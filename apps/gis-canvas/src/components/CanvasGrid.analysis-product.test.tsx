import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { CanvasGrid } from './CanvasGrid'
import type { CanvasDoc } from '../lib/types'
import { HandlerProvider } from './HandlerContext'
import type { CanvasActions } from '../lib/handlers'
import { LayoutProvider } from './LayoutProvider'
import { useLayoutStore } from '../lib/use-layout-store'

// jsdom has no layout; give the container a real rect so px→% is finite (FreeCanvas
// consumes getBoundingClientRect for live container sizing) — same setup as CanvasGrid.test.tsx.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => {} }) as DOMRect
})

// The fixture lives outside this package (tests/fixtures/gis-canvas/...), shared with
// the backend golden-fixture test (tests/plugins/gis_canvas/test_analysis_product_fixture.py).
const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/gis-canvas/session-2026-08-31/render-spec-after.json'
)

function loadFixtureDoc(): CanvasDoc {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  return { rev: 1, ...raw } as CanvasDoc
}

function renderDoc(d: CanvasDoc) {
  function Harness() {
    const store = useLayoutStore()
    const actions: CanvasActions = {
      setLocalState: () => {},
      reportInteraction: () => {},
      sendPrompt: () => {},
      fetchData: async () => ({ ok: true, rows: [], schema: [], total: 0, page: 0, pageSize: 0 })
    }
    return (
      <HandlerProvider actions={actions}>
        <LayoutProvider store={store}>
          <CanvasGrid doc={d} />
        </LayoutProvider>
      </HandlerProvider>
    )
  }
  return render(<Harness />)
}

// Pins the render half of the analysis-product golden fixture: the Python suite
// (test_analysis_product_fixture.py) proves the validator accepts this document, but
// nothing mounted it — a render throw in note or inline-rows would slip past every
// existing suite. This test fails loudly if either regresses.
test('the analysis-product golden fixture actually renders: judgments, inline gap table, demoted source tabs', () => {
  const doc = loadFixtureDoc()
  renderDoc(doc)

  // Each Window also shows its own titlebar (node.props.title), so title text is
  // legitimately duplicated on screen; scope assertions to each fixture node's
  // window (data-testid="window-<id>") to check its actual content unambiguously.
  const judgmentsWindow = within(screen.getByTestId('window-judgments'))
  const gapsWindow = within(screen.getByTestId('window-gaps'))
  const caveatsWindow = within(screen.getByTestId('window-caveats'))
  const sourcesWindow = within(screen.getByTestId('window-sources'))

  // Judgment prose from the base note (layer:'base' — the answer, not raw data).
  expect(judgmentsWindow.getAllByText('Key judgments — shadow-fleet AIS gaps').length).toBeGreaterThanOrEqual(1)
  expect(judgmentsWindow.getByText('AGNI')).toBeInTheDocument() // bold vessel name inside the judgment list

  // The inline gap/tasking table: computed rows travel via props.rows, no data:// handle.
  expect(gapsWindow.getAllByText('AIS gaps & recommended tasking windows').length).toBeGreaterThanOrEqual(1)
  expect(gapsWindow.getByText('5 rows')).toBeInTheDocument()
  expect(gapsWindow.getByText('CLYDE NOBLE')).toBeInTheDocument() // computed row, rendered as a table cell
  expect(gapsWindow.getByText('TREND')).toBeInTheDocument()
  expect(screen.getAllByText('CLYDE NOBLE').length).toBeGreaterThanOrEqual(2) // note prose too (whole doc)

  // Caveats note.
  expect(caveatsWindow.getAllByText('Caveats').length).toBeGreaterThanOrEqual(1)
  expect(caveatsWindow.getByText(/independent corroboration step/)).toBeInTheDocument()

  // Source tables demoted to a tabs rail, not rendered at base/dock as raw tables.
  expect(sourcesWindow.getByText('Suspects')).toBeInTheDocument()
  expect(sourcesWindow.getByText('CLYDE months')).toBeInTheDocument()
})
