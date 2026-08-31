import type { MoleculeProps } from '../registry'
import { renderMarkdown } from '../../lib/markdown'

/** Agent-authored prose: key judgments, prioritization, caveats. The canvas's only
 *  way to show analysis rather than retrieved data. */
export function NoteMolecule({ node }: MoleculeProps) {
  const { title, body } = (node.props ?? {}) as { title?: string; body?: string }
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
      {title ? (
        <div className="shrink-0 truncate border-b border-hairline px-3 py-2 font-display text-sm font-semibold text-primary">
          {title}
        </div>
      ) : null}
      <div data-molecule="note" className="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm leading-relaxed text-secondary">
        {renderMarkdown(body ?? '')}
      </div>
    </div>
  )
}
