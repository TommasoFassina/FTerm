import { describe, it, expect } from 'vitest'
import {
  normalizeHex,
  parseITermColors,
  parseWindowsTerminalSchemes,
  stripJsonComments,
  nameFromFilename,
  importThemes,
} from './themeImport'

// Minimal but faithful .itermcolors: two ANSI slots plus the named colours.
const ITERM = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Ansi 0 Color</key>
  <dict>
    <key>Color Space</key><string>sRGB</string>
    <key>Blue Component</key><real>0.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Red Component</key><real>0.0</real>
  </dict>
  <key>Ansi 1 Color</key>
  <dict>
    <key>Blue Component</key><real>0.0</real>
    <key>Green Component</key><real>0.0</real>
    <key>Red Component</key><real>1.0</real>
  </dict>
  <key>Ansi 15 Color</key>
  <dict>
    <key>Blue Component</key><real>1.0</real>
    <key>Green Component</key><real>1.0</real>
    <key>Red Component</key><real>1.0</real>
  </dict>
  <key>Background Color</key>
  <dict>
    <key>Blue Component</key><real>0.1</real>
    <key>Green Component</key><real>0.1</real>
    <key>Red Component</key><real>0.1</real>
  </dict>
  <key>Foreground Color</key>
  <dict>
    <key>Blue Component</key><real>0.8</real>
    <key>Green Component</key><real>0.8</real>
    <key>Red Component</key><real>0.8</real>
  </dict>
  <key>Cursor Color</key>
  <dict>
    <key>Blue Component</key><real>1.0</real>
    <key>Green Component</key><real>0.5</real>
    <key>Red Component</key><real>0.0</real>
  </dict>
