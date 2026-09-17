import { describe, expect, it } from 'vitest'
import { normalizeBlockProperties } from './block-properties.js'

describe('normalizeBlockProperties', () => {
  it('converts string[][] cells to RichText[][] for table_row', () => {
    const out = normalizeBlockProperties('table_row', {
      cells: [
        ['A', 'B'],
        ['C', 'D']
      ]
    })
    // Output wraps in { table_row: {...} } to match Notion API contract
    expect(out.table_row.cells).toHaveLength(2)
    expect(out.table_row.cells[0]).toHaveLength(2)
    expect(out.table_row.cells[0][0]).toHaveLength(1)
    expect(out.table_row.cells[0][0][0]).toMatchObject({ type: 'text' })
  })

  it('passes through RichText[][] cells', () => {
    const cells = [[{ type: 'text', text: { content: 'A' } }]]
    expect(normalizeBlockProperties('table_row', { cells }).table_row.cells).toBe(cells)
  })

  it('throws on invalid table_row.cells', () => {
    expect(() => normalizeBlockProperties('table_row', { cells: 'bad' })).toThrow(/cells/)
  })

  it('handles synced_block null (unlink)', () => {
    expect(normalizeBlockProperties('synced_block', { synced_from: null })).toEqual({
      synced_block: { synced_from: null }
    })
  })

  it('handles synced_block { block_id } (link)', () => {
    expect(normalizeBlockProperties('synced_block', { synced_from: { block_id: 'x' } })).toEqual({
      synced_block: { synced_from: { block_id: 'x' } }
    })
  })

  it('throws on invalid synced_block shape', () => {
    expect(() => normalizeBlockProperties('synced_block', { synced_from: 42 })).toThrow(/synced_from/)
  })

  it('link_to_page requires exactly one target', () => {
    expect(() => normalizeBlockProperties('link_to_page', {})).toThrow(/exactly one/)
    expect(() => normalizeBlockProperties('link_to_page', { page_id: 'p', database_id: 'd' })).toThrow(/exactly one/)
    expect(normalizeBlockProperties('link_to_page', { page_id: 'p' })).toEqual({ link_to_page: { page_id: 'p' } })
  })

  it('column requires width_ratio in (0, 1]', () => {
    expect(() => normalizeBlockProperties('column', { width_ratio: 0 })).toThrow(/width_ratio/)
    expect(() => normalizeBlockProperties('column', { width_ratio: 2 })).toThrow(/width_ratio/)
    expect(normalizeBlockProperties('column', { width_ratio: 0.5 })).toEqual({ column: { width_ratio: 0.5 } })
  })

  it('passes through unknown block types (caller wraps)', () => {
    expect(normalizeBlockProperties('paragraph', { foo: 'bar' })).toEqual({ foo: 'bar' })
  })
})
