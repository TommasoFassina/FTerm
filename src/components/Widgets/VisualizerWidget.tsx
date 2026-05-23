import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '@/store'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { X, Play, Pause, Music, Volume2, VolumeX, Maximize2, Minimize2, FolderOpen, SkipBack, SkipForward, Shuffle, Repeat, ListMusic, Trash2, ChevronLeft, ChevronRight, Folder, Loader2 } from 'lucide-react'
import { RENDERER_MAP } from './visualizers'
import type { Style, VisualizerRefs } from './visualizers'

type Source = 'file' | null

async function extractCover(buffer: ArrayBuffer): Promise<{ mime: string; data: Uint8Array } | null> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const ver = bytes[3]
    const flags = bytes[5]
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
    let off = 10
    if (flags & 0x40) {
      const ehSize = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]
      off += ehSize
    }
    const end = Math.min(10 + tagSize, bytes.length)
    while (off < end - 10) {
      const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3])
      if (id === '\0\0\0\0' || !/^[A-Z0-9]{4}$/.test(id)) break
      let fsize: number
      if (ver === 4) {
        fsize = ((bytes[off + 4] & 0x7f) << 21) | ((bytes[off + 5] & 0x7f) << 14) | ((bytes[off + 6] & 0x7f) << 7) | (bytes[off + 7] & 0x7f)
      } else {
        fsize = (bytes[off + 4] << 24) | (bytes[off + 5] << 16) | (bytes[off + 6] << 8) | bytes[off + 7]
      }
      const fstart = off + 10
      if (id === 'APIC' && fsize > 0 && fstart + fsize <= bytes.length) {
        let p = fstart
        const enc = bytes[p++]
        let mEnd = p
        while (mEnd < fstart + fsize && bytes[mEnd] !== 0) mEnd++
        const mime = new TextDecoder('ascii').decode(bytes.subarray(p, mEnd))
        p = mEnd + 1
        p++ // picture type
        if (enc === 1 || enc === 2) {
          while (p < fstart + fsize - 1 && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2
          p += 2
        } else {
          while (p < fstart + fsize && bytes[p] !== 0) p++
          p++
        }
        return { mime: mime || 'image/jpeg', data: bytes.subarray(p, fstart + fsize) }
      }
      off = fstart + fsize
    }
  }
  if (bytes.length > 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
    let off = 4
    while (off + 4 < bytes.length) {
      const header = bytes[off]
      const last = (header & 0x80) !== 0
      const type = header & 0x7f
      const size = (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]
      off += 4
      if (type === 6 && off + size <= bytes.length) {
        let p = off + 4
        const mimeLen = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
        p += 4
        const mime = new TextDecoder('ascii').decode(bytes.subarray(p, p + mimeLen))
        p += mimeLen
        const descLen = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
        p += 4 + descLen + 16
        const dataLen = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
        p += 4
        return { mime, data: bytes.subarray(p, p + dataLen) }
      }
      off += size
      if (last) break
    }
  }
  // MP4/M4A: moov→udta→meta→ilst→covr→data atom tree
  {
    const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o+1] << 16) | (bytes[o+2] << 8) | bytes[o+3]) >>> 0
    const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o+1], bytes[o+2], bytes[o+3])
    const findAtom = (start: number, end: number, target: string): number => {
      let o = start
      while (o + 8 <= end && o + 8 <= bytes.length) {
        const sz = u32(o)
        if (sz < 8) break
        if (tag(o + 4) === target) return o
        o += sz
      }
      return -1
    }
    const moovOff = findAtom(0, bytes.length, 'moov')
    if (moovOff >= 0) {
      const moovSz = u32(moovOff)
      const moovEnd = moovOff + moovSz
      const udtaOff = findAtom(moovOff + 8, moovEnd, 'udta')
      if (udtaOff >= 0) {
        const udtaEnd = udtaOff + u32(udtaOff)
        const metaOff = findAtom(udtaOff + 8, udtaEnd, 'meta')
        if (metaOff >= 0) {
          const metaEnd = metaOff + u32(metaOff)
          const ilstOff = findAtom(metaOff + 12, metaEnd, 'ilst') // +12: skip 8-byte header + 4-byte version/flags
          if (ilstOff >= 0) {
            const ilstEnd = ilstOff + u32(ilstOff)
            const covrOff = findAtom(ilstOff + 8, ilstEnd, 'covr')
            if (covrOff >= 0) {
              const covrEnd = covrOff + u32(covrOff)
              const dataOff = findAtom(covrOff + 8, covrEnd, 'data')
              if (dataOff >= 0 && dataOff + 16 <= bytes.length) {
                const dataEnd = dataOff + u32(dataOff)
                const typeIndicator = u32(dataOff + 8) // 13=JPEG, 14=PNG
                const mime = typeIndicator === 14 ? 'image/png' : 'image/jpeg'
                return { mime, data: bytes.subarray(dataOff + 16, dataEnd) }
              }
            }
          }
        }
      }
    }
  }
  return null
}

interface TrackMeta {
  title?: string
  artist?: string
  album?: string
  track?: number
}

