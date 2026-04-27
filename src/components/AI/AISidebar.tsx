import { useState, useRef, useEffect, KeyboardEvent, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Zap } from 'lucide-react'
import { useStore } from '@/store'
import { useAI } from '@/hooks/useAI'
import ChatMessageBubble from './ChatMessage'
import type { AIProvider } from '@/types'

const PROVIDER_ICONS: Record<AIProvider | 'none', string> = {
  claude: '◆', openai: '◎', copilot: '⊙', ollama: '◈', gemini: '✧', deepseek: '🐳', none: '○',
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export default function AISidebar() {
  const ai = useStore(s => s.ai)
  const chatMessages = useStore(s => s.chatMessages)
  const settings = useStore(s => s.settings)
  const usage = useStore(s => s.usage)
  const clearChat = useStore(s => s.clearChat)
  const setAIConfig = useStore(s => s.setAIConfig)
  const { sendMessage } = useAI()
  const providerUsage = ai.provider !== 'none' ? usage[ai.provider] : undefined
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const streamingId = useRef<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isOpen = ai.sidebarOpen
  const hasProvider = ai.provider !== 'none'

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatMessages])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending || !hasProvider) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    try {
      const id = await sendMessage(text)
      streamingId.current = id ?? null
    } finally {
      setSending(false)
      streamingId.current = null
    }
  }

  function handleCancel() {
    const id = streamingId.current
      ?? [...chatMessages].reverse().find((m: any) => m.streaming)?.id
    if (id) window.fterm.aiCancel(id)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={`flex flex-col h-full ${settings.layout?.aiSidebarPosition === 'left' ? 'border-r' : 'border-l'} border-white/[0.06] overflow-hidden shrink-0`}
          style={{ background: 'rgba(0, 0, 0, 0.25)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[#58a6ff] shrink-0">AI</span>
              <ProviderPicker />
              {ai.provider === 'ollama' && <OllamaModelPicker />}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearChat}
                title="Clear chat"
                className="text-[#6e7681] hover:text-[#c9d1d9] text-xs px-1.5 py-0.5 rounded hover:bg-[#21262d]"
              >
                Clear
              </button>
              <button
                onClick={() => setAIConfig({ sidebarOpen: false })}
                className="text-[#6e7681] hover:text-[#c9d1d9] w-6 h-6 flex items-center justify-center rounded hover:bg-[#21262d]"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center mt-12 bg-white/5 p-6 rounded-2xl mx-2 border border-white/5 shadow-inner">
                <Sparkles className="w-8 h-8 text-[#58a6ff] mb-3 opacity-80" />
                <div className="text-[#c9d1d9] text-sm font-medium mb-1">
                  {hasProvider ? `Ask ${ai.provider}` : 'Welcome to AI'}
                </div>
                <div className="text-[#6e7681] text-xs">
                  {hasProvider
                    ? 'Start chatting about your terminal session.'
                    : 'Connect an AI provider in Settings first.'}
                </div>
              </div>
            )}
            {chatMessages.map(msg => (
              <ChatMessageBubble key={msg.id} message={msg} />
            ))}
            <div />
          </div>

          {/* Quick actions — shown when chat is empty */}
          {hasProvider && chatMessages.length === 0 && (
            <div className="px-4 pb-3 flex gap-2 flex-wrap shrink-0">
              {(ai.quickActions?.length ? ai.quickActions : QUICK_ACTIONS).map(a => (
                <button
                  key={a.label}
                  onClick={() => { setInput(a.prompt); textareaRef.current?.focus() }}
                  className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[#c9d1d9] hover:bg-white/10 hover:border-[#58a6ff] transition-all shadow-sm"
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* Token usage */}
          {providerUsage && (providerUsage.sessionInput > 0 || providerUsage.sessionOutput > 0) && (
            <div className="px-4 pb-1 shrink-0 flex items-center gap-2 text-[10px] text-[#484f58]">
              <Zap size={10} className="text-[#d29922]" />
              <span>Session: {fmt(providerUsage.sessionInput + providerUsage.sessionOutput)} tokens</span>
              <span className="ml-auto">{ai.provider === 'ollama' ? (ai.ollamaModel || providerUsage.lastModel) : providerUsage.lastModel}</span>
            </div>
          )}

          {/* Input */}
          <div className="px-4 pb-4 shrink-0">
            <div className={`flex gap-2 items-end rounded-xl border transition-all ${hasProvider ? 'border-white/20 bg-black/40 focus-within:border-[#58a6ff] focus-within:bg-black/60 shadow-inner' : 'border-white/5 bg-black/20 opacity-50'
              }`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); autoResize() }}
                onKeyDown={handleKeyDown}
                disabled={!hasProvider || sending}
                placeholder={hasProvider ? 'Ask anything… (Enter to send)' : 'No API Key connected'}
                rows={1}
                className="flex-1 bg-transparent text-sm text-[#c9d1d9] placeholder-[#6e7681] resize-none px-3 py-3 outline-none min-h-[44px] max-h-[160px] overflow-y-auto"
              />
              {sending ? (
                <button
                  onClick={handleCancel}
                  className="m-1.5 px-2.5 py-1.5 rounded bg-[#f85149] text-white text-sm hover:bg-red-400 transition-all flex items-center justify-center font-medium"
                  title="Stop generation"
                >
                  ■
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!hasProvider || !input.trim()}
                  className="m-1.5 px-2.5 py-1.5 rounded bg-[#388bfd] text-white text-sm disabled:opacity-30 disabled:bg-[#21262d] disabled:cursor-not-allowed hover:bg-[#58a6ff] hover:shadow-[0_0_12px_rgba(88,166,255,0.4)] transition-all flex items-center justify-center font-medium"
                >
                  →
                </button>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

// ─── Provider picker ──────────────────────────────────────────────────────────

const PROVIDERS: AIProvider[] = ['claude', 'openai', 'copilot', 'gemini', 'deepseek', 'ollama', 'none']
const PROVIDER_LABELS: Record<AIProvider | 'none', string> = {
  claude: 'Claude', openai: 'OpenAI', copilot: 'Copilot', gemini: 'Gemini',
  deepseek: 'DeepSeek', ollama: 'Ollama', none: 'None',
}

function ProviderPicker() {
  const ai = useStore(s => s.ai)
  const setAIConfig = useStore(s => s.setAIConfig)
  const [open, setOpen] = useState(false)
  const currentStatus = ai.provider !== 'none' ? ai.providerStatus[ai.provider] : undefined

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-[#6e7681] hover:text-[#c9d1d9] px-1.5 py-0.5 rounded hover:bg-[#21262d]"
      >
        <span>{PROVIDER_ICONS[ai.provider]}</span>
        <span>{ai.provider === 'none' ? 'Pick provider' : PROVIDER_LABELS[ai.provider]}</span>
        {currentStatus?.connected && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
        {currentStatus?.testing && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />}
        {currentStatus?.error && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
        <span className="opacity-40">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full left-0 mt-1 border border-white/10 rounded-lg shadow-xl z-50 min-w-[160px] overflow-hidden"
            style={{ background: 'rgba(15, 20, 30, 0.95)', backdropFilter: 'blur(16px)' }}
          >
            {PROVIDERS.map(p => {
              const status = p !== 'none' ? ai.providerStatus[p] : undefined
              return (
                <button
                  key={p}
                  onClick={() => { setAIConfig({ provider: p }); setOpen(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[#21262d] transition-colors
                    ${ai.provider === p ? 'text-[#58a6ff] bg-[#388bfd0d]' : 'text-[#c9d1d9]'}
                  `}
                >
                  <span className="w-4">{PROVIDER_ICONS[p]}</span>
                  <span className="flex-1">{PROVIDER_LABELS[p]}</span>
                  {status?.connected && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Connected" />}
                  {status?.testing && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" title="Testing…" />}
                  {status?.error && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title={status.error} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}

// ─── Ollama model picker ──────────────────────────────────────────────────────

function OllamaModelPicker() {
  const ai = useStore(s => s.ai)
  const setAIConfig = useStore(s => s.setAIConfig)
  const [models, setModels] = useState<string[]>([])

  const fetchModels = useCallback(async () => {
    try {
      const url = (ai.ollamaUrl || 'http://localhost:11434').replace('::1', '127.0.0.1')
      const res = await fetch(`${url}/api/tags`)
      if (!res.ok) return
      const data = await res.json()
      const names: string[] = (data.models ?? []).map((m: any) => m.name)
      setModels(names)
      if (names.length && !ai.ollamaModel) setAIConfig({ ollamaModel: names[0] })
    } catch { /* ollama not running */ }
  }, [ai.ollamaUrl, ai.ollamaModel, setAIConfig])

  useEffect(() => { fetchModels() }, [fetchModels])

  if (models.length === 0) return null

  return (
    <select
      value={ai.ollamaModel || models[0]}
      onChange={e => setAIConfig({ ollamaModel: e.target.value })}
      className="text-[11px] bg-[#21262d] border border-white/10 text-[#c9d1d9] rounded px-1.5 py-0.5 outline-none max-w-[110px] truncate cursor-pointer hover:border-white/20"
    >
      {models.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  )
}

// ─── Quick action prompts ─────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Fix last error', prompt: 'Fix the last error shown in the terminal.' },
  { label: 'Explain command', prompt: 'Explain what the last command does.' },
  { label: 'Suggest command', prompt: 'Suggest a command for: ' },
  { label: 'Git help', prompt: 'Help me with git: ' },
]
