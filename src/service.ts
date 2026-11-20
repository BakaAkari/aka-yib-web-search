import { Context, Service } from 'koishi'
import { DeepSeekSearchClient } from './client'
import type { ClientDependencies, Config, FetchInput, SearchInput } from './types'

declare module 'koishi' {
  interface Context { akaYibWebSearch: AkaYibWebSearchService }
}

export class AkaYibWebSearchService extends Service {
  readonly client: DeepSeekSearchClient

  constructor(ctx: Context, config: Partial<Config> = {}, dependencies: ClientDependencies = {}) {
    super(ctx, 'akaYibWebSearch', true)
    this.client = new DeepSeekSearchClient(config, { logger: ctx.logger('aka-yib-web-search'), ...dependencies })
    ctx.set('akaYibWebSearch', this)
  }

  search(input: SearchInput, signal?: AbortSignal) { return this.client.search(input, signal) }
  fetch(input: FetchInput, signal?: AbortSignal) { return this.client.fetch(input, signal) }
}
