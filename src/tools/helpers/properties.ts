/**
 * Property Helpers
 * Convert between human-friendly and Notion API formats
 */

import { NotionMCPError } from './errors.js'
import { parseRichText } from './markdown.js'
import * as RichText from './richtext.js'

/**
 * Notion server-managed property types that POST /v1/pages rejects.
 * Reference: https://developers.notion.com/reference/post-page
 * These fields are computed by Notion and cannot be set when creating a page.
 */
export const READONLY_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'formula',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'unique_id',
  'verification'
])

/**
 * Find the name of the title-typed column in a Notion data-source schema.
 * Returns null if no title column exists (shouldn't happen in practice —
 * every data source has exactly one title column).
 */
export function findTitleColumnName(schema: Record<string, string>): string | null {
  for (const name of Object.keys(schema)) {
    if (schema[name] === 'title') return name
  }
  return null
}

/**
 * Filter a properties map to only keys present in the schema. Prevents
 * Notion API rejection when callers pass extra keys (e.g. { Name: 'X' }
 * when schema title column is "Title") — those foreign keys would
 * otherwise be sent as-is and rejected as "not a property that exists".
 */
export function filterToSchemaKeys(
  properties: Record<string, any>,
  schema: Record<string, string>
): Record<string, any> {
  const validKeys = new Set(Object.keys(schema))
  const filtered: Record<string, any> = {}
  for (const k of Object.keys(properties)) {
    if (validKeys.has(k)) filtered[k] = properties[k]
  }
  return filtered
}

/**
 * Strip Notion-managed readonly properties from a page properties map.
 * Used when duplicating pages — these fields are computed by Notion
 * and cannot be set via POST /v1/pages.
 */
export function sanitizeReadonlyProperties(
  properties: Record<string, any> | undefined
): Record<string, any> {
  const result: Record<string, any> = {}
  if (!properties) return result
  for (const [key, prop] of Object.entries(properties)) {
    const propType = (prop as any)?.type

    // Skip server-managed readonly types (formula, rollup, created_*, etc.)
    if (propType && READONLY_PROPERTY_TYPES.has(propType)) continue

    // Skip non-objects (defensive: malformed input)
    if (!prop || typeof prop !== 'object') continue

    // Skip properties whose value field exists but is empty — Notion API
    // rejects these on POST /v1/pages (Bug #23 + #29). Only check when
    // the value key is present; missing-value cases are passed through.
    if (propType === 'relation') {
      if ('relation' in prop && (!Array.isArray(prop.relation) || prop.relation.length === 0)) continue
    } else if (propType === 'rich_text' || propType === 'title') {
      if (propType in prop && (!Array.isArray(prop[propType]) || prop[propType].length === 0)) continue
    } else if (propType === 'people' || propType === 'files') {
      if (propType in prop && (!Array.isArray(prop[propType]) || prop[propType].length === 0)) continue
    } else if (propType === 'select' || propType === 'status') {
      // select / status: null OR no value field at all = unset — Notion rejects.
      // (Real Notion API retrieve returns `{ type: 'select', select: null }` for unset;
      // fetched pages may have value field omitted entirely.)
      if (!(propType in prop) || prop[propType] === null) continue
    }

    result[key] = prop
  }
  return result
}

const PAGE_ID_REGEX = /([a-f0-9]{32})/

/** Extract a 32-char hex page ID from a Notion URL, or return the input as-is if it's already a raw ID */
function extractPageId(value: any): string {
  if (typeof value !== 'string') return String(value)
  const match = value.match(PAGE_ID_REGEX)
  if (match) return match[1]
  // Also accept hyphenated UUIDs as-is
  return value
}

/** Convert a single string or array value to Notion relation format */
function toRelation(value: any): { relation: { id: string }[] } {
  if (typeof value === 'string') {
    if (value === '') return { relation: [] }
    // Try parsing as JSON array (e.g. '["id1", "id2"]')
    if (value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
          return { relation: parsed.map((v: string) => ({ id: extractPageId(v) })) }
        }
      } catch {
        // Not valid JSON, treat as single value
      }
    }
    return { relation: [{ id: extractPageId(value) }] }
  }
  if (Array.isArray(value)) {
    return {
      relation: value.map((v: any) => (typeof v === 'object' && v !== null && 'id' in v ? v : { id: extractPageId(v) }))
    }
  }
  return value
}

