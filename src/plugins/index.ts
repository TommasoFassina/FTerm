import { pluginManager } from './PluginManager'
import { useStore } from '@/store'

const BLOCKED_GLOBALS = ['require', 'process', 'global', '__dirname', '__filename', 'Buffer', 'setImmediate', 'clearImmediate']

export function evalPluginCode(code: string): any {
    const wrapper = `(function(${BLOCKED_GLOBALS.join(',')}) { "use strict"; return (${code}); })`
    const fn = new Function(`return ${wrapper}`)()
    return fn(...BLOCKED_GLOBALS.map(() => undefined))
}

export function initPlugins() {
    const store = useStore.getState()
    const registeredInfo = pluginManager.getRegisteredPlugins().map(p => ({
        id: p.id, name: p.name, description: p.description, enabled: true
    }))

    const current = store.plugins || []
    const currentIds = new Set(current.map(p => p.id))
    const toAdd = registeredInfo.filter(p => !currentIds.has(p.id))
    if (toAdd.length > 0) {
        useStore.setState({ plugins: [...current, ...toAdd] })
    }

    // Only load custom plugins that are enabled
    const customPlugins = current.filter(p => p.isCustom && p.code && p.enabled)
    for (const cp of customPlugins) {
        try {
            const pluginObj = evalPluginCode(cp.code!)
            pluginObj.id = cp.id
            pluginObj.name = cp.name
            pluginObj.description = cp.description
            pluginObj.version = pluginObj.version ?? '1.0.0'
            pluginManager.register(pluginObj)
        } catch (err) {
            console.error(`Failed to load custom plugin "${cp.name}" (${cp.id}):`, err)
        }
    }
}

export { pluginManager }