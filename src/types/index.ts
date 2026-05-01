export interface Pane {
  id: string
  shellPid?: number
  shell?: string
  shellArgs?: string[]
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
  type?: 'terminal' | 'editor'
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

export type PetState =
  | 'idle' | 'happy' | 'sad' | 'working' | 'sleeping' | 'celebrating' | 'worried'

export type PetType = 'cat' | 'dog' | 'dragon' | 'robot' | 'ghost' | 'fox'

export interface PetStats {
  commitsMade?: number
  commandsRun?: number
  daysActive?: number
  linesWritten?: number
}

export interface PetConfig {
  type: PetType
  name: string
  visible: boolean
  level: number
  xp: number
  maxXp: number
  stats: PetStats
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
  showRecordingButton: boolean
  showAIAutoFixButton: boolean
  explorerOpenInTerminal?: boolean
  terminalTextEditor?: string
  settingsPanelOpen: boolean
  activeSettingsTab?: 'general' | 'theme' | 'ai' | 'pet' | 'stats' | 'shortcuts' | 'remote'
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
