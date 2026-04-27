import { contextBridge, ipcRenderer } from 'electron'
import type { AIProvider, AIRequest, ChatMessage } from './services/aiService'
import type { DeviceCodeResponse } from './services/githubOAuth'

contextBridge.exposeInMainWorld('fterm', {
  // Synchronous env values — no IPC round-trip needed
  homedir: process.env.USERPROFILE || process.env.HOME || '',

  // ── PTY ────────────────────────────────────────────────────────────────────
  ptyCreate: (tabId: string, cols: number, rows: number, shell?: string, args?: string[], cwd?: string, env?: Record<string, string>) =>
    ipcRenderer.invoke('pty:create', tabId, cols, rows, shell, args, cwd, env),
  ptyWrite: (tabId: string, data: string) => ipcRenderer.send('pty:write', tabId, data),
  ptyResize: (tabId: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', tabId, cols, rows),
  ptyKill: (tabId: string) => ipcRenderer.send('pty:kill', tabId),

  onPtyData: (tabId: string, cb: (data: string) => void) => {
    const ch = `pty:data:${tabId}`
    const fn = (_: Electron.IpcRendererEvent, d: string) => cb(d)
    ipcRenderer.on(ch, fn)
    return () => ipcRenderer.removeListener(ch, fn)
  },
  onPtyExit: (tabId: string, sessionId: number, cb: (code: number) => void) => {
    const ch = `pty:exit:${tabId}:${sessionId}`
    const fn = (_: Electron.IpcRendererEvent, code: number) => cb(code)
    ipcRenderer.on(ch, fn)
    return () => ipcRenderer.removeListener(ch, fn)
  },

  // ── AI ─────────────────────────────────────────────────────────────────────
  aiChat: (req: AIRequest) => ipcRenderer.invoke('ai:chat', req),
  aiCancel: (requestId: string) => ipcRenderer.send('ai:cancel', requestId),
  aiAutocomplete: (req: AIRequest) => ipcRenderer.invoke('ai:autocomplete', req),
  aiTest: (provider: AIProvider, ollamaUrl?: string) =>
    ipcRenderer.invoke('ai:test', provider, ollamaUrl),

  onAIChunk: (cb: (requestId: string, text: string) => void) => {
    const fn = (_: Electron.IpcRendererEvent, id: string, text: string) => cb(id, text)
    ipcRenderer.on('ai:chunk', fn)
    return () => ipcRenderer.removeListener('ai:chunk', fn)
  },
  onAIDone: (cb: (requestId: string) => void) => {
    const fn = (_: Electron.IpcRendererEvent, id: string) => cb(id)
    ipcRenderer.on('ai:done', fn)
    return () => ipcRenderer.removeListener('ai:done', fn)
  },
  onAIError: (cb: (requestId: string, err: string) => void) => {
    const fn = (_: Electron.IpcRendererEvent, id: string, err: string) => cb(id, err)
    ipcRenderer.on('ai:error', fn)
    return () => ipcRenderer.removeListener('ai:error', fn)
  },
  onAIUsage: (cb: (requestId: string, usage: import('./services/aiService').UsageData) => void) => {
    const fn = (_: Electron.IpcRendererEvent, id: string, usage: import('./services/aiService').UsageData) => cb(id, usage)
    ipcRenderer.on('ai:usage', fn)
    return () => ipcRenderer.removeListener('ai:usage', fn)
  },

  // ── Secure key storage ─────────────────────────────────────────────────────
  keysSet: (provider: string, key: string) => ipcRenderer.invoke('keys:set', provider, key),
  keysDelete: (provider: string) => ipcRenderer.invoke('keys:delete', provider),
  keysHas: (provider: string) => ipcRenderer.invoke('keys:has', provider),
  keysListConnected: () => ipcRenderer.invoke('keys:listConnected'),

  // ── GitHub OAuth ────────────────────────────────────────────────────────────
  githubOAuthStart: (clientId: string): Promise<DeviceCodeResponse> =>
    ipcRenderer.invoke('oauth:github:start', clientId),
  githubOAuthPoll: (clientId: string, deviceCode: string, interval: number, expiresIn: number): Promise<string> =>
    ipcRenderer.invoke('oauth:github:poll', clientId, deviceCode, interval, expiresIn),
  githubOAuthRedirect: (clientId: string): Promise<void> =>
    ipcRenderer.invoke('oauth:github:redirect', clientId),
  onGithubOAuthStatus: (cb: (status: 'opened' | 'success') => void) => {
    const fn = (_: Electron.IpcRendererEvent, s: string) => cb(s as 'opened' | 'success')
    ipcRenderer.on('oauth:github:status', fn)
    return () => ipcRenderer.removeListener('oauth:github:status', fn)
  },

  // ── Provider OAuth (PKCE) ──────────────────────────────────────────────────
  openaiOAuthStart: (clientId: string): Promise<void> =>
    ipcRenderer.invoke('oauth:openai:start', clientId),
  onOpenAIOAuthStatus: (cb: (status: 'success') => void) => {
    const fn = (_: Electron.IpcRendererEvent, s: string) => cb(s as 'success')
    ipcRenderer.on('oauth:openai:status', fn)
    return () => ipcRenderer.removeListener('oauth:openai:status', fn)
  },
  geminiOAuthStart: (clientId: string): Promise<void> =>
    ipcRenderer.invoke('oauth:gemini:start', clientId),
  onGeminiOAuthStatus: (cb: (status: 'success') => void) => {
    const fn = (_: Electron.IpcRendererEvent, s: string) => cb(s as 'success')
    ipcRenderer.on('oauth:gemini:status', fn)
    return () => ipcRenderer.removeListener('oauth:gemini:status', fn)
  },

  // ── Claude Code credential import ──────────────────────────────────────────
  claudeImportFromCLI: (): Promise<boolean> => ipcRenderer.invoke('claude:import-credentials'),

  // ── Git System ─────────────────────────────────────────────────────────────
  git: {
    repository: (cwd: string) => ipcRenderer.invoke('git:repository', cwd),
    status: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
    branches: (repoPath: string) => ipcRenderer.invoke('git:branches', repoPath),
    log: (repoPath: string, limit?: number) => ipcRenderer.invoke('git:log', repoPath, limit),
    checkout: (repoPath: string, branch: string) => ipcRenderer.invoke('git:checkout', repoPath, branch),
    commit: (repoPath: string, message: string) => ipcRenderer.invoke('git:commit', repoPath, message),
    push: (repoPath: string, remote: string, branch: string) => ipcRenderer.invoke('git:push', repoPath, remote, branch),
    pull: (repoPath: string, remote: string, branch: string) => ipcRenderer.invoke('git:pull', repoPath, remote, branch),
    remotes: (repoPath: string) => ipcRenderer.invoke('git:remotes', repoPath),
    stats: (repoPath: string) => ipcRenderer.invoke('git:stats', repoPath),
    diff: (repoPath: string, args?: string[]) => ipcRenderer.invoke('git:diff', repoPath, args),
    stage: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:stage', repoPath, filePath),
    unstage: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:unstage', repoPath, filePath),
    stashList: (repoPath: string) => ipcRenderer.invoke('git:stash:list', repoPath),
    stashPush: (repoPath: string, message?: string) => ipcRenderer.invoke('git:stash:push', repoPath, message),
    stashPop: (repoPath: string, index: number) => ipcRenderer.invoke('git:stash:pop', repoPath, index),
    stashApply: (repoPath: string, index: number) => ipcRenderer.invoke('git:stash:apply', repoPath, index),
    stashDrop: (repoPath: string, index: number) => ipcRenderer.invoke('git:stash:drop', repoPath, index),
    discard: (repoPath: string, filePath: string) => ipcRenderer.invoke('git:discard', repoPath, filePath),
  },

  // ── Window ──────────────────────────────────────────────────────────────────
  setWindowOpacity: (v: number) => ipcRenderer.send('window:set-opacity', v),
  setWindowBlur: (enabled: boolean) => ipcRenderer.send('window:set-blur', enabled),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  dragStart: () => ipcRenderer.send('window:drag-start'),
  dragUpdate: () => ipcRenderer.send('window:drag-update'),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  close: () => ipcRenderer.send('window:close'),
  onWindowState: (cb: (state: { maximized: boolean; fullScreen: boolean }) => void) => {
    const fn = (_: Electron.IpcRendererEvent, s: { maximized: boolean; fullScreen: boolean }) => cb(s)
    ipcRenderer.on('window:state', fn)
    return () => ipcRenderer.removeListener('window:state', fn)
  },
  setWindowPosition: (x: number, y: number) => ipcRenderer.send('window:set-position', x, y),
  getWindowPosition: (): Promise<[number, number]> => ipcRenderer.invoke('window:get-position'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  openExternal: (url: string) => ipcRenderer.send('window:open-external', url),
  openPath: (filePath: string) => ipcRenderer.send('shell:open-path', filePath),
  onHistorySearch: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('shortcut:history-search', fn)
    return () => ipcRenderer.removeListener('shortcut:history-search', fn)
  },
  getSystemMetrics: () => ipcRenderer.invoke('system:metrics'),
  pingHost: (host: string, count?: number) => ipcRenderer.invoke('system:ping', host, count),
  portScan: (host: string, ports: number[]) => ipcRenderer.invoke('system:portscan', host, ports),
  shellDetect: () => ipcRenderer.invoke('shell:detect'),
  fsTempWrite: (filename: string, content: string): Promise<string> =>
    ipcRenderer.invoke('fs:writeTmp', filename, content),
  fsOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('fs:openDialog'),
  fsSaveDialog: (defaultName?: string, filters?: { name: string, extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('fs:saveDialog', defaultName, filters),
  fsReadFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  fsWriteFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  fsReadDir: (dirPath: string): Promise<Array<{ name: string; isDir: boolean; size: number }>> =>
    ipcRenderer.invoke('fs:readdir', dirPath),
  fsDrives: (): Promise<Array<{ path: string; label: string; size: number; freeSpace: number }>> =>
    ipcRenderer.invoke('fs:drives'),
  dockerPs: (): Promise<any[] | null> =>
    ipcRenderer.invoke('docker:ps'),
  dockerLogs: (containerId: string): Promise<string> =>
    ipcRenderer.invoke('docker:logs', containerId),
  dockerAction: (id: string, action: 'start' | 'stop'): Promise<void> =>
    ipcRenderer.invoke('docker:action', id, action),
  systemProcesses: (): Promise<(string | number)[][]> =>
    ipcRenderer.invoke('system:processes'),

  // ── Remote Terminal ────────────────────────────────────────────────────────
  remoteStart: (port: number) => ipcRenderer.invoke('remote:start', port),
  remoteStop: () => ipcRenderer.invoke('remote:stop'),
  remoteStatus: () => ipcRenderer.invoke('remote:status'),
  onRemoteClientChange: (cb: (clients: number) => void) => {
    const fn = (_: Electron.IpcRendererEvent, n: number) => cb(n)
    ipcRenderer.on('remote:clients', fn)
    return () => ipcRenderer.removeListener('remote:clients', fn)
  },

  // ── Recording ──────────────────────────────────────────────────────────────
  recordingStop: (data: { snapshots: any[]; events: any[]; theme: any; backgroundImage?: string; backgroundBlur?: number; backgroundOpacity?: number; generateSubtitlesWith?: string }): Promise<{ videoPath: string }> =>
    ipcRenderer.invoke('recording:stop', data),
  captureRect: (rect: { x: number; y: number; width: number; height: number }): Promise<string> =>
    ipcRenderer.invoke('window:captureRect', rect),
  onRecordingProgress: (cb: (percent: number) => void) => {
    const fn = (_: Electron.IpcRendererEvent, p: number) => cb(p)
    ipcRenderer.on('recording:progress', fn)
    return () => ipcRenderer.removeListener('recording:progress', fn)
  },
})

// Re-export types needed by the renderer's global.d.ts
export type { AIProvider, AIRequest, ChatMessage }
export type { DeviceCodeResponse }
