import { describe, it, expect } from 'vitest'
import {
  addCut, defaultPlan, frameCount, isCutAt, keptDuration, keptRanges, normalizeCuts,
  outputDuration, outputTimeOf, removeCutAt, sourceTimeAt, type EditPlan,
} from './editPlan'

const plan = (over: Partial<EditPlan> = {}): EditPlan => ({ ...defaultPlan(10_000), ...over })

describe('normalizeCuts', () => {
  it('sorts and merges overlapping ranges', () => {
    expect(normalizeCuts([{ start: 500, end: 900 }, { start: 100, end: 600 }]))
      .toEqual([{ start: 100, end: 900 }])
  })

  it('merges ranges that merely touch', () => {
    expect(normalizeCuts([{ start: 0, end: 100 }, { start: 100, end: 200 }]))
      .toEqual([{ start: 0, end: 200 }])
  })

  it('drops empty ranges and repairs reversed ones', () => {
    expect(normalizeCuts([{ start: 50, end: 50 }])).toEqual([])
    expect(normalizeCuts([{ start: 300, end: 100 }])).toEqual([{ start: 100, end: 300 }])
  })

  it('keeps disjoint ranges apart', () => {
    expect(normalizeCuts([{ start: 0, end: 100 }, { start: 200, end: 300 }]))
      .toEqual([{ start: 0, end: 100 }, { start: 200, end: 300 }])
  })
})

describe('keptRanges', () => {
  it('is the whole take by default', () => {
    expect(keptRanges(plan())).toEqual([{ start: 0, end: 10_000 }])
  })

  it('honours the trim', () => {
    expect(keptRanges(plan({ trimStart: 2000, trimEnd: 8000 })))
      .toEqual([{ start: 2000, end: 8000 }])
  })

  it('splits around a cut', () => {
    expect(keptRanges(plan({ cuts: [{ start: 3000, end: 4000 }] })))
      .toEqual([{ start: 0, end: 3000 }, { start: 4000, end: 10_000 }])
  })

  it('clips cuts to the trimmed region', () => {
    expect(keptRanges(plan({ trimStart: 2000, trimEnd: 8000, cuts: [{ start: 0, end: 3000 }] })))
      .toEqual([{ start: 3000, end: 8000 }])
  })

  it('ignores cuts entirely outside the trim', () => {
    expect(keptRanges(plan({ trimStart: 2000, trimEnd: 8000, cuts: [{ start: 9000, end: 9500 }] })))
      .toEqual([{ start: 2000, end: 8000 }])
  })

  it('returns nothing when everything is cut away', () => {
    expect(keptRanges(plan({ cuts: [{ start: 0, end: 10_000 }] }))).toEqual([])
  })

  it('survives an inverted trim', () => {
    expect(keptRanges(plan({ trimStart: 8000, trimEnd: 2000 })))
      .toEqual([{ start: 2000, end: 8000 }])
  })
})

describe('durations', () => {
  it('sums the surviving material', () => {
    expect(keptDuration(plan({ cuts: [{ start: 1000, end: 3000 }] }))).toBe(8000)
  })

  it('divides by speed', () => {
    expect(outputDuration(plan({ speed: 2 }))).toBe(5000)
    expect(outputDuration(plan({ speed: 0.5 }))).toBe(20_000)
  })

  it('treats a nonsensical speed as realtime rather than dividing by zero', () => {
    expect(outputDuration(plan({ speed: 0 }))).toBe(10_000)
    expect(Number.isFinite(outputDuration(plan({ speed: -1 })))).toBe(true)
  })

  it('is zero when the edit keeps nothing', () => {
    expect(outputDuration(plan({ cuts: [{ start: 0, end: 10_000 }] }))).toBe(0)
  })
})

