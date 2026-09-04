/** Read-only session browsing, proxied by the BFF (which holds the OIDC
 * session). Nothing here may mutate a session — see the design's constraint. */

export interface SessionRow {
  id: string
  source: string
  /** Set when this session was forked from another (see canvas.branch). The API
   * returns it; grouping in the picker resolves families from it. */
  parent_session_id?: string | null
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

/** Session management. Unlike listSessions these THROW on failure: they are
 * deliberate user actions, and a silently swallowed delete would be a lie. */
async function mutate(url: string, init: RequestInit, what: string): Promise<void> {
  const r = await fetch(url, { credentials: 'include', ...init })
  if (!r.ok) throw new Error(`Could not ${what} (${r.status})`)
}

export async function renameSession(bffUrl: string, id: string, title: string): Promise<void> {
  await mutate(`${bffUrl}/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }, 'rename this session')
}

export async function setArchived(bffUrl: string, id: string, archived: boolean): Promise<void> {
  // Send ONLY `archived`: a title of null would clear the session's title.
  await mutate(`${bffUrl}/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  }, 'archive this session')
}

export async function deleteSession(bffUrl: string, id: string): Promise<void> {
  await mutate(`${bffUrl}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' },
    'delete this session')
}
