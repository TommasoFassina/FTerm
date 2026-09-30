import { describe, it, expect } from 'vitest'
import { LANGS, languageForPath, extForLanguage, runCommandFor } from './editorLang'

describe('languageForPath', () => {
  it('maps common extensions', () => {
    expect(languageForPath('a.ts')).toBe('typescript')
    expect(languageForPath('a.tsx')).toBe('tsx')
    expect(languageForPath('a.mjs')).toBe('javascript')
    expect(languageForPath('a.cjs')).toBe('javascript')
    expect(languageForPath('a.yml')).toBe('yaml')
    expect(languageForPath('a.toml')).toBe('toml')
  })

  it('handles Windows and POSIX paths alike', () => {
    expect(languageForPath('E:\\Github\\FTerm\\src\\store\\index.ts')).toBe('typescript')
    expect(languageForPath('/home/t/notes.md')).toBe('markdown')
  })

  it('is case-insensitive', () => {
    expect(languageForPath('README.MD')).toBe('markdown')
    expect(languageForPath('Program.CS')).toBe('csharp')
  })

  it('recognises extensionless and prefix-named files', () => {
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('Dockerfile.dev')).toBe('dockerfile')
    expect(languageForPath('.env.local')).toBe('ini')
  })

  it('falls back to plaintext', () => {
    expect(languageForPath('LICENSE')).toBe('plaintext')
    expect(languageForPath('archive.zzz')).toBe('plaintext')
  })
})

describe('extForLanguage', () => {
  it('returns the preferred extension', () => {
    expect(extForLanguage('python')).toBe('py')
    expect(extForLanguage('markdown')).toBe('md')
  })
  it('falls back to txt for unknown ids', () => {
    expect(extForLanguage('klingon')).toBe('txt')
  })
  it('round-trips every language through languageForPath', () => {
    for (const l of LANGS) expect(languageForPath('file.' + extForLanguage(l.id))).toBe(l.id)
  })
})

describe('runCommandFor', () => {
  it('quotes the path so spaces survive', () => {
    expect(runCommandFor('python', 'C:\\My Files\\a.py')).toBe('python "C:\\My Files\\a.py"')
  })

  it('keeps the Rust binary beside the source instead of /tmp', () => {
    const cmd = runCommandFor('rust', 'C:\\tmp\\a.rs')!
    expect(cmd).not.toContain('/tmp/')
    expect(cmd).toContain('C:\\tmp\\a_out')
  })

  it('returns null for languages with no runner', () => {
    expect(runCommandFor('json', 'a.json')).toBeNull()
    expect(runCommandFor('csharp', 'a.cs')).toBeNull()
  })
})
