// Distinct color per layer index for multi-layer maps. Prefers the themed
// --color-cat-1..6 tokens (so map colors match the app palette); falls back to a
// fixed hex palette when getComputedStyle can't resolve them (jsdom, or an
// uncomputed style), so ESRI always receives a concrete color.
const FALLBACK = ['#3b6fe0', '#c2831a', '#c22e4c', '#6b4fcb', '#1f9e7a', '#b5490f']

export function resolveLayerColor(index: number): string {
  const slot = ((index % 6) + 6) % 6 // 0..5, safe for negatives
  const fallback = FALLBACK[slot]
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const token = getComputedStyle(document.documentElement).getPropertyValue(`--color-cat-${slot + 1}`).trim()
  return token || fallback
}
