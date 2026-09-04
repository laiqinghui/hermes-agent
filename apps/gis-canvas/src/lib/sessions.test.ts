import { describe, it, expect, vi, afterEach } from 'vitest'
import { listSessions, fetchTranscript, renameSession, setArchived, deleteSession } from './sessions'

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

describe('session mutations', () => {
  it('renames via PATCH with the title', async () => {
    const spy = stubFetch(200, { ok: true })
    await renameSession(BFF, 'abc', 'New name')
    expect(spy).toHaveBeenCalledWith(`${BFF}/sessions/abc`, expect.objectContaining({
      method: 'PATCH',
      credentials: 'include',
      body: JSON.stringify({ title: 'New name' }),
    }))
  })

  it('archives via PATCH without sending a title', async () => {
    const spy = stubFetch(200, { ok: true })
    await setArchived(BFF, 'abc', true)
    // A title of null/undefined would CLEAR the title server-side.
    expect(spy.mock.calls[0][1].body).toBe(JSON.stringify({ archived: true }))
  })

  it('deletes via DELETE', async () => {
    const spy = stubFetch(200, { ok: true })
    await deleteSession(BFF, 'abc')
    expect(spy).toHaveBeenCalledWith(`${BFF}/sessions/abc`, expect.objectContaining({
      method: 'DELETE', credentials: 'include',
    }))
  })

  it('throws on failure so the caller can surface it', async () => {
    stubFetch(502, { error: 'gateway error' })
    await expect(deleteSession(BFF, 'abc')).rejects.toThrow(/delete/i)
    stubFetch(404, { error: 'session not found' })
    await expect(renameSession(BFF, 'abc', 'x')).rejects.toThrow(/rename/i)
  })

  it('encodes the id in the path', async () => {
    const spy = stubFetch(200, { ok: true })
    await deleteSession(BFF, 'a/b c')
    expect(spy.mock.calls[0][0]).toBe(`${BFF}/sessions/a%2Fb%20c`)
  })
})
