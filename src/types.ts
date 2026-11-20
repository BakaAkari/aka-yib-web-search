export interface Config {
  apiKey: string
  baseUrl: string
  defaultLimit: number
  maxLimit: number
  defaultNeedContent: boolean
  localization: string
  minRerankScore: number
  maxSearchContentChars: number
  maxFetchChars: number
  timeoutMs: number
  maxRetries: number
  blacklist: string[]
  yesimbotEnabled: boolean
  enableCommands: boolean
  commandAuthority: number
}

export const defaultConfig: Config = {
  apiKey: '', baseUrl: 'https://api.deepseek.com', defaultLimit: 5, maxLimit: 10,
  defaultNeedContent: false, localization: '', minRerankScore: 0,
  maxSearchContentChars: 3000, maxFetchChars: 12000, timeoutMs: 15000,
  maxRetries: 2, blacklist: [], yesimbotEnabled: true, enableCommands: true,
  commandAuthority: 3,
}

export interface SearchInput {
  query: string
  ori_question?: string
  count?: number
  need_content?: boolean
}
export interface FetchInput { url: string }
export interface DeepSeekSearchRequest extends SearchInput {
  count: number
  need_content: boolean
  localization?: string
}
export interface DeepSeekFetchRequest { url: string }
export interface DeepSeekSearchResult {
  url: string
  title?: string
  summary?: string
  snippet?: string
  content?: string
  rerank_score?: number
  site_name?: string
  site_icon?: string
  date?: string
  authority?: number
}
export interface DeepSeekSearchResponse { results: DeepSeekSearchResult[] }
export interface DeepSeekFetchResponse { title: string; content: string }
export interface DeepSeekErrorResponse {
  error: { message?: string; type?: string; code?: string | number | null }
}
export type WebSearchErrorCode = 'invalid_input' | 'missing_api_key' | 'invalid_response'
  | 'aborted' | 'timeout' | 'network_error' | 'bad_request' | 'unauthorized'
  | 'insufficient_balance' | 'forbidden' | 'not_found' | 'payload_too_large'
  | 'rate_limited' | 'http_error'
export interface WebSearchError {
  code: WebSearchErrorCode
  message: string
  retryable: boolean
  status?: number
  apiCode?: string | number
  apiType?: string
}
export interface Failure { ok: false; error: WebSearchError }
export interface SearchResult extends DeepSeekSearchResult {
  title: string
  summary: string
  truncated: boolean
}
export interface SearchSuccess {
  ok: true
  provider: 'deepseek'
  query: string
  results: SearchResult[]
}
export interface FetchSuccess {
  ok: true
  provider: 'deepseek'
  url: string
  title: string
  content: string
  truncated: boolean
}
export type SearchResponse = SearchSuccess | Failure
export type FetchResponse = FetchSuccess | Failure
export type FetchLike = typeof globalThis.fetch
export interface ClientDependencies {
  fetch?: FetchLike
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  logger?: { warn: (message: string) => void }
}
