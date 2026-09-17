/**
 * Property Helpers
 * Convert between human-friendly and Notion API formats
 */

import { extractPageId, PAGE_ID_REGEX, PROPERTY_CODECS, type PropertyCodec, toRelation } from './property-codecs.js'
import * as RichText from './richtext.js'

export { normalizeBlockProperties } from './block-properties.js'
export { extractPageId, PAGE_ID_REGEX, PROPERTY_CODECS, type PropertyCodec, toRelation }

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
  'verification',
  'button'
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

export interface SanitizeOptions {
  mode?: 'create' | 'update'
}

export interface SanitizeResult {
  writable: Record<string, any>
  ignoredProperties: string[]
}

/**
 * Strip Notion-managed readonly properties from a page properties map.
 * In create mode (default), empty values and arrays are dropped to avoid POST /v1/pages 400.
 * In update mode, null values and empty arrays are preserved so Notion API clears the fields.
 */
export function sanitizeReadonlyPropertiesWithFeedback(
  properties: Record<string, any> | undefined,
  options?: SanitizeOptions
): SanitizeResult {
  const mode = options?.mode ?? 'create'
  const writable: Record<string, any> = {}
  const ignoredProperties: string[] = []

  if (!properties) return { writable, ignoredProperties }

  for (const [key, prop] of Object.entries(properties)) {
    if (prop === null || prop === undefined) {
      if (mode === 'update') {
        writable[key] = prop
      }
      continue
    }

    // Skip non-objects
    if (typeof prop !== 'object') {
      if (mode === 'update') {
        writable[key] = prop
      }
      continue
    }

    const propType = (prop as any)?.type

    // Skip server-managed readonly types (formula, rollup, created_*, etc.)
    if (propType && READONLY_PROPERTY_TYPES.has(propType)) {
      ignoredProperties.push(key)
      continue
    }

    // Detect readonly even when `type` is absent: a property whose only field
    // is a readonly-typed key (e.g. `{ created_time: '...' }`) is also a
    // readonly property. Mirror convertToNotionProperties' pass-through shape
    // so callers can POST raw values without explicit `type` (Bug #35).
    if (!propType) {
      const keys = Object.keys(prop).filter((k) => k !== 'type' && k !== 'id')
      if (keys.length === 1 && READONLY_PROPERTY_TYPES.has(keys[0])) {
        ignoredProperties.push(key)
        continue
      }
    }

    // Skip properties whose value field exists but is empty — Notion API
    // rejects these on POST /v1/pages (Bug #23 + #29). Only check when
    // mode is 'create'. On 'update', Notion allows null/empty arrays to clear.
    if (mode === 'create') {
      if (propType === 'relation') {
        if ('relation' in prop && (!Array.isArray(prop.relation) || prop.relation.length === 0)) continue
      } else if (propType === 'rich_text' || propType === 'title') {
        if (propType in prop && (!Array.isArray(prop[propType]) || prop[propType].length === 0)) continue
      } else if (propType === 'people' || propType === 'files') {
        if (propType in prop && (!Array.isArray(prop[propType]) || prop[propType].length === 0)) continue
      } else if (propType === 'select' || propType === 'status') {
        if (!(propType in prop) || prop[propType] === null) continue
      }
    }

    // Button property check
    if (propType === 'button' || (!propType && 'button' in prop)) {
      ignoredProperties.push(key)
      continue
    }

    if (propType === 'status' || propType === 'select') {
      const sub = (prop as any)[propType]
      if (sub && typeof sub === 'object' && 'name' in sub) {
        writable[key] = { [propType]: { name: sub.name } }
      } else if (sub && typeof sub === 'object' && 'id' in sub) {
        writable[key] = { [propType]: { id: sub.id } }
      } else if (sub === null && mode === 'update') {
        writable[key] = { [propType]: null }
      }
      // else in create mode: no usable sub-value — drop the prop
    } else if (propType && ('type' in prop || 'id' in prop)) {
      const { type: _t, id: _i, ...rest } = prop as Record<string, any>
      writable[key] = rest
    } else {
      writable[key] = prop
    }
  }

  return { writable, ignoredProperties }
}

/**
 * Strip Notion-managed readonly properties from a page properties map.
 */
export function sanitizeReadonlyProperties(
  properties: Record<string, any> | undefined,
  options?: SanitizeOptions
): Record<string, any> {
  return sanitizeReadonlyPropertiesWithFeedback(properties, options).writable
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

    const schemaType = schema?.[key]

    const normalizedKey = key.toLowerCase().replace(/[\s_-]+/g, '_')
    const readonlyType =
      (schemaType && READONLY_PROPERTY_TYPES.has(schemaType) ? schemaType : null) ??
      (!schemaType && READONLY_PROPERTY_TYPES.has(normalizedKey) ? normalizedKey : null)

    if (readonlyType) {
      if (typeof value === 'object' && value !== null && ('type' in value || readonlyType in value)) {
        converted[key] = value
      } else {
        converted[key] = { type: readonlyType, [readonlyType]: value }
      }
      continue
    }

    if (value === null || value === undefined) {
      if (schemaType) {
        const codec = PROPERTY_CODECS[schemaType]
        converted[key] = codec ? codec.toNotion(value, { schemaType, key }) : { [schemaType]: null }
      } else {
        converted[key] = value
      }
      continue
    }

    if (typeof value === 'string') {
      if (value === '' && schemaType) {
        const codec = PROPERTY_CODECS[schemaType]
        if (codec) {
          converted[key] = codec.toNotion(value, { schemaType, key })
          continue
        }
      }

      if (schemaType && PROPERTY_CODECS[schemaType]) {
        converted[key] = PROPERTY_CODECS[schemaType].toNotion(value, { schemaType, key })
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
      if (schemaType && PROPERTY_CODECS[schemaType]) {
        converted[key] = PROPERTY_CODECS[schemaType].toNotion(value, { schemaType, key })
        continue
      }
      // Only assume multi_select if all elements are strings and no other schema
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
      if (schemaType === 'date' && value !== null && 'start' in value && !('date' in value)) {
        // Bare {start,end} object for a date column — wrap with the `date` type key.
        converted[key] = { date: value }
      } else {
        // Already in Notion format or date/complex object
        converted[key] = value
      }
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
    // Cache p.type once per iteration -- avoids redundant property lookups
    const type = p.type as string | undefined
    if (!type) continue

    const codec = PROPERTY_CODECS[type]
    if (codec) {
      const val = codec.fromNotion(p)
      if (val !== undefined) {
        properties[key] = val
      }
    }
  }
  return properties
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
  if (!prop?.type) return null
  const codec = PROPERTY_CODECS[prop.type]
  return codec?.toScalar ? codec.toScalar(prop) : null
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
