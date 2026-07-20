import { useRef, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import type { ComponentNode, WindowRect } from '../lib/types'
import { HANDLES, type ResizeHandle } from '../lib/window-layout'

interface WindowProps {
  node: ComponentNode
  rect: WindowRect
  getContainer: () => { w: number; h: number } // LIVE accessor — called per gesture, never snapshotted
  onGestureStart: () => void                    // pointerdown: parent snapshots rect + brings to front
  onDragMove: (dxPct: number, dyPct: number, commit: boolean) => void
  onResizeMove: (handle: ResizeHandle, dxPct: number, dyPct: number, commit: boolean) => void
  children: ReactNode
}

function humanTitle(node: ComponentNode): string {
  const t = (node.props?.title as string | undefined)?.trim()
  return t || node.type.replace(/^esri:/, '').replace(/[-_]/g, ' ')
}

export function Window({ node, rect, getContainer, onGestureStart, onDragMove, onResizeMove, children }: WindowProps) {
  const start = useRef<{ x: number; y: number } | null>(null)

  // px→% deltas against the LIVE container (read at gesture start); window-level
  // listeners so a fast drag that outruns the header still tracks. Released on up.
  const beginDrag = (e: RPointerEvent) => {
    e.preventDefault() // NOT stopPropagation — must bubble to outer onGestureStart
    start.current = { x: e.clientX, y: e.clientY }
    const c = getContainer()
    const emit = (ev: PointerEvent, commit: boolean) => {
      if (!start.current) return
      onDragMove(((ev.clientX - start.current.x) / c.w) * 100, ((ev.clientY - start.current.y) / c.h) * 100, commit)
    }
    const move = (ev: PointerEvent) => emit(ev, false)
    const up = (ev: PointerEvent) => { emit(ev, true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const beginResize = (handle: ResizeHandle) => (e: RPointerEvent) => {
    e.preventDefault(); e.stopPropagation() // stop drag; bubbling is suppressed, so fire gesture start ourselves
    onGestureStart()
    start.current = { x: e.clientX, y: e.clientY }
    const c = getContainer()
    const emit = (ev: PointerEvent, commit: boolean) => {
      if (!start.current) return
      onResizeMove(handle, ((ev.clientX - start.current.x) / c.w) * 100, ((ev.clientY - start.current.y) / c.h) * 100, commit)
    }
    const move = (ev: PointerEvent) => emit(ev, false)
    const up = (ev: PointerEvent) => { emit(ev, true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      data-testid={`window-${node.id}`}
      onPointerDown={onGestureStart}
      className="gc-hud pointer-events-auto absolute flex flex-col overflow-hidden rounded-gc-md"
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, zIndex: rect.z }}
    >
      <div
        data-testid={`window-header-${node.id}`}
        onPointerDown={beginDrag}
        className="flex shrink-0 cursor-move items-center gap-1.5 border-b border-hairline/40 px-2 py-1 font-mono text-[10.5px] uppercase tracking-wide text-tertiary select-none"
      >
        <span className="truncate">{humanTitle(node)}</span>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
      {HANDLES.map(h => (
        <span key={h} data-testid={`resize-${node.id}-${h}`} onPointerDown={beginResize(h)}
          className={`absolute ${handleClass(h)}`} />
      ))}
    </div>
  )
}

// Hit-zones for the 8 handles (edges 6px, corners 12px), invisible but grabbable.
function handleClass(h: ResizeHandle): string {
  const edges: Record<ResizeHandle, string> = {
    n: 'top-0 left-0 right-0 h-1.5 cursor-ns-resize',
    s: 'bottom-0 left-0 right-0 h-1.5 cursor-ns-resize',
    e: 'top-0 bottom-0 right-0 w-1.5 cursor-ew-resize',
    w: 'top-0 bottom-0 left-0 w-1.5 cursor-ew-resize',
    ne: 'top-0 right-0 h-3 w-3 cursor-nesw-resize',
    nw: 'top-0 left-0 h-3 w-3 cursor-nwse-resize',
    se: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize',
    sw: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize',
  }
  return edges[h]
}
