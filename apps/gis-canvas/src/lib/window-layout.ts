import type { Anchor, CanvasDoc, ComponentNode, Edge, WindowRect } from './types'
import { applyAutoShell, edgeForType } from './auto-shell'
import { defaultDockSize, defaultSize } from './anchor'

// Attribution strip reserved at the canvas bottom on first render, as a % of
// height (the map's "Map data ©…" must stay visible). Approximates the old 22px
// px reserve; the user can nudge windows afterward, so exact px is not critical.
export const RESERVE_PCT = 3

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

function dockRect(edge: Edge, size?: { w: number; h: number }, insets: { left: number; right: number } = { left: 0, right: 0 }): Omit<WindowRect, 'z'> {
  const s = size ?? defaultDockSize(edge)
  const bottom = 100 - RESERVE_PCT
  switch (edge) {
    case 'left': return { x: 0, y: 0, w: s.w, h: bottom }
    case 'right': return { x: 100 - s.w, y: 0, w: s.w, h: bottom }
    case 'top': return { x: insets.left, y: 0, w: 100 - insets.left - insets.right, h: s.h }
    case 'bottom': return { x: insets.left, y: bottom - s.h, w: 100 - insets.left - insets.right, h: s.h }
  }
}

const FULL_BLEED = { x: 0, y: 0, w: 100, h: 100 }

/** A map at `base` is the backdrop — panels are meant to sit on top of it, and it stays
 *  full-bleed. Anything else at `base` (notably a note carrying the analysis) must NOT be
 *  left under an opaque rail: the rail hides the text *and* the note's own scrollbar, so
 *  that content becomes unreachable rather than merely scrolled away. A non-map base
 *  therefore takes the area the rails leave over. */
function baseRect(
  type: string,
  insets: { left: number; right: number; top: number; bottom: number },
): Omit<WindowRect, 'z'> {
  if (type === 'esri:map') return { ...FULL_BLEED }
  const w = 100 - insets.left - insets.right
  const h = 100 - RESERVE_PCT - insets.top - insets.bottom
  // Rails that leave no room are a malformed layout; showing the panel behind them beats
  // collapsing it to nothing.
  if (w <= 0 || h <= 0) return { ...FULL_BLEED }
  return { x: insets.left, y: insets.top, w, h }
}

/** Anchor a float inside the area the rails leave, not the raw canvas. The guidance tells
 *  the agent "panels must not overlap each other" while also inviting floats to overlay a
 *  map's interior; anchoring within the rails satisfies both. Without it a top-left float
 *  seeds under a top dock and — because seed z follows array order, not layer — can be
 *  rendered completely invisibly. With no rails the box IS the canvas, so a float overlays
 *  a full-bleed map exactly as before. */
function floatRect(
  anchor: Anchor,
  size: { w: number; h: number } | undefined,
  insets: { left: number; right: number; top: number; bottom: number },
): Omit<WindowRect, 'z'> {
  const s = size ?? defaultSize(anchor)
  const g = GAP_PCT
  let ax = insets.left, ay = insets.top
  let aw = 100 - insets.left - insets.right
  let ah = 100 - RESERVE_PCT - insets.top - insets.bottom
  // Rails leaving no room are a malformed layout: fall back to the whole canvas rather
  // than emitting a negative-origin rect.
  if (aw <= 0 || ah <= 0) { ax = 0; ay = 0; aw = 100; ah = 100 - RESERVE_PCT }
  const leftX = ax + g, rightX = ax + aw - s.w - g, midX = ax + (aw - s.w) / 2
  const topY = ay + g, bottomY = ay + ah - s.h - g, midY = ay + (ah - s.h) / 2
  switch (anchor) {
    case 'top-left': return { x: leftX, y: topY, w: s.w, h: s.h }
    case 'top': return { x: midX, y: topY, w: s.w, h: s.h }
    case 'top-right': return { x: rightX, y: topY, w: s.w, h: s.h }
    case 'left': return { x: leftX, y: midY, w: s.w, h: s.h }
    case 'center': return { x: midX, y: midY, w: s.w, h: s.h }
    case 'right': return { x: rightX, y: midY, w: s.w, h: s.h }
    case 'bottom-left': return { x: leftX, y: bottomY, w: s.w, h: s.h }
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

  // Compute rail insets before processing components: the left/right ones size the
  // horizontal docks, and all four inset a non-map base out from under the rails.
  let leftInset = 0, rightInset = 0, topInset = 0, bottomInset = 0
  resolved.components.forEach((c: ComponentNode) => {
    if (c.layer === 'dock') {
      const edge = (c.edge as Edge | undefined) ?? edgeForType(c.type)
      if (edge === 'left') {
        leftInset = c.size?.w ?? defaultDockSize('left').w
      } else if (edge === 'right') {
        rightInset = c.size?.w ?? defaultDockSize('right').w
      } else if (edge === 'top') {
        topInset = c.size?.h ?? defaultDockSize('top').h
      } else {
        bottomInset = c.size?.h ?? defaultDockSize('bottom').h
      }
    }
  })
  const insets = { left: leftInset, right: rightInset, top: topInset, bottom: bottomInset }

  resolved.components.forEach((c: ComponentNode, i: number) => {
    if (c.layer === 'base') { out[c.id] = { ...baseRect(c.type, insets), z: 0 }; return }
    if (c.layer === 'float') {
      const r = floatRect((c.anchor as Anchor | undefined) ?? 'top-left', c.size, insets)
      out[c.id] = { ...r, z: i + 1 }; return
    }
    const edge = (c.edge as Edge | undefined) ?? edgeForType(c.type)
    out[c.id] = { ...dockRect(edge, c.size, { left: leftInset, right: rightInset }), z: i + 1 }
  })
  return out
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function applyDrag(r: WindowRect, dxPct: number, dyPct: number): WindowRect {
  return { ...r, x: r.x + dxPct, y: r.y + dyPct }
}

/** Resize along a handle. West/north edges move the origin and shrink; min size clamps so a
 * window never inverts or collapses below its per-type floor. */
export function applyResize(
  r: WindowRect, h: ResizeHandle, dxPct: number, dyPct: number, min: { w: number; h: number },
): WindowRect {
  let { x, y, w, hgt } = { x: r.x, y: r.y, w: r.w, hgt: r.h }
  if (h.includes('e')) w = Math.max(min.w, r.w + dxPct)
  if (h.includes('s')) hgt = Math.max(min.h, r.h + dyPct)
  if (h.includes('w')) { const nw = Math.max(min.w, r.w - dxPct); x = r.x + (r.w - nw); w = nw }
  if (h.includes('n')) { const nh = Math.max(min.h, r.h - dyPct); y = r.y + (r.h - nh); hgt = nh }
  return { ...r, x, y, w, h: hgt }
}

/** Keep at least `marginPct` of the window on-canvas on each side, and never let
 * the top edge (the drag header) leave the top — so no window is ever lost. */
export function clampToBounds(r: WindowRect, marginPct: number): WindowRect {
  const x = Math.min(Math.max(r.x, marginPct - r.w), 100 - marginPct)
  const y = Math.min(Math.max(r.y, 0), 100 - marginPct)
  return { ...r, x, y }
}
