/**
 * Pages Mega Tool
 * All page operations in one unified interface
 */

import type { Client, PageObjectResponse } from '@notionhq/client'
import { updatePageWithParent } from '../../types/notion-extended.js'
import { formatCover } from '../helpers/covers.js'
import { getSchemaTypeMap, resolveDataSourceId, resolvePageSchema } from '../helpers/data-source.js'
import { NotionMCPError, retryWithBackoff, throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import { formatIcon } from '../helpers/icons.js'
import { parseMaybeJSON } from '../helpers/json-input.js'
import { blocksToMarkdown, markdownToBlocks, sanitizeNotionMarkdown } from '../helpers/markdown.js'
import {
  type GetPageMarkdownResult,
  getPageMarkdown,
  type InsertMarkdownResult,
  insertPageMarkdown,
  type PageMarkdownAPI,
  type ReplaceContentRangeResult,
  type ReplaceContentResult,
  replacePageContent,
  replacePageContentRange,
  type UpdateContentResult,
  updatePageContent
} from '../helpers/page-content.js'
import { type DuplicatePageResult, duplicatePage } from '../helpers/page-duplicate.js'
import {
  clearPageTitleCache,
  type GetPagePropertyResult,
  getPageProperty,
  resolvePageTitle
} from '../helpers/page-property-resolver.js'
import { autoPaginate, populateDeepChildren, processBatches } from '../helpers/pagination.js'
import {
  convertToNotionProperties,
  extractPageProperties,
  filterToSchemaKeys,
  findTitleColumnName,
  sanitizeReadonlyPropertiesWithFeedback
} from '../helpers/properties.js'
import * as RichText from '../helpers/richtext.js'

export type {
  DuplicatePageResult,
  GetPageMarkdownResult,
  GetPagePropertyResult,
  InsertMarkdownResult,
  PageMarkdownAPI,
  ReplaceContentRangeResult,
  ReplaceContentResult,
  UpdateContentResult
}
export {
  clearPageTitleCache,
  duplicatePage,
  getPageMarkdown,
  getPageProperty,
  insertPageMarkdown,
  replacePageContent,
  replacePageContentRange,
  resolvePageTitle,
  sanitizeNotionMarkdown,
  updatePageContent
}

export interface CreatePageResult {
  action: 'create'
  page_id: string
  url: string
  created: true
}

export interface GetPageResult {
  action: 'get'
  page_id: string
  url: string
  created_time: string
  last_edited_time: string
  archived: boolean
  icon: any
  cover: any
  properties: Record<string, any>
  content: string
  block_count: number
}

export interface UpdatePageResult {
  action: 'update'
  page_id: string
  updated: true
  ignored_properties?: string[]
}

export interface MovePageResult {
  action: 'move'
  page_id: string
  new_parent_id: string
  moved: true
}

export interface ArchivePageResult {
  action: 'archive' | 'restore'
  processed: number
  results: Array<{ page_id: string; archived: boolean }>
}

export type PagesResult =
  | CreatePageResult
  | GetPageResult
  | GetPagePropertyResult
  | UpdatePageResult
  | MovePageResult
  | ArchivePageResult
  | DuplicatePageResult
  | GetPageMarkdownResult
  | ReplaceContentResult
  | InsertMarkdownResult
  | UpdateContentResult
  | ReplaceContentRangeResult

export interface PagesInput {
  action:
    | 'create'
    | 'get'
    | 'get_property'
    | 'update'
    | 'move'
    | 'archive'
    | 'restore'
    | 'duplicate'
    | 'get_markdown'
    | 'replace_content'
    | 'insert_markdown'
    | 'update_content'
    | 'replace_content_range'

  // Common params
  page_id?: string
  page_ids?: string[]

  // Create/Update params
  title?: string
  content?: string // Markdown (defaults to append, use replace: true to overwrite)
  append_content?: string
  parent_id?: string
  properties?: Record<string, any>
  icon?: string
  cover?: string

  // get_property params
  property_id?: string
  property_name?: string
  resolve_titles?: boolean

  // get params
  resolve_relations?: boolean

  // Archive/Restore params
  archived?: boolean
  replace?: boolean

  // Markdown-native actions (Notion SDK v5.22+ markdown endpoints)
  /** Markdown body (alias for content / new_str) */
  markdown?: string
  /** Markdown body for replace_content / insert_markdown. For replace_content_range use `content` (this `new_str` is accepted as an alias). */
  new_str?: string
  /** Markdown content to insert */
  content_range?: string
  /** Position for insert_markdown: 'end' (default) | 'start' */
  position?: 'start' | 'end'
  /** Block id to insert after (insert_markdown only) */
  after_block_id?: string
  /** Search-and-replace updates for update_content */
  updates?: Array<{
    old_str?: string
    new_str?: string
    search?: string
    replace?: string
    target?: string
    content?: string
    replace_all_matches?: boolean
  }>
  /** Allow replace_content / replace_content_range to delete unmatched content (default true for replace_content) */
  allow_deleting_content?: boolean
}

/**
 * Unified pages tool - handles all page operations
 */
export async function pages(notion: Client, input: PagesInput): Promise<PagesResult> {
  return withErrorHandling(async () => {
    switch (input.action) {
      case 'create':
        return await createPage(notion, input)

      case 'get':
        return await getPage(notion, input)

      case 'get_property':
        return await getPageProperty(notion, input)

      case 'update':
        return await updatePage(notion, input)

      case 'move':
        return await movePage(notion, input)

      case 'archive':
      case 'restore':
        return await archivePage(notion, input)

      case 'duplicate':
        return await duplicatePage(notion, input)

      case 'get_markdown':
        return await getPageMarkdown(notion, input)

      case 'replace_content':
        return await replacePageContent(notion, input)

      case 'insert_markdown':
        return await insertPageMarkdown(notion, input)

      case 'update_content':
        return await updatePageContent(notion, input)

      case 'replace_content_range':
        return await replacePageContentRange(notion, input)

      default:
        throwUnknownAction(
          input.action,
          [
            'create',
            'get',
            'get_property',
            'update',
            'move',
            'archive',
            'restore',
            'duplicate',
            'get_markdown',
            'replace_content',
            'insert_markdown',
            'update_content',
            'replace_content_range'
          ],
          'pages'
        )
    }
  })()
}

/**
 * Create page with title and content
 * Maps to: POST /v1/pages + PATCH /v1/blocks/{id}/children
 *
 * For database parents, fetches schema so convertToNotionProperties can
 * correctly infer types for non-English column names (e.g. `名称`).
 * Falls back to parent_id heuristic when the id resolves to a non-database page.
 */
async function createPage(notion: Client, input: PagesInput): Promise<CreatePageResult> {
  if (!input.title) {
    throw new NotionMCPError('title is required for create action', 'VALIDATION_ERROR', 'Provide page title')
  }

  if (!input.parent_id) {
    throw new NotionMCPError(
      'parent_id is required for page creation',
      'VALIDATION_ERROR',
      'Integration tokens cannot create workspace-level pages. Provide parent_id (database or page ID).'
    )
  }

  const normalizedId = input.parent_id.replace(/-/g, '')

  // Detect parent type by trying database retrieve first; if not found, treat as page_id.
  let parent: Record<string, any>
  let schemaForConvert: Record<string, string> | undefined
  try {
    const { dataSourceId } = await resolveDataSourceId(notion, normalizedId)
    // Bug #11: Notion API 2025-09-03 rejects `database_id` parent when the
    // database has 2+ data sources ("multiple_data_sources_for_database").
    // Use `data_source_id` instead — works for both single- and multi-source DBs.
    parent = { type: 'data_source_id', data_source_id: dataSourceId }

    // Fetch schema so convertToNotionProperties handles non-English column names correctly.
    schemaForConvert = await getSchemaTypeMap(notion, dataSourceId)
  } catch (error: any) {
    // Only fall back to page_id when the ID doesn't resolve to any known parent.
    // resolveDataSourceId throws NotionMCPError('NOT_FOUND') when neither a database
    // nor a data source can be found for the given ID — that case is the expected
    // fallback path for plain page parents. For other errors (e.g. unauthorized,
    // rate limit) we must surface them to the caller when database-shaped properties
    // were supplied — otherwise the user would get a 200 response with their data
    // silently dropped.
    if (error?.code === 'NOT_FOUND' || error?.code === 'object_not_found') {
      parent = { type: 'page_id', page_id: normalizedId }
    } else if (input.properties && Object.keys(input.properties).length > 0) {
      throw error
    } else {
      parent = { type: 'page_id', page_id: normalizedId }
    }
  }

  // Convert user-provided properties using schema. If user did not supply a title field,
  // locate the schema's title column dynamically and set it from input.title.
  let properties: Record<string, any> = {}
  // Both `data_source_id` and `database_id` parents indicate a database-backed page.
  // (Bug #11: we now prefer `data_source_id` for API 2025-09-03 compatibility
  // with multi-source databases.)
  if (parent.data_source_id || parent.database_id) {
    properties = convertToNotionProperties(parseMaybeJSON(input.properties, 'properties') || {}, schemaForConvert)

    if (schemaForConvert) {
      // Drop user-supplied keys that don't exist in the schema (e.g. user
      // passed { Name: 'X' } when schema title column is "Title"). Then
      // locate the schema's actual title column and inject input.title if
      // it wasn't already provided under that key.
      properties = filterToSchemaKeys(properties, schemaForConvert)
      const titleColumnName = findTitleColumnName(schemaForConvert)
      if (titleColumnName && !properties[titleColumnName] && input.title) {
        properties[titleColumnName] = { title: [RichText.text(input.title)] }
      }
    }
  } else {
    properties = { title: { title: [RichText.text(input.title)] } }
  }

  const pageData: Record<string, any> = { parent, properties }
  if (input.icon) pageData.icon = formatIcon(input.icon)
  if (input.cover) pageData.cover = formatCover(input.cover)

  const page = (await notion.pages.create(pageData)) as PageObjectResponse

  // Add content if provided (supports content, markdown, or new_str aliases)
  const pageContent = input.content ?? input.markdown ?? input.new_str
  if (pageContent) {
    const { blocks } = markdownToBlocks(pageContent)
    if (blocks.length > 0) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: blocks as any
      })
    }
  }

  return {
    action: 'create',
    page_id: page.id,
    url: page.url,
    created: true
  }
}

