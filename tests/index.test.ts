import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ services: [] as any[] }))

vi.mock('koishi', () => {
  class Service {
    ctx: any
    name?: string
    immediate?: boolean
    constructor(ctx: any, name?: string, immediate?: boolean) {
      this.ctx = ctx
      this.name = name
      this.immediate = immediate
      hoisted.services.push(this)
    }
  }
  const chain = () => {
    const schema: any = () => schema
    for (const key of ['role', 'default', 'description', 'step', 'min', 'max']) schema[key] = () => schema
    return schema
  }
  const Schema: any = () => chain()
  Schema.string = () => chain()
  Schema.number = () => chain()
  Schema.boolean = () => chain()
  Schema.array = () => chain()
  Schema.object = () => chain()
  return { Service, Schema }
})

import * as plugin from '../src/index'
import { defaultConfig } from '../src/types'

const { apply, Config, inject, name } = plugin

function createCtx() {
  const commands: string[] = []
  const injected: string[][] = []
  const ctx = {
    logger: () => ({ warn: () => undefined }),
    command(commandName: string) {
      commands.push(commandName.split(/\s+/)[0])
      const chain: any = {
        option: () => chain,
        action: () => chain,
      }
      return chain
    },
    inject(deps: string[]) {
      injected.push(deps)
      return { kind: 'fiber' }
    },
    set: () => undefined,
    on: () => undefined,
  }
  return { ctx: ctx as any, commands, injected }
}

beforeEach(() => { hoisted.services.length = 0 })

describe('plugin metadata', () => {
  it('exports the expected name, required yesimbot inject declaration and config schema', () => {
    expect(name).toBe('aka-yib-web-search')
    expect(inject).toEqual(['yesimbot'])
    expect(Config).toBeDefined()
  })
})

describe('apply', () => {
  it('merges defaults, creates the service, and registers commands and the bridge', () => {
    const { ctx, commands, injected } = createCtx()

    apply(ctx, { apiKey: 'sk-test' } as never)

    expect(hoisted.services).toHaveLength(1)
    const service = hoisted.services[0]
    expect(service.name).toBe('akaYibWebSearch')
    expect(service.client.config.apiKey).toBe('sk-test')
    expect(service.client.config.timeoutMs).toBe(defaultConfig.timeoutMs)
    expect(service.client.config.maxRetries).toBe(defaultConfig.maxRetries)
    expect(commands).toEqual(['websearch', 'webfetch'])
    expect(injected).toEqual([['yesimbot']])
  })

  it('skips commands when enableCommands is false', () => {
    const { ctx, commands } = createCtx()

    apply(ctx, { apiKey: 'sk', enableCommands: false } as never)

    expect(commands).toEqual([])
  })

  it('skips the YesImBot bridge when yesimbotEnabled is false', () => {
    const { ctx, injected } = createCtx()

    apply(ctx, { apiKey: 'sk', yesimbotEnabled: false } as never)

    expect(injected).toEqual([])
  })

  it('always exposes a fully resolved config to the service', () => {
    const { ctx } = createCtx()
    const overrides = { apiKey: 'sk', defaultLimit: 3, maxLimit: 7, blacklist: ['spam'] }

    apply(ctx, overrides as never)

    expect(hoisted.services[0].client.config).toMatchObject({
      ...defaultConfig,
      ...overrides,
    })
  })
})
