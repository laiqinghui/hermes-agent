// apps/gis-canvas/src/lib/handlers.ts
import type { ComponentNode, Handler } from './types'
import type { DataPage } from './data-plane'

export interface CanvasActions {
  /** Optimistic local state change (instant re-render). */
  setLocalState(id: string, patch: Record<string, unknown>): void
  /** Local change + record server-side (canvas.interaction) for agent awareness. */
  reportInteraction(id: string, patch: Record<string, unknown>): void
  /** Trigger an agent turn. */
  sendPrompt(text: string): void
  /** Pull a page of rows from the data plane by handle (canvas.data_fetch). */
  fetchData(handle: string, opts?: { page?: number; pageSize?: number; filter?: Record<string, string>; fields?: string[] }): Promise<DataPage>
}

export interface HandlerEvent {
  value?: unknown
}

/** Execute a component handler. `event.value` is the control's new value. */
export function runHandler(
  handler: Handler,
  node: ComponentNode,
  actions: CanvasActions,
  event: HandlerEvent
): void {
  switch (handler.kind) {
    case 'set':
      actions.reportInteraction(handler.target, { [handler.key]: handler.value })
      return
    case 'reactive': {
      // controls path: "targetId.key" or "targetId.key.subkey"
      const [target, key, subkey] = handler.controls.split('.')
      if (!target || !key) return
      const patch = subkey ? { [key]: { [subkey]: event.value } } : { [key]: event.value }
      actions.reportInteraction(target, patch)
      return
    }
    case 'agent':
      actions.sendPrompt(handler.prompt)
      return
    case 'open':
      // Reserved for the overlay layer (Phase 3+ overlays). No runtime effect yet;
      // schema permits it (validated to require `overlay`). Implement when overlays land.
      return
  }
}