function extractTextMeta(bytes: Uint8Array): TrackMeta {
  const meta: TrackMeta = {}
  try {
    // ID3v2
    if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const ver = bytes[3]
      const flags = bytes[5]
      const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
      let off = 10
      if (flags & 0x40) { const eh = (bytes[off] << 24) | (bytes[off+1] << 16) | (bytes[off+2] << 8) | bytes[off+3]; off += eh }
      const end = Math.min(10 + tagSize, bytes.length)
      const dec = (data: Uint8Array, enc: number) => {
        try {
          const s = new TextDecoder(enc === 1 || enc === 2 ? 'utf-16' : enc === 3 ? 'utf-8' : 'latin1').decode(data)
          return s.replace(/\0+$/, '').trim()
        } catch { return '' }
      }
      while (off < end - 10) {
        const id = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3])
        if (!/^[A-Z0-9]{4}$/.test(id)) break
        const fsize = ver === 4
          ? ((bytes[off+4] & 0x7f) << 21) | ((bytes[off+5] & 0x7f) << 14) | ((bytes[off+6] & 0x7f) << 7) | (bytes[off+7] & 0x7f)
          : (bytes[off+4] << 24) | (bytes[off+5] << 16) | (bytes[off+6] << 8) | bytes[off+7]
        const fstart = off + 10
        if (fsize <= 0) break
        if (fstart + fsize <= bytes.length && ['TIT2','TPE1','TALB','TRCK'].includes(id)) {
          const text = dec(bytes.subarray(fstart + 1, fstart + fsize), bytes[fstart])
          if (id === 'TIT2') meta.title = text
          else if (id === 'TPE1') meta.artist = text
          else if (id === 'TALB') meta.album = text
          else if (id === 'TRCK') meta.track = parseInt(text) || undefined
        }
        off = fstart + fsize
      }
      return meta
    }
    // FLAC VORBIS_COMMENT (type 4)
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      let off = 4
      while (off + 4 < bytes.length) {
        const header = bytes[off]; const last = (header & 0x80) !== 0; const type = header & 0x7f
        const size = (bytes[off+1] << 16) | (bytes[off+2] << 8) | bytes[off+3]
        off += 4
        if (type === 4 && off + size <= bytes.length) {
          let p = off
          const vLen = bytes[p] | (bytes[p+1] << 8) | (bytes[p+2] << 16) | (bytes[p+3] << 24)
          p += 4 + vLen
          if (p + 4 <= off + size) {
            const count = bytes[p] | (bytes[p+1] << 8) | (bytes[p+2] << 16) | (bytes[p+3] << 24)
            p += 4
            for (let i = 0; i < count && p + 4 <= off + size; i++) {
              const len = bytes[p] | (bytes[p+1] << 8) | (bytes[p+2] << 16) | (bytes[p+3] << 24)
              p += 4
              if (len > 0 && p + len <= off + size) {
                const s = new TextDecoder('utf-8').decode(bytes.subarray(p, p + len))
                const eq = s.indexOf('=')
                if (eq > 0) {
                  const k = s.slice(0, eq).toUpperCase(); const v = s.slice(eq + 1)
                  if (k === 'TITLE') meta.title = v
                  else if (k === 'ARTIST') meta.artist = v
                  else if (k === 'ALBUM') meta.album = v
                  else if (k === 'TRACKNUMBER') meta.track = parseInt(v) || undefined
                }
              }
              p += len
            }
          }
          return meta
        }
        off += size
        if (last) break
      }
    }
  } catch {}
  return meta
}

interface Track {
  path: string
  name: string
  meta?: TrackMeta
}

const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'weba', 'webm'])

interface Props {
  onClose: () => void
  initialPath?: string
}

