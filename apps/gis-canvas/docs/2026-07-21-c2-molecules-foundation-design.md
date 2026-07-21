# C2 Molecule Registry — Foundation (Sub-project 0)

**Date:** 2026-07-21
**Status:** Design approved, pending spec review
**Scope:** `apps/gis-canvas` (frontend) + `plugins/gis-canvas` (agent-facing tools/validation)

## Context

The GIS canvas lets the agent compose a UI by authoring a declarative JSON
document (`render_view` / `update_view`). Each node's `type` string maps to a
React "molecule" via `COMPONENT_REGISTRY`. We want to expand this registry
toward a Palantir-Gotham-style Command-and-Control (C2) vocabulary so the agent
can compose richer operational views.

Extracting the Gotham service-definition doc + screenshots, the C2 vocabulary
clusters into:

- **A · Entity/Object intelligence** — a selected-object inspector (properties,
  links to related entities, media, tabbed views). The Browser / Custom Object
  View / Graph "Selection" helper. The most distinctly Gotham capability.
- **B · Aggregation & temporal** — histogram/bar/pie/line charts over a grouped
  field (Object Explorer), a temporal timeline band, KPI/metric groups.
- **C · Triage & tasking** — alert/notification feed (Inbox), command/search
  bar, faceted filter stack, action toolbar. *(Not selected for this program.)*
- **D · Geospatial C2 depth** — ESRI sketch → geofence/radius/polygon spatial
  filter, layer-list, time-slider, basemap switch, heatmap renderer (Gaia).
- **E · Shell chrome** — classification marking banners, status strips, badges.

### Decisions taken during brainstorming

- **In scope for the program:** clusters **A, B, D**.
- **UI foundation:** adopt **ShadCN/Radix** (the app currently has neither; it
  uses a custom Tailwind `gc-` token system + Esri Calcite for map widgets).
- **Entity model (cluster A):** **full ontology-lite** — a typed entity/link
  data-plane abstraction (its own sub-project).
- Because ShadCN adoption + ontology-lite + charts + ESRI depth is a **program,
  not one spec**, it is decomposed into independently shippable sub-projects.
  **This document specs sub-project 0 only.**

### Program decomposition

| # | Sub-project | Depends on |
|---|---|---|
| **0** | **Foundation** — adopt ShadCN/Radix (themed to `gc-`/C2), shared primitive layer, registry-extension conventions, `tabs` vertical slice | — |
| 1 | Ontology-lite data plane + `entity-detail` molecule (cluster A) | 0 |
| 2 | Aggregation & temporal: `chart` (ShadCN/Recharts), `timeline`, KPI group (cluster B) | 0 |
| 3 | Geospatial C2 depth: ESRI sketch/geofence, layer-list, time-slider, basemap, heatmap (cluster D) | (light) |

---

## Sub-project 0: Foundation — Goals

**Goal:** stand up ShadCN/Radix inside `apps/gis-canvas`, themed so it is
indistinguishable from the existing C2 look in light *and* dark; establish a
reusable primitive layer; and prove the full registry-extension path by shipping
one new agent-authorable molecule (`tabs`).

**Non-goals (deferred to sub-projects 1–3):** the ontology-lite data plane,
`entity-detail`, charts/timeline/KPI, ESRI sketch/layer-list/time-slider/
basemap/heatmap. Foundation ships **only** the substrate + `tabs`.

**Success criteria:**

1. ShadCN primitives render themed correctly in both light and `:root.dark`,
   with no second palette and no duplicate dark-mode block.
2. The `tabs` molecule is agent-authorable end-to-end (schema → types → registry
   → catalog → validator → renders → tab switch updates `state.active`).
3. `docs/registry-extension.md` documents the convention so sub-projects 1–3 are
   mechanical.
4. `tsc --noEmit` and the full existing test suite stay green; new FE + Python
   tests cover the primitive theming and the `tabs` molecule + validator rules.

---

## Section 1 — Integration approach

Three approaches were considered:

| | Approach | Trade-off |
|---|---|---|
| **A ✅** | **Token-bridge ShadCN** — install primitives into `src/components/ui/`, but define ShadCN's semantic vars (`--background`, `--primary`, `--border`, `--ring`, `--radius`…) as thin aliases over existing `gc-` tokens via Tailwind v4 `@theme inline`, mirroring the Calcite bridge already in `index.css`. | One design language; theme-aware for free; minimal churn. More upfront token mapping. |
| B | **Vanilla ShadCN palette** — stock neutral/zinc tokens + own dark block. | Fast copy-paste, but a second palette drifting from C2, duplicated theming, inconsistent with the Calcite bridge. Rejected. |
| C | **Radix-only, no ShadCN tokens** — headless Radix styled with `gc-` classes, skipping ShadCN's token system + `ui/` convention. | Max control but rebuilds ShadCN's variants and loses copy-in ergonomics. Partial. |

