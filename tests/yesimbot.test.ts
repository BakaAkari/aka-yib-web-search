import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'koishi'
import { createChannelAgentPlugin, createYesImBotTools, registerYesImBot } from '../src/yesimbot'
import type { AkaYibWebSearchService } from '../src/service'

function createService(impl?: Partial<AkaYibWebSearchService>) {
  return {
    search: vi.fn(async () => ({ ok: true, provider: 'deepseek', query: 'q', results: [] })),
    fetch: vi.fn(async () => ({ ok: true, provider: 'deepseek', url: 'https://example.com/', title: '', content: '', truncated: false })),
    ...impl,
  } as unknown as AkaYibWebSearchService
}

describe('createYesImBotTools', () => {
  it('exposes web_search and web_fetch with descriptions and schemas', () => {
    const tools = createYesImBotTools(createService())

    expect(Object.keys(tools).sort()).toEqual(['web_fetch', 'web_search'])
    expect(tools.web_search.description).toContain('Search the web')
    expect(tools.web_fetch.description).toContain('webpage')
    expect(tools.web_search.inputSchema).toBeDefined()
    expect(tools.web_fetch.inputSchema).toBeDefined()
  })

  it('forwards search input and the abortSignal', async () => {
    const service = createService()
    const tools = createYesImBotTools(service)
    const controller = new AbortController()

    const result = await tools.web_search.execute({ query: 'q', count: 3 }, { abortSignal: controller.signal })

    expect(service.search).toHaveBeenCalledWith({ query: 'q', count: 3 }, controller.signal)
    expect(result).toEqual({ ok: true, provider: 'deepseek', query: 'q', results: [] })
  })

  it('forwards fetch input and the abortSignal', async () => {
    const service = createService()
    const tools = createYesImBotTools(service)
    const controller = new AbortController()

    await tools.web_fetch.execute({ url: 'https://example.com/' }, { abortSignal: controller.signal })

    expect(service.fetch).toHaveBeenCalledWith({ url: 'https://example.com/' }, controller.signal)
  })

  it('works without an options argument', async () => {
    const service = createService()
    const tools = createYesImBotTools(service)

    await tools.web_search.execute({ query: 'q' })

    expect(service.search).toHaveBeenCalledWith({ query: 'q' }, undefined)
  })

  it('isolates thrown service errors into a structured failure', async () => {
    const service = createService({
      search: vi.fn(async () => { throw new Error('boom') }),
      fetch: vi.fn(async () => { throw new Error('boom') }),
    })
    const tools = createYesImBotTools(service)

    await expect(tools.web_search.execute({ query: 'q' })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_response', message: '联网工具执行失败。', retryable: false },
    })
    await expect(tools.web_fetch.execute({ url: 'https://example.com/' })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_response', message: '联网工具执行失败。', retryable: false },
    })
  })
})

describe('createChannelAgentPlugin', () => {
  it('registers the channel plugin name, tools and instructions', () => {
    const plugin = createChannelAgentPlugin(createService())

    expect(plugin.name).toBe('aka-yib-web-search')
    const tools = plugin.extendTools()
    expect(Object.keys(tools).sort()).toEqual(['web_fetch', 'web_search'])
    const instructions = plugin.extendInstructions()
    expect(instructions).toContain('web_search')
    expect(instructions).toContain('web_fetch')
  })
})

describe('registerYesImBot', () => {
  function createCtx(options: {
    yesimbot?: unknown
    useResult?: unknown
    useThrows?: boolean
  } = {}) {
    const dispose = vi.fn()
    const use = vi.fn(() => {
      if (options.useThrows) throw new Error('registration exploded')
      return options.useResult === undefined ? dispose : options.useResult
    })
    const warnings: string[] = []
    const injected = {
      yesimbot: options.yesimbot === undefined ? { agent: { use } } : options.yesimbot,
      logger: () => ({ warn: (message: string) => warnings.push(message) }),
      on: vi.fn(),
    }
    const inject = vi.fn((_deps: string[], callback: (ctx: unknown) => void) => {
      callback(injected)
      return { kind: 'fiber' }
    })
    const ctx = { inject } as unknown as Context
    return { ctx, inject, injected, use, dispose, warnings }
  }

  it('registers a channel plugin whose setup returns the tools and instructions', () => {
    const state = createCtx()

    registerYesImBot(state.ctx, createService())

    expect(state.inject).toHaveBeenCalledTimes(1)
    expect(state.inject.mock.calls[0][0]).toEqual(['yesimbot'])
    expect(state.use).toHaveBeenCalledTimes(1)
    const plugin = state.use.mock.calls[0][0] as { setup: () => ReturnType<typeof createChannelAgentPlugin> }
    const built = plugin.setup()
    expect(built.name).toBe('aka-yib-web-search')
    expect(Object.keys(built.extendTools()).sort()).toEqual(['web_fetch', 'web_search'])
    expect(typeof built.extendInstructions()).toBe('string')
  })

  it('wires the registered tools to the given service', async () => {
    const state = createCtx()
    const service = createService()

    registerYesImBot(state.ctx, service)

    const plugin = state.use.mock.calls[0][0] as { setup: () => ReturnType<typeof createChannelAgentPlugin> }
    const tools = plugin.setup().extendTools()
    const controller = new AbortController()
    await tools.web_search.execute({ query: 'q' }, { abortSignal: controller.signal })
    await tools.web_fetch.execute({ url: 'https://example.com/' }, { abortSignal: controller.signal })

    expect(service.search).toHaveBeenCalledWith({ query: 'q' }, controller.signal)
    expect(service.fetch).toHaveBeenCalledWith({ url: 'https://example.com/' }, controller.signal)
  })

  it('unregisters the channel plugin on dispose', () => {
    const state = createCtx()

    registerYesImBot(state.ctx, createService())

    expect(state.injected.on).toHaveBeenCalledWith('dispose', expect.any(Function))
    expect(state.dispose).not.toHaveBeenCalled()
    const handler = state.injected.on.mock.calls[0][1] as () => void
    handler()
    expect(state.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not register a dispose handler when use returns nothing', () => {
    const state = createCtx({ useResult: undefined })
    state.use.mockReturnValue(undefined)

    expect(() => registerYesImBot(state.ctx, createService())).not.toThrow()
    expect(state.injected.on).not.toHaveBeenCalled()
  })

  it('does nothing beyond a warning when yesimbot is unavailable', () => {
    const state = createCtx({ yesimbot: {} })

    expect(() => registerYesImBot(state.ctx, createService())).not.toThrow()
    expect(state.warnings).toEqual(['event=yesimbot_bridge_unavailable reason=missing_agent_use'])
  })

  it('does nothing beyond a warning when agent.use is not a function', () => {
    const state = createCtx({ yesimbot: { agent: { use: 'nope' } } })

    expect(() => registerYesImBot(state.ctx, createService())).not.toThrow()
    expect(state.warnings).toEqual(['event=yesimbot_bridge_unavailable reason=missing_agent_use'])
  })

  it('swallows registration errors and warns', () => {
    const state = createCtx({ useThrows: true })

    expect(() => registerYesImBot(state.ctx, createService())).not.toThrow()
    expect(state.warnings).toEqual(['event=yesimbot_bridge_registration_failed'])
    expect(state.injected.on).not.toHaveBeenCalled()
  })
})
