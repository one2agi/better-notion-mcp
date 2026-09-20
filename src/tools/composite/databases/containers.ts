/**
 * Database and Data Source container-level operations
 * Notion API 2025-09-03
 */

import type { Client } from '@notionhq/client'
import { formatCover } from '../../helpers/covers.js'
import { getDataSourceSchema, resolveDataSourceId } from '../../helpers/data-source.js'
import { NotionMCPError } from '../../helpers/errors.js'
import { formatIcon } from '../../helpers/icons.js'
import { normalizeId } from '../../helpers/id.js'
import { parseMaybeJSON } from '../../helpers/json-input.js'
import { autoPaginate } from '../../helpers/pagination.js'
import { buildSchemaMap } from '../../helpers/properties.js'
import * as RichText from '../../helpers/richtext.js'
import { formatDatabaseResults, getSmartSearchFilter, resolveDatabaseFilter } from './query-helpers.js'
import type {
  CreateDatabaseResponse,
  CreateDataSourceResponse,
  DatabasesInput,
  GetDatabaseResponse,
  ListDataSourceTemplatesResponse,
  QueryDatabaseResponse,
  UpdateDatabaseResponse,
  UpdateDataSourceResponse
} from './types.js'

/**
 * Normalize property schema options: converts array-style multi_select/select/status
 * (e.g. { multi_select: [...] }) to the object-style format Notion expects
 * ({ multi_select: { options: [...] } }).
 */
export function normalizePropertyOptions(schema: Record<string, any>): Record<string, any> {
  const typesWithOptions = ['multi_select', 'select', 'status'] as const
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested property objects (e.g. { multi_select: { ... } })
      result[key] = normalizePropertyOptions(value)
    } else if (Array.isArray(value)) {
      // Array-valued property — check if it matches a known option-carrier type
      const lowerKey = key.toLowerCase()
      if (typesWithOptions.some((t) => lowerKey === t)) {
        result[key] = { options: value }
      } else {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Validate that a data source schema includes at least one title-type property.
 * Notion requires every data source to have a title property.
 */
export function validateTitleProperty(properties: Record<string, any>): void {
  const values = Object.values(properties)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value && typeof value === 'object' && 'title' in value) {
      return
    }
  }
  throw new NotionMCPError(
    'A data source schema must include a title property',
    'VALIDATION_ERROR',
    "Add a title property to your schema, e.g. { 'Name': { 'title': {} } } or { '名称': { 'title': {} } }. Title properties use the key 'title' inside the property definition."
  )
}

/**
 * Create database with initial data source
 * Maps to: POST /v1/databases (API 2025-09-03)
 */
export async function createDatabase(notion: Client, input: DatabasesInput): Promise<CreateDatabaseResponse> {
  if (!input.parent_id || !input.title || !input.properties) {
    throw new NotionMCPError(
      'parent_id, title, and properties required for create action',
      'VALIDATION_ERROR',
      'Provide parent_id, title, and properties'
    )
  }

  // API 2025-09-03: properties go under initial_data_source
  const dbData: any = {
    parent: { type: 'page_id', page_id: input.parent_id },
    title: [RichText.text(input.title)],
    initial_data_source: {
      properties: parseMaybeJSON(input.properties, 'properties')
    }
  }

  if (input.description) {
    dbData.description = [RichText.text(input.description)]
  }

  if (input.is_inline !== undefined) {
    dbData.is_inline = input.is_inline
  }

  if (input.icon) {
    dbData.icon = formatIcon(input.icon)
  }

  if (input.cover) {
    dbData.cover = formatCover(input.cover)
  }

  const database: any = await notion.databases.create(dbData)

  return {
    action: 'create',
    database_id: database.id,
    data_source_id: database.data_sources?.[0]?.id,
    url: database.url,
    created: true
  }
}

/**
 * Get database info including all data sources
 * Maps to: GET /v1/databases/{id} (API 2025-09-03)
 */
