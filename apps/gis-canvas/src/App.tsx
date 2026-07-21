import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasGrid } from './components/CanvasGrid'
import { CommandDock } from './components/CommandDock'
import { AgentPanel } from './components/AgentPanel'
import { BuildToast } from './components/BuildToast'
import { HandlerProvider } from './components/HandlerContext'
import { TopBar } from './components/TopBar'
import { CanvasHeader } from './components/CanvasHeader'
import { CognitionPlane } from './components/CognitionPlane'
import { useTheme } from './lib/use-theme'
import { useOverlayShortcut } from './lib/use-overlay-shortcut'
import { deriveActivity, activityItemFromEvent, type ActivityItem } from './lib/activity'
import { approvalFromEvent, type PendingApproval, type ApprovalChoice } from './lib/approval'
import { createGatewayClient, resolveWsUrl, type GatewayLike } from './lib/gateway'
import { useCanvasDoc } from './lib/use-canvas-doc'
import { mergeOverrides, type Overrides } from './lib/merge'
import { fetchDataPage } from './lib/data-plane'
import type { CanvasActions } from './lib/handlers'
import { resolveBffUrl, authMe, loginUrl, bindSessions, logout, type AuthState } from './lib/auth'
import { SelectionProvider } from './components/SelectionContext'
import { collectNodesBySource } from './lib/selection'
import { LayoutProvider } from './components/LayoutProvider'
import { useLayoutStore } from './lib/use-layout-store'

