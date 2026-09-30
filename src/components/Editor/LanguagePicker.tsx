import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Play, Search } from 'lucide-react'
import { LANGS } from '@/utils/editorLang'

/**
 * The language selector used to be a bare `<select>`. Its popup is drawn by the
 * OS, not by us, so on Windows it came up as a white list in a dark window with
 * lowercase Monaco ids ("plaintext", "csharp") for labels — unreadable and
 * visibly not part of the app.
 *
 * This is the same picker idiom as the command palette: type to filter, arrows
 * to move, Enter to pick. It renders in a portal so it is never clipped by the
 * editor's `overflow-hidden` panes.
 */

interface Props {
  value: string
  onChange: (id: string) => void
  /** Open upwards — the picker lives in the status bar at the bottom. */
  align?: 'up' | 'down'
}

export default function LanguagePicker({ value, onChange, align = 'down' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /* Anchored by the edge nearest the button: opening upward pins the popover's
     bottom to the trigger, so a short filtered list hugs it instead of floating
     a fixed 320px above. */
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 })

  const current = LANGS.find(l => l.id === value)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return LANGS
    // an extension typed with or without its dot finds the language it belongs to
    const bare = q.replace(/^\./, '')
    return LANGS.filter(l =>
      l.label.toLowerCase().includes(q) ||
      l.id.includes(q) ||
      l.ext.some(e => e === bare || e.startsWith(bare)))
  }, [query])

  useEffect(() => { setCursor(0) }, [query])

  useLayoutEffect(() => {
    if (!open) return
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = 260
    setBox(align === 'up'
      ? { left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
          bottom: Math.max(8, window.innerHeight - r.top + 6) }
      : { left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
          top: r.bottom + 6 })
    inputRef.current?.focus()
  }, [open, align])

  /* keep the highlighted row in view while arrowing through a long list */
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) &&
        !listRef.current?.parentElement?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const commit = (id: string) => { onChange(id); setOpen(false); setQuery('') }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(matches.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[cursor]) commit(matches[cursor].id) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery('') }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="Select the language for syntax highlighting"
        className={`px-1.5 rounded transition-colors hover:bg-white/10 ${open ? 'bg-white/10 text-white' : 'text-white/60'}`}
      >
        {current?.label ?? value}
      </button>

      {open && createPortal(
        <div
          className="fixed z-[200] w-[260px] rounded-xl border border-white/10 bg-[#12141a] shadow-2xl overflow-hidden flex flex-col"
          style={{ left: box.left, top: box.top, bottom: box.bottom, maxHeight: 320 }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search size={13} className="text-white/40 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Language or extension…"
              className="bg-transparent text-[12px] text-white outline-none w-full placeholder:text-white/30"
            />
          </div>

          <div ref={listRef} className="overflow-y-auto py-1 custom-scrollbar">
            {matches.length === 0 && (
              <div className="px-3 py-5 text-[12px] text-white/40 text-center">No match</div>
            )}
            {matches.map((l, i) => (
              <button
                key={l.id}
                data-on={i === cursor ? '1' : '0'}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(l.id)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12px] transition-colors ${
                  i === cursor ? 'bg-white/10 text-white' : 'text-white/70'}`}
              >
                <span className="w-3 shrink-0">
                  {l.id === value && <Check size={12} className="text-[#58a6ff]" />}
                </span>
                <span className="truncate">{l.label}</span>
                {l.run && <Play size={9} fill="currentColor" className="text-white/30 shrink-0"
                  aria-label="can be run" />}
                <span className="ml-auto text-[10px] text-white/25 shrink-0 font-mono">
                  .{l.ext[0]}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
