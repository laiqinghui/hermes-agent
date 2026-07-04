import { describe, it, expect, vi } from 'vitest'
import { fetchDataPage, isDataHandle } from './data-plane'

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
