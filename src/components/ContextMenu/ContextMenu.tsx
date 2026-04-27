import { useEffect, useRef } from 'react'

interface MenuItem {
  label: string
  shortcut?: string
  action: () => void
  separator?: false
}

interface Separator {
  separator: true
}

type ContextItem = MenuItem | Separator

interface Props {
  x: number
  y: number
  items: ContextItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Clamp position to stay within viewport
  const style = {
    top: Math.min(y, window.innerHeight - 200),
    left: Math.min(x, window.innerWidth - 180),
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] py-1 rounded-lg border border-[#30363d] shadow-2xl"
      style={{ ...style, background: 'rgba(13,17,23,0.96)', backdropFilter: 'blur(16px)' }}
    >
      {items.map((item, i) =>
        'separator' in item && item.separator ? (
          <div key={i} className="my-1 border-t border-[#30363d]" />
        ) : (
          <button
            key={i}
            onClick={() => { (item as MenuItem).action(); onClose() }}
            className="flex items-center justify-between w-full px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#388bfd33] transition-colors text-left"
          >
            <span>{(item as MenuItem).label}</span>
            {(item as MenuItem).shortcut && (
              <span className="text-[#484f58] ml-4 text-[10px]">{(item as MenuItem).shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  )
}
