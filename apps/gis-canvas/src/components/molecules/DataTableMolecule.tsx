import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from '@tanstack/react-table'
import { resolveMockSource, type MockSource, type MockField } from '../../lib/mock-data'
import { isDataHandle } from '../../lib/data-plane'
import { categoryColorVar } from '../../lib/category-color'
import { useCanvasActions } from '../HandlerContext'
import { useLinkedSelection } from '../SelectionContext'
import { resolveIdField } from '../../lib/selection'
import { Skeleton } from '../atoms/Skeleton'
import type { MoleculeProps } from '../registry'

type Row = Record<string, string | number>
const helper = createColumnHelper<Row>()

/** Rows the agent computed itself (gap windows, rankings): no data:// handle exists
 *  for them, and bindings only carries strings, so they travel in props.rows. */
function inlineSource(props: Record<string, unknown> | undefined): MockSource | null {
  const rows = props?.rows as Array<Record<string, string | number>> | undefined
  if (!Array.isArray(rows)) return null
  const declared = props?.schema as MockField[] | undefined
  const schema = declared ?? (rows.length === 0 ? [] : Object.keys(rows[0]).map(name => ({
    name,
    type: typeof rows[0][name] === 'number' ? 'number' : 'string'
  })) as MockField[])
  return { schema, rows }
}

export function DataTableMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const source = (Array.isArray(node.bindings?.source) ? node.bindings!.source[0] : node.bindings?.source) ?? ''

  // data:// handles are pulled from the broker (data plane); mock:// resolves locally.
  const [fetched, setFetched] = useState<MockSource | null>(null)
  // A failed fetch must never render as an ordinary empty table: an expired handle looks
  // identical to "the query found nothing", which hides a recoverable cache problem.
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    if (isDataHandle(source)) {
      actions
        .fetchData(source, { pageSize: 1000 })
        .then(p => {
          if (cancelled) return
          if (p?.ok === false) {
            setLoadError(p.errors?.[0] ?? 'could not load this data handle')
            setFetched({ schema: [], rows: [] })
            return
          }
          setFetched({ schema: (p.schema ?? []) as MockField[], rows: (p.rows ?? []) as Array<Record<string, string | number>> })
        })
        .catch(() => { if (!cancelled) { setLoadError('could not reach the data plane'); setFetched({ schema: [], rows: [] }) } })
    } else {
      setFetched(null)
    }
    return () => { cancelled = true }
  }, [source, actions])

  const inline = useMemo(() => inlineSource(node.props), [node.props])
  // bindings.source always wins; inline rows are the fallback for agent-computed tables
  const data = isDataHandle(source) ? fetched : (source ? resolveMockSource(source) : inline)
  const wanted = (node.props?.columns as string[] | undefined) ?? null
  const filter = (node.state?.filter as Record<string, string> | undefined) ?? {}
  const [selected, setSelected] = useLinkedSelection(source)
  const [sorting, setSorting] = useState<SortingState>([])
  const firstSelRef = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => { if (selected.length) firstSelRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [selected])

  // client-side filter (reactive, no agent turn): keep rows matching every
  // active filter entry (ignore empty / 'all').
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const active = Object.entries(filter).filter(([, v]) => v && v !== 'all')
    if (!active.length) return all
    return all.filter(r => active.every(([k, v]) => String(r[k]) === v))
  }, [data, filter])

  const idField = resolveIdField(data?.schema, data?.rows)
  const fields = useMemo(
    () => (data?.schema ?? []).filter(f => !wanted || wanted.includes(f.name)),
    [data, wanted]
  )
  const columns = useMemo(
    () => fields.map(f => helper.accessor(row => row[f.name], { id: f.name, header: f.name })),
    [fields]
  )

  // Domain-agnostic categorical-column detection: a string field whose values repeat
  // (not every row unique) within a small vocabulary reads as a category and gets a
  // colored chip; a field with mostly-unique values (ids, free text, timestamps) does not.
  // No schema change needed — this works for any agent-authored table.
  const categoricalFields = useMemo(() => {
    const set = new Set<string>()
    for (const f of fields) {
      if (f.type !== 'string' || rows.length < 2) continue
      const distinct = new Set(rows.map(r => String(r[f.name])))
      if (distinct.size > 1 && distinct.size <= 8 && distinct.size < rows.length) set.add(f.name)
    }
    return set
  }, [fields, rows])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  })

  if (loadError) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
          <span className="truncate font-display text-sm font-semibold text-primary">
            {(node.props?.title as string | undefined) ?? source}
          </span>
        </div>
        <div className="min-h-0 flex-1 p-3 text-sm text-negative">{loadError}</div>
      </div>
    )
  }

  if (!data) {
    // A data:// handle that hasn't resolved yet is loading, not unknown.
    if (isDataHandle(source)) {
      return (
        <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
          <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
            <span className="truncate font-display text-sm font-semibold text-primary">
              {(node.props?.title as string | undefined) ?? source}
            </span>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <Skeleton rows={8} />
          </div>
        </div>
      )
    }
    return <div className="p-2 text-sm text-negative">Unknown data source: {source || '(none)'}</div>
  }

  const toggle = (rowId: string) => {
    setSelected(selected.includes(rowId) ? selected.filter(x => x !== rowId) : [...selected, rowId])
  }

  const title = (node.props?.title as string | undefined) ?? (source || node.id)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
        <span className="truncate font-display text-sm font-semibold text-primary">{title}</span>
        <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-tertiary">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-raised">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                <th className="w-6 border-b border-hairline-strong px-2 py-1.5" />
                {hg.headers.map(h => {
                  const field = fields.find(f => f.name === h.column.id)
                  return (
                    <th
                      key={h.id}
                      onClick={h.column.getToggleSortingHandler()}
                      className={`cursor-pointer select-none border-b border-hairline-strong px-2 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-tertiary hover:text-primary ${field?.type === 'number' ? 'text-right' : 'text-left'}`}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => {
              const rid = String(row.original[idField])
              const isSel = selected.includes(rid)
              return (
                <tr
                  key={row.id}
                  ref={selected[0] === rid ? firstSelRef : undefined}
                  className={`border-l-2 transition-colors hover:bg-accent/5 ${
                    isSel ? 'border-l-accent bg-accent/10' : `border-l-transparent ${i % 2 ? 'bg-surface-raised/40' : ''}`
                  }`}
                >
                  <td className="border-b border-hairline px-2 py-1">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(rid)}
                      aria-label={`select ${rid}`}
                      className="accent-accent"
                    />
                  </td>
                  {row.getVisibleCells().map(cell => {
                    const field = fields.find(f => f.name === cell.column.id)
                    const value = cell.getValue()
                    if (field?.type === 'number') {
                      return (
                        <td key={cell.id} className="border-b border-hairline px-2 py-1 text-right font-mono tabular-nums text-primary">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    }
                    if (categoricalFields.has(cell.column.id)) {
                      const colorVar = categoryColorVar(value as string)
                      return (
                        <td key={cell.id} className="border-b border-hairline px-2 py-1">
                          <span
                            style={{ '--chip': colorVar } as React.CSSProperties}
                            className="rounded-full border border-(--chip) bg-(--chip)/15 px-1.5 py-0.5 font-mono text-[11px] text-(--chip)"
                          >
                            {String(value)}
                          </span>
                        </td>
                      )
                    }
                    return (
                      <td key={cell.id} className="border-b border-hairline px-2 py-1 text-primary">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
