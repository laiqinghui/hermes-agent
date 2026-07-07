import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveBffUrl, authMe, loginUrl, bindSessions } from './auth'

afterEach(() => vi.restoreAllMocks())

describe('auth', () => {
  it('resolveBffUrl reads VITE_BFF_URL', () => {
    expect(resolveBffUrl({ VITE_BFF_URL: 'http://localhost:9109' })).toBe('http://localhost:9109')
    expect(() => resolveBffUrl({})).toThrow()
  })

  it('loginUrl points at /auth/login', () => {
    expect(loginUrl('http://localhost:9109')).toBe('http://localhost:9109/auth/login')
  })

  it('authMe returns authenticated=false on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    expect(await authMe('http://b')).toEqual({ authenticated: false })
  })

  it('authMe returns user on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ authenticated: true, username: 'jsmith', roles: ['selectdata'] }),
    }))
    expect(await authMe('http://b')).toEqual({ authenticated: true, username: 'jsmith', roles: ['selectdata'] })
  })

  it('bindSessions POSTs canvas_sessions with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await bindSessions('http://b', ['stored-1', 'live-1'])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://b/auth/bind')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(JSON.parse(opts.body)).toEqual({ canvas_sessions: ['stored-1', 'live-1'] })
  })
})
