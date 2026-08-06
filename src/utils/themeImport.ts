/**
 * Importers for third-party terminal color schemes.
 *
 * Two formats are supported, chosen because between them they cover almost
 * every scheme published online:
 *   • iTerm2 `.itermcolors` — an XML plist of 0–1 float RGB components
 *   • Windows Terminal JSON — a single scheme object, an array of schemes, or a
 *     whole `settings.json` with a `schemes` array
 *
 * Everything here is pure string → data so it can be unit-tested without a DOM
 * (no `DOMParser`: vitest runs these in a plain Node environment).
 */
import type { Theme } from '@/types'

/** A theme that has been parsed but not yet assigned an id by the store. */
export type ImportedTheme = Omit<Theme, 'id'>

export interface ImportResult {
  themes: ImportedTheme[]
  /** Present when nothing could be parsed. */
  error?: string
}

/** ANSI slots 0–15 in the order both formats use. */
const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const satisfies readonly (keyof Theme)[]

// Sensible stand-ins for slots a scheme omits — better a readable theme than a
// black-on-black one because the file skipped `brightBlack`.
const FALLBACKS: ImportedTheme = {
  name: 'Imported',
  background: '#000000', foreground: '#c0c0c0', cursor: '#c0c0c0', selectionBackground: '#4d4d4d',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
}

// ─── Color helpers ───────────────────────────────────────────────────────────

/** `#abc` / `abcdef` / `#aabbccdd` → `#aabbcc`(`dd`), lowercased. Null if not a hex color. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(v)) return '#' + v.toLowerCase().split('').map(c => c + c).join('')
  if (/^[0-9a-fA-F]{6}$/.test(v) || /^[0-9a-fA-F]{8}$/.test(v)) return '#' + v.toLowerCase()
  return null
}

/** iTerm stores components as 0–1 floats in a wide gamut; clamp and quantize. */
function componentToHexByte(n: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, n)) * 255)
  return byte.toString(16).padStart(2, '0')
}

// ─── iTerm2 (.itermcolors) ───────────────────────────────────────────────────

const ITERM_KEY_MAP: Record<string, keyof ImportedTheme> = {
  'Background Color': 'background',
  'Foreground Color': 'foreground',
  'Cursor Color': 'cursor',
  'Selection Color': 'selectionBackground',
}

/**
 * Pull `<key>NAME</key><dict>…</dict>` pairs out of a plist without a full XML
 * parser. iTerm writes a single flat dict of colour dicts, so a scan for the
 * next `</dict>` after each key is exact rather than heuristic.
 */
function iTermColorDicts(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  const keyRe = /<key>([^<]+)<\/key>\s*<dict>/g
  let m: RegExpExecArray | null
  while ((m = keyRe.exec(xml)) !== null) {
    const end = xml.indexOf('</dict>', m.index)
    if (end === -1) continue
    out.set(m[1].trim(), xml.slice(m.index + m[0].length, end))
  }
  return out
}

function iTermDictToHex(body: string): string | null {
  const component = (name: string): number | null => {
    const m = new RegExp(`<key>${name} Component</key>\\s*<real>([^<]+)</real>`).exec(body)
    if (!m) return null
    const n = parseFloat(m[1])
    return Number.isFinite(n) ? n : null
  }
  const r = component('Red'), g = component('Green'), b = component('Blue')
  if (r === null || g === null || b === null) return null
  return '#' + componentToHexByte(r) + componentToHexByte(g) + componentToHexByte(b)
}

/**
 * Parse an iTerm2 `.itermcolors` file. `fallbackName` is used as the theme name
 * — the format carries no name of its own, so callers pass the filename.
 */
export function parseITermColors(xml: string, fallbackName = 'Imported'): ImportedTheme | null {
  if (typeof xml !== 'string' || !xml.includes('<key>')) return null
  const dicts = iTermColorDicts(xml)
  if (dicts.size === 0) return null

  const theme: ImportedTheme = { ...FALLBACKS, name: fallbackName }
  let matched = 0

  for (const [rawKey, body] of dicts) {
    const hex = iTermDictToHex(body)
    if (!hex) continue
    const ansi = /^Ansi (\d{1,2}) Color$/.exec(rawKey)
    if (ansi) {
      const idx = Number(ansi[1])
      if (idx >= 0 && idx < 16) { theme[ANSI_KEYS[idx]] = hex; matched++ }
      continue
    }
    const mapped = ITERM_KEY_MAP[rawKey]
    if (mapped) { theme[mapped] = hex; matched++ }
  }

  // A plist with no recognizable colour keys is not an iTerm scheme.
  if (matched < 4) return null
  return theme
}

