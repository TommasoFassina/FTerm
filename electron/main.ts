import { app, BrowserWindow, ipcMain, shell, protocol, dialog, screen, session, clipboard } from 'electron'

// Register fterm:// as privileged BEFORE app.ready — required for audio/video MediaElementSource,
// CORS-permitted fetch, and range requests. Must run at module load time.
protocol.registerSchemesAsPrivileged([
  { scheme: 'fterm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
])
import { join } from 'path'
import { homedir, tmpdir, cpus as osCpus, freemem, totalmem, platform, release, hostname, userInfo, arch, uptime } from 'os'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync, createReadStream } from 'fs'
import { readFile } from 'fs/promises'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'

import { initBrowserSession, getAdblockStats, setAdblockEnabled, downloadUrl, cancelDownload, clearBrowsingData, setAskWhereToSave, getAskWhereToSave, isAllowedDownloadPath, getUbolInfo, checkUbolUpdateNow, setUbolAutoUpdate, BROWSER_PARTITION, BROWSER_SESSION_PARTITION, type ClearDataOptions } from './services/browserSession'

// GPU: this machine's GPU driver crashes Chromium's command buffer during video playback
// on both real-GPU ANGLE backends — D3D11 ("command_buffer_proxy_impl ... GPU state
// invalid after WaitForGetOffsetInRange") and native GL ("eglPostSubBufferNV failed").
// So hardware acceleration is disabled (software raster/decode). Re-test whether HW can
// be re-enabled once the GPU driver is updated. (Note: the "GetGpuDriverOverlayInfo:
// Failed to retrieve video device" stderr line is harmless — Chromium probing a video
// device that doesn't exist with the GPU off.)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

// Silence Node deprecation warnings (DEP0040 punycode, DEP0169 url.parse) — they
// originate in transitive dependencies, not our code, and just clutter the console.
process.noDeprecation = true

// Never let a broken stdout/stderr pipe (e.g. parent terminal closed) crash the app.
process.stdout.on('error', (err: any) => { if (err?.code === 'EPIPE') return })
process.stderr.on('error', (err: any) => { if (err?.code === 'EPIPE') return })

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

// ─── Network stats tracker ────────────────────────────────────────────────────
let _prevNetBytes: { rx: number; tx: number; ts: number } | null = null

// Cache static system info — these never change at runtime
const _staticMetrics = {
  platform: platform(),
  release: release(),
  hostname: hostname(),
  username: userInfo().username,
  arch: arch(),
  tmpdir: tmpdir(),
}

// Cache network delta; spawning PowerShell on every 2s poll is expensive
let _netCache: { result: { rxKbps: number; txKbps: number; rxTotal: number; txTotal: number }; ts: number } | null = null

