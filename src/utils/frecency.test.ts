import { describe, it, expect } from 'vitest'
import { cdCommand, dirKey, frecency, rankDirs, recordVisit, shellKind, MAX_DIRS, type DirVisits } from './frecency'

const H = 3_600_000
const NOW = 1_000 * H

describe('dirKey', () => {
  it('treats Windows spellings of one directory as one', () => {
    expect(dirKey('C:\\Src\\App\\')).toBe(dirKey('c:/src/app'))
    expect(dirKey('C:\\')).toBe('c:/')
    expect(dirKey('C:')).toBe('c:/')
  })
  it('keeps POSIX paths case-sensitive', () => {
    expect(dirKey('/home/A')).not.toBe(dirKey('/home/a'))
    expect(dirKey('/')).toBe('/')
  })
})

describe('recordVisit', () => {
  it('counts visits and remembers the latest spelling', () => {
    let v: DirVisits = {}
    v = recordVisit(v, 'C:\\src', NOW - H)
    v = recordVisit(v, 'c:/src/', NOW)
    const e = Object.values(v)
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ count: 2, last: NOW, path: 'c:/src/' })
  })

  it('ignores an empty path', () => {
    expect(recordVisit({}, '  ', NOW)).toEqual({})
  })

  it('caps the map, dropping the weakest but never the new one', () => {
    let v: DirVisits = {}
    for (let i = 0; i < MAX_DIRS; i++) v = recordVisit(v, `/d${i}`, NOW - 30 * 24 * H)
    v = recordVisit(v, '/d0', NOW) // make d0 strong
    v = recordVisit(v, '/fresh', NOW - 60 * 24 * H)
    expect(Object.keys(v)).toHaveLength(MAX_DIRS)
    expect(v['/fresh']).toBeDefined()
    expect(v['/d0']).toBeDefined()
  })
})

describe('frecency', () => {
  it('weights recent use above old use', () => {
    expect(frecency({ path: '/a', count: 1, last: NOW - 10 }, NOW))
      .toBeGreaterThan(frecency({ path: '/b', count: 10, last: NOW - 30 * 24 * H }, NOW))
  })
})

describe('rankDirs', () => {
  const v: DirVisits = {
    a: { path: 'C:\\src\\my-app', count: 5, last: NOW - 2 * H },
    b: { path: '/app/src', count: 50, last: NOW - 2 * H },
    c: { path: '/home/me/notes', count: 1, last: NOW },
  }

  it('returns everything by score with no query', () => {
    expect(rankDirs(v, '', NOW).map(d => d.path)).toEqual(['/app/src', 'C:\\src\\my-app', '/home/me/notes'])
  })

  it('needs the words in order and the last one in the final component', () => {
    expect(rankDirs(v, 'src app', NOW).map(d => d.path)).toEqual(['C:\\src\\my-app'])
    expect(rankDirs(v, 'APP', NOW).map(d => d.path)).toEqual(['C:\\src\\my-app'])
    expect(rankDirs(v, 'nothing', NOW)).toEqual([])
  })

  it('honours the limit', () => {
    expect(rankDirs(v, '', NOW, 1)).toHaveLength(1)
  })
})

describe('cdCommand', () => {
  it('quotes for each shell', () => {
    expect(cdCommand("C:\\it's here", 'powershell')).toBe("Set-Location -LiteralPath 'C:\\it''s here'")
    expect(cdCommand('C:\\Program Files', 'cmd')).toBe('cd /d "C:\\Program Files"')
    expect(cdCommand("/tmp/it's", 'posix')).toBe("cd -- '/tmp/it'\\''s'")
  })
  it('refuses paths it cannot quote safely', () => {
    expect(cdCommand('/tmp/a\nrm -rf ~', 'posix')).toBeNull()
    expect(cdCommand('C:\\100%', 'cmd')).toBeNull()
  })
})

describe('shellKind', () => {
  it('recognises the shell family', () => {
    expect(shellKind('powershell.exe', 'win32')).toBe('powershell')
    expect(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32')).toBe('powershell')
    expect(shellKind('cmd.exe', 'win32')).toBe('cmd')
    expect(shellKind('bash.exe', 'win32')).toBe('posix')
    expect(shellKind(undefined, 'win32')).toBe('powershell')
    expect(shellKind(undefined, 'linux')).toBe('posix')
  })
})
