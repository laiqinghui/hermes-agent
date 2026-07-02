import type { ReactNode } from 'react'
import type { CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const { cols, rowHeight = 80, gap = 8 } = doc.layout
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
      {doc.components.map(node => {
        const area = node.area ?? { col: 1, colSpan: cols, row: 1, rowSpan: 1 }
        return (
          <div
            key={node.id}
            data-testid={`cell-${node.id}`}
            style={{
              gridColumn: `${area.col} / span ${area.colSpan}`,
              gridRow: `${area.row} / span ${area.rowSpan}`,
              minHeight: 0
            }}
          >
            {renderNode(node)}
          </div>
        )
      })}
    </div>
  )
}
