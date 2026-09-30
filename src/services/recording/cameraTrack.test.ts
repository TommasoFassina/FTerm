import { describe, it, expect } from 'vitest'
import {
  buildCameraTrack, cameraAt, clampCamera, DEFAULT_CAMERA, IDENTITY_CAMERA,
  zoomSpans, type CameraKey, type TrackableSnapshot,
} from './cameraTrack'

const COLS = 80
const ROWS = 24

/** Builds a snapshot whose given rows carry text. */
const snap = (
  timestamp: number,
  rowsWithText: Record<number, string>,
  over: Partial<TrackableSnapshot> = {},
): TrackableSnapshot => {
  const lines = Array.from({ length: ROWS }, (_, y) => rowsWithText[y] ?? '')
  return {
    timestamp,
    buffer: lines.join('\n'),
    cursorX: 0,
    cursorY: 0,
    viewportTop: 0,
    cols: COLS,
    rows: ROWS,
    ...over,
  }
}

describe('clampCamera', () => {
  it('never lets the view leave the frame', () => {
    const c = clampCamera({ cx: 0, cy: 1, scale: 2 })
    expect(c.cx).toBeCloseTo(0.25)
    expect(c.cy).toBeCloseTo(0.75)
  })

  it('pins a 1x camera to the centre', () => {
    expect(clampCamera({ cx: 0.1, cy: 0.9, scale: 1 })).toEqual({ cx: 0.5, cy: 0.5, scale: 1 })
  })

  it('refuses to zoom out past the frame', () => {
    expect(clampCamera({ cx: 0.5, cy: 0.5, scale: 0.4 }).scale).toBe(1)
  })
})

describe('buildCameraTrack', () => {
  it('is empty when disabled', () => {
    const shots = [snap(0, { 2: 'hello' }), snap(2000, { 10: 'world' })]
    expect(buildCameraTrack(shots, { enabled: false })).toEqual([])
  })

  it('is empty when zooming is capped at 1x', () => {
    const shots = [snap(0, { 2: 'hello' }), snap(2000, { 10: 'world' })]
    expect(buildCameraTrack(shots, { maxScale: 1 })).toEqual([])
  })

  it('is empty for an empty take', () => {
    expect(buildCameraTrack([])).toEqual([])
  })

  it('frames a small burst of activity', () => {
    const track = buildCameraTrack([
      snap(0, { 3: 'npm run build' }),
      snap(2000, { 3: 'npm run build', 4: 'done' }),
    ])
    expect(track.length).toBeGreaterThan(0)
    expect(track[0].scale).toBeGreaterThan(1)
  })

  it('stays at 1x when the whole screen is busy', () => {
    const full: Record<number, string> = {}
    for (let y = 0; y < ROWS; y++) full[y] = 'x'.repeat(COLS)
    const track = buildCameraTrack([snap(0, {}), snap(500, full)])
    expect(track).toEqual([])
  })

  it('holds a framing instead of hopping between two hot spots', () => {
    /* Activity alternates top and bottom every 200ms. A camera that re-framed
       on every change would produce a keyframe per snapshot. */
    const shots: TrackableSnapshot[] = []
    for (let i = 0; i < 10; i++) {
      shots.push(snap(i * 200, i % 2 === 0 ? { 1: 'top ' + i } : { 20: 'bottom ' + i }))
    }
    const track = buildCameraTrack(shots, { minHoldMs: 1400 })
    expect(track.length).toBeLessThanOrEqual(2)
  })

  it('re-frames once the hold has elapsed', () => {
    const track = buildCameraTrack([
      snap(0, { 2: 'first' }),
      snap(5000, { 2: 'first', 20: 'much later, elsewhere' }),
      snap(10_000, { 2: 'first', 20: 'much later, elsewhere', 21: 'more' }),
    ], { minHoldMs: 1000 })
    expect(track.length).toBeGreaterThanOrEqual(2)
    expect(track[1].t).toBeGreaterThanOrEqual(1000)
  })

  it('pulls back to 1x while a widget owns the pane', () => {
    const track = buildCameraTrack([
      snap(0, { 2: 'small' }),
      snap(3000, { 2: 'small' }, { widgetFrame: 0 }),
    ])
    expect(track[track.length - 1].scale).toBe(1)
  })

  it('keeps every keyframe inside the frame', () => {
    const track = buildCameraTrack([
      snap(0, { 0: 'top-left' }),
      snap(4000, { [ROWS - 1]: 'x'.repeat(COLS) }),
    ], { minHoldMs: 500 })
    for (const k of track) {
      const half = 0.5 / k.scale
      expect(k.cx).toBeGreaterThanOrEqual(half - 1e-9)
      expect(k.cx).toBeLessThanOrEqual(1 - half + 1e-9)
      expect(k.cy).toBeGreaterThanOrEqual(half - 1e-9)
      expect(k.cy).toBeLessThanOrEqual(1 - half + 1e-9)
    }
  })

  it('never exceeds the configured maximum', () => {
    const track = buildCameraTrack([snap(0, {}), snap(1000, { 5: 'hi' })], { maxScale: 1.5 })
    for (const k of track) expect(k.scale).toBeLessThanOrEqual(1.5)
  })

  it('is deterministic — the exporter rebuilds what the preview showed', () => {
    const shots = [snap(0, { 2: 'a' }), snap(2000, { 12: 'bbbb' }), snap(6000, { 20: 'cc' })]
    expect(buildCameraTrack(shots)).toEqual(buildCameraTrack(shots))
  })
})

