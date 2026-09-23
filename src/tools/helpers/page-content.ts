/**
 * Page content markdown pipeline helpers
 * Integrates with Notion SDK v5.22.0+ server-side markdown endpoints:
 * GET/PATCH /v1/pages/{id}/markdown
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, retryWithBackoff } from './errors.js'
import { parseMaybeJSON } from './json-input.js'
import { markdownToBlocks, sanitizeBlocksForAppend, sanitizeNotionMarkdown } from './markdown.js'
import { autoPaginate, processBatches } from './pagination.js'

/**
 * Server-side markdown endpoints from Notion SDK v5.22.0 (`pages.retrieveMarkdown`,
 * `pages.updateMarkdown`). The SDK exposes the methods on `Client.d.ts` but does
 * not re-export the request/response interfaces from its public entry, so we
 * declare the surface we use locally to keep call sites type-safe.
 */
export interface PageMarkdownAPI {
  retrieveMarkdown(args: { page_id: string }): Promise<{
    markdown?: string
    truncated?: boolean
    unknown_block_ids?: string[]
  }>
  updateMarkdown(args: {
    page_id: string
    type: 'insert_content' | 'replace_content' | 'update_content' | 'replace_content_range'
    insert_content?: { content: string; position?: { type: 'start' | 'end' }; after?: string }
    replace_content?: { new_str: string; allow_deleting_content?: boolean }
    update_content?: {
      content_updates: Array<{ old_str: string; new_str: string; replace_all_matches?: boolean }>
      allow_deleting_content?: boolean
    }
    replace_content_range?: { content: string; content_range: string; allow_deleting_content?: boolean }
  }): Promise<{ markdown?: string; truncated?: boolean }>
}

export interface GetPageMarkdownResult {
  action: 'get_markdown'
  page_id: string
  markdown: string
  truncated: boolean
  unknown_block_ids: string[]
}

export interface ReplaceContentResult {
  action: 'replace_content'
  page_id: string
  replaced: true
  block_count?: number
  markdown?: string
  truncated?: boolean
}

export interface InsertMarkdownResult {
  action: 'insert_markdown'
  page_id: string
  inserted: true
  markdown?: string
  truncated?: boolean
}

export interface UpdateContentResult {
  action: 'update_content'
  page_id: string
  updated: true
  markdown?: string
  truncated?: boolean
}

export interface ReplaceContentRangeResult {
  action: 'replace_content_range'
  page_id: string
  replaced: true
  markdown?: string
  truncated?: boolean
}

export interface PageContentInput {
  page_id?: string
  markdown?: string
  new_str?: string
  content?: string
  content_range?: string
  position?: 'start' | 'end'
  after_block_id?: string
  updates?:
    | Array<{
        old_str?: string
        new_str?: string
        search?: string
        replace?: string
        target?: string
        content?: string
        replace_all_matches?: boolean
      }>
    | string
  allow_deleting_content?: boolean
  [key: string]: any
}

/**
 * get_markdown action — retrieve page content as a markdown string.
 * Maps to: GET /v1/pages/{id}/markdown (Notion API 2025-09-03, requires SDK v5.22+).
 * Faster than `pages: get` for long pages (no per-block JSON parsing).
 */
export async function getPageMarkdown(notion: Client, input: PageContentInput): Promise<GetPageMarkdownResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for get_markdown action', 'VALIDATION_ERROR', 'Provide page_id')
  }
  // SDK types don't include retrieveMarkdown in Client.d.ts pre-v5.22; cast for forward-compat.
  const r = await (notion.pages as unknown as PageMarkdownAPI).retrieveMarkdown({ page_id: input.page_id })
  return {
    action: 'get_markdown',
    page_id: input.page_id,
    markdown: sanitizeNotionMarkdown(r?.markdown ?? ''),
    truncated: Boolean(r?.truncated),
    unknown_block_ids: Array.isArray(r?.unknown_block_ids) ? r.unknown_block_ids : []
  }
}

