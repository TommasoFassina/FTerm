import type { Theme } from '../types'

/**
 * Builds a Monaco theme out of an FTerm terminal theme.
 *
 * The editor used to be pinned to `vs-dark`, which meant a Dracula or Nord
 * terminal sat next to a VS Code grey editor in the same window. Terminal
 * palettes only define sixteen ANSI colours plus a background, so the chrome
 * (line highlight, gutter, selection, widgets) is mixed out of those two rather
 * than invented.
 */

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

const parse = (hex: string): [number, number, number] => {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (c: [number, number, number]) =>
  '#' + c.map(v => clamp(v).toString(16).padStart(2, '0')).join('')

/** k = 0 keeps a, k = 1 lands on b */
const mix = (a: string, b: string, k: number) => {
  const x = parse(a), y = parse(b)
  return toHex([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * k) as [number, number, number])
}

const luma = (hex: string) => {
  const [r, g, b] = parse(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export const isLightTheme = (t: Theme) => luma(t.background) > 0.5

/** Monaco theme id for an FTerm theme — stable, so re-defining is idempotent. */
export const monacoThemeId = (t: Theme) => 'fterm-' + t.id.replace(/[^a-z0-9-]/gi, '-')

const bare = (hex: string) => hex.replace('#', '')

export function buildMonacoTheme(t: Theme) {
  const light = isLightTheme(t)
  /** push a colour away from the background: "further from the page" */
  const away = (k: number) => mix(t.background, light ? '#000000' : '#ffffff', k)

  return {
    base: (light ? 'vs' : 'vs-dark') as 'vs' | 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: bare(t.foreground) },
      { token: 'comment', foreground: bare(t.brightBlack), fontStyle: 'italic' },
      { token: 'keyword', foreground: bare(t.magenta) },
      { token: 'keyword.control', foreground: bare(t.magenta) },
      { token: 'operator', foreground: bare(t.cyan) },
      { token: 'string', foreground: bare(t.green) },
      { token: 'string.escape', foreground: bare(t.brightCyan) },
      { token: 'number', foreground: bare(t.yellow) },
      { token: 'constant', foreground: bare(t.yellow) },
      { token: 'regexp', foreground: bare(t.brightRed) },
      { token: 'type', foreground: bare(t.brightYellow) },
      { token: 'type.identifier', foreground: bare(t.brightYellow) },
      { token: 'identifier', foreground: bare(t.foreground) },
      { token: 'variable', foreground: bare(t.foreground) },
      { token: 'variable.parameter', foreground: bare(t.brightRed) },
      { token: 'function', foreground: bare(t.blue) },
      { token: 'tag', foreground: bare(t.red) },
      { token: 'attribute.name', foreground: bare(t.brightBlue) },
      { token: 'attribute.value', foreground: bare(t.green) },
      { token: 'delimiter', foreground: bare(mix(t.foreground, t.background, 0.35)) },
      { token: 'invalid', foreground: bare(t.brightRed) },
    ],
    colors: {
      'editor.background': t.background,
      'editor.foreground': t.foreground,
      'editorCursor.foreground': t.cursor,
      'editor.selectionBackground': t.selectionBackground,
      'editor.inactiveSelectionBackground': mix(t.background, t.selectionBackground, 0.5),
      'editor.lineHighlightBackground': away(0.05),
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': mix(t.background, t.foreground, 0.35),
      'editorLineNumber.activeForeground': t.foreground,
      'editorIndentGuide.background1': away(0.09),
      'editorIndentGuide.activeBackground1': away(0.22),
      'editorWhitespace.foreground': away(0.14),
      'editorGutter.background': t.background,
      'editorWidget.background': away(0.06),
      'editorWidget.border': away(0.14),
      'editorSuggestWidget.background': away(0.06),
      'editorSuggestWidget.selectedBackground': mix(t.background, t.blue, 0.28),
      'editorHoverWidget.background': away(0.06),
      'input.background': away(0.09),
      'input.foreground': t.foreground,
      'focusBorder': t.blue,
      'editorBracketMatch.background': mix(t.background, t.blue, 0.22),
      'editorBracketMatch.border': t.blue,
      'editorError.foreground': t.red,
      'editorWarning.foreground': t.yellow,
      'editorInfo.foreground': t.blue,
      'editorOverviewRuler.border': '#00000000',
      'scrollbarSlider.background': away(0.10),
      'scrollbarSlider.hoverBackground': away(0.16),
      'scrollbarSlider.activeBackground': away(0.22),
      'minimap.background': t.background,
      'editorStickyScroll.background': away(0.04),
    } as Record<string, string>,
  }
}
