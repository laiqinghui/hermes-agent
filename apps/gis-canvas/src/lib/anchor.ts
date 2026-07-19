import type { CSSProperties } from 'react'
import type { Anchor, Size } from './types'

const GAP = 12 // px inset from the canvas edge and between tiled floats

const DEFAULTS: Record<Anchor, Size> = {
  'top-left': { w: 24, h: 40 },
  'top-right': { w: 24, h: 40 },
  'bottom-left': { w: 24, h: 40 },
  'bottom-right': { w: 24, h: 40 },
  left: { w: 24, h: 60 },
  right: { w: 24, h: 60 },
  top: { w: 60, h: 22 },
  bottom: { w: 92, h: 34 },
  center: { w: 60, h: 60 },
}

export function defaultSize(anchor: Anchor): Size {
  return DEFAULTS[anchor]
}

// Absolute position + flex layout for the container holding every float that
// shares this anchor. Horizontal strips (top/bottom) flow as a centered row;
// everything else stacks as a column aligned to its edge. The container is
// capped and its floats scroll, so a zone can never overflow the canvas.
// NOTE: transforms are set inline here (never as Tailwind `-translate-*`
// classes) so they don't compose with any keyframe transform (the Phase 6
// centering gotcha); floats do not get an entrance animation.
export function zoneStyle(anchor: Anchor): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    display: 'flex',
    gap: `${GAP}px`,
    maxWidth: `calc(100% - ${GAP * 2}px)`,
    maxHeight: `calc(100% - ${GAP * 2}px)`,
    pointerEvents: 'none', // panels re-enable it (see floatStyle)
  }
  switch (anchor) {
    case 'top-left':
      return { ...base, top: GAP, left: GAP, flexDirection: 'column', alignItems: 'flex-start' }
    case 'top-right':
      return { ...base, top: GAP, right: GAP, flexDirection: 'column', alignItems: 'flex-end' }
    case 'bottom-left':
      return { ...base, bottom: GAP, left: GAP, flexDirection: 'column', alignItems: 'flex-start' }
    case 'bottom-right':
      return { ...base, bottom: GAP, right: GAP, flexDirection: 'column', alignItems: 'flex-end' }
    case 'left':
      return { ...base, top: '50%', left: GAP, transform: 'translateY(-50%)', flexDirection: 'column', alignItems: 'flex-start' }
    case 'right':
      return { ...base, top: '50%', right: GAP, transform: 'translateY(-50%)', flexDirection: 'column', alignItems: 'flex-end' }
    case 'center':
      return { ...base, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', flexDirection: 'column', alignItems: 'center' }
    case 'top':
      return { ...base, top: GAP, left: GAP, right: GAP, flexDirection: 'row', justifyContent: 'center' }
    case 'bottom':
      return { ...base, bottom: GAP, left: GAP, right: GAP, flexDirection: 'row', justifyContent: 'center' }
  }
}

// One float panel's box: width/height as a percent (of its zone container),
// capped so tall content scrolls inside the glass panel rather than overflowing.
export function floatStyle(anchor: Anchor, size?: Size): CSSProperties {
  const s = size ?? defaultSize(anchor)
  return {
    width: `${s.w}%`,
    maxHeight: `${s.h}%`,
    overflow: 'auto',
    pointerEvents: 'auto',
    flex: '0 0 auto',
  }
}
