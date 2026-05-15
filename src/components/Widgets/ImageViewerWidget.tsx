import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { X, ZoomIn, ZoomOut, RotateCcw, RotateCw, Maximize2, Minimize2, RefreshCw } from 'lucide-react'

interface Props {
  imagePath: string
  base64: string
  mime: string
  onClose: () => void
}

export default function ImageViewerWidget({ imagePath, base64, mime, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [floating, setFloating] = useState(false)
  const [pos, setPos] = useState(() => ({
    x: Math.max(40, (window.innerWidth - 520) / 2),
    y: Math.max(40, (window.innerHeight - 400) / 2),
  }))
  const [size, setSize] = useState({ w: 520, h: 400 })

  // window drag (floating mode header)
  const winDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)
  // image pan (zoomed)
  const panDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
  const src = `data:${mime};base64,${base64}`

  const resetView = () => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }) }
  const changeZoom = (next: number) => { setZoom(next); if (next <= 1) setPan({ x: 0, y: 0 }) }

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (!floating) return
    e.preventDefault()
    winDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }, [floating, pos])

  // window drag + resize listeners
  useEffect(() => {
    if (!floating) return
    const onMove = (e: MouseEvent) => {
      if (winDragRef.current) {
        const newX = winDragRef.current.origX + e.clientX - winDragRef.current.startX
        const newY = winDragRef.current.origY + e.clientY - winDragRef.current.startY
        setPos({
          x: Math.max(0, Math.min(newX, window.innerWidth - 80)),
          y: Math.max(0, Math.min(newY, window.innerHeight - 40)),
        })
      }
      if (resizeRef.current) {
        setSize({
          w: Math.max(280, resizeRef.current.origW + e.clientX - resizeRef.current.startX),
          h: Math.max(200, resizeRef.current.origH + e.clientY - resizeRef.current.startY),
        })
      }
    }
    const onUp = () => { winDragRef.current = null; resizeRef.current = null }
    const onLeave = () => { winDragRef.current = null; resizeRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [floating])

  // image pan listeners (always active, pan only when zoom > 1)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panDragRef.current) return
      setPan({
        x: panDragRef.current.origX + e.clientX - panDragRef.current.startX,
        y: panDragRef.current.origY + e.clientY - panDragRef.current.startY,
      })
    }
    const onUp = () => { panDragRef.current = null }
    const onLeave = () => { panDragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const onImageMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return
    e.preventDefault()
    e.stopPropagation()
    panDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y }
  }, [zoom, pan])

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
        <button onClick={() => changeZoom(Math.max(0.25, zoom - 0.25))} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Zoom out">
          <ZoomOut size={16} />
        </button>
        <span className="text-xs font-mono w-10 text-center" style={{ color: '#8b949e' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => changeZoom(Math.min(4, zoom + 0.25))} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Zoom in">
          <ZoomIn size={16} />
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        <button onClick={() => setRotation(r => (r - 90 + 360) % 360)} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Rotate CCW">
          <RotateCcw size={14} />
        </button>
        <button onClick={() => setRotation(r => (r + 90) % 360)} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Rotate CW">
          <RotateCw size={14} />
        </button>
        <button onClick={resetView} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: '#8b949e' }} title="Reset view">
          <RefreshCw size={14} />
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        <button
          onClick={() => setFloating(f => !f)}
          className="p-1 rounded hover:bg-white/10 transition-colors"
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
    <div
      className="flex-1 overflow-hidden flex items-center justify-center"
      style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
    >
      <img
        src={src}
        alt={filename}
        draggable={false}
        onMouseDown={onImageMouseDown}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
          transformOrigin: 'center center',
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
          userSelect: 'none',
          transition: panDragRef.current ? 'none' : 'transform 0.15s ease',
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
