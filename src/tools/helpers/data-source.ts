import type { Client, PageObjectResponse } from '@notionhq/client'
import { NotionMCPError } from './errors.js'
import { normalizeId } from './id.js'

/** 5 minutes TTL for cached schemas and resolved IDs */
const SCHEMA_CACHE_TTL = 5 * 60 * 1000

/** Resolved data source metadata including optional view cascade */
export interface ResolvedDataSource {
  databaseId: string
  dataSourceId: string
  viewId?: string
  viewFilter?: any
  viewSorts?: any
  isLinkedView?: boolean
}

export type CachedResolvedDataSource = ResolvedDataSource & { expiresAt: number }

/** Cache for database/data_source ID resolution */
export const resolutionCache = new Map<string, CachedResolvedDataSource>()

/** Cache for data source schema (properties) */
export const schemaCache = new Map<string, { properties: any; expiresAt: number }>()

/**
 * Clear all in-memory data source and schema caches.
 * Useful for tests and manual cache invalidation.
 */
export function clearDataSourceCache(): void {
  resolutionCache.clear()
  schemaCache.clear()
}

/**
 * Smart ID resolution: accepts both database container ID and data_source ID.
 * Tries database_id first; if container has no data_sources, cascades into linked view resolution.
 * If NOT_FOUND, tries as data_source_id.
 * Returns ResolvedDataSource for downstream operations.
 *
 * Maps to upstream Notion API endpoints:
 * - GET /v1/databases/{id} (Database container retrieval)
 * - GET /v1/views (View listing and cascading resolution)
 * - GET /v1/views/{id} (Specific view retrieval)
 * - GET /v1/data_sources/{id} (Data source retrieval)
 */
export async function resolveDataSourceId(
  notion: Client,
  id: string,
  options?: { viewId?: string }
): Promise<ResolvedDataSource> {
  const normalized = normalizeId(id)
  const targetViewId = options?.viewId ? normalizeId(options.viewId) : undefined
  const cacheKey = targetViewId ? `${normalized}:${targetViewId}` : normalized

  const cached = resolutionCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return {
      databaseId: cached.databaseId,
      dataSourceId: cached.dataSourceId,
      viewId: cached.viewId,
      viewFilter: cached.viewFilter,
      viewSorts: cached.viewSorts,
      isLinkedView: cached.isLinkedView
    }
  }

  // Try as database container first
  try {
    const database: any = await notion.databases.retrieve({ database_id: normalized })

    // If a specific view was requested, resolve that view's details (works for both entity databases and linked views)
    if (targetViewId) {
      if (typeof (notion as any).views?.retrieve === 'function') {
        try {
          const view: any = await (notion as any).views.retrieve({ view_id: targetViewId })
          if (view?.data_source_id) {
            const result: ResolvedDataSource = {
              databaseId: database.id || normalized,
              dataSourceId: view.data_source_id,
              viewId: view.id,
              viewFilter: view.filter,
              viewSorts: view.sorts,
              isLinkedView: database.data_sources?.length === 0
            }
            resolutionCache.set(cacheKey, { ...result, expiresAt: Date.now() + SCHEMA_CACHE_TTL })
            return result
          }
        } catch (viewError: any) {
          if (viewError instanceof NotionMCPError) throw viewError
          if (viewError.code === 'object_not_found') {
            throw new NotionMCPError(
              `View "${options?.viewId}" not found`,
              'NOT_FOUND',
              'The specified view_id could not be found. Use databases.list_views to see available views.'
            )
          }
        }
      }
    }

    if (database.data_sources?.length > 0) {
      const result: ResolvedDataSource = {
        databaseId: database.id,
        dataSourceId: database.data_sources[0].id
      }
      resolutionCache.set(cacheKey, { ...result, expiresAt: Date.now() + SCHEMA_CACHE_TTL })
      return result
    }

    // Database container has no data_sources; attempt linked view cascading penetration via views.list
    if (typeof (notion as any).views?.list === 'function') {
      try {
        const viewsResponse: any = await (notion as any).views.list({
          database_id: normalized,
          page_size: 10
        })
        const views = viewsResponse?.results || []
        const targetView = targetViewId ? views.find((v: any) => normalizeId(v.id) === targetViewId) : views[0]

        if (targetView) {
          let fullView = targetView
          if (!fullView.data_source_id && typeof (notion as any).views?.retrieve === 'function') {
            try {
              fullView = await (notion as any).views.retrieve({ view_id: normalizeId(targetView.id) })
            } catch (retrieveError: any) {
              if (retrieveError instanceof NotionMCPError) throw retrieveError
            }
          }

          if (fullView?.data_source_id) {
            const result: ResolvedDataSource = {
              databaseId: database.id || normalized,
              dataSourceId: fullView.data_source_id,
              viewId: fullView.id,
              viewFilter: fullView.filter,
              viewSorts: fullView.sorts,
              isLinkedView: true
            }
            resolutionCache.set(cacheKey, { ...result, expiresAt: Date.now() + SCHEMA_CACHE_TTL })
            return result
          }
        }
      } catch (viewError: any) {
        if (viewError instanceof NotionMCPError) throw viewError
        // Fall through to read-only guidance error
      }
    }

    throw new NotionMCPError(
      'Database has no data sources',
      'VALIDATION_ERROR',
      'This database container has no data sources or accessible linked views. Check integration permissions on the underlying source database, or query the source database directly via its parent database ID or relation.'
    )
  } catch (error: any) {
    if (error instanceof NotionMCPError) throw error

    // If NOT_FOUND, try interpreting as data_source_id
    if (error.code === 'object_not_found') {
      try {
        const ds: any = await notion.dataSources.retrieve({ data_source_id: normalized })
        const result: ResolvedDataSource = {
          databaseId: ds.parent?.database_id || normalized,
          dataSourceId: ds.id
        }
        resolutionCache.set(cacheKey, { ...result, expiresAt: Date.now() + SCHEMA_CACHE_TTL })
        return result
      } catch {
        throw new NotionMCPError(
          `ID "${id}" is not a valid database or data source`,
          'NOT_FOUND',
          'Use the database ID from the Notion URL (e.g., notion.so/<database_id>?...), or a data_source_id from workspace search. Try workspace/search with filter.object="data_source" to find available databases.'
        )
      }
    }
    throw error
  }
}

