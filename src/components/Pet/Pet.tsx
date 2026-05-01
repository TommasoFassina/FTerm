import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '@/store'
import type { PetState } from '@/types'

// ── Sprites per pet type ────────────────────────────────────────────────────────────

import { SPRITES, STATE_COLORS, pickDialogue } from './PetData'

export default function Pet() {
  const pet = useStore(s => s.pet)
  const petState = useStore(s => s.petState)
  const lastActivity = useStore(s => s.lastActivity)
  const petMessage = useStore(s => s.petMessage)
  const ai = useStore(s => s.ai)
  const setPetMessage = useStore(s => s.setPetMessage)
  const setPetState = useStore(s => s.setPetState)
  const [frameIdx, setFrameIdx] = useState(0)
  const [bubble, setBubble] = useState<string | null>(null)
  const [prevState, setPrevState] = useState<PetState>(petState)
  const [shaking, setShaking] = useState(false)
  const lastInteractionRef = useRef(Date.now())
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressStateBubbleRef = useRef(false)
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sprites = SPRITES[pet.type]

  // Animate sprite frames
  useEffect(() => {
    const frames = sprites[petState] || sprites['idle']
    setFrameIdx(0)
    const interval = setInterval(() => {
      setFrameIdx(i => (i + 1) % frames.length)
    }, petState === 'sleeping' ? 5000 : petState === 'celebrating' ? 1500 : 3000)
    return () => clearInterval(interval)
  }, [petState, pet.type, sprites])

  // Track last interaction time when state changes away from idle
  useEffect(() => {
    if (petState !== 'idle') lastInteractionRef.current = Date.now()
  }, [petState])

  // Idle micro-animations (rare glance — 4% chance every 10s)
  useEffect(() => {
    if (petState !== 'idle') return
    const interval = setInterval(() => {
      if (Math.random() < 0.04) {
        setPetState(Math.random() > 0.5 ? 'worried' : 'working')
        setTimeout(() => {
          if (useStore.getState().petState !== 'idle') setPetState('idle')
        }, 2000)
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [petState, setPetState])

  // Idle chatter — show a random idle message every ~90s (30% chance each tick)
  useEffect(() => {
    if (petState !== 'idle') return
    const interval = setInterval(() => {
      if (Math.random() < 0.30 && !useStore.getState().petMessage && !bubbleTimerRef.current) {
        const text = pickDialogue(pet.type, 'idle', 'default')
        setBubble(text)
        bubbleTimerRef.current = setTimeout(() => { setBubble(null); bubbleTimerRef.current = null }, 4000)
      }
    }, 90_000)
    return () => clearInterval(interval)
  }, [petState, pet.type])

  // Mood decay — pet gets sad after 10min idle, sleeping after 20min
  useEffect(() => {
    const interval = setInterval(() => {
      const state = useStore.getState().petState
      if (state !== 'idle' && state !== 'sad' && state !== 'sleeping' && state !== 'worried') return
      const idleMs = Date.now() - lastInteractionRef.current
      const idleMin = idleMs / 60_000
      if (idleMin >= 20 && state !== 'sleeping') {
        setPetState('sleeping')
        useStore.getState().setPetMessage('zzz...')
      } else if (idleMin >= 10 && state === 'idle') {
        setPetState('sad')
        useStore.getState().setPetMessage('I miss you...')
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [setPetState])

  // Easter egg: react when user shakes the window; revert when still
  useEffect(() => {
    const offShake = window.fterm.onPetShake?.(() => {
      lastInteractionRef.current = Date.now()
      suppressStateBubbleRef.current = true
      setShaking(true)
      const text = pickDialogue(pet.type, 'worried', 'shake')
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      setBubble(text)
      bubbleTimerRef.current = setTimeout(() => { setBubble(null); bubbleTimerRef.current = null }, 3500)
      setPetState('worried')
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
    })
    const offStill = window.fterm.onPetStill?.(() => {
      setShaking(false)
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
      if (useStore.getState().petState === 'worried') setPetState('idle')
    })
    return () => { offShake?.(); offStill?.() }
  }, [pet.type, setPetState])

  // Easter egg: Konami code → super celebration
  useEffect(() => {
    const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
    let idx = 0
    let resetTimer: ReturnType<typeof setTimeout> | null = null
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const expected = sequence[idx]
      const key = expected.length === 1 ? e.key.toLowerCase() : e.key
      if (key === expected) {
        idx++
        if (resetTimer) clearTimeout(resetTimer)
        resetTimer = setTimeout(() => { idx = 0 }, 1500)
        if (idx === sequence.length) {
          idx = 0
          lastInteractionRef.current = Date.now()
          suppressStateBubbleRef.current = true
          if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
          setBubble('★ KONAMI! 30 LIVES UNLOCKED ★')
          bubbleTimerRef.current = setTimeout(() => { setBubble(null); bubbleTimerRef.current = null }, 5000)
          setPetState('celebrating')
          setTimeout(() => {
            if (useStore.getState().petState === 'celebrating') setPetState('idle')
          }, 5000)
        }
      } else {
        idx = key === sequence[0] ? 1 : 0
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (resetTimer) clearTimeout(resetTimer) }
  }, [setPetState])

  // Single entry-point for all bubble display — cancels any in-flight timer
  const showBubble = useCallback((text: string, onDone?: () => void) => {
    if (!text || text.trim() === '') return
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    setBubble(text)
    bubbleTimerRef.current = setTimeout(() => {
      setBubble(null)
      bubbleTimerRef.current = null
      onDone?.()
    }, 4000)
  }, [])

  // Handle explicit pet messages (from store) — only re-run when the message itself changes
  useEffect(() => {
    if (petMessage) {
      showBubble(petMessage, () => setPetMessage(null))
    }
  }, [petMessage])

  // Handle general state transitions — skip if petMessage or direct click is driving the bubble
  useEffect(() => {
    if (petState !== prevState) {
      setPrevState(petState)
      if (suppressStateBubbleRef.current) {
        suppressStateBubbleRef.current = false
        return
      }
      if (!useStore.getState().petMessage) {
        const text = pickDialogue(pet.type, petState, lastActivity)
        if (petState !== 'idle') showBubble(text)
      }
    }
  }, [petState, lastActivity])

  if (!pet.visible) return null

  const sprite = (sprites[petState] || sprites['idle'])[frameIdx] || sprites['idle'][0]
  const color = STATE_COLORS[petState] || STATE_COLORS['idle']

  const handlePetting = () => {
    lastInteractionRef.current = Date.now()
    suppressStateBubbleRef.current = true
    showBubble(pickDialogue(pet.type, 'happy', 'default'))
    setPetState('happy')
    setTimeout(() => {
      if (useStore.getState().petState === 'happy') setPetState('idle')
    }, 3000)
  }

  return (
    <div
      id="fterm-pet-overlay"
      className="fixed bottom-12 flex flex-col items-end gap-1 z-50 pointer-events-none select-none transition-all duration-300 ease-out"
      style={{ right: ai.sidebarOpen ? 'calc(380px + 1.5rem)' : '1.5rem' }}
    >
      {/* Speech bubble */}
      <AnimatePresence>
        {bubble && bubble.trim() !== '' && (
          <motion.div
            key={bubble}
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.92 }}
            transition={{ duration: 0.15 }}
            id="fterm-pet-bubble"
            className="relative bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-2 text-[11px] text-[#c9d1d9] max-w-[200px] text-right shadow-lg leading-snug"
          >
            {bubble}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pet name */}
      <div className="text-[10px] text-[#484f58] text-right mr-0.5" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}>{pet.name}</div>

      {/* Pet sprite */}
      <motion.div
        animate={
          shaking
            ? { x: [-6, 6, -5, 5, -3, 3, 0], rotate: [-8, 8, -6, 6, 0] }
            : petState === 'celebrating'
              ? { x: 0, y: [0, -10, 0], rotate: [-6, 6, -6, 0] }
              : petState === 'happy'
                ? { x: 0, rotate: 0, y: [0, -4, 0] }
                : petState === 'sleeping'
                  ? { x: 0, rotate: 0, y: 0, opacity: [1, 0.5, 1] }
                  : petState === 'worried'
                    ? { rotate: 0, y: 0, x: [-1, 1, -1, 0] }
                    : { x: 0, y: 0, rotate: 0, opacity: 1 }
        }
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        transition={
          shaking
            ? { repeat: Infinity, duration: 0.25 }
            : petState === 'celebrating'
              ? { repeat: Infinity, duration: 0.4 }
              : petState === 'worried'
                ? { repeat: Infinity, duration: 0.3 }
              : petState === 'happy'
                ? { repeat: Infinity, duration: 0.6 }
              : petState === 'sleeping'
                ? { repeat: Infinity, duration: 2 }
              : { duration: 0.25 }
        }
        className={`font-mono text-[11px] leading-tight whitespace-pre ${color} cursor-pointer pointer-events-auto`}
        style={{ filter: 'drop-shadow(0 0 6px rgba(0,0,0,0.9)) drop-shadow(0 1px 3px rgba(0,0,0,0.8))' }}
        title={`${pet.name} — Click to pet!`}
        onClick={handlePetting}
      >
        {sprite}
      </motion.div>
    </div>
  )
}

