import { useEffect, useState, useCallback } from 'react'
import { motion } from 'motion/react'
import { X, CornerDownRight, Copy, Check, Clock, ArrowRight, Image as ImageIcon } from 'lucide-react'
import { useActiveTheme, useStore } from '@/store'
import { blockImageName, renderBlockImage } from '@/services/recording/blockImage'
import type { Ctx2D, FramePalette } from '@/services/recording/paintFrame'
import { getTracker, type CommandBlock } from '@/services/CommandBlocks'
import { formatDuration, summarizeCommand } from '@/utils/shellIntegration'

/**
 * Session command list for one pane, built from OSC 133 shell-integration
 * markers: every command with its exit code, duration and cwd. Selecting one
 * scrolls the terminal to it; the copy buttons lift the command or its output
 * out of the scrollback without dragging a selection.
 */
export default function CommandBlocksPanel({
  instanceId,
  onClose,
}: {
  instanceId: string
  onClose: () => void
}) {
  const [blocks, setBlocks] = useState<CommandBlock[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null)
  const theme = useActiveTheme()
  const fontFamily = useStore(s => s.settings.fontFamily)

  // The tracker is the source of truth; mirror it into state on every change.
  useEffect(() => {
    const tracker = getTracker(instanceId)
    if (!tracker) return
    const sync = () => setBlocks(tracker.getBlocks().filter(b => b.command))
    sync()
    return tracker.subscribe(sync)
  }, [instanceId])

  // A running command has no duration yet — tick so the elapsed time moves.
  useEffect(() => {
    if (!blocks.some(b => b.running)) return
    const t = setInterval(() => setBlocks(b => [...b]), 500)
    return () => clearInterval(t)
  }, [blocks])

  const copy = useCallback((key: string, text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1200)
    }).catch(() => { })
  }, [])

  /**
   * Renders the block as a PNG and puts it on the clipboard — the thing people
   * actually paste into an issue. Shift-click saves it to a file instead, for
   * when it has to be attached rather than pasted.
   */
  const asImage = useCallback(async (block: CommandBlock, save: boolean) => {
    const palette = theme as unknown as FramePalette
    const canvas = renderBlockImage(
      {
        command: block.command,
        output: getTracker(instanceId)?.getOutput(block.id) ?? '',
        exitCode: block.exitCode,
        durationMs: block.durationMs,
        cwd: block.cwd,
      },
      { theme: palette, fontFamily: fontFamily || 'Cascadia Mono, Consolas, monospace' },
      (w, h) => {
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        return { canvas: c, ctx: c.getContext('2d') as unknown as Ctx2D }
      },
    )

    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/png'))
    if (!blob) return

    if (save) {
      const path = await window.fterm.fsSaveDialog(
        blockImageName(block.command), [{ name: 'PNG image', extensions: ['png'] }])
      if (!path) return
      // fsWriteFile takes text, so the bytes travel as base64 in a data URL
      const dataUrl = canvas.toDataURL('image/png')
      await window.fterm.fsWriteFileBase64(path, dataUrl.split(',')[1])
      setCopied(`img-${block.id}`)
      setTimeout(() => setCopied(c => (c === `img-${block.id}` ? null : c)), 1200)
      return
    }

    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied(`img-${block.id}`)
      setTimeout(() => setCopied(c => (c === `img-${block.id}` ? null : c)), 1200)
    } catch { /* clipboard refused the image — nothing useful to say */ }
  }, [instanceId, theme, fontFamily])

  const reveal = (id: string) => {
    getTracker(instanceId)?.revealBlock(id)
  }

  const togglePreview = (id: string) => {
    if (preview?.id === id) { setPreview(null); return }
    const text = getTracker(instanceId)?.getOutput(id) ?? ''
    setPreview({ id, text: text || '(no output)' })
  }

  const newestFirst = [...blocks].reverse()

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.15 }}
      className="absolute top-2 right-2 bottom-2 w-[min(28rem,calc(100%-1rem))] z-30 flex flex-col
                 rounded-lg border border-[#30363d] bg-[#0d1117]/95 backdrop-blur-md shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] shrink-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-xs font-semibold text-[#c9d1d9] uppercase tracking-wider">Command blocks</h3>
          <span className="text-[10px] text-[#484f58]">{blocks.length}</span>
        </div>
        <button onClick={onClose} className="text-[#8b949e] hover:text-white transition-colors" title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      {newestFirst.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-xs text-[#8b949e]">No commands recorded yet.</p>
          <p className="text-[11px] text-[#484f58] leading-relaxed">
            Blocks appear once you run something. They need FTerm&apos;s shell integration,
            which is injected automatically into new sessions — restart this tab if it
            was opened before the feature landed.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {newestFirst.map(b => {
            const failed = b.exitCode !== null && b.exitCode !== 0
            const elapsed = b.running && b.startedAt ? Date.now() - b.startedAt : b.durationMs
            const scrolledOut = b.promptLine < 0
            return (
              <div key={b.id} className="border-b border-[#21262d] last:border-b-0">
                <div className="group flex items-start gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors">
                  {/* Status rail — green ok, red failed, blue running */}
                  <span
                    className={`mt-1.5 w-1 h-4 rounded-full shrink-0 ${b.running
                      ? 'bg-[#58a6ff] animate-pulse'
                      : failed ? 'bg-[#f85149]' : 'bg-[#3fb950]'}`}
                    title={b.running ? 'Running' : failed ? `Exit ${b.exitCode}` : 'Exit 0'}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => reveal(b.id)}
                      disabled={scrolledOut}
                      title={scrolledOut ? 'Scrolled out of the buffer' : 'Scroll to this command'}
                      className={`block w-full text-left font-mono text-[11px] truncate ${scrolledOut
                        ? 'text-[#484f58] cursor-default'
                        : 'text-[#c9d1d9] hover:text-white'}`}
                    >
                      {summarizeCommand(b.command)}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#484f58]">
                      {b.running
                        ? <span className="text-[#58a6ff]">running…</span>
                        : failed
                          ? <span className="text-[#f85149]">exit {b.exitCode}</span>
                          : <span className="text-[#3fb950]">ok</span>}
                      {elapsed !== null && elapsed !== undefined && (
                        <span className="flex items-center gap-0.5"><Clock size={9} />{formatDuration(elapsed)}</span>
                      )}
                      {b.cwd && <span className="truncate">{b.cwd}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconButton
                      title="Copy command"
                      active={copied === `cmd-${b.id}`}
                      onClick={() => copy(`cmd-${b.id}`, b.command)}
                    >
                      <CornerDownRight size={12} />
                    </IconButton>
                    <IconButton
                      title="Copy output"
                      active={copied === `out-${b.id}`}
                      onClick={() => copy(`out-${b.id}`, getTracker(instanceId)?.getOutput(b.id) ?? '')}
                    >
                      <Copy size={12} />
                    </IconButton>
                    <IconButton
                      title="Copy as image — hold Shift to save a file"
                      active={copied === `img-${b.id}`}
                      onClick={(ev) => asImage(b, ev.shiftKey)}
                    >
                      <ImageIcon size={12} />
                    </IconButton>
                    <IconButton title="Preview output" onClick={() => togglePreview(b.id)}>
                      <ArrowRight size={12} className={preview?.id === b.id ? 'rotate-90 transition-transform' : 'transition-transform'} />
                    </IconButton>
                  </div>
                </div>

                {preview?.id === b.id && (
                  <pre className="mx-3 mb-2 max-h-40 overflow-auto rounded bg-black/50 border border-[#21262d]
                                  px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[#8b949e] whitespace-pre-wrap">
                    {preview.text}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="px-3 py-1.5 border-t border-[#30363d] text-[10px] text-[#484f58] shrink-0">
        <kbd className="font-mono">Ctrl+Shift+↑/↓</kbd> jump between prompts · <kbd className="font-mono">Ctrl+Shift+B</kbd> toggle
      </div>
    </motion.div>
  )
}

function IconButton({
  title, onClick, active, children,
}: {
  title: string
  onClick: (ev: React.MouseEvent) => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1 rounded transition-colors ${active
        ? 'text-[#3fb950]'
        : 'text-[#6e7681] hover:text-white hover:bg-white/10'}`}
    >
      {active ? <Check size={12} /> : children}
    </button>
  )
}
