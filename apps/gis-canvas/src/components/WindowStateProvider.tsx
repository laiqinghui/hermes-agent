import { createContext, useContext, type ReactNode } from 'react'
import type { WindowStateStore } from '../lib/use-window-state'

const NOOP: WindowStateStore = {
  states: {}, updated: new Set(), get: () => 'open',
  toggleShade: () => {}, minimize: () => {}, restore: () => {}, markUpdated: () => {},
  sync: () => {}, toggleFocus: () => {}, reset: () => {},
  minimizedIds: [], canFocus: false, isFocused: false, isEmpty: true,
}
const Ctx = createContext<WindowStateStore>(NOOP)

/** Distributes the App-owned window-state store to canvas windows. Controlled:
 * App owns the store so TopBar's Focus map and Reset can reach it too. */
export function WindowStateProvider({ store, children }: { store: WindowStateStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useWindowState(): WindowStateStore {
  return useContext(Ctx)
}
