import { useEffect, useMemo, useState } from 'react'
import { useCanvasActions } from '../HandlerContext'
import { useSelectionState } from '../SelectionContext'
import { useOntology } from '../OntologyContext'
import { fetchSourceData } from '../../lib/source-fetch'
import { typeForSource, resolveEntity, type SourceData } from '../../lib/ontology'
import type { MoleculeProps } from '../registry'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface">
      <div className="flex shrink-0 items-center border-b border-hairline px-3 py-2">
        <span className="font-display text-xs font-semibold uppercase tracking-wide text-primary">Entity</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </div>
  )
}
const Hint = ({ text }: { text: string }) => <div className="flex h-full items-center justify-center text-center font-sans text-xs text-tertiary">{text}</div>

export function EntityDetailMolecule({ node: _node }: MoleculeProps) {
  const ontology = useOntology()
  const selection = useSelectionState()
  const actions = useCanvasActions()

  // First ontology-mapped source with a selected key drives the panel (last-selected key).
  const focal = useMemo(() => {
    for (const [source, keys] of Object.entries(selection)) {
      if (!keys?.length) continue
      const type = typeForSource(ontology, source)
      if (type) return { source, type, key: keys[keys.length - 1] }
    }
    return null
  }, [selection, ontology])

  const [data, setData] = useState<SourceData | null>(null)
  useEffect(() => {
    if (!focal) { setData(null); return }
    let cancelled = false
    setData(null)
    fetchSourceData(actions, focal.source).then(d => { if (!cancelled) setData(d) }).catch(() => { if (!cancelled) setData({ schema: [], rows: [] }) })
    return () => { cancelled = true }
  }, [focal?.source, actions])

  const resolved = useMemo(() => (focal && data ? resolveEntity(ontology!, focal.type, data, focal.key) : null), [ontology, focal, data])

  const anySelection = Object.values(selection).some(k => k?.length)
  if (!focal) return <Frame><Hint text={anySelection ? 'Selection is not an ontology entity' : 'Select an entity to see its details'} /></Frame>
  if (!data) return <Frame><Hint text="Loading…" /></Frame>
  if (!resolved) return <Frame><Hint text={`No matching ${focal.type} for "${focal.key}"`} /></Frame>

  const e = resolved.entity
  return (
    <Frame>
      <div className="mb-3">
        <span className="rounded-full border border-hairline bg-surface-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">{e.typeLabel}</span>
        <div className="mt-1 font-display text-sm font-semibold text-primary">{e.title}</div>
        <div className="font-mono text-[11px] text-tertiary">{e.ref.id}</div>
      </div>
      <dl className="mb-3 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1">
        {e.props.map(p => (
          <div key={p.label} className="contents">
            <dt className="truncate font-mono text-[11px] uppercase tracking-wide text-tertiary">{p.label}</dt>
            <dd className="truncate text-xs text-primary">{p.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-hairline pt-2">
        <div className="font-mono text-[9px] uppercase tracking-wide text-tertiary">Provenance</div>
        <div className="truncate font-mono text-[11px] text-secondary">{e.provenance.source}</div>
      </div>
    </Frame>
  )
}
