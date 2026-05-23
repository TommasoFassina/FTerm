export type Style = 'bars' | 'wave' | 'ascii' | 'radial' | 'warp' | 'waterfall3d' | 'nebula' | 'scope' | 'kaleid' | 'crystal' | 'attractor' | 'none'

export interface NebulaParticle {
  x: number; y: number; px: number; py: number
  vx: number; vy: number
  hue: number; size: number; age: number; band: number
}

export interface VisualizerFrame {
  freqData: Uint8Array
  analyser: AnalyserNode
  canvas: HTMLCanvasElement
  w: number
  h: number
  isSilent: boolean
  beatPulse: number
  t: number
}

export interface VisualizerRefs {
  warpRef: { current: { canvas: HTMLCanvasElement | null; rot: number } }
  nebulaRef: { current: NebulaParticle[] }
  nebulaShockRef: { current: { r: number; alpha: number; hue: number }[] }
  nebulaBassRef: { current: { avg: number; last: number } }
  coverBitmapRef: { current: ImageBitmap | null }
  coverImgRef: { current: HTMLImageElement | null }
  coverHueRef: { current: number | null }
  waterfallRef: { current: { history: Uint8Array[]; max: number } }
}

export type VisualizerRenderer = (
  ctx: CanvasRenderingContext2D,
  frame: VisualizerFrame,
  refs: VisualizerRefs,
) => void
