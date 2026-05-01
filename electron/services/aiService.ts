/**
 * AI service — routes chat requests to the correct provider and streams
 * chunks + usage data back to the renderer via IPC events.
 *
 * Events emitted per request:
 *   ai:chunk   (requestId, text)
 *   ai:usage   (requestId, UsageData)
 *   ai:done    (requestId)
 *   ai:error   (requestId, message)
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron'

const MAX_AI_BUFFER = 50 * 1024 * 1024 // 50MB

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getKey } from './secureStore'
import { getCopilotToken } from './githubOAuth'

export type AIProvider = 'claude' | 'openai' | 'copilot' | 'ollama' | 'gemini' | 'deepseek'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AIRequest {
  requestId: string
  provider: AIProvider
  messages: ChatMessage[]
  model?: string
  ollamaUrl?: string
  openaiUrl?: string
}

export interface UsageData {
  model: string
  inputTokens: number
  outputTokens: number
  provider: AIProvider
}

type Sender = IpcMainInvokeEvent['sender']

// Active request abort controllers keyed by requestId
const activeRequests = new Map<string, AbortController>()

function createChunkCollector(): { sender: Sender; chunks: string[] } {
  const chunks: string[] = []
  const sender = {
    send: (_ch: string, _id: string, data?: unknown) => {
      if (typeof data === 'string') chunks.push(data)
    },
  } as unknown as Sender
  return { sender, chunks }
}

/**
 * Coalesce streaming text into 16ms batches to reduce IPC round-trips.
 * Anthropic / OpenAI deltas often arrive every few ms; sending one IPC
 * message per delta floods the renderer event loop.
 */
function makeBatcher(sender: Sender, requestId: string) {
  let buffer = ''
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    if (buffer) {
      sender.send('ai:chunk', requestId, buffer)
      buffer = ''
    }
    timer = null
  }
  return {
    push(text: string) {
      if (!text) return
      buffer += text
      if (!timer) timer = setTimeout(flush, 16)
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null }
      flush()
    },
  }
}

// ─── Claude ──────────────────────────────────────────────────────────────────

async function streamClaude(sender: Sender, req: AIRequest, signal?: AbortSignal): Promise<void> {
  const key = getKey('claude')
  if (!key) throw new Error('Claude API key not configured')

  const isApiKey = key.startsWith('sk-ant-')
  const client = isApiKey
    ? new Anthropic({ apiKey: key })
    : new Anthropic({ authToken: key })
  const systemMsg = req.messages.find(m => m.role === 'system')
  const userMsgs = req.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const resolvedModel = req.model || 'claude-opus-4-6'

  const stream = client.messages.stream({
    model: resolvedModel,
    max_tokens: 4096,
    system: systemMsg?.content,
    messages: userMsgs,
  })

  signal?.addEventListener('abort', () => stream.controller.abort())

  const batch = makeBatcher(sender, req.requestId)
  for await (const chunk of stream) {
    if (signal?.aborted) break
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      batch.push(chunk.delta.text)
    }
  }
  batch.flush()

  if (signal?.aborted) return

  const final = await stream.finalMessage()
  sender.send('ai:usage', req.requestId, {
    provider: 'claude',
    model: final.model,
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  } satisfies UsageData)
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function streamOpenAI(sender: Sender, req: AIRequest, signal?: AbortSignal): Promise<void> {
  const provider = req.provider as 'openai' | 'gemini' | 'deepseek'
  const apiKey = getKey(provider)
  if (!apiKey) throw new Error(`${provider} API key not configured`)

  const baseURL = req.provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai/' :
    req.provider === 'deepseek' ? 'https://api.deepseek.com' :
      req.openaiUrl || undefined

  const resolvedModel = req.model || (provider === 'gemini' ? 'gemini-2.0-flash' : provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o')
  const client = new OpenAI({ apiKey, baseURL })

  let inputTokens = 0
  let outputTokens = 0

  const stream = await client.chat.completions.create({
    model: resolvedModel,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
  })

  const batch = makeBatcher(sender, req.requestId)
  for await (const chunk of stream) {
    if (signal?.aborted) { stream.controller.abort(); break }
    const text = chunk.choices[0]?.delta?.content
    if (text) batch.push(text)
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens
      outputTokens = chunk.usage.completion_tokens
    }
  }
  batch.flush()

  if (!signal?.aborted) {
    sender.send('ai:usage', req.requestId, {
      provider, model: resolvedModel, inputTokens, outputTokens,
    } satisfies UsageData)
  }
}

