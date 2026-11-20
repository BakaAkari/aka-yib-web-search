import { describe, expect, it } from 'vitest'
import { createHarness, errorResponse, hangUntilAbort, jsonResponse } from './helpers'

const successResults = { results: [{ url: 'https://example.com/ok', title: 'ok' }] }

describe('DeepSeekSearchClient retry policy / retryable statuses', () => {
  const retryable: Array<[number, string]> = [
    [408, 'timeout'],
    [429, 'rate_limited'],
    [500, 'http_error'],
    [504, 'http_error'],
  ]

  it.each(retryable)('retries HTTP %i once and returns the successful result', async (status) => {
    const { client, fetchMock, sleepMock } = createHarness()
    fetchMock
      .mockResolvedValueOnce(errorResponse(status))
      .mockResolvedValueOnce(jsonResponse(successResults))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).toHaveBeenCalledWith(1000)
  })

  it('honours a numeric Retry-After header', async () => {
    const { client, fetchMock, sleepMock } = createHarness()
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, { error: { message: 'slow down' } }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(successResults))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledWith(2000)
  })

  it('honours an HTTP-date Retry-After header', async () => {
    const { client, fetchMock, sleepMock } = createHarness()
    const targetDate = new Date(Date.now() + 4500).toUTCString()
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, { error: { message: 'slow down' } }, { 'retry-after': targetDate }))
      .mockResolvedValueOnce(jsonResponse(successResults))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledTimes(1)
    const delay = sleepMock.mock.calls[0][0]
    expect(delay).toBeGreaterThanOrEqual(2000)
    expect(delay).toBeLessThanOrEqual(6000)
  })

  it('caps Retry-After at the maximum retry delay', async () => {
    const { client, fetchMock, sleepMock } = createHarness()
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, { error: { message: 'slow down' } }, { 'retry-after': '3600' }))
      .mockResolvedValueOnce(jsonResponse(successResults))

    await client.search({ query: 'q' })

    expect(sleepMock).toHaveBeenCalledWith(30_000)
  })

  it('ignores an unparseable Retry-After header', async () => {
    const { client, fetchMock, sleepMock } = createHarness()
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, {}, { 'retry-after': 'not-a-date' }))
      .mockResolvedValueOnce(jsonResponse(successResults))

    await client.search({ query: 'q' })

    expect(sleepMock).toHaveBeenCalledWith(1000)
  })

  it('uses exponential backoff and gives up after maxRetries with retryable errors', async () => {
    const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 2 })
    fetchMock.mockImplementation(async () => errorResponse(500, { error: { message: 'down', type: 'server' } }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'http_error',
        message: 'down',
        retryable: true,
        status: 500,
        apiType: 'server',
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleepMock.mock.calls.map(call => call[0])).toEqual([1000, 2000])
  })

  it('retries fetch endpoint errors until maxRetries is exhausted', async () => {
    const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 2 })
    fetchMock.mockImplementation(async () => errorResponse(503, { error: { message: 'busy' } }))

    const result = await client.fetch({ url: 'https://example.com/doc' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'http_error', message: 'busy', retryable: true, status: 503 })
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleepMock.mock.calls.map(call => call[0])).toEqual([1000, 2000])
  })

  it('does not retry when maxRetries is 0', async () => {
    const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 0 })
    fetchMock.mockResolvedValue(errorResponse(503))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('fails fast with invalid_input when baseUrl is invalid without calling fetch', async () => {
    for (const baseUrl of ['not-a-url', 'ftp://api.deepseek.com', 'https://user:pass@api.deepseek.com']) {
      const { client, fetchMock, sleepMock } = createHarness({ baseUrl, maxRetries: 2 })

      const result = await client.search({ query: 'q' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatchObject({ code: 'invalid_input', retryable: false })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(sleepMock).not.toHaveBeenCalled()
    }
  })

  it('retries network failures then reports network_error', async () => {
    const { client, fetchMock } = createHarness({ maxRetries: 1 })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'network_error', retryable: true })
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a network failure and can succeed', async () => {
    const { client, fetchMock } = createHarness({ maxRetries: 1 })
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(successResults))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries stream read disconnects on ok responses as network_error while failing fast on SyntaxError', async () => {
    const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 1 })
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => { throw new TypeError('terminated') },
      })
      .mockResolvedValueOnce(jsonResponse(successResults))

    const recovered = await client.search({ query: 'q' })
    expect(recovered.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledTimes(1)

    const { client: c2, fetchMock: f2, sleepMock: s2 } = createHarness({ maxRetries: 2 })
    f2.mockResolvedValue(new Response('not json', { status: 200 }))
    const broken = await c2.search({ query: 'q' })
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error).toMatchObject({ code: 'invalid_response', retryable: false })
    expect(f2).toHaveBeenCalledTimes(1)
    expect(s2).not.toHaveBeenCalled()
  })

  it('retries a single timeout and can succeed', async () => {
    const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 1, timeoutMs: 5 })
    fetchMock
      .mockImplementationOnce(hangUntilAbort as never)
      .mockResolvedValueOnce(jsonResponse(successResults))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledTimes(1)
  })

  it('reports timeout after exhausting retries', async () => {
    const { client, fetchMock } = createHarness({ maxRetries: 1, timeoutMs: 5 })
    fetchMock.mockImplementation(hangUntilAbort as never)

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'timeout', retryable: true })
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('DeepSeekSearchClient retry policy / non-retryable statuses', () => {
  const cases: Array<[number, string]> = [
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [402, 'insufficient_balance'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [413, 'payload_too_large'],
  ]

  it.each(cases)('does not retry HTTP %i (%s) and maps the OpenAI error body', async (status, code) => {
    const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 5 })
    fetchMock.mockResolvedValue(errorResponse(status, {
      error: { message: `failure-${status}`, type: 'invalid_request_error', code: `code-${status}` },
    }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({
        code,
        message: `failure-${status}`,
        retryable: false,
        status,
        apiCode: `code-${status}`,
        apiType: 'invalid_request_error',
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the error body is not OpenAI-shaped', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(new Response('oops', { status: 400 }))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('bad_request')
      expect(result.error.message).toBe('DeepSeek API 请求失败（HTTP 400）。')
      expect(result.error).not.toHaveProperty('apiCode')
      expect(result.error).not.toHaveProperty('apiType')
    }
  })

  it('maps unknown statuses to http_error', async () => {
    const { client, fetchMock } = createHarness()
    fetchMock.mockResolvedValue(errorResponse(418))

    const result = await client.search({ query: 'q' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: 'http_error', retryable: false, status: 418 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('DeepSeekSearchClient abort handling', () => {
  it('returns aborted immediately when the signal is already aborted', async () => {
    const { client, fetchMock } = createHarness()
    const controller = new AbortController()
    controller.abort()

    const result = await client.search({ query: 'q' }, controller.signal)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('aborted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops mid-flight when the external signal aborts', async () => {
    const { client, fetchMock } = createHarness()
    const controller = new AbortController()
    fetchMock.mockImplementation(hangUntilAbort as never)

    const pending = client.search({ query: 'q' }, controller.signal)
    setTimeout(() => controller.abort(), 5)
    const result = await pending

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('aborted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops retrying when the signal aborts during the backoff wait', async () => {
    const { client, fetchMock, sleepMock } = createHarness()
    const controller = new AbortController()
    fetchMock.mockResolvedValue(errorResponse(500))
    sleepMock.mockImplementation(async () => { controller.abort() })

    const result = await client.search({ query: 'q' }, controller.signal)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('aborted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not leak unhandledRejection when signal aborts right before response.json() or wait()', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const controller = new AbortController()
      const { client, fetchMock, sleepMock } = createHarness({ maxRetries: 1 })
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => {
          controller.abort()
          return Promise.reject(new Error('late body rejection'))
        },
      })
      sleepMock.mockImplementation(() => Promise.reject(new Error('late wait rejection')))

      const result = await client.search({ query: 'q' }, controller.signal)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('aborted')
      expect(sleepMock).not.toHaveBeenCalled()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('stops retrying in fetch as well', async () => {
    const { client, fetchMock } = createHarness()
    const controller = new AbortController()
    controller.abort()

    const result = await client.fetch({ url: 'https://example.com/' }, controller.signal)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('aborted')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
