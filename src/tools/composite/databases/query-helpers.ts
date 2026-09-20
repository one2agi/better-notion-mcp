/**
 * Databases Query Helpers
 * Filter building, smart text search, ergonomic filter normalization, and result formatting.
 */

import type { Client } from '@notionhq/client'
import { getDataSourceSchema } from '../../helpers/data-source.js'
import { isFlatFilter, normalizeFilter } from '../../helpers/filter-normalizer.js'
import { parseMaybeJSON } from '../../helpers/json-input.js'
import { extractPageProperties } from '../../helpers/properties.js'

/**
 * Build a filter that searches across all title and rich_text properties
 */
export function buildSearchFilter(properties: any, search: string): any | null {
  if (!properties) return null

  const keys = Object.keys(properties)
  const or: any[] = []

  for (let i = 0; i < keys.length; i++) {
    const name = keys[i]
    const type = properties[name].type

    switch (type) {
      case 'title':
      case 'rich_text':
        or.push({
          property: name,
          rich_text: { contains: search }
        })
        break
    }
  }

  return or.length > 0 ? { or } : null
}

/**
 * Get search filter for text properties
 */
export async function getSmartSearchFilter(notion: Client, dataSourceId: string, search: string): Promise<any | null> {
  const properties = await getDataSourceSchema(notion, dataSourceId)
  return buildSearchFilter(properties, search)
}

/**
 * Resolves and auto-normalizes filters (supporting both Notion DSL and ergonomic flat filters)
 */
export async function resolveDatabaseFilter(notion: Client, dataSourceId: string, rawFilters: any): Promise<any> {
  let filter = parseMaybeJSON<any>(rawFilters, 'filters')
  if (isFlatFilter(filter)) {
    const properties = await getDataSourceSchema(notion, dataSourceId)
    filter = normalizeFilter(properties, filter)
  }
  return filter
}

/**
 * Format raw Notion page results into AI-friendly property objects
 */
export function formatDatabaseResults(results: any[]): Record<string, any>[] {
  const formattedResults = new Array(results.length)
  for (let i = 0; i < results.length; i++) {
    const page: any = results[i]
    const props = extractPageProperties(page.properties)
    props.page_id = page.id
    props.url = page.url

    formattedResults[i] = props
  }
  return formattedResults
}
