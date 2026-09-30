/**
 * asciicast v2 export.
 *
 * An MP4 of a terminal is a picture of text: tens of megabytes, unselectable,
 * unsearchable, and it will not go in a README. asciicast is the format the
 * terminal world actually shares — a JSON header followed by one line per
 * output event — and a take is already almost in that shape, because the
 * recorder stores ANSI-serialized viewport rows rather than pixels.
 *
 * Spec: https://docs.asciinema.org/manual/asciicast/v2/
 *
 * Pure, so the same edit plan that drives the video drives this too and both
 * come out with identical trims, cuts and speed.
 */

import { keptRanges, type EditPlan } from './editPlan'

export interface CastSnapshot {
  timestamp: number
  buffer: string
  cols: number
  rows: number
}

export interface CastOptions {
  /** Included in the header so a player sizes itself correctly. */
  cols?: number
  rows?: number
  title?: string
  /** Environment recorded in the header, purely informational. */
  shell?: string
  term?: string
}

/**
 * Redraws a full frame: home the cursor, clear, then paint the rows.
 *
 * A recorder that captured deltas could emit an incremental stream, but this
 * one captures whole viewports, so every event is a repaint. That costs a
 * little size and buys exactness — no way for the reconstruction to drift from
 * what was on screen.
 */
function frameToWrite(buffer: string): string {
  const ESC = '\x1b'
  // \e[H home, \e[2J clear screen, \e[3J clear scrollback
  return `${ESC}[H${ESC}[2J${ESC}[3J` + buffer.split('\n').join('\r\n')
}

/**
 * Builds the `.cast` text for a take under an edit plan.
 *
 * Timestamps are rebuilt from scratch rather than shifted: cuts remove material
 * from the middle, so the surviving frames have to be renumbered or a player
 * would sit through the gap it was told to skip.
 */
export function buildCast(
  snapshots: CastSnapshot[],
  plan: EditPlan,
  options: CastOptions = {},
): string {
  const first = snapshots[0]
  const cols = options.cols ?? first?.cols ?? 80
  const rows = options.rows ?? first?.rows ?? 24
  const speed = plan.speed > 0 ? plan.speed : 1

  const header: Record<string, unknown> = {
    version: 2,
    width: cols,
    height: rows,
    timestamp: Math.floor(Date.now() / 1000),
    env: { SHELL: options.shell ?? '', TERM: options.term ?? 'xterm-256color' },
  }
  if (options.title) header.title = options.title

  const lines: string[] = [JSON.stringify(header)]

  let outputMs = 0
  let lastWritten: string | null = null

  const ranges = keptRanges(plan)
  for (const range of ranges) {
    /* Ranges are half-open, which is right at a cut boundary: a frame at
       exactly `cut.start` belongs to the material being removed. The final
       range ends at the trim point, though, and the frame sitting exactly
       there is the last thing the viewer should see — without this the closing
       frame of every take was silently dropped. */
    const endInclusive = range === ranges[ranges.length - 1]
    // The frame in effect when this range opens, so a cut never starts mid-blank
    const startIdx = indexAtOrBefore(snapshots, range.start)
    const rangeStartOut = outputMs

    for (let i = Math.max(0, startIdx); i < snapshots.length; i++) {
      const snap = snapshots[i]
      if (endInclusive ? snap.timestamp > range.end : snap.timestamp >= range.end) break
      // frames before the range only matter as the opening state
      const at = Math.max(snap.timestamp, range.start)
      if (snap.timestamp < range.start && i !== startIdx) continue

      const data = frameToWrite(snap.buffer)
      // Consecutive identical viewports carry no information in this format
      if (data === lastWritten) continue
      lastWritten = data

      const t = (rangeStartOut + (at - range.start) / speed) / 1000
      lines.push(JSON.stringify([Number(t.toFixed(6)), 'o', data]))
    }

    outputMs += (range.end - range.start) / speed
  }

  return lines.join('\n') + '\n'
}

/** Index of the last snapshot at or before `t`, or 0 when `t` precedes them all. */
function indexAtOrBefore(snapshots: CastSnapshot[], t: number): number {
  let lo = 0, hi = snapshots.length - 1
  if (snapshots.length === 0) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (snapshots[mid].timestamp <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Rough byte size, so the studio can show it before writing anything. */
export const castSize = (cast: string) => new TextEncoder().encode(cast).length
