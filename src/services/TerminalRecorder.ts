import { Terminal } from '@xterm/xterm'
import { useStore } from '@/store'
import { SPRITES, STATE_HEX_COLORS } from '@/components/Pet/PetData'

export interface FrameSnapshot {
  timestamp: number
  buffer: string
  cursorX: number
  cursorY: number
  viewportTop: number
  lines: number
  cols: number
  rows: number
  widgetCapture?: string
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

export class TerminalRecorder {
  private isRecording = false
  private startTime = 0
  private snapshots: FrameSnapshot[] = []
  private events: CommandEvent[] = []
  private terminal: Terminal
  private currentCommand = ''
  private commandInProgress = false
  private captureIntervalId: ReturnType<typeof setInterval> | null = null
  private widgetCaptureIntervalId: ReturnType<typeof setInterval> | null = null
  private dataDisposable: { dispose: () => void } | null = null
  private writeDisposable: { dispose: () => void } | null = null
  private widgetEl: HTMLElement | null = null
  private containerEl: HTMLElement | null = null
  private latestWidgetCapture: string | undefined = undefined
  private latestWidgetRect: FrameSnapshot['widgetRect'] = undefined

  constructor(terminal: Terminal, widgetEl?: HTMLElement | null, containerEl?: HTMLElement | null) {
    this.terminal = terminal
    this.widgetEl = widgetEl ?? null
    this.containerEl = containerEl ?? null
  }

  start() {
    this.isRecording = true
    this.startTime = Date.now()
    this.snapshots = []
    this.events = []
    this.currentCommand = ''
    this.commandInProgress = false

    this.captureIntervalId = setInterval(() => this.captureSnapshot(), 100)
    this.dataDisposable = this.terminal.onData(this.handleData)
    this.writeDisposable = (this.terminal as any).onWriteParsed?.(this.handleWrite) ?? null

    if (this.widgetEl && this.containerEl) {
      this.widgetCaptureIntervalId = setInterval(() => this.captureWidgetFrame(), 200)
    }
  }

  setWidgetElement(widgetEl: HTMLElement | null, containerEl: HTMLElement | null) {
    this.widgetEl = widgetEl
    this.containerEl = containerEl
    if (this.isRecording && widgetEl && containerEl && !this.widgetCaptureIntervalId) {
      this.widgetCaptureIntervalId = setInterval(() => this.captureWidgetFrame(), 200)
    } else if (!widgetEl && this.widgetCaptureIntervalId) {
      clearInterval(this.widgetCaptureIntervalId)
      this.widgetCaptureIntervalId = null
      this.latestWidgetCapture = undefined
      this.latestWidgetRect = undefined
    }
  }

  private async captureWidgetFrame() {
    if (!this.isRecording || !this.widgetEl || !this.containerEl) return
    const cRect = this.containerEl.getBoundingClientRect()
    if (cRect.width === 0 || cRect.height === 0) return
    try {
      const dataUrl = await window.fterm.captureRect({
        x: Math.round(cRect.left), y: Math.round(cRect.top),
        width: Math.round(cRect.width), height: Math.round(cRect.height),
      })
      // Widget may have closed during the async IPC call
      if (!this.widgetEl) return
      this.latestWidgetCapture = dataUrl
      this.latestWidgetRect = { xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 }
    } catch {}
  }

  private handleData = (data: string) => {
    if (!this.isRecording) return
    if (data === '\r') {
      this.commandInProgress = false
      this.events.push({
        type: 'command_end',
        timestamp: Date.now() - this.startTime,
        command: this.currentCommand,
      })
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
    if (!this.isRecording || !data) return
    if (!this.commandInProgress && data.trim().length > 0) {
      this.commandInProgress = true
      this.events.push({
        type: 'command_start',
        timestamp: Date.now() - this.startTime,
      })
    }
    const lines = data.split('\n')
    lines.forEach(line => {
      if (line.trim()) {
        this.events.push({
          type: 'output_line',
          timestamp: Date.now() - this.startTime,
          outputLine: line,
          isError: this.isErrorLine(line),
        })
      }
    })
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
    if (!this.isRecording) return
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
      const store = useStore.getState()
      const { pet, petState } = store
      if (pet.visible) {
        const stateSprites = SPRITES[pet.type]?.[petState] ?? SPRITES[pet.type]?.['idle']
        if (stateSprites) {
          const frameIdx = Math.floor(Date.now() / (petState === 'sleeping' ? 2000 : 1200)) % stateSprites.length
          petSprite = stateSprites[frameIdx]
          petColor = STATE_HEX_COLORS[petState] ?? '#58a6ff'
          petName = pet.name || undefined
        }
      }
    } catch {}

    // Ghost text overlay
    let ghostSuffix: string | undefined
    try {
      const ghostEl = document.getElementById('fterm-ghost-text')
      if (ghostEl && ghostEl.style.display !== 'none' && ghostEl.textContent) {
        ghostSuffix = ghostEl.textContent
      }
    } catch {}

    // Pet speech bubble
    let petBubble: string | undefined
    try {
      const bubbleEl = document.getElementById('fterm-pet-bubble')
      if (bubbleEl && bubbleEl.textContent) {
        petBubble = bubbleEl.textContent.trim() || undefined
      }
    } catch {}

    this.snapshots.push({
      timestamp: Date.now() - this.startTime,
      buffer: lines.join('\n'),
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      viewportTop: viewportY,
      lines: rows,
      cols: this.terminal.cols,
      rows,
      widgetCapture: this.latestWidgetCapture,
      widgetRect: this.latestWidgetRect,
      petSprite,
      petColor,
      petName,
      petBubble,
      ghostSuffix,
    })
  }

  stop(): { snapshots: FrameSnapshot[]; events: CommandEvent[] } {
    this.isRecording = false
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
    return { snapshots: this.snapshots, events: this.events }
  }

  getIsRecording(): boolean {
    return this.isRecording
  }
}
