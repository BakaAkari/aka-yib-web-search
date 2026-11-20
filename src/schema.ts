import type { FetchInput, SearchInput } from './types'

export type JsonSchema = Record<string, unknown>

export function createJsonSchema<T>(schema: JsonSchema) {
  return {
    [Symbol.for('vercel.ai.schema')]: true as const,
    _type: undefined as unknown as T,
    get jsonSchema(): JsonSchema { return schema },
    validate: undefined,
  }
}

export const webSearchInputSchema = createJsonSchema<SearchInput>({
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query (up to 128 Unicode characters).' },
    ori_question: { type: 'string', description: 'Original question for search context.' },
    count: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum number of results.' },
    need_content: { type: 'boolean', description: 'Include extracted webpage content.' },
  },
  required: ['query'],
  additionalProperties: false,
})

export const webFetchInputSchema = createJsonSchema<FetchInput>({
  type: 'object',
  properties: {
    url: { type: 'string', description: 'HTTP or HTTPS webpage URL to read.' },
  },
  required: ['url'],
  additionalProperties: false,
})

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isSearchInput(value: unknown): value is SearchInput {
  return isRecord(value) && typeof value.query === 'string' && !!value.query.trim()
    && (value.ori_question === undefined || value.ori_question === null || typeof value.ori_question === 'string')
    && (value.count === undefined || value.count === null || (typeof value.count === 'number' && Number.isFinite(value.count)))
    && (value.need_content === undefined || value.need_content === null || typeof value.need_content === 'boolean')
}

export function isFetchInput(value: unknown): value is FetchInput {
  return isRecord(value) && typeof value.url === 'string'
}

export function normalizeUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || Array.from(trimmed).length > 8192) return undefined
  try {
    const url = new URL(trimmed)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined
    url.hash = ''
    if (Array.from(url.href).length > 8192) return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function truncateText(value: string, maxChars: number): { content: string; truncated: boolean } {
  const chars = Array.from(value)
  const truncated = chars.length > maxChars
  return { content: truncated ? chars.slice(0, maxChars).join('') + '\n[内容已截断]' : value, truncated }
}