**Chosen: Approach A.**

### Integration mechanics

- **Dependencies:** `class-variance-authority`, `clsx`, `tailwind-merge`, plus
  Radix packages per seeded primitive (`@radix-ui/react-tabs`,
  `@radix-ui/react-tooltip`, `@radix-ui/react-scroll-area`,
  `@radix-ui/react-separator`, `@radix-ui/react-slot`). No animation library is
  needed — the vendored primitives use no animate utilities (the app already has
  its own keyframes). These are **not** added to `vite.config.ts`
  `optimizeDeps.exclude` — only the ESRI/Polymer subtree needs excluding; Radix
  pre-bundles fine.
- **Path alias:** add `@/*` → `src/*` to **both** `tsconfig.json` (`paths`) and
  `vite.config.ts` (`resolve.alias`). It does not exist yet and ShadCN's
  generated imports assume it. Vitest reads `vite.config.ts`, so the alias
  resolves in tests too.
- **`cn()` util:** `src/lib/utils.ts` (clsx + tailwind-merge).
- **Layering:**
  - `src/components/ui/` — ShadCN/Radix primitives (low-level, **not** agent-facing).
  - `src/components/molecules/` — registry molecules composing `ui/` + data plane.
  - `src/components/atoms/` — unchanged.
- **`components.json`** committed (hand-authored to avoid a v3 `tailwind.config`)
  so future `shadcn add <x>` drops correctly-aliased, correctly-themed code.

---

## Section 2 — Theming + primitive seed set

### Theming: primitives styled on gc- utilities (no parallel token layer)

**Why not an `@theme inline` bridge:** the gc- system already defines
`--color-primary`, `--color-secondary`, and `--color-accent` (meanings: primary
text, secondary text, brand teal), which generate the utilities `text-primary`,
`bg-accent`, etc. used throughout the app. ShadCN's stock primitives reference
utilities of the **same names** with **different** meanings (`bg-primary` = brand
button, `bg-accent` = hover surface). A parallel `@theme inline` bridge under
those names would collide and reassign existing utilities app-wide — a real
breakage. (This corrects the original bridge idea after discovering the name
collision.)

**Resolution:** vendor the ShadCN/Radix primitives — their Radix structure,
`cva` variants, `data-slot` attributes, and `cn()` composition — but style their
color classes with the **existing gc- utilities**. One token system, no
collisions, and theme-awareness (light + `:root.dark`) comes for free because
gc- utilities already flip under `.dark`. Mapping used when vendoring each
primitive:

| ShadCN role | gc- utility(ies) |
|---|---|
| brand / primary | `bg-accent text-accent-fg` (hover `bg-accent/90`) |
| secondary / muted surface | `bg-surface-raised` + `text-secondary` / `text-tertiary` |
| hover/active surface (ShadCN "accent") | `bg-surface-raised` / `hover:bg-surface-raised` |
| background / foreground | `bg-surface` / `text-primary` |
| popover / card | `bg-surface-raised` / `bg-surface` |
| border / input / ring | `border-hairline` / `border-hairline-strong` / `ring-accent` |
| destructive | `bg-negative text-alert-fg` |
| radius | `rounded-gc-sm` / `rounded-gc-md` |

No new `--color-*` tokens, no `@theme inline` block, no duplicate dark-mode
block. Fonts inherit `--font-sans` / `--font-display`.
`src/components/ui/README.md` documents this restyle rule so primitives added
later via `shadcn add` (which emits stock `bg-primary` / `bg-muted` classes) are
converted to the gc- utilities above consistently.

### Primitive seed set (`src/components/ui/`)

YAGNI — only what Foundation proves + what A/B need immediately:

- **`tabs`** (Radix Tabs) — required by the vertical slice + future entity inspector.
- **`button`** (+ `buttonVariants` via cva) — baseline for toolbars/actions; validates variant theming.
- **`badge`** — row counts / classification chips; validates variant tokens.
- **`tooltip`** (Radix Tooltip) — validates portal + `--popover` theming + a11y.
- **`scroll-area`** (Radix ScrollArea) — themed scrollbars for tab panels / inspector.
- **`separator`** (Radix Separator) — structural divider.

Primitives are **not** added to `COMPONENT_REGISTRY` — they are a lower layer.
Only the `tabs` *molecule* becomes agent-facing.

---

## Section 3 — The `tabs` molecule + registry-extension convention

### Why `tabs` is the proof

The current slot model is *fixed* per type (`card` → `{content, footer}`).
`tabs` needs **dynamic, data-driven slots** — one panel per agent-declared tab —
which forces a small, reusable generalization of the validator's slot model.
The future tabbed entity inspector (sub-project 1) needs exactly this.

