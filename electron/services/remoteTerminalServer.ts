import * as http from 'http'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { existsSync, readdirSync, statSync, realpathSync, readFileSync } from 'fs'
import { execFile } from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'
import { app, BrowserWindow, clipboard } from 'electron'
import QRCode from 'qrcode'
import { deployFtermFetch } from './ptyManager'

const MAX_WS_MESSAGE = 64 * 1024 // 64 KB per message
const MAX_COLS = 500
const MAX_ROWS = 200
const IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes
const PING_INTERVAL_MS = 30 * 1000      // 30 seconds
const TOKEN_TTL_MS = 2 * 60 * 1000      // tokens expire 2 min after auth

interface RemoteSession {
  ws: WebSocket
  ptyProcess: pty.IPty
  pingInterval: ReturnType<typeof setInterval>
  idleTimer: ReturnType<typeof setTimeout>
  cmdCallTimestamps: number[]   // rolling window of widget command exec times
}

const CMD_RATE_LIMIT = 60         // max widget exec calls per minute per session
const RATE_WINDOW_MS = 60 * 1000

function checkRate(stamps: number[], limit: number): boolean {
  const now = Date.now()
  // Drop entries outside the window
  while (stamps.length && stamps[0] < now - RATE_WINDOW_MS) stamps.shift()
  if (stamps.length >= limit) return false
  stamps.push(now)
  return true
}

// ─── Widget data helpers (used over WS for remote widgets) ───────────────────

// ─── Security: filesystem allowlist + sensitive-path deny ────────────────────
//
// Whitelist of path prefixes the remote client may browse:
//   - user homedir (covers most user files)
//   - drive roots on Windows (so user can pick files from secondary drives)
//   - Unix mount points (/mnt, /media, /Volumes)
// Sensitive directories (.ssh, .aws, .gnupg, keyrings, credentials, etc.) are
// denied even inside the allowlist. Reading these would leak SSH keys, cloud
// credentials, OAuth tokens, etc. to anyone holding a valid session.

function listWindowsDrives(): string[] {
  const drives: string[] = []
  for (let c = 65; c <= 90; c++) {
    const root = String.fromCharCode(c) + ':\\'
    try { statSync(root); drives.push(root.toLowerCase()) } catch { /* not present */ }
  }
  return drives
}

const ALLOWED_ROOTS: string[] = (() => {
  const roots = [os.homedir(), os.tmpdir(), app.getPath('appData'), app.getPath('userData')]
  if (process.platform === 'win32') {
    roots.push(...listWindowsDrives())
  } else {
    roots.push('/mnt', '/media', '/Volumes', '/opt', '/srv', '/var/log', '/etc', '/usr', '/home')
  }
  return roots.map(r => path.resolve(r))
})()

// Files / directories whose contents would expose credentials. Block reads and
// hide entries from listings. Match by normalized lowercase suffix.
const SENSITIVE_NAMES = new Set([
  '.ssh', '.aws', '.gnupg', '.gnupg.d',
  '.docker', '.kube', '.azure', '.gcp', '.config/gcloud',
  '.npmrc', '.yarnrc', '.netrc', '.pypirc',
  'credentials.json', 'credentials',
  'id_rsa', 'id_ed25519', 'id_dsa', 'id_ecdsa',
  '.git-credentials',
])
const SENSITIVE_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks'])
const SENSITIVE_REGEX = /(^|[\\/])(\.ssh|\.aws|\.gnupg|\.kube|\.azure|\.docker|\.config[\\/]gcloud|\.config[\\/]gh)([\\/]|$)/i

function isSensitivePath(p: string): boolean {
  const norm = p.replace(/\\/g, '/').toLowerCase()
  if (SENSITIVE_REGEX.test(norm)) return true
  const base = path.basename(p).toLowerCase()
  if (SENSITIVE_NAMES.has(base)) return true
  const ext = path.extname(base)
  if (SENSITIVE_EXT.has(ext)) return true
  // Common credential / secret filename patterns
  if (/(^|[._-])(secret|secrets|password|passwords|token|api[_-]?key|private[_-]?key)([._-]|$)/i.test(base)) return true
  if (/\.env(\.|$)/i.test(base) || base === '.env') return true
  return false
}

function isPathSafe(p: string): boolean {
  try {
    const resolved = path.resolve(p)
    const lower = resolved.toLowerCase()
    // System-internals blocklist (always denied, even within allowed roots)
    if (process.platform === 'win32') {
      if (lower.startsWith('c:\\windows\\system32')) return false
      if (lower.startsWith('c:\\windows\\syswow64')) return false
      if (lower.startsWith('c:\\$recycle.bin')) return false
      if (lower.includes('\\appdata\\local\\microsoft\\credentials')) return false
      if (lower.includes('\\appdata\\roaming\\microsoft\\credentials')) return false
      if (lower.includes('\\appdata\\local\\microsoft\\vault')) return false
    } else {
      if (resolved === '/proc' || resolved.startsWith('/proc/')) return false
      if (resolved.startsWith('/sys/')) return false
      if (resolved.startsWith('/dev/')) return false
      if (resolved === '/root' || resolved.startsWith('/root/')) return false
    }
    // Must be within an allowed root
    const withinRoot = ALLOWED_ROOTS.some(root => {
      const r = root.toLowerCase()
      return lower === r || lower.startsWith(r.endsWith(path.sep.toLowerCase()) ? r : r + path.sep.toLowerCase())
    })
    if (!withinRoot) return false
    return true
  } catch { return false }
}

function fsListDir(dirPath: string): { entries: Array<{ name: string; isDir: boolean; size: number }>; error?: string; path?: string } {
  if (typeof dirPath !== 'string') return { entries: [], error: 'Invalid path' }
  const resolved = path.resolve(dirPath || os.homedir())
  if (!isPathSafe(resolved)) return { entries: [], error: 'Path not allowed' }
  if (isSensitivePath(resolved)) return { entries: [], error: 'Directory contains sensitive data — access blocked' }
  try {
    const raw = readdirSync(resolved, { withFileTypes: true })
    const entries = raw
      // Hide sensitive entries entirely from listings (don't even reveal existence)
      .filter(e => !isSensitivePath(path.join(resolved, e.name)))
      .map(e => {
        const entryPath = path.join(resolved, e.name)
        let size = 0
        let isDir = e.isDirectory()
        try {
          if (e.isSymbolicLink()) {
            const real = realpathSync(entryPath)
            // Symlink target must also pass allowlist + sensitive checks
            if (!isPathSafe(real) || isSensitivePath(real)) return null
            const st = statSync(real)
            isDir = st.isDirectory()
            size = isDir ? 0 : st.size
          } else if (!isDir) {
            size = statSync(entryPath).size
          }
        } catch { /* permission denied — leave defaults */ }
        return { name: e.name, isDir, size }
      })
      .filter((e): e is { name: string; isDir: boolean; size: number } => e !== null)
    return { entries, path: resolved }
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException)?.code === 'EACCES' ? 'Access denied'
      : (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'Not found'
      : (err as Error).message
    return { entries: [], error: msg }
  }
}

const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
}

function fsReadImage(filePath: string): { dataUrl?: string; error?: string; name?: string } {
  if (typeof filePath !== 'string') return { error: 'Invalid path' }
  const resolved = path.resolve(filePath)
  if (!isPathSafe(resolved)) return { error: 'Path not allowed' }
  if (isSensitivePath(resolved)) return { error: 'Path flagged as sensitive' }
  const ext = path.extname(resolved).toLowerCase()
  const mime = IMAGE_EXT_MIME[ext]
  if (!mime) return { error: 'Not an image' }
  try {
    const real = realpathSync(resolved)
    if (!isPathSafe(real) || isSensitivePath(real)) return { error: 'Symlink target not allowed' }
    const st = statSync(real)
    if (st.size > 12 * 1024 * 1024) return { error: 'Image too large (>12 MB)' }
    const buf = readFileSync(real)
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, name: path.basename(real) }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

function fsReadText(filePath: string): { content?: string; error?: string } {
  if (typeof filePath !== 'string') return { error: 'Invalid path' }
  const resolved = path.resolve(filePath)
  if (!isPathSafe(resolved)) return { error: 'Path not allowed' }
  if (isSensitivePath(resolved)) return { error: 'File flagged as sensitive — read blocked' }
  try {
    // Resolve symlinks before reading so we don't follow a symlink that escapes the allowlist
    const real = realpathSync(resolved)
    if (!isPathSafe(real) || isSensitivePath(real)) return { error: 'Symlink target not allowed' }
    const st = statSync(real)
    if (st.size > 512 * 1024) return { error: 'File too large (>512 KB)' }
    return { content: readFileSync(real, 'utf8') }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

function execAsync(cmd: string, args: string[], timeoutMs = 5000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        code: err && typeof (err as NodeJS.ErrnoException).code === 'number' ? (err as any).code : (err ? 1 : 0),
      })
    })
  })
}

