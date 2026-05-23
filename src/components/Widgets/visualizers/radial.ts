import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

export const drawRadial: VisualizerRenderer = (ctx, { freqData, w, h, beatPulse }: VisualizerFrame, refs: VisualizerRefs) => {
  ctx.clearRect(0, 0, w, h)
  const cx = w / 2, cy = h / 2
  const bars = 96
  const step = Math.floor(freqData.length / bars)
  const baseR = Math.min(w, h) * 0.18 * (1 + beatPulse * 0.35)
  const maxLen = Math.min(w, h) * 0.42
  const rot = performance.now() / 1500
  const cover = refs.coverBitmapRef.current ?? refs.coverImgRef.current
  if (cover && (cover instanceof ImageBitmap || ((cover as HTMLImageElement).complete && (cover as HTMLImageElement).naturalWidth > 0))) {
    const discR = Math.min(w, h) * 0.22 * (1 + beatPulse * 0.08)
    const spin = performance.now() / 3000
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(spin)
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 24
    ctx.beginPath()
    ctx.arc(0, 0, discR, 0, Math.PI * 2)
    ctx.fillStyle = '#080808'
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 0.5
    for (let gr = discR * 0.80; gr < discR; gr += 2) {
      ctx.beginPath(); ctx.arc(0, 0, gr, 0, Math.PI * 2); ctx.stroke()
    }
    const imgR = discR * 0.78
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, imgR, 0, Math.PI * 2)
    ctx.clip()
    try { ctx.drawImage(cover, -imgR, -imgR, imgR * 2, imgR * 2) }
    catch { refs.coverImgRef.current = null; refs.coverBitmapRef.current = null }
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(0, 0, imgR, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#111'
    ctx.beginPath(); ctx.arc(0, 0, discR * 0.05, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, baseR * 0.85, 0, Math.PI * 2)
    const ringGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR)
    ringGrad.addColorStop(0, `hsla(${(performance.now() / 30) % 360}, 100%, 60%, ${0.25 + beatPulse * 0.4})`)
    ringGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = ringGrad
    ctx.fill()
  }
  ctx.lineWidth = 2
  for (let i = 0; i < bars; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += freqData[i * step + j]
    const v = sum / step / 255
    if (v < 0.02) continue
    const ang = (i / bars) * Math.PI * 2 + rot
    const len = v * maxLen
    const x1 = cx + Math.cos(ang) * baseR
    const y1 = cy + Math.sin(ang) * baseR
    const x2 = cx + Math.cos(ang) * (baseR + len)
    const y2 = cy + Math.sin(ang) * (baseR + len)
    const hue = (i * 360 / bars + performance.now() / 40) % 360
    ctx.strokeStyle = `hsl(${hue}, 100%, ${55 + v * 30}%)`
    ctx.shadowColor = `hsl(${hue}, 100%, 60%)`
    ctx.shadowBlur = 8 + v * 12
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
}
