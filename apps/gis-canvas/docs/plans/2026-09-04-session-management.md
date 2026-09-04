# Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename, archive and permanently delete sessions from the canvas picker, and show which session is currently loaded.

**Architecture:** The gateway already exposes `PATCH /api/sessions/{id}` (title + archived) and `DELETE /api/sessions/{id}`; the BFF gains three thin proxies beside its existing read routes. The picker stays presentational — `App` owns `currentId` and the callbacks, performs each request, and refetches. Permanent delete additionally calls a new `canvas.forget` RPC so the stored canvas doc and preview-index records go with the session; archive deliberately does not.

**Tech Stack:** FastAPI + pytest + respx (BFF), Python plugin + pytest (gateway), React 19 + TypeScript + Vitest (SPA).

**Spec:** `apps/gis-canvas/docs/2026-09-04-session-management-design.md`

## Global Constraints

- **Archive must NOT forget the canvas doc.** Only permanent delete calls `canvas.forget`. Deleting the doc on archive would be data loss wearing a "reversible" label.
- **`canvas.forget` runs only after the DELETE succeeds.** A failed delete forgets nothing.
- **The currently-loaded session cannot be archived or deleted** — only renamed.
- **Session titles are untrusted** (authored on other surfaces, by other users). Render as text, in the row and in the confirmation prompt alike; never as markup.
- **Two ids, never interchangeable.** `canvasKeyRef` holds the STORED key — that is what the picker, the canvas store and `sessions.id` all use, and therefore what `currentId` carries. `sessionIdRef` holds the RUNTIME sid and is not involved here.
- **Working directories.** The Bash tool's cwd resets between calls — prefix every command. SPA from `apps/gis-canvas`; BFF from `apps/gis-canvas-bff`; plugin/pytest from the repo root.
- **Test runners.** SPA: `npx vitest run <path>`. BFF: `.venv/Scripts/python.exe -m pytest tests/ -q`. Plugin: `.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q`.
- **NEVER run `tests/test_tui_gateway_server.py` or `tests/tui_gateway/` on this machine.** That suite is not hermetic: it writes to the real `HERMES_HOME`, and doing so previously wiped the user's `auth.json` providers and injected fixture rows into the live `state.db`. Only `tests/plugins/gis_canvas/` is safe.
- **Task 2 edits `tui_gateway/server.py`, so it needs a gateway restart to verify live.** Tasks 1, 3, 4 and 5 do not. The BFF needs a restart after Task 1.
- **Branch:** `gis/session-browser`.
- **Existing suites must stay green:** 443 SPA, 200 plugin, 40 BFF.

## File Structure

| File | Responsibility |
|---|---|
| `apps/gis-canvas-bff/app/sessions_proxy.py` (modify) | Add PATCH + DELETE beside the read routes; restate the invariant |
| `plugins/gis-canvas/wire.py` (modify) | `handle_canvas_forget` — drop a doc and its preview records |
| `tui_gateway/server.py` (modify) | `canvas.forget` delegate in the fenced block |
| `apps/gis-canvas/src/lib/sessions.ts` (modify) | `renameSession`, `setArchived`, `deleteSession` |
| `apps/gis-canvas/src/components/SessionPicker.tsx` (modify) | Row actions, inline rename, current-row guard |
| `apps/gis-canvas/src/components/CanvasHeader.tsx` (modify) | Show the session title |
| `apps/gis-canvas/src/App.tsx` (modify) | Own `currentId`, the callbacks, and the header title |

---

### Task 1: BFF mutation routes

**Files:**
- Modify: `apps/gis-canvas-bff/app/sessions_proxy.py`
- Test: `apps/gis-canvas-bff/tests/test_sessions_proxy.py`

**Interfaces:**
- Consumes: `app_module.settings`, `app_module.store`, `app_module.get_http_client` (already used by the read routes)
- Produces:
  - `PATCH /sessions/{id}` body `{"title": str}` and/or `{"archived": bool}` → the gateway's JSON
  - `DELETE /sessions/{id}` → the gateway's JSON

The module's docstring currently says no delete endpoint may be added. That constraint was about **browsing** never mutating — not about the module staying read-only forever. Update it to state what is actually true rather than leaving a contradiction in the file.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas-bff/tests/test_sessions_proxy.py`:

