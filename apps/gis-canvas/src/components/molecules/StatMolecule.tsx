import type { MoleculeProps } from '../registry'

export function StatMolecule({ node }: MoleculeProps) {
  const { label, value, trend } = (node.props ?? {}) as { label?: string; value?: unknown; trend?: string }
  const sign = trend?.trim().startsWith('+') ? 'positive' : trend?.trim().startsWith('-') ? 'negative' : 'neutral'
  const barClass = sign === 'positive' ? 'bg-positive' : sign === 'negative' ? 'bg-negative' : 'bg-accent'
  const trendClass = sign === 'positive' ? 'text-positive' : sign === 'negative' ? 'text-negative' : 'text-tertiary'

  return (
    <div
      data-molecule="stat"
      className="@container flex h-full items-stretch overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised"
    >
      <span aria-hidden className={`w-[3px] shrink-0 ${barClass}`} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
        <span className="truncate font-mono text-[11px] uppercase tracking-wide text-tertiary">{label ?? node.id}</span>
        <span
          className="truncate font-display font-semibold leading-none tabular-nums text-primary [font-size:clamp(1rem,7cqi,1.75rem)]"
          title={String(value ?? '—')}
        >
          {String(value ?? '—')}
        </span>
        {trend ? <span className={`truncate font-mono text-xs ${trendClass}`}>{trend}</span> : null}
      </div>
    </div>
  )
}
