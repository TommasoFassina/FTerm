import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

export const drawScope: VisualizerRenderer = (ctx, { analyser, w, h, beatPulse, t }: VisualizerFrame, _refs: VisualizerRefs) => {
  const buf = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(buf)
  const n = buf.length
  const q = Math.floor(n / 4)

  ctx.fillStyle = 'rgba(0,2,6,0.18)'
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2, cy = h / 2
  const scale = Math.min(w, h) * 0.44
  const pulse = beatPulse

  let maxDev = 0
  for (let i = 0; i < n; i++) { const d = Math.abs(buf[i] - 128); if (d > maxDev) maxDev = d }
  const sigGain = maxDev > 8 ? Math.min(4, 100 / maxDev) : 1

  ctx.lineWidth = 3 + pulse * 3
  ctx.strokeStyle = `hsla(${(t * 40) % 360}, 100%, 60%, 0.25)`
  ctx.shadowColor = `hsl(${(t * 40) % 360}, 100%, 60%)`
  ctx.shadowBlur = 22 + pulse * 20
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = (buf[i] - 128) / 128 * scale * sigGain
    const y = (buf[(i + q) % n] - 128) / 128 * scale * sigGain
    if (i === 0) ctx.moveTo(cx + x, cy + y)
    else ctx.lineTo(cx + x, cy + y)
  }
  ctx.stroke()

  ctx.shadowBlur = 8
  ctx.lineWidth = 1.2
  for (let i = 0; i < n - 1; i++) {
    const x0 = (buf[i] - 128) / 128 * scale * sigGain
    const y0 = (buf[(i + q) % n] - 128) / 128 * scale * sigGain
    const x1 = (buf[i + 1] - 128) / 128 * scale * sigGain
    const y1 = (buf[(i + q + 1) % n] - 128) / 128 * scale * sigGain
    const hue = (i / n * 360 + t * 80) % 360
    ctx.strokeStyle = `hsla(${hue}, 100%, 75%, 0.9)`
    ctx.shadowColor = `hsl(${hue}, 100%, 70%)`
    ctx.beginPath()
    ctx.moveTo(cx + x0, cy + y0)
    ctx.lineTo(cx + x1, cy + y1)
    ctx.stroke()
  }
  ctx.shadowBlur = 0

  ctx.strokeStyle = 'rgba(0,200,255,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke()
  for (const fr of [0.33, 0.66, 1]) {
    ctx.beginPath()
    ctx.arc(cx, cy, scale * fr, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(0,200,255,${0.04 + fr * 0.02})`
    ctx.stroke()
  }
}
