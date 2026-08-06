/**
 * Pet progression: achievements earned from real terminal activity, the coins
 * they pay out, and the cosmetics those coins buy.
 *
 * Pure data + pure functions — no store, no React — so the rules can be unit
 * tested and so the store slice stays a thin dispatcher.
 */
import type { PetConfig, TerminalStats } from '@/types'

// ─── Metrics ─────────────────────────────────────────────────────────────────

/** Everything the achievement conditions are allowed to look at. */
export interface PetMetrics {
  commandsRun: number
  commitsMade: number
  daysActive: number
  level: number
  currentStreak: number
  longestStreak: number
  totalErrors: number
  /** Commands run between 00:00 and 04:59. */
  nightCommands: number
  /** Distinct base commands the user has ever run. */
  distinctCommands: number
}

/** Flatten the pet + stats slices into the metric shape the rules consume. */
export function deriveMetrics(
  pet: Pick<PetConfig, 'level' | 'stats'>,
  stats: Pick<TerminalStats, 'currentStreak' | 'longestStreak' | 'totalErrors' | 'hourlyActivity' | 'commandFrequency'>,
): PetMetrics {
  const hourly = stats.hourlyActivity ?? []
  let nightCommands = 0
  for (let h = 0; h < 5; h++) nightCommands += hourly[h] || 0
  return {
    commandsRun: pet.stats?.commandsRun ?? 0,
    commitsMade: pet.stats?.commitsMade ?? 0,
    daysActive: pet.stats?.daysActive ?? 1,
    level: pet.level ?? 1,
    currentStreak: stats.currentStreak ?? 0,
    longestStreak: stats.longestStreak ?? 0,
    totalErrors: stats.totalErrors ?? 0,
    nightCommands,
    distinctCommands: Object.keys(stats.commandFrequency ?? {}).length,
  }
}

// ─── Achievements ────────────────────────────────────────────────────────────

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  /** Coins paid out the first time the condition holds. */
  reward: number
  /** Cosmetic this achievement puts on the shop shelf, if any. */
  unlocks?: string
  /** Progress denominator, used to draw the bar in the UI. */
  goal: number
  /** How far along the user is, clamped to `goal` by `achievementProgress`. */
  progress: (m: PetMetrics) => number
}

// `icon` is a short ASCII badge, not an emoji — it renders in the same
// monospace vocabulary as the terminal and the pet sprites.
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-steps', name: 'First Steps', description: 'Run 10 commands', icon: '>_', reward: 20, goal: 10, progress: m => m.commandsRun },
  { id: 'century', name: 'Century', description: 'Run 100 commands', icon: '100', reward: 60, goal: 100, progress: m => m.commandsRun, unlocks: 'cap' },
  { id: 'millennium', name: 'Millennium', description: 'Run 1,000 commands', icon: '1K', reward: 250, goal: 1000, progress: m => m.commandsRun, unlocks: 'crown' },
  { id: 'first-commit', name: 'Sealed It', description: 'Make a commit from the Git view', icon: '[o]', reward: 30, goal: 1, progress: m => m.commitsMade },
  { id: 'committer', name: 'Committer', description: 'Make 25 commits', icon: '[25]', reward: 120, goal: 25, progress: m => m.commitsMade, unlocks: 'scarf' },
  { id: 'centurion-commits', name: 'Maintainer', description: 'Make 100 commits', icon: '[C]', reward: 300, goal: 100, progress: m => m.commitsMade, unlocks: 'halo' },
  { id: 'streak-3', name: 'Warming Up', description: 'Code 3 days in a row', icon: '3d', reward: 40, goal: 3, progress: m => m.longestStreak },
  { id: 'streak-7', name: 'Full Week', description: 'Code 7 days in a row', icon: '7d', reward: 100, goal: 7, progress: m => m.longestStreak, unlocks: 'headphones' },
  { id: 'streak-30', name: 'Unbroken', description: 'Code 30 days in a row', icon: '30d', reward: 400, goal: 30, progress: m => m.longestStreak, unlocks: 'wizard-hat' },
  { id: 'night-owl', name: 'Night Owl', description: 'Run 50 commands between midnight and 5am', icon: '0-5', reward: 80, goal: 50, progress: m => m.nightCommands, unlocks: 'moon' },
  { id: 'polyglot', name: 'Polyglot', description: 'Use 40 different commands', icon: 'A-Z', reward: 90, goal: 40, progress: m => m.distinctCommands },
  { id: 'level-5', name: 'Growing Up', description: 'Reach level 5', icon: 'L5', reward: 50, goal: 5, progress: m => m.level },
  { id: 'level-10', name: 'Seasoned', description: 'Reach level 10', icon: 'L10', reward: 150, goal: 10, progress: m => m.level, unlocks: 'sunglasses' },
  { id: 'survivor', name: 'Survivor', description: 'Recover from 100 errors', icon: '!!', reward: 70, goal: 100, progress: m => m.totalErrors, unlocks: 'bandage' },
  { id: 'veteran', name: 'Veteran', description: 'Be active for 30 days', icon: '30+', reward: 200, goal: 30, progress: m => m.daysActive, unlocks: 'medal' },
]

