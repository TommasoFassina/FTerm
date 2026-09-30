/**
 * Frequently used directories, zoxide-style.
 *
 * Every time a pane *changes* directory (OSC 7 reports a cwd different from
 * the last one it reported) the new directory gets a visit. Ranking is the
 * zoxide formula — visit count weighted by how recently it was used — so a
 * project you cd into every day beats one you visited a hundred times last
 * year. Pure: the store owns the map, the palette asks for a ranking.
 */

export interface DirVisit {
  /** The path as the shell reported it, for display and for `cd`. */
  path: string
  count: number
  /** Epoch ms of the last visit. */
  last: number
}

export type DirVisits = Record<string, DirVisit>

/** Entries kept. The lowest-ranked are dropped beyond this. */
export const MAX_DIRS = 300

const HOUR = 3_600_000

/**
 * Map key for a path: separators unified, trailing slash dropped, and a
 * Windows drive path lowercased — `C:\Src` and `c:/src/` are one directory.
 */
export function dirKey(path: string): string {
  let p = path.trim().replace(/\\/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(p)) p += '/'
  return /^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p
}

/** zoxide's recency weighting. */
export function frecency(v: DirVisit, now: number): number {
  const age = now - v.last
  const w = age < HOUR ? 4 : age < 24 * HOUR ? 2 : age < 7 * 24 * HOUR ? 0.5 : 0.25
  return v.count * w
}

export function recordVisit(visits: DirVisits, path: string, now: number): DirVisits {
  if (!path.trim()) return visits
  const key = dirKey(path)
  const prev = visits[key]
  const next: DirVisits = { ...visits, [key]: { path, count: (prev?.count ?? 0) + 1, last: now } }
  const keys = Object.keys(next)
  if (keys.length <= MAX_DIRS) return next
  // Drop the weakest, never the one just visited.
  const drop = keys
    .filter(k => k !== key)
    .sort((a, b) => frecency(next[a], now) - frecency(next[b], now))
    .slice(0, keys.length - MAX_DIRS)
  for (const k of drop) delete next[k]
  return next
}

/**
 * Directories matching `query`, best first. Like zoxide, every word of the
 * query must appear in the path in order, and the last word must appear in
 * the final component — `src app` finds `…/src/my-app`, not `…/app/src`.
 */
export function rankDirs(visits: DirVisits, query: string, now: number, limit = 10): DirVisit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const out: { v: DirVisit; score: number }[] = []
  for (const v of Object.values(visits)) {
    const path = v.path.replace(/\\/g, '/').toLowerCase()
    if (words.length && !matches(path, words)) continue
    out.push({ v, score: frecency(v, now) })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.v)
}

function matches(path: string, words: string[]): boolean {
  let from = 0
  for (const w of words) {
    const i = path.indexOf(w, from)
    if (i === -1) return false
    from = i + w.length
  }
  const base = path.replace(/\/+$/, '').split('/').pop() ?? ''
  return base.includes(words[words.length - 1])
}

/**
 * The line that moves a shell into `dir`, quoted for that shell. Unknown
 * shells get the POSIX form. Returns null for a path that cannot be quoted
 * safely (a newline would submit whatever followed it).
 */
export function cdCommand(dir: string, shell: 'powershell' | 'cmd' | 'posix'): string | null {
  if (/[\r\n\0]/.test(dir)) return null
  if (shell === 'powershell') return `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`
  if (shell === 'cmd') return /["%^&|<>]/.test(dir) ? null : `cd /d "${dir}"`
  return `cd -- '${dir.replace(/'/g, `'\\''`)}'`
}

/** Which quoting `cdCommand` should use for a shell executable. */
export function shellKind(shell: string | undefined, platform: string): 'powershell' | 'cmd' | 'posix' {
  const s = (shell ?? '').toLowerCase()
  if (/pwsh|powershell/.test(s)) return 'powershell'
  if (/(^|[\\/])cmd(\.exe)?$/.test(s)) return 'cmd'
  if (!s) return platform === 'win32' ? 'powershell' : 'posix'
  return 'posix'
}
