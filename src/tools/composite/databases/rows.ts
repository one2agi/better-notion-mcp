/**
 * Database Row Operations (create, update, delete pages within databases)
 * Notion API 2025-09-03
 */

import type { Client } from '@notionhq/client'
import {
  getDataSourceSchema,
  getSchemaTypeMap,
  resolveDataSourceId,
  resolvePageSchema
} from '../../helpers/data-source.js'
import { NotionMCPError, retryWithBackoff } from '../../helpers/errors.js'
import { parseMaybeJSON } from '../../helpers/json-input.js'
import { markdownToBlocks, sanitizeBlocksForAppend } from '../../helpers/markdown.js'
import { processBatches } from '../../helpers/pagination.js'
import { buildSchemaMap, convertToNotionProperties, sanitizeReadonlyProperties } from '../../helpers/properties.js'
import type { TemplateConfig } from '../pages.js'
import { resolveTemplateConfig } from '../pages.js'
import type {
  CreateDatabasePageResponse,
  DatabasesInput,
  DeleteDatabasePageResponse,
  UpdateDatabasePageResponse
} from './types.js'

/**
 * Create pages in database (via data source)
 * Maps to: Multiple POST /v1/pages with data_source_id parent (API 2025-09-03)
 */
export async function createDatabasePages(notion: Client, input: DatabasesInput): Promise<CreateDatabasePageResponse> {
  if (!input.database_id) {
    throw new NotionMCPError(
      'database_id required',
      'VALIDATION_ERROR',
      'Provide database_id (from Notion URL) or data_source_id (from workspace search). Both formats are accepted.'
    )
  }

  // Smart resolve: accepts both database_id and data_source_id
  const { databaseId, dataSourceId } = await resolveDataSourceId(notion, input.database_id)

  // Fetch schema for property type mapping
  const properties = await getDataSourceSchema(notion, dataSourceId)
  const richSchema = buildSchemaMap(properties, { includeOptions: false })
  const schema: Record<string, string> = {}
  for (const name of Object.keys(richSchema)) {
    schema[name] = richSchema[name].type
  }

  const rawCommonProperties = input.page_properties ?? input.properties
  const pageProperties = parseMaybeJSON<Record<string, any>>(rawCommonProperties, 'page_properties')
  const parsedPages = parseMaybeJSON<NonNullable<DatabasesInput['pages']>>(input.pages, 'pages')
  const rawItems = parsedPages || (pageProperties ? [{ properties: pageProperties }] : [])

  if (rawItems.length === 0) {
    throw new NotionMCPError('pages or page_properties required', 'VALIDATION_ERROR', 'Provide items to create')
  }

  // Validate and normalize all items before processing to avoid partial writes on malformed input
  const items: Array<{
    properties: Record<string, any>
    template?: any
    template_id?: string
    content?: string
  }> = []

  for (let i = 0; i < rawItems.length; i++) {
    const raw: any = rawItems[i]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.properties === null) {
      throw new NotionMCPError(
        `Item at index ${i} in the pages array is missing the "properties" key`,
        'VALIDATION_ERROR',
        'Use format: pages: [{ "properties": { "FieldName": "value" } }]'
      )
    }

    let properties = raw.properties
    if (typeof properties === 'string') {
      properties = parseMaybeJSON(properties, 'properties')
    }

    if (properties === undefined) {
      const {
        template: _t,
        template_id: _ti,
        content: _c,
        markdown: _m,
        database_id: _d,
        data_source_id: _ds,
        ...flatProps
      } = raw
      if (Object.keys(flatProps).length > 0) {
        properties = flatProps
      } else {
        throw new NotionMCPError(
          `Item at index ${i} in the pages array is missing the "properties" key`,
          'VALIDATION_ERROR',
          'Use format: pages: [{ "properties": { "FieldName": "value" } }]'
        )
      }
    }

    const pageContent = raw.content ?? raw.markdown ?? input.content ?? input.markdown

    items.push({
      properties,
      template: raw.template,
      template_id: raw.template_id,
      content: pageContent
    })
  }

  let defaultTemplateConfig: TemplateConfig | undefined
  if (input.template !== undefined || input.template_id !== undefined) {
    defaultTemplateConfig = await resolveTemplateConfig(notion, dataSourceId, input.template, input.template_id)
  }

  const itemTemplateCache = new Map<string, TemplateConfig | undefined>()

  const results = await processBatches(
    items,
    async (item: any) => {
      const properties = convertToNotionProperties(item.properties, schema)

      let templateConfig = defaultTemplateConfig
      if (item.template !== undefined || item.template_id !== undefined) {
        const cacheKey = JSON.stringify({ t: item.template, id: item.template_id })
        if (itemTemplateCache.has(cacheKey)) {
          templateConfig = itemTemplateCache.get(cacheKey)
        } else {
          templateConfig = await resolveTemplateConfig(notion, dataSourceId, item.template, item.template_id)
          itemTemplateCache.set(cacheKey, templateConfig)
        }
      }

      const pageCreatePayload: any = {
        // Bug #11: Notion API 2025-09-03 rejects `database_id` parent when the
        // database has 2+ data sources ("multiple_data_sources_for_database").
        // Use `data_source_id` instead — works for both single- and multi-source DBs.
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties
      }
      if (templateConfig) {
        pageCreatePayload.template = templateConfig
      }

      const page = await retryWithBackoff(async () => notion.pages.create(pageCreatePayload))

      if (item.content) {
        const { blocks } = markdownToBlocks(item.content)
        if (blocks.length > 0) {
          const sanitized = sanitizeBlocksForAppend(blocks as any)
          await retryWithBackoff(async () =>
            notion.blocks.children.append({
              block_id: page.id,
              children: sanitized as any
            })
          )
        }
      }

      return {
        page_id: page.id,
        url: (page as any).url,
        created: true
      }
    },
    { batchSize: 5, concurrency: 3 }
  )

  return {
    action: 'create_page',
    database_id: databaseId,
    data_source_id: dataSourceId,
    processed: results.length,
    results
  }
}

