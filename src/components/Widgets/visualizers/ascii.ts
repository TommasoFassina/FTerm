import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

const RAMP = ' .:-=+*#%@'

export const drawAscii: VisualizerRenderer = (ctx, { freqData, w, h }: VisualizerFrame, _refs: VisualizerRefs) => {
  ctx.clearRect(0, 0, w, h)
  const cols = 80
  const rows = 20
  const cellW = w / cols
  const cellH = h / rows
  const step = Math.floor(freqData.length / cols)
  ctx.font = `${Math.floor(cellH * 0.95)}px 'Fira Code', monospace`
  ctx.textBaseline = 'top'
  const t = performance.now() / 50
  for (let c = 0; c < cols; c++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += freqData[c * step + j]
    const v = sum / step / 255
    const filled = Math.floor(v * rows)
    for (let r = 0; r < rows; r++) {
      const fromBottom = rows - 1 - r
      if (fromBottom < filled) {
        const intensity = (filled - fromBottom) / rows
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(intensity * RAMP.length))]
        const hue = (c * 360 / cols + t) % 360
        ctx.fillStyle = `hsl(${hue}, 95%, ${45 + intensity * 40}%)`
        ctx.fillText(ch, c * cellW, r * cellH)
      }
    }
  }
}
