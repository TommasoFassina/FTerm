import { createCanvas, loadImage, Canvas, CanvasRenderingContext2D } from 'canvas'
import type { FrameSnapshot } from '../../src/services/TerminalRecorder'

export interface RenderOptions {
  width: number
  height: number
  fontSize: number
  fontFamily: string
  theme: {
    background: string
    foreground: string
    red: string
    green: string
    yellow: string
    blue: string
    cyan: string
    magenta: string
    white: string
    [key: string]: string
  }
  backgroundImage?: string
  backgroundBlur?: number
  backgroundOpacity?: number
}

// Simple ANSI SGR color mapping
const ANSI_COLORS: Record<number, string> = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow',
  34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'brightBlack', 91: 'brightRed', 92: 'brightGreen', 93: 'brightYellow',
  94: 'brightBlue', 95: 'brightMagenta', 96: 'brightCyan', 97: 'brightWhite',
}

// xterm 256-color palette
function xterm256Color(n: number): string {
  if (n < 16) {
    const named = ['#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0',
                   '#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff']
    return named[n]
  }
  if (n < 232) {
    const i = n - 16
    const b = i % 6; const g = Math.floor(i / 6) % 6; const r = Math.floor(i / 36)
    const v = (x: number) => x === 0 ? 0 : 55 + x * 40
    return `rgb(${v(r)},${v(g)},${v(b)})`
  }
  const gray = 8 + (n - 232) * 10
  return `rgb(${gray},${gray},${gray})`
}

// Software box blur on ImageData (3-pass approximation)
function boxBlur(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number): void {
  const data = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(data.data)
  const dst = data.data
  const r = Math.max(1, Math.round(radius / 3))
  for (let pass = 0; pass < 3; pass++) {
    const buf = pass === 0 ? src : new Uint8ClampedArray(dst)
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rr = 0, gg = 0, bb = 0, aa = 0, cnt = 0
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.min(w - 1, Math.max(0, x + dx))
          const i = (y * w + nx) * 4
          rr += buf[i]; gg += buf[i+1]; bb += buf[i+2]; aa += buf[i+3]; cnt++
        }
        const i = (y * w + x) * 4
        dst[i] = rr/cnt; dst[i+1] = gg/cnt; dst[i+2] = bb/cnt; dst[i+3] = aa/cnt
      }
    }
    const tmp = new Uint8ClampedArray(dst)
    // vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rr = 0, gg = 0, bb = 0, aa = 0, cnt = 0
        for (let dy = -r; dy <= r; dy++) {
          const ny = Math.min(h - 1, Math.max(0, y + dy))
          const i = (ny * w + x) * 4
          rr += tmp[i]; gg += tmp[i+1]; bb += tmp[i+2]; aa += tmp[i+3]; cnt++
        }
        const i = (y * w + x) * 4
        dst[i] = rr/cnt; dst[i+1] = gg/cnt; dst[i+2] = bb/cnt; dst[i+3] = aa/cnt
      }
    }
  }
  ctx.putImageData(data, 0, 0)
}

