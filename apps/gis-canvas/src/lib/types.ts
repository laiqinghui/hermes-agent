/**
 * TypeScript mirror of plugins/gis-canvas/schema/canvas.schema.json (v1).
 * Keep in sync when the schema changes.
 */
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select', 'tabs', 'esri:map', 'esri:legend', 'esri:layer-list', 'esri:time-slider', 'entity-detail', 'esri:feature-table'] as const
export type MoleculeType = (typeof MOLECULE_TYPES)[number]

export interface Area {
  col: number
  colSpan: number
  row: number
  rowSpan: number
}

export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface Size {
  w: number // percent of canvas, 0-100
  h: number // percent of canvas, 0-100
}

export interface WindowRect {
  x: number // percent of canvas box, left edge
  y: number // percent of canvas box, top edge
  w: number // percent width
  h: number // percent height
  z: number // stacking order
}

export type Handler =
  | { kind: 'set'; target: string; key: string; value: unknown }
  | { kind: 'reactive'; controls: string } // "targetId.key.subkey" path written from event value
  | { kind: 'agent'; prompt: string }
  | { kind: 'open'; overlay: string }

export interface ComponentNode {
  id: string
  type: MoleculeType | (string & {}) // tolerate future types; renderer falls back to UnknownTile
  area?: Area
  layer?: 'base' | 'dock' | 'float'
  edge?: Edge
  anchor?: Anchor
  size?: Size
  z?: number
  props?: Record<string, unknown>
  bindings?: Record<string, string | string[]>
  state?: Record<string, unknown>
  children?: ComponentNode[]
  slots?: Record<string, ComponentNode[]>
  handlers?: Record<string, Handler>
}

export interface LinkDef { to: string; field: string; reverse?: boolean }
export interface EntityType { source: string; id: string; title?: string; props?: string[]; links?: Record<string, LinkDef> }
export type Ontology = Record<string, EntityType>

export interface GridLayout {
  type: 'grid'
  cols: number
  rowHeight?: number
  gap?: number
}

export interface CanvasDoc {
  canvasVersion: 1
  rev: number
  layout: GridLayout
  components: ComponentNode[]
  overlays?: ComponentNode[]
  focus?: string
  ontology?: Ontology
}

/** Envelope carried in canvas tool results (see plugins/gis-canvas/tools_canvas.py). */
export interface CanvasEnvelope {
  gis_canvas: true
  ok: boolean
  rev: number | null
  doc?: CanvasDoc
  node?: ComponentNode
  errors?: string[]
  components_index?: Array<{ id: string; type: string }>
}
