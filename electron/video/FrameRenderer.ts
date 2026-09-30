import { createCanvas, loadImage, registerFont, Canvas, CanvasRenderingContext2D } from 'canvas'
import { existsSync } from 'fs'
import type { FrameSnapshot } from '../../src/services/TerminalRecorder'
import { boxBlur, paintFrame, type Ctx2D, type FramePalette } from '../../src/services/recording/paintFrame'

export interface RenderOptions {
  width: number
  height: number
  fontSize: number
  fontFamily: string
  theme: FramePalette
  backgroundImage?: string
  backgroundBlur?: number
  backgroundOpacity?: number
}

/**
 * node-canvas side of the recorder.
 *
 * The drawing itself lives in `src/services/recording/paintFrame.ts`, shared
 * with the studio preview in the renderer — this class only owns the things
 * that are specific to running under Node: font registration, decoding the
 * background from disk, and turning the finished canvas into a PNG buffer.
 */
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
    // Register Windows symbol/emoji fonts so Pango can reach the block
    // elements and box-drawing glyphs monospace faces tend to lack.
    const winFonts: Array<{ path: string; family: string }> = [
      { path: 'C:\\Windows\\Fonts\\seguisym.ttf', family: 'Segoe UI Symbol' },
      { path: 'C:\\Windows\\Fonts\\seguiemj.ttf', family: 'Segoe UI Emoji' },
      { path: 'C:\\Windows\\Fonts\\CascadiaMono.ttf', family: 'Cascadia Mono' },
      { path: 'C:\\Windows\\Fonts\\CascadiaCode.ttf', family: 'Cascadia Code' },
    ]
    for (const { path, family } of winFonts) {
      if (existsSync(path)) {
        try { registerFont(path, { family }) } catch { /* skip unavailable */ }
      }
    }

    const { backgroundImage, backgroundBlur = 10, width, height } = this.options
    if (!backgroundImage) return
    try {
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
      if (backgroundBlur > 0) boxBlur(bgCtx as unknown as Ctx2D, width, height, backgroundBlur)
    } catch (e) {
      console.warn('[FrameRenderer] failed to load backgroundImage:', e)
    }
  }

  renderFrame(
    snapshot: FrameSnapshot,
    camera?: { cx: number; cy: number; scale: number },
    widgetImage?: any,
    widgetAlpha = 1.0,
  ): Buffer {
    paintFrame(
      this.ctx as unknown as Ctx2D,
      snapshot,
      {
        width: this.options.width,
        height: this.options.height,
        fontFamily: this.options.fontFamily,
        theme: this.options.theme,
        backgroundImage: this.bgCanvas ?? undefined,
        backgroundOpacity: this.options.backgroundOpacity,
      },
      { camera, widgetImage, widgetAlpha },
    )
    return this.canvas.toBuffer('image/png')
  }
}
