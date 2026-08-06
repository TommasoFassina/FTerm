import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  isWithinRoots,
  isSensitivePath,
  isPrivateTarget,
  isValidContainerId,
  isGitHubToken,
  isValidAccelerator,
} from './validators'

const win = process.platform === 'win32'
// Root used for containment tests — absolute and platform-appropriate.
const ROOT = win ? 'C:\\Users\\tester' : '/home/tester'
const OUTSIDE = win ? 'C:\\Windows\\System32' : '/etc'
const p = (...parts: string[]) => path.join(...parts)

describe('isWithinRoots', () => {
  it('accepts the root itself and paths beneath it', () => {
    expect(isWithinRoots(ROOT, [ROOT])).toBe(true)
    expect(isWithinRoots(p(ROOT, 'projects', 'app.ts'), [ROOT])).toBe(true)
  })

  it('rejects paths outside every root', () => {
    expect(isWithinRoots(OUTSIDE, [ROOT])).toBe(false)
    expect(isWithinRoots(p(ROOT, '..', 'someone-else'), [ROOT])).toBe(false)
  })

  it('collapses .. traversal before comparing', () => {
    expect(isWithinRoots(p(ROOT, 'projects', '..', '..', '..'), [ROOT])).toBe(false)
    expect(isWithinRoots(p(ROOT, 'projects', '..', 'notes.md'), [ROOT])).toBe(true)
  })

  it('does not treat a sibling with a shared prefix as contained', () => {
    // "…/tester-evil" must not match the root "…/tester"
    expect(isWithinRoots(ROOT + '-evil', [ROOT])).toBe(false)
    expect(isWithinRoots(ROOT + '-evil/secrets', [ROOT])).toBe(false)
  })

  it('rejects empty, relative and non-string input', () => {
    expect(isWithinRoots('', [ROOT])).toBe(false)
    expect(isWithinRoots('relative/path', [ROOT])).toBe(false)
    expect(isWithinRoots(undefined as unknown as string, [ROOT])).toBe(false)
  })

  it('rejects everything when the root list is empty', () => {
    expect(isWithinRoots(p(ROOT, 'x'), [])).toBe(false)
  })

  it('matches any root in the list', () => {
    const other = win ? 'D:\\shared' : '/srv/shared'
    expect(isWithinRoots(p(other, 'file.txt'), [ROOT, other])).toBe(true)
  })

  it.runIf(win)('is case-insensitive on Windows', () => {
    expect(isWithinRoots('c:\\users\\TESTER\\file.txt', ['C:\\Users\\tester'])).toBe(true)
  })
})

describe('isSensitivePath', () => {
  it('flags credential directories anywhere in the path', () => {
    for (const dir of ['.ssh', '.aws', '.gnupg', '.kube', '.azure', '.docker']) {
      expect(isSensitivePath(`/home/tester/${dir}/config`)).toBe(true)
      expect(isSensitivePath(`C:\\Users\\tester\\${dir}\\config`)).toBe(true)
    }
    expect(isSensitivePath('/home/tester/.config/gcloud/creds.db')).toBe(true)
    expect(isSensitivePath('/home/tester/.config/gh/hosts.yml')).toBe(true)
  })

  it('flags private key files by name', () => {
    for (const name of ['id_rsa', 'id_ed25519', 'id_dsa', 'id_ecdsa', '.git-credentials', '.netrc', '.npmrc']) {
      expect(isSensitivePath(`/tmp/${name}`)).toBe(true)
    }
  })

  it('flags key material by extension', () => {
    for (const ext of ['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks']) {
      expect(isSensitivePath(`/tmp/server${ext}`)).toBe(true)
    }
  })

  it('flags secret-ish filenames', () => {
    expect(isSensitivePath('/tmp/api_key.txt')).toBe(true)
    expect(isSensitivePath('/tmp/app-secret.json')).toBe(true)
    expect(isSensitivePath('/tmp/my.password.yaml')).toBe(true)
    expect(isSensitivePath('/tmp/private-key.bin')).toBe(true)
  })

  it('flags every .env variant', () => {
    expect(isSensitivePath('/app/.env')).toBe(true)
    expect(isSensitivePath('/app/.env.production')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSensitivePath('/home/tester/.SSH/id_rsa')).toBe(true)
    expect(isSensitivePath('/tmp/SERVER.PEM')).toBe(true)
  })

  it('leaves ordinary files alone', () => {
    for (const ok of ['/home/tester/notes.md', '/home/tester/src/index.ts', '/tmp/screenshot.png', '/home/tester/.bashrc']) {
      expect(isSensitivePath(ok)).toBe(false)
    }
  })

  it('rejects non-string input', () => {
    expect(isSensitivePath(undefined as unknown as string)).toBe(false)
  })
})

