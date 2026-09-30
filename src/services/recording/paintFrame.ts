/**
 * One painter, two canvases.
 *
 * The export runs in the main process on node-canvas; the studio preview runs
 * in the renderer on a real `<canvas>`. Both call this module, so what you
 * scrub through in the studio is drawn by the same code that encodes the file —
 * there is no second implementation to drift.
 *
 * Everything here is environment-free: no `canvas` import, no DOM. Callers hand
 * in a 2D context and, if they want one, an already-decoded background image.
 */

export interface FramePalette {
  background: string
  foreground: string
  cursor?: string
  red: string
  green: string
  yellow: string
  blue: string
  cyan: string
  magenta: string
  white: string
  [key: string]: string | undefined
}

/** The slice of the 2D context this painter uses — satisfied by both canvases. */
export interface Ctx2D {
  canvas?: unknown
  font: string
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  globalAlpha: number
  globalCompositeOperation: string
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  fill(): void
  stroke(): void
  drawImage(img: any, ...args: number[]): void
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
  putImageData(data: any, x: number, y: number): void
}

export interface PaintOptions {
  width: number
  height: number
  fontFamily: string
  theme: FramePalette
  /** Already-decoded and pre-blurred background, drawn at 0,0 at full size. */
  backgroundImage?: any
  backgroundOpacity?: number
}

export interface PaintExtras {
  /** Normalized framing from the camera track. Omitted means 1x, centred. */
  camera?: { cx: number; cy: number; scale: number }
  widgetImage?: any
  widgetAlpha?: number
}

/** Snapshot shape the painter needs. Kept structural to avoid an import cycle. */
export interface PaintableSnapshot {
  buffer: string
  cursorX: number
  cursorY: number
  viewportTop: number
  cols: number
  rows: number
  widgetRect?: { xRatio: number; yRatio: number; wRatio: number; hRatio: number }
  petSprite?: string
  petColor?: string
  petName?: string
  petBubble?: string
  ghostSuffix?: string
}

const ANSI_COLORS: Record<number, string> = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow',
  34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'brightBlack', 91: 'brightRed', 92: 'brightGreen', 93: 'brightYellow',
  94: 'brightBlue', 95: 'brightMagenta', 96: 'brightCyan', 97: 'brightWhite',
}

/** xterm 256-colour cube. */
export function xterm256Color(n: number): string {
  if (n < 16) {
    const named = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
      '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff']
    return named[n]
  }
  if (n < 232) {
    const i = n - 16
    const b = i % 6, g = Math.floor(i / 6) % 6, r = Math.floor(i / 36)
    const v = (x: number) => x === 0 ? 0 : 55 + x * 40
    return `rgb(${v(r)},${v(g)},${v(b)})`
  }
  const gray = 8 + (n - 232) * 10
  return `rgb(${gray},${gray},${gray})`
}

/**
 * Strip everything that is not a plain SGR colour sequence.
 *
 * Ordering matters: ESC-non-CSI sequences must go BEFORE the CSI pass, or the
 * generic `\x1b.` rule eats the `ESC [` prefix of the sequences we are keeping
 * and leaves "39m" / "0m" as literal text in the video.
 */
