import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X, Search, Clipboard, Copy, Trash2, Pin } from 'lucide-react'

export interface ClipEntry {
  id: string
  text: string
  ts: number
  pinned?: boolean
}

interface Props {
  onClose: () => void
  onPaste?: (text: string) => void
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function preview(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 200 ? t.slice(0, 200) + '…' : t
}

export default function ClipboardWidget({ onClose, onPaste }: Props) {
  const [entries, setEntries] = useState<ClipEntry[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    const list = await window.fterm.clipboardHistory()
    setEntries(list)
  }

  useEffect(() => {
    refresh()
    const off = window.fterm.onClipboardUpdate(() => refresh())
    inputRef.current?.focus()
    return () => off()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...entries].sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.ts - a.ts
    )
    if (!q) return sorted
    return sorted.filter(e => e.text.toLowerCase().includes(q))
  }, [entries, query])

  useEffect(() => { setSelected(0) }, [query, entries.length])

  const choose = async (e: ClipEntry) => {
    await window.fterm.clipboardWrite(e.text)
    if (onPaste) onPaste(e.text)
    onClose()
  }

  const togglePin = async (e: ClipEntry, ev: React.MouseEvent) => {
    ev.stopPropagation()
    await window.fterm.clipboardPin(e.id, !e.pinned)
    refresh()
  }

  const remove = async (e: ClipEntry, ev: React.MouseEvent) => {
    ev.stopPropagation()
    await window.fterm.clipboardDelete(e.id)
    refresh()
  }

  const copyOnly = async (e: ClipEntry, ev: React.MouseEvent) => {
    ev.stopPropagation()
    await window.fterm.clipboardWrite(e.text)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(filtered.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = filtered[selected]; if (it) choose(it) }
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
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden border border-white/15 shadow-2xl flex flex-col"
        style={{ background: 'linear-gradient(135deg, rgba(13,17,23,0.92), rgba(13,17,23,0.78))', maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 text-white/80">
            <Clipboard size={16} />
            <span className="text-sm font-medium">Clipboard History</span>
            <span className="text-xs text-white/40 ml-2">{entries.length} item{entries.length === 1 ? '' : 's'}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <Search size={14} className="text-white/40" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search clipboard…"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-white/30"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center text-white/30 text-sm py-12">
              {entries.length === 0 ? 'Nothing copied yet. Copy text anywhere — it will show up here.' : 'No matches.'}
            </div>
          )}
          {filtered.map((e, i) => (
            <div
              key={e.id}
              onClick={() => choose(e)}
              onMouseEnter={() => setSelected(i)}
              className={`px-5 py-3 border-b border-white/5 cursor-pointer transition flex items-start gap-3 group ${
                i === selected ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white/85 font-mono whitespace-pre-wrap break-all line-clamp-3">
                  {preview(e.text)}
                </div>
                <div className="text-xs text-white/35 mt-1 flex items-center gap-2">
                  <span>{timeAgo(e.ts)} ago</span>
                  <span>·</span>
                  <span>{e.text.length} chars</span>
                  {e.pinned && <span className="text-yellow-400/70">· pinned</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={(ev) => copyOnly(e, ev)}
                  title="Copy"
                  className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-white"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={(ev) => togglePin(e, ev)}
                  title={e.pinned ? 'Unpin' : 'Pin'}
                  className={`p-1.5 hover:bg-white/10 rounded ${e.pinned ? 'text-yellow-400' : 'text-white/60 hover:text-white'}`}
                >
                  <Pin size={13} />
                </button>
                <button
                  onClick={(ev) => remove(e, ev)}
                  title="Delete"
                  className="p-1.5 hover:bg-white/10 rounded text-white/60 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-2 border-t border-white/10 text-center text-xs text-white/30">
          ↑↓ navigate · Enter paste · Esc close
        </div>
      </motion.div>
    </motion.div>
  )
}
