import { render, screen, act } from '@testing-library/react'
import { TimeExtentProvider, useTimeExtentPublisher, useMapTimeExtent } from './TimeExtentContext'

let publish: (mapId: string, extent: { start: number; end: number } | null) => void

function Harness({ mapId }: { mapId: string }) {
  publish = useTimeExtentPublisher()
  const ext = useMapTimeExtent(mapId)
  return <span data-testid="ext">{ext ? `${ext.start}..${ext.end}` : 'none'}</span>
}

test('a subscriber reads the extent published for its map id', () => {
  render(
    <TimeExtentProvider>
      <Harness mapId="m1" />
    </TimeExtentProvider>
  )
  expect(screen.getByTestId('ext').textContent).toBe('none')
  act(() => publish('m1', { start: 10, end: 90 }))
  expect(screen.getByTestId('ext').textContent).toBe('10..90')
})

test('publishing null clears a map’s extent', () => {
  render(
    <TimeExtentProvider>
      <Harness mapId="m2" />
    </TimeExtentProvider>
  )
  act(() => publish('m2', { start: 1, end: 2 }))
  expect(screen.getByTestId('ext').textContent).toBe('1..2')
  act(() => publish('m2', null))
  expect(screen.getByTestId('ext').textContent).toBe('none')
})

test('an unrelated map id is not affected by another map’s extent', () => {
  render(
    <TimeExtentProvider>
      <Harness mapId="other" />
    </TimeExtentProvider>
  )
  act(() => publish('m3', { start: 5, end: 6 }))
  expect(screen.getByTestId('ext').textContent).toBe('none')
})
