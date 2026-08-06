import { useEffect } from 'react'
import { useStore } from '@/store'
import { motion } from 'motion/react'
import { Zap, Shield, Sparkles } from 'lucide-react'
import { SPRITES, STATE_COLORS } from '@/components/Pet/PetData'
import {
    ACHIEVEMENTS, COSMETICS, deriveMetrics, achievementProgress,
    purchaseRefusal, getAchievement, getCosmetic,
} from '@/utils/petAchievements'

export default function PetView() {
    const DEFAULT_NAMES: Record<string, string> = {
        cat: 'Void', dog: 'Buddy', dragon: 'Ember', robot: 'R2', ghost: 'Boo', fox: 'Foxy',
    }
    const { pet, petProgress, setPetConfig } = useStore()
    const equipped = getCosmetic(pet.equippedCosmetic)

    // Calculate real XP progress
    const xpPercentage = Math.round((pet.xp / pet.maxXp) * 100)

    return (
        <motion.div
            key="pet"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col h-full w-full max-w-5xl mx-auto p-4 sm:p-6 overflow-y-auto"
        >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8 shrink-0">
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold text-white mb-1 sm:mb-2">Terminal Companion</h1>
                    <p className="text-xs sm:text-sm text-[#8b949e]">Manage your virtual pet, view stats, and swap out styles.</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <button
                        onClick={() => setPetConfig({ visible: !pet.visible })}
                        className={`px-4 py-2 rounded font-medium text-sm transition-colors ${pet.visible
                            ? 'bg-white/10 text-white hover:bg-white/20'
                            : 'bg-[#58a6ff] text-black hover:bg-[#79b8ff]'
                            }`}
                    >
                        {pet.visible ? 'Hide Pet' : 'Summon Pet'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">

                {/* Left Column: Stats & XP */}
                <div className="md:col-span-1 flex flex-col gap-6">
                    <div className="p-6 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md flex flex-col items-center justify-center text-center">
                        <div className="w-24 h-24 rounded-full bg-white/5 border-2 border-white/20 flex items-center justify-center mb-4">
                            {/* Same anchoring as the live overlay: centred on the
                                sprite's width, exactly one line above it. */}
                            <pre className={`relative font-mono text-[9px] leading-tight select-none ${STATE_COLORS['idle']}`}>
                                {equipped && (
                                    <span
                                        className="absolute left-1/2 bottom-full block leading-tight"
                                        style={{ transform: 'translateX(-50%)' }}
                                        title={equipped.name}
                                    >
                                        {equipped.glyph}
                                    </span>
                                )}
                                {SPRITES[pet.type]?.idle?.[0]}
                            </pre>
                        </div>
                        <input
                            value={pet.name}
                            onChange={(e) => setPetConfig({ name: e.target.value })}
                            className="bg-transparent text-xl font-bold text-white text-center border-b border-transparent hover:border-white/20 focus:border-[#58a6ff] outline-none transition-colors mb-1 w-full"
                        />
                        <p className="text-xs text-[#8b949e] uppercase tracking-wider font-semibold mb-6">Level {pet.level} {pet.type}</p>

                        <div className="w-full text-left">
                            <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-[#8b949e]">XP Progress</span>
                                <span className="text-white">{pet.xp} / {pet.maxXp} XP</span>
                            </div>
                            <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                                <div className="h-full bg-[#58a6ff] rounded-full" style={{ width: `${xpPercentage}%` }} />
                            </div>
                            <p className="text-[10px] text-[#8b949e] mt-2 text-center">Reach {pet.maxXp} XP to Level {pet.level + 1}</p>
                        </div>
                    </div>
                </div>

                {/* Right Column: Pet Configuration & Skills */}
                <div className="md:col-span-2 flex flex-col gap-6">
                    <div className="p-6 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md">
                        <h3 className="text-white font-medium mb-4 flex items-center justify-between">
                            Stats
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Stats */}
                            <div className="flex items-start gap-4 p-4 rounded-lg bg-white/5 border border-white/5">
                                <div className="p-2 rounded bg-white/10 text-[#58a6ff]">
                                    <Sparkles size={16} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-white flex gap-2 items-center">
                                        Commands Run
                                    </h4>
                                    <p className="text-xs text-[#8b949e] mt-1">{pet.stats?.commandsRun || 0} terminal commands</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 p-4 rounded-lg bg-white/5 border border-white/5">
                                <div className="p-2 rounded bg-white/10 text-[#58a6ff]">
                                    <Zap size={16} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-white flex gap-2 items-center">
                                        Commits Pushed
                                    </h4>
                                    <p className="text-xs text-[#8b949e] mt-1">{pet.stats?.commitsMade || 0} commits</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 p-4 rounded-lg bg-white/5 border border-white/5">
                                <div className="p-2 rounded bg-white/10 text-[#58a6ff]">
                                    <Shield size={16} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-white flex gap-2 items-center">
                                        Days Active
                                    </h4>
                                    <p className="text-xs text-[#8b949e] mt-1">{pet.stats?.daysActive || 1} days</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md">
                        <h3 className="text-white font-medium mb-4">Species</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {(['cat', 'dog', 'dragon', 'robot', 'ghost', 'fox'] as const).map(type => {
                                const progress = type === pet.type
                                    ? { level: pet.level, xp: pet.xp, maxXp: pet.maxXp, name: pet.name }
                                    : petProgress[type] ?? { level: 1, xp: 0, maxXp: 100, name: DEFAULT_NAMES[type] ?? type }
                                return (
                                <button
                                    key={type}
                                    onClick={() => setPetConfig({ type })}
                                    className={`p-4 rounded-lg border flex flex-col items-center gap-2 transition-all ${pet.type === type
                                        ? 'bg-[#58a6ff]/10 border-[#58a6ff] text-white'
                                        : 'bg-white/5 border-transparent text-[#8b949e] hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    <pre className={`font-mono text-[7px] leading-tight select-none ${pet.type === type ? STATE_COLORS['idle'] : 'text-[#8b949e]'}`}>{SPRITES[type]?.idle?.[0]}</pre>
                                    <span className="text-xs font-medium">{progress.name}</span>
                                    <span className="text-[10px] text-[#8b949e]">Lv.{progress.level}</span>
                                </button>
                                )
                            })}
                        </div>
                    </div>
                </div>

            </div>

            <AchievementsPanel />
            <CosmeticsShop />
        </motion.div>
    )
}

// ─── Achievements ────────────────────────────────────────────────────────────

function AchievementsPanel() {
    const { pet, terminalStats, checkPetAchievements } = useStore()
    const metrics = deriveMetrics(pet, terminalStats)
    const unlocked = pet.achievements ?? []

    // Opening the panel is also a chance to pay out anything already earned —
    // otherwise a full progress bar with no coins looks like a bug.
    useEffect(() => { checkPetAchievements() }, [checkPetAchievements])

    // Earned first, then whatever is closest to completion — the next goal is
    // the useful thing to show, not the alphabetical one.
    const ordered = [...ACHIEVEMENTS].sort((a, b) => {
        const ea = unlocked.includes(a.id) ? 1 : 0
        const eb = unlocked.includes(b.id) ? 1 : 0
        if (ea !== eb) return eb - ea
        return achievementProgress(b, metrics) / b.goal - achievementProgress(a, metrics) / a.goal
    })

    return (
        <div className="mt-6 p-6 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md">
            <h3 className="text-white font-medium mb-1 flex items-center justify-between">
                <span>Achievements</span>
                <span className="text-xs text-[#8b949e] font-normal">{unlocked.length} / {ACHIEVEMENTS.length}</span>
            </h3>
            <p className="text-xs text-[#8b949e] mb-4">Earned from what you actually do in the terminal. Each one pays coins.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ordered.map(a => {
                    const done = unlocked.includes(a.id)
                    const value = achievementProgress(a, metrics)
                    const pct = Math.round((value / a.goal) * 100)
                    return (
                        <div
                            key={a.id}
                            className={`p-3 rounded-lg border transition-colors ${done
                                ? 'bg-[#f0c040]/10 border-[#f0c040]/30'
                                : 'bg-white/5 border-white/5'}`}
                        >
                            <div className="flex items-start gap-2.5">
                                <span
                                    className={`font-mono text-[11px] leading-none px-1.5 py-1 rounded border shrink-0 ${done
                                        ? 'border-[#f0c040]/40 text-[#f0c040]'
                                        : 'border-white/10 text-white/30'}`}
                                >
                                    {a.icon}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <h4 className={`text-sm font-semibold truncate ${done ? 'text-white' : 'text-white/60'}`}>{a.name}</h4>
                                        <span className={`text-[10px] shrink-0 whitespace-nowrap ${done ? 'text-[#f0c040]' : 'text-[#8b949e]'}`}>+{a.reward} coins</span>
                                    </div>
                                    <p className="text-[11px] text-[#8b949e] mt-0.5">{a.description}</p>
                                    {!done && (
                                        <>
                                            <div className="w-full h-1 bg-black/50 rounded-full overflow-hidden mt-2">
                                                <div className="h-full bg-[#58a6ff] rounded-full" style={{ width: `${pct}%` }} />
                                            </div>
                                            <p className="text-[10px] text-[#484f58] mt-1">{value.toLocaleString()} / {a.goal.toLocaleString()}</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Cosmetics shop ──────────────────────────────────────────────────────────

const REFUSAL_LABEL: Record<string, string> = {
    owned: 'Owned',
    locked: 'Locked',
    insufficient: 'Not enough coins',
    unknown: 'Unavailable',
}

function CosmeticsShop() {
    const { pet, buyCosmetic, equipCosmetic } = useStore()
    const coins = pet.coins ?? 0
    const owned = pet.ownedCosmetics ?? []
    const unlockedAchievements = pet.achievements ?? []

    return (
        <div className="mt-6 mb-6 p-6 rounded-xl bg-black/40 border border-white/10 backdrop-blur-md">
            <h3 className="text-white font-medium mb-1 flex items-center justify-between">
                <span>Wardrobe</span>
                <span className="text-sm text-[#f0c040] font-mono">{coins.toLocaleString()} coins</span>
            </h3>
            <p className="text-xs text-[#8b949e] mb-4">
                Spend coins on something for {pet.name} to wear. Locked items need their achievement first.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {/* Bare-headed option, so equipping is reversible */}
                <button
                    onClick={() => equipCosmetic(null)}
                    className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${!pet.equippedCosmetic
                        ? 'bg-[#58a6ff]/10 border-[#58a6ff] text-white'
                        : 'bg-white/5 border-transparent text-[#8b949e] hover:bg-white/10'}`}
                >
                    <span className="font-mono text-sm leading-none opacity-40">--</span>
                    <span className="text-xs font-medium">None</span>
                    <span className="text-[10px] text-[#484f58]">{!pet.equippedCosmetic ? 'Worn' : 'Take off'}</span>
                </button>

                {COSMETICS.map(c => {
                    const isOwned = owned.includes(c.id)
                    const worn = pet.equippedCosmetic === c.id
                    const refusal = purchaseRefusal(c.id, coins, owned, unlockedAchievements)
                    const gate = getAchievement(c.requires ?? '')
                    const locked = refusal === 'locked'
                    return (
                        <button
                            key={c.id}
                            disabled={!isOwned && !!refusal}
                            onClick={() => (isOwned ? equipCosmetic(worn ? null : c.id) : buyCosmetic(c.id))}
                            title={locked ? `Unlocks with “${gate?.name ?? c.requires}”` : c.name}
                            className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 transition-all ${worn
                                ? 'bg-[#58a6ff]/10 border-[#58a6ff] text-white'
                                : isOwned
                                    ? 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'
                                    : refusal
                                        ? 'bg-white/[0.02] border-transparent text-[#484f58] cursor-not-allowed'
                                        : 'bg-[#f0c040]/10 border-[#f0c040]/30 text-white hover:bg-[#f0c040]/20'}`}
                        >
                            <span className={`font-mono text-sm leading-none whitespace-pre ${isOwned ? '' : 'opacity-40'}`}>{c.glyph}</span>
                            <span className="text-xs font-medium text-center leading-tight">{c.name}</span>
                            <span className="text-[10px] text-center leading-tight">
                                {isOwned
                                    ? (worn ? 'Worn' : 'Wear')
                                    : locked
                                        ? `Locked · ${gate?.name ?? ''}`
                                        : refusal
                                            ? REFUSAL_LABEL[refusal]
                                            : `Buy · ${c.price} coins`}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
