/**
 * Automatic camera moves for a recording.
 *
 * The old auto-zoom was a stub: `SceneDetector` produced scenes, none of them
 * ever carried a `zoomRect`, and the painter's zoom path — a hard 1.8× snap
 * centred on a point, with nothing keeping the view inside the frame — never
 * ran. This replaces it with a real one.
 *
 * The idea is the one a person with a camera would use. Find what is changing,
 * frame it with some air around it, hold that framing long enough to be
 * readable, and move between framings slowly enough that the eye follows
 * instead of being yanked. Everything here is pure and works in cell
 * coordinates, so the studio preview and the exporter compute the identical
 * track from the identical take.
 */

import { stripNonSGR } from './paintFrame'

export interface CameraConfig {
  enabled: boolean
  /** Hard ceiling on magnification. 1 disables zooming without disabling pans. */
  maxScale: number
  /** A framing must survive at least this long before another can replace it. */
  minHoldMs: number
  /** How long a move between framings takes. */
  settleMs: number
  /** Cells of breathing room kept around the region of interest. */
  padCells: number
}

export const DEFAULT_CAMERA: CameraConfig = {
  enabled: true,
  maxScale: 1.8,
  minHoldMs: 1400,
  settleMs: 900,
  padCells: 6,
}

/** Normalized framing: centre in 0..1 of the frame, plus a magnification. */
export interface Camera {
  cx: number
  cy: number
  scale: number
}

export interface CameraKey extends Camera {
  /** Source ms at which the move towards this framing begins. */
  t: number
}

export const IDENTITY_CAMERA: Camera = { cx: 0.5, cy: 0.5, scale: 1 }

/** Snapshot fields the camera needs. Structural, to avoid an import cycle. */
export interface TrackableSnapshot {
  timestamp: number
  buffer: string
  cursorX: number
  cursorY: number
  viewportTop: number
  cols: number
  rows: number
  widgetFrame?: number
}

interface Box { x0: number; y0: number; x1: number; y1: number }

const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
})

const contains = (outer: Box, inner: Box) =>
  inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1

/** Printable width of a serialized row, colour codes discarded. */
const rowWidth = (line: string) => stripNonSGR(line).replace(/\s+$/, '').length

/**
 * The rows that changed between two frames, plus the cursor row. An empty
 * result means nothing moved — the camera should stay where it is rather than
 * drift towards a stale hot-spot.
 */
function regionOfInterest(
  snap: TrackableSnapshot,
  prev: TrackableSnapshot | undefined,
): Box | null {
  const lines = snap.buffer.split('\n')
  const prevLines = prev ? prev.buffer.split('\n') : null

  let box: Box | null = null
  const add = (y: number, x0: number, x1: number) => {
    const b = { x0, y0: y, x1, y1: y }
    box = box ? union(box, b) : b
  }

  for (let y = 0; y < lines.length; y++) {
    // A resized or freshly started take has no comparable previous frame:
    // treat every non-empty row as interesting so the first shot is sensible.
    const changed = !prevLines || prevLines.length !== lines.length || prevLines[y] !== lines[y]
    if (!changed) continue
    const w = Math.max(rowWidth(lines[y]), prevLines ? rowWidth(prevLines[y] ?? '') : 0)
    if (w === 0) continue
    add(y, 0, w - 1)
  }

  const cursorRow = snap.cursorY - snap.viewportTop
  if (cursorRow >= 0 && cursorRow < snap.rows) {
    add(cursorRow, Math.max(0, snap.cursorX - 1), snap.cursorX + 1)
  }

  return box
}

/** Framing that shows `box` with padding, clamped to stay inside the frame. */
function frameBox(box: Box, cols: number, rows: number, cfg: CameraConfig): Camera {
  const x0 = Math.max(0, box.x0 - cfg.padCells)
  const x1 = Math.min(cols - 1, box.x1 + cfg.padCells)
  // Vertical padding is half the horizontal figure: terminal cells are about
  // twice as tall as they are wide, so equal cell padding would look lopsided.
  const vPad = Math.max(1, Math.round(cfg.padCells / 2))
  const y0 = Math.max(0, box.y0 - vPad)
  const y1 = Math.min(rows - 1, box.y1 + vPad)

  const w = Math.max(1, x1 - x0 + 1)
  const h = Math.max(1, y1 - y0 + 1)
  const scale = Math.min(cols / w, rows / h, cfg.maxScale)

  // Below a meaningful magnification, do not move the camera at all — a 1.05×
  // push reads as a wobble, not as an intention.
  if (scale < 1.15) return IDENTITY_CAMERA

  return clampCamera({
    cx: (x0 + x1 + 1) / 2 / cols,
    cy: (y0 + y1 + 1) / 2 / rows,
    scale,
  })
}