```python
def test_rename_401_when_not_authenticated():
    r = TestClient(bff.app).patch("/sessions/abc", json={"title": "New name"})
    assert r.status_code == 401


def test_delete_401_when_not_authenticated():
    r = TestClient(bff.app).delete("/sessions/abc")
    assert r.status_code == 401


def test_rename_proxies_the_title():
    with respx.mock:
        route = respx.patch(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True, "title": "New name"}))
        r = _authed().patch("/sessions/abc", json={"title": "New name"})
    assert r.status_code == 200
    assert json.loads(route.calls[0].request.content)["title"] == "New name"


def test_archive_proxies_the_flag_without_touching_the_title():
    with respx.mock:
        route = respx.patch(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True}))
        r = _authed().patch("/sessions/abc", json={"archived": True})
    assert r.status_code == 200
    body = json.loads(route.calls[0].request.content)
    assert body["archived"] is True
    # Sending title=None would CLEAR the title — only send what is being changed.
    assert "title" not in body


def test_rename_can_clear_a_title_with_an_empty_string():
    with respx.mock:
        route = respx.patch(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True}))
        r = _authed().patch("/sessions/abc", json={"title": ""})
    assert r.status_code == 200
    assert json.loads(route.calls[0].request.content)["title"] == ""


def test_delete_proxies_and_returns_the_gateway_body():
    with respx.mock:
        respx.delete(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True}))
        r = _authed().delete("/sessions/abc")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_mutations_surface_a_missing_session_as_404():
    with respx.mock:
        respx.patch(f"{GW}/api/sessions/gone").mock(return_value=httpx.Response(404, json={}))
        r = _authed().patch("/sessions/gone", json={"title": "x"})
    assert r.status_code == 404


def test_mutations_surface_a_gateway_failure_as_502():
    with respx.mock:
        respx.delete(f"{GW}/api/sessions/abc").mock(return_value=httpx.Response(500, text="boom"))
        r = _authed().delete("/sessions/abc")
    assert r.status_code == 502
```

Add `import json` to the top of that test file if it is not already imported.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/workspace/analyst/hermes-agent/apps/gis-canvas-bff && .venv/Scripts/python.exe -m pytest tests/test_sessions_proxy.py -q`
Expected: FAIL — the PATCH/DELETE routes do not exist, so FastAPI returns 405 rather than 401/200.

- [ ] **Step 3: Update the module docstring**

In `apps/gis-canvas-bff/app/sessions_proxy.py`, replace the module docstring:

```python
"""Session browsing and management for Thoughts Canvas.

Proxies the gateway's session endpoints. The invariant is about BROWSING, not
about this module: reading a session must never change it, so the GET routes
below are side-effect free and no resume/branch call may be added to them.

The PATCH and DELETE routes are explicit, user-initiated management actions
(rename, archive, delete) and are deliberately separate from the read path.
"""
```

- [ ] **Step 4: Add the routes**

In the same file, inside `_init`, add a shared request helper beside `_get` and then the two
routes, after `session_messages`:

```python
    async def _send(method: str, path: str, json_body: dict | None = None):
        async with app_module.get_http_client() as client:
            return await client.request(
                method,
                f"{settings.gateway_url}{path}",
                json=json_body,
                headers={"X-Hermes-Session-Token": settings.gateway_token},
            )

    def _relay(r: httpx.Response):
        """Map a gateway response onto ours: 404 stays 404 (the session is gone,
        which the caller must distinguish), anything else non-200 is a 502."""
        if r.status_code == 404:
            return JSONResponse({"error": "session not found"}, status_code=404)
        if r.status_code != 200:
            return JSONResponse({"error": "gateway error"}, status_code=502)
        return r.json()

    @router.patch("/sessions/{session_id}")
    async def update_session(request: Request, session_id: str):
        if not _principal(request):
            return JSONResponse({"error": "not authenticated"}, status_code=401)
        body = await request.json()
        # Forward ONLY the fields being changed: sending title=None would clear
        # the title, so an archive request must not carry one.
        patch = {k: body[k] for k in ("title", "archived") if k in body}
        if not patch:
            return JSONResponse({"error": "title or archived is required"}, status_code=400)
        try:
            r = await _send("PATCH", f"/api/sessions/{session_id}", patch)
        except httpx.HTTPError as exc:
            return JSONResponse({"error": f"gateway unreachable: {exc}"}, status_code=502)
        return _relay(r)

    @router.delete("/sessions/{session_id}")
    async def delete_session(request: Request, session_id: str):
        if not _principal(request):
            return JSONResponse({"error": "not authenticated"}, status_code=401)
        try:
            r = await _send("DELETE", f"/api/sessions/{session_id}")
        except httpx.HTTPError as exc:
            return JSONResponse({"error": f"gateway unreachable: {exc}"}, status_code=502)
        return _relay(r)
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd /c/workspace/analyst/hermes-agent/apps/gis-canvas-bff && .venv/Scripts/python.exe -m pytest tests/ -q`
Expected: PASS — 48 tests.

- [ ] **Step 6: Restart the BFF**

```
Set-Location C:\workspace\analyst\hermes-agent\apps\gis-canvas-bff
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 9109
```

Verify: `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://127.0.0.1:9109/sessions/nope` → `401` (route exists, auth enforced).

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas-bff/app/sessions_proxy.py apps/gis-canvas-bff/tests/test_sessions_proxy.py
git commit -m "feat(gis-canvas-bff): rename, archive and delete session routes"
```

---

### Task 2: canvas.forget

**Files:**
- Modify: `plugins/gis-canvas/wire.py`
- Modify: `tui_gateway/server.py` (fenced block, ends `# <<< gis-canvas >>>`)
- Test: `tests/plugins/gis_canvas/test_wire.py`, `tests/plugins/gis_canvas/test_registration.py`

