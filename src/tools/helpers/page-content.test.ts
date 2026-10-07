import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendMarkdownBlocks,
  type GetPageMarkdownResult,
  getPageMarkdown,
  type InsertMarkdownResult,
  insertPageMarkdown,
  type ReplaceContentRangeResult,
  type ReplaceContentResult,
  replacePageContent,
  replacePageContentRange,
  type UpdateContentResult,
  updatePageContent
} from './page-content.js'

function createMockNotion() {
  return {
    pages: {
      retrieveMarkdown: vi.fn(),
      updateMarkdown: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'p1' })
    },
    blocks: {
      children: {
        list: vi.fn().mockResolvedValue({ results: [], has_more: false, next_cursor: null }),
        append: vi.fn().mockResolvedValue({ results: [] })
      },
      delete: vi.fn().mockResolvedValue({ id: 'deleted' })
    }
  }
}

let mockNotion: ReturnType<typeof createMockNotion>

describe('page-content helper', () => {
  beforeEach(() => {
    mockNotion = createMockNotion()
  })

  // ---------------------------------------------------------------------------
  // getPageMarkdown
  // ---------------------------------------------------------------------------
  describe('getPageMarkdown', () => {
    it('returns markdown, truncated flag, and unknown_block_ids', async () => {
      mockNotion.pages.retrieveMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '# Title\n\nBody',
        truncated: false,
        unknown_block_ids: []
      })

      const result: GetPageMarkdownResult = await getPageMarkdown(mockNotion as any, {
        page_id: 'p1'
      })

      expect(result).toEqual({
        action: 'get_markdown',
        page_id: 'p1',
        markdown: '# Title\n\nBody',
        truncated: false,
        unknown_block_ids: []
      })
      expect(mockNotion.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: 'p1' })
    })

    it('sanitizes <empty-block/> and table blocks via sanitizeNotionMarkdown', async () => {
      mockNotion.pages.retrieveMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown:
          '# Title\n\n<empty-block/>\n\n<table header-row="true"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
        truncated: false,
        unknown_block_ids: []
      })

      const result = await getPageMarkdown(mockNotion as any, { page_id: 'p1' })
      expect(result.markdown).not.toContain('<empty-block/>')
      expect(result.markdown).toContain('| A | B |')
    })

    it('throws when page_id is missing', async () => {
      await expect(getPageMarkdown(mockNotion as any, {})).rejects.toThrow(
        'page_id is required for get_markdown action'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // replacePageContent
  // ---------------------------------------------------------------------------
  describe('replacePageContent', () => {
    it('replaces page content with new_str', async () => {
      const result: ReplaceContentResult = await replacePageContent(mockNotion as any, {
        page_id: 'p1',
        new_str: 'NEW'
      })

      expect(result).toMatchObject({
        action: 'replace_content',
        page_id: 'p1',
        replaced: true,
        block_count: 1
      })
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith(
        expect.objectContaining({
          block_id: 'p1',
          children: expect.any(Array)
        })
      )
    })

    it('accepts content alias instead of new_str', async () => {
      const result = await replacePageContent(mockNotion as any, {
        page_id: 'p1',
        content: 'ALIASED'
      })

      expect(result).toMatchObject({ action: 'replace_content', page_id: 'p1', replaced: true, block_count: 1 })
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith(
        expect.objectContaining({
          block_id: 'p1',
          children: expect.any(Array)
        })
      )
    })

    it('throws when page_id is missing', async () => {
      await expect(replacePageContent(mockNotion as any, { new_str: 'foo' })).rejects.toThrow(
        'page_id is required for replace_content action'
      )
    })

    it('throws when new_str and aliases are missing', async () => {
      await expect(replacePageContent(mockNotion as any, { page_id: 'p1' })).rejects.toThrow(
        'new_str is required for replace_content action'
      )
    })

    it('updates page metadata (icon, cover, title) when provided in replace_content', async () => {
      const result = await replacePageContent(mockNotion as any, {
        page_id: 'p1',
        new_str: 'NEW CONTENT',
        icon: '🚀',
        cover: 'gradient_1',
        title: 'New Title'
      })

      expect(result).toMatchObject({
        action: 'replace_content',
        page_id: 'p1',
        replaced: true,
        block_count: 1
      })
      expect(mockNotion.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'p1',
          icon: { type: 'emoji', emoji: '🚀' },
          cover: { type: 'external', external: { url: expect.stringContaining('gradients_1.png') } },
          properties: expect.objectContaining({
            title: expect.anything()
          })
        })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // replacePageContent high-fidelity AST pipeline (RT-04, RT-07, RT-08)
  // ---------------------------------------------------------------------------
  describe('replacePageContent high-fidelity AST pipeline', () => {
    it('RT-04: should clear existing blocks and batch-append parsed client blocks (including bookmarks)', async () => {
      const listMock = vi.fn().mockResolvedValue({
        results: [{ id: 'block-1' }, { id: 'block-2' }],
        has_more: false,
        next_cursor: null
      })
      const deleteMock = vi.fn().mockResolvedValue({ id: 'deleted' })
      const appendMock = vi.fn().mockResolvedValue({ results: [] })
      const updateMarkdownMock = vi.fn()

      const notion = {
        blocks: {
          children: {
            list: listMock,
            append: appendMock
          },
          delete: deleteMock
        },
        pages: {
          updateMarkdown: updateMarkdownMock
        }
      } as any

      const result = await replacePageContent(notion, {
        page_id: 'target-page-id',
        new_str: '# Heading\n\n[bookmark](https://github.com "GitHub")'
      })

      expect(result.replaced).toBe(true)
      // 1. Cleared old blocks
      expect(deleteMock).toHaveBeenCalledWith({ block_id: 'block-1' })
      expect(deleteMock).toHaveBeenCalledWith({ block_id: 'block-2' })
      // 2. Appended new blocks via client AST
      expect(appendMock).toHaveBeenCalledTimes(1)
      const appendArgs = appendMock.mock.calls[0][0]
      expect(appendArgs.block_id).toBe('target-page-id')
      expect(appendArgs.children[1].type).toBe('bookmark')
      expect(appendArgs.children[1].bookmark.url).toBe('https://github.com')
      // 3. updateMarkdown was NOT called
      expect(updateMarkdownMock).not.toHaveBeenCalled()
    })

    it('RT-07: should handle empty new_str by clearing all blocks and appending nothing', async () => {
      const listMock = vi.fn().mockResolvedValue({
        results: [{ id: 'block-1' }],
        has_more: false,
        next_cursor: null
      })
      const deleteMock = vi.fn().mockResolvedValue({ id: 'deleted' })
      const appendMock = vi.fn()

      const notion = {
        blocks: {
          children: {
            list: listMock,
            append: appendMock
          },
          delete: deleteMock
        }
      } as any

      const result = await replacePageContent(notion, {
        page_id: 'target-page-id',
        new_str: ''
      })

      expect(result.replaced).toBe(true)
      expect(result.block_count).toBe(0)
      expect(deleteMock).toHaveBeenCalledWith({ block_id: 'block-1' })
      expect(appendMock).not.toHaveBeenCalled()
    })

    it('RT-08: should chunk append calls into batches of <=100 blocks for large documents', async () => {
      const listMock = vi.fn().mockResolvedValue({
        results: [],
        has_more: false,
        next_cursor: null
      })
      const deleteMock = vi.fn().mockResolvedValue({ id: 'deleted' })
      const appendMock = vi.fn().mockResolvedValue({ results: [] })

      const notion = {
        blocks: {
          children: {
            list: listMock,
            append: appendMock
          },
          delete: deleteMock
        }
      } as any

      const md = Array.from({ length: 120 }, (_, i) => `Paragraph line ${i}`).join('\n\n')
      const result = await replacePageContent(notion, {
        page_id: 'target-page-id',
        new_str: md
      })

      expect(result.replaced).toBe(true)
      expect(result.block_count).toBe(120)
      expect(appendMock).toHaveBeenCalledTimes(2)
      expect(appendMock.mock.calls[0][0].children).toHaveLength(100)
      expect(appendMock.mock.calls[1][0].children).toHaveLength(20)
    })

    it('throws VALIDATION_ERROR when allow_deleting_content is false and page has existing blocks', async () => {
      const listMock = vi.fn().mockResolvedValue({
        results: [{ id: 'block-1' }],
        has_more: false,
        next_cursor: null
      })
      const deleteMock = vi.fn()
      const appendMock = vi.fn()

      const notion = {
        blocks: {
          children: {
            list: listMock,
            append: appendMock
          },
          delete: deleteMock
        }
      } as any

      await expect(
        replacePageContent(notion, {
          page_id: 'target-page-id',
          new_str: 'New content',
          allow_deleting_content: false
        })
      ).rejects.toThrow('Cannot delete existing content when allow_deleting_content is false')

      expect(deleteMock).not.toHaveBeenCalled()
      expect(appendMock).not.toHaveBeenCalled()
    })

    it('allows replacing when allow_deleting_content is false but page has no existing blocks', async () => {
      const listMock = vi.fn().mockResolvedValue({
        results: [],
        has_more: false,
        next_cursor: null
      })
      const deleteMock = vi.fn()
      const appendMock = vi.fn().mockResolvedValue({ results: [] })

      const notion = {
        blocks: {
          children: {
            list: listMock,
            append: appendMock
          },
          delete: deleteMock
        }
      } as any

      const result = await replacePageContent(notion, {
        page_id: 'target-page-id',
        new_str: 'New content',
        allow_deleting_content: false
      })

      expect(result.replaced).toBe(true)
      expect(deleteMock).not.toHaveBeenCalled()
      expect(appendMock).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // appendMarkdownBlocks
  // ---------------------------------------------------------------------------
  describe('appendMarkdownBlocks', () => {
    it('returns 0 and does not call append when markdown is empty or whitespace', async () => {
      const appendMock = vi.fn()
      const notion = {
        blocks: { children: { append: appendMock } }
      } as any

      expect(await appendMarkdownBlocks(notion, 'p1', '')).toBe(0)
      expect(await appendMarkdownBlocks(notion, 'p1', '   ')).toBe(0)
      expect(appendMock).not.toHaveBeenCalled()
    })

    it('parses markdown and appends chunked blocks with <=100 batch limit', async () => {
      const appendMock = vi.fn().mockResolvedValue({ results: [] })
      const notion = {
        blocks: { children: { append: appendMock } }
      } as any

      const md = Array.from({ length: 105 }, (_, i) => `Paragraph ${i}`).join('\n\n')
      const count = await appendMarkdownBlocks(notion, 'p1', md)

      expect(count).toBe(105)
      expect(appendMock).toHaveBeenCalledTimes(2)
      expect(appendMock.mock.calls[0][0].block_id).toBe('p1')
      expect(appendMock.mock.calls[0][0].children).toHaveLength(100)
      expect(appendMock.mock.calls[1][0].children).toHaveLength(5)
    })
  })

  // ---------------------------------------------------------------------------
  // insertPageMarkdown
  // ---------------------------------------------------------------------------
  describe('insertPageMarkdown', () => {
    it('inserts at end by default', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: 'x\nINSERTED'
      })

      const result: InsertMarkdownResult = await insertPageMarkdown(mockNotion as any, {
        page_id: 'p1',
        content: 'INSERTED'
      })

      expect(result).toMatchObject({ action: 'insert_markdown', page_id: 'p1', inserted: true })
      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'insert_content',
        insert_content: { content: 'INSERTED', position: { type: 'end' } }
      })
    })

    it('inserts at start when position is start', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({ object: 'page_markdown', id: 'p1' })

      await insertPageMarkdown(mockNotion as any, {
        page_id: 'p1',
        content: 'TOP',
        position: 'start'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'insert_content',
        insert_content: { content: 'TOP', position: { type: 'start' } }
      })
    })

    it('inserts after a specific block when after_block_id is provided', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({ object: 'page_markdown', id: 'p1' })

      await insertPageMarkdown(mockNotion as any, {
        page_id: 'p1',
        content: 'AFTER',
        after_block_id: 'block-123'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'insert_content',
        insert_content: { content: 'AFTER', after: 'block-123' }
      })
    })

    it('accepts markdown alias instead of content', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({ object: 'page_markdown', id: 'p1' })

      await insertPageMarkdown(mockNotion as any, {
        page_id: 'p1',
        markdown: 'ALIASED_MD'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'insert_content',
        insert_content: { content: 'ALIASED_MD', position: { type: 'end' } }
      })
    })

    it('throws when page_id is missing', async () => {
      await expect(insertPageMarkdown(mockNotion as any, { content: 'test' })).rejects.toThrow(
        'page_id is required for insert_markdown action'
      )
    })

    it('throws when content is missing', async () => {
      await expect(insertPageMarkdown(mockNotion as any, { page_id: 'p1' })).rejects.toThrow(
        'content is required for insert_markdown action'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // updatePageContent
  // ---------------------------------------------------------------------------
  describe('updatePageContent', () => {
    it('normalizes updates and calls updateMarkdown', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: 'updated'
      })

      const result: UpdateContentResult = await updatePageContent(mockNotion as any, {
        page_id: 'p1',
        updates: [{ old_str: 'foo', new_str: 'bar' }]
      })

      expect(result).toMatchObject({ action: 'update_content', page_id: 'p1', updated: true })
      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'update_content',
        update_content: {
          content_updates: [{ old_str: 'foo', new_str: 'bar' }],
          allow_deleting_content: false
        }
      })
    })

    it('accepts search / replace aliases and JSON string format', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({ object: 'page_markdown', id: 'p1' })

      await updatePageContent(mockNotion as any, {
        page_id: 'p1',
        updates: '[{"search":"A","replace":"B","replace_all_matches":true}]' as any
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'update_content',
        update_content: {
          content_updates: [{ old_str: 'A', new_str: 'B', replace_all_matches: true }],
          allow_deleting_content: false
        }
      })
    })

    it('throws when page_id is missing', async () => {
      await expect(updatePageContent(mockNotion as any, { updates: [{ old_str: 'a', new_str: 'b' }] })).rejects.toThrow(
        'page_id is required for update_content action'
      )
    })

    it('throws when updates is missing or empty', async () => {
      await expect(updatePageContent(mockNotion as any, { page_id: 'p1' })).rejects.toThrow(
        'updates is required for update_content action'
      )
      await expect(updatePageContent(mockNotion as any, { page_id: 'p1', updates: [] })).rejects.toThrow(
        'updates is required for update_content action'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // replacePageContentRange
  // ---------------------------------------------------------------------------
  describe('replacePageContentRange', () => {
    it('replaces content within range', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: 'NEW RANGE'
      })

      const result: ReplaceContentRangeResult = await replacePageContentRange(mockNotion as any, {
        page_id: 'p1',
        content: 'NEW',
        content_range: 'OLD'
      })

      expect(result).toMatchObject({
        action: 'replace_content_range',
        page_id: 'p1',
        replaced: true,
        markdown: 'NEW RANGE'
      })
      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'replace_content_range',
        replace_content_range: {
          content: 'NEW',
          content_range: 'OLD',
          allow_deleting_content: false
        }
      })
    })

    it('accepts new_str alias for content (RC-7)', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({ object: 'page_markdown', id: 'p1' })

      await replacePageContentRange(mockNotion as any, {
        page_id: 'p1',
        new_str: 'NEW_STR',
        content_range: 'RANGE'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'replace_content_range',
        replace_content_range: {
          content: 'NEW_STR',
          content_range: 'RANGE',
          allow_deleting_content: false
        }
      })
    })

    it('throws when page_id is missing', async () => {
      await expect(replacePageContentRange(mockNotion as any, { content: 'a', content_range: 'b' })).rejects.toThrow(
        'page_id is required for replace_content_range action'
      )
    })

    it('throws when content or content_range is missing', async () => {
      await expect(replacePageContentRange(mockNotion as any, { page_id: 'p1', content: 'a' })).rejects.toThrow(
        'content (or new_str) and content_range required for replace_content_range action'
      )
    })
  })
})
