import type { ComponentNode } from '../lib/types'
import { humanTitle } from '../lib/window-state'
import { RESERVE_PCT } from '../lib/window-layout'

/** Strip of restore chips for minimized windows. Sits above the reserved
 * attribution strip at the canvas bottom (same RESERVE_PCT the seed rects use),
 * so the map's "Map data ©…" credit is never covered. */
export function WindowTaskbar({
  nodes, updated, onRestore,
}: {
  nodes: ComponentNode[]
  updated: Set<string>
  onRestore: (id: string) => void
}) {
  if (!nodes.length) return null
  return (
    <div
      data-testid="window-taskbar"
      className="gc-hud pointer-events-auto absolute left-2 right-2 z-[60] flex flex-wrap items-center gap-1.5 rounded-gc-md px-2 py-1.5"
      style={{ bottom: `${RESERVE_PCT}%` }}
    >
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-tertiary">Minimized</span>
      {nodes.map(node => (
        <button
          key={node.id}
          data-testid={`taskbar-chip-${node.id}`}
          onClick={() => onRestore(node.id)}
          title={`Restore ${humanTitle(node)}`}
          className="flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-gc-sm border border-hairline bg-surface px-2 py-1 font-sans text-[11.5px] text-secondary hover:text-primary"
        >
          <span className="truncate">{humanTitle(node)}</span>
          {updated.has(node.id) && (
            <span data-testid={`chip-badge-${node.id}`} aria-label="Updated"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}
