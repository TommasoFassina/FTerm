import {
    Terminal as TerminalIcon,
    Layout,
    Palette,
    Blocks,
    Sparkles,
    Settings,
    GitBranch,
    Cat
} from 'lucide-react';
import { motion } from 'motion/react';
import { useStore, useActiveTheme } from '@/store';

function SidebarIcon({ icon, label, active, onClick, accent, special = false, isRight = false }: any) {
    return (
        <button
            onClick={onClick}
            className={`relative group w-full flex items-center py-2 transition-all duration-200 ${special ? 'text-yellow-400 hover:text-yellow-300' : ''}`}
        >
            <div className={`mx-auto p-2 rounded-lg transition-all duration-200 flex items-center justify-center ${active
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white hover:bg-white/5'
                }`}
                style={active ? { boxShadow: `0 0 12px ${accent}25` } : undefined}
            >
                {icon}
            </div>

            {active && (
                <motion.div
                    layoutId={special ? 'sidebarIndicatorSpecial' : 'sidebarIndicator'}
                    className={`absolute ${isRight ? 'right-0' : 'left-0'} w-[3px] h-5 rounded-full`}
                    style={{ backgroundColor: accent, top: '50%', marginTop: '-10px' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
            )}

            <div className={`absolute ${isRight ? 'right-14 group-hover:-translate-x-1' : 'left-14 group-hover:translate-x-1'} top-1/2 -translate-y-1/2 px-2.5 py-1 bg-black/90 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all whitespace-nowrap z-50 shadow-lg`}>
                {label}
            </div>
        </button>
    );
}

export default function Sidebar() {
    const activeView = useStore(s => s.activeView)
    const ai = useStore(s => s.ai)
    const settings = useStore(s => s.settings)
    const setActiveView = useStore(s => s.setActiveView)
    const setAIConfig = useStore(s => s.setAIConfig)
    const theme = useActiveTheme();
    const accent = theme.blue || '#58a6ff';
    const isRight = settings.layout?.navSidebarPosition === 'right';

    return (
        <div className={`w-12 h-full flex flex-col items-center py-3 gap-1 ${isRight ? 'border-l' : 'border-r'} border-white/5 z-40`}>
            <SidebarIcon icon={<TerminalIcon size={18} />} label="Terminal" active={activeView === 'terminal'} onClick={() => setActiveView('terminal')} accent={accent} isRight={isRight} />
            <SidebarIcon icon={<Layout size={18} />} label="Profiles" active={activeView === 'profiles'} onClick={() => setActiveView('profiles')} accent={accent} isRight={isRight} />
            <SidebarIcon icon={<Palette size={18} />} label="Themes" active={activeView === 'themes'} onClick={() => setActiveView('themes')} accent={accent} isRight={isRight} />
            <SidebarIcon icon={<Blocks size={18} />} label="Plugins" active={activeView === 'plugins'} onClick={() => setActiveView('plugins')} accent={accent} isRight={isRight} />
            <SidebarIcon icon={<GitBranch size={18} />} label="Source Control" active={activeView === 'git'} onClick={() => setActiveView('git')} accent={accent} isRight={isRight} />
            <SidebarIcon icon={<Cat size={18} />} label="Companion" active={activeView === 'pet'} onClick={() => setActiveView('pet')} accent={accent} isRight={isRight} />

            <div className="flex-1" />

            <SidebarIcon
                icon={<Sparkles size={18} />}
                label="AI"
                active={ai.sidebarOpen}
                onClick={() => setAIConfig({ sidebarOpen: !ai.sidebarOpen })}
                accent="#e3b341"
                special
                isRight={isRight}
            />
            <SidebarIcon
                icon={<Settings size={18} />}
                label="Settings"
                active={activeView === 'settings'}
                onClick={() => setActiveView('settings')}
                accent={accent}
                isRight={isRight}
            />
        </div>
    );
}