export async function getDatabase(notion: Client, input: DatabasesInput): Promise<GetDatabaseResponse> {
  if (!input.database_id) {
    throw new NotionMCPError('database_id required for get action', 'VALIDATION_ERROR', 'Provide database_id')
  }

  // Get database (contains list of data_sources)
  const database: any = await notion.databases.retrieve({
    database_id: normalizeId(input.database_id)
  })

  // Get detailed schema from first data source
  const schema: any = {}
  let dataSourceInfo: any = null

  if (database.data_sources && database.data_sources.length > 0) {
    const dataSourceId = database.data_sources[0].id
    const properties = await getDataSourceSchema(notion, dataSourceId)

    dataSourceInfo = {
      id: dataSourceId,
      name: database.data_sources[0].name
    }

    // Format properties for AI-friendly output
    if (properties) {
      Object.assign(schema, buildSchemaMap(properties))
    }
  }

  return {
    action: 'get',
    database_id: database.id,
    title: database.title?.[0]?.plain_text || 'Untitled',
    description: database.description?.[0]?.plain_text || '',
    url: database.url,
    is_inline: database.is_inline,
    created_time: database.created_time,
    last_edited_time: database.last_edited_time,
    data_source: dataSourceInfo,
    schema
  }
}

/**
 * Query database (via data source)
 * Maps to: POST /v1/data_sources/{id}/query (API 2025-09-03)
 */
export async function queryDatabase(notion: Client, input: DatabasesInput): Promise<QueryDatabaseResponse> {
  if (!input.database_id) {
    throw new NotionMCPError(
      'database_id required for query action',
      'VALIDATION_ERROR',
      'Provide database_id (from Notion URL) or data_source_id (from workspace search). Both formats are accepted.'
    )
  }

  // Smart resolve: accepts both database_id and data_source_id
  const { databaseId, dataSourceId } = await resolveDataSourceId(notion, input.database_id)

  let filter = await resolveDatabaseFilter(notion, dataSourceId, input.filters)

  // Smart search across text properties
  if (input.search && !filter) {
    filter = await getSmartSearchFilter(notion, dataSourceId, input.search)
  }

  const queryParams: any = { data_source_id: dataSourceId }
  if (filter) queryParams.filter = filter
  queryParams.sorts = parseMaybeJSON(input.sorts, 'sorts')

  // Fetch with pagination
  const allResults = await autoPaginate(async (cursor) => {
    const response: any = await notion.dataSources.query({
      ...queryParams,
      start_cursor: cursor,
      page_size: 100
    })
    return {
      results: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more
    }
  })

  // Limit results if specified
  const results = input.limit ? allResults.slice(0, input.limit) : allResults

  // Format results
  const formattedResults = formatDatabaseResults(results)

  return {
    action: 'query',
    database_id: databaseId,
    data_source_id: dataSourceId,
    total: formattedResults.length,
    results: formattedResults
  }
}

/**
 * Create additional data source for existing database
 * Maps to: POST /v1/data_sources (API 2025-09-03)
 */
export async function createDataSource(notion: Client, input: DatabasesInput): Promise<CreateDataSourceResponse> {
  if (!input.database_id || !input.title || !input.properties) {
    throw new NotionMCPError(
      'database_id, title, and properties required',
      'VALIDATION_ERROR',
      'Provide database_id, title, and properties for new data source'
    )
  }

  const rawProperties = parseMaybeJSON(input.properties, 'properties')
  const properties = normalizePropertyOptions(rawProperties ?? {})

  // Notion requires at least one title-type property in the schema
  validateTitleProperty(properties)

  const dataSourceData: any = {
    parent: { type: 'database_id', database_id: input.database_id },
    title: [RichText.text(input.title)],
    properties
  }

  if (input.description) {
    dataSourceData.description = [RichText.text(input.description)]
  }

  const dataSource: any = await notion.dataSources.create(dataSourceData)

  return {
    action: 'create_data_source',
    data_source_id: dataSource.id,
    database_id: input.database_id,
    created: true
  }
}

/**
 * Update data source (title, description, properties/schema)
 * Maps to: PATCH /v1/data_sources/{id} (API 2025-09-03)
 */
