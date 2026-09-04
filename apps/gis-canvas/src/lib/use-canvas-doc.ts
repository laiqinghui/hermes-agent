import { useEffect, useState } from 'react'
import { extractCanvasEnvelope } from './extract'
import type { CanvasDoc } from './types'

export interface CanvasEventSource {
  on(type: string, handler: (event: { type?: string; payload?: unknown }) => void): unknown
}

export function useCanvasDoc(client: CanvasEventSource): {
  doc: CanvasDoc | null
  errors: string[]
  /** Install a doc the app fetched itself (reopening a stored canvas). Live
   * agent renders still arrive through the tool.complete subscription below. */
  setDoc: (doc: CanvasDoc | null) => void
} {
  const [doc, setDoc] = useState<CanvasDoc | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    // NOTE: client doc.rev advances only on agent tool.complete renders, NOT on canvas.interaction
    // (interactions bump the SERVER rev but emit no event). This is intentional: the override-reset
    // below keys on doc.rev so optimistic interaction overlays survive until a real agent re-render.
    const off = client.on('tool.complete', event => {
      const env = extractCanvasEnvelope(event)
      if (!env) return
      if (env.ok && env.doc) {
        setDoc(env.doc)
        setErrors([])
      } else if (!env.ok) {
        setErrors(env.errors ?? ['canvas update failed'])
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [client])

  return { doc, errors, setDoc }
}
