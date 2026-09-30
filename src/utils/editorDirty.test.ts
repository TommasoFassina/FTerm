import { describe, it, expect } from 'vitest'
import { isTabDirty, EDITOR_PLACEHOLDER } from './editorDirty'
import type { Tab } from '../types'

const tab = (over: Partial<Tab>): Tab => ({ id: 't1', title: 'x', type: 'editor', ...over })

describe('isTabDirty', () => {
  it('ignores non-editor tabs', () => {
    expect(isTabDirty(tab({ type: 'terminal', editorContent: 'a' }))).toBe(false)
    expect(isTabDirty(undefined)).toBe(false)
  })

  it('is clean for an untouched new editor', () => {
    expect(isTabDirty(tab({}))).toBe(false)
    expect(isTabDirty(tab({ editorContent: EDITOR_PLACEHOLDER }))).toBe(false)
    expect(isTabDirty(tab({ editorContent: '   \n ' }))).toBe(false)
  })

  it('is dirty once a never-saved editor holds real text', () => {
    expect(isTabDirty(tab({ editorContent: 'console.log(1)' }))).toBe(true)
  })

  it('compares against the last saved content once a file exists', () => {
    expect(isTabDirty(tab({ editorContent: 'a', editorSavedContent: 'a' }))).toBe(false)
    expect(isTabDirty(tab({ editorContent: 'ab', editorSavedContent: 'a' }))).toBe(true)
  })

  it('treats a saved-then-emptied file as dirty', () => {
    expect(isTabDirty(tab({ editorContent: '', editorSavedContent: 'a' }))).toBe(true)
  })
})
