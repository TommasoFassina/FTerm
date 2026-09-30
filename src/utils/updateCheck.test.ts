import { describe, it, expect } from 'vitest'
import { compareVersions, isCheckDue, pickLatestRelease, toUpdateInfo, UPDATE_CHECK_INTERVAL_MS } from './updateCheck'

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('0.1.6', '0.1.5')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('sorts a pre-release before its release', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
  })

  it('never lets a malformed tag look newer', () => {
    expect(compareVersions('nightly', '0.1.0')).toBeLessThan(0)
    expect(compareVersions('0.1.0', 'garbage')).toBeGreaterThan(0)
  })
})

describe('pickLatestRelease', () => {
  it('takes the highest version, pre-releases included, drafts excluded', () => {
    const r = pickLatestRelease([
      { tag_name: 'v0.1.5', html_url: 'u5', prerelease: true },
      { tag_name: 'v0.1.7', html_url: 'u7', draft: true },
      { tag_name: 'v0.1.6', html_url: 'u6', prerelease: true },
      { tag_name: 'not-a-version', html_url: 'x' },
    ])
    expect(r).toEqual({ version: '0.1.6', url: 'u6' })
  })

  it('returns null for an empty or useless list', () => {
    expect(pickLatestRelease([])).toBeNull()
    expect(pickLatestRelease([{ draft: true, tag_name: 'v1.0.0' }])).toBeNull()
  })
})

describe('toUpdateInfo', () => {
  it('flags a newer release', () => {
    expect(toUpdateInfo('0.1.6', [{ tag_name: 'v0.1.7', html_url: 'u' }])).toEqual({
      current: '0.1.6', latest: '0.1.7', url: 'u', newer: true,
    })
  })

  it('does not flag the running version or an older one', () => {
    expect(toUpdateInfo('0.1.6', [{ tag_name: 'v0.1.6' }])?.newer).toBe(false)
    expect(toUpdateInfo('0.1.6', [{ tag_name: 'v0.1.5' }])?.newer).toBe(false)
  })
})

describe('isCheckDue', () => {
  const now = 10 * UPDATE_CHECK_INTERVAL_MS
  it('is due the first time and once a day after', () => {
    expect(isCheckDue(undefined, now)).toBe(true)
    expect(isCheckDue(now - 1000, now)).toBe(false)
    expect(isCheckDue(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true)
  })
  it('is due when the clock went backwards', () => {
    expect(isCheckDue(now + 5000, now)).toBe(true)
  })
})
