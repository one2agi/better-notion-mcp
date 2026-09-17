/**
 * Block Properties Helpers
 * Normalizes per-block-type properties from user input to Notion API format.
 */

import { NotionMCPError } from './errors.js'
import { parseRichText } from './markdown.js'

/**
 * Normalize per-block-type properties from the user's input format to the
 * shape Notion's API expects. Throws NotionMCPError on invalid input.
 *
 * Extracted from `composite/blocks.ts` so it can be unit-tested in isolation
 * and reused if other code paths need to format block properties.
 */
export function normalizeBlockProperties(blockType: string, raw: Record<string, any>): any {
  if (blockType === 'table_row') {
    const cells = raw.cells
    if (Array.isArray(cells) && cells.length > 0 && Array.isArray(cells[0])) {
      // cells is string[][] or RichText[][]
      if (cells[0].length > 0 && typeof cells[0][0] === 'string') {
        // string[][] -> RichText[][]
        return {
          table_row: {
            cells: (cells as string[][]).map((row) => row.map((cell) => parseRichText(cell)))
          }
        }
      }
      // already RichText[][] - pass through
      return { table_row: { cells } }
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
      return { synced_block: { synced_from: null } }
    }
    if (raw.synced_from && typeof raw.synced_from === 'object' && typeof raw.synced_from.block_id === 'string') {
      return { synced_block: { synced_from: { block_id: raw.synced_from.block_id } } }
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
    return { link_to_page: { [targets[0]]: raw[targets[0]] } }
  }

  if (blockType === 'template') {
    // Template block has no markdown syntax — caller passes rich_text via properties.
    // Wrap into { template: {...} } to match Notion API contract.
    return { template: raw }
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
    return { column: { width_ratio: ratio } }
  }

  // table: wrap into { table: {...} } to match Notion API contract
  if (blockType === 'table') {
    return { table: raw }
  }

  // For other block types (text-rich like paragraph/heading), pass-through.
  // The caller (blocks.ts updateBlock) wraps under the block type key itself.
  return raw
}
