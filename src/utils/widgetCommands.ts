/**
 * Which widget, if any, a typed line should open.
 *
 * `TerminalPane` intercepts fourteen commands before they reach the shell. That
 * decision used to live inside a 1500-line keyboard handler as fourteen
 * near-identical `if` blocks, each re-implementing its own argument parsing —
 * which is how `portscan` ended up accepting only one spelling while the rest
 * accepted several, and why nothing about the interception was testable.
 *
 * This module answers the question and nothing else: no PTY writes, no state,
 * no side effects. The pane still owns everything that actually happens.
 */

/** What the pane should do with an intercepted line. */
export interface WidgetIntent {
  /** Widget id, as used by `activeWidget.type`. */
  widget:
  | 'imgcat' | 'browser' | 'browser-tab' | 'file-explorer' | 'sys-mon' | 'docker'
  | 'weather' | 'ping' | 'portscan' | 'snippets' | 'notes-pad' | 'data-table'
  | 'ftermfetch' | 'visualizer' | 'clipboard'
  /** Plugin that gates this widget, when one does. */
  plugin?: string
  /** Raw argument as typed, quotes stripped. Empty string when absent. */
  arg: string
  /** The command word actually typed, e.g. `note` vs `notes`. */
  verb: string
  /** The widget refuses to open without an argument. */
  requiresArg?: boolean
  /** The argument names a file, so the pane resolves it against the cwd. */
  argIsPath?: boolean
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '')

/**
 * Command words, longest first so `browser` is not swallowed by `browse` and
 * `visualizer` is not swallowed by `viz`.
 */
interface Rule {
  /** Accepted spellings, in match order. */
  words: string[]
  build: (verb: string, arg: string) => WidgetIntent
}

const RULES: Rule[] = [
  {
    words: ['imgcat'],
    build: (verb, arg) => ({ widget: 'imgcat', verb, arg, requiresArg: true, argIsPath: true }),
  },
  // `browser` opens a tab, `browse` stays in the pane — check the longer first
  { words: ['browser'], build: (verb, arg) => ({ widget: 'browser-tab', verb, arg }) },
  { words: ['browse'], build: (verb, arg) => ({ widget: 'browser', verb, arg }) },
  {
    words: ['explore'],
    build: (verb, arg) => ({ widget: 'file-explorer', plugin: 'file-explorer', verb, arg }),
  },
  { words: ['sys-mon'], build: (verb, arg) => ({ widget: 'sys-mon', plugin: 'sys-mon', verb, arg }) },
  { words: ['docker-dash'], build: (verb, arg) => ({ widget: 'docker', plugin: 'docker', verb, arg }) },
  { words: ['weather'], build: (verb, arg) => ({ widget: 'weather', plugin: 'weather', verb, arg }) },
  { words: ['ping'], build: (verb, arg) => ({ widget: 'ping', verb, arg }) },
  // both spellings — the website advertises the hyphenated one
  { words: ['port-scan', 'portscan'], build: (verb, arg) => ({ widget: 'portscan', verb, arg }) },
  { words: ['snippets'], build: (verb, arg) => ({ widget: 'snippets', verb, arg }) },
  { words: ['notes', 'note'], build: (verb, arg) => ({ widget: 'notes-pad', verb, arg }) },
  // `query` was advertised for a long time but never implemented: the old code
  // checked the Data Table plugin and then let the line fall through to the
  // shell. Only `ps` is real.
  { words: ['ps'], build: (verb, arg) => ({ widget: 'data-table', plugin: 'data-table', verb, arg }) },
  { words: ['ftermfetch'], build: (verb, arg) => ({ widget: 'ftermfetch', verb, arg }) },
  {
    words: ['visualizer', 'viz'],
    build: (verb, arg) => ({ widget: 'visualizer', verb, arg, argIsPath: true }),
  },
  { words: ['clipboard', 'clip'], build: (verb, arg) => ({ widget: 'clipboard', verb, arg }) },
]

/** Commands that take no argument at all — `ps -aux` must reach the shell. */
const NO_ARG = new Set(['sys-mon', 'docker-dash', 'snippets', 'notes', 'note', 'ps', 'ftermfetch', 'clipboard', 'clip'])

/**
 * Parses a typed line. Returns null when the shell should handle it — which is
 * the common case, so this is deliberately cheap and allocation-light.
 *
 * Leading whitespace is honoured the way a shell does (`  ls` is still `ls`),
 * but a line with anything before the command word is not a widget invocation.
 */
export function parseWidgetCommand(rawInput: string): WidgetIntent | null {
  const input = rawInput.replace(/^\s+/, '')
  if (!input) return null

  for (const rule of RULES) {
    for (const word of rule.words) {
      if (!input.startsWith(word)) continue
      const rest = input.slice(word.length)
      // exact match, or the word followed by whitespace — never `pingu`
      if (rest !== '' && !/^\s/.test(rest)) continue
      // `ps` is a real command with real flags; only the bare word is ours
      if (NO_ARG.has(word) && rest.trim() !== '') return null
      return rule.build(word, unquote(rest))
    }
  }
  return null
}

/** Defaults the pane applies when a widget's argument is missing. */
export const WIDGET_ARG_DEFAULTS: Partial<Record<WidgetIntent['widget'], string>> = {
  ping: '8.8.8.8',
  portscan: 'localhost',
}

/** Every spelling the terminal intercepts — used for autocomplete and docs. */
export const WIDGET_WORDS: string[] = RULES.flatMap(r => r.words).sort()
