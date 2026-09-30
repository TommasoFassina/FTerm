import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  ArrowLeft, ChevronFirst, ChevronLast, Loader2, Pause, Play, Redo2, Scissors,
  SkipBack, SkipForward, Trash2, Undo2, X,
} from 'lucide-react'
import { useStore, useActiveTheme } from '@/store'
import type { FrameSnapshot } from '@/services/TerminalRecorder'
import { boxBlur, paintFrame, type Ctx2D, type FramePalette } from '@/services/recording/paintFrame'
import {
  addCut, defaultPlan, frameCount, normalizeCuts, outputDuration, outputTimeOf,
  removeCutAt, sourceTimeAt, type Cut, type EditPlan,
} from '@/services/recording/editPlan'
import {
  buildCameraTrack, cameraAt, DEFAULT_CAMERA, zoomSpans, type CameraConfig,
} from '@/services/recording/cameraTrack'
import {
  canRedo, canUndo, initHistory, push, redo, undo, type History,
} from '@/services/recording/history'
import { buildCast, castSize } from '@/services/recording/castExport'

const SIZES = [
  { label: '1200 × 800', width: 1200, height: 800 },
  { label: '1280 × 720  ·  720p', width: 1280, height: 720 },
  { label: '1920 × 1080  ·  1080p', width: 1920, height: 1080 },
  { label: '1080 × 1080  ·  square', width: 1080, height: 1080 },
]
const FPS_CHOICES = [10, 15, 24, 30]
const SPEEDS = [0.5, 1, 1.5, 2, 3]

