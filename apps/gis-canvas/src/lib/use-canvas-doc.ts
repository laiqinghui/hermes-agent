import { useEffect, useState } from 'react'
import { extractCanvasEnvelope } from './extract'
import type { CanvasDoc } from './types'

export interface CanvasEventSource {
  on(type: string, handler: (event: { type?: string; payload?: unknown }) => void): unknown
}

export function useCanvasDoc(client: CanvasEventSource): { doc: CanvasDoc | null; errors: string[] } {
  const [doc, setDoc] = useState<CanvasDoc | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
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

  return { doc, errors }
}
