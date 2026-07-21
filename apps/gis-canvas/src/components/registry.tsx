import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { ComponentNode } from '../lib/types'
import { CardMolecule } from './molecules/CardMolecule'
import { StatMolecule } from './molecules/StatMolecule'
import { DataTableMolecule } from './molecules/DataTableMolecule'
import { SelectMolecule } from './molecules/SelectMolecule'
import { TabsMolecule } from './molecules/TabsMolecule'

export interface MoleculeProps {
  node: ComponentNode
  renderChild: (node: ComponentNode) => ReactNode
}

const EsriMapLazy = lazy(() => import('./molecules/EsriMapMolecule').then(m => ({ default: m.EsriMapMolecule })))
function EsriMap(props: MoleculeProps) {
  return (
    <Suspense fallback={<div className="p-2 text-xs text-neutral-400">Loading map…</div>}>
      <EsriMapLazy {...props} />
    </Suspense>
  )
}

const EsriLegendLazy = lazy(() => import('./molecules/EsriLegendMolecule').then(m => ({ default: m.EsriLegendMolecule })))
function EsriLegend(props: MoleculeProps) {
  return (
    <Suspense fallback={<div className="p-2 text-xs text-neutral-400">Loading legend…</div>}>
      <EsriLegendLazy {...props} />
    </Suspense>
  )
}

// The native ESRI feature-table pulls a Vaadin/Polymer subtree Vite mis-bundles,
// and duplicates the DataTable for the same data. Render feature-table nodes as a
// DataTable over their layer handle instead (bindings.layer -> source).
function FeatureTableAsDataTable({ node, renderChild }: MoleculeProps) {
  const layer = Array.isArray(node.bindings?.layer) ? node.bindings!.layer[0] : (node.bindings?.layer as string | undefined)
  if (!layer) {
    return (
      <div className="flex h-full items-center justify-center rounded-gc-md border border-hairline bg-surface p-2 text-center font-sans text-xs text-tertiary">
        feature table unavailable
      </div>
    )
  }
  const adapted: ComponentNode = { ...node, type: 'data-table', bindings: { ...node.bindings, source: layer } }
  return <DataTableMolecule node={adapted} renderChild={renderChild} />
}

export const COMPONENT_REGISTRY: Record<string, ComponentType<MoleculeProps>> = {
  card: CardMolecule,
  stat: StatMolecule,
  'data-table': DataTableMolecule,
  select: SelectMolecule,
  tabs: TabsMolecule,
  'esri:map': EsriMap,
  'esri:legend': EsriLegend,
  'esri:feature-table': FeatureTableAsDataTable
}

export function UnknownTile({ node }: MoleculeProps) {
  return (
    <div
      data-testid="unknown-tile"
      className="flex h-full items-center justify-center rounded-lg border border-dashed border-neutral-300 p-2 text-xs text-neutral-500"
    >
      unsupported component: {node.type} ({node.id})
    </div>
  )
}
