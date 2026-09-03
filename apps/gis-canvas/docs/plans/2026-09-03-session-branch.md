# Session Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the loaded session into a brand-new one that carries the full conversation and the same canvas, leaving the original untouched.

**Architecture:** `session.branch` already does the hard part — it copies the history, links the parent, seeds a fresh agent, and deliberately leaves the parent live. It only fails to reveal the branch's *stored* key, which the canvas store needs. A thin fenced `canvas.branch` RPC delegates to it, reads the stored key in-process, copies the parent's canvas doc under the branch's key, and returns both ids. The SPA then treats the branch as a normally-loaded session.

**Tech Stack:** Python plugin + pytest (gateway), React 19 + TypeScript + Vitest (SPA).

**Spec:** `apps/gis-canvas/docs/2026-09-03-session-branch-design.md`

## Global Constraints

- **Two ids, never interchangeable.** `_sessions` is keyed by RUNTIME SID; `CanvasStore` and `sessions.id` use the STORED KEY. `sessionIdRef` holds the runtime sid (`prompt.submit`, `approval.respond`, `canvas.branch`); `canvasKeyRef` holds the stored key (`canvas.interaction`, `canvas.get`). Confusing them is the single most repeated bug in this feature area.
- **The parent's canvas doc is read, never written.** That is what makes "the original is preserved" true rather than aspirational, and it has its own test.
- **The parent is never closed and never gets an `end_reason`.** `session.branch`'s TUI path leaves it alone by design.
- **Working directories.** The Bash tool's cwd resets between calls — prefix every command. SPA commands run from `apps/gis-canvas`; plugin/pytest commands from the repo root.
- **Test runners.** SPA: `npx vitest run <path>` from `apps/gis-canvas`. Plugin: `.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q` from the repo root.
- **Task 2 edits `tui_gateway/server.py`, so it needs a gateway restart to verify live.** Tasks 1, 3 and 4 do not.
- **Branch:** `gis/session-browser` (already checked out, holds the design commit).
- **Existing suites must stay green:** 438 SPA, 196 plugin, 38 BFF.

## File Structure

| File | Responsibility |
|---|---|
| `plugins/gis-canvas/wire.py` (modify) | `handle_canvas_branch_doc` — copy a canvas doc between keys |
| `tui_gateway/server.py` (modify) | `canvas.branch` delegate inside the existing fenced block |
| `apps/gis-canvas/src/App.tsx` (modify) | Fix the runtime-sid defect; add the branch action |
| `apps/gis-canvas/src/components/TopBar.tsx` (modify) | The `⑂ Branch` button |

---

### Task 1: Copy a canvas doc between sessions

**Files:**
- Modify: `plugins/gis-canvas/wire.py`
- Test: `tests/plugins/gis_canvas/test_wire.py`

**Interfaces:**
- Consumes: `get_store()` from `plugins/gis-canvas/tools_canvas.py` (already imported in `wire.py`)
- Produces: `handle_canvas_branch_doc(params: dict) -> dict` → `{"ok": True, "doc": dict | None}`, params `{from_key, to_key}`

A branch gets a brand-new stored key, so `CanvasStore` has nothing under it. This copies the parent's doc across so the fork opens on the same picture. `CanvasStore.put` stamps the copy as the branch's own rev 1 — it is a new document, not a shared one.

A parent with no canvas is normal (a conversation-only session), not an error: return `None` and write nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_wire.py`:

```python
def test_branch_doc_copies_the_parent_canvas_to_the_new_key(plugin):
    _render(plugin, "parent")
    out = plugin.wire.handle_canvas_branch_doc({"from_key": "parent", "to_key": "child"})
    assert out["ok"] is True
    assert out["doc"]["components"][0]["id"] == "sev"
    # The copy is the branch's OWN document, starting at rev 1.
    assert out["doc"]["rev"] == 1
    assert plugin.wire.handle_canvas_get({"session_id": "child"})["doc"]["components"][0]["id"] == "sev"