export function stripNonSGR(line: string): string {
  return line
    // OSC: ESC ] ... BEL | ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // DCS: ESC P ... ST
    .replace(/\x1bP[^\x1b]*(?:\x1b\\)/g, '')
    // ESC + a single non-[ char (charset designators, ESC7/ESC8, …)
    .replace(/\x1b[^[]/g, '')
    // CSI: keep only unprefixed SGR
    .replace(/\x1b\[([?!>]?[0-9;:]*)([A-Za-z@`])/g, (match, p, cmd) =>
      (cmd === 'm' && !/^[?!>]/.test(p)) ? match : '')
    // C0 controls except TAB and ESC — ESC still prefixes the SGR we kept
    .replace(/[\x00-\x08\x0a-\x1a\x1c-\x1f\x7f]/g, '')
}

export interface TextSegment { text: string; color: string }

/** Splits an SGR-coloured line into coloured runs. */
export function parseAnsiLine(line: string, theme: FramePalette): TextSegment[] {
  const segments: TextSegment[] = []
  let currentColor = theme.foreground || '#c9d1d9'
  const parts = line.split(/\x1b\[([0-9;]*)m/)

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) segments.push({ text: parts[i], color: currentColor })
      continue
    }
    const codes = parts[i].split(';').map(Number)
    let j = 0
    while (j < codes.length) {
      const code = codes[j]
      if (code === 0 || code === 39) {
        currentColor = theme.foreground || '#c9d1d9'
      } else if (ANSI_COLORS[code]) {
        currentColor = theme[ANSI_COLORS[code]] || currentColor
      } else if ((code === 38 || code === 48) && codes[j + 1] === 5) {
        if (j + 2 < codes.length) {
          if (code === 38) currentColor = xterm256Color(codes[j + 2])
          j += 2
        }
      } else if ((code === 38 || code === 48) && codes[j + 1] === 2) {
        if (j + 4 < codes.length) {
          if (code === 38) currentColor = `rgb(${codes[j + 2]},${codes[j + 3]},${codes[j + 4]})`
          j += 4
        }
      }
      j++
    }
  }
  return segments
}

/** Three-pass box blur — a cheap Gaussian, used to soften a background image. */
export function boxBlur(ctx: Ctx2D, w: number, h: number, radius: number): void {
  const data = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(data.data)
  const dst = data.data
  const r = Math.max(1, Math.round(radius / 3))
  for (let pass = 0; pass < 3; pass++) {
    const buf = pass === 0 ? src : new Uint8ClampedArray(dst)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rr = 0, gg = 0, bb = 0, aa = 0, cnt = 0
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.min(w - 1, Math.max(0, x + dx))
          const i = (y * w + nx) * 4
          rr += buf[i]; gg += buf[i + 1]; bb += buf[i + 2]; aa += buf[i + 3]; cnt++
        }
        const i = (y * w + x) * 4
        dst[i] = rr / cnt; dst[i + 1] = gg / cnt; dst[i + 2] = bb / cnt; dst[i + 3] = aa / cnt
      }
    }
    const tmp = new Uint8ClampedArray(dst)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rr = 0, gg = 0, bb = 0, aa = 0, cnt = 0
        for (let dy = -r; dy <= r; dy++) {
          const ny = Math.min(h - 1, Math.max(0, y + dy))
          const i = (ny * w + x) * 4
          rr += tmp[i]; gg += tmp[i + 1]; bb += tmp[i + 2]; aa += tmp[i + 3]; cnt++
        }
        const i = (y * w + x) * 4
        dst[i] = rr / cnt; dst[i + 1] = gg / cnt; dst[i + 2] = bb / cnt; dst[i + 3] = aa / cnt
      }
    }
  }
  ctx.putImageData(data, 0, 0)
}

/** Layout the painter derives from a snapshot — exported so the studio can
 *  place overlays and hit-test without re-deriving the numbers. */
export function frameMetrics(snapshot: PaintableSnapshot, width: number, height: number) {
  const paddingX = 16
  const paddingY = 16
  const cols = snapshot.cols || 80
  const rows = snapshot.rows || 24
  const charWidth = (width - paddingX * 2) / cols
  const lineHeight = Math.min(charWidth * 2, (height - paddingY * 2) / rows)
  const fontSize = Math.round(lineHeight / 1.4)
  return { paddingX, paddingY, cols, rows, charWidth, lineHeight, fontSize }
}

/** Draws one frame into `ctx`. The canvas is fully repainted, background included. */
export function paintFrame(
  ctx: Ctx2D,
  snapshot: PaintableSnapshot,
  options: PaintOptions,
  extras: PaintExtras = {},
): void {
  const { width, height, fontFamily, theme, backgroundImage } = options
  const { camera, widgetImage, widgetAlpha = 1 } = extras
  const m = frameMetrics(snapshot, width, height)

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (backgroundImage) ctx.drawImage(backgroundImage, 0, 0)

  // Theme wash over the wallpaper — the same layering App.tsx uses live
  const bgHex = (theme.background || '#0d1117').replace('#', '')
  const r = parseInt(bgHex.slice(0, 2), 16) || 13
  const g = parseInt(bgHex.slice(2, 4), 16) || 17
  const b = parseInt(bgHex.slice(4, 6), 16) || 23
  const opacity = backgroundImage ? (options.backgroundOpacity ?? 0.85) : 1
  ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`
  ctx.fillRect(0, 0, width, height)

  ctx.font = `${m.fontSize}px ${fontFamily}`
  // Trust the cols-derived width for layout, but never overflow if the font
  // measures wider than we assumed.
  const charWidth = Math.min(m.charWidth, ctx.measureText('M').width || m.charWidth)

  /* Camera. The framing is normalized to the frame, so this maps the point the
     camera is looking at onto the centre of the canvas at the chosen scale.
     Only the terminal content moves: the pet is a corner overlay, and a widget
     capture is a raster of the pane that magnifying would only make soft. */
  const zoomed = !!camera && camera.scale > 1.0001
  if (zoomed) {
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.scale(camera!.scale, camera!.scale)
    ctx.translate(-camera!.cx * width, -camera!.cy * height)
  }

  const lines = snapshot.buffer.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const y = m.paddingY + i * m.lineHeight + m.fontSize
    let x = m.paddingX
    for (const seg of parseAnsiLine(stripNonSGR(lines[i]), theme)) {
      ctx.fillStyle = seg.color
      ctx.fillText(seg.text, x, y)
      x += seg.text.length * charWidth
    }
  }

  // Cursor. cursorY is a buffer row, so subtract the viewport origin.
  ctx.fillStyle = theme.cursor || theme.foreground || '#58a6ff'
  ctx.globalAlpha = 0.7
  ctx.fillRect(
    m.paddingX + snapshot.cursorX * charWidth,
    m.paddingY + (snapshot.cursorY - snapshot.viewportTop) * m.lineHeight,
    charWidth, m.lineHeight,
  )
  ctx.globalAlpha = 1

  if (zoomed) ctx.restore()

  if (snapshot.ghostSuffix) {
    ctx.font = `${m.fontSize}px ${fontFamily}`
    ctx.fillStyle = '#8b949e'
    ctx.globalAlpha = 0.55
    ctx.fillText(
      snapshot.ghostSuffix,
      m.paddingX + snapshot.cursorX * charWidth,
      m.paddingY + (snapshot.cursorY - snapshot.viewportTop) * m.lineHeight + m.fontSize,
    )
    ctx.globalAlpha = 1
  }

  paintPet(ctx, snapshot, options, m, charWidth)

  if (widgetImage && snapshot.widgetRect) {
    const { xRatio, yRatio, wRatio, hRatio } = snapshot.widgetRect
    ctx.globalAlpha = widgetAlpha
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(widgetImage,
      Math.round(xRatio * width), Math.round(yRatio * height),
      Math.round(wRatio * width), Math.round(hRatio * height))
    ctx.globalAlpha = 1
  }
}

function paintPet(
  ctx: Ctx2D,
  snapshot: PaintableSnapshot,
  options: PaintOptions,
  m: ReturnType<typeof frameMetrics>,
  charWidth: number,
) {
  if (!snapshot.petSprite || !snapshot.petColor) return
  const { width, height, fontFamily } = options
  const petLines = snapshot.petSprite.split('\n')
  const maxLen = Math.max(...petLines.map(l => l.length))
  const petX = width - m.paddingX - maxLen * charWidth
  const petBottom = height - 50
  // The live component uses leading-tight (1.25), not the terminal's ~1.4
  const petLineHeight = Math.round(m.fontSize * 1.25)

  ctx.font = `${m.fontSize}px ${fontFamily}`
  ctx.fillStyle = snapshot.petColor
  ctx.globalAlpha = 0.9
  for (let i = 0; i < petLines.length; i++) {
    ctx.fillText(petLines[i], petX, petBottom - (petLines.length - 1 - i) * petLineHeight)
  }
  ctx.globalAlpha = 1

  if (snapshot.petName) {
    const nameFontSize = Math.max(8, m.fontSize - 4)
    ctx.font = `${nameFontSize}px ${fontFamily}`
    ctx.fillStyle = '#6e7681'
    ctx.globalAlpha = 0.85
    ctx.fillText(
      snapshot.petName,
      width - m.paddingX - ctx.measureText(snapshot.petName).width,
      petBottom - petLines.length * petLineHeight - 2,
    )
    ctx.globalAlpha = 1
  }

  if (!snapshot.petBubble) return
  const bubbleFontSize = Math.max(10, m.fontSize - 2)
  ctx.font = `${bubbleFontSize}px ${fontFamily}`
  const padding = 6
  const maxBubbleWidth = 180
  const bubbleLines: string[] = []
  let line = ''
  for (const word of snapshot.petBubble.split(' ')) {
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
  const bubbleW = Math.min(maxBubbleWidth,
    Math.max(...bubbleLines.map(l => ctx.measureText(l).width)) + padding * 2)
  const bubbleH = bubbleLines.length * bubbleLineH + padding * 2
  const bubbleX = petX + maxLen * charWidth - bubbleW
  const bubbleY = petBottom - petLines.length * petLineHeight - bubbleH - 4

  ctx.globalAlpha = 0.92
  ctx.fillStyle = '#161b22'
  ctx.beginPath()
  const rad = 6
  ctx.moveTo(bubbleX + rad, bubbleY)
  ctx.lineTo(bubbleX + bubbleW - rad, bubbleY)
  ctx.arcTo(bubbleX + bubbleW, bubbleY, bubbleX + bubbleW, bubbleY + rad, rad)
  ctx.lineTo(bubbleX + bubbleW, bubbleY + bubbleH - rad)
  ctx.arcTo(bubbleX + bubbleW, bubbleY + bubbleH, bubbleX + bubbleW - rad, bubbleY + bubbleH, rad)
  ctx.lineTo(bubbleX + rad, bubbleY + bubbleH)
  ctx.arcTo(bubbleX, bubbleY + bubbleH, bubbleX, bubbleY + bubbleH - rad, rad)
  ctx.lineTo(bubbleX, bubbleY + rad)
  ctx.arcTo(bubbleX, bubbleY, bubbleX + rad, bubbleY, rad)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#30363d'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = '#c9d1d9'
  for (let i = 0; i < bubbleLines.length; i++) {
    ctx.fillText(bubbleLines[i], bubbleX + padding, bubbleY + padding + (i + 1) * bubbleLineH - 2)
  }
  ctx.globalAlpha = 1
}