/** Keeps the visible rectangle inside the frame, so no edge shows empty space. */
export function clampCamera(cam: Camera): Camera {
  const scale = Math.max(1, cam.scale)
  const half = 0.5 / scale
  return {
    scale,
    cx: Math.min(1 - half, Math.max(half, cam.cx)),
    cy: Math.min(1 - half, Math.max(half, cam.cy)),
  }
}

/**
 * Builds the camera track for a take.
 *
 * A new framing is only committed once the previous one has been held for
 * `minHoldMs`; anything happening before that widens the current shot instead
 * of replacing it. That single rule is what stops the camera hopping between
 * two ends of the screen while a build log scrolls.
 */
export function buildCameraTrack(
  snapshots: TrackableSnapshot[],
  config: Partial<CameraConfig> = {},
): CameraKey[] {
  const cfg = { ...DEFAULT_CAMERA, ...config }
  if (!cfg.enabled || snapshots.length === 0 || cfg.maxScale <= 1) return []

  const cols = snapshots[0].cols || 80
  const rows = snapshots[0].rows || 24

  const keys: CameraKey[] = []
  let shotBox: Box | null = null
  let shotStart = snapshots[0].timestamp
  let lastCommitted: Camera = IDENTITY_CAMERA

  const commit = (t: number, cam: Camera) => {
    const prev = keys[keys.length - 1]
    // Skip a keyframe that would not move the camera anywhere worth going
    if (prev && Math.abs(prev.cx - cam.cx) < 0.02 && Math.abs(prev.cy - cam.cy) < 0.02
      && Math.abs(prev.scale - cam.scale) < 0.08) return
    keys.push({ t, ...cam })
    lastCommitted = cam
  }

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]
    // A widget owns the whole pane; framing the text under it makes no sense.
    if (snap.widgetFrame !== undefined) {
      if (lastCommitted.scale !== 1) commit(snap.timestamp, IDENTITY_CAMERA)
      shotBox = null
      shotStart = snap.timestamp
      continue
    }

    const roi = regionOfInterest(snap, snapshots[i - 1])
    if (!roi) continue

    if (shotBox && contains(shotBox, roi)) continue

    if (shotBox && snap.timestamp - shotStart < cfg.minHoldMs) {
      // Still inside the hold: widen rather than re-frame.
      shotBox = union(shotBox, roi)
      const widened = frameBox(shotBox, cols, rows, cfg)
      // Only rewrite the shot in place; the move already started at shotStart
      if (keys.length > 0 && keys[keys.length - 1].t === shotStart) {
        keys[keys.length - 1] = { t: shotStart, ...widened }
        lastCommitted = widened
      }
      continue
    }

    shotBox = roi
    shotStart = snap.timestamp
    commit(shotStart, frameBox(roi, cols, rows, cfg))
  }

  // A track that never leaves 1× is no track at all.
  if (keys.every(k => k.scale === 1)) return []
  return keys
}

/** Smoothstep — zero velocity at both ends, which is what makes a move read as deliberate. */
const ease = (p: number) => {
  const t = Math.min(1, Math.max(0, p))
  return t * t * (3 - 2 * t)
}

/** The framing in effect at a source time, mid-move included. */
export function cameraAt(track: CameraKey[], t: number, settleMs = DEFAULT_CAMERA.settleMs): Camera {
  if (track.length === 0) return IDENTITY_CAMERA

  let idx = -1
  for (let i = 0; i < track.length; i++) {
    if (track[i].t <= t) idx = i
    else break
  }
  if (idx < 0) return IDENTITY_CAMERA

  const to = track[idx]
  const from: Camera = idx === 0 ? IDENTITY_CAMERA : track[idx - 1]
  const p = settleMs <= 0 ? 1 : ease((t - to.t) / settleMs)

  return clampCamera({
    cx: from.cx + (to.cx - from.cx) * p,
    cy: from.cy + (to.cy - from.cy) * p,
    scale: from.scale + (to.scale - from.scale) * p,
  })
}

/** Spans where the camera is magnified, for drawing on the studio timeline. */
export function zoomSpans(track: CameraKey[], duration: number): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let open: number | null = null
  for (const k of track) {
    if (k.scale > 1 && open === null) open = k.t
    else if (k.scale === 1 && open !== null) { spans.push({ start: open, end: k.t }); open = null }
  }
  if (open !== null) spans.push({ start: open, end: duration })
  return spans
}