function pathToFtermUrl(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return `fterm://local/${encodeURI(norm)}`
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

const FFT_SIZE = 512

export default function VisualizerWidget({ onClose, initialPath }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const beatRef = useRef({ avg: 0, lastBeat: 0, intervals: [] as number[], rhythmTimer: null as ReturnType<typeof setInterval> | null, moveIdx: 0 })
  const warpRef = useRef<{ canvas: HTMLCanvasElement | null; rot: number }>({ canvas: null, rot: 0 })
  const nebulaRef = useRef<{ x: number; y: number; px: number; py: number; vx: number; vy: number; hue: number; size: number; age: number; band: number }[]>([])
  const nebulaShockRef = useRef<{ r: number; alpha: number; hue: number }[]>([])
  const nebulaBassRef = useRef({ avg: 0, last: 0 })
  const coverHueRef = useRef<number | null>(null)
  const coverImgRef = useRef<HTMLImageElement | null>(null)
  const coverBitmapRef = useRef<ImageBitmap | null>(null)
  const coverUrlRef = useRef<string | null>(null)
  const waterfallRef = useRef<{ history: Uint8Array[]; max: number }>({ history: [], max: 60 })
  const beatPulseRef = useRef(0)

  const [showVizWarning, setShowVizWarning] = useState(() => !localStorage.getItem('fterm-viz-warned'))
  const [source, setSource] = useState<Source>(null)
  const [style, setStyle] = useState<Style>('waterfall3d')
  const [playing, setPlaying] = useState(false)
  const [trackName, setTrackName] = useState<string>('')
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { settings } = useStore()
  const petVibe = settings.vizPetVibe !== false
  const [floating, setFloating] = useState(false)
  const [pos, setPos] = useState(() => ({
    x: Math.max(40, (window.innerWidth - 640) / 2),
    y: Math.max(40, (window.innerHeight - 480) / 2),
  }))
  const [size, setSize] = useState({ w: 640, h: 480 })
  const [volume, setVolume] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('fterm-viz-volume') || '0.8')
    return isNaN(saved) ? 0.8 : Math.min(1, Math.max(0, saved))
  })
  const [muted, setMuted] = useState(false)
  const [queue, setQueue] = useState<Track[]>([])
  const [queueIdx, setQueueIdx] = useState(-1)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<'none' | 'one' | 'all'>('none')
  const [currentMeta, setCurrentMeta] = useState<TrackMeta>({})
  const [showLibrary, setShowLibrary] = useState(false)
  const [libRoot, setLibRoot] = useState<string>(() => localStorage.getItem('fterm-viz-libroot') || '')
  const [libPath, setLibPath] = useState<string[]>([])
  const [libItems, setLibItems] = useState<{ name: string; isDir: boolean }[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [libFolderCovers, setLibFolderCovers] = useState<Record<string, string>>({})

  const winDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  const ensureCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      audioCtxRef.current = new Ctx()
      const a = audioCtxRef.current.createAnalyser()
      a.fftSize = FFT_SIZE
      a.smoothingTimeConstant = 0.82
      analyserRef.current = a
    }
    return audioCtxRef.current!
  }, [])

  const teardownSource = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    try { sourceRef.current?.disconnect() } catch {}
    sourceRef.current = null
    if (audioElRef.current) {
      const el = audioElRef.current
      el.onerror = null
      el.onended = null
      el.onpause = null
      el.onplay = null
      el.pause()
      el.removeAttribute('src')
      el.load()
      audioElRef.current = null
    }
    const b = beatRef.current
    if (b.rhythmTimer) { clearInterval(b.rhythmTimer); b.rhythmTimer = null }
    b.intervals = []
    b.avg = 0
    b.lastBeat = 0
    warpRef.current = { canvas: null, rot: 0 }
    nebulaRef.current = []
    if (coverUrlRef.current) { URL.revokeObjectURL(coverUrlRef.current); coverUrlRef.current = null }
    coverImgRef.current = null
    coverBitmapRef.current?.close(); coverBitmapRef.current = null
    coverHueRef.current = null
    waterfallRef.current = { history: [], max: 60 }
    beatPulseRef.current = 0
    window.dispatchEvent(new CustomEvent('pet:vibe-off'))
    setPlaying(false)
    setCurrentMeta({})
    setCoverDataUrl(null)
  }, [])

  useEffect(() => {
    return () => {
      teardownSource()
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [teardownSource])

  const loadCoverImg = (src: string, mimeHint?: string): Promise<boolean> => new Promise(resolve => {
    const img = new Image()
    if (src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.onload = () => {
      console.log('[viz] cover img loaded:', src.slice(0, 60), 'size:', img.naturalWidth, 'x', img.naturalHeight)
      if (coverUrlRef.current && coverUrlRef.current !== src) URL.revokeObjectURL(coverUrlRef.current)
      coverUrlRef.current = src.startsWith('blob:') ? src : null
      coverImgRef.current = img
      createImageBitmap(img).then(bm => { coverBitmapRef.current = bm; console.log('[viz] ImageBitmap created') }).catch((e) => { console.warn('[viz] ImageBitmap failed:', e) })
      setCoverDataUrl(src)
      try {
        const sc = document.createElement('canvas')
        sc.width = 32; sc.height = 32
        const sctx = sc.getContext('2d')!
        sctx.drawImage(img, 0, 0, 32, 32)
        const px = sctx.getImageData(0, 0, 32, 32).data
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < px.length; i += 4) {
          const pr = px[i], pg = px[i + 1], pb = px[i + 2]
          const mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb)
          if (mx - mn < 30) continue
          r += pr; g += pg; b += pb; n++
        }
        if (n > 10) {
          r /= n; g /= n; b /= n
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
          let h = 0
          if (d > 0) {
            if (mx === r) h = ((g - b) / d) % 6
            else if (mx === g) h = (b - r) / d + 2
            else h = (r - g) / d + 4
            h = (h * 60 + 360) % 360
          }
          coverHueRef.current = h
        }
      } catch {}
      resolve(true)
    }
    img.onerror = (e) => { console.error('[viz] cover img error:', e, src.slice(0, 80)); if (src.startsWith('blob:')) URL.revokeObjectURL(src); resolve(false) }
    img.src = src
    void mimeHint
  })

  const loadCoverFromBuffer = async (buf: ArrayBuffer): Promise<boolean> => {
    try {
      const cov = await extractCover(buf)
      if (!cov) return false
      const blob = new Blob([cov.data.slice().buffer], { type: cov.mime })
      const u = URL.createObjectURL(blob)
      return await loadCoverImg(u, cov.mime)
    } catch { return false }
  }

  const loadCoverFromFolder = async (filePath: string): Promise<boolean> => {
    const sep = filePath.includes('\\') ? '\\' : '/'
    const dir = filePath.substring(0, filePath.lastIndexOf(sep))
    if (!dir) return false
    const candidates = ['cover', 'folder', 'album', 'front', 'artwork']
    const exts = ['jpg', 'jpeg', 'png', 'webp']
    for (const name of candidates) {
      for (const ext of exts) {
        try {
          const imgPath = dir + sep + name + '.' + ext
          const res = await window.fterm.fsReadImage(imgPath)
          if (res) {
            const dataUrl = `data:${res.mime};base64,${res.base64}`
            if (await loadCoverImg(dataUrl, res.mime)) return true
          }
        } catch { /* not found */ }
      }
    }
    try {
      const dirResult = await window.fterm.fsReadDir(dir)
      if (!dirResult.error) {
        const imgExts = new Set(['jpg', 'jpeg', 'png', 'webp'])
        const imgFile = dirResult.entries.find(e => !e.isDir && imgExts.has(e.name.split('.').pop()?.toLowerCase() ?? ''))
        if (imgFile) {
          const res = await window.fterm.fsReadImage(dir + sep + imgFile.name)
          if (res) {
            const dataUrl = `data:${res.mime};base64,${res.base64}`
            if (await loadCoverImg(dataUrl, res.mime)) return true
          }
        }
      }
    } catch { /* ignore */ }
    return false
  }

  const fetchFileInfo = async (url: string, filePath?: string) => {
    try {
      const headRes = await fetch(url, { headers: { Range: 'bytes=0-9' } })
      const headBuf = await headRes.arrayBuffer()
      const h = new Uint8Array(headBuf)
      let fetchEnd = 2097151
      if (h.length >= 10 && h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) {
        const tagSize = ((h[6] & 0x7f) << 21) | ((h[7] & 0x7f) << 14) | ((h[8] & 0x7f) << 7) | (h[9] & 0x7f)
        fetchEnd = Math.max(fetchEnd, 10 + tagSize - 1)
      }
      const res = await fetch(url, { headers: { Range: `bytes=0-${fetchEnd}` } })
      const buf = await res.arrayBuffer()
      const hasEmbedded = await loadCoverFromBuffer(buf)
      console.log('[viz] cover: embedded=', hasEmbedded, 'filePath=', filePath)
      if (!hasEmbedded && filePath) {
        const fromFolder = await loadCoverFromFolder(filePath)
        console.log('[viz] cover: fromFolder=', fromFolder)
      }
      setCurrentMeta(extractTextMeta(new Uint8Array(buf)))
    } catch (e) { console.error('[viz] fetchFileInfo failed:', e) }
  }

  const playUrl = async (url: string, name: string) => {
    setError(null)
    teardownSource()
    const ctx = ensureCtx()
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch { /* ignore */ }
    }
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.volume = muted ? 0 : volume
    el.src = url
    audioElRef.current = el
    try {
      const node = ctx.createMediaElementSource(el)
      try { analyserRef.current!.disconnect() } catch {}
      node.connect(analyserRef.current!)
      analyserRef.current!.connect(ctx.destination)
      sourceRef.current = node
      setSource('file')
      setTrackName(name)
      el.onended = () => { setPlaying(false); advance(1); window.dispatchEvent(new CustomEvent('pet:vibe-off')) }
      el.onerror = () => setError(`Failed to load: ${el.error?.message ?? 'unknown error'}`)
      el.onpause = () => {
        const bb = beatRef.current
        if (bb.rhythmTimer) { clearInterval(bb.rhythmTimer); bb.rhythmTimer = null }
        window.dispatchEvent(new CustomEvent('pet:vibe-off'))
      }
      el.onplay = () => { if (petVibeRef.current) window.dispatchEvent(new CustomEvent('pet:vibe-on')) }
      try {
        await el.play()
        setPlaying(true)
      } catch (e: any) {
        setError(e.message || 'Playback blocked — click somewhere then press Play')
      }
      startLoop()
      const decodedPath = url.startsWith('fterm://local/')
        ? decodeURIComponent(url.slice('fterm://local/'.length))
        : undefined
      fetchFileInfo(url, decodedPath)
    } catch (e: any) {
      setError(e.message || 'Failed to play file')
    }
  }

  const playTrackAt = (idx: number) => {
    if (idx < 0 || idx >= queue.length) return
    const t = queue[idx]
    setQueueIdx(idx)
    playUrl(pathToFtermUrl(t.path), t.name)
  }

  const advance = (dir: 1 | -1) => {
    const cur = queueIdxRef.current
    const q = queueRef.current
    if (q.length === 0 || cur < 0) return
    if (repeatRef.current === 'one') { playTrackAt(cur); return }
    let next: number
    if (shuffleRef.current && dir === 1 && q.length > 1) {
      do { next = Math.floor(Math.random() * q.length) } while (next === cur)
    } else {
      next = cur + dir
      if (next >= q.length) {
        if (repeatRef.current === 'all') next = 0
        else return
      }
      if (next < 0) {
        if (repeatRef.current === 'all') next = q.length - 1
        else return
      }
    }
    playTrackAt(next)
  }

  const libSep = (root: string) => root.includes('\\') ? '\\' : '/'

  const libFullDir = (root: string, path: string[]) => {
    if (!path.length) return root
    const sep = libSep(root)
    return root.replace(/[\\/]+$/, '') + sep + path.join(sep)
  }

  const loadLibDir = async (root: string, path: string[]) => {
    setLibLoading(true)
    setLibFolderCovers({})
    const result = await window.fterm.fsReadDir(libFullDir(root, path))
    setLibLoading(false)
    if (result.error) return
    const items = result.entries
      .filter(e => e.isDir || AUDIO_EXTS.has(e.name.split('.').pop()?.toLowerCase() ?? ''))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      .map(e => ({ name: e.name, isDir: e.isDir }))
    setLibItems(items)
    const sep = libSep(root)
    const baseDir = libFullDir(root, path)
    const coverNames = ['cover', 'folder', 'album', 'front', 'artwork']
    const coverExts = ['jpg', 'jpeg', 'png', 'webp']
    for (const item of items.filter(i => i.isDir)) {
      const dirPath = baseDir.replace(/[\\/]+$/, '') + sep + item.name
      ;(async () => {
        for (const name of coverNames) {
          for (const ext of coverExts) {
            try {
              const res = await window.fterm.fsReadImage(dirPath + sep + name + '.' + ext)
              if (res) {
                setLibFolderCovers(prev => ({ ...prev, [item.name]: `data:${res.mime};base64,${res.base64}` }))
                return
              }
            } catch { /* not found */ }
          }
        }
      })()
    }
  }

  const openLibrary = async () => {
    const dir = await window.fterm.fsOpenDirDialog()
    if (!dir) return
    localStorage.setItem('fterm-viz-libroot', dir)
    setLibRoot(dir)
    setLibPath([])
    await loadLibDir(dir, [])
    setShowLibrary(true)
    setShowPlaylist(false)
  }

  const libDrillIn = async (name: string) => {
    const newPath = [...libPath, name]
    setLibPath(newPath)
    await loadLibDir(libRoot, newPath)
  }

  const libGoUp = async () => {
    if (!libPath.length) return
    const newPath = libPath.slice(0, -1)
    setLibPath(newPath)
    await loadLibDir(libRoot, newPath)
  }

  const libPlayFile = (startName: string) => {
    const sep = libSep(libRoot)
    const dir = libFullDir(libRoot, libPath)
    const audioFiles = libItems.filter(i => !i.isDir)
    const tracks: Track[] = audioFiles.map(i => ({ path: dir.replace(/[\\/]+$/, '') + sep + i.name, name: i.name }))
    setQueue(tracks)
    setShowLibrary(false)
    setShowPlaylist(true)
    const idx = tracks.findIndex(t => t.name === startName)
    const startIdx = idx >= 0 ? idx : 0
    if (tracks.length > 0) {
      setQueueIdx(startIdx)
      playUrl(pathToFtermUrl(tracks[startIdx].path), tracks[startIdx].name)
    }
  }

  const removeFromQueue = (idx: number) => {
    setQueue(q => q.filter((_, i) => i !== idx))
    if (idx < queueIdx) setQueueIdx(i => i - 1)
    else if (idx === queueIdx) { setQueueIdx(-1); teardownSource() }
  }

  const petVibeRef = useRef(petVibe)
  useEffect(() => {
    petVibeRef.current = petVibe
    const b = beatRef.current
    if (!petVibe) {
      if (b.rhythmTimer) { clearInterval(b.rhythmTimer); b.rhythmTimer = null }
      b.intervals = []
      b.avg = 0
      b.lastBeat = 0
      window.dispatchEvent(new CustomEvent('pet:vibe-off'))
    } else if (audioElRef.current && !audioElRef.current.paused) {
      window.dispatchEvent(new CustomEvent('pet:vibe-on'))
    }
  }, [petVibe])

  const queueRef = useRef(queue)
  useEffect(() => { queueRef.current = queue }, [queue])
  const queueIdxRef = useRef(queueIdx)
  useEffect(() => { queueIdxRef.current = queueIdx }, [queueIdx])
  const shuffleRef = useRef(shuffle)
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])
  const repeatRef = useRef(repeat)
  useEffect(() => { repeatRef.current = repeat }, [repeat])

  useEffect(() => {
    if (initialPath) {
      playUrl(pathToFtermUrl(initialPath), basename(initialPath))
    }
  }, [initialPath])

  useEffect(() => {
    if (libRoot) loadLibDir(libRoot, [])
  }, [])

  useEffect(() => {
    localStorage.setItem('fterm-viz-volume', String(volume))
    if (audioElRef.current) audioElRef.current.volume = muted ? 0 : volume
  }, [volume, muted])

  useEffect(() => {
    if (!floating) return
    const onMove = (e: MouseEvent) => {
      if (winDragRef.current) {
        const newX = winDragRef.current.origX + e.clientX - winDragRef.current.startX
        const newY = winDragRef.current.origY + e.clientY - winDragRef.current.startY
        setPos({
          x: Math.max(0, Math.min(newX, window.innerWidth - 80)),
          y: Math.max(0, Math.min(newY, window.innerHeight - 40)),
        })
      }
      if (resizeRef.current) {
        setSize({
          w: Math.max(360, resizeRef.current.origW + e.clientX - resizeRef.current.startX),
          h: Math.max(280, resizeRef.current.origH + e.clientY - resizeRef.current.startY),
        })
      }
    }
    const onUp = () => { winDragRef.current = null; resizeRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mouseleave', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mouseleave', onUp)
    }
  }, [floating])

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (!floating) return
    e.preventDefault()
    winDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }, [floating, pos])

  const togglePlay = () => {
    const el = audioElRef.current
    if (!el) return
    if (el.paused) { el.play(); setPlaying(true) } else { el.pause(); setPlaying(false) }
  }

  const emitRhythm = () => {
    const b = beatRef.current
    const move = b.moveIdx++ % 5
    window.dispatchEvent(new CustomEvent('pet:rhythm', { detail: { move } }))
  }

  const updateRhythmTimer = (intervalMs: number) => {
    const b = beatRef.current
    if (b.rhythmTimer) clearInterval(b.rhythmTimer)
    b.rhythmTimer = setInterval(emitRhythm, intervalMs)
  }

  const detectBeat = (data: Uint8Array) => {
    if (!petVibe) return
    let sum = 0
    for (let i = 1; i < 9; i++) sum += data[i]
    const energy = sum / 8 / 255
    const b = beatRef.current
    b.avg = b.avg * 0.92 + energy * 0.08
    const now = performance.now()
    if (energy > b.avg * 1.12 && energy > 0.12 && now - b.lastBeat > 200) {
      const delta = now - b.lastBeat
      b.lastBeat = now
      if (delta > 250 && delta < 1500) {
        b.intervals.push(delta)
        if (b.intervals.length > 8) b.intervals.shift()
        if (b.intervals.length >= 3) {
          const sorted = [...b.intervals].sort((a, b) => a - b)
          const median = sorted[Math.floor(sorted.length / 2)]
          updateRhythmTimer(median)
        }
      }
      emitRhythm()
      window.dispatchEvent(new CustomEvent('pet:beat'))
    }
  }

  const startLoop = () => {
    const vizRefs: VisualizerRefs = {
      warpRef,
      nebulaRef,
      nebulaShockRef,
      nebulaBassRef,
      coverBitmapRef,
      coverImgRef,
      coverHueRef,
      waterfallRef,
    }

    const draw = () => {
      const canvas = canvasRef.current
      const analyser = analyserRef.current
      if (!canvas || !analyser) return
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) return

      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(freqData)
      // Normalize so peak always fills display — caps at 6× gain to avoid amplifying silence
      let peakFreq = 0
      for (let i = 0; i < freqData.length; i++) if (freqData[i] > peakFreq) peakFreq = freqData[i]
      const isSilent = peakFreq <= 8
      if (peakFreq > 8) {
        const gain = Math.min(255 / peakFreq, 6)
        for (let i = 0; i < freqData.length; i++) freqData[i] = Math.min(255, freqData[i] * gain)
      }
      detectBeat(freqData)

      // Bass pulse for radial/tunnel/particles modes
      let bass = 0
      for (let i = 1; i < 9; i++) bass += freqData[i]
      bass = bass / 8 / 255
      beatPulseRef.current = Math.max(beatPulseRef.current * 0.92, bass)

      RENDERER_MAP[style](ctx2d, { freqData, analyser, canvas, w, h, isSilent, beatPulse: beatPulseRef.current, t: performance.now() / 1000 }, vizRefs)

      rafRef.current = requestAnimationFrame(draw)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }

  useEffect(() => {
    // Reset trail state when switching modes so old pixels don't bleed through
    nebulaRef.current = []
    nebulaShockRef.current = []
    nebulaBassRef.current = { avg: 0, last: 0 }
    warpRef.current = { canvas: null, rot: 0 }
    const canvas = canvasRef.current
    if (canvas) { const c = canvas.getContext('2d'); if (c) c.clearRect(0, 0, canvas.width, canvas.height) }
    if (sourceRef.current) startLoop()
  }, [style])

  const header = (
    <div
      className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-white/10"
      style={{ background: 'rgba(22,27,34,0.95)', cursor: floating ? 'move' : 'default' }}
      onMouseDown={onHeaderMouseDown}
    >
      <div className="flex items-center gap-2 text-white/80 select-none min-w-0 flex-1">
        <Music size={15} className="shrink-0" />
        <span className="text-sm font-medium shrink-0">Audio Visualizer</span>
        {trackName && (
          <>
            {coverDataUrl && (
              <img src={coverDataUrl} className="w-8 h-8 rounded object-cover shrink-0 ml-2 ring-1 ring-white/10" />
            )}
            <div className={`${coverDataUrl ? '' : 'ml-2'} min-w-0 flex flex-col leading-tight`}>
              <span className="text-xs text-white/70 truncate max-w-[280px]">
                {currentMeta.artist && currentMeta.title
                  ? `${currentMeta.artist} — ${currentMeta.title}`
                  : currentMeta.title || trackName}
              </span>
              {currentMeta.album && (
                <span className="text-[10px] text-white/35 truncate max-w-[280px]">{currentMeta.album}{currentMeta.track ? ` · #${currentMeta.track}` : ''}</span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => setFloating(f => !f)}
          title={floating ? 'Dock' : 'Float'}
          className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white"
        >
          {floating ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white">
          <X size={15} />
        </button>
      </div>
    </div>
  )

  const STYLES: Style[] = ['waterfall3d', 'radial', 'bars', 'nebula', 'kaleid', 'crystal', 'attractor', 'ascii', 'none']

  const controls = (
    <div className="px-3 py-2 flex items-center gap-1.5 shrink-0 border-b border-white/8">
      <button
        onClick={openLibrary}
        title="Browse music library"
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs text-white/80 transition shrink-0"
      >
        <FolderOpen size={13} /> Open
      </button>

      <div className="w-px h-5 bg-white/10 shrink-0" />

      {queue.length > 0 ? (
        <>
          <button onClick={() => advance(-1)} disabled={queueIdx <= 0 && repeat !== 'all'}
            className="p-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-25 rounded-md text-white/70" title="Previous"
          ><SkipBack size={13} /></button>
          <button onClick={togglePlay} className="p-1.5 bg-white/8 hover:bg-white/15 rounded-md text-white/90">
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button onClick={() => advance(1)} disabled={queueIdx >= queue.length - 1 && repeat !== 'all'}
            className="p-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-25 rounded-md text-white/70" title="Next"
          ><SkipForward size={13} /></button>
          <button onClick={() => setShuffle(s => !s)} title="Shuffle"
            className={`p-1.5 rounded-md ${shuffle ? 'bg-cyan-500/25 text-cyan-300' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
          ><Shuffle size={13} /></button>
          <button onClick={() => setRepeat(r => r === 'none' ? 'all' : r === 'all' ? 'one' : 'none')} title={`Repeat: ${repeat}`}
            className={`p-1.5 rounded-md relative ${repeat !== 'none' ? 'bg-cyan-500/25 text-cyan-300' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
          >
            <Repeat size={13} />
            {repeat === 'one' && <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold leading-none">1</span>}
          </button>
          <div className="w-px h-5 bg-white/10 shrink-0" />
          <button onClick={() => { setShowPlaylist(p => !p); setShowLibrary(false) }} title="Playlist"
            className={`p-1.5 rounded-md ${showPlaylist && !showLibrary ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
          ><ListMusic size={13} /></button>
          {libRoot && (
            <button onClick={() => { setShowLibrary(l => !l); setShowPlaylist(false) }} title="Library"
              className={`p-1.5 rounded-md ${showLibrary ? 'bg-cyan-500/25 text-cyan-300' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
            ><FolderOpen size={13} /></button>
          )}
        </>
      ) : source === 'file' ? (
        <button onClick={togglePlay} className="p-1.5 bg-white/8 hover:bg-white/15 rounded-md text-white/90">
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
      ) : null}

      <div className="flex items-center gap-1.5 ml-auto">
        <button onClick={() => setMuted(m => !m)} title={muted ? 'Unmute' : 'Mute'} className="text-white/50 hover:text-white transition shrink-0">
          {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input type="range" min={0} max={1} step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => { setMuted(false); setVolume(parseFloat(e.target.value)) }}
          className="w-20 accent-cyan-400"
        />
        <span className="text-[11px] text-white/40 tabular-nums w-6 text-right">{Math.round((muted ? 0 : volume) * 100)}</span>
      </div>

      <div className="w-px h-5 bg-white/10 shrink-0 ml-1" />
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => setStyle(s => STYLES[(STYLES.indexOf(s) - 1 + STYLES.length) % STYLES.length])}
          className="p-1 rounded text-white/40 hover:text-white hover:bg-white/8 transition"
        ><ChevronLeft size={11} /></button>
        <span className="text-[11px] text-white/80 w-[76px] text-center tabular-nums select-none">{style}</span>
        <button
          onClick={() => setStyle(s => STYLES[(STYLES.indexOf(s) + 1) % STYLES.length])}
          className="p-1 rounded text-white/40 hover:text-white hover:bg-white/8 transition"
        ><ChevronRight size={11} /></button>
      </div>
    </div>
  )

  const libraryPanel = showLibrary && libRoot && (
    <div className="w-64 shrink-0 border-l border-white/10 bg-black/30 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-1.5 shrink-0">
        {libPath.length > 0 && (
          <button onClick={libGoUp} className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white" title="Back">
            <ChevronLeft size={12} />
          </button>
        )}
        <div className="flex items-center gap-1 text-[10px] text-white/40 min-w-0 flex-1 truncate">
          <span className="text-white/60 font-medium truncate">{libPath.length === 0 ? 'Library' : libPath[libPath.length - 1]}</span>
        </div>
        {libLoading && <Loader2 size={11} className="animate-spin text-white/40 shrink-0" />}
      </div>
      {libPath.length > 0 && (
        <div className="px-3 py-1 border-b border-white/8 text-[9px] text-white/25 truncate">
          {libPath.join(' › ')}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {libItems.length === 0 && !libLoading && (
          <div className="px-3 py-4 text-xs text-white/30 text-center">Empty</div>
        )}
        {libItems.map(item => (
          <div
            key={item.name}
            onClick={() => item.isDir ? libDrillIn(item.name) : libPlayFile(item.name)}
            className="px-3 py-1.5 text-xs cursor-pointer flex items-center gap-2 group text-white/70 hover:bg-white/8 hover:text-white transition-colors"
            title={item.name}
          >
            {item.isDir && libFolderCovers[item.name]
              ? <img src={libFolderCovers[item.name]} className="w-5 h-5 rounded object-cover shrink-0" />
              : item.isDir
                ? <Folder size={12} className="text-yellow-400 shrink-0" />
                : <Music size={12} className="text-cyan-400 shrink-0" />
            }
            <span className="truncate flex-1">{item.name}</span>
            {item.isDir && <ChevronRight size={10} className="text-white/25 shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  )

  const playlistPanel = showPlaylist && queue.length > 0 && (
    <div className="w-56 shrink-0 border-l border-white/10 bg-black/30 flex flex-col min-h-0">
      <div className="px-3 py-2 text-xs text-white/60 border-b border-white/10 truncate" title={libRoot}>
        {queue.length} track{queue.length === 1 ? '' : 's'}
      </div>
      <div className="flex-1 overflow-y-auto">
        {queue.map((t, i) => (
          <div
            key={t.path}
            onClick={() => playTrackAt(i)}
            className={`px-3 py-1.5 text-xs cursor-pointer flex items-center gap-2 group ${
              i === queueIdx ? 'bg-cyan-500/15 text-cyan-200' : 'text-white/70 hover:bg-white/5'
            }`}
          >
            <span className="w-4 shrink-0 text-white/40 tabular-nums">{i === queueIdx && playing ? '♪' : i + 1}</span>
            <span className="truncate flex-1" title={t.name}>{t.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); removeFromQueue(i) }}
              className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400"
            ><Trash2 size={11} /></button>
          </div>
        ))}
      </div>
    </div>
  )

  const body = (
    <>
      {error && <div className="px-4 pt-2 text-xs text-red-400 shrink-0">{error}</div>}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 p-4 min-h-0">
          <canvas
            ref={canvasRef}
            className="w-full h-full rounded-lg bg-black/60 border border-white/5"
          />
        </div>
        {libraryPanel}
        {playlistPanel}
      </div>
    </>
  )

  if (showVizWarning) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-[#1a1a2e] border border-yellow-500/50 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-yellow-400 text-xl">⚠️</span>
            <h2 className="text-yellow-400 font-semibold text-base">Photosensitivity Warning</h2>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed mb-4">
            The audio visualizer contains <strong className="text-white">rapidly flashing lights, strobing effects, and high-contrast animations</strong> that may trigger seizures or discomfort in people with photosensitive epilepsy or other visual sensitivities.
          </p>
          <p className="text-gray-400 text-xs mb-5">
            If you or someone nearby is sensitive to flashing lights, do not use this feature or select the <em>None</em> style (audio only, no visuals).
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { localStorage.setItem('fterm-viz-warned', '1'); setShowVizWarning(false) }}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold text-sm rounded-lg py-2 transition-colors"
            >
              I understand, continue
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-white/10 hover:bg-white/20 text-gray-300 text-sm rounded-lg py-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (floating) {
    return createPortal(
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="flex flex-col rounded-lg overflow-hidden shadow-2xl"
        style={{
          position: 'fixed',
          left: pos.x, top: pos.y,
          width: size.w, height: size.h,
          zIndex: 9999,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(13,17,23,0.97)',
        }}
      >
        {header}
        {controls}
        {body}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{ opacity: 0.4 }}
          onMouseDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h }
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', bottom: 3, right: 3 }}>
            <path d="M9 1L1 9M9 5L5 9M9 9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </motion.div>,
      document.body
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-30 flex items-start justify-center pt-8 px-6"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-3xl rounded-2xl overflow-hidden border border-white/15 shadow-2xl flex flex-col"
        style={{ background: 'linear-gradient(135deg, rgba(13,17,23,0.92), rgba(13,17,23,0.78))', height: 520 }}
      >
        {header}
        {controls}
        {body}
        <div className="px-5 pb-2 text-center text-xs text-white/25 shrink-0">Esc to close</div>
      </motion.div>
    </motion.div>
  )
}
