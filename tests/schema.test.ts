import { describe, expect, it } from 'vitest'
import {
  createJsonSchema, isFetchInput, isRecord, isSearchInput, normalizeUrl, truncateText,
  webFetchInputSchema, webSearchInputSchema,
} from '../src/schema'

const schemaSymbol = Symbol.for('vercel.ai.schema')

function walk(node: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, visit))
    return
  }
  const record = node as Record<string, unknown>
  visit(record, path)
  for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`, visit)
}

describe('AI SDK schema contract', () => {
  const schemas = [
    ['webSearchInputSchema', webSearchInputSchema],
    ['webFetchInputSchema', webFetchInputSchema],
  ] as const

  it.each(schemas)('%s satisfies the isSchema contract', (_name, schema) => {
    const value = schema as unknown as Record<PropertyKey, unknown>
    expect(value[schemaSymbol]).toBe(true)
    expect('jsonSchema' in schema).toBe(true)
    expect('validate' in schema).toBe(true)
    expect(typeof schema.jsonSchema).toBe('object')
    expect(schema.jsonSchema).not.toBeNull()
    expect(schema.jsonSchema.type).toBe('object')
  })

  it('createJsonSchema exposes the given JSON schema and stays zero-dependency', () => {
    const jsonSchema = { type: 'object', properties: {} }
    const schema = createJsonSchema(jsonSchema)

    expect((schema as unknown as Record<PropertyKey, unknown>)[schemaSymbol]).toBe(true)
    expect(schema.jsonSchema).toBe(jsonSchema)
  })
})

describe('cross-model JSON schema safety', () => {
  const schemas = [
    ['webSearchInputSchema', webSearchInputSchema],
    ['webFetchInputSchema', webFetchInputSchema],
  ] as const

  it.each(schemas)('%s never contains non-string enums, uri format, or composition keywords', (_name, schema) => {
    const hits: string[] = []
    walk(schema.jsonSchema, 'root', (node, path) => {
      if ('enum' in node) {
        const values = node.enum
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
          hits.push(`${path}.enum is not a string-only enum`)
        }
      }
      if (node.format === 'uri') hits.push(`${path}.format is "uri"`)
      for (const keyword of ['oneOf', 'anyOf', 'allOf', '$ref'] as const) {
        if (keyword in node) hits.push(`${path}.${keyword} is unsupported`)
      }
    })

    expect(hits).toEqual([])
  })

  it('keeps numeric bounds declarative without numeric enums', () => {
    const count = (webSearchInputSchema.jsonSchema.properties as Record<string, Record<string, unknown>>).count
    expect(count.type).toBe('integer')
    expect(count.minimum).toBe(1)
    expect(count.maximum).toBe(50)
    expect(count).not.toHaveProperty('enum')
  })

  it('marks only the required tool arguments as required', () => {
    expect(webSearchInputSchema.jsonSchema.required).toEqual(['query'])
    expect(webFetchInputSchema.jsonSchema.required).toEqual(['url'])
    expect(webSearchInputSchema.jsonSchema.additionalProperties).toBe(false)
    expect(webFetchInputSchema.jsonSchema.additionalProperties).toBe(false)
  })
})

describe('schema helpers', () => {
  it('isRecord only accepts plain objects', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('isSearchInput validates every field type and tolerates null optional fields', () => {
    expect(isSearchInput({ query: 'q' })).toBe(true)
    expect(isSearchInput({ query: 'q', count: 3, need_content: true, ori_question: 'o' })).toBe(true)
    expect(isSearchInput({ query: 'q', count: null, need_content: null, ori_question: null })).toBe(true)
    expect(isSearchInput({ query: '   ' })).toBe(false)
    expect(isSearchInput({ query: 'q', count: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isSearchInput({ query: 'q', need_content: 1 })).toBe(false)
    expect(isSearchInput({ query: 'q', ori_question: 1 })).toBe(false)
    expect(isSearchInput([])).toBe(false)
  })

  it('isFetchInput only requires a string url', () => {
    expect(isFetchInput({ url: '' })).toBe(true)
    expect(isFetchInput({ url: 1 })).toBe(false)
    expect(isFetchInput(null)).toBe(false)
  })

  it('normalizeUrl enforces protocol, host, credentials, and strips hashes', () => {
    expect(normalizeUrl('https://example.com/a#b')).toBe('https://example.com/a')
    expect(normalizeUrl('  https://example.com/a#b  ')).toBe('https://example.com/a')
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/')
    expect(normalizeUrl('HTTPS://EXAMPLE.COM/A')).toBe('https://example.com/A')
    expect(normalizeUrl('ftp://example.com/')).toBeUndefined()
    expect(normalizeUrl('file:///tmp/x')).toBeUndefined()
    expect(normalizeUrl('http://')).toBeUndefined()
    expect(normalizeUrl('https://user@example.com/')).toBeUndefined()
    expect(normalizeUrl('https://user:pass@example.com/')).toBeUndefined()
    expect(normalizeUrl('')).toBeUndefined()
    expect(normalizeUrl('   ')).toBeUndefined()
    expect(normalizeUrl(`https://example.com/${'a'.repeat(8200)}`)).toBeUndefined()
  })

  it('normalizeUrl limits the length of both the input and the normalized href', () => {
    const prefix = 'https://example.com/'
    const atLimit = prefix + 'a'.repeat(8192 - prefix.length)
    expect(Array.from(atLimit)).toHaveLength(8192)
    expect(normalizeUrl(atLimit)).toBe(atLimit)
    expect(normalizeUrl(`${atLimit}a`)).toBeUndefined()

    // Under the input limit, but percent-encoding inflates the href past it.
    const inflated = prefix + '😀'.repeat(8192 - prefix.length)
    expect(Array.from(inflated)).toHaveLength(8192)
    expect(Array.from(new URL(inflated).href).length).toBeGreaterThan(8192)
    expect(normalizeUrl(inflated)).toBeUndefined()
  })

  it('truncateText appends the marker only when truncating', () => {
    expect(truncateText('abcd', 4)).toEqual({ content: 'abcd', truncated: false })
    expect(truncateText('abcde', 4)).toEqual({ content: 'abcd\n[内容已截断]', truncated: true })
    expect(truncateText('😀😀😀', 2)).toEqual({ content: '😀😀\n[内容已截断]', truncated: true })
    expect(truncateText('anything', 0)).toEqual({ content: '\n[内容已截断]', truncated: true })
  })
})
