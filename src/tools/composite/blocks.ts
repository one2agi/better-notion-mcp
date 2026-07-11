/**
 * Blocks Mega Tool
 * All block operations in one unified interface
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import { parseMaybeJSON } from '../helpers/json-input.js'
import { blocksToMarkdown, markdownToBlocks } from '../helpers/markdown.js'
import { autoPaginate, populateDeepChildren } from '../helpers/pagination.js'
import { normalizeBlockProperties } from '../helpers/properties.js'

export interface GetBlockResult {
  action: 'get'
  block_id: string
  type: string
  has_children: boolean
  archived: boolean
  block: any
}

export interface GetBlockChildrenResult {
  action: 'children'
  block_id: string
  total_children: number
  markdown: string
  blocks: any[]
}

export interface AppendToBlockResult {
  action: 'append'
  block_id: string
  appended_count: number
  warnings?: import('../helpers/markdown.js').MarkdownWarning[]
}

export interface UpdateBlockResult {
  action: 'update'
  block_id: string
  type: string
  updated: true
}

export interface DeleteBlockResult {
  action: 'delete'
  block_id: string
  deleted: true
}

export type BlocksResult =
  | GetBlockResult
  | GetBlockChildrenResult
  | AppendToBlockResult
  | UpdateBlockResult
  | DeleteBlockResult

export interface BlocksInput {
  action: 'get' | 'children' | 'append' | 'update' | 'delete'
  block_id: string
  content?: string // Markdown format (for text-rich block types)

  /**
   * Direct block JSON array for structural types (synced_block, link_to_page,
   * table, table_row, column, column_list) that have no markdown syntax.
   * Mutually exclusive with `content`.
   */
  blocks?: any[]
  position?: 'start' | 'end' | 'after_block'
  after_block_id?: string

  /**
   * Direct field updates for non-text block types. Mutually exclusive with
   * `content`. Per-type shape:
   * - table:        { has_column_header?: bool, has_row_header?: bool }
   * - table_row:    { cells: string[][] | RichText[][] }
   * - column:       { width_ratio: number (0 < x <= 1) }
   * - synced_block: { synced_from: { block_id } | null }
   * - link_to_page: { page_id } | { database_id } | { comment_id } (exactly one)
   */
  properties?: Record<string, any>
}

/**
 * Unified blocks tool
 * Maps to: GET/PATCH/DELETE /v1/blocks/{id} and GET/PATCH /v1/blocks/{id}/children
 */
export async function blocks(notion: Client, input: BlocksInput): Promise<BlocksResult> {
  return withErrorHandling(async () => {
    if (!input.block_id) {
      throw new NotionMCPError('block_id required', 'VALIDATION_ERROR', 'Provide block_id')
    }

    switch (input.action) {
      case 'get':
        return await getBlock(notion, input)

      case 'children':
        return await getBlockChildren(notion, input)

      case 'append':
        return await appendToBlock(notion, input)

      case 'update':
        return await updateBlock(notion, input)

      case 'delete':
        return await deleteBlock(notion, input)

      default:
        throwUnknownAction(input.action, ['get', 'children', 'append', 'update', 'delete'], 'blocks')
    }
  })()
}

/**
 * Retrieve single block
 * Maps to: GET /v1/blocks/{id}
 */
async function getBlock(notion: Client, input: BlocksInput): Promise<GetBlockResult> {
  const block: any = await notion.blocks.retrieve({ block_id: input.block_id })
  return {
    action: 'get',
    block_id: block.id,
    type: block.type,
    has_children: block.has_children,
    archived: block.archived,
    block
  }
}

/**
 * List child blocks
 * Maps to: GET /v1/blocks/{id}/children
 */
async function getBlockChildren(notion: Client, input: BlocksInput): Promise<GetBlockChildrenResult> {
  const blocksList = await autoPaginate((cursor) =>
    notion.blocks.children.list({
      block_id: input.block_id,
      start_cursor: cursor,
      page_size: 100
    })
  )

  // Recursively fetch children for blocks that need them (tables, toggles, columns)
  await populateDeepChildren(notion, blocksList as any[])

  const markdown = blocksToMarkdown(blocksList as any)
  return {
    action: 'children',
    block_id: input.block_id,
    total_children: blocksList.length,
    markdown,
    blocks: blocksList
  }
}

/**
 * Add markdown content at position
 * Maps to: PATCH /v1/blocks/{id}/children
 */
