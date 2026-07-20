import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react'
import type { CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { applyAutoShell } from '../lib/auto-shell'
import { FreeCanvas } from './FreeCanvas'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const resolved = useMemo(() => applyAutoShell(doc), [doc])
  const hasBase = resolved.components.some(c => c.layer === 'base')
  return hasBase ? <FreeCanvas doc={resolved} /> : <GridLayer doc={resolved} />
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