/**
 * Convert simple property values to Notion API format
 * Handles auto-detection of property types and conversion
 */
export function convertToNotionProperties(
  properties: Record<string, any>,
  schema?: Record<string, string>
): Record<string, any> {
  const converted: Record<string, any> = {}

  const keys = Object.keys(properties)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = properties[key]

    if (value === null || value === undefined) {
      converted[key] = value
      continue
    }

    // Auto-detect property type and convert
    if (typeof value === 'string') {
      // Use schema type if available
      const schemaType = schema?.[key]

      if (schemaType === 'title') {
        converted[key] = { title: [RichText.text(value)] }
      } else if (schemaType === 'rich_text') {
        converted[key] = { rich_text: [RichText.text(value)] }
      } else if (schemaType === 'date') {
        converted[key] = { date: { start: value } }
      } else if (schemaType === 'url') {
        converted[key] = { url: value }
      } else if (schemaType === 'email') {
        converted[key] = { email: value }
      } else if (schemaType === 'phone_number') {
        converted[key] = { phone_number: value }
      } else if (schemaType === 'relation') {
        converted[key] = toRelation(value)
      } else if (schemaType === 'select') {
        converted[key] = { select: { name: value } }
      } else if (schemaType === 'status') {
        converted[key] = { status: { name: value } }
      } else if (key === 'Name' || key === 'Title' || key.toLowerCase() === 'title') {
        // Fallback: guess title from key name
        converted[key] = { title: [RichText.text(value)] }
      } else {
        // Default: most fields named "Status" are actually select columns, not status type.
        // If the column is actually status type, the schema-aware branch above handles it.
        converted[key] = { select: { name: value } }
      }
    } else if (typeof value === 'number') {
      converted[key] = { number: value }
    } else if (typeof value === 'boolean') {
      converted[key] = { checkbox: value }
    } else if (Array.isArray(value)) {
      const schemaType = schema?.[key]
      if (schemaType === 'relation') {
        converted[key] = toRelation(value)
        continue
      }
      // Could be multi_select, relation, people, files
      // Only assume multi_select if all elements are strings
      if (value.length > 0 && value.every((v) => typeof v === 'string')) {
        const multiSelect = new Array(value.length)
        for (let j = 0; j < value.length; j++) {
          multiSelect[j] = { name: value[j] }
        }
        converted[key] = {
          multi_select: multiSelect
        }
      } else {
        converted[key] = value
      }
    } else if (typeof value === 'object') {
      // Already in Notion format or date/complex object
      converted[key] = value
    } else {
      converted[key] = value
    }
  }

  return converted
}

/**
 * Highly optimized extraction of properties from a Notion page response.
 * Uses direct string building and fixed-length arrays to avoid
 * creating thousands of intermediate arrays during large `.map()` chains.
 */
