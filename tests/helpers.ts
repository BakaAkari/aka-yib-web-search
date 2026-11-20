import { vi } from 'vitest'
import { DeepSeekSearchClient } from '../src/client'
import type { ClientDependencies, Config } from '../src/types'

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export function errorResponse(status: number, body: unknown = { error: { message: 'boom', type: 'server_error', code: 'c1' } }, headers: Record<string, string> = {}) {
  return jsonResponse(body, status, headers)
}

export interface Harness {
  client: DeepSeekSearchClient
  fetchMock: ReturnType<typeof vi.fn>
  sleepMock: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
}

export function createHarness(config: Partial<Config> = {}, deps: Partial<ClientDependencies> = {}): Harness {
  const fetchMock = vi.fn()
  const sleepMock = vi.fn(async (_ms: number, _signal?: AbortSignal) => {})
  const warn = vi.fn()
  const client = new DeepSeekSearchClient(
    { apiKey: 'sk-test', ...config },
    { fetch: fetchMock as unknown as typeof globalThis.fetch, sleep: sleepMock, logger: { warn }, ...deps },
  )
  return { client, fetchMock, sleepMock, warn }
}

export function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): any {
  return JSON.parse(String(fetchMock.mock.calls[call][1].body))
}

export function hangUntilAbort(_url: string, init: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init.signal
    if (!signal) return
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })
}
