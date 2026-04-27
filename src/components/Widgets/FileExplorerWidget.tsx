import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '@/store'

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', md: 'markdown', json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', csv: 'plaintext',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
  txt: 'plaintext', log: 'plaintext', conf: 'ini', ini: 'ini',
}
import { motion, AnimatePresence } from 'motion/react'
import {
  Folder, File, FileText, Image, Code, X, ChevronRight, ChevronLeft,
  ArrowUp, Loader2, AlertCircle, HardDrive, Home, ExternalLink, Copy, RefreshCw
} from 'lucide-react'

interface FileEntry {
  name: string
  type: 'file' | 'folder'
  size?: string
  ext?: string
}

interface Drive {
  path: string
  label: string
  size: number
  freeSpace: number
}

interface ContextMenu {
  x: number
  y: number
  entry: FileEntry
  fullPath: string
}

const TEXT_EXTS = new Set([
  'ts','tsx','js','jsx','py','go','rs','java','c','cpp','cs','rb','php',
  'md','txt','log','json','yaml','yml','toml','xml','csv','sh','bash','zsh','fish','ps1','env','conf','ini','cfg','gitignore','dockerfile','makefile',
])

interface Props {
  path: string
  onClose: () => void
  onNavigate?: (newPath: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function fileIcon(entry: FileEntry, size = 16) {
  if (entry.type === 'folder') return <Folder size={size} className="text-yellow-400 shrink-0" />
  const ext = entry.ext ?? entry.name.split('.').pop() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'rb', 'php'].includes(ext))
    return <Code size={size} className="text-blue-400 shrink-0" />
  if (['md', 'txt', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv'].includes(ext))
    return <FileText size={size} className="text-gray-400 shrink-0" />
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'bmp'].includes(ext))
    return <Image size={size} className="text-pink-400 shrink-0" />
  return <File size={size} className="text-gray-400 shrink-0" />
}

function driveUsagePercent(drive: Drive): number {
  if (!drive.size) return 0
  return Math.round(((drive.size - drive.freeSpace) / drive.size) * 100)
}

