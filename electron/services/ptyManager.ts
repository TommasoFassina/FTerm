/**
 * PTY session manager.
 * Each tab gets its own pseudoterminal process.
 */
import * as pty from 'node-pty'
import { BrowserWindow, app } from 'electron'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const sessions = new Map<string, pty.IPty>()
const sessionIds = new Map<string, number>()
let nextSessionId = 0

const sessionHistory = new Map<string, string[]>()
const MAX_HISTORY_CHUNKS = 2000 // ring buffer of PTY data chunks
const MAX_PTY_BUFFER = 4 * 1024 * 1024 // 4MB per-flush cap to prevent unbounded growth

let ftermfetchScriptPath: string | null = null

function deployFtermFetch(): string {
  if (ftermfetchScriptPath !== null) return ftermfetchScriptPath
  try {
    const dir = join(app.getPath('appData'), 'fterm')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, 'ftermfetch.ps1')
    // Always overwrite so updates ship with new app versions
    const src = join(__dirname, 'ftermfetch.ps1')
    const content = existsSync(src)
      ? readFileSync(src, 'utf8')
      : readFileSync(join(__dirname, '..', 'electron', 'services', 'ftermfetch.ps1'), 'utf8')
    // UTF-8 BOM (\ufeff) required for PowerShell 5.1 to read Unicode correctly
    writeFileSync(dest, '\ufeff' + content, 'utf8')
    // cmd init batch: DOSKEY macro + OSC 7 + OSC 9998 exit-code prompt (language-agnostic error detection)
    // $E]9998;%ERRORLEVEL%$E\ emits exit code each prompt redraw so renderer can show AI fix button
    const cmdPromptStr = String.raw`$E]7;file://localhost/$P$E\$E]9998;%ERRORLEVEL%$E\$P$G`
    const initBat = [
      '@echo off',
      `doskey ftermfetch=powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${dest}"`,
      `prompt ${cmdPromptStr}`,
      'cls',
    ].join('\r\n') + '\r\n'
    writeFileSync(join(dir, 'fterm_init.bat'), initBat, 'ascii')
    ftermfetchScriptPath = dest
  } catch {
    ftermfetchScriptPath = ''
  }
  return ftermfetchScriptPath!
}

let cachedShell: string | null = null

function getShell(): string {
  if (cachedShell) return cachedShell
  if (process.platform === 'win32') {
    cachedShell = 'cmd.exe'
  } else {
    cachedShell = process.env.SHELL || '/bin/bash'
  }
  return cachedShell
}

