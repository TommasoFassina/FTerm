/**
 * Hook for sending messages to the active AI provider.
 * Uses requestId as the message id so chunks map directly to the right message.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import type { AIProvider } from '@/types'

let requestCounter = 0
const nextId = () => `req-${++requestCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function useAI() {
  const ai = useStore(s => s.ai)
  const addChatMessage = useStore(s => s.addChatMessage)
  const setProviderStatus = useStore(s => s.setProviderStatus)

  // Track which requestIds are in flight
  const pending = useRef(new Set<string>())

  useEffect(() => {
    // Use store.getState() in callbacks to avoid re-subscribing when action refs change
    const removeChunk = window.fterm.onAIChunk((id, text) => {
      if (pending.current.has(id)) useStore.getState().appendChatContent(id, text)
    })
    const removeDone = window.fterm.onAIDone((id) => {
      if (pending.current.has(id)) {
        useStore.getState().updateChatMessage(id, { streaming: false })
        pending.current.delete(id)
        useStore.getState().setPetState('happy')
        useStore.getState().setPetMessage('Done thinking!')
      }
    })
    const removeError = window.fterm.onAIError((id, err) => {
      if (pending.current.has(id)) {
        useStore.getState().updateChatMessage(id, { streaming: false, error: err })
        pending.current.delete(id)
        useStore.getState().setPetState('sad')
        useStore.getState().setPetMessage('Something went wrong...')
      }
    })
    const removeUsage = window.fterm.onAIUsage((_id, usage) => {
      useStore.getState().recordUsage(usage)
    })

    return () => { removeChunk(); removeDone(); removeError(); removeUsage() }
  }, [])

  const sendMessage = useCallback(async (content: string, provider?: AIProvider): Promise<string | undefined> => {
    const activeProvider = provider ?? ai.provider
    if (activeProvider === 'none') return undefined

    // Generate one id used as both requestId and message store id
    const id = nextId()

    addChatMessage({ role: 'user', content }, `${id}-user`)
    addChatMessage({ role: 'assistant', content: '', provider: activeProvider, streaming: true }, id)

    pending.current.add(id)

    useStore.getState().setPetState('working')
    useStore.getState().setPetMessage('Thinking...')

    // Build context from current history (last 10 non-streaming messages)
    const { chatMessages, tabs, activeTabId, commandHistory, git } = useStore.getState()
    const history = chatMessages
      .filter(m => !m.streaming && !m.error)
      .slice(-10)
      .map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))

    // Build terminal context block to inject into every message
    const activeTab = tabs.find(t => t.id === activeTabId)
    const cwd = activeTab?.currentCwd
    const branch = git.status?.branch
    const recentCmds = commandHistory.slice(-5)
    const ctxParts: string[] = []
    if (cwd) ctxParts.push(`CWD: ${cwd}`)
    if (branch) ctxParts.push(`Git branch: ${branch}`)
    if (recentCmds.length > 0) ctxParts.push(`Recent commands: ${recentCmds.join(', ')}`)
    const contextBlock = ctxParts.length > 0
      ? `[Terminal context: ${ctxParts.join(' | ')}]\n\n`
      : ''

    // Map effort → model default for Claude; use ollamaModel for Ollama
    const resolvedModel = ai.model
      || (activeProvider === 'ollama' ? ai.ollamaModel : undefined)
      || effortToModel(activeProvider, ai.effort)

    await window.fterm.aiChat({
      requestId: id,
      provider: activeProvider,
      messages: [
        { role: 'system', content: ai.systemPrompt || SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: contextBlock + content },
      ],
      model: resolvedModel || undefined,
      ollamaUrl: ai.ollamaUrl,
    })
    return id
  }, [ai, addChatMessage])

  // One-off NL → shell command. Does NOT touch chatMessages (no sidebar pollution).
  const generateCommand = useCallback(async (nl: string): Promise<string> => {
    const activeProvider = ai.provider
    if (activeProvider === 'none') throw new Error('No AI provider configured')

    const id = nextId()
    const { tabs, activeTabId, git } = useStore.getState()
    const activeTab = tabs.find(t => t.id === activeTabId)
    const cwd = activeTab?.currentCwd
    const branch = git.status?.branch
    const np = typeof navigator !== 'undefined' ? navigator.platform : 'Win32'
    const platform = /win/i.test(np) ? 'win32' : /mac/i.test(np) ? 'darwin' : 'linux'
    const shell = platform === 'win32' ? 'PowerShell' : 'bash'
    const ctxParts: string[] = [`OS: ${platform}`, `Shell: ${shell}`]
    if (cwd) ctxParts.push(`CWD: ${cwd}`)
    if (branch) ctxParts.push(`Git branch: ${branch}`)

    const system = `You translate natural language into a single safe shell command for ${shell} on ${platform}. Output ONLY the command — no markdown, no code fences, no explanation. [Terminal context: ${ctxParts.join(' | ')}]`

    return new Promise<string>((resolve, reject) => {
      let buf = ''
      let removeChunk: () => void = () => {}
      let removeDone: () => void = () => {}
      let removeError: () => void = () => {}
      const cleanup = () => { removeChunk(); removeDone(); removeError() }
      removeChunk = window.fterm.onAIChunk((rid, text) => { if (rid === id) buf += text })
      removeDone = window.fterm.onAIDone((rid) => {
        if (rid !== id) return
        cleanup()
        resolve(buf.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim())
      })
      removeError = window.fterm.onAIError((rid, err) => {
        if (rid !== id) return
        cleanup()
        reject(new Error(err))
      })
      window.fterm.aiChat({
        requestId: id,
        provider: activeProvider,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: nl },
        ],
        model: (activeProvider === 'ollama' ? ai.ollamaModel : effortToModel(activeProvider, 'fast')) || undefined,
        ollamaUrl: ai.ollamaUrl,
      }).catch(reject)
    })
  }, [ai])

  const testConnection = useCallback(async (provider: AIProvider) => {
    setProviderStatus(provider, { testing: true, error: undefined })
    try {
      await window.fterm.aiTest(provider, ai.ollamaUrl)
      setProviderStatus(provider, { connected: true, testing: false })
    } catch (err) {
      setProviderStatus(provider, {
        connected: false, testing: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [ai.ollamaUrl, setProviderStatus])

  const saveKey = useCallback(async (provider: string, key: string) => {
    await window.fterm.keysSet(provider, key)
  }, [])

  const removeKey = useCallback(async (provider: string) => {
    await window.fterm.keysDelete(provider)
    setProviderStatus(provider as AIProvider, { connected: false })
  }, [setProviderStatus])

  return { sendMessage, generateCommand, testConnection, saveKey, removeKey }
}

export function useAIInit() {
  const setProviderStatus = useStore(s => s.setProviderStatus)
  useEffect(() => {
    window.fterm.keysListConnected().then(connected => {
      const providers: AIProvider[] = ['claude', 'openai', 'copilot', 'ollama', 'gemini', 'deepseek']
      providers.forEach(p => {
        if (connected.includes(p)) setProviderStatus(p, { connected: true })
      })
    })
  }, [setProviderStatus])
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = 'You are a helpful coding assistant embedded in a terminal. Answer concisely. Use markdown code blocks for code.'

function effortToModel(provider: AIProvider, effort: string): string {
  if (provider === 'claude') {
    if (effort === 'fast') return 'claude-haiku-4-5-20251001'
    if (effort === 'thorough') return 'claude-opus-4-6'
    return 'claude-sonnet-4-6'
  }
  if (provider === 'openai' || provider === 'copilot') {
    if (effort === 'fast') return 'gpt-4o-mini'
    if (effort === 'thorough') return 'o1'
    return 'gpt-4o'
  }
  if (provider === 'gemini') {
    if (effort === 'fast') return 'gemini-2.0-flash'
    if (effort === 'thorough') return 'gemini-2.5-pro'
    return 'gemini-2.0-flash'
  }
  if (provider === 'deepseek') {
    if (effort === 'thorough') return 'deepseek-reasoner'
    return 'deepseek-chat'
  }
  return '' // ollama: use whatever model is in ai.model
}
