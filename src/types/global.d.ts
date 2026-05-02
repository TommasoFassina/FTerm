import type { AIProvider } from '@/types'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface AIRequest {
  requestId: string
  provider: AIProvider
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  model?: string
  ollamaUrl?: string
  openaiUrl?: string
}

interface FTermAPI {
  homedir: string

  // PTY
  ptyCreate: (tabId: string, cols: number, rows: number, shell?: string, args?: string[], cwd?: string, env?: Record<string, string>) => Promise<{ pid: number; sessionId: number; history: string; cwd: string }>
  ptyWrite: (tabId: string, data: string) => void
  ptyResize: (tabId: string, cols: number, rows: number) => void
  ptyKill: (tabId: string) => void
  onPtyData: (tabId: string, cb: (data: string) => void) => () => void
  onPtyExit: (tabId: string, sessionId: number, cb: (code: number) => void) => () => void

  // AI (streaming via IPC events)
  aiChat: (req: AIRequest) => Promise<void>
  aiCancel: (requestId: string) => void
  aiAutocomplete: (req: AIRequest) => Promise<string>
  aiTest: (provider: AIProvider, ollamaUrl?: string) => Promise<string>
  onAIChunk: (cb: (requestId: string, text: string) => void) => () => void
  onAIDone: (cb: (requestId: string) => void) => () => void
  onAIError: (cb: (requestId: string, err: string) => void) => () => void
  onAIUsage: (cb: (requestId: string, usage: import('@/types').UsageData) => void) => () => void

  // Secure key storage (keys never cross IPC boundary after set)
  keysSet: (provider: string, key: string) => Promise<void>
  keysDelete: (provider: string) => Promise<void>
  keysHas: (provider: string) => Promise<boolean>
  keysListConnected: () => Promise<string[]>

  // GitHub OAuth device flow
  githubOAuthStart: (clientId: string) => Promise<DeviceCodeResponse>
  githubOAuthPoll: (clientId: string, deviceCode: string, interval: number, expiresIn: number) => Promise<string>
  // GitHub OAuth redirect flow
  githubOAuthRedirect: (clientId: string) => Promise<void>
  onGithubOAuthStatus: (cb: (status: 'opened' | 'success') => void) => () => void

  // Import credentials from Claude Code CLI (~/.claude/.credentials.json)
  claudeImportFromCLI: () => Promise<boolean>

  // Provider OAuth (PKCE) — user-supplied OAuth client ID required
  openaiOAuthStart: (clientId: string) => Promise<void>
  geminiOAuthStart: (clientId: string) => Promise<void>
  onOpenAIOAuthStatus: (cb: (status: 'success') => void) => () => void
  onGeminiOAuthStatus: (cb: (status: 'success') => void) => () => void

  // Window
  setWindowOpacity: (v: number) => void
  setWindowBlur: (enabled: boolean) => void
  minimize: () => void
  maximize: () => void
  dragStart: () => void
  dragUpdate: () => void
  dragEnd: () => void
  close: () => void
  onWindowState: (cb: (state: { maximized: boolean; fullScreen: boolean }) => void) => () => void
  setWindowPosition: (x: number, y: number) => void
  getWindowPosition: () => Promise<[number, number]>
  isMaximized: () => Promise<boolean>
  openExternal: (url: string) => void
  openPath: (filePath: string) => void
  onHistorySearch: (cb: () => void) => () => void
  onPetShake: (cb: () => void) => () => void
  onPetStill: (cb: () => void) => () => void
  getSystemMetrics: () => Promise<{ cpus: any[], freeMem: number, totalMem: number, platform: string, release: string, hostname: string, username: string, arch: string, uptime: number, network: { rxKbps: number; txKbps: number; rxTotal: number; txTotal: number } }>
  pingHost: (host: string, count?: number) => Promise<{ host: string; rtts: number[]; lost: number; avg: number; min: number; max: number; count: number }>
  portScan: (host: string, ports: number[]) => Promise<{ port: number; open: boolean }[]>
  shellDetect: () => Promise<Array<{ id: string; name: string; shell: string; icon: string }>>
  shellExec: (command: string) => Promise<string>
  fsTempWrite: (filename: string, content: string) => Promise<string>
  fsOpenDialog: () => Promise<string | null>
  fsSaveDialog: (defaultName?: string, filters?: { name: string, extensions: string[] }[]) => Promise<string | null>
  fsReadFile: (filePath: string) => Promise<string>
  fsWriteFile: (filePath: string, content: string) => Promise<boolean>
  fsReadDir: (dirPath: string) => Promise<Array<{ name: string; isDir: boolean; size: number }>>
  fsDrives: () => Promise<Array<{ path: string; label: string; size: number; freeSpace: number }>>
  dockerPs: () => Promise<any[] | null>
  dockerLogs: (containerId: string) => Promise<string>
  dockerAction: (id: string, action: 'start' | 'stop') => Promise<void>
  systemProcesses: () => Promise<(string | number)[][]>

  // Recording
  recordingStop: (data: { snapshots: any[]; events: any[]; theme: any; fontFamily?: string; backgroundImage?: string; backgroundBlur?: number; backgroundOpacity?: number; generateSubtitlesWith?: string }) => Promise<{ videoPath: string }>
  onRecordingProgress: (cb: (percent: number) => void) => () => void
  captureRect: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>

  // Remote Terminal
  remoteStart: (port: number) => Promise<{ pin: string; localIp: string; allIps: string[]; qr: string; firewallOk: boolean }>
  remoteStop: () => Promise<void>
  remoteStatus: () => Promise<{ clients: number; localIp: string; allIps: string[] }>
  onRemoteClientChange: (cb: (clients: number) => void) => () => void

  // Git System
  git: {
    repository: (cwd: string) => Promise<boolean>
    status: (repoPath: string) => Promise<import('../../electron/services/gitService').GitStatus>
    branches: (repoPath: string) => Promise<import('../../electron/services/gitService').Branch[]>
    log: (repoPath: string, limit?: number) => Promise<import('../../electron/services/gitService').Commit[]>
    checkout: (repoPath: string, branch: string) => Promise<void>
    commit: (repoPath: string, message: string) => Promise<any>
    push: (repoPath: string, remote: string, branch: string) => Promise<void>
    pull: (repoPath: string, remote: string, branch: string) => Promise<void>
    remotes: (repoPath: string) => Promise<import('../../electron/services/gitService').Remote[]>
    stats: (repoPath: string) => Promise<{ totalCommits: number, workDays: number }>
    diff: (repoPath: string, args?: string[]) => Promise<string>
    stage: (repoPath: string, filePath: string) => Promise<void>
    unstage: (repoPath: string, filePath: string) => Promise<void>
    stashList: (repoPath: string) => Promise<{ index: number; message: string }[]>
    stashPush: (repoPath: string, message?: string) => Promise<void>
    stashPop: (repoPath: string, index: number) => Promise<void>
    stashApply: (repoPath: string, index: number) => Promise<void>
    stashDrop: (repoPath: string, index: number) => Promise<void>
    discard: (repoPath: string, filePath: string) => Promise<void>
  }
}

declare global {
  interface Window {
    fterm: FTermAPI
    __ftermLastPetUpdate: number
  }
}

export { }
