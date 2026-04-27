import { useState, useRef, useEffect, useMemo } from 'react'
import { useStore, THEMES } from '@/store'
import { terminalInstances } from '@/components/Terminal/terminalRegistry'
import { Settings, Search, Play, Terminal, Command, X, Plus, Code2, Save, RotateCcw } from 'lucide-react'
import { Trash2, Sparkles, Paintbrush } from 'lucide-react'

interface PaletteAction {
  id: string
  label: string
  icon?: React.ReactNode
  group?: string
  shortcut?: string
  action: () => void
}

interface Props {
  onClose: () => void
  onToggleSearch: () => void
}

export default function CommandPalette({ onClose, onToggleSearch }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { addTab, closeTab, activeTabId, tabs, setActiveTab, profiles, ai, setAIConfig, setSettings, setActiveView, setTheme, snippets, savedLayouts, saveCurrentLayout, deleteSavedLayout, addTab: addTabFn } = useStore()
  const [layoutNamePrompt, setLayoutNamePrompt] = useState(false)
  const [layoutName, setLayoutName] = useState('')

  useEffect(() => { inputRef.current?.focus() }, [])

  const actions: PaletteAction[] = useMemo(() => {
    const baseActions: PaletteAction[] = [
      { id: 'new-tab', label: 'New Tab', group: 'Application', icon: <Plus size={14} />, shortcut: 'Ctrl+T', action: () => addTab() },
      { id: 'close-tab', label: 'Close Current Tab', group: 'Application', icon: <X size={14} />, shortcut: 'Ctrl+W', action: () => activeTabId && closeTab(activeTabId) },
      { id: 'toggle-ai', label: 'Toggle AI Sidebar', group: 'Application', icon: <Sparkles size={14} />, shortcut: 'Ctrl+Shift+A', action: () => setAIConfig({ sidebarOpen: !ai.sidebarOpen }) },
      { id: 'settings', label: 'Open Settings', group: 'Application', icon: <Settings size={14} />, shortcut: 'Ctrl+,', action: () => setActiveView('settings') },
      { id: 'search', label: 'Search in Terminal', group: 'Terminal', icon: <Search size={14} />, shortcut: 'Ctrl+Shift+F', action: onToggleSearch },
      { id: 'clear', label: 'Clear Output', group: 'Terminal', icon: <Trash2 size={14} />, action: () => { if (activeTabId) terminalInstances.get(`${activeTabId}-0`)?.clear() } },
      { id: 'save-layout', label: 'Save Current Layout…', group: 'Layouts', icon: <Save size={14} />, action: () => setLayoutNamePrompt(true) },
    ]

    const snippetActions: PaletteAction[] = snippets.map(sn => ({
      id: `snippet-${sn.id}`,
      label: `Run snippet: ${sn.name}`,
      group: 'Snippets',
      icon: <Code2 size={14} />,
      action: () => {
        if (!activeTabId) return
        const activeTab = tabs.find(t => t.id === activeTabId)
        const paneId = activeTab?.activePaneId ?? '0'
        window.fterm.ptyWrite(`${activeTabId}-${paneId}`, sn.command + '\r')
      }
    }))

    const savedLayoutActions: PaletteAction[] = savedLayouts.map(l => ({
      id: `restore-layout-${l.id}`,
      label: `Restore layout: ${l.name}`,
      group: 'Layouts',
      icon: <RotateCcw size={14} />,
      action: () => {
        for (let i = 0; i < l.tabCount; i++) {
          addTabFn(l.profileIds[i])
        }
      }
    }))

    const deletedLayoutActions: PaletteAction[] = savedLayouts.map(l => ({
      id: `delete-layout-${l.id}`,
      label: `Delete layout: ${l.name}`,
      group: 'Layouts',
      icon: <Trash2 size={14} />,
      action: () => deleteSavedLayout(l.id)
    }))

    const tabActions: PaletteAction[] = tabs.map(t => ({
      id: `tab-${t.id}`,
      label: `Jump to: ${t.title}`,
      group: 'Open Tabs',
      icon: <Terminal size={14} />,
      action: () => setActiveTab(t.id)
    }))

    const profileActions: PaletteAction[] = profiles.map(p => ({
      id: `profile-${p.id}`,
      label: `Launch Preset: ${p.name}`,
      group: 'Presets',
      icon: <Play size={14} />,
      action: () => addTab(p.id)
    }))

    const themeActions: PaletteAction[] = THEMES.map(t => ({
      id: `theme-${t.id}`,
      label: `Theme: ${t.name}`,
      group: 'Themes',
      icon: <Paintbrush size={14} />,
      action: () => setTheme(t.id)
    }))

    return [...baseActions, ...snippetActions, ...savedLayoutActions, ...deletedLayoutActions, ...tabActions, ...profileActions, ...themeActions]
  }, [addTab, addTabFn, closeTab, activeTabId, ai.sidebarOpen, setAIConfig, setSettings, setActiveView, onToggleSearch, tabs, setActiveTab, profiles, setTheme, snippets, savedLayouts, saveCurrentLayout, deleteSavedLayout])

  const filtered = useMemo(() => {
    if (!query) return actions
    const q = query.toLowerCase()
    return actions.filter(a => a.label.toLowerCase().includes(q) || a.group?.toLowerCase().includes(q))
  }, [actions, query])

  useEffect(() => { setSelected(0) }, [query])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && filtered[selected]) {
      filtered[selected].action()
      onClose()
    }
  }

  if (layoutNamePrompt) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setLayoutNamePrompt(false)} />
        <div
          className="fixed top-[25%] left-1/2 -translate-x-1/2 z-50 w-[380px] rounded-xl border border-white/10 shadow-2xl overflow-hidden flex flex-col"
          style={{ background: 'rgba(17, 24, 39, 0.9)', backdropFilter: 'blur(24px)' }}
        >
          <div className="px-4 py-3 border-b border-white/10">
            <div className="text-white text-sm font-medium">Save Layout</div>
            <div className="text-white/40 text-xs mt-0.5">Give this layout a name</div>
          </div>
          <div className="p-4 space-y-3">
            <input
              autoFocus
              value={layoutName}
              onChange={e => setLayoutName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && layoutName.trim()) {
                  saveCurrentLayout(layoutName.trim())
                  setLayoutName('')
                  setLayoutNamePrompt(false)
                  onClose()
                }
                if (e.key === 'Escape') setLayoutNamePrompt(false)
              }}
              placeholder="e.g. Dev Setup"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setLayoutNamePrompt(false)} className="px-3 py-1.5 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors">Cancel</button>
              <button
                onClick={() => {
                  if (layoutName.trim()) {
                    saveCurrentLayout(layoutName.trim())
                    setLayoutName(''); setLayoutNamePrompt(false); onClose()
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs bg-blue-500/30 border border-blue-500/40 text-blue-300 hover:bg-blue-500/40 transition-colors"
              >Save</button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div
        className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-[520px] rounded-xl border border-white/10 shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'rgba(17, 24, 39, 0.85)', backdropFilter: 'blur(24px)' }}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
          <Command size={16} className="text-white/50" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, tabs, presets, or themes..."
            className="bg-transparent text-base text-white outline-none w-full placeholder:text-white/30"
          />
        </div>

        <div className="max-h-[350px] overflow-y-auto py-1 custom-scrollbar">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-sm text-white/50 text-center">No matching commands</div>
          )}
          {filtered.map((item, ii) => (
            <button
              key={item.id}
              onClick={() => { item.action(); onClose() }}
              onMouseEnter={() => setSelected(ii)}
              className={`flex items-center justify-between w-full px-4 py-2.5 text-sm text-left transition-all
                ${ii === selected ? 'bg-blue-500/20 text-blue-300' : 'text-white/70 hover:bg-white/5'}
              `}
            >
              <div className="flex items-center gap-3">
                {item.icon && <span className="opacity-70">{item.icon}</span>}
                <span>{item.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {item.group && <span className="text-[10px] text-white/40 uppercase tracking-wider">{item.group}</span>}
                {item.shortcut && <span className="bg-white/10 px-2 py-0.5 rounded text-[10px] text-white/60">{item.shortcut}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