export default function FileExplorerWidget({ path: initialPath, onClose, onNavigate }: Props) {
  const { settings, addEditorTab } = useStore()
  const [currentPath, setCurrentPath] = useState(initialPath || '.')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drives, setDrives] = useState<Drive[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const historyRef = useRef<string[]>([initialPath || '.'])
  const historyIdxRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.fterm.fsDrives?.().then(setDrives).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.fterm.fsReadDir(currentPath)
      .then(entries => {
        if (cancelled) return
        const mapped: FileEntry[] = entries.map(e => ({
          name: e.name,
          type: e.isDir ? 'folder' : 'file',
          size: e.isDir ? undefined : formatSize(e.size),
          ext: e.isDir ? undefined : e.name.split('.').pop(),
        }))
        setFiles(mapped)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to read directory')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [currentPath])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return }
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [contextMenu, onClose])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    window.addEventListener('click', dismiss)
    return () => window.removeEventListener('click', dismiss)
  }, [contextMenu])

  const goTo = (path: string, pushHistory = true) => {
    if (pushHistory) {
      const truncated = historyRef.current.slice(0, historyIdxRef.current + 1)
      truncated.push(path)
      historyRef.current = truncated
      historyIdxRef.current = truncated.length - 1
    }
    setCurrentPath(path)
    onNavigate?.(path)
  }

  const sep = currentPath.includes('\\') ? '\\' : '/'

  const navigate = (name: string) => {
    goTo(currentPath.replace(/[/\\]$/, '') + sep + name)
  }

  const goUp = () => {
    const parts = currentPath.replace(/[/\\]$/, '').split(/[/\\]/)
    if (parts.length > 1) {
      parts.pop()
      const up = parts.join(sep) || sep
      goTo(up)
    }
  }

  const goBack = () => {
    if (historyIdxRef.current > 0) {
      historyIdxRef.current--
      goTo(historyRef.current[historyIdxRef.current], false)
    }
  }

  const goForward = () => {
    if (historyIdxRef.current < historyRef.current.length - 1) {
      historyIdxRef.current++
      goTo(historyRef.current[historyIdxRef.current], false)
    }
  }

  const goHome = () => {
    goTo(window.fterm.homedir || '.')
  }

  const fullPath = useCallback((name: string) => {
    return currentPath.replace(/[/\\]$/, '') + sep + name
  }, [currentPath, sep])

  const openFile = async (fp: string) => {
    const ext = fp.split('.').pop()?.toLowerCase() ?? ''
    if (settings.explorerOpenInTerminal !== false && TEXT_EXTS.has(ext)) {
      try {
        const content = await window.fterm.fsReadFile(fp)
        const lang = EXT_TO_LANG[ext] ?? 'plaintext'
        addEditorTab(content, lang, fp)
        onClose()
      } catch {
        window.fterm.openPath(fp)
      }
    } else {
      window.fterm.openPath(fp)
    }
  }

  const copyPath = (fp: string) => {
    navigator.clipboard.writeText(fp).catch(() => {})
  }

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'folder') {
      navigate(entry.name)
    } else {
      openFile(fullPath(entry.name))
    }
  }

  const handleRightClick = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry, fullPath: fullPath(entry.name) })
  }

  const canBack = historyIdxRef.current > 0
  const canForward = historyIdxRef.current < historyRef.current.length - 1

  const folders = files.filter(f => f.type === 'folder').sort((a, b) => a.name.localeCompare(b.name))
  const fileEntries = files.filter(f => f.type === 'file').sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...folders, ...fileEntries]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-30 flex items-start justify-center pt-6 px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-3xl bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: 'calc(100vh - 80px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/10 bg-white/5 shrink-0">
          <button onClick={goBack} disabled={!canBack} className="p-1.5 rounded transition-colors text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed" title="Back">
            <ChevronLeft size={14} />
          </button>
          <button onClick={goForward} disabled={!canForward} className="p-1.5 rounded transition-colors text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed" title="Forward">
            <ChevronRight size={14} />
          </button>
          <button onClick={goUp} className="p-1.5 rounded transition-colors text-white/50 hover:text-white hover:bg-white/10" title="Up">
            <ArrowUp size={14} />
          </button>
          <button onClick={goHome} className="p-1.5 rounded transition-colors text-white/50 hover:text-white hover:bg-white/10" title="Home">
            <Home size={14} />
          </button>
          <button onClick={() => { setLoading(true); setCurrentPath(p => p) }} className="p-1.5 rounded transition-colors text-white/50 hover:text-white hover:bg-white/10" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <div className="flex items-center gap-2 text-sm text-white/70 min-w-0 flex-1 mx-1 px-2 py-1 bg-white/5 rounded-md border border-white/8">
            <Folder size={12} className="text-yellow-400 shrink-0" />
            <span className="font-mono text-white/90 truncate text-xs">{currentPath}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded transition-colors text-white/50 hover:text-white shrink-0">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Drives sidebar */}
          {drives.length > 0 && (
            <div className="w-36 shrink-0 border-r border-white/8 overflow-y-auto py-2 px-1.5 flex flex-col gap-0.5 bg-white/2">
              <div className="text-[10px] text-white/30 font-medium uppercase tracking-wider px-1.5 pb-1">Drives</div>
              {drives.map(drive => {
                const used = driveUsagePercent(drive)
                const isActive = currentPath.toLowerCase().startsWith(drive.path.toLowerCase())
                return (
                  <button
                    key={drive.path}
                    onClick={() => goTo(drive.path)}
                    className={`flex flex-col gap-0.5 px-1.5 py-1.5 rounded-md transition-colors text-left ${isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <HardDrive size={12} className={isActive ? 'text-blue-400' : 'text-white/40'} />
                      <span className="text-xs font-medium truncate">{drive.label || drive.path}</span>
                    </div>
                    {drive.size > 0 && (
                      <>
                        <div className="w-full bg-white/10 rounded-full h-0.5 mt-0.5">
                          <div
                            className={`h-0.5 rounded-full transition-all ${used > 90 ? 'bg-red-400' : used > 70 ? 'bg-yellow-400' : 'bg-blue-400'}`}
                            style={{ width: `${used}%` }}
                          />
                        </div>
                        <div className="text-[9px] text-white/30">{formatSize(drive.freeSpace)} free</div>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* File list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
            {loading && (
              <div className="flex items-center justify-center py-12 text-white/40">
                <Loader2 size={20} className="animate-spin mr-2" />
                Loading...
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center justify-center py-12 text-red-400 gap-2">
                <AlertCircle size={16} />
                <span className="text-sm">{error}</span>
              </div>
            )}
            {!loading && !error && sorted.length === 0 && (
              <div className="flex items-center justify-center py-12 text-white/30 text-sm">
                Empty folder
              </div>
            )}
            {!loading && !error && sorted.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                <AnimatePresence mode="popLayout">
                  {sorted.map((entry, i) => (
                    <motion.div
                      key={entry.name}
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.1, delay: Math.min(i * 0.01, 0.15) }}
                      onClick={() => handleEntryClick(entry)}
                      onContextMenu={e => handleRightClick(e, entry)}
                      className={`flex items-center gap-2 p-2 rounded-lg border border-white/8 bg-white/4 hover:bg-white/10 hover:border-white/15 transition-all text-sm cursor-pointer select-none`}
                      title={entry.type === 'file' ? `Click to open: ${entry.name}` : entry.name}
                    >
                      {fileIcon(entry)}
                      <span className="truncate text-white/80 flex-1 text-xs">{entry.name}</span>
                      {entry.type === 'folder' && <ChevronRight size={11} className="text-white/25 shrink-0" />}
                      {entry.type === 'file' && entry.size && (
                        <span className="text-white/25 text-[10px] shrink-0">{entry.size}</span>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-white/10 bg-white/4 text-xs text-white/35 flex gap-4 shrink-0">
          <span>{folders.length} folders</span>
          <span>{fileEntries.length} files</span>
          <span className="ml-auto">Click file to open · Right-click for more · Esc to close</span>
        </div>
      </motion.div>

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-50 bg-[#161b22] border border-white/15 rounded-lg shadow-2xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.entry.type === 'file' && (
              <button
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/8 transition-colors"
                onClick={() => { openFile(contextMenu.fullPath); setContextMenu(null) }}
              >
                <ExternalLink size={13} className="text-blue-400" />
                Open
              </button>
            )}
            {contextMenu.entry.type === 'folder' && (
              <button
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/8 transition-colors"
                onClick={() => { navigate(contextMenu.entry.name); setContextMenu(null) }}
              >
                <Folder size={13} className="text-yellow-400" />
                Open Folder
              </button>
            )}
            <button
              className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/8 transition-colors"
              onClick={() => { copyPath(contextMenu.fullPath); setContextMenu(null) }}
            >
              <Copy size={13} className="text-white/50" />
              Copy Path
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
