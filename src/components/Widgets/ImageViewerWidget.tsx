import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { X, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2 } from 'lucide-react'

interface Props {
  imagePath: string
  base64: string
  mime: string
  onClose: () => void
}

export default function ImageViewerWidget({ imagePath, base64, mime, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [floating, setFloating] = useState(false)
  const [pos, setPos] = useState(() => ({
    x: Math.max(40, (window.innerWidth - 520) / 2),
    y: Math.max(40, (window.innerHeight - 400) / 2),
  }))
  const [size, setSize] = useState({ w: 520, h: 400 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)
  const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
  const src = `data:${mime};base64,${base64}`

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (!floating) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }, [floating, pos])

  useEffect(() => {
    if (!floating) return
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        setPos({
          x: dragRef.current.origX + e.clientX - dragRef.current.startX,
          y: dragRef.current.origY + e.clientY - dragRef.current.startY,
        })
      }
      if (resizeRef.current) {
        setSize({
          w: Math.max(280, resizeRef.current.origW + e.clientX - resizeRef.current.startX),
          h: Math.max(200, resizeRef.current.origH + e.clientY - resizeRef.current.startY),
        })
      }
    }
    const onUp = () => { dragRef.current = null; resizeRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [floating])

  const header = (
    <div
      className="flex items-center justify-between px-4 py-2 shrink-0"
      style={{
        background: 'rgba(22,27,34,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        cursor: floating ? 'move' : 'default',
      }}
      onMouseDown={onHeaderMouseDown}
    >
      <span className="text-sm font-mono select-none" style={{ color: '#e6edf3' }}>{filename}</span>
      <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Zoom out">
          <ZoomOut size={16} />
        </button>
        <span className="text-xs font-mono w-10 text-center" style={{ color: '#8b949e' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button onClick={() => setZoom(1)} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Reset zoom">
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setFloating(f => !f)}
          className="p-1 rounded hover:bg-white/10 transition-colors ml-1"
          style={{ color: '#8b949e' }}
          title={floating ? 'Dock (fullscreen overlay)' : 'Float (draggable window)'}
        >
          {floating ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors ml-1" style={{ color: '#8b949e' }} title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
    </div>
  )

  const imageArea = (
    <div className="flex-1 overflow-auto flex items-center justify-center p-4">
      <img
        src={src}
        alt={filename}
        draggable={false}
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
          maxWidth: zoom <= 1 ? '100%' : 'none',
          maxHeight: zoom <= 1 ? '100%' : 'none',
          objectFit: 'contain',
          imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
          userSelect: 'none',
        }}
      />
    </div>
  )

  if (floating) {
    return createPortal(
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="flex flex-col rounded-lg overflow-hidden shadow-2xl"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
          zIndex: 9999,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(13,17,23,0.97)',
        }}
      >
        {header}
        {imageArea}
        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{ opacity: 0.4 }}
          onMouseDown={e => {
            e.preventDefault()
            e.stopPropagation()
            resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h }
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', bottom: 3, right: 3 }}>
            <path d="M9 1L1 9M9 5L5 9M9 9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </motion.div>,
      document.body
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-30 flex flex-col"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        transition={{ duration: 0.18 }}
        className="flex flex-col w-full h-full"
        onClick={e => e.stopPropagation()}
      >
        {header}
        {imageArea}
      </motion.div>
    </motion.div>
  )
}