describe('isPrivateTarget', () => {
  it('accepts loopback and localhost', () => {
    expect(isPrivateTarget('localhost')).toBe(true)
    expect(isPrivateTarget('127.0.0.1')).toBe(true)
    expect(isPrivateTarget('127.255.255.254')).toBe(true)
    expect(isPrivateTarget('::1')).toBe(true)
    expect(isPrivateTarget('[::1]')).toBe(true)
  })

  it('accepts RFC1918 / link-local / CGNAT ranges', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.0.1', '100.64.0.1']) {
      expect(isPrivateTarget(ip)).toBe(true)
    }
  })

  it('rejects public IPv4 and near-miss ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.169.1.1', '100.63.0.1', '100.128.0.1']) {
      expect(isPrivateTarget(ip)).toBe(false)
    }
  })

  it('rejects malformed IPv4 octets', () => {
    expect(isPrivateTarget('999.1.1.1')).toBe(false)
    expect(isPrivateTarget('10.0.0.256')).toBe(false)
  })

  it('accepts IPv6 link-local and unique-local literals', () => {
    expect(isPrivateTarget('fe80::1')).toBe(true)
    expect(isPrivateTarget('fd12:3456::1')).toBe(true)
    expect(isPrivateTarget('fc00::1')).toBe(true)
    expect(isPrivateTarget('[fe80::1]')).toBe(true)
  })

  it('rejects public IPv6', () => {
    expect(isPrivateTarget('2001:4860:4860::8888')).toBe(false)
    expect(isPrivateTarget('fe00::1')).toBe(false)
    // 0fe8:: — a different address from the fe80::/10 link-local block
    expect(isPrivateTarget('fe8::1')).toBe(false)
  })

  it('does not let an fc/fd hostname masquerade as unique-local', () => {
    // Regression: a bare startsWith('fc'/'fd') check let any such hostname through,
    // turning the remote host into a scanner aimed at the public internet.
    expect(isPrivateTarget('fd-cdn.example.com')).toBe(false)
    expect(isPrivateTarget('fcatalog.evil.com')).toBe(false)
    expect(isPrivateTarget('fdrive.attacker.net')).toBe(false)
  })

  it('accepts intranet names, rejects public ones', () => {
    expect(isPrivateTarget('nas')).toBe(true)
    expect(isPrivateTarget('printer.local')).toBe(true)
    expect(isPrivateTarget('example.com')).toBe(false)
    expect(isPrivateTarget('sub.example.com')).toBe(false)
  })

  it('rejects empty / non-string input', () => {
    expect(isPrivateTarget('')).toBe(false)
    expect(isPrivateTarget('   ')).toBe(false)
    expect(isPrivateTarget(null as unknown as string)).toBe(false)
  })
})

describe('isValidContainerId', () => {
  it('accepts hex ids and container names', () => {
    expect(isValidContainerId('a1b2c3d4e5f6')).toBe(true)
    expect(isValidContainerId('my_app-1.2')).toBe(true)
    expect(isValidContainerId('a'.repeat(64))).toBe(true)
  })

  it('rejects shell metacharacters and separators', () => {
    for (const bad of ['a; rm -rf /', 'a b', 'a&&b', 'a|b', 'a$(id)', 'a/b', 'a\\b', 'a\nb', "a'b", 'a`b`']) {
      expect(isValidContainerId(bad)).toBe(false)
    }
  })

  it('rejects a leading non-alphanumeric character', () => {
    expect(isValidContainerId('-rf')).toBe(false)
    expect(isValidContainerId('.hidden')).toBe(false)
    expect(isValidContainerId('_x')).toBe(false)
  })

  it('enforces the length bound', () => {
    expect(isValidContainerId('')).toBe(false)
    expect(isValidContainerId('a'.repeat(65))).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidContainerId(undefined)).toBe(false)
    expect(isValidContainerId(123)).toBe(false)
  })
})

