/**
 * Lightweight resilient fetch wrapper with automatic retry for transient network errors.
 */

export interface ResilientFetchOptions {
  /** Maximum number of retry attempts. Default: 2 */
  maxRetries?: number
  /** Initial delay in ms before first retry. Default: 200 */
  initialDelayMs?: number
  /** Exponential backoff factor. Default: 2 */
  backoffFactor?: number
  /** Underlying fetch implementation. Default: globalThis.fetch */
  fetchFn?: typeof fetch
  /** Custom sleep function for delays. Default: setTimeout promise */
  sleepFn?: (ms: number) => Promise<void>
}

const TRANSIENT_ERROR_CODES = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']

const TRANSIENT_UNDICI_CODES = [
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_DESTROYED',
  'UND_ERR_CLOSED',
  'UND_ERR_ABORTED',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
]

/**
 * Checks whether an error is a transient network error that should be retried.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const err = error as Record<string, any>
  const msg = String(err.message || '')
  const code = String(err.code || '')

  const cause = err.cause && typeof err.cause === 'object' ? (err.cause as Record<string, any>) : undefined
  const causeMsg = cause ? String(cause.message || '') : ''
  const causeCode = cause ? String(cause.code || '') : ''

  // 1. Check direct error codes & cause codes
  if (TRANSIENT_ERROR_CODES.includes(code) || TRANSIENT_ERROR_CODES.includes(causeCode)) {
    return true
  }

  // 2. Check specific transient undici network codes
  if (TRANSIENT_UNDICI_CODES.includes(code) || TRANSIENT_UNDICI_CODES.includes(causeCode)) {
    return true
  }

  // 3. Check error messages (e.g. Node fetch throws TypeError('fetch failed'))
  if (msg.includes('fetch failed') || causeMsg.includes('fetch failed')) {
    return true
  }

  // 4. Check codes appearing in message strings
  for (const c of TRANSIENT_ERROR_CODES) {
    if (msg.includes(c) || causeMsg.includes(c)) {
      return true
    }
  }

  for (const c of TRANSIENT_UNDICI_CODES) {
    if (msg.includes(c) || causeMsg.includes(c)) {
      return true
    }
  }

  return false
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Creates a fetch function that automatically retries transient network errors.
 */
export function createResilientFetch(options: ResilientFetchOptions = {}): typeof fetch {
  const maxRetries = options.maxRetries ?? 2
  const initialDelayMs = options.initialDelayMs ?? 200
  const backoffFactor = options.backoffFactor ?? 2
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const sleepFn = options.sleepFn ?? defaultSleep

  return (async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    let attempt = 0
    let delay = initialDelayMs

    while (true) {
      try {
        return await fetchFn(...args)
      } catch (error) {
        attempt++
        if (attempt <= maxRetries && isTransientNetworkError(error)) {
          await sleepFn(delay)
          delay *= backoffFactor
          continue
        }
        throw error
      }
    }
  }) as typeof fetch
}

/**
 * Default global resilient fetch instance.
 */
export const resilientFetch: typeof fetch = createResilientFetch()
