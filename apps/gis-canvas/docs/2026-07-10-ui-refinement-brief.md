# GIS Generative Canvas — UI Refinement Brief

**Handover to Claude Design.** Prepared 2026-07-10.

---

## TL;DR

Refine the **overall visual polish & hierarchy** of a data-dense GIS analytics dashboard, pushing a
**more custom / branded** aesthetic (beyond stock ESRI Calcite) for the surrounding chrome while the
ESRI map widgets stay native. **Deliver design proposals / mockups first** (implementation is a
separate later step).

**The one thing that makes this unusual:** the UI is **generative**. An AI agent composes each
dashboard at runtime from a fixed vocabulary of components placed on a grid — no two dashboards are
identical. So this is **not "design one screen."** It is **"refine the design system + composition
rules"** so that *any* agent-authored arrangement reads as one cohesive, intentional product.

---

## 1. What the product is

**GIS Generative Canvas** is an AI-driven analytics surface. An enterprise analyst talks to an agent
(chat, in a right-hand rail) in natural language — *"discover vessel datasets"*, *"retrieve 20 rows
and show them on a map with a table"* — and the agent **declaratively authors a dashboard**: a map,
data-tables, KPI/stat tiles, and controls. A React frontend renders whatever the agent composed, and
pulls **real enterprise data** (Denodo data-virtualization layer) through a server-side broker.

- **Domain in the live demo:** maritime intelligence — AIS vessel tracking, port arrivals,
  shadow-fleet / sanctions analysis. Data is dense, tabular, and geospatial.
- **Users:** enterprise GIS / intelligence analysts on desktop. They care about clarity, density,
  trust, and fast scanning of many rows + a map at once.
- **Tone target:** serious, modern, "enterprise intelligence tool" — credible and calm, not playful.

## 2. THE key constraint — the UI is generative, not hand-designed per screen

The agent chooses **which** components to render and **where** to place them on a CSS grid
(`cols`, `rowHeight`, `gap`, and a per-component `area` = {col, colSpan, row, rowSpan}). A dashboard is
just a list of typed component nodes. Consequences for the design work:

- **Design the *vocabulary*, not a fixed composition.** Each molecule (stat, card, table, map,
  select, legend) must look polished and coherent at *arbitrary* grid sizes and positions, next to any
  other molecule.
- **Define hierarchy *rules*, not a one-off layout** — how emphasis, elevation, spacing, and color
  roles distinguish a KPI tile from a card from a data-table from the map, so a generated screen never
  looks like undifferentiated gray boxes.
- **Show the system across ≥2 representative agent-authored layouts** (e.g. the vessel dashboard
  below, plus a sparser "few stats + one table" arrangement) to prove it composes.

## 3. Component vocabulary to refine (the "molecules")

All live in `apps/gis-canvas/src/components/`. Current styling is minimal Tailwind (baseline shown so
you can see exactly what to elevate).

| Component | Role | Current look (baseline) |
|---|---|---|
| **StatMolecule** | KPI / single metric tile | `rounded-lg border border-neutral-200 bg-white p-3`; value `text-2xl font-bold`; label `text-xs uppercase tracking-wide text-neutral-500`; optional `trend` in `text-neutral-400`. Flat, no emphasis, no delta/icon treatment. |
| **CardMolecule** | Titled container w/ `content` + optional `footer` slots | `rounded-lg border border-neutral-200 bg-white`; header `border-b px-3 py-2 text-sm font-semibold`. Generic. |
| **DataTableMolecule** | Tabular rows (TanStack Table), client-side filter/select | Plain HTML table styling; the workhorse — often 20+ rows, many columns. |
| **SelectMolecule** | Control (dropdown) that reactively filters bound data | Basic select. |
| **Chat** (right rail) | Agent conversation + activity feed + input | `w-360px`, `border-l border-neutral-200 bg-neutral-50`; activity is a **mono debug-log** (`font-mono text-neutral-400 [kind] text…`), `text-xs`; input + blue `Send` button. Feels like a dev console, not a product agent panel. |
| **EsriMapMolecule / EsriFeatureTableMolecule / EsriLegendMolecule** | The map, an ESRI feature-table, and a legend | **ESRI Calcite-native components** — see constraints §6. Themable via Calcite tokens, not freely restyleable. |
| **CanvasGrid** | The grid renderer | CSS grid from `doc.layout` (cols/rowHeight≈80px/gap≈8px). |
| **App shell** | Overall frame | `grid grid-cols-[1fr_360px]`: canvas `main` on `bg-neutral-100 p-4`, Chat rail on the right. Empty state: centered *"No canvas yet — ask the agent to build a dashboard."* |

**Design tokens today** (`src/index.css`): a thin Calcite→Tailwind bridge —
`--calcite-color-brand: #4f8cff` (generic blue), `--calcite-border-radius: 8px`, plus dark-mode brand
overrides under `.calcite-mode-dark` / `:root.dark`. Tailwind v4. Palette is "shadcn-ish neutral."

## 4. Current visual state & pain points

**Current rendered state (see attached screenshot — the vessel dashboard):** a row of 4 KPI stat
tiles across the top (selected vessel, lat/long, timestamp, speed); a large world **map** on the left;
on the right an ESRI **feature-table** panel plus a small `data://…` handle/legend panel; a wide
**data-table** of 20 vessels across the bottom; the **chat rail** on the far right showing a streaming
`[message.delta]` token log. Everything is light, white cards on `neutral-100`, hairline
`neutral-200` borders.

