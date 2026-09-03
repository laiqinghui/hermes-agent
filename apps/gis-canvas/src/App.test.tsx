import { StrictMode } from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import App from './App'
import type { GatewayLike } from './lib/gateway'
import { authMe } from './lib/auth'
import { listSessions, fetchTranscript } from './lib/sessions'

vi.mock('./lib/sessions', async (orig) => ({
  ...(await orig<typeof import('./lib/sessions')>()),
  listSessions: vi.fn().mockResolvedValue([]),
  fetchTranscript: vi.fn().mockResolvedValue([]),
}))

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
function makeFakeClient(responses: Record<string, unknown> = {}) {
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
      if (method in responses) return responses[method] as T
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
  fireEvent.click(screen.getByRole('button', { name: /ask the agent to compose the situation picture/i }))

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

test('shows the cognition plane while a tool is running and hides it when the turn completes', async () => {
  const client = makeFakeClient()
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  // a running tool with reasoning → busy turn → cognition plane appears
  act(() => client.emit({ type: 'reasoning.available', payload: { text: 'Planning the data query' } }))
  act(() => client.emit({ type: 'tool.start', payload: { tool_id: 't1', name: 'data_query' } }))
  expect(await screen.findByTestId('cognition-plane')).toBeInTheDocument()
  // the "No canvas yet" placeholder must not bleed through while composing
  expect(screen.queryByText(/No canvas yet/)).toBeNull()

  // tool completes and the agent answers → no longer busy → plane unmounts
  act(() => client.emit({ type: 'tool.complete', payload: { tool_id: 't1', name: 'data_query', result: { rows: 1 } } }))
  act(() => client.emit({ type: 'message.complete', payload: { text: 'Done.' } }))
  await waitFor(() => expect(screen.queryByTestId('cognition-plane')).toBeNull())
})

test('keeps the cognition plane mounted across the gap between tools, until the answer', async () => {
  const client = makeFakeClient()
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  // first (short) tool runs then completes — no tool is "running" now, but the
  // turn isn't done, so the plane must NOT flicker away between tools
  act(() => client.emit({ type: 'tool.start', payload: { tool_id: 't1', name: 'skill_view' } }))
  expect(await screen.findByTestId('cognition-plane')).toBeInTheDocument()
  act(() => client.emit({ type: 'tool.complete', payload: { tool_id: 't1', name: 'skill_view', result: { ok: true } } }))
  expect(screen.getByTestId('cognition-plane')).toBeInTheDocument()

  // the agent's final answer ends the turn → plane unmounts
  act(() => client.emit({ type: 'message.complete', payload: { text: 'Done.' } }))
  await waitFor(() => expect(screen.queryByTestId('cognition-plane')).toBeNull())
})

const msg = (role: string, content: string) =>
  ({ role, content, tool_calls: null, tool_name: null, reasoning: null, reasoning_content: null, timestamp: 1 })

test('reopening a session with a stored canvas replays its transcript into the dock', async () => {
  vi.mocked(listSessions).mockResolvedValueOnce([
    { id: 'own1', source: 'tui', title: 'Shadow fleet', preview: '', message_count: 7, started_at: 1, last_active: 2 },
  ])
  vi.mocked(fetchTranscript).mockResolvedValueOnce([
    msg('user', 'find the AIS gaps'),
    msg('assistant', 'four suspect vessels found'),
  ])
  const client = makeFakeClient({
    'canvas.list': { keys: ['own1'] },
    'canvas.get': { doc: { canvasVersion: 1, rev: 3, layout: { type: 'grid', cols: 12 }, components: [] } },
  })
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x/api/ws?token=t" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  fireEvent.click(screen.getByTestId('open-sessions'))
  fireEvent.click(await screen.findByTestId('session-row-own1'))

  // The activity log only holds THIS connection's events, so a reopened
  // session's history must be replayed or the dock is empty.
  fireEvent.click(await screen.findByTestId('command-dock'))
  expect(await screen.findByText('find the AIS gaps')).toBeInTheDocument()
})

test('a resumed own session keeps its composer (replay is not read-only)', async () => {
  vi.mocked(listSessions).mockResolvedValueOnce([
    { id: 'own1', source: 'tui', title: 'Shadow fleet', preview: '', message_count: 7, started_at: 1, last_active: 2 },
  ])
  vi.mocked(fetchTranscript).mockResolvedValueOnce([msg('user', 'find the AIS gaps')])
  const client = makeFakeClient({
    'canvas.list': { keys: ['own1'] },
    'canvas.get': { doc: null },
  })
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x/api/ws?token=t" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  fireEvent.click(screen.getByTestId('open-sessions'))
  fireEvent.click(await screen.findByTestId('session-row-own1'))
  fireEvent.click(await screen.findByTestId('command-dock'))

  expect(await screen.findByTestId('agent-input')).toBeInTheDocument()
  expect(screen.queryByTestId('continue-here')).toBeNull()
})

test('reopening a session addresses it by RUNTIME sid, not the stored key', async () => {
  vi.mocked(listSessions).mockResolvedValueOnce([
    { id: 'own1', source: 'tui', title: 'Shadow fleet', preview: '', message_count: 7, started_at: 1, last_active: 2 },
  ])
  vi.mocked(fetchTranscript).mockResolvedValueOnce([msg('user', 'earlier question')])
  const client = makeFakeClient({
    'canvas.list': { keys: ['own1'] },
    'canvas.get': { doc: null },
    // The gateway keys live sessions by runtime sid and returns both ids.
    'session.resume': { session_id: 'rt-99', session_key: 'own1' },
  })
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x/api/ws?token=t" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  fireEvent.click(screen.getByTestId('open-sessions'))
  fireEvent.click(await screen.findByTestId('session-row-own1'))
  fireEvent.click(await screen.findByTestId('command-dock'))

  const input = await screen.findByTestId('agent-input')
  fireEvent.change(input, { target: { value: 'follow-up' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  await waitFor(() => {
    const submit = client.requests.find(r => r.method === 'prompt.submit')
    // The stored key here would be 4001 "session not found".
    expect((submit?.params as { session_id: string } | undefined)?.session_id).toBe('rt-99')
  })
})

test('branching forks into the new session, carrying its canvas and history', async () => {
  vi.mocked(fetchTranscript).mockResolvedValue([
    msg('user', 'the original question'),
    msg('assistant', 'the original answer'),
  ])
  const client = makeFakeClient({
    'canvas.branch': {
      session_id: 'rt-branch',
      stored_session_id: '20260903_090000_abcdef',
      title: 'Shadow fleet (2)',
      parent: 'parent-key',
      doc: { canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components: [] },
    },
  })
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x/api/ws?token=t" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  // Give the session a turn so there is something to branch.
  fireEvent.click(await screen.findByTestId('command-dock'))
  const input = await screen.findByTestId('agent-input')
  fireEvent.change(input, { target: { value: 'first prompt' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  fireEvent.click(await screen.findByTestId('branch-session'))

  await waitFor(() => {
    expect(client.requests.some(r => r.method === 'canvas.branch')).toBe(true)
  })
  // The fork's inherited conversation is visible, not an apparently empty session.
  expect(await screen.findByText('the original question')).toBeInTheDocument()
  // Later prompts address the BRANCH by its runtime sid.
  fireEvent.change(input, { target: { value: 'second prompt' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => {
    const last = [...client.requests].reverse().find(r => r.method === 'prompt.submit')
    expect((last?.params as { session_id: string }).session_id).toBe('rt-branch')
  })
})
