import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@/store'
import { Terminal, FileCode, Plus, ChevronDown, TerminalSquare, Code, Settings, Command, Folder } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

const PROFILE_ICONS: Record<string, JSX.Element> = {
  TerminalSquare: <TerminalSquare size={11} />,
  Code:           <Code size={11} />,
  Terminal:       <Terminal size={11} />,
  Command:        <Command size={11} />,
  Settings:       <Settings size={11} />,
  Folder:         <Folder size={11} />,
}

export default function Titlebar() {
  const tabs = useStore(s => s.tabs)
  const activeTabId = useStore(s => s.activeTabId)
  const profiles = useStore(s => s.profiles)
  const tabBells = useStore(s => s.tabBells)
  const availableShells = useStore(s => s.availableShells)
  const addTab = useStore(s => s.addTab)
  const addEditorTab = useStore(s => s.addEditorTab)
  const closeTab = useStore(s => s.closeTab)
  const closeOtherTabs = useStore(s => s.closeOtherTabs)
  const duplicateTab = useStore(s => s.duplicateTab)
  const setActiveTab = useStore(s => s.setActiveTab)
  const updateTabTitle = useStore(s => s.updateTabTitle)
  const reorderTabs = useStore(s => s.reorderTabs)
  const clearTabBell = useStore(s => s.clearTabBell)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [isMax, setIsMax] = useState(false)
  const [tabCtxMenu, setTabCtxMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  const toggleMaximize = () => window.fterm.maximize()

  useEffect(() => {
    // Sync initial state
    window.fterm.isMaximized().then(setIsMax)
    // Stay in sync via native window events pushed from main process
    return window.fterm.onWindowState(({ maximized, fullScreen }) => {
      setIsMax(maximized || fullScreen)
    })
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false)
      }
    }
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAddMenu])

  useLayoutEffect(() => {
    if (showAddMenu && menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom,
        left: rect.left - 192 + rect.width
      })
    }
  }, [showAddMenu])

  useEffect(() => {
    if (editingTabId) editRef.current?.focus()
  }, [editingTabId])

  function startRename(tabId: string, title: string) {
    setEditingTabId(tabId)
    setEditValue(title)
  }

  const commitRename = () => {
    if (editingTabId && editValue.trim()) {
      updateTabTitle(editingTabId, editValue.trim())
    }
    setEditingTabId(null)
  }

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    window.fterm.dragStart()
    window.dispatchEvent(new Event('window:drag-start'))
    const onMove = () => window.fterm.dragUpdate()
    const onUp = () => {
      window.fterm.dragEnd()
      window.dispatchEvent(new Event('window:drag-end'))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="flex items-stretch h-9 select-none shrink-0 border-b border-white/[0.06] z-50"
      onMouseDown={handleDragMouseDown}
      onDoubleClick={toggleMaximize}
    >
      {/* Logo */}
      <div className="flex items-center px-4 gap-2 text-white/40 shrink-0">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase">FTerm</span>
      </div>

      {/* Tabs */}
      <div className="flex items-end overflow-x-auto flex-1 gap-0.5 px-1 pt-1.5 no-scrollbar">
        <AnimatePresence initial={false}>
          {tabs.map((tab, idx) => (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 180 }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              key={tab.id}
              draggable
              onDragStart={(e) => {
                (e as unknown as DragEvent).dataTransfer!.effectAllowed = 'move'
                setDraggedTabId(tab.id)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                  ; (e as unknown as DragEvent).dataTransfer!.dropEffect = 'move'
                setDropIndex(idx)
              }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={(e) => {
                e.preventDefault()
                if (!draggedTabId) return
                const fromIdx = tabs.findIndex(t => t.id === draggedTabId)
                if (fromIdx !== idx) reorderTabs(fromIdx, idx)
                setDraggedTabId(null)
                setDropIndex(null)
              }}
              onDragEnd={() => {
                setDraggedTabId(null)
                setDropIndex(null)
              }}
              onClick={() => { setActiveTab(tab.id); clearTabBell(tab.id) }}
              onDoubleClick={(e: React.MouseEvent) => { e.stopPropagation(); startRename(tab.id, tab.title) }}
              onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setTabCtxMenu({ tabId: tab.id, x: e.clientX, y: e.clientY }) }}
              style={{ overflow: 'hidden', flexShrink: 0 } as React.CSSProperties}
            >
              <div
                className={`
                  group flex items-center gap-2 px-3 h-[30px] w-[180px] cursor-pointer rounded-t-md text-[12px] relative transition-colors duration-150
                  ${draggedTabId === tab.id ? 'opacity-40' : ''}
                  ${dropIndex === idx && dropIndex !== tabs.findIndex(t => t.id === draggedTabId) ? 'border-l-2 border-l-[#58a6ff]' : ''}
                  ${tab.id === activeTabId
                    ? 'bg-white/[0.10] text-white/95'
                    : 'bg-transparent text-white/35 hover:bg-white/[0.05] hover:text-white/65'}
                `}
              >
              {/* Active tab top accent line */}
              {tab.id === activeTabId && (
                <motion.div
                  layoutId="activeTabLine"
                  className="absolute top-0 left-2 right-2 h-[2px] rounded-full"
                  style={{ backgroundColor: tab.color || '#58a6ff' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div className={`shrink-0 relative transition-colors duration-150 ${tab.id === activeTabId ? 'opacity-80' : 'opacity-40'}`}>
                {tab.type === 'editor' ? <FileCode size={11} /> : (() => {
                  const profileId = tab.layout?.profileId ?? tab.layout?.first?.profileId ?? tab.layout?.second?.profileId
                  const profile = profiles.find(p => p.id === profileId)
                  return profile?.icon ? (PROFILE_ICONS[profile.icon] ?? <Terminal size={11} />) : <Terminal size={11} />
                })()}
                {tabBells[tab.id] && (
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                )}
              </div>
              {editingTabId === tab.id ? (
                <input
                  ref={editRef}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingTabId(null)
                  }}
                  className="bg-transparent text-[12px] text-white outline-none w-full border-b border-[#58a6ff]"
                />
              ) : (
                <span className="truncate flex-1 font-medium" title={tab.title}>{tab.title}</span>
              )}
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                className="opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-white/10 p-0.5 rounded-sm transition-all shrink-0"
                style={{ opacity: tab.id === activeTabId ? 0.4 : undefined }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="relative h-full flex items-center shrink-0 mb-0.5" onMouseDown={e => e.stopPropagation()}>
          <button
            onClick={() => addTab()}
            className="h-full px-2.5 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="h-full px-1 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors"
            ref={menuButtonRef}
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* Window controls */}
      <div className="flex items-center shrink-0 h-full" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center h-full">
          <button onClick={() => window.fterm.minimize()} className="h-full px-3.5 hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
          </button>
          <button onClick={toggleMaximize} className="h-full px-3.5 hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors">
            {isMax ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></svg>
            )}
          </button>
          <button onClick={() => window.fterm.close()} className="h-full px-3.5 hover:bg-red-500/80 text-white/30 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      </div>

      {showAddMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed bg-black/90 border border-white/10 rounded-lg shadow-2xl py-1 w-48 z-50 backdrop-blur-xl"
          style={{
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`
          }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-wider">Profiles</div>
          {profiles.map(p => (
            <button
              key={p.id}
              className="w-full text-left px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
              onClick={() => { addTab(p.id); setShowAddMenu(false) }}
            >
              <span className="opacity-50">{PROFILE_ICONS[p.icon] ?? <Terminal size={12} />}</span>
              {p.name}
            </button>
          ))}
          {availableShells.length > 0 && (
            <>
              <div className="h-px bg-white/[0.06] my-1 mx-2" />
              <div className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-wider">Shells</div>
              {availableShells.map(s => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
                  onClick={() => {
                    const match = profiles.find(pr => (pr.shell || '').split(/[/\\]/).pop()?.toLowerCase() === s.shell.split(/[/\\]/).pop()?.toLowerCase())
                    addTab(match?.id)
                    setShowAddMenu(false)
                  }}
                >
                  <Terminal size={12} className="opacity-50" /> {s.name}
                </button>
              ))}
            </>
          )}
          <div className="h-px bg-white/[0.06] my-1 mx-2" />
          <button
            className="w-full text-left px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
            onClick={() => { addEditorTab(); setShowAddMenu(false) }}
          >
            <FileCode size={12} className="opacity-50" /> New Text Editor
          </button>
        </div>,
        document.body
      )}

      {/* Tab context menu */}
      {tabCtxMenu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTabCtxMenu(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed bg-black/90 border border-white/10 rounded-lg shadow-2xl py-1 w-44 z-50 backdrop-blur-xl"
            style={{ top: tabCtxMenu.y, left: tabCtxMenu.x }}
          >
            {[
              { label: 'Rename', action: () => { const t = tabs.find(t => t.id === tabCtxMenu.tabId); if (t) startRename(t.id, t.title) } },
              { label: 'Duplicate', action: () => duplicateTab(tabCtxMenu.tabId) },
              null,
              { label: 'Close', action: () => closeTab(tabCtxMenu.tabId) },
              { label: 'Close Others', action: () => closeOtherTabs(tabCtxMenu.tabId), disabled: tabs.length <= 1 },
            ].map((item, i) =>
              item === null
                ? <div key={i} className="h-px bg-white/[0.06] my-1 mx-2" />
                : <button
                    key={i}
                    onClick={() => { item.action(); setTabCtxMenu(null) }}
                    disabled={item.disabled}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {item.label}
                  </button>
            )}
          </motion.div>
        </>,
        document.body
      )}
    </div>
  )
}
