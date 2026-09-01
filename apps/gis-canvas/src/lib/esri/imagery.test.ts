import { describe, it, expect } from 'vitest'
import { buildImageryLayer, buildFootprintLayer, type ImageryBag } from './imagery'
import type { ImageryScene } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeLayer { constructor(public opts: any) {} }
class FakeRenderer { constructor(public opts: any) {} }

const bag = () => ({ ImageryTileLayer: FakeLayer, RasterStretchRenderer: FakeRenderer } as unknown as ImageryBag)
const fl = () => ({ FeatureLayer: FakeLayer as unknown as new (o: unknown) => unknown })

const optical: ImageryScene = {
  id: 'o1', title: 'S2C 2025-12-05', url: 'https://example.com/TCI.tif',
  sensor: 'optical', datetime: '2025-12-05T03:36:14Z', bbox: [104.58, 1.72, 104.78, 1.94]
}
const sar: ImageryScene = {
  id: 's1', title: 'S1A 2025-12-03', url: 'https://example.com/vv.tif',
  sensor: 'sar', datetime: '2025-12-03T22:11:00Z', bbox: [104.5, 1.7, 104.9, 2.0]
}

describe('buildImageryLayer', () => {
  it('builds an RGB layer for optical with no renderer', () => {
    const layer = buildImageryLayer(optical, bag()) as FakeLayer
    expect(layer.opts.url).toBe('https://example.com/TCI.tif')
    expect(layer.opts.bandIds).toEqual([0, 1, 2])
    expect(layer.opts.title).toBe('S2C 2025-12-05')
    expect(layer.opts.renderer).toBeUndefined()
  })

  it('builds a single-band percent-clip stretch for SAR — without it a VV COG paints black', () => {
    const layer = buildImageryLayer(sar, bag()) as FakeLayer
    expect(layer.opts.bandIds).toEqual([0])
    expect(layer.opts.renderer).toBeInstanceOf(FakeRenderer)
    expect(layer.opts.renderer.opts.stretchType).toBe('percent-clip')
    expect(layer.opts.renderer.opts.dra).toBe(true)
  })

  it('honours an explicit bandIds override on either sensor', () => {
    const layer = buildImageryLayer({ ...optical, bandIds: [3, 2, 1] }, bag()) as FakeLayer
    expect(layer.opts.bandIds).toEqual([3, 2, 1])
  })
})

describe('buildFootprintLayer', () => {
  it('builds one polygon graphic per scene, each carrying an explicit spatialReference', () => {
    const layer = buildFootprintLayer([optical, sar], fl()) as FakeLayer
    expect(layer.opts.source).toHaveLength(2)
    expect(layer.opts.geometryType).toBe('polygon')
    // SP3b: a geometry without an explicit SR yields a [0,0] extent and renders nothing.
    expect(layer.opts.source[0].geometry.spatialReference).toEqual({ wkid: 4326 })
    expect(layer.opts.source[0].attributes.scene_id).toBe('o1')
    expect(layer.opts.source[0].attributes.__oid).toBe(1)
    expect(layer.opts.source[1].attributes.__oid).toBe(2)
  })

  it('skips scenes with an unusable bbox instead of poisoning the layer', () => {
    const bad = { ...sar, bbox: [Number.NaN, 1.7, 104.9, 2.0] as [number, number, number, number] }
    const layer = buildFootprintLayer([optical, bad], fl()) as FakeLayer
    expect(layer.opts.source).toHaveLength(1)
    expect(layer.opts.source[0].attributes.scene_id).toBe('o1')
  })

  it('returns null when nothing is drawable, so the caller adds no empty layer', () => {
    expect(buildFootprintLayer([], fl())).toBeNull()
  })
})
