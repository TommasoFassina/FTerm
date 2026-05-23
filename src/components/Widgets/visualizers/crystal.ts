import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

// Hex-grid pillar city. Each column's height = freq band amplitude.
// Slow orbiting camera, depth-sorted, fogged. Spectrum hue across columns.

const COLS = 26
const ROWS = 18
const FOCAL = 900

const getAmp = (freqData: Uint8Array, col: number, row: number, isSilent: boolean): number => {
  if (isSilent) return 0
  const frac = col / COLS * 0.6 + (1 - row / ROWS) * 0.4
  const fi = Math.min(Math.floor(Math.pow(frac, 0.55) * freqData.length * 0.88), freqData.length - 1)
  return freqData[fi] / 255
}

const crystalColor = (col: number, amp: number, brightnessScale: number): string => {
  const hue = (260 - col / COLS * 240 + 360) % 360
  const sat = 80 + amp * 20
  const lit = Math.min(96, (5 + amp * 88) * brightnessScale)
  return `hsl(${hue},${sat}%,${lit}%)`
}

export const drawCrystal: VisualizerRenderer = (ctx, { freqData, w, h, isSilent, beatPulse, t }: VisualizerFrame, _refs: VisualizerRefs) => {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  // Deep vignette
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,8,0.82)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2

  // Static top-down viewpoint — no rotation
  const camRotY = 0
  const camRotX = Math.PI / 2 - 0.001
  // Shorter pillars from above
  const maxPillarH = Math.min(w * 0.18, h * 0.22) * (1 + beatPulse * 0.28)

  // Fit entire COLS×ROWS grid in viewport. Ground-plane scale = FOCAL/(FOCAL*0.55) ≈ 1.818
  const groundScale = 1 / 0.55
  const hexR = Math.min(
    (w * 0.92) / (COLS * Math.sqrt(3) * groundScale),
    (h * 0.92) / (ROWS * 1.5 * groundScale),
  )

  const camFwdX = Math.sin(camRotY)
  const camFwdZ = Math.cos(camRotY)

  const project = (x3: number, y3: number, z3: number) => {
    const cosY = Math.cos(camRotY), sinY = Math.sin(camRotY)
    const rx = x3 * cosY + z3 * sinY
    const ry = y3
    const rz = -x3 * sinY + z3 * cosY
    const cosX = Math.cos(camRotX), sinX = Math.sin(camRotX)
    const fy = ry * cosX - rz * sinX
    const fz = ry * sinX + rz * cosX + FOCAL * 0.55
    const scale = FOCAL / Math.max(fz, 1)
    return { sx: cx + rx * scale, sy: cy - fy * scale, depth: fz, scale }
  }

  const vOff: [number, number][] = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6
    return [hexR * 0.93 * Math.cos(a), hexR * 0.93 * Math.sin(a)]
  })

  interface HexEntry {
    col: number; cx3: number; cz3: number
    amp: number; pillarH: number
    depth: number; fogT: number
  }

  const hexList: HexEntry[] = []

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx3 = (col - COLS / 2 + (row % 2) * 0.5) * hexR * Math.sqrt(3)
      const cz3 = (row - ROWS / 2) * hexR * 1.5

      const amp = getAmp(freqData, col, row, isSilent)
      const idleWave = isSilent
        ? 0.04 * Math.max(0, Math.sin(cx3 * 0.25 + t * 0.55) + Math.sin(cz3 * 0.20 + t * 0.42))
        : 0
      const pillarH = Math.max(0, amp + idleWave) * maxPillarH

      const { depth } = project(cx3, pillarH * 0.5, cz3)
      const fogT = Math.max(0, Math.min(1, (depth / FOCAL - 0.28) * 1.5))

      hexList.push({ col, cx3, cz3, amp, pillarH, depth, fogT })
    }
  }

  hexList.sort((a, b) => b.depth - a.depth)

  for (const hex of hexList) {
    const { col, cx3, cz3, amp, pillarH, fogT } = hex

    const topPts = vOff.map(([dx, dz]) => project(cx3 + dx, pillarH, cz3 + dz))
    const botPts = vOff.map(([dx, dz]) => project(cx3 + dx, 0, cz3 + dz))

    const fogAlpha = 1 - fogT * 0.68

    // Floor tile — tinted by column hue
    ctx.save()
    ctx.globalAlpha = fogAlpha * (amp < 0.02 ? 0.55 : 0.25)
    const floorHue = (260 - col / COLS * 240 + 360) % 360
    ctx.fillStyle = `hsl(${floorHue},60%,6%)`
    ctx.beginPath()
    botPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy))
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Floor glow under tall pillars
    if (amp > 0.3 && fogT < 0.7) {
      ctx.save()
      const gc = botPts[0]
      const glow = ctx.createRadialGradient(gc.sx, gc.sy, 0, gc.sx, gc.sy, hexR * gc.scale * 2.5)
      glow.addColorStop(0, `hsla(${floorHue},100%,55%,${(amp - 0.3) * fogAlpha * 0.35})`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(gc.sx - hexR * gc.scale * 3, gc.sy - hexR * gc.scale * 3, hexR * gc.scale * 6, hexR * gc.scale * 6)
      ctx.restore()
    }

    if (pillarH < 0.5) continue

    // Side faces
    for (let i = 0; i < 6; i++) {
      const next = (i + 1) % 6
      const midX = (vOff[i][0] + vOff[next][0]) / 2
      const midZ = (vOff[i][1] + vOff[next][1]) / 2
      const dot = midX * camFwdX + midZ * camFwdZ
      // Skip culling when looking near-top-down (all sides visible)
      if (camRotX < 1.0 && dot <= 0) continue

      const t0 = topPts[i], t1 = topPts[next]
      const b0 = botPts[i], b1 = botPts[next]

      const sideBright = 0.35 + dot * 0.32
      ctx.save()
      ctx.globalAlpha = fogAlpha
      ctx.fillStyle = crystalColor(col, amp, sideBright)
      ctx.beginPath()
      ctx.moveTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy)
      ctx.lineTo(b1.sx, b1.sy); ctx.lineTo(b0.sx, b0.sy)
      ctx.closePath()
      ctx.fill()

      if (amp > 0.38) {
        ctx.strokeStyle = crystalColor(col, amp, 1.8)
        ctx.lineWidth = 0.5
        ctx.globalAlpha = fogAlpha * (amp - 0.38) * 1.1
        ctx.stroke()
      }
      ctx.restore()
    }

    // Top face
    ctx.save()
    ctx.globalAlpha = fogAlpha
    if (amp > 0.35) {
      const sc = topPts[0].scale
      ctx.shadowColor = crystalColor(col, amp, 2.0)
      ctx.shadowBlur = amp * 22 * Math.min(sc, 1.8)
    }
    ctx.fillStyle = crystalColor(col, amp, 1.05)
    ctx.beginPath()
    topPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy))
    ctx.closePath()
    ctx.fill()

    // Sparkle on very tall pillars
    if (amp > 0.72 && fogT < 0.5) {
      const tc = topPts[0]
      ctx.shadowColor = '#fff'
      ctx.shadowBlur = 20
      ctx.fillStyle = `rgba(255,255,255,${(amp - 0.72) * 2.2 * fogAlpha})`
      ctx.beginPath()
      ctx.arc(tc.sx, tc.sy, 1.5 * tc.scale, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.shadowBlur = 0
    ctx.restore()
  }
}
