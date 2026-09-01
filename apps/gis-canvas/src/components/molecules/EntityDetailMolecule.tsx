import { useEffect, useMemo, useState } from 'react'
import { useCanvasActions } from '../HandlerContext'
import { useSelectionState, useSelectionActions } from '../SelectionContext'
import { useOntology } from '../OntologyContext'
import { fetchSourceData } from '../../lib/source-fetch'
import { typeForSource, resolveEntity, resolveLinks, type SourceData, type EntityRef } from '../../lib/ontology'
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
  const selActions = useSelectionActions()
  const actions = useCanvasActions()
  const [stack, setStack] = useState<Array<EntityRef & { title: string }>>([])

  // Selection-derived focal (first ontology-mapped source with a selected key).
  const selFocal = useMemo(() => {
    for (const [source, keys] of Object.entries(selection)) {
      if (!keys?.length) continue
      const type = typeForSource(ontology, source)
      if (type) return { type, source, key: keys[keys.length - 1] } as { type: string; source: string; key: string }
    }
    return null
  }, [selection, ontology])

  // A new selection resets the pivot stack (new drill root).
  const selKey = selFocal ? `${selFocal.source}:${selFocal.key}` : ''
  useEffect(() => { setStack([]) }, [selKey])

  // Displayed target: stack top if present, else the selection focal.
  const top = stack.length ? stack[stack.length - 1] : null
  const focus = top ? { type: top.type, source: top.source, key: top.key } : selFocal

  // Fetch the focal source + all sources its type's links can reach; memoize per source.
  const [sources, setSources] = useState<Record<string, SourceData>>({})
  useEffect(() => {
    if (!focus || !ontology) return
    const et = ontology[focus.type]
    const needed = new Set<string>([focus.source])
    for (const l of Object.values(et?.links ?? {})) { const t = ontology[l.to]; if (t) needed.add(t.source) }
    let cancelled = false
    Promise.all([...needed].map(async s => [s, await fetchSourceData(actions, s)] as const))
      .then(pairs => { if (!cancelled) setSources(prev => ({ ...prev, ...Object.fromEntries(pairs) })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [focus?.type, focus?.source, ontology, actions])

  const data = focus ? sources[focus.source] : undefined
  const resolved = useMemo(() => (focus && data && ontology ? resolveEntity(ontology, focus.type, data, focus.key) : null), [ontology, focus, data])
  const links = useMemo(() => (resolved && ontology && focus ? resolveLinks(ontology, focus.type, resolved.row, sources) : []), [resolved, ontology, focus, sources])

  const anySelection = Object.values(selection).some(k => k?.length)
  if (!focus) return <Frame><Hint text={anySelection ? 'Selection is not an ontology entity' : 'Select an entity to see its details'} /></Frame>
  if (!data) return <Frame><Hint text="Loading…" /></Frame>
  // A refused handle is not "no match" — report the data-plane reason instead.
  if (!resolved) return <Frame><Hint text={data.error ?? `No matching ${focus.type} for "${focus.key}"`} /></Frame>

  const e = resolved.entity
  const pivot = (ref: EntityRef, title: string) => {
    setStack(s => [...s, { ...ref, title }])
    selActions.set(ref.source, [ref.key])
  }
  const popTo = (i: number) => setStack(s => s.slice(0, i))

  return (
    <Frame>
      {stack.length ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 font-mono text-[10px] text-tertiary">
          <button onClick={() => popTo(0)} className="hover:text-accent">‹ {selFocal?.type ?? 'root'}</button>
          {stack.slice(0, -1).map((r, i) => (
            <button key={i} onClick={() => popTo(i + 1)} className="hover:text-accent">/ {r.title || r.id}</button>
          ))}
        </div>
      ) : null}
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
      {links.length ? (
        <div className="mb-3 border-t border-hairline pt-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-tertiary">Relationships</div>
          {links.map(g => (
            <div key={g.name} className="mb-1.5">
              <div className="font-mono text-[10px] text-tertiary">{g.name}</div>
              <div className="flex flex-wrap gap-1">
                {g.entities.map(r => (
                  <button
                    key={`${r.ref.source}:${r.ref.key}`}
                    onClick={() => pivot(r.ref, r.title)}
                    className="rounded-gc-sm border border-hairline bg-surface-raised px-1.5 py-0.5 text-xs text-primary hover:border-accent hover:text-accent"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="border-t border-hairline pt-2">
        <div className="font-mono text-[9px] uppercase tracking-wide text-tertiary">Provenance</div>
        <div className="truncate font-mono text-[11px] text-secondary">{e.provenance.source}</div>
      </div>
    </Frame>
  )
}
