// Derivation layer over App.tsx's existing flat gateway activity log.
// Splits one debug-log stream into what the redesigned agent panel actually
// needs: a conversation thread, and a build/tool-call trace.
export interface ActivityItem { id: number; kind: string; text: string; toolId?: string }
export interface ChatMessage { id: number; role: 'user' | 'agent'; text: string }
export interface BuildStep { id: number; label: string; status: 'running' | 'done' }
export interface DerivedActivity { messages: ChatMessage[]; trace: BuildStep[]; isBusy: boolean }

export function deriveActivity(items: ActivityItem[]): DerivedActivity {
  // message.delta chunks are superseded by the final message.complete text,
  // so only 'you' (the user's own prompt) and message.complete become bubbles.
  const messages: ChatMessage[] = items
    .filter(i => i.kind === 'you' || i.kind === 'message.complete')
    .map(i => ({ id: i.id, role: i.kind === 'you' ? 'user' : 'agent', text: i.text }))

  // tool.start/tool.complete pairing: prefer the gateway's real tool_id when
  // present (see tui_gateway/server.py _on_tool_start/_on_tool_complete),
  // falling back to FIFO-by-name for any item that lacks one.
  const trace: BuildStep[] = []
  const openById = new Map<string, BuildStep>()
  const openByName: BuildStep[] = []

  for (const item of items) {
    if (item.kind === 'tool.start') {
      const step: BuildStep = { id: item.id, label: item.text, status: 'running' }
      trace.push(step)
      if (item.toolId) openById.set(item.toolId, step)
      else openByName.push(step)
    } else if (item.kind === 'tool.complete') {
      let step: BuildStep | undefined
      if (item.toolId && openById.has(item.toolId)) {
        step = openById.get(item.toolId)
        openById.delete(item.toolId)
      } else {
        const idx = openByName.findIndex(s => s.label === item.text)
        if (idx !== -1) { step = openByName[idx]; openByName.splice(idx, 1) }
      }
      if (step) step.status = 'done'
    }
  }

  return { messages, trace: trace.slice(-8), isBusy: trace.some(s => s.status === 'running') }
}
