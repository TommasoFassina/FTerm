import { useState } from 'react';
import { THEMES, useStore } from '@/store';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import type { Theme } from '@/types';

function ViewContainer({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col p-8 overflow-y-auto"
        >
            <h2 className="text-2xl font-bold mb-6">{title}</h2>
            {children}
        </motion.div>
    );
}

const COLOR_FIELDS: { key: keyof Theme; label: string }[] = [
    { key: 'background', label: 'Background' },
    { key: 'foreground', label: 'Foreground' },
    { key: 'cursor', label: 'Cursor' },
    { key: 'selectionBackground', label: 'Selection' },
    { key: 'black', label: 'Black' },
    { key: 'red', label: 'Red' },
    { key: 'green', label: 'Green' },
    { key: 'yellow', label: 'Yellow' },
    { key: 'blue', label: 'Blue' },
    { key: 'magenta', label: 'Magenta' },
    { key: 'cyan', label: 'Cyan' },
    { key: 'white', label: 'White' },
    { key: 'brightBlack', label: 'Br.Black' },
    { key: 'brightRed', label: 'Br.Red' },
    { key: 'brightGreen', label: 'Br.Green' },
    { key: 'brightYellow', label: 'Br.Yellow' },
    { key: 'brightBlue', label: 'Br.Blue' },
    { key: 'brightMagenta', label: 'Br.Magenta' },
    { key: 'brightCyan', label: 'Br.Cyan' },
    { key: 'brightWhite', label: 'Br.White' },
];

const DEFAULT_NEW_THEME: Omit<Theme, 'id' | 'name'> = {
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#388bfd33',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
    brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
};

