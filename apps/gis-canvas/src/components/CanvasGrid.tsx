import { useEffect, useRef, type ReactNode } from 'react'
import type { CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const { cols, rowHeight = 80, gap = 8 } = doc.layout

  // Tiles whose ids weren't present on the previous render get a one-time
  // materialize/scan-sweep entrance animation ("components render live" per
  // the redesign brief) — driven by real doc changes, not a scripted timer.
  const prevIdsRef = useRef<Set<string>>(new Set())
  const currentIds = new Set(doc.components.map(n => n.id))
  const newIds = new Set([...currentIds].filter(id => !prevIdsRef.current.has(id)))
  useEffect(() => { prevIdsRef.current = currentIds }) // eslint-disable-line react-hooks/exhaustive-deps

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
        const isNew = newIds.has(node.id)
        return (
          <div
            key={node.id}
            data-testid={`cell-${node.id}`}
            className={`relative overflow-hidden${isNew ? ' gc-tile-enter' : ''}`}
            style={{
              gridColumn: `${area.col} / span ${area.colSpan}`,
              gridRow: `${area.row} / span ${area.rowSpan}`,
              minHeight: 0,
              animationDelay: isNew ? `${Math.min(i, 8) * 40}ms` : undefined
            }}
          >
            {renderNode(node)}
          </div>
        )
      })}
    </div>
  )
}
