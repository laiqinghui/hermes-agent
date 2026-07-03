import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import type { ComponentNode } from '../lib/types'
import { CardMolecule } from './molecules/CardMolecule'
import { StatMolecule } from './molecules/StatMolecule'
import { DataTableMolecule } from './molecules/DataTableMolecule'
import { SelectMolecule } from './molecules/SelectMolecule'

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

export const COMPONENT_REGISTRY: Record<string, ComponentType<MoleculeProps>> = {
  card: CardMolecule,
  stat: StatMolecule,
  'data-table': DataTableMolecule,
  select: SelectMolecule,
  'esri:map': EsriMap
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