/**
 * Get page with full content as markdown
 * Maps to: GET /v1/pages/{id} + GET /v1/blocks/{id}/children
 */
async function getPage(notion: Client, input: PagesInput): Promise<GetPageResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for get action', 'VALIDATION_ERROR', 'Provide page_id')
  }

  const page = (await notion.pages.retrieve({ page_id: input.page_id })) as PageObjectResponse

  // Get all blocks with auto-pagination
  const blocks = await autoPaginate((cursor) =>
    notion.blocks.children.list({
      block_id: input.page_id!,
      start_cursor: cursor,
      page_size: 100
    })
  )

  // Recursively fetch children for blocks that need them (tables, toggles, columns)
  await populateDeepChildren(notion, blocks as any[])

  const markdown = blocksToMarkdown(blocks as any)

  // Extract properties
  const properties = extractPageProperties(page.properties)

  const shouldResolveRelations = input.resolve_relations === true || (input.resolve_relations as any) === 'true'
  if (shouldResolveRelations && page.properties) {
    for (const [key, prop] of Object.entries<any>(page.properties)) {
      if (prop.type === 'relation' && Array.isArray(properties[key])) {
        properties[key] = await Promise.all(
          properties[key].map(async (item: any) => {
            const id = typeof item === 'string' ? item : item?.id
            return {
              id,
              title: await resolvePageTitle(notion, id)
            }
          })
        )
      }
    }
  }

  return {
    action: 'get',
    page_id: page.id,
    url: page.url,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    archived: page.archived,
    icon: page.icon || null,
    cover: page.cover || null,
    properties,
    content: markdown,
    block_count: blocks.length
  }
}

