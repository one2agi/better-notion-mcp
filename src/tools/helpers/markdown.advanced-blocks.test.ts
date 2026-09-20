import { describe, expect, it } from 'vitest'
import type { NotionBlock, RichText } from './markdown.js'
import { blocksToMarkdown, markdownToBlocks } from './markdown.js'

function getRichTextContent(block: NotionBlock): string {
  const key = block.type
  const richText: RichText[] = block[key]?.rich_text ?? []
  return richText.map((rt: RichText) => rt.text?.content ?? rt.plain_text ?? '').join('')
}

describe('Advanced Blocks: Toggle Headings, Columns Safety Guard & Synced Blocks', () => {
  describe('Toggle Headings (折叠标题)', () => {
    it('should parse <details><summary># H1</summary>Content</details> to heading_1 with is_toggleable: true', () => {
      const md = '<details><summary># Heading 1 Toggle</summary>\nParagraph inside\n</details>'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      const block = blocks[0]
      expect(block.type).toBe('heading_1')
      expect(block.heading_1.is_toggleable).toBe(true)
      expect(getRichTextContent(block)).toBe('Heading 1 Toggle')
      expect(block.heading_1.children).toHaveLength(1)
      expect(block.heading_1.children[0].type).toBe('paragraph')
      expect(getRichTextContent(block.heading_1.children[0])).toBe('Paragraph inside')
    })

    it('should parse inline single-line <details><summary># H1</summary>Content</details>', () => {
      const md = '<details><summary># Inline H1</summary>Inline Content</details>'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      const block = blocks[0]
      expect(block.type).toBe('heading_1')
      expect(block.heading_1.is_toggleable).toBe(true)
      expect(getRichTextContent(block)).toBe('Inline H1')
      expect(block.heading_1.children).toHaveLength(1)
      expect(getRichTextContent(block.heading_1.children[0])).toBe('Inline Content')
    })

    it('should parse ## H2 and ### H3 toggle headings with nested children', () => {
      const mdH2 = '<details>\n<summary>## Heading 2 Toggle</summary>\n- Item 1\n- Item 2\n</details>'
      const { blocks: blocksH2 } = markdownToBlocks(mdH2)

      expect(blocksH2).toHaveLength(1)
      const h2Block = blocksH2[0]
      expect(h2Block.type).toBe('heading_2')
      expect(h2Block.heading_2.is_toggleable).toBe(true)
      expect(getRichTextContent(h2Block)).toBe('Heading 2 Toggle')
      expect(h2Block.heading_2.children).toHaveLength(2)
      expect(h2Block.heading_2.children[0].type).toBe('bulleted_list_item')

      const mdH3 = '<details>\n<summary>### Heading 3 Toggle</summary>\nDeep text\n</details>'
      const { blocks: blocksH3 } = markdownToBlocks(mdH3)

      expect(blocksH3).toHaveLength(1)
      const h3Block = blocksH3[0]
      expect(h3Block.type).toBe('heading_3')
      expect(h3Block.heading_3.is_toggleable).toBe(true)
      expect(getRichTextContent(h3Block)).toBe('Heading 3 Toggle')
      expect(h3Block.heading_3.children).toHaveLength(1)
      expect(h3Block.heading_3.children[0].type).toBe('paragraph')
    })

    it('should keep standard toggle when summary has no heading prefix', () => {
      const md = '<details>\n<summary>Normal Toggle</summary>\nNormal content\n</details>'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      const block = blocks[0]
      expect(block.type).toBe('toggle')
      expect(getRichTextContent(block)).toBe('Normal Toggle')
      expect(block.toggle.children).toHaveLength(1)
    })

    it('should serialize heading_1/2/3 (is_toggleable: true) to <details><summary># ... in blocksToMarkdown', () => {
      const blocks: NotionBlock[] = [
        {
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: 'H1 Title', link: null }, annotations: {} as any }],
            color: 'default',
            is_toggleable: true,
            children: [
              {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [
                    { type: 'text', text: { content: 'Child paragraph', link: null }, annotations: {} as any }
                  ],
                  color: 'default'
                }
              }
            ]
          }
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: 'H2 Title', link: null }, annotations: {} as any }],
            color: 'default',
            is_toggleable: true,
            children: []
          }
        },
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: 'H3 Title', link: null }, annotations: {} as any }],
            color: 'default',
            is_toggleable: true,
            children: []
          }
        }
      ]

      const md = blocksToMarkdown(blocks)
      expect(md).toContain('<details>')
      expect(md).toContain('<summary># H1 Title</summary>')
      expect(md).toContain('Child paragraph')
      expect(md).toContain('<summary>## H2 Title</summary>')
      expect(md).toContain('<summary>### H3 Title</summary>')
      expect(md).toContain('</details>')
    })

    it('should round-trip toggle headings through markdownToBlocks and blocksToMarkdown', () => {
      const inputMd = '<details>\n<summary># Architecture Overview</summary>\n\nKey architectural pillars.\n</details>'
      const { blocks } = markdownToBlocks(inputMd)
      const outputMd = blocksToMarkdown(blocks)

      expect(outputMd).toContain('<details>')
      expect(outputMd).toContain('<summary># Architecture Overview</summary>')
      expect(outputMd).toContain('Key architectural pillars.')
      expect(outputMd).toContain('</details>')
    })
  })

  describe('Columns Safety Guard (分栏安全防线)', () => {
    it('should ensure each column has at least 1 child block when column is empty', () => {
      const md = ':::columns\n:::column\n:::column\nRight side\n:::end'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('column_list')
      const columns = blocks[0].column_list.children
      expect(columns).toHaveLength(2)

      // First column was empty, MUST be padded with empty paragraph
      expect(columns[0].column.children).toHaveLength(1)
      expect(columns[0].column.children[0].type).toBe('paragraph')
      expect(columns[0].column.children[0].paragraph.rich_text).toEqual([])

      // Second column has content
      expect(columns[1].column.children).toHaveLength(1)
      expect(columns[1].column.children[0].type).toBe('paragraph')
      expect(getRichTextContent(columns[1].column.children[0])).toBe('Right side')
    })

    it('should auto-pad to at least 2 columns when fewer than 2 columns are parsed', () => {
      const mdSingle = ':::columns\n:::column\nSingle column\n:::end'
      const { blocks } = markdownToBlocks(mdSingle)

      expect(blocks).toHaveLength(1)
      const columns = blocks[0].column_list.children
      expect(columns).toHaveLength(2)

      // Column 1 has content
      expect(columns[0].column.children).toHaveLength(1)
      expect(getRichTextContent(columns[0].column.children[0])).toBe('Single column')

      // Column 2 was auto-created, MUST have 1 fallback paragraph
      expect(columns[1].column.children).toHaveLength(1)
      expect(columns[1].column.children[0].type).toBe('paragraph')
      expect(columns[1].column.children[0].paragraph.rich_text).toEqual([])
    })

    it('should handle zero columns by creating 2 empty padded columns', () => {
      const mdEmpty = ':::columns\n:::end'
      const { blocks } = markdownToBlocks(mdEmpty)

      expect(blocks).toHaveLength(1)
      const columns = blocks[0].column_list.children
      expect(columns).toHaveLength(2)
      expect(columns[0].column.children).toHaveLength(1)
      expect(columns[1].column.children).toHaveLength(1)
    })
  })

  describe('Synced Blocks (同步块)', () => {
    it('should parse original :::synced ... :::end to synced_block with synced_from: null', () => {
      const md = ':::synced\nThis is a synced original block\n:::end'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      const block = blocks[0]
      expect(block.type).toBe('synced_block')
      expect(block.synced_block.synced_from).toBeNull()
      expect(block.synced_block.children).toHaveLength(1)
      expect(block.synced_block.children[0].type).toBe('paragraph')
      expect(getRichTextContent(block.synced_block.children[0])).toBe('This is a synced original block')
    })

    it('should parse multi-block content inside original synced block', () => {
      const md = ':::synced\n# Synced Header\n\n- Synced item 1\n- Synced item 2\n:::end'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      const block = blocks[0]
      expect(block.type).toBe('synced_block')
      expect(block.synced_block.synced_from).toBeNull()
      expect(block.synced_block.children).toHaveLength(3)
      expect(block.synced_block.children[0].type).toBe('heading_1')
      expect(block.synced_block.children[1].type).toBe('bulleted_list_item')
      expect(block.synced_block.children[2].type).toBe('bulleted_list_item')
    })

    it('should parse synced block reference :::synced{from="uuid"}:::', () => {
      const md = ':::synced{from="3de4f4cf-c8e2-80f9-acbd-dff14d6ec10e"}:::'
      const { blocks } = markdownToBlocks(md)

      expect(blocks).toHaveLength(1)
      const block = blocks[0]
      expect(block.type).toBe('synced_block')
      expect(block.synced_block.synced_from).toEqual({
        block_id: '3de4f4cf-c8e2-80f9-acbd-dff14d6ec10e'
      })
      expect(block.synced_block.children).toBeUndefined()
    })

    it('should serialize original synced block in blocksToMarkdown', () => {
      const block: NotionBlock = {
        object: 'block',
        type: 'synced_block',
        synced_block: {
          synced_from: null,
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: 'Reusable notice', link: null }, annotations: {} as any }],
                color: 'default'
              }
            }
          ]
        }
      }

      const md = blocksToMarkdown([block])
      expect(md).toBe(':::synced\nReusable notice\n:::end')
    })

    it('should serialize reference synced block in blocksToMarkdown', () => {
      const block: NotionBlock = {
        object: 'block',
        type: 'synced_block',
        synced_block: {
          synced_from: {
            block_id: 'orig-block-12345'
          }
        }
      }

      const md = blocksToMarkdown([block])
      expect(md).toBe(':::synced{from="orig-block-12345"}:::')
    })

    it('should round-trip original and reference synced blocks', () => {
      const origMd = ':::synced\nOriginal shared note\n:::end'
      const { blocks: origBlocks } = markdownToBlocks(origMd)
      expect(blocksToMarkdown(origBlocks)).toBe(origMd)

      const refMd = ':::synced{from="abc-123-xyz"}:::'
      const { blocks: refBlocks } = markdownToBlocks(refMd)
      expect(blocksToMarkdown(refBlocks)).toBe(refMd)
    })
  })
})
