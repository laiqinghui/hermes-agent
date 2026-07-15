import { StrictMode } from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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
  let anyHandler: ((e: { type?: string; payload?: unknown }) => void) | null = null
  const requests: Array<{ method: string; params: unknown }> = []

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
    async request<T>(method: string, params?: unknown): Promise<T> {
      if (state !== 'open') throw new Error('gateway not connected')
      requests.push({ method, params })
      if (method === 'session.create') {
        sessionCreateCalls++
        return { session_id: 's1' } as unknown as T
      }
      return {} as T
    },
    on() {
      return () => undefined
    },
    onAny(cb: (e: { type?: string; payload?: unknown }) => void) {
      anyHandler = cb
      return () => { if (anyHandler === cb) anyHandler = null }
    },
    emit(event: { type?: string; payload?: unknown }) {
      anyHandler?.(event)
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
    },
    get requests() {
      return requests
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

  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))
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

test('shows login gate (not a permanent spinner) when the BFF is unreachable', async () => {
  vi.mocked(authMe).mockRejectedValueOnce(new Error('Failed to fetch'))
  const client = makeFakeClient()
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x" />)

  expect(await screen.findByText(/log in with keycloak/i)).toBeInTheDocument()
  expect(screen.queryByText(/checking session/i)).toBeNull()
  expect(client.sessionCreateCalls).toBe(0)
})

test('surfaces an approval request, responds scoped to the session, and clears it', async () => {
  const client = makeFakeClient()
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  // open the agent panel (collapsed dock → overlay)
  fireEvent.click(screen.getByRole('button', { name: /ask the agent to build a dashboard/i }))

  // gateway requests approval to run a gated command
  act(() => client.emit({ type: 'approval.request', payload: { command: 'python - <<EOF' } }))
  expect(await screen.findByText(/approval needed/i)).toBeInTheDocument()

  // "Approve for session" → approval.respond scoped to the live gateway session_id
  fireEvent.click(screen.getByRole('button', { name: /approve for session/i }))
  expect(client.requests).toContainEqual({ method: 'approval.respond', params: { session_id: 's1', choice: 'session' } })
  // clears immediately on respond
  expect(screen.queryByText(/approval needed/i)).toBeNull()

  // a later request clears when the gated tool completes (approved or timed-out)
  act(() => client.emit({ type: 'approval.request', payload: { command: 'ls' } }))
  expect(screen.getByText(/approval needed/i)).toBeInTheDocument()
  act(() => client.emit({ type: 'tool.complete', payload: { tool_id: 't', name: 'execute_code' } }))
  expect(screen.queryByText(/approval needed/i)).toBeNull()
})