/** Restrict portscan / ping targets to loopback + RFC1918 / link-local / unique-local. */
function isPrivateTarget(host: string): boolean {
  const h = host.toLowerCase().trim()
  if (!h) return false
  if (h === 'localhost' || h === 'localhost.localdomain') return true
  // IPv4
  const m4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m4) {
    const a = +m4[1], b = +m4[2]
    if ([a, b, +m4[3], +m4[4]].some(n => n > 255)) return false
    if (a === 127) return true                       // loopback
    if (a === 10) return true                        // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true          // 192.168/16
    if (a === 169 && b === 254) return true          // link-local
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  // IPv6: loopback, link-local, unique-local
  if (h === '::1' || h === '[::1]') return true
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  // Hostname without dots resolves on local LAN typically (NetBIOS / mDNS).
  // Allow short hostnames (no dot) — likely intranet.
  if (!h.includes('.') && /^[a-z0-9-]+$/.test(h)) return true
  // .local mDNS suffix
  if (h.endsWith('.local')) return true
  return false
}

async function probePort(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean) => { if (done) return; done = true; try { socket.destroy() } catch { /* ignore */ } resolve(ok) }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try { socket.connect(port, host) } catch { finish(false) }
  })
}

async function fetchWeather(query: string): Promise<{ data?: string; error?: string }> {
  const safeQuery = encodeURIComponent(query || '').replace(/[^a-zA-Z0-9%~,_-]/g, '')
  const url = `https://wttr.in/${safeQuery}?format=j1`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { data: await res.text() }
  } catch (err) {
    return { error: (err as Error).message }
  }
}


let server: http.Server | null = null
let wss: WebSocketServer | null = null
let currentPin = ''
// token → expiry timestamp (not just boolean; lets us reject stale tokens)
const tokens = new Map<string, number>()
const sessions = new Set<RemoteSession>()
let mainWin: BrowserWindow | null = null

function generatePin(): string {
  return String(crypto.randomInt(100000, 1000000))
}

function generateToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

const failedAttempts = new Map<string, { count: number; lockedUntil: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

function isLocked(ip: string): boolean {
  const rec = failedAttempts.get(ip)
  if (!rec) return false
  if (rec.lockedUntil > Date.now()) return true
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) failedAttempts.delete(ip)
  return false
}

function recordFailure(ip: string): void {
  const rec = failedAttempts.get(ip) ?? { count: 0, lockedUntil: 0 }
  rec.count += 1
  if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOCKOUT_MS
  failedAttempts.set(ip, rec)
}

function recordSuccess(ip: string): void {
  failedAttempts.delete(ip)
}

function getLocalIps(): string[] {
  const ips: string[] = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) ips.push(iface.address)
    }
  }
  return ips.length ? ips : ['127.0.0.1']
}

function getLocalIp(): string {
  return getLocalIps()[0]
}

