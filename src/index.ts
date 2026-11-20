import { Context, Schema } from 'koishi'
import { registerCommands } from './commands'
import { AkaYibWebSearchService } from './service'
import { defaultConfig } from './types'
import type { Config as PluginConfig } from './types'
import { registerYesImBot } from './yesimbot'

export const name = 'aka-yib-web-search'
export const inject = ['yesimbot']
export type Config = PluginConfig
export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().role('secret').default('').description('DeepSeek API Key'),
  baseUrl: Schema.string().default(defaultConfig.baseUrl).description('可信 DeepSeek API 地址，不带 /v1'),
  defaultLimit: Schema.number().step(1).min(1).max(50).default(5).description('默认搜索数量'),
  maxLimit: Schema.number().step(1).min(1).max(50).default(10).description('搜索数量上限'),
  defaultNeedContent: Schema.boolean().default(false).description('搜索默认包含正文'),
  localization: Schema.string().default('').description('可选本地化 IP'),
  minRerankScore: Schema.number().min(0).max(3).default(0).description('最低评分，0 不过滤'),
  maxSearchContentChars: Schema.number().step(1).min(0).default(3000).description('单条搜索正文字符上限'),
  maxFetchChars: Schema.number().step(1).min(0).default(12000).description('抓取正文字符上限'),
  timeoutMs: Schema.number().step(1).min(1).default(15000).description('单次请求超时毫秒数'),
  maxRetries: Schema.number().step(1).min(0).max(10).default(2).description('额外重试次数'),
  blacklist: Schema.array(Schema.string()).default([]).description('URL 正则黑名单'),
  yesimbotEnabled: Schema.boolean().default(true).description('注册 YesImBot 联网工具'),
  enableCommands: Schema.boolean().default(true).description('启用联网命令'),
  commandAuthority: Schema.number().step(1).min(0).default(3).description('命令最低权限'),
})

export function apply(ctx: Context, config: Config) {
  const service = new AkaYibWebSearchService(ctx, config)
  const resolved = service.client.config
  registerCommands(ctx, service, resolved)
  if (resolved.yesimbotEnabled) registerYesImBot(ctx, service)
}

export * from './types'
export * from './schema'
export * from './client'
export * from './service'
export * from './yesimbot'
export * from './commands'
