import { app, BrowserWindow, ipcMain, shell, protocol, dialog, screen, session } from 'electron'
import { join } from 'path'
import { homedir, tmpdir, cpus as osCpus, freemem, totalmem, platform, release, hostname, userInfo, arch, uptime } from 'os'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

// ─── Network stats tracker ────────────────────────────────────────────────────
let _prevNetBytes: { rx: number; tx: number; ts: number } | null = null

async function getNetworkDelta(): Promise<{ rxKbps: number; txKbps: number; rxTotal: number; txTotal: number }> {
  try {
    let rx = 0, tx = 0
    const plat = platform()
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
    return { rxKbps: Math.round(rxKbps * 10) / 10, txKbps: Math.round(txKbps * 10) / 10, rxTotal: rx, txTotal: tx }
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
const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,          // disable DevTools in packaged builds — prevents inspecting IPC traffic / token-bearing requests
    },
  })

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    // Block DevTools shortcuts in production
    if (!isDev && input.type === 'keyDown') {
      const k = input.key.toLowerCase()
      if (k === 'f12' || (input.control && input.shift && (k === 'i' || k === 'j' || k === 'c'))) {
        _e.preventDefault()
        return
      }
    }
    if (input.type === 'keyDown' && input.control && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
      _e.preventDefault()
      mainWindow?.webContents.send('shortcut:history-search')
    }
  })

  // Block navigation away from app origin — prevents redirect-based exfiltration if renderer is XSS'd
  mainWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const parsed = new URL(url)
      const devOk = isDev && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      const fileOk = parsed.protocol === 'file:'
      if (!devOk && !fileOk) e.preventDefault()
    } catch { e.preventDefault() }
  })

  // Open all window.open() / target=_blank externally via shell — never spawn another BrowserWindow
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(url)
    } catch { /* ignore */ }
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    pty.killAll()
    mainWindow = null
  })

  // Broadcast window state changes to renderer so UI stays in sync
  const sendState = () => {
    if (!mainWindow) return
    mainWindow.webContents.send('window:state', {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen(),
    })
  }
  mainWindow.on('maximize', sendState)
  mainWindow.on('unmaximize', sendState)
  mainWindow.on('enter-full-screen', sendState)
  mainWindow.on('leave-full-screen', sendState)

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
        mainWindow?.webContents.send('pet:still')
      }
    }, 500)
  }
  mainWindow.on('move', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
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
            mainWindow.webContents.send('pet:shake')
          }
        }
      }
      if (dist >= 4) lastDir = { dx, dy }
    }
    lastPos = { x, y, ts: now }
    if (shakeActive) armStill()
  })
}

// ─── PTY IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (_e, tabId: string, cols: number, rows: number, shell?: string, args?: string[], cwd?: string, env?: Record<string, string>) => {
  if (!mainWindow) throw new Error('No window')
  return pty.createSession(tabId, cols, rows, mainWindow, shell, args, cwd, env)
})

ipcMain.on('pty:write', (_e, tabId: string, data: string) => pty.writeToSession(tabId, data))
ipcMain.on('pty:resize', (_e, tabId: string, c: number, r: number) => pty.resizeSession(tabId, c, r))
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

// GitHub tokens: gho_/ghu_/ghs_/ghp_/ghr_ prefixes (modern) or 40-char hex (legacy)
const GITHUB_TOKEN_RE = /^(gh[oupsr]_[A-Za-z0-9_]{30,255}|[a-f0-9]{40})$/

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

ipcMain.on('window:minimize', () => mainWindow?.minimize())
let preMaxBounds: Electron.Rectangle | null = null

function toggleMaximize() {
  if (!mainWindow) return
  const isMax = mainWindow.isMaximized() || (process.platform === 'win32' && preMaxBounds !== null)
  const isFS = mainWindow.isFullScreen()
  if (isMax || isFS) {
    if (isFS) {
      mainWindow.setFullScreen(false)
    } else if (process.platform === 'win32' && preMaxBounds) {
      mainWindow.setBounds(preMaxBounds)
      preMaxBounds = null
      mainWindow.webContents.send('window:state', { maximized: false, fullScreen: false })
    } else {
      mainWindow.unmaximize()
    }
  } else {
    if (process.platform === 'win32') {
      preMaxBounds = mainWindow.getBounds()
      const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea
      mainWindow.setBounds(workArea)
      mainWindow.webContents.send('window:state', { maximized: true, fullScreen: false })
    } else {
      mainWindow.maximize()
    }
  }
}