const fmt = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 100) / 10)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export default function RecordingStudio() {
  const take = useStore(s => s.studioTake)
  const setStudioTake = useStore(s => s.setStudioTake)
  const setActiveView = useStore(s => s.setActiveView)
  const settings = useStore(s => s.settings)
  const appTheme = useActiveTheme()
  const takeTheme = useStore(s => (take?.themeId ? s.themes.find(t => t.id === take.themeId) : undefined))
  const theme = takeTheme ?? appTheme

  const duration = take?.duration ?? 0
  /* Every edit goes through the history, so any of them can be taken back. */
  const [history, setHistory] = useState<History<EditPlan>>(() => initHistory(defaultPlan(duration)))
  const plan = history.present
  /** Records an edit. `live` folds into the current entry — used while dragging
   *  a trim grip, so a drag is one undo step and not two hundred. */
  const commitPlan = useCallback((next: EditPlan | ((p: EditPlan) => EditPlan), live = false) => {
    setHistory(h => {
      const value = typeof next === 'function' ? next(h.present) : next
      return live ? { ...h, present: value } : push(h, value)
    })
  }, [])
  const [outputTime, setOutputTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sizeIdx, setSizeIdx] = useState(0)
  const [fps, setFps] = useState(15)
  const [crf, setCrf] = useState(23)
  const [format, setFormat] = useState<'mp4' | 'gif' | 'cast'>('mp4')
  const [camera, setCamera] = useState<CameraConfig>(DEFAULT_CAMERA)
  const [fileName, setFileName] = useState(() => `fterm-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)
  const [selection, setSelection] = useState<Cut | null>(null)
  const [dragging, setDragging] = useState<'scrub' | 'select' | 'in' | 'out' | null>(null)
  /** Set right after a cut so the studio can offer to take it straight back. */
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const exported = useRef(false)
  const [bgReady, setBgReady] = useState(0)

  const size = SIZES[sizeIdx]
  const outDuration = outputDuration(plan)

  const palette: FramePalette = useMemo(() => ({
    background: theme.background, foreground: theme.foreground, cursor: theme.cursor,
    red: theme.red, green: theme.green, yellow: theme.yellow, blue: theme.blue,
    cyan: theme.cyan, magenta: theme.magenta, white: theme.white,
    brightBlack: theme.brightBlack, brightRed: theme.brightRed, brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow, brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta, brightCyan: theme.brightCyan, brightWhite: theme.brightWhite,
  }), [theme])

  /* Widget captures are data URLs in the take; decode each one once. */
  const widgetImages = useRef<(HTMLImageElement | undefined)[]>([])
  useEffect(() => {
    if (!take) return
    widgetImages.current = take.widgetFrames.map(() => undefined)
    take.widgetFrames.forEach((src, i) => {
      const img = new Image()
      img.onload = () => { widgetImages.current[i] = img }
      img.src = src
    })
  }, [take])

  /* Background wallpaper, pre-scaled and pre-blurred exactly as the exporter
     does it — the preview is meant to be the file, not an approximation. */
  useEffect(() => {
    const src = settings.backgroundImage
    if (!src) { bgRef.current = null; setBgReady(n => n + 1); return }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const c = document.createElement('canvas')
      c.width = size.width; c.height = size.height
      const ctx = c.getContext('2d')
      if (!ctx) return
      const blur = settings.backgroundBlur ?? 10
      const scale = Math.max(size.width / img.width, size.height / img.height) * (blur > 0 ? 1.1 : 1)
      const sw = img.width * scale, sh = img.height * scale
      ctx.drawImage(img, (size.width - sw) / 2, (size.height - sh) / 2, sw, sh)
      if (blur > 0) boxBlur(ctx as unknown as Ctx2D, size.width, size.height, blur)
      bgRef.current = c
      setBgReady(n => n + 1)
    }
    img.onerror = () => { bgRef.current = null; setBgReady(n => n + 1) }
    img.src = src
    return () => { cancelled = true }
  }, [settings.backgroundImage, settings.backgroundBlur, size.width, size.height])

  /** Snapshot in effect at a source time — the same rule the exporter uses. */
  const snapshotAt = useCallback((sourceMs: number): FrameSnapshot | null => {
    const snaps = take?.snapshots
    if (!snaps || snaps.length === 0) return null
    let lo = 0, hi = snaps.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (snaps[mid].timestamp < sourceMs) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && snaps[lo].timestamp > sourceMs) return snaps[lo - 1]
    return snaps[lo]
  }, [take])

  /* The camera track is derived from the take, never from the edit: cutting a
     span out does not re-frame the shots around it, it just removes them. The
     exporter runs the same pure function over the same snapshots, so nothing
     about the move needs to cross the IPC boundary. */
  /* Deliberately not keyed on settleMs: the move duration is applied when the
     track is sampled, so dragging that slider must not walk every snapshot
     again. */
  const cameraTrack = useMemo(
    () => (take ? buildCameraTrack(take.snapshots, camera) : []),
    [take, camera.enabled, camera.maxScale, camera.minHoldMs, camera.padCells],
  )

  const sourceTime = sourceTimeAt(plan, outputTime)

  /* Draw the current frame. */
  useEffect(() => {
    const canvas = canvasRef.current
    const snap = snapshotAt(sourceTime)
    if (!canvas || !snap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const widgetImg = snap.widgetFrame !== undefined ? widgetImages.current[snap.widgetFrame] : undefined
    paintFrame(ctx as unknown as Ctx2D, snap, {
      width: size.width,
      height: size.height,
      fontFamily: settings.fontFamily || 'Cascadia Mono, Consolas, monospace',
      theme: palette,
      backgroundImage: bgRef.current ?? undefined,
      backgroundOpacity: settings.opacity ?? 0.85,
    }, {
      widgetImage: widgetImg,
      widgetAlpha: 1,
      camera: cameraAt(cameraTrack, sourceTime, camera.settleMs),
    })
  }, [sourceTime, size, palette, settings.fontFamily, settings.opacity, snapshotAt, bgReady,
    cameraTrack, camera.settleMs])

  /* Playback. Driven off wall-clock deltas, not a fixed step, so a slow frame
     does not make the preview drift away from real time. */
  useEffect(() => {
    if (!playing) return
    lastTickRef.current = performance.now()
    const tick = (now: number) => {
      const dt = now - lastTickRef.current
      lastTickRef.current = now
      setOutputTime(t => {
        const next = t + dt
        if (next >= outDuration) { setPlaying(false); return outDuration }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [playing, outDuration])

  /* An edit can shorten the video out from under the playhead. */
  useEffect(() => {
    setOutputTime(t => Math.min(t, outDuration))
  }, [outDuration])

  /* Leaving throws the take away — there is nowhere else it lives. Ask, unless
     it has already been exported. */
  const close = useCallback(() => {
    if (!exported.current && !confirm('Discard this recording? It has not been exported.')) return
    setStudioTake(null)
    setActiveView('terminal')
  }, [setStudioTake, setActiveView])

  const posToSource = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el || duration === 0) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
  }, [duration])

  const seekSource = useCallback((sourceMs: number) => {
    setPlaying(false)
    setOutputTime(outputTimeOf(plan, sourceMs))
  }, [plan])

  /* Two lanes, two jobs. The ruler seeks and nothing else; the clip lane below
     it selects and nothing else. They used to be the same strip, which meant
     every attempt to select also dragged the playhead around and it was never
     obvious which gesture you were making. */
  const onLaneDown = (e: React.PointerEvent, mode: 'scrub' | 'select' | 'in' | 'out') => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setDragging(mode)
    const at = posToSource(e.clientX)
    if (mode === 'scrub') seekSource(at)
    if (mode === 'select') { setSelection({ start: at, end: at }); seekSource(at) }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const at = posToSource(e.clientX)
      if (dragging === 'in') commitPlan(p => ({ ...p, trimStart: Math.min(at, p.trimEnd - 100) }), true)
      else if (dragging === 'out') commitPlan(p => ({ ...p, trimEnd: Math.max(at, p.trimStart + 100) }), true)
      else if (dragging === 'select') {
        setSelection(sel => (sel ? { start: sel.start, end: at } : { start: at, end: at }))
        seekSource(at)
      } else {
        seekSource(at)
      }
    }
    const up = () => {
      // the whole grip drag lands as one undo step
      if (dragging === 'in' || dragging === 'out') commitPlan(p => p)
      setDragging(null)
      // a click with no drag is a seek, not a one-millisecond selection
      setSelection(sel => (sel && Math.abs(sel.end - sel.start) < 40 ? null : sel))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, posToSource, seekSource, commitPlan])

  const hasSelection = !!selection && Math.abs(selection.end - selection.start) >= 40
  const selRange: Cut | null = hasSelection
    ? { start: Math.min(selection!.start, selection!.end), end: Math.max(selection!.start, selection!.end) }
    : null

  const cutSelection = () => {
    if (!selRange) return
    commitPlan(p => addCut(p, selRange))
    setSelection(null)
    setLastAction(`Cut ${fmt(selRange.end - selRange.start)}`)
  }
  const trimToSelection = () => {
    if (!selRange) return
    commitPlan(p => ({ ...p, trimStart: selRange.start, trimEnd: selRange.end }))
    setSelection(null)
    setLastAction(`Trimmed to ${fmt(selRange.end - selRange.start)}`)
  }
  const restoreCutAt = (sourceMs: number) => {
    commitPlan(p => removeCutAt(p, sourceMs))
    setLastAction('Span restored')
  }
  const doUndo = useCallback(() => { setHistory(h => undo(h)); setLastAction(null) }, [])
  const doRedo = useCallback(() => { setHistory(h => redo(h)); setLastAction(null) }, [])

  const step = (frames: number) => {
    setPlaying(false)
    setOutputTime(t => Math.max(0, Math.min(outDuration, t + (frames * 1000) / fps)))
  }

  /* Keyboard. The studio owns the window while it is open. */
  // The studio opens from the pane's Stop button with the terminal still
  // focused: its hidden textarea would swallow every transport key below and
  // pass Space / I / O / X to the shell instead.
  useEffect(() => {
    const el = document.activeElement
    if (el instanceof HTMLElement && el.classList.contains('xterm-helper-textarea')) el.blur()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) doRedo()
        else doUndo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return }
      // single-key transport only — leave the app's Ctrl/Alt shortcuts alone
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -10 : -1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 10 : 1) }
      else if (e.key === 'Home') { e.preventDefault(); setPlaying(false); setOutputTime(0) }
      else if (e.key === 'End') { e.preventDefault(); setPlaying(false); setOutputTime(outDuration) }
      else if (e.key.toLowerCase() === 'i') commitPlan(p => ({ ...p, trimStart: Math.min(sourceTime, p.trimEnd - 100) }))
      else if (e.key.toLowerCase() === 'o') commitPlan(p => ({ ...p, trimEnd: Math.max(sourceTime, p.trimStart + 100) }))
      else if (e.key.toLowerCase() === 'x') cutSelection()
      else if (e.key === 'Escape' && !exporting) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [outDuration, sourceTime, selRange, exporting, close, fps, commitPlan, doUndo, doRedo])

  /* Rebuilt only when it could change — a cast of a long take is a few hundred
     KB of string building, not something to redo on every render. */
  const castEstimate = useMemo(
    () => (take && format === 'cast' ? castSize(buildCast(take.snapshots, plan)) : 0),
    [take, plan, format],
  )

  const doExport = async () => {
    if (!take) return
    setExporting(true)
    setProgress(0)
    setError(null)
    setResult(null)
    const off = window.fterm.onRecordingProgress(p => setProgress(Math.round(p)))
    try {
      if (format === 'cast') {
        // text, so there is nothing to encode and nothing to report progress on
        const res = await window.fterm.recordingExportCast({
          cast: buildCast(take.snapshots, plan, {
            title: fileName,
          }),
          fileName,
        })
        setResult(res.videoPath)
        exported.current = true
        return
      }
      const res = await window.fterm.recordingExport({
        snapshots: take.snapshots,
        events: take.events,
        widgetFrames: take.widgetFrames,
        theme: palette,
        fontFamily: settings.fontFamily,
        backgroundImage: settings.backgroundImage || undefined,
        backgroundBlur: settings.backgroundBlur ?? 10,
        backgroundOpacity: settings.opacity ?? 0.85,
        plan,
        fps,
        width: size.width,
        height: size.height,
        crf,
        camera,
        format,
        fileName,
      })
      if (res.cancelled) setError('Export cancelled')
      else if (res.videoPath) { setResult(res.videoPath); exported.current = true }
    } catch (err: any) {
      setError(err?.message ?? 'Export failed')
    } finally {
      off()
      setExporting(false)
    }
  }

  if (!take) {
    return (
      <Shell onClose={close}>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No recording is waiting. Hit REC on a pane first.
        </div>
      </Shell>
    )
  }

  const pct = (ms: number) => (duration === 0 ? 0 : (ms / duration) * 100)
  const commandMarks = take.events.filter(e => e.type === 'command_end' && e.command?.trim())
  const cuts = normalizeCuts(plan.cuts)

  return (
    <Shell onClose={close}>
      <div className="flex-1 min-h-0 flex gap-4">
        {/* ── preview ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex-1 min-h-0 flex items-center justify-center rounded-xl border border-white/10 bg-black/40 overflow-hidden">
            <canvas
              ref={canvasRef}
              width={size.width}
              height={size.height}
              className="max-w-full max-h-full object-contain"
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
            />
          </div>

          {/* transport */}
          <div className="flex items-center gap-2">
            <IconBtn onClick={() => { setPlaying(false); setOutputTime(0) }} title="Start (Home)">
              <ChevronFirst size={15} />
            </IconBtn>
            <IconBtn onClick={() => step(-1)} title="Previous frame (←)"><SkipBack size={14} /></IconBtn>
            <button
              onClick={() => setPlaying(p => !p)}
              title="Play / pause (Space)"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
            </button>
            <IconBtn onClick={() => step(1)} title="Next frame (→)"><SkipForward size={14} /></IconBtn>
            <IconBtn onClick={() => { setPlaying(false); setOutputTime(outDuration) }} title="End (End)">
              <ChevronLast size={15} />
            </IconBtn>

            <span className="ml-2 text-[12px] tabular-nums text-white/60">
              {fmt(outputTime)} <span className="text-white/25">/ {fmt(outDuration)}</span>
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={doUndo}
                disabled={!canUndo(history)}
                title="Undo (Ctrl+Z)"
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-colors"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={doRedo}
                disabled={!canRedo(history)}
                title="Redo (Ctrl+Shift+Z)"
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-colors"
              >
                <Redo2 size={14} />
              </button>
              <div className="w-px h-4 bg-white/10" />
              <button
                onClick={trimToSelection}
                disabled={!selRange}
                className="px-2.5 py-1 text-[12px] rounded-md border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:pointer-events-none transition-colors"
                title="Keep only the selected span"
              >
                Trim to selection
              </button>
              <button
                onClick={cutSelection}
                disabled={!selRange}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border border-[#f85149]/40 text-[#ff8880] hover:bg-[#f85149]/15 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                title="Remove the selected span (X)"
              >
                <Scissors size={12} />Cut
              </button>
            </div>
          </div>

          {(lastAction || selRange) && (
            <div className="flex items-center gap-2 -mt-1 text-[11px]">
              {selRange ? (
                <span className="text-[#79c0ff]">
                  {fmt(selRange.end - selRange.start)} selected — Cut removes it, Trim keeps only it
                </span>
              ) : (
                <>
                  <span className="text-white/45">{lastAction}</span>
                  <button
                    onClick={doUndo}
                    disabled={!canUndo(history)}
                    className="text-[#58a6ff] hover:underline disabled:opacity-30 disabled:no-underline"
                  >
                    Undo
                  </button>
                </>
              )}
              {selRange && (
                <button onClick={() => setSelection(null)}
                  className="ml-auto text-white/35 hover:text-white transition-colors">
                  Clear selection
                </button>
              )}
            </div>
          )}

          {/* ── timeline ─────────────────────────────────────────────── */}
          {/* Two lanes on purpose. The ruler seeks; the clip lane selects. One
              strip doing both was the whole reason cutting felt like guesswork. */}
          <div ref={trackRef} className="select-none">
            {/* ruler / scrubber */}
            <div
              onPointerDown={e => onLaneDown(e, 'scrub')}
              title="Click or drag to move the playhead"
              className="relative h-6 rounded-t-lg border border-b-0 border-white/10 bg-white/[0.05] cursor-pointer overflow-hidden"
            >
              {commandMarks.map((m, i) => (
                <div key={i} title={m.command}
                  className="absolute top-0 h-2.5 w-px bg-white/30 pointer-events-none"
                  style={{ left: `${pct(m.timestamp)}%` }} />
              ))}
              {zoomSpans(cameraTrack, duration).map((z, i) => (
                <div key={i} title="Camera pushed in here"
                  className="absolute bottom-0 h-1 bg-[#58a6ff]/60 pointer-events-none"
                  style={{ left: `${pct(z.start)}%`, width: `${pct(z.end - z.start)}%` }} />
              ))}
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-wider text-white/25 pointer-events-none">
                seek
              </span>
            </div>

            {/* clip lane */}
            <div
              onPointerDown={e => onLaneDown(e, 'select')}
              className="relative h-16 rounded-b-lg border border-white/10 bg-white/[0.03] cursor-col-resize overflow-hidden"
            >
              {/* trimmed-away material */}
              <div className="absolute inset-y-0 left-0 bg-black/60 pointer-events-none"
                style={{ width: `${pct(plan.trimStart)}%` }} />
              <div className="absolute inset-y-0 right-0 bg-black/60 pointer-events-none"
                style={{ width: `${100 - pct(plan.trimEnd)}%` }} />

              {/* the kept material, so there is something to point at */}
              <div className="absolute inset-y-0 bg-[#3fb950]/10 border-y border-[#3fb950]/25 pointer-events-none"
                style={{ left: `${pct(plan.trimStart)}%`, width: `${pct(plan.trimEnd - plan.trimStart)}%` }} />

              {/* removed spans */}
              {cuts.map((c, i) => (
                <button
                  key={i}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => restoreCutAt((c.start + c.end) / 2)}
                  title={`Removed ${fmt(c.end - c.start)} — click to put it back`}
                  className="group absolute inset-y-0 flex items-center justify-center bg-[#f85149]/25 border-x border-[#f85149]/70 hover:bg-[#f85149]/40 transition-colors"
                  style={{ left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%` }}
                >
                  <Undo2 size={12} className="text-white/70 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}

              {/* live selection, with its actions sitting on top of it */}
              {selRange && (
                <div className="absolute inset-y-0 bg-[#58a6ff]/20 border-x-2 border-[#58a6ff] pointer-events-none"
                  style={{ left: `${pct(selRange.start)}%`, width: `${pct(selRange.end - selRange.start)}%` }}>
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-[#79c0ff] whitespace-nowrap">
                    {fmt(selRange.end - selRange.start)}
                  </span>
                </div>
              )}

              {/* empty state: say what this lane is for */}
              {!selRange && cuts.length === 0 && (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/25 pointer-events-none">
                  Drag across this lane to select a span, then Cut it out
                </span>
              )}

              <Grip left={pct(plan.trimStart)} onDown={e => onLaneDown(e, 'in')} title="Drag to trim the start (I)" />
              <Grip left={pct(plan.trimEnd)} onDown={e => onLaneDown(e, 'out')} title="Drag to trim the end (O)" />

              {/* playhead */}
              <div className="absolute inset-y-0 w-[2px] bg-white pointer-events-none"
                style={{ left: `${pct(sourceTime)}%` }} />
            </div>

            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30">
              <span className="tabular-nums">0:00.0</span>
              <Legend className="bg-[#3fb950]/40">kept</Legend>
              <Legend className="bg-[#f85149]/60">cut</Legend>
              <Legend className="bg-[#58a6ff]/70">zoom</Legend>
              <span className="ml-auto tabular-nums">source · {fmt(duration)}</span>
            </div>
          </div>
        </div>

        {/* ── side panel ──────────────────────────────────────────────── */}
        <div className="w-[280px] shrink-0 overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-1">
          <Panel title="Output">
            <Field label="Format">
              <div className="grid grid-cols-3 gap-1">
                {(['mp4', 'gif', 'cast'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`py-1 rounded-md text-[11px] uppercase tracking-wide transition-colors ${
                      format === f
                        ? 'bg-[#58a6ff]/20 text-[#79c0ff] border border-[#58a6ff]/40'
                        : 'border border-white/10 text-white/50 hover:bg-white/10 hover:text-white'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Field>
            <p className="text-[11px] text-white/30 leading-relaxed -mt-1">
              {format === 'mp4' && 'H.264 video. Keeps the pet, the widgets and the camera moves.'}
              {format === 'gif' && 'One palette for the whole clip, so the theme survives 256 colours. Large — keep it short.'}
              {format === 'cast' && 'asciicast v2: the text itself, not a picture of it. Selectable, searchable, kilobytes instead of megabytes — but no pet, widgets or camera.'}
            </p>
            <Field label="Size">
              <Select value={sizeIdx} onChange={v => setSizeIdx(Number(v))}
                options={SIZES.map((s, i) => ({ value: i, label: s.label }))} />
            </Field>
            <Field label="Frame rate">
              <Select value={fps} onChange={v => setFps(Number(v))}
                options={FPS_CHOICES.map(f => ({ value: f, label: `${f} fps` }))} />
            </Field>
            {format === 'mp4' && (
              <Field label="Quality">
                <input
                  type="range" min={16} max={32} step={1} value={48 - crf}
                  onChange={e => setCrf(48 - Number(e.target.value))}
                  className="w-full accent-[#58a6ff]"
                />
              </Field>
            )}
            <Field label="File name">
              <input
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                spellCheck={false}
                className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[12px] text-white outline-none focus:border-[#58a6ff]/60"
              />
            </Field>
            <p className="text-[11px] text-white/30 leading-relaxed">
              {format === 'cast'
                ? `about ${Math.max(1, Math.round(castEstimate / 1024))} KB · saved to your Videos folder`
                : `${frameCount(plan, fps).toLocaleString()} frames · saved to your Videos folder`}
            </p>
          </Panel>

          <Panel title="Camera">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={camera.enabled}
                onChange={e => setCamera(c => ({ ...c, enabled: e.target.checked }))}
                className="accent-[#58a6ff]"
              />
              <span className="text-[12px] text-white/75">Auto-zoom</span>
            </label>
            <p className="text-[11px] text-white/30 leading-relaxed -mt-1">
              Frames whatever is changing on screen and holds it, instead of showing
              a full-width terminal nobody can read.
            </p>
            <Field label={`Maximum zoom · ${camera.maxScale.toFixed(1)}×`}>
              <input
                type="range" min={1} max={3} step={0.1} value={camera.maxScale}
                disabled={!camera.enabled}
                onChange={e => setCamera(c => ({ ...c, maxScale: Number(e.target.value) }))}
                className="w-full accent-[#58a6ff] disabled:opacity-30"
              />
            </Field>
            <Field label={`Hold before re-framing · ${(camera.minHoldMs / 1000).toFixed(1)} s`}>
              <input
                type="range" min={400} max={4000} step={100} value={camera.minHoldMs}
                disabled={!camera.enabled}
                onChange={e => setCamera(c => ({ ...c, minHoldMs: Number(e.target.value) }))}
                className="w-full accent-[#58a6ff] disabled:opacity-30"
              />
            </Field>
            <Field label={`Move duration · ${(camera.settleMs / 1000).toFixed(1)} s`}>
              <input
                type="range" min={200} max={2000} step={50} value={camera.settleMs}
                disabled={!camera.enabled}
                onChange={e => setCamera(c => ({ ...c, settleMs: Number(e.target.value) }))}
                className="w-full accent-[#58a6ff] disabled:opacity-30"
              />
            </Field>
            <p className="text-[11px] text-white/30">
              {camera.enabled
                ? cameraTrack.length === 0
                  ? 'Nothing worth framing — the camera stays put.'
                  : `${cameraTrack.filter(k => k.scale > 1).length} shots`
                : 'Off — the frame never moves.'}
            </p>
          </Panel>

          <Panel title="Edit">
            <Field label="Speed">
              <Select value={plan.speed} onChange={v => commitPlan(p => ({ ...p, speed: Number(v) }))}
                options={SPEEDS.map(s => ({ value: s, label: `${s}×` }))} />
            </Field>
            <div className="flex items-center justify-between text-[11px] text-white/45">
              <span>Source</span><span className="tabular-nums">{fmt(duration)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/45">
              <span>After edit</span>
              <span className="tabular-nums text-white/80">{fmt(outDuration)}</span>
            </div>

            {cuts.length > 0 && (
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-white/45">{cuts.length} cut{cuts.length > 1 ? 's' : ''}</span>
                  <button onClick={() => commitPlan(p => ({ ...p, cuts: [] }))}
                    className="text-[11px] text-white/40 hover:text-white transition-colors">
                    Clear
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {cuts.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-white/55 bg-white/[0.04] rounded px-2 py-1">
                      <span className="tabular-nums">{fmt(c.start)} – {fmt(c.end)}</span>
                      <button
                        onClick={() => restoreCutAt((c.start + c.end) / 2)}
                        className="ml-auto opacity-50 hover:opacity-100 transition-opacity"
                        title="Restore this span"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => { commitPlan(defaultPlan(duration)); setSelection(null); setLastAction(null) }}
              className="text-[11px] text-white/40 hover:text-white self-start transition-colors"
            >
              Reset all edits
            </button>
          </Panel>

          {take.truncated && (
            <p className="text-[11px] text-[#e3b341] leading-relaxed">
              This take hit the recorder's length limit and stops early.
            </p>
          )}

          <div className="mt-auto flex flex-col gap-2">
            {result && (
              <div className="flex items-center gap-2 text-[12px] text-[#56d364]">
                <span className="truncate flex-1" title={result}>Saved</span>
                <button onClick={() => window.fterm.openPath(result)}
                  className="text-[#58a6ff] hover:underline">Open</button>
              </div>
            )}
            {error && <div className="text-[12px] text-[#ff8880]">{error}</div>}

            {exporting ? (
              <>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-[#58a6ff] transition-[width] duration-200"
                    style={{ width: `${progress}%` }} />
                </div>
                <div className="flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-[#58a6ff]" />
                  <span className="text-[12px] text-white/60">Encoding {progress}%</span>
                  <button onClick={() => window.fterm.recordingCancel()}
                    className="ml-auto text-[12px] text-white/50 hover:text-white transition-colors">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={doExport}
                disabled={outDuration <= 0}
                className="w-full py-2 rounded-lg bg-[#0e639c] hover:bg-[#1177bb] text-white text-[13px] font-medium disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                Export {format.toUpperCase()}
              </button>
            )}
            <button
              onClick={close}
              disabled={exporting}
              className="w-full py-1.5 rounded-lg text-[12px] text-white/45 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors"
            >
              Discard take
            </button>
          </div>
        </div>
      </div>
    </Shell>
  )
}

/* ── chrome ────────────────────────────────────────────────────────────── */

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="h-full w-full flex flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <button onClick={onClose}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-[15px] font-semibold text-white/90">Recording studio</h1>
        <span className="text-[12px] text-white/30 truncate">
          <Key>Space</Key> play · <Key>←→</Key> step · <Key>I</Key>/<Key>O</Key> trim here ·
          drag the lower lane to select · <Key>X</Key> cut · <Key>Ctrl+Z</Key> undo
        </span>
        <button onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors">
          <X size={15} />
        </button>
      </div>
      {children}
    </motion.div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2.5">
      <h2 className="text-[10px] uppercase tracking-wider text-white/35">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-white/45">{label}</span>
      {children}
    </label>
  )
}

function Select<T extends string | number>(
  { value, onChange, options }:
  { value: T; onChange: (v: string) => void; options: { value: T; label: string }[] },
) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[#12141a] border border-white/10 rounded-md px-2 py-1 text-[12px] text-white outline-none focus:border-[#58a6ff]/60 cursor-pointer"
    >
      {options.map(o => (
        <option key={String(o.value)} value={o.value} className="bg-[#12141a]">{o.label}</option>
      ))}
    </select>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1 py-px rounded bg-white/10 text-white/55 text-[10px] font-sans">{children}</kbd>
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <i className={`w-2.5 h-2.5 rounded-sm ${className}`} />{children}
    </span>
  )
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="w-7 h-7 flex items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white transition-colors">
      {children}
    </button>
  )
}

function Grip({ left, onDown, title }: {
  left: number; onDown: (e: React.PointerEvent) => void; title: string
}) {
  return (
    <div
      onPointerDown={e => { e.stopPropagation(); onDown(e) }}
      title={title}
      className="absolute inset-y-0 w-3 -ml-1.5 cursor-ew-resize group"
      style={{ left: `${left}%` }}
    >
      <div className="absolute inset-y-0 left-1/2 -ml-px w-0.5 bg-[#e3b341] group-hover:w-1 group-hover:-ml-0.5 transition-all" />
    </div>
  )
}
