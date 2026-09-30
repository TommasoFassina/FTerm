import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getRecentFiles, pushRecentFile, removeRecentFile, shortPath, MAX_RECENT } from './recentFiles'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
})

describe('recentFiles', () => {
  it('starts empty', () => {
    expect(getRecentFiles()).toEqual([])
  })

  it('puts the newest path first', () => {
    pushRecentFile('a.ts')
    pushRecentFile('b.ts')
    expect(getRecentFiles()).toEqual(['b.ts', 'a.ts'])
  })

  it('re-opening a file moves it to the front instead of duplicating', () => {
    pushRecentFile('a.ts'); pushRecentFile('b.ts'); pushRecentFile('a.ts')
    expect(getRecentFiles()).toEqual(['a.ts', 'b.ts'])
  })

  it('de-duplicates case-insensitively, the way Windows paths behave', () => {
    pushRecentFile('E:\\Work\\App.ts')
    pushRecentFile('e:\\work\\app.ts')
    expect(getRecentFiles()).toEqual(['e:\\work\\app.ts'])
  })

  it('caps the list', () => {
    for (let i = 0; i < MAX_RECENT + 5; i++) pushRecentFile('f' + i)
    expect(getRecentFiles()).toHaveLength(MAX_RECENT)
    expect(getRecentFiles()[0]).toBe('f' + (MAX_RECENT + 4))
  })

  it('removes a path', () => {
    pushRecentFile('a.ts'); pushRecentFile('b.ts')
    expect(removeRecentFile('A.TS')).toEqual(['b.ts'])
  })

  it('survives corrupt or hostile storage', () => {
    store.set('fterm-recent-files', '{not json')
    expect(getRecentFiles()).toEqual([])
    store.set('fterm-recent-files', '{"a":1}')
    expect(getRecentFiles()).toEqual([])
    store.set('fterm-recent-files', '[1,2,"ok"]')
    expect(getRecentFiles()).toEqual(['ok'])
  })

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => pushRecentFile('a.ts')).not.toThrow()
    expect(getRecentFiles()).toEqual([])
  })

  it('shortens a path to its last two segments', () => {
    expect(shortPath('E:\\Github\\FTerm\\src\\store\\index.ts')).toBe('store/index.ts')
    expect(shortPath('/home/t/notes.md')).toBe('t/notes.md')
    expect(shortPath('notes.md')).toBe('notes.md')
  })
})
