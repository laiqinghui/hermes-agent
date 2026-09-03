/** Read-only session browsing, proxied by the BFF (which holds the OIDC
 * session). Nothing here may mutate a session — see the design's constraint. */

export interface SessionRow {
  id: string
  source: string
  title: string
  preview: string
  message_count: number
  started_at: number
  last_active: number
}

/** One row of the gateway's `messages` table. All content fields are UNTRUSTED
 * — they come from other surfaces and other users. Render as text only. */
export interface MessageRow {
  role: string
  content: string | null
  tool_calls?: string | null
  tool_call_id?: string | null
  tool_name?: string | null
  reasoning?: string | null
  reasoning_content?: string | null
  timestamp?: number
}

/** Sessions visible to the signed-in user. Failure degrades to an empty list:
 * a picker with no rows is a usable state, an exception at open time is not. */
export async function listSessions(bffUrl: string): Promise<SessionRow[]> {
  try {
    const r = await fetch(`${bffUrl}/sessions`, { credentials: 'include' })
    if (!r.ok) return []
    const body = (await r.json()) as { sessions?: SessionRow[] }
    return body.sessions ?? []
  } catch {
    return []
  }
}

/** Full transcript for one session. Throws on failure — the user explicitly
 * asked for THIS session, so a silent empty transcript would be a lie. */
export async function fetchTranscript(bffUrl: string, id: string): Promise<MessageRow[]> {
  const r = await fetch(`${bffUrl}/sessions/${encodeURIComponent(id)}/messages`, { credentials: 'include' })
  if (!r.ok) throw new Error(`Could not load transcript for session ${id} (${r.status})`)
  const body = (await r.json()) as { messages?: MessageRow[] }
  return body.messages ?? []
}
