import { describe, expect, it, vi } from 'vitest'

vi.mock('koishi', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  return { h: require('koishi').h }
})

import { h, type Context } from 'koishi'
import { registerCommands } from '../src/commands'
import type { AkaYibWebSearchService } from '../src/service'
import { defaultConfig } from '../src/types'
import type { Config } from '../src/types'

interface RegisteredCommand {
  description?: string
  config?: Record<string, unknown>
  options: Array<{ name: string, definition: string }>
  action?: (argv: { options: Record<string, unknown> }, ...args: unknown[]) => Promise<unknown>
}

function createCommandCtx() {
  const commands = new Map<string, RegisteredCommand>()
  const ctx = {
    command(name: string, description?: string, cmdConfig?: Record<string, unknown>) {
      const entry: RegisteredCommand = { description, config: cmdConfig, options: [] }
      commands.set(name.trim().split(/\s+/)[0], entry)
      const chain: any = {
        option(name: string, definition: string) {
          entry.options.push({ name, definition })
          return chain
        },
        action(fn: RegisteredCommand['action']) {
          entry.action = fn
          return chain
        },
      }
      return chain
    },
  } as unknown as Context
  return { ctx, commands }
}

function createService(overrides: Partial<AkaYibWebSearchService> = {}) {
  return {
    search: vi.fn(async () => ({ ok: true, provider: 'deepseek', query: 'q', results: [] })),
    fetch: vi.fn(async () => ({ ok: true, provider: 'deepseek', url: '', title: '', content: '', truncated: false })),
    ...overrides,
  } as unknown as AkaYibWebSearchService
}

function expectTextElement(output: unknown, expected: string) {
  expect(output).toEqual(h.text(expected))
  const element = output as h
  expect(element.type).toBe('text')
  expect(element.attrs.content).toBe(expected)
  expect(element.children).toEqual([])
}

const config: Config = { ...defaultConfig, apiKey: 'sk', commandAuthority: 2 }

describe('registerCommands', () => {
  it('registers websearch and webfetch with authority and options', () => {
    const { ctx, commands } = createCommandCtx()

    registerCommands(ctx, createService(), config)

    expect([...commands.keys()]).toEqual(['websearch', 'webfetch'])
    expect(commands.get('websearch')!.config).toEqual({ authority: 2 })
    expect(commands.get('webfetch')!.config).toEqual({ authority: 2 })
    expect(commands.get('websearch')!.options).toEqual([
      { name: 'count', definition: '-n <count:number> 返回数量' },
      { name: 'content', definition: '-c, --content 包含网页正文' },
    ])
    expect(commands.get('webfetch')!.options).toEqual([])
  })

  it('does nothing when commands are disabled', () => {
    const { ctx, commands } = createCommandCtx()

    registerCommands(ctx, createService(), { ...config, enableCommands: false })

    expect(commands.size).toBe(0)
  })
})

