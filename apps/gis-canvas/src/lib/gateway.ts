import { JsonRpcGatewayClient } from '@hermes/shared'

/**
 * Dev connection config:
 *   VITE_HERMES_WS_URL  full URL, e.g. ws://127.0.0.1:9119/api/ws?token=dev-gis-local
 *   VITE_HERMES_TOKEN   just the token (host defaults to ws://127.0.0.1:9119/api/ws)
 */
export function resolveWsUrl(env: Record<string, string | undefined>): string {
  if (env.VITE_HERMES_WS_URL) return env.VITE_HERMES_WS_URL
  if (env.VITE_HERMES_TOKEN) return `ws://127.0.0.1:9119/api/ws?token=${env.VITE_HERMES_TOKEN}`
  throw new Error(
    'Set VITE_HERMES_WS_URL (full ws URL incl. ?token=) or VITE_HERMES_TOKEN. ' +
      'Start the backend with: HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes dashboard --no-open --port 9119'
  )
}

export function createGatewayClient(): JsonRpcGatewayClient {
  return new JsonRpcGatewayClient()
}
