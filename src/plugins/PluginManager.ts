import { FTermPlugin } from './Plugin'
import { useStore } from '@/store'
import { Terminal } from '@xterm/xterm'

class PluginManager {
    private plugins = new Map<string, FTermPlugin>()

    register(plugin: FTermPlugin) {
        this.plugins.set(plugin.id, plugin)
        if (plugin.onLoad) {
            try { plugin.onLoad() }
            catch (e) { console.error(`[Plugin:${plugin.id}] onLoad error:`, e) }
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

    notifyTerminalReady(terminal: Terminal, instanceId: string) {
        const storePlugins = useStore.getState().plugins
        for (const [id, plugin] of this.plugins) {
            const state = storePlugins.find(p => p.id === id)
            if (state?.enabled && plugin.onTerminalReady) {
                try { plugin.onTerminalReady(terminal, instanceId) }
                catch (e) { console.error(`[Plugin:${id}] onTerminalReady error:`, e) }
            }
        }
    }

    getRegisteredPlugins() {
        return Array.from(this.plugins.values())
    }
}

export const pluginManager = new PluginManager()
