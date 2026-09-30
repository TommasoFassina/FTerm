import { describe, it, expect } from 'vitest'
import { canRedo, canUndo, HISTORY_LIMIT, initHistory, push, redo, undo } from './history'

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory('a')
    expect(h.present).toBe('a')
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('undoes back to the state it was created with', () => {
    let h = push(push(initHistory('a'), 'b'), 'c')
    expect(h.present).toBe('c')
    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    expect(canUndo(h)).toBe(false)
  })

  it('redoes what it undid', () => {
    let h = push(push(initHistory('a'), 'b'), 'c')
    h = undo(undo(h))
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toBe('b')
    h = redo(h)
    expect(h.present).toBe('c')
    expect(canRedo(h)).toBe(false)
  })

  it('drops the redo branch once you edit again', () => {
    let h = push(push(initHistory('a'), 'b'), 'c')
    h = undo(h)               // back at b, c is redoable
    h = push(h, 'd')          // a new edit from b
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe('d')
    expect(undo(h).present).toBe('b')
  })

  it('ignores a push of the identical state', () => {
    const a = { n: 1 }
    const h = push(initHistory(a), a)
    expect(canUndo(h)).toBe(false)
  })

  it('records a distinct but equal-looking state', () => {
    const h = push(initHistory({ n: 1 }), { n: 1 })
    expect(canUndo(h)).toBe(true)
  })

  it('undo and redo on an empty stack are no-ops, not errors', () => {
    const h = initHistory('a')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('caps the stack and forgets the oldest states first', () => {
    let h = initHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = push(h, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.present).toBe(HISTORY_LIMIT + 10)
    // the very first states are gone, the recent ones survive
    expect(h.past[h.past.length - 1]).toBe(HISTORY_LIMIT + 9)
    expect(h.past[0]).toBeGreaterThan(0)
  })

  it('never mutates the history it was given', () => {
    const h = push(initHistory('a'), 'b')
    const snapshot = JSON.stringify(h)
    push(h, 'c'); undo(h); redo(undo(h))
    expect(JSON.stringify(h)).toBe(snapshot)
  })
})