/**
 * replace_content action — overwrite the entire page content with a single markdown string.
 * Uses high-fidelity client AST engine (markdownToBlocks) and batch block appending.
 * Preserves bookmarks, toggles, callouts, tables, and all rich-content block types without loss.
 * Maps to:
 * - GET /v1/blocks/{id}/children
 * - DELETE /v1/blocks/{id}
 * - PATCH /v1/blocks/{id}/children
 */
export async function replacePageContent(notion: Client, input: PageContentInput): Promise<ReplaceContentResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for replace_content action', 'VALIDATION_ERROR', 'Provide page_id')
  }
  const newStr = input.new_str ?? input.content ?? input.markdown ?? (input as any).new_content
  if (newStr === undefined || newStr === null) {
    throw new NotionMCPError(
      'new_str is required for replace_content action',
      'VALIDATION_ERROR',
      'Provide new_str (or content: the full new markdown content for the page)'
    )
  }

  // Step 1: Fetch and clear existing top-level blocks
  const existingBlocks = await autoPaginate((cursor) =>
    retryWithBackoff(() =>
      notion.blocks.children.list({
        block_id: input.page_id!,
        start_cursor: cursor,
        page_size: 100
      })
    )
  )

  if (input.allow_deleting_content === false && existingBlocks.length > 0) {
    throw new NotionMCPError(
      'Cannot delete existing content when allow_deleting_content is false',
      'VALIDATION_ERROR',
      'Set allow_deleting_content: true to allow overwriting existing page content'
    )
  }

  if (existingBlocks.length > 0) {
    await processBatches(
      existingBlocks,
      async (block: any) => {
        await retryWithBackoff(() => notion.blocks.delete({ block_id: block.id }))
      },
      { batchSize: 10, concurrency: 3 }
    )
  }

  // Step 2: Parse new markdown with client AST engine and append
  const blockCount = await appendMarkdownBlocks(notion, input.page_id!, newStr)

  return {
    action: 'replace_content',
    page_id: input.page_id,
    replaced: true,
    block_count: blockCount
  }
}

/**
 * Parse markdown with client AST engine and batch-append blocks to a page or parent block.
 * Uses 100-block chunking per Notion API limits with sanitizeBlocksForAppend and retryWithBackoff.
 * Returns the total number of blocks appended.
 */
export async function appendMarkdownBlocks(notion: Client, blockId: string, markdown: string): Promise<number> {
  if (!markdown || markdown.trim().length === 0) {
    return 0
  }
  const { blocks } = markdownToBlocks(markdown)
  if (blocks.length === 0) {
    return 0
  }
  const sanitized = sanitizeBlocksForAppend(blocks as any)
  const CHUNK_SIZE = 100
  for (let i = 0; i < sanitized.length; i += CHUNK_SIZE) {
    const chunk = sanitized.slice(i, i + CHUNK_SIZE)
    await retryWithBackoff(() =>
      notion.blocks.children.append({
        block_id: blockId,
        children: chunk as any
      })
    )
  }
  return sanitized.length
}

/**
 * insert_markdown action — insert markdown at a specific position.
 * Maps to: PATCH /v1/pages/{id}/markdown with body type=insert_content (SDK v5.22+).
 * position: 'start' | 'end' (default 'end'); after_block_id: insert after a specific block.
 */
export async function insertPageMarkdown(notion: Client, input: PageContentInput): Promise<InsertMarkdownResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for insert_markdown action', 'VALIDATION_ERROR', 'Provide page_id')
  }
  const content = input.content ?? input.markdown ?? input.new_str
  if (content === undefined || content === null) {
    throw new NotionMCPError(
      'content is required for insert_markdown action',
      'VALIDATION_ERROR',
      'Provide content (the markdown to insert)'
    )
  }
  const insertContent: any = { content }
  if (input.position === 'start') {
    insertContent.position = { type: 'start' }
  } else if (input.after_block_id) {
    insertContent.after = input.after_block_id
  } else {
    // default: append to end
    insertContent.position = { type: 'end' }
  }
  const r = await (notion.pages as unknown as PageMarkdownAPI).updateMarkdown({
    page_id: input.page_id,
    type: 'insert_content',
    insert_content: insertContent
  })
  return {
    action: 'insert_markdown',
    page_id: input.page_id,
    inserted: true,
    markdown: r?.markdown ? sanitizeNotionMarkdown(r.markdown) : r?.markdown,
    truncated: r?.truncated
  }
}

