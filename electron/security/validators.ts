/**
 * Pure security validators shared by the main process and the remote terminal
 * server. Deliberately free of `electron` imports so they can be unit-tested
 * without an Electron runtime — everything here is input → boolean.
 */
import path from 'path'

// ─── Path containment ────────────────────────────────────────────────────────

/**
 * True when `target` is one of `roots` or lives underneath one. Both sides are
 * resolved and normalized first, so `..` traversal cannot escape a root.
 * Comparison is case-insensitive on Windows, case-sensitive elsewhere.
 */
export function isWithinRoots(target: string, roots: string[]): boolean {
  if (typeof target !== 'string' || target.length === 0) return false
  let resolved: string
  try { resolved = path.resolve(target) } catch { return false }
  if (!path.isAbsolute(resolved)) return false
  const ci = process.platform === 'win32'
  const norm = ci ? path.normalize(resolved).toLowerCase() : path.normalize(resolved)
  return roots.some(root => {
    if (typeof root !== 'string' || root.length === 0) return false
    let r = path.normalize(path.resolve(root))
    if (ci) r = r.toLowerCase()
    if (norm === r) return true
    return norm.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
  })
}

// ─── Sensitive files ─────────────────────────────────────────────────────────

// Files / directories whose contents would expose credentials. Reads are refused
// and entries are hidden from listings entirely.
const SENSITIVE_NAMES = new Set([
  '.ssh', '.aws', '.gnupg', '.gnupg.d',
  '.docker', '.kube', '.azure', '.gcp',
  '.npmrc', '.yarnrc', '.netrc', '.pypirc',
  'credentials.json', 'credentials',
  'id_rsa', 'id_ed25519', 'id_dsa', 'id_ecdsa',
  '.git-credentials',
])
const SENSITIVE_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks'])
const SENSITIVE_DIR_RE = /(^|[\\/])(\.ssh|\.aws|\.gnupg|\.kube|\.azure|\.docker|\.config[\\/]gcloud|\.config[\\/]gh)([\\/]|$)/i
const SECRETISH_NAME_RE = /(^|[._-])(secret|secrets|password|passwords|token|api[_-]?key|private[_-]?key)([._-]|$)/i

/** True for anything that looks like a credential store — path or filename. */
export function isSensitivePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  const norm = p.replace(/\\/g, '/').toLowerCase()
  if (SENSITIVE_DIR_RE.test(norm)) return true
  const base = path.basename(p).toLowerCase()
  if (SENSITIVE_NAMES.has(base)) return true
  if (SENSITIVE_EXT.has(path.extname(base))) return true
  if (SECRETISH_NAME_RE.test(base)) return true
  if (/\.env(\.|$)/i.test(base) || base === '.env') return true
  return false
}

// ─── Network targets ─────────────────────────────────────────────────────────

/**
 * Restrict portscan / ping targets to the local machine and private networks:
 * loopback, RFC1918, link-local, CGNAT, IPv6 loopback / link-local / unique-local,
 * single-label intranet hostnames and `.local` mDNS names.
 *
 * Everything else is refused so a hijacked remote session can't turn the host
 * into a scanner pointed at the public internet.
 */
export function isPrivateTarget(host: string): boolean {
  if (typeof host !== 'string') return false
  const h = host.toLowerCase().trim()
  if (!h) return false
  if (h === 'localhost' || h === 'localhost.localdomain') return true

  const m4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m4) {
    const a = +m4[1], b = +m4[2]
    if ([a, b, +m4[3], +m4[4]].some(n => n > 255)) return false
    if (a === 127) return true                        // loopback
    if (a === 10) return true                         // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true  // 172.16/12
    if (a === 192 && b === 168) return true           // 192.168/16
    if (a === 169 && b === 254) return true           // link-local
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }

  // IPv6 — only for things that actually are IPv6 literals. Testing the `fc`/`fd`
  // prefix on any string would also match hostnames like `fd-cdn.example.com`
  // and hand an attacker an allowlist bypass.
  const v6 = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
  if (v6.includes(':')) {
    if (v6 === '::1') return true                                  // loopback
    // Exactly 4 hex digits in the first group: fe80–febf can never be written
    // shorter (leading digit is non-zero), so `fe8:` is a different address.
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true                 // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true                 // unique-local fc00::/7
    return false
  }

  // Single-label hostname (no dot) — NetBIOS / mDNS intranet name.
  if (!h.includes('.') && /^[a-z0-9-]+$/.test(h)) return true
  if (h.endsWith('.local')) return true
  return false
}

// ─── Opaque identifiers ──────────────────────────────────────────────────────

/** Docker container id or name: alphanumeric start, `[A-Za-z0-9_.-]` body, ≤64 chars. */
export function isValidContainerId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)
}

// ─── Global shortcut accelerators ────────────────────────────────────────────

// Electron accelerator vocabulary, restricted to what a quake hotkey needs.
const ACCEL_MODIFIERS = new Set([
  'command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl',
  'alt', 'option', 'altgr', 'shift', 'super', 'meta',
])
const ACCEL_KEYS = new Set([
  'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace',
  'delete', 'insert', 'return', 'enter', 'up', 'down', 'left', 'right',
  'home', 'end', 'pageup', 'pagedown', 'escape', 'esc', 'printscreen',
  'medianexttrack', 'mediaprevioustrack', 'mediastop', 'mediaplaypause',
  'volumeup', 'volumedown', 'volumemute',
])
/** F1–F24, single printable char, or a named key. */
function isAcceleratorKey(k: string): boolean {
  if (/^f([1-9]|1\d|2[0-4])$/.test(k)) return true
  if (k.length === 1 && /^[a-z0-9`~!@#$%^&*()\-_=+[\]{}\\|;:'",.<>/?]$/.test(k)) return true
  return ACCEL_KEYS.has(k)
}

/**
 * Shape check for an Electron accelerator (e.g. `Ctrl+Shift+\``) before it is
 * handed to `globalShortcut.register`. A global hotkey is registered on behalf
 * of the user from renderer-supplied text, so the vocabulary is an allowlist:
 * modifiers from a fixed set, exactly one non-modifier key, ≤4 parts.
 *
 * A bare key with no modifier is refused — registering `a` globally would
 * swallow that key for every application on the machine.
 */
export function isValidAccelerator(accel: unknown): accel is string {
  if (typeof accel !== 'string') return false
  const raw = accel.trim()
  if (!raw || raw.length > 64) return false
  const parts = raw.split('+')
  if (parts.length < 2 || parts.length > 4) return false
  if (parts.some(p => p.trim() !== p || p.length === 0)) return false

  const lower = parts.map(p => p.toLowerCase())
  const mods = lower.slice(0, -1)
  const key = lower[lower.length - 1]
  if (!mods.every(m => ACCEL_MODIFIERS.has(m))) return false
  if (new Set(mods).size !== mods.length) return false
  if (ACCEL_MODIFIERS.has(key)) return false
  return isAcceleratorKey(key)
}

// GitHub tokens: gho_/ghu_/ghs_/ghp_/ghr_ prefixes (modern) or 40-char hex (legacy)
export const GITHUB_TOKEN_RE = /^(gh[oupsr]_[A-Za-z0-9_]{30,255}|[a-f0-9]{40})$/

/** Shape check only — says nothing about whether the token is live or revoked. */
export function isGitHubToken(token: unknown): token is string {
  return typeof token === 'string' && GITHUB_TOKEN_RE.test(token)
}
