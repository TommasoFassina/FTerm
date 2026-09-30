/**
 * The timeline maths behind the recording studio.
 *
 * A take is a list of snapshots stamped with a source time in ms. Editing never
 * touches those snapshots: it produces an `EditPlan` that says which parts of
 * the source survive and how fast to play them. Both the live preview and the
 * exporter ask the same question of it — "what source time am I showing at
 * output time T?" — so what you scrub through is exactly what gets encoded.
 */

export interface Cut {
  /** inclusive source ms */
  start: number
  /** exclusive source ms */
  end: number
}

export interface EditPlan {
  /** Source ms where the export begins. */
  trimStart: number
  /** Source ms where the export ends. */
  trimEnd: number
  /** Ranges removed from inside the trimmed region. */
  cuts: Cut[]
  /** Playback multiplier: 2 means twice as fast, so half the output length. */
  speed: number
}

export const defaultPlan = (duration: number): EditPlan => ({
  trimStart: 0,
  trimEnd: Math.max(0, duration),
  cuts: [],
  speed: 1,
})

/** Sorted, merged, non-empty cuts — overlapping selections collapse into one. */
export function normalizeCuts(cuts: Cut[]): Cut[] {
  const valid = cuts
    .map(c => ({ start: Math.min(c.start, c.end), end: Math.max(c.start, c.end) }))
    .filter(c => c.end > c.start)
    .sort((a, b) => a.start - b.start)

  const out: Cut[] = []
  for (const c of valid) {
    const last = out[out.length - 1]
    // touching ranges merge too: [0,100) and [100,200) are one hole, not two
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end)
    else out.push({ ...c })
  }
  return out
}

/**
 * The source ranges that survive, in order. Always disjoint and ascending; an
 * empty result means the edit removes everything.
 */
export function keptRanges(plan: EditPlan): Cut[] {
  const from = Math.max(0, Math.min(plan.trimStart, plan.trimEnd))
  const to = Math.max(plan.trimStart, plan.trimEnd)
  const kept: Cut[] = []
  let cursor = from

  for (const cut of normalizeCuts(plan.cuts)) {
    if (cut.end <= from || cut.start >= to) continue
    const s = Math.max(from, cut.start)
    const e = Math.min(to, cut.end)
    if (s > cursor) kept.push({ start: cursor, end: s })
    cursor = Math.max(cursor, e)
  }
  if (cursor < to) kept.push({ start: cursor, end: to })
  return kept
}

/** Source ms that survive, before the speed multiplier. */
export function keptDuration(plan: EditPlan): number {
  return keptRanges(plan).reduce((sum, r) => sum + (r.end - r.start), 0)
}

/** Length of the exported video in ms. */
export function outputDuration(plan: EditPlan): number {
  const speed = plan.speed > 0 ? plan.speed : 1
  return keptDuration(plan) / speed
}

/**
 * Source time shown at `outputMs` of the finished video. Clamped at both ends,
 * so a caller that overshoots by a frame gets the last surviving frame rather
 * than undefined.
 */
export function sourceTimeAt(plan: EditPlan, outputMs: number): number {
  const ranges = keptRanges(plan)
  if (ranges.length === 0) return plan.trimStart
  const speed = plan.speed > 0 ? plan.speed : 1
  let remaining = Math.max(0, outputMs) * speed

  for (const r of ranges) {
    const len = r.end - r.start
    if (remaining < len) return r.start + remaining
    remaining -= len
  }
  return ranges[ranges.length - 1].end
}

/**
 * Where a source time lands in the output. A time inside a cut has no output
 * position of its own — it reports the start of the next surviving material,
 * which is what a playhead should do when it walks into a hole.
 */
export function outputTimeOf(plan: EditPlan, sourceMs: number): number {
  const ranges = keptRanges(plan)
  const speed = plan.speed > 0 ? plan.speed : 1
  let acc = 0
  for (const r of ranges) {
    if (sourceMs < r.start) return acc / speed
    if (sourceMs < r.end) return (acc + (sourceMs - r.start)) / speed
    acc += r.end - r.start
  }
  return acc / speed
}

/** True when `sourceMs` falls inside a removed range (or outside the trim). */
export function isCutAt(plan: EditPlan, sourceMs: number): boolean {
  if (sourceMs < plan.trimStart || sourceMs >= plan.trimEnd) return true
  return normalizeCuts(plan.cuts).some(c => sourceMs >= c.start && sourceMs < c.end)
}

/** Frame count an export will produce at `fps`. */
export function frameCount(plan: EditPlan, fps: number): number {
  if (fps <= 0) return 0
  return Math.max(1, Math.round((outputDuration(plan) / 1000) * fps))
}

/** Adds a cut, keeping the list normalized. Returns a new plan. */
export function addCut(plan: EditPlan, cut: Cut): EditPlan {
  return { ...plan, cuts: normalizeCuts([...plan.cuts, cut]) }
}

/** Removes whichever cut contains `sourceMs`, if any. Returns a new plan. */
export function removeCutAt(plan: EditPlan, sourceMs: number): EditPlan {
  return {
    ...plan,
    cuts: normalizeCuts(plan.cuts).filter(c => !(sourceMs >= c.start && sourceMs < c.end)),
  }
}
