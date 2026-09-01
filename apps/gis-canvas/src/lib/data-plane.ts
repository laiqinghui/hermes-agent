import type { GatewayLike } from './gateway'

export type Row = Record<string, string | number>
export interface Field { name: string; type: 'string' | 'number' }
export interface DataPage {
  ok: boolean
  rows: Row[]
  schema: Field[]
  total: number
  page: number
  pageSize: number
  errors?: string[]
  /** true when the fetch failed because the broker handle outlived its TTL (recoverable
   *  by re-running the query) rather than never having existed. */
  expired?: boolean
}

export function isDataHandle(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith('data://')
}

/** The message to show when the data plane refuses a handle, or null when the page is
 *  usable. Centralised because every consumer previously read `page.rows` unconditionally,
 *  so an expired handle rendered as a plausible empty result — indistinguishable from a
 *  query that legitimately found nothing. */
export function pageError(page: DataPage | null | undefined): string | null {
  if (!page || page.ok !== false) return null
  return page.errors?.[0] ?? 'could not load this data handle'
}

export async function fetchDataPage(
  gw: Pick<GatewayLike, 'request'>,
  handle: string,
  opts: { page?: number; pageSize?: number; filter?: Record<string, string>; fields?: string[] } = {}
): Promise<DataPage> {
  const params: Record<string, unknown> = { handle, page: opts.page ?? 0, pageSize: opts.pageSize ?? 100 }
  if (opts.filter) params.filter = opts.filter
  if (opts.fields) params.fields = opts.fields
  return gw.request<DataPage>('canvas.data_fetch', params)
}
