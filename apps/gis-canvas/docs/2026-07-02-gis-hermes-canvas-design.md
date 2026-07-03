# GIS Generative Canvas on Hermes — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved design (brainstorm complete) — ready for implementation planning
- **Fork:** `laiqinghui/hermes-agent` (monorepo fork of `NousResearch/hermes-agent`)
- **Integration branch:** `gis/main`

---

## 1. Goal & non-goals

**Goal.** Use the Hermes Agent as the harness for a GIS-focused agentic application. A generative
web frontend presents a single **canvas** — a grid the Hermes agent fills *declaratively* from a
whitelisted component catalog (shadcn molecules + ESRI ArcGIS map/table/legend/chart). The agent
interprets a user request, decides how best to present the answer, and authors/updates a canvas
specification. Data is sourced from an Enterprise Data Catalog via a **Data Agent** (A2A protocol),
brokered server-side so bulk geodata never enters the LLM context.

**Non-goals (v1).**
- No agent-generated executable UI code (explicitly rejected for reliability/safety).
- No multi-user collaboration on one canvas (single-user, single-client, reconnectable).
- No modification of the Hermes agent core (keeps the fork mergeable with a fast upstream).

## 2. Locked decisions (with rationale)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Declarative view-spec** (not agent-code, not imperative UI-action tools) | Reliable, testable, rehydratable; agent authors JSON, a reconciler renders it |
| 2 | **Canonical canvas doc = server-side session state** | Rehydration, reconnect, headless render come free from Hermes |
| 3 | **Canvas = session**, single-user/single-client/reconnectable | Matches Hermes's native model (1 `AIAgent` per session); zero new concurrency machinery |
| 4 | **Hybrid awareness** | Cheap always-on `<canvas>` summary + `canvas_get_state()` + event subscriptions balances token cost vs freshness |
| 5 | **Gateway-as-broker with handles**; bulk data never in context | Token budget + reliability; browser never speaks A2A |
| 6 | **Catalog granularity = Option A** (curated molecules + shallow containers, ≤3 nesting) | Sweet spot: grouped/titled dashboards while specs stay valid & testable |
| 7 | **ESRI web components** (`@arcgis/map-components`) as the map molecule shell | Declarative shell + imperative escape hatch absorbs the map's imperative nature inside one molecule |
| 8 | **Calcite tokens themed to shadcn** | One cohesive look; ESRI widgets blend with shadcn molecules |
| 9 | **Monorepo fork, additive-only** (`apps/gis-canvas/` + `plugins/gis-canvas/`) | Conflict-free weekly merges against ~110-commit/day upstream |

## 3. Architecture / topology

```
BROWSER — Generative GIS Frontend  [BUILD: apps/gis-canvas]
  Canvas Renderer (12-col grid) ─ Component Registry (type → React component)
  Data client (fetch by handle, paged) ─ Interaction emitter
        │  WS + JSON-RPC  [REUSE]                    ▲ tool.complete carries canvas updates [REUSE]
        ▼ canvas.interaction (inbound)               │
HERMES GATEWAY (long-lived, remote-hostable, ticket/OAuth auth)  [REUSE]
  Session = Canvas (1 AIAgent)  [REUSE]
  Canonical Canvas Doc in session state (persisted)  [BUILD: schema, in plugin]
  Canvas tools + hooks + Data Broker  [BUILD: plugins/gis-canvas]
        └─ DataSource interface ──A2A/MCP──▶ Enterprise Data Agent
```

**Reused wholesale:** gateway server, WS+JSON-RPC transport, session lifecycle/persistence,
reconnect/replay, auth, agent loop, tool registry, MCP client, subagents, plugin system.

**Net-new (all additive):**
1. `apps/gis-canvas/` — new frontend workspace app (sibling to `apps/desktop`).
2. `plugins/gis-canvas/` — Hermes plugin: canvas tools, hooks, data broker, doc schema + validator.
3. Canvas document schema + validator (shared contract, generated to TS + Python).
4. Two wire flows: **outbound** rides existing `tool.complete` (no new method);
   **inbound** `canvas.interaction` (see §11 for the additive path).

## 4. Canvas document model

One versioned JSON document per session, held in server-side session state. Small by construction:
structure + live interaction state only — **never bulk data**.

