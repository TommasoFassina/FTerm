/**
 * Fetch uBlock Origin Lite (MV3) into `electron/vendor/ubol`.
 *
 * That directory is git-ignored — uBOL is GPL and is not redistributed inside
 * this repository — but `electron-builder` copies it into the package as an
 * extraResource. A clean checkout (CI, or a fresh clone) therefore has to pull
 * it down before building, or the browser ships with no ad blocking.
 *
 * Mirrors what the in-app updater does at runtime (`updateUbol()` in
 * electron/services/browserSession.ts): latest release of uBlockOrigin/uBOL-home,
 * the `*.chromium.zip` asset. The FTerm shim is applied at runtime when the
 * extension is copied into userData, so the vendored copy stays pristine.
 *
 *   node scripts/fetch-ubol.mjs           # skip if already present
 *   node scripts/fetch-ubol.mjs --force   # re-download
 */
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'electron', 'vendor', 'ubol')
const RELEASE_API = 'https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest'

const force = process.argv.includes('--force')

function currentVersion() {
  try {
    return JSON.parse(readFileSync(join(DEST, 'manifest.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

async function main() {
  const have = currentVersion()
  if (have && !force) {
    console.log(`uBOL ${have} already vendored at electron/vendor/ubol — skipping (use --force to re-download).`)
    return
  }

  // A token lifts the 60 req/h unauthenticated rate limit; CI passes GITHUB_TOKEN.
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'FTerm-build' }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  console.log('Querying latest uBOL release…')
  const res = await fetch(RELEASE_API, { headers })
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`)
  const release = await res.json()

  const asset = (release.assets ?? []).find(a => /\.chromium\.zip$/.test(a.name))
  if (!asset?.browser_download_url) {
    throw new Error(`No *.chromium.zip asset in release ${release.tag_name ?? '(unknown)'}`)
  }

  console.log(`Downloading ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)…`)
  const zipRes = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'FTerm-build' } })
  if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status} ${zipRes.statusText}`)
  const buf = Buffer.from(new Uint8Array(await zipRes.arrayBuffer()))

  // Extract to a sibling temp dir first so a failed unzip can't leave a
  // half-written extension behind for electron-builder to package.
  const tmp = DEST + '.tmp'
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  new AdmZip(buf).extractAllTo(tmp, true)

  if (!existsSync(join(tmp, 'manifest.json'))) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error('Extracted archive has no manifest.json — unexpected asset layout')
  }

  rmSync(DEST, { recursive: true, force: true })
  mkdirSync(dirname(DEST), { recursive: true })
  // rename() across the same parent directory is atomic enough here.
  const { renameSync } = await import('node:fs')
  renameSync(tmp, DEST)

  console.log(`uBOL ${currentVersion() ?? '?'} vendored into electron/vendor/ubol`)
}

main().catch(err => {
  console.error('fetch-ubol failed:', err.message)
  process.exit(1)
})
