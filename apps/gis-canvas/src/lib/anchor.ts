import type { CSSProperties } from 'react'
import type { Anchor, Edge, Size } from './types'

const GAP = 12 // px inset/padding

const FLOAT_DEFAULTS: Record<Anchor, Size> = {
  'top-left': { w: 24, h: 40 }, 'top-right': { w: 24, h: 40 },
  'bottom-left': { w: 24, h: 40 }, 'bottom-right': { w: 24, h: 40 },
  left: { w: 24, h: 60 }, right: { w: 24, h: 60 },
  top: { w: 60, h: 22 }, bottom: { w: 60, h: 22 }, center: { w: 60, h: 60 },
}

const DOCK_DEFAULTS: Record<Edge, Size> = {
  left: { w: 26, h: 100 }, right: { w: 26, h: 100 },
  top: { w: 100, h: 10 }, bottom: { w: 100, h: 34 },
}

export function defaultSize(anchor: Anchor): Size { return FLOAT_DEFAULTS[anchor] }
export function defaultDockSize(edge: Edge): Size { return DOCK_DEFAULTS[edge] }

export interface RailInsets { left?: string; right?: string }

// A dock rail: absolute, definite-size flex box pinned to `edge`. Vertical rails
// fill full height (top:0;bottom:0) with a % width; horizontal rails fill width
// (inset by any adjacent vertical rails) with a % height. Definite by construction
// so thickness and children percentages resolve.
export function railStyle(edge: Edge, size?: Size, insets: RailInsets = {}): CSSProperties {
  const s = size ?? DOCK_DEFAULTS[edge]
  const base: CSSProperties = { position: 'absolute', display: 'flex', gap: `${GAP}px`, padding: `${GAP}px` }
  switch (edge) {
    case 'left': return { ...base, top: 0, bottom: 0, left: 0, width: `${s.w}%`, flexDirection: 'column' }
    case 'right': return { ...base, top: 0, bottom: 0, right: 0, width: `${s.w}%`, flexDirection: 'column' }
    case 'top': return { ...base, top: 0, left: insets.left ?? 0, right: insets.right ?? 0, height: `${s.h}%`, flexDirection: 'row' }
    case 'bottom': return { ...base, bottom: 0, left: insets.left ?? 0, right: insets.right ?? 0, height: `${s.h}%`, flexDirection: 'row' }
  }
}

// A float card: absolute at the anchor, sized as a % of the definite inset-0 float
// layer (so width/maxHeight resolve). One card per anchor is the norm (auto-shell
// uses docks); multiple same-anchor floats are agent-authored and may overlap.
// NOTE: transforms are inline (never Tailwind `-translate-*`) so they don't compose
// with any keyframe transform (the Phase 6 centering gotcha).
export function floatStyle(anchor: Anchor, size?: Size): CSSProperties {
  const s = size ?? FLOAT_DEFAULTS[anchor]
  const box: CSSProperties = { position: 'absolute', width: `${s.w}%`, maxHeight: `${s.h}%`, overflow: 'auto' }
  switch (anchor) {
    case 'top-left': return { ...box, top: GAP, left: GAP }
    case 'top': return { ...box, top: GAP, left: '50%', transform: 'translateX(-50%)' }
    case 'top-right': return { ...box, top: GAP, right: GAP }
    case 'left': return { ...box, top: '50%', left: GAP, transform: 'translateY(-50%)' }
    case 'center': return { ...box, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }
    case 'right': return { ...box, top: '50%', right: GAP, transform: 'translateY(-50%)' }
    case 'bottom-left': return { ...box, bottom: GAP, left: GAP }
    case 'bottom': return { ...box, bottom: GAP, left: '50%', transform: 'translateX(-50%)' }
    case 'bottom-right': return { ...box, bottom: GAP, right: GAP }
  }
}
