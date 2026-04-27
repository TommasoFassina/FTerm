import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Plus, Trash2, Play, Edit3, Check } from 'lucide-react'
import { useStore } from '@/store'

interface Props {
  onClose: () => void
  onRun: (command: string) => void
}

export default function SnippetsWidget({ onClose, onRun }: Props) {
  const { snippets, addSnippet, updateSnippet, deleteSnippet } = useStore()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!adding) return
    const id = setTimeout(() => nameRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [adding])

  function handleAdd() {
    if (!newName.trim() || !newCommand.trim()) return
    addSnippet({ name: newName.trim(), command: newCommand.trim(), description: newDesc.trim() || undefined })
    setNewName(''); setNewCommand(''); setNewDesc(''); setAdding(false)
  }

  function startEdit(sn: typeof snippets[0]) {
    setEditingId(sn.id)
    setNewName(sn.name)
    setNewCommand(sn.command)
    setNewDesc(sn.description ?? '')
  }

  function saveEdit(id: string) {
    if (!newName.trim() || !newCommand.trim()) return
    updateSnippet(id, { name: newName.trim(), command: newCommand.trim(), description: newDesc.trim() || undefined })
    setEditingId(null); setNewName(''); setNewCommand(''); setNewDesc('')
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
        className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-white/15 shadow-2xl flex flex-col max-h-[80vh]"
        style={{ backdropFilter: 'blur(20px)', background: 'linear-gradient(135deg, rgba(13,17,23,0.92), rgba(13,17,23,0.78))' }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/10">
          <div>
            <div className="text-white text-xl font-light">Snippets</div>
            <div className="text-white/40 text-xs mt-0.5">Save and run reusable commands</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setAdding(true); setEditingId(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs hover:bg-blue-500/30 transition-colors"
            >
              <Plus size={12} /> New
            </button>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 p-3 space-y-2">
          <AnimatePresence>
            {adding && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 space-y-2"
              >
                <input
                  ref={nameRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Name (e.g. Deploy)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50"
                />
                <input
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50"
                />
                <textarea
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder="Command"
                  rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd() }}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 outline-none focus:border-blue-500/50 resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors">Cancel</button>
                  <button onClick={handleAdd} className="px-3 py-1.5 rounded-lg text-xs bg-blue-500/30 border border-blue-500/40 text-blue-300 hover:bg-blue-500/40 transition-colors">Save</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {snippets.length === 0 && !adding && (
            <div className="text-white/30 text-sm text-center py-10">
              No snippets yet. Click <span className="text-blue-400">New</span> to add one.
            </div>
          )}

          {snippets.map((sn, i) => (
            <motion.div
              key={sn.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              {editingId === sn.id ? (
                <div className="space-y-2">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500/50"
                  />
                  <input
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50"
                  />
                  <textarea
                    value={newCommand}
                    onChange={e => setNewCommand(e.target.value)}
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-mono outline-none focus:border-blue-500/50 resize-none"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors">Cancel</button>
                    <button onClick={() => saveEdit(sn.id)} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs bg-blue-500/30 border border-blue-500/40 text-blue-300 hover:bg-blue-500/40 transition-colors"><Check size={11} /> Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">{sn.name}</div>
                    {sn.description && <div className="text-white/40 text-xs mt-0.5 truncate">{sn.description}</div>}
                    <div className="text-white/50 font-mono text-xs mt-1.5 bg-black/30 rounded px-2 py-1 truncate">{sn.command}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(sn)}
                      className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      title="Edit"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => deleteSnippet(sn.id)}
                      className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={() => { onRun(sn.command); onClose() }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-300 text-xs hover:bg-green-500/30 transition-colors"
                      title="Run"
                    >
                      <Play size={11} /> Run
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
        <div className="px-4 py-2 text-center text-xs text-white/20 border-t border-white/5">Press Esc to close</div>
      </motion.div>
    </motion.div>
  )
}
