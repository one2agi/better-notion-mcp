import { describe, expect, it } from 'vitest'
import { NotionMCPError } from './errors.js'
import { parseMaybeJSON } from './json-input.js'

describe('parseMaybeJSON', () => {
  it('passes through non-string values unchanged', () => {
    const obj = { 数字: 100, 状态: '进行中' }
    expect(parseMaybeJSON(obj)).toBe(obj)
    const arr = [1, 2, 3]
    expect(parseMaybeJSON(arr)).toBe(arr)
  })

  it('passes through null and undefined unchanged', () => {
    expect(parseMaybeJSON(null)).toBe(null)
    expect(parseMaybeJSON(undefined)).toBe(undefined)
  })

  it('parses a JSON object string', () => {
    const result = parseMaybeJSON<Record<string, unknown>>('{"数字":100,"状态":"进行中"}')
    expect(result).toEqual({ 数字: 100, 状态: '进行中' })
  })

  it('parses a JSON array string', () => {
    const result = parseMaybeJSON<Array<{ id: string }>>('[{"id":"p1"},{"id":"p2"}]')
    expect(result).toEqual([{ id: 'p1' }, { id: 'p2' }])
  })

  it('throws NotionMCPError on malformed JSON string with field context', () => {
    let caught: unknown
    try {
      parseMaybeJSON('{not valid json', 'properties')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(NotionMCPError)
    const err = caught as NotionMCPError
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toContain('(field: properties)')
    expect(err.message).toContain('Failed to parse JSON string')
    expect(err.suggestion).toContain('JSON object/array string')
  })

  it('throws NotionMCPError without field context when none provided', () => {
    let caught: unknown
    try {
      parseMaybeJSON('{nope')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(NotionMCPError)
    const err = caught as NotionMCPError
    expect(err.message).not.toContain('(field:')
    expect(err.message).toContain('Failed to parse JSON string')
  })

  it('passes through primitive numbers/booleans unchanged', () => {
    // Edge case: tool input schema could be `any` for some parameters.
    // Primitives should never be JSON-parsed (would stringify first).
    expect(parseMaybeJSON(42)).toBe(42)
    expect(parseMaybeJSON(true)).toBe(true)
    expect(parseMaybeJSON(false)).toBe(false)
  })
})
