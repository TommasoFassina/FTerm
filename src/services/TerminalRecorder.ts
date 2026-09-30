import { Terminal } from '@xterm/xterm'
import { useStore } from '@/store'
import { SPRITES, STATE_HEX_COLORS } from '@/components/Pet/PetData'
import { getCosmetic } from '@/utils/petAchievements'

export interface FrameSnapshot {
  timestamp: number
  buffer: string
  cursorX: number
  cursorY: number
  viewportTop: number
  lines: number
  cols: number
  rows: number
  /**
   * Index into the take's `widgetFrames` array, or undefined for no widget.
   * Captures used to be inlined as a base64 PNG on every snapshot; at ten
   * snapshots a second that made the take's JSON enormous for no gain.
   */
  widgetFrame?: number
  widgetRect?: { xRatio: number; yRatio: number; wRatio: number; hRatio: number }
  petSprite?: string
  petColor?: string
  petName?: string
  petBubble?: string
  ghostSuffix?: string
}

export interface CommandEvent {
  type: 'command_start' | 'command_end' | 'output_line'
  timestamp: number
  command?: string
  outputLine?: string
  isError?: boolean
}

/** Everything the studio and the exporter need to reproduce a recording. */
export interface RecordingTake {
  snapshots: FrameSnapshot[]
  events: CommandEvent[]
  /** Deduplicated widget captures as data URLs, addressed by `widgetFrame`. */
  widgetFrames: string[]
  /** Wall-clock length in ms, excluding time spent paused. */
  duration: number
  /** True when the recorder stopped itself at the safety ceiling. */
  truncated: boolean
  /** The pane's own theme when its profile pins one; absent = the app theme. */
  themeId?: string
}

/** Snapshots are 10/s; 20 minutes of them is already a very long asciinema. */
const MAX_DURATION_MS = 20 * 60 * 1000
/** Widget PNGs are the expensive part of a take — cap what we retain. */
const MAX_WIDGET_FRAMES = 1800

export class TerminalRecorder {
  private isRecording = false
  private paused = false
  /** Wall clock when the current running stretch began. */
  private segmentStart = 0
  /** Recorded ms accumulated before the current stretch. */
  private elapsedBeforeSegment = 0
  private snapshots: FrameSnapshot[] = []
  private events: CommandEvent[] = []
  private widgetFrames: string[] = []
  private truncated = false
  private terminal: Terminal
  private currentCommand = ''
  private commandInProgress = false
  private captureIntervalId: ReturnType<typeof setInterval> | null = null
  private widgetCaptureIntervalId: ReturnType<typeof setInterval> | null = null
  private dataDisposable: { dispose: () => void } | null = null
  private writeDisposable: { dispose: () => void } | null = null
  private widgetEl: HTMLElement | null = null
  private containerEl: HTMLElement | null = null
  private latestWidgetFrame: number | undefined = undefined
  private latestWidgetRect: FrameSnapshot['widgetRect'] = undefined
  /** Last pushed frame's identity, so an idle terminal stops duplicating rows. */
  private lastFingerprint = ''
  private lastPushedAt = -1
  /** Fired when the safety ceiling stops the recording on its own. */
  onAutoStop?: () => void

  constructor(terminal: Terminal, widgetEl?: HTMLElement | null, containerEl?: HTMLElement | null) {
    this.terminal = terminal
    this.widgetEl = widgetEl ?? null
    this.containerEl = containerEl ?? null
  }

  /** Recorded ms so far, with paused stretches excluded. */
  now(): number {
    if (!this.isRecording || this.paused) return this.elapsedBeforeSegment
    return this.elapsedBeforeSegment + (Date.now() - this.segmentStart)
  }

  start() {
    this.isRecording = true
    this.paused = false
    this.segmentStart = Date.now()
    this.elapsedBeforeSegment = 0
    this.snapshots = []
    this.events = []
    this.widgetFrames = []
    this.truncated = false
    this.currentCommand = ''
    this.commandInProgress = false
    this.lastFingerprint = ''
    this.lastPushedAt = -1
    this.latestWidgetFrame = undefined
    this.latestWidgetRect = undefined

    this.captureIntervalId = setInterval(() => this.captureSnapshot(), 100)
    this.dataDisposable = this.terminal.onData(this.handleData)
    this.writeDisposable = (this.terminal as any).onWriteParsed?.(this.handleWrite) ?? null

    if (this.widgetEl && this.containerEl) this.startWidgetCapture()
  }

