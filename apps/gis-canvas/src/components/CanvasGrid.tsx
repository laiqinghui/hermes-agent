import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Anchor, CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { applyAutoHero, anchorForType } from '../lib/auto-hero'
import { zoneStyle, floatStyle } from '../lib/anchor'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const resolved = useMemo(() => applyAutoHero(doc), [doc])
  const base = resolved.components.find(c => c.layer === 'base')
  return base
    ? <HeroLayers doc={resolved} base={base} />
    : <GridLayer doc={resolved} />
}

// Full-bleed base + glass float panels grouped into anchor zones.
function HeroLayers({ doc, base }: { doc: CanvasDoc; base: ComponentNode }) {
  const floats = doc.components.filter(c => c !== base)
  // group floats by their (explicit or role-default) anchor
  const zones = new Map<Anchor, ComponentNode[]>()
  for (const c of floats) {
    const a = (c.anchor as Anchor | undefined) ?? anchorForType(c.type)
    const list = zones.get(a) ?? []
    list.push(c)
    zones.set(a, list)
  }
  return (
    <div className="relative w-full min-h-[80vh]">
      <div data-testid="canvas-base" className="absolute inset-0 z-0 overflow-hidden">
        {renderNode(base)}
      </div>
      <div className="absolute inset-0 z-10">
        {[...zones.entries()].map(([anchor, comps]) => (
          <div key={anchor} style={zoneStyle(anchor)}>
            {comps
              .slice()
              .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
              .map(c => {
                const a = (c.anchor as Anchor | undefined) ?? anchor
                return (
                  <div
                    key={c.id}
                    data-testid={`float-${c.id}`}
                    className="rounded-gc-md border border-hairline-strong bg-surface/90 shadow-gc-overlay backdrop-blur"
                    style={floatStyle(a, c.size)}
                  >
                    {renderNode(c)}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}

// Today's flat grid — unchanged (entrance animation preserved).
function GridLayer({ doc }: { doc: CanvasDoc }) {
  const { cols, rowHeight = 80, gap = 8 } = doc.layout

  // Tiles whose ids weren't present on a previous render get a one-time
  // materialize/scan-sweep entrance animation, driven by real doc changes.
  // The entering ids MUST live in state (not a per-render diff): the canvas
  // re-renders many times right after a tile mounts (async data loads, override
  // resets, StrictMode), and a per-render diff would drop the class on the very
  // next render. Instead we mark a tile "entering" once and only clear it on
  // animationend, so the class survives intervening re-renders.
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