describe('isGitHubToken', () => {
  it('accepts modern prefixed tokens', () => {
    for (const prefix of ['gho_', 'ghu_', 'ghp_', 'ghs_', 'ghr_']) {
      expect(isGitHubToken(prefix + 'A'.repeat(36))).toBe(true)
    }
  })

  it('accepts 40-char legacy hex tokens', () => {
    expect(isGitHubToken('a'.repeat(40))).toBe(true)
    expect(isGitHubToken('0123456789abcdef0123456789abcdef01234567')).toBe(true)
  })

  it('rejects wrong prefixes, wrong lengths and junk', () => {
    expect(isGitHubToken('ghx_' + 'A'.repeat(36))).toBe(false)
    expect(isGitHubToken('gho_short')).toBe(false)
    expect(isGitHubToken('A'.repeat(40))).toBe(false)   // legacy tokens are lowercase hex
    expect(isGitHubToken('a'.repeat(39))).toBe(false)
    expect(isGitHubToken('')).toBe(false)
    expect(isGitHubToken(undefined)).toBe(false)
  })

  it('rejects tokens with surrounding whitespace or newlines', () => {
    expect(isGitHubToken(' gho_' + 'A'.repeat(36))).toBe(false)
    expect(isGitHubToken('gho_' + 'A'.repeat(36) + '\n')).toBe(false)
  })
})

describe('isValidAccelerator', () => {
  it('accepts common quake hotkeys', () => {
    for (const a of ['Ctrl+`', 'Ctrl+Shift+Space', 'Alt+F12', 'CommandOrControl+Alt+T', 'Super+Return', 'Option+`']) {
      expect(isValidAccelerator(a)).toBe(true)
    }
  })

  it('is case-insensitive on modifier and key names', () => {
    expect(isValidAccelerator('ctrl+shift+a')).toBe(true)
    expect(isValidAccelerator('CTRL+PAGEUP')).toBe(true)
  })

  it('requires at least one modifier', () => {
    // A bare key registered globally would swallow it for every application.
    expect(isValidAccelerator('A')).toBe(false)
    expect(isValidAccelerator('F5')).toBe(false)
    expect(isValidAccelerator('`')).toBe(false)
  })

  it('rejects a trailing modifier or duplicated modifiers', () => {
    expect(isValidAccelerator('Ctrl+Shift')).toBe(false)
    expect(isValidAccelerator('Ctrl+Ctrl+A')).toBe(false)
  })

  it('rejects unknown keys, empty parts and stray whitespace', () => {
    expect(isValidAccelerator('Ctrl+Banana')).toBe(false)
    expect(isValidAccelerator('Ctrl+F25')).toBe(false)
    expect(isValidAccelerator('Ctrl++')).toBe(false)   // empty middle part
    expect(isValidAccelerator('Ctrl + A')).toBe(false)
    expect(isValidAccelerator('Ctrl+A ')).toBe(true)   // outer trim is allowed
    expect(isValidAccelerator(' Ctrl+A')).toBe(true)
  })

  it('rejects non-strings, empties and absurd lengths', () => {
    expect(isValidAccelerator(undefined)).toBe(false)
    expect(isValidAccelerator(null)).toBe(false)
    expect(isValidAccelerator(42)).toBe(false)
    expect(isValidAccelerator('')).toBe(false)
    expect(isValidAccelerator('Ctrl+' + 'A'.repeat(100))).toBe(false)
    expect(isValidAccelerator('Ctrl+Alt+Shift+Super+A')).toBe(false)   // >4 parts
  })
})
