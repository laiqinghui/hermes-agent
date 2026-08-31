# Analysis-Product Canvas (SP-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the GIS canvas somewhere to put analysis — prose judgments and agent-computed tables — so a finished investigation renders as an intelligence product instead of a source-data review.

**Architecture:** Two new expression primitives plus a guidance rewrite. A `note` component renders a safe markdown subset through a small in-house parser that emits React elements (never `innerHTML`). `data-table` gains an inline `props.rows` path that is used only when `bindings.source` is absent. The `render_view` tool description is rewritten to hero the answer rather than the data, and its absolute "NEVER inline data rows" rule is narrowed to retrieved rows only.

**Tech Stack:** React 19 + TypeScript + Vitest + Testing Library (frontend, `apps/gis-canvas`); Python 3.11 + pytest + jsonschema (plugin, `plugins/gis-canvas`).

**Design:** `apps/gis-canvas/docs/2026-08-31-analysis-product-canvas-design.md`

## Global Constraints

- **No new npm dependencies.** The markdown renderer is written in-repo. This app has documented bundling failures with transitive deps (the `@polymer` / `@vaadin` Rolldown exclusions in `vite.config.ts`).
- **Never use `dangerouslySetInnerHTML`.** All markdown output is React elements; escaping must be structural, because the input is model-authored.
- **Markdown subset is exactly:** `#`–`###`, paragraphs, `**bold**`, `*italic*`, `` `code` ``, unordered lists (`-`/`*`), ordered lists (`1.`), horizontal rule (`---`). No links, images, raw HTML, or tables.
- **Inline row cap: 50.** Enforced in the plugin validator. `render_view` echoes the full doc back into agent context, so this is a context-budget limit, not a display limit.
- **`bindings.source` always wins** over `props.rows` when both are present. Existing behaviour must not change.
- **Frontend tests run from the workspace:** `npm test --workspace @hermes/gis-canvas`. Running `vitest` from the repo root loads the wrong config and fails with `document is not defined`.
- **Python is `./.venv/Scripts/python.exe`** (Windows). Bare `python` is not on PATH.
- Tailwind tokens available: `text-primary`, `text-secondary`, `text-tertiary`, `text-negative`, `text-positive`, `bg-surface`, `bg-surface-raised`, `border-hairline`, `rounded-gc-md`, `shadow-gc-raised`.

---

### Task 1: Markdown subset renderer

**Files:**
- Create: `apps/gis-canvas/src/lib/markdown.ts`
- Test: `apps/gis-canvas/src/lib/markdown.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `renderMarkdown(src: string): ReactNode[]` and `renderInline(text: string, keyPrefix: string): ReactNode[]`. Task 2 calls `renderMarkdown`.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/markdown.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderMarkdown } from './markdown'

function md(src: string) {
  return render(<div data-testid="md">{renderMarkdown(src)}</div>)
}

describe('renderMarkdown', () => {
  it('renders headings h1-h3', () => {
    md('# One\n## Two\n### Three')
    expect(screen.getByText('One').tagName).toBe('H1')
    expect(screen.getByText('Two').tagName).toBe('H2')
    expect(screen.getByText('Three').tagName).toBe('H3')
  })

  it('renders paragraphs, joining wrapped lines', () => {
    md('alpha\nbravo\n\ncharlie')
    expect(screen.getByText('alpha bravo').tagName).toBe('P')
    expect(screen.getByText('charlie').tagName).toBe('P')
  })

  it('renders bold, italic and inline code', () => {
    md('a **bold** b *ital* c `code` d')
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('ital').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('renders unordered and ordered lists', () => {
    const { container } = md('- one\n- two\n\n1. first\n2. second')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(screen.getByText('one').tagName).toBe('LI')
  })

  it('renders a horizontal rule', () => {
    const { container } = md('a\n\n---\n\nb')
    expect(container.querySelectorAll('hr')).toHaveLength(1)
  })

  it('renders raw HTML as literal text, never as elements', () => {
    const { container } = md('<script>alert(1)</script>\n\n<b>x</b>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('<b>x</b>')
  })

  it('leaves unmatched emphasis markers as text', () => {
    const { container } = md('2 * 3 * 4 and ** unclosed')
    expect(container.querySelector('strong')).toBeNull()
    expect(container.textContent).toContain('** unclosed')
  })

  it('returns nothing for empty input', () => {
    const { container } = md('')
    expect(container.querySelector('[data-testid="md"]')?.children).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @hermes/gis-canvas -- src/lib/markdown.test.tsx`
