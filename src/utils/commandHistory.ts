/**
 * The rules behind the persistent command history.
 *
 * Command blocks already know a command's exit code, duration and working
 * directory; until now all of that was thrown away when the tab closed. Keeping
 * it means keeping a log of everything typed into a shell, so the two questions
 * that decide whether this is a feature or a liability — *what must never be
 * written down*, and *how do you find one command among twenty thousand* — live
 * here, pure and tested, rather than inside a store or an IPC handler.
 */

export interface HistoryEntry {
  id: string
  /** Epoch ms when the command was submitted. */
  ts: number
  command: string
  exitCode: number | null
  durationMs: number | null
  cwd: string
  /** Truncated output, when output capture is on. */
  output?: string
}

/** Longest output kept per entry. Beyond this the tail is dropped. */
export const MAX_OUTPUT_CHARS = 4000

/* ── what never gets written down ──────────────────────────────────────── */

/**
 * Command names whose *arguments* are secrets by definition. Recording
 * `mysql -p hunter2` is worse than recording nothing at all.
 */
const SECRET_COMMANDS = [
  'mysql', 'psql', 'mongo', 'redis-cli', 'ssh-keygen', 'openssl', 'gpg',
  'htpasswd', 'chpasswd', 'passwd', 'vaultenv', 'age',
]

/** Assignments and flags whose value is a secret. */
const SECRET_KEY = /(pass(word|wd)?|secret|token|api[-_]?key|auth|credential|private[-_]?key|access[-_]?key|client[-_]?secret|bearer)/i

/**
 * Flags whose *value* is a secret. `SECRET_KEY` covers the spelled-out ones
 * (`--password`); the short aliases have to be listed, because a bare `-p`
 * carries no word to match on.
 */
const SECRET_FLAG = new RegExp(`^\\s*--?(p|pw|k)$|${SECRET_KEY.source}`, 'i')

const REDACTED = '‹redacted›'

/**
 * Removes secret-looking values from a command line, keeping enough shape that
 * the entry is still recognisable in a list.
 *
 * This is deliberately eager: a false positive costs a hidden argument, a false
 * negative writes a live credential to disk.
 */
