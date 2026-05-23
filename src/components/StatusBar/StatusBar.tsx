import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { estimateCost, formatCost, formatTokens } from '@/utils/tokenCost'
import type { AIProvider, EffortLevel } from '@/types'

const PROVIDER_ICON: Record<AIProvider | 'none', string> = {
  claude: '◆', openai: '◎', copilot: '⊙', ollama: '◈', gemini: '✧', deepseek: '🐳', none: '○',
}

function truncateCwd(cwd: string, segments = 3): string {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= segments) return cwd.replace(/\\/g, '/')
  return '…/' + parts.slice(-segments).join('/')
}

export default function StatusBar() {
  const {
    ai, usage, activeTabId, setAIConfig, setSettings, setActiveView, setPendingWidget,
    claudeStatusline, statusBarCfg, claudeCodeUsage, setClaudeCodeStats, addClaudeCodeCost,
  } = useStore(useShallow(s => ({
    ai: s.ai,
    usage: s.usage,
    activeTabId: s.activeTabId,
    setAIConfig: s.setAIConfig,
    setSettings: s.setSettings,
    setActiveView: s.setActiveView,
    setPendingWidget: s.setPendingWidget,
    claudeStatusline: s.settings.claudeStatusline,
    statusBarCfg: s.settings.statusBar,
    claudeCodeUsage: s.claudeCodeUsage,
    setClaudeCodeStats: s.setClaudeCodeStats,
    addClaudeCodeCost: s.addClaudeCodeCost,
  })))
  const sb = {
    showCpuRam: statusBarCfg?.showCpuRam !== false,
    showEffort: statusBarCfg?.showEffort !== false,
    showTokens: statusBarCfg?.showTokens !== false,
    showCwd: statusBarCfg?.showCwd !== false,
    showClaudeStats: statusBarCfg?.showClaudeStats !== false,
    showProvider: statusBarCfg?.showProvider !== false,
  }
  const claudeCodeStats = useStore(s => activeTabId ? s.claudeCodeStats[activeTabId] : null)
  const activeCwd = useStore(s => s.tabs.find(t => t.id === s.activeTabId)?.currentCwd)
  const [metrics, setMetrics] = useState({ cpu: 0, ram: 0 })
  const [statuslineText, setStatuslineText] = useState<string | null>(null)
  const [showClaudePopover, setShowClaudePopover] = useState(false)
  const [contextWarnDismissed, setContextWarnDismissed] = useState(false)
  const statsFileRef = useRef<string | null>(null)
  const lastStatsSessionRef = useRef<string | null>(null)
  const lastStatsCostRef = useRef<number>(0)
  const lastCpusRef = useRef<any[] | null>(null)
  const claudeCodeStatsRef = useRef(claudeCodeStats)
  claudeCodeStatsRef.current = claudeCodeStats
  const claudeBtnRef = useRef<HTMLButtonElement>(null)
  const prevContextPct = useRef<number | null>(null)

  useEffect(() => {
    const pct = claudeCodeStats?.contextPct ?? null
    if (pct !== null && pct >= 80 && (prevContextPct.current ?? 0) < 80) {
      setContextWarnDismissed(false)
    }
    prevContextPct.current = pct
  }, [claudeCodeStats?.contextPct])

  const sendClaudeCmd = useCallback((cmd: string) => {
    if (!activeTabId) return
    const writeFn = window.__ftermTerminalWrite?.get(activeTabId)
    if (writeFn) {
      writeFn(cmd + '\r')
    } else {
      window.fterm.ptyWrite(activeTabId, cmd + '\r')
    }
    setShowClaudePopover(false)
  }, [activeTabId])

  useEffect(() => {
    let unmounted = false
    const poll = async () => {
      try {
        const data = await window.fterm.getSystemMetrics()
        if (unmounted) return

        let cpuUsage = 0
        if (lastCpusRef.current) {
          const currentCpus = data.cpus
          const lastCpus = lastCpusRef.current
          let totalDiff = 0
          let idleDiff = 0
          for (let i = 0; i < currentCpus.length; i++) {
            const c = currentCpus[i].times
            const l = lastCpus[i].times
            const totalC = Object.values(c).reduce((v, t) => (v as number) + (t as number), 0) as number
            const totalL = Object.values(l).reduce((v, t) => (v as number) + (t as number), 0) as number
            totalDiff += totalC - totalL
            idleDiff += c.idle - l.idle
          }
          if (totalDiff > 0) cpuUsage = 100 - Math.round((idleDiff / totalDiff) * 100)
        }

        lastCpusRef.current = data.cpus
        const usedRamGB = ((data.totalMem - data.freeMem) / 1024 / 1024 / 1024).toFixed(1)
        setMetrics({ cpu: Math.max(0, cpuUsage), ram: Number(usedRamGB) })
      } catch { /* non-critical */ }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => { unmounted = true; clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!claudeStatusline?.enabled || !claudeStatusline.command) {
      setStatuslineText(null)
      return
    }
    let unmounted = false
    const poll = async () => {
      try {
        const out = await window.fterm.shellExec(claudeStatusline.command)
        if (!unmounted) setStatuslineText(out || null)
      } catch {
        if (!unmounted) setStatuslineText(null)
      }
    }
    poll()
    const timer = setInterval(poll, claudeStatusline.pollInterval ?? 3000)
    return () => { unmounted = true; clearInterval(timer) }
  }, [claudeStatusline?.enabled, claudeStatusline?.command, claudeStatusline?.pollInterval])

  useEffect(() => {
    let unmounted = false
    const init = async () => {
      try {
        const status = await window.fterm.claudeHookStatus()
        if (!unmounted) statsFileRef.current = status.statsFile
      } catch {}
    }
    init()

    const poll = async () => {
      const statsFile = statsFileRef.current
      if (!statsFile) return
      try {
        const raw = await window.fterm.fsReadFile(statsFile)
        if (unmounted || !raw) return
        const parsed = JSON.parse(raw)
        if (!parsed?.sessionId) return

        if (parsed.sessionId !== lastStatsSessionRef.current) {
          lastStatsSessionRef.current = parsed.sessionId
          lastStatsCostRef.current = 0
        }

        if (!activeTabId) return
        const prevCtxPct = claudeCodeStatsRef.current?.contextPct ?? null

        // API `input_tokens` already excludes cached tokens; cache_read priced at 10% input rate.
        const cost = parsed.model && (parsed.tokensIn || parsed.tokensOut || parsed.cacheRead)
          ? (() => {
              const base = estimateCost(parsed.model, parsed.tokensIn ?? 0, parsed.tokensOut ?? 0)
              if (base === null) return null
              const cacheCost = estimateCost(parsed.model, parsed.cacheRead ?? 0, 0)
              return base + (cacheCost !== null ? cacheCost * 0.1 : 0)
            })()
          : null
        if (cost !== null) {
          const delta = cost - lastStatsCostRef.current
          if (delta > 0) {
            addClaudeCodeCost(delta)
            lastStatsCostRef.current = cost
          }
        }

        setClaudeCodeStats(activeTabId, {
          model: parsed.model ?? null,
          tokensIn: parsed.tokensIn ?? 0,
          tokensOut: parsed.tokensOut ?? 0,
          contextPct: prevCtxPct,
          cost,
        })
      } catch {}
    }

    const timer = setInterval(poll, 2000)
    return () => { unmounted = true; clearInterval(timer) }
  }, [activeTabId, setClaudeCodeStats, addClaudeCodeCost])

  const provider = ai.provider
  const provUsage = provider !== 'none' ? usage[provider] : undefined
  const model = (provider === 'ollama' ? ai.ollamaModel : ai.model) || provUsage?.lastModel || ''

  const sessionIn = provUsage?.sessionInput ?? 0
  const sessionOut = provUsage?.sessionOutput ?? 0
  const dayIn = provUsage?.dayInput ?? 0
  const dayOut = provUsage?.dayOutput ?? 0
  const weekIn = provUsage?.weekInput ?? 0
  const weekOut = provUsage?.weekOutput ?? 0

  const sessionTotal = sessionIn + sessionOut
  const dayTotal = dayIn + dayOut
  const weekTotal = weekIn + weekOut

  const sessionCost = model ? estimateCost(model, sessionIn, sessionOut) : null
  const dayCost = model ? estimateCost(model, dayIn, dayOut) : null
  const weekCost = model ? estimateCost(model, weekIn, weekOut) : null

  const cpuRamBtn = sb.showCpuRam && (
    <button
      className="flex items-center gap-1.5 hover:bg-white/[0.06] rounded px-1 -mx-1 transition-colors cursor-pointer"
      onClick={() => activeTabId && setPendingWidget({ type: 'sys-mon', tabId: activeTabId })}
      title="Open system monitor"
    >
      <span className="text-white/25">CPU <span className="text-white/50">{metrics.cpu}%</span></span>
      <Divider />
      <span className="text-white/25">RAM <span className="text-white/50">{metrics.ram}GB</span></span>
    </button>
  )

  const claudeBadge = sb.showClaudeStats && claudeCodeStats && (
    <>
      <Divider />
      <ClaudeStatsBadge
        stats={claudeCodeStats}
        usage={claudeCodeUsage}
        btnRef={claudeBtnRef}
        open={showClaudePopover}
        onToggle={() => setShowClaudePopover(v => !v)}
        onClose={() => setShowClaudePopover(false)}
        onCmd={sendClaudeCmd}
      />
    </>
  )

  const cwdBtn = sb.showCwd && activeCwd && (
    <>
      <Divider />
      <button
        className="flex items-center gap-1 hover:bg-white/[0.06] rounded px-1 -mx-1 transition-colors cursor-pointer"
        onClick={() => activeTabId && setPendingWidget({ type: 'file-explorer', data: { path: activeCwd }, tabId: activeTabId })}
        title="Open file explorer here"
      >
        <span className="text-white/25">cwd</span>
        <span className="text-white/50 font-mono">{truncateCwd(activeCwd)}</span>
      </button>
    </>
  )

  return (
    <div className="flex items-center justify-between h-[22px] px-3 border-t border-white/[0.06] text-[10px] shrink-0 select-none overflow-hidden text-white/40">
      <div className="flex items-center gap-2.5">
        {provider === 'none' ? (
          <span>No AI provider</span>
        ) : (
          <>
            {sb.showProvider && (
              <Segment>
                <span className="text-[#58a6ff]">{PROVIDER_ICON[provider]}</span>
                <span className="text-white/60">{model || provider}</span>
              </Segment>
            )}

            {sb.showProvider && sb.showEffort && <Divider />}

            {sb.showEffort && (
              <div className="flex items-center rounded-[3px] border border-white/[0.08] overflow-hidden">
                {(['fast', 'auto', 'thorough'] as EffortLevel[]).map(e => (
                  <button
                    key={e}
                    onClick={() => setAIConfig({ effort: e })}
                    className={`px-1.5 py-[1px] text-[9px] uppercase tracking-wider transition-all duration-150 ${ai.effort === e
                      ? 'bg-[#58a6ff]/20 text-[#58a6ff] font-medium'
                      : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}

            {sb.showEffort && sb.showTokens && <Divider />}

            {sb.showTokens && (
              <div
                className="flex items-center gap-2.5 cursor-pointer hover:bg-white/[0.04] rounded px-1 -mx-1 transition-colors"
                onClick={() => { setActiveView('settings'); setSettings({ activeSettingsTab: 'stats' }) }}
              >
                <Segment>
                  <span className="text-white/25">session</span>
                  <span className="text-white/60">{formatTokens(sessionTotal)}</span>
                  {sessionCost !== null && sessionTotal > 0 && <span className="text-white/30">{formatCost(sessionCost)}</span>}
                </Segment>
                <Divider />
                <Segment>
                  <span className="text-white/25">today</span>
                  <span className="text-white/60">{formatTokens(dayTotal)}</span>
                  {dayCost !== null && dayTotal > 0 && <span className="text-white/30">{formatCost(dayCost)}</span>}
                </Segment>
                <Divider />
                <Segment>
                  <span className="text-white/25">week</span>
                  <span className="text-white/60">{formatTokens(weekTotal)}</span>
                  {weekCost !== null && weekTotal > 0 && <span className="text-white/30">{formatCost(weekCost)}</span>}
                </Segment>
              </div>
            )}
          </>
        )}

        {cwdBtn}

        {statuslineText && (
          <>
            <Divider />
            <Segment>
              <span className="text-[#58a6ff]/70 font-mono max-w-[240px] truncate">{statuslineText}</span>
            </Segment>
          </>
        )}

        {claudeBadge}
      </div>

      <div className="flex items-center gap-2.5">
        {cpuRamBtn}
        {provider !== 'none' && ai.providerStatus[provider]?.connected && (
          <>
            {sb.showCpuRam && <Divider />}
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/80 shrink-0" />
          </>
        )}
      </div>

      {claudeCodeStats && claudeCodeStats.contextPct !== null && claudeCodeStats.contextPct >= 80 && !contextWarnDismissed &&
        createPortal(
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 bg-[#3d2b00] border border-[#d29922]/40 text-[#d29922] text-[10px] rounded px-3 py-1.5 shadow-lg">
            <span>Context {claudeCodeStats.contextPct}% full — consider</span>
            <button className="underline hover:text-[#e3b341] transition-colors" onClick={() => sendClaudeCmd('/compact')}>/compact</button>
            <button className="ml-1 text-white/40 hover:text-white/70 transition-colors" onClick={() => setContextWarnDismissed(true)}>✕</button>
          </div>,
          document.body
        )
      }
    </div>
  )
}

function ClaudeStatsBadge({ stats, usage, btnRef, open, onToggle, onClose, onCmd }: {
  stats: import('@/types').ClaudeCodeStats
  usage: import('@/types').ClaudeCodeUsage
  btnRef: React.RefObject<HTMLButtonElement>
  open: boolean
  onToggle: () => void
  onClose: () => void
  onCmd: (cmd: string) => void
}) {
  const [popoverPos, setPopoverPos] = useState({ bottom: 0, left: 0 })

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopoverPos({ bottom: window.innerHeight - r.top + 4, left: r.left })
    }
    onToggle()
  }

  return (
    <>
      <button
        ref={btnRef}
        className="flex items-center gap-1 hover:bg-white/[0.06] rounded px-1 -mx-1 transition-colors cursor-pointer"
        onClick={handleToggle}
        title="Claude Code — click for quick actions"
      >
        <span className={`text-[#f78166]/80 ${stats.contextPct !== null && stats.contextPct >= 80 ? 'animate-pulse' : ''}`}>◆</span>
        {stats.model && (
          <span className="text-white/40 font-mono">{stats.model.replace('claude-', '')}</span>
        )}
        {(stats.tokensIn > 0 || stats.tokensOut > 0) && (
          <span className="text-white/50 font-mono">
            ↑{formatTokens(stats.tokensIn)} ↓{formatTokens(stats.tokensOut)}
          </span>
        )}
        {stats.contextPct !== null && <ContextBar pct={stats.contextPct} />}
        {stats.cost !== null && (
          <span className="text-[#3fb950]/70 font-mono">${stats.cost.toFixed(4)}</span>
        )}
        {usage.dayCost > 0 && (
          <span className="text-white/25 font-mono">d:${usage.dayCost.toFixed(3)}</span>
        )}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={onClose} />
          <div
            className="fixed z-[9999] bg-[#161b22] border border-white/10 rounded-md shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[150px]"
            style={{ bottom: popoverPos.bottom, left: popoverPos.left }}
          >
            <p className="text-[9px] text-white/30 uppercase tracking-wider px-2 py-1">Claude Code</p>
            <ClaudeAction label="/compact" desc="Compress context" onClick={() => onCmd('/compact')} />
            <ClaudeAction label="/clear" desc="Clear conversation" onClick={() => onCmd('/clear')} />
            <ClaudeAction label="/cost" desc="Show cost summary" onClick={() => onCmd('/cost')} />
            <ClaudeAction label="/status" desc="Agent status" onClick={() => onCmd('/status')} />
            {usage.weekCost > 0 && (
              <div className="border-t border-white/[0.06] mt-0.5 pt-1.5 px-2 flex flex-col gap-0.5">
                <span className="text-[9px] text-white/30">Today: <span className="text-[#3fb950]/70">${usage.dayCost.toFixed(3)}</span></span>
                <span className="text-[9px] text-white/30">Week: <span className="text-[#3fb950]/70">${usage.weekCost.toFixed(3)}</span></span>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  )
}

function ContextBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? '#f85149' : pct >= 60 ? '#d29922' : '#3fb950'
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-[6px] rounded-sm bg-white/10 overflow-hidden"
        style={{ width: 36 }}
        title={`Context ${pct}%`}
      >
        <span
          className="block h-full rounded-sm transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
      <span className="font-mono text-white/30" style={{ color }}>{pct}%</span>
    </span>
  )
}

function ClaudeAction({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.06] text-left transition-colors w-full"
      onMouseDown={e => { e.stopPropagation(); onClick() }}
    >
      <span className="text-[#58a6ff] font-mono text-[10px]">{label}</span>
      <span className="text-white/30 text-[9px]">{desc}</span>
    </button>
  )
}

function Segment({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>
}

function Divider() {
  return <span className="text-white/[0.12]">|</span>
}