  /** Freezes the timeline. Nothing is captured and no time accrues. */
  pause() {
    if (!this.isRecording || this.paused) return
    this.elapsedBeforeSegment += Date.now() - this.segmentStart
    this.paused = true
  }

  resume() {
    if (!this.isRecording || !this.paused) return
    this.segmentStart = Date.now()
    this.paused = false
  }

  isPaused(): boolean { return this.paused }

  private startWidgetCapture() {
    if (this.widgetCaptureIntervalId) return
    this.widgetCaptureIntervalId = setInterval(() => this.captureWidgetFrame(), 200)
  }

  setWidgetElement(widgetEl: HTMLElement | null, containerEl: HTMLElement | null) {
    this.widgetEl = widgetEl
    this.containerEl = containerEl
    if (this.isRecording && widgetEl && containerEl) {
      this.startWidgetCapture()
    } else if (!widgetEl && this.widgetCaptureIntervalId) {
      clearInterval(this.widgetCaptureIntervalId)
      this.widgetCaptureIntervalId = null
      this.latestWidgetFrame = undefined
      this.latestWidgetRect = undefined
    }
  }

  private async captureWidgetFrame() {
    if (!this.isRecording || this.paused || !this.widgetEl || !this.containerEl) return
    if (this.widgetFrames.length >= MAX_WIDGET_FRAMES) return
    const cRect = this.containerEl.getBoundingClientRect()
    if (cRect.width === 0 || cRect.height === 0) return
    try {
      const dataUrl = await window.fterm.captureRect({
        x: Math.round(cRect.left), y: Math.round(cRect.top),
        width: Math.round(cRect.width), height: Math.round(cRect.height),
      })
      // The widget may have closed while the IPC round-trip was in flight
      if (!this.widgetEl || !this.isRecording) return
      // An unchanged panel (a paused visualiser, an idle table) reuses its frame
      const prev = this.latestWidgetFrame
      if (prev !== undefined && this.widgetFrames[prev] === dataUrl) return
      this.widgetFrames.push(dataUrl)
      this.latestWidgetFrame = this.widgetFrames.length - 1
      this.latestWidgetRect = { xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 }
    } catch { /* capture failed for this tick — keep the previous frame */ }
  }

  private handleData = (data: string) => {
    if (!this.isRecording || this.paused) return
    if (data === '\r') {
      this.commandInProgress = false
      this.events.push({ type: 'command_end', timestamp: this.now(), command: this.currentCommand })
      this.currentCommand = ''
    } else if (data === '\x7f') {
      this.currentCommand = this.currentCommand.slice(0, -1)
    } else if (data === '\x03') {
      this.currentCommand = ''
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.currentCommand += data
    }
  }

  private handleWrite = (data: string) => {
    if (!this.isRecording || this.paused || !data) return
    if (!this.commandInProgress && data.trim().length > 0) {
      this.commandInProgress = true
      this.events.push({ type: 'command_start', timestamp: this.now() })
    }
    for (const line of data.split('\n')) {
      if (!line.trim()) continue
      this.events.push({
        type: 'output_line',
        timestamp: this.now(),
        outputLine: line,
        isError: this.isErrorLine(line),
      })
    }
  }

  private isErrorLine(line: string): boolean {
    const errorKeywords = ['error', 'failed', 'cannot', 'not found', 'fatal', 'exception']
    return errorKeywords.some(kw => line.toLowerCase().includes(kw))
  }

  private serializeLineWithColors(lineIndex: number): string {
    const buffer = this.terminal.buffer.active
    const line = buffer.getLine(lineIndex)
    if (!line) return ''
    const cols = this.terminal.cols
    const cell = buffer.getNullCell()
    let result = ''
    let lastFgCode = ''
    for (let x = 0; x < cols; x++) {
      line.getCell(x, cell)
      const ch = cell.getChars() || ' '
      let fgCode = ''
      if (cell.isFgRGB()) {
        const c = cell.getFgColor()
        fgCode = `\x1b[38;2;${(c >> 16) & 0xff};${(c >> 8) & 0xff};${c & 0xff}m`
      } else if (cell.isFgPalette()) {
        fgCode = `\x1b[38;5;${cell.getFgColor()}m`
      } else {
        fgCode = '\x1b[39m'
      }
      if (fgCode !== lastFgCode) { result += fgCode; lastFgCode = fgCode }
      result += ch
    }
    return result.trimEnd() + '\x1b[0m'
  }

