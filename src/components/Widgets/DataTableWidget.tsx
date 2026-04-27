import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { X, ChevronUp, ChevronDown, ChevronsUpDown, Table } from 'lucide-react'

interface Props {
  title: string
  headers: string[]
  rows: (string | number)[][]
  onClose: () => void
}

type SortDir = 'asc' | 'desc' | null

export default function DataTableWidget({ title, headers, rows, onClose }: Props) {
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  const handleSort = (col: number) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
      if (sortDir === 'desc') setSortCol(null)
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    if (sortCol === null || sortDir === null) return 0
    const av = a[sortCol]
    const bv = b[sortCol]
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  }), [rows, sortCol, sortDir])

  const SortIcon = ({ col }: { col: number }) => {
    if (sortCol !== col) return <ChevronsUpDown size={12} className="text-white/20" />
    if (sortDir === 'asc') return <ChevronUp size={12} className="text-blue-400" />
    return <ChevronDown size={12} className="text-blue-400" />
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
            <Table size={15} className="text-blue-400" />
            {title}
            <span className="text-xs font-normal text-white/40">{rows.length} rows</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto max-h-[440px] custom-scrollbar">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-[#0d1117] z-10">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    onClick={() => handleSort(i)}
                    className="px-4 py-2 text-left text-xs font-semibold text-white/50 uppercase tracking-wide border-b border-white/10 cursor-pointer hover:text-white/80 hover:bg-white/5 transition-colors select-none"
                  >
                    <div className="flex items-center gap-1">
                      {h}
                      <SortIcon col={i} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, ri) => (
                <motion.tr
                  key={ri}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: ri * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors"
                >
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-2 text-white/80 font-mono text-xs whitespace-nowrap">
                      {String(cell)}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 border-t border-white/10 bg-white/5 text-xs text-white/30">
          Click column headers to sort · Press Esc to close
        </div>
      </div>
    </motion.div>
  )
}
