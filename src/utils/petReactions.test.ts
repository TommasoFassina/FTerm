import { describe, it, expect } from 'vitest'
import { reactToExit, LONG_COMMAND_MS } from './petReactions'

const run = (command: string, exitCode: number | null, durationMs = 500) => reactToExit({ command, exitCode, durationMs })

describe('reactToExit', () => {
  it('ignores a command whose exit code is unknown', () => {
    expect(run('ls', null)).toBeNull()
  })

  it('celebrates passing tests and builds by the command, not the output', () => {
    expect(run('npm test', 0)?.label).toBe('tests_passed')
    expect(run('npx vitest run', 0)?.label).toBe('tests_passed')
    expect(run('npm run build', 0)?.label).toBe('build_success')
    expect(run('git push origin main', 0)?.state).toBe('happy')
  })

  it('says nothing about an ordinary success, unless it took a while', () => {
    expect(run('echo hi', 0)).toBeNull()
    expect(run('./long-job.sh', 0, LONG_COMMAND_MS)?.state).toBe('happy')
  })

  it('is sad when tests fail', () => {
    expect(run('npm test', 1)).toMatchObject({ state: 'sad', label: 'error' })
  })

  it('does not treat Ctrl+C as a failure', () => {
    expect(run('npm run dev', 130)).toBeNull()
    expect(run('npm run dev', -1073741510)).toBeNull()   // 0xC000013A, signed
    expect(run('npm run dev', 3221225786)).toBeNull()    // 0xC000013A, unsigned
  })

  it('knows command-not-found and permission codes', () => {
    expect(run('nope', 127)?.label).toBe('cmd_not_found')
    expect(run('nope', 9009)?.label).toBe('cmd_not_found')
    expect(run('./script', 126)?.label).toBe('permission')
  })

  it('recognises crashes on both platforms', () => {
    expect(run('./a.out', 139)?.label).toBe('crashed')
    expect(run('app.exe', -1073741819)?.label).toBe('crashed')   // 0xC0000005
  })
})
