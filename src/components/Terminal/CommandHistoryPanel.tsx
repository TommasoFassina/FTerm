import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle, Check, ClipboardCopy, CornerDownLeft, Loader2, Search, Trash2, X,
} from 'lucide-react'
import type { HistoryEntry } from '@/utils/commandHistory'

type Hit = HistoryEntry & { runs: number }

interface Props {
  onClose: () => void
  /** Puts a command back on the prompt without running it. */
  onInsert: (command: string) => void
}

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

const dur = (ms: number | null) =>
  ms === null ? '' : ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`

/**
 * Search across every command FTerm has ever seen finish.
 *
 * `Ctrl+R` searches the *shell's* history: plain strings, no exit code, no
 * directory, gone when the shell forgets them. This searches the block log,
 * which knows what each command did and where — so "the thing that failed in
 * this repo last week" is an actual query rather than a memory exercise.
 */
export default function CommandHistoryPanel({ onClose, onInsert }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(true)
  const [includeOutput, setIncludeOutput] = useState(false)
  const [stats, setStats] = useState<{ total: number; unique: number; failed: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { window.fterm.historyStats().then(setStats).catch(() => { }) }, [])

  /* Debounced: typing a word should not fire a search per keystroke. */
  useEffect(() => {
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      window.fterm.historySearch(query, 200, includeOutput)
        .then(res => { if (alive) { setHits(res); setCursor(0); setLoading(false) } })
        .catch(() => { if (alive) { setHits([]); setLoading(false) } })
    }, 120)
    return () => { alive = false; clearTimeout(t) }
  }, [query, includeOutput])

  useEffect(() => {
    listRef.current?.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const insert = useCallback((cmd: string) => { onInsert(cmd); onClose() }, [onInsert, onClose])

  const copy = (cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd)
      setTimeout(() => setCopied(null), 1500)
    }).catch(() => { })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(hits.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[cursor]
      if (hit) insert(hit.command)
    } else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[150] bg-black/50" onClick={onClose} />
      <div className="fixed top-[10%] left-1/2 -translate-x-1/2 z-[151] w-[680px] max-w-[92vw] max-h-[74vh] rounded-xl border border-white/10 bg-[#12141a] shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search size={15} className="text-white/40 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search everything you have run…"
            spellCheck={false}
            className="bg-transparent text-[14px] text-white outline-none w-full placeholder:text-white/25"
          />
          {loading && <Loader2 size={13} className="animate-spin text-white/30 shrink-0" />}
          <button onClick={onClose} className="text-white/35 hover:text-white transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-white/10 text-[11px] text-white/30">
          <span><b className="text-white/50">cwd:</b>fterm</span>
          <span><b className="text-white/50">exit:</b>fail</span>
          <span><b className="text-white/50">since:</b>7d</span>
          <label className="ml-auto flex items-center gap-1.5 cursor-pointer hover:text-white/60 transition-colors">
            <input
              type="checkbox"
              checked={includeOutput}
              onChange={e => setIncludeOutput(e.target.checked)}
              className="accent-[#58a6ff]"
            />
            search output too
          </label>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar py-1 min-h-[120px]">
          {!loading && hits.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-white/35">
              {stats?.total === 0
                ? 'Nothing recorded yet. Run a command and it will show up here.'
                : 'No command matches that.'}
            </div>
          )}
          {hits.map((hit, i) => (
            <div
              key={hit.id}
              data-on={i === cursor ? '1' : '0'}
              onMouseEnter={() => setCursor(i)}
              onClick={() => insert(hit.command)}
              className={`group flex items-start gap-3 px-4 py-2 cursor-pointer transition-colors ${
                i === cursor ? 'bg-white/[0.07]' : ''}`}
            >
              <span className="mt-[3px] shrink-0" title={
                hit.exitCode === null ? 'exit code unknown'
                  : hit.exitCode === 0 ? 'succeeded' : `exit ${hit.exitCode}`}>
                {hit.exitCode === null
                  ? <span className="block w-1.5 h-1.5 rounded-full bg-white/20" />
                  : hit.exitCode === 0
                    ? <Check size={12} className="text-[#3fb950]" />
                    : <AlertCircle size={12} className="text-[#f85149]" />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12.5px] text-white/85 truncate">{hit.command}</div>
                <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-white/30">
                  <span className="truncate max-w-[280px]" title={hit.cwd}>{hit.cwd || '—'}</span>
                  <span>·</span>
                  <span>{ago(hit.ts)}</span>
                  {hit.durationMs !== null && <><span>·</span><span>{dur(hit.durationMs)}</span></>}
                  {hit.runs > 1 && <><span>·</span><span>{hit.runs}× </span></>}
                </div>
                {includeOutput && hit.output && (
                  <pre className="mt-1 max-h-16 overflow-hidden text-[10.5px] leading-snug text-white/35 font-mono whitespace-pre-wrap">
                    {hit.output.slice(0, 300)}
                  </pre>
                )}
              </div>

              <button
                onClick={e => { e.stopPropagation(); copy(hit.command) }}
                title="Copy the command"
                className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-white/70 transition-opacity"
              >
                {copied === hit.command ? <Check size={12} className="text-[#3fb950]" /> : <ClipboardCopy size={12} />}
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-white/10 text-[11px] text-white/30">
          <span className="flex items-center gap-1">
            <CornerDownLeft size={11} />put it back on the prompt
          </span>
          {stats && (
            <span className="ml-auto">
              {stats.total.toLocaleString()} recorded · {stats.unique.toLocaleString()} distinct · {stats.failed.toLocaleString()} failed
            </span>
          )}
          <button
            onClick={() => {
              if (!confirm('Delete the whole command history? This cannot be undone.')) return
              window.fterm.historyClear().then(() => {
                setHits([])
                window.fterm.historyStats().then(setStats).catch(() => { })
              })
            }}
            title="Delete the whole history"
            className="text-white/30 hover:text-[#f85149] transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
