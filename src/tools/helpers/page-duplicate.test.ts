import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type DuplicatePageResult, duplicatePage } from './page-duplicate.js'

function createMockNotion() {
  return {
    pages: {
      create: vi.fn(),
      retrieve: vi.fn()
    },
    blocks: {
      children: {
        list: vi.fn(),
        append: vi.fn()
      }
    }
  }
}

let mockNotion: ReturnType<typeof createMockNotion>

describe('page-duplicate helper', () => {
  beforeEach(() => {
    mockNotion = createMockNotion()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('duplicates single page with content and metadata', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      parent: { type: 'page_id', page_id: 'parent1' },
      properties: {
        title: { id: 'title', type: 'title', title: [{ type: 'text', text: { content: 'Original' } }] }
      },
      icon: { type: 'emoji', emoji: '📄' },
      cover: { type: 'external', external: { url: 'https://img.com/cover.png' } }
    })
    mockNotion.blocks.children.list.mockResolvedValueOnce({
      results: [
        {
          id: 'b1',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: 'Hello' } }] },
          has_children: false
        }
      ],
      next_cursor: null,
      has_more: false
    })
    mockNotion.pages.create.mockResolvedValueOnce({
      id: 'dup-1',
      url: 'https://notion.so/dup-1'
    })
    mockNotion.blocks.children.append.mockResolvedValueOnce({})

    const result: DuplicatePageResult = await duplicatePage(mockNotion as any, { page_id: 'p1' })

    expect(result).toEqual({
      action: 'duplicate',
      processed: 1,
      results: [{ original_id: 'p1', duplicate_id: 'dup-1', url: 'https://notion.so/dup-1' }]
    })
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'page_id', page_id: 'parent1' },
        icon: { type: 'emoji', emoji: '📄' },
        cover: { type: 'external', external: { url: 'https://img.com/cover.png' } }
      })
    )
    expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
      block_id: 'dup-1',
      children: [
        expect.objectContaining({
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: 'Hello' } }] }
        })
      ]
    })
  })

  it('duplicates multiple pages via page_ids', async () => {
    mockNotion.pages.retrieve
      .mockResolvedValueOnce({ id: 'p1', parent: { type: 'page_id', page_id: 'par' }, properties: {} })
      .mockResolvedValueOnce({ id: 'p2', parent: { type: 'page_id', page_id: 'par' }, properties: {} })
    mockNotion.blocks.children.list.mockResolvedValue({ results: [], next_cursor: null, has_more: false })
    mockNotion.pages.create
      .mockResolvedValueOnce({ id: 'dup-1', url: 'https://notion.so/dup-1' })
      .mockResolvedValueOnce({ id: 'dup-2', url: 'https://notion.so/dup-2' })

    const result = await duplicatePage(mockNotion as any, { page_ids: ['p1', 'p2'] })

    expect(result.processed).toBe(2)
    expect(result.results).toHaveLength(2)
  })

  it('handles data_source_id and database_id parent types', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      parent: { type: 'data_source_id', data_source_id: 'ds1', database_id: 'db1' },
      properties: {}
    })
    mockNotion.blocks.children.list.mockResolvedValueOnce({ results: [], next_cursor: null, has_more: false })
    mockNotion.pages.create.mockResolvedValueOnce({ id: 'dup-ds', url: 'https://notion.so/dup-ds' })

    await duplicatePage(mockNotion as any, { page_id: 'p1' })

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'data_source_id', data_source_id: 'ds1' }
      })
    )
  })

  it('strips readonly properties (formula, rollup, etc.) during duplication', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      parent: { type: 'page_id', page_id: 'par' },
      properties: {
        Title: { type: 'title', title: [{ text: { content: 'Doc' } }] },
        Calc: { type: 'formula', formula: { string: 'val' } },
        Count: { type: 'rollup', rollup: { number: 5 } },
        Created: { type: 'created_time', created_time: '2026-01-01' }
      }
    })
    mockNotion.blocks.children.list.mockResolvedValueOnce({ results: [], next_cursor: null, has_more: false })
    mockNotion.pages.create.mockResolvedValueOnce({ id: 'dup-1', url: 'https://notion.so/dup-1' })

    await duplicatePage(mockNotion as any, { page_id: 'p1' })

    const createArgs = mockNotion.pages.create.mock.calls[0][0]
    expect(createArgs.properties).toHaveProperty('Title')
    expect(createArgs.properties).not.toHaveProperty('Calc')
    expect(createArgs.properties).not.toHaveProperty('Count')
    expect(createArgs.properties).not.toHaveProperty('Created')
  })

  it('drops child_page and child_database blocks (Bug #34)', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      parent: { type: 'page_id', page_id: 'par' },
      properties: {}
    })
    mockNotion.blocks.children.list.mockResolvedValueOnce({
      results: [
        { id: 'b1', type: 'child_page', child_page: { title: 'Sub' } },
        { id: 'b2', type: 'child_database', child_database: { title: 'DB' } },
        { id: 'b3', type: 'paragraph', paragraph: { rich_text: [] } }
      ],
      next_cursor: null,
      has_more: false
    })
    mockNotion.pages.create.mockResolvedValueOnce({ id: 'dup-1', url: 'https://notion.so/dup-1' })
    mockNotion.blocks.children.append.mockResolvedValueOnce({})

    await duplicatePage(mockNotion as any, { page_id: 'p1' })

    expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
      block_id: 'dup-1',
      children: [
        expect.objectContaining({
          type: 'paragraph'
        })
      ]
    })
  })

  it('skips block append when original page has no blocks', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      parent: { type: 'page_id', page_id: 'par' },
      properties: {}
    })
    mockNotion.blocks.children.list.mockResolvedValueOnce({ results: [], next_cursor: null, has_more: false })
    mockNotion.pages.create.mockResolvedValueOnce({ id: 'dup-1', url: 'https://notion.so/dup-1' })

    await duplicatePage(mockNotion as any, { page_id: 'p1' })

    expect(mockNotion.blocks.children.append).not.toHaveBeenCalled()
  })

  it('throws when page_id or page_ids is not provided', async () => {
    await expect(duplicatePage(mockNotion as any, {})).rejects.toThrow('page_id or page_ids required')
    await expect(duplicatePage(mockNotion as any, { page_ids: [] })).rejects.toThrow('page_id or page_ids required')
  })
})
