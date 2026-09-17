/**
 * Page property resolver helper
 * Handles single property retrieval, multilingual name to property_id resolution,
 * automatic pagination, and typed fallback values.
 * Maps to: GET /v1/pages/{id}/properties/{property_id}
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError } from './errors.js'
import { autoPaginate } from './pagination.js'

export interface GetPagePropertyResult {
  action: 'get_property'
  page_id: string
  property_id: string
  type: string
  value: any
}

export interface GetPagePropertyInput {
  page_id?: string
  property_id?: string
  property_name?: string
  [key: string]: any
}

/**
 * Retrieve a page property item (supports paginated properties like relation, rollup, rich_text)
 * Maps to: GET /v1/pages/{id}/properties/{property_id}
 */
export async function getPageProperty(notion: Client, input: GetPagePropertyInput): Promise<GetPagePropertyResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for get_property action', 'VALIDATION_ERROR', 'Provide page_id')
  }

  let propertyId = input.property_id || input.property_name
  if (!propertyId) {
    throw new NotionMCPError(
      'property_id is required for get_property action',
      'VALIDATION_ERROR',
      'Provide property_id (from page properties metadata)'
    )
  }

  let propertyTypeHint: string | undefined

  // Attempt to resolve property name to property ID.
  // In Notion, property_id in the retrieve endpoint must be a property ID (or 'title'),
  // but callers frequently pass property names (e.g. 'Status', '源链接', 'Tags').
  const isDirectId = propertyId === 'title' || propertyId.startsWith('%')
  const shouldResolveName = Boolean(input.property_name || !isDirectId || /[^\w\-_%]/.test(propertyId))

  if (shouldResolveName && notion.pages?.retrieve) {
    try {
      const page = (await notion.pages.retrieve({ page_id: input.page_id })) as any
      if (page?.properties) {
        const targetName = input.property_name || propertyId
        if (page.properties[targetName]) {
          const prop = page.properties[targetName]
          propertyId = prop.id
          propertyTypeHint = prop.type
        } else {
          for (const [name, prop] of Object.entries<any>(page.properties)) {
            if (name.toLowerCase() === targetName.toLowerCase()) {
              propertyId = prop.id
              propertyTypeHint = prop.type
              break
            }
          }
        }
      }
    } catch {
      // Fall through to direct property retrieve
    }
  }

  let propertyItemType: string | undefined

  // Fetch with auto-pagination for paginated property items
  const allResults = await autoPaginate(async (cursor) => {
    const response: any = await notion.pages.properties.retrieve({
      page_id: input.page_id!,
      property_id: propertyId,
      start_cursor: cursor,
      page_size: 100
    } as any)

    if (response.property_item?.type) {
      propertyItemType = response.property_item.type
    } else if (response.type && response.type !== 'property_item') {
      propertyItemType = response.type
    }

    // Non-paginated property items return the value directly (no results array)
    if (!response.results) {
      return {
        results: [response],
        next_cursor: null,
        has_more: false
      }
    }

    return {
      results: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more
    }
  })

  // Format results based on property type
  const firstResult = allResults[0] as any
  const propertyType = firstResult?.type || propertyItemType || propertyTypeHint || 'unknown'

  let value: any
  switch (propertyType) {
    case 'title':
    case 'rich_text': {
      if (allResults.length === 0) {
        value = ''
        break
      }
      const len = allResults.length
      const arr = new Array(len)
      for (let i = 0; i < len; i++) {
        arr[i] = (allResults[i] as any)[propertyType]?.plain_text || ''
      }
      value = arr.join('')
      break
    }
    case 'relation': {
      const relationIds: string[] = []
      for (const item of allResults as any[]) {
        const id = item.relation?.id
        if (id) {
          relationIds.push(id)
        }
      }
      value = relationIds
      break
    }
    case 'rollup':
      value = firstResult?.rollup ?? null
      break
    case 'people':
      if (allResults.length === 0) {
        value = []
        break
      }
      value = allResults.map((item: any) => ({
        id: item.people?.id,
        name: item.people?.name
      }))
      break
    case 'multi_select':
    case 'files':
      value = allResults.length === 0 ? [] : (firstResult?.[propertyType] ?? [])
      break
    default:
      // For non-paginated types, return the raw value
      if (allResults.length === 0) {
        value = null
      } else {
        value = firstResult?.[propertyType] ?? firstResult
      }
      break
  }

  return {
    action: 'get_property',
    page_id: input.page_id,
    property_id: propertyId!,
    type: propertyType,
    value
  }
}
