import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
    GitBranch, CheckCircle2, FileCode2, Clock, GitCommit, RefreshCw,
    UploadCloud, DownloadCloud, Plus, Minus, AlertCircle, Trash2,
    RotateCcw, GitMerge, Archive, ChevronDown, ChevronUp, Copy, Check, Sparkles, Loader2
} from 'lucide-react'
import { useStore } from '@/store'

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const s = Math.floor(diff / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d}d ago`
    const mo = Math.floor(d / 30)
    if (mo < 12) return `${mo}mo ago`
    return `${Math.floor(mo / 12)}y ago`
}

const STATUS_LABELS: Record<string, string> = {
    M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed',
    C: 'Copied', U: 'Updated', '?': 'Untracked', '!': 'Ignored',
}
const STATUS_COLORS: Record<string, string> = {
    M: 'text-yellow-400 border-yellow-400/30',
    A: 'text-green-400 border-green-400/30',
    D: 'text-red-400 border-red-400/30',
    R: 'text-blue-400 border-blue-400/30',
    C: 'text-purple-400 border-purple-400/30',
    U: 'text-orange-400 border-orange-400/30',
    '?': 'text-white/40 border-white/20',
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SectionHeader({ label, count, action }: { label: string; count?: number; action?: React.ReactNode }) {
    return (
        <div className="text-xs text-white/50 mb-2 uppercase tracking-wider flex items-center justify-between">
            <span>{label}{count !== undefined ? ` (${count})` : ''}</span>
            {action}
        </div>
    )
}

function FileRow({
    path, status, staged, onAction, actionIcon, actionTitle, actionColor,
    onDiscard,
}: {
    path: string
    status: string
    staged: boolean
    onAction: () => void
    actionIcon: React.ReactNode
    actionTitle: string
    actionColor: string
    onDiscard?: () => void
}) {
    const s = status.charAt(0).toUpperCase()
    const colorClass = STATUS_COLORS[s] || 'text-white/40 border-white/20'
    const isConflict = status === 'conflict' || status === 'unmerged'
    return (
        <div className={`flex items-center justify-between text-sm p-1.5 hover:bg-white/5 rounded transition-colors group ${isConflict ? 'border border-orange-500/30 bg-orange-500/5' : ''}`}>
            <div className="flex items-center gap-2 truncate min-w-0">
                {isConflict
                    ? <AlertCircle size={14} className="text-orange-400 shrink-0" />
                    : <FileCode2 size={14} className={staged ? 'text-green-400' : 'text-yellow-400'} style={{ flexShrink: 0 }} />
                }
                <span className="font-mono text-xs truncate text-white/80" title={path}>{path}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
                <span className={`text-[10px] border px-1 rounded uppercase min-w-[18px] text-center ${colorClass}`} title={STATUS_LABELS[s]}>
                    {s}
                </span>
                {onDiscard && (
                    <button
                        onClick={onDiscard}
                        title="Discard changes"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400 p-0.5 rounded"
                    >
                        <RotateCcw size={11} />
                    </button>
                )}
                <button
                    onClick={onAction}
                    title={actionTitle}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity text-white/30 ${actionColor} p-0.5 rounded`}
                >
                    {actionIcon}
                </button>
            </div>
        </div>
    )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GitView() {
    const {
        git, setGitRepo, refreshGitStatus, gitCheckout, gitCommit, gitPush, gitPull,
        gitStageFile, gitUnstageFile, tabs, activeTabId, ai
    } = useStore()

    const [message, setMessage] = useState('')
    const [generatingCommit, setGeneratingCommit] = useState(false)
    const [selectedBranch, setSelectedBranch] = useState('')
    const [newBranch, setNewBranch] = useState('')
    const [showNewBranch, setShowNewBranch] = useState(false)
    const [stashes, setStashes] = useState<{ index: number; message: string }[]>([])
    const [stashMessage, setStashMessage] = useState('')
    const [stashOpen, setStashOpen] = useState(false)
    const [copiedHash, setCopiedHash] = useState<string | null>(null)
    const newBranchRef = useRef<HTMLInputElement>(null)
    const copyTimerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        const activeTab = tabs.find(t => t.id === activeTabId)
        const cwd = activeTab?.currentCwd || window.fterm.homedir || '.'
        setGitRepo(cwd)
    }, [activeTabId, tabs])

    useEffect(() => {
        if (showNewBranch) newBranchRef.current?.focus()
    }, [showNewBranch])

    const handleCommit = async () => {
        if (!message.trim()) return
        await gitCommit(message)
        setMessage('')
    }

    const handleGenerateCommit = async () => {
        if (!git.currentRepo || ai.provider === 'none') return

        let diffString = ''
        const stFiles = git.status?.stagedFiles || []

        if (stFiles.length > 0) {
            diffString = await window.fterm.git.diff(git.currentRepo, ['--cached'])
        } else {
            const unFiles = git.status?.unstagedFiles || []
            if (unFiles.length > 0) {
                diffString = await window.fterm.git.diff(git.currentRepo, [])
            } else {
                return
            }
        }

        try {
            setGeneratingCommit(true)
            const croppedDiff = diffString.length > 20000 ? diffString.slice(0, 20000) + '\n...[Diff Truncated]...' : diffString

            const req = {
                id: crypto.randomUUID(),
                provider: ai.provider,
                model: ai.model,
                effort: ai.effort,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert developer. Generate a detailed commit message based on the provided git diff. Write natural sentences without "conventional commit" prefixes (e.g. do not prefix with "feat:", "fix:", "chore:"). The first line must be a concise summary. Following that, leave a blank line and then provide a detailed list or explanation of the actual modifications (what changed and why). Output ONLY the raw commit message without markdown formatting, code blocks, prefixes like "Commit message:", or outside explanations.'
                    },
                    {
                        role: 'user',
                        content: croppedDiff
                    }
                ],
                ollamaUrl: ai.ollamaUrl
            } as any // Cast to any to align with IPC request format if needed

            const result = await window.fterm.aiAutocomplete(req)
            if (result) {
                setMessage(result.trim().replace(/^`{3}[\s\S]*?\n|<\/?code>/g, '').replace(/`{3}$/, ''))
            }
        } catch (err: any) {
            console.error('Failed to generate commit', err)
        } finally {
            setGeneratingCommit(false)
        }
    }

    async function loadStashes() {
        if (!git.currentRepo) return
        const list = await window.fterm.git.stashList(git.currentRepo)
        setStashes(list)
    }

    async function handleStashPush() {
        if (!git.currentRepo) return
        await window.fterm.git.stashPush(git.currentRepo, stashMessage || undefined)
        setStashMessage('')
        await loadStashes()
        await refreshGitStatus()
    }

    async function handleStashApply(index: number) {
        if (!git.currentRepo) return
        await window.fterm.git.stashApply(git.currentRepo, index)
        await refreshGitStatus()
    }

    async function handleStashPop(index: number) {
        if (!git.currentRepo) return
        await window.fterm.git.stashPop(git.currentRepo, index)
        await loadStashes()
        await refreshGitStatus()
    }

    async function handleStashDrop(index: number) {
        if (!git.currentRepo) return
        await window.fterm.git.stashDrop(git.currentRepo, index)
        await loadStashes()
    }

    async function handleCreateBranch() {
        if (!newBranch.trim() || !git.currentRepo) return
        await gitCheckout(newBranch.trim())
        setNewBranch('')
        setShowNewBranch(false)
    }

    async function handleDiscard(filePath: string) {
        if (!git.currentRepo) return
        await window.fterm.git.discard(git.currentRepo, filePath)
        await refreshGitStatus()
    }

    function copyHash(hash: string) {
        navigator.clipboard.writeText(hash)
        setCopiedHash(hash)
        clearTimeout(copyTimerRef.current)
        copyTimerRef.current = setTimeout(() => setCopiedHash(null), 1500)
    }

    const { status, branches, commits, loading, error, remotes, stats } = git
    const defaultRemote = remotes[0]?.name || 'origin'
    const totalChanges = (status?.stagedFiles.length ?? 0) + (status?.unstagedFiles.length ?? 0)
    const conflictCount = status?.unmergedFiles?.length ?? 0

    return (
        <motion.div
            key="git"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col h-full w-full max-w-6xl mx-auto p-4 gap-4 overflow-hidden"
        >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <h2 className="text-xl font-bold text-white truncate">Source Control</h2>
                    {loading && <RefreshCw size={14} className="text-white/40 animate-spin" />}
                    {conflictCount > 0 && (
                        <span className="flex items-center gap-1 text-xs text-orange-400 bg-orange-500/15 border border-orange-500/30 px-2 py-0.5 rounded-full">
                            <AlertCircle size={11} /> {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={() => refreshGitStatus()}
                        disabled={loading}
                        className="p-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-50 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw size={15} />
                    </button>
                    <button
                        onClick={() => gitPull(defaultRemote, status?.branch || 'main')}
                        disabled={loading || !status?.branch}
                        title="Pull"
                        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded bg-blue-600/40 hover:bg-blue-600/60 text-white disabled:opacity-50 transition-colors text-sm"
                    >
                        <DownloadCloud size={14} /> <span className="hidden sm:inline">Pull</span>
                        {status?.behind ? <span className="bg-white/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{status.behind}</span> : null}
                    </button>
                    <button
                        onClick={() => gitPush(defaultRemote, status?.branch || 'main')}
                        disabled={loading || !status?.branch}
                        title="Push"
                        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded bg-green-600/40 hover:bg-green-600/60 text-white disabled:opacity-50 transition-colors text-sm"
                    >
                        <UploadCloud size={14} /> <span className="hidden sm:inline">Push</span>
                        {status?.ahead ? <span className="bg-white/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{status.ahead}</span> : null}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/15 text-red-300 px-3 py-2 rounded-lg text-xs border border-red-500/30 shrink-0 flex items-center gap-2">
                    <AlertCircle size={13} className="shrink-0" />
                    {error === 'Not a git repository'
                        ? 'No git repo in current directory'
                        : error}
                </div>
            )}

            {/* Main grid */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-0">

                {/* ── Left column ── */}
                <div className="flex flex-col gap-3 min-h-0 overflow-y-auto no-scrollbar">

                    {/* Branch panel */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 shrink-0">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold text-white/60 flex items-center gap-2 uppercase tracking-wide">
                                <GitBranch size={13} /> Branch
                            </h3>
                            <div className="flex items-center gap-2">
                                {status?.behind ? <span className="text-[11px] font-bold text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded">↓ {status.behind}</span> : null}
                                {status?.ahead ? <span className="text-[11px] font-bold text-green-400 bg-green-500/15 px-1.5 py-0.5 rounded">↑ {status.ahead}</span> : null}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 bg-black/30 px-2.5 py-1.5 rounded-lg border border-white/5 mb-2">
                            <GitMerge size={13} className="text-blue-400 shrink-0" />
                            <select
                                value={selectedBranch || status?.branch || ''}
                                onChange={e => setSelectedBranch(e.target.value)}
                                className="flex-1 bg-transparent text-sm text-blue-400 font-mono outline-none cursor-pointer min-w-0"
                            >
                                {branches.map(b => (
                                    <option key={b.name} value={b.name} className="bg-[#1a1a2e] text-white">
                                        {b.isRemote ? '⬡ ' : ''}{b.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => selectedBranch && selectedBranch !== status?.branch && gitCheckout(selectedBranch)}
                                disabled={!selectedBranch || selectedBranch === status?.branch || loading}
                                className="text-[11px] bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2.5 py-1 rounded transition-colors shrink-0"
                            >
                                Switch
                            </button>
                        </div>

                        <AnimatePresence>
                            {showNewBranch && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                >
                                    <div className="flex gap-2 mt-1">
                                        <input
                                            ref={newBranchRef}
                                            value={newBranch}
                                            onChange={e => setNewBranch(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') handleCreateBranch(); if (e.key === 'Escape') setShowNewBranch(false) }}
                                            placeholder="new-branch-name"
                                            className="flex-1 bg-black/40 border border-white/15 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-500/60 font-mono"
                                        />
                                        <button
                                            onClick={handleCreateBranch}
                                            disabled={!newBranch.trim() || loading}
                                            className="px-2.5 py-1.5 rounded bg-blue-600/50 hover:bg-blue-600/70 text-xs text-white disabled:opacity-40 transition-colors"
                                        >
                                            Create
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <button
                            onClick={() => setShowNewBranch(o => !o)}
                            className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 mt-2 transition-colors"
                        >
                            <Plus size={11} /> New branch
                        </button>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 bg-white/5 border border-white/10 rounded-xl py-3 shrink-0 divide-x divide-white/10">
                        {[
                            { label: 'Commits', value: stats?.totalCommits ?? 0 },
                            { label: 'Work Days', value: stats?.workDays ?? 0 },
                            { label: 'Branches', value: branches.filter(b => !b.isRemote).length },
                            { label: 'Remotes', value: remotes.length },
                        ].map(({ label, value }) => (
                            <div key={label} className="flex flex-col items-center">
                                <span className="text-lg font-bold text-white leading-none">{value}</span>
                                <span className="text-[9px] uppercase tracking-widest text-white/40 mt-1">{label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Changes */}
                    <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col shrink-0 overflow-hidden">
                        <div className="px-4 pt-4 pb-2 shrink-0">
                            <h3 className="text-xs font-semibold text-white/60 flex items-center gap-2 uppercase tracking-wide">
                                <CheckCircle2 size={13} /> Changes
                                {totalChanges > 0 && (
                                    <span className="ml-auto text-white/40 font-normal normal-case tracking-normal">{totalChanges}</span>
                                )}
                            </h3>
                        </div>

                        <div className="max-h-[22vh] overflow-y-auto px-3 pb-2 space-y-4 no-scrollbar">
                            {/* Conflicts */}
                            {conflictCount > 0 && (
                                <div>
                                    <SectionHeader label="Conflicts" count={conflictCount} />
                                    <div className="space-y-0.5">
                                        {status!.unmergedFiles.map(f => (
                                            <FileRow
                                                key={f.path} path={f.path} status="conflict" staged={false}
                                                onAction={() => gitStageFile(f.path)}
                                                actionIcon={<Plus size={12} />}
                                                actionTitle="Mark resolved"
                                                actionColor="hover:text-green-400"
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Staged */}
                            {status?.stagedFiles.length ? (
                                <div>
                                    <SectionHeader
                                        label="Staged"
                                        count={status.stagedFiles.length}
                                        action={
                                            <button
                                                onClick={() => gitUnstageFile('.')}
                                                className="text-[10px] text-white/35 hover:text-white/65 transition-colors"
                                            >
                                                Unstage all
                                            </button>
                                        }
                                    />
                                    <div className="space-y-0.5">
                                        {status.stagedFiles.map(f => (
                                            <FileRow
                                                key={f.path} path={f.path} status={f.status} staged={true}
                                                onAction={() => gitUnstageFile(f.path)}
                                                actionIcon={<Minus size={12} />}
                                                actionTitle="Unstage"
                                                actionColor="hover:text-yellow-400"
                                            />
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            {/* Unstaged */}
                            {status?.unstagedFiles.length ? (
                                <div>
                                    <SectionHeader
                                        label="Unstaged"
                                        count={status.unstagedFiles.length}
                                        action={
                                            <button
                                                onClick={() => gitStageFile('.')}
                                                className="text-[10px] text-white/35 hover:text-white/65 transition-colors"
                                            >
                                                Stage all
                                            </button>
                                        }
                                    />
                                    <div className="space-y-0.5">
                                        {status.unstagedFiles.map(f => (
                                            <FileRow
                                                key={f.path} path={f.path} status={f.status} staged={false}
                                                onAction={() => gitStageFile(f.path)}
                                                actionIcon={<Plus size={12} />}
                                                actionTitle="Stage"
                                                actionColor="hover:text-green-400"
                                                onDiscard={() => handleDiscard(f.path)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            {!totalChanges && !conflictCount && (
                                <div className="text-xs text-white/30 text-center py-6 flex flex-col items-center gap-2">
                                    <CheckCircle2 size={24} className="text-green-500/40" />
                                    Working tree clean
                                </div>
                            )}
                        </div>

                        {/* Commit area */}
                        <div className="p-3 bg-black/20 border-t border-white/10 shrink-0 space-y-2">
                            <textarea
                                rows={4}
                                placeholder="Commit message…"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && e.ctrlKey && handleCommit()}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/30 resize-none leading-relaxed"
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCommit}
                                    disabled={!message.trim() || loading || !status?.stagedFiles.length}
                                    className="flex-1 bg-blue-600/80 disabled:bg-blue-600/30 hover:bg-blue-500/80 text-white text-xs font-medium py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                                >
                                    Commit Staged
                                </button>
                                <button
                                    onClick={handleGenerateCommit}
                                    disabled={generatingCommit || (!status?.stagedFiles.length && !status?.unstagedFiles.length) || ai.provider === 'none'}
                                    title={ai.provider === 'none' ? "Select an AI Provider to generate" : "Generate commit message (from staged or unstaged changes)"}
                                    className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-blue-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    {generatingCommit ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                                </button>
                                <span className="text-[10px] text-white/25 hidden sm:inline-block">Ctrl+↵</span>
                            </div>
                        </div>
                    </div>

                    {/* Stash */}
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden shrink-0">
                        <button
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.04] text-xs font-semibold text-white/60 uppercase tracking-wide transition-colors"
                            onClick={() => { setStashOpen(o => !o); if (!stashOpen) loadStashes() }}
                        >
                            <span className="flex items-center gap-2"><Archive size={13} /> Stash</span>
                            {stashOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                        <AnimatePresence>
                            {stashOpen && (
                                <motion.div
                                    initial={{ height: 0 }}
                                    animate={{ height: 'auto' }}
                                    exit={{ height: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                >
                                    <div className="p-3 pt-0 space-y-2 border-t border-white/10">
                                        <div className="flex gap-2 pt-3">
                                            <input
                                                value={stashMessage}
                                                onChange={e => setStashMessage(e.target.value)}
                                                placeholder="Optional message…"
                                                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white/80 outline-none focus:border-blue-500/50 min-w-0"
                                            />
                                            <button
                                                onClick={handleStashPush}
                                                disabled={!totalChanges}
                                                className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs text-white/70 disabled:opacity-40 transition-colors shrink-0"
                                            >
                                                Save
                                            </button>
                                        </div>
                                        {stashes.length === 0
                                            ? <p className="text-xs text-white/25 text-center py-2">No stashes</p>
                                            : stashes.map(s => (
                                                <div key={s.index} className="flex items-center gap-2 text-xs bg-black/20 rounded p-2">
                                                    <span className="flex-1 text-white/55 truncate min-w-0">{s.message}</span>
                                                    <button onClick={() => handleStashApply(s.index)} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 transition-colors shrink-0">Apply</button>
                                                    <button onClick={() => handleStashPop(s.index)} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 transition-colors shrink-0">Pop</button>
                                                    <button onClick={() => handleStashDrop(s.index)} className="p-1 rounded hover:bg-red-900/40 text-red-400/60 hover:text-red-400 transition-colors shrink-0">
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            ))
                                        }
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* ── Right column: Commit history ── */}
                <div className="flex flex-col bg-white/5 border border-white/10 rounded-xl min-h-0">
                    <div className="px-5 pt-4 pb-3 shrink-0 flex items-center justify-between border-b border-white/5">
                        <h3 className="text-xs font-semibold text-white/60 flex items-center gap-2 uppercase tracking-wide">
                            <Clock size={13} /> Commit History
                            {commits.length > 0 && <span className="text-white/30 font-normal normal-case tracking-normal">({commits.length})</span>}
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 space-y-1">
                        {commits.length === 0 && !loading && (
                            <div className="text-xs text-white/30 text-center py-10">No commits found</div>
                        )}
                        {commits.map((commit) => (
                            <div
                                key={commit.hash}
                                className="flex items-start gap-3 p-3 rounded-lg border border-transparent hover:border-white/8 hover:bg-white/[0.03] transition-colors group"
                            >
                                <GitCommit size={14} className="text-white/25 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <span className="text-sm text-white/85 leading-snug break-words" title={commit.message}>
                                            {commit.message}
                                        </span>
                                        <span
                                            className="text-[10px] text-white/35 whitespace-nowrap shrink-0 mt-0.5"
                                            title={new Date(commit.date).toLocaleString()}
                                        >
                                            {relativeTime(commit.date)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-white/35">
                                        <button
                                            className="flex items-center gap-1 font-mono text-blue-400/80 hover:text-blue-400 transition-colors"
                                            onClick={() => copyHash(commit.hash)}
                                            title="Copy full hash"
                                        >
                                            {copiedHash === commit.hash
                                                ? <><Check size={10} className="text-green-400" /><span className="text-green-400">copied</span></>
                                                : <><Copy size={10} />{commit.shortHash}</>
                                            }
                                        </button>
                                        <span className="truncate">{commit.author}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