describe('cameraAt', () => {
  const track: CameraKey[] = [
    { t: 1000, cx: 0.3, cy: 0.3, scale: 2 },
    { t: 5000, cx: 0.7, cy: 0.7, scale: 2 },
  ]

  it('is the identity before the first keyframe', () => {
    expect(cameraAt(track, 0)).toEqual(IDENTITY_CAMERA)
    expect(cameraAt([], 1234)).toEqual(IDENTITY_CAMERA)
  })

  it('eases out of the identity into the first framing', () => {
    const mid = cameraAt(track, 1000 + DEFAULT_CAMERA.settleMs / 2, DEFAULT_CAMERA.settleMs)
    expect(mid.scale).toBeGreaterThan(1)
    expect(mid.scale).toBeLessThan(2)
  })

  it('has arrived once the settle time has passed', () => {
    const c = cameraAt(track, 1000 + DEFAULT_CAMERA.settleMs + 1, DEFAULT_CAMERA.settleMs)
    expect(c.scale).toBeCloseTo(2)
    expect(c.cx).toBeCloseTo(clampCamera(track[0]).cx)
  })

  it('starts and ends a move at rest', () => {
    const settle = 1000
    const at = (p: number) => cameraAt(track, 5000 + p * settle, settle).cx
    // smoothstep: the first and last tenth move far less than the middle tenth
    const head = Math.abs(at(0.1) - at(0))
    const middle = Math.abs(at(0.55) - at(0.45))
    const tail = Math.abs(at(1) - at(0.9))
    expect(head).toBeLessThan(middle)
    expect(tail).toBeLessThan(middle)
  })

  it('moves monotonically between two framings', () => {
    let prev = -Infinity
    for (let p = 0; p <= 1.001; p += 0.05) {
      const cx = cameraAt(track, 5000 + p * 900, 900).cx
      expect(cx).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = cx
    }
  })

  it('snaps instantly when the settle time is zero', () => {
    expect(cameraAt(track, 1000, 0).scale).toBeCloseTo(2)
  })

  it('stays inside the frame at every instant of a move', () => {
    for (let t = 0; t <= 8000; t += 25) {
      const c = cameraAt(track, t, 900)
      const half = 0.5 / c.scale
      expect(c.cx).toBeGreaterThanOrEqual(half - 1e-9)
      expect(c.cx).toBeLessThanOrEqual(1 - half + 1e-9)
    }
  })
})

describe('zoomSpans', () => {
  it('reports where the camera is magnified', () => {
    expect(zoomSpans([
      { t: 1000, cx: 0.3, cy: 0.3, scale: 2 },
      { t: 4000, cx: 0.5, cy: 0.5, scale: 1 },
    ], 10_000)).toEqual([{ start: 1000, end: 4000 }])
  })

  it('runs an open span to the end of the take', () => {
    expect(zoomSpans([{ t: 2000, cx: 0.3, cy: 0.3, scale: 2 }], 9000))
      .toEqual([{ start: 2000, end: 9000 }])
  })

  it('is empty for a track that never zooms', () => {
    expect(zoomSpans([], 5000)).toEqual([])
  })
})