export function createSession(
  tabId: string,
  cols: number,
  rows: number,
  win: BrowserWindow,
  customShell?: string,
  customArgs?: string[],
  customCwd?: string,
  customEnv?: Record<string, string>
): { pid: number; sessionId: number; history: string; cwd: string } {
  const resolvedCwd = customCwd || process.env.USERPROFILE || process.env.HOME || '/'
  if (sessions.has(tabId)) {
    const existingPty = sessions.get(tabId)!
    const existingId = sessionIds.get(tabId)!
    const history = (sessionHistory.get(tabId) || []).join('')
    try { existingPty.resize(Math.max(cols, 10), Math.max(rows, 5)) } catch { }
    return { pid: existingPty.pid!, sessionId: existingId, history, cwd: resolvedCwd }
  }

  const sessionId = ++nextSessionId
  sessionIds.set(tabId, sessionId)
  sessionHistory.set(tabId, [])

  const shell = customShell || getShell()
  const cwd = resolvedCwd

  const shellLower = shell.toLowerCase()
  const isPwsh = shellLower.includes('pwsh') || shellLower.includes('powershell')
  const isCmd = shellLower.includes('cmd.exe') || shellLower.includes('cmd')
  const scriptPath = deployFtermFetch().replace(/\\/g, '\\\\')
  const ftermDir = join(app.getPath('appData'), 'fterm')
  const initBatPath = join(ftermDir, 'fterm_init.bat')
  const finalEnv = customEnv ? { ...process.env, ...customEnv } as Record<string, string> : { ...process.env } as Record<string, string>
  finalEnv['COLUMNS'] = String(Math.max(cols, 10))
  finalEnv['LINES']   = String(Math.max(rows, 5))

  // OSC 7: CWD + OSC 9998: exit code. Capture $? and $LASTEXITCODE FIRST before any Write resets $?
  const osc7Emit = String.raw`$p=$pwd.Path -replace '\\','/';[Console]::Write([char]27+']7;file://localhost/'+$p+[char]7)`
  const pwshPromptFn = String.raw`$_e=$LASTEXITCODE;$LASTEXITCODE=0;${osc7Emit};[Console]::Write([char]27+']9998;'+$(if($_e -gt 0) {'1'} else {'0'})+[char]7);return ($pwd.Path+'> ')`
  const pwshInit = [
    'try { Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue } catch {}',
    `function prompt { ${pwshPromptFn} }`,
    scriptPath ? `function ftermfetch { & '${scriptPath}' }` : '',
    'try { Set-PSReadLineOption -PredictionSource History -ErrorAction SilentlyContinue } catch {}',
    'try { Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction SilentlyContinue } catch {}',
    'try { Set-PSReadLineOption -Colors @{ InlinePrediction = ([char]27+[char]91+\'38;5;244m\') } -ErrorAction SilentlyContinue } catch {}',
  ].filter(Boolean).join('; ')

  const args = customArgs || (
    isPwsh ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', pwshInit] :
    isCmd  ? ['/k', initBatPath] :
    /* unix */ []
  )

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: Math.max(cols, 10),
    rows: Math.max(rows, 5),
    cwd,
    env: finalEnv,
  })

  let buffer = ''
  let flushTimeout: NodeJS.Timeout | null = null

  const flush = () => {
    if (!win.isDestroyed() && buffer.length > 0) {
      // Use IPC send with buffered chunk
      win.webContents.send(`pty:data:${tabId}`, buffer)
      buffer = ''
    }
    flushTimeout = null
  }

  ptyProcess.onData(data => {
    buffer += data

    const history = sessionHistory.get(tabId)
    if (history) {
      history.push(data)
      if (history.length > MAX_HISTORY_CHUNKS) history.shift()
    }

    // Force-flush early if buffer gets large to bound memory
    if (buffer.length >= MAX_PTY_BUFFER) {
      if (flushTimeout) { clearTimeout(flushTimeout); flushTimeout = null }
      flush()
      return
    }
    if (!flushTimeout) {
      flushTimeout = setTimeout(flush, 16)
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    // Only fire if this is still the active session for this tab
    if (sessionIds.get(tabId) !== sessionId) return
    if (flushTimeout) { clearTimeout(flushTimeout); flushTimeout = null }
    sessions.delete(tabId)
    sessionIds.delete(tabId)
    sessionHistory.delete(tabId)
    if (!win.isDestroyed()) {
      win.webContents.send(`pty:exit:${tabId}:${sessionId}`, exitCode)
    }
  })

  sessions.set(tabId, ptyProcess)

  return { pid: ptyProcess.pid!, sessionId, history: '', cwd: resolvedCwd }
}

export function writeToSession(tabId: string, data: string): void {
  sessions.get(tabId)?.write(data)
}

export function resizeSession(tabId: string, cols: number, rows: number): void {
  const p = sessions.get(tabId)
  if (p) {
    p.resize(Math.max(cols, 10), Math.max(rows, 5))
  }
}

export function killSession(tabId: string): void {
  const p = sessions.get(tabId)
  if (p) {
    try { p.kill() } catch { /* already dead */ }
    // Delete after kill so a throw doesn't leave maps in an inconsistent state.
    // onExit fires asynchronously after this returns, at which point sessionIds
    // is already cleared, so the onExit guard (sessionId mismatch) still works.
    sessions.delete(tabId)
    sessionIds.delete(tabId)
    sessionHistory.delete(tabId)
  }
}

export function killAll(): void {
  sessions.forEach((p) => {
    try { p.kill() } catch { /* ignore */ }
  })
  sessions.clear()
  sessionIds.clear()
  sessionHistory.clear()
}
