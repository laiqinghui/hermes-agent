import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FreeCanvas } from './FreeCanvas'
import { LayoutProvider } from './LayoutProvider'
import { useLayoutStore } from '../lib/use-layout-store'
import type { CanvasDoc } from '../lib/types'

// jsdom has no layout; give the container a real rect so px→% is finite.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => {} }) as DOMRect
})

const doc: CanvasDoc = {
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
  components: [
    { id: 'm', type: 'esri:map', layer: 'base' },
    { id: 'lg', type: 'esri:legend', layer: 'dock', edge: 'right' },
  ],
}

function Harness({ doc }: { doc: CanvasDoc }) {
  const store = useLayoutStore()
  return (
    <LayoutProvider store={store}>
      <div data-testid="store-empty">{String(store.isEmpty)}</div>
      <FreeCanvas doc={doc} />
    </LayoutProvider>
  )
}

describe('FreeCanvas', () => {
  it('renders one window per molecule, seeded from auto-shell', () => {
    render(<Harness doc={doc} />)
    expect(screen.getByTestId('window-m')).toBeInTheDocument()
    expect(screen.getByTestId('window-lg')).toBeInTheDocument()
    // map full-bleed
    expect(screen.getByTestId('window-m')).toHaveStyle({ left: '0%', top: '0%', width: '100%', height: '100%' })
  })

  it('dragging a window commits a clamped override', () => {
    render(<Harness doc={doc} />)
    const header = screen.getByTestId('window-header-lg')
    fireEvent.pointerDown(header, { clientX: 500, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 300, clientY: 100 })
    // legend seeded at right edge (x≈74); dragged -20% → override persists (x moved left)
    const el = screen.getByTestId('window-lg')
    expect(el.style.left).not.toBe('74%')
    // a real drag (with a pointermove) does write an override
    expect(screen.getByTestId('store-empty').textContent).toBe('false')
  })

  it('a bare click (no movement) pins nothing', () => {
    render(<Harness doc={doc} />)
    const el = screen.getByTestId('window-lg')
    const seedLeft = el.style.left
    const header = screen.getByTestId('window-header-lg')
    fireEvent.pointerDown(header, { clientX: 500, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 500, clientY: 100 })
    expect(screen.getByTestId('store-empty').textContent).toBe('true')
    expect(el.style.left).toBe(seedLeft)
  })

  it('a multi-move drag lands at the net offset (no compounding)', () => {
    render(<Harness doc={doc} />)
    fireEvent.pointerDown(screen.getByTestId('window-header-lg'), { clientX: 500, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 450, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 400, clientY: 100 }) // net -100px = -10%
    fireEvent.pointerUp(window, { clientX: 400, clientY: 100 })
    // seed x≈74; net -10% (snap may adjust a few %); assert it's near 64, not 54 (compounded)
    const x = parseFloat(screen.getByTestId('window-lg').style.left)
    expect(x).toBeGreaterThan(60)
    expect(x).toBeLessThan(68)
  })

  it('dragging the map keeps it behind the panels (base stays at back)', () => {
    render(<Harness doc={doc} />)
    fireEvent.pointerDown(screen.getByTestId('window-header-m'), { clientX: 100, clientY: 50 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 50 })
    fireEvent.pointerUp(window, { clientX: 140, clientY: 50 })
    const mZ = Number(screen.getByTestId('window-m').style.zIndex)   // base — must NOT be raised
    const lgZ = Number(screen.getByTestId('window-lg').style.zIndex) // seed z 2
    expect(mZ).toBe(0)            // map kept at the back
    expect(mZ).toBeLessThan(lgZ)  // panels stay on top of the map
  })

  it('dragging a panel raises it above the other panels (front z)', () => {
    const threePane: CanvasDoc = {
      canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
      components: [
        { id: 'm', type: 'esri:map', layer: 'base' },
        { id: 's', type: 'stat', layer: 'dock', edge: 'left' },   // seed z 2
        { id: 'lg', type: 'esri:legend', layer: 'dock', edge: 'right' }, // seed z 3
      ],
    }
    render(<Harness doc={threePane} />)
    // drag the lower-z stat; it should jump above the legend
    fireEvent.pointerDown(screen.getByTestId('window-header-s'), { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 160, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 160, clientY: 100 })
    const sZ = Number(screen.getByTestId('window-s').style.zIndex)
    const lgZ = Number(screen.getByTestId('window-lg').style.zIndex)
    expect(sZ).toBeGreaterThan(lgZ)
  })
})
