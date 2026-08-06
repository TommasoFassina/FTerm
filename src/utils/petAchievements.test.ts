import { describe, it, expect } from 'vitest'
import {
  ACHIEVEMENTS,
  COSMETICS,
  deriveMetrics,
  evaluateAchievements,
  achievementProgress,
  isEarned,
  totalReward,
  isCosmeticAvailable,
  purchaseRefusal,
  getAchievement,
  getCosmetic,
  type PetMetrics,
} from './petAchievements'

const metrics = (over: Partial<PetMetrics> = {}): PetMetrics => ({
  commandsRun: 0, commitsMade: 0, daysActive: 1, level: 1,
  currentStreak: 0, longestStreak: 0, totalErrors: 0,
  nightCommands: 0, distinctCommands: 0,
  ...over,
})

describe('deriveMetrics', () => {
  it('flattens the pet and stats slices', () => {
    const m = deriveMetrics(
      { level: 4, stats: { commandsRun: 120, commitsMade: 7, daysActive: 9 } },
      {
        currentStreak: 3, longestStreak: 8, totalErrors: 12,
        hourlyActivity: Array.from({ length: 24 }, (_, h) => h),
        commandFrequency: { git: 5, ls: 2, npm: 1 },
      },
    )
    expect(m.commandsRun).toBe(120)
    expect(m.commitsMade).toBe(7)
    expect(m.level).toBe(4)
    expect(m.longestStreak).toBe(8)
    expect(m.distinctCommands).toBe(3)
    expect(m.nightCommands).toBe(0 + 1 + 2 + 3 + 4)   // hours 0–4 only
  })

  it('survives missing/undefined sub-fields', () => {
    const m = deriveMetrics(
      { level: 1, stats: {} },
      { currentStreak: 0, longestStreak: 0, totalErrors: 0, hourlyActivity: [], commandFrequency: {} },
    )
    expect(m).toEqual(metrics())
  })
})

describe('achievement definitions', () => {
  it('has unique ids and positive goals/rewards', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACHIEVEMENTS) {
      expect(a.goal).toBeGreaterThan(0)
      expect(a.reward).toBeGreaterThan(0)
    }
  })

  it('only unlocks cosmetics that exist, and each at most once', () => {
    const unlocks = ACHIEVEMENTS.map(a => a.unlocks).filter(Boolean) as string[]
    expect(new Set(unlocks).size).toBe(unlocks.length)
    for (const id of unlocks) expect(getCosmetic(id)).toBeDefined()
  })

  it('keeps cosmetic gates pointing at real achievements', () => {
    for (const c of COSMETICS) {
      if (c.requires) expect(getAchievement(c.requires)).toBeDefined()
      expect(c.price).toBeGreaterThan(0)
    }
    const ids = COSMETICS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('evaluateAchievements', () => {
  it('returns nothing for a fresh pet', () => {
    expect(evaluateAchievements(metrics(), [])).toEqual([])
  })

  it('returns every newly satisfied achievement', () => {
    const earned = evaluateAchievements(metrics({ commandsRun: 100 }), [])
    expect(earned.map(a => a.id)).toEqual(['first-steps', 'century'])
  })

  it('never pays twice for the same achievement', () => {
    const m = metrics({ commandsRun: 100 })
    const earned = evaluateAchievements(m, ['first-steps', 'century'])
    expect(earned).toEqual([])
  })

  it('uses the longest streak, so a broken streak keeps the badge', () => {
    const m = metrics({ currentStreak: 0, longestStreak: 7 })
    expect(evaluateAchievements(m, []).map(a => a.id)).toContain('streak-7')
  })

  it('sums rewards deterministically', () => {
    const earned = evaluateAchievements(metrics({ commandsRun: 1000 }), [])
    expect(totalReward(earned)).toBe(20 + 60 + 250)
  })
})

describe('progress reporting', () => {
  it('clamps to the goal and never goes negative', () => {
    const a = getAchievement('century')!
    expect(achievementProgress(a, metrics({ commandsRun: 5000 }))).toBe(100)
    expect(achievementProgress(a, metrics({ commandsRun: 40 }))).toBe(40)
    expect(achievementProgress(a, metrics({ commandsRun: -5 }))).toBe(0)
  })

  it('marks earned exactly at the goal', () => {
    const a = getAchievement('level-5')!
    expect(isEarned(a, metrics({ level: 4 }))).toBe(false)
    expect(isEarned(a, metrics({ level: 5 }))).toBe(true)
  })
})

describe('shop rules', () => {
  it('hides gated cosmetics until their achievement lands', () => {
    const crown = getCosmetic('crown')!
    expect(isCosmeticAvailable(crown, [])).toBe(false)
    expect(isCosmeticAvailable(crown, ['millennium'])).toBe(true)
  })

  it('always offers the ungated cosmetics', () => {
    expect(isCosmeticAvailable(getCosmetic('party-hat')!, [])).toBe(true)
  })

  it('explains each refusal', () => {
    expect(purchaseRefusal('nope', 999, [], [])).toBe('unknown')
    expect(purchaseRefusal('party-hat', 999, ['party-hat'], [])).toBe('owned')
    expect(purchaseRefusal('crown', 999, [], [])).toBe('locked')
    expect(purchaseRefusal('crown', 10, [], ['millennium'])).toBe('insufficient')
  })

  it('allows a funded, unlocked, unowned purchase', () => {
    expect(purchaseRefusal('crown', 400, [], ['millennium'])).toBeNull()
    expect(purchaseRefusal('party-hat', 30, [], [])).toBeNull()   // exact price is enough
  })
})
