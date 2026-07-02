import { resolveWsUrl } from './gateway'

test('explicit full URL wins', () => {
  expect(resolveWsUrl({ VITE_HERMES_WS_URL: 'ws://x:1/api/ws?token=t' })).toBe('ws://x:1/api/ws?token=t')
})

test('token + default host compose a loopback URL', () => {
  expect(resolveWsUrl({ VITE_HERMES_TOKEN: 'abc' })).toBe('ws://127.0.0.1:9119/api/ws?token=abc')
})

test('missing config throws a helpful error', () => {
  expect(() => resolveWsUrl({})).toThrow(/VITE_HERMES_WS_URL/)
})