async function allowFirewall(port: number): Promise<boolean> {
  if (process.platform !== 'win32') return true
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false
  const { execFile } = require('child_process') as typeof import('child_process')
  const ruleName = `FTerm Remote Terminal Port ${port}`
  return new Promise<boolean>(resolve =>
    execFile('netsh', [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${ruleName}`,
      'dir=in', 'action=allow', 'protocol=TCP',
      `localport=${port}`,
    ], { timeout: 5000 }, (err) => resolve(!err))
  )
}

let cachedRemoteShell: string | null = null
async function detectRemoteShell(): Promise<void> {
  if (cachedRemoteShell) return
  if (process.platform === 'win32') {
    cachedRemoteShell = await new Promise<string>(resolve => {
      const { execFile } = require('child_process') as typeof import('child_process')
      execFile('where', ['pwsh.exe'], { timeout: 1500 }, (err, stdout) => {
        if (err || !stdout) return resolve('powershell.exe')
        const first = String(stdout).split(/\r?\n/)[0].trim()
        resolve(first || 'powershell.exe')
      })
    })
  } else {
    cachedRemoteShell = process.env.SHELL || '/bin/bash'
  }
}

function getShell(): string {
  return cachedRemoteShell || (process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'))
}

function broadcastClientCount() {
  mainWin?.webContents.send('remote:clients', sessions.size)
}

// Serve xterm.js assets from the app's node_modules so the client works on
// air-gapped LANs without any internet dependency.
function serveStaticFile(res: http.ServerResponse, filePath: string, contentType: string): boolean {
  try {
    const fs = require('fs') as typeof import('fs')
    const content = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'max-age=3600' })
    res.end(content)
    return true
  } catch {
    return false
  }
}

// Full-featured xterm.js client:
// - proper ANSI/256-color rendering  - resize via ResizeObserver + FitAddon
// - mouse reporting (vim, less, etc.) - scrollback 5000 lines
// - touch-to-focus for mobile keyboard  - window.resize listener cleanup
const CLIENT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover"/>
<meta name="theme-color" content="#0d1117"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="mobile-web-app-capable" content="yes"/>
<title>FTerm Remote</title>
<link rel="stylesheet" href="/xterm.css"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%;background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;overscroll-behavior:none}
button{font:inherit;color:inherit}
/* PIN */
#pin{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;padding:32px}
#pin h1{font-size:22px;font-weight:600}
#pin p{font-size:13px;color:#8b949e;text-align:center;max-width:260px}
#pin-input{width:160px;padding:12px 16px;border-radius:8px;border:1px solid #30363d;background:#161b22;color:#c9d1d9;font-size:24px;font-family:monospace;letter-spacing:.3em;text-align:center;outline:none}
#pin-input:focus{border-color:#58a6ff}
#pin-btn{padding:10px 28px;border-radius:8px;border:none;background:#238636;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
#pin-btn:disabled{opacity:.5}
#pin-err{color:#f85149;font-size:13px;min-height:18px;text-align:center}
/* App */
#app{display:none;flex-direction:column;height:100%}
#topbar{display:flex;align-items:center;padding:6px 8px;background:#161b22;border-bottom:1px solid #30363d;font-size:12px;color:#8b949e;flex-shrink:0;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;background:#3fb950;flex-shrink:0}
.tab{padding:6px 12px;border-radius:6px;cursor:pointer;background:none;border:none;color:#8b949e;font-size:12px;font-weight:600}
.tab.on{background:#21262d;color:#c9d1d9}
.spacer{flex:1}
.icon-btn{cursor:pointer;background:none;border:none;color:#8b949e;font-size:18px;padding:4px 8px;line-height:1;border-radius:4px}
.icon-btn:active{background:#21262d}
#disc{color:#f85149}
/* Views */
.view{flex:1;display:none;overflow:hidden;flex-direction:column;min-height:0}
.view.on{display:flex}
/* Terminal view */
#term-container{flex:1;overflow:hidden;background:#0d1117;padding:2px;min-height:0}
.xterm{height:100%!important}
.xterm-viewport{overflow-y:auto!important}
/* Mobile keybar */
#keybar{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:4px;padding:4px;background:#161b22;border-top:1px solid #30363d;flex-shrink:0;scrollbar-width:none}
#keybar::-webkit-scrollbar{display:none}
.kb{flex:0 0 auto;padding:8px 10px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:12px;font-family:monospace;min-width:36px;text-align:center;cursor:pointer;user-select:none}
.kb:active{background:#30363d}
.kb.sticky{background:#1f6feb;border-color:#388bfd;color:#fff}
.kb.danger{color:#f85149}
.kb.wide{min-width:54px}
/* Quick launchers */
#launchers{display:flex;gap:6px;padding:6px 8px;background:#0d1117;border-top:1px solid #30363d;overflow-x:auto;flex-shrink:0;scrollbar-width:none}
#launchers::-webkit-scrollbar{display:none}
.launcher{flex:0 0 auto;padding:6px 12px;background:#21262d;border:1px solid #30363d;border-radius:14px;color:#c9d1d9;font-size:11px;cursor:pointer}
.launcher:active{background:#30363d}
/* Tools view */
#tools-view{padding:0;overflow:hidden;display:none;flex-direction:column;min-height:0}
#tools-view.on{display:flex}
#tools-selector{display:flex;gap:4px;padding:8px;background:#161b22;border-bottom:1px solid #30363d;overflow-x:auto;flex-shrink:0;scrollbar-width:none}
#tools-selector::-webkit-scrollbar{display:none}
.wsel{flex:0 0 auto;padding:6px 12px;background:#21262d;border:1px solid #30363d;border-radius:14px;color:#8b949e;font-size:11px;cursor:pointer;white-space:nowrap}
.wsel.on{background:#1f6feb;border-color:#388bfd;color:#fff}
#tools-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;min-height:0}
.row{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.row input,.row select{flex:1;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:12px;outline:none;min-width:0}
.row button{padding:8px 14px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer}
.fs-item{display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #21262d;font-size:12px;cursor:pointer;gap:8px;align-items:center}
.fs-item:active{background:#21262d}
.fs-item .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs-item .size{color:#8b949e;font-family:monospace;font-size:11px;flex-shrink:0}
.fs-launch{background:#bc8cff;color:#0d1117;border:none;border-radius:4px;padding:6px 10px;font-size:14px;cursor:pointer;flex-shrink:0}
.fs-launch:active{background:#a371f7}
.fs-path{font-family:monospace;font-size:11px;color:#8b949e;padding:6px 8px;background:#0d1117;border-radius:4px;margin-bottom:8px;word-break:break-all}
.port-row{display:flex;justify-content:space-between;padding:4px 8px;font-family:monospace;font-size:12px;border-bottom:1px solid #21262d}
.port-open{color:#3fb950}
.port-closed{color:#8b949e}
.docker-row{padding:8px;border:1px solid #30363d;border-radius:6px;margin-bottom:6px;background:#0d1117}
.docker-row .name{font-weight:600;font-size:13px}
.docker-row .meta{color:#8b949e;font-size:11px;font-family:monospace;margin-top:2px;word-break:break-all}
.docker-row .actions{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}
.docker-row .actions button{padding:4px 10px;font-size:11px;border-radius:4px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;cursor:pointer}
.docker-row .actions button.danger{color:#f85149}
.fetch-art{font-family:'Cascadia Code',monospace;font-size:11px;color:#58a6ff;white-space:pre;line-height:1.2;text-align:center;margin-bottom:8px}
pre.out{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;overflow-x:auto;font-family:'Cascadia Code',monospace;font-size:11px;color:#c9d1d9;white-space:pre-wrap;word-wrap:break-word;max-height:60vh}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
.card h3{font-size:13px;font-weight:600;color:#c9d1d9;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.card .stat{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:#8b949e}
.card .stat b{color:#c9d1d9;font-family:monospace}
.bar{height:6px;background:#21262d;border-radius:3px;overflow:hidden;margin-top:4px}
.bar>span{display:block;height:100%;background:linear-gradient(90deg,#3fb950,#d29922,#f85149);transition:width .3s}
/* Send-text modal */
/* Image viewer */
#img-modal .img-wrap{width:100%;height:100%;display:flex;flex-direction:column;background:#000;border-radius:0;padding:0;max-width:none}
.img-bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0d1117;border-bottom:1px solid #30363d;color:#c9d1d9;font-size:12px;flex-shrink:0}
.img-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:8px;touch-action:pinch-zoom}
.img-stage img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal.on{display:flex}
.modal-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;width:100%;max-width:400px;display:flex;flex-direction:column;gap:10px}
.modal-box h3{font-size:14px;font-weight:600}
.modal-box textarea{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:13px;resize:vertical;min-height:80px;outline:none}
.modal-buttons{display:flex;gap:8px;justify-content:flex-end}
.modal-buttons button{padding:8px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600}
.btn-ok{background:#238636;color:#fff}
.btn-cancel{background:#21262d;color:#c9d1d9}
</style>
</head>
<body>
<div id="pin">
  <h1>FTerm Remote</h1>
  <p>Enter the 6-digit PIN shown in the FTerm app</p>
  <input id="pin-input" type="tel" placeholder="000000" maxlength="6" autocomplete="off" inputmode="numeric"/>
  <div id="pin-err"></div>
  <button id="pin-btn">Connect</button>
  <div id="pin-warn" style="margin-top:24px;padding:10px 14px;background:#332701;border:1px solid #d29922;border-radius:6px;color:#e3b341;font-size:11px;max-width:300px;text-align:center;line-height:1.5">
    ⚠ LAN-only. Traffic is unencrypted (HTTP). Only connect over a trusted network you control. Anyone on the same network can intercept your session if they obtain the PIN.
  </div>
</div>

<div id="app">
  <div id="topbar">
    <span class="dot"></span>
    <button class="tab on" data-view="term">Term</button>
    <button class="tab" data-view="tools">Tools</button>
    <span class="spacer"></span>
    <button class="icon-btn" id="paste-btn" title="Paste text">📋</button>
    <button class="icon-btn" id="kbd-btn" title="Show keyboard">⌨</button>
    <button class="icon-btn" id="disc" title="Disconnect">✕</button>
  </div>

  <!-- Terminal view -->
  <div class="view on" id="term-view">
    <div id="term-container"></div>
    <div id="launchers">
      <button class="launcher" data-cmd="claude">claude</button>
      <button class="launcher" data-cmd="claude --continue">continue</button>
      <button class="launcher" data-cmd="ls">ls</button>
      <button class="launcher" data-cmd="git status">git status</button>
      <button class="launcher" data-cmd="cd ..">cd ..</button>
      <button class="launcher" data-key="\\x03">^C</button>
      <button class="launcher" data-key="\\x04">^D</button>
      <button class="launcher" data-key="\\x0c">clear</button>
    </div>
    <div id="keybar">
      <button class="kb sticky-toggle" data-mod="ctrl">Ctrl</button>
      <button class="kb sticky-toggle" data-mod="alt">Alt</button>
      <button class="kb" data-key="\\x1b">Esc</button>
      <button class="kb" data-key="\\t">Tab</button>
      <button class="kb" data-key="\\x1b[A">↑</button>
      <button class="kb" data-key="\\x1b[B">↓</button>
      <button class="kb" data-key="\\x1b[D">←</button>
      <button class="kb" data-key="\\x1b[C">→</button>
      <button class="kb" data-key="|">|</button>
      <button class="kb" data-key="\\\\">\\</button>
      <button class="kb" data-key="/">/</button>
      <button class="kb" data-key="~">~</button>
      <button class="kb" data-key="-">-</button>
      <button class="kb" data-key="_">_</button>
      <button class="kb" data-key="=">=</button>
      <button class="kb" data-key="$">$</button>
      <button class="kb" data-key="&amp;">&amp;</button>
      <button class="kb" data-key="*">*</button>
      <button class="kb" data-key="(">(</button>
      <button class="kb" data-key=")">)</button>
      <button class="kb" data-key="[">[</button>
      <button class="kb" data-key="]">]</button>
      <button class="kb" data-key="{">{</button>
      <button class="kb" data-key="}">}</button>
      <button class="kb" data-key="&lt;">&lt;</button>
      <button class="kb" data-key="&gt;">&gt;</button>
      <button class="kb" data-key="\\x1b[5~">PgU</button>
      <button class="kb" data-key="\\x1b[6~">PgD</button>
      <button class="kb" data-key="\\x1b[H">Home</button>
      <button class="kb" data-key="\\x1b[F">End</button>
    </div>
  </div>

  <!-- Tools view -->
  <div class="view" id="tools-view">
    <div id="tools-selector">
      <button class="wsel on" data-w="sysinfo">📊 System</button>
      <button class="wsel" data-w="ftermfetch">🎨 Ftermfetch</button>
      <button class="wsel" data-w="explorer">📁 Files</button>
      <button class="wsel" data-w="weather">☀ Weather</button>
      <button class="wsel" data-w="ping">📡 Ping</button>
      <button class="wsel" data-w="portscan">🔌 Ports</button>
      <button class="wsel" data-w="docker">🐳 Docker</button>
      <button class="wsel" data-w="clipboard">📋 Clipboard</button>
    </div>
    <div id="tools-body"></div>
  </div>
</div>

<!-- Image viewer modal -->
<div class="modal" id="img-modal">
  <div class="img-wrap">
    <div class="img-bar">
      <span id="img-name"></span>
      <button id="img-close" class="icon-btn" style="color:#fff">✕</button>
    </div>
    <div class="img-stage"><img id="img-el" alt=""/></div>
  </div>
</div>

<!-- Send-text modal (for pasting / typing long input) -->
<div class="modal" id="paste-modal">
  <div class="modal-box">
    <h3>Send text to terminal</h3>
    <textarea id="paste-text" placeholder="Type or paste text here…"></textarea>
    <div class="modal-buttons">
      <button class="btn-cancel" id="paste-cancel">Cancel</button>
      <button class="btn-ok" id="paste-send">Send</button>
    </div>
  </div>
</div>

<script src="/xterm.js"></script>
<script src="/xterm-addon-fit.js"></script>
<script>
(function(){
var $=function(id){return document.getElementById(id)};
var pinDiv=$('pin'),appDiv=$('app');
var pinInput=$('pin-input'),pinBtn=$('pin-btn'),pinErr=$('pin-err');
var ws=null,term=null,fitAddon=null,ro=null,sendResize=null;
var sysTimer=null;
var stickyMods={ctrl:false,alt:false};

// ── Auth ──────────────────────────────────────────────────────────────
async function connect(){
  var pin=pinInput.value.trim();
  if(pin.length<6){pinErr.textContent='Enter a 6-digit PIN';return}
  pinErr.textContent='';pinBtn.disabled=true;pinBtn.textContent='Connecting…';
  try{
    var r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})});
    var d=await r.json();
    if(!r.ok)throw new Error(d.error||'Auth failed');
    openApp(d.token);
  }catch(e){pinErr.textContent=e.message;pinBtn.disabled=false;pinBtn.textContent='Connect'}
}

// ── Main app ──────────────────────────────────────────────────────────
function openApp(token){
  pinDiv.style.display='none';appDiv.style.display='flex';
  // Lock app height to visible viewport (not window) so mobile keyboard doesn't hide keybar
  setTimeout(syncViewport,50);

  term=new Terminal({
    theme:{
      background:'#0d1117',foreground:'#c9d1d9',cursor:'#58a6ff',
      selectionBackground:'rgba(88,166,255,0.3)',
      black:'#0d1117',red:'#f85149',green:'#3fb950',yellow:'#d29922',
      blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#c9d1d9',
      brightBlack:'#8b949e',brightRed:'#ffa198',brightGreen:'#56d364',
      brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',
      brightCyan:'#56d4dd',brightWhite:'#ffffff'
    },
    fontFamily:"'Cascadia Code','Fira Code','Courier New',monospace",
    fontSize:13,lineHeight:1.45,cursorBlink:true,scrollback:5000,
    allowProposedApi:true
  });
  fitAddon=new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  var container=$('term-container');
  term.open(container);
  fitAddon.fit();

  var proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(proto+'://'+location.host+'/api/terminal?token='+encodeURIComponent(token));
  ws.onopen=function(){
    sendResize();
    term.focus();
  };
  ws.onmessage=function(e){
    try{
      var m=JSON.parse(e.data);
      if(m.type==='data'){term.write(m.data);}
      else if(m.type==='sysinfo:data'){renderSysinfo(m.data);}
      else if(m.type==='ftermfetch'){renderFtermfetch(m.data);}
      else if(m.type==='fs:home'){fsCurrentPath=m.data.home;sendWs({type:'fs:list',path:m.data.home});}
      else if(m.type==='fs:list'){renderExplorer(m.data);}
      else if(m.type==='fs:drives'){renderDrives(m.data);}
      else if(m.type==='fs:image'){openImage(m.data);}
      else if(m.type==='weather'){renderWeather(m.data);}
      else if(m.type==='ping'){renderPing(m.data);}
      else if(m.type==='portscan'){renderPortscan(m.data);}
      else if(m.type==='docker:ps'){renderDocker(m.data);}
      else if(m.type==='docker:action'){/* refresh handled by caller */}
      else if(m.type==='clipboard:read'){renderClipboard(m.data);}
    }catch(ex){}
  };
  ws.onclose=function(){disconnect('Disconnected.')};
  ws.onerror=function(){disconnect('Connection error.')};

  term.onData(function(data){sendWs({type:'data',data:data})});

  sendResize=function(){
    if(!term||!fitAddon||!ws||ws.readyState!==1)return;
    fitAddon.fit();
    sendWs({type:'resize',cols:term.cols,rows:term.rows});
  };
  ro=new ResizeObserver(sendResize);
  ro.observe(container);
  window.addEventListener('resize',sendResize);
  container.addEventListener('touchend',function(e){
    // Don't grab focus from keybar buttons
    if(e.target!==container&&e.target.parentNode!==container)return;
    e.preventDefault();
    if(term)term.focus();
  });
}

function sendWs(obj){
  if(ws&&ws.readyState===1)ws.send(JSON.stringify(obj));
}

function disconnect(msg){
  if(sysTimer){clearInterval(sysTimer);sysTimer=null;}
  if(sendResize){window.removeEventListener('resize',sendResize);sendResize=null;}
  if(ro){ro.disconnect();ro=null;}
  if(ws){try{ws.close()}catch(e){}}ws=null;
  if(term){term.dispose();term=null;}
  fitAddon=null;
  appDiv.style.display='none';pinDiv.style.display='flex';
  pinInput.value='';pinBtn.disabled=false;pinBtn.textContent='Connect';
  pinErr.textContent=msg||'Disconnected.';
}

// ── Tab switching ─────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click',function(){
    var v=t.dataset.view;
    document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('on',x===t)});
    document.querySelectorAll('.view').forEach(function(x){x.classList.toggle('on',x.id===v+'-view')});
    if(v==='term'&&term){setTimeout(function(){fitAddon&&fitAddon.fit();sendResize&&sendResize();term.focus();},50);}
    if(v==='tools'){openWidget(activeWidget);}
    else if(sysTimer){clearInterval(sysTimer);sysTimer=null;}
  });
});

// ── Mobile key bar ────────────────────────────────────────────────────
function decode(s){
  return s.replace(/\\\\x([0-9a-f]{2})/gi,function(_,h){return String.fromCharCode(parseInt(h,16))})
          .replace(/\\\\t/g,'\\t').replace(/\\\\n/g,'\\n').replace(/\\\\r/g,'\\r')
          .replace(/\\\\\\\\/g,'\\\\');
}
function sendKey(raw){
  if(!ws||ws.readyState!==1)return;
  var data=raw;
  if(stickyMods.ctrl){
    // Ctrl + letter → control char
    var c=raw.toLowerCase();
    if(c.length===1&&c>='a'&&c<='z'){data=String.fromCharCode(c.charCodeAt(0)-96);}
    stickyMods.ctrl=false;updateMods();
  }
  if(stickyMods.alt){
    data='\\x1b'+data;
    stickyMods.alt=false;updateMods();
  }
  sendWs({type:'data',data:data});
}
function updateMods(){
  document.querySelectorAll('.kb.sticky-toggle').forEach(function(b){
    b.classList.toggle('sticky',!!stickyMods[b.dataset.mod]);
  });
}
document.querySelectorAll('#keybar .kb').forEach(function(b){
  b.addEventListener('click',function(e){
    e.preventDefault();
    if(b.dataset.mod){stickyMods[b.dataset.mod]=!stickyMods[b.dataset.mod];updateMods();return;}
    if(b.dataset.key){sendKey(decode(b.dataset.key));}
  });
});

// ── Launchers ─────────────────────────────────────────────────────────
document.querySelectorAll('#launchers .launcher').forEach(function(b){
  b.addEventListener('click',function(e){
    e.preventDefault();
    if(b.dataset.cmd){sendWs({type:'data',data:b.dataset.cmd+'\\r'});}
    else if(b.dataset.key){sendKey(decode(b.dataset.key));}
  });
});

// ── Paste modal ───────────────────────────────────────────────────────
$('paste-btn').addEventListener('click',function(){
  $('paste-modal').classList.add('on');
  $('paste-text').value='';$('paste-text').focus();
});
$('paste-cancel').addEventListener('click',function(){$('paste-modal').classList.remove('on')});
$('paste-send').addEventListener('click',function(){
  var t=$('paste-text').value;
  if(t)sendWs({type:'data',data:t});
  $('paste-modal').classList.remove('on');
});
$('kbd-btn').addEventListener('click',function(){if(term)term.focus()});
$('disc').addEventListener('click',function(){disconnect()});

function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── Tools view (multi-widget) ─────────────────────────────────────────
var activeWidget='sysinfo';
var fsCurrentPath='';
var pendingReqs={};
function fmtBytes(n){
  if(n<1024)return n+' B';
  if(n<1048576)return (n/1024).toFixed(1)+' KB';
  if(n<1073741824)return (n/1048576).toFixed(1)+' MB';
  return (n/1073741824).toFixed(2)+' GB';
}
function fmtUptime(s){
  var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return (d?d+'d ':'')+(h?h+'h ':'')+m+'m';
}
function reqId(){return 'r-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);}

document.querySelectorAll('.wsel').forEach(function(b){
  b.addEventListener('click',function(){
    document.querySelectorAll('.wsel').forEach(function(x){x.classList.toggle('on',x===b)});
    activeWidget=b.dataset.w;
    openWidget(activeWidget);
  });
});

function openWidget(name){
  if(sysTimer){clearInterval(sysTimer);sysTimer=null;}
  var body=$('tools-body');body.innerHTML='Loading…';
  if(name==='sysinfo'){
    sendWs({type:'sysinfo'});
    sysTimer=setInterval(function(){sendWs({type:'sysinfo'})},3000);
  } else if(name==='ftermfetch'){
    sendWs({type:'ftermfetch'});
  } else if(name==='explorer'){
    body.innerHTML='';
    sendWs({type:'fs:home'});
  } else if(name==='weather'){
    body.innerHTML='<div class="row"><input id="w-q" placeholder="City (empty = auto-detect)" /><button id="w-go">Get</button></div><div id="w-out"></div>';
    $('w-go').addEventListener('click',function(){
      $('w-out').innerHTML='Loading…';
      sendWs({type:'weather',requestId:reqId(),query:$('w-q').value});
    });
  } else if(name==='ping'){
    body.innerHTML='<div class="row"><input id="p-h" placeholder="Host (e.g. 8.8.8.8)" /><button id="p-go">Ping</button></div><pre class="out" id="p-out">Enter host and press Ping.</pre>';
    $('p-go').addEventListener('click',function(){
      var h=$('p-h').value.trim();if(!h)return;
      $('p-out').textContent='Pinging '+h+'…';
      sendWs({type:'ping',requestId:reqId(),host:h});
    });
  } else if(name==='portscan'){
    body.innerHTML='<div class="row"><input id="ps-h" placeholder="Host" value="127.0.0.1" /><input id="ps-p" placeholder="Ports (e.g. 22,80,443 or 1-1024)" value="22,80,443,3000,5432,6379,8080" /></div><div class="row"><button id="ps-go" style="width:100%">Scan</button></div><div id="ps-out"></div>';
    $('ps-go').addEventListener('click',function(){
      var h=$('ps-h').value.trim();var spec=$('ps-p').value.trim();
      var ports=[];
      spec.split(',').forEach(function(s){
        s=s.trim();var m=s.match(/^(\\d+)-(\\d+)$/);
        if(m){var a=+m[1],b=+m[2];for(var i=a;i<=b&&ports.length<200;i++)ports.push(i);}
        else if(/^\\d+$/.test(s))ports.push(+s);
      });
      if(!h||!ports.length)return;
      $('ps-out').innerHTML='Scanning '+ports.length+' ports…';
      sendWs({type:'portscan',requestId:reqId(),host:h,ports:ports});
    });
  } else if(name==='docker'){
    body.innerHTML='<div class="row"><button id="d-go" style="width:100%">Refresh containers</button></div><div id="d-out">Press Refresh.</div>';
    $('d-go').addEventListener('click',function(){
      $('d-out').innerHTML='Loading…';sendWs({type:'docker:ps',requestId:reqId()});
    });
  } else if(name==='clipboard'){
    body.innerHTML='<div class="row"><button id="c-read">Read host clipboard</button><button id="c-paste-term">Paste to terminal</button></div><textarea id="c-text" style="width:100%;min-height:120px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;outline:none" placeholder="Host clipboard contents will appear here. Edit and press Write to update."></textarea><div class="row" style="margin-top:8px"><button id="c-write" style="width:100%">Write to host clipboard</button></div>';
    $('c-read').addEventListener('click',function(){sendWs({type:'clipboard:read'});});
    $('c-write').addEventListener('click',function(){sendWs({type:'clipboard:write',text:$('c-text').value});});
    $('c-paste-term').addEventListener('click',function(){sendWs({type:'data',data:$('c-text').value});});
    // Note: do NOT auto-read clipboard on widget open. Host clipboard may contain
    // passwords / tokens — only read on explicit user action via the Read button.
  }
}

function renderSysinfo(d){
  if(activeWidget!=='sysinfo')return;
  var pct=d.memUsedPct.toFixed(1);
  $('tools-body').innerHTML=
    '<div class="card"><h3>🖥 System</h3>'+
      '<div class="stat"><span>Host</span><b>'+escapeHtml(d.hostname)+'</b></div>'+
      '<div class="stat"><span>OS</span><b>'+escapeHtml(d.platform)+' '+escapeHtml(d.arch)+'</b></div>'+
      '<div class="stat"><span>Kernel</span><b>'+escapeHtml(d.release)+'</b></div>'+
      '<div class="stat"><span>Uptime</span><b>'+fmtUptime(d.uptime)+'</b></div>'+
    '</div>'+
    '<div class="card"><h3>⚡ CPU</h3>'+
      '<div class="stat"><span>Cores</span><b>'+d.cpus+'</b></div>'+
      '<div class="stat"><span>Model</span><b style="font-size:10px">'+escapeHtml(d.cpuModel)+'</b></div>'+
      '<div class="stat"><span>Load (1/5/15)</span><b>'+d.loadavg.map(function(x){return x.toFixed(2)}).join(' / ')+'</b></div>'+
    '</div>'+
    '<div class="card"><h3>💾 Memory</h3>'+
      '<div class="stat"><span>Used</span><b>'+pct+'%</b></div>'+
      '<div class="bar"><span style="width:'+pct+'%"></span></div>'+
      '<div class="stat"><span>Total</span><b>'+fmtBytes(d.memTotal)+'</b></div>'+
      '<div class="stat"><span>Free</span><b>'+fmtBytes(d.memFree)+'</b></div>'+
    '</div>';
}
function renderFtermfetch(d){
  if(activeWidget!=='ftermfetch')return;
  var art='   ╱╲╱╲   \\n  ( o o )  \\n   > ‿ <   \\n  /│ F │\\\\\\n   ‾‾‾‾‾   ';
  $('tools-body').innerHTML=
    '<div class="card"><div class="fetch-art">'+art+'</div>'+
    '<div class="stat"><span>User</span><b>'+escapeHtml(d.user)+'@'+escapeHtml(d.hostname)+'</b></div>'+
    '<div class="stat"><span>OS</span><b>'+escapeHtml(d.platform)+' '+escapeHtml(d.arch)+'</b></div>'+
    '<div class="stat"><span>Kernel</span><b>'+escapeHtml(d.kernel)+'</b></div>'+
    '<div class="stat"><span>Uptime</span><b>'+fmtUptime(d.uptime)+'</b></div>'+
    '<div class="stat"><span>CPUs</span><b>'+d.cpus+'</b></div>'+
    '<div class="stat"><span>CPU</span><b style="font-size:10px">'+escapeHtml(d.cpuModel)+'</b></div>'+
    '<div class="stat"><span>Memory</span><b>'+fmtBytes(d.memUsed)+' / '+fmtBytes(d.memTotal)+'</b></div>'+
    '<div class="stat"><span>Shell</span><b style="font-size:10px">'+escapeHtml(d.shell)+'</b></div>'+
    '<div class="stat"><span>Node</span><b>'+escapeHtml(d.node)+'</b></div>'+
    '<div class="stat"><span>Electron</span><b>'+escapeHtml(d.electron)+'</b></div>'+
    '</div>';
}
function renderExplorer(d){
  if(activeWidget!=='explorer')return;
  if(d.error){$('tools-body').innerHTML='<div class="card">Error: '+escapeHtml(d.error)+'</div>'+
    '<div class="row" style="margin-top:8px"><button id="fs-back" style="width:100%">⬅ Back</button></div>';
    $('fs-back').addEventListener('click',function(){sendWs({type:'fs:home'});});
    return;
  }
  fsCurrentPath=d.path||fsCurrentPath;
  var html='<div class="fs-path" id="fs-path-display">'+escapeHtml(fsCurrentPath)+'</div>';
  html+='<div class="row"><input id="fs-input" value="'+escapeHtml(fsCurrentPath)+'" placeholder="Type path and Enter"/><button id="fs-go">Go</button></div>';
  html+='<div class="row"><button id="fs-up" style="flex:1">⬆ Up</button><button id="fs-home" style="flex:1">🏠 Home</button><button id="fs-drives" style="flex:1">💽 Drives</button></div>';
  html+='<div class="row"><button id="fs-claude-here" style="flex:2;background:#bc8cff;color:#0d1117">🚀 Claude here</button><button id="fs-cd-here" style="flex:1">cd here</button></div>';
  html+='<div id="fs-list">';
  var entries=(d.entries||[]).slice().sort(function(a,b){
    if(a.isDir!==b.isDir)return a.isDir?-1:1;
    return a.name.localeCompare(b.name);
  });
  entries.forEach(function(e,i){
    var actions=e.isDir?'<button class="fs-launch" data-i="'+i+'" title="Open Claude here">🚀</button>':'';
    html+='<div class="fs-item" data-i="'+i+'"><span class="name">'+(e.isDir?'📁':'📄')+' '+escapeHtml(e.name)+'</span><span class="size">'+(e.isDir?'':fmtBytes(e.size))+'</span>'+actions+'</div>';
  });
  html+='</div>';
  $('tools-body').innerHTML=html;
  $('fs-up').addEventListener('click',function(){
    var parent=fsCurrentPath.replace(/[\\\\\\/][^\\\\\\/]*$/,'')||fsCurrentPath;
    // Windows: when at "C:\\foo" stripping gives "C:" → restore trailing sep
    if(/^[A-Za-z]:$/.test(parent))parent=parent+'\\\\';
    sendWs({type:'fs:list',path:parent});
  });
  $('fs-home').addEventListener('click',function(){sendWs({type:'fs:home'});});
  $('fs-drives').addEventListener('click',function(){sendWs({type:'fs:drives'});});
  $('fs-go').addEventListener('click',function(){
    var p=$('fs-input').value.trim();if(p)sendWs({type:'fs:list',path:p});
  });
  $('fs-input').addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();
      var p=$('fs-input').value.trim();if(p)sendWs({type:'fs:list',path:p});
    }
  });
  document.querySelectorAll('#fs-list .fs-item').forEach(function(it){
    it.addEventListener('click',function(ev){
      if(ev.target&&ev.target.classList&&ev.target.classList.contains('fs-launch'))return;
      var e=entries[+it.dataset.i];
      var newPath=joinPath(fsCurrentPath,e.name);
      if(e.isDir){sendWs({type:'fs:list',path:newPath});}
      else if(/\\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(e.name)){
        // Image — fetch as data URL and show in viewer modal
        sendWs({type:'fs:image',requestId:reqId(),path:newPath});
      }
      else{
        var isWin=fsCurrentPath.indexOf('\\\\')>=0||/^[A-Za-z]:/.test(fsCurrentPath);
        sendWs({type:'data',data:(isWin?'type ':'cat ')+'"'+newPath+'"\\r'});
      }
    });
  });
  document.querySelectorAll('#fs-list .fs-launch').forEach(function(b){
    b.addEventListener('click',function(ev){
      ev.stopPropagation();
      var e=entries[+b.dataset.i];
      var target=joinPath(fsCurrentPath,e.name);
      launchClaudeAt(target);
    });
  });
  $('fs-claude-here').addEventListener('click',function(){launchClaudeAt(fsCurrentPath);});
  $('fs-cd-here').addEventListener('click',function(){
    sendWs({type:'data',data:'cd "'+fsCurrentPath+'"\\r'});
    switchTo('term');
  });
}
function joinPath(base,name){
  var isWin=base.indexOf('\\\\')>=0||/^[A-Za-z]:/.test(base);
  var sep=isWin?'\\\\':'/';
  var b=base.replace(/[\\\\\\/]+$/,'');
  if(/^[A-Za-z]:$/.test(b))return b+sep+name;
  return (b||sep)+sep+name;
}
function switchTo(view){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('on',t.dataset.view===view);});
  document.querySelectorAll('.view').forEach(function(v){v.classList.toggle('on',v.id===view+'-view');});
  if(view==='term'&&term){setTimeout(function(){fitAddon&&fitAddon.fit();sendResize&&sendResize();term.focus();},50);}
}
function launchClaudeAt(folder){
  var isWin=folder.indexOf('\\\\')>=0||/^[A-Za-z]:/.test(folder);
  // cd into folder, then start claude. Use && (PowerShell 7+/bash/zsh) — fallback ;
  // PowerShell 5.1 lacks && so use semicolon which always runs both.
  var cmd='cd "'+folder+'"; claude';
  switchTo('term');
  setTimeout(function(){sendWs({type:'data',data:cmd+'\\r'});},80);
}
function renderDrives(d){
  if(activeWidget!=='explorer')return;
  var html='<div class="fs-path">Select drive / mount</div><div id="fs-list">';
  (d.drives||[]).forEach(function(dr,i){
    var meta='';
    if(dr.total){
      var pct=dr.free!=null?((1-dr.free/dr.total)*100).toFixed(0)+'% used':'';
      meta=fmtBytes(dr.total)+(pct?' · '+pct:'');
    }
    html+='<div class="fs-item" data-path="'+escapeHtml(dr.path)+'"><span class="name">💽 '+escapeHtml(dr.label)+' <span style="color:#8b949e;font-size:11px">'+escapeHtml(dr.path)+'</span></span><span class="size">'+meta+'</span></div>';
  });
  html+='</div><div class="row" style="margin-top:8px"><button id="fs-back" style="width:100%">⬅ Back to Home</button></div>';
  $('tools-body').innerHTML=html;
  document.querySelectorAll('#fs-list .fs-item').forEach(function(it){
    it.addEventListener('click',function(){sendWs({type:'fs:list',path:it.dataset.path});});
  });
  $('fs-back').addEventListener('click',function(){sendWs({type:'fs:home'});});
}
function renderWeather(d){
  if(activeWidget!=='weather')return;
  if(d.error){$('w-out').innerHTML='<div class="card">Error: '+escapeHtml(d.error)+'</div>';return;}
  try{
    var j=JSON.parse(d.data);
    var cc=j.current_condition[0];
    var nearest=j.nearest_area[0];
    var loc=nearest.areaName[0].value+', '+nearest.country[0].value;
    var html='<div class="card"><h3>'+escapeHtml(loc)+'</h3>'+
      '<div class="stat"><span>Condition</span><b>'+escapeHtml(cc.weatherDesc[0].value)+'</b></div>'+
      '<div class="stat"><span>Temp</span><b>'+cc.temp_C+'°C / '+cc.temp_F+'°F</b></div>'+
      '<div class="stat"><span>Feels like</span><b>'+cc.FeelsLikeC+'°C</b></div>'+
      '<div class="stat"><span>Humidity</span><b>'+cc.humidity+'%</b></div>'+
      '<div class="stat"><span>Wind</span><b>'+cc.windspeedKmph+' km/h '+cc.winddir16Point+'</b></div>'+
      '<div class="stat"><span>Pressure</span><b>'+cc.pressure+' mb</b></div>'+
      '<div class="stat"><span>UV</span><b>'+cc.uvIndex+'</b></div>'+
    '</div>';
    j.weather.slice(0,3).forEach(function(day){
      html+='<div class="card"><h3>'+day.date+'</h3>'+
      '<div class="stat"><span>Min/Max</span><b>'+day.mintempC+' / '+day.maxtempC+' °C</b></div>'+
      '<div class="stat"><span>Sun</span><b>'+day.astronomy[0].sunrise+' → '+day.astronomy[0].sunset+'</b></div>'+
      '</div>';
    });
    $('w-out').innerHTML=html;
  }catch(e){$('w-out').innerHTML='<pre class="out">'+escapeHtml(d.data||String(e))+'</pre>';}
}
function renderPing(d){
  if(activeWidget!=='ping')return;
  $('p-out').textContent=(d.stdout||'')+(d.stderr?'\\n[stderr]\\n'+d.stderr:'');
}
function renderPortscan(d){
  if(activeWidget!=='portscan')return;
  var open=d.results.filter(function(r){return r.open});
  var html='<div class="card"><h3>'+escapeHtml(d.host)+' — '+open.length+' open / '+d.results.length+' scanned</h3>';
  d.results.forEach(function(r){
    html+='<div class="port-row"><span class="'+(r.open?'port-open':'port-closed')+'">'+(r.open?'●':'○')+' '+r.port+'</span><span>'+(r.open?'open':'closed')+'</span></div>';
  });
  html+='</div>';
  $('ps-out').innerHTML=html;
}
function renderDocker(d){
  if(activeWidget!=='docker')return;
  if(d.error){$('d-out').innerHTML='<div class="card">Docker error: '+escapeHtml(d.error)+'</div>';return;}
  if(!d.stdout||!d.stdout.trim()){$('d-out').innerHTML='<div class="card">No containers.</div>';return;}
  var rows=d.stdout.trim().split('\\n').map(function(l){try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);
  var html='';
  rows.forEach(function(c){
    var running=/up/i.test(c.State||c.Status||'');
    html+='<div class="docker-row"><div class="name">'+(running?'🟢':'⚫')+' '+escapeHtml(c.Names||c.ID||'')+'</div>'+
      '<div class="meta">'+escapeHtml(c.Image||'')+'</div>'+
      '<div class="meta">'+escapeHtml(c.Status||'')+'</div>'+
      '<div class="actions">'+
        (running?'<button data-act="stop" data-id="'+escapeHtml(c.ID)+'">Stop</button>':'<button data-act="start" data-id="'+escapeHtml(c.ID)+'">Start</button>')+
        '<button data-act="restart" data-id="'+escapeHtml(c.ID)+'">Restart</button>'+
        '<button class="danger" data-act="rm" data-id="'+escapeHtml(c.ID)+'">Remove</button>'+
      '</div></div>';
  });
  $('d-out').innerHTML=html||'<div class="card">No containers.</div>';
  document.querySelectorAll('#d-out button[data-act]').forEach(function(b){
    b.addEventListener('click',function(){
      sendWs({type:'docker:action',requestId:reqId(),id:b.dataset.id,action:b.dataset.act});
      setTimeout(function(){sendWs({type:'docker:ps',requestId:reqId()});},700);
    });
  });
}
function renderClipboard(d){
  if(activeWidget!=='clipboard')return;
  if(d.text!==undefined&&$('c-text'))$('c-text').value=d.text;
}

// Image viewer
function openImage(d){
  if(d.error){alert('Image: '+d.error);return;}
  $('img-name').textContent=d.name||'';
  $('img-el').src=d.dataUrl;
  $('img-modal').classList.add('on');
}
$('img-close').addEventListener('click',function(){
  $('img-modal').classList.remove('on');
  $('img-el').src='';
});
$('img-modal').addEventListener('click',function(e){
  if(e.target===$('img-modal')){$('img-modal').classList.remove('on');$('img-el').src='';}
});

// ── Mobile keyboard handling ──────────────────────────────────────────
// When mobile keyboard opens, visualViewport shrinks. Resize #app to the
// visible region so the keybar stays above the keyboard (not hidden behind it).
function syncViewport(){
  var vv=window.visualViewport;
  if(!vv||appDiv.style.display!=='flex')return;
  var h=vv.height;
  appDiv.style.height=h+'px';
  // Keep iOS from scrolling page when keyboard opens
  window.scrollTo(0,0);
  if(term&&fitAddon&&document.querySelector('#term-view.on')){
    try{fitAddon.fit();}catch(e){}
    if(sendResize)sendResize();
  }
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',syncViewport);
  window.visualViewport.addEventListener('scroll',syncViewport);
}

// PIN screen events
pinBtn.addEventListener('click',connect);
pinInput.addEventListener('keydown',function(e){if(e.key==='Enter')connect()});
})();
</script>
</body>
</html>`

// Security headers applied to all HTML / static responses.
// - CSP: self-only sources (no inline-script bypass since we inline our own script
//   tags and inline styles; we use 'unsafe-inline' for both so the existing client
//   keeps working without a refactor — but limit script-src to 'self' so even an
//   injected payload can't load remote JS).
// - X-Frame-Options DENY: prevent click-jacking from a malicious LAN page.
// - Referrer-Policy: avoid leaking the remote URL to wttr.in or any redirect.
// - Permissions-Policy: deny powerful APIs we don't use.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; " +
    "font-src 'self' data:; " +
    "frame-ancestors 'none'; " +
    "base-uri 'none'; " +
    "form-action 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

function serveClient(res: http.ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS })
  res.end(CLIENT_HTML)
}

/** Check Origin header (if present) matches Host — defense vs. CSRF on /api/auth. */
function originMatchesHost(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true // No Origin header → not a browser cross-origin request
  try {
    const o = new URL(origin)
    return o.host === req.headers.host
  } catch { return false }
}

export async function start(port: number, win: BrowserWindow): Promise<{ pin: string; localIp: string; allIps: string[]; qr: string; firewallOk: boolean }> {
  if (server) await stop()

  mainWin = win
  currentPin = generatePin()
  tokens.clear()

  await detectRemoteShell()
  const firewallOk = await allowFirewall(port)

  const allIps = getLocalIps()
  const localIp = allIps[0]
  const url = `http://${localIp}:${port}`
  const qr = await QRCode.toDataURL(url, { width: 256, margin: 2 })

  // Resolve xterm.js assets from installed node_modules (air-gap friendly)
  let xtermJsPath: string | null = null
  let xtermCssPath: string | null = null
  let fitAddonPath: string | null = null
  try {
    xtermJsPath = require.resolve('@xterm/xterm')                               // → .../lib/xterm.js
    xtermCssPath = path.join(path.dirname(xtermJsPath), '..', 'css', 'xterm.css')
    fitAddonPath = require.resolve('@xterm/addon-fit')                          // → .../lib/addon-fit.js
  } catch { /* unavailable in some build configs; client will fail to load assets */ }

  server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      serveClient(res); return
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('pong'); return
    }

    // Serve xterm.js assets locally so client works without internet
    if (req.method === 'GET' && req.url === '/xterm.js' && xtermJsPath) {
      if (serveStaticFile(res, xtermJsPath, 'application/javascript')) return
    }
    if (req.method === 'GET' && req.url === '/xterm.css' && xtermCssPath) {
      if (serveStaticFile(res, xtermCssPath, 'text/css')) return
    }
    if (req.method === 'GET' && req.url === '/xterm-addon-fit.js' && fitAddonPath) {
      if (serveStaticFile(res, fitAddonPath, 'application/javascript')) return
    }

    if (req.method === 'POST' && req.url === '/api/auth') {
      const ip = (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '')
      // Reject cross-origin POST (defense against drive-by from other LAN sites)
      if (!originMatchesHost(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS })
        res.end(JSON.stringify({ error: 'Cross-origin request rejected' }))
        return
      }
      // Require Content-Type: application/json
      const ct = String(req.headers['content-type'] || '').toLowerCase()
      if (!ct.startsWith('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json', ...SECURITY_HEADERS })
        res.end(JSON.stringify({ error: 'Unsupported content type' }))
        return
      }
      if (isLocked(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS })
        res.end(JSON.stringify({ error: 'Too many failed attempts. Try again in 5 minutes.' }))
        return
      }
      let body = ''
      let aborted = false
      req.setTimeout(5000, () => {
        if (aborted) return
        aborted = true
        try { res.writeHead(408); res.end() } catch { /* ignore */ }
        try { req.destroy() } catch { /* ignore */ }
      })
      req.on('data', d => {
        if (aborted) return
        body += d
        if (body.length > 1024) {
          aborted = true
          try { res.writeHead(413); res.end() } catch { /* ignore */ }
          try { req.destroy() } catch { /* ignore */ }
        }
      })
      req.on('end', () => {
        if (aborted) return
        try {
          const { pin } = JSON.parse(body)
          const pinValid = typeof pin === 'string'
            && pin.length === currentPin.length
            && currentPin.length > 0
            && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(currentPin))
          if (pinValid) {
            recordSuccess(ip)
            const token = generateToken()
            tokens.set(token, Date.now() + TOKEN_TTL_MS)
            res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS })
            res.end(JSON.stringify({ token }))
          } else {
            recordFailure(ip)
            res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS })
            res.end(JSON.stringify({ error: 'Invalid PIN' }))
          }
        } catch {
          recordFailure(ip)
          res.writeHead(400)
          res.end()
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const urlObj = new URL(req.url ?? '/', `http://localhost`)
    const token = urlObj.searchParams.get('token')

    // Validate token exists and hasn't expired
    const expiry = token ? tokens.get(token) : undefined
    if (!expiry || expiry < Date.now()) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    tokens.delete(token!) // single-use: invalidate immediately

    // Strict origin enforcement: require Origin header AND match to Host.
    // Browsers always send Origin on WS upgrade; non-browser clients shouldn't be
    // connecting anyway since the token was issued to a browser session.
    const origin = req.headers.origin
    if (!origin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      const o = new URL(origin)
      const host = req.headers.host ?? ''
      if (o.host !== host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    if (sessions.size >= 3) {
      socket.write('HTTP/1.1 503 Too many clients\r\n\r\n')
      socket.destroy()
      return
    }

    wss!.handleUpgrade(req, socket as net.Socket, head, (ws) => {
      wss!.emit('connection', ws, req)

      const shell = getShell()
      const shellLower = shell.toLowerCase()
      const isPwsh = shellLower.includes('pwsh') || shellLower.includes('powershell')
      const isBash = shellLower.includes('bash')
      const isZsh = shellLower.includes('zsh')
      const isFish = shellLower.includes('fish')

      const scriptPath = deployFtermFetch().replace(/\\/g, '\\\\')
      const ftermDir = path.join(app.getPath('appData'), 'fterm')
      const unixInitPath = path.join(ftermDir, 'fterm_init.sh')
      const fishInitPath = path.join(ftermDir, 'fterm_init.fish')

      const args = isPwsh ? ['-NoLogo', '-NoExit', '-Command',
        [
          'function prompt { return "$(Get-Location)> " }',
          'try { Set-PSReadLineOption -PredictionSource None -ErrorAction SilentlyContinue } catch {}',
          scriptPath ? `function ftermfetch { & '${scriptPath}' }` : '',
        ].filter(Boolean).join('; ')
      ] : isFish ? ['--init-command', `source ${fishInitPath}`]
        : (isBash || isZsh) && existsSync(unixInitPath) ? ['--rcfile', unixInitPath]
        : []

      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.USERPROFILE || process.env.HOME || '/',
        env: process.env as Record<string, string>,
      })

      const session: RemoteSession = {
        ws,
        ptyProcess,
        pingInterval: setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping()
        }, PING_INTERVAL_MS),
        idleTimer: setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.close(1001, 'Idle timeout')
        }, IDLE_TIMEOUT_MS),
        cmdCallTimestamps: [],
      }

      const resetIdleTimer = () => {
        clearTimeout(session.idleTimer)
        session.idleTimer = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.close(1001, 'Idle timeout')
        }, IDLE_TIMEOUT_MS)
      }

      sessions.add(session)
      broadcastClientCount()

      ws.on('pong', resetIdleTimer)

      ptyProcess.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }))
        }
      })

      ws.on('message', (raw) => {
        // Reject oversized messages
        const byteLen = Buffer.isBuffer(raw) ? raw.length
          : raw instanceof ArrayBuffer ? raw.byteLength
          : (raw as Buffer[]).reduce((n, b) => n + b.length, 0)
        if (byteLen > MAX_WS_MESSAGE) {
          ws.close(1009, 'Message too large')
          return
        }
        resetIdleTimer()
        try {
          const str = Array.isArray(raw) ? Buffer.concat(raw as Buffer[]).toString()
            : raw instanceof ArrayBuffer ? Buffer.from(raw).toString()
            : (raw as Buffer).toString()
          const msg = JSON.parse(str)
          if (msg.type === 'data') {
            if (typeof msg.data !== 'string') return
            ptyProcess.write(msg.data)
          } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
            const cols = Math.min(Math.max(Math.round(msg.cols), 10), MAX_COLS)
            const rows = Math.min(Math.max(Math.round(msg.rows), 5), MAX_ROWS)
            ptyProcess.resize(cols, rows)
          } else if (msg.type === 'fs:list') {
            ws.send(JSON.stringify({ type: 'fs:list', requestId: msg.requestId, data: fsListDir(msg.path) }))
          } else if (msg.type === 'fs:read') {
            ws.send(JSON.stringify({ type: 'fs:read', requestId: msg.requestId, data: fsReadText(msg.path) }))
          } else if (msg.type === 'fs:image') {
            ws.send(JSON.stringify({ type: 'fs:image', requestId: msg.requestId, data: fsReadImage(msg.path) }))
          } else if (msg.type === 'fs:home') {
            ws.send(JSON.stringify({ type: 'fs:home', data: { home: os.homedir(), sep: path.sep } }))
          } else if (msg.type === 'fs:drives') {
            if (process.platform === 'win32') {
              execAsync('wmic', ['logicaldisk', 'get', 'DeviceID,VolumeName,Size,FreeSpace', '/format:csv'], 5000).then(r => {
                const drives: Array<{ path: string; label: string; total?: number; free?: number }> = []
                const lines = r.stdout.split(/\r?\n/).filter(l => l.trim() && !/^Node/i.test(l))
                for (const line of lines) {
                  const parts = line.split(',')
                  if (parts.length < 5) continue
                  const dev = parts[1]?.trim()
                  const free = Number(parts[2])
                  const size = Number(parts[3])
                  const label = parts[4]?.trim()
                  if (!dev) continue
                  drives.push({ path: dev + '\\', label: label || dev, total: Number.isFinite(size) ? size : undefined, free: Number.isFinite(free) ? free : undefined })
                }
                ws.send(JSON.stringify({ type: 'fs:drives', data: { drives } }))
              })
            } else {
              const drives = [{ path: '/', label: 'Root' }, { path: os.homedir(), label: 'Home' }]
              try {
                for (const m of readdirSync('/mnt', { withFileTypes: true })) {
                  if (m.isDirectory()) drives.push({ path: '/mnt/' + m.name, label: '/mnt/' + m.name })
                }
              } catch { /* no /mnt */ }
              try {
                for (const m of readdirSync('/media', { withFileTypes: true })) {
                  if (m.isDirectory()) drives.push({ path: '/media/' + m.name, label: '/media/' + m.name })
                }
              } catch { /* no /media */ }
              try {
                for (const m of readdirSync('/Volumes', { withFileTypes: true })) {
                  if (m.isDirectory()) drives.push({ path: '/Volumes/' + m.name, label: m.name })
                }
              } catch { /* no /Volumes */ }
              ws.send(JSON.stringify({ type: 'fs:drives', data: { drives } }))
            }
          } else if (msg.type === 'clipboard:read') {
            ws.send(JSON.stringify({ type: 'clipboard:read', data: { text: clipboard.readText() } }))
          } else if (msg.type === 'clipboard:write' && typeof msg.text === 'string') {
            clipboard.writeText(msg.text)
            ws.send(JSON.stringify({ type: 'clipboard:write', data: { ok: true } }))
          } else if (msg.type === 'ping' && typeof msg.host === 'string') {
            if (!checkRate(session.cmdCallTimestamps, CMD_RATE_LIMIT)) {
              ws.send(JSON.stringify({ type: 'ping', requestId: msg.requestId, data: { error: 'Rate limit exceeded' } })); return
            }
            const safeHost = msg.host.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 253)
            if (!safeHost) { ws.send(JSON.stringify({ type: 'ping', requestId: msg.requestId, data: { error: 'Invalid host' } })); return }
            if (!isPrivateTarget(safeHost)) {
              ws.send(JSON.stringify({ type: 'ping', requestId: msg.requestId, data: { error: 'Only loopback / private LAN targets allowed' } })); return
            }
            const args = process.platform === 'win32' ? ['-n', '4', safeHost] : ['-c', '4', safeHost]
            execAsync('ping', args, 10000).then(r => {
              ws.send(JSON.stringify({ type: 'ping', requestId: msg.requestId, data: { stdout: r.stdout, stderr: r.stderr } }))
            })
          } else if (msg.type === 'portscan' && typeof msg.host === 'string' && Array.isArray(msg.ports)) {
            if (!checkRate(session.cmdCallTimestamps, CMD_RATE_LIMIT)) {
              ws.send(JSON.stringify({ type: 'portscan', requestId: msg.requestId, data: { error: 'Rate limit exceeded', host: '', results: [] } })); return
            }
            const safeHost = msg.host.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 253)
            if (!isPrivateTarget(safeHost)) {
              ws.send(JSON.stringify({ type: 'portscan', requestId: msg.requestId, data: { error: 'Only loopback / private LAN targets allowed', host: safeHost, results: [] } })); return
            }
            const ports: number[] = msg.ports.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0 && n < 65536).slice(0, 200)
            Promise.all(ports.map(async p => ({ port: p, open: await probePort(safeHost, p, 600) }))).then(results => {
              ws.send(JSON.stringify({ type: 'portscan', requestId: msg.requestId, data: { host: safeHost, results } }))
            })
          } else if (msg.type === 'weather') {
            if (!checkRate(session.cmdCallTimestamps, CMD_RATE_LIMIT)) {
              ws.send(JSON.stringify({ type: 'weather', requestId: msg.requestId, data: { error: 'Rate limit exceeded' } })); return
            }
            fetchWeather(typeof msg.query === 'string' ? msg.query : '').then(r => {
              ws.send(JSON.stringify({ type: 'weather', requestId: msg.requestId, data: r }))
            })
          } else if (msg.type === 'docker:ps') {
            if (!checkRate(session.cmdCallTimestamps, CMD_RATE_LIMIT)) {
              ws.send(JSON.stringify({ type: 'docker:ps', requestId: msg.requestId, data: { error: 'Rate limit exceeded' } })); return
            }
            execAsync('docker', ['ps', '-a', '--format', '{{json .}}'], 6000).then(r => {
              ws.send(JSON.stringify({ type: 'docker:ps', requestId: msg.requestId, data: { stdout: r.stdout, error: r.stderr && !r.stdout ? r.stderr : undefined } }))
            })
          } else if (msg.type === 'docker:action' && typeof msg.id === 'string' && typeof msg.action === 'string') {
            if (!checkRate(session.cmdCallTimestamps, CMD_RATE_LIMIT)) {
              ws.send(JSON.stringify({ type: 'docker:action', requestId: msg.requestId, data: { error: 'Rate limit exceeded' } })); return
            }
            const id = msg.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64)
            const action = msg.action
            if (!id || !['start', 'stop', 'restart', 'rm'].includes(action)) {
              ws.send(JSON.stringify({ type: 'docker:action', requestId: msg.requestId, data: { error: 'Invalid' } })); return
            }
            execAsync('docker', [action, id], 10000).then(r => {
              ws.send(JSON.stringify({ type: 'docker:action', requestId: msg.requestId, data: { stdout: r.stdout, stderr: r.stderr } }))
            })
          } else if (msg.type === 'ftermfetch') {
            const total = os.totalmem(), free = os.freemem()
            const cpus = os.cpus()
            ws.send(JSON.stringify({
              type: 'ftermfetch',
              data: {
                user: os.userInfo().username,
                hostname: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                kernel: os.version?.() || os.release(),
                uptime: os.uptime(),
                cpus: cpus.length,
                cpuModel: cpus[0]?.model || '',
                memTotal: total,
                memUsed: total - free,
                shell: process.env.SHELL || process.env.ComSpec || '',
                node: process.version,
                electron: process.versions.electron,
              },
            }))
          } else if (msg.type === 'sysinfo') {
            const mem = process.memoryUsage()
            const total = os.totalmem(), free = os.freemem()
            const cpus = os.cpus()
            ws.send(JSON.stringify({
              type: 'sysinfo:data',
              data: {
                hostname: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                release: os.release(),
                uptime: os.uptime(),
                cpus: cpus.length,
                cpuModel: cpus[0]?.model || '',
                loadavg: os.loadavg(),
                memTotal: total,
                memFree: free,
                memUsedPct: ((total - free) / total) * 100,
                rss: mem.rss,
              },
            }))
          }
        } catch { /* malformed */ }
      })

      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        clearInterval(session.pingInterval)
        clearTimeout(session.idleTimer)
        sessions.delete(session)
        broadcastClientCount()
        try { ptyProcess.kill() } catch { /* already dead */ }
      }

      ws.on('close', cleanup)
      ws.on('error', cleanup)
      // PTY exit: run cleanup (clears timers, removes session) then close WS
      ptyProcess.onExit(() => {
        cleanup()
        if (ws.readyState === WebSocket.OPEN) ws.close()
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server!.listen(port, '0.0.0.0', () => resolve())
    server!.on('error', reject)
  })

  return { pin: currentPin, localIp, allIps, qr, firewallOk }
}

export async function stop(): Promise<void> {
  for (const s of sessions) {
    clearInterval(s.pingInterval)
    clearTimeout(s.idleTimer)
    try { s.ws.close() } catch { /* ignore */ }
    try { s.ptyProcess.kill() } catch { /* ignore */ }
  }
  sessions.clear()
  broadcastClientCount()

  await new Promise<void>((resolve) => {
    wss?.close()
    wss = null
    server?.close(() => resolve())
    server = null
  })
  tokens.clear()
  failedAttempts.clear()
  currentPin = ''
  mainWin = null
}

export function getStatus(): { clients: number; localIp: string; allIps: string[] } {
  return { clients: sessions.size, localIp: getLocalIp(), allIps: getLocalIps() }
}
