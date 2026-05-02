import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore, useActiveTheme } from '@/store'
import { TerminalRecorder } from '@/services/TerminalRecorder'
import type { Terminal } from '@xterm/xterm'

interface Props {
  terminal: Terminal | null
  tabId?: string
  paneId?: string
  widgetEl?: HTMLElement | null
  containerEl?: HTMLElement | null
}

type RecordingState = 'idle' | 'recording' | 'processing'

export default function RecordingControls({ terminal, widgetEl, containerEl }: Props) {
  const [state, setState] = useState<RecordingState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<TerminalRecorder | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const theme = useActiveTheme()
  const { settings } = useStore()

  useEffect(() => {
    if (recorderRef.current && state === 'recording') {
      recorderRef.current.setWidgetElement(widgetEl ?? null, containerEl ?? null)
    }
  }, [widgetEl, containerEl, state])

  const startRecording = useCallback(() => {
    if (!terminal) return
    setError(null)
    setVideoPath(null)
    setElapsed(0)

    const recorder = new TerminalRecorder(terminal, widgetEl, containerEl)
    recorder.start()
    recorderRef.current = recorder
    setState('recording')

    const startTime = Date.now()
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
  }, [terminal])

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current) return

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    const { snapshots, events } = recorderRef.current.stop()
    recorderRef.current = null
    setState('processing')
    setProgress(0)

    const removeProgress = window.fterm.onRecordingProgress((p) => {
      setProgress(Math.round(p))
    })

    try {
      const themeData = {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        cyan: theme.cyan,
        magenta: theme.magenta,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      }

      const result = await window.fterm.recordingStop({
        snapshots,
        events,
        theme: themeData,
        fontFamily: settings.fontFamily,
        backgroundImage: settings.backgroundImage || undefined,
        backgroundBlur: settings.backgroundBlur ?? 10,
        backgroundOpacity: settings.opacity ?? 0.85,
      })
      setVideoPath(result.videoPath)
    } catch (err: any) {
      setError(err?.message ?? 'Recording failed')
    } finally {
      removeProgress()
      setState('idle')
    }
  }, [theme, settings])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (recorderRef.current?.getIsRecording()) recorderRef.current.stop()
    }
  }, [])

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="flex items-center gap-2">
      {state === 'idle' && !videoPath && (
        <button
          onClick={startRecording}
          disabled={!terminal}
          title="Start recording"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-transparent hover:bg-white/10 text-[#c9d1d9] border border-white/10 transition-colors disabled:opacity-40"
        >
          <span className="w-2 h-2 rounded-full bg-red-500" />
          REC
        </button>
      )}

      {state === 'recording' && (
        <button
          onClick={stopRecording}
          title="Stop recording"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors animate-pulse"
        >
          <span className="w-2 h-2 rounded bg-red-500" />
          {formatElapsed(elapsed)}
        </button>
      )}

      {state === 'processing' && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-[#8b949e] border border-white/10">
          <span className="w-2 h-2 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          {progress > 0 ? `${progress}%` : 'Rendering…'}
        </div>
      )}

      {videoPath && state === 'idle' && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-green-400">✓ Saved</span>
          <button
            onClick={() => window.fterm.openPath(videoPath)}
            title={videoPath}
            className="text-xs text-[#58a6ff] hover:underline"
          >
            Open
          </button>
          <button
            onClick={() => setVideoPath(null)}
            className="text-xs text-[#8b949e] hover:text-white ml-1"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-red-400" title={error}>⚠ Failed</span>
          <button onClick={() => setError(null)} className="text-xs text-[#8b949e] hover:text-white">×</button>
        </div>
      )}
    </div>
  )
}
