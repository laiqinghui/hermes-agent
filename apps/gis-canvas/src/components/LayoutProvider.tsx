import { createContext, useContext, type ReactNode } from 'react'
import type { LayoutStore } from '../lib/use-layout-store'

const NOOP: LayoutStore = {
  overrides: {}, get: () => undefined, set: () => {},
  prune: () => {}, reset: () => {}, isEmpty: true,
}
const Ctx = createContext<LayoutStore>(NOOP)

/** Distributes the App-owned layout store to canvas windows. Controlled: App owns
 * the store (so TopBar's Reset can call it too) and passes it straight through. */
export function LayoutProvider({ store, children }: { store: LayoutStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useLayout(): LayoutStore {
  return useContext(Ctx)
}
