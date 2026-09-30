import { describe, it, expect } from 'vitest'
import { parseWidgetCommand, WIDGET_WORDS, WIDGET_ARG_DEFAULTS } from './widgetCommands'

describe('parseWidgetCommand', () => {
  it('leaves ordinary commands to the shell', () => {
    for (const cmd of ['ls', 'git status', 'npm run build', 'cd ..', '', '   ']) {
      expect(parseWidgetCommand(cmd)).toBeNull()
    }
  })

  it('opens a widget for a bare command word', () => {
    expect(parseWidgetCommand('sys-mon')?.widget).toBe('sys-mon')
    expect(parseWidgetCommand('ftermfetch')?.widget).toBe('ftermfetch')
    expect(parseWidgetCommand('snippets')?.widget).toBe('snippets')
  })

  it('does not match a command word that is only a prefix', () => {
    expect(parseWidgetCommand('pingu')).toBeNull()
    expect(parseWidgetCommand('clipboardd')).toBeNull()
    expect(parseWidgetCommand('notes.txt')).toBeNull()
  })

  it('reads the argument, quotes stripped', () => {
    expect(parseWidgetCommand('weather Milano')?.arg).toBe('Milano')
    expect(parseWidgetCommand('imgcat "C:/My Pics/a.png"')?.arg).toBe('C:/My Pics/a.png')
    expect(parseWidgetCommand("explore 'some dir'")?.arg).toBe('some dir')
  })

  it('tolerates leading whitespace like a shell does', () => {
    expect(parseWidgetCommand('   sys-mon')?.widget).toBe('sys-mon')
  })

  it('is not fooled by a command word in the middle of a line', () => {
    expect(parseWidgetCommand('echo sys-mon')).toBeNull()
    expect(parseWidgetCommand('git ping')).toBeNull()
  })

  describe('browse vs browser', () => {
    it('keeps browse in the pane and browser in a tab', () => {
      expect(parseWidgetCommand('browse example.com')?.widget).toBe('browser')
      expect(parseWidgetCommand('browser example.com')?.widget).toBe('browser-tab')
    })
    it('matches the bare words too', () => {
      expect(parseWidgetCommand('browse')?.widget).toBe('browser')
      expect(parseWidgetCommand('browser')?.widget).toBe('browser-tab')
    })
  })

  describe('visualizer vs viz', () => {
    it('accepts both spellings with an argument', () => {
      expect(parseWidgetCommand('viz song.mp3')).toMatchObject({ widget: 'visualizer', arg: 'song.mp3' })
      expect(parseWidgetCommand('visualizer song.mp3')).toMatchObject({ widget: 'visualizer', arg: 'song.mp3' })
    })
    it('does not let viz swallow visualizer', () => {
      expect(parseWidgetCommand('visualizer')?.arg).toBe('')
    })
  })

  describe('port scanning', () => {
    it('accepts both spellings', () => {
      expect(parseWidgetCommand('portscan')?.widget).toBe('portscan')
      expect(parseWidgetCommand('port-scan')?.widget).toBe('portscan')
    })
    it('carries the host through', () => {
      expect(parseWidgetCommand('port-scan 10.0.0.1')?.arg).toBe('10.0.0.1')
    })
  })

  describe('argument-free commands stay out of the shell\'s way', () => {
    it('lets `ps` with flags reach the shell', () => {
      expect(parseWidgetCommand('ps')?.widget).toBe('data-table')
      expect(parseWidgetCommand('ps -aux')).toBeNull()
      expect(parseWidgetCommand('ps aux')).toBeNull()
    })
    it('leaves `query` to the shell — it was advertised but never implemented', () => {
      expect(parseWidgetCommand('query')).toBeNull()
      expect(parseWidgetCommand('query select 1')).toBeNull()
    })
    it('lets `clip` with arguments through', () => {
      expect(parseWidgetCommand('clip')?.widget).toBe('clipboard')
      expect(parseWidgetCommand('clip < file.txt')).toBeNull()
    })
  })

  describe('plugin gating', () => {
    it('reports the plugin that gates each widget', () => {
      expect(parseWidgetCommand('explore')?.plugin).toBe('file-explorer')
      expect(parseWidgetCommand('sys-mon')?.plugin).toBe('sys-mon')
      expect(parseWidgetCommand('docker-dash')?.plugin).toBe('docker')
      expect(parseWidgetCommand('weather')?.plugin).toBe('weather')
      expect(parseWidgetCommand('ps')?.plugin).toBe('data-table')
    })
    it('leaves ungated widgets without one', () => {
      expect(parseWidgetCommand('ping')?.plugin).toBeUndefined()
      expect(parseWidgetCommand('clipboard')?.plugin).toBeUndefined()
    })
  })

  it('flags the arguments that name a file', () => {
    expect(parseWidgetCommand('imgcat a.png')?.argIsPath).toBe(true)
    expect(parseWidgetCommand('viz a.mp3')?.argIsPath).toBe(true)
    expect(parseWidgetCommand('weather Roma')?.argIsPath).toBeUndefined()
  })

  it('marks imgcat as needing an argument', () => {
    expect(parseWidgetCommand('imgcat')?.requiresArg).toBe(true)
    expect(parseWidgetCommand('imgcat')?.arg).toBe('')
  })

  it('records which spelling was typed', () => {
    expect(parseWidgetCommand('note')?.verb).toBe('note')
    expect(parseWidgetCommand('notes')?.verb).toBe('notes')
    expect(parseWidgetCommand('ps')?.verb).toBe('ps')
  })

  it('every advertised word actually parses', () => {
    for (const word of WIDGET_WORDS) {
      expect(parseWidgetCommand(word), word).not.toBeNull()
    }
  })

  it('has a default host for the network widgets', () => {
    expect(WIDGET_ARG_DEFAULTS.ping).toBe('8.8.8.8')
    expect(WIDGET_ARG_DEFAULTS.portscan).toBe('localhost')
  })
})
