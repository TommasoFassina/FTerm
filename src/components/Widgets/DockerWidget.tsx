import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X, Play, Square, FileText, Container, Loader2, AlertCircle, RefreshCw } from 'lucide-react'

interface ContainerEntry {
  id: string
  name: string
  image: string
  status: 'running' | 'stopped' | 'paused'
  ports?: string
  uptime?: string
}

interface Props {
  onClose: () => void
}

function parseDockerPs(raw: any): ContainerEntry {
  const statusStr: string = (raw.Status ?? raw.status ?? '').toLowerCase()
  let status: ContainerEntry['status'] = 'stopped'
  if (statusStr.startsWith('up')) status = 'running'
  else if (statusStr.includes('paused')) status = 'paused'
  return {
    id: (raw.ID ?? raw.Id ?? '').slice(0, 12),
    name: (raw.Names ?? raw.Name ?? '').replace(/^\//, ''),
    image: raw.Image ?? '',
    status,
    ports: raw.Ports || undefined,
    uptime: raw.Status ?? raw.status,
  }
}

export default function DockerWidget({ onClose }: Props) {
  const [containers, setContainers] = useState<ContainerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [logs, setLogs] = useState<{ name: string; content: string } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  const load = async () => {
    setLoading(true)
    try {
      const result = await window.fterm.dockerPs()
      if (!mountedRef.current) return
      if (result === null) {
        setUnavailable(true)
      } else {
        setContainers(result.map(parseDockerPs))
        setUnavailable(false)
      }
    } catch {
      if (mountedRef.current) setUnavailable(true)
    }
    if (mountedRef.current) setLoading(false)
  }

  useEffect(() => { load() }, [])

  const toggle = async (c: ContainerEntry) => {
    const action = c.status === 'running' ? 'stop' : 'start'
    setActionLoading(c.id)
    try {
      await window.fterm.dockerAction(c.id, action)
      await load()
    } catch {
      // ignore
    }
    setActionLoading(null)
  }

  const showLogs = async (c: ContainerEntry) => {
    const content = await window.fterm.dockerLogs(c.id)
    setLogs({ name: c.name, content })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-30 flex items-start justify-center pt-8 px-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <div className="w-full max-w-3xl bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2 text-sm text-white/90 font-semibold">
            <Container size={15} className="text-blue-400" />
            Docker Dashboard
            {!unavailable && <span className="ml-1 text-xs font-normal text-white/40">{containers.filter(c => c.status === 'running').length} running</span>}
          </div>
          <div className="flex items-center gap-1">
            {!unavailable && (
              <button onClick={load} className="p-1 hover:bg-white/10 rounded transition-colors text-white/40 hover:text-white" title="Refresh">
                <RefreshCw size={14} />
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors text-white/50 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-white/40 gap-2">
            <Loader2 size={20} className="animate-spin" />
            Connecting to Docker…
          </div>
        )}

        {!loading && unavailable && (
          <div className="flex flex-col items-center justify-center py-16 text-white/40 gap-3">
            <AlertCircle size={24} className="text-yellow-400" />
            <span className="text-sm">Docker is not available or not running</span>
          </div>
        )}

        {!loading && !unavailable && !logs && (
          <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto custom-scrollbar">
            {containers.length === 0 && (
              <div className="py-10 text-center text-white/30 text-sm">No containers found</div>
            )}
            {containers.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  c.status === 'running' ? 'bg-green-400' :
                  c.status === 'paused' ? 'bg-yellow-400' : 'bg-red-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-white">{c.name}</span>
                    <span className="text-xs text-white/40 font-mono">{c.id}</span>
                  </div>
                  <div className="text-xs text-white/40 truncate">{c.image} · {c.uptime}</div>
                  {c.ports && <div className="text-xs text-blue-400/70 font-mono mt-0.5">{c.ports}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => showLogs(c)}
                    className="p-1.5 hover:bg-white/10 rounded transition-colors text-white/40 hover:text-white"
                    title="Logs"
                  >
                    <FileText size={14} />
                  </button>
                  <button
                    onClick={() => toggle(c)}
                    disabled={actionLoading === c.id}
                    className={`p-1.5 rounded transition-colors ${
                      c.status === 'running'
                        ? 'hover:bg-red-500/20 text-red-400/70 hover:text-red-400'
                        : 'hover:bg-green-500/20 text-green-400/70 hover:text-green-400'
                    } disabled:opacity-40`}
                    title={c.status === 'running' ? 'Stop' : 'Start'}
                  >
                    {actionLoading === c.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : c.status === 'running' ? <Square size={14} /> : <Play size={14} />}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {!loading && !unavailable && logs && (
          <div>
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
              <span className="text-sm text-white/70 font-mono">logs: {logs.name}</span>
              <button onClick={() => setLogs(null)} className="text-xs text-white/40 hover:text-white transition-colors">← back</button>
            </div>
            <div className="p-4 font-mono text-xs text-green-400 whitespace-pre-wrap max-h-[380px] overflow-y-auto custom-scrollbar">
              {logs.content || '(no output)'}
            </div>
          </div>
        )}

        <div className="px-4 py-2 border-t border-white/10 bg-white/5 text-xs text-white/30">
          Press Esc to close
        </div>
      </div>
    </motion.div>
  )
}
