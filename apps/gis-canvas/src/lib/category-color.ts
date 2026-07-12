// Deterministic, domain-agnostic mapping from an arbitrary category value (e.g. a
// row's category/status/type field) to one of the generic --color-cat-1..6 tokens
// defined in index.css. Deliberately has no knowledge of any specific domain's
// vocabulary — the agent may compose a table over any dataset.
const SLOTS = 6

export function categoryColorVar(value: string | number | null | undefined): string {
  const key = String(value ?? '')
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  const slot = (hash % SLOTS) + 1
  return `var(--color-cat-${slot})`
}
