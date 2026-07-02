import { useState } from 'react'

export interface ActivityItem { id: number; kind: string; text: string }

export function Chat({
  activity,
  errors,
  onSend,
  connected
}: {
  activity: ActivityItem[]
  errors: string[]
  onSend: (text: string) => void
  connected: boolean
}) {
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50">
      <div className="border-b border-neutral-200 px-3 py-2 text-sm font-semibold">
        Agent {connected ? '● connected' : '○ connecting…'}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto p-3 text-xs">
        {activity.map(item => (
          <div key={item.id}>
            <span className="font-mono text-neutral-400">[{item.kind}]</span> {item.text}
          </div>
        ))}
        {errors.map((e, i) => (
          <div key={`err-${i}`} className="text-red-600">canvas error: {e}</div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-neutral-200 p-2">
        <input
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          value={text}
          placeholder="Ask the agent to build a dashboard…"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={submit} disabled={!connected}>
          Send
        </button>
      </div>
    </div>
  )
}