**Pain points to fix:**
- **Flat hierarchy** — stat tiles, cards, and tables are all white-with-a-gray-border; nothing signals
  relative importance or type. A generated screen reads as uniform boxes.
- **Generic, unbranded palette** — stock blue + neutrals; no product identity, no considered accent
  system (severity, selection, positive/negative deltas, geo categories).
- **Chat panel reads as a debug console** — monospace `[kind] text` activity log rather than a
  polished agent/conversation panel with legible message + tool-activity + status states.
- **Half-baked dark mode** — dark tokens exist, but molecules hardcode `bg-white` / `neutral-200`, so
  dark mode is broken in practice.
- **Weak states** — minimal empty state; no loading/skeleton, selection, or error styling to speak of;
  KPI trends/deltas are unstyled.
- **Typographic scale is thin** — one bold size for values, tiny uppercase labels; no considered scale
  for headers, table density, numerics.

## 5. Refinement goals — this pass

**Primary focus: overall visual polish & hierarchy.** Concretely:

1. A **branded design system**: a real palette (brand + neutrals + semantic/accent roles for
   selection, severity, +/- deltas, and geospatial categories), a typographic scale (headers, body,
   dense-table, tabular-numeric), spacing/radius/elevation tokens.
2. **Distinct visual roles** so KPI tiles ≠ cards ≠ data-tables ≠ map at a glance (elevation, weight,
   accent, density) — the core of "hierarchy."
3. A **refined app shell** (canvas background, framing, the 360px agent rail) and a **redesigned chat
   / agent panel** (conversation + tool-activity + connection/status, not a mono log).
4. **Polished molecules**: KPI tile (emphasis, delta/trend, optional icon/sparkline), card headers,
   dense data-table chrome (zebra/hover/selection/sticky header, tabular numerics), controls.
5. **Cohesion across dynamic layouts** — the system must look intentional whether the agent renders 1
   tile or 12.
6. **Light + dark** both first-class (even though "custom look" is the priority, define both — dark
   mode is currently the most broken part).

**Non-goals this pass:** changing *what* components exist or the agent/data architecture; restyling the
internals of the ESRI map widgets; net-new features. This is visual-system refinement.

## 6. Constraints the design must respect

- **Coexist with ESRI Calcite.** The map, feature-table, and legend are ESRI Calcite components. They
  can be **themed via Calcite CSS tokens** (brand color, radius, dark mode) but **not** freely
  restyled. The custom/branded look therefore applies to the **surrounding chrome** (shell, stats,
  cards, tables, chat, backgrounds, type) **and the token bridge** — and must **harmonize** with the
  Calcite map, not fight it. Treat the map as a first-class citizen the rest of the UI frames.
- **Generative-safe.** Every molecule must remain a **reusable component** that looks right at any grid
  cell size/position and beside any neighbor. No design that assumes a fixed screen composition.
- **Data density is real.** Tables routinely show 20+ rows and many columns; the map + tables + stats
  share the viewport. Favor clarity and scannability over decoration.
- **Desktop-first** (1fr canvas + 360px rail). Accessibility matters: WCAG-AA contrast, visible focus
  states, colorblind-safe accents.
- **Implementation later (for context):** Tailwind CSS v4 + Calcite design tokens, React 19; all
  changes will live under `apps/gis-canvas/src/`. You do **not** need to honor this in the proposal
  stage, but proposing token-and-utility-friendly systems will make implementation smooth.

## 7. What to deliver (proposals / mockups first)

1. **2–3 distinct visual directions** for the dashboard system (e.g. "calm intelligence-console",
   "high-contrast operations", "editorial data-viz"). For each:
   - a **token system** (color roles incl. semantic/geo accents, type scale, spacing, radius,
     elevation), light **and** dark;
   - the **key molecules** designed: KPI stat tile, card, dense data-table, the agent/chat rail, and
     the canvas shell/background;
   - **hierarchy & elevation rules** that differentiate component types;
   - shown composed on **the vessel dashboard** (from the screenshot) and **one sparser layout**.
2. A **recommendation** with rationale and how it harmonizes with the ESRI Calcite map.
3. Enough spec (tokens, do/don'ts) that the winning direction can later be implemented in
   Tailwind + Calcite tokens.

## 8. Reference material to hand over alongside this brief

- **Attach the live screenshot** of the vessel dashboard (the generated map + tables + stats + chat).
  *(Best captured from the running app; described in §4.)*
- **Product/architecture context:** `apps/gis-canvas/docs/2026-07-06-phase4b-oidc-bff-design.md`
  (what the data/agent stack is) and the original canvas design doc under `apps/gis-canvas/docs/`
  (component model + theming rationale).
- **Baseline code to skim for the current look:**
  `src/index.css` (token bridge), `src/App.tsx` (shell + rail), `src/components/CanvasGrid.tsx`
  (grid), and the molecules under `src/components/molecules/` (`StatMolecule`, `CardMolecule`,
  `DataTableMolecule`, `EsriMapMolecule`, `Chat` is at `src/components/Chat.tsx`).

## 9. Success criteria

- Any agent-composed dashboard looks **intentional and cohesive**, with **clear visual hierarchy** and
  **distinct component roles** — never "uniform gray boxes."
- A **branded, modern, enterprise-serious** aesthetic that still **harmonizes** with the native ESRI
  Calcite map.
- **Light and dark** both first-class.
- **Dense, scannable, accessible** — built to compose, because the agent will compose it.