/**
 * Update page content/properties
 * Maps to: PATCH /v1/pages/{id} + PATCH /v1/blocks/{id}/children
 */
async function updatePage(notion: Client, input: PagesInput): Promise<UpdatePageResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for update action', 'VALIDATION_ERROR', 'Provide page_id')
  }

  const updates: Record<string, any> = {}
  const ignoredPropsList: string[] = []

  // Update metadata
  if (input.icon !== undefined) updates.icon = input.icon === null || input.icon === '' ? null : formatIcon(input.icon)
  if (input.cover !== undefined)
    updates.cover = input.cover === null || input.cover === '' ? null : formatCover(input.cover)
  if (input.archived !== undefined) updates.archived = input.archived

  // Update properties
  if (input.properties || input.title) {
    updates.properties = {}

    // Resolve schema once for both title and properties paths. Mirrors createPage
    // logic: fetches the parent database schema so convertToNotionProperties
    // can correctly route status / select / date / relation values per their
    // actual schema type (Bug #26). Falls back gracefully when the page is
    // not in a database or schema lookup fails — preserves the pre-fix
    // default behavior for page-only and workspace-level parents.
    const schemaTypeMap = await resolvePageSchema(notion, input.page_id)

    if (input.title) {
      // Default to "title" for non-database parents (page-only pages) where
      // Notion accepts a literal "title" key in the properties object.
      const titleColumnName = (schemaTypeMap && findTitleColumnName(schemaTypeMap)) || 'title'
      updates.properties[titleColumnName] = { title: [RichText.text(input.title)] }
    }

    if (input.properties) {
      // Schema-aware conversion: status-type fields become `{ status: { name } }`,
      // select-type fields become `{ select: { name } }`, etc. Without schema
      // we fall through to convertToNotionProperties' key-name heuristics.
      const converted = convertToNotionProperties(parseMaybeJSON(input.properties, 'properties'), schemaTypeMap)
      // Strip readonly types (created_time, formula, rollup, button, verification,
      // unique_id, created_by, last_edited_by, last_edited_time) before forwarding
      // to Notion API. Without this, the API returns 400 for any readonly key
      // the caller mistakenly includes (Bug #35, mirrors pages.duplicate behavior).
      const { writable, ignoredProperties } = sanitizeReadonlyPropertiesWithFeedback(converted, { mode: 'update' })
      if (ignoredProperties.length > 0) {
        ignoredPropsList.push(...ignoredProperties)
      }
      updates.properties = { ...updates.properties, ...writable }
    }
  }

  // Update page if we have metadata/property changes
  if (Object.keys(updates).length > 0) {
    await notion.pages.update({
      page_id: input.page_id,
      ...updates
    })
  }

  // Handle content updates using efficient server-side markdown API (SDK v5.22+)
  // Decision matrix:
  //   content present + replace=true   → updateMarkdown replace_content (1 API call)
  //   content present + replace=false  → updateMarkdown insert_content at end (1 API call)
  //   append_content present           → updateMarkdown insert_content at end (1 API call)
  //   content empty/omitted + replace=true → updateMarkdown replace_content with empty string (1 API call)
  const mdApi = notion.pages as unknown as PageMarkdownAPI
  const pageContent = input.content ?? input.markdown ?? input.new_str

  if (pageContent && input.replace) {
    // Replace entire page content — single API call
    await mdApi.updateMarkdown({
      page_id: input.page_id,
      type: 'replace_content',
      replace_content: { new_str: pageContent, allow_deleting_content: true }
    })
  } else if (pageContent && !input.replace) {
    // Append content at end — single API call
    await mdApi.updateMarkdown({
      page_id: input.page_id,
      type: 'insert_content',
      insert_content: { content: pageContent, position: { type: 'end' } }
    })
  } else if (input.append_content) {
    // Append append_content at end — single API call
    await mdApi.updateMarkdown({
      page_id: input.page_id,
      type: 'insert_content',
      insert_content: { content: input.append_content, position: { type: 'end' } }
    })
  } else if (input.replace) {
    // Clear page: replace with empty string — single API call
    await mdApi.updateMarkdown({
      page_id: input.page_id,
      type: 'replace_content',
      replace_content: { new_str: '', allow_deleting_content: true }
    })
  }

  const result: UpdatePageResult = {
    action: 'update',
    page_id: input.page_id,
    updated: true
  }
  if (ignoredPropsList.length > 0) {
    result.ignored_properties = ignoredPropsList
  }
  return result
}

