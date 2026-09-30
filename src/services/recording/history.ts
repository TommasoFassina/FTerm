/**
 * A small undo stack.
 *
 * Kept separate from the studio so the behaviour that matters — what undo does
 * after a redo, what happens when the cap is reached, that undoing to the
 * bottom leaves you at the original state rather than at nothing — is testable
 * without a canvas in the room.
 */

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

/** Bounded so a long editing session cannot grow without limit. */
export const HISTORY_LIMIT = 50

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] })

/**
 * Records a new state. Pushing after an undo discards the redo branch, which is
 * what every editor does: the timeline you were on is the one you kept editing.
 */
export function push<T>(h: History<T>, next: T): History<T> {
  if (Object.is(h.present, next)) return h
  const past = [...h.past, h.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  }
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0
export const canRedo = <T>(h: History<T>) => h.future.length > 0

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
  }
}

/** Back to the state the history was created with, in one step. */
export function reset<T>(h: History<T>, present: T): History<T> {
  return push(h, present)
}