async function getNetworkDelta(): Promise<{ rxKbps: number; txKbps: number; rxTotal: number; txTotal: number }> {
  // Rate-limit to once per 4s — spawning PowerShell every 2s is too expensive
  if (_netCache && Date.now() - _netCache.ts < 4000) return _netCache.result
  try {
    let rx = 0, tx = 0
    const plat = _staticMetrics.platform
    if (plat === 'win32') {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "$s=Get-WmiObject Win32_PerfRawData_Tcpip_NetworkInterface; $rx=($s|Measure-Object BytesReceivedPersec -Sum).Sum; $tx=($s|Measure-Object BytesSentPersec -Sum).Sum; \\"$rx $tx\\""`,
        { timeout: 3000 }
      )
      const parts = stdout.trim().split(/\s+/)
      rx = parseInt(parts[0], 10) || 0
      tx = parseInt(parts[1], 10) || 0
    } else if (plat === 'linux') {
      const content = await readFile('/proc/net/dev', 'utf8')
      for (const line of content.split('\n').slice(2)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 10 || parts[0] === 'lo:') continue
        rx += parseInt(parts[1], 10) || 0
        tx += parseInt(parts[9], 10) || 0
      }
    } else {
      // macOS
      const { stdout } = await execAsync('netstat -ib', { timeout: 2000 })
      const seen = new Set<string>()
      for (const line of stdout.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 10 || parts[0].startsWith('lo')) continue
        if (seen.has(parts[0])) continue
        seen.add(parts[0])
        rx += parseInt(parts[6], 10) || 0
        tx += parseInt(parts[9], 10) || 0
      }
    }
    const now = Date.now()
    let rxKbps = 0, txKbps = 0
    if (_prevNetBytes) {
      const dt = (now - _prevNetBytes.ts) / 1000
      if (dt > 0) {
        rxKbps = Math.max(0, (rx - _prevNetBytes.rx) / dt / 1024)
        txKbps = Math.max(0, (tx - _prevNetBytes.tx) / dt / 1024)
      }
    }
    _prevNetBytes = { rx, tx, ts: now }
    const result = { rxKbps: Math.round(rxKbps * 10) / 10, txKbps: Math.round(txKbps * 10) / 10, rxTotal: rx, txTotal: tx }
    _netCache = { result, ts: Date.now() }
    return result
  } catch {
    return { rxKbps: 0, txKbps: 0, rxTotal: 0, txTotal: 0 }
  }
}
import * as pty from './services/ptyManager'
import * as remoteTerminal from './services/remoteTerminalServer'
import { registerAIHandlers } from './services/aiService'
import { setKey, deleteKey, hasKey, listConnected } from './services/secureStore'
import { startDeviceFlow, pollForToken, startRedirectFlow, clearCopilotToken } from './services/githubOAuth'
import { startPKCEFlow } from './services/pkceOAuth'
import { gitService } from './services/gitService'
import { composeVideo } from './video/VideoComposer'
import { isWithinRoots, isValidContainerId, GITHUB_TOKEN_RE } from './security/validators'
import * as quake from './services/quakeMode'
const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null

// ─── Multi-window registry (tab tear-out) ───────────────────────────────────
const windows = new Set<BrowserWindow>()
// Pending tab hand-offs: token → payload, consumed by the freshly spawned window.
const pendingAdopt = new Map<string, { tab: any; seqOffset: number; snapshot?: any }>()
let winSeq = 0
/** The BrowserWindow that sent an IPC message (multi-window aware), or the primary. */
function senderWin(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender) ?? mainWindow
}

const windowStatePath = join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): { width: number; height: number; x?: number; y?: number } {
  try {
    if (existsSync(windowStatePath)) {
      const s = JSON.parse(readFileSync(windowStatePath, 'utf-8'))
      if (s.width >= 640 && s.height >= 480) return s
    }
  } catch { /* ignore */ }
  return { width: 1280, height: 800 }
}

let saveWinTimer: ReturnType<typeof setTimeout> | null = null
function persistWindowStateNow(): void {
  if (!mainWindow) return
  try {
    const b = mainWindow.getBounds()
    writeFileSync(windowStatePath, JSON.stringify(b), 'utf-8')
  } catch { /* ignore */ }
}
function saveWindowState(): void {
  if (saveWinTimer) clearTimeout(saveWinTimer)
  saveWinTimer = setTimeout(persistWindowStateNow, 250)
}

function createWindow(opts?: { adoptToken?: string; bounds?: { x: number; y: number }; size?: { width: number; height: number } }): BrowserWindow {
  const isPrimary = !mainWindow
  const winState = loadWindowState()
  const win = new BrowserWindow({
    width: opts?.size?.width ?? (opts ? 1100 : winState.width),
    height: opts?.size?.height ?? (opts ? 720 : winState.height),
    x: opts?.bounds?.x ?? (opts ? undefined : winState.x),
    y: opts?.bounds?.y ?? (opts ? undefined : winState.y),
    minWidth: 640,
    minHeight: 480,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,            // node-pty runs in main process, preload only uses contextBridge + ipcRenderer
      webviewTag: true,         // in-app browser (BrowserView component) — guests hardened in web-contents-created
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: process.env.NODE_ENV === 'development',
    },
  })

  windows.add(win)
  if (isPrimary) mainWindow = win

  // Force hardened webview defaults on the in-app browser, regardless of DOM attributes.
  win.webContents.on('will-attach-webview', (_evt, webPreferences, params) => {
    delete (webPreferences as any).preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    ;(webPreferences as any).sandbox = true
    // Keep plugins ON: in modern Chromium this only enables the built-in PDF viewer
    // (Flash/NPAPI are gone), and it makes navigator.plugins a real native PluginArray
    // matching stock Chrome — an empty list is a bot signal Cloudflare Turnstile flags.
    ;(webPreferences as any).plugins = true
    ;(webPreferences as any).webSecurity = true
    ;(webPreferences as any).autoplayPolicy = 'no-user-gesture-required'  // let YouTube etc. play audio/video
    ;(webPreferences as any).backgroundThrottling = false
    // Only our two hardened partitions are permitted. Honor the ephemeral
    // (session-only) partition when "remember me" is off; force the persistent
    // one for anything else.
    params.partition = params.partition === BROWSER_SESSION_PARTITION
      ? BROWSER_SESSION_PARTITION
      : BROWSER_PARTITION
  })

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
      _e.preventDefault()
      win.webContents.send('shortcut:history-search')
    }
  })

  // Block navigation away from app origin — prevents redirect-based exfiltration if renderer is XSS'd
  win.webContents.on('will-navigate', (e, url) => {
    try {
      const parsed = new URL(url)
      const devOk = isDev && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      const fileOk = parsed.protocol === 'file:'
      if (!devOk && !fileOk) e.preventDefault()
    } catch { e.preventDefault() }
  })

  // Open all window.open() / target=_blank externally via shell — never spawn another BrowserWindow
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(url)
    } catch { /* ignore */ }
    return { action: 'deny' }
  })

  const query = opts?.adoptToken ? `?adopt=${opts.adoptToken}` : ''
  if (isDev) {
    win.loadURL((process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173') + query)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'), { search: query.slice(1) })
  }

  win.on('close', () => {
    if (isPrimary) {
      if (saveWinTimer) { clearTimeout(saveWinTimer); saveWinTimer = null }
      persistWindowStateNow()
    }
  })
  win.on('closed', () => {
    windows.delete(win)
    if (win === mainWindow) mainWindow = windows.values().next().value ?? null
  })
  if (isPrimary) {
    win.on('resize', saveWindowState)
    win.on('moved', saveWindowState)
  }

  // Broadcast window state changes to this window's renderer so its titlebar stays in sync
  const sendState = () => {
    if (win.isDestroyed()) return
    win.webContents.send('window:state', {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    })
  }
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
  win.on('enter-full-screen', sendState)
  win.on('leave-full-screen', sendState)

  // Only the primary window runs the shake easter-egg (keeps it simple).
  if (!isPrimary) return win

  // Easter egg: detect window shake / stillness and notify renderer (pet reacts)
  let lastPos: { x: number; y: number; ts: number } | null = null
  let lastDir: { dx: number; dy: number } | null = null
  let reversals: number[] = []
  let shakeActive = false
  let stillTimer: ReturnType<typeof setTimeout> | null = null
  const armStill = () => {
    if (stillTimer) clearTimeout(stillTimer)
    stillTimer = setTimeout(() => {
      if (shakeActive) {
        shakeActive = false
        win.webContents.send('pet:still')
      }
    }, 500)
  }
  win.on('move', () => {
    if (win.isDestroyed()) return
    const [x, y] = win.getPosition()
    const now = Date.now()
    if (lastPos) {
      const dx = x - lastPos.x
      const dy = y - lastPos.y
      const dist = Math.hypot(dx, dy)
      if (dist >= 8 && lastDir) {
        const dot = dx * lastDir.dx + dy * lastDir.dy
        if (dot < 0) {
          reversals.push(now)
          reversals = reversals.filter(t => now - t < 800)
          if (reversals.length >= 4) {
            reversals = []
            shakeActive = true
            win.webContents.send('pet:shake')
          }
        }
      }
      if (dist >= 4) lastDir = { dx, dy }
    }
    lastPos = { x, y, ts: now }
    if (shakeActive) armStill()
  })

  return win
}

// ─── Tab tear-out / merge IPC (multi-window) ─────────────────────────────────
function pointInBounds(b: Electron.Rectangle, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
}

ipcMain.handle('tab:drop', (e, tab: any, snapshot: any, x: number, y: number, w: number, h: number) => {
  const source = senderWin(e)
  // Dropped over another FTerm window → merge the tab into it.
  const target = [...windows].find(win =>
    win !== source && !win.isDestroyed() && pointInBounds(win.getBounds(), x, y))
  if (target) {
    target.webContents.send('tab:adopt-into', tab)
    if (target.isMinimized()) target.restore()
    target.focus()
    return { merged: true }
  }
  // Otherwise spawn a new window that adopts the tab (same size as origin).
  const token = `${Date.now().toString(36)}-${(++winSeq).toString(36)}`
  // 100k id band per window so future tab ids never collide across windows.
  pendingAdopt.set(token, { tab, seqOffset: winSeq * 100000, snapshot })
  createWindow({
    adoptToken: token,
    bounds: { x: Math.round(x - 80), y: Math.round(y - 16) },
    size: w > 200 && h > 200 ? { width: Math.round(w), height: Math.round(h) } : undefined,
  })
  return { merged: false }
})
ipcMain.handle('tab:consume-adopt', (_e, token: string) => {
  const payload = pendingAdopt.get(token)
  if (payload) pendingAdopt.delete(token)
  return payload ?? null
})

// ─── PTY IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (e, tabId: string, cols: number, rows: number, shell?: string, args?: string[], cwd?: string, env?: Record<string, string>) => {
  return pty.createSession(tabId, cols, rows, senderWin(e), shell, args, cwd, env)
})

ipcMain.on('pty:write', (e, tabId: string, data: string) => pty.writeToSession(tabId, data, senderWin(e)))
ipcMain.on('pty:resize', (e, tabId: string, c: number, r: number) => pty.resizeSession(tabId, c, r, senderWin(e)))
ipcMain.on('pty:kill', (_e, tabId: string) => pty.killSession(tabId))

// ─── Secure key storage IPC ───────────────────────────────────────────────────

ipcMain.handle('keys:set', (_e, provider: string, key: string) => setKey(provider, key))
// keys:get is intentionally NOT exposed to renderer via preload — only used internally by main process
ipcMain.handle('keys:delete', (_e, provider: string) => {
  if (provider === 'copilot') clearCopilotToken()
  return deleteKey(provider)
})
ipcMain.handle('keys:has', (_e, provider: string) => hasKey(provider))
ipcMain.handle('keys:listConnected', () => listConnected())

// ─── GitHub OAuth device flow IPC ────────────────────────────────────────────

function assertTokenFormat(token: string, re: RegExp, label: string): void {
  if (typeof token !== 'string' || !re.test(token)) throw new Error(`Invalid ${label} token format`)
}

ipcMain.handle('oauth:github:start', async (_e, clientId: string) => {
  return startDeviceFlow(clientId)
})

ipcMain.handle('oauth:github:poll', async (_e, clientId: string, deviceCode: string, interval: number, expiresIn: number) => {
  const token = await pollForToken(clientId, deviceCode, interval, expiresIn)
  assertTokenFormat(token, GITHUB_TOKEN_RE, 'GitHub')
  setKey('copilot', token)
  return token
})

ipcMain.handle('oauth:github:redirect', async (_e, clientId: string) => {
  const token = await startRedirectFlow(clientId, () => {
    mainWindow?.webContents.send('oauth:github:status', 'opened')
  })
  assertTokenFormat(token, GITHUB_TOKEN_RE, 'GitHub')
  setKey('copilot', token)
  mainWindow?.webContents.send('oauth:github:status', 'success')
})

// ─── Window controls IPC ──────────────────────────────────────────────────────

ipcMain.on('window:minimize', (e) => senderWin(e)?.minimize())
// Per-window saved restore-bounds (custom Windows maximize) keyed by window id.
const preMaxBounds = new Map<number, Electron.Rectangle>()

function toggleMaximizeWin(w: BrowserWindow | null) {
  if (!w) return
  const saved = preMaxBounds.get(w.id) ?? null
  const isMax = w.isMaximized() || (process.platform === 'win32' && saved !== null)
  const isFS = w.isFullScreen()
  if (isMax || isFS) {
    if (isFS) {
      w.setFullScreen(false)
    } else if (process.platform === 'win32' && saved) {
      w.setBounds(saved)
      preMaxBounds.delete(w.id)
      w.webContents.send('window:state', { maximized: false, fullScreen: false })
    } else {
      w.unmaximize()
    }
  } else {
    if (process.platform === 'win32') {
      preMaxBounds.set(w.id, w.getBounds())
      const workArea = screen.getDisplayMatching(w.getBounds()).workArea
      w.setBounds(workArea)
      w.webContents.send('window:state', { maximized: true, fullScreen: false })
    } else {
      w.maximize()
    }
  }
}

ipcMain.on('window:maximize', (e) => toggleMaximizeWin(senderWin(e)))

type DragState = { cursor: { x: number; y: number }; x: number; y: number; width: number; height: number }
const dragStates = new Map<number, DragState>()
ipcMain.on('window:drag-start', (e) => {
  const w = senderWin(e); if (!w) return
  const b = w.getBounds()
  dragStates.set(w.id, { cursor: screen.getCursorScreenPoint(), x: b.x, y: b.y, width: b.width, height: b.height })
})
ipcMain.on('window:drag-update', (e) => {
  const w = senderWin(e); if (!w) return
  const ds = dragStates.get(w.id); if (!ds) return
  const cur = screen.getCursorScreenPoint()
  const dx = cur.x - ds.cursor.x
  const dy = cur.y - ds.cursor.y
  ds.cursor = cur
  ds.x += dx
  ds.y += dy
  w.setBounds({ x: Math.round(ds.x), y: Math.round(ds.y), width: ds.width, height: ds.height })
})
ipcMain.on('window:drag-end', (e) => { const w = senderWin(e); if (w) dragStates.delete(w.id) })
ipcMain.on('window:close', (e) => senderWin(e)?.close())
ipcMain.on('window:set-position', (e, x: number, y: number) => senderWin(e)?.setPosition(x, y))
ipcMain.on('window:set-opacity', (e, v: number) => senderWin(e)?.setOpacity(Math.min(1, Math.max(0.1, v))))
ipcMain.handle('window:get-position', (e) => senderWin(e)?.getPosition() ?? [0, 0])
ipcMain.on('window:open-external', (_e, url: string) => {
  // Only allow http(s) URLs to prevent opening arbitrary protocols (file://, smb://, etc.)
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url)
    }
  } catch { /* invalid URL — ignore */ }
})

// Extensions that EXECUTE code when opened — never hand these to the OS opener.
// Blocks an XSS'd renderer from launching programs via shell.openPath.
const EXECUTABLE_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp', '.cpl', '.hta',
  '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.sct',
  '.scf', '.lnk', '.inf', '.reg', '.jar', '.gadget', '.application', '.msc', '.dll',
  '.sh', '.command', '.app', '.osx', '.run', '.bin', '.appimage',
  // Windows LOLBins that execute / phone-home when opened
  '.url', '.settingcontent-ms', '.appref-ms', '.library-ms', '.diagcab', '.chm',
  '.ws', '.vb', '.msh', '.msh1', '.msh2', '.mshxml', '.msh1xml', '.msh2xml', '.cdxml',
  // Interpreted scripts that run via file association
  '.py', '.pyw', '.pyc', '.rb', '.pl', '.php', '.lua', '.ahk', '.tcl', '.r',
])
// Shared guard for every shell.openPath sink: refuse UNC paths (SMB auth leak /
// remote code exec from attacker-controlled shares) and executable/script
// extensions. Stops an XSS'd renderer from launching programs.
function isSafeToOpen(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || filePath.length === 0) return false
  if (filePath.startsWith('\\\\') || filePath.startsWith('//')) return false
  const ext = require('path').extname(filePath).toLowerCase()
  if (EXECUTABLE_EXTS.has(ext)) return false
  return true
}
ipcMain.on('shell:open-path', (_e, filePath: string) => {
  if (isSafeToOpen(filePath)) shell.openPath(filePath)
})

ipcMain.handle('window:is-maximized', (e) => senderWin(e)?.isMaximized() ?? false)

// ─── Quake / drop-down mode IPC ──────────────────────────────────────────────

ipcMain.handle('quake:configure', (_e, cfg: unknown) => quake.configureQuake(cfg))
ipcMain.handle('quake:status', () => quake.getQuakeStatus())
ipcMain.on('quake:toggle', () => quake.toggleQuake())
ipcMain.on('quake:hide', () => quake.hideQuake())
ipcMain.on('quake:exit', () => quake.exitQuake())

// ─── System Metrics IPC ───────────────────────────────────────────────────────

ipcMain.handle('system:metrics', async () => {
  const net = await getNetworkDelta()
  return {
    cpus: osCpus(),
    freeMem: freemem(),
    totalMem: totalmem(),
    uptime: uptime(),
    shell: process.env.SHELL || process.env.ComSpec || '',
    network: net,
    ..._staticMetrics,
  }
})

// ─── Ping IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('system:ping', async (_e, host: string, count: number = 10) => {
  // Validate host to prevent command injection — allow hostnames, IPs, no shell metacharacters
  if (!/^[a-zA-Z0-9.\-:[\]]+$/.test(host) || host.length > 253) throw new Error('Invalid host')
  count = Math.max(1, Math.min(count, 100)) // cap count
  const plat = platform()

  function parseRtts(stdout: string): number[] {
    const rtts: number[] = []
    if (plat === 'win32') {
      // Match only per-packet reply lines (contain TTL=), extract the duration field (any locale)
      // English: "time=14ms TTL=118"  Italian: "durata=5ms TTL=120"  German: "Zeit=14ms TTL=..."
      for (const line of stdout.split(/\r?\n/)) {
        if (!/TTL=/i.test(line)) continue
        const m = line.match(/\w+\s*([=<])\s*(\d+)\s*ms/i)
        if (m) rtts.push(m[1] === '<' ? 0 : parseInt(m[2], 10))
      }
    } else {
      for (const m of stdout.matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)) rtts.push(parseFloat(m[1]))
    }
    return rtts
  }

  function summarise(rtts: number[], lost: number) {
    const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0
    return {
      host, rtts, lost,
      avg: Math.round(avg * 10) / 10,
      min: rtts.length ? Math.min(...rtts) : 0,
      max: rtts.length ? Math.max(...rtts) : 0,
      count,
    }
  }

  try {
    // Use execFile with full binary path to avoid PATH/shell issues in dev mode
    const pingBin = plat === 'win32' ? 'C:\\Windows\\System32\\ping.exe' : 'ping'
    const pingArgs = plat === 'win32'
      ? ['-n', String(count), host]
      : ['-c', String(count), host]

    const stdout = await new Promise<string>((resolve, reject) => {
      let out = ''
      const MAX_OUT = 256 * 1024
      const child = require('child_process').spawn(pingBin, pingArgs)
      const killTimer = setTimeout(() => { try { child.kill() } catch { } }, 32000)
      const onChunk = (d: Buffer) => {
        if (out.length >= MAX_OUT) return
        out += d.toString()
        if (out.length >= MAX_OUT) {
          out = out.slice(0, MAX_OUT)
          try { child.kill() } catch { /* ignore */ }
        }
      }
      child.stdout.on('data', onChunk)
      child.stderr.on('data', onChunk)
      child.on('close', () => { clearTimeout(killTimer); resolve(out) })
      child.on('error', (err: Error) => { clearTimeout(killTimer); reject(err) })
    })

    const rtts = parseRtts(stdout)
    return summarise(rtts, count - rtts.length)
  } catch (err: any) {
    console.error('[ping] error:', err)
    return summarise([], count)
  }
})

// ─── Filesystem readdir ───────────────────────────────────────────────────────

const FS_READDIR_ROOTS: string[] = [
  homedir(),
  tmpdir(),
  process.cwd(),
  ...(process.platform === 'win32'
    // All possible Windows drive letters — covers external/mapped drives (T:, etc.)
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `${l}:\\`)
    : ['/']),
].map(p => require('path').resolve(p))

function isPathAllowed(inputPath: string): boolean {
  // Resolves + collapses `..` before comparing against the allowlist.
  return isWithinRoots(inputPath, FS_READDIR_ROOTS)
}

ipcMain.handle('fs:readdir', (_e, dirPath: string) => {
  const path = require('path')
  if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) {
    return { entries: [], error: 'Invalid path' }
  }
  const resolved = path.resolve(dirPath)
  if (!isPathAllowed(resolved)) {
    return { entries: [], error: 'Path not allowed' }
  }
  let raw: import('fs').Dirent[]
  try {
    raw = readdirSync(resolved, { withFileTypes: true }) as import('fs').Dirent[]
  } catch (err: any) {
    const code = err?.code as string | undefined
    const msg =
      code === 'EPERM' || code === 'EACCES' ? 'Access denied'
      : code === 'ENOENT' ? 'Folder not found'
      : code === 'EBUSY' ? 'Folder is busy'
      : code === 'ENOTDIR' ? 'Not a folder'
      : (err?.message ?? 'Failed to read folder')
    return { entries: [], error: msg }
  }
  const entries = raw.map(e => {
    const entryPath = join(resolved, e.name)
    let size = 0
    let isDir = e.isDirectory()
    if (e.isSymbolicLink()) {
      try {
        const real = realpathSync(entryPath)
        if (!isPathAllowed(real)) return null
        const st = statSync(real)
        isDir = st.isDirectory()
        size = isDir ? 0 : st.size
      } catch { return null }
    } else if (!isDir) {
      try { size = statSync(entryPath).size } catch { /* ignore */ }
    }
    return { name: e.name, isDir, size }
  }).filter(Boolean)
  return { entries }
})

// ─── Filesystem drives ────────────────────────────────────────────────────────

ipcMain.handle('fs:drives', async () => {
  if (platform() === 'win32') {
    try {
      const { stdout } = await execAsync('wmic logicaldisk get DeviceID,VolumeName,Size,FreeSpace /format:csv')
      const lines = stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'))
      return lines.map(line => {
        const parts = line.split(',')
        const deviceId = parts[1]?.trim()
        const freeSpace = parseInt(parts[2]?.trim() ?? '0', 10)
        const size = parseInt(parts[3]?.trim() ?? '0', 10)
        const volumeName = parts[4]?.trim() ?? ''
        if (!deviceId) return null
        return { path: deviceId + '\\', label: volumeName || deviceId, size, freeSpace }
      }).filter(Boolean)
    } catch {
      return [{ path: 'C:\\', label: 'C:', size: 0, freeSpace: 0 }]
    }
  } else {
    return [{ path: '/', label: 'Root', size: 0, freeSpace: 0 }]
  }
})

// ─── Docker IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('docker:ps', async () => {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}'])
    return stdout.trim().split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)] } catch { return [] }
    })
  } catch {
    return null
  }
})

ipcMain.handle('docker:logs', async (_e, containerId: string) => {
  // Validate container ID format (hex or name: alphanumeric, dash, underscore, dot); max 64 chars
  if (!isValidContainerId(containerId)) throw new Error('Invalid container ID')
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['logs', '--tail', '50', containerId])
    return (stdout || '') + (stderr || '')
  } catch (e: any) {
    return e.message
  }
})

ipcMain.handle('docker:action', async (_e, id: string, action: 'start' | 'stop') => {
  if (!isValidContainerId(id)) throw new Error('Invalid container ID')
  if (action !== 'start' && action !== 'stop') throw new Error('Invalid action')
  try {
    await execFileAsync('docker', [action, id])
  } catch (e: any) {
    throw new Error(e.message)
  }
})

// ─── Port scanner ─────────────────────────────────────────────────────────────

ipcMain.handle('system:portscan', async (_e, host: string, ports: number[]) => {
  if (!/^[a-zA-Z0-9.\-:[\]]+$/.test(host) || host.length > 253) throw new Error('Invalid host')
  if (!Array.isArray(ports) || ports.length > 256) throw new Error('Invalid ports (max 256)')
  if (!ports.every(p => Number.isInteger(p) && p >= 1 && p <= 65535)) throw new Error('Invalid port number')
  const net = require('net')
  const TIMEOUT = 800
  const CONCURRENCY = 32
  const results: Array<{ port: number; open: boolean }> = []
  const scanOne = (port: number) => new Promise<{ port: number; open: boolean }>(resolve => {
    const sock = new net.Socket()
    let done = false
    const finish = (open: boolean) => {
      if (done) return
      done = true
      sock.destroy()
      resolve({ port, open })
    }
    sock.setTimeout(TIMEOUT)
    sock.connect(port, host, () => finish(true))
    sock.on('error', () => finish(false))
    sock.on('timeout', () => finish(false))
  })
  for (let i = 0; i < ports.length; i += CONCURRENCY) {
    const batch = ports.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(scanOne))
    results.push(...batchResults)
  }
  return results
})

// ─── System processes ─────────────────────────────────────────────────────────

ipcMain.handle('system:processes', async () => {
  const isWin = platform() === 'win32'
  if (isWin) {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Compress"',
      { timeout: 4000 }
    )
    const raw = JSON.parse(stdout.trim())
    const procs: Array<{ Id: number; ProcessName: string; CPU: number | null; WorkingSet: number }> = Array.isArray(raw) ? raw : [raw]
    return procs.map(p => {
      const mem = p.WorkingSet ? `${Math.round(p.WorkingSet / 1024)} K` : '—'
      const cpu = p.CPU != null ? `${p.CPU.toFixed(1)}s` : '—'
      return [String(p.Id), p.ProcessName, cpu, mem, 'R', '—']
    })
  } else {
    const { stdout } = await execFileAsync('ps', ['aux'])
    const lines = stdout.trim().split('\n').slice(1) // skip header
    return lines.map(line => {
      const parts = line.trim().split(/\s+/)
      // USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      return [parts[1], parts.slice(10).join(' '), parts[2], parts[3], parts[7], parts[0]]
    })
  }
})

// ─── Provider OAuth (PKCE) ────────────────────────────────────────────────────

ipcMain.handle('oauth:openai:start', async (_e, clientId: string) => {
  const token = await startPKCEFlow({
    authUrl: 'https://platform.openai.com/oauth/authorize',
    tokenUrl: 'https://platform.openai.com/oauth/token',
    clientId,
    scopes: ['openai'],
  })
  setKey('openai', token)
  mainWindow?.webContents.send('oauth:openai:status', 'success')
})

ipcMain.handle('oauth:gemini:start', async (_e, clientId: string) => {
  const token = await startPKCEFlow({
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId,
    scopes: ['https://www.googleapis.com/auth/generative-language'],
  })
  setKey('gemini', token)
  mainWindow?.webContents.send('oauth:gemini:status', 'success')
})

// ─── Claude Code credential import ───────────────────────────────────────────

ipcMain.handle('claude:import-credentials', async () => {
  const credPath = join(homedir(), '.claude', '.credentials.json')
  let raw: string
  try {
    raw = readFileSync(credPath, 'utf8')
  } catch {
    throw new Error(`Claude Code CLI credentials not found at ${credPath}. Run 'claude' first to log in.`)
  }
  let creds: { claudeAiOauth?: { accessToken?: string } }
  try {
    creds = JSON.parse(raw)
  } catch {
    throw new Error('Credentials file is corrupted (invalid JSON).')
  }
  const token = creds?.claudeAiOauth?.accessToken
  if (!token) throw new Error('No access token in ~/.claude/.credentials.json. Re-login via the Claude Code CLI.')
  setKey('claude', token)
  return true
})

// ─── Git System IPC ───────────────────────────────────────────────────────────

function assertRepoPath(p: string): string {
  if (typeof p !== 'string' || p.length === 0) throw new Error('Invalid repo path')
  const path = require('path')
  const resolved = path.resolve(p)
  if (!path.isAbsolute(resolved) || !isPathAllowed(resolved)) throw new Error('Path not allowed')
  return resolved
}

ipcMain.handle('git:repository', (_e, cwd: string) => {
  const safe = assertRepoPath(cwd)
  return gitService.detectRepository(safe)
})
ipcMain.handle('git:status', (_e, repoPath: string) => {
  const safe = assertRepoPath(repoPath)
  return gitService.getStatus(safe)
})
ipcMain.handle('git:branches', (_e, repoPath: string) => gitService.getBranches(assertRepoPath(repoPath)))
ipcMain.handle('git:log', (_e, repoPath: string, limit: number) => gitService.getCommits(assertRepoPath(repoPath), limit))
ipcMain.handle('git:checkout', (_e, repoPath: string, branch: string) => gitService.checkoutBranch(assertRepoPath(repoPath), branch))
ipcMain.handle('git:commit', (_e, repoPath: string, message: string) => gitService.createCommit(assertRepoPath(repoPath), message))
ipcMain.handle('git:push', (_e, repoPath: string, remote: string, branch: string) => gitService.push(assertRepoPath(repoPath), remote, branch))
ipcMain.handle('git:pull', (_e, repoPath: string, remote: string, branch: string) => gitService.pull(assertRepoPath(repoPath), remote, branch))
ipcMain.handle('git:remotes', (_e, repoPath: string) => gitService.getRemotes(assertRepoPath(repoPath)))
ipcMain.handle('git:stats', (_e, repoPath: string) => gitService.getRepoStats(assertRepoPath(repoPath)))
ipcMain.handle('git:diff', (_e, repoPath: string, args?: string[]) => gitService.getDiff(assertRepoPath(repoPath), args))
ipcMain.handle('git:stage', (_e, repoPath: string, filePath: string) => gitService.stageFile(assertRepoPath(repoPath), filePath))
ipcMain.handle('git:unstage', (_e, repoPath: string, filePath: string) => gitService.unstageFile(assertRepoPath(repoPath), filePath))
ipcMain.handle('git:stash:list', (_e, repoPath: string) => gitService.stashList(assertRepoPath(repoPath)))
ipcMain.handle('git:stash:push', (_e, repoPath: string, message?: string) => gitService.stashPush(assertRepoPath(repoPath), message))
ipcMain.handle('git:stash:pop', (_e, repoPath: string, index: number) => gitService.stashPop(assertRepoPath(repoPath), index))
ipcMain.handle('git:stash:apply', (_e, repoPath: string, index: number) => gitService.stashApply(assertRepoPath(repoPath), index))
ipcMain.handle('git:stash:drop', (_e, repoPath: string, index: number) => gitService.stashDrop(assertRepoPath(repoPath), index))
ipcMain.handle('git:discard', (_e, repoPath: string, filePath: string) => gitService.discardFile(assertRepoPath(repoPath), filePath))

// ─── File system IPC ─────────────────────────────────────────────────────────

ipcMain.handle('fs:openDialog', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Code', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'php', 'go', 'rs', 'java', 'cpp', 'c', 'cs', 'sh', 'bash', 'ps1', 'sql', 'html', 'css', 'json', 'yaml', 'yml', 'xml', 'md', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:openDirDialog', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:saveDialog', async (_e, defaultName?: string) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('fs:readFile', (_e, filePath: string) => {
  const path = require('path')
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid path')
  const resolved = path.resolve(filePath)
  if (!isPathAllowed(resolved)) throw new Error('Path not allowed')
  if (!existsSync(resolved)) return null
  return readFileSync(resolved, 'utf8')
})

ipcMain.handle('fs:readImage', (_e, filePath: string) => {
  const path = require('path')
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid path')
  const resolved = path.resolve(filePath)
  if (!isPathAllowed(resolved)) throw new Error('Path not allowed')
  const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
  const mime: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  }
  if (!mime[ext]) return null
  if (!existsSync(resolved)) return null
  const stat = statSync(resolved)
  if (stat.size > 10 * 1024 * 1024) return null
  const data = readFileSync(resolved)
  return { mime: mime[ext], base64: data.toString('base64'), size: data.length }
})

ipcMain.handle('fs:writeFile', (_e, filePath: string, content: string) => {
  const path = require('path')
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid path')
  const resolved = path.resolve(filePath)
  if (!isPathAllowed(resolved)) throw new Error('Path not allowed')
  writeFileSync(resolved, content, 'utf8')
  return true
})

// ─── Claude Code Hook Installer ───────────────────────────────────────────────

const CLAUDE_HOOK_FILENAME = 'fterm-stats.ps1'
const FTERM_STATS_FILENAME = 'fterm-claude-stats.json'

const FTERM_HOOK_PS1 = `# FTerm Claude Code Integration — auto-generated, do not edit manually
param()
$input_json = $input | Out-String
try { $data = $input_json | ConvertFrom-Json } catch { exit 0 }
if (-not $data.session_id) { exit 0 }

$inputTokens = 0; $outputTokens = 0; $cacheRead = 0; $model = $null
if ($data.transcript_path -and (Test-Path $data.transcript_path)) {
    Get-Content $data.transcript_path | ForEach-Object {
        try {
            $line = $_ | ConvertFrom-Json
            if ($line.type -eq "assistant" -and $line.message -and $line.message.usage) {
                $u = $line.message.usage
                if ($u.input_tokens)            { $inputTokens  += $u.input_tokens }
                if ($u.output_tokens)           { $outputTokens += $u.output_tokens }
                if ($u.cache_read_input_tokens) { $cacheRead    += $u.cache_read_input_tokens }
                if ($line.message.model)        { $model         = $line.message.model }
            }
        } catch {}
    }
}

@{
    sessionId = $data.session_id
    model     = $model
    tokensIn  = $inputTokens
    tokensOut = $outputTokens
    cacheRead = $cacheRead
    updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} | ConvertTo-Json -Compress | Set-Content "$env:TEMP\\${FTERM_STATS_FILENAME}" -Encoding utf8
exit 0
`

const FTERM_HOOK_SH = `#!/usr/bin/env bash
# FTerm Claude Code Integration — auto-generated, do not edit manually
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null)
TRANSCRIPT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

TOKENS_IN=0; TOKENS_OUT=0; CACHE_READ=0; MODEL=""
if [ -f "$TRANSCRIPT" ]; then
    while IFS= read -r line; do
        TYPE=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('type',''))" 2>/dev/null)
        if [ "$TYPE" = "assistant" ]; then
            TOKENS_IN=$(( TOKENS_IN + $(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message',{}).get('usage',{}).get('input_tokens',0))" 2>/dev/null || echo 0) ))
            TOKENS_OUT=$(( TOKENS_OUT + $(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message',{}).get('usage',{}).get('output_tokens',0))" 2>/dev/null || echo 0) ))
            CACHE_READ=$(( CACHE_READ + $(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message',{}).get('usage',{}).get('cache_read_input_tokens',0))" 2>/dev/null || echo 0) ))
            M=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message',{}).get('model',''))" 2>/dev/null)
            [ -n "$M" ] && MODEL="$M"
        fi
    done < "$TRANSCRIPT"
fi

TMPFILE="\${TMPDIR:-/tmp}/${FTERM_STATS_FILENAME}"
python3 -c "
import json,os
data={'sessionId':'$SESSION_ID','model':'$MODEL','tokensIn':$TOKENS_IN,'tokensOut':$TOKENS_OUT,'cacheRead':$CACHE_READ,'updatedAt':__import__('time').time()*1000}
open('$TMPFILE','w').write(json.dumps(data))
" 2>/dev/null
exit 0
`

ipcMain.handle('claude:installHook', async () => {
  const path = require('path')
  const fs = require('fs')

  const claudeDir = path.join(homedir(), '.claude')
  const hooksDir = path.join(claudeDir, 'hooks')
  const settingsPath = path.join(claudeDir, 'settings.json')
  const isWin = platform() === 'win32'

  // Write hook script
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true })

  if (isWin) {
    const hookPath = path.join(hooksDir, CLAUDE_HOOK_FILENAME)
    fs.writeFileSync(hookPath, FTERM_HOOK_PS1, 'utf8')
  } else {
    const hookPath = path.join(hooksDir, 'fterm-stats.sh')
    fs.writeFileSync(hookPath, FTERM_HOOK_SH, 'utf8')
    fs.chmodSync(hookPath, 0o755)
  }

  // Patch ~/.claude/settings.json
  let settings: any = {}
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch {}
  }
  if (!settings.hooks) settings.hooks = {}
  if (!settings.hooks.Stop) settings.hooks.Stop = []

  const hookCmd = isWin
    ? `powershell -ExecutionPolicy Bypass -File "${path.join(hooksDir, CLAUDE_HOOK_FILENAME)}"`
    : `bash "${path.join(hooksDir, 'fterm-stats.sh')}"`

  // Check if FTerm hook already registered
  const alreadyRegistered = settings.hooks.Stop.some((group: any) =>
    Array.isArray(group.hooks) && group.hooks.some((h: any) =>
      typeof h.command === 'string' && h.command.includes('fterm-stats')
    )
  )

  if (!alreadyRegistered) {
    settings.hooks.Stop.push({
      hooks: [{
        type: 'command',
        command: hookCmd,
        ...(isWin ? { shell: 'powershell' } : {}),
      }]
    })
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }

  return {
    statsFile: path.join(isWin ? process.env.TEMP || tmpdir() : tmpdir(), FTERM_STATS_FILENAME),
    alreadyRegistered,
  }
})

ipcMain.handle('claude:hookStatus', () => {
  const path = require('path')
  const fs = require('fs')
  const isWin = platform() === 'win32'
  const hookFile = path.join(homedir(), '.claude', 'hooks', isWin ? CLAUDE_HOOK_FILENAME : 'fterm-stats.sh')
  const settingsPath = path.join(homedir(), '.claude', 'settings.json')
  const statsFile = path.join(isWin ? process.env.TEMP || tmpdir() : tmpdir(), FTERM_STATS_FILENAME)

  let registered = false
  if (fs.existsSync(settingsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      registered = (s.hooks?.Stop ?? []).some((group: any) =>
        Array.isArray(group.hooks) && group.hooks.some((h: any) =>
          typeof h.command === 'string' && h.command.includes('fterm-stats')
        )
      )
    } catch {}
  }

  return {
    hookInstalled: fs.existsSync(hookFile),
    registered,
    statsFile,
  }
})

// ─── Temp file write IPC ─────────────────────────────────────────────────────

ipcMain.handle('fs:writeTmp', (_e, filename: string, content: string) => {
  const path = require('path')
  if (typeof filename !== 'string' || filename.length === 0 || filename.length > 200) {
    throw new Error('Invalid filename')
  }
  // Strip any path components — only the basename allowed. Then sanitize remaining chars.
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!base || base === '.' || base === '..') throw new Error('Invalid filename')
  const tmp = path.resolve(tmpdir())
  const filePath = path.resolve(tmp, base)
  // Ensure final path stays inside tmpdir
  if (!filePath.startsWith(tmp + path.sep) && filePath !== tmp) {
    throw new Error('Path escape detected')
  }
  writeFileSync(filePath, content, 'utf8')
  return filePath
})

// ─── Shell exec (statusline polling, etc.) ───────────────────────────────────

ipcMain.handle('shell:exec', async (_e, command: string) => {
  if (typeof command !== 'string' || command.length === 0 || command.length > 2048) {
    throw new Error('Invalid command')
  }
  const { stdout } = await execAsync(command, { timeout: 5000, windowsHide: true })
  // Strip ANSI escapes from output before returning to renderer
  return stdout.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b./g, '').trim()
})

// ─── Shell detection IPC ──────────────────────────────────────────────────────

ipcMain.handle('shell:detect', async () => {
  type ShellEntry = { id: string; name: string; shell: string; icon: string }
  const results: ShellEntry[] = []

  if (process.platform === 'win32') {
    const candidates: ShellEntry[] = [
      { id: 'cmd', name: 'Command Prompt', shell: 'cmd.exe', icon: 'TerminalSquare' },
      { id: 'pwsh', name: 'PowerShell', shell: 'pwsh.exe', icon: 'Code' },
      { id: 'ps', name: 'Windows PS', shell: 'powershell.exe', icon: 'Code' },
      { id: 'wsl', name: 'WSL', shell: 'wsl.exe', icon: 'Linux' },
      { id: 'bash', name: 'Git Bash', shell: 'bash.exe', icon: 'GitMerge' },
    ]
    for (const c of candidates) {
      try {
        await execFileAsync('where', [c.shell], { timeout: 2000 })
        results.push(c)
      } catch { /* not found */ }
    }
  } else {
    const candidates: ShellEntry[] = [
      { id: 'bash', name: 'Bash', shell: '/bin/bash', icon: 'TerminalSquare' },
      { id: 'zsh', name: 'Zsh', shell: '/bin/zsh', icon: 'TerminalSquare' },
      { id: 'fish', name: 'Fish', shell: '/usr/bin/fish', icon: 'TerminalSquare' },
      { id: 'sh', name: 'Sh', shell: '/bin/sh', icon: 'TerminalSquare' },
    ]
    for (const c of candidates) {
      if (existsSync(c.shell)) results.push(c)
    }
  }

  return results
})

// ─── Window capture IPC ──────────────────────────────────────────────────────

ipcMain.handle('window:captureRect', async (event, rect: { x: number; y: number; width: number; height: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('No window')
  const img = await win.webContents.capturePage(rect)
  return 'data:image/png;base64,' + img.toPNG().toString('base64')
})

// ─── Recording IPC ───────────────────────────────────────────────────────────

ipcMain.handle('recording:stop', async (event, data: {
  snapshots: any[]
  events: any[]
  theme: any
  fontFamily?: string
  backgroundImage?: string
  backgroundBlur?: number
  backgroundOpacity?: number
}) => {
  const videos = app.getPath('videos')
  const ts = Date.now()
  const finalVideo = join(videos, `fterm-recording-${ts}.mp4`)

  try {
    await composeVideo({
      snapshots: data.snapshots,
      events: data.events,
      outputPath: finalVideo,
      fps: 10,
      width: 1200,
      height: 800,
      theme: data.theme,
      fontFamily: data.fontFamily,
      backgroundImage: data.backgroundImage,
      backgroundBlur: data.backgroundBlur,
      backgroundOpacity: data.backgroundOpacity,
      onProgress: (p) => event.sender.send('recording:progress', p),
    })
    return { videoPath: finalVideo }
  } catch (err: any) {
    console.error('[recording] ERROR:', err)
    throw new Error(err?.message ?? String(err))
  }
})

// ─── Remote Terminal IPC ──────────────────────────────────────────────────────

ipcMain.handle('remote:start', async (event, port: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('No window')
  const p = Math.max(1024, Math.min(65535, port || 7681))
  return remoteTerminal.start(p, win)
})

ipcMain.handle('remote:stop', async () => {
  await remoteTerminal.stop()
})

ipcMain.handle('remote:status', () => {
  return remoteTerminal.getStatus()
})

// ─── Clipboard history ────────────────────────────────────────────────────────

interface ClipEntry { id: string; text: string; ts: number; pinned?: boolean }
const CLIP_MAX = 100
const CLIP_MIN_LEN = 1
const CLIP_MAX_LEN = 100_000
let clipHistory: ClipEntry[] = []
let clipLastSeen: string = ''
let clipPollTimer: NodeJS.Timeout | null = null
let clipIdCounter = 0
const newClipId = () => `clip-${Date.now()}-${++clipIdCounter}`

function pollClipboard(): void {
  try {
    const cur = clipboard.readText()
    if (!cur || cur === clipLastSeen) return
    clipLastSeen = cur
    if (cur.length < CLIP_MIN_LEN || cur.length > CLIP_MAX_LEN) return
    // Move existing identical entry to top instead of duplicating
    const existingIdx = clipHistory.findIndex(e => e.text === cur)
    if (existingIdx !== -1) {
      const [existing] = clipHistory.splice(existingIdx, 1)
      existing.ts = Date.now()
      clipHistory.unshift(existing)
    } else {
      clipHistory.unshift({ id: newClipId(), text: cur, ts: Date.now() })
      // Trim non-pinned overflow
      const pinned = clipHistory.filter(e => e.pinned)
      const unpinned = clipHistory.filter(e => !e.pinned).slice(0, CLIP_MAX - pinned.length)
      clipHistory = [...pinned, ...unpinned].sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.ts - a.ts
      )
    }
    mainWindow?.webContents.send('clipboard:update')
  } catch { /* ignore */ }
}

ipcMain.handle('clipboard:history', () => clipHistory)
ipcMain.handle('clipboard:write', (_e, text: string) => {
  clipboard.writeText(text)
  clipLastSeen = text
})
ipcMain.handle('clipboard:pin', (_e, id: string, pinned: boolean) => {
  const e = clipHistory.find(c => c.id === id)
  if (e) e.pinned = pinned
})
ipcMain.handle('clipboard:delete', (_e, id: string) => {
  clipHistory = clipHistory.filter(c => c.id !== id)
})
ipcMain.handle('clipboard:clear', () => {
  clipHistory = clipHistory.filter(c => c.pinned)
})

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Single instance — a second launch focuses the existing window instead of
// spawning a rival process that fights over the GPU/disk cache (breaks video decode).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      // Hidden because quake tucked it off-screen — a second launch should
      // bring the app back rather than silently do nothing.
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  protocol.handle('fterm', (request) => {
    // URL format: fterm://local/<absolute-path>  e.g. fterm://local/C:/Users/…
    const path = require('path')
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)
    // On Windows the path is /C:/… — strip the leading slash
    if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1)
    // Resolve and validate against allowlist (catches .. after decoding)
    let resolved: string
    try { resolved = path.resolve(filePath) } catch { return new Response('Bad Request', { status: 400 }) }
    if (!path.isAbsolute(resolved) || !isPathAllowed(resolved)) {
      return new Response('Forbidden', { status: 403 })
    }
    // Serve user-selected images and audio
    const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
    const mime: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
      flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm', webm: 'audio/webm',
    }
    if (!mime[ext]) return new Response('Forbidden', { status: 403 })
    try {
      const st = statSync(resolved)
      const total = st.size
      const rangeHeader = request.headers.get('range') || request.headers.get('Range')
      const baseHeaders: Record<string, string> = {
        'Content-Type': mime[ext],
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      }
      const streamToWeb = (start: number, end: number): ReadableStream => {
        const nodeStream = createReadStream(resolved, { start, end })
        return new ReadableStream({
          start(controller) {
            nodeStream.on('data', (chunk: Buffer | string) => {
              controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))
            })
            nodeStream.on('end', () => controller.close())
            nodeStream.on('error', (err) => controller.error(err))
          },
          cancel() { nodeStream.destroy() },
        })
      }
      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
        if (!m) return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
        let start = m[1] === '' ? NaN : parseInt(m[1], 10)
        let end = m[2] === '' ? NaN : parseInt(m[2], 10)
        if (isNaN(start) && isNaN(end)) return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
        if (isNaN(start)) { start = Math.max(0, total - end); end = total - 1 }
        else if (isNaN(end)) { end = total - 1 }
        if (start > end || end >= total) return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
        return new Response(streamToWeb(start, end), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
          },
        })
      }
      return new Response(streamToWeb(0, total - 1), {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(total) },
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })

  // CSP — defense-in-depth against XSS in renderer
  // Dev needs 'unsafe-eval' for Vite HMR; prod is stricter.
  // Monaco editor is self-hosted (see src/monaco-init.ts). Workers load from blob:
  // and Monaco uses Function() inside workers → 'unsafe-eval' required in script-src.
  const cspProd = [
    "default-src 'self' fterm:",
    "script-src 'self' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: fterm: https:",
    "media-src 'self' blob: fterm:",
    "font-src 'self' data:",
    "connect-src 'self' fterm: https: wss: ws://localhost:* ws://127.0.0.1:*",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')
  const cspDev = [
    "default-src 'self' fterm:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: fterm: https:",
    "media-src 'self' blob: fterm:",
    "font-src 'self' data:",
    "connect-src 'self' fterm: https: wss: ws: http://localhost:* http://127.0.0.1:*",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? cspDev : cspProd],
        'X-Content-Type-Options': ['nosniff'],
      },
    })
  })

  registerAIHandlers()
  initBrowserSession()  // adblock + hardened partition for in-app browser (non-blocking)
  // Quake drives the primary window; the renderer pushes the persisted config on mount.
  quake.initQuakeMode(() => mainWindow)
  createWindow()

  clipLastSeen = clipboard.readText() || ''
  clipPollTimer = setInterval(pollClipboard, 800)
})

// Harden in-app browser <webview> guests. Fires for the main window AND every webview.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return

  // Pop-ups / target=_blank → open in the user's real browser, never a new Electron window.
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const p = new URL(url)
      if (p.protocol === 'http:' || p.protocol === 'https:') shell.openExternal(url)
    } catch { /* ignore */ }
    return { action: 'deny' }
  })

  // Block navigation to non-web schemes (file:, javascript:, etc.) inside the guest.
  contents.on('will-navigate', (evt, url) => {
    try {
      const p = new URL(url)
      if (p.protocol !== 'http:' && p.protocol !== 'https:' && p.protocol !== 'about:') evt.preventDefault()
    } catch { evt.preventDefault() }
  })
})

ipcMain.handle('browser:adblock-stats', () => getAdblockStats())
ipcMain.on('browser:download-url', (_e, url: string, ephemeral?: boolean) => downloadUrl(url, !!ephemeral))
ipcMain.on('browser:download-cancel', (_e, id: number) => cancelDownload(id))
ipcMain.on('browser:download-open', (_e, path: string) => { if (isAllowedDownloadPath(path) && isSafeToOpen(path)) shell.openPath(path) })
ipcMain.on('browser:download-show', (_e, path: string) => { if (isAllowedDownloadPath(path)) shell.showItemInFolder(path) })
ipcMain.handle('browser:clear-data', (_e, opts?: ClearDataOptions) => {
  // Coerce to plain booleans so a malformed renderer payload can't smuggle
  // unexpected shapes into the session API.
  const safe = opts && typeof opts === 'object'
    ? { cache: !!opts.cache, cookies: !!opts.cookies }
    : undefined
  return clearBrowsingData(safe)
})
ipcMain.handle('browser:adblock-toggle', (_e, on: boolean) => setAdblockEnabled(on))
ipcMain.handle('browser:download-mode-get', () => getAskWhereToSave())
ipcMain.handle('browser:download-mode-set', (_e, ask: boolean) => setAskWhereToSave(ask))
ipcMain.handle('browser:ubol-info', () => getUbolInfo())
ipcMain.handle('browser:ubol-check', () => checkUbolUpdateNow())
ipcMain.handle('browser:ubol-autoupdate', (_e, on: boolean) => setUbolAutoUpdate(!!on))

app.on('will-quit', () => {
  quake.disposeQuakeMode()   // release the global hotkey back to the OS
})

app.on('window-all-closed', () => {
  remoteTerminal.stop().catch(() => { })
  quake.disposeQuakeMode()
  clearCopilotToken()
  if (clipPollTimer) { clearInterval(clipPollTimer); clipPollTimer = null }
  pty.killAll()   // all windows gone → tear down every PTY session
  if (process.platform !== 'darwin') app.quit()
})

app.on('browser-window-blur', () => {
  // Clear short-lived copilot token from memory when app loses focus
  clearCopilotToken()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
