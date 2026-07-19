import { describe, it, expect } from 'vitest'
import { applyAutoShell, edgeForType } from './auto-shell'
import type { CanvasDoc, ComponentNode } from './types'

const comp = (id: string, type: string, extra: Partial<ComponentNode> = {}): ComponentNode =>
  ({ id, type, ...extra })
const doc = (components: ComponentNode[]): CanvasDoc =>
  ({ canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components })

describe('edgeForType', () => {
  it('maps roles to edges, default bottom', () => {
    expect(edgeForType('data-table')).toBe('bottom')
    expect(edgeForType('esri:feature-table')).toBe('bottom')
    expect(edgeForType('esri:legend')).toBe('right')
    expect(edgeForType('stat')).toBe('left')
    expect(edgeForType('select')).toBe('top')
    expect(edgeForType('card')).toBe('left')
    expect(edgeForType('future:widget')).toBe('bottom')
  })
})

describe('applyAutoShell', () => {
  it('promotes a lone map to base and docks the rest by role', () => {
    const out = applyAutoShell(doc([comp('s1', 'stat'), comp('m1', 'esri:map'), comp('t1', 'data-table')]))
    const byId = Object.fromEntries(out.components.map(c => [c.id, c]))
    expect(byId.m1.layer).toBe('base')
    expect(byId.s1.layer).toBe('dock'); expect(byId.s1.edge).toBe('left'); expect(byId.s1.z).toBe(0)
    expect(byId.t1.layer).toBe('dock'); expect(byId.t1.edge).toBe('bottom'); expect(byId.t1.z).toBe(2)
  })
  it('place-all: two tables both dock bottom', () => {
    const out = applyAutoShell(doc([comp('m1', 'esri:map'), comp('t1', 'data-table'), comp('t2', 'data-table')]))
    const docks = out.components.filter(c => c.layer === 'dock')
    expect(docks.map(c => c.id)).toEqual(['t1', 't2'])
    expect(docks.every(c => c.edge === 'bottom')).toBe(true)
  })
  it('no-op when a layer is already set', () => {
    const input = doc([comp('m1', 'esri:map', { layer: 'base' }), comp('s1', 'stat')])
    expect(applyAutoShell(input)).toBe(input)
  })
  it('no-op when not exactly one map', () => {
    const none = doc([comp('s1', 'stat')]); expect(applyAutoShell(none)).toBe(none)
    const two = doc([comp('m1', 'esri:map'), comp('m2', 'esri:map')]); expect(applyAutoShell(two)).toBe(two)
  })
})
