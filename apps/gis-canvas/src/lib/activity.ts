// Derivation layer over App.tsx's gateway activity log. Splits one ordered event
// stream into what the AgentPanel needs: a conversation thread, an enriched
// tool-call trace (with inputs/outputs the gateway already sends), the agent's
// reasoning, and a chronological timeline for the verbose inspector.
export interface ActivityItem {
  id: number
  kind: string
  text: string
  toolId?: string
  name?: string
  context?: string
  args?: unknown
  result?: unknown
  summary?: string
  durationS?: number
}
export interface ChatMessage { id: number; role: 'user' | 'agent'; text: string }
export interface ReasoningItem { id: number; text: string }
export interface BuildStep {
  id: number
  label: string
  status: 'running' | 'done'
  context?: string
  args?: unknown
  result?: unknown
  summary?: string
  durationS?: number
}
export type TimelineEvent =
  | { id: number; kind: 'reasoning'; text: string }
  | { id: number; kind: 'tool'; step: BuildStep }
  | { id: number; kind: 'message'; role: 'user' | 'agent'; text: string }
  | { id: number; kind: 'error'; text: string }
export interface DerivedActivity {
  messages: ChatMessage[]
  trace: BuildStep[]
  reasoning: ReasoningItem[]
  timeline: TimelineEvent[]
  isBusy: boolean
}

/** Map a raw gateway event into an ActivityItem (id is assigned by the caller).
 * Keeps the structured tool/reasoning fields the gateway already sends. */
export function activityItemFromEvent(kind: string, payload: Record<string, unknown> | undefined): Omit<ActivityItem, 'id'> {
  const p = payload ?? {}
  const name = typeof p.name === 'string' ? p.name : undefined
  const safeFallback = () => { try { return JSON.stringify(p).slice(0, 160) } catch { return String(p).slice(0, 160) } }
  const text = typeof p.text === 'string' ? p.text : (name ?? safeFallback())
  const item: Omit<ActivityItem, 'id'> = { kind, text }
  if (typeof p.tool_id === 'string') item.toolId = p.tool_id
  if (name) item.name = name
  if (typeof p.context === 'string') item.context = p.context
  if ('args' in p) item.args = p.args
  if ('result' in p) item.result = p.result
  if (typeof p.summary === 'string') item.summary = p.summary
  if (typeof p.duration_s === 'number') item.durationS = p.duration_s
  return item
}

export function deriveActivity(items: ActivityItem[]): DerivedActivity {
  const messages: ChatMessage[] = []
  const reasoning: ReasoningItem[] = []
  const trace: BuildStep[] = []
  const timeline: TimelineEvent[] = []
  const openById = new Map<string, BuildStep>()
  const openByName: BuildStep[] = []

  for (const item of items) {
    switch (item.kind) {
      case 'you':
        messages.push({ id: item.id, role: 'user', text: item.text })
        timeline.push({ id: item.id, kind: 'message', role: 'user', text: item.text })
        break
      case 'message.complete':
        messages.push({ id: item.id, role: 'agent', text: item.text })
        timeline.push({ id: item.id, kind: 'message', role: 'agent', text: item.text })
        break
      case 'reasoning.available':
        reasoning.push({ id: item.id, text: item.text })
        timeline.push({ id: item.id, kind: 'reasoning', text: item.text })
        break
      case 'tool.start': {
        const step: BuildStep = { id: item.id, label: item.name ?? item.text, status: 'running', context: item.context }
        trace.push(step)
        timeline.push({ id: item.id, kind: 'tool', step })
        if (item.toolId) openById.set(item.toolId, step)
        else openByName.push(step)
        break
      }
      case 'tool.complete': {
        const label = item.name ?? item.text
        let step: BuildStep | undefined
        if (item.toolId && openById.has(item.toolId)) {
          step = openById.get(item.toolId); openById.delete(item.toolId)
        } else {
          const idx = openByName.findIndex(s => s.label === label)
          if (idx !== -1) { step = openByName[idx]; openByName.splice(idx, 1) }
        }
        // Unmatched completion (its tool.start was evicted from the buffer or never seen):
        // nothing to enrich, so drop it silently.
        if (step) {
          step.status = 'done'
          step.args = item.args
          step.result = item.result
          step.summary = item.summary
          step.durationS = item.durationS
          if (item.context) step.context = item.context
        }
        break
      }
      case 'error':
        timeline.push({ id: item.id, kind: 'error', text: item.text })
        break
    }
  }

  return { messages, trace: trace.slice(-8), reasoning, timeline, isBusy: trace.some(s => s.status === 'running') }
}
