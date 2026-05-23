import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

export const drawWaterfall3d: VisualizerRenderer = (ctx, { freqData, w, h, isSilent, beatPulse }: VisualizerFrame, refs: VisualizerRefs) => {
  const wf = refs.waterfallRef.current
  wf.history.unshift(new Uint8Array(freqData))
  if (wf.history.length > wf.max) wf.history.length = wf.max

  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#02000d')
  bg.addColorStop(0.55, '#060120')
  bg.addColorStop(1, '#0b0430')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const horizonY = h * 0.18
  const t = performance.now() / 1000

  let wfBassSum = 0
  const wfBassEnd = Math.floor(freqData.length * 0.08)
  for (let i = 1; i < wfBassEnd; i++) wfBassSum += freqData[i]
  const wfBass = isSilent ? 0 : wfBassSum / (wfBassEnd - 1) / 255
  const ampBoost = 1 + wfBass * 0.55 + beatPulse * 0.35
  const colorHue = (t * 22) % 360

  // Stars across full background
  ctx.save()
  for (let s = 0; s < 140; s++) {
    const sx = (Math.sin(s * 127.1) * 0.5 + 0.5) * w
    const sy = (Math.sin(s * 311.7) * 0.5 + 0.5) * h
    const sr = 0.4 + (Math.sin(s * 53.3) * 0.5 + 0.5) * 1.0
    const twinkle = 0.3 + 0.7 * (Math.sin(t * (0.6 + (s % 5) * 0.3) + s) * 0.5 + 0.5)
    ctx.fillStyle = `rgba(255,255,255,${twinkle * 0.75})`
    ctx.beginPath()
    ctx.arc(sx, sy, sr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // Perspective floor grid (drawn before layers so layers overlay it)
  {
    const vx = w / 2
    const vy = horizonY
    const gridAlpha = 0.13 + wfBass * 0.07
    ctx.save()
    ctx.shadowColor = `hsl(${colorHue}, 100%, 65%)`
    ctx.shadowBlur = 4

    // Converging vertical lines — start below horizon to avoid visible vanishing point dot
    const vLines = 14
    const gridStart = vy + (h - vy) * 0.08
    for (let i = 0; i <= vLines; i++) {
      const bx = (i / vLines) * w
      const frac = Math.abs(i / vLines - 0.5) * 2
      const lineAlpha = gridAlpha * (0.4 + 0.6 * frac)
      ctx.strokeStyle = `hsla(${colorHue}, 100%, 65%, ${lineAlpha})`
      ctx.lineWidth = 0.8
      // interpolate top of line from vanishing point offset downward
      const topX = vx + (bx - vx) * 0.08
      ctx.beginPath()
      ctx.moveTo(topX, gridStart)
      ctx.lineTo(bx, h)
      ctx.stroke()
    }

    // Horizontal lines with perspective spacing
    const hLines = 10
    for (let i = 1; i <= hLines; i++) {
      const p = Math.pow(i / hLines, 1.8)
      const y = vy + (h - vy) * p
      const lineAlpha = gridAlpha * (0.3 + 0.7 * p)
      ctx.strokeStyle = `hsla(${colorHue}, 100%, 65%, ${lineAlpha})`
      ctx.lineWidth = 0.8
      const lx = vx * (1 - p)
      const rx = vx + (w - vx) * p
      ctx.beginPath()
      ctx.moveTo(lx, y)
      ctx.lineTo(rx, y)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
    ctx.restore()
  }

  const layers = wf.history.length
  const bandCount = 128
  for (let li = layers - 1; li >= 0; li--) {
    const data = wf.history[li]
    const depth = li / wf.max
    const persp = 1 - depth
    const baseY = horizonY + (h - horizonY) * Math.pow(persp, 1.4)
    const layerW = w * (0.35 + 0.65 * Math.pow(persp, 1.2))
    const layerX = (w - layerW) / 2
    const amp = (h - horizonY) * 0.34 * persp * (li === 0 ? ampBoost : 1)
    const step = Math.floor(data.length / bandCount)
    const alpha = 0.22 + persp * 0.78
    const hue = (depth * 270 + t * 22) % 360

    ctx.beginPath()
    ctx.moveTo(layerX, baseY)
    for (let i = 0; i < bandCount; i++) {
      let sum = 0
      for (let j = 0; j < step; j++) sum += data[i * step + j]
      const v = sum / step / 255
      const px = layerX + (i / (bandCount - 1)) * layerW
      const py = baseY - v * amp
      ctx.lineTo(px, py)
    }
    ctx.lineTo(layerX + layerW, baseY)
    ctx.closePath()
    const fillGrad = ctx.createLinearGradient(0, baseY - amp, 0, baseY)
    fillGrad.addColorStop(0, `hsla(${hue}, 100%, 65%, ${alpha * 0.68})`)
    fillGrad.addColorStop(0.5, `hsla(${(hue + 50) % 360}, 100%, 38%, ${alpha * 0.28})`)
    fillGrad.addColorStop(1, `hsla(${(hue + 90) % 360}, 100%, 18%, ${alpha * 0.07})`)
    ctx.fillStyle = fillGrad
    ctx.fill()

    if (persp > 0.12) {
      ctx.strokeStyle = `hsla(${hue}, 100%, ${62 + persp * 28}%, ${alpha})`
      ctx.lineWidth = 0.5 + persp * 2.0
      ctx.shadowColor = `hsl(${hue}, 100%, 72%)`
      ctx.shadowBlur = persp * 20 * (1 + wfBass * 0.6)
      ctx.beginPath()
      for (let i = 0; i < bandCount; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += data[i * step + j]
        const v = sum / step / 255
        const px = layerX + (i / (bandCount - 1)) * layerW
        const py = baseY - v * amp
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
  }
  ctx.shadowBlur = 0

  if (wf.history.length > 0) {
    const data = wf.history[0]
    const baseY = horizonY + (h - horizonY) * Math.pow(1, 1.4)
    const layerW = w * 0.998
    const layerX = (w - layerW) / 2
    const amp = (h - horizonY) * 0.34 * ampBoost
    const step = Math.floor(data.length / bandCount)
    const hue = (t * 22) % 360
    ctx.save()
    ctx.globalAlpha = 0.14 + wfBass * 0.1
    ctx.beginPath()
    ctx.moveTo(layerX, baseY)
    for (let i = 0; i < bandCount; i++) {
      let sum = 0
      for (let j = 0; j < step; j++) sum += data[i * step + j]
      const v = sum / step / 255
      const px = layerX + (i / (bandCount - 1)) * layerW
      const py = baseY + v * amp * 0.45
      ctx.lineTo(px, py)
    }
    ctx.lineTo(layerX + layerW, baseY)
    ctx.closePath()
    const refGrad = ctx.createLinearGradient(0, baseY, 0, baseY + amp * 0.45)
    refGrad.addColorStop(0, `hsla(${hue}, 100%, 55%, 0.5)`)
    refGrad.addColorStop(1, `hsla(${hue}, 100%, 30%, 0)`)
    ctx.fillStyle = refGrad
    ctx.fill()
    ctx.restore()
  }
}