/**
 * Update pages in database (bulk)
 * Maps to: Multiple PATCH /v1/pages/{id}
 */
export async function updateDatabasePages(notion: Client, input: DatabasesInput): Promise<UpdateDatabasePageResponse> {
  const rawCommonProperties = input.page_properties ?? input.properties
  const pageProperties = parseMaybeJSON<Record<string, any>>(rawCommonProperties, 'page_properties')
  const parsedPages = parseMaybeJSON<NonNullable<DatabasesInput['pages']>>(input.pages, 'pages')
  const parsedPageIds = parseMaybeJSON<string[]>(input.page_ids, 'page_ids')

  let items = parsedPages ? [...parsedPages] : []

  if (items.length === 0 && parsedPageIds && parsedPageIds.length > 0 && pageProperties) {
    items = parsedPageIds.map((id) => ({ page_id: id, properties: pageProperties }))
  } else if (items.length === 0 && input.page_id && pageProperties) {
    items = [{ page_id: input.page_id, properties: pageProperties }]
  }

  if (items.length === 0) {
    throw new NotionMCPError('pages or page_id+page_properties required', 'VALIDATION_ERROR', 'Provide items to update')
  }

  // Validate and normalize all items before processing to avoid partial writes on malformed input
  const normalizedItems: Array<{ page_id: string; properties: Record<string, any> }> = []
  for (let i = 0; i < items.length; i++) {
    const raw: any = items[i]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.properties === null) {
      throw new NotionMCPError(
        `Item at index ${i} in the pages array is missing the "properties" key`,
        'VALIDATION_ERROR',
        'Use format: pages: [{ "page_id": "...", "properties": { "FieldName": "value" } }]'
      )
    }

    let properties = raw.properties
    if (typeof properties === 'string') {
      properties = parseMaybeJSON(properties, 'properties')
    }

    if (properties === undefined) {
      const {
        page_id: _p,
        id: _i,
        template: _t,
        template_id: _ti,
        database_id: _d,
        data_source_id: _ds,
        ...flatProps
      } = raw
      if (Object.keys(flatProps).length > 0) {
        properties = flatProps
      } else {
        throw new NotionMCPError(
          `Item at index ${i} in the pages array is missing the "properties" key`,
          'VALIDATION_ERROR',
          'Use format: pages: [{ "page_id": "...", "properties": { "FieldName": "value" } }]'
        )
      }
    }

    const pageId = raw.page_id || raw.id
    if (!pageId) {
      throw new NotionMCPError('page_id required for each item', 'VALIDATION_ERROR', 'Provide page_id')
    }

    normalizedItems.push({
      page_id: pageId,
      properties
    })
  }

  let sharedSchema: Record<string, string> | undefined
  const containerId = input.data_source_id || input.database_id
  if (containerId) {
    try {
      const { dataSourceId } = await resolveDataSourceId(notion, containerId)
      sharedSchema = await getSchemaTypeMap(notion, dataSourceId)
    } catch {
      // Fall back gracefully to per-page lookup
    }
  }

  const results = await processBatches(
    normalizedItems,
    async (item) => {
      if (!item.page_id) {
        throw new NotionMCPError('page_id required for each item', 'VALIDATION_ERROR', 'Provide page_id')
      }

      const schemaTypeMap = sharedSchema ?? (await resolvePageSchema(notion, item.page_id))

      const converted = convertToNotionProperties(item.properties, schemaTypeMap)
      const properties = sanitizeReadonlyProperties(converted, { mode: 'update' })

      await retryWithBackoff(async () =>
        notion.pages.update({
          page_id: item.page_id!,
          properties
        })
      )

      return {
        page_id: item.page_id,
        updated: true
      }
    },
    { batchSize: 5, concurrency: 3 }
  )

  return {
    action: 'update_page',
    processed: results.length,
    results
  }
}

/**
 * Delete pages in database (bulk archive)
 * Maps to: Multiple PATCH /v1/pages/{id} with archived: true
 */
export async function deleteDatabasePages(notion: Client, input: DatabasesInput): Promise<DeleteDatabasePageResponse> {
  const parsedPages = parseMaybeJSON<NonNullable<DatabasesInput['pages']>>(input.pages, 'pages')
  const parsedPageIds = parseMaybeJSON<string[]>(input.page_ids, 'page_ids')
  let pageIds: string[] = parsedPageIds || (input.page_id ? [input.page_id] : [])
  if (!pageIds || pageIds.length === 0) {
    if (parsedPages) {
      pageIds = []
      for (const p of parsedPages) {
        const itemAny: any = p
        if (typeof itemAny === 'string' && itemAny.trim()) {
          pageIds.push(itemAny.trim())
        } else if (itemAny && typeof itemAny === 'object') {
          const id = itemAny.page_id ?? itemAny.id
          if (id) {
            pageIds.push(id)
          }
        }
      }
    } else {
      pageIds = []
    }
  }

  if (pageIds.length === 0) {
    throw new NotionMCPError('page_id or page_ids required', 'VALIDATION_ERROR', 'Provide page IDs to delete')
  }

  const results = await processBatches(
    pageIds,
    async (pageId) => {
      await retryWithBackoff(async () =>
        notion.pages.update({
          page_id: pageId,
          archived: true
        })
      )

      return {
        page_id: pageId,
        deleted: true
      }
    },
    { batchSize: 5, concurrency: 3 }
  )

  return {
    action: 'delete_page',
    processed: results.length,
    results
  }
}
