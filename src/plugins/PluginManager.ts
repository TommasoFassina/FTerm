import { FTermPlugin } from './Plugin'
import { useStore } from '@/store'
import { Terminal } from '@xterm/xterm'

class PluginManager {
    private plugins = new Map<string, FTermPlugin>()
    private terminals = new Map<string, Terminal>()

    registerTerminal(instanceId: string, terminal: Terminal) {
        console.log('[PluginManager] registerTerminal', instanceId, 'total:', this.terminals.size + 1)
        this.terminals.set(instanceId, terminal)
    }

    unregisterTerminal(instanceId: string) {
        console.log('[PluginManager] unregisterTerminal', instanceId)
        this.terminals.delete(instanceId)
    }

    register(plugin: FTermPlugin) {
        console.log('[PluginManager] register', plugin.id, 'terminals open:', this.terminals.size)
        this.plugins.set(plugin.id, plugin)
        if (plugin.onLoad) {
            try { plugin.onLoad() }
            catch (e) { console.error(`[Plugin:${plugin.id}] onLoad error:`, e) }
        }
        // Fire onTerminalReady for all currently open terminals
        if (plugin.onTerminalReady) {
            for (const [instanceId, terminal] of this.terminals) {
                console.log('[PluginManager] firing onTerminalReady for', instanceId)
                this._fireWhenReady(plugin.id, plugin.onTerminalReady, terminal, instanceId)
            }
        }
    }

    unregister(pluginId: string) {
        const plugin = this.plugins.get(pluginId)
        if (plugin) {
            if (plugin.onUnload) {
                try { plugin.onUnload() }
                catch (e) { console.error(`[Plugin:${pluginId}] onUnload error:`, e) }
            }
            this.plugins.delete(pluginId)
        }
    }

    notifyPtyData(data: string) {
        const storePlugins = useStore.getState().plugins
        for (const [id, plugin] of this.plugins) {
            const state = storePlugins.find(p => p.id === id)
            if (state?.enabled && plugin.onPtyData) {
                try { plugin.onPtyData(data) }
                catch (e) { console.error(`[Plugin:${id}] onPtyData error:`, e) }
            }
        }
    }

    private _fireWhenReady(
        pluginId: string,
        hook: (t: Terminal, id: string) => void,
        terminal: Terminal,
        instanceId: string
    ) {
        // Wait for xterm's first render event — only then is the Viewport fully wired up
        const disposable = terminal.onRender(() => {
            disposable.dispose()
            try { hook(terminal, instanceId) }
            catch (e) { console.error(`[Plugin:${pluginId}] onTerminalReady error:`, e) }
        })
    }

    notifyTerminalReady(terminal: Terminal, instanceId: string) {
        console.log('[PluginManager] notifyTerminalReady', instanceId, 'plugins:', this.plugins.size)
        const storePlugins = useStore.getState().plugins
        for (const [id, plugin] of this.plugins) {
            const state = storePlugins.find(p => p.id === id)
            console.log('[PluginManager]  plugin', id, 'enabled:', state?.enabled, 'hasHook:', !!plugin.onTerminalReady)
            if (state?.enabled && plugin.onTerminalReady) {
                this._fireWhenReady(id, plugin.onTerminalReady, terminal, instanceId)
            }
        }
    }

    getRegisteredPlugins() {
        return Array.from(this.plugins.values())
    }
}

export const pluginManager = new PluginManager()
