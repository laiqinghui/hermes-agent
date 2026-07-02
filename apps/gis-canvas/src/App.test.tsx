import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import type { GatewayLike } from './lib/gateway'

/**
 * Fake client that faithfully models JsonRpcGatewayClient's relevant semantics:
 * - connect() while already 'connecting'/'open' returns immediately (no await)
 * - request() rejects with 'gateway not connected' unless the socket is open
 * This is exactly the shape that turns a StrictMode double-invoke into a
 * premature-request race.
 */
function makeFakeClient() {
  let state: 'idle' | 'connecting' | 'open' = 'idle'
  const openResolvers: Array<() => void> = []
  let sessionCreateCalls = 0

  const client = {
    async connect() {
      if (state === 'open' || state === 'connecting') return
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
      openResolvers.splice(0).forEach(r => r())
    },
    get sessionCreateCalls() {
      return sessionCreateCalls
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
