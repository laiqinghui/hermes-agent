import { describe, it, expect, vi } from 'vitest'
import { fetchDataPage, isDataHandle, pageError } from './data-plane'

describe('data-plane', () => {
  it('isDataHandle recognizes data:// only', () => {
    expect(isDataHandle('data://ab12')).toBe(true)
    expect(isDataHandle('mock://incidents')).toBe(false)
    expect(isDataHandle('https://services.arcgis.com/x/FeatureServer/0')).toBe(false)
    expect(isDataHandle(undefined)).toBe(false)
  })

  it('fetchDataPage calls canvas.data_fetch with params and returns the page', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      rows: [{ id: 'a' }],
      schema: [{ name: 'id', type: 'string' }],
      total: 1,
      page: 0,
      pageSize: 50
    })
    const page = await fetchDataPage({ request }, 'data://ab12', { pageSize: 50, filter: { sev: 'high' } })
    expect(request).toHaveBeenCalledWith('canvas.data_fetch', {
      handle: 'data://ab12',
      page: 0,
      pageSize: 50,
      filter: { sev: 'high' }
    })
    expect(page.rows).toEqual([{ id: 'a' }])
  })
})

describe('pageError', () => {
  // Every consumer of the data plane used to read page.rows unconditionally, so an
  // expired handle rendered as a plausible empty result. Centralising the check keeps
  // that from drifting apart again per-molecule.
  it('returns the broker message when the page failed', () => {
    expect(pageError({
      ok: false, expired: true, rows: [], schema: [], total: 0, page: 0, pageSize: 100,
      errors: ["handle 'data://gone' expired and its cached rows were dropped; re-run the query to repopulate it"]
    })).toMatch(/expired/)
  })

  it('falls back to a generic message when a failure carries no errors', () => {
    expect(pageError({ ok: false, rows: [], schema: [], total: 0, page: 0, pageSize: 100 }))
      .toBeTruthy()
  })

  it('returns null for a usable page, including a genuinely empty one', () => {
    expect(pageError({ ok: true, rows: [], schema: [], total: 0, page: 0, pageSize: 100 })).toBeNull()
    expect(pageError(null)).toBeNull()
  })
})