Expected: FAIL — `Failed to resolve import "./markdown"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/gis-canvas/src/lib/markdown.ts`:

```ts
/**
 * Minimal, dependency-free markdown renderer for agent-authored `note` bodies.
 *
 * Emits React elements only — never dangerouslySetInnerHTML — so any HTML in the
 * source is escaped structurally by React rather than by a sanitizer we would have
 * to trust with model-written text. Supported subset: h1-h3, paragraphs, bold,
 * italic, inline code, ordered/unordered lists, horizontal rule. Links, images,
 * raw HTML and tables are deliberately unsupported (tables belong in a data-table
 * with props.rows; omitting links keeps javascript: URLs out entirely).
 */
import { createElement, type ReactNode } from 'react'

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g
const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const ORDERED = /^\s*\d+\.\s+(.*)$/
const RULE = /^\s*-{3,}\s*$/

const H_CLASS: Record<number, string> = {
  1: 'mt-1 mb-2 font-display text-base font-semibold text-primary',
  2: 'mt-3 mb-1.5 font-display text-sm font-semibold text-primary',
  3: 'mt-2 mb-1 font-display text-[13px] font-semibold text-secondary'
}

export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${n++}`
    if (tok.startsWith('`')) {
      out.push(createElement('code', { key, className: 'rounded bg-surface-raised px-1 font-mono text-[0.9em]' }, tok.slice(1, -1)))
    } else if (tok.startsWith('**')) {
      out.push(createElement('strong', { key, className: 'font-semibold text-primary' }, tok.slice(2, -2)))
    } else {
      out.push(createElement('em', { key }, tok.slice(1, -1)))
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdown(src: string): ReactNode[] {
  const lines = (src ?? '').split('\n')
  const out: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (!para.length) return
    const key = `p-${k++}`
    out.push(createElement('p', { key, className: 'mb-2' }, renderInline(para.join(' '), key)))
    para = []
  }
  const flushList = () => {
    if (!list) return
    const key = `l-${k++}`
    const items = list.items.map((t, i) =>
      createElement('li', { key: `${key}-${i}`, className: 'mb-0.5' }, renderInline(t, `${key}-${i}`))
    )
    out.push(createElement(list.ordered ? 'ol' : 'ul', {
      key, className: list.ordered ? 'mb-2 list-decimal pl-5' : 'mb-2 list-disc pl-5'
    }, items))
    list = null
  }
  const flush = () => { flushPara(); flushList() }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }

    const h = HEADING.exec(line)
    if (h) {
      flush()
      const key = `h-${k++}`
      out.push(createElement(`h${h[1].length}`, { key, className: H_CLASS[h[1].length] }, renderInline(h[2], key)))
      continue
    }

    // checked before BULLET: '---' has no space after the dash so it cannot match a bullet
    if (RULE.test(line)) {
      flush()
      out.push(createElement('hr', { key: `hr-${k++}`, className: 'my-3 border-hairline' }))
      continue
    }

    const b = BULLET.exec(line)
    if (b) {
      flushPara()
      if (list?.ordered) flushList()
      if (!list) list = { ordered: false, items: [] }
      list.items.push(b[1])
      continue
    }

    const o = ORDERED.exec(line)
    if (o) {
      flushPara()
      if (list && !list.ordered) flushList()
      if (!list) list = { ordered: true, items: [] }
      list.items.push(o[1])
      continue
    }

    flushList()
    para.push(line.trim())
  }
  flush()
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @hermes/gis-canvas -- src/lib/markdown.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/markdown.ts apps/gis-canvas/src/lib/markdown.test.tsx
git commit -m "feat(gis-canvas): dependency-free markdown subset renderer for note bodies"
```

---

### Task 2: `NoteMolecule` + registry

**Files:**
- Create: `apps/gis-canvas/src/components/molecules/NoteMolecule.tsx`
- Create: `apps/gis-canvas/src/components/molecules/NoteMolecule.test.tsx`
- Modify: `apps/gis-canvas/src/components/registry.tsx` (import, and `COMPONENT_REGISTRY` at lines 67-79)

**Interfaces:**
- Consumes: `renderMarkdown` from Task 1.
- Produces: component type `note` in `COMPONENT_REGISTRY`, reading `props.title` (optional) and `props.body` (string).

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/components/molecules/NoteMolecule.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteMolecule } from './NoteMolecule'
import { COMPONENT_REGISTRY } from '../registry'

const noop = () => null

describe('NoteMolecule', () => {
  it('renders the title and the markdown body', () => {
    render(<NoteMolecule node={{ id: 'n1', type: 'note',
      props: { title: 'Key judgments', body: '## AGNI\n**148-day** silence' } } as any} renderChild={noop} />)
    expect(screen.getByText('Key judgments')).toBeInTheDocument()
    expect(screen.getByText('AGNI').tagName).toBe('H2')
    expect(screen.getByText('148-day').tagName).toBe('STRONG')
  })

  it('renders without a title', () => {
    render(<NoteMolecule node={{ id: 'n2', type: 'note', props: { body: 'plain' } } as any} renderChild={noop} />)
    expect(screen.getByText('plain')).toBeInTheDocument()
  })

  it('does not crash when body is missing', () => {
    render(<NoteMolecule node={{ id: 'n3', type: 'note', props: { title: 'Empty' } } as any} renderChild={noop} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('is registered as the "note" component type', () => {
    expect(COMPONENT_REGISTRY['note']).toBe(NoteMolecule)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @hermes/gis-canvas -- src/components/molecules/NoteMolecule.test.tsx`
