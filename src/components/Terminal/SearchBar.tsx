import { useState, useRef, useEffect } from 'react'
import { searchAddons } from './terminalRegistry'

interface Props {
  tabId: string
  activePaneId: string
  onClose: () => void
}

export default function SearchBar({ tabId, activePaneId, onClose }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const instanceId = `${tabId}-${activePaneId}`

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const addon = searchAddons.get(instanceId)
    if (!addon || !query) return
    addon.findNext(query, { caseSensitive: false, regex: false })
  }, [query, instanceId])

  function findNext() {
    searchAddons.get(instanceId)?.findNext(query, { caseSensitive: false, regex: false })
  }

  function findPrev() {
    searchAddons.get(instanceId)?.findPrevious(query, { caseSensitive: false, regex: false })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) findPrev(); else findNext()
    }
  }

  return (
    <div className="absolute top-2 right-2 z-30 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[#30363d] shadow-xl"
      style={{ background: 'rgba(13,17,23,0.95)', backdropFilter: 'blur(12px)' }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search…"
        className="bg-transparent text-xs text-[#c9d1d9] outline-none w-48 placeholder:text-[#484f58]"
      />
      <button onClick={findPrev} className="text-[#6e7681] hover:text-[#c9d1d9] text-xs px-1" title="Previous (Shift+Enter)">▲</button>
      <button onClick={findNext} className="text-[#6e7681] hover:text-[#c9d1d9] text-xs px-1" title="Next (Enter)">▼</button>
      <button onClick={onClose} className="text-[#6e7681] hover:text-[#c9d1d9] text-xs px-1" title="Close (Esc)">✕</button>
    </div>
  )
}
