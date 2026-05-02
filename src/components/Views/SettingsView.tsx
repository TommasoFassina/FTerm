import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore, THEMES, DEFAULT_KEYBINDINGS } from '@/store'
import { useAI } from '@/hooks/useAI'
import type { AIProvider, QuickAction } from '@/types'

type Tab = 'general' | 'theme' | 'ai' | 'pet' | 'stats' | 'shortcuts' | 'remote'

const TAB_COMPONENTS: Record<Tab, JSX.Element> = {
  general: <GeneralTab />, theme: <ThemeTab />, ai: <AITab />, pet: <PetTab />, stats: <StatsTab />,
  shortcuts: <ShortcutsTab />, remote: <RemoteTab />,
}

export default function SettingsView() {
  const { settings, setSettings } = useStore()
  const activeTab = settings.activeSettingsTab || 'general'

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full w-full max-w-5xl mx-auto"
    >
      <h2 className="text-lg font-semibold mb-4 text-white/90 shrink-0">Settings</h2>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden gap-4 md:gap-6">
        {/* Sidebar Nav */}
        <div className="w-full md:w-40 shrink-0 flex flex-row md:flex-col gap-0.5 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
          {(['general', 'theme', 'ai', 'pet', 'stats', 'shortcuts', 'remote'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setSettings({ activeSettingsTab: t })}
              className={`
                px-3 py-2 rounded-md text-[13px] font-medium capitalize text-left transition-all relative overflow-hidden whitespace-nowrap
                ${activeTab === t
                  ? 'text-white bg-white/[0.06]'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/[0.03]'}
              `}
            >
              {activeTab === t && (
                <motion.div
                  layoutId="activeSettingsTabIndicator"
                  className="absolute left-0 bottom-0 md:top-0 h-[2px] md:h-auto w-full md:w-[2px] rounded-full bg-[#58a6ff]"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {t}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              {TAB_COMPONENTS[activeTab]}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

function GeneralTab() {
  const { settings, setSettings } = useStore()

  function exportSettings() {
    const data = JSON.stringify(settings, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fterm-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importSettings() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string)
          setSettings(parsed)
        } catch {
          alert('Invalid settings file.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start mb-12">
      {/* --- Column 1 flow --- */}
      <Section title="Font">
        <Row label="Family">
          <input
            value={settings.fontFamily}
            onChange={e => setSettings({ fontFamily: e.target.value })}
            className="input flex-1 min-w-0"
          />
        </Row>
        <Row label="Size">
          <Slider min={10} max={24} value={settings.fontSize} onChange={v => setSettings({ fontSize: v })} />
        </Row>
        <Row label="Line height">
          <Slider min={1} max={2} step={0.05} value={settings.lineHeight} onChange={v => setSettings({ lineHeight: v })} />
        </Row>
      </Section>

      <Section title="Transparency">
        <Row label="Window Opacity">
          <Slider min={0.1} max={1} step={0.05} value={settings.opacity} onChange={v => setSettings({ opacity: v })} />
        </Row>
        <Row label="Acrylic Blur">
          <Toggle value={settings.blurEnabled} onChange={v => setSettings({ blurEnabled: v })} />
        </Row>
        <p className="text-[10px] text-white/30 mt-1">
          Acrylic blur uses Windows 11 native DWM. Lower opacity to see the effect. Requires restart if toggled.
        </p>
      </Section>

      <Section title="Cursor">
        <Row label="Style">
          <select
            value={settings.cursorStyle}
            onChange={e => setSettings({ cursorStyle: e.target.value as 'block' | 'underline' | 'bar' })}
            className="input"
          >
            <option value="block">Block</option>
            <option value="underline">Underline</option>
            <option value="bar">Bar</option>
          </select>
        </Row>
        <Row label="Blink">
          <Toggle value={settings.cursorBlink} onChange={v => setSettings({ cursorBlink: v })} />
        </Row>
      </Section>

      <Section title="Background">
        <Row label="Image">
          <div className="flex flex-1 gap-2">
            <input
              value={settings.backgroundImage || ''}
              onChange={e => setSettings({ backgroundImage: e.target.value })}
              placeholder="https://..."
              className="input flex-1 min-w-0"
            />
            <input
              type="file" id="bg-upload" className="hidden" accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) {
                  // In Electron, file objects have a `path` property
                  const reader = new FileReader()
                  reader.onload = e => setSettings({ backgroundImage: e.target?.result as string })
                  reader.readAsDataURL(file)
                }
              }}
            />
            <label htmlFor="bg-upload" className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded cursor-pointer text-xs font-medium transition-colors flex items-center justify-center whitespace-nowrap">
              Upload...
            </label>
          </div>
        </Row>
        <Row label="Wallpaper Blur">
          <Slider min={0} max={50} value={settings.backgroundBlur ?? 10} onChange={v => setSettings({ backgroundBlur: v })} />
        </Row>
      </Section>

      <Section title="Scrollback">
        <Row label="Lines">
          <input
            type="number"
            min={500}
            max={50000}
            value={settings.scrollback}
            onChange={e => setSettings({ scrollback: Number(e.target.value) })}
            className="input w-24"
          />
        </Row>
      </Section>

      <Section title="Terminal">
        <Row label="Padding">
          <Slider min={0} max={20} value={settings.terminalPadding ?? 8} onChange={v => setSettings({ terminalPadding: v })} />
        </Row>
        <Row label="Font ligatures">
          <Toggle value={settings.ligatures !== false} onChange={v => setSettings({ ligatures: v })} />
        </Row>
        <Row label="Copy on select">
          <Toggle value={settings.copyOnSelect !== false} onChange={v => setSettings({ copyOnSelect: v })} />
        </Row>
        <Row label="Show recording button">
          <Toggle value={settings.showRecordingButton !== false} onChange={v => setSettings({ showRecordingButton: v })} />
        </Row>
      </Section>

      <Section title="File Explorer">
        <Row label="Open text files in editor">
          <Toggle value={settings.explorerOpenInTerminal !== false} onChange={v => setSettings({ explorerOpenInTerminal: v })} />
        </Row>
        <p className="text-[10px] text-white/30 mt-1">
          Text/code files open in the built-in Monaco editor tab. Disable to use Windows default app.
        </p>
      </Section>

      <Section title="Backup">
        <p className="text-xs text-[#6e7681] mb-3">Export or import all visual settings as JSON.</p>
        <div className="flex gap-2">
          <button onClick={exportSettings} className="btn-secondary flex-1">Export settings</button>
          <button onClick={importSettings} className="btn-secondary flex-1">Import settings</button>
        </div>
      </Section>
    </div>
  )
}

// ─── Theme tab ────────────────────────────────────────────────────────────────

function ThemeTab() {
  const { activeThemeId, setTheme } = useStore()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[#6e7681]">Changes apply instantly. Select a theme to preview.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {THEMES.map(theme => {
          const isActive = activeThemeId === theme.id
          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className={`
                group relative text-left rounded-xl border-2 overflow-hidden transition-all duration-200
                ${isActive
                  ? 'border-[#58a6ff] shadow-[0_0_20px_rgba(88,166,255,0.15)]'
                  : 'border-white/10 hover:border-white/25 hover:shadow-lg'}
              `}
            >
              {/* Terminal preview */}
              <div
                className="p-4 font-mono text-[11px] leading-relaxed"
                style={{ background: theme.background, color: theme.foreground }}
              >
                <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: theme.brightBlack + '40' }}>
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: theme.red }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: theme.yellow }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: theme.green }} />
                  </div>
                  <span className="text-[10px] ml-1" style={{ color: theme.brightBlack }}>{theme.name}</span>
                  {isActive && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: theme.blue + '30', color: theme.blue }}>Active</span>}
                </div>
                <div><span style={{ color: theme.green }}>$</span> <span style={{ color: theme.foreground }}>git status</span></div>
                <div style={{ color: theme.green }}>On branch <span style={{ color: theme.cyan }}>main</span></div>
                <div style={{ color: theme.yellow }}>Changes not staged:</div>
                <div>&nbsp; <span style={{ color: theme.red }}>modified:</span> <span style={{ color: theme.blue }}>src/App.tsx</span></div>
              </div>

              {/* Color palette */}
              <div className="flex items-center gap-3 px-4 py-3 bg-black/30">
                <div className="flex gap-1">
                  {[theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan].map((c, i) => (
                    <div key={i} className="w-4 h-4 rounded-[4px] transition-transform group-hover:scale-110" style={{ background: c }} />
                  ))}
                </div>
                <span className="ml-auto text-[10px] font-medium" style={{ color: theme.brightBlack }}>{theme.id}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── AI tab ───────────────────────────────────────────────────────────────────