**Interfaces:**
- Consumes: `get_store()`, `get_preview_index()` (both already imported in `wire.py`)
- Produces: `handle_canvas_forget(params: dict) -> dict` → `{"ok": True, "forgot": bool}`; RPC `canvas.forget {session_id}`

Deleting a session's rows would otherwise leave `~/.hermes/gis_canvas/<id>.json` orphaned and its
key in `canvas.list` forever. Two kinds of preview record must go: one keyed by this id (it was a
foreign session that got judged) and any whose `preview_session_id` points at it (it was the
preview session created for some other foreign session).

`PreviewIndex` has no delete method yet, so this task adds `drop(session_id)` to it.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_wire.py`:

```python
def test_forget_removes_the_stored_canvas(plugin):
    _render(plugin, "doomed")
    assert plugin.wire.handle_canvas_get({"session_id": "doomed"})["doc"] is not None
    out = plugin.wire.handle_canvas_forget({"session_id": "doomed"})
    assert out["ok"] is True and out["forgot"] is True
    assert plugin.wire.handle_canvas_get({"session_id": "doomed"})["doc"] is None
    assert "doomed" not in plugin.wire.handle_canvas_list({})["keys"]


def test_forget_drops_a_preview_record_keyed_by_that_session(plugin):
    plugin.preview_index.reset_index_for_tests()
    plugin.wire.handle_canvas_preview_set({
        "source_session_id": "doomed", "preview_session_id": "p1", "verdict": "rendered"})
    plugin.wire.handle_canvas_forget({"session_id": "doomed"})
    assert plugin.wire.handle_canvas_preview_get({"source_session_id": "doomed"})["record"] is None


def test_forget_drops_a_preview_record_pointing_at_that_session(plugin):
    # The deleted session was the PREVIEW created for some other foreign session.
    # Leaving the record behind would strand it: cached, but pointing at nothing.
    plugin.preview_index.reset_index_for_tests()
    plugin.wire.handle_canvas_preview_set({
        "source_session_id": "foreign", "preview_session_id": "doomed", "verdict": "rendered"})
    plugin.wire.handle_canvas_forget({"session_id": "doomed"})
    assert plugin.wire.handle_canvas_preview_get({"source_session_id": "foreign"})["record"] is None


def test_forget_is_a_no_op_for_an_unknown_session(plugin):
    plugin.preview_index.reset_index_for_tests()
    out = plugin.wire.handle_canvas_forget({"session_id": "never-existed"})
    assert out["ok"] is True and out["forgot"] is False