async function appendToBlock(notion: Client, input: BlocksInput): Promise<AppendToBlockResult> {
  if (!input.content && !input.blocks) {
    throw new NotionMCPError(
      'content or blocks required for append',
      'VALIDATION_ERROR',
      'Provide markdown content or a blocks array'
    )
  }
  if (input.content && input.blocks) {
    throw new NotionMCPError(
      'Provide either content or blocks, not both',
      'VALIDATION_ERROR',
      'Pick one: content for markdown parsing, blocks for direct block JSON'
    )
  }
  if (input.position === 'after_block' && !input.after_block_id) {
    throw new NotionMCPError(
      'after_block_id required when position is after_block',
      'VALIDATION_ERROR',
      'Provide after_block_id with the block ID to insert after'
    )
  }
  let blocksList: any[]
  let markdownWarnings: import('../helpers/markdown.js').MarkdownWarning[] | undefined
  if (input.blocks) {
    // Direct block JSON path (structural types: synced_block, link_to_page, table, table_row, column, column_list)
    blocksList = input.blocks
  } else {
    const { blocks: parsed, warnings } = markdownToBlocks(input.content!)
    blocksList = parsed
    markdownWarnings = warnings
    // Notion API rejects column_ratio in format when creating column blocks via blocks.children.append.
    // Strip format.column_ratio from any column blocks (width is set implicitly or via separate update).
    for (const block of blocksList) {
      if (block.type === 'column' && (block as any).column?.format?.column_ratio !== undefined) {
        delete (block as any).column.format.column_ratio
        if (Object.keys((block as any).column.format).length === 0) {
          delete (block as any).column.format
        }
      }
    }
  }
  const appendParams: any = {
    block_id: input.block_id,
    children: blocksList as any
  }
  if (input.position === 'start') {
    appendParams.position = { type: 'start' }
  } else if (input.position === 'after_block' && input.after_block_id) {
    appendParams.position = { type: 'after_block', after_block: { id: input.after_block_id } }
  }
  await notion.blocks.children.append(appendParams)
  const result: AppendToBlockResult = {
    action: 'append',
    block_id: input.block_id,
    appended_count: blocksList.length
  }
  // BUG #5: surface parser warnings to the caller so silent markdown degradation
  // (unclosed code fence, unclosed <details> toggle) is visible at the API boundary.
  if (markdownWarnings && markdownWarnings.length > 0) {
    result.warnings = markdownWarnings
  }
  return result
}

/**
 * Replace block content. Two input modes (mutually exclusive):
 * - content: markdown string -> parsed to a Notion block (text-rich types)
 * - properties: direct field object (structural types: table/table_row/column/synced_block/link_to_page)
 * Maps to: PATCH /v1/blocks/{id}
 */