export async function updateDataSource(notion: Client, input: DatabasesInput): Promise<UpdateDataSourceResponse> {
  if (!input.data_source_id) {
    throw new NotionMCPError('data_source_id required', 'VALIDATION_ERROR', 'Provide data_source_id')
  }

  const updates: any = {}

  if (input.title) {
    updates.title = [RichText.text(input.title)]
  }

  if (input.description) {
    updates.description = [RichText.text(input.description)]
  }

  const parsedProperties = parseMaybeJSON(input.properties, 'properties')
  if (parsedProperties) {
    const normalizedProps = normalizePropertyOptions(parsedProperties)
    updates.properties = normalizedProps
  }

  if (Object.keys(updates).length === 0) {
    throw new NotionMCPError(
      'No updates provided',
      'VALIDATION_ERROR',
      'Provide title, description, or properties to update'
    )
  }

  await notion.dataSources.update({
    data_source_id: input.data_source_id,
    ...updates
  })

  return {
    action: 'update_data_source',
    data_source_id: input.data_source_id,
    updated: true
  }
}

/**
 * Update database container (parent, title, is_inline, icon, cover)
 * Maps to: PATCH /v1/databases/{id} (API 2025-09-03)
 */
export async function updateDatabaseContainer(notion: Client, input: DatabasesInput): Promise<UpdateDatabaseResponse> {
  if (!input.database_id) {
    throw new NotionMCPError('database_id required', 'VALIDATION_ERROR', 'Provide database_id')
  }

  const updates: any = {}

  if (input.parent_id) {
    updates.parent = { type: 'page_id', page_id: input.parent_id }
  }

  if (input.title) {
    updates.title = [RichText.text(input.title)]
  }

  if (input.description) {
    updates.description = [RichText.text(input.description)]
  }

  if (input.is_inline !== undefined) {
    updates.is_inline = input.is_inline
  }

  if (input.icon) {
    const icon = formatIcon(input.icon)
    if (icon === null) {
      // Notion's Update-a-Database API cannot clear an icon: its `icon` request type is
      // PageIconRequest (no null/empty variant), unlike pages which accept `icon: null`.
      // Sending null yields a 400. Fail loudly with the actual contract instead.
      throw new NotionMCPError(
        'Notion does not support clearing a database icon via the API',
        'VALIDATION_ERROR',
        'A database icon can only be changed to another emoji/URL — it cannot be removed (Notion API limitation: icon has no null/empty request variant; the same applies to cover). Page icons CAN be cleared with icon="none". To remove a database icon, do it manually in the Notion app.'
      )
    }
    updates.icon = icon
  }

  if (input.cover) updates.cover = formatCover(input.cover)

  if (Object.keys(updates).length === 0) {
    throw new NotionMCPError(
      'No updates provided',
      'VALIDATION_ERROR',
      'Provide parent_id, title, description, is_inline, icon, or cover'
    )
  }

  await notion.databases.update({
    database_id: normalizeId(input.database_id),
    ...updates
  })

  return {
    action: 'update_database',
    database_id: input.database_id,
    updated: true
  }
}

/**
 * List data source templates
 * Maps to: GET /v1/data_sources/{id}/templates (API 2025-09-03)
 */
export async function listDataSourceTemplates(
  notion: Client,
  input: DatabasesInput
): Promise<ListDataSourceTemplatesResponse> {
  if (!input.database_id) {
    throw new NotionMCPError(
      'database_id required for list_templates action',
      'VALIDATION_ERROR',
      'Provide database_id (from Notion URL) or data_source_id. Both formats are accepted.'
    )
  }

  // Smart resolve: accepts both database_id and data_source_id
  const { databaseId, dataSourceId: resolvedDsId } = await resolveDataSourceId(notion, input.database_id)
  const dataSourceId = input.data_source_id || resolvedDsId

  const templates = await autoPaginate(async (cursor) => {
    const response: any = await notion.dataSources.listTemplates({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100
    })
    return {
      results: response.templates || response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more
    }
  })

  return {
    action: 'list_templates',
    database_id: databaseId,
    data_source_id: dataSourceId,
    total: templates.length,
    templates: templates.map((t: any) => ({
      template_id: t.id,
      title:
        t.name ||
        t.properties?.title?.title?.[0]?.plain_text ||
        t.properties?.Name?.title?.[0]?.plain_text ||
        'Untitled',
      properties: t.properties
    }))
  }
}
