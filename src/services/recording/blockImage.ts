/**
 * Renders one command block as an image.
 *
 * This is the thing people paste into issues and chats ten times a day, and
 * until now the only way to do it was a screenshot of the whole window. The
 * recorder's painter already knows how to draw ANSI text in a theme, so this
 * borrows it rather than growing a second renderer: same colours, same font
 * stack, same output as a frame of a recording.
 */

import { frameMetrics, paintFrame, stripNonSGR, type Ctx2D, type FramePalette } from './paintFrame'

export interface BlockImageInput {
  command: string
  output: string
  exitCode: number | null
  durationMs: number | null
  cwd: string
}

export interface BlockImageOptions {
  theme: FramePalette
  fontFamily: string
  /** Device pixel ratio to render at — 2 keeps text crisp on a retina paste. */
  scale?: number
  /** Rows beyond this are dropped and a "… N more lines" note takes their place. */
  maxLines?: number
  /** Prompt shown above the command. */
  prompt?: string
}

const PAD = 22
const HEADER = 34
const FOOTER = 26

const durationText = (ms: number | null) =>
  ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`

/**
 * Lays the block out as a synthetic terminal frame and hands it to the shared
 * painter. Returns the canvas so the caller decides between clipboard and file.
 */
export function renderBlockImage(
  block: BlockImageInput,
  options: BlockImageOptions,
  makeCanvas: (w: number, h: number) => { canvas: HTMLCanvasElement; ctx: Ctx2D },
): HTMLCanvasElement {
  const { theme, fontFamily, scale = 2, maxLines = 40, prompt = '>' } = options

  const rawLines = block.output.split('\n')
  const truncated = Math.max(0, rawLines.length - maxLines)
  const bodyLines = truncated ? rawLines.slice(0, maxLines) : rawLines

  const commandLine = `\x1b[38;2;88;166;255m${prompt}\x1b[39m ${block.command}`
  const lines = [commandLine, ...bodyLines]
  if (truncated) lines.push(`\x1b[38;2;110;118;129m… ${truncated} more lines\x1b[39m`)

  // Width from the longest printable row, so the image is never mostly padding
  const cols = Math.max(
    28,
    Math.min(120, ...[Math.max(...lines.map(l => stripNonSGR(l).length)) + 2, 120]),
  )
  const rows = lines.length

  // Borrow the painter's own cell maths so the text lands where it expects
  const probe = { buffer: '', cursorX: 0, cursorY: 0, viewportTop: 0, cols, rows }
  const cell = frameMetrics(probe, cols * 9 + PAD * 2, rows * 20 + PAD * 2)
  const width = Math.round(cols * cell.charWidth + PAD * 2)
  const height = Math.round(rows * cell.lineHeight + PAD * 2 + HEADER + FOOTER)

  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale))
  ctx.save()
  ctx.scale(scale, scale)

  // Card background
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)

  // The body, drawn by the recorder's painter with the cursor parked off-screen
  ctx.save()
  ctx.translate(0, HEADER)
  paintFrame(ctx, {
    buffer: lines.join('\n'),
    cursorX: 0,
    cursorY: -5,          // off the top: a still frame has no live cursor
    viewportTop: 0,
    cols,
    rows,
  }, {
    width,
    height: height - HEADER - FOOTER,
    fontFamily,
    theme,
  })
  ctx.restore()

  // Header: three dots and the working directory
  const dot = (x: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x, HEADER / 2)
    ctx.arcTo(x + 5, HEADER / 2 - 5, x + 10, HEADER / 2, 5)
    ctx.arcTo(x + 5, HEADER / 2 + 5, x, HEADER / 2, 5)
    ctx.closePath()
    ctx.fill()
  }
  dot(PAD, '#ff5f57'); dot(PAD + 18, '#febc2e'); dot(PAD + 36, '#28c840')

  ctx.font = `12px ${fontFamily}`
  ctx.fillStyle = theme.brightBlack ?? '#6e7681'
  const cwdText = block.cwd.length > 60 ? '…' + block.cwd.slice(-59) : block.cwd
  ctx.fillText(cwdText, PAD + 62, HEADER / 2 + 4)

  // Footer: exit code and duration, the two things a screenshot never carries
  ctx.font = `12px ${fontFamily}`
  const ok = block.exitCode === 0 || block.exitCode === null
  ctx.fillStyle = ok ? (theme.green ?? '#3fb950') : (theme.red ?? '#f85149')
  const status = block.exitCode === null
    ? 'done'
    : block.exitCode === 0 ? 'exit 0' : `exit ${block.exitCode}`
  ctx.fillText(status, PAD, height - FOOTER / 2 + 2)

  const dur = durationText(block.durationMs)
  if (dur) {
    ctx.fillStyle = theme.brightBlack ?? '#6e7681'
    ctx.fillText(dur, PAD + ctx.measureText(status).width + 14, height - FOOTER / 2 + 2)
  }

  ctx.fillStyle = theme.brightBlack ?? '#6e7681'
  const mark = 'FTerm'
  ctx.fillText(mark, width - PAD - ctx.measureText(mark).width, height - FOOTER / 2 + 2)

  ctx.restore()
  return canvas
}

/** Filename for a saved block image, derived from the command itself. */
export function blockImageName(command: string): string {
  const slug = command
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toLowerCase()
  return `fterm-${slug || 'command'}.png`
}
