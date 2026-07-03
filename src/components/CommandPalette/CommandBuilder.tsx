import { useState, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import { useAI } from '@/hooks/useAI'
import { Sparkles, Loader2, Play, Copy, Pencil } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function CommandBuilder({ onClose }: Props) {
  const { ai, tabs, activeTabId } = useStore()
  const { generateCommand } = useAI()
  const [nl, setNl] = useState('')
  const [cmd, setCmd] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cmdRef = useRef<HTMLTextAreaElement>(null)

  const noProvider = ai.provider === 'none'

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { if (cmd !== null) cmdRef.current?.focus() }, [cmd])

  async function generate() {
    if (!nl.trim() || loading) return
    setLoading(true); setError(null)
    try {
      setCmd(await generateCommand(nl.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  function run() {
    if (!cmd || !activeTabId) return
    const tab = tabs.find(t => t.id === activeTabId)
    const paneId = tab?.activePaneId ?? '0'
    // No trailing \r — user reviews then presses Enter.
    window.fterm.ptyWrite(`${activeTabId}-${paneId}`, cmd)
    onClose()
  }

  function copy() {
    if (!cmd) return
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div
        className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[520px] rounded-xl border border-white/10 shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'rgba(17, 24, 39, 0.9)', backdropFilter: 'blur(24px)' }}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
          <Sparkles size={16} className="text-purple-400/80" />
          <input
            ref={inputRef}
            value={nl}
            onChange={e => setNl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter') { e.preventDefault(); generate() }
            }}
            disabled={noProvider}
            placeholder={noProvider ? 'Configure an AI provider in Settings first' : 'Describe what you want to do…'}
            className="bg-transparent text-base text-white outline-none w-full placeholder:text-white/30 disabled:opacity-50"
          />
          {loading && <Loader2 size={16} className="text-white/50 animate-spin shrink-0" />}
        </div>

        {error && (
          <div className="px-4 py-3 text-sm text-red-400 border-b border-white/10">{error}</div>
        )}

        {cmd !== null && (
          <div className="p-4 space-y-3">
            <textarea
              ref={cmdRef}
              value={cmd}
              onChange={e => setCmd(e.target.value)}
              rows={Math.min(6, cmd.split('\n').length)}
              onKeyDown={e => {
                if (e.key === 'Escape') onClose()
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run() }
              }}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-green-300 font-mono outline-none focus:border-blue-500/50 resize-none"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-white/30">
                <Pencil size={11} /> Editable — review before running
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={run}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-green-500/20 border border-green-500/30 text-green-300 hover:bg-green-500/30 transition-colors"
                >
                  <Play size={12} /> Run
                </button>
              </div>
            </div>
            <div className="text-[10px] text-white/25 text-center">
              Run inserts the command without executing — press Enter in the terminal to run it.
            </div>
          </div>
        )}
      </div>
    </>
  )
}
