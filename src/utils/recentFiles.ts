/**
 * Most-recently-opened list for the editor.
 *
 * Kept out of the Zustand store on purpose: it is a per-machine convenience,
 * not part of the session a torn-off window or a synced layout should carry.
 * Stored under its own localStorage key so it never bloats `fterm-v1`.
 */

const KEY = 'fterm-recent-files'
export const MAX_RECENT = 10

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : []
  } catch {
    return []
  }
}

export const getRecentFiles = (): string[] => read()

/** Adds a path at the front, de-duplicated case-insensitively (Windows). */
export function pushRecentFile(filePath: string): string[] {
  if (!filePath) return read()
  const lower = filePath.toLowerCase()
  const next = [filePath, ...read().filter(p => p.toLowerCase() !== lower)].slice(0, MAX_RECENT)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode, quota */ }
  return next
}

export function removeRecentFile(filePath: string): string[] {
  const lower = filePath.toLowerCase()
  const next = read().filter(p => p.toLowerCase() !== lower)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

/** "…\parent\file.ts" — enough context to tell two same-named files apart. */
export function shortPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return filePath
  return parts.slice(-2).join('/')
}