/**
 * Move page to a new parent
 * Maps to: POST /v1/pages/{id}/move
 */
async function movePage(notion: Client, input: PagesInput): Promise<MovePageResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for move action', 'VALIDATION_ERROR', 'Provide page_id')
  }

  if (!input.parent_id) {
    throw new NotionMCPError(
      'parent_id is required for move action',
      'VALIDATION_ERROR',
      'Provide parent_id (target page ID to move into)'
    )
  }

  const normalizedParentId = input.parent_id.replace(/-/g, '')

  // SDK types don't include parent in UpdatePageParameters, but the API supports it.
  // Use the typed escape hatch (notion-extended.ts) instead of `as any`.
  await updatePageWithParent(notion, {
    page_id: input.page_id,
    parent: { type: 'page_id', page_id: normalizedParentId }
  })

  return {
    action: 'move',
    page_id: input.page_id,
    new_parent_id: normalizedParentId,
    moved: true
  }
}

/**
 * Archive or restore page
 * Maps to: PATCH /v1/pages/{id}
 */
async function archivePage(notion: Client, input: PagesInput): Promise<ArchivePageResult> {
  const pageIds = input.page_ids || (input.page_id ? [input.page_id] : [])

  if (pageIds.length === 0) {
    throw new NotionMCPError('page_id or page_ids required', 'VALIDATION_ERROR', 'Provide at least one page ID')
  }

  const archived = input.action === 'archive'
  const results = await processBatches(
    pageIds,
    async (pageId) => {
      await retryWithBackoff(() =>
        notion.pages.update({
          page_id: pageId,
          archived
        })
      )
      return { page_id: pageId, archived }
    },
    { batchSize: 5, concurrency: 3 }
  )

  return {
    action: input.action as 'archive' | 'restore',
    processed: results.length,
    results
  }
}
