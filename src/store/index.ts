import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

// Throttled localStorage: zustand persist writes synchronously on EVERY state change.
// During AI streaming, appendChatContent fires per chunk (dozens/sec), each triggering a
// blocking localStorage.setItem of the whole persisted blob. Collapse rapid writes to one
// trailing write per second. Streaming messages are excluded from partialize, so nothing
// is lost; a beforeunload flush guarantees the final state is saved on close.
const throttledStorage: StateStorage = (() => {
  const pending = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    for (const [k, v] of pending) { try { localStorage.setItem(k, v) } catch { /* quota */ } }
    pending.clear()
    timer = null
  }
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush)
  return {
    getItem: (name) => localStorage.getItem(name),
    removeItem: (name) => { pending.delete(name); localStorage.removeItem(name) },
    setItem: (name, value) => {
      pending.set(name, value)
      if (!timer) timer = setTimeout(flush, 1000)
    },
  }
})()
import type {
  Tab, Theme, PetConfig, AIConfig, AppSettings,
  PetState, AIProvider, AIProviderStatus, ChatMessage,
  ProviderUsage, UsageData, SplitNode,
  GitStatus, Branch, Commit, Remote,
  TerminalStats, DailyActivity,
  FtermfetchConfig, FetchFieldId,
  ClaudeCodeStats,
  ClaudeCodeUsage,
  TerminalProfile,
} from '@/types'
import { PROFILE_COLORS } from '@/types'
import {
  deriveMetrics, evaluateAchievements, totalReward,
  purchaseRefusal, getCosmetic, COIN_EVENTS,
} from '@/utils/petAchievements'
import { dirKey, recordVisit, type DirVisits } from '@/utils/frecency'
import type { UpdateInfo } from '@/utils/updateCheck'

// ─── Built-in themes ──────────────────────────────────────────────────────────