/**
 * update_content action — server-side search & replace (string-level).
 * Maps to: PATCH /v1/pages/{id}/markdown with body type=update_content (SDK v5.22+).
 * Updates: [{old_str, new_str, replace_all_matches?}]
 * Server finds old_str and replaces with new_str without disturbing other content.
 */
export async function updatePageContent(notion: Client, input: PageContentInput): Promise<UpdateContentResult> {
  if (!input.page_id) {
    throw new NotionMCPError('page_id is required for update_content action', 'VALIDATION_ERROR', 'Provide page_id')
  }
  if (!input.updates || (Array.isArray(input.updates) && input.updates.length === 0)) {
    throw new NotionMCPError(
      'updates is required for update_content action',
      'VALIDATION_ERROR',
      'Provide updates: [{old_str, new_str, replace_all_matches?}] (at least one)'
    )
  }
  const parsedUpdates = parseMaybeJSON(input.updates, 'updates')
  if (Array.isArray(parsedUpdates) && parsedUpdates.length === 0) {
    throw new NotionMCPError(
      'updates is required for update_content action',
      'VALIDATION_ERROR',
      'Provide updates: [{old_str, new_str, replace_all_matches?}] (at least one)'
    )
  }
  const contentUpdates = Array.isArray(parsedUpdates)
    ? parsedUpdates.map((u: any) => ({
        old_str: u.old_str ?? u.search ?? u.target,
        new_str: u.new_str ?? u.replace ?? u.content,
        ...(u.replace_all_matches !== undefined ? { replace_all_matches: u.replace_all_matches } : {})
      }))
    : parsedUpdates

  const r = await (notion.pages as unknown as PageMarkdownAPI).updateMarkdown({
    page_id: input.page_id,
    type: 'update_content',
    update_content: {
      content_updates: contentUpdates as any,
      allow_deleting_content: input.allow_deleting_content ?? false
    }
  })
  return {
    action: 'update_content',
    page_id: input.page_id,
    updated: true,
    markdown: r?.markdown ? sanitizeNotionMarkdown(r.markdown) : r?.markdown,
    truncated: r?.truncated
  }
}

/**
 * replace_content_range action — replace markdown within a specific content range.
 * Maps to: PATCH /v1/pages/{id}/markdown with body type=replace_content_range (SDK v5.22+).
 */
export async function replacePageContentRange(
  notion: Client,
  input: PageContentInput
): Promise<ReplaceContentRangeResult> {
  if (!input.page_id) {
    throw new NotionMCPError(
      'page_id is required for replace_content_range action',
      'VALIDATION_ERROR',
      'Provide page_id'
    )
  }
  // `new_str` and `markdown` are accepted as aliases for `content`
  const rangeBody = input.content ?? input.markdown ?? input.new_str
  if (rangeBody === undefined || rangeBody === null || !input.content_range) {
    throw new NotionMCPError(
      'content (or new_str) and content_range required for replace_content_range action',
      'VALIDATION_ERROR',
      'Provide both content/new_str (new markdown) and content_range (existing range to replace)'
    )
  }
  const r = await (notion.pages as unknown as PageMarkdownAPI).updateMarkdown({
    page_id: input.page_id,
    type: 'replace_content_range',
    replace_content_range: {
      content: rangeBody,
      content_range: input.content_range,
      allow_deleting_content: input.allow_deleting_content ?? false
    }
  })
  return {
    action: 'replace_content_range',
    page_id: input.page_id,
    replaced: true,
    markdown: r?.markdown ? sanitizeNotionMarkdown(r.markdown) : r?.markdown,
    truncated: r?.truncated
  }
}
