// A pending command-approval request from the gateway (approval.request event).
// The gateway gates dangerous tools (e.g. execute_code) behind an approval the
// user must answer; without a response the tool blocks until it times out.
export type ApprovalChoice = 'once' | 'session' | 'deny'

export interface PendingApproval {
  command: string          // already redacted by the gateway
  description?: string
  patternKeys?: string[]
}

/** Map an `approval.request` payload into a PendingApproval. */
export function approvalFromEvent(payload: Record<string, unknown> | undefined): PendingApproval {
  const p = payload ?? {}
  const out: PendingApproval = { command: typeof p.command === 'string' ? p.command : '' }
  if (typeof p.description === 'string') out.description = p.description
  if (Array.isArray(p.pattern_keys)) {
    const keys = p.pattern_keys.filter((x): x is string => typeof x === 'string')
    if (keys.length) out.patternKeys = keys
  }
  return out
}