Expected: FAIL — `Failed to resolve import "./NoteMolecule"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/gis-canvas/src/components/molecules/NoteMolecule.tsx`:

```tsx
import type { MoleculeProps } from '../registry'
import { renderMarkdown } from '../../lib/markdown'

/** Agent-authored prose: key judgments, prioritization, caveats. The canvas's only
 *  way to show analysis rather than retrieved data. */
export function NoteMolecule({ node }: MoleculeProps) {
  const { title, body } = (node.props ?? {}) as { title?: string; body?: string }
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
      {title ? (
        <div className="shrink-0 truncate border-b border-hairline px-3 py-2 font-display text-sm font-semibold text-primary">
          {title}
        </div>
      ) : null}
      <div data-molecule="note" className="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm leading-relaxed text-secondary">
        {renderMarkdown(body ?? '')}
      </div>
    </div>
  )
}
```

In `apps/gis-canvas/src/components/registry.tsx`, add the import alongside the other molecule imports:

```tsx
import { NoteMolecule } from './molecules/NoteMolecule'
```

and add one entry to `COMPONENT_REGISTRY` (after the `stat` line):

```tsx
  note: NoteMolecule,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @hermes/gis-canvas -- src/components/molecules/NoteMolecule.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/NoteMolecule.tsx apps/gis-canvas/src/components/molecules/NoteMolecule.test.tsx apps/gis-canvas/src/components/registry.tsx
git commit -m "feat(gis-canvas): note molecule renders agent-authored analysis prose"
```

---

