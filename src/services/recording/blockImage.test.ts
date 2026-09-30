import { describe, it, expect, vi } from 'vitest'
import { blockImageName, renderBlockImage, type BlockImageInput } from './blockImage'
import type { Ctx2D, FramePalette } from './paintFrame'

const theme: FramePalette = {
  background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
  red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff',
  cyan: '#39c5cf', magenta: '#bc8cff', white: '#b1bac4', brightBlack: '#6e7681',
}

const block: BlockImageInput = {
  command: 'npm run build',
  output: 'vite v7.3.6 building for production...\n✓ built in 3.38s',
  exitCode: 0,
  durationMs: 3380,
  cwd: 'C:/src/app',
}

/** A context that records what was asked of it, so layout can be asserted. */
function spyCanvas() {
  const calls: { text: string[]; fills: string[]; rects: number[][] } =
    { text: [], fills: [], rects: [] }
  let size = { w: 0, h: 0 }
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    fillRect: (...a: number[]) => { calls.rects.push(a) },
    fillText: (t: string) => { calls.text.push(t); calls.fills.push(String(ctx.fillStyle)) },
    measureText: (t: string) => ({ width: t.length * 8 }),
    beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    arcTo: vi.fn(), fill: vi.fn(), stroke: vi.fn(), drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as Ctx2D
  const make = (w: number, h: number) => {
    size = { w, h }
    return { canvas: { width: w, height: h } as HTMLCanvasElement, ctx }
  }
  return { make, calls, size: () => size }
}

describe('renderBlockImage', () => {
  it('returns a canvas sized for the device pixel ratio', () => {
    const spy = spyCanvas()
    const c = renderBlockImage(block, { theme, fontFamily: 'mono', scale: 2 }, spy.make)
    expect(c.width).toBeGreaterThan(0)
    const one = spyCanvas()
    renderBlockImage(block, { theme, fontFamily: 'mono', scale: 1 }, one.make)
    expect(spy.size().w).toBe(one.size().w * 2)
  })

  it('draws the command and its output', () => {
    const spy = spyCanvas()
    renderBlockImage(block, { theme, fontFamily: 'mono' }, spy.make)
    const text = spy.calls.text.join(' ')
    expect(text).toContain('npm run build')
    expect(text).toContain('built in 3.38s')
  })

  it('puts the exit code and duration on the card', () => {
    const spy = spyCanvas()
    renderBlockImage(block, { theme, fontFamily: 'mono' }, spy.make)
    expect(spy.calls.text).toContain('exit 0')
    expect(spy.calls.text).toContain('3.4 s')
  })

  it('colours a failure in the theme red and a success in green', () => {
    const ok = spyCanvas()
    renderBlockImage(block, { theme, fontFamily: 'mono' }, ok.make)
    expect(ok.calls.fills[ok.calls.text.indexOf('exit 0')]).toBe('#3fb950')

    const bad = spyCanvas()
    renderBlockImage({ ...block, exitCode: 1 }, { theme, fontFamily: 'mono' }, bad.make)
    expect(bad.calls.fills[bad.calls.text.indexOf('exit 1')]).toBe('#ff7b72')
  })

  it('says "done" when the exit code was never reported', () => {
    const spy = spyCanvas()
    renderBlockImage({ ...block, exitCode: null, durationMs: null }, { theme, fontFamily: 'mono' }, spy.make)
    expect(spy.calls.text).toContain('done')
  })

  it('shows the working directory, shortened from the left when long', () => {
    const spy = spyCanvas()
    renderBlockImage({ ...block, cwd: 'C:/' + 'very-long-folder/'.repeat(8) },
      { theme, fontFamily: 'mono' }, spy.make)
    const cwdLine = spy.calls.text.find(t => t.startsWith('…'))
    expect(cwdLine).toBeDefined()
    expect(cwdLine!.length).toBeLessThanOrEqual(60)
  })

  it('truncates long output and says how much it dropped', () => {
    const spy = spyCanvas()
    const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    renderBlockImage({ ...block, output: long }, { theme, fontFamily: 'mono', maxLines: 10 }, spy.make)
    const text = spy.calls.text.join(' ')
    expect(text).toContain('190 more lines')
    expect(text).not.toContain('line 150')
  })

  it('grows taller with more output, not wider without reason', () => {
    const short = spyCanvas(); renderBlockImage({ ...block, output: 'a' }, { theme, fontFamily: 'mono' }, short.make)
    const tall = spyCanvas(); renderBlockImage({ ...block, output: 'a\nb\nc\nd\ne' }, { theme, fontFamily: 'mono' }, tall.make)
    expect(tall.size().h).toBeGreaterThan(short.size().h)
  })

  it('caps the width so one very long line does not make a billboard', () => {
    const spy = spyCanvas()
    renderBlockImage({ ...block, output: 'x'.repeat(5000) }, { theme, fontFamily: 'mono' }, spy.make)
    expect(spy.size().w).toBeLessThan(4000)
  })

  it('handles empty output without collapsing', () => {
    const spy = spyCanvas()
    renderBlockImage({ ...block, output: '' }, { theme, fontFamily: 'mono' }, spy.make)
    expect(spy.size().h).toBeGreaterThan(0)
    expect(spy.calls.text.join(' ')).toContain('npm run build')
  })
})

describe('blockImageName', () => {
  it('derives a filename from the command', () => {
    expect(blockImageName('npm run build')).toBe('fterm-npm-run-build.png')
  })
  it('strips characters a filesystem would refuse', () => {
    expect(blockImageName('git log --oneline | head -3')).toMatch(/^fterm-[\w.-]+\.png$/)
  })
  it('falls back rather than producing a nameless file', () => {
    expect(blockImageName('   ')).toBe('fterm-command.png')
    expect(blockImageName('///')).toBe('fterm-command.png')
  })
  it('keeps the name short', () => {
    expect(blockImageName('x'.repeat(300)).length).toBeLessThan(64)
  })
})
