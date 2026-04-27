import type { Terminal } from '@xterm/xterm'

export interface FTermPlugin {
    id: string
    name: string
    description: string
    version: string
    onLoad?: () => void
    onUnload?: () => void
    onPtyData?: (data: string) => void
    onTerminalReady?: (terminal: Terminal, instanceId: string) => void
}