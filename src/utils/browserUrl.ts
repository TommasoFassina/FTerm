/** Search engines offered in the in-app browser's Settings picker. `urlTemplate` contains `%s` for the query. */
export const SEARCH_ENGINES: { id: string; name: string; urlTemplate: string }[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q=%s' },
  { id: 'google', name: 'Google', urlTemplate: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', urlTemplate: 'https://www.bing.com/search?q=%s' },
  { id: 'brave', name: 'Brave', urlTemplate: 'https://search.brave.com/search?q=%s' },
  { id: 'custom', name: 'Custom…', urlTemplate: '' },
]

export const DEFAULT_SEARCH_TEMPLATE = SEARCH_ENGINES[0].urlTemplate

export function buildSearchUrl(query: string, template: string): string {
  const t = template && template.includes('%s') ? template : DEFAULT_SEARCH_TEMPLATE
  return t.replace('%s', encodeURIComponent(query))
}

/** Resolve the effective search URL template from settings (falls back to DuckDuckGo). */
export function resolveSearchTemplate(engineId: string | undefined, customUrl: string | undefined): string {
  if (engineId === 'custom') {
    return customUrl && customUrl.includes('%s') ? customUrl : DEFAULT_SEARCH_TEMPLATE
  }
  return SEARCH_ENGINES.find(e => e.id === engineId)?.urlTemplate || DEFAULT_SEARCH_TEMPLATE
}

/** Turn raw address-bar / command text into a navigable URL (search if it isn't one). Empty input → undefined. */
export function resolveBrowserInput(raw: string, searchUrlTemplate: string): string | undefined {
  const s = raw.trim()
  if (!s) return undefined
  if (/^https?:\/\//i.test(s)) return s
  if (/^about:/i.test(s)) return s
  // looks like a domain (has a dot, no spaces) → assume https
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s
  return buildSearchUrl(s, searchUrlTemplate)
}
