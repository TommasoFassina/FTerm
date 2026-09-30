import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { HistoryEntry } from '../../src/utils/commandHistory'
import { historyStats, matchesQuery, parseHistoryQuery, searchHistory } from '../../src/utils/commandHistory'

/**
 * Persistent command history.
 *
 * JSON Lines rather than a database: appending is one `write`, the file is
 * readable with `type` or `cat` if anything ever goes wrong, and it needs no
 * native module — which matters, because a native dependency here would be one
 * more thing to rebuild on every Electron bump.
 *
 * The whole log is held in memory. Twenty thousand entries is a few megabytes,
 * and searching them is a linear scan over strings, which is faster than any
 * round-trip to a query engine would be at this size.
 */

const FILE = 'command-history.jsonl'
/** Above this the file is compacted on next launch, oldest first. */
const MAX_ENTRIES = 20_000

let entries: HistoryEntry[] = []
let loaded = false
let enabled = true

const filePath = () => join(app.getPath('userData'), FILE)

function ensureDir(p: string) {
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** Reads the log, dropping any line that is not a well-formed entry. */
function load(): void {
  if (loaded) return
  loaded = true
  const p = filePath()
  if (!existsSync(p)) return
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed: HistoryEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        // A truncated final line after a crash is normal; skip it silently.
        if (e && typeof e.command === 'string' && typeof e.ts === 'number') parsed.push(e)
      } catch { /* not a whole line yet */ }
    }
    entries = parsed
    if (entries.length > MAX_ENTRIES) compact()
  } catch (err) {
    console.warn('[commandHistory] could not read the log:', err)
    entries = []
  }
}

/** Rewrites the file with only the newest MAX_ENTRIES, atomically. */
function compact(): void {
  entries = entries.slice(entries.length - MAX_ENTRIES)
  const p = filePath()
  const tmp = p + '.tmp'
  try {
    ensureDir(p)
    writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 })
    renameSync(tmp, p)
  } catch (err) {
    console.warn('[commandHistory] compaction failed:', err)
  }
}

export const commandHistory = {
  setEnabled(on: boolean) { enabled = on },

  /**
   * Appends one finished command. The renderer has already redacted and
   * filtered it — this layer only owns durability.
   */
  append(entry: HistoryEntry): void {
    if (!enabled) return
    load()
    entries.push(entry)
    const p = filePath()
    try {
      ensureDir(p)
      appendFileSync(p, JSON.stringify(entry) + '\n', { mode: 0o600 })
    } catch (err) {
      console.warn('[commandHistory] append failed:', err)
    }
    // Compact well past the cap so this is rare, not once per command
    if (entries.length > MAX_ENTRIES * 1.25) compact()
  },

  search(query: string, limit = 200, includeOutput = false) {
    load()
    return searchHistory(entries, query, { limit, includeOutput })
  },

  /** Full entry by id, for showing the captured output. */
  get(id: string): HistoryEntry | null {
    load()
    return entries.find(e => e.id === id) ?? null
  },

  stats() {
    load()
    return { ...historyStats(entries), enabled, path: filePath() }
  },

  clear(): void {
    load()
    entries = []
    try {
      const p = filePath()
      if (existsSync(p)) unlinkSync(p)
    } catch (err) {
      console.warn('[commandHistory] clear failed:', err)
    }
  },

  /**
   * Removes everything matching a search, for pruning one project or one day.
   *
   * Matched per entry rather than by collapsing to command text first: search
   * results are deduplicated by command, so deleting by that text would take
   * every run of `npm test` everywhere when the query asked for one directory.
   *
   * An empty query matches everything; that is `clear()`, and refusing it here
   * keeps a blank search box from wiping the log.
   */
  removeMatching(query: string): number {
    load()
    if (!query.trim()) return 0
    const q = parseHistoryQuery(query)
    const before = entries.length
    entries = entries.filter(e => !matchesQuery(e, q))
    const removed = before - entries.length
    if (removed > 0) compact()
    return removed
  },
}