// ─── GitHub Copilot ──────────────────────────────────────────────────────────

async function streamCopilot(sender: Sender, req: AIRequest, signal?: AbortSignal): Promise<void> {
  const githubToken = getKey('copilot')
  if (!githubToken) throw new Error('GitHub Copilot not connected')

  const copilotToken = await getCopilotToken(githubToken)
  const resolvedModel = req.model || 'gpt-4o'

  const client = new OpenAI({
    apiKey: copilotToken,
    baseURL: 'https://api.githubcopilot.com',
    defaultHeaders: {
      'Editor-Version': 'FTerm/0.1.0',
      'Copilot-Integration-Id': 'vscode-chat',
    },
  })

  let inputTokens = 0
  let outputTokens = 0

  const stream = await client.chat.completions.create({
    model: resolvedModel,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
  })

  const batch = makeBatcher(sender, req.requestId)
  for await (const chunk of stream) {
    if (signal?.aborted) { stream.controller.abort(); break }
    const text = chunk.choices[0]?.delta?.content
    if (text) batch.push(text)
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens
      outputTokens = chunk.usage.completion_tokens
    }
  }
  batch.flush()

  if (!signal?.aborted) {
    sender.send('ai:usage', req.requestId, {
      provider: 'copilot', model: resolvedModel, inputTokens, outputTokens,
    } satisfies UsageData)
  }
}

// ─── Ollama (local) ───────────────────────────────────────────────────────────

async function streamOllama(sender: Sender, req: AIRequest, signal?: AbortSignal): Promise<void> {
  const defaultUrl = req.ollamaUrl || 'http://localhost:11434'
  // Node 18+ fetch often resolves localhost to IPv6 ::1, but Ollama defaults to IPv4 127.0.0.1
  const baseUrl = defaultUrl.replace('//localhost:', '//127.0.0.1:')
  let resolvedModel = req.model || 'llama3'

  // If no model explicitly chosen and we used default llama3, optionally try fetching the first available model to prevent instant 404
  if (!req.model) {
    try {
      const tagRes = await fetch(`${baseUrl}/api/tags`)
      if (tagRes.ok) {
        const json = await tagRes.json()
        if (json.models && json.models.length > 0) {
          resolvedModel = json.models[0].name
        }
      }
    } catch (_) { } // silently fail and try default `llama3`
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: resolvedModel, messages: req.messages, stream: true }),
      signal,
    })
  } catch (err: any) {
    throw new Error(`Failed to connect to Ollama at ${baseUrl} (${err.message})`)
  }

  if (!res.ok) {
    let errBody = res.statusText
    try {
      const json = await res.json()
      if (json.error) errBody = json.error
    } catch (_) { }
    throw new Error(`Ollama error: ${errBody}`)
  }
  if (!res.body) throw new Error('No response body from Ollama')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let inputTokens = 0
  let outputTokens = 0
  let buffer = ''
  const batch = makeBatcher(sender, req.requestId)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    if (buffer.length > MAX_AI_BUFFER) {
      try { reader.cancel() } catch { /* ignore */ }
      throw new Error('Ollama response exceeded 50MB cap')
    }
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as {
          message?: { content?: string }
          prompt_eval_count?: number
          eval_count?: number
          done?: boolean
        }
        const text = parsed.message?.content
        if (text) batch.push(text)
        if (parsed.done) {
          inputTokens = parsed.prompt_eval_count ?? 0
          outputTokens = parsed.eval_count ?? 0
        }
      } catch { /* partial JSON */ }
    }
  }
  batch.flush()

  sender.send('ai:usage', req.requestId, {
    provider: 'ollama', model: resolvedModel, inputTokens, outputTokens,
  } satisfies UsageData)
}

// ─── Single-shot helper (for recording subtitle generation) ──────────────────

