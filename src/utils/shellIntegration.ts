/**
 * OSC 133 shell integration — the marker protocol that turns a flat scrollback
 * into addressable command blocks.
 *
 * FTerm's shell init scripts emit two of the four standard markers from the
 * prompt hook, which run back to back on every prompt draw:
 *
 *   ESC ] 133 ; D ; <exitCode> ST   the command that just finished, and how
 *   ESC ] 133 ; A ST                a new prompt starts on this row
 *
 * `B` (end of prompt) and `C` (start of output) are deliberately not emitted:
 * embedding invisible sequences inside the prompt string confuses PSReadLine's
 * prompt-width accounting on Windows. The renderer already knows when the user
 * pressed Enter, so it derives those two boundaries itself.
 *
 * This module is pure string → data so the protocol can be tested directly.
 */

export type Osc133Kind = 'A' | 'B' | 'C' | 'D'

export interface Osc133Event {
  kind: Osc133Kind
  /** Only meaningful for `D`; null when the shell reported no code. */
  exitCode: number | null
}

/**
 * Parse the payload of an OSC 133 sequence — i.e. what sits between `133;` and
 * the string terminator. Returns null for anything unrecognized so an unknown
 * future marker is ignored rather than mis-attributed.
 */
export function parseOsc133(payload: unknown): Osc133Event | null {
  if (typeof payload !== 'string') return null
  const parts = payload.split(';')
  const kind = parts[0]?.trim().toUpperCase()
  if (kind !== 'A' && kind !== 'B' && kind !== 'C' && kind !== 'D') return null
  if (kind !== 'D') return { kind, exitCode: null }

  // `D` may arrive bare (`D`), with a code (`D;1`), or with extra key=value
  // fields appended by other terminals — take the first numeric field only.
  const raw = parts[1]?.trim()
  if (raw === undefined || raw === '') return { kind, exitCode: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 255) return { kind, exitCode: null }
  return { kind, exitCode: n }
}

/** Human-readable duration for a block: `820ms`, `3.4s`, `2m 05s`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** Collapse a command to one line for list display. */
export function summarizeCommand(cmd: string, max = 80): string {
  const oneLine = (cmd ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine
}
