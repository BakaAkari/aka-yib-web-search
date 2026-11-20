import { describe, expect, it, vi } from 'vitest'

vi.mock('koishi', () => ({
  Service: class {
    ctx: unknown
    constructor(ctx: unknown) {
      this.ctx = ctx
    }
  },
}))

import { AkaYibWebSearchService } from '../src/service'
import { DeepSeekSearchClient } from '../src/client'
import { jsonResponse } from './helpers'

function createCtx() {
  const warnings: string[] = []
  const ctx = {
    logger: () => ({ warn: (message: string) => warnings.push(message) }),
    set: () => undefined,
  }
  return { ctx: ctx as never, warnings }
}

function createService(config: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
  const { ctx, warnings } = createCtx()
  const service = new AkaYibWebSearchService(
    ctx,
    { apiKey: 'sk-test', ...config } as never,
    { fetch: fetchMock as unknown as typeof globalThis.fetch, sleep: async () => {} },
  )
  return { ctx, service, fetchMock, warnings }
}

describe('AkaYibWebSearchService', () => {
  it('builds a client from the plugin config with defaults filled in', () => {
    const { service } = createService({ baseUrl: 'https://api.example.com', maxRetries: 0 })

    expect(service.client).toBeInstanceOf(DeepSeekSearchClient)
    expect(service.client.config).toMatchObject({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      maxRetries: 0,
      timeoutMs: 15000,
    })
  })

  it('delegates search to the client', async () => {
    const { service, fetchMock } = createService()

    const result = await service.search({ query: 'hello' })

    expect(result).toEqual({ ok: true, provider: 'deepseek', query: 'hello', results: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/tools/search')
  })

  it('delegates fetch to the client', async () => {
    const { service, fetchMock } = createService()
    fetchMock.mockResolvedValue(jsonResponse({ title: 'T', content: 'Body' }) as never)

    const result = await service.fetch({ url: 'https://example.com/' })

    expect(result).toMatchObject({ ok: true, title: 'T', content: 'Body' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/tools/fetch')
  })

  it('forwards the abort signal to the client', async () => {
    const { service } = createService()
    const controller = new AbortController()
    controller.abort()

    const result = await service.search({ query: 'q' }, controller.signal)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('aborted')
  })

  it('passes the injected logger to the client so invalid blacklist regexes warn', () => {
    const { service, warnings } = createService({ blacklist: ['['] })

    expect(service.client.config.blacklist).toEqual(['['])
    expect(warnings).toEqual(['event=invalid_blacklist_regex action=ignored'])
  })
})
