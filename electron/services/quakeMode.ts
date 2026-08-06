/**
 * Quake / drop-down terminal mode.
 *
 * A global hotkey slides the window in from an edge of the display, always on
 * top, and slides it away again. The window is the *same* BrowserWindow the app
 * already runs in — entering quake stashes the normal bounds so `restore()` can
 * put it back exactly where the user left it.
 *
 * Everything here is main-process only; the renderer just pushes config and
 * reads back whether the hotkey could be registered.
 */
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { isValidAccelerator } from '../security/validators'

export interface QuakeConfig {
  enabled: boolean
  /** Electron accelerator, validated before registration. */
  hotkey: string
  /** Edge the window drops from. */
  position: 'top' | 'bottom'
  /** Percent of the display work area, 20–100. */
  height: number
  /** Percent of the display work area, 30–100. */
  width: number
  /** Which display to drop onto. */
  monitor: 'cursor' | 'primary'
  /** Hide again as soon as the window loses focus. */
  hideOnBlur: boolean
  /** Slide the window in, instead of appearing instantly. */
  animate: boolean
}

export const DEFAULT_QUAKE: QuakeConfig = {
  enabled: false,
  hotkey: process.platform === 'darwin' ? 'Option+`' : 'Ctrl+`',
  position: 'top',
  height: 45,
  width: 100,
  monitor: 'cursor',
  hideOnBlur: true,
  animate: true,
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback

/** Coerce a renderer-supplied payload into a config we are willing to act on. */
export function sanitizeQuakeConfig(input: unknown): QuakeConfig {
  const c = (input && typeof input === 'object' ? input : {}) as Partial<QuakeConfig>
  return {
    enabled: !!c.enabled,
    hotkey: isValidAccelerator(c.hotkey) ? c.hotkey.trim() : DEFAULT_QUAKE.hotkey,
    position: c.position === 'bottom' ? 'bottom' : 'top',
    height: clamp(c.height, 20, 100, DEFAULT_QUAKE.height),
    width: clamp(c.width, 30, 100, DEFAULT_QUAKE.width),
    monitor: c.monitor === 'primary' ? 'primary' : 'cursor',
    hideOnBlur: c.hideOnBlur !== false,
    animate: c.animate !== false,
  }
}

export interface QuakeStatus {
  /** Whether the hotkey is currently held by us. */
  registered: boolean
  /** Set when registration failed — usually another app owns the combo. */
  error?: string
  active: boolean
}

// ─── State ───────────────────────────────────────────────────────────────────

let config: QuakeConfig = { ...DEFAULT_QUAKE }
let getWindow: () => BrowserWindow | null = () => null
let registeredHotkey: string | null = null
let lastError: string | undefined
/** Bounds the window had before it was pulled into the quake strip. */
let normalBounds: Electron.Rectangle | null = null
let active = false
let animTimer: ReturnType<typeof setInterval> | null = null
let blurHooked: BrowserWindow | null = null

/** Called once at startup with a getter for the window quake should drive. */
export function initQuakeMode(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
}

function status(): QuakeStatus {
  return { registered: registeredHotkey !== null, error: lastError, active }
}

// ─── Geometry ────────────────────────────────────────────────────────────────

function targetBounds(): Electron.Rectangle {
  const display = config.monitor === 'primary'
    ? screen.getPrimaryDisplay()
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const width = Math.max(400, Math.round(wa.width * (config.width / 100)))
  const height = Math.max(200, Math.round(wa.height * (config.height / 100)))
  const x = Math.round(wa.x + (wa.width - width) / 2)
  const y = config.position === 'bottom' ? wa.y + wa.height - height : wa.y
  return { x, y, width, height }
}

/** Off-screen start position for the slide-in, just past the edge it drops from. */
function offscreenY(b: Electron.Rectangle): number {
  const display = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + 1 })
  return config.position === 'bottom'
    ? display.bounds.y + display.bounds.height
    : display.bounds.y - b.height
}

