import { useState } from 'react'
import { useStore } from '@/store'
import { motion, AnimatePresence } from 'motion/react'
import { Search, Plus, Settings, Edit3, Trash2, X, Save } from 'lucide-react'
import { pluginManager, evalPluginCode as evalPlugin, autoThemePlugin, AUTO_THEME_DEFAULTS } from '@/plugins'

export default function PluginsView() {
    const { plugins, togglePlugin, addCustomPlugin, updateCustomPlugin, deleteCustomPlugin, settings, setSettings } = useStore()
    const [search, setSearch] = useState('')
    const [editingPlugin, setEditingPlugin] = useState<any>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [editForm, setEditForm] = useState({ name: '', description: '', code: '' })

    const defaultCode = `{\n  version: "1.0.0",\n  onLoad: () => {\n    console.log("Plugin loaded!");\n  },\n  onUnload: () => {\n    // cleanup: clear intervals, remove listeners, etc.\n  },\n  onPtyData: (data) => {\n    // called for every byte of terminal output\n    // console.log("Data:", data);\n  },\n  onTerminalReady: (term, instanceId) => {\n    // term.writeln("Hello from plugin!");\n  }\n}`

    const openEditor = (plugin?: any) => {
        if (plugin) {
            setEditingPlugin(plugin)
            setEditForm({ name: plugin.name, description: plugin.description, code: plugin.code || defaultCode })
            setIsCreating(false)
        } else {
            setEditingPlugin(null)
            setEditForm({ name: 'My Custom Plugin', description: 'A new FTerm plugin.', code: defaultCode })
            setIsCreating(true)
        }
    }

    const closeEditor = () => {
        setEditingPlugin(null)
        setIsCreating(false)
    }

    const handleSave = async () => {
        let pluginObj: any
        try {
            pluginObj = await evalPlugin(editForm.code)
        } catch (err: any) {
            console.error('Plugin eval failed:', err)
            alert(`Plugin code error:\n\n${err.name}: ${err.message}\n\nTip: paste only the object literal, e.g. { onPtyData: (d) => {...} }`)
            return
        }

        try {
            if (isCreating) {
                const id = addCustomPlugin({ ...editForm, enabled: true })
                pluginObj.id = id
                pluginObj.name = editForm.name
                pluginObj.description = editForm.description
                pluginObj.version = pluginObj.version ?? '1.0.0'
                pluginManager.register(pluginObj)
            } else if (editingPlugin) {
                pluginManager.unregister(editingPlugin.id)
                updateCustomPlugin(editingPlugin.id, editForm)
                pluginObj.id = editingPlugin.id
                pluginObj.name = editForm.name
                pluginObj.description = editForm.description
                pluginObj.version = pluginObj.version ?? '1.0.0'
                if (editingPlugin.enabled) {
                    pluginManager.register(pluginObj)
                }
            }
            closeEditor()
        } catch (err: any) {
            console.error('Plugin register failed:', err)
            alert(`Plugin saved but failed to load:\n\n${err.name}: ${err.message}`)
        }
    }

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this custom plugin?')) {
            pluginManager.unregister(id)
            deleteCustomPlugin(id)
            closeEditor()
        }
    }

    const filteredPlugins = plugins.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase()))

    return (
        <motion.div
            key="plugins"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col h-full w-full max-w-5xl mx-auto p-6 relative"
        >
            <h2 className="text-2xl font-bold mb-6 text-white text-shadow-sm">Plugins & Extensions</h2>

            <div className="flex gap-4 mb-6">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search plugins..."
                        className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-white/40 transition-colors"
                    />
                </div>
                <button onClick={() => openEditor()} className="px-4 py-2 bg-white text-black font-medium rounded-lg text-sm hover:bg-white/90 transition-colors flex items-center gap-2">
                    <Plus size={16} /> Add Plugin
                </button>
            </div>

            <div className="space-y-3 mb-10 overflow-y-auto flex-1 pr-2 custom-scrollbar">
                {filteredPlugins.map(plugin => (
                    <div
                        key={plugin.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between hover:bg-white/10 transition-colors"
                    >
                        <div className="cursor-pointer flex-1 mr-4" onClick={() => openEditor(plugin)}>
                            <h3 className="font-semibold text-white flex items-center gap-2">
                                {plugin.name}
                                {plugin.isCustom && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Custom</span>}
                            </h3>
                            <p className="text-white/50 text-sm mt-1">{plugin.description}</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => {
                                    togglePlugin(plugin.id)
                                    if (plugin.id === 'auto-theme') {
                                        if (plugin.enabled) pluginManager.unregister('auto-theme')
                                        else pluginManager.register(autoThemePlugin)
                                    } else if (plugin.isCustom && plugin.code) {
                                        if (plugin.enabled) pluginManager.unregister(plugin.id)
                                        else {
                                            evalPlugin(plugin.code).then(p => {
                                                p.id = plugin.id
                                                p.name = plugin.name
                                                p.description = plugin.description
                                                pluginManager.register(p)
                                            }).catch((e: any) => {
                                                alert(`Failed to enable plugin:\n${e.message}`)
                                            })
                                        }
                                    }
                                }}
                                className={`text-xs font-medium px-2 py-1 rounded-md transition-colors ${plugin.enabled
                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                    : 'bg-white/10 text-white/40 hover:bg-white/20'
                                    }`}
                            >
                                {plugin.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                            {plugin.isCustom ? (
                                <button onClick={() => openEditor(plugin)} className="p-2 hover:bg-white/10 rounded-md transition-colors text-white/50 hover:text-white">
                                    <Edit3 size={18} />
                                </button>
                            ) : (
                                <button onClick={() => openEditor(plugin)} className="p-2 hover:bg-white/10 rounded-md transition-colors text-white/50 hover:text-white">
                                    <Settings size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                {filteredPlugins.length === 0 && (
                    <div className="text-center py-10 text-white/40">No plugins found.</div>
                )}
            </div>

            <AnimatePresence>
                {(isCreating || editingPlugin) && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 rounded-xl"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-[#111] border border-white/10 rounded-xl max-w-2xl w-full h-[80vh] flex flex-col shadow-2xl relative overflow-hidden"
                        >
                            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                                <h3 className="font-bold text-lg text-white">
                                    {isCreating ? 'Create Custom Plugin' : editingPlugin?.isCustom ? 'Edit Plugin' : 'Plugin Details'}
                                </h3>
                                <button onClick={closeEditor} className="p-1 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 p-5 overflow-y-auto space-y-4 flex flex-col">
                                {(isCreating || editingPlugin?.isCustom) ? (
                                    <>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-sm font-medium text-white/70">Plugin Name</label>
                                            <input
                                                type="text"
                                                value={editForm.name}
                                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                                className="bg-black/50 border border-white/10 rounded tracking-wide px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-sm font-medium text-white/70">Description</label>
                                            <input
                                                type="text"
                                                value={editForm.description}
                                                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                                                className="bg-black/50 border border-white/10 rounded tracking-wide px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                                            />
                                        </div>
                                        <div className="text-[11px] text-yellow-400/80 bg-yellow-400/5 border border-yellow-400/20 rounded px-3 py-2 leading-relaxed">
                                            ⚠ Plugins run as JavaScript in the renderer. They can access <code className="font-mono">window.fterm</code> (terminal control, settings) and browser APIs. Only install plugins you trust.
                                        </div>

                                        <div className="flex flex-col gap-1.5 flex-1 min-h-[16rem]">
                                            <label className="text-sm font-medium text-white/70 flex justify-between">
                                                Logic (JavaScript object)
                                                <span className="text-xs text-blue-400">Must return a plain object</span>
                                            </label>
                                            <textarea
                                                value={editForm.code}
                                                onChange={e => setEditForm({ ...editForm, code: e.target.value })}
                                                className="w-full flex-1 bg-black text-green-300 font-mono text-sm p-4 border border-white/10 rounded outline-none focus:border-blue-500/50 resize-none whitespace-pre overflow-auto"
                                                spellCheck={false}
                                            />
                                        </div>
                                    </>
                                ) : editingPlugin?.id === 'auto-theme' ? (
                                    <AutoThemeConfig
                                        config={settings.autoThemeConfig ?? AUTO_THEME_DEFAULTS}
                                        themes={useStore.getState().themes}
                                        onChange={cfg => setSettings({ autoThemeConfig: cfg })}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center flex-1 text-white/50 h-full py-10">
                                        <Settings size={48} className="mb-4 opacity-50" />
                                        <p className="font-medium text-white/80">Built-in Plugin</p>
                                        <p className="text-sm">Settings for this plugin cannot be edited.</p>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 border-t border-white/10 bg-white/5 flex items-center justify-between">
                                <div>
                                    {!isCreating && editingPlugin?.isCustom && (
                                        <button
                                            onClick={() => handleDelete(editingPlugin.id)}
                                            className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors flex items-center gap-2 text-sm font-medium"
                                        >
                                            <Trash2 size={16} /> Delete
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={closeEditor} className="px-4 py-2 hover:bg-white/10 text-white rounded transition-colors text-sm font-medium">
                                        {isCreating || editingPlugin?.isCustom ? 'Cancel' : 'Close'}
                                    </button>
                                    {(isCreating || editingPlugin?.isCustom) && (
                                        <button onClick={handleSave} className="px-4 py-2 bg-white text-black hover:bg-white/90 rounded transition-colors flex items-center gap-2 text-sm font-medium">
                                            <Save size={16} /> Save Plugin
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}

// ─── Auto Theme Config ────────────────────────────────────────────────────────

const SLOT_LABELS: Record<string, { label: string; hours: string }> = {
    morning:   { label: 'Morning',   hours: '06:00 – 12:00' },
    afternoon: { label: 'Afternoon', hours: '12:00 – 18:00' },
    evening:   { label: 'Evening',   hours: '18:00 – 22:00' },
    night:     { label: 'Night',     hours: '22:00 – 06:00' },
}

function AutoThemeConfig({
    config,
    themes,
    onChange,
}: {
    config: { morning: string; afternoon: string; evening: string; night: string }
    themes: { id: string; name: string }[]
    onChange: (cfg: typeof config) => void
}) {
    return (
        <div className="flex flex-col gap-5 p-1">
            <p className="text-sm text-white/50">Theme switches automatically based on local time. Changes take effect within 30 minutes or on next app launch.</p>
            {(Object.keys(SLOT_LABELS) as Array<keyof typeof config>).map(slot => (
                <div key={slot} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{SLOT_LABELS[slot].label}</div>
                        <div className="text-xs text-white/40 font-mono">{SLOT_LABELS[slot].hours}</div>
                    </div>
                    <select
                        value={config[slot]}
                        onChange={e => onChange({ ...config, [slot]: e.target.value })}
                        className="bg-black/60 border border-white/10 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500/50 min-w-[160px]"
                    >
                        {themes.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
            ))}
        </div>
    )
}
