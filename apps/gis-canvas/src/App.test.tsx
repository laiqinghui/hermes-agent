import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { GatewayLike } from './lib/gateway'
import { authMe } from './lib/auth'

vi.mock('./lib/auth', async (orig) => ({
  ...(await orig<typeof import('./lib/auth')>()),
  resolveBffUrl: () => 'http://bff',
  // Default: authenticated, so existing tests exercise the pre-gate connect flow unchanged.
  authMe: vi.fn().mockResolvedValue({ authenticated: true }),
  bindSessions: vi.fn(),
}))

/**
 * Fake client that faithfully models JsonRpcGatewayClient's relevant semantics:
 * - connect() while already 'connecting'/'open' returns immediately (no await)
 * - request() rejects with 'gateway not connected' unless the socket is open
 * This is exactly the shape that turns a StrictMode double-invoke into a
 * premature-request race.
 *
 * The connect effect is now gated on the async authMe() resolution, so
 * connect() can be called a tick after openNow() runs (once auth flips
 * authenticated). `armed` lets openNow() called "early" still take effect:
 * once armed, a later connect() opens synchronously instead of waiting on
 * a resolver that will never come.
 */
function makeFakeClient() {
  let state: 'idle' | 'connecting' | 'open' = 'idle'
  const openResolvers: Array<() => void> = []
  let armed = false
  let sessionCreateCalls = 0
  let connectCalls = 0

  const client = {
    async connect() {
      connectCalls++
      if (state === 'open' || state === 'connecting') return
      if (armed) {
        state = 'open'
        return
      }
      state = 'connecting'
      await new Promise<void>(res => openResolvers.push(res))
      state = 'open'
    },
    async request<T>(method: string): Promise<T> {
      if (state !== 'open') throw new Error('gateway not connected')
      if (method === 'session.create') {
        sessionCreateCalls++
        return { session_id: 's1' } as unknown as T
      }
      return {} as T
    },
    on() {
      return () => undefined
    },
    onAny() {
      return () => undefined
    },
    openNow() {
      if (openResolvers.length === 0) {
        armed = true
        return
      }
      openResolvers.splice(0).forEach(r => r())
    },
    get sessionCreateCalls() {
      return sessionCreateCalls
    },
    get connectCalls() {
      return connectCalls
    }
  }
  return client
}

test('survives StrictMode double-invoke: no premature request, one session.create', async () => {
  const client = makeFakeClient()
  render(
    <StrictMode>
      <App client={client as unknown as GatewayLike} wsUrl="ws://x/api/ws?token=t" />
    </StrictMode>
  )

  // Socket opens shortly after mount (both effect invocations have run by now).
  client.openNow()

  await waitFor(() => expect(screen.getByText(/● connected/)).toBeInTheDocument())
  expect(client.sessionCreateCalls).toBe(1)
  expect(screen.queryByText(/gateway not connected/)).toBeNull()
})

test('shows login gate when unauthenticated and skips session.create', async () => {
  vi.mocked(authMe).mockResolvedValueOnce({ authenticated: false })
  const client = makeFakeClient()
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x" />)

  expect(await screen.findByText(/log in with keycloak/i)).toBeInTheDocument()
  expect(client.sessionCreateCalls).toBe(0)
  // Effect-level gate: the connect/session.create effect must not even attempt
  // to connect when unauthenticated (not just fail to reach session.create).
  expect(client.connectCalls).toBe(0)
})
