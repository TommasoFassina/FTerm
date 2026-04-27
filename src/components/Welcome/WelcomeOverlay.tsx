import { motion } from 'motion/react'
import { useStore } from '@/store'

const FEATURES = [
  { icon: '⌨️', title: 'Real terminal', desc: 'Full PTY shell — bash, PowerShell, zsh, anything.' },
  { icon: '🤖', title: 'AI sidebar', desc: 'Chat, autocomplete, error fix. Press Ctrl+Shift+A to open.' },
  { icon: '📦', title: 'Widgets', desc: 'Type sys-mon, explore, docker-dash, ping, weather and more.' },
  { icon: '🐾', title: 'Pet companion', desc: 'Your ASCII tamagotchi reacts to what you do in the terminal.' },
  { icon: '🔌', title: 'Plugins', desc: 'Write custom JS plugins that hook into terminal output.' },
  { icon: '📡', title: 'Remote terminal', desc: 'Control your shell from a phone via QR code.' },
]

export default function WelcomeOverlay() {
  const { setSettings, setActiveView } = useStore()

  function dismiss() {
    setSettings({ hasSeenWelcome: true })
  }

  function goToAI() {
    setSettings({ hasSeenWelcome: true, activeSettingsTab: 'ai' })
    setActiveView('settings')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={dismiss}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={e => e.stopPropagation()}
        className="bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-4 text-center">
          <div className="text-3xl mb-3">⚡</div>
          <h1 className="text-xl font-bold text-white mb-1">Welcome to FTerm</h1>
          <p className="text-sm text-white/40">AI-powered terminal with a tamagotchi companion</p>
        </div>

        {/* Feature grid */}
        <div className="px-6 pb-4 grid grid-cols-2 gap-2">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
              <div className="text-lg mb-1">{f.icon}</div>
              <div className="text-[13px] font-semibold text-white/80 mb-0.5">{f.title}</div>
              <div className="text-[11px] text-white/40 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={goToAI}
            className="flex-1 py-2.5 rounded-lg bg-[#58a6ff] hover:bg-[#79b8ff] text-black font-semibold text-sm transition-colors"
          >
            Connect AI provider
          </button>
          <button
            onClick={dismiss}
            className="flex-1 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/70 text-sm transition-colors"
          >
            Start exploring
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
