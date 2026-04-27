import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/types'

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

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="relative group rounded-md overflow-hidden border border-[#30363d] my-2">
      {lang && (
        <div className="flex items-center justify-between px-3 py-1 bg-[#0d1117] border-b border-[#30363d]">
          <span className="text-[10px] text-[#6e7681] font-mono">{lang}</span>
          <button onClick={copy} className="text-[10px] text-[#6e7681] hover:text-[#c9d1d9] transition-colors">
            {copied ? '✓ copied' : 'copy'}
          </button>
        </div>
      )}
      {!lang && (
        <button
          onClick={copy}
          className="absolute top-1.5 right-2 text-[10px] text-[#6e7681] hover:text-[#c9d1d9] opacity-0 group-hover:opacity-100 transition-all"
        >
          {copied ? '✓' : 'copy'}
        </button>
      )}
      <pre className="px-3 py-2.5 text-[12px] font-mono text-[#c9d1d9] bg-[#0d1117] overflow-x-auto leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  )
}
