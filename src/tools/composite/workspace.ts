/**
 * Workspace Mega Tool
 * Workspace exploration and info
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import { normalizeId } from '../helpers/id.js'
import { parseMaybeJSON } from '../helpers/json-input.js'
import { autoPaginateWithMetadata } from '../helpers/pagination.js'
import { extractPageId } from '../helpers/property-codecs.js'
import { extractPlainText } from '../helpers/richtext.js'

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
    title?: string
  }
}

export interface WorkspaceSearchResult {
  action: 'search'
  query?: string
  total: number
  results: WorkspaceSearchResultItem[]
  is_truncated?: boolean
  suggestion?: string
}

export type WorkspaceResult = WorkspaceInfoResult | WorkspaceSearchResult

export interface WorkspaceInput {
  action: 'info' | 'search'

  // Search params
  query?: string
  parent_id?: string
  filter?: {
    object?: 'page' | 'data_source' | 'database'
  }
  sort?: {
    direction?: 'ascending' | 'descending'
    timestamp?: 'last_edited_time' | 'created_time'
  }
  limit?: number
  in_trash?: boolean
  archived?: boolean
}

/** Cache for parent title resolution (5 minutes TTL) */
interface CachedParentInfo {
  title: string
  expiresAt: number
}
export const parentTitleCache = new Map<string, CachedParentInfo>()
export const infoCache = new Map<string, { bot: any; expiresAt: number }>()
const INFO_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const PARENT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Clear in-memory caches for workspace tool (useful in tests and manual invalidation)
 */
export function clearWorkspaceCache(): void {
  parentTitleCache.clear()
  infoCache.clear()
}

/**
 * Robust title extraction for pages, databases, and data sources (multi-span rich text aware)
 */
export function getItemTitle(item: any): string {
  if (!item) return 'Untitled'

  if (item.object === 'page' || item.properties) {
    if (item.properties) {
      for (const key of Object.keys(item.properties)) {
        const prop = item.properties[key]
        if (prop?.type === 'title' && prop.title) {
          const text = extractPlainText(prop.title).trim()
          if (text) return text
        }
      }
      const titleProps = [item.properties.title, item.properties.Name, item.properties.名称]
      for (const p of titleProps) {
        if (p?.title) {
          const text = extractPlainText(p.title).trim()
          if (text) return text
        }
      }
    }
  }

  if (item.title) {
    const text = extractPlainText(item.title).trim()
    if (text) return text
  }

  return 'Untitled'
}

/**
 * Fetches parent title via Notion API:
 * GET /v1/databases/:id, GET /v1/pages/:id, or GET /v1/data_sources/:id
 */
async function fetchParentTitle(notion: Client, type: string, id: string): Promise<string | undefined> {
  try {
    if (type === 'data_source_id' && typeof (notion as any).dataSources?.retrieve === 'function') {
      const ds: any = await (notion as any).dataSources.retrieve({ data_source_id: id })
      if (ds && typeof ds === 'object') return getItemTitle(ds)
    }
    if (type === 'database_id') {
      const db: any = await notion.databases.retrieve({ database_id: id })
      if (!db || typeof db !== 'object') return undefined
      return getItemTitle(db)
    }
    const page: any = await notion.pages.retrieve({ page_id: id })
    if (!page || typeof page !== 'object') return undefined
    return getItemTitle(page)
  } catch {
    try {
      if (type === 'database_id' || type === 'data_source_id') {
        const page: any = await notion.pages.retrieve({ page_id: id })
        if (!page || typeof page !== 'object') return undefined
        return getItemTitle(page)
      }
      const db: any = await notion.databases.retrieve({ database_id: id })
      if (!db || typeof db !== 'object') return undefined
      return getItemTitle(db)
    } catch {
      return undefined
    }
  }
}

/**
 * Resolve parent titles for formatted items using candidate matching, memory cache, and concurrent fallback
 */
export async function resolveParentTitles(
  notion: Client,
  formattedItems: WorkspaceSearchResultItem[],
  allSearchResults: any[]
): Promise<void> {
  const candidateTitles = new Map<string, string>()
  for (const candidate of allSearchResults) {
    if (candidate?.id) {
      const cleanId = normalizeId(candidate.id).toLowerCase()
      const title = getItemTitle(candidate)
      candidateTitles.set(cleanId, title)
      if (candidate.object === 'data_source' && candidate.parent?.database_id) {
        const cleanParentDbId = normalizeId(candidate.parent.database_id).toLowerCase()
        if (!candidateTitles.has(cleanParentDbId)) {
          candidateTitles.set(cleanParentDbId, title)
        }
      }
    }
  }

  const pendingParents = new Map<string, { type: string; id: string }>()

  for (const item of formattedItems) {
    if (!item.parent) continue

    if (item.parent.type === 'workspace') {
      item.parent.title = 'Workspace'
      continue
    }

    const parentId = item.parent.id
    if (!parentId) continue

    const cleanParentId = normalizeId(parentId).toLowerCase()

    // Step 1: Candidate search result matching takes top priority (freshest data)
    const candidateTitle = candidateTitles.get(cleanParentId)
    if (candidateTitle) {
      item.parent.title = candidateTitle
      parentTitleCache.set(cleanParentId, { title: candidateTitle, expiresAt: Date.now() + PARENT_CACHE_TTL })
      continue
    }

    // Step 2: In-memory module cache across requests
    const cached = parentTitleCache.get(cleanParentId)
    if (cached && Date.now() < cached.expiresAt) {
      item.parent.title = cached.title
      continue
    }

    if (!pendingParents.has(cleanParentId)) {
      pendingParents.set(cleanParentId, { type: item.parent.type, id: parentId })
    }
  }

  if (pendingParents.size > 0) {
    const fetchPromises = Array.from(pendingParents.entries()).map(async ([cleanId, { type, id }]) => {
      const title = await fetchParentTitle(notion, type, id)
      if (title) {
        parentTitleCache.set(cleanId, { title, expiresAt: Date.now() + PARENT_CACHE_TTL })
      }
      return { cleanId, title }
    })

    await Promise.allSettled(fetchPromises)

    for (const item of formattedItems) {
      if (!item.parent || item.parent.title || !item.parent.id) continue
      const cleanParentId = normalizeId(item.parent.id).toLowerCase()
      const cached = parentTitleCache.get(cleanParentId)
      if (cached) {
        item.parent.title = cached.title
      }
    }
  }
}

