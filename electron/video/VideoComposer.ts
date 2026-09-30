import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { Readable } from 'stream'
import { loadImage } from 'canvas'
import { FrameRenderer, RenderOptions } from './FrameRenderer'
import type { FrameSnapshot, CommandEvent } from '../../src/services/TerminalRecorder'
import { defaultPlan, frameCount, sourceTimeAt, type EditPlan } from '../../src/services/recording/editPlan'
import { buildCameraTrack, cameraAt, DEFAULT_CAMERA, type CameraConfig } from '../../src/services/recording/cameraTrack'

function unpackedPath(p: string): string {
  return p.replace(/[/\\]app\.asar[/\\]/, '/app.asar.unpacked/')
}

const resolvedFfmpegPath = ffmpegPath ? unpackedPath(ffmpegPath) : null
const resolvedFfprobePath = unpackedPath(ffprobeInstaller.path)
if (resolvedFfmpegPath) ffmpeg.setFfmpegPath(resolvedFfmpegPath)
ffmpeg.setFfprobePath(resolvedFfprobePath)

/** Container to write. GIF goes through a palette pass; mp4 is H.264. */
export type VideoFormat = 'mp4' | 'gif'

export interface ComposeOptions {
  format?: VideoFormat
  snapshots: FrameSnapshot[]
  /** Carried with the take for the studio timeline; the encoder does not use it. */
  events?: CommandEvent[]
  /** Deduplicated widget captures, addressed by `FrameSnapshot.widgetFrame`. */
  widgetFrames?: string[]
  outputPath: string
  fps: number
  width: number
  height: number
  theme: RenderOptions['theme']
  fontFamily?: string
  backgroundImage?: string
  backgroundBlur?: number
  backgroundOpacity?: number
  /** Trim / cuts / speed decided in the studio. Omitted means "the whole take". */
  plan?: EditPlan
  /** Encoder quality: lower CRF is better and bigger. */
  crf?: number
  /** Automatic camera. Rebuilt here from the same take the studio previewed. */
  camera?: Partial<CameraConfig>
  onProgress?: (percent: number) => void
  /** Resolves true to abort mid-encode. Polled once per frame. */
  shouldCancel?: () => boolean
}