### Task 3: Accept `note` in the schema and validator

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json` (component `type` enum, line 72)
- Modify: `plugins/gis-canvas/validator.py` (`CATALOG` ends line 75; `STATE_KEYS` ends line 91)
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `note` is a valid component type; `CATALOG["note"]["required_props"] == ["body"]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_note_component_accepted(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "kj", "type": "note", "layer": "base",
        "props": {"title": "Key judgments", "body": "## AGNI\n**148-day** silence"},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_note_requires_body(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "kj", "type": "note", "layer": "base", "props": {"title": "No body"},
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("body" in e for e in errors)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_validator.py -k note -v`
Expected: FAIL — schema error `'note' is not one of [...]`.

- [ ] **Step 3: Write minimal implementation**

In `plugins/gis-canvas/schema/canvas.schema.json`, add `"note"` to the `type` enum so it reads:

```json
"type": { "enum": ["card", "stat", "note", "data-table", "select", "tabs", "esri:map", "esri:legend", "esri:layer-list", "esri:time-slider", "entity-detail", "esri:feature-table"] },
```

In `plugins/gis-canvas/validator.py`, add to `CATALOG` after the `stat` entry:

```python
    "note": {
        "container": False,
        "slots": set(),
        "required_props": ["body"],
        "required_bindings": [],
    },
```

and add to `STATE_KEYS` after the `stat` entry (documentary — `interaction.py:32` reads
`STATE_KEYS.get(type, set())`, so a note has no user-owned state either way):

```python
    "note": set(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_validator.py -k note -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): accept note components in schema and validator"
```

---

### Task 4: `data-table` inline rows (frontend)

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx` (the `fetched`/`data` block, lines ~28-53)
- Test: `apps/gis-canvas/src/components/molecules/DataTableMolecule.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `data-table` renders `props.rows` when `bindings.source` is absent. Optional `props.schema` of `{name, type}` overrides inference.

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `apps/gis-canvas/src/components/molecules/DataTableMolecule.test.tsx`:

```tsx
describe('DataTableMolecule inline rows', () => {
  it('renders agent-authored rows with no data handle', async () => {
    const fetchData = vi.fn()
    renderWith({ id: 'g1', type: 'data-table', props: {
      title: 'AIS gaps',
      rows: [{ vessel: 'AGNI', days: 148 }, { vessel: 'TREND', days: 35.1 }]
    } }, fetchData)
    await waitFor(() => expect(screen.getByText('AGNI')).toBeInTheDocument())
    expect(screen.getByText('TREND')).toBeInTheDocument()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
    expect(fetchData).not.toHaveBeenCalled()
  })

  it('infers numeric columns from the first inline row', async () => {
    const fetchData = vi.fn()
    const { container } = renderWith({ id: 'g2', type: 'data-table', props: {
      rows: [{ vessel: 'AGNI', days: 148 }]
    } }, fetchData)
    await waitFor(() => expect(screen.getByText('AGNI')).toBeInTheDocument())
    const headers = [...container.querySelectorAll('th')].map(h => h.textContent)
    expect(headers).toContain('days')
    expect(container.querySelector('th.text-right')?.textContent).toBe('days')
  })

  it('prefers bindings.source over inline rows when both are present', async () => {
    const fetchData = vi.fn().mockResolvedValue(page)
    renderWith({ id: 'g3', type: 'data-table',
      bindings: { source: 'data://ab12' },
      props: { rows: [{ vessel: 'SHOULD-NOT-RENDER' }] } }, fetchData)
    await waitFor(() => expect(screen.getByText('x1')).toBeInTheDocument())
    expect(screen.queryByText('SHOULD-NOT-RENDER')).not.toBeInTheDocument()
    expect(fetchData).toHaveBeenCalledWith('data://ab12', expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @hermes/gis-canvas -- src/components/molecules/DataTableMolecule.test.tsx`
Expected: FAIL — the first two tests time out in `waitFor` because nothing renders (`data` is `null`, so the "Unknown data source" branch shows).

- [ ] **Step 3: Write minimal implementation**

In `apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx`, add this helper just above the component:

```tsx
/** Rows the agent computed itself (gap windows, rankings): no data:// handle exists
 *  for them, and bindings only carries strings, so they travel in props.rows. */
function inlineSource(props: Record<string, unknown> | undefined): MockSource | null {
  const rows = props?.rows as Array<Record<string, string | number>> | undefined
  if (!Array.isArray(rows) || rows.length === 0) return null
  const declared = props?.schema as MockField[] | undefined
  const schema = declared ?? Object.keys(rows[0]).map(name => ({
    name,
    type: typeof rows[0][name] === 'number' ? 'number' : 'string'
  })) as MockField[]
  return { schema, rows }
}
```

Then replace the `data` line (currently `const data = isDataHandle(source) ? fetched : resolveMockSource(source)`) with:

```tsx
  const inline = useMemo(() => inlineSource(node.props), [node.props])
  // bindings.source always wins; inline rows are the fallback for agent-computed tables
  const data = isDataHandle(source) ? fetched : (source ? resolveMockSource(source) : inline)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @hermes/gis-canvas -- src/components/molecules/DataTableMolecule.test.tsx`
Expected: PASS, 10 tests (7 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx apps/gis-canvas/src/components/molecules/DataTableMolecule.test.tsx
git commit -m "feat(gis-canvas): data-table renders agent-authored inline rows"
```

---

### Task 5: Validate inline rows (plugin)

**Files:**
- Modify: `plugins/gis-canvas/validator.py` (`CATALOG["data-table"]` lines 32-37; per-node checks inside `walk()` after the `required_bindings` loop, ~line 127)
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: nothing.
- Produces: module constant `MAX_INLINE_ROWS = 50`; a `data-table` is valid with `bindings.source` **or** `props.rows`, and invalid with neither.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_data_table_accepts_inline_rows_without_source(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "gaps", "type": "data-table", "layer": "base",
        "props": {"title": "AIS gaps", "rows": [{"vessel": "AGNI", "days": 148}]},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_data_table_requires_source_or_rows(plugin):
    doc = _minimal_doc()
    doc["components"].append({"id": "empty", "type": "data-table", "layer": "base", "props": {}})
    errors = plugin.validator.validate_doc(doc)
    assert any("source" in e and "rows" in e for e in errors)


def test_data_table_inline_rows_capped(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "big", "type": "data-table", "layer": "base",
        "props": {"rows": [{"i": n} for n in range(plugin.validator.MAX_INLINE_ROWS + 1)]},
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("50" in e for e in errors)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_validator.py -k "inline or source_or_rows" -v`
Expected: FAIL — first test reports `missing required bindings.source`; third fails with `AttributeError: MAX_INLINE_ROWS`.

- [ ] **Step 3: Write minimal implementation**

In `plugins/gis-canvas/validator.py`, add near the other module constants (above `CATALOG`):

```python
# render_view echoes the whole doc back into the agent's context, so agent-authored
# rows are capped for context budget, not for display.
MAX_INLINE_ROWS = 50
```

Change `CATALOG["data-table"]` so the binding is no longer unconditionally required:

```python
    "data-table": {
        "container": False,
        "slots": set(),
        "required_props": [],
        "required_bindings": [],  # needs bindings.source OR props.rows -- checked in walk()
    },
```

Inside `walk()`, immediately after the `for b in entry["required_bindings"]:` loop, add:

```python
        if node_type == "data-table":
            rows = props.get("rows")
            if "source" not in bindings and rows is None:
                errors.append(
                    f"'{node_id}' (data-table): needs bindings.source (retrieved data) "
                    "or props.rows (rows you derived yourself)"
                )
            if isinstance(rows, list) and len(rows) > MAX_INLINE_ROWS:
                errors.append(
                    f"'{node_id}' (data-table): {len(rows)} inline rows exceeds max "
                    f"{MAX_INLINE_ROWS}; retrieve large results via data_query instead"
                )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q`
Expected: PASS, 139 tests (134 existing + 2 from Task 3 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): validate inline data-table rows with a 50-row cap"
```

---

### Task 6: Rewrite the agent guidance

**Files:**
- Modify: `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP` lines 123-148; `RENDER_VIEW_SCHEMA` COMPOSITION block lines 259-273)
- Test: `tests/plugins/gis_canvas/test_tools.py` (this file covers `tools_canvas`; `test_data_tools.py` covers `tools_data`)

**Interfaces:**
- Consumes: component types from Tasks 3 and 5.
- Produces: no code interface — this is the model-facing prompt.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_tools.py`:

```python
def test_catalog_help_no_longer_forbids_all_inline_rows(plugin):
    """The absolute ban contradicted props.rows; it must stay narrowed to RETRIEVED rows."""
    help_text = plugin.tools_canvas._CATALOG_HELP
    assert "NEVER inline data rows" not in help_text
    assert "props.rows" in help_text


def test_catalog_help_documents_the_note_component(plugin):
    assert "note" in plugin.tools_canvas._CATALOG_HELP


def test_render_view_guidance_leads_with_analysis(plugin):
    desc = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"]
    assert "ANALYSIS PRODUCT" in desc
    # the old rule told the agent to hero the DATA -- that caused source-data-review canvases
    assert "for a tabular-only result make the main data-table the layer:'base'" not in desc
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_tools.py -k "catalog_help or guidance" -v`
Expected: FAIL — `"NEVER inline data rows" not in help_text` assertion fails.

- [ ] **Step 3: Write minimal implementation**

In `_CATALOG_HELP`, replace the sentence on line 132:

```
"depth max 3. NEVER inline data rows — bind data via bindings.source handles only. "
```

with:

```python
    "depth max 3. Never inline RETRIEVED rows — bulk data stays on the data plane behind a "
    "'data://' handle. DO inline rows you DERIVED yourself (gap windows, rankings, computed "
    "summaries) via props.rows: they have no handle and are small (max 50 rows). "
```

In the same string, extend the `data-table` catalog entry (line 127-129) to mention the new prop, and add `note` after the `stat` entry:

```python
    "note (props.title optional, props.body markdown: #/##/### headings, **bold**, *italic*, "
    "`code`, - bullets, 1. numbered, --- rule; NO links/images/tables — put tables in a "
    "data-table with props.rows). Use note for judgments, rankings, recommendations and caveats | "
```

In `RENDER_VIEW_SCHEMA["description"]`, replace the block that currently begins
`" COMPOSITION (Command-and-Control): ALWAYS call render_view"` and ends
`"...or a plain area grid for equal tiles."` with:

```python
        " ANALYSIS PRODUCT (what the canvas is FOR): the canvas is your deliverable, not a "
        "data dump — it must ANSWER the user's question, not display what you retrieved. "
        "ALWAYS call render_view. Put the ANSWER at layer:'base': a note with your key "
        "judgments and/or a data-table of the findings you computed — NOT the raw retrieved "
        "table. Everything you would write in a chat answer (judgments, rankings, "
        "recommendations, caveats) belongs on the canvas as note components; if it is worth "
        "telling the user, it is worth rendering. Tables you COMPUTED go in props.rows; "
        "tables you RETRIEVED stay bound to their data:// handle. Demote source data to "
        "layer:'dock' or a tabs rail — never render a source table merely because you "
        "retrieved it. When the analysis has limitations, carry them in their own note. "
        "Hero a map at layer:'base' only when the geography IS the answer. "
        "Briefing example: {canvasVersion:1, layout:{type:'grid',cols:12}, components:[ "
        "{id:'kj', type:'note', layer:'base', props:{title:'Key judgments', "
        "body:'## Highest-value tasking windows\\n1. **AGNI** 2025-06-25 to 2025-11-20 — "
        "148-day silence.\\n2. **CLYDE NOBLE** — 111.8-day silence plus MMSI change.'}}, "
        "{id:'gaps', type:'data-table', layer:'dock', edge:'bottom', size:{w:100,h:34}, "
        "props:{title:'AIS gaps & tasking windows', rows:[{vessel:'AGNI', gap:'A', "
        "last_ais:'2025-06-25T20:22Z', first_ais:'2025-11-20T19:37Z', days:148.0, "
        "mmsi_change:'no'}]}}, {id:'cav', type:'note', layer:'dock', edge:'right', "
        "size:{w:26,h:100}, props:{title:'Caveats', body:'AIS gaps show absence of returned "
        "observations, not proof of deliberate disablement.'}}, "
        "{id:'src', type:'tabs', layer:'dock', edge:'top', size:{w:100,h:22}, "
        "props:{tabs:[{id:'sus',label:'Suspects'},{id:'cov',label:'AIS coverage'}]}, "
        "state:{active:'sus'}, slots:{sus:[{id:'t1', type:'data-table', "
        "bindings:{source:'data://<suspects>'}}], cov:[{id:'t2', type:'data-table', "
        "bindings:{source:'data://<coverage>'}}]}} ]} — judgments lead, computed findings "
        "support them, retrieved source data sits behind a rail. "
```

Leave the `LAYOUT & REAL-ESTATE` block that follows unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q`
Expected: PASS, 142 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_tools.py
git commit -m "feat(gis-canvas): steer render_view toward an analysis product, not a data dump"
```

---

### Task 7: Golden-fixture acceptance test

**Files:**
- Create: `tests/fixtures/gis-canvas/session-2026-08-31/render-spec-after.json`
- Create: `tests/plugins/gis_canvas/test_analysis_product_fixture.py`
- Test: same file

**Interfaces:**
- Consumes: `note` (Task 3), inline rows (Task 5).
- Produces: the executable definition of "what good looks like" for this canvas.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/gis_canvas/test_analysis_product_fixture.py`:

```python
"""The 31 Aug session produced a full intelligence product but rendered only its source
tables. render-spec-after.json is the same investigation drawn as an analysis product;
this pins the target so the two primitives cannot silently regress."""
import json
import pathlib

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "gis-canvas" / "session-2026-08-31"


def _after() -> dict:
    return json.loads((FIXTURE / "render-spec-after.json").read_text(encoding="utf-8"))


def _types(doc: dict) -> list[str]:
    found: list[str] = []

    def walk(node: dict) -> None:
        found.append(node["type"])
        for child in node.get("children", []) or []:
            walk(child)
        for nodes in (node.get("slots") or {}).values():
            for child in nodes:
                walk(child)

    for c in doc["components"]:
        walk(c)
    return found


def test_analysis_product_canvas_is_valid(plugin):
    assert plugin.validator.validate_doc(_after()) == []


def test_analysis_product_leads_with_judgments_not_source_data(plugin):
    doc = _after()
    base = [c for c in doc["components"] if c.get("layer") == "base"]
    assert len(base) == 1
    assert base[0]["type"] == "note", "the answer, not a retrieved table, must be the base layer"


def test_analysis_product_carries_prose_and_computed_rows(plugin):
    doc = _after()
    types = _types(doc)
    assert types.count("note") >= 2, "expected key judgments plus caveats"
    inline = [c for c in doc["components"]
              if c["type"] == "data-table" and "rows" in (c.get("props") or {})]
    assert inline, "the computed gap/tasking table must be inline, not a handle"


def test_retrieved_source_data_is_demoted(plugin):
    """Every data:// binding must sit behind a dock/tabs rail, never at base."""
    doc = _after()
    for c in doc["components"]:
        src = (c.get("bindings") or {}).get("source", "")
        if isinstance(src, str) and src.startswith("data://"):
            assert c.get("layer") != "base"


def test_before_and_after_come_from_the_same_session(plugin):
    """Guards against the fixture drifting onto invented handles."""
    before = json.loads((FIXTURE / "render-spec-before.json").read_text(encoding="utf-8"))
    manifest = json.loads((FIXTURE / "handles-manifest.json").read_text(encoding="utf-8"))
    known = {e["handle"] for e in manifest}

    def sources(doc: dict) -> set[str]:
        out: set[str] = set()

        def walk(node: dict) -> None:
            src = (node.get("bindings") or {}).get("source")
            if isinstance(src, str) and src.startswith("data://"):
                out.add(src)
            for nodes in (node.get("slots") or {}).values():
                for child in nodes:
                    walk(child)

        for c in doc["components"]:
            walk(c)
        return out

    assert sources(_after()) <= known
    assert before["components"], "before-spec fixture must not be empty"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_analysis_product_fixture.py -v`
Expected: FAIL — `FileNotFoundError: render-spec-after.json`.

- [ ] **Step 3: Write minimal implementation**

Create `tests/fixtures/gis-canvas/session-2026-08-31/render-spec-after.json`. Handles are the
surviving ones from `handles-manifest.json` (`f4e4262d` = suspects, `08d4277a` = CLYDE months):

```json
{
  "canvasVersion": 1,
  "layout": { "type": "grid", "cols": 12, "rowHeight": 80, "gap": 8 },
  "components": [
    {
      "id": "judgments",
      "type": "note",
      "layer": "base",
      "props": {
        "title": "Key judgments — shadow-fleet AIS gaps",
        "body": "## Highest-value imagery tasking windows\n\n1. **AGNI** 2025-06-25 to 2025-11-20 — longest silence, 148 days.\n2. **CLYDE NOBLE** 2025-05-19 to 2025-09-08 — 111.8-day silence plus MMSI change.\n3. **WONDER VEGA** 2025-07-17 to 2025-09-03 — 47.7-day silence plus MMSI change.\n4. **TREND** 2025-11-02 to 2025-12-08 — 35.1-day silence, tight geographic boundary.\n\n---\n\n### Sensor recommendation\n\n- **SAR first** for every window: cloud and night independent.\n- **High-resolution optical** when daylight and cloud allow: deck activity, rendezvous, possible STS indicators.\n- For MMSI-change gaps, task both the **late-gap** and **first-reappearance** windows to see whether the same hull returns under a new identity."
      }
    },
    {
      "id": "gaps",
      "type": "data-table",
      "layer": "dock",
      "edge": "bottom",
      "size": { "w": 100, "h": 34 },
      "props": {
        "title": "AIS gaps & recommended tasking windows",
        "rows": [
          { "vessel": "AGNI", "gap": "A", "last_ais": "2025-06-25T20:22Z", "first_ais": "2025-11-20T19:37Z", "days": 148.0, "mmsi_change": "no", "early_sar": "2025-06-26 02:22Z-08:22Z" },
          { "vessel": "CLYDE NOBLE", "gap": "A", "last_ais": "2025-05-19T06:30Z", "first_ais": "2025-09-08T01:07Z", "days": 111.8, "mmsi_change": "yes", "early_sar": "2025-05-19 12:30Z-18:30Z" },
          { "vessel": "WONDER VEGA", "gap": "A", "last_ais": "2025-07-17T16:47Z", "first_ais": "2025-09-03T09:28Z", "days": 47.7, "mmsi_change": "yes", "early_sar": "2025-07-17 22:47Z-04:47Z" },
          { "vessel": "WONDER VEGA", "gap": "B", "last_ais": "2025-09-19T18:30Z", "first_ais": "2025-11-02T02:52Z", "days": 43.3, "mmsi_change": "no", "early_sar": "2025-09-20 00:30Z-06:30Z" },
          { "vessel": "TREND", "gap": "A", "last_ais": "2025-11-02T22:55Z", "first_ais": "2025-12-08T00:22Z", "days": 35.1, "mmsi_change": "no", "early_sar": "2025-11-03 04:55Z-10:55Z" }
        ]
      }
    },
    {
      "id": "caveats",
      "type": "note",
      "layer": "dock",
      "edge": "right",
      "size": { "w": 26, "h": 100 },
      "props": {
        "title": "Caveats",
        "body": "These are AIS transmission gaps from records returned through the Denodo-governed AIS view.\n\nThey indicate **absence of returned observations**, not proof of deliberate AIS disablement.\n\nSatellite imagery is the independent corroboration step."
      }
    },
    {
      "id": "sources",
      "type": "tabs",
      "layer": "dock",
      "edge": "top",
      "size": { "w": 100, "h": 22 },
      "props": { "tabs": [{ "id": "suspects", "label": "Suspects" }, { "id": "clyde", "label": "CLYDE months" }] },
      "state": { "active": "suspects" },
      "slots": {
        "suspects": [
          { "id": "t_suspects", "type": "data-table", "props": { "title": "potential_shadow_fleets suspects" }, "bindings": { "source": "data://f4e4262d" } }
        ],
        "clyde": [
          { "id": "t_clyde", "type": "data-table", "props": { "title": "CLYDE NOBLE monthly AIS activity" }, "bindings": { "source": "data://08d4277a" } }
        ]
      }
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/test_analysis_product_fixture.py -v`
Expected: PASS, 5 tests.

Then run everything:

Run: `./.venv/Scripts/python.exe -m pytest tests/plugins/gis_canvas/ -q && npm test --workspace @hermes/gis-canvas && npm run typecheck --workspace @hermes/gis-canvas`
Expected: backend 147 passed; frontend 316 passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/gis-canvas/session-2026-08-31/render-spec-after.json tests/plugins/gis_canvas/test_analysis_product_fixture.py
git commit -m "test(gis-canvas): pin the analysis-product canvas as a golden fixture"
```

---

## Manual verification (Tier 2 — not automatable)

No unit test can prove the *agent* now behaves differently; Task 6 only proves the prompt
changed. After Task 7:

1. Restart the gateway so the plugin reloads (Python does not hot-reload):
   stop the `hermes.exe dashboard --port 9119` process tree, then relaunch **via PowerShell**
   with `$env:GIS_BFF_PROXY_SECRET` sourced from `apps/gis-canvas-bff/.env`,
   `$env:GIS_DATA_SOURCE='a2a'`, `$env:GIS_BFF_URL='http://localhost:9109'`,
   `$env:HERMES_DASHBOARD_SESSION_TOKEN='dev-gis-local'`.
   Killing that tree also kills any TUI slash-worker sessions running under it — warn the user first.
2. Seed **one** agent turn with the contents of
   `tests/fixtures/gis-canvas/session-2026-08-31/analysis-product.md` plus the live handle list,
   asking only for the final investigation canvas. This is a single `render_view` — the ~2h of
   Denodo round-trips is not repeated.
3. Check the canvas leads with judgments, shows the computed gap table, carries caveats, and
   demotes the retrieved tables. If it still heroes a source table, the guidance in Task 6 needs
   another pass — that is the expected failure mode.

## Out of scope (backlog)

SP-B (`finding` component) and SP-C (drill-through: select evidence rows + focus map/time) are
specified in the design doc. SP-C needs two channels that do not exist yet — nothing consumes
`STATE_KEYS["esri:map"]["extent"]` as an input, and `TimeExtentContext` is publish-only.
