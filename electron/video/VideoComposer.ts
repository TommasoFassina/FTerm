import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { Readable } from 'stream'
import { loadImage } from 'canvas'
import { FrameRenderer, RenderOptions } from './FrameRenderer'
import { detectScenes } from './SceneDetector'
import type { FrameSnapshot, CommandEvent } from '../../src/services/TerminalRecorder'

console.log('[VideoComposer] ffmpeg path:', ffmpegPath)
console.log('[VideoComposer] ffprobe path:', ffprobeInstaller.path)
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobeInstaller.path)

export interface ComposeOptions {
  snapshots: FrameSnapshot[]
  events: CommandEvent[]
  outputPath: string
  fps: number
  width: number
  height: number
  theme: RenderOptions['theme']
  fontFamily?: string
  backgroundImage?: string
  backgroundBlur?: number
  backgroundOpacity?: number
  onProgress?: (percent: number) => void
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

export async function composeVideo(options: ComposeOptions): Promise<void> {
  const { snapshots, events, outputPath, fps, width, height, theme, fontFamily, backgroundImage, backgroundBlur, backgroundOpacity, onProgress } = options

  if (snapshots.length === 0) throw new Error('No snapshots to compose')

  const totalDuration = snapshots[snapshots.length - 1].timestamp
  const scenes = detectScenes(events, totalDuration)

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

  // Preload unique widget capture images
  const widgetImageCache = new Map<string, any>()
  for (const snap of snapshots) {
    if (snap.widgetCapture && !widgetImageCache.has(snap.widgetCapture)) {
      try {
        const buf = Buffer.from(snap.widgetCapture.replace(/^data:image\/png;base64,/, ''), 'base64')
        widgetImageCache.set(snap.widgetCapture, await loadImage(buf))
      } catch {}
    }
  }

  const frameStream = new Readable({ read() {} })
  const frameDuration = 1000 / fps

  console.log('[VideoComposer] starting ffmpeg, totalDuration:', totalDuration, 'ms, frames to generate:', Math.ceil(totalDuration / (1000 / fps)))
  return new Promise<void>((resolve, reject) => {
    const command = ffmpeg()
      .input(frameStream as any)
      .inputFormat('image2pipe')
      .inputOptions([`-framerate ${fps}`])
      .output(outputPath)
      .videoCodec('libx264')
      .outputOptions(['-pix_fmt yuv420p', '-preset fast', '-crf 23'])
      .on('progress', (progress: { percent?: number }) => {
        if (onProgress) onProgress(progress.percent || 0)
      })
      .on('end', () => { console.log('[VideoComposer] ffmpeg done'); resolve() })
      .on('error', (err, _stdout, stderr) => { console.error('[VideoComposer] ffmpeg error:', err.message, stderr); reject(err) })

    command.run()

    let frameIndex = 0
    const totalFrames = Math.ceil(totalDuration / frameDuration)

    // Widget fade-in/out state
    const WIDGET_FADE_FRAMES = 8
    let widgetVisible = false
    let widgetFadeFrame = 0
    let widgetFadeDir = 0
    let lastWidgetImg: any = undefined  // retained during fade-out

    function pushNextFrame() {
      const currentTime = frameIndex * frameDuration
      if (currentTime > totalDuration || frameIndex > totalFrames) {
        frameStream.push(null)
        return
      }

      const snapshot = findClosestSnapshot(snapshots, currentTime)
      const activeScene = scenes.find(
        s => currentTime >= s.startTime && currentTime <= s.endTime
      )

      const currentWidgetImg = snapshot.widgetCapture ? widgetImageCache.get(snapshot.widgetCapture) : undefined
      const hasWidget = !!currentWidgetImg

      if (hasWidget && !widgetVisible) {
        widgetVisible = true
        widgetFadeDir = 1
        widgetFadeFrame = 0
      } else if (!hasWidget && widgetVisible) {
        widgetVisible = false
        widgetFadeDir = -1
        widgetFadeFrame = WIDGET_FADE_FRAMES
        // keep lastWidgetImg so fade-out has something to draw
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
        const pngBuffer = renderer.renderFrame(snapshot, activeScene?.zoomRect, widgetImg, widgetAlpha)
        frameStream.push(pngBuffer)
      } catch (err) {
        console.error('Frame render error:', err)
        frameStream.push(renderer.renderFrame(snapshot))
      }

      frameIndex++
      // Use setImmediate to avoid blocking the event loop
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
  if (lo > 0 && Math.abs(snapshots[lo - 1].timestamp - time) < Math.abs(snapshots[lo].timestamp - time)) {
    return snapshots[lo - 1]
  }
  return snapshots[lo]
}
