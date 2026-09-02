import { describe, it, expect } from 'vitest'
import { canMinimize, humanTitle, signatures, changedIds } from './window-state'
import type { CanvasDoc } from './types'

const doc: CanvasDoc = {
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
  components: [
    { id: 'm', type: 'esri:map', layer: 'base' },
    { id: 't', type: 'data-table', layer: 'dock', edge: 'right', props: { title: 'Tracks' } },
  ],
}

describe('canMinimize', () => {
  it('exempts the base layer and allows everything else', () => {
    expect(canMinimize({ id: 'm', type: 'esri:map', layer: 'base' })).toBe(false)
    expect(canMinimize({ id: 't', type: 'data-table', layer: 'dock' })).toBe(true)
    expect(canMinimize({ id: 'n', type: 'note' })).toBe(true)
  })
})

describe('humanTitle', () => {
  it('prefers props.title and otherwise humanizes the type', () => {
    expect(humanTitle({ id: 'a', type: 'data-table', props: { title: 'Tracks' } })).toBe('Tracks')
    expect(humanTitle({ id: 'b', type: 'esri:time-slider' })).toBe('time slider')
    expect(humanTitle({ id: 'c', type: 'note', props: { title: '   ' } })).toBe('note')
  })
})

describe('signatures / changedIds', () => {
  it('is stable when nothing changed', () => {
    expect(changedIds(signatures(doc), signatures(doc))).toEqual([])
  })

  it('reports only the molecule whose content changed', () => {
    const next: CanvasDoc = {
      ...doc, rev: 2,
      components: [doc.components[0], { ...doc.components[1], props: { title: 'Tracks (12)' } }],
    }
    expect(changedIds(signatures(doc), signatures(next))).toEqual(['t'])
  })

  it('reports a newly added molecule and ignores a removed one', () => {
    const next: CanvasDoc = {
      ...doc, rev: 2,
      components: [doc.components[0], { id: 'n', type: 'note' }],
    }
    expect(changedIds(signatures(doc), signatures(next))).toEqual(['n'])
  })
})