// Strip all non-printable / ANSI sequences that aren't SGR color codes
function stripNonSGR(line: string): string {
  // Remove all ESC sequences that are NOT ESC[...m (SGR)
  return line.replace(/\x1b\[([0-9;]*)([A-Za-z])/g, (match, _params, cmd) => {
    return cmd === 'm' ? match : ''
  }).replace(/\x1b[^[]/g, '')  // ESC + single char (e.g. ESC= ESC>)
}

export class FrameRenderer {
  private canvas: Canvas
  private bgCanvas: Canvas | null = null
  private ctx: CanvasRenderingContext2D
  private options: RenderOptions

  constructor(options: RenderOptions) {
    this.options = options
    this.canvas = createCanvas(options.width, options.height)
    this.ctx = this.canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  }

  async preload(): Promise<void> {
    const { backgroundImage, backgroundBlur = 10, width, height } = this.options
    if (!backgroundImage) return
    try {
      // Convert fterm:// protocol to a file path for node-canvas
      const imgPath = backgroundImage.startsWith('fterm://')
        ? backgroundImage.replace('fterm://', '')
        : backgroundImage
      const img = await loadImage(imgPath)
      this.bgCanvas = createCanvas(width, height)
      const bgCtx = this.bgCanvas.getContext('2d') as unknown as CanvasRenderingContext2D
      const scale = Math.max(width / img.width, height / img.height) * (backgroundBlur > 0 ? 1.1 : 1)
      const sw = img.width * scale
      const sh = img.height * scale
      bgCtx.drawImage(img as any, (width - sw) / 2, (height - sh) / 2, sw, sh)
      if (backgroundBlur > 0) {
        boxBlur(bgCtx, width, height, backgroundBlur)
      }
    } catch (e) {
      console.warn('[FrameRenderer] failed to load backgroundImage:', e)
    }
  }

  renderFrame(
    snapshot: FrameSnapshot,
    zoomRect?: { x: number; y: number; width: number; height: number },
    widgetImage?: any,
    widgetAlpha = 1.0
  ): Buffer {
    const { width, height, fontFamily, theme } = this.options
    const ctx = this.ctx
    const paddingX = 16
    const paddingY = 16

    // Background
    ctx.globalAlpha = 1.0
    ctx.globalCompositeOperation = 'source-over'
    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas as any, 0, 0)
    }
    // Theme color overlay (matches App.tsx Layer 2)
    const bgHex = (theme.background || '#0d1117').replace('#', '')
    const r = parseInt(bgHex.slice(0, 2), 16) || 13
    const g = parseInt(bgHex.slice(2, 4), 16) || 17
    const b = parseInt(bgHex.slice(4, 6), 16) || 23
    const opacity = this.bgCanvas ? (this.options.backgroundOpacity ?? 0.85) : 1.0
    ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`
    ctx.fillRect(0, 0, width, height)

    // Derive font size so content always fits horizontally.
    // Use cols from snapshot; fall back to a reasonable default.
    const cols = snapshot.cols || 80
    const rows = snapshot.rows || 24

    // Calculate charWidth to fit cols inside canvas (with padding on both sides)
    const availableWidth = width - paddingX * 2
    const charWidth = availableWidth / cols

    // Keep aspect ratio of monospace cell: typical cell is ~2:1 height:width
    const lineHeight = Math.min(charWidth * 2, (height - paddingY * 2) / rows)
    const fontSize = Math.round(lineHeight / 1.4)

    ctx.font = `${fontSize}px ${fontFamily}`

    // Measure actual advance width from the canvas and correct charWidth if needed
    // (node-canvas uses native font metrics; our calculation might differ slightly)
    const measuredCharWidth = ctx.measureText('M').width
    // Use measured if it's closer to the cols-derived value; otherwise keep derived
    // to avoid overflow. We always trust the cols-based charWidth for layout.
    const renderCharWidth = Math.min(charWidth, measuredCharWidth)

    if (zoomRect) {
      const targetX = paddingX + zoomRect.x * renderCharWidth
      const targetY = paddingY + zoomRect.y * lineHeight
      const scale = 1.8
      ctx.save()
      ctx.translate(width / 2 - targetX * scale, height / 2 - targetY * scale)
      ctx.scale(scale, scale)
    }

    const lines = snapshot.buffer.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const y = paddingY + i * lineHeight
      this.renderAnsiLine(ctx, lines[i], paddingX, y + fontSize, theme, renderCharWidth)
    }

    // Draw cursor (cursorY is relative to full buffer; subtract viewportTop to get viewport row)
    const cursorX = paddingX + snapshot.cursorX * renderCharWidth
    const cursorY = paddingY + (snapshot.cursorY - snapshot.viewportTop) * lineHeight
    ctx.fillStyle = theme.cursor || theme.foreground || '#58a6ff'
    ctx.globalAlpha = 0.7
    ctx.fillRect(cursorX, cursorY, renderCharWidth, lineHeight)
    ctx.globalAlpha = 1.0

    if (zoomRect) {
      ctx.restore()
    }

    // Ghost text (inline suggestion after cursor)
    if (snapshot.ghostSuffix) {
      const ghostX = paddingX + snapshot.cursorX * renderCharWidth
      const ghostY = paddingY + (snapshot.cursorY - snapshot.viewportTop) * lineHeight + fontSize
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.fillStyle = '#8b949e'
      ctx.globalAlpha = 0.55
      ctx.fillText(snapshot.ghostSuffix, ghostX, ghostY)
      ctx.globalAlpha = 1.0
    }

    // Pet overlay (bottom-right, matching fixed bottom-12 right-1.5rem)
    if (snapshot.petSprite && snapshot.petColor) {
      const petLines = snapshot.petSprite.split('\n')
      const maxLen = Math.max(...petLines.map(l => l.length))
      const petX = width - paddingX - maxLen * renderCharWidth
      const petBottom = height - 50
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.fillStyle = snapshot.petColor
      ctx.globalAlpha = 0.9
      for (let i = 0; i < petLines.length; i++) {
        const lineY = petBottom - (petLines.length - 1 - i) * lineHeight
        ctx.fillText(petLines[i], petX, lineY)
      }
      ctx.globalAlpha = 1.0

      // Pet name (above sprite, right-aligned, matching text-[#484f58])
      if (snapshot.petName) {
        const nameFontSize = Math.max(8, fontSize - 4)
        ctx.font = `${nameFontSize}px ${fontFamily}`
        ctx.fillStyle = '#6e7681'
        ctx.globalAlpha = 0.85
        const nameY = petBottom - petLines.length * lineHeight - 2
        const nameX = width - paddingX - ctx.measureText(snapshot.petName).width
        ctx.fillText(snapshot.petName, nameX, nameY)
        ctx.globalAlpha = 1.0
      }

      // Pet speech bubble (above sprite, right-aligned)
      if (snapshot.petBubble) {
        const bubbleFontSize = Math.max(10, fontSize - 2)
        ctx.font = `${bubbleFontSize}px ${fontFamily}`
        const padding = 6
        const maxBubbleWidth = 180
        // Wrap text
        const words = snapshot.petBubble.split(' ')
        const bubbleLines: string[] = []
        let line = ''
        for (const word of words) {
          const test = line ? `${line} ${word}` : word
          if (ctx.measureText(test).width > maxBubbleWidth - padding * 2) {
            if (line) bubbleLines.push(line)
            line = word
          } else {
            line = test
          }
        }
        if (line) bubbleLines.push(line)

        const bubbleLineH = bubbleFontSize * 1.4
        const bubbleW = Math.min(maxBubbleWidth, Math.max(...bubbleLines.map(l => ctx.measureText(l).width)) + padding * 2)
        const bubbleH = bubbleLines.length * bubbleLineH + padding * 2
        const bubbleX = petX + maxLen * renderCharWidth - bubbleW
        const bubbleY = petBottom - petLines.length * lineHeight - bubbleH - 4

        ctx.globalAlpha = 0.92
        ctx.fillStyle = '#161b22'
        ctx.beginPath()
        const r = 6
        ctx.moveTo(bubbleX + r, bubbleY)
        ctx.lineTo(bubbleX + bubbleW - r, bubbleY)
        ctx.arcTo(bubbleX + bubbleW, bubbleY, bubbleX + bubbleW, bubbleY + r, r)
        ctx.lineTo(bubbleX + bubbleW, bubbleY + bubbleH - r)
        ctx.arcTo(bubbleX + bubbleW, bubbleY + bubbleH, bubbleX + bubbleW - r, bubbleY + bubbleH, r)
        ctx.lineTo(bubbleX + r, bubbleY + bubbleH)
        ctx.arcTo(bubbleX, bubbleY + bubbleH, bubbleX, bubbleY + bubbleH - r, r)
        ctx.lineTo(bubbleX, bubbleY + r)
        ctx.arcTo(bubbleX, bubbleY, bubbleX + r, bubbleY, r)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#30363d'
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.fillStyle = '#c9d1d9'
        ctx.globalAlpha = 0.92
        for (let i = 0; i < bubbleLines.length; i++) {
          ctx.fillText(bubbleLines[i], bubbleX + padding, bubbleY + padding + (i + 1) * bubbleLineH - 2)
        }
        ctx.globalAlpha = 1.0
      }
    }

    if (widgetImage && snapshot.widgetRect) {
      const { xRatio, yRatio, wRatio, hRatio } = snapshot.widgetRect
      ctx.globalAlpha = widgetAlpha
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(
        widgetImage,
        Math.round(xRatio * width), Math.round(yRatio * height),
        Math.round(wRatio * width), Math.round(hRatio * height)
      )
      ctx.globalAlpha = 1.0
    }

    return this.canvas.toBuffer('image/png')
  }

  private renderAnsiLine(
    ctx: CanvasRenderingContext2D,
    line: string,
    startX: number,
    y: number,
    theme: RenderOptions['theme'],
    charWidth: number
  ) {
    const segments = parseAnsiLine(stripNonSGR(line), theme)
    let x = startX
    for (const seg of segments) {
      ctx.fillStyle = seg.color
      ctx.fillText(seg.text, x, y)
      x += seg.text.length * charWidth
    }
  }
}

interface TextSegment {
  text: string
  color: string
}

function parseAnsiLine(line: string, theme: RenderOptions['theme']): TextSegment[] {
  const segments: TextSegment[] = []
  let currentColor = theme.foreground || '#c9d1d9'
  const parts = line.split(/\x1b\[([0-9;]*)m/)

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) {
        segments.push({ text: parts[i], color: currentColor })
      }
    } else {
      const codes = parts[i].split(';').map(Number)
      let j = 0
      while (j < codes.length) {
        const code = codes[j]
        if (code === 0) {
          currentColor = theme.foreground || '#c9d1d9'
        } else if (ANSI_COLORS[code]) {
          currentColor = theme[ANSI_COLORS[code]] || currentColor
        } else if ((code === 38 || code === 48) && codes[j + 1] === 5) {
          // 256-color: 38;5;N
          if (j + 2 < codes.length) {
            if (code === 38) currentColor = xterm256Color(codes[j + 2])
            j += 2
          }
        } else if ((code === 38 || code === 48) && codes[j + 1] === 2) {
          // 24-bit: 38;2;R;G;B
          if (j + 4 < codes.length) {
            if (code === 38) currentColor = `rgb(${codes[j+2]},${codes[j+3]},${codes[j+4]})`
            j += 4
          }
        }
        j++
      }
    }
  }

  return segments
}
