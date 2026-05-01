import { useStore } from '@/store'
import { motion } from 'motion/react'
import { Zap, Shield, Sparkles } from 'lucide-react'
import { SPRITES, STATE_COLORS } from '@/components/Pet/PetData'

export default function PetView() {
    const DEFAULT_NAMES: Record<string, string> = {
        cat: 'Void', dog: 'Buddy', dragon: 'Ember', robot: 'R2', ghost: 'Boo', fox: 'Foxy',
    }
    const { pet, petProgress, setPetConfig } = useStore()

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
                            <pre className={`font-mono text-[9px] leading-tight select-none ${STATE_COLORS['idle']}`}>{SPRITES[pet.type]?.idle?.[0]}</pre>
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
        </motion.div>
    )
}
