import { render, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'
import { TimeExtentProvider, useTimeExtentPublisher } from '../TimeExtentContext'
import { useEffect } from 'react'

// TimeExtent is captured so the extent effect can construct one; the fake records
// its {start,end} so a test can assert what was applied to the element.
class FakeTimeExtent {
  start: Date
  end: Date
  constructor(o: { start: Date; end: Date }) { this.start = o.start; this.end = o.end }
}
vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({ TimeExtent: FakeTimeExtent }) }))

import { EsriTimeSliderMolecule } from './EsriTimeSliderMolecule'

test('renders an arcgis-time-slider bound to the map via reference-element', () => {
  const node: ComponentNode = { id: 'ts1', type: 'esri:time-slider', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriTimeSliderMolecule node={node} renderChild={() => null} />)
  const el = container.querySelector('arcgis-time-slider')
  expect(el).toBeTruthy()
  expect(el?.getAttribute('reference-element')).toBe('#esri-map-map1')
})

test('omits reference-element when no mapRef is bound', () => {
  const node: ComponentNode = { id: 'ts2', type: 'esri:time-slider' }
  const { container } = render(<EsriTimeSliderMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-time-slider')?.getAttribute('reference-element')).toBeNull()
})

function PublishOnMount({ mapId, extent }: { mapId: string; extent: { start: number; end: number } }) {
  const publish = useTimeExtentPublisher()
  useEffect(() => { publish(mapId, extent) }, [publish, mapId, extent])
  return null
}

test('applies the map’s published full time extent + play stops to the element', async () => {
  const node: ComponentNode = { id: 'ts3', type: 'esri:time-slider', bindings: { mapRef: 'map9' } }
  const { container } = render(
    <TimeExtentProvider>
      <PublishOnMount mapId="map9" extent={{ start: 1000, end: 5000 }} />
      <EsriTimeSliderMolecule node={node} renderChild={() => null} />
    </TimeExtentProvider>
  )
  const el = container.querySelector('arcgis-time-slider') as unknown as {
    fullTimeExtent?: FakeTimeExtent; timeExtent?: FakeTimeExtent; stops?: { count?: number }
  }
  await waitFor(() => expect(el.fullTimeExtent).toBeInstanceOf(FakeTimeExtent))
  expect(el.fullTimeExtent!.start.getTime()).toBe(1000)
  expect(el.fullTimeExtent!.end.getTime()).toBe(5000)
  expect(el.timeExtent!.start.getTime()).toBe(1000)
  expect(el.stops?.count).toBe(50)
})

test('does not set a full time extent when its map has published none', async () => {
  const node: ComponentNode = { id: 'ts4', type: 'esri:time-slider', bindings: { mapRef: 'no-extent-map' } }
  const { container } = render(
    <TimeExtentProvider>
      <EsriTimeSliderMolecule node={node} renderChild={() => null} />
    </TimeExtentProvider>
  )
  // give any async loadEsri().then a chance to run
  await new Promise(r => setTimeout(r, 0))
  const el = container.querySelector('arcgis-time-slider') as unknown as { fullTimeExtent?: unknown }
  expect(el.fullTimeExtent).toBeUndefined()
})
