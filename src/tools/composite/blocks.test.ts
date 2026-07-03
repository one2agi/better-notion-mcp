import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blocks } from './blocks.js'

vi.mock('../helpers/markdown.js', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    blocksToMarkdown: vi.fn().mockImplementation(actual.blocksToMarkdown),
    markdownToBlocks: vi.fn().mockImplementation(actual.markdownToBlocks)
  }
})

describe('Blocks Tool', () => {
  let mockNotion: any

  beforeEach(() => {
    mockNotion = {
      blocks: {
        retrieve: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        children: {
          list: vi.fn(),
          append: vi.fn()
        }
      }
    }
    vi.clearAllMocks()
  })

  describe('validation', () => {
    it('should throw if block_id is missing', async () => {
      await expect(blocks(mockNotion as any, { action: 'get' } as any)).rejects.toThrow('block_id required')
    })
  })

  describe('get', () => {
    it('should retrieve a block', async () => {
      const mockBlock = {
        id: 'block-1',
        type: 'paragraph',
        has_children: false,
        archived: false,
        paragraph: { rich_text: [] }
      }
      mockNotion.blocks.retrieve.mockResolvedValue(mockBlock)

      const result = await blocks(mockNotion as any, { action: 'get', block_id: 'block-1' })

      expect(result).toEqual({
        action: 'get',
        block_id: 'block-1',
        type: 'paragraph',
        has_children: false,
        archived: false,
        block: mockBlock
      })
      expect(mockNotion.blocks.retrieve).toHaveBeenCalledWith({ block_id: 'block-1' })
    })
  })

  describe('children', () => {
    it('should return markdown and blocks', async () => {
      const paragraphBlock = {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: 'Hello', link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: 'default'
              },
              plain_text: 'Hello',
              href: null
            }
          ]
        }
      }

      mockNotion.blocks.children.list.mockResolvedValue({
        results: [paragraphBlock],
        next_cursor: null,
        has_more: false
      })

      const result = await blocks(mockNotion as any, { action: 'children', block_id: 'block-1' })

      expect(result.action).toBe('children')
      expect(result.block_id).toBe('block-1')
      expect((result as any).total_children).toBe(1)
      expect((result as any).markdown).toBe('Hello')
      expect((result as any).blocks).toHaveLength(1)
      expect(mockNotion.blocks.children.list).toHaveBeenCalledWith({
        block_id: 'block-1',
        start_cursor: undefined,
        page_size: 100
      })
    })

    it('should handle empty blocks', async () => {
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const result = await blocks(mockNotion as any, { action: 'children', block_id: 'block-1' })

      expect(result.action).toBe('children')
      expect(result.block_id).toBe('block-1')
      expect((result as any).total_children).toBe(0)
      expect((result as any).markdown).toBe('')
      expect((result as any).blocks).toHaveLength(0)
    })
  })

  describe('append', () => {
    it('should append blocks from markdown', async () => {
      mockNotion.blocks.children.append.mockResolvedValue({})

      const result = await blocks(mockNotion as any, {
        action: 'append',
        block_id: 'block-1',
        content: 'Hello world'
      })

      expect(result.action).toBe('append')
      expect(result.block_id).toBe('block-1')
      expect((result as any).appended_count).toBe(1)
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'block-1',
        children: expect.any(Array)
      })
    })

    it('should throw without content', async () => {
      await expect(blocks(mockNotion as any, { action: 'append', block_id: 'block-1' })).rejects.toThrow(
        'content required for append'
      )
    })

    it('should pass position start when specified', async () => {
      mockNotion.blocks.children.append.mockResolvedValue({})

      await blocks(mockNotion as any, {
        action: 'append',
        block_id: 'block-1',
        content: 'Prepended',
        position: 'start'
      })

      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'block-1',
        children: expect.any(Array),
        position: { type: 'start' }
      })
    })

    it('should pass position after_block with after_block_id', async () => {
      mockNotion.blocks.children.append.mockResolvedValue({})

      await blocks(mockNotion as any, {
        action: 'append',
        block_id: 'block-1',
        content: 'Inserted after',
        position: 'after_block',
        after_block_id: 'target-block'
      })

      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'block-1',
        children: expect.any(Array),
        position: { type: 'after_block', after_block: { id: 'target-block' } }
      })
    })

    // Defensive strip from 64b6612: column blocks cannot have format.column_ratio when
    // created via blocks.children.append (Notion API rejects it). The parser currently
    // does not emit column blocks, so this path is exercised via a mocked parser that
    // synthesises a column block to guarantee coverage if future parser support is added.
    it('should strip format.column_ratio from column blocks before appending', async () => {
      const { markdownToBlocks } = await import('../helpers/markdown.js')
      vi.mocked(markdownToBlocks).mockReturnValueOnce({
        blocks: [
          {
            type: 'column',
            column: {
              rich_text: [{ text: { content: 'left' } }],
              format: { column_ratio: 0.5 }
            }
          },
          {
            type: 'column',
            column: {
              rich_text: [{ text: { content: 'right' } }],
              format: { column_ratio: 0.3, block_width: 100 } // keep non-empty format
            }
          }
        ],
        warnings: []
      } as any)

      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await blocks(mockNotion as any, {
        action: 'append',
        block_id: 'parent-block',
        content: 'irrelevant (parser is mocked)'
      })

      const captured = mockNotion.blocks.children.append.mock.calls[0][0]
      const [col1, col2] = captured.children

      // 1st column: format was only column_ratio → object should be deleted entirely
      expect(col1.column.format?.column_ratio).toBeUndefined()
      expect('format' in col1.column).toBe(false)
      // rich_text should be preserved
      expect(col1.column.rich_text).toEqual([{ text: { content: 'left' } }])

      // 2nd column: format has other fields → only column_ratio removed, format retained
      expect(col2.column.format?.column_ratio).toBeUndefined()
      expect(col2.column.format?.block_width).toBe(100)
    })

    it('should not modify non-column blocks', async () => {
      const { markdownToBlocks } = await import('../helpers/markdown.js')
      vi.mocked(markdownToBlocks).mockReturnValueOnce({
        blocks: [
          { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'p1' } }] } },
          { type: 'heading_1', heading_1: { rich_text: [{ text: { content: 'h' } }] } }
        ],
        warnings: []
      } as any)

      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await blocks(mockNotion as any, {
        action: 'append',
        block_id: 'p',
        content: 'x'
      })

      const captured = mockNotion.blocks.children.append.mock.calls[0][0]
      expect(captured.children).toEqual([
        { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'p1' } }] } },
        { type: 'heading_1', heading_1: { rich_text: [{ text: { content: 'h' } }] } }
      ])
    })

    it('should throw when after_block without after_block_id', async () => {
      await expect(
        blocks(mockNotion as any, {
          action: 'append',
          block_id: 'block-1',
          content: 'Missing ID',
          position: 'after_block'
        })
      ).rejects.toThrow('after_block_id required')
    })

    it('should not include position when using default end', async () => {
      mockNotion.blocks.children.append.mockResolvedValue({})

      await blocks(mockNotion as any, {
        action: 'append',
        block_id: 'block-1',
        content: 'Default append'
      })

      const call = mockNotion.blocks.children.append.mock.calls[0][0]
      expect(call.position).toBeUndefined()
    })
  })

  describe('update', () => {
    it('should update paragraph block', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'paragraph',
        has_children: false,
        archived: false,
        paragraph: { rich_text: [] }
      })
      mockNotion.blocks.update.mockResolvedValue({})

      const result = await blocks(mockNotion as any, {
        action: 'update',
        block_id: 'block-1',
        content: 'Updated text'
      })

      expect(result).toEqual({
        action: 'update',
        block_id: 'block-1',
        type: 'paragraph',
        updated: true
      })
      expect(mockNotion.blocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          block_id: 'block-1',
          paragraph: { rich_text: expect.any(Array) }
        })
      )
    })

    it('should update heading block', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'heading_1',
        has_children: false,
        archived: false,
        heading_1: { rich_text: [], color: 'default' }
      })
      mockNotion.blocks.update.mockResolvedValue({})

      const result = await blocks(mockNotion as any, {
        action: 'update',
        block_id: 'block-1',
        content: '# New heading'
      })

      expect(result).toEqual({
        action: 'update',
        block_id: 'block-1',
        type: 'heading_1',
        updated: true
      })
      expect(mockNotion.blocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          block_id: 'block-1',
          heading_1: { rich_text: expect.any(Array) }
        })
      )
    })

    it('should throw for unsupported block type', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'image',
        has_children: false,
        archived: false,
        image: { type: 'external', external: { url: 'https://example.com/img.png' } }
      })

      await expect(
        blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: 'Some text'
        })
      ).rejects.toThrow("Block type 'image' cannot be updated")
    })

    it('should throw without content or properties', async () => {
      await expect(blocks(mockNotion as any, { action: 'update', block_id: 'block-1' })).rejects.toThrow(
        'Provide content (markdown) or properties (direct fields)'
      )
    })

    it('should throw when content type does not match block type', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'paragraph',
        has_children: false,
        archived: false,
        paragraph: { rich_text: [] }
      })

      await expect(
        blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: '# New Heading'
        })
      ).rejects.toThrow('Block type mismatch')
    })

    it('should update to_do block with checked state', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'to_do',
        has_children: false,
        archived: false,
        to_do: { rich_text: [], checked: true }
      })
      mockNotion.blocks.update.mockResolvedValue({})

      const result = await blocks(mockNotion as any, {
        action: 'update',
        block_id: 'block-1',
        content: '- [ ] Updated task'
      })

      expect(result).toEqual({
        action: 'update',
        block_id: 'block-1',
        type: 'to_do',
        updated: true
      })
      expect(mockNotion.blocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          block_id: 'block-1',
          to_do: { rich_text: expect.any(Array), checked: expect.any(Boolean) }
        })
      )
    })

    it('should update code block with language', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'code',
        has_children: false,
        archived: false,
        code: { rich_text: [], language: 'javascript' }
      })
      mockNotion.blocks.update.mockResolvedValue({})

      const result = await blocks(mockNotion as any, {
        action: 'update',
        block_id: 'block-1',
        content: '```javascript\nconst x = 1\n```'
      })

      expect(result).toEqual({
        action: 'update',
        block_id: 'block-1',
        type: 'code',
        updated: true
      })
      expect(mockNotion.blocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          block_id: 'block-1',
          code: { rich_text: expect.any(Array), language: expect.any(String) }
        })
      )
    })

    it('should throw when content given for structural type like table', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'table',
        has_children: true,
        archived: false,
        table: { table_width: 2, has_column_header: false, has_row_header: false }
      })

      // 'plain text' parses to paragraph, not table - so we expect the
      // "use properties" hint since the block is a structural type
      await expect(
        blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: 'plain text content'
        })
      ).rejects.toThrow("Block type 'table' cannot be updated via content")
    })

    it('should throw when content produces no blocks', async () => {
      mockNotion.blocks.retrieve.mockResolvedValue({
        id: 'block-1',
        type: 'paragraph',
        has_children: false,
        archived: false,
        paragraph: { rich_text: [] }
      })

      // Use a single newline - markdownToBlocks returns [] for whitespace-only
      await expect(
        blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: '\n'
        })
      ).rejects.toThrow('Content must produce at least one block')
    })

    // ========== Extended block types (B/C/E groups) ==========

    describe('B group: text-rich blocks via markdown', () => {
      it('should update toggle via markdown', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'toggle',
          has_children: false,
          archived: false,
          toggle: { rich_text: [], color: 'default' }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: '<details><summary>New toggle title</summary></details>'
        })

        expect((result as any).type).toBe('toggle')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            toggle: expect.objectContaining({ rich_text: expect.any(Array) })
          })
        )
      })

      it('should update callout via markdown', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'callout',
          has_children: false,
          archived: false,
          callout: { rich_text: [], icon: { type: 'emoji', emoji: '💡' }, color: 'blue_background' }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: '> [!TIP] Updated callout text'
        })

        expect((result as any).type).toBe('callout')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            callout: expect.objectContaining({ rich_text: expect.any(Array) })
          })
        )
      })

      it('should update template via properties (no markdown syntax for template)', async () => {
        // Template block has no markdown representation - must be updated via properties
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'template',
          has_children: false,
          archived: false,
          template: { rich_text: [] }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { rich_text: [{ type: 'text', text: { content: 'New template body' } }] }
        })

        expect((result as any).type).toBe('template')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            template: { rich_text: expect.any(Array) }
          })
        )
      })

      it('should update heading_2 via properties with color', async () => {
        // Verify heading blocks support properties mode for preserving color
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'heading_2',
          has_children: false,
          archived: false,
          heading_2: { rich_text: [], color: 'red', is_toggleable: false }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { rich_text: [{ type: 'text', text: { content: 'Updated heading' } }], color: 'blue' }
        })

        expect((result as any).type).toBe('heading_2')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            heading_2: expect.objectContaining({ rich_text: expect.any(Array), color: 'blue' })
          })
        )
      })

      it('should update heading_4 via markdown', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'heading_4',
          has_children: false,
          archived: false,
          heading_4: { rich_text: [], color: 'default', is_toggleable: false }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          content: '#### New h4 title'
        })

        expect((result as any).type).toBe('heading_4')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            heading_4: expect.objectContaining({ rich_text: expect.any(Array) })
          })
        )
      })
    })

    describe('C group: structural blocks via properties', () => {
      it('should update table via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'table',
          has_children: true,
          archived: false,
          table: { table_width: 2, has_column_header: false, has_row_header: false }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { has_column_header: true }
        })

        expect((result as any).type).toBe('table')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            table: expect.objectContaining({ has_column_header: true })
          })
        )
      })

      it('should update table_row.cells with string[][]', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'table_row',
          has_children: false,
          archived: false,
          table_row: { cells: [[], []] }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: {
            cells: [
              ['A', 'B'],
              ['C', 'D']
            ]
          }
        })

        expect((result as any).type).toBe('table_row')
        const call = mockNotion.blocks.update.mock.calls[0][0]
        expect(call.table_row.cells).toHaveLength(2)
        expect(call.table_row.cells[0]).toHaveLength(2)
        expect(call.table_row.cells[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]))
      })

      it('should pass through table_row.cells as RichText[][] when not strings', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'table_row',
          has_children: false,
          archived: false,
          table_row: { cells: [[], []] }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const richCells = [
          [{ type: 'text', text: { content: 'A', link: null }, annotations: { bold: true } }],
          [{ type: 'text', text: { content: 'B', link: null }, annotations: { bold: false } }]
        ]

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { cells: richCells }
        })

        expect((result as any).type).toBe('table_row')
        const call = mockNotion.blocks.update.mock.calls[0][0]
        expect(call.table_row.cells).toEqual(richCells) // passed through unchanged
      })

      it('should throw on malformed table_row.cells (not an array of arrays)', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'table_row',
          has_children: false,
          archived: false,
          table_row: { cells: [[], []] }
        })

        await expect(
          blocks(mockNotion as any, {
            action: 'update',
            block_id: 'block-1',
            properties: { cells: 'not an array' }
          })
        ).rejects.toThrow('table_row.properties.cells must be string[][] or RichText[][]')
      })

      it('should update column.width_ratio via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'column',
          has_children: true,
          archived: false,
          column: { width_ratio: 0.5 }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { width_ratio: 0.75 }
        })

        expect((result as any).type).toBe('column')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            column: { width_ratio: 0.75 }
          })
        )
      })

      it('should reject invalid width_ratio', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'column',
          has_children: false,
          archived: false,
          column: { width_ratio: 0.5 }
        })

        await expect(
          blocks(mockNotion as any, {
            action: 'update',
            block_id: 'block-1',
            properties: { width_ratio: 1.5 }
          })
        ).rejects.toThrow('width_ratio must be between 0 and 1')
      })

      it('should update synced_block linking via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'synced_block',
          has_children: false,
          archived: false,
          synced_block: { synced_from: null }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { synced_from: { block_id: 'src-block-id' } }
        })

        expect((result as any).type).toBe('synced_block')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            synced_block: { synced_from: { block_id: 'src-block-id' } }
          })
        )
      })

      it('should update synced_block to unlink via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'synced_block',
          has_children: false,
          archived: false,
          synced_block: { synced_from: { block_id: 'src-block-id', type: 'block_id' } }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { synced_from: null }
        })

        expect((result as any).type).toBe('synced_block')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            synced_block: { synced_from: null }
          })
        )
      })
    })

    describe('E group: link blocks via properties', () => {
      it('should update link_to_page with page_id via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'link_to_page',
          has_children: false,
          archived: false,
          link_to_page: { type: 'page_id', page_id: 'old-page-id' }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { page_id: 'new-page-id-32-chars-aaaaaaaaaa' }
        })

        expect((result as any).type).toBe('link_to_page')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            link_to_page: { page_id: 'new-page-id-32-chars-aaaaaaaaaa' }
          })
        )
      })

      it('should update link_to_page with database_id via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'link_to_page',
          has_children: false,
          archived: false,
          link_to_page: { type: 'database_id', database_id: 'old-db-id' }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { database_id: 'new-db-id-32-chars-bbbbbbbbbbbb' }
        })

        expect((result as any).type).toBe('link_to_page')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            link_to_page: { database_id: 'new-db-id-32-chars-bbbbbbbbbbbb' }
          })
        )
      })

      it('should update link_to_page with comment_id via properties', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'link_to_page',
          has_children: false,
          archived: false,
          link_to_page: { type: 'comment_id', comment_id: 'old-comment-id' }
        })
        mockNotion.blocks.update.mockResolvedValue({})

        const result = await blocks(mockNotion as any, {
          action: 'update',
          block_id: 'block-1',
          properties: { comment_id: 'new-comment-id-32-chars-cccccccccc' }
        })

        expect((result as any).type).toBe('link_to_page')
        expect(mockNotion.blocks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            block_id: 'block-1',
            link_to_page: { comment_id: 'new-comment-id-32-chars-cccccccccc' }
          })
        )
      })

      it('should throw on link_to_page without any target id', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'link_to_page',
          has_children: false,
          archived: false,
          link_to_page: { type: 'page_id', page_id: 'old-page-id' }
        })

        await expect(
          blocks(mockNotion as any, {
            action: 'update',
            block_id: 'block-1',
            properties: {}
          })
        ).rejects.toThrow('link_to_page requires exactly one of')
      })
    })

    describe('error paths', () => {
      it('should throw when both content and properties provided', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'paragraph',
          has_children: false,
          archived: false,
          paragraph: { rich_text: [] }
        })

        await expect(
          blocks(mockNotion as any, {
            action: 'update',
            block_id: 'block-1',
            content: 'something',
            properties: { rich_text: [] }
          })
        ).rejects.toThrow('Provide either content or properties, not both')
      })

      it('should throw when properties given for text-only type', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'paragraph',
          has_children: false,
          archived: false,
          paragraph: { rich_text: [] }
        })

        await expect(
          blocks(mockNotion as any, {
            action: 'update',
            block_id: 'block-1',
            properties: { rich_text: [] }
          })
        ).rejects.toThrow("Block type 'paragraph' cannot be updated via properties")
      })

      it('should throw when properties given for unsupported type', async () => {
        mockNotion.blocks.retrieve.mockResolvedValue({
          id: 'block-1',
          type: 'image',
          has_children: false,
          archived: false,
          image: { type: 'external', external: { url: 'https://example.com/img.png' } }
        })

        await expect(
          blocks(mockNotion as any, {
            action: 'update',
            block_id: 'block-1',
            properties: { url: 'https://new.com/img.png' }
          })
        ).rejects.toThrow("Block type 'image' cannot be updated")
      })
    })
  })

  describe('delete', () => {
    it('should delete block', async () => {
      mockNotion.blocks.delete.mockResolvedValue({})

      const result = await blocks(mockNotion as any, { action: 'delete', block_id: 'block-1' })

      expect(result).toEqual({
        action: 'delete',
        block_id: 'block-1',
        deleted: true
      })
      expect(mockNotion.blocks.delete).toHaveBeenCalledWith({ block_id: 'block-1' })
    })
  })

  describe('default', () => {
    it('should throw on unknown action with closest-match hint', async () => {
      await expect(blocks(mockNotion as any, { action: 'invalid' as any, block_id: 'block-1' })).rejects.toThrow(
        "Unknown action: 'invalid' for blocks."
      )
    })

    it('should suggest closest match for typo in action', async () => {
      // 'appnd' is one typo away from 'append'
      await expect(blocks(mockNotion as any, { action: 'appnd' as any, block_id: 'block-1' })).rejects.toThrow(
        "Did you mean 'append'?"
      )
    })
  })
})