```jsonc
{
  "canvasVersion": 1,
  "rev": 42,                                  // monotonic; bumped on every write (agent OR user) — stale-write guard
  "layout": { "type": "grid", "cols": 12, "rowHeight": 80, "gap": 8 },
  "components": [ /* ComponentNode[] — grid-placed, recursive */ ],
  "overlays":   [ /* ComponentNode[] — portal layer (dialog/sheet/popover/toast/command) */ ],
  "focus": "map1"                             // optional: what the agent last drew attention to
}
```

`ComponentNode` (recursive; four concern-separated fields + composition + handlers):

```jsonc
{
  "id": "tbl1",                               // stable identity — patch & binding target
  "type": "data-table",                       // MUST exist in the catalog (bare = shadcn family, esri: = ArcGIS)
  "area": { "col": 9, "colSpan": 4, "row": 1, "rowSpan": 2 },   // grid placement (top level only)
  "props":    { "title": "High-severity incidents", "density": "compact" },  // agent-authored, static
  "bindings": { "source": "data://q7f3" },    // data:// handle OR component: ref
  "state":    { "sort": [{"reported_at":"desc"}], "rowSelection": ["f_82"] },  // live, user-owned
  "children": [ /* ComponentNode[] */ ],      // for containers (grid-group, scroll-area)
  "slots":    { "content": [ /*…*/ ], "footer": [ /*…*/ ] },   // named composition (card/tabs)
  "handlers": { "onClick": { /* Handler */ } }
}
```

**Handler** — the interaction spine (reactive-by-default; agent-triggering explicit):

```jsonc
Handler =
  | { kind:"set",      target:"map1.state.selection", value:… }   // client-side state write
  | { kind:"reactive", controls:"map1.filter.severity" }         // client re-query, NO agent turn
  | { kind:"open",     overlay:"dialog1" }                        // open a portal component
  | { kind:"agent",    prompt:"…{binding refs}…" }                // triggers an agent turn (opt-in)
```

## 5. Component catalog (Option A) — the reliability contract

The catalog is a machine-readable registry present on **both** sides: the plugin validates authored
specs against it (invalid → rejected); the frontend maps `type → React component`. Each entry
declares prop schema, binding slots, owned state, and emitted interactions.

> **Key finding (from shadcn docs):** Data Table (TanStack `useReactTable`) and Form
> (TanStack Form / react-hook-form + zod) are *recipes*, not drop-in components — an LLM cannot
> assemble them. Therefore the catalog exposes **pre-built molecules**, not raw shadcn primitives.

| Tier | Members | Notes |
|------|---------|-------|
| **Molecules** (whole units) | `data-table`, `form`, `chart`, `stat`, `filter-bar`, `markdown`, `esri:map`, `esri:legend`, `esri:layer-list`, `esri:feature-table`, `esri:chart` | workhorses; each unit-tested |
| **Containers** (children/slots, ≤3 deep) | `card`, `tabs`, `accordion`, `grid-group`, `scroll-area` | recursive composition |
| **Controls** (leaf, emit events) | `button`, `select`, `slider`, `switch`, `date-range`, `badge` | handlers → reactive or agent |
| **Overlays** (portal layer) | `dialog`, `sheet`, `drawer`, `popover`, `toast`, `command` | opened via `kind:"open"` |

**Type namespace rule:** bare names (`data-table`, `card`, `button`) are the shadcn/Tailwind family
(default renderer); the `esri:` prefix denotes ArcGIS-backed components. IDs (`map1`, `tbl1`) are
instance identifiers, orthogonal to type.

Example catalog entry:
```jsonc
"data-table": {
  "props":    { "title?":"string", "density?":"compact|normal", "columns?":"string[]" },
  "bindings": { "source":"DataHandle|ComponentRef" },       // required
  "state":    { "sort":"SortSpec[]", "columnFilters":"Filter[]", "rowSelection":"id[]",
                "columnVisibility":"Record<string,bool>", "page":"int" },  // mirrors useReactTable state
  "emits":    ["rowSelection","sort","columnFilters","page"]
}
```

