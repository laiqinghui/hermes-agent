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
import { deriveActivity, activityItemFromEvent, type ActivityItem, type Turn } from './lib/activity'
import { approvalFromEvent, type PendingApproval, type ApprovalChoice } from './lib/approval'
import { createGatewayClient, resolveWsUrl, type GatewayLike } from './lib/gateway'
import { useCanvasDoc } from './lib/use-canvas-doc'
import { mergeOverrides, type Overrides } from './lib/merge'
import { fetchDataPage } from './lib/data-plane'
import type { CanvasActions } from './lib/handlers'
import type { CanvasDoc } from './lib/types'
import { resolveBffUrl, authMe, loginUrl, bindSessions, logout, type AuthState } from './lib/auth'
import { SelectionProvider } from './components/SelectionContext'
import { TimeExtentProvider } from './components/TimeExtentContext'
import { OntologyProvider } from './components/OntologyContext'
import { ImageryProvider } from './components/ImageryContext'
import { collectNodesBySource } from './lib/selection'
import { LayoutProvider } from './components/LayoutProvider'
import { useLayoutStore } from './lib/use-layout-store'
import { WindowStateProvider } from './components/WindowStateProvider'
import { useWindowStateStore } from './lib/use-window-state'
import { SessionPicker } from './components/SessionPicker'
import { listSessions, fetchTranscript, type SessionRow } from './lib/sessions'
import { transcriptToTurns } from './lib/transcript'
import { packTranscript } from './lib/transcript-pack'
import { buildJudgePrompt } from './lib/judge'

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
  const { doc, errors, setDoc } = useCanvasDoc(client)
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
  const windows = useWindowStateStore()
  const [overlayOpen, setOverlayOpen] = useOverlayShortcut()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([])
  const [canvasKeys, setCanvasKeys] = useState<Set<string>>(new Set())
  const [pickerBusy, setPickerBusy] = useState(false)
  // A session opened from the picker. `turns` is its REPLAYED history — the
  // activity log only holds this browser connection's events, so without a
  // replay any reopened session shows an empty dock. `readOnly` is a SEPARATE
  // concern: only a session we did not resume (a foreign one) locks the composer.
  const [opened, setOpened] = useState<{
    row: SessionRow
    turns: Turn[]
    readOnly: boolean
    previewSessionId?: string
    verdict?: 'rendered' | 'declined'
    reason?: string
    judging?: boolean
  } | null>(null)
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

  // NOTE: the verdict is decided SERVER-SIDE by canvas.judge, which runs the
  // turn to completion and only then reads the answer and the authored doc.
  // Do not reintroduce a client-side watcher here: the SPA sees one global
  // event stream with no session correlation, so it cannot tell whose turn
  // ended — the earlier attempt cached "declined" before the turn had begun.

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

  // "Reset layout" is the put-everything-back button: it drops drag/resize
  // overrides AND restores every shaded or minimized window.
  const handleResetLayout = () => { layout.reset(); windows.reset() }

  // Opening the picker refetches both lists: sessions from the BFF, stored
  // canvas keys from the plugin, so Canvas/Transcript marks are never stale.
  const openPicker = () => {
    setPickerOpen(true)
    setPickerBusy(true)
    void Promise.all([
      listSessions(bffUrl),
      client.request<{ keys: string[] }>('canvas.list', {}).catch(() => ({ keys: [] as string[] })),
    ]).then(([rows, stored]) => {
      setSessionRows(rows)
      setCanvasKeys(new Set(stored.keys ?? []))
    }).finally(() => setPickerBusy(false))
  }

  // Own session: fetch the stored doc, resume so it can be continued (resume
  // MUTATES — correct for our own session, forbidden for foreign ones), bind.
  const openOwnSession = (row: SessionRow) => {
    setPickerOpen(false)
    void (async () => {
      try {
        await client.request('session.resume', { session_id: row.id })
        const got = await client.request<{ doc: CanvasDoc | null }>('canvas.get', { session_id: row.id })
        sessionIdRef.current = row.id
        canvasKeyRef.current = row.id
        await bindSessions(bffUrl, [row.id])
        if (got.doc) setDoc(got.doc)
        // Replay the history too — resuming does not backfill this connection's
        // activity log, so the dock would otherwise be empty.
        const rows = await fetchTranscript(bffUrl, row.id).catch(() => [])
        setOpened({ row, turns: transcriptToTurns(rows), readOnly: false })
        log({ kind: 'system', text: `opened session ${row.id}` })
      } catch (err) {
        log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
  }

  // Foreign session: READ-ONLY on the original. Never resume, never branch.
  // The judgement runs in a separate preview session, once per foreign session
  // (cached in the plugin's preview index), and Continue here promotes it.
  const openForeignSession = (row: SessionRow) => {
    setPickerOpen(false)
    void (async () => {
      try {
        const rows = await fetchTranscript(bffUrl, row.id)
        setOpened({ row, turns: transcriptToTurns(rows), readOnly: true })
        setOverlayOpen(true)

        const cached = await client
          .request<{ record: { preview_session_id: string; verdict: 'rendered' | 'declined'; reason: string } | null }>(
            'canvas.preview_get', { source_session_id: row.id })
          .catch(() => ({ record: null }))

        if (cached.record) {
          const got = await client
            .request<{ doc: CanvasDoc | null }>('canvas.get', { session_id: cached.record.preview_session_id })
            .catch(() => ({ doc: null }))
          if (got.doc) setDoc(got.doc)
          setOpened(f => f && { ...f, previewSessionId: cached.record!.preview_session_id,
            verdict: cached.record!.verdict, reason: cached.record!.reason })
          return
        }

        // Never judged: one server-side call that creates the preview session,
        // runs the turn to completion, decides the verdict from what the agent
        // said AND whether a doc landed, and caches it. Returns the STORED
        // session key — the id the canvas store and session.resume both use.
        setOpened(f => f && { ...f, judging: true })
        const judged = await client.request<{
          preview_session_id: string
          record: { verdict: 'rendered' | 'declined'; reason: string }
          doc: CanvasDoc | null
        }>('canvas.judge', {
          source_session_id: row.id,
          text: buildJudgePrompt(row, packTranscript(rows)),
        })
        await bindSessions(bffUrl, [judged.preview_session_id])
        if (judged.doc) setDoc(judged.doc)
        setOpened(f => f && { ...f, judging: false,
          previewSessionId: judged.preview_session_id,
          verdict: judged.record.verdict, reason: judged.record.reason })
      } catch (err) {
        setOpened(f => f && { ...f, judging: false })
        log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
  }

  // Promote the preview session to a live one the user can type into. The
  // transcript and rendered canvas are already in it, which is the inheritance
  // "Continue here" promises. The ORIGINAL foreign session stays untouched.
  const continueHere = async () => {
    if (!opened) return
    const current = opened
    try {
      let pid = current.previewSessionId
      try {
        if (!pid) throw new Error('no preview session')
        await client.request('session.resume', { session_id: pid })
      } catch {
        // The cached preview session is gone (pruned, deleted). Rebuild it the
        // same way it was made in the first place — one server-side judge run,
        // which re-seeds the transcript and re-caches the verdict.
        const rows = await fetchTranscript(bffUrl, current.row.id).catch(() => [])
        const judged = await client.request<{ preview_session_id: string; doc: CanvasDoc | null }>(
          'canvas.judge', {
            source_session_id: current.row.id,
            text: buildJudgePrompt(current.row, packTranscript(rows)),
          })
        pid = judged.preview_session_id
        if (judged.doc) setDoc(judged.doc)
      }
      sessionIdRef.current = pid!
      canvasKeyRef.current = pid!
      await bindSessions(bffUrl, [pid!])
      setOpened(null) // leaves read-only mode; the composer returns
      log({ kind: 'system', text: `continuing from ${current.row.id} in session ${pid}` })
    } catch (err) {
      log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="flex h-screen flex-col bg-canvas font-sans text-primary">
      <TopBar theme={theme} onToggleTheme={toggleTheme} connected={connected} isBusy={isBusy}
        onLogout={handleLogout} onResetLayout={handleResetLayout}
        canReset={!layout.isEmpty || !windows.isEmpty}
        onFocusMap={windows.toggleFocus} canFocus={windows.canFocus} isFocused={windows.isFocused}
        onOpenSessions={openPicker} />
      <main className="relative min-h-0 flex-1 overflow-auto gc-canvas-grid-bg p-4">
        <CanvasHeader rev={mergedDoc?.rev} isBusy={isBusy} />
        {opened?.judging && (
          <p data-testid="verdict-judging" className="px-1 pb-2 font-sans text-[12.5px] text-tertiary">
            Reading {opened.row.source} session — deciding whether it is worth rendering…
          </p>
        )}
        {opened?.verdict === 'declined' && (
          <p data-testid="verdict-declined" className="px-1 pb-2 font-sans text-[12.5px] text-tertiary">
            No canvas for this session — {opened.reason || 'the agent judged it not worth rendering'}.
          </p>
        )}
        {mergedDoc ? (
          <SelectionProvider nodesBySource={nodesBySource} onMirror={mirrorSelection}>
            <TimeExtentProvider>
              <OntologyProvider ontology={mergedDoc.ontology}>
                <ImageryProvider imagery={mergedDoc.imagery}>
                  <HandlerProvider actions={actions}>
                    <LayoutProvider store={layout}>
                      <WindowStateProvider store={windows}>
                        <CanvasGrid doc={mergedDoc} />
                      </WindowStateProvider>
                    </LayoutProvider>
                  </HandlerProvider>
                </ImageryProvider>
              </OntologyProvider>
            </TimeExtentProvider>
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
        turns={opened ? [...opened.turns, ...derived.turns] : derived.turns}
        readOnly={!!opened?.readOnly}
        noReasoningNote={!!opened && opened.turns.length > 0 && opened.turns.every(t => !t.reasoning.length)}
        onContinue={() => { void continueHere() }}
        timeline={derived.timeline}
        errors={errors}
        connected={connected}
        onSend={send}
        approval={approval}
        onRespond={respondApproval}
      />
      <SessionPicker
        open={pickerOpen}
        rows={sessionRows}
        canvasKeys={canvasKeys}
        busy={pickerBusy}
        onOpenSession={(row, hasCanvas) => (hasCanvas ? openOwnSession(row) : openForeignSession(row))}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}
