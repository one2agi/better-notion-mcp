/**
 * Workspace Mega Tool
 * Workspace exploration and info
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import { parseMaybeJSON } from '../helpers/json-input.js'
import { autoPaginate } from '../helpers/pagination.js'
import { extractPageId } from '../helpers/property-codecs.js'

export interface WorkspaceInfoResult {
  action: 'info'
  bot: {
    id: string
    name: string
    type: string
    owner?: any
  }
}

export interface WorkspaceSearchResultItem {
  id: string
  object: string
  title: string
  url: string
  last_edited_time: string
  database_id?: string
  parent?: {
    type: string
    id?: string
  }
}

export interface WorkspaceSearchResult {
  action: 'search'
  query?: string
  total: number
  results: WorkspaceSearchResultItem[]
}

export type WorkspaceResult = WorkspaceInfoResult | WorkspaceSearchResult

export interface WorkspaceInput {
  action: 'info' | 'search'

  // Search params
  query?: string
  parent_id?: string
  filter?: {
    object?: 'page' | 'data_source'
    property?: string
    value?: any
  }
  sort?: {
    direction?: 'ascending' | 'descending'
    timestamp?: 'last_edited_time' | 'created_time'
  }
  limit?: number
  in_trash?: boolean
  archived?: boolean
}

// Cache for bot identity
const infoCache = new WeakMap<Client, { bot: any; expiresAt: number }>()
const INFO_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Unified workspace tool
 * Maps to: GET /v1/users/me and POST /v1/search
 */
export async function workspace(notion: Client, input: WorkspaceInput): Promise<WorkspaceResult> {
  return withErrorHandling(async () => {
    switch (input.action) {
      case 'info': {
        const cached = infoCache.get(notion)
        if (cached && Date.now() < cached.expiresAt) {
          return {
            action: 'info' as const,
            bot: cached.bot
          }
        }

        const botUser = await notion.users.retrieve({ user_id: 'me' })
        const bot = {
          id: (botUser as any).id,
          name: (botUser as any).name || 'Bot',
          type: (botUser as any).type,
          owner: (botUser as any).bot?.owner
        }

        infoCache.set(notion, {
          bot,
          expiresAt: Date.now() + INFO_CACHE_TTL
        })

        return {
          action: 'info' as const,
          bot
        }
      }

      case 'search': {
        const isTrashRequested =
          input.in_trash === true ||
          (input.in_trash as unknown) === 'true' ||
          input.archived === true ||
          (input.archived as unknown) === 'true'

        if (isTrashRequested) {
          throw new NotionMCPError(
            'Notion REST API does not support searching deleted or archived pages in workspace.search',
            'VALIDATION_ERROR',
            'To restore an archived page, use pages.restore({ page_id: "<id>" }) directly. If you need the ID, check parent page block history, database sync logs, or previous search results.'
          )
        }

        // Query is optional - empty query returns all accessible pages
        const parsedFilter = parseMaybeJSON<NonNullable<WorkspaceInput['filter']>>(input.filter, 'filter')
        const searchParams: any = {
          query: input.query || ''
        }

        if (parsedFilter?.object) {
          searchParams.filter = {
            value: parsedFilter.object,
            property: 'object'
          }
        }

        const parsedSort = parseMaybeJSON<NonNullable<WorkspaceInput['sort']>>(input.sort, 'sort')
        if (parsedSort) {
          searchParams.sort = {
            direction: parsedSort.direction || 'descending',
            timestamp: parsedSort.timestamp || 'last_edited_time'
          }
        }

        // Fetch results with pagination
        // If parent_id is specified, fetch candidates without limit to avoid starvation before in-memory filter
        const paginationOpts = input.parent_id ? { maxPages: 3, pageSize: 100 } : { limit: input.limit }

        const results = await autoPaginate(
          (cursor, pageSize) =>
            notion.search({
              ...searchParams,
              start_cursor: cursor,
              page_size: pageSize
            }),
          paginationOpts
        )

        let filteredResults = results
        if (input.parent_id) {
          const targetParentId = extractPageId(input.parent_id).replace(/-/g, '').toLowerCase()
          filteredResults = results.filter((item: any) => {
            const p = item.parent
            if (!p) return false
            const itemParentId = (p.page_id || p.database_id || p.block_id || '').replace(/-/g, '').toLowerCase()
            return itemParentId === targetParentId
          })
          if (input.limit && input.limit > 0) {
            filteredResults = filteredResults.slice(0, input.limit)
          }
        }

        const formattedResults = new Array(filteredResults.length)
        for (let i = 0; i < filteredResults.length; i++) {
          const item: any = filteredResults[i]
          const result: any = {
            id: item.id,
            object: item.object,
            title:
              item.object === 'page'
                ? item.properties?.title?.title?.[0]?.plain_text ||
                  item.properties?.Name?.title?.[0]?.plain_text ||
                  'Untitled'
                : item.title?.[0]?.plain_text || 'Untitled',
            url: item.url,
            last_edited_time: item.last_edited_time
          }
          if (item.parent) {
            result.parent = {
              type: item.parent.type,
              id: item.parent.page_id || item.parent.database_id || item.parent.block_id
            }
          }
          // For data_source objects, include the parent database_id
          // This lets callers use either ID with the databases tool
          if (item.object === 'data_source' && item.parent?.database_id) {
            result.database_id = item.parent.database_id
          }
          formattedResults[i] = result
        }

        return {
          action: 'search' as const,
          query: input.query,
          total: filteredResults.length,
          results: formattedResults
        }
      }

      default:
        throwUnknownAction(input.action, ['info', 'search'], 'workspace')
    }
  })()
}