function stopAnimation(): void {
  if (animTimer) { clearInterval(animTimer); animTimer = null }
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

function slideTo(win: BrowserWindow, from: number, to: number, b: Electron.Rectangle, onDone?: () => void): void {
  stopAnimation()
  const DURATION = 150
  const start = Date.now()
  animTimer = setInterval(() => {
    if (win.isDestroyed()) { stopAnimation(); return }
    const t = Math.min(1, (Date.now() - start) / DURATION)
    const y = Math.round(from + (to - from) * easeOut(t))
    try { win.setBounds({ ...b, y }) } catch { /* display changed mid-flight */ }
    if (t >= 1) { stopAnimation(); onDone?.() }
  }, 16)
}

// ─── Show / hide ─────────────────────────────────────────────────────────────

function hookBlur(win: BrowserWindow): void {
  if (blurHooked === win) return
  blurHooked = win
  win.on('blur', () => {
    // DevTools steal focus from the window without the user leaving the app.
    if (!active || !config.hideOnBlur) return
    if (win.isDestroyed() || win.webContents.isDevToolsFocused()) return
    hideQuake()
  })
}

export function showQuake(): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return

  const b = targetBounds()
  if (!active) {
    // Remember where the window lived so exitQuake() can put it back.
    if (!win.isMinimized() && win.isVisible()) normalBounds = win.getBounds()
    active = true
  }
  hookBlur(win)

  if (win.isMinimized()) win.restore()
  if (win.isFullScreen()) win.setFullScreen(false)
  win.setAlwaysOnTop(true, 'floating')
  // Follow the window onto other virtual desktops / spaces so the hotkey works
  // from wherever the user currently is.
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch { /* unsupported */ }

  if (config.animate) {
    win.setBounds({ ...b, y: offscreenY(b) })
    win.showInactive()
    slideTo(win, offscreenY(b), b.y, b, () => { if (!win.isDestroyed()) win.focus() })
  } else {
    stopAnimation()
    win.setBounds(b)
    win.show()
    win.focus()
  }
  win.webContents.send('quake:state', { ...status(), visible: true })
}

export function hideQuake(): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const finish = () => {
    if (win.isDestroyed()) return
    win.hide()
    // Put the bounds back so a later normal `show()` isn't stuck off-screen.
    try { win.setBounds(b) } catch { /* ignore */ }
    win.webContents.send('quake:state', { ...status(), visible: false })
  }
  if (config.animate) slideTo(win, b.y, offscreenY(b), b, finish)
  else { stopAnimation(); finish() }
}

export function toggleQuake(): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  const shown = win.isVisible() && !win.isMinimized()
  if (active && shown && win.isFocused()) hideQuake()
  else showQuake()
}

/** Leave drop-down mode: normal window chrome behaviour and original bounds. */
export function exitQuake(): void {
  const win = getWindow()
  stopAnimation()
  active = false
  if (!win || win.isDestroyed()) return
  win.setAlwaysOnTop(false)
  try { win.setVisibleOnAllWorkspaces(false) } catch { /* unsupported */ }
  if (normalBounds) { try { win.setBounds(normalBounds) } catch { /* ignore */ } }
  normalBounds = null
  if (!win.isVisible()) win.show()
  win.focus()
  win.webContents.send('quake:state', { ...status(), visible: true })
}

// ─── Registration ────────────────────────────────────────────────────────────

function unregister(): void {
  if (registeredHotkey) {
    try { globalShortcut.unregister(registeredHotkey) } catch { /* ignore */ }
    registeredHotkey = null
  }
}

/**
 * Apply a config from the renderer. Registering the hotkey can fail when
 * another application already owns the combination — that is reported back
 * rather than thrown, so Settings can show it inline.
 */
export function configureQuake(input: unknown): QuakeStatus {
  const next = sanitizeQuakeConfig(input)
  const hotkeyChanged = next.hotkey !== config.hotkey
  config = next
  lastError = undefined

  if (!config.enabled) {
    unregister()
    if (active) exitQuake()
    return status()
  }
  if (registeredHotkey && !hotkeyChanged) return status()

  unregister()
  if (!isValidAccelerator(config.hotkey)) {
    lastError = 'Invalid shortcut'
    return status()
  }
  try {
    const ok = globalShortcut.register(config.hotkey, toggleQuake)
    if (ok) registeredHotkey = config.hotkey
    else lastError = 'Shortcut already in use by another application'
  } catch (e: any) {
    lastError = e?.message || 'Could not register shortcut'
  }
  return status()
}

export function getQuakeStatus(): QuakeStatus {
  return status()
}

/** Release the global hotkey on shutdown. */
export function disposeQuakeMode(): void {
  stopAnimation()
  unregister()
}
