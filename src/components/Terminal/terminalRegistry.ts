import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'

export const searchAddons = new Map<string, SearchAddon>()
export const terminalInstances = new Map<string, Terminal>()
