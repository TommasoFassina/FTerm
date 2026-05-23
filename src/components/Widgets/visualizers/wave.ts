import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

export const drawWave: VisualizerRenderer = (ctx, { analyser, w, h }: VisualizerFrame, _refs: VisualizerRefs) => {
  ctx.clearRect(0, 0, w, h)
  const buf = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(buf)
  let maxDev = 0
  for (let i = 0; i < buf.length; i++) { const d = Math.abs(buf[i] - 128); if (d > maxDev) maxDev = d }
  if (maxDev > 8) {
    const gain = Math.min(100 / maxDev, 6)
    for (let i = 0; i < buf.length; i++) buf[i] = 128 + Math.round((buf[i] - 128) * gain)
  }
  const cy = h / 2
  const amp = cy - 6
  const slice = w / buf.length
  const pts: [number, number][] = []
  for (let i = 0; i < buf.length; i++) {
    pts.push([i * slice, cy + ((buf[i] - 128) / 128) * amp])
  }
  const drawPath = () => {
    ctx.beginPath()
    pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py))
  }
  const fillGrad = ctx.createLinearGradient(0, 0, 0, h)
  fillGrad.addColorStop(0, 'rgba(0,255,159,0.12)')
  fillGrad.addColorStop(0.5, 'rgba(0,180,255,0.06)')
  fillGrad.addColorStop(1, 'rgba(255,0,170,0.12)')
  drawPath()
  ctx.lineTo(w, cy); ctx.lineTo(0, cy); ctx.closePath()
  ctx.fillStyle = fillGrad
  ctx.fill()
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, '#ff00aa')
  grad.addColorStop(0.25, '#ff7b00')
  grad.addColorStop(0.5, '#ffe600')
  grad.addColorStop(0.75, '#00ff9f')
  grad.addColorStop(1, '#00b4ff')
  ctx.strokeStyle = grad
  ctx.shadowColor = '#00b4ff'
  ctx.shadowBlur = 22; ctx.lineWidth = 5; ctx.globalAlpha = 0.25
  drawPath(); ctx.stroke()
  ctx.shadowBlur = 10; ctx.lineWidth = 3; ctx.globalAlpha = 0.6
  drawPath(); ctx.stroke()
  ctx.shadowBlur = 0; ctx.lineWidth = 1.8; ctx.globalAlpha = 1
  drawPath(); ctx.stroke()
  ctx.globalAlpha = 0.2
  ctx.lineWidth = 1.2
  ctx.beginPath()
  pts.forEach(([px, py], i) => {
    const my = cy + (cy - py)
    if (i === 0) ctx.moveTo(px, my); else ctx.lineTo(px, my)
  })
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke()
}
