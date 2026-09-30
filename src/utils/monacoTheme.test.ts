import { describe, it, expect } from 'vitest'
import { buildMonacoTheme, isLightTheme, monacoThemeId } from './monacoTheme'
import type { Theme } from '../types'

const dark: Theme = {
  id: 'github-dark', name: 'GitHub Dark',
  background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#264f78',
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
  brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
}
const light: Theme = { ...dark, id: 'solarized light', background: '#fdf6e3', foreground: '#586e75' }

describe('monacoTheme', () => {
  it('detects light vs dark backgrounds', () => {
    expect(isLightTheme(dark)).toBe(false)
    expect(isLightTheme(light)).toBe(true)
  })

  it('picks the matching Monaco base', () => {
    expect(buildMonacoTheme(dark).base).toBe('vs-dark')
    expect(buildMonacoTheme(light).base).toBe('vs')
  })

  it('carries the terminal palette into editor colors', () => {
    const t = buildMonacoTheme(dark)
    expect(t.colors['editor.background']).toBe('#0d1117')
    expect(t.colors['editorCursor.foreground']).toBe('#58a6ff')
    expect(t.colors['editor.selectionBackground']).toBe('#264f78')
  })

  it('emits token rules without the leading hash Monaco rejects', () => {
    for (const rule of buildMonacoTheme(dark).rules) {
      expect(rule.foreground).toMatch(/^[0-9a-f]{6}$/i)
    }
  })

  it('derives chrome colours from the background, not a fixed grey', () => {
    const d = buildMonacoTheme(dark).colors['editor.lineHighlightBackground']
    const l = buildMonacoTheme(light).colors['editor.lineHighlightBackground']
    expect(d).not.toBe(l)
    expect(d).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('makes a Monaco-safe id', () => {
    expect(monacoThemeId(dark)).toBe('fterm-github-dark')
    expect(monacoThemeId(light)).toBe('fterm-solarized-light')
  })
})