// ─── Windows Terminal JSON ───────────────────────────────────────────────────

// Windows Terminal calls magenta "purple"; everything else matches our naming.
const WT_KEY_MAP: Record<string, keyof ImportedTheme> = {
  background: 'background',
  foreground: 'foreground',
  cursorColor: 'cursor',
  selectionBackground: 'selectionBackground',
  black: 'black', red: 'red', green: 'green', yellow: 'yellow',
  blue: 'blue', purple: 'magenta', cyan: 'cyan', white: 'white',
  brightBlack: 'brightBlack', brightRed: 'brightRed', brightGreen: 'brightGreen',
  brightYellow: 'brightYellow', brightBlue: 'brightBlue', brightPurple: 'brightMagenta',
  brightCyan: 'brightCyan', brightWhite: 'brightWhite',
}

function schemeObjectToTheme(obj: unknown, fallbackName: string): ImportedTheme | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const src = obj as Record<string, unknown>
  const theme: ImportedTheme = { ...FALLBACKS, name: fallbackName }
  let matched = 0

  for (const [wtKey, ourKey] of Object.entries(WT_KEY_MAP)) {
    const hex = normalizeHex(src[wtKey])
    if (hex) { theme[ourKey] = hex; matched++ }
  }
  if (typeof src.name === 'string' && src.name.trim()) theme.name = src.name.trim().slice(0, 60)

  // Require enough colours that we aren't importing an unrelated JSON object.
  if (matched < 8) return null
  return theme
}

/**
 * Parse Windows Terminal colour schemes: a bare scheme object, an array of
 * them, or a full `settings.json` whose `schemes` array holds many.
 */
export function parseWindowsTerminalSchemes(json: string, fallbackName = 'Imported'): ImportedTheme[] {
  let parsed: unknown
  try {
    // Windows Terminal ships settings.json with // comments and trailing commas.
    parsed = JSON.parse(stripJsonComments(json))
  } catch { return [] }

  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).schemes)
      ? (parsed as any).schemes
      : [parsed]

  const themes: ImportedTheme[] = []
  for (const c of candidates) {
    const t = schemeObjectToTheme(c, fallbackName)
    if (t) themes.push(t)
  }
  return themes
}

/** Strip `//` and block comments plus trailing commas — JSONC → JSON. */
export function stripJsonComments(text: string): string {
  let out = ''
  let inString = false, inLine = false, inBlock = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } continue }
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++ } continue }
    if (inString) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; out += c; continue }
    if (c === '/' && next === '/') { inLine = true; i++; continue }
    if (c === '/' && next === '*') { inBlock = true; i++; continue }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/** Filename without directory or extension, trimmed to a usable theme name. */
export function nameFromFilename(filename: string): string {
  const base = (filename || '').split(/[\\/]/).pop() || 'Imported'
  const stem = base.replace(/\.(itermcolors|json|txt)$/i, '').trim()
  return (stem || 'Imported').slice(0, 60)
}

/**
 * Detect the format from the filename and content, then parse. Returns a
 * human-readable `error` instead of throwing so the caller can surface it.
 */
export function importThemes(filename: string, content: string): ImportResult {
  const fallbackName = nameFromFilename(filename)
  if (typeof content !== 'string' || !content.trim()) {
    return { themes: [], error: 'File is empty.' }
  }

  const looksXml = /\.itermcolors$/i.test(filename) || content.trimStart().startsWith('<')
  if (looksXml) {
    const theme = parseITermColors(content, fallbackName)
    return theme
      ? { themes: [theme] }
      : { themes: [], error: 'Not a readable iTerm2 .itermcolors file.' }
  }

  const themes = parseWindowsTerminalSchemes(content, fallbackName)
  if (themes.length) return { themes }
  return {
    themes: [],
    error: 'No color scheme found. Expected an iTerm2 .itermcolors file or a Windows Terminal scheme JSON.',
  }
}
