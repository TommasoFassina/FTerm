import { describe, it, expect } from 'vitest'
import { parseOsc133, formatDuration, summarizeCommand } from './shellIntegration'

describe('parseOsc133', () => {
  it('recognizes every standard marker', () => {
    expect(parseOsc133('A')).toEqual({ kind: 'A', exitCode: null })
    expect(parseOsc133('B')).toEqual({ kind: 'B', exitCode: null })
    expect(parseOsc133('C')).toEqual({ kind: 'C', exitCode: null })
    expect(parseOsc133('D')).toEqual({ kind: 'D', exitCode: null })
  })

  it('reads the exit code off D', () => {
    expect(parseOsc133('D;0')).toEqual({ kind: 'D', exitCode: 0 })
    expect(parseOsc133('D;1')).toEqual({ kind: 'D', exitCode: 1 })
    expect(parseOsc133('D;127')).toEqual({ kind: 'D', exitCode: 127 })
  })

  it('ignores trailing key=value fields other terminals append', () => {
    expect(parseOsc133('D;1;aid=7')).toEqual({ kind: 'D', exitCode: 1 })
    expect(parseOsc133('A;cl=m')).toEqual({ kind: 'A', exitCode: null })
  })

  it('is case- and whitespace-tolerant', () => {
    expect(parseOsc133('d;2')).toEqual({ kind: 'D', exitCode: 2 })
    expect(parseOsc133(' a ')).toEqual({ kind: 'A', exitCode: null })
  })

  it('treats an unusable exit code as unknown rather than guessing', () => {
    for (const bad of ['D;', 'D;abc', 'D;-1', 'D;999', 'D;1.5']) {
      expect(parseOsc133(bad)).toEqual({ kind: 'D', exitCode: null })
    }
  })

  it('ignores markers it does not know', () => {
    for (const bad of ['E', 'P;Cwd=/tmp', '', 'AA', null, undefined, 7]) {
      expect(parseOsc133(bad)).toBeNull()
    }
  })
})

describe('formatDuration', () => {
  it('scales the unit to the magnitude', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(820)).toBe('820ms')
    expect(formatDuration(3400)).toBe('3.4s')
    expect(formatDuration(125_000)).toBe('2m 05s')
  })

  it('returns empty for nonsense instead of NaN text', () => {
    expect(formatDuration(-1)).toBe('')
    expect(formatDuration(NaN)).toBe('')
    expect(formatDuration(Infinity)).toBe('')
  })
})

describe('summarizeCommand', () => {
  it('collapses whitespace and newlines to one line', () => {
    expect(summarizeCommand('  git   commit \n  -m "x" ')).toBe('git commit -m "x"')
  })

  it('truncates with an ellipsis at the limit', () => {
    const long = 'a'.repeat(200)
    const out = summarizeCommand(long, 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves short commands untouched', () => {
    expect(summarizeCommand('ls -la', 20)).toBe('ls -la')
  })
})
