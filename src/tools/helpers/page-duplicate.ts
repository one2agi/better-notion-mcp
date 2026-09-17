/**
 * Page deep duplication engine
 * Handles recursive block-tree duplication, batch processing, and read-only property sanitization
 * Maps to: GET /v1/pages/{id} + POST /v1/pages + GET/PATCH /v1/blocks
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, retryWithBackoff } from './errors.js'
import { autoPaginate, populateDeepChildren, processBatches } from './pagination.js'
import { sanitizeReadonlyProperties } from './properties.js'

export interface DuplicatePageResult {
  action: 'duplicate'
  processed: number
  results: Array<{ original_id: string; duplicate_id: string; url: string }>
}

export interface DuplicatePageInput {
  page_id?: string
  page_ids?: string[]
  [key: string]: any
}

/**
 * Duplicate page
 * Maps to: GET /v1/pages/{id} + POST /v1/pages + GET/PATCH /v1/blocks
 */
export async function duplicatePage(notion: Client, input: DuplicatePageInput): Promise<DuplicatePageResult> {
  const pageIds = input.page_ids || (input.page_id ? [input.page_id] : [])

  if (pageIds.length === 0) {
    throw new NotionMCPError('page_id or page_ids required', 'VALIDATION_ERROR', 'Provide at least one page ID')
  }

  // Process duplicates in batches to improve performance while respecting rate limits
  const results = await processBatches(
    pageIds,
    async (pageId) => {
      // Get original page and content in parallel

      const [originalPage, originalBlocks] = await Promise.all([
        retryWithBackoff(() => notion.pages.retrieve({ page_id: pageId }) as Promise<any>),

        autoPaginate((cursor) =>
          notion.blocks.children.list({
            block_id: pageId,

            start_cursor: cursor,

            page_size: 100
          })
        )
      ])

      // Bug #33: Notion API `blocks.children.append` requires nested children
      // to be inlined for has_children blocks (tables, toggles, columns, ...).
      // autoPaginate above only fetches the top level — recursively fetch
      // nested children so the append payload matches what Notion expects.
      // (Discovered via real-Notion differential test on test page
      // 3924f4cfc8e280aba43fcbb4ede3631e — table block at children[13] had
      // `table.children should be defined, instead was undefined`.)
      await populateDeepChildren(notion, originalBlocks as any)

      // Sanitize parent - API response may include extra fields that
      // the create endpoint rejects (e.g. database_id in data_source parent)
      const rawParent = originalPage.parent
      let parent: any
      if (rawParent.type === 'data_source_id') {
        parent = { type: 'data_source_id', data_source_id: rawParent.data_source_id }
      } else if (rawParent.type === 'database_id') {
        parent = { type: 'database_id', database_id: rawParent.database_id }
      } else if (rawParent.type === 'page_id') {
        parent = { type: 'page_id', page_id: rawParent.page_id }
      } else {
        parent = rawParent
      }

      // Drop Notion-managed readonly types (formula, rollup, created_time, etc.)
      // that POST /v1/pages rejects. All other properties pass through unchanged
      // to preserve their exact Notion format (title, select, date objects, ...).
      const sanitizedProps = sanitizeReadonlyProperties(originalPage.properties)

      // Create duplicate
      const duplicatedPage: any = await retryWithBackoff(() =>
        notion.pages.create({
          parent,
          properties: sanitizedProps,
          icon: originalPage.icon,
          cover: originalPage.cover
        })
      )

      // Copy content — strip read-only fields that the create endpoint rejects.
      // Recurses into nested children so nested blocks (table rows, toggle
      // paragraphs, etc.) are also sanitized — they have the same metadata
      // fields (id/parent/created_time/...) that POST rejects.
      //
      // Bug #34: child_page and child_database blocks are NOT creatable via
      // blocks.children.append — Notion rejects them with "X should be defined"
      // for every type field. They're created via pages.create separately.
      // For duplicate, we drop them (they live as their own pages, not part of
      // the parent's body). Discovered via real-Notion differential test on
      // test page 3924f4cfc8e280aba43fcbb4ede3631e, 2026-07-04.
      const BLOCKS_DROP_ON_DUPLICATE = new Set(['child_page', 'child_database'])
      if (originalBlocks.length > 0) {
        const sanitizeBlock = (block: any): any | null => {
          const {
            id,
            parent,
            created_time,
            last_edited_time,
            created_by,
            last_edited_by,
            has_children,
            archived,
            in_trash,
            request_id,
            object,
            ...rest
          } = block
          // Drop block types that POST /v1/blocks/{id}/children rejects outright
          if (BLOCKS_DROP_ON_DUPLICATE.has(rest.type)) return null
          // Strip null values inside block type data (e.g., paragraph.icon: null)
          // Notion API rejects null where it expects object or undefined
          const blockType = rest.type
          if (blockType && rest[blockType] && typeof rest[blockType] === 'object') {
            for (const key of Object.keys(rest[blockType])) {
              if (rest[blockType][key] === null) {
                delete rest[blockType][key]
              }
            }
            // Recurse into nested children (tables, toggles, columns, ...)
            const nestedChildren = rest[blockType].children
            if (Array.isArray(nestedChildren)) {
              rest[blockType].children = nestedChildren.map(sanitizeBlock).filter((b: any) => b !== null)
            }
          }
          return rest
        }
        const sanitizedBlocks = (originalBlocks as any[]).map(sanitizeBlock).filter((b: any) => b !== null)
        if (sanitizedBlocks.length > 0) {
          await retryWithBackoff(() =>
            notion.blocks.children.append({
              block_id: duplicatedPage.id,
              children: sanitizedBlocks as any
            })
          )
        }
      }

      return {
        original_id: pageId,
        duplicate_id: duplicatedPage.id,
        url: duplicatedPage.url
      }
    },
    { batchSize: 5, concurrency: 3 }
  )

  return {
    action: 'duplicate',
    processed: results.length,
    results
  }
}
