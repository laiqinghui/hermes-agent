// apps/gis-canvas/src/components/molecules/SelectMolecule.tsx
import { useCanvasActions } from '../HandlerContext'
import { runHandler } from '../../lib/handlers'
import type { Handler } from '../../lib/types'
import type { MoleculeProps } from '../registry'

export function SelectMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const { field, options } = (node.props ?? {}) as { field?: string; options?: string[] }
  const value = (node.state?.value as string | undefined) ?? (options?.[0] ?? '')
  const onChange = node.handlers?.onChange as Handler | undefined

  return (
    <div className="flex h-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3">
      <label className="text-xs uppercase tracking-wide text-neutral-500">{field ?? node.id}</label>
      <select
        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
        value={value}
        onChange={e => {
          const v = e.target.value
          // record the select's own value, then run its handler with the new value
          actions.reportInteraction(node.id, { value: v })
          if (onChange) runHandler(onChange, node, actions, { value: v })
        }}
      >
        {(options ?? []).map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}
