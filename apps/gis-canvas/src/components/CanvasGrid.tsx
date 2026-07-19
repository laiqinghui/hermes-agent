import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Anchor, CanvasDoc, ComponentNode, Edge } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { applyAutoShell, edgeForType } from '../lib/auto-shell'
import { railStyle, floatStyle, defaultDockSize } from '../lib/anchor'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const resolved = useMemo(() => applyAutoShell(doc), [doc])
  const base = resolved.components.find(c => c.layer === 'base')
  return base ? <ShellLayers doc={resolved} base={base} /> : <GridLayer doc={resolved} />
}

// Full-bleed base + dock rails + float cards. The shell is a definite-size box so
// all the percentage geometry below resolves (the fix for the collapse/overflow bugs).
function ShellLayers({ doc, base }: { doc: CanvasDoc; base: ComponentNode }) {
  const rest = doc.components.filter(c => c !== base)
  const floats = rest.filter(c => c.layer === 'float')
  const docks = rest.filter(c => c.layer !== 'float') // dock or leftover grid → dock

  const byEdge = new Map<Edge, ComponentNode[]>()
  for (const c of docks) {
    const e = (c.edge as Edge | undefined) ?? edgeForType(c.type)
    const list = byEdge.get(e) ?? []
    list.push(c)
    byEdge.set(e, list)
  }
  // Horizontal rails inset by adjacent vertical rails' thickness so corners don't overlap.
  const thickness = (edge: Edge): string => {
    const list = byEdge.get(edge)
    if (!list) return '0'
    const s = list[0].size ?? defaultDockSize(edge)
    return `${edge === 'left' || edge === 'right' ? s.w : s.h}%`
  }
  const insets = { left: thickness('left'), right: thickness('right') }

  return (
    <div className="relative w-full min-h-[80vh] overflow-hidden">
      <div data-testid="canvas-base" className="absolute inset-0 z-0 overflow-hidden">
        {renderNode(base)}
      </div>

      {[...byEdge.entries()].map(([edge, comps]) => (
        <div
          key={edge}
          data-testid={`dock-${edge}`}
          className="z-10"
          style={railStyle(edge, comps[0].size, edge === 'top' || edge === 'bottom' ? insets : undefined)}
        >
          {comps
            .slice()
            .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
            .map(c => (
              <div
                key={c.id}
                data-testid={`panel-${c.id}`}
                className="gc-hud rounded-gc-md min-w-0 min-h-0 flex-1 overflow-auto"
              >
                {renderNode(c)}
              </div>
            ))}
        </div>
      ))}

      {floats.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20">
          {floats.map(c => (
            <div
              key={c.id}
              data-testid={`float-${c.id}`}
              className="gc-hud pointer-events-auto rounded-gc-md"
              style={floatStyle((c.anchor as Anchor | undefined) ?? 'top-left', c.size)}
            >
              {renderNode(c)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Today's flat grid — unchanged (entrance animation preserved).
function GridLayer({ doc }: { doc: CanvasDoc }) {
  const { cols, rowHeight = 80, gap = 8 } = doc.layout

  // Tiles whose ids weren't present on a previous render get a one-time entrance
  // animation. The entering ids MUST live in state (not a per-render diff): the
  // canvas re-renders many times right after a tile mounts (async data loads,
  // override resets, StrictMode); we mark a tile "entering" once and clear it only
  // on animationend, so the class survives intervening re-renders.
  const seenRef = useRef<Set<string>>(new Set())
  const [entering, setEntering] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fresh = doc.components.map(n => n.id).filter(id => !seenRef.current.has(id))
    if (!fresh.length) return
    fresh.forEach(id => seenRef.current.add(id))
    setEntering(prev => {
      const next = new Set(prev)
      fresh.forEach(id => next.add(id))
      return next
    })
  }, [doc])

  const clearEntering = (id: string) =>
    setEntering(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  return (
    <div
      className="w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap: `${gap}px`
      }}
    >
      {doc.components.map((node, i) => {
        const area = node.area ?? { col: 1, colSpan: cols, row: 1, rowSpan: 1 }
        const isNew = entering.has(node.id)
        return (
          <div
            key={node.id}
            data-testid={`cell-${node.id}`}
            className={`relative overflow-hidden${isNew ? ' gc-tile-enter' : ''}`}
            onAnimationEnd={isNew ? (e) => { if (e.target === e.currentTarget) clearEntering(node.id) } : undefined}
            style={{
              gridColumn: `${area.col} / span ${area.colSpan}`,
              gridRow: `${area.row} / span ${area.rowSpan}`,
              minHeight: 0,
              animationDelay: isNew ? `${Math.min(i, 10) * 70}ms` : undefined
            }}
          >
            {renderNode(node)}
          </div>
        )
      })}
    </div>
  )
}
