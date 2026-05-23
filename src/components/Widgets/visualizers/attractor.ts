import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

// Beat-driven Lorenz: slow continuous pen, bright bursts on beat.
// Silent → nothing drawn. Music plays → line writes at a calm musical pace.

interface Particle { x: number; y: number; z: number; hueBase: number }

const SEEDS: Particle[] = [
  { x: 0.10, y: 0.00, z: 1.00, hueBase:   0 },
  { x: -0.10, y: 0.05, z: 1.20, hueBase: 150 },
  { x: 0.05, y: -0.10, z: 0.90, hueBase: 270 },
  { x: -0.15, y: 0.12, z: 1.05, hueBase:  60 },
  { x: 0.20, y: -0.05, z: 0.80, hueBase: 200 },
]
const particles: Particle[] = SEEDS.map(p => ({ ...p }))

let prevT = -1
let silentDecay = 1
let prevBeat = 0
let beatBurst = 0
let beatHueShift = 0
let bassSmooth = 0
let midsSmooth = 0
let trebSmooth = 0

interface Shock { age: number; hue: number }
const shocks: Shock[] = []

export const drawAttractor: VisualizerRenderer = (ctx, { freqData, w, h, isSilent, beatPulse, t }: VisualizerFrame, _refs: VisualizerRefs) => {
  if (prevT < 0 || t - prevT > 2) {
    for (let i = 0; i < SEEDS.length; i++) particles[i] = { ...SEEDS[i] }
    silentDecay = 1
    prevBeat = 0
    beatBurst = 0
    beatHueShift = 0
    bassSmooth = midsSmooth = trebSmooth = 0
    shocks.length = 0
  }
  prevT = t

  silentDecay = isSilent
    ? Math.min(1, silentDecay + 0.05)
    : Math.max(0, silentDecay - 0.10)

  if (silentDecay >= 0.999) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(0, 0, w, h)
    return
  }

  // Bass
  const bEnd = Math.max(2, Math.floor(freqData.length * 0.06))
  let bSum = 0
  for (let i = 1; i < bEnd; i++) bSum += freqData[i]
  const bass = isSilent ? 0 : bSum / (bEnd - 1) / 255

  // Mids
  const mStart = Math.floor(freqData.length * 0.08)
  const mEnd = Math.floor(freqData.length * 0.32)
  let mSum = 0
  for (let i = mStart; i < mEnd; i++) mSum += freqData[i]
  const mids = isSilent ? 0 : mSum / (mEnd - mStart) / 255

  // Treble
  const tStart = Math.floor(freqData.length * 0.40)
  const tEnd = Math.floor(freqData.length * 0.85)
  let tSum = 0
  for (let i = tStart; i < tEnd; i++) tSum += freqData[i]
  const treb = isSilent ? 0 : tSum / (tEnd - tStart) / 255

  bassSmooth += (bass - bassSmooth) * 0.18
  midsSmooth += (mids - midsSmooth) * 0.18
  trebSmooth += (treb - trebSmooth) * 0.22

  // Beat onset
  const BEAT_ON = 0.45
  let beatHit = false
  if (beatPulse > BEAT_ON && prevBeat <= BEAT_ON) {
    beatBurst = 1.0
    beatHueShift = (beatHueShift + 40) % 360
    beatHit = true
  }
  prevBeat = beatPulse
  beatBurst = Math.max(0, beatBurst - 0.05)

  // Trail fade — slightly faster when silent so dies clean
  const fadeA = 0.05 + silentDecay * 0.12
  ctx.fillStyle = `rgba(0,0,5,${fadeA.toFixed(3)})`
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2
  const sc = Math.min(w, h) / 52
  // Camera breathes with bass; drifts very slowly
  const camY = t * 0.03 + bassSmooth * 0.08
  const camX = 0.22 + midsSmooth * 0.05

  const project = (x3: number, y3: number, z3: number) => {
    const xc = x3, yc = y3, zc = z3 - 25
    const cosY = Math.cos(camY), sinY = Math.sin(camY)
    const rx = xc * cosY + zc * sinY
    const ry = yc
    const rz = -xc * sinY + zc * cosY
    const cosX = Math.cos(camX), sinX = Math.sin(camX)
    const fy = ry * cosX - rz * sinX
    const fz = ry * sinX + rz * cosX
    const p = 420 / (420 + fz * sc * 0.4)
    return { sx: cx + rx * sc * p, sy: cy - fy * sc * p, depth: p }
  }

  // Ambient bass glow — sits behind the lines
  if (bassSmooth > 0.05) {
    const rr = Math.min(w, h) * (0.35 + bassSmooth * 0.25)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr)
    const bAlpha = bassSmooth * 0.10 + beatBurst * 0.06
    g.addColorStop(0, `hsla(${((beatHueShift + 220) % 360).toFixed(0)},90%,55%,${bAlpha.toFixed(3)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  // Spawn shock ring on beat
  if (beatHit) shocks.push({ age: 0, hue: (beatHueShift + 30) % 360 })
  if (shocks.length > 6) shocks.shift()

  // Lorenz params
  const σ = 10 + trebSmooth * 4
  const ρ = 28 + bassSmooth * 6 + beatBurst * 4
  const β = 8 / 3 + midsSmooth * 0.35

  const continuousSteps = Math.floor(10 + midsSmooth * 36 + bassSmooth * 28)
  const burstSteps = Math.floor(beatBurst * 160)
  const totalSteps = continuousSteps + burstSteps
  if (totalSteps <= 0) {
    drawShocks(ctx, cx, cy, w, h)
    return
  }

  const dt = 0.00010 + bassSmooth * 0.00012 + beatBurst * 0.00014

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const part of particles) {
    // Collect projected path then stroke once — smoother + cheaper
    const pts: { sx: number; sy: number; depth: number }[] = []
    pts.push(project(part.x, part.y, part.z))

    for (let s = 0; s < totalSteps; s++) {
      const dx = σ * (part.y - part.x)
      const dy = part.x * (ρ - part.z) - part.y
      const dz = part.x * part.y - β * part.z
      part.x += dx * dt
      part.y += dy * dt
      part.z += dz * dt
      pts.push(project(part.x, part.y, part.z))
    }

    const head = pts[pts.length - 1]
    const hue = (((part.x * 3.5 + part.z * 2) + part.hueBase + beatHueShift + midsSmooth * 80 + trebSmooth * 40) % 360 + 360) % 360
    const lit = 55 + beatBurst * 25 + trebSmooth * 15
    const baseWidth = 0.9 + bassSmooth * 0.8 + beatBurst * 2.8

    // Continuous + burst segments split: dimmer pen, bright arc
    const drawRange = (from: number, to: number, alpha: number, widthMul: number) => {
      if (to - from < 2) return
      ctx.beginPath()
      ctx.moveTo(pts[from].sx, pts[from].sy)
      for (let i = from + 1; i < to - 1; i++) {
        const mx = (pts[i].sx + pts[i + 1].sx) * 0.5
        const my = (pts[i].sy + pts[i + 1].sy) * 0.5
        ctx.quadraticCurveTo(pts[i].sx, pts[i].sy, mx, my)
      }
      ctx.lineTo(pts[to - 1].sx, pts[to - 1].sy)
      // Bloom pass — wide, low alpha
      ctx.strokeStyle = `hsla(${hue.toFixed(0)},95%,${lit.toFixed(0)}%,${(alpha * 0.35).toFixed(3)})`
      ctx.lineWidth = baseWidth * widthMul * 3.2
      ctx.stroke()
      // Sharp pass
      ctx.strokeStyle = `hsla(${hue.toFixed(0)},92%,${(lit + 12).toFixed(0)}%,${alpha.toFixed(3)})`
      ctx.lineWidth = baseWidth * widthMul
      ctx.stroke()
    }

    drawRange(0, continuousSteps + 1, 0.22 + trebSmooth * 0.25, 0.6)
    if (burstSteps > 0) {
      drawRange(continuousSteps, pts.length, 0.65 + beatBurst * 0.25, 1.0)
    }

    // Bass kick dot at start of arc
    if (beatBurst > 0.85 && pts[continuousSteps]) {
      const k = pts[continuousSteps]
      ctx.fillStyle = `hsla(${hue.toFixed(0)},100%,85%,0.95)`
      ctx.beginPath()
      ctx.arc(k.sx, k.sy, 2.4 + bassSmooth * 2.8, 0, Math.PI * 2)
      ctx.fill()
    }

    // Head glow
    const headHue = (((part.x * 3.5 + part.z * 2) + part.hueBase + beatHueShift) % 360 + 360) % 360
    const headR = 1.4 + bassSmooth * 1.6 + beatBurst * 3.8
    ctx.shadowColor = `hsl(${headHue.toFixed(0)},100%,70%)`
    ctx.shadowBlur = 6 + beatBurst * 24 + trebSmooth * 10
    ctx.fillStyle = `hsla(${headHue.toFixed(0)},100%,82%,${(0.75 + beatBurst * 0.25).toFixed(2)})`
    ctx.beginPath()
    ctx.arc(head.sx, head.sy, headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  ctx.restore()

  drawShocks(ctx, cx, cy, w, h)
}

function drawShocks(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  if (shocks.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const maxR = Math.hypot(w, h) * 0.55
  for (let i = shocks.length - 1; i >= 0; i--) {
    const s = shocks[i]
    s.age += 0.04
    if (s.age >= 1) { shocks.splice(i, 1); continue }
    const r = s.age * maxR
    const alpha = (1 - s.age) * 0.45
    ctx.strokeStyle = `hsla(${s.hue.toFixed(0)},100%,72%,${alpha.toFixed(3)})`
    ctx.lineWidth = (1 - s.age) * 2.2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}