### Molecule shape

```jsonc
{ "id": "insp", "type": "tabs",
  "props": { "tabs": [ {"id":"overview","label":"Overview"},
                       {"id":"props","label":"Properties"} ] },
  "state": { "active": "overview" },
  "slots": { "overview": [ /* child nodes */ ],
             "props":    [ /* child nodes */ ] } }
```

- Renders on `ui/tabs` (Radix): a trigger per `props.tabs` entry (order + labels
  from that array); each `TabsContent` renders `slots[tabId].map(renderChild)`
  inside `ui/scroll-area`.
- Active tab in `state.active` (client-side, no agent turn), mirrored to canvas
  awareness so the agent knows which tab is showing.
- Optional `handlers.onChange` dispatched through the existing `HandlerContext`
  (same path `select` uses) if present — enables later agent-driven/lazy tabs
  with no new plumbing.
- Container; counts toward `MAX_DEPTH = 3`.

### Registry-extension convention (Foundation's reusable deliverable)

Committed as `docs/registry-extension.md`. Adding any molecule type touches, in
order:

1. `schema/canvas.schema.json` — add to the `type` enum.
2. `src/lib/types.ts` — add to `MOLECULE_TYPES`.
3. `validator.py` — `CATALOG` entry (container / slots / required props+bindings)
   + `STATE_KEYS` + any per-type rule.
4. `registry.tsx` — map `type → molecule` (lazy-wrap if heavy, like the ESRI ones).
5. `tools_canvas.py` `_CATALOG_HELP` — agent-facing prose + one example (the agent
   only knows types documented here).
6. molecule component in `molecules/`, composing `ui/` primitives.
7. tests — registry render, validator accept/reject, state/interaction if stateful.
8. `awareness.py` — format live state if the type carries any.

### `tabs`-specific validator changes

- `CATALOG["tabs"]`: `container: True`, **new `dynamic_slots: True`** flag,
  `required_props: ["tabs"]`, `required_bindings: []`.
- Validator slot check generalized: when `dynamic_slots` is set, any slot name is
  allowed **but** slot keys must be ⊆ `props.tabs[].id` (else a
  `"unknown slot / no matching tab"` error). Fixed-slot types keep current behavior.
- `STATE_KEYS["tabs"] = {"active"}`.
- `awareness.py` `_fmt_state` emits `active=<tabId>` for tabs.

---

## Verification strategy

- **FE unit:** `TabsMolecule` renders triggers from `props.tabs`, switches
  panels, renders slot children via a mocked `renderChild`; a `ui/` theming smoke
  test (e.g. `ui/button` carries the bridged token classes). ResizeObserver
  polyfill added to `test-setup.ts` for Radix scroll-area under jsdom.
- **Python:** `test_validator` — a valid `tabs` doc passes; a tab slot not in
  `props.tabs` ids is rejected; non-container misuse still rejected.
- **Guardrails:** `tsc --noEmit` + full existing suite green; the `@/` alias
  resolves in tsc, vite build, dev, and vitest.
- **Two-theme visual smoke route** for the primitives (light + `.dark`),
  including a primitive inside a `.gc-hud` panel to confirm the glass re-tint.
- **End-to-end:** author a fixture canvas with a `tabs` node; confirm it renders
  and tab-switch updates `state.active` (drive via the run/verify skill during
  implementation).

## Risks & mitigations

- **ShadCN CLI assumes Tailwind v3 config + emits colliding class names** — under
  v4 there is no `tailwind.config.js` (tokens live in `@theme`), and stock CLI
  output references `bg-primary`/`bg-muted`/`bg-accent` which collide with gc-
  meanings. Mitigation: hand-author `components.json` + `cn()`, **vendor**
  primitive source and restyle its color classes onto gc- utilities per
  `ui/README.md` (see Section 2); assert no v3 `tailwind.config.*` is introduced.
- **`.gc-hud` re-tint** — the shell's glass panels re-point `--color-surface` to
  transparent for descendants; primitives must fill with `bg-card` / `bg-background`
  (→ `--color-surface`) so they glass correctly inside docks/floats rather than
  painting an opaque band. Covered by the theming smoke check.
- **React 19 / jsdom Radix** — supported; ResizeObserver + portal polyfills in
  `test-setup.ts`.
- **Bundle** — Radix per-primitive is small; no material impact.

## Out of scope / follow-ups

- Sub-projects 1 (ontology-lite + `entity-detail`), 2 (charts/timeline/KPI),
  3 (ESRI C2 depth) — each its own spec → plan → build cycle.
- Cluster C (triage/tasking) and cluster E (shell chrome) — not part of this
  program; revisit if needed.