describe('websearch command', () => {
  async function run(argv: { options: Record<string, unknown> }, query: unknown) {
    const { ctx, commands } = createCommandCtx()
    const service = createService()
    registerCommands(ctx, service, config)
    const output = await commands.get('websearch')!.action!(argv, query)
    return { output, service }
  }

  it('formats successful results as escaped text elements with numbering, title, url, summary and content', async () => {
    const { ctx, commands } = createCommandCtx()
    const service = createService({
      search: vi.fn(async () => ({
        ok: true,
        provider: 'deepseek',
        query: 'q',
        results: [
          { url: 'https://a.test/', title: 'A', summary: 'sum-a', content: 'body-a', truncated: false },
          { url: 'https://b.test/', title: '', summary: 'sum-b', truncated: false },
        ],
      })),
    } as never)
    registerCommands(ctx, service, config)

    const output = await commands.get('websearch')!.action!({ options: {} }, 'q')

    expectTextElement(output, [
      '1. A',
      'https://a.test/',
      'sum-a',
      'body-a',
      '',
      '2. https://b.test/',
      'https://b.test/',
      'sum-b',
    ].join('\n'))
  })

  it('prevents Satori element injection and preserves angle-bracket markdown in websearch output', async () => {
    const { ctx, commands } = createCommandCtx()
    const payload = '<at type="all"/><img src="file:///etc/passwd"/><execute>help</execute> Array<string> <https://example.com>'
    const service = createService({
      search: vi.fn(async () => ({
        ok: true,
        provider: 'deepseek',
        query: 'q',
        results: [{ url: 'https://a.test/', title: payload, summary: payload, content: payload, truncated: false }],
      })),
    } as never)
    registerCommands(ctx, service, config)

    const output = await commands.get('websearch')!.action!({ options: {} }, 'q') as h

    const expected = `1. ${payload}\nhttps://a.test/\n${payload}\n${payload}`
    expectTextElement(output, expected)
    const serialized = output.toString()
    expect(serialized).not.toContain('<at ')
    expect(serialized).not.toContain('<img ')
    expect(serialized).not.toContain('<execute>')
    expect(h.parse(serialized)).toEqual([h.text(expected)])
  })

  it('passes count and content options through to the service', async () => {
    const { ctx, commands } = createCommandCtx()
    const service = createService({
      search: vi.fn(async () => ({ ok: true, provider: 'deepseek', query: 'q', results: [] })),
    } as never)
    registerCommands(ctx, service, config)

    await commands.get('websearch')!.action!({ options: { count: 3, content: true } }, 'query text')

    expect(service.search).toHaveBeenCalledWith({ query: 'query text', count: 3, need_content: true })
  })

  it('reports when no results remain', async () => {
    const { output } = await run({ options: {} }, 'q')
    expectTextElement(output, '未找到符合条件的搜索结果。')
  })

  it('formats structured failures as plain text elements', async () => {
    const { ctx, commands } = createCommandCtx()
    const service = createService({
      search: vi.fn(async () => ({
        ok: false,
        error: { code: 'rate_limited', message: '请求过快 <at type="all"/>', retryable: true },
      })),
    } as never)
    registerCommands(ctx, service, config)

    const output = await commands.get('websearch')!.action!({ options: {} }, 'q')

    expectTextElement(output, '[rate_limited] 请求过快 <at type="all"/>')
  })

  it('returns usage text for a blank query without calling the service', async () => {
    const { ctx, commands } = createCommandCtx()
    const service = createService()
    registerCommands(ctx, service, config)

    for (const query of [undefined, '', '   ']) {
      const output = await commands.get('websearch')!.action!({ options: {} }, query)
      expectTextElement(output, '用法：websearch [-n 数量] [-c] <关键词>')
    }
    expect(service.search).not.toHaveBeenCalled()
  })
})

describe('webfetch command', () => {
  function setup(result: unknown) {
    const { ctx, commands } = createCommandCtx()
    const service = createService({ fetch: vi.fn(async () => result) } as never)
    registerCommands(ctx, service, config)
    return { commands, service }
  }

  it('formats a successful fetch as a text element with title, url, content', async () => {
    const { commands } = setup({
      ok: true,
      provider: 'deepseek',
      url: 'https://example.com/',
      title: 'Title',
      content: 'Body',
      truncated: false,
    })

    const output = await commands.get('webfetch')!.action!({ options: {} }, 'https://example.com/')

    expectTextElement(output, 'Title\nhttps://example.com/\nBody')
  })

  it('escapes Satori tags and preserves generics in fetched webpage content', async () => {
    const payload = '<at type="all"/><img src="file:///etc/passwd"/> Promise<Array<string>>'
    const { commands } = setup({
      ok: true,
      provider: 'deepseek',
      url: 'https://example.com/',
      title: '<execute>rm</execute>',
      content: payload,
      truncated: false,
    })

    const output = await commands.get('webfetch')!.action!({ options: {} }, 'https://example.com/') as h

    const expected = `<execute>rm</execute>\nhttps://example.com/\n${payload}`
    expectTextElement(output, expected)
    expect(h.parse(output.toString())).toEqual([h.text(expected)])
  })

  it('omits empty title fields', async () => {
    const { commands } = setup({
      ok: true, provider: 'deepseek', url: 'https://example.com/', title: '', content: 'Body', truncated: false,
    })

    const output = await commands.get('webfetch')!.action!({ options: {} }, 'https://example.com/')

    expectTextElement(output, 'https://example.com/\nBody')
  })

  it('formats structured failures', async () => {
    const { commands } = setup({
      ok: false,
      error: { code: 'invalid_input', message: 'URL 无效。', retryable: false },
    })

    const output = await commands.get('webfetch')!.action!({ options: {} }, 'ftp://x')

    expectTextElement(output, '[invalid_input] URL 无效。')
  })

  it('returns usage text for a missing or blank url without calling the service', async () => {
    const { commands, service } = setup({ ok: true, provider: 'deepseek', url: '', title: '', content: '', truncated: false })

    for (const url of [undefined, '', '   ']) {
      const output = await commands.get('webfetch')!.action!({ options: {} }, url)
      expectTextElement(output, '用法：webfetch <HTTP/HTTPS URL>')
    }
    expect(service.fetch).not.toHaveBeenCalled()
  })
})