async function updateBlock(notion: Client, input: BlocksInput): Promise<UpdateBlockResult> {
  if (!input.content && !input.properties) {
    throw new NotionMCPError(
      'Provide content (markdown) or properties (direct fields)',
      'VALIDATION_ERROR',
      'For text-rich blocks use content; for structural blocks (table, table_row, column, synced_block, link_to_page) use properties'
    )
  }
  if (input.content && input.properties) {
    throw new NotionMCPError(
      'Provide either content or properties, not both',
      'VALIDATION_ERROR',
      'Pick one: content for markdown parsing, properties for direct field updates'
    )
  }

  let updatePayload: any
  let blockType: string | undefined

  // Pre-fetch block type once (needed for both content and properties paths)
  let originalBlockType: string | undefined
  try {
    const existingBlock: any = await notion.blocks.retrieve({ block_id: input.block_id })
    originalBlockType = existingBlock.type
  } catch {
    // Block not found will be caught by update call below
  }

  if (input.content) {
    // Content path: parse markdown and build updatePayload using original block type for structural check
    if (originalBlockType && STRUCTURAL_BLOCK_TYPES.has(originalBlockType)) {
      throw new NotionMCPError(
        `Block type '${originalBlockType}' cannot be updated via content; use properties instead`,
        'VALIDATION_ERROR',
        `Provide properties with the relevant fields for ${originalBlockType}`
      )
    }

    const { blocks: newBlocks } = markdownToBlocks(input.content)
    if (newBlocks.length === 0) {
      throw new NotionMCPError('Content must produce at least one block', 'VALIDATION_ERROR', 'Invalid markdown')
    }
    const newContent = newBlocks[0]
    blockType = newContent.type

    updatePayload = {}
    if (blockType === 'to_do') {
      updatePayload.to_do = {
        rich_text: (newContent as any).to_do?.rich_text || [],
        checked: (newContent as any).to_do?.checked ?? false
      }
    } else if (blockType === 'code') {
      updatePayload.code = {
        rich_text: (newContent as any).code?.rich_text || [],
        language: (newContent as any).code?.language || 'plain text'
      }
    } else if (blockType === 'callout') {
      updatePayload.callout = {
        rich_text: (newContent as any).callout?.rich_text || [],
        icon: (newContent as any).callout?.icon,
        color: (newContent as any).callout?.color ?? 'default'
      }
    } else if (blockType === 'toggle') {
      updatePayload.toggle = {
        rich_text: (newContent as any).toggle?.rich_text || [],
        color: (newContent as any).toggle?.color ?? 'default'
      }
    } else if (blockType === 'template') {
      updatePayload.template = { rich_text: (newContent as any).template?.rich_text || [] }
    } else if (blockType === 'image') {
      const img = (newContent as any).image || {}
      updatePayload.image = {
        ...(img.external ? { external: img.external } : {}),
        ...(img.file ? { file: img.file } : {}),
        caption: img.caption || []
      }
    } else if (blockType === 'bookmark') {
      updatePayload.bookmark = {
        url: (newContent as any).bookmark?.url || '',
        caption: (newContent as any).bookmark?.caption || []
      }
    } else if (blockType === 'embed') {
      updatePayload.embed = {
        url: (newContent as any).embed?.url || '',
        caption: (newContent as any).embed?.caption || []
      }
    } else if (blockType === 'divider') {
      updatePayload.divider = {}
    } else if (blockType === 'equation') {
      updatePayload.equation = { expression: (newContent as any).equation?.expression || '' }
    } else if (blockType === 'breadcrumb') {
      updatePayload.breadcrumb = {}
    } else if (blockType === 'column_list') {
      updatePayload.column_list = {}
    } else {
      // Default: rich_text-based blocks (paragraph, heading_*, list, quote, etc.)
      updatePayload[blockType] = (newContent as any)[blockType] || { rich_text: [] }
    }
  } else {
    // Properties path: build updatePayload directly.
    // Notion API rejects properties for unsupported block types (image, etc.).
    const rawProperties = parseMaybeJSON(input.properties!, 'properties')

    if (originalBlockType && STRUCTURAL_BLOCK_TYPES.has(originalBlockType)) {
      // Structural types use normalizeBlockProperties
      updatePayload = normalizeBlockProperties(originalBlockType, rawProperties as Record<string, any>)
    } else if (originalBlockType) {
      // Text-rich types: wrap inside the block type key (preserves color, checked, etc.)
      updatePayload = { [originalBlockType]: rawProperties }
    } else {
      // Fallback: pass through (block type unknown)
      updatePayload = rawProperties
    }
  }

  // Content path: call notion.blocks.update directly
  try {
    await notion.blocks.update({
      block_id: input.block_id,
      ...updatePayload
    } as any)
  } catch (err: any) {
    if (err.code === 'object_not_found') {
      throw new NotionMCPError(
        `Block not found: ${input.block_id}`,
        'OBJECT_NOT_FOUND',
        'The specified block does not exist'
      )
    }
    // BUG #1: only relabel validation_errors that look like an actual whitelist mismatch
    // ("block type X cannot be updated/created"). Loose substring match on "type" used to
    // swallow unrelated field-level errors (e.g. "this block type does not support
    // property is_toggleable") and hide the real Notion API contract from the caller.
    const bodyMessage: string = err.body?.message || err.message || ''
    // Phrasings observed in real Notion API responses:
    //   "Block type 'image' cannot be updated."
    //   "block type 'foo' is not supported"
    //   "body block type 'foo' cannot be created"
    const isWhitelistMismatch =
      /block type .*?(cannot|can't|is not|not) be (updated|created|changed|modified)/i.test(bodyMessage) ||
      /block type .*?(not |un)(supported|allowed|changeable|changeable|updatable|changeable)/i.test(bodyMessage)
    if (err.code === 'validation_error' && isWhitelistMismatch) {
      throw new NotionMCPError(
        `Block type cannot be updated`,
        'VALIDATION_ERROR',
        'Supported types: paragraph, heading_1-4, bulleted/numbered_list_item, quote, to_do, code, toggle, callout, template, table, table_row, column, synced_block, link_to_page'
      )
    }
    throw err
  }

  return {
    action: 'update',
    block_id: input.block_id,
    type: blockType || originalBlockType || 'unknown',
    updated: true
  }
}

/**
 * Block types that can be updated via the Notion API.
 */
const UPDATABLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'heading_4',
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'to_do',
  'code',
  'toggle',
  'callout',
  'template',
  'table',
  'table_row',
  'column',
  'synced_block',
  'link_to_page'
])

/**
 * Block types that must be updated via properties (no markdown representation).
 * Subset of UPDATABLE_BLOCK_TYPES.
 */
const STRUCTURAL_BLOCK_TYPES = new Set([
  'table',
  'table_row',
  'column',
  'synced_block',
  'link_to_page',
  'template' // template has no markdown syntax; rich_text must be passed via properties
])

/**
 * Text-only blocks — should be updated via content (markdown), not properties.
 * Subset of UPDATABLE_BLOCK_TYPES. Excludes headings/paragraph/list items/quote
 * which CAN accept properties (e.g. to preserve color, check state).
 */
const TEXT_ONLY_BLOCK_TYPES = new Set<string>() // No text-rich blocks reject properties — all allow it for color/style

/**
 * Remove block
 * Maps to: DELETE /v1/blocks/{id}
 */
async function deleteBlock(notion: Client, input: BlocksInput): Promise<DeleteBlockResult> {
  await notion.blocks.delete({ block_id: input.block_id })
  return {
    action: 'delete',
    block_id: input.block_id,
    deleted: true
  }
}