  private captureSnapshot() {
    if (!this.isRecording || this.paused) return
    const t = this.now()

    if (t >= MAX_DURATION_MS) {
      this.truncated = true
      this.pause()
      this.onAutoStop?.()
      return
    }

    const buffer = this.terminal.buffer.active
    const rows = this.terminal.rows
    const viewportY = buffer.viewportY
    const lines: string[] = []
    for (let i = viewportY; i < viewportY + rows; i++) {
      lines.push(this.serializeLineWithColors(i))
    }

    // Pet overlay
    let petSprite: string | undefined
    let petColor: string | undefined
    let petName: string | undefined
    try {
      const { pet, petState } = useStore.getState()
      if (pet.visible) {
        const stateSprites = SPRITES[pet.type]?.[petState] ?? SPRITES[pet.type]?.['idle']
        if (stateSprites) {
          const frameIdx = Math.floor(Date.now() / (petState === 'sleeping' ? 2000 : 1200)) % stateSprites.length
          petSprite = stateSprites[frameIdx]
          petColor = STATE_HEX_COLORS[petState] ?? '#58a6ff'
          petName = pet.name || undefined
          // Equipped cosmetic rides along as an extra first line, space-padded
          // to centre it over the sprite. The painter draws every pet line from
          // the same left edge, so padding is all the alignment it needs — and
          // the name/bubble shift up on their own, being placed off the count.
          const cosmetic = getCosmetic(pet.equippedCosmetic)
          if (cosmetic) {
            const spriteWidth = Math.max(...petSprite.split('\n').map(l => l.length))
            const pad = Math.max(0, Math.round((spriteWidth - cosmetic.glyph.length) / 2))
            petSprite = ' '.repeat(pad) + cosmetic.glyph + '\n' + petSprite
          }
        }
      }
    } catch { /* pet is decoration; never let it break a capture */ }

    let ghostSuffix: string | undefined
    try {
      const ghostEl = document.getElementById('fterm-ghost-text')
      if (ghostEl && ghostEl.style.display !== 'none' && ghostEl.textContent) {
        ghostSuffix = ghostEl.textContent
      }
    } catch { /* ignore */ }

    let petBubble: string | undefined
    try {
      const bubbleEl = document.getElementById('fterm-pet-bubble')
      if (bubbleEl && bubbleEl.textContent) petBubble = bubbleEl.textContent.trim() || undefined
    } catch { /* ignore */ }

    const bufferText = lines.join('\n')

    /* An idle terminal used to push ten identical frames a second for as long
       as you left it running. Identical frames are dropped; one is forced every
       second so the timeline still advances and scrubbing stays smooth. */
    const fingerprint = [
      bufferText, buffer.cursorX, buffer.cursorY, viewportY,
      this.latestWidgetFrame ?? -1, petSprite ?? '', petColor ?? '',
      petBubble ?? '', ghostSuffix ?? '',
    ].join('\u0000')
    if (fingerprint === this.lastFingerprint && t - this.lastPushedAt < 1000) return
    this.lastFingerprint = fingerprint
    this.lastPushedAt = t

    this.snapshots.push({
      timestamp: t,
      buffer: bufferText,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      viewportTop: viewportY,
      lines: rows,
      cols: this.terminal.cols,
      rows,
      widgetFrame: this.latestWidgetFrame,
      widgetRect: this.latestWidgetRect,
      petSprite,
      petColor,
      petName,
      petBubble,
      ghostSuffix,
    })
  }

  stop(): RecordingTake {
    const duration = this.now()
    this.isRecording = false
    this.paused = false
    if (this.captureIntervalId !== null) {
      clearInterval(this.captureIntervalId)
      this.captureIntervalId = null
    }
    if (this.widgetCaptureIntervalId !== null) {
      clearInterval(this.widgetCaptureIntervalId)
      this.widgetCaptureIntervalId = null
    }
    this.dataDisposable?.dispose()
    this.writeDisposable?.dispose()
    return {
      snapshots: this.snapshots,
      events: this.events,
      widgetFrames: this.widgetFrames,
      // A take whose last snapshot predates the stop still lasted until now
      duration: Math.max(duration, this.snapshots[this.snapshots.length - 1]?.timestamp ?? 0),
      truncated: this.truncated,
    }
  }

  getIsRecording(): boolean {
    return this.isRecording
  }

  /** Rough byte cost of what is being held, for the UI to warn on. */
  approxBytes(): number {
    let n = 0
    for (const s of this.snapshots) n += s.buffer.length * 2 + 160
    for (const w of this.widgetFrames) n += w.length
    return n
  }
}

export const RECORDER_LIMITS = { MAX_DURATION_MS, MAX_WIDGET_FRAMES }
