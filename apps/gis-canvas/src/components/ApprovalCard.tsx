import type { PendingApproval, ApprovalChoice } from '../lib/approval'

// A pinned, attention-styled card shown when the agent needs approval to run a
// gated command (e.g. execute_code). Without a response the tool blocks until
// it times out, so this stays visible outside the scrolling transcript.
export function ApprovalCard({ approval, onRespond }: { approval: PendingApproval; onRespond: (choice: ApprovalChoice) => void }) {
  return (
    <div className="rounded-gc-md border border-accent bg-accent/5 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-accent" style={{ animation: 'gc-pulse-dot 1.6s ease-in-out infinite' }} />
        <span className="font-mono text-[10px] uppercase tracking-wide text-accent">Approval needed</span>
      </div>
      {approval.description ? <div className="mb-1 font-sans text-[12px] text-primary">{approval.description}</div> : null}
      <pre className="mb-2.5 max-h-32 overflow-auto rounded-gc-sm bg-surface-raised p-2 font-mono text-[10.5px] text-primary">{approval.command}</pre>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onRespond('once')} className="rounded-gc-sm bg-accent px-3 py-1.5 font-sans text-[12px] font-semibold text-accent-fg">
          Approve
        </button>
        <button type="button" onClick={() => onRespond('session')} className="rounded-gc-sm border border-accent px-3 py-1.5 font-sans text-[12px] text-accent hover:bg-accent/10">
          Approve for session
        </button>
        <button type="button" onClick={() => onRespond('deny')} className="rounded-gc-sm border border-negative/50 px-3 py-1.5 font-sans text-[12px] text-negative hover:bg-negative/10">
          Deny
        </button>
      </div>
    </div>
  )
}
