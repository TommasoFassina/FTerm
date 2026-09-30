import { describe, it, expect } from 'vitest'
import { buildCast, castSize, type CastSnapshot } from './castExport'
import { defaultPlan, type EditPlan } from './editPlan'

const snap = (timestamp: number, buffer: string): CastSnapshot =>
  ({ timestamp, buffer, cols: 80, rows: 24 })

const take: CastSnapshot[] = [
  snap(0, 'one'),
  snap(1000, 'two'),
  snap(2000, 'three'),
  snap(3000, 'four'),
]

const plan = (over: Partial<EditPlan> = {}): EditPlan => ({ ...defaultPlan(3000), ...over })

const parse = (cast: string) => {
  const lines = cast.trim().split('\n')
  return { header: JSON.parse(lines[0]), events: lines.slice(1).map(l => JSON.parse(l)) }
}

describe('buildCast', () => {
  it('writes a valid asciicast v2 header', () => {
    const { header } = parse(buildCast(take, plan()))
    expect(header.version).toBe(2)
    expect(header.width).toBe(80)
    expect(header.height).toBe(24)
    expect(typeof header.timestamp).toBe('number')
  })

  it('takes the size from the take when none is given', () => {
    const { header } = parse(buildCast([{ timestamp: 0, buffer: 'x', cols: 120, rows: 40 }], plan()))
    expect(header).toMatchObject({ width: 120, height: 40 })
  })

  it('carries an optional title', () => {
    expect(parse(buildCast(take, plan(), { title: 'demo' })).header.title).toBe('demo')
  })

  it('emits one output event per distinct frame', () => {
    const { events } = parse(buildCast(take, plan()))
    expect(events).toHaveLength(4)
    for (const [, kind] of events) expect(kind).toBe('o')
  })

  it('clears the screen before painting each frame', () => {
    const [, , data] = parse(buildCast(take, plan())).events[0]
    expect(data).toContain('\x1b[H')
    expect(data).toContain('\x1b[2J')
    expect(data.endsWith('one')).toBe(true)
  })

  it('uses CRLF between rows, as a terminal needs', () => {
    const [, , data] = parse(buildCast([snap(0, 'a\nb')], plan())).events[0]
    expect(data).toContain('a\r\nb')
  })

  it('starts at time zero and increases', () => {
    const { events } = parse(buildCast(take, plan()))
    expect(events[0][0]).toBe(0)
    for (let i = 1; i < events.length; i++) expect(events[i][0]).toBeGreaterThan(events[i - 1][0])
  })

  it('drops consecutive identical frames', () => {
    const dup = [snap(0, 'same'), snap(500, 'same'), snap(1000, 'other')]
    expect(parse(buildCast(dup, plan())).events).toHaveLength(2)
  })

  describe('under an edit plan', () => {
    it('honours a trim and rebases time to zero', () => {
      const { events } = parse(buildCast(take, plan({ trimStart: 1000, trimEnd: 3000 })))
      expect(events[0][0]).toBe(0)
      expect(events[0][2]).toContain('two')
      // the frame sitting exactly on the trim point is the closing frame
      expect(events[events.length - 1][2]).toContain('four')
    })

    it('renumbers timestamps across a cut instead of leaving a gap', () => {
      const { events } = parse(buildCast(take, plan({ cuts: [{ start: 1000, end: 2000 }] })))
      const times = events.map(e => e[0])
      // 3 seconds of source minus a 1 second hole is 2 seconds of playback
      expect(Math.max(...times)).toBeLessThanOrEqual(2.001)
      // and nothing sits still for the length of the removed span
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThan(1.001)
    })

    it('drops material that was superseded inside a cut', () => {
      const { events } = parse(buildCast(take, plan({ cuts: [{ start: 900, end: 2100 }] })))
      const text = events.map(e => e[2]).join(' ')
      // 'two' was on screen only during the removed span, so it never appears
      expect(text).not.toContain('two')
      // 'three' is what the screen actually showed at the resume point, and the
      // video export picks the same frame there — the two must not disagree
      expect(text).toContain('three')
    })

    it('compresses time with the speed multiplier', () => {
      const fast = parse(buildCast(take, plan({ speed: 2 }))).events
      const real = parse(buildCast(take, plan())).events
      expect(Math.max(...fast.map(e => e[0]))).toBeCloseTo(Math.max(...real.map(e => e[0])) / 2)
    })

    it('opens a trimmed range with the frame that was on screen', () => {
      // trim starts between frames: the viewer must still see something
      const { events } = parse(buildCast(take, plan({ trimStart: 1500, trimEnd: 3000 })))
      expect(events[0][2]).toContain('two')
      expect(events[0][0]).toBe(0)
    })
  })

  it('produces a header-only file for an empty take rather than throwing', () => {
    const cast = buildCast([], plan())
    expect(parse(cast).events).toHaveLength(0)
    expect(parse(cast).header.version).toBe(2)
  })

  it('is newline terminated, as line-oriented formats should be', () => {
    expect(buildCast(take, plan()).endsWith('\n')).toBe(true)
  })

  it('is dramatically smaller than a video of the same take', () => {
    // a rough sanity check: four frames of text must be a handful of bytes
    expect(castSize(buildCast(take, plan()))).toBeLessThan(2000)
  })
})
