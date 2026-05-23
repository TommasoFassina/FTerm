export type { Style, VisualizerFrame, VisualizerRefs, VisualizerRenderer, NebulaParticle } from './types'

import type { Style, VisualizerRenderer } from './types'
import { drawBars } from './bars'
import { drawWave } from './wave'
import { drawAscii } from './ascii'
import { drawRadial } from './radial'
import { drawWarp } from './warp'
import { drawWaterfall3d } from './waterfall3d'
import { drawNebula } from './nebula'
import { drawScope } from './scope'
import { drawKaleid } from './kaleid'
import { drawCrystal } from './crystal'
import { drawAttractor } from './attractor'

const drawNone: VisualizerRenderer = (ctx, { w, h }) => {
  ctx.clearRect(0, 0, w, h)
}

export const RENDERER_MAP: Record<Style, VisualizerRenderer> = {
  none: drawNone,
  bars: drawBars,
  wave: drawWave,
  ascii: drawAscii,
  radial: drawRadial,
  warp: drawWarp,
  waterfall3d: drawWaterfall3d,
  nebula: drawNebula,
  scope: drawScope,
  kaleid: drawKaleid,
  crystal: drawCrystal,
  attractor: drawAttractor,
}
