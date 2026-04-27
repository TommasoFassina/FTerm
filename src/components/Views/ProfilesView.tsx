import { useState } from 'react'
import { useStore } from '@/store'
import { motion, AnimatePresence } from 'motion/react'
import {
  TerminalSquare, Code, Settings, Plus, Save, X, Trash2,
  Folder, Terminal, Command, Play, Edit3, ChevronDown,
  AlertTriangle, FolderOpen
} from 'lucide-react'

const ICONS = ['TerminalSquare', 'Code', 'Terminal', 'Command', 'Settings', 'Folder'] as const
type IconKey = typeof ICONS[number]

const iconMap: Record<IconKey, JSX.Element> = {
  TerminalSquare: <TerminalSquare size={16} />,
  Code:           <Code size={16} />,
  Terminal:       <Terminal size={16} />,
  Command:        <Command size={16} />,
  Settings:       <Settings size={16} />,
  Folder:         <Folder size={16} />,
}

const ACCENT_COLORS = [
  { id: 'blue',   bg: 'rgba(88,166,255,0.15)',  border: 'rgba(88,166,255,0.3)',  text: '#58a6ff',  dot: '#58a6ff' },
  { id: 'green',  bg: 'rgba(63,185,80,0.15)',   border: 'rgba(63,185,80,0.3)',   text: '#3fb950',  dot: '#3fb950' },
  { id: 'purple', bg: 'rgba(188,140,255,0.15)', border: 'rgba(188,140,255,0.3)', text: '#bc8cff',  dot: '#bc8cff' },
  { id: 'orange', bg: 'rgba(210,153,34,0.15)',  border: 'rgba(210,153,34,0.3)',  text: '#d29922',  dot: '#d29922' },
  { id: 'red',    bg: 'rgba(255,123,114,0.15)', border: 'rgba(255,123,114,0.3)', text: '#ff7b72',  dot: '#ff7b72' },
  { id: 'cyan',   bg: 'rgba(57,197,207,0.15)',  border: 'rgba(57,197,207,0.3)',  text: '#39c5cf',  dot: '#39c5cf' },
]

function getAccent(colorId?: string) {
  return ACCENT_COLORS.find(c => c.id === colorId) ?? ACCENT_COLORS[0]
}

interface FormState {
  name: string
  shell: string
  args: string
  cwd: string
  icon: IconKey
  color: string
}

