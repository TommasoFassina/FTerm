import type { VisualizerFrame, VisualizerRefs, VisualizerRenderer } from './types'

const PARTICLE_COUNT = 600

export const drawNebula: VisualizerRenderer = (ctx, { freqData, w, h, isSilent, beatPulse, t }: VisualizerFrame, refs: VisualizerRefs) => {
  const particles = refs.nebulaRef.current
  const shocks = refs.nebulaShockRef.current
  const cx = w / 2, cy = h / 2

  const nbins = freqData.length
  let bassSum = 0, midSum = 0, trebSum = 0
  const bassEnd = Math.floor(nbins * 0.08)
  const midEnd = Math.floor(nbins * 0.35)
  for (let i = 1; i < bassEnd; i++) bassSum += freqData[i]
  for (let i = bassEnd; i < midEnd; i++) midSum += freqData[i]
  for (let i = midEnd; i < nbins; i++) trebSum += freqData[i]
  const bass = isSilent ? 0 : bassSum / (bassEnd - 1) / 255
  const mid = isSilent ? 0 : midSum / (midEnd - bassEnd) / 255
  const treble = isSilent ? 0 : trebSum / (nbins - midEnd) / 255
  const pulse = isSilent ? 0 : beatPulse

  const nb = refs.nebulaBassRef.current
  nb.avg = nb.avg * 0.82 + bass * 0.18
  const now = performance.now()
  const baseHue = refs.coverHueRef.current ?? (t * 60) % 360
  if (bass > nb.avg * 1.1 && bass > 0.10 && now - nb.last > 120) {
    nb.last = now
    const ringCount = bass > 0.5 ? 3 : 2
    for (let ri = 0; ri < ringCount; ri++) {
      shocks.push({ r: ri * 12, alpha: Math.min(1, 0.75 + bass * 0.5), hue: (baseHue + ri * 40 + Math.random() * 30 - 15 + 360) % 360 })
    }
    const burst = 24 + Math.floor(bass * 60)
    for (let i = 0; i < burst && particles.length < PARTICLE_COUNT + 200; i++) {
      const ra = Math.random() * Math.PI * 2
      const rs = 4 + Math.random() * 5 + bass * 8
      particles.push({
        x: cx, y: cy, px: cx, py: cy,
        vx: Math.cos(ra) * rs, vy: Math.sin(ra) * rs,
        hue: (baseHue + (i % 2 === 0 ? 0 : 150) + Math.random() * 60 - 30 + 360) % 360,
        size: 1.6 + Math.random() * 2.8,
        age: 0, band: 0,
      })
    }
  }
  if (treble > 0.28 && Math.random() < treble * 0.55) {
    const sparkCount = 3 + Math.floor(treble * 6)
    for (let i = 0; i < sparkCount; i++) {
      const ra = Math.random() * Math.PI * 2
      const rd = 40 + Math.random() * Math.min(w, h) * 0.38
      particles.push({
        x: cx + Math.cos(ra) * rd, y: cy + Math.sin(ra) * rd,
        px: cx + Math.cos(ra) * rd, py: cy + Math.sin(ra) * rd,
        vx: Math.cos(ra) * (1.5 + treble * 4), vy: Math.sin(ra) * (1.5 + treble * 4),
        hue: (baseHue + 180 + Math.random() * 80) % 360,
        size: 0.6 + Math.random() * 1.5, age: 0, band: 1,
      })
    }
  }

  const bgR = Math.max(w, h) * (0.65 + bass * 0.45)
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, bgR)
  const bgHue = (baseHue + t * 10) % 360
  bgGrad.addColorStop(0, `hsla(${bgHue}, 90%, ${6 + bass * 18}%, 1)`)
  bgGrad.addColorStop(0.35, `hsla(${(bgHue + 120) % 360}, 80%, ${3 + bass * 9}%, 1)`)
  bgGrad.addColorStop(0.7, `hsla(${(bgHue + 240) % 360}, 70%, ${1 + bass * 5}%, 1)`)
  bgGrad.addColorStop(1, 'rgba(0,0,4,1)')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, w, h)

  const cov = refs.coverBitmapRef.current ?? refs.coverImgRef.current
  if (cov && (cov instanceof ImageBitmap || ((cov as HTMLImageElement).complete && (cov as HTMLImageElement).naturalWidth > 0))) {
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip()
    ctx.globalAlpha = 0.12 + bass * 0.18
    ctx.filter = `blur(${22 - bass * 8}px) saturate(1.4)`
    const cs = Math.min(w, h) * (0.55 + bass * 0.25 + pulse * 0.1)
    ctx.drawImage(cov, cx - cs / 2, cy - cs / 2, cs, cs)
    ctx.restore()
  }
  ctx.fillStyle = `rgba(0,0,2,${Math.max(0.04, 0.14 - mid * 0.08 - bass * 0.07)})`
  ctx.fillRect(0, 0, w, h)

  ctx.globalCompositeOperation = 'lighter'
  for (let i = shocks.length - 1; i >= 0; i--) {
    const s = shocks[i]
    s.r += 8 + s.r * 0.055
    s.alpha *= 0.93
    if (s.alpha < 0.02 || s.r > Math.max(w, h) * 1.2) { shocks.splice(i, 1); continue }
    ctx.strokeStyle = `hsla(${s.hue}, 100%, 72%, ${s.alpha})`
    ctx.lineWidth = 2.5 + s.alpha * 4
    ctx.shadowColor = `hsl(${s.hue}, 100%, 75%)`
    ctx.shadowBlur = 24 * s.alpha
    ctx.beginPath()
    ctx.arc(cx, cy, s.r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.shadowBlur = 0

  while (!isSilent && particles.length < PARTICLE_COUNT) {
    const ang = Math.random() * Math.PI * 2
    const dist = 30 + Math.random() * Math.min(w, h) * 0.45
    const spd = 0.3 + Math.random() * 1.2
    const x = cx + Math.cos(ang) * dist
    const y = cy + Math.sin(ang) * dist
    particles.push({
      x, y, px: x, py: y,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      hue: Math.random() * 360,
      size: 0.7 + Math.random() * 2,
      age: Math.floor(Math.random() * 200),
      band: Math.random(),
    })
  }

  if (isSilent) {
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.vx *= 0.88; p.vy *= 0.88
      p.x += p.vx; p.y += p.vy
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      if (speed < 0.05) continue
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
      grd.addColorStop(0, `hsla(${p.hue}, 100%, 70%, 0.3)`)
      grd.addColorStop(1, 'hsla(0,0%,0%,0)')
      ctx.fillStyle = grd
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  } else {
    const sectors = 64
    const step2 = Math.max(1, Math.floor(nbins / sectors))
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.px = p.x; p.py = p.y
      const dx = p.x - cx, dy = p.y - cy
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const ang = Math.atan2(dy, dx)
      const sector = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * sectors)
      let bandSum = 0
      for (let j = 0; j < step2; j++) bandSum += freqData[sector * step2 + j] || 0
      const bandE = bandSum / step2 / 255

      const radial = bass * 3.0 + bandE * 1.6 + pulse * 2.2
      p.vx += (dx / dist) * radial * 0.07
      p.vy += (dy / dist) * radial * 0.07
      const swirl = 0.008 + mid * 0.2
      p.vx += -dy / dist * swirl
      p.vy += dx / dist * swirl
      if (treble > 0.1) {
        p.vx += (Math.random() - 0.5) * treble * 1.8
        p.vy += (Math.random() - 0.5) * treble * 1.8
      }
      const grav = 0.006 - bass * 0.0055
      p.vx = p.vx * 0.978 - dx * grav
      p.vy = p.vy * 0.978 - dy * grav
      p.x += p.vx
      p.y += p.vy
      p.age++
      p.hue = (p.hue + 0.3 + bandE * 3 + treble * 2) % 360

      if (Math.abs(p.x - cx) > w * 0.75 || Math.abs(p.y - cy) > h * 0.75 || p.age > 320) {
        const ra = Math.random() * Math.PI * 2
        const rs = 0.4 + Math.random() * 1.4
        const rd = 25 + Math.random() * Math.min(w, h) * 0.35
        p.x = cx + Math.cos(ra) * rd
        p.y = cy + Math.sin(ra) * rd
        p.px = p.x; p.py = p.y
        p.vx = Math.cos(ra) * rs
        p.vy = Math.sin(ra) * rs
        p.hue = Math.random() * 360
        p.age = 0
      }

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      const brightness = 52 + Math.min(speed * 16, 38)
      const alpha = Math.min(0.98, 0.5 + speed * 0.12 + bandE * 0.5 + pulse * 0.3)
      const r2 = p.size * (1 + pulse * 0.9 + bass * 0.7)

      if (speed > 0.4) {
        ctx.strokeStyle = `hsla(${p.hue}, 100%, ${brightness}%, ${alpha * 0.65})`
        ctx.lineWidth = r2 * 1.0
        ctx.beginPath()
        ctx.moveTo(p.px, p.py)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r2 * 3)
      grd.addColorStop(0, `hsla(${p.hue}, 100%, ${brightness + 25}%, ${alpha})`)
      grd.addColorStop(0.4, `hsla(${p.hue}, 100%, ${brightness}%, ${alpha * 0.5})`)
      grd.addColorStop(1, 'hsla(0,0%,0%,0)')
      ctx.fillStyle = grd
      ctx.beginPath()
      ctx.arc(p.x, p.y, r2 * 3, 0, Math.PI * 2)
      ctx.fill()
    }

    if (particles.length > PARTICLE_COUNT + 60) particles.splice(0, particles.length - PARTICLE_COUNT)

    const coreR = 10 + (bass * 1.5 + pulse) * 65
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    cg.addColorStop(0, `hsla(${(t * 90) % 360}, 100%, 98%, ${0.55 + bass * 0.45})`)
    cg.addColorStop(0.3, `hsla(${(t * 90 + 60) % 360}, 100%, 75%, ${0.35 + bass * 0.45})`)
    cg.addColorStop(0.7, `hsla(${(t * 90 + 160) % 360}, 100%, 50%, ${0.15 + bass * 0.2})`)
    cg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }
}
