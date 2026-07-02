import type { MoleculeProps } from '../registry'

export function StatMolecule({ node }: MoleculeProps) {
  const { label, value, trend } = (node.props ?? {}) as { label?: string; value?: unknown; trend?: string }
  return (
    <div className="flex h-full flex-col justify-center rounded-lg border border-neutral-200 bg-white p-3">
      <span className="text-2xl font-bold">{String(value ?? '—')}</span>
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label ?? node.id}</span>
      {trend ? <span className="text-xs text-neutral-400">{trend}</span> : null}
    </div>
  )
}