export const THEMES: Theme[] = [
  {
    id: 'github-dark', name: 'GitHub Dark',
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#388bfd33',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
    brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
  },
  {
    id: 'dracula', name: 'Dracula',
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night',
    background: '#1a1b26', foreground: '#a9b1d6', cursor: '#c0caf5', selectionBackground: '#283457',
    black: '#32344a', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#ad8ee6', cyan: '#449dab', white: '#787c99',
    brightBlack: '#565f89', brightRed: '#ff7a93', brightGreen: '#b9f27c',
    brightYellow: '#ff9e64', brightBlue: '#7da6ff', brightMagenta: '#bb9af7',
    brightCyan: '#0db9d7', brightWhite: '#acb0d0',
  },
  {
    id: 'cyberpunk', name: 'Cyberpunk',
    background: '#0a0a0f', foreground: '#00ff9f', cursor: '#ff00ff', selectionBackground: '#ff00ff33',
    black: '#0a0a0f', red: '#ff0055', green: '#00ff9f', yellow: '#ffff00',
    blue: '#00b4ff', magenta: '#ff00ff', cyan: '#00ffff', white: '#cccccc',
    brightBlack: '#666680', brightRed: '#ff4488', brightGreen: '#33ffbb',
    brightYellow: '#ffff66', brightBlue: '#44ccff', brightMagenta: '#ff44ff',
    brightCyan: '#44ffff', brightWhite: '#ffffff',
  },
  {
    id: 'nord', name: 'Nord',
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#616e88', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
]

// ─── Store interface ──────────────────────────────────────────────────────────

interface FTermState {
  // Navigation
  activeView: 'terminal' | 'profiles' | 'themes' | 'plugins' | 'settings' | 'git' | 'pet' | 'studio'
  /** The take waiting in the recording studio. Runtime only — never persisted. */
  studioTake: import('../services/TerminalRecorder').RecordingTake | null
  setStudioTake: (take: import('../services/TerminalRecorder').RecordingTake | null) => void
  setActiveView: (view: 'terminal' | 'profiles' | 'themes' | 'plugins' | 'settings' | 'git' | 'pet' | 'studio') => void

  // Detected shells (runtime, not persisted)
  availableShells: Array<{ id: string; name: string; shell: string; icon: string }>
  setAvailableShells: (shells: Array<{ id: string; name: string; shell: string; icon: string }>) => void

  // Bell notifications (runtime, not persisted)
  tabBells: Record<string, boolean>
  setTabBell: (tabId: string) => void
  clearTabBell: (tabId: string) => void

  // Claude Code CLI stats per tab (runtime, not persisted)
  claudeCodeStats: Record<string, ClaudeCodeStats | null>
  setClaudeCodeStats: (tabId: string, stats: ClaudeCodeStats | null) => void

  // Claude Code CLI usage (persisted, cost accumulation across sessions)
  claudeCodeUsage: ClaudeCodeUsage
  addClaudeCodeCost: (cost: number) => void

  // CWD tracking (persisted per profile)
  profileCwds: Record<string, string>
  /** Directories panes have moved into, ranked zoxide-style in the palette. */
  dirVisits: DirVisits
  clearDirVisits: () => void
  /** Set when a newer release was found. Runtime only. */
  availableUpdate: UpdateInfo | null
  setAvailableUpdate: (info: UpdateInfo | null) => void
  updateProfileCwd: (profileId: string, cwd: string) => void
  updateTabCwd: (tabId: string, paneId: string, cwd: string) => void

  profiles: TerminalProfile[]
  addProfile: (profile: Omit<TerminalProfile, 'id'>) => void
  updateProfile: (id: string, updates: Partial<Omit<TerminalProfile, 'id'>>) => void
  deleteProfile: (id: string) => void
  plugins: { id: string, name: string, description: string, enabled: boolean, isCustom?: boolean, code?: string }[]
  togglePlugin: (id: string) => void
  addCustomPlugin: (plugin: { name: string, description: string, code: string, enabled: boolean }) => string
  updateCustomPlugin: (id: string, updates: Partial<{ name: string, description: string, code: string, enabled: boolean }>) => void
  deleteCustomPlugin: (id: string) => void

  // Snippets
  snippets: { id: string; name: string; command: string; description?: string }[]
  addSnippet: (snippet: { name: string; command: string; description?: string }) => void
  updateSnippet: (id: string, updates: Partial<{ name: string; command: string; description: string }>) => void
  deleteSnippet: (id: string) => void

  // SSH hosts
  sshHosts: import('../types').SshHost[]
  addSshHost: (host: Omit<import('../types').SshHost, 'id'>) => void
  updateSshHost: (id: string, updates: Partial<Omit<import('../types').SshHost, 'id'>>) => void
  deleteSshHost: (id: string) => void
  connectSshHost: (id: string) => void

  // Notes scratchpad
  notes: import('../types').Note[]
  addNote: () => string
  updateNote: (id: string, updates: Partial<Pick<import('../types').Note, 'title' | 'body'>>) => void
  deleteNote: (id: string) => void

  // Browser bookmarks
  bookmarks: import('../types').Bookmark[]
  addBookmark: (title: string, url: string) => void
  removeBookmark: (url: string) => void

  // Browser history — session-only, never persisted (privacy)
  browserHistory: import('../types').BrowserHistoryEntry[]
  addHistory: (title: string, url: string) => void
  clearHistory: () => void

  // Saved layouts
  savedLayouts: { id: string; name: string; tabCount: number; profileIds: (string | undefined)[] }[]
  saveCurrentLayout: (name: string) => void
  deleteSavedLayout: (id: string) => void

  // Tabs
  tabs: Tab[]
  activeTabId: string | null
  /** `cwd` overrides the inherited directory (active tab's, then the profile's). */
  addTab: (profileId?: string, cwd?: string) => void
  addTabWithCommand: (command: string, cwd?: string, title?: string) => void
  addEditorTab: (content?: string, language?: string, filePath?: string) => void
  addBrowserTab: (url?: string) => void
  setEditorContent: (tabId: string, content: string) => void
  setEditorLanguage: (tabId: string, language: string) => void
  setEditorFilePath: (tabId: string, filePath: string) => void
  /** Records the on-disk content, clearing the tab's dirty state. */
  markEditorSaved: (tabId: string, content: string) => void
  closeTab: (id: string) => void
  detachTabAway: (id: string) => void
  adoptTab: (tab: Tab) => void
  setTabBrowserUrl: (id: string, url: string) => void
  closeOtherTabs: (id: string) => void
  duplicateTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabTitle: (id: string, title: string) => void
  setTabColor: (id: string, color: string) => void
  setTabOscTitle: (id: string, title: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  setTabPid: (tabId: string, paneId: string, pid: number) => void

  // Panes
  splitPane: (tabId: string, paneId: string, direction: 'horizontal' | 'vertical') => void
  closePane: (tabId: string, paneId: string) => void
  setActivePane: (tabId: string, paneId: string) => void
  resizePane: (tabId: string, splitId: string, newSize: number) => void

  // Theme
  activeThemeId: string
  themes: Theme[]
  setTheme: (id: string) => void
  addTheme: (theme: Theme) => void
  updateTheme: (id: string, updates: Partial<Theme>) => void
  deleteTheme: (id: string) => void

  // Pet
  pet: PetConfig
  petState: PetState
  petMessage: string | null
  setPetMessage: (message: string | null) => void
  lastActivity: string
  setPetState: (state: PetState) => void
  setLastActivity: (activity: string) => void
  setPetConfig: (config: Partial<PetConfig>) => void
  addPetXp: (amount: number) => void
  /** Pay out any achievement whose condition now holds. Safe to call often. */
  checkPetAchievements: () => void
  awardPetCoins: (amount: number) => void
  /** Buy a cosmetic; returns false (and changes nothing) if it is not affordable/unlocked. */
  buyCosmetic: (id: string) => boolean
  equipCosmetic: (id: string | null) => void
  /** React to a real git event — coins, mood and a line of dialogue. */
  petGitEvent: (event: 'commit' | 'push' | 'conflict' | 'clean') => void
  /** Per-type XP/level progress stored separately so switching type preserves each pet's progress */
  petProgress: Partial<Record<string, { level: number; xp: number; maxXp: number; name: string }>>

  // AI
  ai: AIConfig
  setAIConfig: (config: Partial<AIConfig>) => void
  setProviderStatus: (provider: AIProvider, status: Partial<AIProviderStatus>) => void

  // Chat history
  chatMessages: ChatMessage[]
  commandHistory: string[]
  addCommandHistory: (command: string) => void
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>, explicitId?: string) => string
  updateChatMessage: (id: string, update: Partial<ChatMessage>) => void
  appendChatContent: (id: string, text: string) => void
  clearChat: () => void

  // Usage tracking
  usage: Partial<Record<AIProvider, ProviderUsage>>
  recordUsage: (data: UsageData) => void

  // Terminal activity stats
  terminalStats: TerminalStats
  recordTerminalError: () => void

  // ftermfetch customization
  ftermfetchConfig: FtermfetchConfig
  setFtermfetchConfig: (updates: Partial<FtermfetchConfig>) => void
  setFetchFieldColor: (id: FetchFieldId, color: string) => void
  reorderFetchField: (id: FetchFieldId, direction: 'up' | 'down') => void
  toggleFetchField: (id: FetchFieldId) => void

  // Settings
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void

  // Keybindings
  keybindings: Record<string, string>
  setKeybinding: (action: string, keys: string) => void
  resetKeybindings: () => void

  // Remote terminal state (runtime + persisted config)
  remoteTerminal: { enabled: boolean; port: number; pin: string; clients: number }
  setRemoteTerminal: (updates: Partial<{ enabled: boolean; port: number; pin: string; clients: number }>) => void

  // Pending widget trigger (runtime, not persisted) — allows StatusBar/other components to open a widget in the active pane
  pendingWidget: { type: string; data?: any; tabId: string } | null
  setPendingWidget: (w: { type: string; data?: any; tabId: string } | null) => void

  // Git System
  git: {
    currentRepo: string | null
    status: GitStatus | null
    branches: Branch[]
    commits: Commit[]
    remotes: Remote[]
    stats: { totalCommits: number, workDays: number } | null
    loading: boolean
    error: string | null
  }
  setGitRepo: (path: string | null) => Promise<void>
  refreshGitStatus: () => Promise<void>
  gitCheckout: (branch: string) => Promise<void>
  gitCommit: (message: string) => Promise<void>
  gitPush: (remote: string, branch: string) => Promise<void>
  gitPull: (remote: string, branch: string) => Promise<void>
  gitStageFile: (filePath: string) => Promise<void>
  gitUnstageFile: (filePath: string) => Promise<void>
}

// ─── Default keybindings ─────────────────────────────────────────────────────

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'ai-sidebar':     'ctrl+shift+a',
  'settings':       'ctrl+,',
  'new-tab':        'ctrl+t',
  'close-tab':      'ctrl+w',
  'command-palette':'ctrl+shift+p',
  'command-builder':'ctrl+k',
  'search':         'ctrl+shift+f',
  'next-tab':       'ctrl+tab',
  'prev-tab':       'ctrl+shift+tab',
  'split-h':        'ctrl+shift+e',
  'split-v':        'ctrl+shift+o',
  'font-increase':  'ctrl+=',
  'font-decrease':  'ctrl+-',
  'font-reset':     'ctrl+0',
  'history-search': 'ctrl+r',
  'pane-prev':      'ctrl+alt+arrowleft',
  'pane-next':      'ctrl+alt+arrowright',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const TAB_PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#f78166', '#bc8cff', '#39c5cf', '#ff7b72', '#e3b341']

let tabCounter = 0
/** Last cwd each pane reported, to tell a `cd` from a prompt redraw. */
const lastPaneCwd = new Map<string, string>()
let paneCounter = 0
let splitCounter = 0

// Tab tear-out: a window spawned by detaching a tab carries ?adopt=<token>.
export const ADOPT_TOKEN: string | null =
  typeof location !== 'undefined' ? new URLSearchParams(location.search).get('adopt') : null
export const IS_DETACHED = !!ADOPT_TOKEN
/** Raise the tab-id counter base (used to namespace detached-window tab ids). */
export function setTabCounterBase(n: number) { if (n > tabCounter) tabCounter = n }

/** Curated config slice handed to a torn-off window so it looks identical to its origin. */
export function getConfigSnapshot() {
  const s = useStore.getState()
  return {
    settings: s.settings,
    activeThemeId: s.activeThemeId,
    themes: s.themes,
    ai: s.ai,
    pet: s.pet,
    petProgress: s.petProgress,
    keybindings: s.keybindings,
    profiles: s.profiles,
    plugins: s.plugins,
    snippets: s.snippets,
    bookmarks: s.bookmarks,
    savedLayouts: s.savedLayouts,
    profileCwds: s.profileCwds,
    ftermfetchConfig: s.ftermfetchConfig,
  }
}

const newPaneId = () => `pane-${++paneCounter}`
const newSplitId = () => `split-${++splitCounter}`

const SHELL_LABELS: Record<string, string> = {
  pwsh: 'PS', cmd: 'CMD', wsl: 'WSL', bash: 'Bash', zsh: 'Zsh', fish: 'Fish',
}

function shellLabel(profileId?: string): string {
  if (!profileId) return 'Terminal'
  return SHELL_LABELS[profileId] ?? profileId
}

const newTab = (profileId?: string, initialCwd?: string): Tab => {
  const paneId = newPaneId()
  const id = `tab-${++tabCounter}`
  const color = TAB_PALETTE[(tabCounter - 1) % TAB_PALETTE.length]
  return {
    id,
    title: shellLabel(profileId),
    color,
    layout: {
      id: newSplitId(),
      type: 'pane',
      paneId,
      profileId,
      initialCwd,
    },
    activePaneId: paneId
  }
}

export function findNode(node: SplitNode, id: string): SplitNode | null {
  if (node.id === id || node.paneId === id) return node;
  if (node.first) {
    const found = findNode(node.first, id);
    if (found) return found;
  }
  if (node.second) {
    const found = findNode(node.second, id);
    if (found) return found;
  }
  return null;
}

function findParent(node: SplitNode, id: string): SplitNode | null {
  if (node.first && (node.first.id === id || node.first.paneId === id)) return node;
  if (node.second && (node.second.id === id || node.second.paneId === id)) return node;

  if (node.first) {
    const found = findParent(node.first, id);
    if (found) return found;
  }
  if (node.second) {
    const found = findParent(node.second, id);
    if (found) return found;
  }
  return null;
}

export function getOrderedPaneIds(node: SplitNode): string[] {
  if (node.type === 'pane') return node.paneId ? [node.paneId] : []
  return [
    ...(node.first ? getOrderedPaneIds(node.first) : []),
    ...(node.second ? getOrderedPaneIds(node.second) : []),
  ]
}

function getFirstPaneId(node: SplitNode): string | undefined {
  if (node.type === 'pane') return node.paneId;
  if (node.first) return getFirstPaneId(node.first);
  return undefined;
}

/** Pure helper — apply XP amount and return new level/xp/maxXp. */
function applyXp(xp: number, level: number, maxXp: number, amount: number) {
  let newXp = xp + amount
  let newLevel = level
  let newMaxXp = maxXp
  while (newXp >= newMaxXp) {
    newXp -= newMaxXp
    newLevel++
    newMaxXp = Math.floor(newMaxXp * 1.5)
  }
  return { newXp, newLevel, newMaxXp }
}

/** Deep clone a SplitNode tree without JSON serialisation round-trip. */
function cloneNode(node: SplitNode): SplitNode {
  return {
    ...node,
    first: node.first ? cloneNode(node.first) : undefined,
    second: node.second ? cloneNode(node.second) : undefined,
  }
}

/** Structural-sharing tree update — only copies nodes on the path to the target. */
function updateTreeNode(node: SplitNode, id: string, updater: (n: SplitNode) => SplitNode): SplitNode {
  if (node.id === id || node.paneId === id) return updater({ ...node })
  const newFirst = node.first ? updateTreeNode(node.first, id, updater) : node.first
  const newSecond = node.second ? updateTreeNode(node.second, id, updater) : node.second
  if (newFirst === node.first && newSecond === node.second) return node
  return { ...node, first: newFirst, second: newSecond }
}

let msgCounter = 0
const newMsgId = () => `msg-${++msgCounter}-${Date.now()}`

/** Returns ISO date string for the Monday of the current week (YYYY-MM-DD). */
function getWeekStart(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sun … 6=Sat
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function getDayStart(): string {
  return new Date().toISOString().slice(0, 10)
}

function extractBaseCommand(raw: string): string {
  return raw.trim().split(/\s+/)[0].replace(/^[>$#]+/, '').toLowerCase() || raw.trim()
}

function computeStreaks(log: Record<string, DailyActivity>): { current: number; longest: number } {
  const dates = Object.keys(log).filter(d => log[d].commands > 0 || log[d].sessions > 0).sort()
  if (dates.length === 0) return { current: 0, longest: 0 }

  let longest = 1, current = 1
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1])
    const curr = new Date(dates[i])
    const diff = (curr.getTime() - prev.getTime()) / 86400000
    if (diff === 1) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }

  // Check if streak reaches today
  const today = getDayStart()
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const lastDate = dates[dates.length - 1]
  if (lastDate !== today && lastDate !== yesterday) current = 0

  return { current, longest }
}

function pruneActivityLog(log: Record<string, DailyActivity>): Record<string, DailyActivity> {
  const cutoff = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
  return Object.fromEntries(Object.entries(log).filter(([d]) => d >= cutoff))
}

const DEFAULT_FTERMFETCH_CONFIG: FtermfetchConfig = {
  fields: [
    { id: 'hostname',      enabled: true },
    { id: 'os',           enabled: true },
    { id: 'shell',        enabled: true },
    { id: 'cpu',          enabled: true },
    { id: 'memory',       enabled: true },
    { id: 'uptime',       enabled: true },
    { id: 'cwd',          enabled: true },
    { id: 'petLevel',     enabled: true },
    { id: 'aiProvider',   enabled: true },
    { id: 'currentStreak',enabled: true },
    { id: 'commandsRun',  enabled: true },
  ],
  colorMode: 'theme',
  fieldColors: {},
}

const DEFAULT_TERMINAL_STATS: TerminalStats = {
  activityLog: {},
  currentStreak: 0,
  longestStreak: 0,
  commandFrequency: {},
  hourlyActivity: Array(24).fill(0),
  totalErrors: 0,
  lastSessionDate: '',
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<FTermState>()(
  persist(
    (set, get) => ({
      // Navigation
      activeView: 'terminal',
      setActiveView: (view: 'terminal' | 'profiles' | 'themes' | 'plugins' | 'settings' | 'git' | 'pet' | 'studio') => set({ activeView: view }),
      studioTake: null,
      setStudioTake: (take) => set({ studioTake: take }),

      // Detected shells
      availableShells: [],
      setAvailableShells: (shells) => set({ availableShells: shells }),

      // Bell notifications
      tabBells: {},
      setTabBell: (tabId) => set(s => ({ tabBells: { ...s.tabBells, [tabId]: true } })),
      clearTabBell: (tabId) => set(s => {
        const next = { ...s.tabBells }
        delete next[tabId]
        return { tabBells: next }
      }),

      // Claude Code CLI stats
      claudeCodeStats: {},
      setClaudeCodeStats: (tabId, stats) => set(s => ({ claudeCodeStats: { ...s.claudeCodeStats, [tabId]: stats } })),

      // Claude Code CLI usage (persisted cost accumulation)
      claudeCodeUsage: {
        sessionCost: 0,
        dayCost: 0,
        dayStart: new Date().toISOString().slice(0, 10),
        weekCost: 0,
        weekStart: getWeekStart(),
      },
      addClaudeCodeCost: (cost) => set(s => {
        const today = new Date().toISOString().slice(0, 10)
        const thisWeek = getWeekStart()
        const prev = s.claudeCodeUsage
        const resetDay = prev.dayStart !== today
        const resetWeek = prev.weekStart !== thisWeek
        return {
          claudeCodeUsage: {
            sessionCost: prev.sessionCost + cost,
            dayCost: (resetDay ? 0 : prev.dayCost) + cost,
            dayStart: today,
            weekCost: (resetWeek ? 0 : prev.weekCost) + cost,
            weekStart: thisWeek,
          },
        }
      }),

      // CWD tracking
      profileCwds: {},
      updateProfileCwd: (profileId, cwd) => set(s => ({
        profileCwds: { ...s.profileCwds, [profileId]: cwd }
      })),
      dirVisits: {},
      clearDirVisits: () => set({ dirVisits: {} }),
      availableUpdate: null,
      setAvailableUpdate: (info) => set({ availableUpdate: info }),
      updateTabCwd: (tabId, paneId, cwd) => {
        // A visit is a *change* of directory: shells report the cwd at every
        // prompt, and the directory a pane starts in is not a choice.
        const paneKey = `${tabId}-${paneId}`
        const prevCwd = lastPaneCwd.get(paneKey)
        lastPaneCwd.set(paneKey, cwd)
        const visited = prevCwd !== undefined && dirKey(prevCwd) !== dirKey(cwd)
        set(s => {
          const tab = s.tabs.find(t => t.id === tabId)
          const paneNode = tab?.layout ? findNode(tab.layout, paneId) : null
          const profileId = paneNode?.profileId || 'default'
          return {
            tabs: s.tabs.map(t => t.id === tabId
              ? { ...t, currentCwd: cwd }
              : t),
            profileCwds: { ...s.profileCwds, [profileId]: cwd },
            ...(visited ? { dirVisits: recordVisit(s.dirVisits, cwd, Date.now()) } : {}),
          }
        })
      },

      // Profiles and Plugins mock data
      profiles: [
        { id: 'pwsh', name: 'PowerShell', icon: 'Code', shell: 'powershell.exe' },
        { id: 'cmd', name: 'Command Prompt', icon: 'TerminalSquare', shell: 'cmd.exe' },
        { id: 'wsl', name: 'WSL', icon: 'Linux', shell: 'wsl.exe' },
        { id: 'bash', name: 'Git Bash', icon: 'GitMerge', shell: 'bash.exe' },
      ],
      addProfile: (profile) => set(state => ({
        profiles: [...state.profiles, { ...profile, id: `profile-${Date.now()}` }]
      })),
      updateProfile: (id, updates) => set(state => ({
        profiles: state.profiles.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      deleteProfile: (id) => set(state => ({
        profiles: state.profiles.filter(p => p.id !== id)
      })),
      plugins: [
        { id: 'auto-theme', name: 'Auto Theme Switcher', description: 'Changes theme based on time of day (morning→Tokyo Night, afternoon→Nord, evening→Dracula, night→GitHub Dark).', enabled: true },
        { id: 'file-explorer', name: 'File Explorer', description: 'Run `explore [path]` to browse files as an interactive widget.', enabled: true },
        { id: 'sys-mon', name: 'System Monitor', description: 'Run `sys-mon` to view live CPU/RAM/network charts.', enabled: true },
        { id: 'docker', name: 'Docker Dashboard', description: 'Run `docker-dash` to manage containers interactively.', enabled: true },
        { id: 'weather', name: 'Weather Widget', description: 'Run `weather [city]` to display a live weather card.', enabled: true },
        { id: 'data-table', name: 'Data Table', description: 'Run `ps` to see processes as a sortable table.', enabled: true },
        { id: 'visualizer', name: 'Audio Visualizer', description: 'Run `viz` or `visualizer` to play an audio file with bars/wave/ASCII spectrum visualization.', enabled: true },
        { id: 'clipboard', name: 'Clipboard History', description: 'Run `clip` or `clipboard` to view, search, pin, and paste from clipboard history.', enabled: true },
      ],
      togglePlugin: (id: string) => set(state => ({
        plugins: state.plugins.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p)
      })),
      addCustomPlugin: (plugin) => {
        const id = `plugin-${Date.now()}`
        set(state => ({
          plugins: [...state.plugins, { ...plugin, id, isCustom: true }]
        }))
        return id
      },
      updateCustomPlugin: (id, updates) => set(state => ({
        plugins: state.plugins.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      deleteCustomPlugin: (id) => set(state => ({
        plugins: state.plugins.filter(p => p.id !== id)
      })),

      // Snippets
      snippets: [],
      addSnippet: (snippet) => set(s => ({
        snippets: [...s.snippets, { ...snippet, id: `snippet-${Date.now()}` }]
      })),
      updateSnippet: (id, updates) => set(s => ({
        snippets: s.snippets.map(sn => sn.id === id ? { ...sn, ...updates } : sn)
      })),
      deleteSnippet: (id) => set(s => ({
        snippets: s.snippets.filter(sn => sn.id !== id)
      })),

      // SSH hosts — key/agent auth only; never store passwords
      sshHosts: [],
      addSshHost: (host) => set(s => ({
        sshHosts: [...s.sshHosts, { ...host, id: `ssh-${Date.now()}` }]
      })),
      updateSshHost: (id, updates) => set(s => ({
        sshHosts: s.sshHosts.map(h => h.id === id ? { ...h, ...updates } : h)
      })),
      deleteSshHost: (id) => set(s => ({
        sshHosts: s.sshHosts.filter(h => h.id !== id)
      })),
      connectSshHost: (id) => {
        const host = get().sshHosts.find(h => h.id === id)
        if (!host) return
        const args = ['-p', String(host.port ?? 22)]
        if (host.identityFile) args.push('-i', host.identityFile)
        if (host.extraArgs?.trim()) args.push(...host.extraArgs.trim().split(/\s+/))
        args.push(`${host.user}@${host.host}`)
        const profileId = id // sshHosts ids are already `ssh-…`
        set(s => ({
          profiles: s.profiles.some(p => p.id === profileId)
            ? s.profiles.map(p => p.id === profileId ? { ...p, name: host.label, shell: 'ssh.exe', args } : p)
            : [...s.profiles, { id: profileId, name: host.label, icon: 'Globe', shell: 'ssh.exe', args }]
        }))
        get().addTab(profileId)
        // Label the freshly created tab with the host name
        set(s => ({
          tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, title: host.label } : t)
        }))
      },

      // Notes scratchpad
      notes: [],
      addNote: () => {
        const id = `note-${Date.now()}`
        set(s => ({ notes: [{ id, title: 'Untitled', body: '', updatedAt: Date.now() }, ...s.notes] }))
        return id
      },
      updateNote: (id, updates) => set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n)
      })),
      deleteNote: (id) => set(s => ({
        notes: s.notes.filter(n => n.id !== id)
      })),

      // Saved layouts
      bookmarks: [],
      addBookmark: (title, url) => set(s => s.bookmarks.some(b => b.url === url)
        ? {}
        : { bookmarks: [...s.bookmarks, { id: `bm-${Date.now()}`, title: title || url, url }] }),
      removeBookmark: (url) => set(s => ({ bookmarks: s.bookmarks.filter(b => b.url !== url) })),

      // Session-only browsing history (excluded from persist partialize)
      browserHistory: [],
      addHistory: (title, url) => set(s => {
        if (!url || url === 'about:blank') return {}
        // Collapse consecutive duplicates of the same URL.
        if (s.browserHistory[0]?.url === url) {
          const [first, ...rest] = s.browserHistory
          return { browserHistory: [{ ...first, title: title || first.title, visitedAt: Date.now() }, ...rest] }
        }
        const entry = { id: `h-${Date.now()}`, title: title || url, url, visitedAt: Date.now() }
        return { browserHistory: [entry, ...s.browserHistory].slice(0, 500) }
      }),
      clearHistory: () => set({ browserHistory: [] }),

      savedLayouts: [],
      saveCurrentLayout: (name) => set(s => {
        const profileIds = s.tabs.map(t => t.layout?.profileId)
        return {
          savedLayouts: [
            ...s.savedLayouts,
            { id: `layout-${Date.now()}`, name, tabCount: s.tabs.length, profileIds }
          ]
        }
      }),
      deleteSavedLayout: (id) => set(s => ({
        savedLayouts: s.savedLayouts.filter(l => l.id !== id)
      })),

      // Tabs
      tabs: [newTab()],
      activeTabId: 'tab-1',

      addTab: (profileId?: string, cwd?: string) => {
        const state = get()
        // Inherit CWD from active tab or profile's saved CWD
        const activeTab = state.tabs.find(t => t.id === state.activeTabId)
        const profile = profileId ? state.profiles.find(p => p.id === profileId) : undefined
        // A directory set on the profile is a choice, so it beats inheriting.
        const inheritedCwd = (typeof cwd === 'string' && cwd) || profile?.cwd || activeTab?.currentCwd
          || state.profileCwds[profileId || 'default']
          || (typeof window !== 'undefined' ? (window as any).fterm?.homedir : undefined)
          || undefined
        const tab = newTab(profileId, inheritedCwd)
        if (inheritedCwd) tab.currentCwd = inheritedCwd
        if (profile?.color && PROFILE_COLORS[profile.color]) tab.color = PROFILE_COLORS[profile.color]
        set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activeView: 'terminal' }))
      },
      addTabWithCommand: (command: string, cwd?: string, title?: string) => {
        const paneId = newPaneId()
        const id = `tab-${++tabCounter}`
        const color = TAB_PALETTE[(tabCounter - 1) % TAB_PALETTE.length]
        const tab: Tab = {
          id,
          title: title || 'Run',
          color,
          layout: {
            id: newSplitId(),
            type: 'pane',
            paneId,
            initialCwd: cwd,
            initialCommand: command,
          },
          activePaneId: paneId,
        }
        set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activeView: 'terminal' }))
      },
      addEditorTab: (content?: string, language?: string, filePath?: string) => {
        if (filePath) {
          const existing = get().tabs.find(t => t.type === 'editor' && t.editorFilePath === filePath)
          if (existing) { set({ activeTabId: existing.id, activeView: 'terminal' }); return }
        }
        const tab: Tab = {
          id: `tab-${++tabCounter}`,
          title: filePath ? filePath.split(/[/\\]/).pop() || 'Text Editor' : 'Text Editor',
          type: 'editor',
          editorContent: content || '',
          editorLanguage: language || 'plaintext',
          editorFilePath: filePath,
          // A file opened from disk starts clean; a blank scratch buffer has
          // nothing on disk to compare against and stays undefined.
          editorSavedContent: filePath ? (content || '') : undefined,
        }
        set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activeView: 'terminal' }))
      },
      addBrowserTab: (url?: string) => {
        const tab: Tab = {
          id: `tab-${++tabCounter}`,
          title: 'Browser',
          color: TAB_PALETTE[(tabCounter - 1) % TAB_PALETTE.length],
          type: 'browser',
          browserUrl: url || get().settings.browserHomepage || 'https://start.duckduckgo.com/',
        }
        set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, activeView: 'terminal' }))
      },
      // Remove a tab that has been torn off into another window. Unlike closeTab,
      // this does NOT kill the PTY sessions — they live on in the new window.
      detachTabAway: (id) => {
        const { tabs, activeTabId } = get()
        if (tabs.length <= 1) return
        const idx = tabs.findIndex(t => t.id === id)
        if (idx === -1) return
        const remaining = tabs.filter(t => t.id !== id)
        const nextActive = activeTabId === id
          ? remaining[Math.max(0, idx - 1)]?.id ?? remaining[0].id
          : activeTabId
        set({ tabs: remaining, activeTabId: nextActive })
      },
      // Receive a tab dragged in from another window (merge-back).
      adoptTab: (tab) => {
        const n = parseInt(String(tab.id).replace(/^tab-/, ''), 10)
        if (!isNaN(n)) setTabCounterBase(n)
        set(s => s.tabs.some(t => t.id === tab.id)
          ? { activeTabId: tab.id, activeView: 'terminal' }
          : { tabs: [...s.tabs, tab], activeTabId: tab.id, activeView: 'terminal' })
      },
      // Track the live URL of a browser tab so it survives window moves (re-opens same page).
      setTabBrowserUrl: (id, url) => set(s => ({
        tabs: s.tabs.map(t => t.id === id ? { ...t, browserUrl: url } : t)
      })),
      setEditorContent: (tabId, content) => set(s => ({
        tabs: s.tabs.map(t => t.id === tabId ? { ...t, editorContent: content } : t)
      })),
      setEditorLanguage: (tabId, language) => set(s => ({
        tabs: s.tabs.map(t => t.id === tabId ? { ...t, editorLanguage: language } : t)
      })),
      setEditorFilePath: (tabId, filePath) => set(s => ({
        tabs: s.tabs.map(t => t.id === tabId ? { ...t, editorFilePath: filePath } : t)
      })),
      markEditorSaved: (tabId, content) => set(s => ({
        tabs: s.tabs.map(t => t.id === tabId ? { ...t, editorContent: content, editorSavedContent: content } : t)
      })),
      closeTab: (id) => {
        const { tabs, activeTabId } = get()
        if (tabs.length === 1) return

        // Deep wipe PTY sessions managed by this tab
        const tab = tabs.find(t => t.id === id)
        if (tab?.layout) {
          const killPanes = (node: import('../types').SplitNode) => {
            if (node.type === 'pane' && node.paneId) window.fterm.ptyKill(`${id}-${node.paneId}`)
            if (node.first) killPanes(node.first)
            if (node.second) killPanes(node.second)
          }
          killPanes(tab.layout)
        }

        const idx = tabs.findIndex(t => t.id === id)
        const next = tabs[idx === 0 ? 1 : idx - 1]
        set({ tabs: tabs.filter(t => t.id !== id), activeTabId: activeTabId === id ? next.id : activeTabId })
      },
      closeOtherTabs: (id) => {
        const { tabs } = get()
        tabs.forEach(t => {
          if (t.id === id || !t.layout) return
          const killPanes = (node: import('../types').SplitNode) => {
            if (node.type === 'pane' && node.paneId) window.fterm.ptyKill(`${t.id}-${node.paneId}`)
            if (node.first) killPanes(node.first)
            if (node.second) killPanes(node.second)
          }
          killPanes(t.layout)
        })
        set({ tabs: tabs.filter(t => t.id === id), activeTabId: id })
      },
      duplicateTab: (id) => {
        const { tabs } = get()
        const src = tabs.find(t => t.id === id)
        if (!src) return
        const tab = newTab(src.layout?.profileId, src.currentCwd)
        tab.title = src.title
        set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      },
      setActiveTab: (id) => set({ activeTabId: id }),
      updateTabTitle: (id, title) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, title, manualTitle: true } : t) })),
      setTabColor: (id, color) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, color } : t) })),
      setTabOscTitle: (id, title) => set(s => ({ tabs: s.tabs.map(t => t.id === id && !t.manualTitle ? { ...t, title } : t) })),
      reorderTabs: (fromIndex, toIndex) => set(s => {
        const newTabs = [...s.tabs]
        const [removed] = newTabs.splice(fromIndex, 1)
        newTabs.splice(toIndex, 0, removed)
        return { tabs: newTabs }
      }),
      setTabPid: (_tabId, _paneId, _pid) => { /* pid not stored in state — PTY manager owns it */ },

      // Panes
      splitPane: (tabId, paneId, direction) => {
        const newPaneIdStr = newPaneId()
        set(s => ({
          tabs: s.tabs.map(t => {
            if (t.id !== tabId || !t.layout) return t
            const newLayout = updateTreeNode(t.layout, paneId, n => {
              if (n.type !== 'pane') return n
              const { paneId: existingPaneId, ...rest } = n
              return {
                ...rest,
                type: 'split' as const,
                direction,
                size: 50,
                first: { id: newSplitId(), type: 'pane' as const, paneId: existingPaneId },
                second: { id: newSplitId(), type: 'pane' as const, paneId: newPaneIdStr },
              }
            })
            return { ...t, layout: newLayout, activePaneId: newPaneIdStr }
          })
        }))
      },

      closePane: (tabId, paneId) => {
        window.fterm.ptyKill(`${tabId}-${paneId}`) // explicitly clean up persistent PTYs when users actually close it
        set(s => {
          const tab = s.tabs.find(t => t.id === tabId);
          if (!tab || !tab.layout) return s;

          if (tab.layout.type === 'pane' && tab.layout.paneId === paneId) {
            if (s.tabs.length > 1) {
              const idx = s.tabs.findIndex(t => t.id === tabId);
              const next = s.tabs[idx === 0 ? 1 : idx - 1];
              return { tabs: s.tabs.filter(t => t.id !== tabId), activeTabId: s.activeTabId === tabId ? next.id : s.activeTabId };
            }
            return s;
          }

          const newLayout = cloneNode(tab.layout);
          const parent = findParent(newLayout, paneId);

          if (parent) {
            const isFirst = parent.first?.paneId === paneId || parent.first?.id === paneId;
            const sibling = isFirst ? parent.second : parent.first;

            if (sibling) {
              parent.type = sibling.type;
              parent.direction = sibling.direction;
              parent.size = sibling.size;
              parent.first = sibling.first;
              parent.second = sibling.second;
              parent.paneId = sibling.paneId;
            }

            let newActivePaneId = tab.activePaneId;
            if (tab.activePaneId === paneId) {
              newActivePaneId = getFirstPaneId(newLayout) || '';
            }

            return {
              tabs: s.tabs.map(t => t.id === tabId ? { ...t, layout: newLayout, activePaneId: newActivePaneId } : t)
            };
          }

          return s;
        });
      },

      setActivePane: (tabId, paneId) => {
        set(s => ({
          tabs: s.tabs.map(t => t.id === tabId ? { ...t, activePaneId: paneId } : t)
        }));
      },

      resizePane: (tabId, splitId, newSize) => {
        set(s => ({
          tabs: s.tabs.map(t => {
            if (t.id !== tabId || !t.layout) return t
            const newLayout = updateTreeNode(t.layout, splitId, n => ({ ...n, size: newSize }))
            if (newLayout === t.layout) return t
            return { ...t, layout: newLayout }
          })
        }))
      },

      // Theme
      activeThemeId: 'github-dark',
      themes: THEMES,
      setTheme: (id) => set({ activeThemeId: id }),
      addTheme: (theme) => set(s => ({ themes: [...s.themes, theme] })),
      updateTheme: (id, updates) => set(s => ({
        themes: s.themes.map(t => t.id === id ? { ...t, ...updates } : t)
      })),
      deleteTheme: (id) => set(s => ({
        themes: s.themes.filter(t => t.id !== id),
        activeThemeId: s.activeThemeId === id ? 'github-dark' : s.activeThemeId,
      })),

      // Pet
      pet: {
        type: 'cat',
        name: 'Void',
        visible: true,
        level: 1,
        xp: 0,
        maxXp: 100,
        stats: { commitsMade: 0, commandsRun: 0, daysActive: 1, linesWritten: 0 },
        coins: 0,
        achievements: [],
        ownedCosmetics: [],
        equippedCosmetic: null,
      },
      petProgress: {},
      petState: 'idle',
      petMessage: null,
      lastActivity: 'idle',
      setPetState: (petState) => set({ petState }),
      setPetMessage: (petMessage) => set({ petMessage }),
      setLastActivity: (lastActivity) => set({ lastActivity }),
      setPetConfig: (config) => set(s => {
        // If switching type, save current pet's full progress (including name) and restore new type's
        if (config.type && config.type !== s.pet.type) {
          const DEFAULT_NAMES: Record<string, string> = {
            cat: 'Void', dog: 'Buddy', dragon: 'Ember', robot: 'R2', ghost: 'Boo', fox: 'Foxy',
          }
          const savedProgress = {
            ...s.petProgress,
            [s.pet.type]: { level: s.pet.level, xp: s.pet.xp, maxXp: s.pet.maxXp, name: s.pet.name },
          }
          const restored = savedProgress[config.type] ?? {
            level: 1, xp: 0, maxXp: 100,
            name: DEFAULT_NAMES[config.type] ?? config.type,
          }
          return {
            petProgress: savedProgress,
            pet: { ...s.pet, ...config, level: restored.level, xp: restored.xp, maxXp: restored.maxXp, name: restored.name },
          }
        }
        return { pet: { ...s.pet, ...config } }
      }),
      addPetXp: (amount) => set(s => {
        const { newXp, newLevel, newMaxXp } = applyXp(s.pet.xp, s.pet.level, s.pet.maxXp, amount)
        const levels = newLevel - s.pet.level
        if (levels > 0) {
          setTimeout(() => {
            useStore.getState().setPetState('celebrating')
            useStore.getState().setPetMessage(`Level ${newLevel}! +${COIN_EVENTS.levelUp * levels} coins`)
            setTimeout(() => useStore.getState().setPetState('idle'), 5000)
          }, 0)
        }
        return {
          pet: {
            ...s.pet,
            xp: newXp, level: newLevel, maxXp: newMaxXp,
            coins: (s.pet.coins ?? 0) + (levels > 0 ? COIN_EVENTS.levelUp * levels : 0),
          },
        }
      }),

      // Pet — achievements, coins and cosmetics
      checkPetAchievements: () => {
        const s = get()
        const metrics = deriveMetrics(s.pet, s.terminalStats)
        const earned = evaluateAchievements(metrics, s.pet.achievements ?? [])
        if (!earned.length) return

        const reward = totalReward(earned)
        set(st => ({
          pet: {
            ...st.pet,
            coins: (st.pet.coins ?? 0) + reward,
            achievements: [...(st.pet.achievements ?? []), ...earned.map(a => a.id)],
          },
        }))
        // Announce one badge at a time — a burst of bubbles reads as noise.
        const first = earned[0]
        const extra = earned.length > 1 ? ` (+${earned.length - 1} more)` : ''
        get().setPetState('celebrating')
        get().setPetMessage(`${first.name} unlocked! +${reward} coins${extra}`)
        setTimeout(() => {
          if (useStore.getState().petState === 'celebrating') useStore.getState().setPetState('idle')
          useStore.getState().setPetMessage(null)
        }, 5000)
      },
      awardPetCoins: (amount) => set(s => ({
        pet: { ...s.pet, coins: Math.max(0, (s.pet.coins ?? 0) + amount) },
      })),
      buyCosmetic: (id) => {
        const s = get()
        const owned = s.pet.ownedCosmetics ?? []
        if (purchaseRefusal(id, s.pet.coins ?? 0, owned, s.pet.achievements ?? [])) return false
        const price = getCosmetic(id)!.price
        set(st => ({
          pet: {
            ...st.pet,
            coins: (st.pet.coins ?? 0) - price,
            ownedCosmetics: [...(st.pet.ownedCosmetics ?? []), id],
            equippedCosmetic: id,   // wearing what you just bought is the expected outcome
          },
        }))
        return true
      },
      equipCosmetic: (id) => set(s => {
        // Only something already owned can be worn.
        if (id !== null && !(s.pet.ownedCosmetics ?? []).includes(id)) return s
        return { pet: { ...s.pet, equippedCosmetic: id } }
      }),
      petGitEvent: (event) => {
        const REACTIONS: Record<string, { coins: number; state: PetState; message: string; hold: number }> = {
          commit: { coins: COIN_EVENTS.commit, state: 'celebrating', message: `Commit! +${COIN_EVENTS.commit} coins`, hold: 4000 },
          push: { coins: COIN_EVENTS.push, state: 'happy', message: `Pushed! +${COIN_EVENTS.push} coins`, hold: 3500 },
          conflict: { coins: 0, state: 'worried', message: 'Merge conflict — I believe in you.', hold: 5000 },
          clean: { coins: 0, state: 'happy', message: 'Working tree clean.', hold: 2500 },
        }
        const r = REACTIONS[event]
        if (!r) return
        if (r.coins) get().awardPetCoins(r.coins)
        get().setPetState(r.state)
        get().setPetMessage(r.message)
        setTimeout(() => {
          const st = useStore.getState()
          if (st.petState === r.state) st.setPetState('idle')
          st.setPetMessage(null)
        }, r.hold)
        get().checkPetAchievements()
      },

      // AI
      ai: {
        provider: 'none',
        model: '',
        effort: 'auto',
        sidebarOpen: false,
        ollamaUrl: 'http://localhost:11434',
        openaiUrl: '',
        githubClientId: '',
        providerStatus: {},
      },
      setAIConfig: (config) => set(s => ({ ai: { ...s.ai, ...config } })),
      setProviderStatus: (provider, status) =>
        set(s => ({
          ai: {
            ...s.ai,
            providerStatus: {
              ...s.ai.providerStatus,
              [provider]: { ...s.ai.providerStatus[provider], ...status },
            },
          },
        })),

      // Chat
      chatMessages: [],
      commandHistory: [],
      addCommandHistory: (command) => {
        set(s => {
        const { newXp, newLevel, newMaxXp } = applyXp(s.pet.xp, s.pet.level, s.pet.maxXp, 15)
        const petStats = { ...s.pet.stats, commandsRun: (s.pet.stats?.commandsRun || 0) + 1 }
        const history = [...s.commandHistory, command].slice(-1000)

        const today = getDayStart()
        const ts = s.terminalStats
        const prevDay = ts.activityLog[today] ?? { commands: 0, errors: 0, sessions: 0 }
        const isNewSession = ts.lastSessionDate !== today
        const updatedDay: DailyActivity = {
          ...prevDay,
          commands: prevDay.commands + 1,
          sessions: isNewSession ? prevDay.sessions + 1 : prevDay.sessions,
        }
        const updatedLog = pruneActivityLog({ ...ts.activityLog, [today]: updatedDay })
        const { current, longest } = computeStreaks(updatedLog)
        const base = extractBaseCommand(command)
        const freq = { ...ts.commandFrequency, [base]: (ts.commandFrequency[base] || 0) + 1 }
        const hour = new Date().getHours()
        const hourly = [...ts.hourlyActivity]
        hourly[hour] = (hourly[hour] || 0) + 1

        return {
          commandHistory: history,
          pet: { ...s.pet, xp: newXp, level: newLevel, maxXp: newMaxXp, stats: petStats },
          terminalStats: {
            ...ts,
            activityLog: updatedLog,
            currentStreak: current,
            longestStreak: Math.max(longest, ts.longestStreak),
            commandFrequency: freq,
            hourlyActivity: hourly,
            lastSessionDate: today,
          },
        }
        })
        // Achievements read the counters this call just bumped.
        get().checkPetAchievements()
      },
      addChatMessage: (msg, explicitId?) => {
        const id = explicitId ?? newMsgId()
        set(s => ({
          chatMessages: [...s.chatMessages, { ...msg, id, timestamp: Date.now() }],
        }))
        return id
      },
      updateChatMessage: (id, update) =>
        set(s => ({ chatMessages: s.chatMessages.map(m => m.id === id ? { ...m, ...update } : m) })),
      appendChatContent: (id, text) =>
        set(s => {
          const idx = s.chatMessages.findIndex(m => m.id === id)
          if (idx === -1) return s
          const updated = [...s.chatMessages]
          updated[idx] = { ...updated[idx], content: updated[idx].content + text }
          return { chatMessages: updated }
        }),
      clearChat: () => set({ chatMessages: [] }),

      // Pending widget trigger
      pendingWidget: null,
      setPendingWidget: (w) => set({ pendingWidget: w }),

      // Git
      git: {
        currentRepo: null,
        status: null,
        branches: [],
        commits: [],
        remotes: [],
        stats: null,
        loading: false,
        error: null,
      },
      setGitRepo: async (path) => {
        set(s => ({ git: { ...s.git, currentRepo: path, loading: true, error: null } }))
        if (!path) {
          set(s => ({ git: { ...s.git, loading: false, status: null, branches: [], commits: [], remotes: [] } }))
          return
        }
        try {
          const isRepo = await window.fterm.git.repository(path)
          if (!isRepo) {
            set(s => ({ git: { ...s.git, loading: false, error: 'Not a git repository' } }))
            return
          }
          const [status, branches, commits, remotes, stats] = await Promise.all([
            window.fterm.git.status(path),
            window.fterm.git.branches(path),
            window.fterm.git.log(path, 50),
            window.fterm.git.remotes(path),
            window.fterm.git.stats(path),
          ])
          set(s => ({ git: { ...s.git, loading: false, status, branches, commits, remotes, stats } }))
        } catch (e: any) {
          set(s => ({ git: { ...s.git, loading: false, error: e.message } }))
        }
      },
      refreshGitStatus: async () => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        set(s => ({ git: { ...s.git, loading: true, error: null } }))
        try {
          const [status, branches, commits, stats] = await Promise.all([
            window.fterm.git.status(currentRepo),
            window.fterm.git.branches(currentRepo),
            window.fterm.git.log(currentRepo, 50),
            window.fterm.git.stats(currentRepo),
          ])
          const hadConflicts = get().git.status?.hasConflicts ?? false
          set(s => ({ git: { ...s.git, loading: false, status, branches, commits, stats } }))
          // Only on the transition, so the pet doesn't sulk on every refresh.
          if (status?.hasConflicts && !hadConflicts) get().petGitEvent('conflict')
        } catch (e: any) {
          set(s => ({ git: { ...s.git, loading: false, error: e.message } }))
        }
      },
      gitCheckout: async (branch) => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        try {
          await window.fterm.git.checkout(currentRepo, branch)
          await get().refreshGitStatus()
        } catch (e: any) {
          set(s => ({ git: { ...s.git, error: e.message } }))
        }
      },
      gitCommit: async (message) => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        try {
          await window.fterm.git.commit(currentRepo, message)
          await get().refreshGitStatus()
          get().addPetXp(50) // Bonus XP for committing
          set(s => ({
            pet: {
              ...s.pet,
              stats: { ...s.pet.stats, commitsMade: (s.pet.stats?.commitsMade || 0) + 1 }
            }
          }))
          get().petGitEvent('commit')   // coins + celebration, then achievement sweep
        } catch (e: any) {
          set(s => ({ git: { ...s.git, error: e.message } }))
        }
      },
      gitPush: async (remote, branch) => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        set(s => ({ git: { ...s.git, loading: true } }))
        try {
          await window.fterm.git.push(currentRepo, remote, branch)
          await get().refreshGitStatus()
          set(s => ({ git: { ...s.git, loading: false } }))
          get().petGitEvent('push')
        } catch (e: any) {
          set(s => ({ git: { ...s.git, loading: false, error: e.message } }))
        }
      },
      gitPull: async (remote, branch) => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        set(s => ({ git: { ...s.git, loading: true } }))
        try {
          await window.fterm.git.pull(currentRepo, remote, branch)
          await get().refreshGitStatus()
          set(s => ({ git: { ...s.git, loading: false } }))
        } catch (e: any) {
          set(s => ({ git: { ...s.git, loading: false, error: e.message } }))
        }
      },

      gitStageFile: async (filePath) => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        try {
          await window.fterm.git.stage(currentRepo, filePath)
          await get().refreshGitStatus()
        } catch (e: any) {
          set(s => ({ git: { ...s.git, error: e.message } }))
        }
      },
      gitUnstageFile: async (filePath) => {
        const { currentRepo } = get().git
        if (!currentRepo) return
        try {
          await window.fterm.git.unstage(currentRepo, filePath)
          await get().refreshGitStatus()
        } catch (e: any) {
          set(s => ({ git: { ...s.git, error: e.message } }))
        }
      },

      // Usage
      usage: {},
      recordUsage: (data) => {
        const weekStart = getWeekStart()
        const dayStart = getDayStart()
        set(s => {
          const prev = s.usage[data.provider] ?? {
            sessionInput: 0, sessionOutput: 0,
            dayInput: 0, dayOutput: 0,
            dayStart,
            weekInput: 0, weekOutput: 0,
            weekStart, lastModel: data.model,
          }
          // Reset week/day counters if rollover
          const resetWeek = prev.weekStart !== weekStart
          const resetDay = prev.dayStart !== dayStart
          return {
            usage: {
              ...s.usage,
              [data.provider]: {
                sessionInput: prev.sessionInput + data.inputTokens,
                sessionOutput: prev.sessionOutput + data.outputTokens,
                dayInput: (resetDay ? 0 : (prev.dayInput || 0)) + data.inputTokens,
                dayOutput: (resetDay ? 0 : (prev.dayOutput || 0)) + data.outputTokens,
                dayStart,
                weekInput: (resetWeek ? 0 : prev.weekInput) + data.inputTokens,
                weekOutput: (resetWeek ? 0 : prev.weekOutput) + data.outputTokens,
                weekStart,
                lastModel: data.model,
              } satisfies ProviderUsage,
            },
          }
        })
      },

      // Terminal activity stats
      terminalStats: { ...DEFAULT_TERMINAL_STATS },
      recordTerminalError: () => set(s => {
        const today = getDayStart()
        const ts = s.terminalStats
        const prevDay = ts.activityLog[today] ?? { commands: 0, errors: 0, sessions: 0 }
        const updatedLog = { ...ts.activityLog, [today]: { ...prevDay, errors: prevDay.errors + 1 } }
        return {
          terminalStats: { ...ts, activityLog: updatedLog, totalErrors: ts.totalErrors + 1 },
        }
      }),

      // ftermfetch customization
      ftermfetchConfig: { ...DEFAULT_FTERMFETCH_CONFIG, fields: DEFAULT_FTERMFETCH_CONFIG.fields.map(f => ({ ...f })) },
      setFtermfetchConfig: (updates) => set(s => ({ ftermfetchConfig: { ...s.ftermfetchConfig, ...updates } })),
      setFetchFieldColor: (id, color) => set(s => ({
        ftermfetchConfig: { ...s.ftermfetchConfig, fieldColors: { ...s.ftermfetchConfig.fieldColors, [id]: color } }
      })),
      reorderFetchField: (id, direction) => set(s => {
        const fields = [...s.ftermfetchConfig.fields]
        const idx = fields.findIndex(f => f.id === id)
        if (idx === -1) return s
        const newIdx = direction === 'up' ? idx - 1 : idx + 1
        if (newIdx < 0 || newIdx >= fields.length) return s
        ;[fields[idx], fields[newIdx]] = [fields[newIdx], fields[idx]]
        return { ftermfetchConfig: { ...s.ftermfetchConfig, fields } }
      }),
      toggleFetchField: (id) => set(s => ({
        ftermfetchConfig: {
          ...s.ftermfetchConfig,
          fields: s.ftermfetchConfig.fields.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)
        }
      })),

      // Settings
      settings: {
        fontSize: 14,
        fontFamily: "'Fira Code', 'Cascadia Code', monospace",
        ligatures: true,
        opacity: 0.85,
        blurEnabled: true,
        backgroundImage: '',
        backgroundBlur: 10,
        terminalPadding: 8,
        lineHeight: 1.2,
        cursorStyle: 'block',
        cursorBlink: true,
        scrollback: 10000,
        copyOnSelect: true,
        syncPaneScroll: false,
        showRecordingButton: true,
        showAIAutoFixButton: true,
        explorerOpenInTerminal: true,
        vizPetVibe: true,
        terminalTextEditor: 'nano',
        settingsPanelOpen: false,
        activeSettingsTab: 'general',
        layout: {
          navSidebarPosition: 'left',
          aiSidebarPosition: 'right'
        }
      },
      setSettings: (s) => set(state => ({ settings: { ...state.settings, ...s } })),

      // Keybindings
      keybindings: { ...DEFAULT_KEYBINDINGS },
      setKeybinding: (action, keys) => set(s => ({ keybindings: { ...s.keybindings, [action]: keys } })),
      resetKeybindings: () => set({ keybindings: { ...DEFAULT_KEYBINDINGS } }),

      // Remote terminal
      remoteTerminal: { enabled: false, port: 7681, pin: '', clients: 0 },
      setRemoteTerminal: (updates) => set(s => ({ remoteTerminal: { ...s.remoteTerminal, ...updates } })),
    }),
    {
      // Detached windows persist to their own key so they never clobber the main
      // window's tab list (and don't rehydrate it on open).
      name: IS_DETACHED ? `fterm-win-${ADOPT_TOKEN}` : 'fterm-v1',
      storage: createJSONStorage(() => throttledStorage),
      merge: (persisted: any, current) => {
        // Sync tabCounter so new tabs never collide with rehydrated tab IDs
        if (persisted?.tabs?.length) {
          for (const t of persisted.tabs) {
            const n = parseInt(String(t.id).replace('tab-', ''), 10)
            if (!isNaN(n) && n > tabCounter) tabCounter = n
            // Sync pane/split counters too — otherwise a split after reload reuses an
            // existing paneId, giving two panes the same instanceId (tab-X-pane-N).
            // That binds both panes to the same PTY session → input/output in both.
            if (t.layout) {
              const walk = (node: SplitNode) => {
                const pn = parseInt(String(node.paneId ?? '').replace('pane-', ''), 10)
                if (!isNaN(pn) && pn > paneCounter) paneCounter = pn
                const sn = parseInt(String(node.id ?? '').replace('split-', ''), 10)
                if (!isNaN(sn) && sn > splitCounter) splitCounter = sn
                if (node.first) walk(node.first)
                if (node.second) walk(node.second)
              }
              walk(t.layout)
            }
          }
        }
        return ({
        ...current,
        ...persisted,
        // Merge built-in themes with persisted custom themes
        themes: [
          ...THEMES,
          ...(((persisted as Record<string, unknown>)?.customThemes as Theme[]) ?? []),
        ],
        tabs: persisted?.tabs?.length ? persisted.tabs : current.tabs,
        activeTabId: persisted?.activeTabId ?? current.activeTabId,
        pet: { ...current.pet, ...persisted?.pet },
        petProgress: { ...(persisted as Record<string, unknown>)?.petProgress as Record<string, unknown> },
        ai: { ...current.ai, ...persisted?.ai },
        settings: { ...current.settings, ...persisted?.settings },
        // Merge plugins: keep built-ins (with persisted enabled state), append custom plugins
        plugins: (() => {
          const persistedPlugins: typeof current.plugins = (persisted as any)?.plugins ?? []
          const persistedMap = new Map(persistedPlugins.map((p: any) => [p.id, p]))
          const builtins = current.plugins.map(p => ({
            ...p,
            enabled: (persistedMap.get(p.id) as any)?.enabled ?? p.enabled,
          }))
          const customPlugins = persistedPlugins.filter((p: any) => p.isCustom)
          return [...builtins, ...customPlugins]
        })(),
        chatMessages: persisted?.chatMessages ?? [],
        snippets: (persisted as any)?.snippets ?? [],
        sshHosts: (persisted as any)?.sshHosts ?? [],
        notes: (persisted as any)?.notes ?? [],
        bookmarks: (persisted as any)?.bookmarks ?? [],
        savedLayouts: (persisted as any)?.savedLayouts ?? [],
        keybindings: { ...DEFAULT_KEYBINDINGS, ...(persisted as any)?.keybindings },
        remoteTerminal: { port: 7681, ...(persisted as any)?.remoteTerminal, enabled: false, pin: '', clients: 0 },
        terminalStats: {
          ...DEFAULT_TERMINAL_STATS,
          ...(persisted as any)?.terminalStats,
          hourlyActivity: (persisted as any)?.terminalStats?.hourlyActivity ?? Array(24).fill(0),
        },
        ftermfetchConfig: (() => {
          const saved = (persisted as any)?.ftermfetchConfig
          if (!saved) return { ...DEFAULT_FTERMFETCH_CONFIG, fields: DEFAULT_FTERMFETCH_CONFIG.fields.map(f => ({ ...f })) }
          // Merge: add any new fields from defaults that aren't in saved, preserve order of saved
          const savedIds = new Set(saved.fields?.map((f: any) => f.id) ?? [])
          const newFields = DEFAULT_FTERMFETCH_CONFIG.fields.filter(f => !savedIds.has(f.id))
          return { ...DEFAULT_FTERMFETCH_CONFIG, ...saved, fields: [...(saved.fields ?? []), ...newFields] }
        })(),
      })},
      partialize: (s) => ({
        activeThemeId: s.activeThemeId,
        // Persist only custom (non-built-in) themes
        customThemes: s.themes.filter(t => !THEMES.find(bt => bt.id === t.id)),
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        pet: s.pet,
        petProgress: s.petProgress,
        profileCwds: s.profileCwds,
        dirVisits: s.dirVisits,
        // Persist chat history (streaming messages are cleaned up before save)
        chatMessages: s.chatMessages
          .filter(m => !m.streaming)
          .slice(-100), // keep last 100 messages
        ai: {
          provider: s.ai.provider,
          model: s.ai.model,
          effort: s.ai.effort,
          ollamaUrl: s.ai.ollamaUrl,
          ollamaModel: (s.ai as any).ollamaModel,
          githubClientId: s.ai.githubClientId,
          systemPrompt: (s.ai as any).systemPrompt,
          quickActions: s.ai.quickActions,
          providerStatus: {},  // reset on load; runtime state only
          sidebarOpen: false,
        },
        plugins: s.plugins,
        snippets: s.snippets,
        sshHosts: s.sshHosts,
        notes: s.notes,
        bookmarks: s.bookmarks,
        savedLayouts: s.savedLayouts,
        keybindings: s.keybindings,
        remoteTerminal: { enabled: false, port: s.remoteTerminal.port, pin: '', clients: 0 },
        terminalStats: s.terminalStats,
        ftermfetchConfig: s.ftermfetchConfig,
        settings: { ...s.settings, settingsPanelOpen: false },
        // Persist day/week counters (session resets on restart)
        usage: Object.fromEntries(
          Object.entries(s.usage).map(([k, v]) => [
            k,
            {
              weekInput: v!.weekInput, weekOutput: v!.weekOutput, weekStart: v!.weekStart,
              dayInput: v!.dayInput, dayOutput: v!.dayOutput, dayStart: v!.dayStart,
              lastModel: v!.lastModel,
              sessionInput: 0, sessionOutput: 0
            },
          ])
        ),
        claudeCodeUsage: { ...s.claudeCodeUsage, sessionCost: 0 },
      }),
    }
  )
)

// ─── Derived selectors ────────────────────────────────────────────────────────

export const useActiveTheme = () =>
  useStore(s => s.themes.find(t => t.id === s.activeThemeId) ?? s.themes[0])
