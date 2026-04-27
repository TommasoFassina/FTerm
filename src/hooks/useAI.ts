/**
 * Hook for sending messages to the active AI provider.
 * Uses requestId as the message id so chunks map directly to the right message.
 */
import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/store'
import type { AIProvider } from '@/types'

let requestCounter = 0
const nextId = () => `req-${++requestCounter}-${Date.now()}`

export function useAI() {
  const ai = useStore(s => s.ai)
  const addChatMessage = useStore(s => s.addChatMessage)
  const updateChatMessage = useStore(s => s.updateChatMessage)
  const appendChatContent = useStore(s => s.appendChatContent)
  const setProviderStatus = useStore(s => s.setProviderStatus)
  const recordUsage = useStore(s => s.recordUsage)

  // Track which requestIds are in flight
  const pending = useRef(new Set<string>())

  useEffect(() => {
    const removeChunk = window.fterm.onAIChunk((id, text) => {
      if (pending.current.has(id)) appendChatContent(id, text)
    })
    const removeDone = window.fterm.onAIDone((id) => {
      if (pending.current.has(id)) {
        updateChatMessage(id, { streaming: false })
        pending.current.delete(id)
        useStore.getState().setPetState('happy')
        useStore.getState().setPetMessage('Done thinking!')
      }
    })
    const removeError = window.fterm.onAIError((id, err) => {
      if (pending.current.has(id)) {
        updateChatMessage(id, { streaming: false, error: err })
        pending.current.delete(id)
        useStore.getState().setPetState('sad')
        useStore.getState().setPetMessage('Something went wrong...')
      }
    })
    const removeUsage = window.fterm.onAIUsage((_id, usage) => {
      recordUsage(usage)
    })

    return () => { removeChunk(); removeDone(); removeError(); removeUsage() }
  }, [appendChatContent, updateChatMessage, recordUsage])

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

  return { sendMessage, testConnection, saveKey, removeKey }
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
