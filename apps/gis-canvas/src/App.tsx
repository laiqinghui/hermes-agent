import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasGrid } from './components/CanvasGrid'
import { Chat, type ActivityItem } from './components/Chat'
import { createGatewayClient, resolveWsUrl } from './lib/gateway'
import { useCanvasDoc } from './lib/use-canvas-doc'

const LOGGED_EVENTS = new Set(['message.delta', 'message.complete', 'tool.start', 'tool.complete', 'error'])

export default function App() {
  const client = useMemo(() => createGatewayClient(), [])
  const { doc, errors } = useCanvasDoc(client)
  const [connected, setConnected] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const sessionIdRef = useRef<string | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    const log = (kind: string, text: string) =>
      setActivity(prev => [...prev.slice(-199), { id: nextId.current++, kind, text }])

    let cancelled = false
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
    ;(async () => {
      try {
        await client.connect(resolveWsUrl(import.meta.env as Record<string, string | undefined>))
        const created = await client.request<{ session_id: string }>('session.create', { cols: 96 })
        if (cancelled) return
        sessionIdRef.current = created.session_id
        setConnected(true)
        log('system', `session ${created.session_id} ready`)
      } catch (err) {
        log('error', err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (typeof off === 'function') off()
    }
  }, [client])

  const send = async (text: string) => {
    if (!sessionIdRef.current) return
    setActivity(prev => [...prev.slice(-199), { id: nextId.current++, kind: 'you', text }])
    try {
      await client.request('prompt.submit', { session_id: sessionIdRef.current, text })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setActivity(prev => [...prev.slice(-199), { id: nextId.current++, kind: 'error', text: msg }])
    }
  }

  return (
    <div className="grid h-screen grid-cols-[1fr_360px] font-sans">
      <main className="overflow-auto bg-neutral-100 p-4">
        {doc ? (
          <CanvasGrid doc={doc} />
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