</dict>
</plist>`

const WT_SCHEME = {
  name: 'Campbell',
  background: '#0C0C0C',
  foreground: '#CCCCCC',
  cursorColor: '#FFFFFF',
  selectionBackground: '#FFFFFF',
  black: '#0C0C0C', red: '#C50F1F', green: '#13A10E', yellow: '#C19C00',
  blue: '#0037DA', purple: '#881798', cyan: '#3A96DD', white: '#CCCCCC',
  brightBlack: '#767676', brightRed: '#E74856', brightGreen: '#16C60C', brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF', brightPurple: '#B4009E', brightCyan: '#61D6D6', brightWhite: '#F2F2F2',
}

describe('normalizeHex', () => {
  it('expands shorthand and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('FF0000')).toBe('#ff0000')
    expect(normalizeHex('  #0D1117  ')).toBe('#0d1117')
  })

  it('keeps 8-digit colors with alpha', () => {
    expect(normalizeHex('#388BFD33')).toBe('#388bfd33')
  })

  it('rejects anything that is not a hex color', () => {
    for (const bad of ['red', '#12', '#12345', 'rgb(1,2,3)', '', null, undefined, 42, '#gggggg']) {
      expect(normalizeHex(bad)).toBeNull()
    }
  })
})

describe('parseITermColors', () => {
  it('maps ANSI slots and named colors', () => {
    const t = parseITermColors(ITERM, 'Solarized')!
    expect(t).not.toBeNull()
    expect(t.name).toBe('Solarized')
    expect(t.black).toBe('#000000')
    expect(t.red).toBe('#ff0000')
    expect(t.brightWhite).toBe('#ffffff')
    expect(t.background).toBe('#1a1a1a')     // 0.1 → 26 → 0x1a
    expect(t.foreground).toBe('#cccccc')
    expect(t.cursor).toBe('#0080ff')
  })

  it('fills unspecified slots with readable fallbacks', () => {
    const t = parseITermColors(ITERM, 'X')!
    expect(t.brightBlack).toMatch(/^#[0-9a-f]{6}$/)
    expect(t.green).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('clamps out-of-range components', () => {
    const xml = `<dict><key>Background Color</key><dict>
      <key>Red Component</key><real>1.7</real>
      <key>Green Component</key><real>-0.4</real>
      <key>Blue Component</key><real>0.5</real></dict>
      <key>Ansi 0 Color</key><dict><key>Red Component</key><real>0</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>0</real></dict>
      <key>Ansi 1 Color</key><dict><key>Red Component</key><real>0</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>0</real></dict>
      <key>Ansi 2 Color</key><dict><key>Red Component</key><real>0</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>0</real></dict>
      <key>Ansi 3 Color</key><dict><key>Red Component</key><real>0</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>0</real></dict></dict>`
    expect(parseITermColors(xml)!.background).toBe('#ff0080')
  })

  it('ignores ANSI indices outside 0–15', () => {
    const t = parseITermColors(ITERM.replace('Ansi 15 Color', 'Ansi 42 Color'), 'X')!
    expect(t.brightWhite).toBe('#ffffff')   // untouched fallback, not a crash
  })

  it('rejects non-plist and colorless input', () => {
    expect(parseITermColors('not xml at all')).toBeNull()
    expect(parseITermColors('<plist><dict><key>Foo</key><dict></dict></dict></plist>')).toBeNull()
    expect(parseITermColors(undefined as unknown as string)).toBeNull()
  })
})

describe('parseWindowsTerminalSchemes', () => {
  it('parses a bare scheme object and renames purple → magenta', () => {
    const [t] = parseWindowsTerminalSchemes(JSON.stringify(WT_SCHEME))
    expect(t.name).toBe('Campbell')
    expect(t.magenta).toBe('#881798')
    expect(t.brightMagenta).toBe('#b4009e')
    expect(t.cursor).toBe('#ffffff')
    expect(t.background).toBe('#0c0c0c')
  })

  it('parses a settings.json with a schemes array', () => {
    const settings = { profiles: {}, schemes: [WT_SCHEME, { ...WT_SCHEME, name: 'Vintage' }] }
    const themes = parseWindowsTerminalSchemes(JSON.stringify(settings))
    expect(themes.map(t => t.name)).toEqual(['Campbell', 'Vintage'])
  })

  it('parses a bare array of schemes', () => {
    expect(parseWindowsTerminalSchemes(JSON.stringify([WT_SCHEME])).length).toBe(1)
  })

  it('tolerates comments and trailing commas', () => {
    const jsonc = `{
      // Windows Terminal ships JSONC
      "schemes": [${JSON.stringify(WT_SCHEME)},],
    }`
    expect(parseWindowsTerminalSchemes(jsonc).length).toBe(1)
  })

  it('falls back to the supplied name when the scheme has none', () => {
    const { name, ...rest } = WT_SCHEME
    void name
    const [t] = parseWindowsTerminalSchemes(JSON.stringify(rest), 'my-file')
    expect(t.name).toBe('my-file')
  })

  it('rejects JSON that is not a color scheme', () => {
    expect(parseWindowsTerminalSchemes('{"hello":"world"}')).toEqual([])
    expect(parseWindowsTerminalSchemes('[1,2,3]')).toEqual([])
    expect(parseWindowsTerminalSchemes('not json')).toEqual([])
    // A partial scheme with only a couple of colours is not enough signal.
    expect(parseWindowsTerminalSchemes('{"background":"#000","red":"#f00"}')).toEqual([])
  })
})

describe('stripJsonComments', () => {
  it('leaves comment-looking text inside strings alone', () => {
    expect(stripJsonComments('{"url":"https://x.dev/a"}')).toBe('{"url":"https://x.dev/a"}')
    expect(stripJsonComments('{"a":"/* not a comment */"}')).toBe('{"a":"/* not a comment */"}')
  })

  it('removes line and block comments', () => {
    expect(JSON.parse(stripJsonComments('{"a":1 // trailing\n}'))).toEqual({ a: 1 })
    expect(JSON.parse(stripJsonComments('{/* lead */"a":1}'))).toEqual({ a: 1 })
  })

  it('handles escaped quotes inside strings', () => {
    expect(JSON.parse(stripJsonComments('{"a":"say \\"hi\\" // now"}'))).toEqual({ a: 'say "hi" // now' })
  })
})

describe('nameFromFilename', () => {
  it('strips directories and known extensions', () => {
    expect(nameFromFilename('C:\\Users\\me\\Dracula.itermcolors')).toBe('Dracula')
    expect(nameFromFilename('/home/me/nord.json')).toBe('nord')
    expect(nameFromFilename('')).toBe('Imported')
  })
})

describe('importThemes', () => {
  it('routes by extension', () => {
    expect(importThemes('Dracula.itermcolors', ITERM).themes[0].name).toBe('Dracula')
    expect(importThemes('campbell.json', JSON.stringify(WT_SCHEME)).themes[0].name).toBe('Campbell')
  })

  it('routes XML content even when the extension lies', () => {
    expect(importThemes('theme.json', ITERM).themes.length).toBe(1)
  })

  it('reports a readable error instead of throwing', () => {
    expect(importThemes('x.json', '').error).toBeTruthy()
    expect(importThemes('x.json', '{}').themes).toEqual([])
    expect(importThemes('x.itermcolors', '<plist></plist>').error).toMatch(/iTerm/)
  })
})
