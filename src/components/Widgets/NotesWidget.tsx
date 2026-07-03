import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { X, Plus, Trash2, Download } from 'lucide-react'
import { useStore } from '@/store'

interface Props {
  onClose: () => void
}

export default function NotesWidget({ onClose }: Props) {
  const { notes, addNote, updateNote, deleteNote } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(notes[0]?.id ?? null)

  // Keep a valid selection as notes change
  useEffect(() => {
    if (!notes.find(n => n.id === selectedId)) setSelectedId(notes[0]?.id ?? null)
  }, [notes, selectedId])

  const active = notes.find(n => n.id === selectedId) ?? null

  function handleAdd() {
    setSelectedId(addNote())
  }

  async function exportNote() {
    if (!active) return
    const home = (window as any).fterm?.homedir ?? ''
    const safe = (active.title || 'note').replace(/[^\w.-]+/g, '_')
    try {
      await window.fterm.fsWriteFile(`${home}/.fterm/notes/${safe}.md`, active.body)
    } catch { /* ignore export failure */ }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-30 flex items-start justify-center pt-10 px-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2, type: 'spring', stiffness: 260, damping: 20 }}
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden border border-white/15 shadow-2xl flex flex-col max-h-[80vh]"
        style={{ backdropFilter: 'blur(20px)', background: 'linear-gradient(135deg, rgba(13,17,23,0.92), rgba(13,17,23,0.78))' }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/10">
          <div>
            <div className="text-white text-xl font-light">Notes</div>
            <div className="text-white/40 text-xs mt-0.5">Quick scratchpad — autosaved</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs hover:bg-blue-500/30 transition-colors"
            >
              <Plus size={12} /> New
            </button>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* List */}
          <div className="w-48 shrink-0 border-r border-white/10 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {notes.length === 0 && (
              <div className="text-white/30 text-xs text-center py-8 px-2">No notes. Click New.</div>
            )}
            {notes.map(n => (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                className={`group flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-left transition-colors
                  ${n.id === selectedId ? 'bg-blue-500/20 text-blue-200' : 'text-white/70 hover:bg-white/5'}`}
              >
                <span className="text-xs truncate">{n.title || 'Untitled'}</span>
                <Trash2
                  size={12}
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 shrink-0 ml-1"
                  onClick={(e) => { e.stopPropagation(); deleteNote(n.id) }}
                />
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0 p-3 gap-2">
            {active ? (
              <>
                <div className="flex items-center gap-2">
                  <input
                    value={active.title}
                    onChange={e => updateNote(active.id, { title: e.target.value })}
                    placeholder="Title"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50"
                  />
                  <button
                    onClick={exportNote}
                    title="Export .md to ~/.fterm/notes"
                    className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Download size={14} />
                  </button>
                </div>
                <textarea
                  value={active.body}
                  onChange={e => updateNote(active.id, { body: e.target.value })}
                  placeholder="Write markdown notes here…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 outline-none focus:border-blue-500/50 resize-none"
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/30 text-sm">Select or create a note</div>
            )}
          </div>
        </div>
        <div className="px-4 py-2 text-center text-xs text-white/20 border-t border-white/5">Press Esc to close</div>
      </motion.div>
    </motion.div>
  )
}