ipcMain.on('window:maximize', toggleMaximize)

let dragState: { cursor: { x: number; y: number }; x: number; y: number; width: number; height: number } | null = null
ipcMain.on('window:drag-start', () => {
  if (!mainWindow) return
  const b = mainWindow.getBounds()
  dragState = { cursor: screen.getCursorScreenPoint(), x: b.x, y: b.y, width: b.width, height: b.height }
})
ipcMain.on('window:drag-update', () => {
  if (!mainWindow || !dragState) return
  const cur = screen.getCursorScreenPoint()
  const dx = cur.x - dragState.cursor.x
  const dy = cur.y - dragState.cursor.y
  dragState.cursor = cur
  dragState.x += dx
  dragState.y += dy
  mainWindow.setBounds({ x: Math.round(dragState.x), y: Math.round(dragState.y), width: dragState.width, height: dragState.height })
})
ipcMain.on('window:drag-end', () => { dragState = null })
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.on('window:set-position', (_e, x: number, y: number) => mainWindow?.setPosition(x, y))
ipcMain.on('window:set-opacity', (_e, v: number) => mainWindow?.setOpacity(Math.min(1, Math.max(0.1, v))))
ipcMain.handle('window:get-position', () => mainWindow?.getPosition() ?? [0, 0])
ipcMain.on('window:open-external', (_e, url: string) => {
  // Only allow http(s) URLs to prevent opening arbitrary protocols (file://, smb://, etc.)
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url)
    }
  } catch { /* invalid URL — ignore */ }
})

ipcMain.on('shell:open-path', (_e, filePath: string) => {
  if (typeof filePath === 'string' && filePath.length > 0) {
    shell.openPath(filePath)
  }
})

ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

// ─── System Metrics IPC ───────────────────────────────────────────────────────

ipcMain.handle('system:metrics', async () => {
  const net = await getNetworkDelta()
  return {
    cpus: osCpus(),
    freeMem: freemem(),
    totalMem: totalmem(),
    platform: platform(),
    release: release(),
    hostname: hostname(),
    username: userInfo().username,
    arch: arch(),
    uptime: uptime(),
    network: net,
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
      const child = require('child_process').spawn(pingBin, pingArgs)
      const killTimer = setTimeout(() => { try { child.kill() } catch { } }, 32000)
      child.stdout.on('data', (d: Buffer) => { out += d.toString() })
      child.stderr.on('data', (d: Buffer) => { out += d.toString() })
      child.on('close', () => { clearTimeout(killTimer); resolve(out) })
      child.on('error', (err: Error) => { clearTimeout(killTimer); reject(err) })
    })

    console.log('[ping] raw stdout:', JSON.stringify(stdout))
    const rtts = parseRtts(stdout)
    console.log('[ping] parsed rtts:', rtts)
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
    ? ['C:\\', 'D:\\', 'E:\\', 'F:\\']
    : ['/']),
].map(p => require('path').resolve(p))

function isPathAllowed(resolved: string): boolean {
  const path = require('path')
  const norm = path.normalize(resolved)
  return FS_READDIR_ROOTS.some(root => {
    const r = path.normalize(root)
    return norm === r || norm.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
  })
}

ipcMain.handle('fs:readdir', (_e, dirPath: string) => {
  try {
    const path = require('path')
    if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) throw new Error('Invalid path')
    const resolved = path.resolve(dirPath)
    if (!isPathAllowed(resolved)) throw new Error('Path not allowed')
    const entries = readdirSync(resolved, { withFileTypes: true })
    return entries.map(e => {
      let size = 0
      if (!e.isDirectory()) {
        try { size = statSync(join(dirPath, e.name)).size } catch { /* ignore */ }
      }
      return { name: e.name, isDir: e.isDirectory(), size }
    })
  } catch (err: any) {
    throw new Error(err.message)
  }
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
    return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  } catch {
    return null
  }
})

