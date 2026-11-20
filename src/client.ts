import { isFetchInput, isRecord, isSearchInput, normalizeUrl, truncateText } from './schema'
import { defaultConfig } from './types'
import type {
  ClientDependencies, Config, DeepSeekSearchRequest, Failure, FetchInput,
  FetchResponse, SearchInput, SearchResponse, SearchResult, WebSearchErrorCode,
} from './types'

export const MAX_RETRY_DELAY_MS = 30_000
const failure = (code: WebSearchErrorCode, message: string, retryable = false): Failure =>
  ({ ok: false, error: { code, message, retryable } })
const finite = (value: number, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.floor(value) : fallback))
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const retryStatus = (status: number) => status === 408 || status === 429 || (status >= 500 && status <= 599)

function mergeConfig(config: Partial<Config>): Config {
  const merged: Config = { ...defaultConfig, blacklist: [...defaultConfig.blacklist] }
  for (const [key, value] of Object.entries(config) as [keyof Config, unknown][]) {
    if (value !== undefined) {
      ;(merged as unknown as Record<string, unknown>)[key] = key === 'blacklist' && Array.isArray(value)
        ? [...value]
        : value
    }
  }
  return merged
}

function abortError() { return new DOMException('Operation aborted', 'AbortError') }

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    operation.catch(() => {})
    return Promise.reject(abortError())
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(abortError()) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class DeepSeekSearchClient {
  readonly config: Config
  private readonly transport: typeof globalThis.fetch
  private readonly wait: NonNullable<ClientDependencies['sleep']>
  private readonly blacklist: RegExp[] = []

  constructor(config: Partial<Config> = {}, dependencies: ClientDependencies = {}) {
    this.config = mergeConfig(config)
    this.transport = dependencies.fetch ?? globalThis.fetch
    this.wait = dependencies.sleep ?? sleep
    for (const pattern of this.config.blacklist) {
      if (typeof pattern !== 'string' || !pattern.trim()) {
        dependencies.logger?.warn('event=empty_blacklist_regex action=ignored')
        continue
      }
      try { this.blacklist.push(new RegExp(pattern, 'i')) }
      catch { dependencies.logger?.warn('event=invalid_blacklist_regex action=ignored') }
    }
  }

  private blocked(url: string) { return this.blacklist.some(pattern => pattern.test(url)) }

  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchResponse> {
    try {
      if (!isSearchInput(input)) return failure('invalid_input', 'query 必须为非空字符串，搜索参数类型必须有效。')
      const query = Array.from(input.query.trim()).slice(0, 128).join('')
      const maxLimit = finite(this.config.maxLimit, 10, 1, 50)
      const body: DeepSeekSearchRequest = {
        query,
        count: finite(input.count ?? this.config.defaultLimit, 5, 1, maxLimit),
        need_content: input.need_content ?? this.config.defaultNeedContent,
      }
      const original = typeof input.ori_question === 'string' ? input.ori_question.trim() : ''
      if (original) body.ori_question = Array.from(original).slice(0, 128).join('')
      const localization = this.config.localization.trim()
      if (localization) body.localization = localization
      const response = await this.request('search', body, signal)
      if (!response.ok) return response
      if (!isRecord(response.data) || !Array.isArray(response.data.results)) {
        return failure('invalid_response', '搜索响应缺少 results 数组。')
      }
      const seen = new Set<string>()
      const results: SearchResult[] = []
      for (const item of response.data.results) {
        if (!isRecord(item) || typeof item.url !== 'string') continue
        const url = normalizeUrl(item.url)
        if (!url || this.blocked(item.url) || this.blocked(url) || seen.has(url)) continue
        const score = typeof item.rerank_score === 'number' && Number.isFinite(item.rerank_score) ? item.rerank_score : undefined
        if (this.config.minRerankScore > 0 && (score === undefined || score < this.config.minRerankScore)) continue
        seen.add(url)
        const result: SearchResult = {
          url,
          title: text(item.title),
          summary: text(item.summary).trim() || text(item.snippet),
          truncated: false,
        }
        if (score !== undefined) result.rerank_score = score
        if (typeof item.snippet === 'string') result.snippet = item.snippet
        if (typeof item.content === 'string') {
          const clipped = truncateText(item.content, finite(this.config.maxSearchContentChars, 3000, 0, Number.MAX_SAFE_INTEGER))
          result.content = clipped.content
          result.truncated = clipped.truncated
        }
        for (const key of ['site_name', 'site_icon', 'date'] as const) {
          if (typeof item[key] === 'string') result[key] = item[key]
        }
        if (typeof item.authority === 'number' && Number.isFinite(item.authority)) result.authority = item.authority
        results.push(result)
        if (results.length >= body.count) break
      }
      return { ok: true, provider: 'deepseek', query, results }
    } catch {
      return failure('invalid_response', '无法处理搜索响应。')
    }
  }

  async fetch(input: FetchInput, signal?: AbortSignal): Promise<FetchResponse> {
    try {
      if (!isFetchInput(input)) return failure('invalid_input', 'url 必须为 HTTP/HTTPS URL。')
      const url = normalizeUrl(input.url)
      if (!url || this.blocked(input.url) || this.blocked(url)) {
        return failure('invalid_input', 'URL 无效、包含凭证、超过长度限制或命中黑名单。')
      }
      const response = await this.request('fetch', { url }, signal)
      if (!response.ok) return response
      if (!isRecord(response.data) || typeof response.data.content !== 'string') {
        return failure('invalid_response', '网页响应缺少 content 字符串。')
      }
      return {
        ok: true,
        provider: 'deepseek',
        url,
        title: text(response.data.title),
        ...truncateText(response.data.content, finite(this.config.maxFetchChars, 12000, 0, Number.MAX_SAFE_INTEGER)),
      }
    } catch {
      return failure('invalid_response', '无法处理网页响应。')
    }
  }

  private async request(endpoint: 'search' | 'fetch', body: object, signal?: AbortSignal): Promise<
    { ok: true; data: unknown } | Failure
  > {
    const apiKey = this.config.apiKey.trim()
    if (!apiKey) return failure('missing_api_key', '请配置 DeepSeek API Key。')
    const rawBaseUrl = this.config.baseUrl.trim() || defaultConfig.baseUrl
    const normalizedBaseUrl = normalizeUrl(rawBaseUrl)
    if (!normalizedBaseUrl) return failure('invalid_input', 'baseUrl 必须为有效的 HTTP/HTTPS 地址。')
    const baseUrl = normalizedBaseUrl.replace(/\/+$/, '')
    const retries = finite(this.config.maxRetries, 2, 0, 10)
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) return failure('aborted', '请求已取消。')
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, finite(this.config.timeoutMs, 15000, 1, 2_147_483_647))
      let result: Failure
      let delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt)
      try {
        const response = await withAbort(this.transport(`${baseUrl}/v1/tools/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }), controller.signal)
        let data: unknown
        try { data = await withAbort(response.json(), controller.signal) }
        catch (error) {
          if (controller.signal.aborted) throw error
          if (response.ok) {
            if (error instanceof SyntaxError) return failure('invalid_response', 'API 返回了无效的 JSON。')
            throw error
          }
        }
        if (response.ok) return { ok: true, data }
        const details = isRecord(data) && isRecord(data.error) ? data.error : undefined
        const codes: Record<number, WebSearchErrorCode> = {
          400: 'bad_request', 401: 'unauthorized', 402: 'insufficient_balance', 403: 'forbidden',
          404: 'not_found', 408: 'timeout', 413: 'payload_too_large', 429: 'rate_limited',
        }
        result = failure(
          codes[response.status] ?? 'http_error',
          text(details?.message) || `DeepSeek API 请求失败（HTTP ${response.status}）。`,
          retryStatus(response.status),
        )
        result.error.status = response.status
        if (typeof details?.code === 'string' || typeof details?.code === 'number') result.error.apiCode = details.code
        if (typeof details?.type === 'string') result.error.apiType = details.type
        const retryAfter = response.headers?.get?.('retry-after')?.trim()
        if (retryAfter) {
          const seconds = Number(retryAfter)
          const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()
          if (Number.isFinite(parsed)) delay = Math.min(MAX_RETRY_DELAY_MS, Math.max(delay, parsed, 0))
        }
      } catch {
        if (signal?.aborted) return failure('aborted', '请求已取消。')
        result = timedOut
          ? failure('timeout', 'DeepSeek API 请求超时。', true)
          : failure('network_error', 'DeepSeek API 网络请求失败。', true)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      if (!result.error.retryable || attempt === retries) return result
      if (signal?.aborted) return failure('aborted', '请求已取消。')
      try {
        if (signal) await withAbort(this.wait(delay, signal), signal)
        else await this.wait(delay)
      } catch {
        return signal?.aborted
          ? failure('aborted', '请求已取消。')
          : failure('network_error', '重试等待失败。')
      }
    }
    return failure('network_error', 'DeepSeek API 请求失败。')
  }
}
