import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

let _glowCanvas: HTMLCanvasElement | null = null
let _haloGrad: CanvasGradient | null = null
let _haloGradT = -999
let _haloW = 0, _haloH = 0

export const drawKaleid: VisualizerRenderer = (ctx, { freqData, w, h, beatPulse, t }: VisualizerFrame, _refs: VisualizerRefs) => {
  const cx = w / 2, cy = h / 2
  const arms = 8
  const barsPerArm = 56
  const step = Math.max(1, Math.floor(freqData.length / barsPerArm))
  const maxLen = Math.min(w, h) * 0.46
  const minLen = Math.min(w, h) * 0.04
  const pulse = beatPulse
  const TWO_PI = Math.PI * 2
  const armSlice = TWO_PI / arms

  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.fillRect(0, 0, w, h)

  // Recreate halo gradient only every 0.5 s — avoids per-frame allocation
  if (t - _haloGradT > 0.5 || !_haloGrad || _haloW !== w || _haloH !== h) {
    _haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxLen * 1.1)
    _haloGrad.addColorStop(0, `hsla(${(t * 35) % 360}, 80%, 12%, 1)`)
    _haloGrad.addColorStop(0.5, `hsla(${(t * 35 + 120) % 360}, 60%, 6%, 1)`)
    _haloGrad.addColorStop(1, 'rgba(0,0,0,1)')
    _haloGradT = t
    _haloW = w; _haloH = h
  }
  ctx.fillStyle = _haloGrad
  ctx.fillRect(0, 0, w, h)

  // Offscreen canvas for single draw pass — composite twice (blurred glow + sharp)
  if (!_glowCanvas) _glowCanvas = document.createElement('canvas')
  if (_glowCanvas.width !== w || _glowCanvas.height !== h) {
    _glowCanvas.width = w; _glowCanvas.height = h
  }
  const gctx = _glowCanvas.getContext('2d')!
  gctx.clearRect(0, 0, w, h)

  const barWidth = Math.max(1, (Math.PI * 2 * minLen / barsPerArm) * 0.65)
  gctx.lineCap = 'round'
  gctx.lineWidth = barWidth

  // Single draw loop — no save/restore, coordinates via trig
  for (let arm = 0; arm < arms; arm++) {
    const armRot = (arm / arms) * TWO_PI + t * 0.08
    const sign = arm % 2 === 1 ? -1 : 1
    for (let bi = 0; bi < barsPerArm; bi++) {
      let sum = 0
      const base = bi * step
      for (let j = 0; j < step; j++) sum += freqData[base + j]
      const v = sum / step / 255
      if (v < 0.01) continue

      const len = minLen + v * (maxLen - minLen) * (1 + pulse * 0.6)
      const hue = (bi / barsPerArm * 320 + t * 55 + arm * 45) % 360
      const brightness = 50 + v * 40
      const alpha = 0.6 + v * 0.4
      const barAngle = ((bi + 0.5) / barsPerArm - 0.5) * armSlice
      const totalAngle = armRot + sign * barAngle
      const cosA = Math.cos(totalAngle)
      const sinA = Math.sin(totalAngle)

      gctx.strokeStyle = `hsla(${hue}, 100%, ${brightness}%, ${alpha})`
      gctx.beginPath()
      gctx.moveTo(cx + minLen * cosA, cy + minLen * sinA)
      gctx.lineTo(cx + len * cosA, cy + len * sinA)
      gctx.stroke()
    }
  }

  // Blurred composite → glow effect (replaces per-stroke shadowBlur)
  const blurPx = Math.round(8 + pulse * 12)
  ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(_glowCanvas, 0, 0)
  ctx.filter = 'none'

  // Sharp composite on top
  ctx.drawImage(_glowCanvas, 0, 0)

  // Center jewel
  const jewel = ctx.createRadialGradient(cx, cy, 0, cx, cy, minLen * 1.5 + pulse * 20)
  jewel.addColorStop(0, `hsla(${(t * 100) % 360}, 100%, 95%, ${0.5 + pulse * 0.5})`)
  jewel.addColorStop(0.4, `hsla(${(t * 100 + 120) % 360}, 100%, 60%, ${0.3 + pulse * 0.3})`)
  jewel.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = jewel
  ctx.beginPath()
  ctx.arc(cx, cy, minLen * 1.5 + pulse * 20, 0, TWO_PI)
  ctx.fill()
}