export function extractPageProperties(pageProperties: any): any {
  if (!pageProperties) return {}
  const properties: any = {}

  const keys = Object.keys(pageProperties)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const p = pageProperties[key] as any
    // Cache p.type once per iteration -- avoids ~20 redundant property
    // lookups in the if/else-if chain on every Notion page row.
    const type = p.type as string | undefined

    switch (type) {
      case 'title': {
        if (p.title) {
          const title = p.title
          const len = title.length
          const arr = new Array(len)
          for (let j = 0; j < len; j++) arr[j] = title[j].plain_text || ''
          properties[key] = arr.join('')
        }
        break
      }
      case 'rich_text': {
        if (p.rich_text) {
          const richText = p.rich_text
          const len = richText.length
          const arr = new Array(len)
          for (let j = 0; j < len; j++) arr[j] = richText[j].plain_text || ''
          properties[key] = arr.join('')
        }
        break
      }
      case 'select': {
        if (p.select) properties[key] = p.select.name
        break
      }
      case 'multi_select': {
        if (p.multi_select) {
          const ms = p.multi_select
          const arr = new Array(ms.length)
          for (let j = 0; j < ms.length; j++) arr[j] = ms[j].name
          properties[key] = arr
        }
        break
      }
      case 'number': {
        properties[key] = p.number
        break
      }
      case 'checkbox': {
        properties[key] = p.checkbox
        break
      }
      case 'url': {
        properties[key] = p.url
        break
      }
      case 'email': {
        properties[key] = p.email
        break
      }
      case 'phone_number': {
        properties[key] = p.phone_number
        break
      }
      case 'date': {
        if (p.date) {
          const d = p.date
          properties[key] = d.start + (d.end ? ` to ${d.end}` : '')
        }
        break
      }
      case 'relation': {
        if (p.relation) {
          const rel = p.relation
          const arr = new Array(rel.length)
          for (let j = 0; j < rel.length; j++) arr[j] = rel[j].id
          properties[key] = arr
        }
        break
      }
      case 'rollup': {
        if (p.rollup) properties[key] = p.rollup
        break
      }
      case 'people': {
        if (p.people) {
          const ppl = p.people
          const arr = new Array(ppl.length)
          for (let j = 0; j < ppl.length; j++) arr[j] = ppl[j].name || ppl[j].id
          properties[key] = arr
        }
        break
      }
      case 'files': {
        if (p.files) {
          const files = p.files
          const arr = new Array(files.length)
          for (let j = 0; j < files.length; j++) {
            const f = files[j]
            arr[j] = f.file?.url || f.external?.url || f.name
          }
          properties[key] = arr
        }
        break
      }
      case 'formula': {
        if (p.formula) {
          const f = p.formula
          properties[key] = f.type ? (f[f.type] ?? null) : null
        }
        break
      }
      case 'created_time': {
        properties[key] = p.created_time
        break
      }
      case 'last_edited_time': {
        properties[key] = p.last_edited_time
        break
      }
      case 'created_by': {
        if (p.created_by) {
          properties[key] = p.created_by?.name || p.created_by?.id
        }
        break
      }
      case 'last_edited_by': {
        if (p.last_edited_by) {
          properties[key] = p.last_edited_by?.name || p.last_edited_by?.id
        }
        break
      }
      case 'status': {
        if (p.status) {
          properties[key] = p.status?.name
        }
        break
      }
      case 'unique_id': {
        if (p.unique_id) {
          const u = p.unique_id
          properties[key] = u.prefix ? `${u.prefix}-${u.number}` : u.number
        }
        break
      }
    }
  }
  return properties
}

/**
 * Normalize per-block-type properties from the user's input format to the
 * shape Notion's API expects. Throws NotionMCPError on invalid input.
 *
 * Extracted from `composite/blocks.ts` so it can be unit-tested in isolation
 * and reused if other code paths need to format block properties.
 */
export function normalizeBlockProperties(blockType: string, raw: Record<string, any>): any {
  if (blockType === 'table_row') {
    const cells = raw.cells
    if (Array.isArray(cells) && cells.length > 0 && Array.isArray(cells[0])) {
      // cells is string[][] or RichText[][]
      if (cells[0].length > 0 && typeof cells[0][0] === 'string') {
        // string[][] -> RichText[][]
        return {
          cells: (cells as string[][]).map((row) => row.map((cell) => parseRichText(cell)))
        }
      }
      // already RichText[][] - pass through
      return { cells }
    }
    throw new NotionMCPError(
      'table_row.properties.cells must be string[][] or RichText[][]',
      'VALIDATION_ERROR',
      'Provide cells as e.g. [["A", "B"], ["C", "D"]]'
    )
  }

  if (blockType === 'synced_block') {
    // Accept { synced_from: null } (unlink) or { synced_from: { block_id } } (link)
    if (raw.synced_from === null) {
      return { synced_from: null }
    }
    if (raw.synced_from && typeof raw.synced_from === 'object' && typeof raw.synced_from.block_id === 'string') {
      return { synced_from: { block_id: raw.synced_from.block_id } }
    }
    throw new NotionMCPError(
      'synced_block.properties.synced_from must be null or { block_id: string }',
      'VALIDATION_ERROR',
      'Pass null to unlink, or { block_id: "<id>" } to link'
    )
  }

  if (blockType === 'link_to_page') {
    const targets = ['page_id', 'database_id', 'comment_id'].filter((k) => raw[k])
    if (targets.length !== 1) {
      throw new NotionMCPError(
        'link_to_page requires exactly one of: page_id, database_id, comment_id',
        'VALIDATION_ERROR',
        'Provide e.g. { page_id: "<page-id>" } or { database_id: "<db-id>" }'
      )
    }
    return { [targets[0]]: raw[targets[0]] }
  }

  if (blockType === 'column') {
    const ratio = raw.width_ratio
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new NotionMCPError(
        'width_ratio must be between 0 and 1',
        'VALIDATION_ERROR',
        'Provide a positive number up to 1 (e.g. 0.5 for half-width column)'
      )
    }
    return { width_ratio: ratio }
  }

  // table: pass-through (has_column_header / has_row_header are already bool)
  return raw
}

