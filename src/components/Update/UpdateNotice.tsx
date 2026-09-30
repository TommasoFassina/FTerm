import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download, X } from 'lucide-react'
import { useStore, IS_DETACHED } from '@/store'
import { isCheckDue } from '@/utils/updateCheck'

/** Delay before the startup check, so it never competes with shell spawn. */
const STARTUP_DELAY_MS = 8000

/**
 * "FTerm x.y.z is available" — checks GitHub once a day and links to the
 * release page. It never downloads or installs anything (see updateCheck.ts).
 */
export default function UpdateNotice() {
  const update = useStore(s => s.availableUpdate)
  const dismissed = useStore(s => s.settings.dismissedUpdateVersion)
  const setSettings = useStore(s => s.setSettings)

  useEffect(() => {
    if (IS_DETACHED) return // torn-off windows leave this to the main one
    const timer = setTimeout(async () => {
      const { settings, setAvailableUpdate } = useStore.getState()
      if (settings.checkForUpdates === false || !isCheckDue(settings.lastUpdateCheck, Date.now())) return
      const info = await window.fterm.checkForUpdate?.().catch(() => null)
      useStore.getState().setSettings({ lastUpdateCheck: Date.now() })
      if (info?.newer) setAvailableUpdate(info)
    }, STARTUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  const show = !!update?.newer && update.latest !== dismissed

  return (
    <AnimatePresence>
      {show && update && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="fixed top-12 right-4 z-40 flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg border border-white/10 shadow-xl text-[12px]"
          style={{ background: 'rgba(17, 24, 39, 0.92)', backdropFilter: 'blur(16px)' }}
          role="status"
        >
          <Download size={14} className="text-[#58a6ff] shrink-0" />
          <span className="text-white/80">
            FTerm <b className="text-white">{update.latest}</b> is available
            <span className="text-white/40"> · you have {update.current}</span>
          </span>
          <button
            onClick={() => window.fterm.openExternal(update.url || 'https://github.com/TommasoFassina/FTerm/releases')}
            className="px-2 py-0.5 rounded-md bg-[#58a6ff]/20 border border-[#58a6ff]/40 text-[#79b8ff] hover:bg-[#58a6ff]/30 transition-colors"
          >
            Download
          </button>
          <button
            onClick={() => setSettings({ dismissedUpdateVersion: update.latest })}
            className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Dismiss"
            title="Don't remind me about this version"
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
