import { useEffect, useMemo, useState } from 'react'
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
import { useCanvasActions } from '../HandlerContext'
import type { MoleculeProps } from '../registry'

type Row = Record<string, string | number>
const helper = createColumnHelper<Row>()

export function DataTableMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const source = (Array.isArray(node.bindings?.source) ? node.bindings!.source[0] : node.bindings?.source) ?? ''

  // data:// handles are pulled from the broker (data plane); mock:// resolves locally.
  const [fetched, setFetched] = useState<MockSource | null>(null)
  useEffect(() => {
    let cancelled = false
    if (isDataHandle(source)) {
      actions
        .fetchData(source, { pageSize: 1000 })
        .then(p => { if (!cancelled) setFetched({ schema: p.schema as MockField[], rows: p.rows as Array<Record<string, string | number>> }) })
        .catch(() => { if (!cancelled) setFetched({ schema: [], rows: [] }) })
    } else {
      setFetched(null)
    }
    return () => { cancelled = true }
  }, [source, actions])

  const data = isDataHandle(source) ? fetched : resolveMockSource(source)
  const wanted = (node.props?.columns as string[] | undefined) ?? null
  const filter = (node.state?.filter as Record<string, string> | undefined) ?? {}
  const selected = (node.state?.rowSelection as string[] | undefined) ?? []
  const [sorting, setSorting] = useState<SortingState>([])

  // client-side filter (reactive, no agent turn): keep rows matching every
  // active filter entry (ignore empty / 'all').
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const active = Object.entries(filter).filter(([, v]) => v && v !== 'all')
    if (!active.length) return all
    return all.filter(r => active.every(([k, v]) => String(r[k]) === v))
  }, [data, filter])

  const idField = data?.schema[0]?.name ?? 'id'
  const columns = useMemo(() => {
    const fields = (data?.schema ?? []).filter(f => !wanted || wanted.includes(f.name))
    return fields.map(f => helper.accessor(row => row[f.name], { id: f.name, header: f.name }))
  }, [data, wanted])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  })

  if (!data) {
    return <div className="p-2 text-sm text-red-600">Unknown data source: {source || '(none)'}</div>
  }

  const toggle = (rowId: string) => {
    const next = selected.includes(rowId) ? selected.filter(x => x !== rowId) : [...selected, rowId]
    actions.reportInteraction(node.id, { rowSelection: next })
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
            <th className="w-6 border-b border-neutral-200 px-2 py-1" />
            {hg.headers.map(h => (
              <th
                key={h.id}
                onClick={h.column.getToggleSortingHandler()}
                className="cursor-pointer border-b border-neutral-200 px-2 py-1 text-left font-semibold"
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
                {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map(row => {
          const rid = String(row.original[idField])
          const isSel = selected.includes(rid)
          return (
            <tr key={row.id} className={isSel ? 'bg-blue-50' : undefined}>
              <td className="border-b border-neutral-100 px-2 py-1">
                <input type="checkbox" checked={isSel} onChange={() => toggle(rid)} aria-label={`select ${rid}`} />
              </td>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="border-b border-neutral-100 px-2 py-1">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
