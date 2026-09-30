/**
 * One table for everything the editor needs to know about a language: the
 * Monaco id, the extensions that map onto it, and how (or whether) a file in
 * that language can be run.
 *
 * This used to live as three separate literals inside EditorPane — an
 * extension→language map, a language→extension map and a runner map — which
 * drifted apart: `.mjs`, `.cjs`, `.mts`, `.toml`, `.ini` and `.tsx` opened as
 * plaintext, and the Rust runner wrote its binary to `/tmp`, a path that does
 * not exist on the platform FTerm ships first.
 */

export interface LangSpec {
  /** Monaco language id */
  id: string
  /** Label shown in the picker */
  label: string
  /** Extensions (no dot). The first one is used when saving a new file. */
  ext: string[]
  /** Bare filenames that imply this language regardless of extension */
  filenames?: string[]
  /** Builds the shell command that runs a file at `f`. Absent = not runnable. */
  run?: (f: string) => string
}

/** `%TEMP%`-safe output path for compiled languages: next to the source file. */
const beside = (f: string, suffix: string) => {
  const cut = f.lastIndexOf('.')
  return (cut > 0 ? f.slice(0, cut) : f) + suffix
}

export const LANGS: LangSpec[] = [
  { id: 'javascript', label: 'JavaScript', ext: ['js', 'mjs', 'cjs'], run: f => `node "${f}"` },
  { id: 'typescript', label: 'TypeScript', ext: ['ts', 'mts', 'cts'], run: f => `npx tsx "${f}"` },
  { id: 'jsx', label: 'JSX', ext: ['jsx'], run: f => `node "${f}"` },
  { id: 'tsx', label: 'TSX', ext: ['tsx'], run: f => `npx tsx "${f}"` },
  { id: 'python', label: 'Python', ext: ['py', 'pyw'], run: f => `python "${f}"` },
  { id: 'ruby', label: 'Ruby', ext: ['rb'], run: f => `ruby "${f}"` },
  { id: 'php', label: 'PHP', ext: ['php'], run: f => `php "${f}"` },
  { id: 'go', label: 'Go', ext: ['go'], run: f => `go run "${f}"` },
  { id: 'rust', label: 'Rust', ext: ['rs'], run: f => `rustc "${f}" -o "${beside(f, '_out')}" && "${beside(f, '_out')}"` },
  { id: 'java', label: 'Java', ext: ['java'], run: f => `java "${f}"` },
  { id: 'csharp', label: 'C#', ext: ['cs'] },
  { id: 'cpp', label: 'C / C++', ext: ['cpp', 'cc', 'cxx', 'c', 'h', 'hpp'] },
  { id: 'shell', label: 'Shell', ext: ['sh', 'bash', 'zsh'], run: f => `bash "${f}"` },
  { id: 'powershell', label: 'PowerShell', ext: ['ps1', 'psm1'], run: f => `pwsh -NoProfile -File "${f}"` },
  { id: 'bat', label: 'Batch', ext: ['bat', 'cmd'], run: f => `"${f}"` },
  { id: 'sql', label: 'SQL', ext: ['sql'] },
  { id: 'html', label: 'HTML', ext: ['html', 'htm'] },
  { id: 'css', label: 'CSS', ext: ['css'] },
  { id: 'scss', label: 'SCSS', ext: ['scss', 'sass'] },
  { id: 'json', label: 'JSON', ext: ['json', 'jsonc', 'webmanifest'] },
  { id: 'markdown', label: 'Markdown', ext: ['md', 'markdown', 'mdx'] },
  { id: 'yaml', label: 'YAML', ext: ['yaml', 'yml'] },
  { id: 'toml', label: 'TOML', ext: ['toml'] },
  { id: 'ini', label: 'INI', ext: ['ini', 'cfg', 'conf', 'env', 'properties'] },
  { id: 'xml', label: 'XML', ext: ['xml', 'svg', 'xsd', 'plist'] },
  { id: 'dockerfile', label: 'Dockerfile', ext: ['dockerfile'], filenames: ['dockerfile'] },
  { id: 'lua', label: 'Lua', ext: ['lua'], run: f => `lua "${f}"` },
  { id: 'plaintext', label: 'Plain text', ext: ['txt', 'log'] },
]

const byId = new Map(LANGS.map(l => [l.id, l]))

const byExt = new Map<string, string>()
const byFilename = new Map<string, string>()
for (const l of LANGS) {
  for (const e of l.ext) if (!byExt.has(e)) byExt.set(e, l.id)
  for (const n of l.filenames ?? []) byFilename.set(n, l.id)
}

/** Language id for a path, or `plaintext` when nothing matches. */
export function languageForPath(filePath: string): string {
  let base = (filePath.split(/[\\/]/).pop() ?? '').toLowerCase()
  const named = byFilename.get(base)
  if (named) return named
  // dotfiles carry their type after the leading dot: ".env.local" is an INI
  if (base.startsWith('.')) base = base.slice(1)
  const parts = base.split('.')
  // the trailing segment is the extension in the normal case ("main.rs"), the
  // leading one when the name is qualified ("Dockerfile.dev", "env.local")
  const tail = parts.length > 1 ? parts[parts.length - 1] : ''
  if (byExt.has(tail)) return byExt.get(tail)!
  const head = parts[0]
  if (byFilename.has(head)) return byFilename.get(head)!
  if (parts.length > 1 && byExt.has(head)) return byExt.get(head)!
  return 'plaintext'
}

/** Preferred extension for a language, for the Save-As dialog filter. */
export function extForLanguage(id: string): string {
  return byId.get(id)?.ext[0] ?? 'txt'
}

/** The shell command that runs `filePath`, or null when we cannot run it. */
export function runCommandFor(languageId: string, filePath: string): string | null {
  const run = byId.get(languageId)?.run
  return run ? run(filePath) : null
}

export const RUNNABLE = LANGS.filter(l => l.run).map(l => l.id)