def test_branch_doc_leaves_the_parent_untouched(plugin):
    _render(plugin, "parent")   # rev 1
    _render(plugin, "parent")   # rev 2 — a parent with some history
    before = plugin.wire.handle_canvas_get({"session_id": "parent"})["doc"]
    plugin.wire.handle_canvas_branch_doc({"from_key": "parent", "to_key": "child"})
    after = plugin.wire.handle_canvas_get({"session_id": "parent"})["doc"]
    # This is the load-bearing guarantee of the whole feature.
    assert after == before
    assert after["rev"] == 2


def test_branch_doc_is_fine_when_the_parent_has_no_canvas(plugin):
    out = plugin.wire.handle_canvas_branch_doc({"from_key": "no-canvas", "to_key": "child"})
    assert out["ok"] is True and out["doc"] is None
    # Nothing was written for the branch either.
    assert plugin.wire.handle_canvas_get({"session_id": "child"})["doc"] is None


def test_branch_doc_requires_both_keys(plugin):
    assert plugin.wire.handle_canvas_branch_doc({"from_key": "parent"})["ok"] is False
    assert plugin.wire.handle_canvas_branch_doc({"to_key": "child"})["ok"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_wire.py -q`
Expected: FAIL — `AttributeError: module 'gis_canvas_plugin.wire' has no attribute 'handle_canvas_branch_doc'`.

- [ ] **Step 3: Implement the handler**

Append to `plugins/gis-canvas/wire.py`:

```python
def handle_canvas_branch_doc(params: dict) -> dict:
    """Inbound (from canvas.branch): copy a canvas doc onto a branch's key.

    The parent's doc is READ ONLY — the branch gets its own file, stamped as
    its own rev 1 by CanvasStore.put. That separation is what lets a branch
    diverge without ever altering the session it came from.

    A parent with no canvas is normal (a conversation-only session), not an
    error: nothing is written and the caller gets None.
    """
    p = params or {}
    from_key = str(p.get("from_key") or "")
    to_key = str(p.get("to_key") or "")
    if not from_key or not to_key:
        return {"ok": False, "errors": ["from_key and to_key are required"]}
    store = get_store()
    doc = store.get(from_key)
    if doc is None:
        return {"ok": True, "doc": None}
    return {"ok": True, "doc": store.put(to_key, doc)}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_wire.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/wire.py tests/plugins/gis_canvas/test_wire.py
git commit -m "feat(gis-canvas): copy a canvas doc onto a branch key"
```

---

### Task 2: The canvas.branch RPC

**Files:**
- Modify: `tui_gateway/server.py` (the fenced gis-canvas block, ends with `# <<< gis-canvas >>>`)
- Test: `tests/plugins/gis_canvas/test_registration.py`

**Interfaces:**
- Consumes: `handle_canvas_branch_doc` (Task 1); `_methods["session.branch"]`, `_sessions`, `_sessions_lock` from `tui_gateway/server.py`
- Produces: RPC `canvas.branch {session_id}` → `{session_id, stored_session_id, title, parent, doc}`

`session.branch` (`server.py:7749`) does all the real work — it needs the parent LIVE, copies the full history, links `parent_session_id`, auto-titles from the lineage, and seeds a fresh agent. It returns only the runtime sid; the stored key lives at `_sessions[new_sid]["session_key"]`, which is why this delegate exists.

**Do NOT add `canvas.branch` to `_LONG_HANDLERS`.** Unlike `canvas.judge` it runs no agent turn. It does build an agent, which `session.branch` already does synchronously on the normal RPC path today, so its latency profile is unchanged.

- [ ] **Step 1: Extend the registration guard**

In `tests/plugins/gis_canvas/test_registration.py`, add `"canvas.branch"` to the tuple in
`test_gateway_fenced_block_declares_the_canvas_rpcs`:

```python
    for m in ("canvas.interaction", "canvas.data_fetch", "canvas.get", "canvas.list",
              "canvas.preview_get", "canvas.preview_set", "canvas.judge", "canvas.branch"):
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_registration.py -q`
Expected: FAIL — `AssertionError: canvas.branch missing from the fenced gis-canvas block`.

- [ ] **Step 3: Add the delegate**

In `tui_gateway/server.py`, immediately **before** the closing `# <<< gis-canvas >>>` line:

```python
# canvas.branch forks the loaded session. session.branch does the real work
# (full history copy, parent link, fresh agent, parent left untouched) but
# returns only the runtime sid — the canvas store is keyed by the STORED key,
# which is only reachable in-process. This delegate bridges that and carries the
# parent's canvas across. NOT a _LONG_HANDLERS entry: it runs no agent turn.
@method("canvas.branch")
def _(rid, params: dict) -> dict:
    try:
        from hermes_plugins.gis_canvas.wire import handle_canvas_branch_doc
    except Exception as exc:  # plugin absent/disabled — fail soft
        return _err(rid, -32601, f"gis-canvas plugin unavailable: {exc}")
    p = params or {}
    sid = str(p.get("session_id") or "")
    if not sid:
        return _err(rid, -32602, "session_id is required")

    with _sessions_lock:
        parent = _sessions.get(sid)
    parent_key = parent.get("session_key") if parent else None
    if not parent_key:
        return _err(rid, 4001, "canvas.branch: session not found")

    branched = _methods["session.branch"](rid, {"session_id": sid})
    if (branched or {}).get("error"):
        return branched  # 4008 "nothing to branch" and friends pass straight through
    result = (branched or {}).get("result") or {}
    new_sid = result.get("session_id")
    if not new_sid:
        return _err(rid, -32000, "canvas.branch: branch returned no session id")

    with _sessions_lock:
        child = _sessions.get(new_sid)
    new_key = (child or {}).get("session_key") or new_sid

    copied = handle_canvas_branch_doc({"from_key": parent_key, "to_key": new_key})
    if not copied.get("ok"):
        return _err(rid, -32000, "; ".join(copied.get("errors", ["canvas.branch failed"])))
    return _ok(rid, {
        "session_id": new_sid,
        "stored_session_id": new_key,
        "title": result.get("title") or "",
        "parent": result.get("parent") or parent_key,
        "doc": copied.get("doc"),
    })
```

- [ ] **Step 4: Run the full plugin suite**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q`
Expected: PASS, 200 tests.

- [ ] **Step 5: Syntax-check the gateway edit**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -c "import ast; ast.parse(open('tui_gateway/server.py',encoding='utf-8').read()); print('SYNTAX OK')"`
Expected: `SYNTAX OK`.

- [ ] **Step 6: Commit**

```bash
git add tui_gateway/server.py tests/plugins/gis_canvas/test_registration.py
git commit -m "feat(gis-canvas): canvas.branch RPC returning the branch stored key"
```

---

### Task 3: Fix the runtime-sid defect in openOwnSession

**Files:**
- Modify: `apps/gis-canvas/src/App.tsx:233-252`
- Test: `apps/gis-canvas/src/App.test.tsx`

**Interfaces:**
- Consumes: `session.resume` → `{session_id: <runtime sid>, session_key: <stored key>}`
- Produces: nothing new; `sessionIdRef` now holds a runtime sid on every path

`_sessions` is keyed by runtime sid (`_sess_nowait`, `server.py:1333`), but `openOwnSession`
stores `row.id` — the **stored** key — in `sessionIdRef`. So `prompt.submit` on a reopened
session fails with `4001 session not found`, and `canvas.branch` (Task 2) would fail identically.

`canvasKeyRef = row.id` is already correct and must stay: the canvas store *is* keyed by the
stored key.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/App.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/App.test.tsx`
Expected: FAIL — the submitted `session_id` is `'own1'`, not `'rt-99'`.

- [ ] **Step 3: Record both ids correctly**

In `apps/gis-canvas/src/App.tsx`, replace the body of `openOwnSession`'s try block:

```tsx
        const resumed = await client.request<{ session_id: string; session_key?: string }>(
          'session.resume', { session_id: row.id })
        const got = await client.request<{ doc: CanvasDoc | null }>('canvas.get', { session_id: row.id })
        // Two DIFFERENT ids: the gateway keys live sessions by runtime sid, while
        // the canvas store and sessions.id use the stored key. Mixing them makes
        // every later prompt fail with 4001 "session not found".
        sessionIdRef.current = resumed.session_id ?? row.id
        canvasKeyRef.current = resumed.session_key ?? row.id
        await bindSessions(bffUrl, [...new Set([row.id, resumed.session_id].filter(Boolean))] as string[])
        if (got.doc) setDoc(got.doc)
        // Replay the history too — resuming does not backfill this connection's
        // activity log, so the dock would otherwise be empty.
        const rows = await fetchTranscript(bffUrl, row.id).catch(() => [])
        setOpened({ row, turns: transcriptToTurns(rows), readOnly: false })
        log({ kind: 'system', text: `opened session ${row.id}` })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/App.tsx apps/gis-canvas/src/App.test.tsx
git commit -m "fix(gis-canvas): address a reopened session by runtime sid, not stored key"
```

---

### Task 4: The Branch action

**Files:**
- Modify: `apps/gis-canvas/src/components/TopBar.tsx`
- Modify: `apps/gis-canvas/src/App.tsx`
- Test: `apps/gis-canvas/src/components/TopBar.test.tsx`, `apps/gis-canvas/src/App.test.tsx`

**Interfaces:**
- Consumes: `canvas.branch` (Task 2); `transcriptToTurns`, `fetchTranscript`, `bindSessions`, `setDoc`
- Produces: `<TopBar onBranch canBranch>` (both required; test id `branch-session`)

**"Something to branch" is not "a session exists."** The bootstrap creates an empty session at
startup and `session.branch` rejects an empty history with `4008 nothing to branch — send a
message first`. So `canBranch` is `!isBusy && (opened !== null || derived.turns.length > 0)` —
never offer an action guaranteed to fail. Mid-turn is excluded so a half-finished exchange is
not copied into the fork.

A branch has no picker row, so one is **synthesised** from the RPC response to reuse the single
`opened` replay path rather than forking the state shape.

- [ ] **Step 1: Write the failing TopBar test**

In `apps/gis-canvas/src/components/TopBar.test.tsx`, add `onBranch: () => {}, canBranch: false,`
to the `base` object, then append inside `describe('TopBar', …)`:

```tsx
  it('offers Branch only when there is something to branch', () => {
    const onBranch = vi.fn()
    const { rerender } = render(<TopBar {...base} onBranch={onBranch} />)
    expect(screen.queryByTestId('branch-session')).toBeNull()
    rerender(<TopBar {...base} onBranch={onBranch} canBranch />)
    fireEvent.click(screen.getByTestId('branch-session'))
    expect(onBranch).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/TopBar.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="branch-session"]`.

- [ ] **Step 3: Add the button**

In `apps/gis-canvas/src/components/TopBar.tsx`, add to the destructured params and the prop type:

```tsx
  onBranch,
  canBranch
```
```tsx
  onBranch: () => void
  canBranch: boolean
```

and insert immediately **before** the `data-testid="open-sessions"` button:

```tsx
        {canBranch && (
          <button
            data-testid="branch-session"
            onClick={onBranch}
            title="Fork this session into a new one, leaving the original untouched"
            className="rounded-gc-sm border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary"
          >
            ⑂ Branch
          </button>
        )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/components/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing App test**

Append to `apps/gis-canvas/src/App.test.tsx`:

```tsx
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
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/App.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="branch-session"]`.

- [ ] **Step 7: Wire App**

In `apps/gis-canvas/src/App.tsx`, add the handler beside `openOwnSession`:

```tsx
  // Fork the loaded session. session.branch copies the whole conversation and
  // leaves the parent alone; canvas.branch additionally carries the canvas
  // across and hands back the STORED key the canvas store needs.
  const branchSession = () => {
    const sid = sessionIdRef.current
    if (!sid) return
    void (async () => {
      try {
        const b = await client.request<{
          session_id: string
          stored_session_id: string
          title: string
          parent: string
          doc: CanvasDoc | null
        }>('canvas.branch', { session_id: sid })
        sessionIdRef.current = b.session_id
        canvasKeyRef.current = b.stored_session_id
        await bindSessions(bffUrl, [b.stored_session_id, b.session_id])
        if (b.doc) setDoc(b.doc)
        // A branch has no picker row; synthesise one so the single `opened`
        // replay path shows the inherited conversation.
        const rows = await fetchTranscript(bffUrl, b.stored_session_id).catch(() => [])
        const turns = transcriptToTurns(rows)
        setOpened({
          row: {
            id: b.stored_session_id,
            source: 'dashboard',
            title: b.title,
            preview: '',
            message_count: turns.length,
            started_at: Date.now() / 1000,
            last_active: Date.now() / 1000,
          },
          turns,
          readOnly: false,
        })
        log({ kind: 'system', text: `branched into ${b.title || b.stored_session_id}` })
      } catch (err) {
        log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
  }
```

and pass the props to `TopBar`:

```tsx
        onBranch={branchSession}
        canBranch={!isBusy && (opened !== null || derived.turns.length > 0)}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 9: Full verification**

Run: `cd apps/gis-canvas && npx vitest run && npx tsc -p . --noEmit && npx vite build`
Expected: all PASS (~441), typecheck clean, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add apps/gis-canvas/src/components/TopBar.tsx apps/gis-canvas/src/components/TopBar.test.tsx apps/gis-canvas/src/App.tsx apps/gis-canvas/src/App.test.tsx
git commit -m "feat(gis-canvas): branch the loaded session into a new one"
```

---

## Manual verification

Task 2 edits `tui_gateway/server.py`, so **restart the gateway** (PowerShell recipe in
`[[gis-canvas-machine-setup]]`, so `GIS_BFF_PROXY_SECRET` propagates). The BFF is unchanged.

Before branching, record the parent's state so the preservation claim can be checked, not assumed:

```bash
sqlite3 "$LOCALAPPDATA/hermes/state.db" \
  "SELECT id, ended_at, end_reason, message_count FROM sessions WHERE id='<parent id>';"
md5sum ~/.hermes/gis_canvas/<parent id>.json
```

Then:

1. In a session with a canvas and a few turns, **⑂ Branch** appears; it is absent on a fresh
   empty session and while a turn is running.
2. Clicking it lands you in a new session whose title reads like `<parent> (2)`, showing the
   **same canvas** and the **inherited conversation** in the dock.
3. Ask the branch something that depends on earlier context ("what was the longest gap you
   found?"). It should answer from the inherited history, not ask what you mean.
4. The branch appears in **▤ Sessions** as its own row, badged **Canvas**.
5. Re-run both commands above: `ended_at`, `end_reason` and `message_count` unchanged, and the
   parent's canvas file has the **same checksum**. This is the whole point of the feature.
6. Reopen the parent from the picker and send a prompt — it must work (Task 3's fix) and must
   still show its own canvas, not the branch's.

## Known risks

- **The parent stays live** after branching, holding an active-session slot. The gateway trims
  detached idle sessions over its cap on its own; we deliberately do not close the parent,
  because closing sets an end reason on the very session we promised not to touch.
- **`session.branch` builds an agent synchronously**, so `canvas.branch` can block for a second
  or two on a cold session. It is not in `_LONG_HANDLERS` because that is the existing behaviour
  of `session.branch` on the normal RPC path; if it proves too slow in practice, adding it there
  is a one-line change.
