import { describe, it, expect } from 'vitest'
import {
  historyStats, matchesQuery, parseHistoryQuery, redactSecrets, searchHistory,
  shouldRecord, toEntry, MAX_OUTPUT_CHARS, type HistoryEntry,
} from './commandHistory'

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'b1', ts: 1_000_000, command: 'npm test', exitCode: 0,
  durationMs: 1200, cwd: 'C:/src/app', ...over,
})

describe('redactSecrets', () => {
  it('leaves ordinary commands alone', () => {
    expect(redactSecrets('git commit -m "fix the thing"')).toBe('git commit -m "fix the thing"')
    expect(redactSecrets('npm run build')).toBe('npm run build')
  })

  it('hides secret-looking assignments', () => {
    expect(redactSecrets('export API_KEY=abcd1234')).not.toContain('abcd1234')
    expect(redactSecrets('SECRET=hunter2 node app.js')).not.toContain('hunter2')
    expect(redactSecrets('curl --token=abc123def')).not.toContain('abc123def')
  })

  it('keeps assignments that are not secrets', () => {
    expect(redactSecrets('NODE_ENV=production npm start')).toContain('production')
    expect(redactSecrets('git config user.name=alice')).toContain('alice')
  })

  it('hides the value of a secret-looking flag given separately', () => {
    expect(redactSecrets('deploy --password hunter2')).not.toContain('hunter2')
    expect(redactSecrets('login --api-key abc123xyz')).not.toContain('abc123xyz')
  })

  it('hides credentials embedded in a URL', () => {
    const out = redactSecrets('git clone https://alice:s3cr3t@github.com/x/y.git')
    expect(out).not.toContain('s3cr3t')
    expect(out).toContain('github.com/x/y.git')
  })

  it('hides known token shapes wherever they appear', () => {
    expect(redactSecrets('echo ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123')).not.toContain('ghp_ABCDEFGHIJ')
    expect(redactSecrets('use sk-abcdefghijklmnopqrstuvwxyz')).not.toContain('sk-abcdefghij')
    expect(redactSecrets('aws AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redactSecrets('curl -H "x: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abc")')).not.toContain('eyJhbGciOiJIUzI1')
  })

  it('hides the MySQL attached-password form', () => {
    expect(redactSecrets('mysql -uroot -phunter2')).not.toContain('hunter2')
  })

  it('drops every argument of commands whose arguments are secrets', () => {
    const out = redactSecrets('psql postgres://u:p@host/db')
    expect(out).toContain('psql')
    expect(out).not.toContain('host/db')
  })

  it('handles a Windows path to such a command', () => {
    expect(redactSecrets('C:\\tools\\openssl.exe rsa -passin pass:abc'))
      .not.toContain('pass:abc')
  })

  it('redacts a secret carried in a header value', () => {
    expect(redactSecrets('curl -H "Authorization: Bearer abcd1234efgh5678"'))
      .not.toContain('abcd1234efgh5678')
    expect(redactSecrets("curl -H 'X-Api-Key: supersecretvalue123'"))
      .not.toContain('supersecretvalue123')
  })

  it('redacts a password given as a separated -p value', () => {
    expect(redactSecrets('docker login -u me -p hunter2')).not.toContain('hunter2')
  })

  it('redacts the password half of -u user:pass', () => {
    const out = redactSecrets('curl -u admin:hunter2 https://x.com')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('admin')
  })

  it('redacts PowerShell and cmd ways of setting a secret', () => {
    expect(redactSecrets('$env:MY_TOKEN = "hunter2hunter2"')).not.toContain('hunter2')
    expect(redactSecrets('$Env:DB_PASSWORD="hunter2"')).not.toContain('hunter2')
    expect(redactSecrets('[Environment]::SetEnvironmentVariable("API_KEY","zzzsecretzzz","User")'))
      .not.toContain('zzzsecretzzz')
    expect(redactSecrets('ConvertTo-SecureString "P@ssw0rd!" -AsPlainText -Force')).not.toContain('P@ssw0rd')
    expect(redactSecrets('ConvertTo-SecureString -String hunter2 -AsPlainText')).not.toContain('hunter2')
    expect(redactSecrets('net user bob Sup3rS3cret /add')).not.toContain('Sup3rS3cret')
    expect(redactSecrets('net user bob /delete')).toBe('net user bob /delete')
  })

  it('redacts a key whose last segment names a secret', () => {
    expect(redactSecrets('npm config set //registry.npmjs.org/:_authToken abcdef123456'))
      .not.toContain('abcdef123456')
    expect(redactSecrets('curl https://x.com/oauth out.json')).toContain('out.json')
  })

  it('hides more provider token shapes', () => {
    for (const t of [
      'glpat-abcdefghijklmnopqrst',
      'AIzaSyA1234567890abcdefghijklmnopqrstuv',
      'npm_abcdefghijklmnopqrstuvwxyz0123456789',
      'hf_abcdefghijklmnopqrstuvwxyz0123',
      'sk_live_abcdefghijklmnop1234',
    ]) expect(redactSecrets(`echo ${t}`)).not.toContain(t)
  })

  it('redacts the value after a bare word that names a secret', () => {
    expect(redactSecrets('aws configure set aws_secret_access_key wJalrXUtnFEMIK7MDENG'))
      .not.toContain('wJalrXUtnFEMIK7MDENG')
  })

  it('keeps values that only look like secrets positionally', () => {
    // a port mapping is not a password, and redacting it makes the entry useless
    expect(redactSecrets('docker run -p 8080:80 nginx')).toContain('8080:80')
    expect(redactSecrets('curl -H "Content-Type: application/json" https://api.x.com'))
      .toContain('application/json')
    expect(redactSecrets('git commit -m "fix: thing"')).toContain('fix: thing')
    expect(redactSecrets('echo hello && git push')).toContain('git push')
  })

  it('does not redact past an assignment it already handled', () => {
    expect(redactSecrets('export MY_TOKEN=abc && npm test')).toContain('&& npm test')
  })
})

describe('shouldRecord', () => {
  it('records real work', () => {
    expect(shouldRecord('npm run build')).toBe(true)
    expect(shouldRecord('git push origin main')).toBe(true)
  })

  it('honours the leading-space convention for "do not log this"', () => {
    expect(shouldRecord('secret-thing', ' secret-thing')).toBe(false)
  })

  it('skips blanks and pure navigation noise', () => {
    for (const cmd of ['', '   ', 'clear', 'cls', 'ls', 'cd', 'pwd', 'exit', 'history']) {
      expect(shouldRecord(cmd), cmd).toBe(false)
    }
  })

  it('does record a command that merely starts with a skipped word', () => {
    expect(shouldRecord('cd ../other && npm i')).toBe(true)
    expect(shouldRecord('ls -la')).toBe(true)
  })
})

describe('toEntry', () => {
  const block = {
    id: 'b1', command: 'deploy --token=abc123456', exitCode: 1,
    durationMs: 900, cwd: 'C:/x', startedAt: 42,
  }

  it('redacts on the way in, so no caller can forget to', () => {
    expect(toEntry(block).command).not.toContain('abc123456')
  })

  it('carries the block metadata across', () => {
    expect(toEntry(block)).toMatchObject({ id: 'b1', ts: 42, exitCode: 1, durationMs: 900, cwd: 'C:/x' })
  })

  it('falls back to now when the block never started', () => {
    expect(toEntry({ ...block, startedAt: null }).ts).toBeGreaterThan(0)
  })

  it('truncates and redacts captured output', () => {
    const out = toEntry(block, 'x'.repeat(MAX_OUTPUT_CHARS + 500)).output!
    expect(out).toHaveLength(MAX_OUTPUT_CHARS)
    expect(toEntry(block, 'token=abcdef123456').output).not.toContain('abcdef123456')
  })

  it('leaves output undefined when none was captured', () => {
    expect(toEntry(block).output).toBeUndefined()
  })
})

describe('parseHistoryQuery', () => {
  it('treats bare words as free text', () => {
    expect(parseHistoryQuery('npm build')).toMatchObject({ text: 'npm build' })
  })

  it('reads the filters', () => {
    const q = parseHistoryQuery('npm cwd:fterm exit:fail since:7d')
    expect(q).toMatchObject({ text: 'npm', cwd: 'fterm', status: 'fail', withinMs: 7 * 86_400_000 })
  })

  it('accepts in: as an alias for cwd:', () => {
    expect(parseHistoryQuery('in:website').cwd).toBe('website')
  })

  it('understands both spellings of a status', () => {
    expect(parseHistoryQuery('exit:0').status).toBe('ok')
    expect(parseHistoryQuery('exit:ok').status).toBe('ok')
    expect(parseHistoryQuery('exit:error').status).toBe('fail')
  })

  it('keeps an unparseable filter as free text rather than dropping it', () => {
    expect(parseHistoryQuery('exit:banana').text).toBe('exit:banana')
    expect(parseHistoryQuery('since:soon').text).toBe('since:soon')
  })

  it('converts every duration unit', () => {
    expect(parseHistoryQuery('since:30m').withinMs).toBe(1_800_000)
    expect(parseHistoryQuery('since:2h').withinMs).toBe(7_200_000)
    expect(parseHistoryQuery('since:1w').withinMs).toBe(604_800_000)
  })
})

describe('matchesQuery', () => {
  const now = 2_000_000

  it('matches every word in any order', () => {
    expect(matchesQuery(entry({ command: 'npm run build' }), parseHistoryQuery('build npm'), now)).toBe(true)
    expect(matchesQuery(entry({ command: 'npm run build' }), parseHistoryQuery('npm deploy'), now)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(matchesQuery(entry({ command: 'NPM Test' }), parseHistoryQuery('npm test'), now)).toBe(true)
  })

  it('filters by working directory', () => {
    expect(matchesQuery(entry({}), parseHistoryQuery('cwd:app'), now)).toBe(true)
    expect(matchesQuery(entry({}), parseHistoryQuery('cwd:website'), now)).toBe(false)
  })

  it('filters by status, treating an unknown exit code as not-a-failure', () => {
    expect(matchesQuery(entry({ exitCode: 0 }), parseHistoryQuery('exit:ok'), now)).toBe(true)
    expect(matchesQuery(entry({ exitCode: 1 }), parseHistoryQuery('exit:fail'), now)).toBe(true)
    expect(matchesQuery(entry({ exitCode: null }), parseHistoryQuery('exit:fail'), now)).toBe(false)
    expect(matchesQuery(entry({ exitCode: null }), parseHistoryQuery('exit:ok'), now)).toBe(false)
  })

  it('filters by age', () => {
    expect(matchesQuery(entry({ ts: now - 5000 }), parseHistoryQuery('since:1h'), now)).toBe(true)
    expect(matchesQuery(entry({ ts: now - 5 * 86_400_000 }), parseHistoryQuery('since:1d'), now)).toBe(false)
  })

  it('only looks inside output when asked to', () => {
    const e = entry({ command: 'npm test', output: 'ECONNREFUSED' })
    expect(matchesQuery(e, { text: 'econnrefused' })).toBe(false)
    expect(matchesQuery(e, { text: 'econnrefused', includeOutput: true })).toBe(true)
  })

  it('an empty query matches everything the filters allow', () => {
    expect(matchesQuery(entry({}), parseHistoryQuery(''))).toBe(true)
    expect(matchesQuery(entry({ exitCode: 0 }), parseHistoryQuery('exit:fail'))).toBe(false)
  })
})

describe('searchHistory', () => {
  const entries: HistoryEntry[] = [
    entry({ id: '1', ts: 100, command: 'npm test', exitCode: 1 }),
    entry({ id: '2', ts: 200, command: 'npm run build' }),
    entry({ id: '3', ts: 300, command: 'npm test', exitCode: 0 }),
    entry({ id: '4', ts: 400, command: 'git push', cwd: 'C:/other' }),
  ]

  it('returns newest first', () => {
    expect(searchHistory(entries, '', { now: 500 }).map(e => e.id)).toEqual(['4', '3', '2'])
  })

  it('collapses repeats onto the most recent run and counts them', () => {
    const hit = searchHistory(entries, 'npm test', { now: 500 })
    expect(hit).toHaveLength(1)
    expect(hit[0]).toMatchObject({ id: '3', runs: 2, exitCode: 0 })
  })

  it('applies the filters', () => {
    expect(searchHistory(entries, 'cwd:other', { now: 500 }).map(e => e.id)).toEqual(['4'])
  })

  it('respects the limit', () => {
    expect(searchHistory(entries, '', { now: 500, limit: 2 })).toHaveLength(2)
  })

  it('is empty rather than throwing on an empty history', () => {
    expect(searchHistory([], 'anything')).toEqual([])
  })
})

describe('historyStats', () => {
  it('counts totals, uniques and failures', () => {
    const s = historyStats([
      entry({ ts: 100, command: 'a', exitCode: 0, durationMs: 100 }),
      entry({ ts: 200, command: 'a', exitCode: 1, durationMs: 300 }),
      entry({ ts: 300, command: 'b', exitCode: null, durationMs: null }),
    ])
    expect(s).toMatchObject({ total: 3, unique: 2, failed: 1, medianMs: 200, oldest: 100 })
  })

  it('handles an empty history', () => {
    expect(historyStats([])).toMatchObject({ total: 0, unique: 0, failed: 0, medianMs: 0, oldest: null })
  })
})
