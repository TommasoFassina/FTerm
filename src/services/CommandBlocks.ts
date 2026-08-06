/**
 * Command block tracking — one tracker per terminal pane.
 *
 * A block is everything between two prompts: the command line the user typed,
 * the rows of output it produced, its exit code and how long it took. Blocks
 * are anchored to xterm `IMarker`s, so they follow the buffer as it scrolls and
 * report `-1` once trimmed out of scrollback.
 *
 * Lifecycle, driven by three signals:
 *   OSC 133;A  → a prompt was drawn: close the open block, open a pending one
 *   Enter      → the pending block's command text is known; output starts next row
 *   OSC 133;D  → the exit code for the block that just finished
 *
 * Blocks live here rather than in the zustand store: they are per-pane, high
 * churn, and must never be persisted to localStorage.
 */
import type { Terminal, IMarker, IDecoration } from '@xterm/xterm'

export interface CommandBlock {
  id: string
  /** Command line as typed, or '' while still being entered. */
  command: string
  /** Buffer row of the prompt this block starts at; -1 once scrolled out. */
  promptLine: number
  /** First row of output (prompt row + 1), or -1 before the command is run. */
  outputStart: number
  /** Last row of output; -1 while the command is still running. */
  outputEnd: number
  /** null while running or when the shell reported nothing. */
  exitCode: number | null
  /** Epoch ms when Enter was pressed; null while the command is being typed. */
  startedAt: number | null
  /** Wall-clock duration in ms, once finished. */
  durationMs: number | null
  cwd: string
  running: boolean
}

const MAX_BLOCKS = 200

// Gutter rail colours — same vocabulary as the rest of the UI.
const RUNNING_COLOR = '#58a6ff'
const OK_COLOR = '#3fb950'
const FAILED_COLOR = '#f85149'
// The rail is a thin bar pushed into the terminal's left padding (default 8px)
// so it never covers the first character of the prompt.
const RAIL_WIDTH_PX = 3
const RAIL_OFFSET_PX = 6

type Listener = () => void

export class CommandBlockTracker {
  private blocks: CommandBlock[] = []
  private markers = new Map<string, IMarker>()
  private decorations = new Map<string, IDecoration>()
  private pending: CommandBlock | null = null
  private listeners = new Set<Listener>()
  private seq = 0
  private lastExitCode: number | null = null

  constructor(private term: Terminal, private paneId: string) { }

  // ─── Subscription ──────────────────────────────────────────────────────────

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** Newest last. Rows are refreshed from the live markers on every read. */
  getBlocks(): CommandBlock[] {
    return this.blocks.map(b => ({ ...b, promptLine: this.lineOf(b.id, b.promptLine) }))
  }

  private lineOf(id: string, fallback: number): number {
    const marker = this.markers.get(id)
    if (!marker) return fallback
    // xterm reports -1 once a marker's row has been trimmed from scrollback.
    return marker.isDisposed ? -1 : marker.line
  }

  // ─── Signals ───────────────────────────────────────────────────────────────

  /** OSC 133;D — the exit code of the command that just finished. */
  onCommandFinished(exitCode: number | null): void {
    this.lastExitCode = exitCode
  }

  /**
   * OSC 133;A — a prompt was drawn on the current row. Closes the block that
   * was running (if any) and opens a pending one for what the user types next.
   */
  onPrompt(cwd: string): void {
    const buffer = this.term.buffer.active
    const row = buffer.baseY + buffer.cursorY

    const open = this.blocks[this.blocks.length - 1]
    if (open?.running) {
      open.running = false
      open.outputEnd = Math.max(open.outputStart, row - 1)
      open.exitCode = this.lastExitCode
      open.durationMs = open.startedAt ? Date.now() - open.startedAt : null
      this.recolor(open.id, open.exitCode ? FAILED_COLOR : OK_COLOR)
    }
    this.lastExitCode = null

    // A prompt redraw with nothing typed (resize, Ctrl+C) replaces the pending
    // block rather than stacking up empty ones.
    this.pending = {
      id: `${this.paneId}-b${++this.seq}`,
      command: '',
      promptLine: row,
      outputStart: -1,
      outputEnd: -1,
      exitCode: null,
      startedAt: null,
      durationMs: null,
      cwd,
      running: false,
    }
    this.emit()
  }

  /**
   * The user submitted `command`. Promotes the pending block into a running one
   * anchored at the prompt row.
   */
  onCommandStart(command: string, cwd: string): void {
    const trimmed = command.trim()
    if (!trimmed) return
    const buffer = this.term.buffer.active
    const row = buffer.baseY + buffer.cursorY

    const block: CommandBlock = this.pending
      ? { ...this.pending, command: trimmed, cwd: cwd || this.pending.cwd }
      : {
        id: `${this.paneId}-b${++this.seq}`,
        command: trimmed,
        promptLine: row,
        outputStart: -1, outputEnd: -1, exitCode: null,
        startedAt: null, durationMs: null, cwd, running: false,
      }
    this.pending = null

    block.startedAt = Date.now()
    block.running = true
    block.outputStart = row + 1
    block.outputEnd = -1

    const marker = this.term.registerMarker(block.promptLine - row)
    if (marker) {
      this.markers.set(block.id, marker)
      block.promptLine = marker.line
      this.decorate(block.id, marker, RUNNING_COLOR)
    }

    this.blocks.push(block)
    this.trim()
    this.emit()
  }