// Strip CSS quotes from font names and append Unicode fallbacks for box-drawing,
// block elements, and symbols that Consolas/Courier New lack.
function buildFontStack(userFont?: string): string {
  const base = userFont
    ? userFont.replace(/['"]/g, '').split(',').map(f => f.trim()).filter(Boolean)
    : []
  const fallbacks = ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Segoe UI Symbol', 'Segoe UI Emoji', 'Courier New', 'DejaVu Sans Mono', 'monospace']
  const merged = [...new Set([...base, ...fallbacks])]
  return merged.join(', ')
}

export class ComposeCancelled extends Error {
  constructor() { super('Export cancelled') }
}

export async function composeVideo(options: ComposeOptions): Promise<void> {
  const {
    snapshots, widgetFrames = [], outputPath, fps, width, height, theme, fontFamily,
    backgroundImage, backgroundBlur, backgroundOpacity, crf = 23, camera, onProgress, shouldCancel,
  } = options

  if (snapshots.length === 0) throw new Error('No snapshots to compose')

  const sourceDuration = snapshots[snapshots.length - 1].timestamp
  const plan = options.plan ?? defaultPlan(sourceDuration)
  const totalFrames = frameCount(plan, fps)
  // Pure and deterministic on the take, so this reproduces exactly the track
  // the studio preview was scrubbed against — no camera data crosses the wire.
  const cameraCfg = { ...DEFAULT_CAMERA, ...camera }
  const cameraTrack = buildCameraTrack(snapshots, cameraCfg)

  const renderer = new FrameRenderer({
    width,
    height,
    fontSize: 16,
    fontFamily: buildFontStack(fontFamily),
    theme,
    backgroundImage,
    backgroundBlur: backgroundBlur ?? 10,
    backgroundOpacity: backgroundOpacity ?? 0.85,
  })

  await renderer.preload()

  // Decode each unique widget capture once, up front.
  const widgetImages: any[] = []
  for (const frame of widgetFrames) {
    try {
      const buf = Buffer.from(frame.replace(/^data:image\/png;base64,/, ''), 'base64')
      widgetImages.push(await loadImage(buf))
    } catch {
      widgetImages.push(undefined)
    }
  }

  const frameStream = new Readable({ read() { } })

  console.log('[VideoComposer] starting ffmpeg —', totalFrames, 'frames at', fps, 'fps')
  return new Promise<void>((resolve, reject) => {
    let cancelled = false

    const command = ffmpeg()
      .input(frameStream as any)
      .inputFormat('image2pipe')
      .inputOptions([`-framerate ${fps}`])
      .output(outputPath)

    if (options.format === 'gif') {
      /* A GIF is 256 colours. Letting ffmpeg pick them per frame produces the
         dithered mess people associate with terminal GIFs; generating one
         palette from the whole clip and reusing it keeps the theme's colours
         intact, which for a terminal recording is nearly all of the quality. */
      command
        .complexFilter([
          `[0:v] fps=${fps},split [a][b]`,
          '[a] palettegen=stats_mode=diff [p]',
          '[b][p] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
        ])
        .outputOptions(['-loop 0'])
    } else {
      command
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-preset fast', `-crf ${crf}`, '-vsync cfr', '-movflags +faststart'])
    }

    command
      .on('end', () => {
        console.log('[VideoComposer] ffmpeg done')
        if (cancelled) reject(new ComposeCancelled())
        else resolve()
      })
      .on('error', (err, _stdout, stderr) => {
        if (cancelled) { reject(new ComposeCancelled()); return }
        console.error('[VideoComposer] ffmpeg error:', err.message, stderr)
        reject(err)
      })

    command.run()

    let frameIndex = 0
    const frameDuration = 1000 / fps

    // Widget fade-in/out state
    const WIDGET_FADE_FRAMES = 8
    let widgetVisible = false
    let widgetFadeFrame = 0
    let widgetFadeDir = 0
    let lastWidgetImg: any = undefined  // retained during fade-out

    function pushNextFrame() {
      if (shouldCancel?.()) {
        cancelled = true
        frameStream.push(null)
        try { command.kill('SIGKILL') } catch { /* already gone */ }
        return
      }
      if (frameIndex >= totalFrames) {
        frameStream.push(null)
        return
      }

      // The plan maps output time back onto the original take. Trims, cuts and
      // the speed multiplier are all expressed here and nowhere else.
      const sourceTime = sourceTimeAt(plan, frameIndex * frameDuration)
      const snapshot = findClosestSnapshot(snapshots, sourceTime)
      const cam = cameraAt(cameraTrack, sourceTime, cameraCfg.settleMs)

      const currentWidgetImg = snapshot.widgetFrame !== undefined
        ? widgetImages[snapshot.widgetFrame]
        : undefined
      const hasWidget = !!currentWidgetImg

      if (hasWidget && !widgetVisible) {
        widgetVisible = true
        widgetFadeDir = 1
        widgetFadeFrame = 0
      } else if (!hasWidget && widgetVisible) {
        widgetVisible = false
        widgetFadeDir = -1
        widgetFadeFrame = WIDGET_FADE_FRAMES
        // keep lastWidgetImg so the fade-out has something to draw
      }
      if (hasWidget) lastWidgetImg = currentWidgetImg

      if (widgetFadeDir !== 0) {
        widgetFadeFrame += widgetFadeDir
        if (widgetFadeFrame >= WIDGET_FADE_FRAMES) { widgetFadeFrame = WIDGET_FADE_FRAMES; widgetFadeDir = 0 }
        if (widgetFadeFrame <= 0) { widgetFadeFrame = 0; widgetFadeDir = 0; lastWidgetImg = undefined }
      }
      const widgetAlpha = widgetFadeFrame / WIDGET_FADE_FRAMES
      const widgetImg = widgetAlpha > 0 ? (currentWidgetImg ?? lastWidgetImg) : undefined

      try {
        frameStream.push(renderer.renderFrame(snapshot, cam, widgetImg, widgetAlpha))
      } catch (err) {
        console.error('Frame render error:', err)
        frameStream.push(renderer.renderFrame(snapshot))
      }

      frameIndex++
      // Progress is reported off our own frame counter, not ffmpeg's estimate:
      // piped input has no duration for ffmpeg to measure against, so its
      // `percent` was frequently NaN and the UI sat at 0 until the very end.
      onProgress?.(Math.min(99, Math.round((frameIndex / totalFrames) * 100)))
      // setImmediate keeps the event loop responsive between frames
      setImmediate(pushNextFrame)
    }

    pushNextFrame()
  })
}

function findClosestSnapshot(snapshots: FrameSnapshot[], time: number): FrameSnapshot {
  let lo = 0
  let hi = snapshots.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (snapshots[mid].timestamp < time) lo = mid + 1
    else hi = mid
  }
  // Frames are held until the next snapshot, so prefer the one at or before
  // `time` — picking the nearest could show a line before it was printed.
  if (lo > 0 && snapshots[lo].timestamp > time) return snapshots[lo - 1]
  return snapshots[lo]
}
