import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import { TerminalRecorder, RECORDER_LIMITS } from '@/services/TerminalRecorder'
import { Circle, Pause, Play, Square } from 'lucide-react'
import type { Terminal } from '@xterm/xterm'

interface Props {
  terminal: Terminal | null
  tabId?: string
  paneId?: string
  widgetEl?: HTMLElement | null
  containerEl?: HTMLElement | null
  /** The pane's profile theme, carried on the take so the studio paints with it. */
  themeId?: string
}

/**
 * Start / pause / stop only. Stopping no longer kicks off an encode: the take
 * goes to the studio, where it can be trimmed, cut and sized before anything is
 * written to disk. A recording you cannot review before publishing is a
 * recording you end up doing twice.
 */
export default function RecordingControls({ terminal, widgetEl, containerEl, themeId }: Props) {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const recorderRef = useRef<TerminalRecorder | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const setStudioTake = useStore(s => s.setStudioTake)
  const setActiveView = useStore(s => s.setActiveView)

  useEffect(() => {
    if (recorderRef.current && recording) {
      recorderRef.current.setWidgetElement(widgetEl ?? null, containerEl ?? null)
    }
  }, [widgetEl, containerEl, recording])

  const finish = useCallback(() => {
    const rec = recorderRef.current
    if (!rec) return
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }

    const take = { ...rec.stop(), themeId }
    recorderRef.current = null
    setRecording(false)
    setPaused(false)

    if (take.snapshots.length === 0) {
      setNotice('Nothing was captured')
      setTimeout(() => setNotice(null), 3000)
      return
    }
    setStudioTake(take)
    setActiveView('studio')
  }, [setStudioTake, setActiveView, themeId])

  const start = useCallback(() => {
    if (!terminal) return
    setNotice(null)
    setElapsed(0)

    const recorder = new TerminalRecorder(terminal, widgetEl, containerEl)
    recorder.onAutoStop = () => {
      setNotice(`Stopped at the ${Math.round(RECORDER_LIMITS.MAX_DURATION_MS / 60000)} minute limit`)
      finish()
    }
    recorder.start()
    recorderRef.current = recorder
    setRecording(true)
    setPaused(false)

    intervalRef.current = setInterval(() => {
      const rec = recorderRef.current
      if (rec) setElapsed(Math.floor(rec.now() / 1000))
    }, 500)
  }, [terminal, widgetEl, containerEl, finish])

  const togglePause = useCallback(() => {
    const rec = recorderRef.current
    if (!rec) return
    if (rec.isPaused()) { rec.resume(); setPaused(false) } else { rec.pause(); setPaused(true) }
  }, [])

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (recorderRef.current?.getIsRecording()) recorderRef.current.stop()
  }, [])

  const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  if (!recording) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={start}
          disabled={!terminal}
          title="Start recording this pane"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-transparent hover:bg-white/10 text-[#c9d1d9] border border-white/10 transition-colors disabled:opacity-40"
        >
          <Circle size={8} fill="#f85149" strokeWidth={0} />
          REC
        </button>
        {notice && <span className="text-xs text-[#8b949e]">{notice}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10">
      <span
        className={`w-2 h-2 rounded-full bg-red-500 ${paused ? 'opacity-40' : 'animate-pulse'}`}
        aria-hidden
      />
      <span className="text-xs font-medium text-red-300 tabular-nums w-[38px] text-center">
        {formatElapsed(elapsed)}
      </span>
      <button
        onClick={togglePause}
        title={paused ? 'Resume' : 'Pause — the timeline stops with it'}
        className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
      >
        {paused ? <Play size={11} fill="currentColor" /> : <Pause size={11} fill="currentColor" />}
      </button>
      <button
        onClick={finish}
        title="Stop and open the studio"
        className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
      >
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  )
}
