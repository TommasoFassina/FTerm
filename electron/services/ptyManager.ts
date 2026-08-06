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
// tabId → webContents.id of the window that currently owns (renders) the tab.
// Updated whenever that window creates/adopts, writes to, or resizes the tab,
// so steady-state PTY output is sent to a single window instead of broadcast.
const tabOwners = new Map<string, number>()
let nextSessionId = 0

const sessionHistory = new Map<string, string[]>()
const MAX_HISTORY_CHUNKS = 2000 // ring buffer of PTY data chunks
const MAX_PTY_BUFFER = 4 * 1024 * 1024 // 4MB per-flush cap to prevent unbounded growth

let ftermfetchScriptPath: string | null = null

export function deployFtermFetch(): string {
  if (ftermfetchScriptPath !== null) return ftermfetchScriptPath
  try {
    const dir = join(app.getPath('appData'), 'fterm')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, 'ftermfetch.ps1')

    // The ftermfetch script is optional. It used to be read inside the same try
    // block as the shell init files below, so a missing script took the init
    // scripts down with it \u2014 and with them OSC 7 / 9998 / 133 on cmd, bash and
    // fish. Shell integration is far more important than the banner, so its
    // failure is isolated here.
    let scriptDeployed = false
    try {
      // Always overwrite so updates ship with new app versions
      const src = join(__dirname, 'ftermfetch.ps1')
      const raw = existsSync(src)
        ? readFileSync(src, 'utf8')
        : readFileSync(join(__dirname, '..', 'electron', 'services', 'ftermfetch.ps1'), 'utf8')
      // Stamp the real app version in, so the banner can never drift from the
      // release the way a hardcoded string does.
      const content = raw.replace(/__FTERM_VERSION__/g, app.getVersion())
      // UTF-8 BOM (\ufeff) required for PowerShell 5.1 to read Unicode correctly
      writeFileSync(dest, '\ufeff' + content, 'utf8')
      scriptDeployed = true
    } catch {
      console.warn('[ftermfetch] script not found \u2014 shell integration continues without it')
    }

    // cmd init batch: DOSKEY macro + OSC 7 + OSC 9998 exit-code prompt (language-agnostic error detection)
    // $E]9998;%ERRORLEVEL%$E\ emits exit code each prompt redraw so renderer can show AI fix button
    // OSC 133;D (command finished + exit code) and OSC 133;A (prompt starts here)
    // drive the command-block tracker in the renderer. `B`/`C` are intentionally
    // not emitted — see src/utils/shellIntegration.ts.
    const cmdPromptStr = String.raw`$E]7;file://localhost/$P$E\$E]9998;%ERRORLEVEL%$E\$E]133;D;%ERRORLEVEL%$E\$E]133;A$E\$P$G`
    const initBat = [
      '@echo off',
      ...(scriptDeployed
        ? [`doskey ftermfetch=powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${dest}"`]
        : []),
      `prompt ${cmdPromptStr}`,
    ].join('\r\n') + '\r\n'
    writeFileSync(join(dir, 'fterm_init.bat'), initBat, 'ascii')

    // Unix init script: OSC 7 CWD + OSC 9998 exit code + ftermfetch stub
    // TerminalPane intercepts ftermfetch before PTY; stub prevents "command not found" as fallback
    const unixInit = [
      '# FTerm shell init',
      '__fterm_prompt() {',
      '  local s=$?',
      '  printf "\\033]7;file://localhost${PWD}\\007"',
      '  printf "\\033]9998;${s}\\007"',
      // OSC 133;D + 133;A — command blocks (see src/utils/shellIntegration.ts)
      '  printf "\\033]133;D;${s}\\007\\033]133;A\\007"',
      '}',
      'PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND}; }__fterm_prompt"',
      'ftermfetch() { printf "\\033[1;34mftermfetch\\033[0m: running via FTerm widget\\n"; }',
      'export -f ftermfetch 2>/dev/null || true',
    ].join('\n') + '\n'
    writeFileSync(join(dir, 'fterm_init.sh'), unixInit, 'utf8')

    // Fish init snippet (written to a file; fish -C sources it)
    const fishInit = [
      'function __fterm_prompt',
      '  set -l s $status',
      '  printf "\\033]7;file://localhost$PWD\\007"',
      '  printf "\\033]9998;%s\\007" $s',
      '  printf "\\033]133;D;%s\\007\\033]133;A\\007" $s',
      'end',
      'function __fterm_precmd --on-event fish_prompt',
      '  __fterm_prompt',
      'end',
      'function ftermfetch',
      '  printf "\\033[1;34mftermfetch\\033[0m: running via FTerm widget\\n"',
      'end',
    ].join('\n') + '\n'
    writeFileSync(join(dir, 'fterm_init.fish'), fishInit, 'utf8')

    // '' signals "no script" to callers, which skip the PowerShell wrapper —
    // the init scripts above are written either way.
    ftermfetchScriptPath = scriptDeployed ? dest : ''
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
  _win: BrowserWindow | null,
  customShell?: string,
  customArgs?: string[],
  customCwd?: string,
  customEnv?: Record<string, string>
): { pid: number; sessionId: number; history: string; cwd: string; reused: boolean } {
  const homedir = process.env.USERPROFILE || process.env.HOME || 'C:\\'
  const resolvedCwd = (customCwd && existsSync(customCwd)) ? customCwd : homedir
  // Whichever window calls create/adopt now owns this tab's output.
  if (_win && !_win.isDestroyed()) tabOwners.set(tabId, _win.webContents.id)
  if (sessions.has(tabId)) {
    const existingPty = sessions.get(tabId)!
    const existingId = sessionIds.get(tabId)!
    const history = (sessionHistory.get(tabId) || []).join('')
    try { existingPty.resize(Math.max(cols, 10), Math.max(rows, 5)) } catch { }
    return { pid: existingPty.pid!, sessionId: existingId, history, cwd: resolvedCwd, reused: true }
  }

  const sessionId = ++nextSessionId
  sessionIds.set(tabId, sessionId)
  sessionHistory.set(tabId, [])

  const shell = customShell || getShell()
  const cwd = resolvedCwd

  const shellLower = shell.toLowerCase()
  const isPwsh = shellLower.includes('pwsh') || shellLower.includes('powershell')
  const isCmd = shellLower.includes('cmd.exe') || shellLower.includes('cmd')
  const isBash = shellLower.includes('bash')
  const isZsh = shellLower.includes('zsh')
  const isFish = shellLower.includes('fish')
  const scriptPath = deployFtermFetch().replace(/\\/g, '\\\\')
  const ftermDir = join(app.getPath('appData'), 'fterm')
  const initBatPath = join(ftermDir, 'fterm_init.bat')
  const finalEnv = customEnv ? { ...process.env, ...customEnv } as Record<string, string> : { ...process.env } as Record<string, string>
  finalEnv['COLUMNS'] = String(Math.max(cols, 10))
  finalEnv['LINES']   = String(Math.max(rows, 5))

  // OSC 7: CWD + OSC 9998: exit code. Capture $? and $LASTEXITCODE FIRST before any Write resets $?
  const osc7Emit = String.raw`$p=$pwd.Path -replace '\\','/';[Console]::Write([char]27+']7;file://localhost/'+$p+[char]7)`
  // OSC 133;D carries the real exit code (0 when the shell reported none), then
  // 133;A marks the prompt row — together they delimit command blocks in the
  // renderer. Emitted via Console::Write rather than inside the returned prompt
  // string: invisible sequences in the prompt confuse PSReadLine's width maths.
  const osc133Emit = String.raw`[Console]::Write([char]27+']133;D;'+$(if($null -ne $_e){[string][int]$_e}else{'0'})+[char]7+[char]27+']133;A'+[char]7)`
  const pwshPromptFn = String.raw`$_e=$LASTEXITCODE;$LASTEXITCODE=0;${osc7Emit};[Console]::Write([char]27+']9998;'+$(if($_e -gt 0) {'1'} else {'0'})+[char]7);${osc133Emit};return ($pwd.Path+'> ')`
  const pwshInit = [
    'try { Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue } catch {}',
    `function prompt { ${pwshPromptFn} }`,
    scriptPath ? `function ftermfetch { & '${scriptPath}' }` : '',
    'try { Set-PSReadLineOption -PredictionSource History -ErrorAction SilentlyContinue } catch {}',
    'try { Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction SilentlyContinue } catch {}',
    'try { Set-PSReadLineOption -Colors @{ InlinePrediction = ([char]27+[char]91+\'38;5;244m\') } -ErrorAction SilentlyContinue } catch {}',
  ].filter(Boolean).join('; ')

  const unixInitPath = join(ftermDir, 'fterm_init.sh')
  const fishInitPath = join(ftermDir, 'fterm_init.fish')

  const args = customArgs || (
    isPwsh ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', pwshInit] :
    isCmd  ? ['/k', initBatPath] :
    isFish ? ['--init-command', `source ${fishInitPath}`] :
    (isBash || isZsh) && existsSync(unixInitPath)
           ? ['--rcfile', unixInitPath] :
    /* other unix */ []
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

  const broadcast = (channel: string, payload: any) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
  }

  // Send to the owning window only (steady state). Fall back to a broadcast if the
  // owner is unknown or gone, so a tab mid-move between windows never drops output.
  const emit = (channel: string, payload: any) => {
    const ownerId = tabOwners.get(tabId)
    if (ownerId !== undefined) {
      const w = BrowserWindow.getAllWindows().find(b => !b.isDestroyed() && b.webContents.id === ownerId)
      if (w) { w.webContents.send(channel, payload); return }
      tabOwners.delete(tabId) // owner window closed — fall through to broadcast
    }
    broadcast(channel, payload)
  }

  const flush = () => {
    if (buffer.length > 0) {
      emit(`pty:data:${tabId}`, buffer)
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
    broadcast(`pty:exit:${tabId}:${sessionId}`, exitCode)
    tabOwners.delete(tabId)
  })

  sessions.set(tabId, ptyProcess)

  return { pid: ptyProcess.pid!, sessionId, history: '', cwd: resolvedCwd, reused: false }
}

export function writeToSession(tabId: string, data: string, win?: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) tabOwners.set(tabId, win.webContents.id)
  sessions.get(tabId)?.write(data)
}

export function resizeSession(tabId: string, cols: number, rows: number, win?: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) tabOwners.set(tabId, win.webContents.id)
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
    tabOwners.delete(tabId)
  }
}

export function killAll(): void {
  sessions.forEach((p) => {
    try { p.kill() } catch { /* ignore */ }
  })
  sessions.clear()
  sessionIds.clear()
  sessionHistory.clear()
  tabOwners.clear()
}
