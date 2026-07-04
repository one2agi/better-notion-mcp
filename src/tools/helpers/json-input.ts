/**
 * JSON-input Coercion Helper
 *
 * Lets MCP tool inputs accept either a parsed value or a JSON stringification
 * of one. Some MCP clients (notably Claude Code) serialize tool arguments as
 * XML and silently drop nested-object content to `{}`. Wrapping nested-object
 * parameters with `parseMaybeJSON` gives those callers an escape hatch: they
 * pass a JSON-encoded string (which XML serialization preserves) and the
 * server parses it before forwarding to Notion.
 *
 * Pattern:
 *   const props = parseMaybeJSON(input.properties, 'properties')
 *   await notion.pages.update({ page_id, properties: props, ... })
 *
 * Non-string inputs (including raw objects, arrays, null, undefined, numbers,
 * booleans) pass through unchanged. Only string inputs are parsed. Malformed
 * JSON throws `NotionMCPError` with a clear field reference so the caller can
 * locate the bad input.
 */
import { NotionMCPError } from './errors.js'

/**
 * Accept either a parsed value or a JSON-encoded string of the same shape.
 *
 * @param value - Either the parsed value (object/array/etc.) or a JSON string
 *   encoding one.
 * @param errorContext - Field name shown in the error message (e.g.
 *   `'properties'`, `'filters'`, `'updates'`). Helps the caller locate the
 *   offender in their MCP call.
 * @returns `value` if it was already a non-string; otherwise the JSON.parse
 *   result cast to T.
 * @throws {NotionMCPError} `VALIDATION_ERROR` if `value` is a string but the
 *   contents are not valid JSON.
 */
export function parseMaybeJSON<T>(value: unknown, errorContext?: string): T {
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch (e) {
    const ctx = errorContext ? ` (field: ${errorContext})` : ''
    const reason = e instanceof Error ? e.message : String(e)
    throw new NotionMCPError(
      `Failed to parse JSON string${ctx}: ${reason}`,
      'VALIDATION_ERROR',
      'Provide a valid JSON object/array string, or pass the parsed object directly.'
    )
  }
}
