/**
 * Secure key storage using Electron's safeStorage (OS keychain).
 * Keys are AES-256 encrypted before writing to disk.
 * Falls back to plaintext only if encryption is unavailable (rare).
 */
import { safeStorage, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const KEYS_FILE = path.join(app.getPath('userData'), 'keys.enc.json')

type KeyMap = Record<string, string>

function readRaw(): KeyMap {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function writeRaw(data: KeyMap): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 })
}

export function setKey(provider: string, key: string): void {
  if (!key) return
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain unavailable — cannot store credentials securely. ' +
      'On Linux, install gnome-keyring / libsecret. Refusing to write plaintext.'
    )
  }
  const raw = readRaw()
  raw[provider] = safeStorage.encryptString(key).toString('base64')
  writeRaw(raw)
}

export function getKey(provider: string): string {
  const raw = readRaw()
  const val = raw[provider]
  if (!val) return ''
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(val, 'base64'))
  } catch {
    return ''
  }
}

export function deleteKey(provider: string): void {
  const raw = readRaw()
  delete raw[provider]
  writeRaw(raw)
}

export function hasKey(provider: string): boolean {
  return Boolean(readRaw()[provider])
}

/** Returns which providers have stored keys (never returns the keys themselves). */
export function listConnected(): string[] {
  const raw = readRaw()
  return Object.keys(raw).filter(k => raw[k])
}