  // ─── Gutter decorations ────────────────────────────────────────────────────

  /**
   * Draw the status rail in the left margin of the prompt row.
   *
   * A decoration anchored at `x: 0` occupies the whole first cell, which paints
   * over the first character of the prompt (`C:\…` became unreadable). The
   * element is therefore narrowed to a few pixels and pulled left into the
   * terminal's padding, so it sits beside the text instead of on top of it.
   * Colour is applied in `onRender` rather than via `backgroundColor` so it can
   * change when the command ends without rebuilding the decoration.
   */
  private decorate(id: string, marker: IMarker, color: string): void {
    const decoration = this.term.registerDecoration({ marker, x: 0, width: 1 })
    if (!decoration) return
    this.decorations.set(id, decoration)
    decoration.onRender(el => {
      el.style.background = this.colors.get(id) ?? color
      el.style.width = `${RAIL_WIDTH_PX}px`
      el.style.marginLeft = `-${RAIL_OFFSET_PX}px`
      el.style.borderRadius = '1px'
      el.style.opacity = '0.85'
      el.style.pointerEvents = 'none'
    })
    this.colors.set(id, color)
  }

  private colors = new Map<string, string>()

  private recolor(id: string, color: string): void {
    this.colors.set(id, color)
    // Force a repaint so the rail flips colour the moment the command ends.
    const el = (this.decorations.get(id) as any)?.element as HTMLElement | undefined
    if (el) el.style.background = color
  }

  /** A clear/reset wiped the viewport — the recorded rows no longer mean anything. */
  reset(): void {
    for (const d of this.decorations.values()) { try { d.dispose() } catch { /* already gone */ } }
    this.decorations.clear()
    this.colors.clear()
    for (const m of this.markers.values()) { try { m.dispose() } catch { /* already gone */ } }
    this.markers.clear()
    this.blocks = []
    this.pending = null
    this.lastExitCode = null
    this.emit()
  }

  dispose(): void {
    this.reset()
    this.listeners.clear()
  }

  private trim(): void {
    if (this.blocks.length <= MAX_BLOCKS) return
    for (const gone of this.blocks.splice(0, this.blocks.length - MAX_BLOCKS)) {
      this.decorations.get(gone.id)?.dispose()
      this.decorations.delete(gone.id)
      this.colors.delete(gone.id)
      this.markers.get(gone.id)?.dispose()
      this.markers.delete(gone.id)
    }
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** The block whose output is still being produced, if any. */
  getRunning(): CommandBlock | null {
    const last = this.blocks[this.blocks.length - 1]
    return last?.running ? last : null
  }

  /**
   * Output rows of a block as text. The prompt row itself is excluded, so this
   * is what the command printed and nothing else.
   */
  getOutput(id: string): string {
    const block = this.blocks.find(b => b.id === id)
    if (!block) return ''
    const line = this.lineOf(id, block.promptLine)
    if (line < 0) return ''

    const buffer = this.term.buffer.active
    const start = line + 1
    const end = block.running
      ? buffer.baseY + buffer.cursorY - 1     // still producing: read up to the cursor
      : block.outputEnd
    if (end < start) return ''

    const lines: string[] = []
    for (let i = start; i <= Math.min(end, buffer.length - 1); i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    }
    // Trailing blank rows are an artifact of where the next prompt landed.
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    return lines.join('\n')
  }

  /**
   * Scroll a block's prompt row to the top of the viewport. Returns false when
   * the block has been trimmed out of scrollback.
   */
  revealBlock(id: string): boolean {
    const block = this.blocks.find(b => b.id === id)
    if (!block) return false
    const line = this.lineOf(id, block.promptLine)
    if (line < 0) return false
    this.term.scrollToLine(Math.max(0, line))
    return true
  }

  /**
   * Block adjacent to the viewport top, for prompt-to-prompt navigation.
   * `direction` is -1 for the previous prompt, +1 for the next.
   */
  findAdjacent(direction: -1 | 1): CommandBlock | null {
    const viewportTop = this.term.buffer.active.viewportY
    const withLines = this.getBlocks()
      .map(b => ({ block: b, line: b.promptLine }))
      .filter(x => x.line >= 0)
    if (!withLines.length) return null

    if (direction < 0) {
      const before = withLines.filter(x => x.line < viewportTop)
      return before.length ? before[before.length - 1].block : null
    }
    const after = withLines.find(x => x.line > viewportTop)
    return after ? after.block : null
  }
}

// ─── Per-pane registry ───────────────────────────────────────────────────────

const trackers = new Map<string, CommandBlockTracker>()

export function registerTracker(instanceId: string, tracker: CommandBlockTracker): void {
  trackers.get(instanceId)?.dispose()
  trackers.set(instanceId, tracker)
}

export function getTracker(instanceId: string): CommandBlockTracker | undefined {
  return trackers.get(instanceId)
}

export function disposeTracker(instanceId: string): void {
  trackers.get(instanceId)?.dispose()
  trackers.delete(instanceId)
}
