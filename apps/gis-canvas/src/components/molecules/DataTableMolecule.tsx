import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from '@tanstack/react-table'
import { resolveMockSource } from '../../lib/mock-data'
import type { MoleculeProps } from '../registry'

type Row = Record<string, string | number>
const helper = createColumnHelper<Row>()

export function DataTableMolecule({ node }: MoleculeProps) {
  const source = node.bindings?.source ?? ''
  const data = resolveMockSource(source)
  const wanted = (node.props?.columns as string[] | undefined) ?? null
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo(() => {
    const fields = (data?.schema ?? []).filter(f => !wanted || wanted.includes(f.name))
    return fields.map(f => helper.accessor(row => row[f.name], { id: f.name, header: f.name }))
  }, [data, wanted])

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  })

  if (!data) {
    return <div className="p-2 text-sm text-red-600">Unknown data source: {source || '(none)'}</div>
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
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
        {table.getRowModel().rows.map(row => (
          <tr key={row.id}>
            {row.getVisibleCells().map(cell => (
              <td key={cell.id} className="border-b border-neutral-100 px-2 py-1">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
