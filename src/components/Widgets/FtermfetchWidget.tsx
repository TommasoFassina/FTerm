import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'motion/react'
import { X, Download } from 'lucide-react'
import { useStore, useActiveTheme } from '@/store'
import type { FetchFieldId } from '@/types'

interface Props {
  onClose: () => void
}

const FTERM_LOGO = [
  ' ███████╗████████╗███████╗██████╗ ███╗   ███╗',
  ' ██╔════╝╚══██╔══╝██╔════╝██╔══██╗████╗ ████║',
  ' █████╗     ██║   █████╗  ██████╔╝██╔████╔██║',
  ' ██╔══╝     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║',
  ' ██║        ██║   ███████╗██║  ██║██║ ╚═╝ ██║',
  ' ╚═╝        ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝',
]

const FIELD_LABELS: Record<FetchFieldId, string> = {
  hostname:      'Host',
  os:            'OS',
  shell:         'Shell',
  cpu:           'CPU',
  memory:        'Memory',
  uptime:        'Uptime',
  cwd:           'CWD',
  petLevel:      'Pet',
  aiProvider:    'AI',
  currentStreak: 'Streak',
  commandsRun:   'Commands',
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
}

export default function FtermfetchWidget({ onClose }: Props) {
  const theme = useActiveTheme()
  const ftermfetchConfig = useStore(s => s.ftermfetchConfig)
  const pet = useStore(s => s.pet)
  const ai = useStore(s => s.ai)
  const terminalStats = useStore(s => s.terminalStats)
  const tabs = useStore(s => s.tabs)
  const activeTabId = useStore(s => s.activeTabId)

  const cardRef = useRef<HTMLDivElement>(null)
  const [sysInfo, setSysInfo] = useState<any>(null)
  const [exporting, setExporting] = useState(false)

  const cwd = tabs.find(t => t.id === activeTabId)?.currentCwd ?? '~'
  const totalCmds = Object.values(terminalStats.activityLog).reduce((s, d) => s + d.commands, 0)

  useEffect(() => {
    window.fterm.getSystemMetrics().then(setSysInfo)
  }, [])

  const accentColor = (id: FetchFieldId): string => {
    if (ftermfetchConfig.colorMode === 'custom' && ftermfetchConfig.fieldColors[id]) {
      return ftermfetchConfig.fieldColors[id]!
    }
    // Theme-derived: cycle through theme colors
    const palette: Record<FetchFieldId, string> = {
      hostname:      theme.blue,
      os:           theme.cyan,
      shell:        theme.green,
      cpu:          theme.yellow,
      memory:       theme.magenta,
      uptime:       theme.cyan,
      cwd:          theme.blue,
      petLevel:     theme.green,
      aiProvider:   theme.magenta,
      currentStreak:theme.yellow,
      commandsRun:  theme.cyan,
    }
    return palette[id] ?? theme.blue
  }

  const getFieldValue = useCallback((id: FetchFieldId): string => {
    if (!sysInfo) return '…'
    switch (id) {
      case 'hostname':      return `${sysInfo.username}@${sysInfo.hostname}`
      case 'os':           return `${sysInfo.platform === 'win32' ? 'Windows' : sysInfo.platform} ${sysInfo.release}`
      case 'shell':        return sysInfo.platform === 'win32' ? 'PowerShell / CMD' : (process.env?.SHELL ?? 'bash')
      case 'cpu':          return sysInfo.cpus?.[0]?.model?.replace(/\(R\)|Core\(TM\)|CPU @/g, '').trim() ?? 'Unknown'
      case 'memory': {
        const used = sysInfo.totalMem - sysInfo.freeMem
        const pct = Math.round((used / sysInfo.totalMem) * 100)
        return `${formatBytes(used)} / ${formatBytes(sysInfo.totalMem)}  ${pct}%`
      }
      case 'uptime':       return formatUptime(sysInfo.uptime)
      case 'cwd':          return cwd.length > 48 ? '…' + cwd.slice(-47) : cwd
      case 'petLevel':     return `${pet.name} (${pet.type}) — Lv.${pet.level} · ${pet.xp}/${pet.maxXp} XP`
      case 'aiProvider':   return ai.provider === 'none' ? 'None' : `${ai.provider}${ai.model ? ` · ${ai.model}` : ''}`
      case 'currentStreak':return `${terminalStats.currentStreak} days (best: ${terminalStats.longestStreak})`
      case 'commandsRun':  return totalCmds.toLocaleString()
      default:             return '?'
    }
  }, [sysInfo, pet, ai, terminalStats, cwd, totalCmds])

  const handleExport = async () => {
    if (!cardRef.current || exporting) return
    setExporting(true)
    try {
      const rect = cardRef.current.getBoundingClientRect()
      const dataUrl = await window.fterm.captureRect({
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `ftermfetch-${new Date().toISOString().slice(0, 10)}.png`
      a.click()
    } finally {
      setExporting(false)
    }
  }

  const enabledFields = ftermfetchConfig.fields.filter(f => f.enabled)

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        ref={cardRef}
        className="relative flex flex-col gap-0 rounded-xl overflow-hidden border shadow-2xl"
        style={{ background: theme.background, borderColor: theme.blue + '44', minWidth: 580, maxWidth: 720 }}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: theme.blue + '33', background: theme.black + 'cc' }}>
          <span className="text-xs font-mono" style={{ color: theme.brightBlack }}>ftermfetch</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80"
              style={{ background: theme.blue + '33', color: theme.blue }}
              title="Export as PNG"
            >
              <Download size={11} />
              {exporting ? 'exporting…' : 'export PNG'}
            </button>
            <button onClick={onClose} className="rounded p-1 hover:opacity-80 transition-opacity" style={{ color: theme.brightBlack }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex gap-6 p-6">
          {/* Logo */}
          <div className="flex flex-col gap-0 shrink-0">
            {FTERM_LOGO.map((line, i) => (
              <span key={i} className="font-mono text-[11px] leading-[1.35]" style={{
                color: i < 2 ? theme.blue : i < 4 ? theme.cyan : theme.brightBlue,
                textShadow: `0 0 8px ${theme.blue}88`,
                whiteSpace: 'pre',
              }}>
                {line}
              </span>
            ))}
            <span className="font-mono text-[10px] mt-2" style={{ color: theme.brightBlack }}>
              The AI-Powered Terminal · v0.1.0
            </span>
            <span className="font-mono text-[10px]" style={{ color: theme.brightBlack }}>
              {sysInfo ? `↑ ${formatUptime(sysInfo.uptime)}` : ''}
            </span>
          </div>

          {/* Fields */}
          <div className="flex flex-col gap-[6px] flex-1 justify-center">
            {enabledFields.map(field => {
              const memPct = field.id === 'memory' && sysInfo
                ? Math.round(((sysInfo.totalMem - sysInfo.freeMem) / sysInfo.totalMem) * 100)
                : null
              return (
                <div key={field.id} className="flex items-center gap-2 font-mono text-[12px]">
                  <span className="shrink-0 w-[88px] text-right" style={{ color: accentColor(field.id) }}>
                    {FIELD_LABELS[field.id]}
                  </span>
                  <span style={{ color: theme.brightBlack }}>──</span>
                  <span style={{ color: theme.foreground }}>{getFieldValue(field.id)}</span>
                  {memPct !== null && (
                    <div className="flex-1 max-w-[80px] h-[6px] rounded-full overflow-hidden" style={{ background: theme.black }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${memPct}%`,
                          background: memPct > 80 ? theme.red : memPct > 60 ? theme.yellow : theme.green,
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {/* Color separator line */}
            <div className="mt-2 h-[3px] rounded" style={{
              background: `linear-gradient(to right, ${theme.red}, ${theme.yellow}, ${theme.green}, ${theme.cyan}, ${theme.blue}, ${theme.magenta})`
            }} />
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
