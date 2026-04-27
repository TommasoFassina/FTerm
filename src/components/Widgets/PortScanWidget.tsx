import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { X, Loader2, Shield, ShieldAlert } from 'lucide-react'

const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 143, 443, 465,
  587, 993, 995, 1433, 3306, 3389, 5432, 5900,
  6379, 8080, 8443, 8888, 27017,
]

const PORT_NAMES: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS',
  587: 'SMTP', 993: 'IMAPS', 995: 'POP3S', 1433: 'MSSQL', 3306: 'MySQL',
  3389: 'RDP', 5432: 'Postgres', 5900: 'VNC', 6379: 'Redis',
  8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 8888: 'Jupyter', 27017: 'MongoDB',
}

interface Props {
  host: string
  onClose: () => void
}

export default function PortScanWidget({ host, onClose }: Props) {
  const [results, setResults] = useState<{ port: number; open: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.fterm.portScan(host, COMMON_PORTS)
      .then(r => { setResults(r); setLoading(false) })
      .catch(err => { setError(err.message ?? 'Scan failed'); setLoading(false) })
  }, [host])

  const open = results.filter(r => r.open)
  const closed = results.filter(r => !r.open)

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
        className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-white/15 shadow-2xl"
        style={{ backdropFilter: 'blur(20px)', background: 'linear-gradient(135deg, rgba(13,17,23,0.92), rgba(13,17,23,0.78))' }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white z-10"
        >
          <X size={16} />
        </button>

        <div className="px-5 pt-5 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2 mb-0.5">
            <Shield size={16} className="text-white/50" />
            <span className="text-white/50 text-sm font-mono">{host}</span>
          </div>
          <div className="text-white text-xl font-light">Port Scan</div>
          <div className="text-white/40 text-xs mt-0.5">Scanning {COMMON_PORTS.length} common ports</div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-white/40 gap-3">
            <Loader2 size={22} className="animate-spin" />
            <span className="text-sm">Scanning ports…</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 text-red-400 gap-3">
            <ShieldAlert size={22} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="grid grid-cols-3 gap-px border-b border-white/10">
              <Stat label="Scanned" value={String(results.length)} />
              <Stat label="Open" value={String(open.length)} valueColor={open.length > 0 ? '#3fb950' : '#6e7681'} />
              <Stat label="Closed" value={String(closed.length)} />
            </div>

            <div className="max-h-72 overflow-y-auto custom-scrollbar p-3 space-y-1">
              {open.length === 0 && (
                <div className="text-white/30 text-sm text-center py-6">No open ports found</div>
              )}
              {results
                .filter(r => r.open)
                .map((r, i) => (
                  <motion.div
                    key={r.port}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-green-300 font-mono text-sm">{r.port}</span>
                      {PORT_NAMES[r.port] && (
                        <span className="text-white/40 text-xs">{PORT_NAMES[r.port]}</span>
                      )}
                    </div>
                    <span className="text-green-400/70 text-xs">open</span>
                  </motion.div>
                ))}
              {results
                .filter(r => !r.open)
                .map((r) => (
                  <div
                    key={r.port}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg opacity-40"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                      <span className="text-white/50 font-mono text-xs">{r.port}</span>
                      {PORT_NAMES[r.port] && (
                        <span className="text-white/25 text-xs">{PORT_NAMES[r.port]}</span>
                      )}
                    </div>
                    <span className="text-white/25 text-xs">closed</span>
                  </div>
                ))}
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
