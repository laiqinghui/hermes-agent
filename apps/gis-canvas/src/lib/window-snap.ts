import type { WindowRect } from './types'

export interface SnapTargets { xs: number[]; ys: number[] }

/** Candidate snap lines: every other window's left/right/centre-x and
 * top/bottom/centre-y, plus grid lines at `gridPct` cadence and the canvas edges. */
export function snapTargets(others: WindowRect[], gridPct: number): SnapTargets {
  const xs = new Set<number>([0, 100])
  const ys = new Set<number>([0, 100])
  if (gridPct > 0) {
    for (let v = gridPct; v < 100; v += gridPct) { xs.add(v); ys.add(v) }
  }
  for (const o of others) {
    xs.add(o.x); xs.add(o.x + o.w); xs.add(o.x + o.w / 2)
    ys.add(o.y); ys.add(o.y + o.h); ys.add(o.y + o.h / 2)
  }
  return { xs: [...xs], ys: [...ys] }
}

function nearest(edges: number[], targets: number[], threshold: number): { offset: number; guide: number } | null {
  let best: { offset: number; guide: number } | null = null
  for (const e of edges) for (const t of targets) {
    const d = t - e
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.offset))) best = { offset: d, guide: t }
  }
  return best
}

/** Snap a dragged rect: consider left/right/centre against xs and top/bottom/centre
 * against ys; shift by the nearest within threshold and report the guide line. */
export function snapDrag(r: WindowRect, targets: SnapTargets, threshold: number): { rect: WindowRect; guideX?: number; guideY?: number } {
  const sx = nearest([r.x, r.x + r.w, r.x + r.w / 2], targets.xs, threshold)
  const sy = nearest([r.y, r.y + r.h, r.y + r.h / 2], targets.ys, threshold)
  return {
    rect: { ...r, x: r.x + (sx?.offset ?? 0), y: r.y + (sy?.offset ?? 0) },
    guideX: sx?.guide, guideY: sy?.guide,
  }
}