def test_forget_requires_a_session_id(plugin):
    assert plugin.wire.handle_canvas_forget({})["ok"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_wire.py -q`
Expected: FAIL — `module 'gis_canvas_plugin.wire' has no attribute 'handle_canvas_forget'`.

- [ ] **Step 3: Add `drop` to the preview index**

In `plugins/gis-canvas/preview_index.py`, add after `put`:

```python
    def drop(self, session_id: str) -> bool:
        """Remove every record that mentions this session — the one keyed by it,
        and any whose preview_session_id points at it (a stranded pointer is
        worse than no record: it is cached, and points at nothing)."""
        with self._lock:
            data = self._read()
            keep = {
                k: v for k, v in data.items()
                if k != session_id and v.get("preview_session_id") != session_id
            }
            if len(keep) == len(data):
                return False
            self._path.write_text(json.dumps(keep, ensure_ascii=False))
            return True
```

- [ ] **Step 4: Add the wire handler**

Append to `plugins/gis-canvas/wire.py`:

```python
def handle_canvas_forget(params: dict) -> dict:
    """Inbound canvas.forget: drop a deleted session's canvas doc and any
    preview records that mention it.

    Called ONLY after a permanent delete succeeds. Archiving must never reach
    here — archiving is reversible, so the canvas has to survive it, or
    restoring the session would silently come back without its picture.
    """
    session_id = str((params or {}).get("session_id") or "")
    if not session_id:
        return {"ok": False, "errors": ["session_id is required"]}
    store = get_store()
    had_doc = store.get(session_id) is not None
    store.reset(session_id)
    dropped = get_preview_index().drop(session_id)
    return {"ok": True, "forgot": bool(had_doc or dropped)}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_wire.py -q`
Expected: PASS.

- [ ] **Step 6: Extend the registration guard, then register the RPC**

In `tests/plugins/gis_canvas/test_registration.py`, add `"canvas.forget"` to the tuple:

```python
    for m in ("canvas.interaction", "canvas.data_fetch", "canvas.get", "canvas.list",
              "canvas.preview_get", "canvas.preview_set", "canvas.judge", "canvas.branch",
              "canvas.forget"):
```

Run it to see it fail (`AssertionError: canvas.forget missing from the fenced gis-canvas block`),
then in `tui_gateway/server.py`, immediately **before** the closing `# <<< gis-canvas >>>`:

```python
@method("canvas.forget")
def _(rid, params: dict) -> dict:
    try:
        from hermes_plugins.gis_canvas.wire import handle_canvas_forget
    except Exception as exc:  # plugin absent/disabled — fail soft
        return _err(rid, -32601, f"gis-canvas plugin unavailable: {exc}")
    result = handle_canvas_forget(params or {})
    if not result.get("ok"):
        return _err(rid, -32000, "; ".join(result.get("errors", ["canvas.forget failed"])))
    return _ok(rid, result)
```

- [ ] **Step 7: Run the plugin suite and syntax-check**

Run: `cd /c/workspace/analyst/hermes-agent && .venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q && .venv/Scripts/python.exe -c "import ast; ast.parse(open('tui_gateway/server.py',encoding='utf-8').read()); print('SYNTAX OK')"`
Expected: PASS (205 tests) and `SYNTAX OK`.

- [ ] **Step 8: Commit**

```bash
git add plugins/gis-canvas/preview_index.py plugins/gis-canvas/wire.py tui_gateway/server.py tests/plugins/gis_canvas/
git commit -m "feat(gis-canvas): canvas.forget drops a deleted session's canvas and preview records"
```

---

### Task 3: SPA session-mutation client

**Files:**
- Modify: `apps/gis-canvas/src/lib/sessions.ts`
- Test: `apps/gis-canvas/src/lib/sessions.test.ts`

**Interfaces:**
- Consumes: the BFF routes from Task 1
- Produces:
  - `renameSession(bffUrl: string, id: string, title: string): Promise<void>`
  - `setArchived(bffUrl: string, id: string, archived: boolean): Promise<void>`
  - `deleteSession(bffUrl: string, id: string): Promise<void>`

All three **throw** on failure, matching `fetchTranscript` rather than `listSessions`: these are
deliberate user actions, and silently swallowing a failed delete would be a lie.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/lib/sessions.test.ts`:

```ts
describe('session mutations', () => {
  it('renames via PATCH with the title', async () => {
    const spy = stubFetch(200, { ok: true })
    await renameSession(BFF, 'abc', 'New name')
    expect(spy).toHaveBeenCalledWith(`${BFF}/sessions/abc`, expect.objectContaining({
      method: 'PATCH',
      credentials: 'include',
      body: JSON.stringify({ title: 'New name' }),
    }))
  })

  it('archives via PATCH without sending a title', async () => {
    const spy = stubFetch(200, { ok: true })
    await setArchived(BFF, 'abc', true)
    // A title of null/undefined would CLEAR the title server-side.
    expect(spy.mock.calls[0][1].body).toBe(JSON.stringify({ archived: true }))
  })

  it('deletes via DELETE', async () => {
    const spy = stubFetch(200, { ok: true })
    await deleteSession(BFF, 'abc')
    expect(spy).toHaveBeenCalledWith(`${BFF}/sessions/abc`, expect.objectContaining({
      method: 'DELETE', credentials: 'include',
    }))
  })

  it('throws on failure so the caller can surface it', async () => {
    stubFetch(502, { error: 'gateway error' })
    await expect(deleteSession(BFF, 'abc')).rejects.toThrow(/delete/i)
    stubFetch(404, { error: 'session not found' })
    await expect(renameSession(BFF, 'abc', 'x')).rejects.toThrow(/rename/i)
  })

  it('encodes the id in the path', async () => {
    const spy = stubFetch(200, { ok: true })
    await deleteSession(BFF, 'a/b c')
    expect(spy.mock.calls[0][0]).toBe(`${BFF}/sessions/a%2Fb%20c`)
  })
})
```

Extend the import at the top of the file:

```ts
import { listSessions, fetchTranscript, renameSession, setArchived, deleteSession } from './sessions'
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/sessions.test.ts`
Expected: FAIL — `renameSession is not a function`.

- [ ] **Step 3: Implement the three calls**

Append to `apps/gis-canvas/src/lib/sessions.ts`:

```ts
/** Session management. Unlike listSessions these THROW on failure: they are
 * deliberate user actions, and a silently swallowed delete would be a lie. */
async function mutate(url: string, init: RequestInit, what: string): Promise<void> {
  const r = await fetch(url, { credentials: 'include', ...init })
  if (!r.ok) throw new Error(`Could not ${what} (${r.status})`)
}

export async function renameSession(bffUrl: string, id: string, title: string): Promise<void> {
  await mutate(`${bffUrl}/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }, 'rename this session')
}

export async function setArchived(bffUrl: string, id: string, archived: boolean): Promise<void> {
  // Send ONLY `archived`: a title of null would clear the session's title.
  await mutate(`${bffUrl}/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  }, 'archive this session')
}

