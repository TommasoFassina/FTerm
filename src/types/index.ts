export interface Pane {
  id: string
  shellPid?: number
  shell?: string
  shellArgs?: string[]
}

export interface SshHost {
  id: string
  label: string
  host: string
  user: string
  port?: number
  identityFile?: string
  extraArgs?: string
}

export interface Note {
  id: string
  title: string
  body: string
  updatedAt: number
}

export interface SplitNode {
  id: string
  type: 'pane' | 'split'
  direction?: 'horizontal' | 'vertical'
  size?: number // percentage for the first child
  first?: SplitNode
  second?: SplitNode
  paneId?: string
  profileId?: string
  initialCwd?: string
  initialCommand?: string
}

export interface Tab {
  id: string
  title: string
  color?: string
  type?: 'terminal' | 'editor' | 'browser'
  /** Initial URL for a browser tab (the webview tracks live URL internally) */
  browserUrl?: string
  layout?: SplitNode
  activePaneId?: string
  editorContent?: string
  editorLanguage?: string
  editorFilePath?: string
  /** Live CWD — updated via OSC 7 from PTY, not persisted */
  currentCwd?: string
  /** True when the user has manually renamed this tab — prevents auto-title updates */
  manualTitle?: boolean
}

export interface Bookmark {
  id: string
  title: string
  url: string
}

/** A visited page. Session-only — never persisted to disk. */
export interface BrowserHistoryEntry {
  id: string
  title: string
  url: string
  visitedAt: number
}

export interface Theme {
  id: string
  name: string
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string; red: string; green: string; yellow: string
  blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
}

export interface ClaudeCodeStats {
  tokensIn: number
  tokensOut: number
  cost: number | null
  contextPct: number | null
  model: string | null
}

export interface ClaudeCodeUsage {
  sessionCost: number
  dayCost: number
  dayStart: string
  weekCost: number
  weekStart: string
}

export type PetState =
  | 'idle' | 'happy' | 'sad' | 'working' | 'sleeping' | 'celebrating' | 'worried'

export type PetType = 'cat' | 'dog' | 'dragon' | 'robot' | 'ghost' | 'fox'

export interface PetStats {
  commitsMade?: number
  commandsRun?: number
  daysActive?: number
  linesWritten?: number
}

export interface DailyActivity {
  commands: number
  errors: number
  sessions: number
}

export interface TerminalStats {
  /** YYYY-MM-DD → daily activity; kept for last 400 days */
  activityLog: Record<string, DailyActivity>
  currentStreak: number
  longestStreak: number
  /** base command string → total run count */
  commandFrequency: Record<string, number>
  /** 24 buckets indexed by hour (0–23) */
  hourlyActivity: number[]
  totalErrors: number
  /** ISO date of last recorded session */
  lastSessionDate: string
}

export interface PetConfig {
  type: PetType
  name: string
  visible: boolean
  level: number
  xp: number
  maxXp: number
  stats: PetStats
  /** Currency earned from achievements and git activity; spent in the cosmetics shop. */
  coins?: number
  /** Ids of achievements already paid out (see `utils/petAchievements`). */
  achievements?: string[]
  /** Cosmetic ids the user has bought. */
  ownedCosmetics?: string[]
  /** Cosmetic currently worn above the sprite, or null. */
  equippedCosmetic?: string | null
}

export type AIProvider = 'claude' | 'openai' | 'copilot' | 'ollama' | 'gemini' | 'deepseek' | 'none'

export interface AIProviderStatus {
  connected: boolean
  testing: boolean
  error?: string
}

export interface QuickAction {
  label: string
  prompt: string
}

export interface AIConfig {
  provider: AIProvider
  model: string
  effort: EffortLevel
  sidebarOpen: boolean
  ollamaUrl: string
  ollamaModel?: string
  openaiUrl?: string
  githubClientId: string
  systemPrompt?: string
  quickActions?: QuickAction[]
  providerStatus: Partial<Record<AIProvider, AIProviderStatus>>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  provider?: AIProvider
  streaming?: boolean
  error?: string
  timestamp: number
}

export interface UsageData {
  model: string
  inputTokens: number
  outputTokens: number
  provider: AIProvider
}

