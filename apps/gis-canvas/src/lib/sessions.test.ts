import { describe, it, expect, vi, afterEach } from 'vitest'
import { listSessions, fetchTranscript } from './sessions'

const BFF = 'http://localhost:9109'

afterEach(() => { vi.unstubAllGlobals() })

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body })
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('listSessions', () => {
  it('returns the rows and sends the session cookie', async () => {
    const spy = stubFetch(200, { sessions: [{ id: 'a', source: 'telegram', title: 't', preview: 'p', message_count: 3, started_at: 1, last_active: 2 }], total: 1 })
    const rows = await listSessions(BFF)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('a')
    expect(spy).toHaveBeenCalledWith(`${BFF}/sessions`, { credentials: 'include' })
  })

  it('returns an empty list rather than throwing when unauthenticated', async () => {
    stubFetch(401, { error: 'not authenticated' })
    await expect(listSessions(BFF)).resolves.toEqual([])
  })

  it('tolerates a malformed body', async () => {
    stubFetch(200, {})
    await expect(listSessions(BFF)).resolves.toEqual([])
  })
})

describe('fetchTranscript', () => {
  it('returns the message rows', async () => {
    stubFetch(200, { session_id: 'a', messages: [{ role: 'user', content: 'hi', timestamp: 1 }] })
    const rows = await fetchTranscript(BFF, 'a')
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe('user')
  })

  it('throws on a failed fetch so the caller can surface it', async () => {
    stubFetch(502, { error: 'gateway error' })
    await expect(fetchTranscript(BFF, 'a')).rejects.toThrow(/transcript/i)
  })
})
