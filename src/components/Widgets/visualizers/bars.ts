import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

export const drawBars: VisualizerRenderer = (ctx, { freqData, w, h }: VisualizerFrame, _refs: VisualizerRefs) => {
  ctx.clearRect(0, 0, w, h)
  const bars = 64
  const step = Math.floor(freqData.length / bars)
  const bw = w / bars
  const t = performance.now() / 40
  for (let i = 0; i < bars; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += freqData[i * step + j]
    const v = sum / step / 255
    if (v < 0.01) continue
    const bh = v * h
    const hue = (i * 360 / bars + t) % 360
    const g = ctx.createLinearGradient(0, h - bh, 0, h)
    g.addColorStop(0, `hsl(${hue}, 100%, ${55 + v * 25}%)`)
    g.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 45%)`)
    ctx.fillStyle = g
    ctx.shadowColor = `hsl(${hue}, 100%, 60%)`
    ctx.shadowBlur = 6 + v * 10
    ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh)
    ctx.fillStyle = `hsla(${hue}, 100%, 80%, 0.95)`
    ctx.fillRect(i * bw + 1, h - bh - 2, bw - 2, 2)
  }
  ctx.shadowBlur = 0
}
