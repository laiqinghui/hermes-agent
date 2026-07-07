export interface AuthState {
  authenticated: boolean
  username?: string
  roles?: string[]
}

export function resolveBffUrl(env: Record<string, string | undefined>): string {
  if (env.VITE_BFF_URL) return env.VITE_BFF_URL
  throw new Error('Set VITE_BFF_URL (e.g. http://localhost:9109) to enable auth.')
}

export function loginUrl(bffUrl: string): string {
  return `${bffUrl}/auth/login`
}

export async function authMe(bffUrl: string): Promise<AuthState> {
  const r = await fetch(`${bffUrl}/auth/me`, { credentials: 'include' })
  if (!r.ok) return { authenticated: false }
  return (await r.json()) as AuthState
}

export async function bindSessions(bffUrl: string, ids: string[]): Promise<void> {
  await fetch(`${bffUrl}/auth/bind`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvas_sessions: ids }),
  })
}

export async function logout(bffUrl: string): Promise<string> {
  const r = await fetch(`${bffUrl}/auth/logout`, { method: 'POST', credentials: 'include' })
  const data = (await r.json()) as { logout_url: string }
  return data.logout_url
}