/**
 * Get data source properties with caching.
 */
export async function getDataSourceSchema(notion: Client, dataSourceId: string): Promise<any> {
  const cached = schemaCache.get(dataSourceId)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.properties
  }

  const dataSource: any = await notion.dataSources.retrieve({
    data_source_id: dataSourceId
  })
  const properties = dataSource.properties

  if (properties) {
    schemaCache.set(dataSourceId, {
      properties,
      expiresAt: Date.now() + SCHEMA_CACHE_TTL
    })
  }

  return properties
}

/**
 * Retrieve a clean flat mapping of column names to property types (e.g. { "Status": "status", "Tags": "multi_select" }).
 */
export async function getSchemaTypeMap(notion: Client, dataSourceId: string): Promise<Record<string, string>> {
  const schemaProperties = await getDataSourceSchema(notion, dataSourceId)
  if (!schemaProperties) return {}

  const schemaTypeMap: Record<string, string> = {}
  for (const name of Object.keys(schemaProperties)) {
    schemaTypeMap[name] = schemaProperties[name]?.type ?? 'rich_text'
  }
  return schemaTypeMap
}

/**
 * One-call page parent schema resolution.
 * Retrieves page metadata, checks if the parent is a database/data_source,
 * resolves the data source ID and returns the schemaTypeMap.
 * Returns undefined if the page is page-parented or if lookup fails.
 */
export async function resolvePageSchema(notion: Client, pageId: string): Promise<Record<string, string> | undefined> {
  try {
    const page = (await notion.pages.retrieve({ page_id: pageId })) as PageObjectResponse
    const parent = page.parent as any
    // API 2025-09-03: DB-row parent is data_source_id but still carries database_id
    const targetId = parent?.database_id ?? (parent?.type === 'data_source_id' ? parent.data_source_id : undefined)
    if (targetId) {
      const dbId = normalizeId(String(targetId))
      const { dataSourceId } = await resolveDataSourceId(notion, dbId)
      return await getSchemaTypeMap(notion, dataSourceId)
    }
    return undefined
  } catch {
    // Schema lookup failed — fall back gracefully to no schema
    return undefined
  }
}
