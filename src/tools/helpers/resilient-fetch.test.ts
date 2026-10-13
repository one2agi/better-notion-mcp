import { describe, expect, it, vi } from 'vitest'
import { createResilientFetch, isTransientNetworkError, resilientFetch } from './resilient-fetch.js'

describe('isTransientNetworkError', () => {
  it('returns false for non-error or non-object inputs', () => {
    expect(isTransientNetworkError(null)).toBe(false)
    expect(isTransientNetworkError(undefined)).toBe(false)
    expect(isTransientNetworkError('some error string')).toBe(false)
    expect(isTransientNetworkError(123)).toBe(false)
  })

  it('identifies TypeError with fetch failed', () => {
    const error = new TypeError('fetch failed')
    expect(isTransientNetworkError(error)).toBe(true)
  })

  it('identifies standard transient network error codes', () => {
    const codes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']
    for (const code of codes) {
      expect(isTransientNetworkError({ code })).toBe(true)
      expect(isTransientNetworkError(new Error(`connect ${code} 1.2.3.4`))).toBe(true)
    }
  })

  it('identifies undici transient error codes', () => {
    expect(isTransientNetworkError({ code: 'UND_ERR_CONNECT_TIMEOUT' })).toBe(true)
    expect(isTransientNetworkError({ code: 'UND_ERR_SOCKET' })).toBe(true)
    expect(isTransientNetworkError(new Error('undici error: UND_ERR_CONNECT_TIMEOUT'))).toBe(true)
  })

  it('identifies transient errors in cause property', () => {
    const causeError = new TypeError('fetch failed')
    causeError.cause = { code: 'ECONNRESET', message: 'connection reset by peer' }
    expect(isTransientNetworkError(causeError)).toBe(true)

    const nestedUndici = new Error('request aborted')
    nestedUndici.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' }
    expect(isTransientNetworkError(nestedUndici)).toBe(true)
  })

  it('returns false for application / non-transient errors', () => {
    expect(isTransientNetworkError(new Error('404 Not Found'))).toBe(false)
    expect(isTransientNetworkError(new Error('Validation error: invalid id'))).toBe(false)
    expect(isTransientNetworkError(new SyntaxError('Unexpected token in JSON'))).toBe(false)
    expect(isTransientNetworkError({ code: 'ERR_INVALID_ARG_TYPE' })).toBe(false)
    expect(isTransientNetworkError({ code: 'UND_ERR_INVALID_ARG_TYPE' })).toBe(false)
  })
})

describe('resilientFetch & createResilientFetch', () => {
  it('exports a default resilientFetch function', () => {
    expect(typeof resilientFetch).toBe('function')
  })

  it('passes normal request through on first attempt without retrying', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    const mockFetch = vi.fn().mockResolvedValue(mockResponse)
    const sleepFn = vi.fn()

    const fetchInstance = createResilientFetch({
      fetchFn: mockFetch as any,
      sleepFn
    })

    const res = await fetchInstance('https://api.notion.com/v1/users')
    expect(res).toBe(mockResponse)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('automatically retries after delay when first request throws TypeError("fetch failed") and succeeds', async () => {
    const mockResponse = new Response('{"results": []}', { status: 200 })
    const mockFetch = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(mockResponse)
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const fetchInstance = createResilientFetch({
      maxRetries: 2,
      initialDelayMs: 200,
      backoffFactor: 2,
      fetchFn: mockFetch as any,
      sleepFn
    })

    const res = await fetchInstance('https://api.notion.com/v1/pages/123')
    expect(res).toBe(mockResponse)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).toHaveBeenCalledWith(200)
  })

  it('throws immediately without retrying when non-transient error occurs', async () => {
    const nonTransientError = new Error('Invalid JSON payload')
    const mockFetch = vi.fn().mockRejectedValue(nonTransientError)
    const sleepFn = vi.fn()

    const fetchInstance = createResilientFetch({
      maxRetries: 2,
      fetchFn: mockFetch as any,
      sleepFn
    })

    await expect(fetchInstance('https://api.notion.com/v1/databases')).rejects.toThrow('Invalid JSON payload')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('exhausts maxRetries and throws the final error with backoff delays', async () => {
    const finalError = new TypeError('fetch failed')
    finalError.cause = { code: 'ETIMEDOUT' }
    const mockFetch = vi.fn().mockRejectedValue(finalError)
    const sleepFn = vi.fn().mockResolvedValue(undefined)

    const fetchInstance = createResilientFetch({
      maxRetries: 2,
      initialDelayMs: 200,
      backoffFactor: 2,
      fetchFn: mockFetch as any,
      sleepFn
    })

    await expect(fetchInstance('https://api.notion.com/v1/blocks/123')).rejects.toThrow('fetch failed')
    // 1 initial attempt + 2 retries = 3 attempts
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(sleepFn).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 200)
    expect(sleepFn).toHaveBeenNthCalledWith(2, 400)
  })
})