const EMPTY_FORM: FormState = { name: '', shell: '', args: '', cwd: '', icon: 'TerminalSquare', color: 'blue' }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-[12px] font-medium text-white/60 uppercase tracking-wider">{label}</label>
        {hint && <span className="text-[10px] text-white/25">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputCls = "w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-blue-500/50 rounded-lg px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder-white/20"
const monoInputCls = inputCls + " font-mono"

export default function ProfilesView() {
  const { profiles, addTab, addProfile, updateProfile, deleteProfile, availableShells } = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shellOpen, setShellOpen] = useState(false)

  const isOpen = creating || editing !== null
  const editingProfile = profiles.find(p => p.id === editing)

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, name: 'New Profile' })
    setCreating(true)
    setEditing(null)
    setConfirmDelete(false)
  }

  const openEdit = (profile: typeof profiles[0]) => {
    setForm({
      name: profile.name,
      shell: profile.shell ?? '',
      args: profile.args?.join(' ') ?? '',
      cwd: profile.cwd ?? '',
      icon: (profile.icon as IconKey) ?? 'TerminalSquare',
      color: (profile as any).color ?? 'blue',
    })
    setEditing(profile.id)
    setCreating(false)
    setConfirmDelete(false)
  }

  const close = () => { setEditing(null); setCreating(false); setConfirmDelete(false) }

  const save = () => {
    const args = form.args.trim() ? form.args.trim().split(/\s+/) : undefined
    const data = { name: form.name, shell: form.shell, args, cwd: form.cwd, icon: form.icon, color: form.color }
    if (creating) {
      if (!form.name.trim()) return
      addProfile(data)
    } else if (editing) {
      updateProfile(editing, data)
    }
    close()
  }

  const doDelete = () => {
    if (editing) { deleteProfile(editing); close() }
  }

  const pickShell = (shell: string) => {
    setForm(f => ({ ...f, shell }))
    setShellOpen(false)
  }

  const browseCwd = async () => {
    const path = await window.fterm.fsOpenDialog?.()
    if (path) setForm(f => ({ ...f, cwd: path }))
  }

  return (
    <motion.div
      key="profiles"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col h-full w-full max-w-5xl mx-auto p-6 relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h2 className="text-xl font-semibold text-white">Profiles</h2>
          <p className="text-[12px] text-white/35 mt-0.5">Launch terminals with preset shells, directories, and environments</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-3.5 py-2 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg text-[13px] font-medium text-white transition-colors"
        >
          <Plus size={14} /> New Profile
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto custom-scrollbar pb-4">
        {profiles.map((profile, i) => {
          const accent = getAccent((profile as any).color)
          const icon = iconMap[(profile.icon as IconKey)] ?? iconMap.TerminalSquare
          return (
            <motion.div
              key={profile.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: i * 0.04 }}
              className="group relative flex flex-col rounded-xl border bg-white/[0.03] hover:bg-white/[0.06] transition-all overflow-hidden"
              style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            >
              {/* Color bar */}
              <div className="h-0.5 w-full" style={{ background: accent.dot }} />

              <div className="flex flex-col flex-1 p-4">
                {/* Icon + edit */}
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-lg" style={{ background: accent.bg, color: accent.text }}>
                    {icon}
                  </div>
                  <button
                    onClick={() => openEdit(profile)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/40 hover:text-white transition-all"
                  >
                    <Edit3 size={13} />
                  </button>
                </div>

                <h3 className="text-[14px] font-semibold text-white mb-1 truncate">{profile.name}</h3>

                <div className="flex flex-col gap-0.5 flex-1 min-h-0">
                  <p className="text-[11px] font-mono text-white/35 truncate">
                    {profile.shell || 'Default shell'}{profile.args?.length ? ' ' + profile.args.join(' ') : ''}
                  </p>
                  {profile.cwd && (
                    <p className="text-[11px] font-mono truncate flex items-center gap-1" style={{ color: accent.text + 'aa' }}>
                      <Folder size={9} className="shrink-0" />{profile.cwd}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => addTab(profile.id)}
                  className="mt-3 w-full py-1.5 rounded-lg text-[12px] font-medium transition-all flex items-center justify-center gap-1.5"
                  style={{ background: accent.bg, color: accent.text, border: `1px solid ${accent.border}` }}
                >
                  <Play size={11} fill="currentColor" /> Launch
                </button>
              </div>
            </motion.div>
          )
        })}

        {profiles.length === 0 && (
          <div className="col-span-3 flex flex-col items-center justify-center py-16 text-white/25 gap-3">
            <TerminalSquare size={32} strokeWidth={1} />
            <p className="text-[13px]">No profiles yet</p>
            <button onClick={openCreate} className="text-[12px] text-blue-400/70 hover:text-blue-400 transition-colors">
              Create your first profile →
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', borderRadius: '0.75rem' }}
            onClick={e => { if (e.target === e.currentTarget) close() }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md flex flex-col rounded-2xl overflow-hidden shadow-2xl"
              style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
                <h3 className="text-[14px] font-semibold text-white">
                  {creating ? 'New Profile' : `Edit — ${editingProfile?.name}`}
                </h3>
                <button onClick={close} className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors">
                  <X size={15} />
                </button>
              </div>

              <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                {/* Name + Icon row */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Field label="Name">
                      <input
                        className={inputCls}
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="My Profile"
                        autoFocus
                      />
                    </Field>
                  </div>
                </div>

                {/* Icon picker */}
                <Field label="Icon">
                  <div className="flex gap-1.5">
                    {ICONS.map(k => (
                      <button
                        key={k}
                        onClick={() => setForm(f => ({ ...f, icon: k }))}
                        className="flex-1 flex items-center justify-center py-2 rounded-lg border transition-all"
                        style={{
                          background: form.icon === k ? getAccent(form.color).bg : 'rgba(255,255,255,0.03)',
                          borderColor: form.icon === k ? getAccent(form.color).border : 'rgba(255,255,255,0.07)',
                          color: form.icon === k ? getAccent(form.color).text : 'rgba(255,255,255,0.35)',
                        }}
                        title={k}
                      >
                        {iconMap[k]}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Color picker */}
                <Field label="Color">
                  <div className="flex gap-2">
                    {ACCENT_COLORS.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setForm(f => ({ ...f, color: c.id }))}
                        className="w-7 h-7 rounded-full border-2 transition-all"
                        style={{
                          background: c.dot,
                          borderColor: form.color === c.id ? 'white' : 'transparent',
                          opacity: form.color === c.id ? 1 : 0.5,
                        }}
                      />
                    ))}
                  </div>
                </Field>

                {/* Shell */}
                <Field label="Shell" hint="optional">
                  <div className="relative">
                    <input
                      className={monoInputCls + ' pr-10'}
                      value={form.shell}
                      onChange={e => setForm(f => ({ ...f, shell: e.target.value }))}
                      placeholder="cmd.exe · bash · pwsh"
                    />
                    {availableShells.length > 0 && (
                      <button
                        onClick={() => setShellOpen(o => !o)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors"
                      >
                        <ChevronDown size={13} />
                      </button>
                    )}
                    <AnimatePresence>
                      {shellOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute top-full mt-1 left-0 right-0 z-10 rounded-lg overflow-hidden border border-white/10 shadow-xl"
                          style={{ background: '#161b22' }}
                        >
                          {availableShells.map(s => (
                            <button
                              key={s.id}
                              onClick={() => pickShell(s.shell)}
                              className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] font-mono text-white/70 hover:text-white hover:bg-white/8 transition-colors text-left"
                            >
                              <span className="text-white/40">{s.icon}</span>
                              <span className="flex-1">{s.name}</span>
                              <span className="text-white/25 truncate max-w-[120px]">{s.shell}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Field>

                {/* Args */}
                <Field label="Arguments" hint="optional">
                  <input
                    className={monoInputCls}
                    value={form.args}
                    onChange={e => setForm(f => ({ ...f, args: e.target.value }))}
                    placeholder="-c 'echo hello'"
                  />
                </Field>

                {/* CWD */}
                <Field label="Start Directory" hint="optional">
                  <div className="flex gap-2">
                    <input
                      className={monoInputCls + ' flex-1 min-w-0'}
                      value={form.cwd}
                      onChange={e => setForm(f => ({ ...f, cwd: e.target.value }))}
                      placeholder="C:\Projects\..."
                    />
                    <button
                      onClick={browseCwd}
                      className="px-2.5 py-2 bg-white/[0.04] hover:bg-white/10 border border-white/[0.08] rounded-lg text-white/40 hover:text-white transition-colors shrink-0"
                      title="Browse"
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </Field>
              </div>

              {/* Modal footer */}
              <div className="px-5 py-4 border-t border-white/[0.07] flex items-center justify-between">
                {!creating && (
                  confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-red-400/80 flex items-center gap-1.5">
                        <AlertTriangle size={12} /> Sure?
                      </span>
                      <button onClick={doDelete} className="text-[12px] px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors">
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(false)} className="text-[12px] px-2.5 py-1 hover:bg-white/10 text-white/40 rounded-lg transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 text-[12px] text-white/25 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )
                )}
                {creating && <div />}
                <div className="flex gap-2">
                  <button onClick={close} className="px-3.5 py-1.5 text-[13px] text-white/40 hover:text-white hover:bg-white/8 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={save}
                    disabled={!form.name.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium bg-white text-black hover:bg-white/90 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save size={13} /> Save
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
