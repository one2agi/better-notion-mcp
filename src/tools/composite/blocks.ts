/**
 * Blocks Mega Tool
 * All block operations in one unified interface
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, withErrorHandling } from '../helpers/errors.js'
import { blocksToMarkdown, markdownToBlocks, parseRichText } from '../helpers/markdown.js'
import { autoPaginate, populateDeepChildren } from '../helpers/pagination.js'

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
        throw new NotionMCPError(
          `Unknown action: ${input.action}`,
          'VALIDATION_ERROR',
          'Supported actions: get, children, append, update, delete'
        )
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
  if (!input.content) {
    throw new NotionMCPError('content required for append', 'VALIDATION_ERROR', 'Provide markdown content')
  }
  if (input.position === 'after_block' && !input.after_block_id) {
    throw new NotionMCPError(
      'after_block_id required when position is after_block',
      'VALIDATION_ERROR',
      'Provide after_block_id with the block ID to insert after'
    )
  }
  const { blocks: blocksList } = markdownToBlocks(input.content)
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
  return {
    action: 'append',
    block_id: input.block_id,
    appended_count: blocksList.length
  }
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

  const block: any = await notion.blocks.retrieve({ block_id: input.block_id })
  const blockType = block.type

  if (!UPDATABLE_BLOCK_TYPES.has(blockType)) {
    throw new NotionMCPError(
      `Block type '${blockType}' cannot be updated`,
      'VALIDATION_ERROR',
      'Supported types: paragraph, heading_1-4, bulleted/numbered_list_item, quote, to_do, code, toggle, callout, template, table, table_row, column, synced_block, link_to_page'
    )
  }

  let updatePayload: any

  if (input.content) {
    // Markdown path: parse content and extract type-specific fields
    const { blocks: newBlocks } = markdownToBlocks(input.content)

    if (newBlocks.length === 0) {
      throw new NotionMCPError('Content must produce at least one block', 'VALIDATION_ERROR', 'Invalid markdown')
    }

    const newContent = newBlocks[0]

    if (newContent.type !== blockType) {
      // For structural types (table/table_row/column/synced_block/link_to_page) require properties
      if (STRUCTURAL_BLOCK_TYPES.has(blockType)) {
        throw new NotionMCPError(
          `Block type '${blockType}' cannot be updated via content; use properties instead`,
          'VALIDATION_ERROR',
          `Provide properties with the relevant fields for ${blockType}`
        )
      }
      // Allow heading level conversion (e.g., heading_2 -> heading_3 if user uses ### markdown)
      // Only heading types can auto-convert; other types still require exact match
      const isHeadingConversion =
        blockType.startsWith('heading_') &&
        newContent.type.startsWith('heading_') &&
        !STRUCTURAL_BLOCK_TYPES.has(blockType)
      if (!isHeadingConversion) {
        throw new NotionMCPError(
          `Block type mismatch: cannot update ${blockType} with content that parses to ${newContent.type}`,
          'VALIDATION_ERROR',
          `Provide markdown that parses to ${blockType} (or use ### syntax matching your block's heading level)`
        )
      }
    }

    updatePayload = {}
    // For heading conversions, use the new type
    const effectiveBlockType = newContent.type !== blockType ? newContent.type : blockType

    if (blockType === 'to_do') {
      updatePayload.to_do = {
        rich_text: (newContent as any).to_do?.rich_text || [],
        checked: (newContent as any).to_do?.checked ?? block.to_do?.checked ?? false
      }
    } else if (blockType === 'code') {
      updatePayload.code = {
        rich_text: (newContent as any).code?.rich_text || [],
        language: (newContent as any).code?.language || block.code?.language || 'plain text'
      }
    } else if (blockType === 'callout') {
      updatePayload.callout = {
        rich_text: (newContent as any).callout?.rich_text || [],
        icon: (newContent as any).callout?.icon ?? block.callout?.icon,
        color: (newContent as any).callout?.color ?? block.callout?.color ?? 'default'
      }
    } else if (blockType === 'toggle') {
      updatePayload.toggle = {
        rich_text: (newContent as any).toggle?.rich_text || [],
        color: (newContent as any).toggle?.color ?? block.toggle?.color ?? 'default'
      }
    } else if (blockType === 'template') {
      updatePayload.template = {
        rich_text: (newContent as any).template?.rich_text || []
      }
    } else if (effectiveBlockType === 'heading_4') {
      updatePayload.heading_4 = {
        rich_text: (newContent as any).heading_4?.rich_text || [],
        color: (newContent as any).heading_4?.color ?? block[blockType]?.color ?? 'default',
        is_toggleable: block[blockType]?.is_toggleable ?? false
      }
    } else {
      // paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, quote
      updatePayload[effectiveBlockType] = {
        rich_text: (newContent as any)[effectiveBlockType]?.rich_text || []
      }
    }
  } else {
    // Properties path: structural blocks
    if (TEXT_RICH_BLOCK_TYPES.has(blockType)) {
      throw new NotionMCPError(
        `Block type '${blockType}' cannot be updated via properties; use content instead`,
        'VALIDATION_ERROR',
        'Provide markdown content that parses to this block type'
      )
    }
    const normalized = normalizeProperties(blockType, input.properties!)
    updatePayload = { [blockType]: normalized }
  }

  await notion.blocks.update({
    block_id: input.block_id,
    ...updatePayload
  } as any)

  return {
    action: 'update',
    block_id: input.block_id,
    type: blockType,
    updated: true
  }
}

/**
 * Block types that should be updated via markdown content (not properties).
 * Subset of UPDATABLE_BLOCK_TYPES. Note: template is NOT here because
 * there's no markdown syntax for it; it must be updated via properties.
 */