**Table/chart duality:** `esri:feature-table` / `esri:chart` for *spatial* (map-linked) data — native
map↔table/chart selection sync (`syncSelectionsBetweenChartAndLayerViewPolicy`); `data-table` /
`chart` for *generic* tabular data from the Data Agent.

## 6. State & the interaction loop

**Three tiers, split by owner** — the key to tractability:

| Tier | What | Owner / source of truth | In doc? |
|------|------|-------------------------|---------|
| Structural | components, layout, static props, bindings | Agent (authors via tools) | yes |
| Data | actual rows/features | Data Agent / FeatureServer | **no** — referenced by handle |
| Interaction | selection, filter values, extent, active tab, input values | User (frontend emits) | yes, in `component.state` |

**Awareness = hybrid.** Each turn a plugin hook injects a compact `<canvas>` summary
(ids/types/layout + key live state) into context; `canvas_get_state(id?)` returns detail on demand;
the agent may `subscribe` to events (e.g. `map1.selection`) that inject a message **only** when
fired.

**Interaction loop.**
```
Agent  --render_view/update_view (tool)-->  [canonical doc @ session state]  --tool.complete-->  Frontend renders
                                                    ▲
User pan/zoom/select/filter --canvas.interaction (RPC)--> patches component.state, bumps rev
```
Reactive handlers re-query the data handle client-side (no agent turn, no tokens). Agent-triggering
handlers inject a prompt. The map view's extent/zoom/selection are captured via ArcGIS view
watchers / `arcgisViewClick` + `hitTest()` and written into `component.state`.

## 7. Authoring tools (the validation gate)

Registered additively via `ctx.register_tool()` in the plugin:

- `render_view(spec)` — initialize/replace the canvas (full doc).
- `update_view(ops)` — **component-addressed patch** ops (`add`/`remove`/`replace`/`setProps`/
  `setBinding`) carrying base `rev`. Patching (not full re-emit) keeps token cost & drift low.
- `canvas_get_state(id?)` — read current doc/state.
- `data_query(dataset, where?, …)` — see §8.

**Every write is validated against the catalog JSON Schema before it touches the canvas** — unknown
type, bad prop, unknown binding, nesting past depth 3, or stale `rev` → the tool returns a structured
**error to the agent** (self-correct), never a broken render. The frontend only ever receives specs
that already passed validation. Agent→frontend delivery reuses the existing `tool.complete` event
(the `close_terminal` precedent — a tool result the frontend interprets), so no new outbound method.

## 8. Data broker & Data Agent integration

**Three planes, cleanly separated** — the invariant that makes the system scale to arbitrary data
volume:

| Plane | Carries | Lives | Sees actual rows? |
|-------|---------|-------|-------------------|
| Agent context | reasoning + `{handle, schema, rowCount, sample≤3}` | LLM context / session | No — sample only |
| Canvas document | structure + `data://handle` bindings + interaction state | session state → frontend | No — handle only |
| **Data plane** | the actual rows / features | gateway broker ↔ browser (never the agent) | **Yes** |

The Data Agent returns **either** form; the broker normalizes both into a `DataHandle`, so the upper
two planes are identical regardless of which the Data Agent gave us:

- **`DataSource` interface** (`query() → DataHandle`), protocol-agnostic (A2A-native tool vs. A2A↔MCP
  shim, deferred). A2A (Google Agent2Agent) ≠ Hermes's ACP/MCP.
- `data_query(...)` runs server-side and **always** returns to the agent only
  `{ handle, schema, rowCount, sample(≤3 rows) }` — **never bulk rows**. **Sampling is uniform:**
  - **service** case → broker samples by querying the service (`queryFeatures`, top-N);
  - **rows** case → broker samples the rows it just received.
  Either way the agent gets exactly the context it needs to formulate the spec, and nothing heavy.
