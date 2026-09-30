import type { Tab } from '../types'

/**
 * An editor tab is dirty when its buffer differs from what last hit disk.
 *
 * A tab that has never been saved counts as dirty only once it holds something
 * other than the placeholder — otherwise every freshly opened editor would ask
 * for confirmation on close.
 */
export const EDITOR_PLACEHOLDER = '// Type your code here...'

export function isTabDirty(tab: Tab | undefined): boolean {
  if (!tab || tab.type !== 'editor') return false
  const content = tab.editorContent
  if (content === undefined) return false
  if (tab.editorSavedContent === undefined) {
    return content.trim() !== '' && content !== EDITOR_PLACEHOLDER
  }
  return content !== tab.editorSavedContent
}
