import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CanvasDoc, ComponentNode, WindowRect } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { Window } from './Window'
import { useLayout } from './LayoutProvider'
import { seedRects, applyDrag, applyResize, clampToBounds, minSizePct, type ResizeHandle } from '../lib/window-layout'
import { snapTargets, snapDrag } from '../lib/window-snap'

const GRID_PCT = 5
const SNAP_PX = 8
const MARGIN_PCT = 8

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function FreeCanvas({ doc }: { doc: CanvasDoc }) {
  const store = useLayout()
  const boxRef = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const altRef = useRef(false)
  const gestureBase = useRef<Record<string, WindowRect>>({})

  const seeds = useMemo(() => seedRects(doc), [doc])

  // Prune overrides for molecules the agent removed (sticky otherwise — NOT reset
  // on rev). Runs after each doc change.
  useEffect(() => { store.prune(doc.components.map(c => c.id)) }, [doc, store])

  // Track Alt to suppress snapping for fine placement.
  useEffect(() => {
    const track = (e: KeyboardEvent) => { altRef.current = e.altKey }
    window.addEventListener('keydown', track); window.addEventListener('keyup', track)
    return () => { window.removeEventListener('keydown', track); window.removeEventListener('keyup', track) }
  }, [])

  // LIVE container size — read per gesture, never snapshotted (boxRef is null on
  // first render; a snapshot would corrupt every delta with {1,1}).
  const getContainer = () => {
    const r = boxRef.current?.getBoundingClientRect()
    return { w: r?.width || 1, h: r?.height || 1 }
  }
  const rectOf = (id: string): WindowRect => store.get(id) ?? seeds[id]
  const baseOf = (id: string): WindowRect => gestureBase.current[id] ?? rectOf(id)
  const others = (id: string) => doc.components.filter(c => c.id !== id).map(c => rectOf(c.id))

  // Gesture start (pointerdown, drag OR resize): snapshot the rect and raise it to
  // the front so the whole gesture — and the committed override — carries the front
  // z. No store write here, so a pure click never pins a seed window; stickiness
  // begins on the first move. Each move re-bases on this fixed snapshot (Window
  // sends cumulative deltas), so drags/resizes never compound.
  const beginGesture = (id: string) => () => {
    const maxZ = Math.max(0, ...doc.components.map(c => rectOf(c.id).z))
    const cur = rectOf(id)
    gestureBase.current[id] = { ...cur, z: cur.z >= maxZ ? cur.z : maxZ + 1 }
  }
  const endGesture = (id: string) => { delete gestureBase.current[id] }

  const onDrag = (id: string) => (dxPct: number, dyPct: number, commit: boolean) => {
    // A bare click (pointerdown -> pointerup, no movement) fires exactly one
    // onDrag(0, 0, true). Guard it: no store write, no guides, no z raise — a
    // clicked-but-unmoved window must stay unpinned on its seed.
    if (dxPct === 0 && dyPct === 0) {
      if (commit) { setGuides({}); endGesture(id) }
      return
    }
    let next = applyDrag(baseOf(id), dxPct, dyPct)
    if (!altRef.current) {
      const snapped = snapDrag(next, snapTargets(others(id), GRID_PCT), (SNAP_PX / getContainer().w) * 100)
      next = snapped.rect
      setGuides({ x: snapped.guideX, y: snapped.guideY })
    }
    store.set(id, clampToBounds(next, MARGIN_PCT))
    if (commit) { setGuides({}); endGesture(id) }
  }

  const onResize = (id: string, type: string) => (handle: ResizeHandle, dxPct: number, dyPct: number, commit: boolean) => {
    if (dxPct === 0 && dyPct === 0) {
      if (commit) endGesture(id)
      return
    }
    const next = applyResize(baseOf(id), handle, dxPct, dyPct, minSizePct(type, getContainer()))
    store.set(id, clampToBounds(next, MARGIN_PCT))
    if (commit) endGesture(id)
  }

  const ordered = [...doc.components].sort((a, b) => rectOf(a.id).z - rectOf(b.id).z)

  return (
    <div ref={boxRef} data-testid="free-canvas" className="relative w-full min-h-[80vh] overflow-hidden">
      {ordered.map(node => (
        <Window
          key={node.id}
          node={node}
          rect={rectOf(node.id)}
          getContainer={getContainer}
          onGestureStart={beginGesture(node.id)}
          onDragMove={onDrag(node.id)}
          onResizeMove={onResize(node.id, node.type)}
        >
          {renderNode(node)}
        </Window>
      ))}
      {guides.x !== undefined && <div className="pointer-events-none absolute top-0 bottom-0 z-50 w-px bg-accent/70" style={{ left: `${guides.x}%` }} />}
      {guides.y !== undefined && <div className="pointer-events-none absolute left-0 right-0 z-50 h-px bg-accent/70" style={{ top: `${guides.y}%` }} />}
    </div>
  )
}
