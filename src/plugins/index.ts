import { pluginManager } from './PluginManager'
import { useStore } from '@/store'

const BLOCKED_GLOBALS = ['require', 'process', 'global', '__dirname', '__filename', 'Buffer', 'setImmediate', 'clearImmediate']

// ─── Built-in plugin: Auto Theme ─────────────────────────────────────────────

const AUTO_THEME_DEFAULTS = {
    morning: 'tokyo-night',
    afternoon: 'nord',
    evening: 'dracula',
    night: 'github-dark',
}

function getTimeBasedTheme(): string {
    const cfg = useStore.getState().settings.autoThemeConfig ?? AUTO_THEME_DEFAULTS
    const h = new Date().getHours()
    if (h >= 6  && h < 12) return cfg.morning
    if (h >= 12 && h < 18) return cfg.afternoon
    if (h >= 18 && h < 22) return cfg.evening
    return cfg.night
}

export { AUTO_THEME_DEFAULTS }

let autoThemeInterval: ReturnType<typeof setInterval> | null = null

const autoThemePlugin = {
    id: 'auto-theme',
    name: 'Auto Theme Switcher',
    description: 'Changes theme based on time of day.',
    version: '1.0.0',
    onLoad() {
        const apply = () => {
            const store = useStore.getState()
            // Only switch if the user hasn't manually picked a theme mid-session
            // (respect if they already changed away from what we'd set)
            store.setTheme(getTimeBasedTheme())
        }
        apply()
        autoThemeInterval = setInterval(apply, 30 * 60 * 1000)
    },
    onUnload() {
        if (autoThemeInterval !== null) {
            clearInterval(autoThemeInterval)
            autoThemeInterval = null
        }
    },
}

export async function evalPluginCode(code: string): Promise<any> {
    // Tolerate paste from README (```js fences, leading/trailing whitespace, trailing semicolon)
    let src = code.trim()
    src = src.replace(/^```(?:js|javascript|ts|typescript)?\s*/i, '').replace(/```\s*$/, '').trim()
    if (src.endsWith(';')) src = src.slice(0, -1)

    // Block dangerous globals by shadowing them in the module scope
    const blocked = BLOCKED_GLOBALS.map(g => `const ${g} = undefined;`).join(' ')
    const moduleCode = `${blocked}\nexport default (${src});`

    const blob = new Blob([moduleCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
        const mod = await import(/* @vite-ignore */ url)
        const obj = mod.default
        if (!obj || typeof obj !== 'object') throw new Error('Plugin must return a plain object (e.g. `{ onPtyData: ... }`)')
        return obj
    } finally {
        URL.revokeObjectURL(url)
    }
}

export async function initPlugins() {
    const store = useStore.getState()
    const current = store.plugins || []

    // Register auto-theme if enabled (or default-enabled on first run)
    const autoThemeState = current.find(p => p.id === 'auto-theme')
    if (!autoThemeState || autoThemeState.enabled) {
        pluginManager.register(autoThemePlugin)
    }

    // Sync any newly registered built-in plugin IDs into the store
    const registeredInfo = pluginManager.getRegisteredPlugins().map(p => ({
        id: p.id, name: p.name, description: p.description, enabled: true
    }))
    const currentIds = new Set(current.map(p => p.id))
    const toAdd = registeredInfo.filter(p => !currentIds.has(p.id))
    if (toAdd.length > 0) {
        useStore.setState({ plugins: [...current, ...toAdd] })
    }

    // Load enabled custom plugins
    const customPlugins = current.filter(p => p.isCustom && p.code && p.enabled)
    for (const cp of customPlugins) {
        try {
            const pluginObj = await evalPluginCode(cp.code!)
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

export { pluginManager, autoThemePlugin }