const PROVIDERS: {
  id: AIProvider
  name: string
  keyPlaceholder: string
  consoleUrl: string
}[] = [
    {
      id: 'claude', name: 'Claude (Anthropic)', keyPlaceholder: 'sk-ant-…',
      consoleUrl: 'https://console.anthropic.com/settings/keys',
    },
    {
      id: 'openai', name: 'OpenAI / Codex', keyPlaceholder: 'sk-…',
      consoleUrl: 'https://platform.openai.com/api-keys',
    }, {
      id: 'gemini', name: 'Google Gemini', keyPlaceholder: 'AIza…',
      consoleUrl: 'https://aistudio.google.com/app/apikey',
    },
    {
      id: 'deepseek', name: 'DeepSeek', keyPlaceholder: 'sk-…',
      consoleUrl: 'https://platform.deepseek.com/api_keys',
    }]

function AITab() {
  const { ai, setAIConfig, settings, setSettings } = useStore()

  return (
    <div className="columns-1 md:columns-2 gap-6 mb-12 [&>*]:break-inside-avoid [&>*]:mb-6">
      {/* API key providers */}
      {PROVIDERS.map(p => (
        <APIKeySection key={p.id} provider={p} />
      ))}

      {/* GitHub Copilot */}
      <CopilotSection />

      {/* Ollama */}
      <OllamaSection />

      {/* Auto-Fix button */}
      <Section title="Terminal">
        <Row label="Auto-Fix button (✨)">
          <Toggle value={settings.showAIAutoFixButton ?? true} onChange={v => setSettings({ showAIAutoFixButton: v })} />
        </Row>
      </Section>

      {/* Effort */}
      <Section title="Effort">
        <p className="text-xs text-[#6e7681] mb-2">
          Controls the default model tier. Overridden by the model field below.
        </p>
        <div className="flex flex-col 2xl:flex-row gap-2">
          {(['fast', 'auto', 'thorough'] as const).map(e => (
            <button
              key={e}
              onClick={() => setAIConfig({ effort: e })}
              className={`flex-1 py-1 rounded border text-xs capitalize transition-colors
                ${ai.effort === e
                  ? 'border-[#58a6ff] text-[#58a6ff] bg-[#388bfd11]'
                  : 'border-[#30363d] text-[#6e7681] hover:border-[#6e7681]'}`}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[#484f58] mt-1">
          fast = haiku/mini · auto = sonnet/4o · thorough = opus/o1
        </p>
      </Section>

      {/* Model override */}
      <Section title="Model override">
        <p className="text-xs text-[#6e7681] mb-2">Leave blank to use the default for the selected effort level.</p>
        <input
          value={ai.model}
          onChange={e => setAIConfig({ model: e.target.value })}
          placeholder="e.g. claude-opus-4-6 / gpt-4o / llama3"
          className="input w-full"
        />
      </Section>

      {/* System prompt */}
      <Section title="System prompt">
        <p className="text-xs text-[#6e7681] mb-2">
          Custom instructions sent to the AI on every message. Leave blank for default.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {PERSONAS.map(p => (
            <button
              key={p.label}
              onClick={() => setAIConfig({ systemPrompt: p.prompt })}
              title={p.prompt}
              className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                ai.systemPrompt === p.prompt
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          value={ai.systemPrompt || ''}
          onChange={e => setAIConfig({ systemPrompt: e.target.value })}
          placeholder="You are a concise dev terminal AI. Use markdown code blocks."
          rows={4}
          className="input w-full resize-y font-mono text-xs"
        />
      </Section>

      {/* Claude CLI Statusline */}
      <ClaudeStatuslineSection />

      {/* Quick actions */}
      <QuickActionsEditor />
    </div>
  )
}

const PERSONAS: { label: string; prompt: string }[] = [
  { label: '🤖 Default', prompt: 'You are a helpful coding assistant embedded in a terminal. Answer concisely. Use markdown code blocks for code.' },
  { label: '🦴 Caveman', prompt: 'Respond terse like smart caveman. All technical substance stay. Only fluff die.\n\nRules:\n- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging\n- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.\n- Pattern: [thing] [action] [reason]. [next step].\n- Not: "Sure! I\'d be happy to help you with that."\n- Yes: "Bug in auth middleware. Fix:"\n\nAuto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.\nBoundaries: code/commits/PRs written normal.' },
  { label: '🏴‍☠️ Pirate', prompt: "You are a pirate software engineer. Speak like a pirate (arr, matey, shiver me timbers) but give accurate technical answers. Use nautical metaphors for code concepts." },
  { label: '🧒 ELI5', prompt: 'Explain everything like I am 5 years old. Use very simple words, fun analogies, and short sentences. Make it easy and friendly.' },
  { label: '😏 Sarcastic', prompt: 'You are a sarcastic but accurate senior developer. You help users but with dry humor and mild sarcasm. Still give correct answers.' },
  { label: '🎓 Professor', prompt: 'You are a computer science professor. Give thorough, educational answers with context, best practices, and examples. Use precise technical terminology.' },
  { label: '⚡ Terse', prompt: 'Be extremely brief. Code only, no explanation unless asked. One-liners preferred. No filler.' },
]

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Fix last error', prompt: 'Fix the last error shown in the terminal.' },
  { label: 'Explain command', prompt: 'Explain what the last command does.' },
  { label: 'Suggest command', prompt: 'Suggest a command for: ' },
  { label: 'Git help', prompt: 'Help me with git: ' },
]

function QuickActionsEditor() {
  const { ai, setAIConfig } = useStore()
  const actions: QuickAction[] = ai.quickActions ?? DEFAULT_QUICK_ACTIONS
  const [newLabel, setNewLabel] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const labelRef = useRef<HTMLInputElement>(null)

  function add() {
    if (!newLabel.trim() || !newPrompt.trim()) return
    setAIConfig({ quickActions: [...actions, { label: newLabel.trim(), prompt: newPrompt.trim() }] })
    setNewLabel('')
    setNewPrompt('')
    labelRef.current?.focus()
  }

  function remove(i: number) {
    const next = actions.filter((_, idx) => idx !== i)
    setAIConfig({ quickActions: next.length ? next : [] })
  }

  function reset() {
    setAIConfig({ quickActions: undefined })
  }

  return (
    <Section title="Quick actions">
      <p className="text-xs text-[#6e7681] mb-3">
        Buttons shown in the AI sidebar when chat is empty.
      </p>
      <div className="flex flex-col gap-1.5 mb-3">
        {actions.map((a, i) => (
          <div key={i} className="flex items-center gap-2 bg-white/5 rounded px-2.5 py-1.5 text-xs">
            <span className="text-white/80 font-medium shrink-0 w-28 truncate">{a.label}</span>
            <span className="text-white/40 flex-1 truncate font-mono text-[11px]">{a.prompt}</span>
            <button
              onClick={() => remove(i)}
              className="text-[#6e7681] hover:text-[#f85149] transition-colors shrink-0 ml-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            ref={labelRef}
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Label"
            className="input w-32 shrink-0"
          />
          <input
            value={newPrompt}
            onChange={e => setNewPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Prompt text…"
            className="input flex-1 min-w-0"
          />
          <button
            onClick={add}
            disabled={!newLabel.trim() || !newPrompt.trim()}
            className="btn-primary shrink-0"
          >
            Add
          </button>
        </div>
        {ai.quickActions && (
          <button onClick={reset} className="text-[10px] text-[#6e7681] hover:text-white/60 text-left">
            Reset to defaults
          </button>
        )}
      </div>
    </Section>
  )
}

const PRESET_STATUSLINE_COMMANDS = [
  { label: 'Caveman badge', command: 'powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\\.claude\\plugins\\cache\\caveman\\caveman\\84cc3c14fa1e\\hooks\\caveman-statusline.ps1"' },
  { label: 'Git branch', command: 'git -C %CD% rev-parse --abbrev-ref HEAD 2>nul' },
  { label: 'Node version', command: 'node --version' },
]

function ClaudeStatuslineSection() {
  const { settings, setSettings } = useStore()
  const cfg = settings.claudeStatusline ?? { enabled: false, command: '', pollInterval: 3000 }
  const [showGuide, setShowGuide] = useState(false)
  const [guideStep, setGuideStep] = useState(0)
  const [settingsJson, setSettingsJson] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [testOutput, setTestOutput] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const update = (patch: Partial<typeof cfg>) =>
    setSettings({ claudeStatusline: { ...cfg, ...patch } })

  async function openGuide() {
    setGuideStep(0)
    setShowGuide(true)
    try {
      const homedir = window.fterm.homedir
      const path = `${homedir}\\.claude\\settings.json`
      const text = await window.fterm.fsReadFile(path)
      setSettingsJson(text)
    } catch {
      setSettingsJson('{}')
    }
  }

  async function saveToClaudeSettings() {
    setSaveStatus('saving')
    try {
      let parsed: Record<string, any> = {}
      try { parsed = JSON.parse(settingsJson) } catch { /* use empty */ }
      parsed.statusLine = { type: 'command', command: cfg.command }
      const homedir = window.fterm.homedir
      const path = `${homedir}\\.claude\\settings.json`
      await window.fterm.fsWriteFile(path, JSON.stringify(parsed, null, 2))
      setSaveStatus('ok')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  async function testCommand() {
    if (!cfg.command) return
    setTesting(true)
    setTestOutput(null)
    try {
      const out = await window.fterm.shellExec(cfg.command)
      setTestOutput(out || '(empty output)')
    } catch (e: any) {
      setTestOutput(`Error: ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section title="Claude CLI Statusline">
      <p className="text-xs text-[#6e7681] mb-3">
        Show a custom statusline from Claude CLI in FTerm's status bar. Polls a shell command and displays the output.
      </p>
      <Row label="Enable">
        <Toggle value={cfg.enabled} onChange={v => update({ enabled: v })} />
      </Row>

      {cfg.enabled && (
        <>
          <div className="mt-3 flex flex-col gap-2">
            <label className="text-xs text-[#6e7681]">Command</label>
            <input
              value={cfg.command}
              onChange={e => update({ command: e.target.value })}
              placeholder="e.g. powershell -File statusline.ps1"
              className="input w-full font-mono text-xs"
            />
            <div className="flex flex-wrap gap-1">
              {PRESET_STATUSLINE_COMMANDS.map(p => (
                <button
                  key={p.label}
                  onClick={() => update({ command: p.command })}
                  className="px-2 py-0.5 rounded text-[10px] border border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-1">
            <label className="text-xs text-[#6e7681]">Poll interval (ms)</label>
            <input
              type="number"
              value={cfg.pollInterval}
              min={500}
              max={30000}
              step={500}
              onChange={e => update({ pollInterval: Number(e.target.value) })}
              className="input w-32"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={testCommand}
              disabled={!cfg.command || testing}
              className="btn-secondary text-xs"
            >
              {testing ? 'Running…' : 'Test command'}
            </button>
            {testOutput !== null && (
              <span className="text-xs font-mono text-[#58a6ff] truncate max-w-xs">{testOutput}</span>
            )}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={openGuide}
          className="text-xs text-[#58a6ff] hover:text-[#79c0ff] underline underline-offset-2"
        >
          Setup guide: configure Claude CLI settings.json →
        </button>
      </div>

      {showGuide && (
        <div className="mt-4 border border-[#30363d] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
            <span className="text-xs font-medium text-white/80">Claude CLI Statusline Setup</span>
            <button onClick={() => setShowGuide(false)} className="text-[#6e7681] hover:text-white text-xs">✕</button>
          </div>

          <div className="p-3 bg-[#0d1117]">
            {guideStep === 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-[#c9d1d9]">
                  Claude CLI reads <code className="bg-white/10 px-1 rounded font-mono text-[11px]">~/.claude/settings.json</code> and runs the <code className="bg-white/10 px-1 rounded font-mono text-[11px]">statusLine.command</code> to display a statusline inside Claude's interactive session.
                </p>
                <p className="text-xs text-[#6e7681]">Step 1: Enter your statusline command above, then click below to write it to your Claude CLI settings.</p>
                <div className="rounded border border-[#30363d] bg-[#161b22] p-2 font-mono text-[11px] text-[#8b949e] whitespace-pre-wrap max-h-32 overflow-auto">
                  {settingsJson || '{}'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveToClaudeSettings}
                    disabled={!cfg.command || saveStatus === 'saving'}
                    className="btn-primary text-xs"
                  >
                    {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'ok' ? 'Saved ✓' : saveStatus === 'error' ? 'Error ✗' : 'Write to settings.json'}
                  </button>
                  <button onClick={() => setGuideStep(1)} className="btn-secondary text-xs">Next →</button>
                </div>
              </div>
            )}

            {guideStep === 1 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-[#c9d1d9] font-medium">Step 2: Verify in Claude CLI</p>
                <p className="text-xs text-[#6e7681]">Open Claude CLI in a terminal and start an interactive session. The statusline output will appear at the bottom of the Claude session. FTerm also polls the same command and shows output in its own status bar below.</p>
                <div className="rounded border border-[#30363d] bg-[#161b22] p-2 font-mono text-[11px] text-[#58a6ff]">
                  claude
                </div>
                <p className="text-xs text-[#6e7681]">To create a custom statusline script, save a PowerShell or shell script that outputs a single line of text. Use the "Command" field above to point to it.</p>
                <div className="flex gap-2">
                  <button onClick={() => setGuideStep(0)} className="btn-secondary text-xs">← Back</button>
                  <button onClick={() => setShowGuide(false)} className="btn-primary text-xs">Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}

function APIKeySection({ provider }: { provider: typeof PROVIDERS[number] }) {
  const { ai, setAIConfig } = useStore()
  const { testConnection, saveKey, removeKey } = useAI()
  const status = ai.providerStatus[provider.id]
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [importStatus, setImportStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [importError, setImportError] = useState('')

  useEffect(() => {
    window.fterm.keysHas(provider.id).then(has => setSaved(has))

    if (provider.id === 'openai') {
      return window.fterm.onOpenAIOAuthStatus(status => {
        if (status === 'success') {
          setSaved(true)
          testConnection(provider.id)
        }
      })
    }
    if (provider.id === 'gemini') {
      return window.fterm.onGeminiOAuthStatus(status => {
        if (status === 'success') {
          setSaved(true)
          testConnection(provider.id)
        }
      })
    }
  }, [provider.id])

  async function handleSaveKey() {
    if (!key.trim()) return
    await saveKey(provider.id, key.trim())
    setSaved(true)
    setKey('')
    testConnection(provider.id)
  }

  async function handleImportFromCLI() {
    setImportStatus('idle')
    try {
      await window.fterm.claudeImportFromCLI()
      setSaved(true)
      setImportStatus('ok')
      testConnection(provider.id)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
      setImportStatus('error')
    }
  }

  async function handleDisconnect() {
    await removeKey(provider.id)
    setSaved(false)
    setImportStatus('idle')
  }

  return (
    <Section title={provider.name}>
      <div className="flex items-center gap-2 mb-2">
        <StatusDot connected={status?.connected} testing={status?.testing} />
        <span className="text-xs text-[#6e7681]">
          {status?.testing ? 'Testing…' : status?.connected ? 'Connected' : saved ? 'Saved — test to verify' : 'Not connected'}
        </span>
        {status?.error && <span className="text-xs text-red-400 truncate">{status.error}</span>}
      </div>

      {saved ? (
        <div className="flex flex-col gap-2 relative">
          <div className="flex flex-col 2xl:flex-row gap-2">
            <button onClick={() => testConnection(provider.id)} className="btn-secondary">
              {status?.testing ? 'Testing…' : 'Test connection'}
            </button>
            <button onClick={handleDisconnect} className="btn-danger">Disconnect</button>
          </div>

          {/* Custom BaseURL for OpenAI/Custom Providers (e.g. OpenRouter) */}
          {(provider.id === 'openai' || provider.id === 'deepseek') && (
            <div className="mt-2 pt-2 border-t border-[#30363d] flex flex-col gap-2">
              <span className="text-xs text-[#8b949e]">Override Base URL (Optional)</span>
              <input
                value={ai.openaiUrl || ''}
                onChange={e => setAIConfig({ openaiUrl: e.target.value })}
                placeholder="e.g. https://openrouter.ai/api/v1"
                className="input w-full text-xs"
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Claude — CLI import (uses local Claude Code credentials) */}
          {provider.id === 'claude' && (
            <div className="mb-3">
              <p className="text-xs text-[#6e7681] mb-2">If you use the Claude Code CLI, import its credentials:</p>
              <button onClick={handleImportFromCLI} className="btn-secondary w-full">
                Import from Claude Code CLI (<code className="font-mono">~/.claude</code>)
              </button>
              {importStatus === 'ok' && <p className="text-xs text-green-400 mt-1">Credentials imported successfully.</p>}
              {importStatus === 'error' && <p className="text-xs text-red-400 mt-1">{importError}</p>}
              <div className="my-3 border-t border-[#30363d]" />
            </div>
          )}

          {/* OpenAI / Gemini — OAuth requires user's own registered OAuth app */}
          {(provider.id === 'openai' || provider.id === 'gemini') && (
            <div className="mb-3">
              <p className="text-xs text-[#6e7681] mb-1">Login via browser (requires a registered OAuth app):</p>
              <p className="text-[11px] text-[#484f58] mb-2">
                {provider.id === 'openai'
                  ? <>Create an OAuth app at <button onClick={() => window.fterm.openExternal('https://platform.openai.com/settings/organization/apps')} className="text-[#58a6ff] hover:underline">platform.openai.com/settings/organization/apps →</button></>
                  : <>Create OAuth credentials at <button onClick={() => window.fterm.openExternal('https://console.cloud.google.com/apis/credentials')} className="text-[#58a6ff] hover:underline">Google Cloud Console →</button></>
                }
              </p>
              <div className="flex flex-col 2xl:flex-row gap-2">
                <input
                  type="text"
                  id={`oauth-client-id-${provider.id}`}
                  placeholder="OAuth Client ID"
                  className="input flex-1 min-w-0"
                />
                <button
                  onClick={() => {
                    const cid = (document.getElementById(`oauth-client-id-${provider.id}`) as HTMLInputElement)?.value
                    if (!cid) return
                    if (provider.id === 'openai') window.fterm.openaiOAuthStart(cid)
                    else if (provider.id === 'gemini') window.fterm.geminiOAuthStart(cid)
                  }}
                  className="btn-secondary shrink-0"
                >
                  Login via Browser
                </button>
              </div>
              <div className="my-3 border-t border-[#30363d]" />
            </div>
          )}

          {/* API key input */}
          <div className="flex flex-col 2xl:flex-row gap-2">
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
              placeholder={provider.keyPlaceholder}
              className="input flex-1 min-w-0"
            />
            <button onClick={handleSaveKey} disabled={!key.trim()} className="btn-primary">Save</button>
          </div>
          <p className="text-[11px] text-[#6e7681] mt-1">
            Get a key at{' '}
            <button
              onClick={() => window.fterm.openExternal(provider.consoleUrl)}
              className="text-[#58a6ff] hover:underline"
            >
              {provider.name} console →
            </button>
          </p>
        </>
      )}
    </Section>
  )
}

function CopilotSection() {
  const { ai, setAIConfig } = useStore()
  const { testConnection, removeKey } = useAI()
  const status = ai.providerStatus['copilot']
  const [clientId, setClientId] = useState(ai.githubClientId)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'browser_open' | 'error'>('idle')
  const [savedPat, setSavedPat] = useState(false)
  const [pat, setPat] = useState('')

  useEffect(() => {
    window.fterm.keysHas('copilot').then(setSavedPat)
  }, [])

  async function startFlow() {
    if (!clientId.trim()) return
    setAIConfig({ githubClientId: clientId })
    setOauthStatus('browser_open')
    try {
      await window.fterm.githubOAuthRedirect(clientId.trim())
      setSavedPat(true)
      setOauthStatus('idle')
      testConnection('copilot')
    } catch {
      setOauthStatus('error')
    }
  }

  async function savePat() {
    if (!pat.trim()) return
    await window.fterm.keysSet('copilot', pat.trim())
    setSavedPat(true)
    setPat('')
    testConnection('copilot')
  }

  return (
    <Section title="GitHub Copilot">
      <div className="flex items-center gap-2 mb-3">
        <StatusDot connected={status?.connected} testing={status?.testing} />
        <span className="text-xs text-[#6e7681]">
          {status?.testing ? 'Testing…' : status?.connected ? 'Connected' : 'Not connected'}
        </span>
        {status?.error && <span className="text-xs text-red-400">{status.error}</span>}
      </div>

      {savedPat ? (
        <div className="flex flex-col 2xl:flex-row gap-2">
          <button onClick={() => testConnection('copilot')} className="btn-secondary">
            {status?.testing ? 'Testing…' : 'Test'}
          </button>
          <button onClick={async () => { await removeKey('copilot'); setSavedPat(false) }} className="btn-danger">
            Disconnect
          </button>
        </div>
      ) : (
        <>
          {/* Redirect flow */}
          <div className="mb-3">
            <p className="text-xs text-[#6e7681] mb-2">
              Login via browser — requires a{' '}
              <button onClick={() => window.fterm.openExternal('https://github.com/settings/developers')} className="text-[#58a6ff] hover:underline">
                GitHub OAuth App
              </button>
              {' '}with <code className="bg-[#21262d] px-1 rounded">http://localhost</code> as the callback URL.
            </p>
            <div className="flex flex-col 2xl:flex-row gap-2 mb-2">
              <input
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder="GitHub OAuth App client_id"
                className="input flex-1 min-w-0"
              />
              <button
                onClick={startFlow}
                disabled={!clientId.trim() || oauthStatus === 'browser_open'}
                className="btn-primary shrink-0"
              >
                {oauthStatus === 'browser_open' ? 'Waiting…' : 'Login with GitHub'}
              </button>
            </div>
            {oauthStatus === 'browser_open' && (
              <div className="rounded-lg bg-[#161b22] border border-[#388bfd] p-3 text-xs">
                <p className="text-[#c9d1d9]">Browser opened — authorize in GitHub, then return here.</p>
                <p className="text-[#6e7681] mt-1">This completes automatically when you approve access.</p>
              </div>
            )}
            {oauthStatus === 'error' && (
              <p className="text-xs text-red-400 mt-1">Authorization failed or was cancelled. Try again.</p>
            )}
          </div>

          {/* PAT fallback */}
          <div>
            <p className="text-xs text-[#6e7681] mb-2">Or paste a GitHub Personal Access Token:</p>
            <div className="flex flex-col 2xl:flex-row gap-2">
              <input
                type="password"
                value={pat}
                onChange={e => setPat(e.target.value)}
                placeholder="github_pat_…"
                className="input flex-1 min-w-0"
              />
              <button onClick={savePat} disabled={!pat.trim()} className="btn-primary">Save</button>
            </div>
          </div>
        </>
      )}
    </Section>
  )
}

function OllamaSection() {
  const { ai, setAIConfig } = useStore()
  const { testConnection } = useAI()
  const status = ai.providerStatus['ollama']
  const [ollamaModels, setOllamaModels] = useState<string[]>([])

  async function fetchModels() {
    try {
      const baseUrl = ai.ollamaUrl.replace('//localhost:', '//127.0.0.1:')
      const res = await fetch(`${baseUrl}/api/tags`)
      if (!res.ok) return
      const json = await res.json()
      const names: string[] = (json.models ?? []).map((m: any) => m.name)
      setOllamaModels(names)
      if (names.length && !ai.ollamaModel) setAIConfig({ ollamaModel: names[0] })
    } catch { /* unreachable */ }
  }

  useEffect(() => {
    if (status?.connected) fetchModels()
  }, [status?.connected])

  return (
    <Section title="Ollama (local)">
      <p className="text-xs text-[#6e7681] mb-2">Runs locally — no API key needed.</p>
      <div className="flex items-center gap-2 mb-3">
        <StatusDot connected={status?.connected} />
        <span className="text-xs text-[#6e7681]">{status?.connected ? 'Reachable' : 'Not detected'}</span>
        {status?.error && <span className="text-xs text-red-400">{status.error}</span>}
      </div>
      <Row label="Server URL">
        <input
          value={ai.ollamaUrl}
          onChange={e => setAIConfig({ ollamaUrl: e.target.value })}
          className="input flex-1 min-w-0"
        />
      </Row>
      {ollamaModels.length > 0 && (
        <Row label="Model">
          <select
            value={ai.ollamaModel || ollamaModels[0]}
            onChange={e => setAIConfig({ ollamaModel: e.target.value })}
            className="input flex-1 min-w-0"
          >
            {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Row>
      )}
      <button
        onClick={async () => { await testConnection('ollama'); fetchModels() }}
        className="btn-secondary mt-2"
      >
        {status?.testing ? 'Testing...' : 'Detect Ollama'}
      </button>
    </Section>
  )
}

// --- Shared UI primitives ---

function PetTab() {
  const { pet, setPetConfig, setPetState, setPetMessage } = useStore()
  const xpPct = Math.round((pet.xp / pet.maxXp) * 100)

  return (
    <div className="flex flex-col gap-5">
      <Section title="Companion settings">
        <Row label="Visible">
          <Toggle value={pet.visible} onChange={v => setPetConfig({ visible: v })} />
        </Row>

        {pet.visible && (
          <>
            <Row label="Species">
              <select
                value={pet.type}
                onChange={e => {
                  setPetConfig({ type: e.target.value as any })
                  setPetMessage(`I'm a ${e.target.value} now!`)
                  setPetState('happy')
                }}
                className="input"
              >
                <option value="cat">Cat</option>
                <option value="dog">Dog</option>
                <option value="fox">Fox</option>
                <option value="dragon">Dragon</option>
                <option value="robot">Robot</option>
                <option value="ghost">Ghost</option>
              </select>
            </Row>
            <Row label="Name">
              <input
                value={pet.name || ''}
                onChange={e => setPetConfig({ name: e.target.value })}
                className="input text-right w-48"
                placeholder="Name your pet..."
              />
            </Row>
          </>
        )}
      </Section>

      {pet.visible && (
        <Section title="Progress">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-white/70 font-medium">Level {pet.level} — {pet.name}</span>
            <span className="text-xs text-white/40 font-mono">{pet.xp} / {pet.maxXp} XP</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mb-4">
            <div
              className="h-full bg-[#58a6ff] rounded-full transition-all duration-500"
              style={{ width: `${xpPct}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { label: 'Commands', value: pet.stats?.commandsRun ?? 0 },
              { label: 'Commits', value: pet.stats?.commitsMade ?? 0 },
              { label: 'Days active', value: pet.stats?.daysActive ?? 1 },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/5 rounded p-2.5 flex flex-col gap-1">
                <span className="text-white/40 text-[10px] uppercase tracking-wide">{label}</span>
                <span className="text-white/80 font-mono text-base">{value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-5">
      <h3 className="text-sm font-semibold text-white/80 mb-4 pb-2 border-b border-white/[0.06] uppercase tracking-wider">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-white/60 shrink-0">{label}</p>
      <div className="flex-1 max-w-[55%] flex justify-end">
        {children}
      </div>
    </div>
  )
}

function Slider({ min, max, step = 1, value, onChange }: {
  min: number; max: number; step?: number; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 flex-1">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 cursor-pointer"
      />
      <span className="text-xs font-mono text-white/40 w-10 text-right shrink-0">{step < 1 ? value.toFixed(2) : value}</span>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className={`
        relative shrink-0 rounded-full transition-all duration-200 outline-none
        w-9 h-[18px] focus-visible:ring-2 focus-visible:ring-blue-400
        ${value ? 'bg-[#58a6ff] shadow-[0_0_8px_rgba(88,166,255,0.3)]' : 'bg-white/[0.12] hover:bg-white/[0.18]'}
      `}
    >
      <span
        className={`
          absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all duration-200
          ${value ? 'left-[20px]' : 'left-[2px]'}
        `}
      />
    </button>
  )
}

function StatusDot({ connected, testing }: { connected?: boolean; testing?: boolean }) {
  if (testing) return (
    <span className="relative flex w-2 h-2 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
      <span className="relative inline-flex w-2 h-2 rounded-full bg-yellow-500" />
    </span>
  )
  return (
    <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-green-500 shadow-[0_0_6px_rgba(63,185,80,0.5)]' : 'bg-[#484f58]'}`} />
  )
}






// ``` Stats tab ```````````````````

function ActivityHeatmap({ activityLog }: { activityLog: Record<string, { commands: number; errors: number; sessions: number }> }) {
  const WEEKS = 53
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build grid: columns = weeks (oldest left), rows = days (Sun top)
  const startDay = new Date(today)
  startDay.setDate(today.getDate() - (WEEKS * 7 - 1))

  const cells: Array<{ date: string; commands: number; errors: number }> = []
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(startDay)
    d.setDate(startDay.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    const act = activityLog[key]
    cells.push({ date: key, commands: act?.commands ?? 0, errors: act?.errors ?? 0 })
  }

  const maxCmds = Math.max(1, ...cells.map(c => c.commands))

  function cellColor(commands: number, errors: number): string {
    if (commands === 0 && errors === 0) return 'bg-white/5'
    if (errors > 0 && commands === 0) return 'bg-red-500/40'
    const intensity = commands / maxCmds
    if (intensity < 0.25) return 'bg-green-900/60'
    if (intensity < 0.5)  return 'bg-green-700/70'
    if (intensity < 0.75) return 'bg-green-500/80'
    return 'bg-green-400'
  }

  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const DAY_LABELS = ['S','M','T','W','T','F','S']

  // Month label positions
  const monthLabels: Array<{ col: number; label: string }> = []
  for (let w = 0; w < WEEKS; w++) {
    const cellIdx = w * 7
    const d = new Date(startDay)
    d.setDate(startDay.getDate() + cellIdx)
    if (d.getDate() <= 7) {
      monthLabels.push({ col: w, label: MONTH_LABELS[d.getMonth()] })
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Month labels */}
      <div className="flex ml-5 text-[9px] text-white/30 font-mono" style={{ gap: 2 }}>
        {Array.from({ length: WEEKS }, (_, w) => {
          const ml = monthLabels.find(m => m.col === w)
          return <div key={w} style={{ width: 10, minWidth: 10 }}>{ml ? ml.label : ''}</div>
        })}
      </div>
      <div className="flex gap-1">
        {/* Day labels */}
        <div className="flex flex-col text-[9px] text-white/30 font-mono" style={{ gap: 2 }}>
          {DAY_LABELS.map((d, i) => (
            <div key={i} style={{ width: 10, height: 10, lineHeight: '10px' }}>{i % 2 === 1 ? d : ''}</div>
          ))}
        </div>
        {/* Grid */}
        <div className="flex" style={{ gap: 2 }}>
          {Array.from({ length: WEEKS }, (_, w) => (
            <div key={w} className="flex flex-col" style={{ gap: 2 }}>
              {Array.from({ length: 7 }, (_, d) => {
                const cell = cells[w * 7 + d]
                if (!cell) return <div key={d} style={{ width: 10, height: 10 }} />
                return (
                  <div
                    key={d}
                    title={`${cell.date}: ${cell.commands} commands, ${cell.errors} errors`}
                    style={{ width: 10, height: 10, borderRadius: 2 }}
                    className={`${cellColor(cell.commands, cell.errors)} cursor-default`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 text-[9px] text-white/30 ml-5 mt-0.5">
        <span>Less</span>
        {['bg-white/5','bg-green-900/60','bg-green-700/70','bg-green-500/80','bg-green-400'].map((c,i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 2 }} className={c} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

function HourlyHistogram({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly)
  return (
    <div className="flex items-end gap-px h-12">
      {hourly.map((v, h) => (
        <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={`${h}:00 — ${v} cmds`}>
          <div
            className="w-full bg-blue-500/60 rounded-sm"
            style={{ height: `${Math.round((v / max) * 40)}px`, minHeight: v > 0 ? 2 : 0 }}
          />
          {h % 6 === 0 && <span className="text-[8px] text-white/20 font-mono">{h}</span>}
        </div>
      ))}
    </div>
  )
}

const FETCH_FIELD_LABELS: Record<string, string> = {
  hostname: 'Host', os: 'OS', shell: 'Shell', cpu: 'CPU', memory: 'Memory',
  uptime: 'Uptime', cwd: 'CWD', petLevel: 'Pet Level', aiProvider: 'AI Provider',
  currentStreak: 'Streak', commandsRun: 'Commands Run',
}

function FtermfetchConfigSection() {
  const { ftermfetchConfig, setFtermfetchConfig, setFetchFieldColor, reorderFetchField, toggleFetchField } = useStore()
  const { fields, colorMode, fieldColors } = ftermfetchConfig

  return (
    <div className="flex flex-col gap-4 p-4 bg-white/5 border border-white/10 rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white/90 text-sm">ftermfetch Layout</h3>
        <div className="flex items-center gap-1 text-[10px]">
          <button
            onClick={() => setFtermfetchConfig({ colorMode: 'theme' })}
            className={`px-2 py-0.5 rounded transition-colors ${colorMode === 'theme' ? 'bg-blue-500/30 text-blue-300' : 'text-white/40 hover:text-white/60'}`}
          >Theme</button>
          <button
            onClick={() => setFtermfetchConfig({ colorMode: 'custom' })}
            className={`px-2 py-0.5 rounded transition-colors ${colorMode === 'custom' ? 'bg-blue-500/30 text-blue-300' : 'text-white/40 hover:text-white/60'}`}
          >Custom</button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {fields.map((field, idx) => (
          <div key={field.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5">
            {/* Enable toggle */}
            <button
              onClick={() => toggleFetchField(field.id)}
              className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${field.enabled ? 'bg-blue-500/60 border-blue-500' : 'border-white/20'}`}
            >
              {field.enabled && <span className="text-[8px] text-white">✓</span>}
            </button>

            <span className={`flex-1 text-xs ${field.enabled ? 'text-white/80' : 'text-white/30'}`}>
              {FETCH_FIELD_LABELS[field.id] ?? field.id}
            </span>

            {/* Custom color picker */}
            {colorMode === 'custom' && field.enabled && (
              <input
                type="color"
                value={fieldColors[field.id] ?? '#58a6ff'}
                onChange={e => setFetchFieldColor(field.id, e.target.value)}
                className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
                title={`Color for ${FETCH_FIELD_LABELS[field.id]}`}
              />
            )}

            {/* Reorder */}
            <button
              onClick={() => reorderFetchField(field.id, 'up')}
              disabled={idx === 0}
              className="text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors"
            >▲</button>
            <button
              onClick={() => reorderFetchField(field.id, 'down')}
              disabled={idx === fields.length - 1}
              className="text-white/30 hover:text-white/60 disabled:opacity-20 transition-colors"
            >▼</button>
          </div>
        ))}
      </div>

      <p className="text-white/30 text-[10px]">Type <code className="bg-white/10 px-1 rounded">ftermfetch</code> in terminal to open the fetch card.</p>
    </div>
  )
}

function StatsTab() {
  const usage = useStore(state => state.usage)
  const terminalStats = useStore(state => state.terminalStats)
  const providers = Object.keys(usage) as AIProvider[]

  const totalCmds = Object.values(terminalStats.activityLog).reduce((s, d) => s + d.commands, 0)
  const totalErrors = terminalStats.totalErrors
  const errorRate = totalCmds > 0 ? ((totalErrors / totalCmds) * 100).toFixed(1) : '0.0'

  const topCommands = Object.entries(terminalStats.commandFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)

  const hasActivity = totalCmds > 0

  return (
    <div className="flex flex-col gap-6 w-full text-xs">

      {/* Heatmap */}
      <div className="flex flex-col gap-3 p-4 bg-white/5 border border-white/10 rounded-lg">
        <h3 className="font-semibold text-white/90 text-sm">Activity Heatmap</h3>
        <ActivityHeatmap activityLog={terminalStats.activityLog} />
      </div>

      {/* Streaks + summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 p-4 bg-white/5 border border-white/10 rounded-lg">
          <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">Current Streak</span>
          <span className="text-3xl font-bold text-green-400 font-mono">{terminalStats.currentStreak}</span>
          <span className="text-white/40">days</span>
        </div>
        <div className="flex flex-col gap-1 p-4 bg-white/5 border border-white/10 rounded-lg">
          <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">Longest Streak</span>
          <span className="text-3xl font-bold text-yellow-400 font-mono">{terminalStats.longestStreak}</span>
          <span className="text-white/40">days</span>
        </div>
        <div className="flex flex-col gap-1 p-4 bg-white/5 border border-white/10 rounded-lg">
          <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">Commands Run</span>
          <span className="text-3xl font-bold text-blue-400 font-mono">{totalCmds.toLocaleString()}</span>
          <span className="text-white/40">all time</span>
        </div>
        <div className="flex flex-col gap-1 p-4 bg-white/5 border border-white/10 rounded-lg">
          <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">Error Rate</span>
          <span className="text-3xl font-bold text-red-400 font-mono">{errorRate}%</span>
          <span className="text-white/40">{totalErrors} errors</span>
        </div>
      </div>

      {/* Busiest hours */}
      <div className="flex flex-col gap-3 p-4 bg-white/5 border border-white/10 rounded-lg">
        <h3 className="font-semibold text-white/90 text-sm">Busiest Hours</h3>
        <HourlyHistogram hourly={terminalStats.hourlyActivity} />
      </div>

      {/* Top commands */}
      {topCommands.length > 0 && (
        <div className="flex flex-col gap-3 p-4 bg-white/5 border border-white/10 rounded-lg">
          <h3 className="font-semibold text-white/90 text-sm">Most Used Commands</h3>
          <div className="flex flex-col gap-1">
            {topCommands.map(([cmd, count], i) => {
              const pct = Math.round((count / (topCommands[0][1] || 1)) * 100)
              return (
                <div key={cmd} className="flex items-center gap-2">
                  <span className="text-white/30 w-4 text-right font-mono">{i + 1}</span>
                  <span className="text-white/70 font-mono w-28 truncate">{cmd}</span>
                  <div className="flex-1 bg-white/5 rounded h-2 overflow-hidden">
                    <div className="h-full bg-blue-500/60 rounded" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-white/40 font-mono w-10 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!hasActivity && (
        <div className="text-white/40 italic p-4 bg-white/5 rounded-lg text-center">
          Run some commands to start tracking activity!
        </div>
      )}

      {/* ftermfetch config */}
      <FtermfetchConfigSection />

      {/* AI Usage */}
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold text-white/90 text-sm">AI Usage</h3>
        <p className="text-white/50 text-xs">
          Recorded locally, based on token counts from AI provider APIs.
        </p>
        {providers.map(provider => {
          const stats = usage[provider]
          if (!stats) return null
          const hasUsage = (stats.sessionInput || 0) + (stats.sessionOutput || 0) + (stats.dayInput || 0) + (stats.weekInput || 0) > 0
          if (!hasUsage) return null
          return (
            <div key={provider} className="flex flex-col gap-3 p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="font-semibold text-white/90 capitalize">{provider}</span>
                {stats.lastModel && (
                  <span className="text-white/40 text-[10px] uppercase font-medium bg-white/5 px-2 py-0.5 rounded">
                    {stats.lastModel}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-6 mt-1">
                <div className="flex flex-col gap-2">
                  <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">Current Session</span>
                  <div className="flex justify-between items-center bg-black/20 p-2 rounded">
                    <span className="text-white/60">Input</span>
                    <span className="text-blue-400 font-mono text-sm">{(stats.sessionInput || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center bg-black/20 p-2 rounded">
                    <span className="text-white/60">Output</span>
                    <span className="text-green-400 font-mono text-sm">{(stats.sessionOutput || 0).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">Historical</span>
                  <div className="flex justify-between items-center bg-black/20 p-2 rounded">
                    <span className="text-white/60">Today</span>
                    <span className="text-blue-400/80 font-mono text-sm">{((stats.dayInput || 0) + (stats.dayOutput || 0)).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center bg-black/20 p-2 rounded">
                    <span className="text-white/60">Week</span>
                    <span className="text-blue-400/80 font-mono text-sm">{((stats.weekInput || 0) + (stats.weekOutput || 0)).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {providers.every(p => {
          const s = usage[p]; return !s || (s.sessionInput||0)+(s.sessionOutput||0)+(s.dayInput||0)+(s.weekInput||0) === 0
        }) && (
          <div className="text-white/40 italic p-4 bg-white/5 rounded-lg text-center">
            No AI usage yet. Start chatting!
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Shortcuts Tab ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  'ai-sidebar':     'Toggle AI Sidebar',
  'settings':       'Open Settings',
  'new-tab':        'New Tab',
  'close-tab':      'Close Tab',
  'command-palette':'Command Palette',
  'search':         'Search Terminal',
  'next-tab':       'Next Tab',
  'prev-tab':       'Previous Tab',
  'split-h':        'Split Horizontal',
  'split-v':        'Split Vertical',
  'font-increase':  'Increase Font Size',
  'font-decrease':  'Decrease Font Size',
  'font-reset':     'Reset Font Size',
  'history-search': 'History Search',
  'pane-prev':      'Previous Pane',
  'pane-next':      'Next Pane',
}

function keyParts(binding: string): string[] {
  return binding.split('+').map(k =>
    k === 'ctrl' ? 'Ctrl' : k === 'shift' ? 'Shift' : k === 'alt' ? 'Alt' : k.length === 1 ? k.toUpperCase() : k
  )
}

function KeyBadge({ binding }: { binding: string }) {
  const parts = keyParts(binding)
  return (
    <span className="flex items-center gap-0.5">
      {parts.map((p, i) => (
        <code key={i} className="text-[11px] text-white/60 bg-white/[0.08] border border-white/[0.12] px-1.5 py-0.5 rounded font-mono leading-none">
          {p}
        </code>
      ))}
    </span>
  )
}

function ShortcutsTab() {
  const { keybindings, setKeybinding, resetKeybindings } = useStore()
  const [capturing, setCapturing] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      const parts: string[] = []
      if (e.ctrlKey) parts.push('ctrl')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')
      parts.push(e.key.toLowerCase())
      const newBinding = parts.join('+')
      const existing = Object.entries({ ...DEFAULT_KEYBINDINGS, ...keybindings })
        .find(([a, b]) => a !== capturing && b === newBinding)
      if (existing) {
        setConflict(`Conflicts with "${ACTION_LABELS[existing[0]] ?? existing[0]}"`)
        setTimeout(() => setConflict(null), 2000)
      } else if (capturing) {
        setKeybinding(capturing, newBinding)
      }
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [capturing, keybindings, setKeybinding])

  const merged = { ...DEFAULT_KEYBINDINGS, ...keybindings }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-white/40 text-[11px] uppercase tracking-wider font-semibold">Keyboard Shortcuts</span>
        <button
          onClick={() => { resetKeybindings(); setCapturing(null) }}
          className="text-[11px] text-white/40 hover:text-white/70 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
        >
          Reset to defaults
        </button>
      </div>
      {conflict && (
        <div className="text-red-400/80 text-[11px] bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">
          {conflict}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {Object.keys(DEFAULT_KEYBINDINGS).map(action => (
          <div
            key={action}
            className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-white/[0.03] group"
          >
            <span className="text-white/70 text-[13px]">{ACTION_LABELS[action] ?? action}</span>
            <div className="flex items-center gap-2">
              {capturing === action ? (
                <span className="text-[11px] text-blue-400 animate-pulse px-2 py-0.5 bg-blue-500/10 rounded">
                  press key…
                </span>
              ) : (
                <KeyBadge binding={merged[action]} />
              )}
              <button
                onClick={() => setCapturing(capturing === action ? null : action)}
                className="text-[11px] text-white/30 hover:text-white/60 opacity-0 group-hover:opacity-100 transition-all px-1.5 py-0.5 rounded hover:bg-white/[0.05]"
              >
                {capturing === action ? 'cancel' : 'edit'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Remote Tab ───────────────────────────────────────────────────────────────

function RemoteTab() {
  const { remoteTerminal, setRemoteTerminal } = useStore()
  const [port, setPort] = useState(String(remoteTerminal.port))
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [allIps, setAllIps] = useState<string[]>([])
  const [firewallOk, setFirewallOk] = useState(true)

  useEffect(() => {
    window.fterm.remoteStatus?.().then((s: any) => {
      if (s?.allIps) setAllIps(s.allIps)
    }).catch(() => {})
  }, [remoteTerminal.enabled])

  useEffect(() => {
    const unsub = window.fterm.onRemoteClientChange?.((n) => {
      setRemoteTerminal({ clients: n })
    })
    return () => unsub?.()
  }, [])

  const toggle = async () => {
    if (remoteTerminal.enabled) {
      await window.fterm.remoteStop?.()
      setRemoteTerminal({ enabled: false, clients: 0, pin: '', qr: undefined } as any)
      setQrSrc(null)
      setFirewallOk(true)
    } else {
      const p = Math.max(1024, Math.min(65535, parseInt(port) || 7681))
      const result = await window.fterm.remoteStart?.(p)
      if (result) {
        setRemoteTerminal({ enabled: true, port: p, pin: result.pin, clients: 0 })
        setQrSrc(result.qr ?? null)
        setAllIps(result.allIps ?? [result.localIp])
        setFirewallOk(result.firewallOk ?? true)
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-white/80 text-[13px] font-medium">Remote Terminal</div>
          <div className="text-white/40 text-[11px] mt-0.5">Control your terminal from a smartphone browser on the same network</div>
        </div>
        <button
          onClick={toggle}
          className={`w-10 h-6 rounded-full transition-colors relative ${remoteTerminal.enabled ? 'bg-[#3fb950]' : 'bg-white/10'}`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${remoteTerminal.enabled ? 'left-5' : 'left-1'}`} />
        </button>
      </div>

      {!remoteTerminal.enabled && (
        <Row label="Port">
          <input
            type="number"
            value={port}
            onChange={e => setPort(e.target.value)}
            min={1024}
            max={65535}
            className="input w-24"
          />
        </Row>
      )}

      {remoteTerminal.enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 items-start">
            {qrSrc && (
              <img src={qrSrc} alt="QR code" className="w-32 h-32 rounded-lg bg-white p-1" />
            )}
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex flex-col gap-1">
                <span className="text-white/40 text-[10px] uppercase tracking-wider">URL{allIps.length > 1 ? 'S' : ''}</span>
                {allIps.length ? allIps.map(ip => (
                  <code key={ip} className="text-blue-400/80 text-[12px] font-mono break-all">
                    http://{ip}:{remoteTerminal.port}
                  </code>
                )) : (
                  <code className="text-blue-400/80 text-[12px] font-mono">http://…:{remoteTerminal.port}</code>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white/40 text-[10px] uppercase tracking-wider">PIN</span>
                <div className="flex items-center gap-2">
                  <code className="text-white/80 text-[18px] font-mono tracking-[0.2em]">{remoteTerminal.pin || '----'}</code>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white/40 text-[10px] uppercase tracking-wider">Connected</span>
                <span className="text-white/60 text-[13px]">{remoteTerminal.clients} client{remoteTerminal.clients !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {!firewallOk && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 flex flex-col gap-1.5">
                <div className="text-yellow-400 text-[11px] font-medium">⚠ Firewall rule could not be added automatically</div>
                <div className="text-yellow-300/70 text-[11px]">Phone may not be able to connect. Run this command as Administrator:</div>
                <code className="text-yellow-200/60 text-[10px] font-mono break-all select-all bg-black/20 rounded px-1.5 py-1 block">
                  netsh advfirewall firewall add rule name="FTerm Remote" dir=in action=allow protocol=TCP localport={remoteTerminal.port}
                </code>
              </div>
            )}
            <div className="text-white/30 text-[11px] bg-white/[0.03] rounded p-2">
              Scan the QR or open the URL on your phone. Enter the PIN to connect.
              Test connectivity: open <span className="font-mono text-white/50">{allIps[0] ? `http://${allIps[0]}:${remoteTerminal.port}/ping` : '…'}</span> on the phone — it should show "pong".
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