export async function deleteSession(bffUrl: string, id: string): Promise<void> {
  await mutate(`${bffUrl}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' },
    'delete this session')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/sessions.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/sessions.ts apps/gis-canvas/src/lib/sessions.test.ts
git commit -m "feat(gis-canvas): SPA client for session rename, archive and delete"
```

---

### Task 4: Picker row actions

**Files:**
- Modify: `apps/gis-canvas/src/components/SessionPicker.tsx`
- Test: `apps/gis-canvas/src/components/SessionPicker.test.tsx`

**Interfaces:**
- Consumes: `SessionRow` from `src/lib/sessions.ts`
- Produces: `<SessionPicker>` gains
  ```ts
  currentId?: string
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  ```
  Test ids: `rename-<id>`, `archive-<id>`, `delete-<id>`, `rename-input-<id>`, `current-<id>`, `confirm-delete`, `cancel-delete`.

The component stays presentational: it neither knows which session is loaded nor how to call the
BFF. `App` supplies `currentId` and performs the requests.

**The Escape/blur interaction is the fiddly part.** Escape also blurs the input, so a naive
"blur commits" handler commits the edit Escape just cancelled. Escape must clear the editing
state *before* the blur fires, and blur must commit only if the row is still being edited.

- [ ] **Step 1: Write the failing test**

The new props are REQUIRED, so the file's existing `setup` helper stops compiling. Add the
no-op handlers to it first:

```tsx
  render(<SessionPicker open rows={rows} canvasKeys={new Set(['own1'])} busy={false}
    onOpenSession={onOpenSession} onClose={onClose}
    onRename={() => {}} onArchive={() => {}} onDelete={() => {}} {...over} />)
```

and do the same for the three `render(<SessionPicker …/>)` calls that do not use `setup`
(the closed, loading and empty-state tests, and the hostile-title test). Then append:

```tsx
function setupManage(over = {}) {
  const onRename = vi.fn(); const onArchive = vi.fn(); const onDelete = vi.fn()
  render(<SessionPicker open rows={rows} canvasKeys={new Set(['own1'])} busy={false}
    onOpenSession={() => {}} onClose={() => {}}
    onRename={onRename} onArchive={onArchive} onDelete={onDelete} {...over} />)
  return { onRename, onArchive, onDelete }
}

describe('SessionPicker management', () => {
  it('renames inline on Enter', () => {
    const { onRename } = setupManage()
    fireEvent.click(screen.getByTestId('rename-own1'))
    const input = screen.getByTestId('rename-input-own1')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('own1', 'Renamed')
  })

  it('Escape cancels the rename even though it also blurs the input', () => {
    const { onRename } = setupManage()
    fireEvent.click(screen.getByTestId('rename-own1'))
    const input = screen.getByTestId('rename-input-own1')
    fireEvent.change(input, { target: { value: 'Discarded' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByTestId('rename-input-own1')).toBeNull()
  })

  it('commits on blur when the edit was not cancelled', () => {
    const { onRename } = setupManage()
    fireEvent.click(screen.getByTestId('rename-own1'))
    const input = screen.getByTestId('rename-input-own1')
    fireEvent.change(input, { target: { value: 'Committed' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('own1', 'Committed')
  })

  it('archives in one click, no confirmation', () => {
    const { onArchive } = setupManage()
    fireEvent.click(screen.getByTestId('archive-tg1'))
    expect(onArchive).toHaveBeenCalledWith('tg1')
  })

  it('requires confirmation before deleting, and cancelling does nothing', () => {
    const { onDelete } = setupManage()
    fireEvent.click(screen.getByTestId('delete-tg1'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cancel-delete'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('delete-tg1'))
    fireEvent.click(screen.getByTestId('confirm-delete'))
    expect(onDelete).toHaveBeenCalledWith('tg1')
  })

  it('marks the current session and forbids removing it', () => {
    setupManage({ currentId: 'own1' })
    expect(screen.getByTestId('current-own1')).toBeInTheDocument()
    expect(screen.getByTestId('archive-own1')).toBeDisabled()
    expect(screen.getByTestId('delete-own1')).toBeDisabled()
    // Renaming what you are looking at is fine.
    expect(screen.getByTestId('rename-own1')).not.toBeDisabled()
    // Other rows are unaffected.
    expect(screen.getByTestId('delete-tg1')).not.toBeDisabled()
  })

  it('renders a hostile title as text in the delete confirmation', () => {
    const hostile: SessionRow[] = [{ ...rows[0], id: 'x', title: '<img src=x onerror=alert(1)>' }]
    render(<SessionPicker open rows={hostile} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}}
      onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByTestId('delete-x'))
    const dialog = screen.getByTestId('confirm-delete').closest('div')!
    expect(dialog.querySelector('img')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/SessionPicker.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="rename-own1"]`.

- [ ] **Step 3: Implement the row actions**

In `apps/gis-canvas/src/components/SessionPicker.tsx`, extend the props:

```tsx
export function SessionPicker({
  open, rows, canvasKeys, busy, onOpenSession, onClose,
  currentId, onRename, onArchive, onDelete,
}: {
  open: boolean
  rows: SessionRow[]
  canvasKeys: Set<string>
  busy: boolean
  onOpenSession: (row: SessionRow, hasCanvas: boolean) => void
  onClose: () => void
  currentId?: string
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
}) {
```

Add state beside `const [q, setQ] = useState('')`:

```tsx
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<SessionRow | null>(null)
  // Escape also blurs, so without this flag the blur handler would commit the
  // very edit Escape just cancelled.
  const cancelled = useRef(false)

  const beginRename = (row: SessionRow) => {
    cancelled.current = false
    setDraft(row.title ?? '')
    setEditing(row.id)
  }
  const commitRename = (id: string) => {
    if (cancelled.current || editing !== id) return
    setEditing(null)
    onRename(id, draft.trim())
  }
  const cancelRename = () => { cancelled.current = true; setEditing(null) }
```

Add `useRef` to the React import. Replace the row's title span with a conditional, and add the
action cluster before the badge:

```tsx
                  <span className="min-w-0 flex-1">
                    {editing === row.id ? (
                      <input
                        data-testid={`rename-input-${row.id}`}
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commitRename(row.id)
                          if (e.key === 'Escape') cancelRename()
                        }}
                        onBlur={() => commitRename(row.id)}
                        className="w-full rounded-gc-sm border border-hairline bg-surface px-1.5 py-0.5 font-sans text-[12.5px] text-primary"
                      />
                    ) : (
                      <span className="block truncate font-sans text-[12.5px] text-primary">{label(row)}</span>
                    )}
                    <span className="mt-0.5 block font-mono text-[10.5px] text-tertiary">
                      {row.source} · {row.message_count} msg · {ago(row.last_active)}
                    </span>
                  </span>

                  {row.id === currentId && (
                    <span data-testid={`current-${row.id}`}
                      className="shrink-0 font-mono text-[10px] text-accent">● current</span>
                  )}
                  <span className="flex shrink-0 items-center gap-1">
                    <button data-testid={`rename-${row.id}`} title="Rename"
                      onClick={e => { e.stopPropagation(); beginRename(row) }}
                      className="rounded-gc-sm border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-tertiary hover:text-primary">
                      Rename
                    </button>
                    <button data-testid={`archive-${row.id}`} disabled={row.id === currentId}
                      title={row.id === currentId ? 'You cannot archive the session you are in' : 'Archive'}
                      onClick={e => { e.stopPropagation(); onArchive(row.id) }}
                      className="rounded-gc-sm border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-tertiary hover:text-primary disabled:opacity-40">
                      Archive
                    </button>
                    <button data-testid={`delete-${row.id}`} disabled={row.id === currentId}
                      title={row.id === currentId ? 'You cannot delete the session you are in' : 'Delete permanently'}
                      onClick={e => { e.stopPropagation(); setConfirming(row) }}
                      className="rounded-gc-sm border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-negative hover:text-primary disabled:opacity-40">
                      Delete…
                    </button>
                  </span>
```

Because the row itself is a `<button>` that opens the session, every action handler calls
`e.stopPropagation()` — otherwise renaming would also open the session.

Add the confirmation, rendered just inside the outer overlay div:

```tsx
        {confirming && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/80 p-6">
            <div className="gc-hud w-[min(420px,90vw)] rounded-gc-md p-4">
              <p className="font-sans text-[12.5px] text-primary">
                Delete “{label(confirming)}” permanently? This cannot be undone.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button data-testid="cancel-delete" onClick={() => setConfirming(null)}
                  className="rounded-gc-sm border border-hairline px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary">
                  Cancel
                </button>
                <button data-testid="confirm-delete"
                  onClick={() => { const r = confirming; setConfirming(null); onDelete(r.id) }}
                  className="rounded-gc-sm border border-negative/50 px-2.5 py-1.5 font-sans text-[11.5px] text-negative hover:text-primary">
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
```

The title inside the prompt goes through `label(row)` and is rendered as text by React — it is
authored on other surfaces, so it must never become markup.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/components/SessionPicker.test.tsx`
Expected: PASS — the 7 new tests plus the 9 existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/SessionPicker.tsx apps/gis-canvas/src/components/SessionPicker.test.tsx
git commit -m "feat(gis-canvas): rename, archive and delete actions in the session picker"
```

---

### Task 5: Header indicator and App wiring

**Files:**
- Modify: `apps/gis-canvas/src/components/CanvasHeader.tsx`
- Modify: `apps/gis-canvas/src/App.tsx`
- Test: `apps/gis-canvas/src/components/CanvasHeader.test.tsx` (create), `apps/gis-canvas/src/App.test.tsx`

**Interfaces:**
- Consumes: `renameSession`/`setArchived`/`deleteSession` (Task 3), the picker props (Task 4), `canvas.forget` (Task 2)
- Produces: `<CanvasHeader rev isBusy title>`

`App` owns `currentId` (from `canvasKeyRef`, the stored key on every path), performs each request,
refetches the list, and updates `opened.row.title` when the renamed session is the loaded one so
the header changes immediately.

Permanent delete calls `canvas.forget` **after** the DELETE succeeds — if the delete throws, the
forget never runs and the canvas doc survives.

- [ ] **Step 1: Write the failing header test**

Create `apps/gis-canvas/src/components/CanvasHeader.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CanvasHeader } from './CanvasHeader'

describe('CanvasHeader', () => {
  it('shows the session title as the heading', () => {
    render(<CanvasHeader rev={4} isBusy={false} title="AIS Gap Analysis" />)
    expect(screen.getByText('AIS Gap Analysis')).toBeInTheDocument()
    expect(screen.getByText(/Situation Canvas · rev 4/)).toBeInTheDocument()
  })

  it('falls back to New session when the title is unknown', () => {
    render(<CanvasHeader rev={undefined} isBusy={false} title={undefined} />)
    expect(screen.getByText('New session')).toBeInTheDocument()
    expect(screen.getByText(/awaiting first render/)).toBeInTheDocument()
  })

  it('still reports the composing state', () => {
    render(<CanvasHeader rev={1} isBusy title="X" />)
    expect(screen.getByText('COMPOSING…')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/CanvasHeader.test.tsx`
Expected: FAIL — the heading is the hard-coded "Situation Canvas".

- [ ] **Step 3: Implement the header**

Replace `apps/gis-canvas/src/components/CanvasHeader.tsx`:

```tsx
// Frontend-only header for the canvas area. CanvasDoc has no title field
// (see lib/types.ts) — the title here is the SESSION's, supplied by App from
// the picker row or the branch response, not agent-authored canvas data.
export function CanvasHeader({
  rev, isBusy, title,
}: {
  rev: number | undefined
  isBusy: boolean
  title?: string
}) {
  return (
    <div className="mb-3.5 flex shrink-0 items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="truncate font-display text-[19px] font-semibold text-primary">
          {title?.trim() || 'New session'}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-tertiary">
          {rev != null ? `Situation Canvas · rev ${rev}` : 'Situation Canvas · awaiting first render'}
        </div>
      </div>
      <div className={`shrink-0 font-mono text-[10.5px] tracking-wide ${isBusy ? 'text-accent' : 'text-positive'}`}>
        {isBusy ? 'COMPOSING…' : 'LIVE'}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write the failing App test**

Append to `apps/gis-canvas/src/App.test.tsx`:

```tsx
test('deleting a session forgets its canvas, but archiving does not', async () => {
  vi.mocked(listSessions).mockResolvedValue([
    { id: 'other', source: 'tui', title: 'Other', preview: '', message_count: 5, started_at: 1, last_active: 2 },
  ])
  const client = makeFakeClient({ 'canvas.list': { keys: [] }, 'canvas.forget': { ok: true } })
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x/api/ws?token=t" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  fireEvent.click(screen.getByTestId('open-sessions'))
  fireEvent.click(await screen.findByTestId('archive-other'))
  await waitFor(() => expect(vi.mocked(setArchived)).toHaveBeenCalledWith('http://bff', 'other', true))
  // Archiving is reversible — the canvas must survive it.
  expect(client.requests.some(r => r.method === 'canvas.forget')).toBe(false)

  fireEvent.click(await screen.findByTestId('delete-other'))
  fireEvent.click(await screen.findByTestId('confirm-delete'))
  await waitFor(() => expect(vi.mocked(deleteSession)).toHaveBeenCalledWith('http://bff', 'other'))
  await waitFor(() => {
    const forget = client.requests.find(r => r.method === 'canvas.forget')
    expect((forget?.params as { session_id: string } | undefined)?.session_id).toBe('other')
  })
})
```

Extend the `./lib/sessions` mock at the top of the file so the mutations are spies:

```tsx
vi.mock('./lib/sessions', async (orig) => ({
  ...(await orig<typeof import('./lib/sessions')>()),
  listSessions: vi.fn().mockResolvedValue([]),
  fetchTranscript: vi.fn().mockResolvedValue([]),
  renameSession: vi.fn().mockResolvedValue(undefined),
  setArchived: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}))
```

and extend the import:

```tsx
import { listSessions, fetchTranscript, setArchived, deleteSession } from './lib/sessions'
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/App.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="archive-other"]`.

- [ ] **Step 6: Wire App**

In `apps/gis-canvas/src/App.tsx`, extend the sessions import:

```tsx
import { listSessions, fetchTranscript, renameSession, setArchived, deleteSession, type SessionRow } from './lib/sessions'
```

Add the handlers beside `openPicker`:

```tsx
  // Session management. Each action performs the request, then refetches so the
  // rows and Canvas/Transcript badges match the server rather than an optimistic
  // guess. Failures surface in the activity log — never silently.
  const refreshSessions = () =>
    Promise.all([
      listSessions(bffUrl),
      client.request<{ keys: string[] }>('canvas.list', {}).catch(() => ({ keys: [] as string[] })),
    ]).then(([rowsNow, stored]) => {
      setSessionRows(rowsNow)
      setCanvasKeys(new Set(stored.keys ?? []))
    })

  const handleRename = (id: string, title: string) => {
    void (async () => {
      try {
        await renameSession(bffUrl, id, title)
        // The loaded session's title lives in `opened`, which drives the header —
        // update it here so the header changes now, not on the next picker open.
        setOpened(o => (o && o.row.id === id ? { ...o, row: { ...o.row, title } } : o))
        await refreshSessions()
      } catch (err) {
        log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
  }

  const handleArchive = (id: string) => {
    void (async () => {
      try {
        // NOT canvas.forget: archiving is reversible, so the canvas must survive.
        await setArchived(bffUrl, id, true)
        await refreshSessions()
      } catch (err) {
        log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
  }

  const handleDelete = (id: string) => {
    void (async () => {
      try {
        await deleteSession(bffUrl, id)
        // Only after the delete SUCCEEDS — a failed delete forgets nothing.
        await client.request('canvas.forget', { session_id: id }).catch(() => {})
        await refreshSessions()
      } catch (err) {
        log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
  }
```

Pass the props to the picker:

```tsx
        currentId={canvasKeyRef.current ?? undefined}
        onRename={handleRename}
        onArchive={handleArchive}
        onDelete={handleDelete}
```

Give the header the title (Step 7 extends this with the adopted-title fallback):

```tsx
        <CanvasHeader rev={mergedDoc?.rev} isBusy={isBusy} title={opened?.row.title} />
```

- [ ] **Step 7: Adopt a title opportunistically when the picker refetches**

A fresh session has no title until the agent assigns one and the SPA is never told. Rather than
poll, adopt it from the list the picker already fetches.

Keep it in its OWN state rather than writing it into `opened`. Setting `opened` for the bootstrap
session would silently make `canBranch` true (`opened !== null`) on a session with no turns, and
Branch would then fail with `4008 nothing to branch`.

Add beside the other `useState` declarations:

```tsx
  const [currentTitle, setCurrentTitle] = useState<string | undefined>()
```

Add to `refreshSessions`, inside the `.then`, after `setCanvasKeys`:

```tsx
      const key = canvasKeyRef.current
      const mine = key ? rowsNow.find(s => s.id === key) : undefined
      if (mine?.title) setCurrentTitle(mine.title)
```

Set it on rename too, in `handleRename` beside the `setOpened` call:

```tsx
        if (canvasKeyRef.current === id) setCurrentTitle(title)
```

and have the header prefer the opened row, falling back to the adopted title:

```tsx
        <CanvasHeader rev={mergedDoc?.rev} isBusy={isBusy} title={opened?.row.title || currentTitle} />
```

- [ ] **Step 8: Full verification**

Run: `cd apps/gis-canvas && npx vitest run && npx tsc -p . --noEmit && npx vite build`
Expected: all PASS (~460), typecheck clean, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/gis-canvas/src
git commit -m "feat(gis-canvas): session title in the header, management wiring in App"
```

---

## Manual verification

Task 2 edits `tui_gateway/server.py`, so **restart the gateway** (PowerShell recipe in
`[[gis-canvas-machine-setup]]`). Task 1 needs the BFF restarted. Then:

1. The header shows the loaded session's title, with `Situation Canvas · rev N` beneath it. A
   brand-new session reads **New session**, and adopts its real title once you open ▤ Sessions.
2. Rename a session: the row updates, and the same new name appears in the **Hermes UI** — one
   database, two views.
3. Rename the session you are in: the header changes immediately.
4. The loaded session's row shows `● current`, with Archive and Delete disabled and Rename
   enabled.
5. Archive a session: it leaves the picker, but `state.db` still has it —
   `SELECT archived FROM sessions WHERE id='<id>'` returns `1`, and
   `~/.hermes/gis_canvas/<id>.json` **still exists**. This is the guarantee that archiving is
   reversible.
6. Delete a session: confirm the prompt names it, then check the row is gone, the `state.db` row
   is gone, and `~/.hermes/gis_canvas/<id>.json` is gone.
7. Cancel a delete and confirm nothing changed.

## Known risks

- **Archived sessions cannot be restored from the canvas.** They are hidden from the picker
  (`list_sessions_rich` excludes them), so the Hermes UI is the only way back. Deliberate, and
  in the spec's non-goals.
- **`currentId` reads `canvasKeyRef.current`, a ref**, so the picker's `● current` marker updates
  only when App re-renders for some other reason. In practice opening the picker sets state and
  re-renders, so the marker is correct whenever the picker is visible.