function ThemeEditor({
    initial,
    onSave,
    onCancel,
}: {
    initial: Theme;
    onSave: (t: Theme) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState<Theme>(initial);

    const set = (key: keyof Theme, value: string) =>
        setDraft(d => ({ ...d, [key]: value }));

    return (
        <div className="p-4 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md flex flex-col gap-4 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    value={draft.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Theme name"
                    className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-[#58a6ff] flex-1 min-w-0"
                />
                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={() => onSave(draft)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#58a6ff] text-black text-sm font-medium rounded hover:bg-[#79b8ff] transition-colors"
                    >
                        <Check size={14} /> Save
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-white text-sm rounded hover:bg-white/20 transition-colors"
                    >
                        <X size={14} /> Cancel
                    </button>
                </div>
            </div>

            {/* Preview */}
            <div className="h-16 w-full rounded-lg p-3 flex flex-col justify-between font-mono text-xs" style={{ backgroundColor: draft.background }}>
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: draft.blue }} />
                    <span style={{ color: draft.foreground }}>{draft.name || 'Preview'}</span>
                </div>
                <div style={{ color: draft.foreground, opacity: 0.7 }}>
                    <span style={{ color: draft.green }}>~</span> echo "Hello World"
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {COLOR_FIELDS.map(({ key, label }) => (
                    <label key={key} className="flex flex-col gap-1">
                        <span className="text-[10px] text-[#8b949e] uppercase tracking-wide">{label}</span>
                        <div className="flex items-center gap-1.5">
                            <input
                                type="color"
                                value={draft[key] as string}
                                onChange={e => set(key, e.target.value)}
                                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                            />
                            <input
                                value={draft[key] as string}
                                onChange={e => set(key, e.target.value)}
                                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] font-mono text-white outline-none focus:border-[#58a6ff]"
                            />
                        </div>
                    </label>
                ))}
            </div>
        </div>
    );
}

export default function ThemesView() {
    const { activeThemeId, themes, setTheme, addTheme, updateTheme, deleteTheme, settings, setSettings } = useStore();
    const bgOpacity = Math.round((settings.opacity ?? 0.85) * 100);

    const [editing, setEditing] = useState<Theme | null>(null);
    const [creating, setCreating] = useState(false);

    const builtIn = THEMES.map(t => t.id);
    const customThemes = themes.filter(t => !builtIn.includes(t.id));

    const handleCreate = (t: Theme) => {
        const id = 'custom-' + Date.now();
        addTheme({ ...t, id });
        setCreating(false);
    };

    const handleUpdate = (t: Theme) => {
        updateTheme(t.id, t);
        setEditing(null);
    };

    const handleDelete = (id: string) => {
        deleteTheme(id);
        if (editing?.id === id) setEditing(null);
    };

    return (
        <ViewContainer title="Appearance & Themes">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {THEMES.map(theme => (
                    <div
                        key={theme.id}
                        onClick={() => setTheme(theme.id)}
                        className={`relative rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${activeThemeId === theme.id ? 'border-white shadow-lg shadow-white/10' : 'border-transparent hover:border-white/30'}`}
                    >
                        <div className="h-24 w-full p-4 flex flex-col justify-between" style={{ backgroundColor: theme.background }}>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: theme.blue || '#58a6ff' }} />
                                <span className="font-mono text-xs font-bold" style={{ color: theme.foreground }}>{theme.name}</span>
                            </div>
                            <div className="font-mono text-xs opacity-70" style={{ color: theme.foreground }}>
                                <span style={{ color: theme.green || '#3fb950' }}>~</span> echo "Hello World"
                            </div>
                        </div>
                        {activeThemeId === theme.id && (
                            <div className="absolute top-2 right-2 bg-white text-black text-[10px] font-bold px-2 py-0.5 rounded-full">ACTIVE</div>
                        )}
                    </div>
                ))}
            </div>

            {/* Custom Themes */}
            <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
                <h3 className="text-lg font-semibold">Custom Themes</h3>
                {!creating && !editing && (
                    <button
                        onClick={() => setCreating(true)}
                        className="flex items-center gap-1.5 px-3 py-1 text-sm bg-[#58a6ff]/10 border border-[#58a6ff]/30 text-[#58a6ff] rounded hover:bg-[#58a6ff]/20 transition-colors"
                    >
                        <Plus size={14} /> New Theme
                    </button>
                )}
            </div>

            <AnimatePresence>
                {creating && (
                    <motion.div
                        key="create"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        className="mb-6"
                    >
                        <ThemeEditor
                            initial={{ id: '', name: 'My Theme', ...DEFAULT_NEW_THEME }}
                            onSave={handleCreate}
                            onCancel={() => setCreating(false)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {customThemes.length === 0 && !creating ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    <div
                        onClick={() => setCreating(true)}
                        className="relative rounded-xl overflow-hidden cursor-pointer border-2 border-dashed border-white/20 hover:border-white/40 bg-white/5 flex flex-col justify-center items-center h-24 text-center p-4 transition-all"
                    >
                        <Plus size={18} className="text-white/40 mb-1" />
                        <span className="text-sm font-semibold text-white/50">Create Custom Theme</span>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    {customThemes.map(theme => (
                        <div key={theme.id} className="flex flex-col gap-0">
                            <div
                                onClick={() => setTheme(theme.id)}
                                className={`relative rounded-t-xl overflow-hidden cursor-pointer border-2 border-b-0 transition-all ${activeThemeId === theme.id ? 'border-white' : 'border-transparent hover:border-white/30'}`}
                            >
                                <div className="h-20 w-full p-3 flex flex-col justify-between" style={{ backgroundColor: theme.background }}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: theme.blue || '#58a6ff' }} />
                                        <span className="font-mono text-xs font-bold" style={{ color: theme.foreground }}>{theme.name}</span>
                                    </div>
                                    <div className="font-mono text-xs opacity-70" style={{ color: theme.foreground }}>
                                        <span style={{ color: theme.green || '#3fb950' }}>~</span> echo "Hello World"
                                    </div>
                                </div>
                                {activeThemeId === theme.id && (
                                    <div className="absolute top-2 right-2 bg-white text-black text-[10px] font-bold px-2 py-0.5 rounded-full">ACTIVE</div>
                                )}
                            </div>
                            <div className="flex border-l-2 border-r-2 border-b-2 border-white/10 rounded-b-xl overflow-hidden">
                                <button
                                    onClick={() => setEditing(editing?.id === theme.id ? null : theme)}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    <Pencil size={12} /> Edit
                                </button>
                                <button
                                    onClick={() => handleDelete(theme.id)}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-[#8b949e] hover:text-[#f85149] hover:bg-[#f85149]/5 transition-colors"
                                >
                                    <Trash2 size={12} /> Delete
                                </button>
                            </div>
                            <AnimatePresence>
                                {editing?.id === theme.id && (
                                    <motion.div
                                        key="edit"
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        transition={{ duration: 0.15 }}
                                        className="mt-2 col-span-full"
                                    >
                                        <ThemeEditor
                                            initial={theme}
                                            onSave={handleUpdate}
                                            onCancel={() => setEditing(null)}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                    {!creating && (
                        <div
                            onClick={() => setCreating(true)}
                            className="relative rounded-xl overflow-hidden cursor-pointer border-2 border-dashed border-white/20 hover:border-white/40 bg-white/5 flex flex-col justify-center items-center h-24 text-center p-4 transition-all"
                        >
                            <Plus size={18} className="text-white/40 mb-1" />
                            <span className="text-xs text-white/40">New Theme</span>
                        </div>
                    )}
                </div>
            )}

            <h3 className="text-lg font-semibold mb-4 border-b border-white/10 pb-2">Customization</h3>
            <div className="space-y-4 max-w-md">
                <div>
                    <label className="block text-xs font-medium text-white/60 mb-1">Background Opacity: {bgOpacity}%</label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={bgOpacity}
                        onChange={(e) => setSettings({ opacity: Number(e.target.value) / 100 })}
                        className="w-full accent-white"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-white/60 mb-1">Font Size: {settings.fontSize ?? 14}px</label>
                    <input
                        type="range"
                        min="10"
                        max="24"
                        value={settings.fontSize ?? 14}
                        onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
                        className="w-full accent-white"
                    />
                </div>
            </div>
        </ViewContainer>
    );
}
