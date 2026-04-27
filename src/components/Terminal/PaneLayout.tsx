import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '@/store'
import TerminalPane from './TerminalPane'
import type { SplitNode } from '@/types'

interface Props {
  tabId: string
  node: SplitNode
  activePaneId: string
}

export default function PaneLayout({ tabId, node, activePaneId }: Props) {
  const { resizePane } = useStore()
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isHorizontal = node.direction === 'horizontal'
  const size = node.size ?? 50

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()

      let newSize = size
      if (isHorizontal) {
        const x = e.clientX - rect.left
        newSize = (x / rect.width) * 100
      } else {
        const y = e.clientY - rect.top
        newSize = (y / rect.height) * 100
      }

      newSize = Math.max(10, Math.min(90, newSize))
      resizePane(tabId, node.id, newSize)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isHorizontal, node.id, resizePane, size, tabId])

  if (node.type === 'pane') {
    const isActive = activePaneId === node.paneId
    return (
      <div
        className="w-full h-full"
        style={isActive ? { boxShadow: 'inset 0 1px 0 0 rgba(88,166,255,0.5)' } : undefined}
      >
        <TerminalPane tabId={tabId} paneId={node.paneId!} profileId={node.profileId} active={isActive} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`flex w-full h-full ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div style={{ [isHorizontal ? 'width' : 'height']: `${size}%` }} className="relative">
        {node.first && <PaneLayout tabId={tabId} node={node.first} activePaneId={activePaneId} />}
      </div>

      <div
        className={`relative z-10 transition-colors ${isHorizontal
            ? 'w-px hover:w-[3px] bg-white/[0.06] hover:bg-[#58a6ff] cursor-col-resize'
            : 'h-px hover:h-[3px] bg-white/[0.06] hover:bg-[#58a6ff] cursor-row-resize'
          } ${isDragging ? (isHorizontal ? '!w-[3px]' : '!h-[3px]') + ' !bg-[#58a6ff]' : ''}`}
        onMouseDown={handleMouseDown}
      />

      <div style={{ [isHorizontal ? 'width' : 'height']: `${100 - size}%` }} className="relative">
        {node.second && <PaneLayout tabId={tabId} node={node.second} activePaneId={activePaneId} />}
      </div>
    </div>
  )
}
