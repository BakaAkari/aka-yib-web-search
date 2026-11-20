import { describe, expect, it } from 'vitest'
import { bodyOf, createHarness, errorResponse, jsonResponse } from './helpers'

const fetchUrl = 'https://api.deepseek.com/v1/tools/fetch'

describe('DeepSeekSearchClient.fetch / success', () => {
  it('posts the normalized URL and returns markdown content', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ title: 'Title', content: '# Body' }))

    const result = await client.fetch({ url: 'https://example.com/page#section' })

    expect(result).toEqual({
      ok: true,
      provider: 'deepseek',
      url: 'https://example.com/page',
      title: 'Title',
      content: '# Body',
      truncated: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(fetchUrl)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    })
    expect(bodyOf(fetchMock)).toEqual({ url: 'https://example.com/page' })
  })

  it('defaults a missing title to an empty string', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ content: 'text' }))

    const result = await client.fetch({ url: 'https://example.com/' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.title).toBe('')
  })

  it('truncates content over maxFetchChars and appends the marker', async () => {
    const { client, fetchMock } = createHarness({ maxFetchChars: 5 })
    fetchMock.mockResolvedValue(jsonResponse({ title: 'T', content: 'abcdefgh' }))

    const result = await client.fetch({ url: 'https://example.com/' })

    expect(result).toEqual({
      ok: true,
      provider: 'deepseek',
      url: 'https://example.com/',
      title: 'T',
      content: 'abcde\n[内容已截断]',
      truncated: true,
    })
  })

  it('does not truncate content at exactly maxFetchChars', async () => {
    const { client, fetchMock } = createHarness({ maxFetchChars: 5 })
    fetchMock.mockResolvedValue(jsonResponse({ content: 'abcde' }))

    const result = await client.fetch({ url: 'https://example.com/' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('abcde')
      expect(result.truncated).toBe(false)
    }
  })

  it('returns missing_api_key without sending a request when apiKey is blank', async () => {
    const { client, fetchMock } = createHarness({ apiKey: '' })

    const result = await client.fetch({ url: 'https://example.com/' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('missing_api_key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a response without string content', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ title: 'T', content: 42 }))

    const result = await client.fetch({ url: 'https://example.com/' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_response')
  })

  it('surfaces HTTP failures unchanged', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(errorResponse(402, { error: { message: 'no balance', type: 'billing', code: 402 } }))

    const result = await client.fetch({ url: 'https://example.com/' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'insufficient_balance',
        message: 'no balance',
        retryable: false,
        status: 402,
        apiCode: 402,
        apiType: 'billing',
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('DeepSeekSearchClient.fetch / URL validation', () => {
  const invalid: Array<[string, string]> = [
    ['ftp scheme', 'ftp://example.com/file'],
    ['file scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['missing host', 'http://'],
    ['relative path', '/relative/path'],
    ['embedded credentials', 'https://user:pass@example.com/'],
    ['overlong URL', `https://example.com/${'a'.repeat(8200)}`],
    ['empty string', ''],
  ]

  it.each(invalid)('rejects %s without calling fetch', async (_label, url) => {
    const { client, fetchMock } = createHarness()

    const result = await client.fetch({ url })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.retryable).toBe(false)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a URL of exactly 8192 code points', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ content: 'ok' }))
    const url = `https://example.com/${'a'.repeat(8192 - 'https://example.com/'.length)}`

    expect(Array.from(url)).toHaveLength(8192)
    const result = await client.fetch({ url })
    expect(result.ok).toBe(true)
  })

  it('rejects blacklisted URLs without calling fetch', async () => {
    const { client, fetchMock } = createHarness({ blacklist: ['blocked\\.test'] })

    const result = await client.fetch({ url: 'https://blocked.test/page' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_input')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a URL whose percent-encoded href exceeds the limit', async () => {
    const { client, fetchMock } = createHarness()
    const prefix = 'https://example.com/'
    const url = prefix + '😀'.repeat(8192 - prefix.length)

    const result = await client.fetch({ url })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_input')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace before validating and sending', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(jsonResponse({ content: 'ok' }))

    const result = await client.fetch({ url: '  https://example.com/page  ' })

    expect(result.ok).toBe(true)
    expect(bodyOf(fetchMock)).toEqual({ url: 'https://example.com/page' })
  })

  it('rejects non-string input', async () => {
    const { client, fetchMock } = createHarness()

    for (const input of [null, {}, { url: 42 }]) {
      const result = await client.fetch(input as never)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid_input')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
