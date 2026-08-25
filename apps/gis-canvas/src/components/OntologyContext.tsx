import { createContext, useContext, type ReactNode } from 'react'
import type { Ontology } from '../lib/types'

const Ctx = createContext<Ontology | undefined>(undefined)

/** Feeds the canvas doc's top-level `ontology` to entity-aware molecules. */
export function OntologyProvider({ ontology, children }: { ontology?: Ontology; children: ReactNode }) {
  return <Ctx.Provider value={ontology}>{children}</Ctx.Provider>
}

export function useOntology(): Ontology | undefined {
  return useContext(Ctx)
}