export interface ProviderUsage {
  /** Tokens used this app session (resets on restart) */
  sessionInput: number
  sessionOutput: number
  /** Tokens used this calendar day (persisted) */
  dayInput: number
  dayOutput: number
  /** ISO date string of today */
  dayStart: string
  /** Tokens used this calendar week (persisted) */
  weekInput: number
  weekOutput: number
  /** ISO date string of the Monday this week started */
  weekStart: string
  /** Last model seen from this provider */
  lastModel: string
}

/** Effort level maps to model defaults (Claude-centric concept, generalized) */
export type EffortLevel = 'fast' | 'auto' | 'thorough'

export type FetchFieldId =
  | 'hostname' | 'os' | 'shell' | 'cpu' | 'memory'
  | 'uptime' | 'cwd' | 'petLevel' | 'aiProvider'
  | 'currentStreak' | 'commandsRun'

export interface FetchFieldConfig {
  id: FetchFieldId
  enabled: boolean
}

export interface FtermfetchConfig {
  fields: FetchFieldConfig[]
  /** 'theme' = derive from active FTerm theme; 'custom' = per-field hex colors */
  colorMode: 'theme' | 'custom'
  /** field id → hex color string (used when colorMode === 'custom') */
  fieldColors: Partial<Record<FetchFieldId, string>>
}

export interface AppSettings {
  fontSize: number
  fontFamily: string
  ligatures: boolean
  opacity: number
  blurEnabled: boolean
  backgroundImage?: string
  backgroundBlur?: number
  terminalPadding: number
  lineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  /** Sync scroll position across all split panes in the active tab */
  syncPaneScroll?: boolean
  showRecordingButton: boolean
  showAIAutoFixButton: boolean
  explorerOpenInTerminal?: boolean
  vizPetVibe?: boolean
  terminalTextEditor?: string
  settingsPanelOpen: boolean
  activeSettingsTab?: 'general' | 'ai' | 'pet' | 'stats' | 'shortcuts' | 'remote'
  hasSeenWelcome?: boolean
  layout?: {
    navSidebarPosition: 'left' | 'right' | 'hidden'
    aiSidebarPosition: 'left' | 'right' | 'hidden'
  }
  autoThemeConfig?: {
    morning: string   // 06:00–12:00
    afternoon: string // 12:00–18:00
    evening: string   // 18:00–22:00
    night: string     // 22:00–06:00
  }
  claudeStatusline?: {
    enabled: boolean
    command: string
    pollInterval: number  // ms, default 3000
  }
  autoRestartShell?: boolean
  statusBar?: {
    showCpuRam?: boolean
    showEffort?: boolean
    showTokens?: boolean
    showCwd?: boolean
    showClaudeStats?: boolean
    showProvider?: boolean
  }
  /** In-app browser: auto-update the bundled uBlock Origin Lite from GitHub. Default on. */
  browserUbolAutoUpdate?: boolean
  /** Drop-down (quake) terminal — toggled from anywhere by a global hotkey. */
  quake?: QuakeSettings
}

export interface QuakeSettings {
  enabled: boolean
  /** Electron accelerator, e.g. `Ctrl+\``. Validated in the main process. */
  hotkey: string
  /** Screen edge the window drops from. */
  position: 'top' | 'bottom'
  /** Height as a percent of the display work area (20–100). */
  height: number
  /** Width as a percent of the display work area (30–100). */
  width: number
  /** Drop onto the display under the cursor, or always the primary one. */
  monitor: 'cursor' | 'primary'
  /** Hide again the moment the window loses focus. */
  hideOnBlur: boolean
  /** Slide in, instead of appearing instantly. */
  animate: boolean
}

export const DEFAULT_QUAKE_SETTINGS: QuakeSettings = {
  enabled: false,
  hotkey: 'Ctrl+`',
  position: 'top',
  height: 45,
  width: 100,
  monitor: 'cursor',
  hideOnBlur: true,
  animate: true,
}

export interface GitStatus {
  branch: string
  stagedFiles: GitFile[]
  unstagedFiles: GitFile[]
  unmergedFiles: GitFile[]
  hasConflicts: boolean
  ahead: number
  behind: number
}

export interface GitFile {
  path: string
  status: string
  staged: boolean
}

export interface Commit {
  hash: string
  shortHash: string
  author: string
  email: string
  message: string
  date: string
}

export interface Branch {
  name: string
  isHead: boolean
  isRemote: boolean
}

export interface Remote {
  name: string
  url: string
}