ipcMain.handle('docker:logs', async (_e, containerId: string) => {
  // Validate container ID format (hex or name: alphanumeric, dash, underscore, dot)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/.test(containerId)) throw new Error('Invalid container ID')
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['logs', '--tail', '50', containerId])
    return (stdout || '') + (stderr || '')
  } catch (e: any) {
    return e.message
  }
})

ipcMain.handle('docker:action', async (_e, id: string, action: 'start' | 'stop') => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/.test(id)) throw new Error('Invalid container ID')
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

ipcMain.handle('git:repository', (_e, cwd: string) => {
  console.log('[git] detectRepository path:', JSON.stringify(cwd))
  return gitService.detectRepository(cwd)
})
ipcMain.handle('git:status', (_e, repoPath: string) => {
  console.log('[git] getStatus path:', JSON.stringify(repoPath))
  return gitService.getStatus(repoPath)
})
ipcMain.handle('git:branches', (_e, repoPath: string) => gitService.getBranches(repoPath))
ipcMain.handle('git:log', (_e, repoPath: string, limit: number) => gitService.getCommits(repoPath, limit))
ipcMain.handle('git:checkout', (_e, repoPath: string, branch: string) => gitService.checkoutBranch(repoPath, branch))
ipcMain.handle('git:commit', (_e, repoPath: string, message: string) => gitService.createCommit(repoPath, message))
ipcMain.handle('git:push', (_e, repoPath: string, remote: string, branch: string) => gitService.push(repoPath, remote, branch))
ipcMain.handle('git:pull', (_e, repoPath: string, remote: string, branch: string) => gitService.pull(repoPath, remote, branch))
ipcMain.handle('git:remotes', (_e, repoPath: string) => gitService.getRemotes(repoPath))
ipcMain.handle('git:stats', (_e, repoPath: string) => gitService.getRepoStats(repoPath))
ipcMain.handle('git:diff', (_e, repoPath: string, args?: string[]) => gitService.getDiff(repoPath, args))
ipcMain.handle('git:stage', (_e, repoPath: string, filePath: string) => gitService.stageFile(repoPath, filePath))
ipcMain.handle('git:unstage', (_e, repoPath: string, filePath: string) => gitService.unstageFile(repoPath, filePath))
ipcMain.handle('git:stash:list', (_e, repoPath: string) => gitService.stashList(repoPath))
ipcMain.handle('git:stash:push', (_e, repoPath: string, message?: string) => gitService.stashPush(repoPath, message))
ipcMain.handle('git:stash:pop', (_e, repoPath: string, index: number) => gitService.stashPop(repoPath, index))
ipcMain.handle('git:stash:apply', (_e, repoPath: string, index: number) => gitService.stashApply(repoPath, index))
ipcMain.handle('git:stash:drop', (_e, repoPath: string, index: number) => gitService.stashDrop(repoPath, index))
ipcMain.handle('git:discard', (_e, repoPath: string, filePath: string) => gitService.discardFile(repoPath, filePath))

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
  return readFileSync(resolved, 'utf8')
})

ipcMain.handle('fs:writeFile', (_e, filePath: string, content: string) => {
  const path = require('path')
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid path')
  const resolved = path.resolve(filePath)
  if (!isPathAllowed(resolved)) throw new Error('Path not allowed')
  writeFileSync(resolved, content, 'utf8')
  return true
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

// ─── App lifecycle ────────────────────────────────────────────────────────────

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
    // Only serve image types — this protocol exists to display user-selected images
    const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
    if (!mime[ext]) return new Response('Forbidden', { status: 403 })
    try {
      const data = readFileSync(resolved)
      return new Response(data, { headers: { 'Content-Type': mime[ext] } })
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
    "font-src 'self' data:",
    "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:*",
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
    "font-src 'self' data:",
    "connect-src 'self' https: wss: ws: http://localhost:* http://127.0.0.1:*",
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
  createWindow()
})

app.on('window-all-closed', () => {
  remoteTerminal.stop().catch(() => { })
  clearCopilotToken()
  if (process.platform !== 'darwin') app.quit()
})

app.on('browser-window-blur', () => {
  // Clear short-lived copilot token from memory when app loses focus
  clearCopilotToken()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
