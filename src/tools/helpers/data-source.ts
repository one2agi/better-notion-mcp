import type { Client, PageObjectResponse } from '@notionhq/client'
import { NotionMCPError } from './errors.js'
import { normalizeId } from './id.js'

/** 5 minutes TTL for cached schemas and resolved IDs */
const SCHEMA_CACHE_TTL = 5 * 60 * 1000

/** Cache for database/data_source ID resolution */
export const resolutionCache = new Map<string, { databaseId: string; dataSourceId: string; expiresAt: number }>()

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
 * Tries database_id first; if NOT_FOUND, tries as data_source_id.
 * Returns both IDs for downstream operations.
 */
export async function resolveDataSourceId(
  notion: Client,
  id: string
): Promise<{ databaseId: string; dataSourceId: string }> {
  const normalized = normalizeId(id)

  const cached = resolutionCache.get(normalized)
  if (cached && Date.now() < cached.expiresAt) {
    return { databaseId: cached.databaseId, dataSourceId: cached.dataSourceId }
  }

  // Try as database container first
  try {
    const database: any = await notion.databases.retrieve({ database_id: normalized })
    if (database.data_sources?.length > 0) {
      const result = { databaseId: database.id, dataSourceId: database.data_sources[0].id }
      resolutionCache.set(normalized, { ...result, expiresAt: Date.now() + SCHEMA_CACHE_TTL })
      return result
    }
    throw new NotionMCPError(
      'Database has no data sources',
      'VALIDATION_ERROR',
      'This database container has no data sources yet. Use create_data_source to add one.'
    )
  } catch (error: any) {
    if (error instanceof NotionMCPError) throw error

    // If NOT_FOUND, try interpreting as data_source_id
    if (error.code === 'object_not_found') {
      try {
        const ds: any = await notion.dataSources.retrieve({ data_source_id: normalized })
        const result = {
          databaseId: ds.parent?.database_id || normalized,
          dataSourceId: ds.id
        }
        resolutionCache.set(normalized, { ...result, expiresAt: Date.now() + SCHEMA_CACHE_TTL })
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
