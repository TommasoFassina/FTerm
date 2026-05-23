import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

export const drawWarp: VisualizerRenderer = (ctx, { freqData, canvas, w, h, isSilent, beatPulse }: VisualizerFrame, refs: VisualizerRefs) => {
  const warp = refs.warpRef.current
  let pc = warp.canvas
  if (!pc || pc.width !== Math.floor(w) || pc.height !== Math.floor(h)) {
    pc = document.createElement('canvas')
    pc.width = Math.max(1, Math.floor(w))
    pc.height = Math.max(1, Math.floor(h))
    warp.canvas = pc
    const initCtx = pc.getContext('2d')!
    initCtx.fillStyle = '#000006'
    initCtx.fillRect(0, 0, pc.width, pc.height)
  }
  if (!isSilent) warp.rot += 0.004 + beatPulse * 0.06
  const rot = warp.rot
  const cx = w / 2, cy = h / 2
  if (isSilent) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.fillRect(0, 0, w, h)
    if (pc) pc.getContext('2d')!.drawImage(canvas, 0, 0, pc.width, pc.height)
  } else {
    const zoom = 1.025 + beatPulse * 0.09
    ctx.fillStyle = `rgba(0,0,0,${0.06 + beatPulse * 0.04})`
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.globalAlpha = 0.94
    ctx.translate(cx, cy)
    ctx.scale(zoom, zoom)
    const over = 1.5
    if (pc) ctx.drawImage(pc, -w * over / 2, -h * over / 2, w * over, h * over)
    ctx.restore()
    const arms = 5
    const turns = 2.4
    const bins = 180
    const step = Math.floor(freqData.length / bins)
    const t = performance.now() / 1000
    for (let arm = 0; arm < arms; arm++) {
      const armPhase = (arm / arms) * Math.PI * 2 + rot
      ctx.beginPath()
      for (let i = 0; i < bins; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += freqData[i * step + j]
        const v = sum / step / 255
        const prog = i / bins
        const ang = armPhase + prog * Math.PI * 2 * turns + Math.sin(t + prog * 6) * 0.2
        const rad = prog * Math.min(w, h) * 0.48 * (1 + v * 0.8 + beatPulse * 0.4)
        const px = cx + Math.cos(ang) * rad
        const py = cy + Math.sin(ang) * rad
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      const hue = (arm * 72 + t * 50) % 360
      ctx.strokeStyle = `hsl(${hue}, 100%, ${60 + beatPulse * 30}%)`
      ctx.lineWidth = 1.6 + beatPulse * 4
      ctx.shadowColor = `hsl(${hue}, 100%, 65%)`
      ctx.shadowBlur = 14 + beatPulse * 24
      ctx.stroke()
    }
    const coreR = 10 + beatPulse * 90
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    coreGrad.addColorStop(0, `hsla(${(t * 80) % 360}, 100%, 70%, ${0.5 + beatPulse * 0.5})`)
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = coreGrad
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    if (pc) pc.getContext('2d')!.drawImage(canvas, 0, 0, pc.width, pc.height)
  }
}
