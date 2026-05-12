import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/types'
import { useStore } from '@/store'

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude', openai: 'GPT', copilot: 'Copilot', ollama: 'Ollama',
  gemini: 'Gemini', deepseek: 'DeepSeek',
}

interface Props {
  message: ChatMessage
}

function ChatMessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const [copiedAll, setCopiedAll] = useState(false)

  function copyAll() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    })
  }

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {!isUser && message.provider && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-[#6e7681]">
            {PROVIDER_LABELS[message.provider] ?? message.provider}
          </span>
          {!message.streaming && message.content && (
            <button
              onClick={copyAll}
              className="text-[10px] text-[#484f58] hover:text-[#6e7681] transition-colors"
              title="Copy response"
            >
              {copiedAll ? '✓ copied' : 'copy'}
            </button>
          )}
        </div>
      )}

      <div
        className={`
          max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed break-words
          ${isUser
            ? 'bg-[#388bfd] text-white rounded-br-sm whitespace-pre-wrap'
            : 'bg-[#161b22] text-[#c9d1d9] border border-[#30363d] rounded-bl-sm'}
          ${message.error ? 'border-red-500 text-red-400' : ''}
        `}
      >
        {message.error
          ? `Error: ${message.error}`
          : isUser
            ? message.content || (message.streaming ? '' : '…')
            : <MarkdownContent text={message.content} streaming={message.streaming} />
        }
      </div>
    </div>
  )
}

function MarkdownContent({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text && streaming) {
    return <span className="inline-block w-2 h-3 bg-current animate-pulse rounded-sm align-middle" />
  }
  if (!text) return <span className="opacity-40">…</span>

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold text-white mb-1 mt-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-white mb-1 mt-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium text-[#e6edf3] mb-1 mt-2">{children}</h3>,
          p: ({ children }) => <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="mb-1 pl-4 space-y-0.5 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="mb-1 pl-4 space-y-0.5 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#30363d] pl-3 text-[#8b949e] my-1">{children}</blockquote>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) return null // handled by pre
            return (
              <code className="font-mono text-[11px] bg-[#0d1117] border border-[#30363d] px-1 py-0.5 rounded text-[#79c0ff]">
                {children}
              </code>
            )
          },
          pre: ({ children }) => {
            const child = (children as any)?.props
            const lang = child?.className?.replace('language-', '') ?? ''
            const code = child?.children ?? ''
            return <CodeBlock lang={lang} code={String(code).replace(/\n$/, '')} />
          },
          a: ({ href, children }) => (
            <a href={href} className="text-[#58a6ff] underline underline-offset-2 hover:text-[#79c0ff]" target="_blank" rel="noopener noreferrer">{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-2 h-3 ml-0.5 bg-current animate-pulse rounded-sm align-middle" />
      )}
    </div>
  )
}

export default memo(ChatMessageBubble, (prev, next) => (
  prev.message.content === next.message.content &&
  prev.message.streaming === next.message.streaming &&
  prev.message.error === next.message.error
))

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  function flash(msg: string) {
    setStatus(msg)
    setTimeout(() => setStatus(null), 1800)
  }

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function activeInstanceId(): string | null {
    const { tabs, activeTabId } = useStore.getState()
    const tab = tabs.find(t => t.id === activeTabId)
    if (!tab) return null
    const paneId = tab.activePaneId ?? '0'
    return `${tab.id}-${paneId}`
  }

  const isShell = /^(bash|sh|shell|zsh|fish|powershell|pwsh|ps1|cmd|bat|console)$/i.test(lang)

  function runInTerminal() {
    const id = activeInstanceId()
    if (!id) { flash('no active terminal'); return }
    // Trim trailing newline, then submit w/ \r so shell executes
    window.fterm.ptyWrite(id, code.replace(/\r?\n$/, '') + '\r')
    flash('sent')
  }

  function insertAtCursor() {
    const id = activeInstanceId()
    if (!id) { flash('no active terminal'); return }
    window.fterm.ptyWrite(id, code)
    flash('inserted')
  }

  async function saveToFile() {
    try {
      const extMap: Record<string, string> = {
        ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'py', rs: 'rs',
        go: 'go', java: 'java', c: 'c', cpp: 'cpp', cs: 'cs', rb: 'rb',
        php: 'php', sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'fish',
        powershell: 'ps1', pwsh: 'ps1', ps1: 'ps1', cmd: 'bat', bat: 'bat',
        json: 'json', yaml: 'yaml', yml: 'yml', toml: 'toml',
        html: 'html', css: 'css', scss: 'scss', md: 'md', sql: 'sql',
        xml: 'xml', txt: 'txt',
      }
      const ext = extMap[lang.toLowerCase()] || 'txt'
      const path = await window.fterm.fsSaveDialog(`snippet.${ext}`)
      if (!path) return
      await window.fterm.fsWriteFile(path, code)
      flash('saved')
    } catch (e: any) {
      flash(e?.message || 'save failed')
    }
  }

  const btnCls = 'text-[10px] text-[#6e7681] hover:text-[#c9d1d9] transition-colors px-1.5 py-0.5 rounded hover:bg-white/5'

  return (
    <div className="relative group rounded-md overflow-hidden border border-[#30363d] my-2">
      <div className="flex items-center justify-between px-3 py-1 bg-[#0d1117] border-b border-[#30363d]">
        <span className="text-[10px] text-[#6e7681] font-mono">{lang || 'code'}</span>
        <div className="flex items-center gap-1">
          {status && <span className="text-[10px] text-[#3fb950] mr-1">{status}</span>}
          {isShell && (
            <button onClick={runInTerminal} className={btnCls} title="Run in active terminal (Enter)">run</button>
          )}
          <button onClick={insertAtCursor} className={btnCls} title="Insert at terminal cursor (no Enter)">insert</button>
          <button onClick={saveToFile} className={btnCls} title="Save to file…">save</button>
          <button onClick={copy} className={btnCls}>{copied ? '✓ copied' : 'copy'}</button>
        </div>
      </div>
      <pre className="px-3 py-2.5 text-[12px] font-mono text-[#c9d1d9] bg-[#0d1117] overflow-x-auto leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  )
}