const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]))

export function getAchievement(id: string): Achievement | undefined {
  return BY_ID.get(id)
}

/** Current progress toward an achievement, clamped to its goal. */
export function achievementProgress(a: Achievement, m: PetMetrics): number {
  return Math.min(a.goal, Math.max(0, a.progress(m)))
}

export function isEarned(a: Achievement, m: PetMetrics): boolean {
  return a.progress(m) >= a.goal
}

/**
 * Achievements whose condition now holds but that the pet has not been paid
 * for yet. Order follows `ACHIEVEMENTS` so payouts are deterministic.
 */
export function evaluateAchievements(m: PetMetrics, unlocked: readonly string[]): Achievement[] {
  const have = new Set(unlocked)
  return ACHIEVEMENTS.filter(a => !have.has(a.id) && isEarned(a, m))
}

export function totalReward(list: readonly Achievement[]): number {
  return list.reduce((sum, a) => sum + a.reward, 0)
}

// ─── Cosmetics ───────────────────────────────────────────────────────────────

export interface Cosmetic {
  id: string
  name: string
  /** ASCII drawn on the row above the sprite — same vocabulary as the pet art. */
  glyph: string
  price: number
  /** Achievement that must be unlocked before this appears in the shop. */
  requires?: string
}

// Deliberately ASCII, not emoji: the pet is monospace art and the cosmetic sits
// directly on top of it, so anything else looks pasted on from another app.
export const COSMETICS: Cosmetic[] = [
  { id: 'cap', name: 'Backwards Cap', glyph: '[==]', price: 50, requires: 'century' },
  { id: 'scarf', name: 'Wool Scarf', glyph: '~~~~', price: 90, requires: 'committer' },
  { id: 'headphones', name: 'Headphones', glyph: 'n--n', price: 120, requires: 'streak-7' },
  { id: 'sunglasses', name: 'Shades', glyph: '[oo]', price: 140, requires: 'level-10' },
  { id: 'bandage', name: 'Battle Scar', glyph: '-##-', price: 60, requires: 'survivor' },
  { id: 'moon', name: 'Moonlight', glyph: '~)~', price: 110, requires: 'night-owl' },
  { id: 'medal', name: 'Service Medal', glyph: '[*]', price: 180, requires: 'veteran' },
  { id: 'wizard-hat', name: 'Wizard Hat', glyph: '/*\\', price: 350, requires: 'streak-30' },
  { id: 'crown', name: 'Crown', glyph: '_W_', price: 400, requires: 'millennium' },
  { id: 'halo', name: 'Halo', glyph: '(-)', price: 500, requires: 'centurion-commits' },
  // Always on sale — gives a coin sink from the very first achievement.
  { id: 'party-hat', name: 'Party Hat', glyph: '/^\\', price: 30 },
  { id: 'flower', name: 'Flower', glyph: '-*-', price: 40 },
]

const COSMETIC_BY_ID = new Map(COSMETICS.map(c => [c.id, c]))

export function getCosmetic(id: string | null | undefined): Cosmetic | undefined {
  return id ? COSMETIC_BY_ID.get(id) : undefined
}

/** A cosmetic is on the shelf once its gating achievement (if any) is unlocked. */
export function isCosmeticAvailable(c: Cosmetic, unlockedAchievements: readonly string[]): boolean {
  return !c.requires || unlockedAchievements.includes(c.requires)
}

export type PurchaseRefusal = 'unknown' | 'owned' | 'locked' | 'insufficient'

/** `null` when the purchase is allowed, otherwise why it was refused. */
export function purchaseRefusal(
  id: string,
  coins: number,
  owned: readonly string[],
  unlockedAchievements: readonly string[],
): PurchaseRefusal | null {
  const c = COSMETIC_BY_ID.get(id)
  if (!c) return 'unknown'
  if (owned.includes(id)) return 'owned'
  if (!isCosmeticAvailable(c, unlockedAchievements)) return 'locked'
  if (coins < c.price) return 'insufficient'
  return null
}

// ─── Coin payouts for live events ────────────────────────────────────────────

/** Coins granted for things that happen in the moment, outside achievements. */
export const COIN_EVENTS = {
  commit: 15,
  push: 10,
  levelUp: 25,
} as const

export type CoinEvent = keyof typeof COIN_EVENTS
