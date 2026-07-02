import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasGrid } from './components/CanvasGrid'
import { Chat, type ActivityItem } from './components/Chat'
import { HandlerProvider } from './components/HandlerContext'
import { createGatewayClient, resolveWsUrl, type GatewayLike } from './lib/gateway'
import { useCanvasDoc } from './lib/use-canvas-doc'
import { mergeOverrides, type Overrides } from './lib/merge'
import type { CanvasActions } from './lib/handlers'

const LOGGED_EVENTS = new Set(['message.delta', 'message.complete', 'tool.start', 'tool.complete', 'error'])

export interface AppProps {
  client?: GatewayLike
  wsUrl?: string
}

export default function App({ client: injectedClient, wsUrl: injectedUrl }: AppProps = {}) {
  const client = useMemo(
    () => injectedClient ?? createGatewayClient(),
    [injectedClient]
  )
  const { doc, errors } = useCanvasDoc(client)
  const [connected, setConnected] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const sessionIdRef = useRef<string | null>(null)
  const startedRef = useRef(false)
  const nextId = useRef(0)

  const log = (kind: string, text: string) =>
    setActivity(prev => [...prev.slice(-199), { id: nextId.current++, kind, text }])

  useEffect(() => {
    // Subscribe to activity events. StrictMode double-invokes this effect;
    // the subscription is added and torn down per invocation, netting one.
    const off = client.onAny((event: { type?: string; payload?: unknown }) => {
      const type = event?.type ?? ''
      if (!LOGGED_EVENTS.has(type)) return
      const payload = event.payload as Record<string, unknown> | undefined
      const summary =
        typeof payload?.text === 'string'
          ? payload.text
          : typeof payload?.name === 'string'
            ? String(payload.name)
            : JSON.stringify(payload ?? {}).slice(0, 160)
      log(type, summary)
    })

    // Connect + create the session exactly once per client. The ref guard is
    // essential under StrictMode: without it, the second effect invocation
    // calls connect() while the first is still 'connecting' (which returns
    // immediately) and then fires session.create on a socket that isn't open
    // yet → "gateway not connected".
    if (!startedRef.current) {
      startedRef.current = true
      const url = injectedUrl ?? resolveWsUrl(import.meta.env as Record<string, string | undefined>)
      void (async () => {
        try {
          await client.connect(url) // resolves only once the socket is OPEN
          const created = await client.request<{ session_id: string }>('session.create', { cols: 96 })
          sessionIdRef.current = created.session_id
          setConnected(true)
          log('system', `session ${created.session_id} ready`)
        } catch (err) {
          log('error', err instanceof Error ? err.message : String(err))
        }
      })()
    }

    return () => {
      if (typeof off === 'function') off()
    }
  }, [client, injectedUrl])

  const send = useCallback(async (text: string) => {
    if (!sessionIdRef.current) return
    log('you', text)
    try {
      await client.request('prompt.submit', { session_id: sessionIdRef.current, text })
    } catch (err) {
      log('error', err instanceof Error ? err.message : String(err))
    }
  }, [client])

  const [overrides, setOverrides] = useState<Overrides>({})

  const actions: CanvasActions = useMemo(() => ({
    setLocalState: (id, patch) =>
      setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } })),
    reportInteraction: (id, patch) => {
      setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
      const sid = sessionIdRef.current
      if (sid) void client.request('canvas.interaction', { session_id: sid, target: id, state: patch }).catch(() => {})
    },
    sendPrompt: text => { void send(text) }
  }), [client, send])

  // reset local overrides whenever the agent re-renders the canvas (new structure)
  useEffect(() => { setOverrides({}) }, [doc?.rev])

  const mergedDoc = doc ? mergeOverrides(doc, overrides) : null

  return (
    <div className="grid h-screen grid-cols-[1fr_360px] font-sans">
      <main className="overflow-auto bg-neutral-100 p-4">
        {mergedDoc ? (
          <HandlerProvider actions={actions}>
            <CanvasGrid doc={mergedDoc} />
          </HandlerProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">
            No canvas yet — ask the agent to build a dashboard.
          </div>
        )}
      </main>
      <Chat activity={activity} errors={errors} onSend={send} connected={connected} />
    </div>
  )
}
