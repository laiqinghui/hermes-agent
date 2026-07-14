import { useState } from 'react'
import { summarizeValue, toRows, isExpandable } from '../lib/summarize-value'

const MAX_DEPTH = 6

export function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const rows = toRows(value)
  if (!rows.length) {
    return <span className="font-mono text-[10.5px] text-primary">{summarizeValue(value)}</span>
  }
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row, i) => (
        <ValueRowView key={`${row.label}-${i}`} label={row.label} value={row.value} depth={depth} />
      ))}
    </div>
  )
}

function ValueRowView({ label, value, depth }: { label: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(false)
  const expandable = isExpandable(value) && depth < MAX_DEPTH
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        {expandable ? (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex shrink-0 items-baseline gap-1 text-left">
            <span aria-hidden className="font-mono text-[10px] text-tertiary">{open ? '▾' : '▸'}</span>
            <span className="font-sans text-[11px] text-secondary">{label}</span>
          </button>
        ) : (
          <span className="shrink-0 font-sans text-[11px] text-secondary">{label}</span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-primary">{summarizeValue(value)}</span>
      </div>
      {expandable && open ? (
        <div className="mt-0.5 border-l border-hairline pl-3">
          <StructuredValue value={value} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  )
}