// reasoning.delta carries the model's real between-step reasoning (gpt-5.5 et al.);
// reasoning.available is only the final answer for such models. Both feed the star.
const LOGGED_EVENTS = new Set(['message.complete', 'tool.start', 'tool.complete', 'reasoning.available', 'reasoning.delta', 'error'])

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
  const canvasKeyRef = useRef<string | null>(null)
  const startedRef = useRef(false)
  const nextId = useRef(0)
  const [auth, setAuth] = useState<AuthState | null>(null)
  const bffUrl = useMemo(() => resolveBffUrl(import.meta.env as Record<string, string | undefined>), [])
  const [theme, toggleTheme] = useTheme()
  const layout = useLayoutStore()
  const [overlayOpen, setOverlayOpen] = useOverlayShortcut()
  const [approval, setApproval] = useState<PendingApproval | null>(null)

  const log = (item: Omit<ActivityItem, 'id'>) =>
    setActivity(prev => [...prev.slice(-199), { id: nextId.current++, ...item }])

  useEffect(() => { void authMe(bffUrl).then(setAuth).catch(() => setAuth({ authenticated: false })) }, [bffUrl])

  useEffect(() => {
    // Subscribe to activity events. StrictMode double-invokes this effect;
    // the subscription is added and torn down per invocation, netting one.
    const off = client.onAny((event: { type?: string; payload?: unknown }) => {
      const type = event?.type ?? ''
      if (type === 'approval.request') {
        setApproval(approvalFromEvent(event.payload as Record<string, unknown> | undefined))
        return
      }
      // A pending approval is resolved once the gated tool completes (approved
      // OR timed-out/denied) or the agent produces its answer — clear the card.
      if (type === 'tool.complete' || type === 'message.complete') setApproval(null)
      if (!LOGGED_EVENTS.has(type)) return
      log(activityItemFromEvent(type, event.payload as Record<string, unknown> | undefined))
    })

    // Connect + create the session exactly once per client. The ref guard is
    // essential under StrictMode: without it, the second effect invocation
    // calls connect() while the first is still 'connecting' (which returns
    // immediately) and then fires session.create on a socket that isn't open
    // yet → "gateway not connected".
    if (!startedRef.current && auth?.authenticated) {
      startedRef.current = true
      const url = injectedUrl ?? resolveWsUrl(import.meta.env as Record<string, string | undefined>)
      void (async () => {
        try {
          await client.connect(url) // resolves only once the socket is OPEN
          const created = await client.request<{ session_id: string; stored_session_id?: string }>('session.create', { cols: 96 })
          sessionIdRef.current = created.session_id
          canvasKeyRef.current = created.stored_session_id ?? created.session_id
          const idsToBind = [...new Set([created.stored_session_id ?? created.session_id, created.session_id].filter(Boolean))] as string[]
          void bindSessions(bffUrl, idsToBind)
          setConnected(true)
          log({ kind: 'system', text: `session ${created.session_id} ready` })
        } catch (err) {
          log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
        }
      })()
    }

    return () => {
      if (typeof off === 'function') off()
    }
  }, [client, injectedUrl, auth, bffUrl])

  const send = useCallback(async (text: string) => {
    if (!sessionIdRef.current) return
    log({ kind: 'you', text })
    try {
      await client.request('prompt.submit', { session_id: sessionIdRef.current, text })
    } catch (err) {
      log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }, [client])

  const respondApproval = useCallback((choice: ApprovalChoice) => {
    setApproval(null)
    const sid = sessionIdRef.current
    if (!sid) return
    void client.request('approval.respond', { session_id: sid, choice }).catch(err => {
      log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    })
  }, [client])

  const [overrides, setOverrides] = useState<Overrides>({})

  const actions: CanvasActions = useMemo(() => ({
    setLocalState: (id, patch) =>
      setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } })),
    reportInteraction: (id, patch) => {
      setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
      const key = canvasKeyRef.current
      if (key) void client.request('canvas.interaction', { session_id: key, target: id, state: patch }).catch(() => {})
    },
    sendPrompt: text => { void send(text) },
    fetchData: (handle, opts) => fetchDataPage(client, handle, opts)
  }), [client, send])

  // NOTE: client doc.rev advances only on agent tool.complete renders, NOT on canvas.interaction
  // (interactions bump the SERVER rev but emit no event). This is intentional: the override-reset
  // below keys on doc.rev so optimistic interaction overlays survive until a real agent re-render.
  // reset local overrides whenever the agent re-renders the canvas (new structure)
  useEffect(() => { setOverrides({}) }, [doc?.rev])

  const mergedDoc = useMemo(() => (doc ? mergeOverrides(doc, overrides) : null), [doc, overrides])
  const nodesBySource = useMemo(() => collectNodesBySource(mergedDoc), [mergedDoc])
  const mirrorSelection = useCallback((id: string, ids: string[]) => actions.reportInteraction(id, { rowSelection: ids }), [actions])
  const derived = useMemo(() => deriveActivity(activity), [activity])
  const { messages, trace, isBusy } = derived

  // Keep the cognition plane mounted for the whole ACTIVE turn — from first
  // activity until the agent's final answer — not just while a tool is running.
  // `isBusy` alone drops between every tool (the gap after one completes, before
  // the next starts), which would unmount/remount the plane and make the first
  // short step flash. A turn is active while it has done work but has no answer yet.
  const lastTurn = derived.turns.at(-1)
  const turnActive = isBusy || (!!lastTurn && lastTurn.answers.length === 0 && lastTurn.trace.length > 0)

  if (auth === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas font-sans text-sm text-tertiary">
        Checking session…
      </div>
    )
  }

  if (auth && !auth.authenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas font-sans">
        <a href={loginUrl(bffUrl)} className="rounded-gc-sm bg-accent px-4 py-2 font-sans text-accent-fg">
          Log in with Keycloak
        </a>
      </div>
    )
  }

  const handleLogout = () => {
    void logout(bffUrl).then(u => { window.location.href = u })
  }

  return (
    <div className="flex h-screen flex-col bg-canvas font-sans text-primary">
      <TopBar theme={theme} onToggleTheme={toggleTheme} connected={connected} isBusy={isBusy}
        onLogout={handleLogout} onResetLayout={layout.reset} canReset={!layout.isEmpty} />
      <main className="relative min-h-0 flex-1 overflow-auto gc-canvas-grid-bg p-4">
        <CanvasHeader rev={mergedDoc?.rev} isBusy={isBusy} />
        {mergedDoc ? (
          <SelectionProvider nodesBySource={nodesBySource} onMirror={mirrorSelection}>
            <HandlerProvider actions={actions}>
              <LayoutProvider store={layout}>
                <CanvasGrid doc={mergedDoc} />
              </LayoutProvider>
            </HandlerProvider>
          </SelectionProvider>
        ) : !isBusy ? (
          <div className="flex h-full items-center justify-center text-sm text-tertiary">
            No canvas yet — ask the agent to compose the situation picture from your data.
          </div>
        ) : null}
        <CognitionPlane turn={turnActive ? lastTurn : undefined} />
      </main>
      {/* progress shows in exactly one place: the dock ticker when minimized,
          the top toast when the panel is open (dock hidden). */}
      <BuildToast show={isBusy && overlayOpen} step={trace.at(-1)} />
      {!overlayOpen && (
        <CommandDock latest={messages.at(-1)} onOpen={() => setOverlayOpen(true)} busy={isBusy} step={trace.at(-1)} />
      )}
      <AgentPanel
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        turns={derived.turns}
        timeline={derived.timeline}
        errors={errors}
        connected={connected}
        onSend={send}
        approval={approval}
        onRespond={respondApproval}
      />
    </div>
  )
}
