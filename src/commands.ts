import { h, type Context } from 'koishi'
import type { AkaYibWebSearchService } from './service'
import type { Config } from './types'

export function registerCommands(ctx: Context, service: AkaYibWebSearchService, config: Config) {
  if (!config.enableCommands) return
  ctx.command('websearch <query:text>', '联网搜索', { authority: config.commandAuthority })
    .option('count', '-n <count:number> 返回数量')
    .option('content', '-c, --content 包含网页正文')
    .action(async ({ options }, query) => {
      if (!query?.trim()) return h.text('用法：websearch [-n 数量] [-c] <关键词>')
      const result = await service.search({ query, count: options?.count, need_content: options?.content })
      if (!result.ok) return h.text(`[${result.error.code}] ${result.error.message}`)
      if (!result.results.length) return h.text('未找到符合条件的搜索结果。')
      const output = result.results.map((item, index) => [
        `${index + 1}. ${item.title || item.url}`, item.url, item.summary, item.content,
      ].filter(Boolean).join('\n')).join('\n\n')
      return h.text(output)
    })
  ctx.command('webfetch <url:string>', '读取网页正文', { authority: config.commandAuthority })
    .action(async (_, url) => {
      if (!url?.trim()) return h.text('用法：webfetch <HTTP/HTTPS URL>')
      const result = await service.fetch({ url })
      if (!result.ok) return h.text(`[${result.error.code}] ${result.error.message}`)
      const output = [result.title, result.url, result.content].filter(Boolean).join('\n')
      return h.text(output)
    })
}