const TEXT_RICH_BLOCK_TYPES = new Set([
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
  'callout'
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
 * Normalize raw `properties` input into the shape the SDK expects per block type.
 */
function normalizeProperties(blockType: string, raw: Record<string, any>): any {
  if (blockType === 'table_row') {
    const cells = raw.cells
    if (Array.isArray(cells) && cells.length > 0 && Array.isArray(cells[0])) {
      // cells is string[][] or RichText[][]
      if (cells[0].length > 0 && typeof cells[0][0] === 'string') {
        // string[][] -> RichText[][]
        return {
          cells: (cells as string[][]).map((row) => row.map((cell) => parseRichText(cell)))
        }
      }
      // already RichText[][] - pass through
      return { cells }
    }
    throw new NotionMCPError(
      'table_row.properties.cells must be string[][] or RichText[][]',
      'VALIDATION_ERROR',
      'Provide cells as e.g. [["A", "B"], ["C", "D"]]'
    )
  }

  if (blockType === 'synced_block') {
    // Accept { synced_from: null } (unlink) or { synced_from: { block_id } } (link)
    if (raw.synced_from === null) {
      return { synced_from: null }
    }
    if (raw.synced_from && typeof raw.synced_from === 'object' && typeof raw.synced_from.block_id === 'string') {
      return { synced_from: { block_id: raw.synced_from.block_id } }
    }
    throw new NotionMCPError(
      'synced_block.properties.synced_from must be null or { block_id: string }',
      'VALIDATION_ERROR',
      'Pass null to unlink, or { block_id: "<id>" } to link'
    )
  }

  if (blockType === 'link_to_page') {
    const targets = ['page_id', 'database_id', 'comment_id'].filter((k) => raw[k])
    if (targets.length !== 1) {
      throw new NotionMCPError(
        'link_to_page requires exactly one of: page_id, database_id, comment_id',
        'VALIDATION_ERROR',
        'Provide e.g. { page_id: "<page-id>" } or { database_id: "<db-id>" }'
      )
    }
    return { [targets[0]]: raw[targets[0]] }
  }

  if (blockType === 'column') {
    const ratio = raw.width_ratio
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new NotionMCPError(
        'width_ratio must be between 0 and 1',
        'VALIDATION_ERROR',
        'Provide a positive number up to 1 (e.g. 0.5 for half-width column)'
      )
    }
    return { width_ratio: ratio }
  }

  // table: pass-through (has_column_header / has_row_header are already bool)
  return raw
}

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