export async function aiSingleShot(
  provider: AIProvider,
  prompt: string,
  _apiKey?: string // unused here since secureStore handles keys internally
): Promise<string> {
  const { sender: fakeSender, chunks } = createChunkCollector()

  const req: AIRequest = {
    requestId: 'subtitle-gen',
    provider,
    messages: [{ role: 'user', content: prompt }],
  }

  try {
    switch (provider) {
      case 'claude': await streamClaude(fakeSender, req); break
      case 'openai':
      case 'gemini':
      case 'deepseek': await streamOpenAI(fakeSender, req); break
      case 'copilot': await streamCopilot(fakeSender, req); break
      case 'ollama': await streamOllama(fakeSender, req); break
      default: return ''
    }
    return chunks.join('')
  } catch {
    return ''
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerAIHandlers(): void {
  ipcMain.handle('ai:chat', async (event, req: AIRequest) => {
    const { sender } = event
    const ac = new AbortController()
    activeRequests.set(req.requestId, ac)
    try {
      switch (req.provider) {
        case 'claude': await streamClaude(sender, req, ac.signal); break
        case 'openai':
        case 'gemini':
        case 'deepseek': await streamOpenAI(sender, req, ac.signal); break
        case 'copilot': await streamCopilot(sender, req, ac.signal); break
        case 'ollama': await streamOllama(sender, req, ac.signal); break
        default: throw new Error(`Unknown provider: ${req.provider}`)
      }
      if (!ac.signal.aborted) sender.send('ai:done', req.requestId)
      else sender.send('ai:done', req.requestId) // still mark done so UI clears spinner
    } catch (err) {
      if (!ac.signal.aborted)
        sender.send('ai:error', req.requestId, err instanceof Error ? err.message : String(err))
      else
        sender.send('ai:done', req.requestId)
    } finally {
      activeRequests.delete(req.requestId)
    }
  })

  ipcMain.on('ai:cancel', (_event, requestId: string) => {
    activeRequests.get(requestId)?.abort()
    activeRequests.delete(requestId)
  })

  ipcMain.handle('ai:autocomplete', async (_event, req: AIRequest) => {
    const { sender: fakeSender, chunks } = createChunkCollector()
    try {
      switch (req.provider) {
        case 'claude': await streamClaude(fakeSender, req); break
        case 'openai':
        case 'gemini':
        case 'deepseek': await streamOpenAI(fakeSender, req); break
        case 'copilot': await streamCopilot(fakeSender, req); break
        case 'ollama': await streamOllama(fakeSender, req); break
        default: return ''
      }
      return chunks.join('')
    } catch (err) {
      console.error('Autocomplete error:', err)
      return ''
    }
  })

  ipcMain.handle('ai:test', async (_event, provider: AIProvider, ollamaUrl?: string) => {
    if (provider === 'ollama') {
      const defaultUrl = ollamaUrl || 'http://localhost:11434'
      const baseUrl = defaultUrl.replace('//localhost:', '//127.0.0.1:')
      try {
        const check = await fetch(`${baseUrl}/api/tags`)
        if (!check.ok) throw new Error(`Ollama error: ${check.statusText}`)
        return 'ok'
      } catch (err: any) {
        throw new Error(`Failed to connect to Ollama at ${baseUrl} (${err.message})`)
      }
    }

    // Use fast/cheap models for testing
    const testModel =
      provider === 'claude' ? 'claude-haiku-4-5-20251001' :
        provider === 'openai' ? 'gpt-4o-mini' :
          provider === 'copilot' ? 'gpt-4o-mini' :
            provider === 'gemini' ? 'gemini-2.0-flash' :
              provider === 'deepseek' ? 'deepseek-chat' :
                undefined

    const testReq: AIRequest = {
      requestId: 'test',
      provider,
      model: testModel,
      messages: [{ role: 'user', content: 'Reply with just "ok".' }],
      ollamaUrl,
    }
    const { sender: fakeSender, chunks } = createChunkCollector()
    try {
      switch (provider) {
        case 'claude': await streamClaude(fakeSender, testReq); break
        case 'openai':
        case 'gemini':
        case 'deepseek': await streamOpenAI(fakeSender, testReq); break
        case 'copilot': await streamCopilot(fakeSender, testReq); break
      }
      return chunks.join('') || 'ok'
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
}
