import type { CanvasEnvelope } from './types'

function asEnvelope(value: unknown): CanvasEnvelope | null {
  if (value && typeof value === 'object' && (value as Record<string, unknown>).gis_canvas === true) {
    return value as CanvasEnvelope
  }
  return null
}

function parseCandidate(value: unknown): CanvasEnvelope | null {
  if (typeof value === 'string') {
    try {
      return asEnvelope(JSON.parse(value))
    } catch {
      return null
    }
  }
  return asEnvelope(value)
}

/**
 * Recognize canvas tool results on tool.complete events by the gis_canvas
 * marker — field-name agnostic (checks the payload and each direct value).
 */
export function extractCanvasEnvelope(event: { type?: string; payload?: unknown }): CanvasEnvelope | null {
  if (event?.type !== 'tool.complete') return null
  const payload = event.payload
  if (!payload || typeof payload !== 'object') return null
  const direct = asEnvelope(payload)
  if (direct) return direct
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const env = parseCandidate(value)
    if (env) return env
  }
  return null
}
