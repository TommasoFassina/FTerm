import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Wifi, WifiOff, Loader2 } from 'lucide-react'

interface PingResult {
  host: string
  rtts: number[]
  lost: number
  avg: number
  min: number
  max: number
  count: number
}

interface Props {
  host: string
  onClose: () => void
}

function getLatencyColor(ms: number): string {
  if (ms === 0) return '#6e7681'
  if (ms < 30) return '#3fb950'
  if (ms < 80) return '#d29922'
  if (ms < 150) return '#f97316'
  return '#ff7b72'
}

function getLatencyLabel(ms: number): string {
  if (ms === 0) return 'Lost'
  if (ms < 30) return 'Excellent'
  if (ms < 80) return 'Good'
  if (ms < 150) return 'Fair'
  return 'Poor'
}

export default function PingWidget({ host, onClose }: Props) {
  const [result, setResult] = useState<PingResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.fterm.pingHost(host, 10)
      .then(r => { setResult(r); setLoading(false) })
      .catch(err => { setError(err.message ?? 'Ping failed'); setLoading(false) })
  }, [host])

  const maxRtt = result?.rtts?.length ? Math.max(...result.rtts, 1) : 1
  const lossPercent = result?.count ? Math.round((result.lost / result.count) * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-30 flex items-start justify-center pt-10 px-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2, type: 'spring', stiffness: 260, damping: 20 }}
        className="relative w-full max-w-md rounded-2xl overflow-hidden border border-white/15 shadow-2xl"
        style={{ backdropFilter: 'blur(20px)', background: 'linear-gradient(135deg, rgba(13,17,23,0.9), rgba(13,17,23,0.75))' }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white z-10"
        >
          <X size={16} />
        </button>

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-white/40 gap-3">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-sm">Pinging {host}…</span>
            <span className="text-xs text-white/25">sending 10 packets</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 text-red-400 gap-3">
            <WifiOff size={24} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {result && !loading && (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-center gap-2 mb-1">
                {result.lost === result.count
                  ? <WifiOff size={18} className="text-red-400" />
                  : <Wifi size={18} style={{ color: getLatencyColor(result.avg) }} />
                }
                <span className="text-white/50 text-sm font-mono">{result.host}</span>
              </div>
              <div className="flex items-end gap-3">
                <span className="text-5xl font-thin text-white">{result.avg}</span>
                <div className="pb-1">
                  <div className="text-white/50 text-sm">ms avg</div>
                  <div className="text-xs font-medium" style={{ color: getLatencyColor(result.avg) }}>
                    {getLatencyLabel(result.avg)}
                  </div>
                </div>
              </div>
            </div>

            {/* RTT bar chart */}
            <div className="px-5 pb-4">
              <div className="text-xs text-white/30 mb-2">Round-trip times ({result.count} packets)</div>
              <div className="flex items-end gap-1 h-16">
                {Array.from({ length: result.count }, (_, i) => {
                  const isLost = i >= result.rtts.length
                  const rtt = isLost ? 0 : result.rtts[i]
                  const heightPct = isLost ? 8 : Math.max(8, (rtt / maxRtt) * 100)
                  const color = getLatencyColor(rtt)
                  return (
                    <motion.div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{ background: color, opacity: isLost ? 0.25 : 0.85 }}
                      initial={{ height: 0 }}
                      animate={{ height: `${heightPct}%` }}
                      transition={{ delay: i * 0.06, duration: 0.35, ease: 'easeOut' }}
                      title={isLost ? 'Lost' : `${rtt} ms`}
                    />
                  )
                })}
              </div>
              {/* RTT labels */}
              <AnimatePresence>
                {result.rtts.length > 0 && (
                  <div className="flex justify-between mt-1 text-[10px] text-white/25 font-mono">
                    <span>{result.min} ms min</span>
                    <span>{result.avg} ms avg</span>
                    <span>{result.max} ms max</span>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-px border-t border-white/10">
              <Stat label="Sent" value={`${result.count}`} />
              <Stat label="Received" value={`${result.count - result.lost}`} />
              <Stat
                label="Loss"
                value={`${lossPercent}%`}
                valueColor={lossPercent === 0 ? '#3fb950' : lossPercent < 20 ? '#d29922' : '#ff7b72'}
              />
            </div>
            <div className="px-4 py-2 text-center text-xs text-white/20">Press Esc to close</div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex flex-col items-center py-3 bg-white/5">
      <div className="text-white font-medium text-sm" style={{ color: valueColor }}>{value}</div>
      <div className="text-white/40 text-xs">{label}</div>
    </div>
  )
}
