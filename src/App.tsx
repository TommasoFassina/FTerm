import { useEffect, useState, lazy, Suspense } from 'react'
import { useStore, useActiveTheme, getOrderedPaneIds, DEFAULT_KEYBINDINGS } from '@/store'
import { useAIInit } from '@/hooks/useAI'
import Titlebar from '@/components/Titlebar/Titlebar'
import PaneLayout from '@/components/Terminal/PaneLayout'
import SearchBar from '@/components/Terminal/SearchBar'
import AISidebar from '@/components/AI/AISidebar'
import Pet from '@/components/Pet/Pet'
import StatusBar from '@/components/StatusBar/StatusBar'
import CommandPalette from '@/components/CommandPalette/CommandPalette'
import Sidebar from '@/components/Sidebar/Sidebar'
import WelcomeOverlay from '@/components/Welcome/WelcomeOverlay'
import { AnimatePresence, motion } from 'motion/react'
import { terminalInstances } from '@/components/Terminal/terminalRegistry'

// Lazy-loaded — only fetched when user opens that view / tab type
const SettingsView = lazy(() => import('@/components/Views/SettingsView'))
const ThemesView   = lazy(() => import('@/components/Views/ThemesView'))
const ProfilesView = lazy(() => import('@/components/Views/ProfilesView'))
const PluginsView  = lazy(() => import('@/components/Views/PluginsView'))
const GitView      = lazy(() => import('@/components/Views/GitView'))
const PetView      = lazy(() => import('@/components/Views/PetView'))
const EditorPane   = lazy(() => import('@/components/Editor/EditorPane'))

function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split('+')
  const needsCtrl = parts.includes('ctrl')
  const needsShift = parts.includes('shift')
  const needsAlt = parts.includes('alt')
  const key = parts.find(p => !['ctrl', 'shift', 'alt'].includes(p)) ?? ''
  return (
    e.ctrlKey === needsCtrl &&
    e.shiftKey === needsShift &&
    e.altKey === needsAlt &&
    e.key.toLowerCase() === key
  )
}