/**
 * Unified workspace tool
 * Maps to: GET /v1/users/me and POST /v1/search
 */
export async function workspace(notion: Client, input: WorkspaceInput): Promise<WorkspaceResult> {
  return withErrorHandling(async () => {
    switch (input.action) {
      case 'info': {
        const cached = infoCache.get('bot_info')
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

        infoCache.set('bot_info', {
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
        const parsedFilter = parseMaybeJSON<Record<string, any>>(input.filter, 'filter')

        // Ergonomic adaptation: if caller passed native Notion { property: 'object', value: 'page' }, normalize it
        if (parsedFilter && typeof parsedFilter === 'object') {
          if (parsedFilter.property === 'object' && parsedFilter.value) {
            parsedFilter.object = parsedFilter.value
            delete parsedFilter.property
            delete parsedFilter.value
          }
        }

        if (parsedFilter && (parsedFilter.property !== undefined || parsedFilter.value !== undefined)) {
          const propName = parsedFilter.property || 'Status'
          throw new NotionMCPError(
            `workspace.search does not support filtering by page properties (such as "${propName}"). Notion search API only searches titles and supports filter.object ("page" | "data_source").`,
            'VALIDATION_ERROR',
            'To query or filter database rows by properties, use databases.query({ database_id: "<id>", filters: ... }) instead.'
          )
        }

        const searchParams: any = {
          query: input.query || ''
        }

        if (parsedFilter?.object) {
          const mappedObject = parsedFilter.object === 'database' ? 'data_source' : parsedFilter.object
          searchParams.filter = {
            value: mappedObject,
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

        const { results, hasMore } = await autoPaginateWithMetadata(
          (cursor, pageSize) =>
            notion.search({
              ...searchParams,
              start_cursor: cursor,
              page_size: pageSize
            }),
          paginationOpts
        )

        let filteredResults = results
        let isTruncated = hasMore

        if (input.parent_id) {
          const targetParentId = normalizeId(extractPageId(input.parent_id)).toLowerCase()
          const allMatching = results.filter((item: any) => {
            const p = item.parent
            if (!p) return false
            const itemParentId = normalizeId(
              p.page_id || p.database_id || p.block_id || p.data_source_id || ''
            ).toLowerCase()
            return itemParentId === targetParentId
          })
          if (input.limit && input.limit > 0 && allMatching.length > input.limit) {
            filteredResults = allMatching.slice(0, input.limit)
            isTruncated = true
          } else {
            filteredResults = allMatching
          }
        }

        const formattedResults = new Array(filteredResults.length)
        for (let i = 0; i < filteredResults.length; i++) {
          const item: any = filteredResults[i]
          const result: any = {
            id: item.id,
            object: item.object,
            title: getItemTitle(item),
            url: item.url,
            last_edited_time: item.last_edited_time
          }
          if (item.parent) {
            result.parent = {
              type: item.parent.type,
              id: item.parent.page_id || item.parent.database_id || item.parent.block_id || item.parent.data_source_id
            }
          }
          // For data_source objects, include the parent database_id
          // This lets callers use either ID with the databases tool
          if (item.object === 'data_source' && item.parent?.database_id) {
            result.database_id = item.parent.database_id
          }
          formattedResults[i] = result
        }

        await resolveParentTitles(notion, formattedResults, results)

        const response: WorkspaceSearchResult = {
          action: 'search' as const,
          query: input.query,
          total: filteredResults.length,
          results: formattedResults
        }

        if (isTruncated) {
          response.is_truncated = true
          response.suggestion = input.parent_id
            ? 'Search candidate pool reached 300-page limit or limit cap and was truncated. Some children under this parent may not be shown. Narrow the search query to locate specific items.'
            : 'Search results reached the requested limit while more matching items exist. Specify a more specific query or filter to narrow results.'
        }

        return response
      }

      default:
        throwUnknownAction(input.action, ['info', 'search'], 'workspace')
    }
  })()
}
