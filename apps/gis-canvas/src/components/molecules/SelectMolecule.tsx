// apps/gis-canvas/src/components/molecules/SelectMolecule.tsx
import { useCanvasActions } from '../HandlerContext'
import { runHandler } from '../../lib/handlers'
import type { Handler } from '../../lib/types'
import type { MoleculeProps } from '../registry'

// Normalize option to {label, value} shape
interface NormalizedOption {
  label: string
  value: string
}

function normalizeOption(opt: string | Record<string, unknown>): NormalizedOption {
  if (typeof opt === 'string') {
    return { label: opt, value: opt }
  }
  const obj = opt as Record<string, unknown>
  const value = String(obj.value ?? '')
  const label = obj.label !== undefined ? String(obj.label) : value
  return { label, value }
}

export function SelectMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const { field, options } = (node.props ?? {}) as { field?: string; options?: (string | Record<string, unknown>)[] }

  // Normalize options to {label, value} shape
  const normalizedOptions = (options ?? []).map(normalizeOption)

  // Use first normalized option's value as fallback
  const fallbackValue = normalizedOptions[0]?.value ?? ''
  const value = (node.state?.value as string | undefined) ?? fallbackValue
  const onChange = node.handlers?.onChange as Handler | undefined

  return (
    <div className="flex min-w-0 h-full items-center gap-2 rounded-gc-md border border-hairline bg-surface px-3">
      <label className="truncate font-mono text-[11px] uppercase tracking-wide text-tertiary">{field ?? node.id}</label>
      <select
        className="flex-1 rounded-gc-sm border border-hairline-strong bg-surface-raised px-2 py-1 text-sm text-primary outline-none focus:ring-2 focus:ring-accent"
        style={{ colorScheme: 'light dark' }}
        value={value}
        onChange={e => {
          const v = e.target.value
          // record the select's own value, then run its handler with the new value
          actions.reportInteraction(node.id, { value: v })
          if (onChange) runHandler(onChange, node, actions, { value: v })
        }}
      >
        {normalizedOptions.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
