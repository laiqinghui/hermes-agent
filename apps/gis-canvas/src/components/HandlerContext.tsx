// apps/gis-canvas/src/components/HandlerContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { CanvasActions } from '../lib/handlers'

const NOOP: CanvasActions = {
  setLocalState: () => {},
  reportInteraction: () => {},
  sendPrompt: () => {}
}

const Ctx = createContext<CanvasActions>(NOOP)

export function HandlerProvider({ actions, children }: { actions: CanvasActions; children: ReactNode }) {
  return <Ctx.Provider value={actions}>{children}</Ctx.Provider>
}

export function useCanvasActions(): CanvasActions {
  return useContext(Ctx)
}
