import { describe, expect, it } from 'vitest'
import { bodyOf, createHarness, errorResponse, jsonResponse } from './helpers'

const searchUrl = 'https://api.deepseek.com/v1/tools/search'

describe('DeepSeekSearchClient.search / request shape', () => {
  it('posts to /v1/tools/search with auth and JSON headers', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    const result = await client.search({ query: 'hello' })

    expect(result).toEqual({ ok: true, provider: 'deepseek', query: 'hello', results: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(searchUrl)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    })
    expect(bodyOf(fetchMock)).toEqual({ query: 'hello', count: 5, need_content: false })
  })

  it('trims the base URL trailing slashes and sends every config-driven field', async () => {
    const { client, fetchMock } = createHarness({
      baseUrl: 'https://api.example.com///',
      defaultLimit: 2,
      defaultNeedContent: true,
      localization: ' 1.2.3.4 ',
    })
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await client.search({ query: '  padded  ', ori_question: ' origin ' })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/tools/search')
    expect(bodyOf(fetchMock)).toEqual({
      query: 'padded',
      count: 2,
      need_content: true,
      ori_question: 'origin',
      localization: '1.2.3.4',
    })
  })

  it('accepts null optional fields from LLM tool calls and falls back to config defaults', async () => {
    const { client, fetchMock } = createHarness({ defaultLimit: 4, defaultNeedContent: true })
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    const result = await client.search({
      query: 'hello',
      ori_question: null,
      count: null,
      need_content: null,
    } as never)

    expect(result.ok).toBe(true)
    expect(bodyOf(fetchMock)).toEqual({ query: 'hello', count: 4, need_content: true })
  })

  it('rejects empty or whitespace-only queries without calling fetch', async () => {
    const { client, fetchMock } = createHarness()

    for (const query of ['', '   ', '\n\t ']) {
      const result = await client.search({ query })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid_input')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid argument shapes without calling fetch', async () => {
    const { client, fetchMock } = createHarness()

    const badInputs: unknown[] = [
      null,
      'query',
      { query: 123 },
      { query: 'ok', count: Number.NaN },
      { query: 'ok', need_content: 'yes' },
      { query: 'ok', ori_question: 7 },
    ]
    for (const input of badInputs) {
      const result = await client.search(input as never)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid_input')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns missing_api_key and never sends a request when apiKey is blank', async () => {
    const { client, fetchMock } = createHarness({ apiKey: '   ' })

    const result = await client.search({ query: 'hello' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'missing_api_key', message: '请配置 DeepSeek API Key。', retryable: false },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('DeepSeekSearchClient.search / unicode truncation', () => {
  it('truncates query and ori_question to 128 code points without splitting surrogate pairs', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
    const query = '中'.repeat(100) + '😀'.repeat(40)
    const question = '😀'.repeat(200)

    await client.search({ query, ori_question: question })

    const body = bodyOf(fetchMock)
    const expectedQuery = Array.from(query).slice(0, 128).join('')
    expect(Array.from(body.query)).toHaveLength(128)
    expect(body.query).toBe(expectedQuery)
    expect(body.query.endsWith('😀')).toBe(true)
    expect(body.query.includes('\uFFFD')).toBe(false)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(body.query)).toBe(false)
    expect(/[\uDC00-\uDFFF]/.test(body.query.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(false)
    expect(Array.from(body.ori_question)).toHaveLength(128)
    expect(body.ori_question).toBe(Array.from(question).slice(0, 128).join(''))
  })

  it('keeps queries at exactly 128 code points intact', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))
    const query = 'a'.repeat(127) + '😀'

    await client.search({ query })

    expect(bodyOf(fetchMock).query).toBe(query)
  })

  it('omits ori_question when blank', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await client.search({ query: 'q', ori_question: '   ' })

    expect(bodyOf(fetchMock)).not.toHaveProperty('ori_question')
  })
})

describe('DeepSeekSearchClient.search / count clamping', () => {
  const cases: Array<[string, Partial<Parameters<typeof createHarness>[0]>, number | undefined, number]> = [
    ['count 0 clamps to 1', {}, 0, 1],
    ['negative count clamps to 1', {}, -5, 1],
    ['missing count uses defaultLimit', {}, undefined, 5],
    ['count within range is kept', {}, 7, 7],
    ['count above maxLimit clamps to maxLimit', {}, 11, 10],
    ['fractional count is floored', {}, 3.9, 3],
    ['count above hard cap 50 clamps to 50', { maxLimit: 50, defaultLimit: 20 }, 60, 50],
    ['maxLimit above 50 is capped by the hard limit', { maxLimit: 200 }, 80, 50],
  ]

  it.each(cases)('%s', async (_label, config, count, expected) => {
    const { client, fetchMock } = createHarness(config)
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await client.search({ query: 'q', count } as never)

    expect(bodyOf(fetchMock).count).toBe(expected)
  })
})

describe('DeepSeekSearchClient.search / result normalization', () => {
  const results = [
    {
      url: 'https://example.com/a',
      title: 'A',
      summary: 'summary-a',
      snippet: 'snippet-a',
      content: 'short',
      rerank_score: 0.9,
      site_name: 'Example',
      date: '2026-11-20',
      authority: 2,
    },
    {
      url: 'https://example.com/b#fragment',
      title: 'B',
      summary: '   ',
      snippet: 'snippet-b',
      rerank_score: 0.4,
    },
    { url: 'https://example.com/a#dup', title: 'duplicate' },
    { url: 'not-a-url', title: 'broken' },
    { title: 'missing url' },
    'garbage',
  ]

  it('maps fields, normalizes and dedupes URLs, and prefers summary over snippet', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ results }))

    const result = await client.search({ query: 'q', count: 10 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results).toHaveLength(2)
    const [a, b] = result.results
    expect(a).toMatchObject({
      url: 'https://example.com/a',
      title: 'A',
      summary: 'summary-a',
      snippet: 'snippet-a',
      content: 'short',
      truncated: false,
      rerank_score: 0.9,
      site_name: 'Example',
      date: '2026-11-20',
      authority: 2,
    })
    expect(b).toMatchObject({
      url: 'https://example.com/b',
      title: 'B',
      summary: 'snippet-b',
      truncated: false,
      rerank_score: 0.4,
    })
  })

  it('stops collecting once count results are gathered', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({
      results: [
        { url: 'https://example.com/1' },
        { url: 'https://example.com/2' },
        { url: 'https://example.com/3' },
      ],
    }))

    const result = await client.search({ query: 'q', count: 2 })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.results).toHaveLength(2)
  })

  it('returns an empty result list when nothing survives filtering', async () => {
    const { client, fetchMock } = createHarness({ minRerankScore: 0.5 })
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ url: 'https://example.com/a', rerank_score: 0.1 }] }))

    const result = await client.search({ query: 'q' })

    expect(result).toEqual({ ok: true, provider: 'deepseek', query: 'q', results: [] })
  })

  it('filters results below minRerankScore and drops results without a score', async () => {
    const { client, fetchMock } = createHarness({ minRerankScore: 0.5 })
    fetchMock.mockResolvedValue(jsonResponse({
      results: [
        { url: 'https://example.com/none' },
        { url: 'https://example.com/low', rerank_score: 0.2 },
        { url: 'https://example.com/high', rerank_score: 0.8 },
      ],
    }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results.map(item => item.url)).toEqual(['https://example.com/high'])
    }
  })

  it('filters blacklisted URLs by raw and normalized forms', async () => {
    const { client, fetchMock } = createHarness({ blacklist: ['blocked\\.test', 'spam'] })
    fetchMock.mockResolvedValue(jsonResponse({
      results: [
        { url: 'https://blocked.test/page' },
        { url: 'https://example.com/spam-page' },
        { url: 'https://example.com/ok' },
      ],
    }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.results.map(item => item.url)).toEqual(['https://example.com/ok'])
  })

  it('ignores empty or whitespace blacklist entries with a warning instead of blocking every URL', async () => {
    const { client, fetchMock, warn } = createHarness({ blacklist: ['', '   ', 'blocked\\.test'] })
    fetchMock.mockResolvedValue(jsonResponse({
      results: [
        { url: 'https://blocked.test/page' },
        { url: 'https://example.com/ok' },
      ],
    }))

    const result = await client.search({ query: 'q' })

    expect(warn).toHaveBeenCalledWith('event=empty_blacklist_regex action=ignored')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.results.map(item => item.url)).toEqual(['https://example.com/ok'])
  })

  it('ignores invalid blacklist regexes without crashing and still applies valid ones', async () => {
    const { client, fetchMock, warn } = createHarness({ blacklist: ['[', 'blocked\\.test'] })
    fetchMock.mockResolvedValue(jsonResponse({
      results: [
        { url: 'https://blocked.test/page' },
        { url: 'https://example.com/ok' },
      ],
    }))

    const result = await client.search({ query: 'q' })

    expect(warn).toHaveBeenCalledWith('event=invalid_blacklist_regex action=ignored')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.results.map(item => item.url)).toEqual(['https://example.com/ok'])
  })

  it('truncates long content with the truncation marker', async () => {
    const { client, fetchMock } = createHarness({ maxSearchContentChars: 10 })
    fetchMock.mockResolvedValue(jsonResponse({
      results: [{ url: 'https://example.com/long', content: 'abcdefghijklmnopqrstuvwxyz' }],
    }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0].content).toBe('abcdefghij\n[内容已截断]')
    expect(result.results[0].truncated).toBe(true)
  })

  it('treats maxSearchContentChars 0 as "content fully truncated"', async () => {
    const { client, fetchMock } = createHarness({ maxSearchContentChars: 0 })
    fetchMock.mockResolvedValue(jsonResponse({
      results: [{ url: 'https://example.com/x', content: 'body' }],
    }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results[0].content).toBe('\n[内容已截断]')
      expect(result.results[0].truncated).toBe(true)
    }
  })

  it('omits optional fields that are missing or mistyped', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({
      results: [{
        url: 'https://example.com/x',
        title: 5,
        summary: null,
        snippet: null,
        content: 42,
        rerank_score: 'high',
        site_name: 1,
        authority: '2',
      }],
    }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]).toEqual({
      url: 'https://example.com/x',
      title: '',
      summary: '',
      truncated: false,
    })
  })

  it('rejects a response without a results array', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_response')
  })

  it('turns an unexpected normalization error into a structured invalid_response', async () => {
    const { client, fetchMock } = createHarness()
    const poisoned = {}
    Object.defineProperty(poisoned, 'results', {
      get() { throw new Error('kaboom') },
    })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => poisoned, headers: new Headers() })

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_response')
  })
})

describe('DeepSeekSearchClient.search / error passthrough', () => {
  it('surfaces non-retryable HTTP failures without retrying', async () => {
    const { client, fetchMock, sleepMock } = createHarness()
    fetchMock.mockResolvedValue(errorResponse(401, { error: { message: 'no key', type: 'auth', code: 'bad' } }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'unauthorized',
        message: 'no key',
        retryable: false,
        status: 401,
        apiCode: 'bad',
        apiType: 'auth',
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })
})