- **Handle kinds:**
  - `kind:"service"` → native ArcGIS FeatureServer/MapServer URL. The `esri:map` binds it directly
    (`new FeatureLayer({ url })`) and streams from the service; gateway proxies enterprise auth.
  - `kind:"rows"` → the actual rows / GeoJSON the Data Agent returned, held in the broker cache
    (TTL'd), addressed by handle.

**Data plane — how the "actual rows" reach the frontend.** The canvas document only ever carries
`data://handle`; rows travel on a dedicated channel, parallel to (never inside) the document:
- Frontend **pulls** by handle: `canvas.data_fetch(handle, page, pageSize, filter?, fields?)` — an
  inbound gateway RPC (additive, same path as `canvas.interaction`, §11). For `kind:"rows"` it serves
  paged rows from the broker cache; for `kind:"service"` the ESRI SDK streams from the service (or
  gateway-proxied).
- The browser assembles fetched pages into the consuming molecule: a client-side
  `new FeatureLayer({ source: graphics, objectIdField, fields, geometryType, spatialReference })` /
  `new GeoJSONLayer({ url: blobUrl })` for the map, or `useReactTable` rows for `data-table`.
- **v1 policy: always pull.** The frontend always fetches rows via `canvas.data_fetch`; no
  first-page piggyback on `tool.complete`. (A small-result piggyback optimization is explicitly
  deferred — revisit only if round-trip latency proves noticeable.)

**Invariant:** rows/features appear **only** on the data plane — never in the canvas document or the
agent context, which see only handles, schema, and a ≤3-row sample. This keeps the agent's reasoning
lean and the document small while the data plane moves arbitrary volume between broker and browser.

## 9. GIS layer (ESRI ArcGIS Maps SDK for JS, v5.x)

**Packages:** `@arcgis/map-components @arcgis/core @esri/calcite-components` (+ `@arcgis/charts-components`
for `esri:chart`). ESM.

**Map molecule = declarative shell + persistent imperative core.** Render `<arcgis-map basemap
center zoom>`; obtain the view with `await el.viewOnReady()` then `el.view`; bind data imperatively
via `el.view.map.add(layer)`. **Diff into the long-lived view — never tear down/rebuild** on spec
updates. Selection via `arcgisViewClick` + `hitTest()`; extent via view watchers → `component.state`.

**Calcite theming to shadcn (doc-grounded).** Override Calcite CSS variables from the shadcn token
layer, e.g.:
```css
body            { --calcite-color-brand: <shadcn --primary>; --calcite-border-radius: <shadcn --radius>; … }
body.calcite-mode-dark { --calcite-color-brand: <shadcn --primary dark>; … }
```
Driven by `ui-ux-pro-max:design-system` (primitive→semantic→component tokens). **Maintenance note:**
re-verify token mappings on ArcGIS/Calcite upgrades.

**Build / runtime constraints.**
- `@arcgis/core` is multi-MB → **lazy-load the map molecule** (dynamic `import()` / `React.lazy`).
- Assets: set `esriConfig.assetsPath` (copy `@arcgis/core/assets` locally) **or** use the CDN
  (`https://js.arcgis.com/5.x/`). API key via `esriConfig.apiKey` (gateway-proxied for enterprise).
- **CSP:** the GIS frontend is a **first-class app, not a sandboxed chat embed** — it needs live
  network access to basemaps/tiles/services + web workers + wasm. CSP must allow the ArcGIS
  CDN/services. (Reinforces §3: the canvas *is* the app.)

## 10. Frontend app (`apps/gis-canvas`)

- New workspace app (root `"apps/*"` glob auto-discovers — **no root edit**). Depends on
  `@hermes/shared` (`workspace:*`) for the gateway JSON-RPC client + shared types.
- Stack: React 19 + Vite + Tailwind + shadcn/ui + `@arcgis/map-components`/`@arcgis/core`
  (lazy) + `@esri/calcite-components`. TanStack Table/Form for the data-table/form molecules.
- Build with **`ui-ux-pro-max`** skills: `design-system` for the shared token layer + Calcite↔shadcn
  theming; `ui-styling` (has a shadcn/ui MCP) for molecule components.
- **Deps pinned in this app's `package.json`, never root.**
- Connects to the gateway over WS+JSON-RPC (same client the desktop/web apps use); handles
  `tool.complete` canvas updates and emits `canvas.interaction`.

## 11. Backend plugin (`plugins/gis-canvas`) & extension points

Packaged as a Hermes plugin (`register(ctx)`), loaded additively:
- **Tools** via `ctx.register_tool()` — `render_view`, `update_view`, `canvas_get_state`, `data_query`.
- **Hooks** via `ctx.register_hook()` — inject the `<canvas>` awareness summary each turn; handle
  inbound `canvas.interaction`.
- **Data broker / DataSource / DataHandle cache** — plain modules inside the plugin.

**The one core-edit contingency.** Gateway JSON-RPC methods live in a `@method()` dict in the shared
`tui_gateway/server.py` (not plugin-extensible). The inbound `canvas.interaction` method:
1. **Preferred:** register a `pre_gateway_dispatch` hook that short-circuits and handles it — *verify
   the hook can return/short-circuit and that the gateway process loads plugins.*
2. **Fallback:** a single comment-fenced line in `server.py`
   (`# >>> gis-canvas <<<` … `# <<< gis-canvas >>>`) that registers our handler module. Trivial to
   re-apply on merge conflict.

## 12. Repo / branching / upstream-sync strategy

**Remotes (wired):** `origin` = `laiqinghui/hermes-agent` (fork); `upstream` =
`NousResearch/hermes-agent` (fetch-only, push disabled).

**Branches:** `main` = pristine mirror of `upstream/main` (never commit); `gis/main` = integration
branch (all work); `gis/<feature>` = short-lived feature branches off `gis/main`.

**Weekly sync (validated live — was 594 commits behind in 2 days):**
```
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout gis/main && git merge main        # merge, never rebase the long-lived branch
# resolve (near-zero), test, commit
```

**Conflict-minimization discipline:** all code in `apps/gis-canvas/` + `plugins/gis-canvas/`; no
core-registration edits (auto-discovery); deps pinned in app package.json; commit prefix `gis:`; any
unavoidable core edit is single-line comment-fenced. **Optional later:** a weekly GitHub Action that
merges `upstream/main` into a throwaway branch and runs tests as an early-warning.

## 13. Build phasing

1. **Skeleton canvas** — doc schema + validator, the 3 canvas tools, session-state doc + `tool.complete`
   delivery, minimal renderer with `card`/`stat`/`data-table` on mock data. Proves the declarative loop
   end-to-end.
2. **Interaction loop** — inbound `canvas.interaction`, reactive handlers, hybrid awareness summary +
   subscriptions.
3. **GIS layer** — `esri:map` (lazy), `esri:feature-table`/`legend`/`layer-list`, Calcite theming,
   CSP/assets, API-key proxy.
4. **Data broker** — `DataSource` + `DataHandle` + cache/paging; wire the real A2A/MCP Data Agent adapter.
5. **Harden** — full catalog, validation edge cases, reconnect/rehydration + headless-render tests.

Each phase is independently demoable and testable; none touches the agent core.

## 14. Testing strategy

- **Schema/validator:** unit tests for every catalog entry; property-based tests that invalid specs
  are rejected with structured errors (never rendered).
- **Molecules:** component tests per molecule (props/bindings/state → render); the `esri:map` molecule
  gets diff-not-rebuild tests (spec change mutates the existing view).
- **Interaction loop:** reactive handler = no agent turn; agent handler = injects prompt;
  `canvas.interaction` patches state + bumps `rev`; stale-`rev` writes rejected.
- **Rehydration/reconnect:** persist doc → reconnect via `session.resume` → identical render; headless
  render of a saved doc.
- **Data broker:** bulk rows never appear in agent-visible tool results (assert only schema/sample/handle).

## 15. Open / deferred decisions

- A2A transport specifics (native A2A client tool vs A2A↔MCP shim) — decide in Phase 4 behind
  `DataSource`.
- `pre_gateway_dispatch` short-circuit capability + whether the gateway process loads plugins —
  verify in Phase 2 (determines §11 preferred vs fallback).
- Enterprise Data Agent's concrete A2A return contract (normalized to `DataHandle` regardless).

## 16. Key Hermes files (verified)

- Frontend chat UI precedents: `apps/desktop/` (React19+Electron+Vite, `@assistant-ui`); `web/` (dashboard);
  streaming switch `apps/desktop/src/app/session/hooks/use-message-stream.ts`; embeds seam
  `apps/desktop/src/components/assistant-ui/embeds/registry.tsx`; message parts
  `apps/desktop/src/lib/chat-messages.ts`.
- Gateway: `tui_gateway/ws.py`, `tui_gateway/server.py` (`_sessions` registry, `@method()` dispatch dict),
  `gateway/run.py`; persistence/reconnect `hermes_state.py` (`session.resume`).
- Tools: `tools/registry.py` (`register()`, AST auto-discovery; `close_terminal` = UI-event tool precedent);
  `model_tools.py`; MCP client `tools/mcp_tool.py`; subagents `tools/delegate_tool.py`.
- Plugins: `hermes_cli/plugins.py` (`PluginContext`: `register_tool`/`register_skill`/`register_hook`/…).
- Workspace: root `package.json` (`"apps/*"` glob); `apps/shared` (`@hermes/shared`).

## 17. References (docs pulled via context7)

- ArcGIS Maps SDK for JS `/websites/developers_arcgis_javascript` — `arcgisViewReadyChange`/`viewOnReady`,
  `view.map.add`, `arcgisViewClick`+`hitTest`, `esriConfig.assetsPath`/`apiKey`, `FeatureLayer({source})`,
  `GeoJSONLayer` blob URL, Calcite `--calcite-color-*` theming, chart↔map selection sync.
- shadcn/ui `/shadcn-ui/ui` — Data Table (`useReactTable` state), Form (TanStack Form / react-hook-form + zod).
- Component catalog basis: https://ui.shadcn.com/docs/components.

## 18. Phase 3 backlog (carried from Phase 2 final review — non-blocking polish)

Fold these into the Phase 3 plan (they are small hardening/clarity items, none blocking):

1. **Per-kind handler schema validation.** `canvas.schema.json` currently requires only `handlers.<event>.kind`.
   Add JSON-Schema `if/then` per kind so `render_view` rejects malformed handlers with a structured,
   agent-correctable error: `reactive` requires `controls` (string); `set` requires `target`+`key`;
   `agent` requires `prompt`; `open` requires `overlay`. Prevents the current silent client-side no-op on a
   malformed `controls` path (`handlers.ts` reactive branch).
2. **`open` handler kind.** The schema enum already permits `open`, but there is no runtime path (overlays
   are Phase 3). When Phase 3 lands the overlay layer, implement `open` in `runHandler` + the renderer;
   until then either drop `open` from the enum or leave a `// reserved for Phase 3 overlays` marker so the
   schema doesn't advertise a kind the client silently ignores.
3. **Client/server `rev` divergence comment.** `useCanvasDoc` refreshes `doc` only on `tool.complete`;
   `canvas.interaction` bumps the *server* rev without advancing the client `doc.rev` (by design — this is
   why the `useEffect([doc?.rev])` override-reset does NOT wipe optimistic overlays on interaction). Add a
   one-line comment at both sites so a future maintainer doesn't "fix" the mismatch and break the overlay
   lifecycle.
4. **`merge.ts` shared-state note.** An un-overridden node shares the server doc's `state` object by
   reference (safe today — nothing mutates `node.state` in place). Add a one-line comment; if any future
   molecule mutates state in place, switch to a defensive clone.

## 19. Phase 3 run notes / known issues (ESRI + Vite dev)

- **Map demo runs via a production preview, not the dev server.** `@arcgis/core`'s ESM trips Vite's
  dev-server transform of its lazily-imported modules ("Unexpected token '(' " from `loadEsri()`;
  reproduced cold, independent of `optimizeDeps include/exclude`). The **production build works
  perfectly** (rollup handles it): map + OSM basemap + client-side incident layer + legend render with
  zero console errors. Run the GIS canvas with:
  `VITE_HERMES_TOKEN=dev-gis-local npm run -w @hermes/gis-canvas build && (cd apps/gis-canvas && npx vite preview --port 5174 --host 127.0.0.1)`.
  Non-map components (Phases 1-2) still work under `npm run dev`.
- **Phase 3 follow-up:** get `@arcgis/core` working under `npm run dev` (candidate approaches: a custom
  esbuild dep-optimizer target, `@arcgis/create`'s Vite template config, or serving ESRI assets/workers
  locally via `setAssetPath` to a copied `@arcgis/core/assets`). Non-blocking — the feature is verified
  via preview.
- **assetsPath:** `loadEsri()` sets `esriConfig.assetsPath` to the versioned ArcGIS CDN (keyless) so
  client-side `FeatureLayer` feature-processing workers load. Bump the version on `@arcgis/core` upgrades.
