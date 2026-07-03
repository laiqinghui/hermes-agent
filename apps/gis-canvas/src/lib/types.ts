/**
 * TypeScript mirror of plugins/gis-canvas/schema/canvas.schema.json (v1).
 * Keep in sync when the schema changes.
 */
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select', 'esri:map', 'esri:legend', 'esri:feature-table'] as const
export type MoleculeType = (typeof MOLECULE_TYPES)[number]

export interface Area {
  col: number
  colSpan: number
  row: number
  rowSpan: number
}

export type Handler =
  | { kind: 'set'; target: string; key: string; value: unknown }
  | { kind: 'reactive'; controls: string } // "targetId.key.subkey" path written from event value
  | { kind: 'agent'; prompt: string }

export interface ComponentNode {
  id: string
  type: MoleculeType | (string & {}) // tolerate future types; renderer falls back to UnknownTile
  area?: Area
  props?: Record<string, unknown>
  bindings?: Record<string, string | string[]>
  state?: Record<string, unknown>
  children?: ComponentNode[]
  slots?: Record<string, ComponentNode[]>
  handlers?: Record<string, Handler>
}

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
