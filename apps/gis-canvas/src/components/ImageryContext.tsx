import { createContext, useContext, type ReactNode } from 'react'
import type { Imagery } from '../lib/types'

const Ctx = createContext<Imagery | undefined>(undefined)

/** Feeds the canvas doc's top-level `imagery` (every STAC-discovered scene, whether
 * or not it is displayed) to imagery-aware molecules. Read-only in SP4a; SP4b adds
 * the visible-set toggle the catalog molecule writes through. */
export function ImageryProvider({ imagery, children }: { imagery?: Imagery; children: ReactNode }) {
  return <Ctx.Provider value={imagery}>{children}</Ctx.Provider>
}

export function useImagery(): Imagery | undefined {
  return useContext(Ctx)
}