export default function App() {
  const {
    tabs, activeTabId, activeView, setActiveView,
    ai, settings, setAIConfig, setSettings,
    addTab, closeTab, setActiveTab, setAvailableShells,
    splitPane, setActivePane, keybindings,
  } = useStore()
  const activeTheme = useActiveTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [, setIsMaximized] = useState(false)

  useEffect(() => {
    window.fterm.isMaximized().then(setIsMaximized)
    return window.fterm.onWindowState(({ maximized, fullScreen }) => {
      setIsMaximized(maximized || fullScreen)
    })
  }, [])
  // Active pane derived state
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activePaneId = activeTab?.activePaneId

  // Check connected providers on startup
  useAIInit()

  // Detect available shells on startup
  useEffect(() => {
    window.fterm.shellDetect().then(setAvailableShells).catch(() => { })
    // Seed the first tab's CWD immediately so status bar never shows blank
    const { tabs, activeTabId: aid } = useStore.getState()
    const first = tabs.find(t => t.id === aid)
    if (first && !first.currentCwd && window.fterm.homedir) {
      useStore.getState().updateTabCwd(first.id, first.activePaneId ?? '', window.fterm.homedir)
    }
  }, [])

  // Sync CSS var for padding
  useEffect(() => {
    document.documentElement.style.setProperty('--terminal-padding', `${settings.terminalPadding ?? 8}px`)
  }, [settings.terminalPadding])


  // Global keyboard shortcuts (driven by keybindings store)
  useEffect(() => {
    const kb = { ...DEFAULT_KEYBINDINGS, ...keybindings }
    function onKey(e: KeyboardEvent) {
      if (matchesBinding(e, kb['ai-sidebar'])) {
        e.preventDefault()
        setAIConfig({ sidebarOpen: !ai.sidebarOpen })
      } else if (matchesBinding(e, kb['settings'])) {
        e.preventDefault()
        setActiveView('settings')
      } else if (matchesBinding(e, kb['new-tab'])) {
        e.preventDefault()
        addTab()
      } else if (matchesBinding(e, kb['close-tab'])) {
        e.preventDefault()
        if (activeTabId) closeTab(activeTabId)
      } else if (matchesBinding(e, kb['command-palette'])) {
        e.preventDefault()
        setPaletteOpen(prev => !prev)
      } else if (matchesBinding(e, kb['search'])) {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      } else if (matchesBinding(e, kb['split-h'])) {
        e.preventDefault()
        if (activeTabId && activePaneId) splitPane(activeTabId, activePaneId, 'horizontal')
      } else if (matchesBinding(e, kb['split-v'])) {
        e.preventDefault()
        if (activeTabId && activePaneId) splitPane(activeTabId, activePaneId, 'vertical')
      } else if (matchesBinding(e, kb['font-increase']) || (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '+')) {
        e.preventDefault()
        setSettings({ fontSize: Math.min(30, (settings.fontSize ?? 14) + 1) })
      } else if (matchesBinding(e, kb['font-decrease'])) {
        e.preventDefault()
        setSettings({ fontSize: Math.max(8, (settings.fontSize ?? 14) - 1) })
      } else if (matchesBinding(e, kb['font-reset'])) {
        e.preventDefault()
        setSettings({ fontSize: 14 })
      } else if (e.ctrlKey && e.key === 'Tab') {
        // Tab cycling — keep separate since Tab key has special handling
        e.preventDefault()
        const idx = tabs.findIndex(t => t.id === activeTabId)
        if (idx < 0) return
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length
        setActiveTab(tabs[next].id)
      } else if (e.ctrlKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const tab = tabs.find(t => t.id === activeTabId)
        if (!tab?.layout || !tab.activePaneId) return
        const ordered = getOrderedPaneIds(tab.layout)
        if (ordered.length < 2) return
        const idx = ordered.indexOf(tab.activePaneId)
        if (idx < 0) return
        const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1
        const nextPaneId = ordered[(idx + dir + ordered.length) % ordered.length]
        setActivePane(activeTabId!, nextPaneId)
        terminalInstances.get(`${activeTabId}-${nextPaneId}`)?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ai.sidebarOpen, setAIConfig, setSettings, tabs, activeTabId, addTab, closeTab, setActiveTab, activePaneId, splitPane, setActivePane, settings, keybindings])

  const bgHex = activeTheme.background.replace('#', '')
  const r = parseInt(bgHex.slice(0, 2), 16) || 10
  const g = parseInt(bgHex.slice(2, 4), 16) || 12
  const b = parseInt(bgHex.slice(4, 6), 16) || 16
  const bgOpacity = settings.opacity ?? 0.85
  const bgBlur = settings.backgroundBlur ?? 10

  return (
    <div
      id="fterm-root"
      className="relative flex flex-col w-full h-full text-[#c9d1d9] overflow-hidden rounded-2xl"
    >
      {/* Layer 1: Background image with blur */}
      {settings.backgroundImage && (
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url("${settings.backgroundImage}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
            transform: bgBlur > 0 ? 'scale(1.1)' : undefined, // prevent blur edge gaps
          }}
        />
      )}

      {/* Layer 2: Theme color overlay with opacity */}
      <div
        className="absolute inset-0 z-[1]"
        style={{ backgroundColor: `rgba(${r}, ${g}, ${b}, ${bgOpacity})` }}
      />

      {/* Layer 3: Content */}
      <div className="relative z-[2] w-full flex-1 shrink-0 flex flex-col overflow-hidden">
        <Titlebar />

        <div className="flex flex-1 overflow-hidden relative">
          {(settings.layout?.navSidebarPosition ?? 'left') === 'left' && <Sidebar />}
          {settings.layout?.aiSidebarPosition === 'left' && <AISidebar />}

          <div className="flex-1 relative grid grid-cols-1 grid-rows-1 overflow-hidden">
            {/* Terminal pane */}
            <motion.div
              className="col-start-1 row-start-1 h-full w-full relative bg-transparent"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{
                opacity: activeView === 'terminal' ? 1 : 0,
                scale: activeView === 'terminal' ? 1 : 0.98,
                pointerEvents: activeView === 'terminal' ? 'auto' : 'none'
              }}
              transition={{ duration: 0.2 }}
              style={{ zIndex: activeView === 'terminal' ? 10 : 0 }}
            >
              {searchOpen && activeTabId && activePaneId && (
                <SearchBar
                  tabId={activeTabId}
                  activePaneId={activePaneId}
                  onClose={() => setSearchOpen(false)}
                />
              )}
              <AnimatePresence>
                {tabs.map(tab => (
                  <motion.div
                    key={tab.id}
                    className="w-full h-full absolute inset-0"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{
                      opacity: tab.id === activeTabId ? 1 : 0,
                      scale: tab.id === activeTabId ? 1 : 0.98
                    }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    style={{
                      pointerEvents: tab.id === activeTabId ? 'auto' : 'none',
                      zIndex: tab.id === activeTabId ? 10 : 0
                    }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    {tab.type === 'editor' ? (
                      <Suspense fallback={null}>
                        <EditorPane tabId={tab.id} />
                      </Suspense>
                    ) : (
                      <PaneLayout
                        tabId={tab.id}
                        node={tab.layout!}
                        activePaneId={tab.activePaneId!}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {/* Views pane */}
            <motion.div
              className="col-start-1 row-start-1 h-full w-full overflow-hidden relative p-6"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{
                opacity: activeView !== 'terminal' ? 1 : 0,
                scale: activeView !== 'terminal' ? 1 : 0.98,
                pointerEvents: activeView !== 'terminal' ? 'auto' : 'none'
              }}
              transition={{ duration: 0.2 }}
              style={{ color: activeTheme.foreground, zIndex: activeView !== 'terminal' ? 10 : 0 }}
            >
              <AnimatePresence mode="wait">
                <Suspense fallback={null}>
                  {activeView === 'profiles' && <ProfilesView key="profiles" />}
                  {activeView === 'themes' && <ThemesView key="themes" />}
                  {activeView === 'plugins' && <PluginsView key="plugins" />}
                  {activeView === 'git' && <GitView key="git" />}
                  {activeView === 'pet' && <PetView key="pet" />}
                  {activeView === 'settings' && <SettingsView key="settings" />}
                </Suspense>
              </AnimatePresence>
            </motion.div>
          </div>

          {(settings.layout?.aiSidebarPosition ?? 'right') === 'right' && <AISidebar />}
          {settings.layout?.navSidebarPosition === 'right' && <Sidebar />}
        </div>

        {/* Overlays */}
        <Pet />
        <AnimatePresence>
          {!settings.hasSeenWelcome && <WelcomeOverlay />}
        </AnimatePresence>
        {paletteOpen && (
          <CommandPalette
            onClose={() => setPaletteOpen(false)}
            onToggleSearch={() => setSearchOpen(prev => !prev)}
          />
        )}

        {/* Status bar */}
        <StatusBar />
      </div>
    </div>
  )
}