export function redactSecrets(command: string): string {
  let out = command

  // scheme://user:password@host
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@]+@/gi, `$1:${REDACTED}@`)

  // KEY=value / --key=value / $env:KEY = value, when the key looks secret.
  // The PowerShell `$env:` prefix matters here: it is how environment
  // variables are set on Windows, and the spaced `$env:X = "…"` is idiomatic.
  out = out.replace(
    /(^|\s)(-{0,2}(?:\$(?:[Ee][Nn][Vv]:)?)?[A-Za-z_][\w.-]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g,
    (m, lead, key) => (SECRET_KEY.test(key) ? `${lead}${key}=${REDACTED}` : m),
  )
  // --key value / -p value, when the flag names a secret. A value made only of
  // digits and separators is kept: `docker run -p 8080:80` is a port, not a
  // password, and redacting it would make the entry useless to re-run.
  out = out.replace(
    /(\s--?[\w.-]*)\s+("[^"]*"|'[^']*'|\S+)/g,
    (m, flag: string, value: string) =>
      SECRET_FLAG.test(flag) && !/^["']?[\d.:/]+["']?$/.test(value)
        ? `${flag} ${REDACTED}`
        : m,
  )

  // -p<value> / -ppassword, the MySQL-style attached form
  out = out.replace(/(\s-p)(\S+)/g, `$1${REDACTED}`)

  // -u user:password, the curl form. Only the half after the colon is a secret.
  out = out.replace(/(\s--?u(?:ser)?\s+["']?)([^\s:"']+):[^\s"']+/gi, `$1$2:${REDACTED}`)

  // `Authorization: Bearer …` / `X-Api-Key: …` inside a header argument. The
  // flag carrying it (-H) says nothing, so the header *name* is what to judge.
  out = out.replace(
    /([A-Za-z][\w-]*)(\s*:\s*)([^"'\s][^"']*)/g,
    (m, name: string, sep: string) => (SECRET_KEY.test(name) ? `${name}${sep}${REDACTED}` : m),
  )

  // ("API_KEY", "value") — [Environment]::SetEnvironmentVariable and friends,
  // where the name and the value are quoted arguments of a call.
  out = out.replace(
    /(["'])([^"']*)\1(\s*,\s*)("[^"]*"|'[^']*')/g,
    (m, q: string, name: string, sep: string) =>
      SECRET_KEY.test(name) ? `${q}${name}${q}${sep}"${REDACTED}"` : m,
  )

  // Windows commands that take a password as a plain positional argument.
  out = out
    .replace(/(\bConvertTo-SecureString\s+(?:-String\s+)?)("[^"]*"|'[^']*'|[^\s-]\S*)/gi, `$1${REDACTED}`)
    .replace(/(\bnet(?:\.exe)?\s+user\s+\S+\s+)([^\s/*]\S*)/gi, `$1${REDACTED}`)

  // A bare word that names a secret, followed by its value:
  // `aws configure set aws_secret_access_key wJalr…`.
  //
  // A token walk rather than one global regex: a global scan consumes each
  // value as it goes, so a secret word sitting in a value slot would never be
  // tested — which is exactly where this case puts it.
  {
    const parts = out.split(/(\s+)/) // even indices are tokens, odd are gaps
    for (let i = 0; i + 2 < parts.length; i += 2) {
      const word = parts[i]
      const value = parts[i + 2]
      // `=`/`:` forms are already handled above; re-testing them here would
      // redact whatever follows an assignment rather than the assigned value.
      if (word.includes('=')) continue
      // A `name:` header is handled above too — but a key whose *last* segment
      // names a secret (`//registry.npmjs.org/:_authToken npm_…`) is not.
      const name = word.includes(':') ? word.slice(word.lastIndexOf(':') + 1) : word
      // (a URL path is not a key: `curl https://x/oauth out.json` keeps its file)
      if (!name || /[\\/]/.test(name) || !SECRET_KEY.test(name)) continue
      // a flag or a shell operator is not this word's value
      if (!value || value.startsWith('-') || value.startsWith('=') || /^[&|;<>()]+$/.test(value)) continue
      parts[i + 2] = REDACTED
    }
    out = parts.join('')
  }

  // known token shapes, wherever they appear
  out = out
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, REDACTED)          // GitHub
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED)
    .replace(/\bsk-[A-Za-z0-9-_]{20,}/g, REDACTED)               // OpenAI-style
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)                  // AWS access key id
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTED)        // Slack
    .replace(/\bglpat-[A-Za-z0-9_-]{20,}/g, REDACTED)             // GitLab
    .replace(/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED)               // Google / Gemini
    .replace(/\bnpm_[A-Za-z0-9]{36}/g, REDACTED)                 // npm
    .replace(/\bhf_[A-Za-z0-9]{30,}/g, REDACTED)                 // Hugging Face
    .replace(/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, REDACTED) // Stripe
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, REDACTED) // JWT

  // everything after a command that takes secrets as plain arguments
  const verb = out.trim().split(/\s+/)[0]?.split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
  if (verb && SECRET_COMMANDS.includes(verb.toLowerCase())) {
    const head = out.slice(0, out.indexOf(verb) + verb.length)
    if (out.length > head.length) return `${head} ${REDACTED}`
  }

  return out
}

/**
 * Whether a finished block should be written down at all.
 *
 * A command typed with a leading space is skipped, the convention every POSIX
 * shell uses for "do not put this in history" — honouring it here means the
 * habit people already have keeps working.
 */
export function shouldRecord(command: string, rawCommand = command): boolean {
  if (/^\s/.test(rawCommand)) return false
  const trimmed = command.trim()
  if (!trimmed) return false
  // navigation and history noise: recording these buries everything else
  if (/^(clear|cls|exit|ls|ll|dir|pwd|cd|history)$/i.test(trimmed)) return false
  return true
}

/** Builds the record to persist. Redaction happens here so callers cannot skip it. */
export function toEntry(block: {
  id: string
  command: string
  exitCode: number | null
  durationMs: number | null
  cwd: string
  startedAt: number | null
}, output?: string): HistoryEntry {
  return {
    id: block.id,
    ts: block.startedAt ?? Date.now(),
    command: redactSecrets(block.command).trim(),
    exitCode: block.exitCode,
    durationMs: block.durationMs,
    cwd: block.cwd,
    output: output
      ? redactSecrets(output).slice(0, MAX_OUTPUT_CHARS)
      : undefined,
  }
}

/* ── finding one command among twenty thousand ─────────────────────────── */

export interface HistoryQuery {
  /** Free text, matched against the command and (optionally) the output. */
  text: string
  /** Substring the working directory must contain. */
  cwd?: string
  /** 'ok' keeps exit code 0, 'fail' keeps anything non-zero. */
  status?: 'ok' | 'fail'
  /** Only entries newer than this many ms before now. */
  withinMs?: number
  /** Search inside captured output as well as the command. */
  includeOutput?: boolean
}

const DURATION_UNITS: Record<string, number> = {
  m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000,
}

/**
 * Parses the filter syntax typed into the search box:
 * `npm cwd:fterm exit:fail since:7d` — anything unrecognised stays free text.
 */
export function parseHistoryQuery(raw: string): HistoryQuery {
  const q: HistoryQuery = { text: '' }
  const words: string[] = []

  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(cwd|exit|since|in):(.+)$/i.exec(token)
    if (!m) { words.push(token); continue }
    const [, key, value] = m
    switch (key.toLowerCase()) {
      case 'cwd':
      case 'in':
        q.cwd = value
        break
      case 'exit':
        if (/^(ok|0|pass|success)$/i.test(value)) q.status = 'ok'
        else if (/^(fail|err|error|bad|nonzero)$/i.test(value)) q.status = 'fail'
        else words.push(token)
        break
      case 'since': {
        const d = /^(\d+)([mhdw])$/i.exec(value)
        if (d) q.withinMs = Number(d[1]) * DURATION_UNITS[d[2].toLowerCase()]
        else words.push(token)
        break
      }
    }
  }

  q.text = words.join(' ')
  return q
}

/** True when `entry` satisfies every part of `query`. */
export function matchesQuery(entry: HistoryEntry, query: HistoryQuery, now = Date.now()): boolean {
  if (query.cwd && !entry.cwd.toLowerCase().includes(query.cwd.toLowerCase())) return false
  if (query.status === 'ok' && entry.exitCode !== 0) return false
  if (query.status === 'fail' && (entry.exitCode === 0 || entry.exitCode === null)) return false
  if (query.withinMs !== undefined && now - entry.ts > query.withinMs) return false

  const text = query.text.trim().toLowerCase()
  if (!text) return true
  // every word must appear somewhere — "npm build" finds "npm run build"
  const haystack = query.includeOutput
    ? `${entry.command}\n${entry.output ?? ''}`.toLowerCase()
    : entry.command.toLowerCase()
  return text.split(/\s+/).every(word => haystack.includes(word))
}

/**
 * Search results, newest first, with repeated commands collapsed onto their
 * most recent run. A history that lists `npm test` four hundred times is a
 * history nobody scrolls.
 */
export function searchHistory(
  entries: HistoryEntry[],
  raw: string,
  opts: { limit?: number; now?: number; includeOutput?: boolean } = {},
): (HistoryEntry & { runs: number })[] {
  const query = { ...parseHistoryQuery(raw), includeOutput: opts.includeOutput }
  const now = opts.now ?? Date.now()
  const byCommand = new Map<string, HistoryEntry & { runs: number }>()

  // walk newest first so the survivor of each group is the most recent run
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!matchesQuery(entry, query, now)) continue
    const key = entry.command
    const seen = byCommand.get(key)
    if (seen) seen.runs++
    else byCommand.set(key, { ...entry, runs: 1 })
  }

  const out = [...byCommand.values()].sort((a, b) => b.ts - a.ts)
  return opts.limit ? out.slice(0, opts.limit) : out
}

/** Aggregate figures for the history panel's header. */
export function historyStats(entries: HistoryEntry[]) {
  let failed = 0
  let totalMs = 0
  let timed = 0
  const commands = new Set<string>()
  for (const e of entries) {
    if (e.exitCode !== null && e.exitCode !== 0) failed++
    if (e.durationMs !== null) { totalMs += e.durationMs; timed++ }
    commands.add(e.command)
  }
  return {
    total: entries.length,
    unique: commands.size,
    failed,
    medianMs: timed ? Math.round(totalMs / timed) : 0,
    oldest: entries.length ? entries[0].ts : null,
  }
}