describe('sourceTimeAt', () => {
  it('is identity on an untouched take', () => {
    expect(sourceTimeAt(plan(), 0)).toBe(0)
    expect(sourceTimeAt(plan(), 4321)).toBe(4321)
  })

  it('offsets by the trim', () => {
    expect(sourceTimeAt(plan({ trimStart: 2000, trimEnd: 8000 }), 0)).toBe(2000)
    expect(sourceTimeAt(plan({ trimStart: 2000, trimEnd: 8000 }), 1000)).toBe(3000)
  })

  it('jumps over a cut', () => {
    const p = plan({ cuts: [{ start: 3000, end: 5000 }] })
    expect(sourceTimeAt(p, 2999)).toBe(2999)
    expect(sourceTimeAt(p, 3000)).toBe(5000)   // first frame after the hole
    expect(sourceTimeAt(p, 4000)).toBe(6000)
  })

  it('walks several cuts in order', () => {
    const p = plan({ cuts: [{ start: 1000, end: 2000 }, { start: 4000, end: 6000 }] })
    expect(sourceTimeAt(p, 1000)).toBe(2000)
    expect(sourceTimeAt(p, 3000)).toBe(6000)
  })

  it('scales with speed', () => {
    expect(sourceTimeAt(plan({ speed: 2 }), 1000)).toBe(2000)
    expect(sourceTimeAt(plan({ speed: 0.5 }), 1000)).toBe(500)
  })

  it('clamps past the end and before the start', () => {
    expect(sourceTimeAt(plan(), 99_999)).toBe(10_000)
    expect(sourceTimeAt(plan(), -500)).toBe(0)
  })

  it('never leaves a cut region for any output time', () => {
    const p = plan({ trimStart: 500, trimEnd: 9500, cuts: [{ start: 2000, end: 3000 }, { start: 7000, end: 7500 }] })
    const total = outputDuration(p)
    for (let t = 0; t < total; t += 25) {
      const src = sourceTimeAt(p, t)
      expect(isCutAt(p, src)).toBe(false)
    }
  })
})

describe('outputTimeOf', () => {
  it('round-trips with sourceTimeAt outside cuts', () => {
    const p = plan({ trimStart: 1000, trimEnd: 9000, cuts: [{ start: 4000, end: 5000 }], speed: 1.5 })
    for (const src of [1000, 2500, 3999, 5000, 6500, 8999]) {
      expect(sourceTimeAt(p, outputTimeOf(p, src))).toBeCloseTo(src, 6)
    }
  })

  it('reports the next surviving material for a time inside a cut', () => {
    const p = plan({ cuts: [{ start: 3000, end: 5000 }] })
    expect(outputTimeOf(p, 4000)).toBe(3000)
  })

  it('starts at zero for the trim point', () => {
    expect(outputTimeOf(plan({ trimStart: 2000, trimEnd: 8000 }), 2000)).toBe(0)
  })
})

describe('isCutAt', () => {
  it('treats material outside the trim as cut', () => {
    const p = plan({ trimStart: 2000, trimEnd: 8000 })
    expect(isCutAt(p, 1999)).toBe(true)
    expect(isCutAt(p, 2000)).toBe(false)
    expect(isCutAt(p, 8000)).toBe(true)
  })

  it('is half-open on a cut, matching keptRanges', () => {
    const p = plan({ cuts: [{ start: 3000, end: 5000 }] })
    expect(isCutAt(p, 2999)).toBe(false)
    expect(isCutAt(p, 3000)).toBe(true)
    expect(isCutAt(p, 4999)).toBe(true)
    expect(isCutAt(p, 5000)).toBe(false)
  })
})

describe('frameCount', () => {
  it('counts frames at the requested rate', () => {
    expect(frameCount(plan(), 30)).toBe(300)
    expect(frameCount(plan({ speed: 2 }), 30)).toBe(150)
  })

  it('never asks the encoder for zero frames', () => {
    expect(frameCount(plan({ cuts: [{ start: 0, end: 10_000 }] }), 30)).toBe(1)
  })
})

describe('cut editing', () => {
  it('adds and normalizes in one step', () => {
    const p = addCut(addCut(plan(), { start: 400, end: 800 }), { start: 600, end: 1200 })
    expect(p.cuts).toEqual([{ start: 400, end: 1200 }])
  })

  it('removes the cut under a given time and leaves the others', () => {
    const p = plan({ cuts: [{ start: 1000, end: 2000 }, { start: 4000, end: 5000 }] })
    expect(removeCutAt(p, 1500).cuts).toEqual([{ start: 4000, end: 5000 }])
    expect(removeCutAt(p, 3000).cuts).toHaveLength(2)
  })

  it('does not mutate the plan it was given', () => {
    const p = plan({ cuts: [{ start: 1000, end: 2000 }] })
    addCut(p, { start: 5000, end: 6000 })
    removeCutAt(p, 1500)
    expect(p.cuts).toEqual([{ start: 1000, end: 2000 }])
  })
})