/**
 * Read a property's raw value from a Notion page, used for numeric / date
 * aggregations. Returns null for missing/empty properties (caller should skip
 * these in sum/avg).
 *
 * Extracted from `composite/databases.ts` so the property-type coverage
 * lives in one place (alongside `extractPageProperties`).
 */
export function readPropertyValue(page: any, propertyName: string): any {
  const prop = page?.properties?.[propertyName]
  if (!prop) return null
  switch (prop.type) {
    case 'number':
      return typeof prop.number === 'number' ? prop.number : null
    case 'checkbox':
      return typeof prop.checkbox === 'boolean' ? prop.checkbox : null
    case 'select':
      return prop.select?.name ?? null
    case 'multi_select':
      return Array.isArray(prop.multi_select) ? prop.multi_select.map((o: any) => o.name) : null
    case 'date':
      return prop.date?.start ?? null
    case 'status':
      return prop.status?.name ?? null
    case 'formula':
      // formula 属性返回 { type: "formula", formula: { type: "number", number: 42 } }
      if (prop.formula?.type === 'number' && typeof prop.formula.number === 'number') {
        return prop.formula.number
      }
      if (prop.formula?.type === 'string') {
        if (prop.formula.string === null) return null
        const parsed = parseFloat(prop.formula.string)
        return Number.isNaN(parsed) ? prop.formula.string : parsed
      }
      if (prop.formula?.type === 'boolean') {
        return prop.formula.boolean ?? null
      }
      if (prop.formula?.type === 'date') {
        return prop.formula.date?.start ?? null
      }
      return null
    case 'people':
      return Array.isArray(prop.people) ? prop.people.map((p: any) => p.id) : null
    case 'rich_text':
      return Array.isArray(prop.rich_text) ? prop.rich_text.map((t: any) => t.plain_text).join('') : null
    case 'title':
      return Array.isArray(prop.title) ? prop.title.map((t: any) => t.plain_text).join('') : null
    default:
      return null
  }
}

/**
 * One entry in the schema map produced by `buildSchemaMap`.
 */
export interface SchemaMapEntry {
  type: string
  id: string
  options?: string[]
  expression?: string
}

/**
 * Build a `{ name: { type, id, options?, expression? } }` map from a Notion
 * data-source properties payload.
 *
 * Used by:
 * - `getDatabase` (full metadata with `includeOptions: true` default)
 * - `createDatabasePages` (type-only via the `includeOptions: false` flag)
 *
 * Extracted from `composite/databases.ts` to eliminate two near-identical
 * schema iteration loops.
 */
export function buildSchemaMap(
  properties: Record<string, any> | undefined,
  options: { includeOptions?: boolean } = { includeOptions: true }
): Record<string, SchemaMapEntry> {
  const schema: Record<string, SchemaMapEntry> = {}
  if (!properties) return schema
  const keys = Object.keys(properties)
  for (let i = 0; i < keys.length; i++) {
    const name = keys[i]
    const p = properties[name]
    const entry: SchemaMapEntry = { type: p.type, id: p.id }
    if (options.includeOptions) {
      if (p.type === 'select' && p.select?.options) {
        entry.options = p.select.options.map((o: any) => o.name)
      } else if (p.type === 'multi_select' && p.multi_select?.options) {
        entry.options = p.multi_select.options.map((o: any) => o.name)
      } else if (p.type === 'formula' && p.formula) {
        entry.expression = p.formula.expression
      }
    }
    schema[name] = entry
  }
  return schema
}
