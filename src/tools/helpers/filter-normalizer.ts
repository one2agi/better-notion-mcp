/**
 * Database filter normalizer
 * Bridges the ergonomic gap between flat key-value filters and Notion's nested filter DSL.
 */

/**
 * Checks if a filter input is a flat key-value object rather than a native Notion filter DSL.
 */
export function isFlatFilter(filter: any): boolean {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return false
  }

  // Native Notion compound filters
  if ('and' in filter || 'or' in filter) {
    return false
  }

  // Native Notion single-property or timestamp filters
  if ('property' in filter || 'timestamp' in filter) {
    return false
  }

  // An object with at least one key is treated as flat
  return Object.keys(filter).length > 0
}

/**
 * Normalizes a flat key-value filter object into Notion's official filter DSL using database schema properties.
 * If the filter is already a native Notion filter or empty, it is returned unchanged.
 */
export function normalizeFilter(properties: Record<string, any> | undefined, filter: any): any {
  if (!filter || !isFlatFilter(filter)) {
    return filter
  }

  const keys = Object.keys(filter)
  if (keys.length === 0) {
    return filter
  }

  // Build a lookup map for case-insensitive schema property resolution
  const schemaLookup = new Map<string, { exactName: string; type: string }>()
  if (properties) {
    for (const [name, def] of Object.entries<any>(properties)) {
      schemaLookup.set(name.toLowerCase(), { exactName: name, type: def.type || 'rich_text' })
    }
  }

  const conditions: any[] = []

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = filter[key]
    const matched = schemaLookup.get(key.toLowerCase())

    const propName = matched ? matched.exactName : key
    const propType = matched ? matched.type : 'rich_text'

    let condition: any

    switch (propType) {
      case 'status':
      case 'select':
        condition = {
          property: propName,
          [propType]: { equals: String(value) }
        }
        break

      case 'checkbox':
        condition = {
          property: propName,
          checkbox: { equals: Boolean(value) }
        }
        break

      case 'number':
        condition = {
          property: propName,
          number: { equals: Number(value) }
        }
        break

      case 'multi_select':
      case 'relation':
        condition = {
          property: propName,
          [propType]: { contains: String(value) }
        }
        break

      case 'date':
        condition = {
          property: propName,
          date: { equals: String(value) }
        }
        break

      case 'title':
        condition = {
          property: propName,
          title: { equals: String(value) }
        }
        break

      default:
        condition = {
          property: propName,
          rich_text: { equals: String(value) }
        }
        break
    }

    conditions.push(condition)
  }

  if (conditions.length === 0) {
    return filter
  }

  if (conditions.length === 1) {
    return conditions[0]
  }

  return { and: conditions }
}
