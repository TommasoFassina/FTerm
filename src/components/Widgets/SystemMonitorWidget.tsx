import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X, Cpu, MemoryStick, Activity, ArrowDown, ArrowUp } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts'

interface DataPoint {
  t: string
  cpu: number
  ram: number
  rxKbps: number
  txKbps: number
}

interface Props {
  onClose: () => void
}

function calcCpuPercent(prev: any[], curr: any[]): number {
  let totalIdle = 0, totalTick = 0
  for (let i = 0; i < curr.length; i++) {
    const p = prev[i]?.times ?? curr[i].times
    const c = curr[i].times
    const prevTotal = Object.values(p as Record<string, number>).reduce((a, b) => a + b, 0)
    const currTotal = Object.values(c as Record<string, number>).reduce((a, b) => a + b, 0)
    totalTick += currTotal - prevTotal
    totalIdle += (c.idle - p.idle)
  }
  if (totalTick === 0) return 0
  return Math.round((1 - totalIdle / totalTick) * 100)
}

export default function SystemMonitorWidget({ onClose }: Props) {
  const [data, setData] = useState<DataPoint[]>([])
  const prevCpusRef = useRef<any[] | null>(null)
  const latest = data[data.length - 1] ?? { cpu: 0, ram: 0, rxKbps: 0, txKbps: 0, t: '' }

  const fmtNet = (kbps: number) => kbps >= 1024
    ? `${(kbps / 1024).toFixed(1)} MB/s`
    : `${kbps.toFixed(1)} KB/s`

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const m = await window.fterm.getSystemMetrics()
        if (cancelled) return

        const cpu = prevCpusRef.current ? calcCpuPercent(prevCpusRef.current, m.cpus) : 0
        prevCpusRef.current = m.cpus

        const ram = Math.round(((m.totalMem - m.freeMem) / m.totalMem) * 100)
        const t = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const { rxKbps = 0, txKbps = 0 } = m.network ?? {}

        setData(prev => [...prev.slice(-39), { t, cpu, ram, rxKbps, txKbps }])
      } catch {
        // ignore
      }
    }

    poll()
    const id = setInterval(poll, 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

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
            <Activity size={15} className="text-green-400" />
            System Monitor
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 px-5 pt-4">
          <StatCard icon={<Cpu size={16} className="text-blue-400" />} label="CPU" value={`${latest.cpu}%`} color="#58a6ff" />
          <StatCard icon={<MemoryStick size={16} className="text-purple-400" />} label="RAM" value={`${latest.ram}%`} color="#bc8cff" />
          <StatCard icon={<ArrowDown size={16} className="text-green-400" />} label="Download" value={fmtNet(latest.rxKbps)} color="#3fb950" />
          <StatCard icon={<ArrowUp size={16} className="text-orange-400" />} label="Upload" value={fmtNet(latest.txKbps)} color="#f97316" />
        </div>

        {/* Charts */}
        <div className="px-5 pb-5 pt-4 space-y-4">
          <ChartSection label="CPU Usage" dataKey="cpu" data={data} color="#58a6ff" unit="%" />
          <ChartSection label="RAM Usage" dataKey="ram" data={data} color="#bc8cff" unit="%" />
          <ChartSection label="Network Download" dataKey="rxKbps" data={data} color="#3fb950" unit=" KB/s" autoScale />
        </div>

        <div className="px-5 pb-3 text-xs text-white/30 text-right">Live data · Press Esc to close</div>
      </div>
    </motion.div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center gap-3">
      {icon}
      <div>
        <div className="text-xs text-white/40">{label}</div>
        <div className="text-lg font-bold" style={{ color }}>{value}</div>
      </div>
    </div>
  )
}

function ChartSection({ label, dataKey, data, color, unit, autoScale }: {
  label: string; dataKey: string; data: DataPoint[]; color: string; unit: string; autoScale?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <ResponsiveContainer width="100%" height={70}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="t" hide />
          <YAxis domain={autoScale ? ['auto', 'auto'] : [0, 100]} hide />
          <Tooltip
            contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 11 }}
            labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
            itemStyle={{ color }}
            formatter={(v) => [`${v ?? 0}${unit}`, label]}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#grad-${dataKey})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
