/**
 * Minimal status bar — shown at the very bottom of the window.
 * Displays active AI provider, model, effort, and token usage per session/week.
 */
import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { estimateCost, formatCost, formatTokens } from '@/utils/tokenCost'
import type { AIProvider, EffortLevel } from '@/types'

const PROVIDER_ICON: Record<AIProvider | 'none', string> = {
  claude: '◆', openai: '◎', copilot: '⊙', ollama: '◈', gemini: '✧', deepseek: '🐳', none: '○',
}

function truncateCwd(cwd: string, segments = 3): string {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= segments) return cwd.replace(/\\/g, '/')
  return '\u2026/' + parts.slice(-segments).join('/')
}

export default function StatusBar() {
  const ai = useStore(s => s.ai)
  const usage = useStore(s => s.usage)
  const tabs = useStore(s => s.tabs)
  const activeTabId = useStore(s => s.activeTabId)
  const setAIConfig = useStore(s => s.setAIConfig)
  const setSettings = useStore(s => s.setSettings)
  const setActiveView = useStore(s => s.setActiveView)
  const claudeStatusline = useStore(s => s.settings.claudeStatusline)
  const activeCwd = tabs.find(t => t.id === activeTabId)?.currentCwd
  const [metrics, setMetrics] = useState({ cpu: 0, ram: 0 })
  const [statuslineText, setStatuslineText] = useState<string | null>(null)
  const lastCpusRef = useRef<any[] | null>(null)

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

          if (totalDiff > 0) {
            cpuUsage = 100 - Math.round((idleDiff / totalDiff) * 100)
          }
        }

        lastCpusRef.current = data.cpus
        const usedRam = data.totalMem - data.freeMem
        const usedRamGB = (usedRam / 1024 / 1024 / 1024).toFixed(1)

        setMetrics({ cpu: Math.max(0, cpuUsage), ram: Number(usedRamGB) })
      } catch (err) {
        console.error('Failed to get system metrics', err)
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      unmounted = true
      clearInterval(timer)
    }
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

  if (provider === 'none') {
    return (
      <div className="flex items-center justify-between h-[22px] px-3 border-t border-white/[0.06] text-[10px] shrink-0 select-none overflow-hidden text-white/40">
        <div className="flex items-center gap-3">
          <span>No AI provider</span>
          {activeCwd && (
            <>
              <Divider />
              <Segment>
                <span className="text-white/25">cwd</span>
                <span className="text-white/50 font-mono">{truncateCwd(activeCwd)}</span>
              </Segment>
            </>
          )}
          {statuslineText && (
            <>
              <Divider />
              <Segment>
                <span className="text-[#58a6ff]/70 font-mono max-w-[240px] truncate">{statuslineText}</span>
              </Segment>
            </>
          )}
        </div>
        <Segment>
          <span className="text-white/25">CPU {metrics.cpu}%</span>
          <Divider />
          <span className="text-white/25">RAM {metrics.ram}GB</span>
        </Segment>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between h-[22px] px-3 border-t border-white/[0.06] text-[10px] shrink-0 select-none overflow-hidden text-white/40">
      <div className="flex items-center gap-2.5">
        {/* Provider + model */}
        <Segment>
          <span className="text-[#58a6ff]">{PROVIDER_ICON[provider]}</span>
          <span className="text-white/60">{model || provider}</span>
        </Segment>

        <Divider />

        {/* Effort picker */}
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

        <Divider />

        <div
          className="flex items-center gap-2.5 cursor-pointer hover:bg-white/[0.04] rounded px-1 -mx-1 transition-colors"
          onClick={() => {
            setActiveView('settings')
            setSettings({ activeSettingsTab: 'stats' })
          }}
        >
          <Segment>
            <span className="text-white/25">session</span>
            <span className="text-white/60">{formatTokens(sessionTotal)}</span>
            {sessionCost !== null && sessionTotal > 0 && (
              <span className="text-white/30">{formatCost(sessionCost)}</span>
            )}
          </Segment>

          <Divider />

          <Segment>
            <span className="text-white/25">today</span>
            <span className="text-white/60">{formatTokens(dayTotal)}</span>
            {dayCost !== null && dayTotal > 0 && (
              <span className="text-white/30">{formatCost(dayCost)}</span>
            )}
          </Segment>

          <Divider />

          <Segment>
            <span className="text-white/25">week</span>
            <span className="text-white/60">{formatTokens(weekTotal)}</span>
            {weekCost !== null && weekTotal > 0 && (
              <span className="text-white/30">{formatCost(weekCost)}</span>
            )}
          </Segment>
        </div>

        {activeCwd && (
          <>
            <Divider />
            <Segment>
              <span className="text-white/25">cwd</span>
              <span className="text-white/50 font-mono">{truncateCwd(activeCwd)}</span>
            </Segment>
          </>
        )}

        {statuslineText && (
          <>
            <Divider />
            <Segment>
              <span className="text-[#58a6ff]/70 font-mono max-w-[240px] truncate">{statuslineText}</span>
            </Segment>
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-white/25">CPU <span className="text-white/50">{metrics.cpu}%</span></span>
        <Divider />
        <span className="text-white/25">RAM <span className="text-white/50">{metrics.ram}GB</span></span>
        {ai.providerStatus[provider]?.connected && (
          <>
            <Divider />
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/80 shrink-0" />
          </>
        )}
      </div>
    </div>
  )
}

function Segment({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>
}

function Divider() {
  return <span className="text-white/[0.12]">|</span>
}
