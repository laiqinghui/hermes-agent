import type { Anchor, CanvasDoc, ComponentNode, Edge, WindowRect } from './types'
import { applyAutoShell, edgeForType } from './auto-shell'

// Attribution strip reserved at the canvas bottom on first render, as a % of
// height (the map's "Map data ©…" must stay visible). Approximates the old 22px
// px reserve; the user can nudge windows afterward, so exact px is not critical.
export const RESERVE_PCT = 3

// Dock rail thickness as a % of the canvas box, mirroring anchor.ts DOCK_DEFAULTS.
const DOCK_PCT: Record<Edge, { w: number; h: number }> = {
  left: { w: 26, h: 100 }, right: { w: 26, h: 100 },
  top: { w: 100, h: 10 }, bottom: { w: 100, h: 34 },
}
// Float default size + anchor placement, mirroring anchor.ts FLOAT_DEFAULTS.
const FLOAT_PCT: Record<Anchor, { w: number; h: number }> = {
  'top-left': { w: 24, h: 40 }, 'top-right': { w: 24, h: 40 },
  'bottom-left': { w: 24, h: 40 }, 'bottom-right': { w: 24, h: 40 },
  left: { w: 24, h: 60 }, right: { w: 24, h: 60 },
  top: { w: 60, h: 22 }, bottom: { w: 60, h: 22 }, center: { w: 60, h: 60 },
}
const GAP_PCT = 1.5

export const MIN_SIZE_PX: Record<string, { w: number; h: number }> = {
  'esri:map': { w: 280, h: 220 },
  'data-table': { w: 260, h: 160 },
  'esri:feature-table': { w: 260, h: 160 },
  'esri:legend': { w: 180, h: 120 },
  card: { w: 160, h: 100 },
  stat: { w: 120, h: 64 },
  select: { w: 160, h: 64 },
}
const DEFAULT_MIN_PX = { w: 160, h: 100 }

export function minSizePct(type: string, container: { w: number; h: number }): { w: number; h: number } {
  const px = MIN_SIZE_PX[type] ?? DEFAULT_MIN_PX
  return { w: (px.w / container.w) * 100, h: (px.h / container.h) * 100 }
}

function dockRect(edge: Edge, size?: { w: number; h: number }): Omit<WindowRect, 'z'> {
  const s = size ?? DOCK_PCT[edge]
  const bottom = 100 - RESERVE_PCT
  switch (edge) {
    case 'left': return { x: 0, y: 0, w: s.w, h: bottom }
    case 'right': return { x: 100 - s.w, y: 0, w: s.w, h: bottom }
    case 'top': return { x: 0, y: 0, w: 100, h: s.h }
    case 'bottom': return { x: 0, y: bottom - s.h, w: 100, h: s.h }
  }
}

function floatRect(anchor: Anchor, size?: { w: number; h: number }): Omit<WindowRect, 'z'> {
  const s = size ?? FLOAT_PCT[anchor]
  const g = GAP_PCT
  const midX = (100 - s.w) / 2, midY = (100 - s.h) / 2
  const rightX = 100 - s.w - g, bottomY = 100 - s.h - g - RESERVE_PCT
  switch (anchor) {
    case 'top-left': return { x: g, y: g, w: s.w, h: s.h }
    case 'top': return { x: midX, y: g, w: s.w, h: s.h }
    case 'top-right': return { x: rightX, y: g, w: s.w, h: s.h }
    case 'left': return { x: g, y: midY, w: s.w, h: s.h }
    case 'center': return { x: midX, y: midY, w: s.w, h: s.h }
    case 'right': return { x: rightX, y: midY, w: s.w, h: s.h }
    case 'bottom-left': return { x: g, y: bottomY, w: s.w, h: s.h }
    case 'bottom': return { x: midX, y: bottomY, w: s.w, h: s.h }
    case 'bottom-right': return { x: rightX, y: bottomY, w: s.w, h: s.h }
  }
}

/** Convert the agent's auto-shell arrangement into a seed WindowRect per molecule.
 * base → full bleed; dock → its rail slot; float → its anchor point. z ascends by
 * order so docks/floats sit above the map. Pure: no DOM, no overrides. */
export function seedRects(doc: CanvasDoc): Record<string, WindowRect> {
  const resolved = applyAutoShell(doc)
  const out: Record<string, WindowRect> = {}
  resolved.components.forEach((c: ComponentNode, i: number) => {
    if (c.layer === 'base') { out[c.id] = { x: 0, y: 0, w: 100, h: 100, z: 0 }; return }
    if (c.layer === 'float') {
      const r = floatRect((c.anchor as Anchor | undefined) ?? 'top-left', c.size)
      out[c.id] = { ...r, z: i + 1 }; return
    }
    const edge = (c.edge as Edge | undefined) ?? edgeForType(c.type)
    out[c.id] = { ...dockRect(edge, c.size), z: i + 1 }
  })
  return out
}
