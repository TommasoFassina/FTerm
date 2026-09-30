/**
 * "Is there a newer FTerm?" — the rules, without the network.
 *
 * The main process fetches the release list from GitHub; everything that
 * decides what that list *means* lives here, pure and tested. Deliberately a
 * notice only: installing in place waits for signed builds, because a
 * self-updating unsigned binary trips SmartScreen on every update.
 */

export interface ReleaseInfo {
  tag_name?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

export interface UpdateInfo {
  current: string
  latest: string
  url: string
  newer: boolean
}

/** How often the automatic check runs. A manual check ignores this. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

function parse(v: string): { nums: number[]; pre: string | null } | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim())
  if (!m) return null
  return { nums: [m[1], m[2], m[3]].map(n => Number(n ?? 0)), pre: m[4] ?? null }
}

/**
 * Semver ordering: negative when `a < b`, 0 when equal, positive when `a > b`.
 * A pre-release sorts before its release (`1.0.0-beta < 1.0.0`). Anything
 * unparseable sorts lowest, so a malformed tag can never look like an update.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  const xa = pa.pre.split('.')
  const xb = pb.pre.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const na = /^\d+$/.test(xa[i]) ? Number(xa[i]) : NaN
    const nb = /^\d+$/.test(xb[i]) ? Number(xb[i]) : NaN
    if (!isNaN(na) && !isNaN(nb)) { if (na !== nb) return na - nb; continue }
    if (!isNaN(na)) return -1
    if (!isNaN(nb)) return 1
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1
  }
  return 0
}

/**
 * The newest release in a GitHub `/releases` listing. Drafts are skipped;
 * pre-releases count (the README badge advertises them too), which is why
 * `/releases/latest`, which ignores them, is not used.
 */
export function pickLatestRelease(releases: ReleaseInfo[]): { version: string; url: string } | null {
  let best: { version: string; url: string } | null = null
  for (const r of releases) {
    if (!r || r.draft || typeof r.tag_name !== 'string' || !parse(r.tag_name)) continue
    const version = r.tag_name.replace(/^v/, '')
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, url: typeof r.html_url === 'string' ? r.html_url : '' }
    }
  }
  return best
}

export function toUpdateInfo(current: string, releases: ReleaseInfo[]): UpdateInfo | null {
  const latest = pickLatestRelease(releases)
  if (!latest) return null
  return {
    current,
    latest: latest.version,
    url: latest.url,
    newer: compareVersions(latest.version, current) > 0,
  }
}

/** Whether the startup check is due. */
export function isCheckDue(lastCheck: number | undefined, now: number): boolean {
  return !lastCheck || now - lastCheck >= UPDATE_CHECK_INTERVAL_MS || lastCheck > now
}
