import { useState, useEffect, useRef, useMemo } from 'react'
import { motion } from 'motion/react'
import { Search, Clock, X, CornerDownLeft } from 'lucide-react'

interface Props {
  history: string[]
  onSelect: (cmd: string) => void
  onClose: () => void
}

export default function HistorySearch({ history, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const deduplicated = useMemo(() => [...new Set([...history].reverse())], [history])
  const filtered = useMemo(() =>
    query ? deduplicated.filter(cmd => cmd.toLowerCase().includes(query.toLowerCase())) : deduplicated,
    [deduplicated, query]
  )

  useEffect(() => { setSelectedIdx(0) }, [query])
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 10) }, [])
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[selectedIdx]) onSelect(filtered[selectedIdx]) }
  }

  function highlight(cmd: string, q: string) {
    if (!q) return <span>{cmd}</span>
    const idx = cmd.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return <span>{cmd}</span>
    return (
      <span>
        {cmd.slice(0, idx)}
        <mark className="bg-blue-500/25 text-blue-300 rounded px-0.5">{cmd.slice(idx, idx + q.length)}</mark>
        {cmd.slice(idx + q.length)}
      </span>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="absolute top-10 right-6 w-96" style={{ zIndex: 60 }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(13,17,23,0.96)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Search size={14} className="text-white/35 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-[13px] text-white/90 outline-none font-mono placeholder-white/20 min-w-0"
            placeholder="Search command history…"
            spellCheck={false}
          />
          <div className="flex items-center gap-2 shrink-0">
            {filtered.length > 0 && (
              <span className="text-[10px] text-white/25 font-mono tabular-nums">
                {filtered.length}
              </span>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white/25 hover:text-white/60"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px mx-3" style={{ background: 'rgba(255,255,255,0.07)' }} />

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto custom-scrollbar py-1.5" style={{ maxHeight: '240px' }}>
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-white/20 font-mono text-center">
              no matches for "{query}"
            </div>
          ) : (
            filtered.slice(0, 80).map((cmd, i) => (
              <div
                key={cmd + i}
                onMouseDown={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIdx(i)}
                className="group flex items-center gap-3 mx-1.5 px-3 py-2 rounded-xl cursor-pointer transition-all"
                style={{
                  background: i === selectedIdx ? 'rgba(88,166,255,0.12)' : 'transparent',
                }}
              >
                <Clock
                  size={11}
                  className="shrink-0 transition-colors"
                  style={{ color: i === selectedIdx ? 'rgba(88,166,255,0.7)' : 'rgba(255,255,255,0.15)' }}
                />
                <span
                  className="flex-1 text-[12px] font-mono truncate transition-colors"
                  style={{ color: i === selectedIdx ? '#c9d1d9' : 'rgba(255,255,255,0.4)' }}
                >
                  {highlight(cmd, query)}
                </span>
                {i === selectedIdx && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[9px] text-blue-400/40 font-mono">run</span>
                    <CornerDownLeft size={10} className="text-blue-400/50" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="h-px mx-3" style={{ background: 'rgba(255,255,255,0.05)' }} />
        <div className="flex items-center gap-4 px-4 py-2 text-[10px] text-white/20">
          <span className="flex items-center gap-1"><kbd className="font-mono opacity-60">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="font-mono opacity-60">↵</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="font-mono opacity-60">Esc</kbd> close</span>
          <span className="ml-auto font-mono tabular-nums">{history.length} entries</span>
        </div>
      </div>
    </motion.div>
  )
}
