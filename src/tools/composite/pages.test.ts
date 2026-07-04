import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ArchivePageResult,
  type CreatePageResult,
  type DuplicatePageResult,
  type GetPagePropertyResult,
  type GetPageResult,
  type MovePageResult,
  pages,
  type UpdatePageResult
} from './pages'

vi.mock('../helpers/markdown.js', () => ({
  markdownToBlocks: vi.fn((md: string) => {
    if (!md) return { blocks: [], warnings: [] }
    return {
      blocks: [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: md } }] } }],
      warnings: []
    }
  }),
  blocksToMarkdown: vi.fn((blocks: any[]) => {
    if (!blocks.length) return ''
    return '# Mock markdown'
  })
}))

function createMockNotion() {
  return {
    pages: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      retrieveMarkdown: vi.fn(),
      updateMarkdown: vi.fn(),
      properties: { retrieve: vi.fn() }
    },
    databases: {
      retrieve: vi.fn()
    },
    dataSources: {
      retrieve: vi.fn(),
      query: vi.fn()
    },
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
}

import { resolutionCache, schemaCache } from './databases.js'

let mockNotion: ReturnType<typeof createMockNotion>

describe('pages', () => {
  beforeEach(() => {
    mockNotion = createMockNotion()
    schemaCache.clear()
    resolutionCache.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('creates page with title and page parent', async () => {
      mockNotion.pages.create.mockResolvedValue({ id: 'page-1', url: 'https://notion.so/page-1' })

      const result = (await pages(mockNotion as any, {
        action: 'create',
        title: 'Test Page',
        parent_id: 'parent-1'
      })) as CreatePageResult

      expect(result).toEqual({
        action: 'create',
        page_id: 'page-1',
        url: 'https://notion.so/page-1',
        created: true
      })
      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'page_id', page_id: 'parent1' },
          properties: { title: { title: [expect.objectContaining({ type: 'text' })] } }
        })
      )
    })

    it('creates page with database parent when properties provided', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db123',
        data_sources: [{ id: 'ds-1', name: 'Source 1' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-1',
        properties: {
          Name: { type: 'title', id: 'prop-1' },
          Status: { type: 'select', id: 'prop-2', select: { options: [{ name: 'Active' }] } }
        }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'page-2', url: 'https://notion.so/page-2' })

      const result = (await pages(mockNotion as any, {
        action: 'create',
        title: 'DB Page',
        parent_id: 'db-123',
        properties: { Status: 'Active' }
      })) as CreatePageResult

      expect(result.page_id).toBe('page-2')
      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'database_id', database_id: 'db123' }
        })
      )
    })

    it('sets title on the schema title column when user did not supply one', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db456',
        data_sources: [{ id: 'ds-2', name: 'Source 2' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-2',
        properties: {
          Name: { type: 'title', id: 'prop-1' },
          Priority: { type: 'number', id: 'prop-2' }
        }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'page-3', url: 'https://notion.so/page-3' })

      await pages(mockNotion as any, {
        action: 'create',
        title: 'Named Page',
        parent_id: 'db-456',
        properties: { Priority: { number: 1 } }
      })

      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.properties.Name).toEqual({
        title: [expect.objectContaining({ text: { content: 'Named Page', link: null } })]
      })
    })

    it('handles non-English title column names via schema (no hardcoding)', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db789',
        data_sources: [{ id: 'ds-3', name: 'Source 3' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValue({
        id: 'ds-3',
        properties: {
          名称: { type: 'title', id: 'prop-1' },
          状态: { type: 'select', id: 'prop-2', select: { options: [{ name: '进行中' }] } }
        }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'page-4', url: 'https://notion.so/page-4' })

      const result = (await pages(mockNotion as any, {
        action: 'create',
        title: '中文页面',
        parent_id: 'db-789',
        properties: { 状态: '进行中' }
      })) as CreatePageResult

      expect(result.page_id).toBe('page-4')
      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.properties.名称).toEqual({
        title: [expect.objectContaining({ text: { content: '中文页面', link: null } })]
      })
      expect(callArgs.properties.状态).toEqual({ select: { name: '进行中' } })
      // Should NOT inject a hardcoded "Name" key
      expect(callArgs.properties.Name).toBeUndefined()
    })

    it('drops foreign property keys not present in schema and uses schema title column for input.title', async () => {
      // Bug: schema's title column is "Title" (NOT "Name"). User passes { Name: 'X', Status: 'Active' }
      // The "Name" key is NOT in the schema — it must be dropped, not wrapped as title.
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-fk',
        data_sources: [{ id: 'ds-fk', name: 'Source FK' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-fk',
        properties: {
          Title: { type: 'title', id: 'prop-1' },
          Status: { type: 'select', id: 'prop-2', select: { options: [{ name: 'Active' }] } }
        }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'page-fk', url: 'https://notion.so/page-fk' })

      await pages(mockNotion as any, {
        action: 'create',
        title: 'Real Title',
        parent_id: 'db-fk',
        properties: { Name: 'X', Status: 'Active' }
      })

      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      // Title goes to the schema's actual title column ("Title")
      expect(callArgs.properties.Title).toEqual({
        title: [expect.objectContaining({ text: { content: 'Real Title', link: null } })]
      })
      // Status preserved
      expect(callArgs.properties.Status).toEqual({ select: { name: 'Active' } })
      // Foreign "Name" key dropped — must NOT be sent to Notion
      expect(callArgs.properties.Name).toBeUndefined()
    })

    it('reverse case: schema title column is "Name", user passes { Title: "X" } — drops foreign "Title" key', async () => {
      // Reverse bug: schema's title column is "Name", user wrongly passes { Title: 'X' }
      // The "Title" key is NOT in the schema — it must be dropped, not wrapped as title.
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-rev',
        data_sources: [{ id: 'ds-rev', name: 'Source Rev' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-rev',
        properties: {
          Name: { type: 'title', id: 'prop-1' },
          Status: { type: 'select', id: 'prop-2', select: { options: [{ name: 'Active' }] } }
        }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'page-rev', url: 'https://notion.so/page-rev' })

      await pages(mockNotion as any, {
        action: 'create',
        title: 'Real Title',
        parent_id: 'db-rev',
        properties: { Title: 'X', Status: 'Active' }
      })

      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      // Title goes to the schema's actual title column ("Name")
      expect(callArgs.properties.Name).toEqual({
        title: [expect.objectContaining({ text: { content: 'Real Title', link: null } })]
      })
      // Status preserved
      expect(callArgs.properties.Status).toEqual({ select: { name: 'Active' } })
      // Foreign "Title" key dropped — must NOT be sent to Notion
      expect(callArgs.properties.Title).toBeUndefined()
    })

    it('falls back to page_id when parent is not a database (object_not_found) even with properties', async () => {
      // ID doesn't resolve to a database — expected fallback for plain page parents.
      mockNotion.databases.retrieve.mockRejectedValueOnce(
        Object.assign(new Error('Not found'), { code: 'object_not_found' })
      )
      mockNotion.pages.create.mockResolvedValue({ id: 'page-fallback', url: 'https://notion.so/page-fallback' })

      const result = (await pages(mockNotion as any, {
        action: 'create',
        title: 'Fallback Page',
        parent_id: 'not-a-database',
        properties: { Status: 'Active' }
      })) as CreatePageResult

      // Plain page parent — schema was not loaded, properties are dropped (Notion will reject them anyway).
      // The fallback is acceptable here because the ID clearly wasn't a database.
      expect(result.page_id).toBe('page-fallback')
      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.parent).toEqual({ type: 'page_id', page_id: 'notadatabase' })
    })

    it('rethrows resolution errors when user supplied database properties (no silent data loss)', async () => {
      // Real bug case: database ID with permissions error, but user passed properties.
      // Must NOT silently fallback to page_id and lose the data.
      mockNotion.databases.retrieve.mockRejectedValueOnce(
        Object.assign(new Error('Insufficient permissions'), { code: 'unauthorized' })
      )

      await expect(
        pages(mockNotion as any, {
          action: 'create',
          title: 'Will Fail',
          parent_id: 'db-with-permission-issue',
          properties: { Status: 'Active' }
        })
      ).rejects.toThrow()

      // Critical: pages.create must NOT have been called — otherwise data would be silently lost.
      expect(mockNotion.pages.create).not.toHaveBeenCalled()
    })

    it('falls back to page_id when resolution fails but no properties supplied (preserves title-only path)', async () => {
      // API error but user only wants a plain page with a title — fallback is acceptable.
      mockNotion.databases.retrieve.mockRejectedValueOnce(
        Object.assign(new Error('Transient API error'), { code: 'service_unavailable' })
      )
      mockNotion.pages.create.mockResolvedValue({ id: 'page-no-props', url: 'https://notion.so/page-no-props' })

      const result = (await pages(mockNotion as any, {
        action: 'create',
        title: 'Title Only',
        parent_id: 'unresolvable-id'
      })) as CreatePageResult

      expect(result.page_id).toBe('page-no-props')
      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.parent).toEqual({ type: 'page_id', page_id: 'unresolvableid' })
      // Verify the title-bearing rich text was sent (annotations are added by RichText helper, not asserted).
      expect(callArgs.properties.title.title[0].text.content).toBe('Title Only')
    })

    it('creates page with content blocks', async () => {
      mockNotion.pages.create.mockResolvedValue({ id: 'page-4', url: 'https://notion.so/page-4' })
      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await pages(mockNotion as any, {
        action: 'create',
        title: 'Content Page',
        parent_id: 'parent-1',
        content: '# Hello World'
      })

      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'page-4',
        children: expect.any(Array)
      })
    })

    it('creates page with icon and cover', async () => {
      mockNotion.pages.create.mockResolvedValue({ id: 'page-5', url: 'https://notion.so/page-5' })

      await pages(mockNotion as any, {
        action: 'create',
        title: 'Styled Page',
        parent_id: 'parent-1',
        icon: '🚀',
        cover: 'https://example.com/cover.jpg'
      })

      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.icon).toEqual({ type: 'emoji', emoji: '🚀' })
      expect(callArgs.cover).toEqual({ type: 'external', external: { url: 'https://example.com/cover.jpg' } })
    })

    it('does not append blocks when content is falsy', async () => {
      mockNotion.pages.create.mockResolvedValue({ id: 'page-6', url: 'https://notion.so/page-6' })

      await pages(mockNotion as any, {
        action: 'create',
        title: 'Empty Content',
        parent_id: 'parent-1',
        content: ''
      })

      expect(mockNotion.blocks.children.append).not.toHaveBeenCalled()
    })

    it('throws without title', async () => {
      await expect(pages(mockNotion as any, { action: 'create', parent_id: 'parent-1' })).rejects.toThrow(
        'title is required'
      )
    })

    it('throws without parent_id', async () => {
      await expect(pages(mockNotion as any, { action: 'create', title: 'No Parent' })).rejects.toThrow(
        'parent_id is required'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------
  describe('get', () => {
    it('returns page with markdown content and properties', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'page-1',
        url: 'https://notion.so/page-1',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-02T00:00:00.000Z',
        archived: false,
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Test' }] }
        }
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [{ id: 'block-1', type: 'paragraph' }],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, { action: 'get', page_id: 'page-1' })) as GetPageResult

      expect(result).toEqual({
        action: 'get',
        page_id: 'page-1',
        url: 'https://notion.so/page-1',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-02T00:00:00.000Z',
        archived: false,
        icon: null,
        cover: null,
        properties: { Name: 'Test' },
        content: '# Mock markdown',
        block_count: 1
      })
    })

    it('handles pages with no blocks', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'page-2',
        url: 'https://notion.so/page-2',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        archived: false,
        properties: {}
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, { action: 'get', page_id: 'page-2' })) as GetPageResult

      expect(result.block_count).toBe(0)
      expect(result.properties).toEqual({})
    })

    it('extracts all property types correctly', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'page-3',
        url: 'https://notion.so/page-3',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        archived: false,
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Hello' }, { plain_text: ' World' }] },
          Description: { type: 'rich_text', rich_text: [{ plain_text: 'A ' }, { plain_text: 'description' }] },
          Category: { type: 'select', select: { name: 'Engineering' } },
          Tags: { type: 'multi_select', multi_select: [{ name: 'urgent' }, { name: 'bug' }] },
          Count: { type: 'number', number: 42 },
          Done: { type: 'checkbox', checkbox: true },
          Website: { type: 'url', url: 'https://example.com' },
          Email: { type: 'email', email: 'test@example.com' },
          Phone: { type: 'phone_number', phone_number: '+1234567890' },
          DueDate: { type: 'date', date: { start: '2024-01-15', end: '2024-01-20' } },
          DateOnly: { type: 'date', date: { start: '2024-06-01', end: null } },
          Related: { type: 'relation', relation: [{ id: 'rel-1' }, { id: 'rel-2' }] },
          Summary: { type: 'rollup', rollup: { type: 'number', number: 100 } },
          Assignees: { type: 'people', people: [{ name: 'Alice', id: 'u-1' }, { id: 'u-2' }] },
          Attachments: {
            type: 'files',
            files: [
              { name: 'doc.pdf', file: { url: 'https://s3.example.com/doc.pdf' } },
              { name: 'link.txt', external: { url: 'https://example.com/link.txt' } },
              { name: 'bare.txt' }
            ]
          },
          Computed: { type: 'formula', formula: { type: 'string', string: 'computed-value' } },
          Created: { type: 'created_time', created_time: '2024-01-01T00:00:00.000Z' },
          Edited: { type: 'last_edited_time', last_edited_time: '2024-01-02T00:00:00.000Z' },
          CreatedBy: { type: 'created_by', created_by: { name: 'Bob', id: 'u-3' } },
          EditedBy: { type: 'last_edited_by', last_edited_by: { id: 'u-4' } },
          Status: { type: 'status', status: { name: 'In Progress' } },
          TaskID: { type: 'unique_id', unique_id: { prefix: 'TASK', number: 42 } },
          PlainID: { type: 'unique_id', unique_id: { prefix: null, number: 7 } }
        }
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, { action: 'get', page_id: 'page-3' })) as GetPageResult
      const p = result.properties

      expect(p.Name).toBe('Hello World')
      expect(p.Description).toBe('A description')
      expect(p.Category).toBe('Engineering')
      expect(p.Tags).toEqual(['urgent', 'bug'])
      expect(p.Count).toBe(42)
      expect(p.Done).toBe(true)
      expect(p.Website).toBe('https://example.com')
      expect(p.Email).toBe('test@example.com')
      expect(p.Phone).toBe('+1234567890')
      expect(p.DueDate).toBe('2024-01-15 to 2024-01-20')
      expect(p.DateOnly).toBe('2024-06-01')
      expect(p.Related).toEqual(['rel-1', 'rel-2'])
      expect(p.Summary).toEqual({ type: 'number', number: 100 })
      expect(p.Assignees).toEqual(['Alice', 'u-2'])
      expect(p.Attachments).toEqual(['https://s3.example.com/doc.pdf', 'https://example.com/link.txt', 'bare.txt'])
      expect(p.Computed).toBe('computed-value')
      expect(p.Created).toBe('2024-01-01T00:00:00.000Z')
      expect(p.Edited).toBe('2024-01-02T00:00:00.000Z')
      expect(p.CreatedBy).toBe('Bob')
      expect(p.EditedBy).toBe('u-4')
      expect(p.Status).toBe('In Progress')
      expect(p.TaskID).toBe('TASK-42')
      expect(p.PlainID).toBe(7)
    })

    it('auto-paginates blocks across multiple pages', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'page-4',
        url: 'https://notion.so/page-4',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        archived: false,
        properties: {}
      })
      mockNotion.blocks.children.list
        .mockResolvedValueOnce({
          results: [{ id: 'b-1', type: 'paragraph' }],
          next_cursor: 'cursor-2',
          has_more: true
        })
        .mockResolvedValueOnce({
          results: [{ id: 'b-2', type: 'paragraph' }],
          next_cursor: null,
          has_more: false
        })

      const result = (await pages(mockNotion as any, { action: 'get', page_id: 'page-4' })) as GetPageResult

      expect(result.block_count).toBe(2)
      expect(mockNotion.blocks.children.list).toHaveBeenCalledTimes(2)
    })

    it('throws without page_id', async () => {
      await expect(pages(mockNotion as any, { action: 'get' })).rejects.toThrow('page_id is required')
    })
  })

  // ---------------------------------------------------------------------------
  // get_property
  // ---------------------------------------------------------------------------
  describe('get_property', () => {
    it('returns paginated title joining text', async () => {
      mockNotion.pages.properties.retrieve.mockResolvedValue({
        results: [
          { type: 'title', title: { plain_text: 'Hello' } },
          { type: 'title', title: { plain_text: ' World' } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'title'
      })) as GetPagePropertyResult

      expect(result).toEqual({
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'title',
        type: 'title',
        value: 'Hello World'
      })
    })

    it('returns paginated rich_text joining text', async () => {
      mockNotion.pages.properties.retrieve.mockResolvedValue({
        results: [
          { type: 'rich_text', rich_text: { plain_text: 'First ' } },
          { type: 'rich_text', rich_text: { plain_text: 'Second' } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'desc'
      })) as GetPagePropertyResult

      expect(result.type).toBe('rich_text')
      expect(result.value).toBe('First Second')
    })

    it('returns relation IDs', async () => {
      mockNotion.pages.properties.retrieve.mockResolvedValue({
        results: [
          { type: 'relation', relation: { id: 'rel-a' } },
          { type: 'relation', relation: { id: 'rel-b' } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'related'
      })) as GetPagePropertyResult

      expect(result.type).toBe('relation')
      expect(result.value).toEqual(['rel-a', 'rel-b'])
    })

    it('returns people with id and name', async () => {
      mockNotion.pages.properties.retrieve.mockResolvedValue({
        results: [
          { type: 'people', people: { id: 'u-1', name: 'Alice' } },
          { type: 'people', people: { id: 'u-2', name: 'Bob' } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'assignees'
      })) as GetPagePropertyResult

      expect(result.type).toBe('people')
      expect(result.value).toEqual([
        { id: 'u-1', name: 'Alice' },
        { id: 'u-2', name: 'Bob' }
      ])
    })

    it('returns rollup value from first result', async () => {
      mockNotion.pages.properties.retrieve.mockResolvedValue({
        results: [{ type: 'rollup', rollup: { type: 'number', number: 99, function: 'sum' } }],
        next_cursor: null,
        has_more: false
      })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'total'
      })) as GetPagePropertyResult

      expect(result.type).toBe('rollup')
      expect(result.value).toEqual({ type: 'number', number: 99, function: 'sum' })
    })

    it('returns non-paginated property as raw value', async () => {
      // Non-paginated responses have no results array
      mockNotion.pages.properties.retrieve.mockResolvedValue({
        type: 'number',
        number: 42
      })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'count'
      })) as GetPagePropertyResult

      expect(result.type).toBe('number')
      expect(result.value).toBe(42)
    })

    it('auto-paginates across multiple pages', async () => {
      mockNotion.pages.properties.retrieve
        .mockResolvedValueOnce({
          results: [{ type: 'relation', relation: { id: 'r-1' } }],
          next_cursor: 'cursor-2',
          has_more: true
        })
        .mockResolvedValueOnce({
          results: [{ type: 'relation', relation: { id: 'r-2' } }],
          next_cursor: null,
          has_more: false
        })

      const result = (await pages(mockNotion as any, {
        action: 'get_property',
        page_id: 'page-1',
        property_id: 'refs'
      })) as GetPagePropertyResult

      expect(result.value).toEqual(['r-1', 'r-2'])
      expect(mockNotion.pages.properties.retrieve).toHaveBeenCalledTimes(2)
    })

    it('throws without page_id', async () => {
      await expect(pages(mockNotion as any, { action: 'get_property', property_id: 'prop-1' })).rejects.toThrow(
        'page_id is required'
      )
    })

    it('throws without property_id', async () => {
      await expect(pages(mockNotion as any, { action: 'get_property', page_id: 'page-1' })).rejects.toThrow(
        'property_id is required'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('updates metadata with icon and cover', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      const result = (await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        icon: '📝',
        cover: 'https://example.com/banner.jpg'
      })) as UpdatePageResult

      expect(result).toEqual({ action: 'update', page_id: 'page-1', updated: true })
      expect(mockNotion.pages.update).toHaveBeenCalledWith({
        page_id: 'page-1',
        icon: { type: 'emoji', emoji: '📝' },
        cover: { type: 'external', external: { url: 'https://example.com/banner.jpg' } }
      })
    })

    it('updates archived status', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        archived: true
      })

      expect(mockNotion.pages.update).toHaveBeenCalledWith({
        page_id: 'page-1',
        archived: true
      })
    })

    it('updates title property', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        title: 'New Title'
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties.title).toEqual({
        title: [expect.objectContaining({ text: { content: 'New Title', link: null } })]
      })
    })

    it('updates custom properties via convertToNotionProperties', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        properties: { Status: { select: { name: 'Done' } } }
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties.Status).toEqual({ select: { name: 'Done' } })
    })

    // Bug #35 (NEW from differential test on 任务管理器 DB 2026-07-04):
    // pages.update calls convertToNotionProperties but NEVER sanitizes readonly
    // types. If user supplies a readonly field (created_time, formula, rollup,
    // button, verification, unique_id, created_by, last_edited_by), Notion API
    // returns 400. Must call sanitizeReadonlyProperties on the converted input.
    it('replicates official: pages.update strips read-only property types (Bug #35)', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        properties: {
          // Writable -- preserved
          Status: { select: { name: 'Done' } },
          // 9 readonly types -- must all be dropped before forwarding to Notion API
          CreatedTime: { created_time: '2020-01-01T00:00:00Z' },
          EditedTime: { last_edited_time: '2020-01-02T00:00:00Z' },
          CreatedBy: { created_by: { id: 'u-1' } },
          EditedBy: { last_edited_by: { id: 'u-1' } },
          UID: { unique_id: { prefix: 'TASK', number: 1 } },
          Formula: { formula: { type: 'number', number: 42 } },
          Rollup: { rollup: { type: 'number', number: 7 } },
          Verify: { verification: {} },
          Button: { button: null }
        }
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties).toEqual({
        Status: { select: { name: 'Done' } }
      })
    })

    it('uses schema title column when database title is not named "title" (no hardcoding)', async () => {
      // Page in a database whose title column is "Subject" (not "title").
      // Current code hardcodes `properties.title` which would 400 in real Notion.
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-1',
        parent: { type: 'database_id', database_id: 'db-subj' }
      })
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-subj',
        data_sources: [{ id: 'ds-subj', name: 'Subjects DB' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-subj',
        properties: {
          Subject: { type: 'title', id: 'prop-1' },
          Body: { type: 'rich_text', id: 'prop-2' }
        }
      })
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        title: 'New Subject'
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      // The schema's actual title column must hold the title, NOT a hardcoded "title" key.
      expect(callArgs.properties.Subject).toEqual({
        title: [expect.objectContaining({ text: { content: 'New Subject', link: null } })]
      })
      expect(callArgs.properties.title).toBeUndefined()
    })

    it('falls back to literal "title" key for page-only parent (no schema fetch)', async () => {
      // Page whose parent is another page (not a database). Schema fetch must
      // be skipped — Notion accepts the literal "title" key for non-DB parents.
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-1',
        parent: { type: 'page_id', page_id: 'other-page' }
      })
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        title: 'Renamed'
      })

      expect(mockNotion.databases.retrieve).not.toHaveBeenCalled()
      expect(mockNotion.dataSources.retrieve).not.toHaveBeenCalled()
      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties.title).toEqual({
        title: [expect.objectContaining({ text: { content: 'Renamed', link: null } })]
      })
    })

    it('falls back to literal "title" key for workspace-level parent (no schema fetch)', async () => {
      // Workspace-root pages have no schema. Same fallback path as page-only parent.
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-1',
        parent: { type: 'workspace', workspace: true }
      })
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        title: 'Workspace Title'
      })

      expect(mockNotion.databases.retrieve).not.toHaveBeenCalled()
      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties.title).toEqual({
        title: [expect.objectContaining({ text: { content: 'Workspace Title', link: null } })]
      })
    })

    it('falls back to literal "title" key when pages.retrieve fails (graceful degradation)', async () => {
      // pages.retrieve throws (e.g. permission, transient network error).
      // The schema resolution is wrapped in try/catch and falls back to the
      // pre-fix default of literal "title" — update must not fail.
      mockNotion.pages.retrieve.mockRejectedValueOnce(
        Object.assign(new Error('Unauthorized'), { code: 'unauthorized' })
      )
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        title: 'Survives Lookup Failure'
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties.title).toEqual({
        title: [expect.objectContaining({ text: { content: 'Survives Lookup Failure', link: null } })]
      })
    })

    it('Fix 3 + Fix 5 roundtrip: create with custom title column, then update by title', async () => {
      // Integration: a page created in a database whose title column is "Subject"
      // must round-trip correctly through create → update. Both actions use the
      // same schema-aware title column resolution; this verifies no drift.
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-subj',
        data_sources: [{ id: 'ds-subj', name: 'Subjects DB' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-subj',
        properties: {
          Subject: { type: 'title', id: 'prop-1' },
          Body: { type: 'rich_text', id: 'prop-2' }
        }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'new-page', url: 'https://notion.so/new-page' })

      // CREATE
      await pages(mockNotion as any, {
        action: 'create',
        title: 'Initial Subject',
        parent_id: 'db-subj'
      })
      const createArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(createArgs.properties.Subject).toEqual({
        title: [expect.objectContaining({ text: { content: 'Initial Subject', link: null } })]
      })

      // UPDATE — schema cache will be hit, so no additional retrieve mocks needed.
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'new-page',
        parent: { type: 'database_id', database_id: 'db-subj' }
      })
      mockNotion.pages.update.mockResolvedValue({ id: 'new-page' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'new-page',
        title: 'Renamed Subject'
      })
      const updateArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(updateArgs.properties.Subject).toEqual({
        title: [expect.objectContaining({ text: { content: 'Renamed Subject', link: null } })]
      })
      expect(updateArgs.properties.title).toBeUndefined()
    })

    it('replaces content by deleting old blocks and appending new when replace is true', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })
      mockNotion.blocks.children.list
        .mockResolvedValueOnce({
          results: [{ id: 'old-block-1' }, { id: 'old-block-2' }],
          next_cursor: 'cursor-2',
          has_more: true
        })
        .mockResolvedValueOnce({
          results: [],
          next_cursor: null,
          has_more: false
        })
      mockNotion.blocks.delete.mockResolvedValue({})
      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        title: 'Updated',
        content: '# New Content',
        replace: true
      })

      expect(mockNotion.blocks.delete).toHaveBeenCalledWith({ block_id: 'old-block-1' })
      expect(mockNotion.blocks.delete).toHaveBeenCalledWith({ block_id: 'old-block-2' })
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'page-1',
        children: expect.any(Array)
      })
    })

    it('appends content when content is provided but replace is false/missing', async () => {
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })
      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        content: '# Appended Content'
      })

      expect(mockNotion.blocks.delete).not.toHaveBeenCalled()
      expect(mockNotion.blocks.children.list).not.toHaveBeenCalled()
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'page-1',
        children: expect.any(Array)
      })
    })

    it('appends content without deleting existing blocks', async () => {
      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        append_content: '## Appended Section'
      })

      expect(mockNotion.blocks.delete).not.toHaveBeenCalled()
      expect(mockNotion.blocks.children.list).not.toHaveBeenCalled()
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'page-1',
        children: expect.any(Array)
      })
    })

    // Boundary case (Issue 1): replace=true with empty content should still clear the page
    it('clears all existing blocks when replace=true and content is empty string', async () => {
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }],
        next_cursor: null,
        has_more: false
      })
      mockNotion.blocks.delete.mockResolvedValue({})

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        content: '',
        replace: true
      })

      expect(mockNotion.blocks.delete).toHaveBeenCalledTimes(3)
      expect(mockNotion.blocks.children.append).not.toHaveBeenCalled()
    })

    it('clears all existing blocks when replace=true and content field is omitted', async () => {
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [{ id: 'old-1' }, { id: 'old-2' }],
        next_cursor: null,
        has_more: false
      })
      mockNotion.blocks.delete.mockResolvedValue({})

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        replace: true
      })

      expect(mockNotion.blocks.delete).toHaveBeenCalledTimes(2)
      expect(mockNotion.blocks.children.append).not.toHaveBeenCalled()
    })

    it('skips pages.update when only content changes', async () => {
      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        append_content: 'More text'
      })

      expect(mockNotion.pages.update).not.toHaveBeenCalled()
    })

    it('throws without page_id', async () => {
      await expect(pages(mockNotion as any, { action: 'update', title: 'Oops' })).rejects.toThrow('page_id is required')
    })
  })

  describe('update (reverse tests for official MCP behavior)', () => {
    it('status field accepts plain string per official MCP contract', async () => {
      // Official MCP accepts `{ 任务状态: '进行中' }` (simple string).
      // This contract: pages.update should also accept simple string for status.
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-1',
        parent: { type: 'database_id', database_id: 'db-task' }
      })
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-task',
        data_sources: [{ id: 'ds-task', name: 'Tasks' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-task',
        properties: {
          Name: { type: 'title', id: 'p1' },
          任务状态: { type: 'status', id: 'p2' }
        }
      })
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        properties: { 任务状态: '进行中' }
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      // Schema-aware: status-type field → status wrapper
      expect(callArgs.properties['任务状态']).toEqual({ status: { name: '进行中' } })
    })

    it('select field accepts plain string per official MCP contract', async () => {
      // Same as status but for select type
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-1',
        parent: { type: 'database_id', database_id: 'db-sel' }
      })
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-sel',
        data_sources: [{ id: 'ds-sel', name: 'DB' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-sel',
        properties: {
          Name: { type: 'title', id: 'p1' },
          Status: { type: 'select', id: 'p2', select: { options: [] } }
        }
      })
      mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

      await pages(mockNotion as any, {
        action: 'update',
        page_id: 'page-1',
        properties: { Status: 'Active' }
      })

      const callArgs = mockNotion.pages.update.mock.calls[0][0]
      expect(callArgs.properties.Status).toEqual({ select: { name: 'Active' } })
    })
  })

  // ---------------------------------------------------------------------------
  // move
  // ---------------------------------------------------------------------------
  describe('move', () => {
    it('moves page to new parent', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await pages(mockNotion as any, {
        action: 'move',
        page_id: 'page-1',
        parent_id: 'newparent123'
      })) as MovePageResult

      expect(result).toEqual({
        action: 'move',
        page_id: 'page-1',
        new_parent_id: 'newparent123',
        moved: true
      })
      expect(mockNotion.pages.update).toHaveBeenCalledWith({
        page_id: 'page-1',
        parent: { type: 'page_id', page_id: 'newparent123' }
      })
    })

    it('normalizes parent_id by removing dashes', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await pages(mockNotion as any, {
        action: 'move',
        page_id: 'page-1',
        parent_id: 'abc-def-123-456'
      })) as MovePageResult

      expect(result.new_parent_id).toBe('abcdef123456')
      expect(mockNotion.pages.update).toHaveBeenCalledWith({
        page_id: 'page-1',
        parent: { type: 'page_id', page_id: 'abcdef123456' }
      })
    })

    it('throws without page_id', async () => {
      await expect(pages(mockNotion as any, { action: 'move', parent_id: 'target' })).rejects.toThrow(
        'page_id is required'
      )
    })

    it('throws without parent_id', async () => {
      await expect(pages(mockNotion as any, { action: 'move', page_id: 'page-1' })).rejects.toThrow(
        'parent_id is required'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // archive / restore
  // ---------------------------------------------------------------------------
  describe('archive', () => {
    it('archives multiple pages', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await pages(mockNotion as any, {
        action: 'archive',
        page_ids: ['page-1', 'page-2', 'page-3']
      })) as ArchivePageResult

      expect(result.action).toBe('archive')
      expect(result.processed).toBe(3)
      expect(result.results).toEqual([
        { page_id: 'page-1', archived: true },
        { page_id: 'page-2', archived: true },
        { page_id: 'page-3', archived: true }
      ])
      expect(mockNotion.pages.update).toHaveBeenCalledTimes(3)
      expect(mockNotion.pages.update).toHaveBeenCalledWith({ page_id: 'page-1', archived: true })
    })

    it('archives single page via page_id', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await pages(mockNotion as any, {
        action: 'archive',
        page_id: 'page-solo'
      })) as ArchivePageResult

      expect(result.processed).toBe(1)
      expect(result.results).toEqual([{ page_id: 'page-solo', archived: true }])
    })

    it('throws without page_id or page_ids', async () => {
      await expect(pages(mockNotion as any, { action: 'archive' })).rejects.toThrow('page_id or page_ids required')
    })
  })

  describe('restore', () => {
    it('restores single page', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await pages(mockNotion as any, {
        action: 'restore',
        page_id: 'page-archived'
      })) as ArchivePageResult

      expect(result.action).toBe('restore')
      expect(result.processed).toBe(1)
      expect(result.results).toEqual([{ page_id: 'page-archived', archived: false }])
      expect(mockNotion.pages.update).toHaveBeenCalledWith({ page_id: 'page-archived', archived: false })
    })

    it('restores multiple pages via page_ids', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await pages(mockNotion as any, {
        action: 'restore',
        page_ids: ['page-a', 'page-b']
      })) as ArchivePageResult

      expect(result.processed).toBe(2)
      for (const r of result.results) {
        expect(r.archived).toBe(false)
      }
    })

    it('throws without page_id or page_ids', async () => {
      await expect(pages(mockNotion as any, { action: 'restore' })).rejects.toThrow('page_id or page_ids required')
    })
  })

  // ---------------------------------------------------------------------------
  // duplicate
  // ---------------------------------------------------------------------------
  describe('duplicate', () => {
    it('duplicates page with content', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'orig-1',
        parent: { type: 'page_id', page_id: 'parent-1' },
        properties: { title: { title: [{ plain_text: 'Original' }] } },
        icon: { type: 'emoji', emoji: '📄' },
        cover: null
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [{ id: 'block-1', type: 'paragraph' }],
        next_cursor: null,
        has_more: false
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-1',
        url: 'https://notion.so/dup-1'
      })
      mockNotion.blocks.children.append.mockResolvedValue({ results: [] })

      const result = (await pages(mockNotion as any, {
        action: 'duplicate',
        page_id: 'orig-1'
      })) as DuplicatePageResult

      expect(result).toEqual({
        action: 'duplicate',
        processed: 1,
        results: [
          {
            original_id: 'orig-1',
            duplicate_id: 'dup-1',
            url: 'https://notion.so/dup-1'
          }
        ]
      })
      expect(mockNotion.pages.create).toHaveBeenCalledWith({
        parent: { type: 'page_id', page_id: 'parent-1' },
        properties: { title: { title: [{ plain_text: 'Original' }] } },
        icon: { type: 'emoji', emoji: '📄' },
        cover: null
      })
      expect(mockNotion.blocks.children.append).toHaveBeenCalledWith({
        block_id: 'dup-1',
        children: [{ type: 'paragraph' }]
      })
    })

    it('skips block append when original has no blocks', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'orig-2',
        parent: { type: 'page_id', page_id: 'parent-1' },
        properties: {},
        icon: null,
        cover: null
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-2',
        url: 'https://notion.so/dup-2'
      })

      await pages(mockNotion as any, { action: 'duplicate', page_id: 'orig-2' })

      expect(mockNotion.blocks.children.append).not.toHaveBeenCalled()
    })

    it('handles data_source_id parent type', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'orig-3',
        parent: { type: 'data_source_id', data_source_id: 'ds-1', extra_field: 'ignored' },
        properties: {},
        icon: null,
        cover: null
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-3',
        url: 'https://notion.so/dup-3'
      })

      await pages(mockNotion as any, { action: 'duplicate', page_id: 'orig-3' })

      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'data_source_id', data_source_id: 'ds-1' }
        })
      )
    })

    it('handles database_id parent type', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'orig-4',
        parent: { type: 'database_id', database_id: 'db-1' },
        properties: {},
        icon: null,
        cover: null
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-4',
        url: 'https://notion.so/dup-4'
      })

      await pages(mockNotion as any, { action: 'duplicate', page_id: 'orig-4' })

      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'database_id', database_id: 'db-1' }
        })
      )
    })

    it('strips readonly property types (formula, rollup, created_time, last_edited_time, created_by, last_edited_by, unique_id) when duplicating', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'orig-ro',
        parent: { type: 'page_id', page_id: 'parent-1' },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Task' }] },
          Status: { type: 'select', select: { name: 'Open' } },
          CreatedAt: { type: 'created_time', created_time: '2026-01-01T00:00:00.000Z' },
          EditedAt: { type: 'last_edited_time', last_edited_time: '2026-01-02T00:00:00.000Z' },
          Author: { type: 'created_by', created_by: { id: 'user-1' } },
          LastEditor: { type: 'last_edited_by', last_edited_by: { id: 'user-2' } },
          UID: { type: 'unique_id', unique_id: { number: 42, prefix: 'T' } }
        },
        icon: null,
        cover: null
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-ro',
        url: 'https://notion.so/dup-ro'
      })

      await pages(mockNotion as any, { action: 'duplicate', page_id: 'orig-ro' })

      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.properties).toHaveProperty('Name')
      expect(callArgs.properties).toHaveProperty('Status')
      expect(callArgs.properties).not.toHaveProperty('CreatedAt')
      expect(callArgs.properties).not.toHaveProperty('EditedAt')
      expect(callArgs.properties).not.toHaveProperty('Author')
      expect(callArgs.properties).not.toHaveProperty('LastEditor')
      expect(callArgs.properties).not.toHaveProperty('UID')
    })

    it('duplicates multiple pages via page_ids', async () => {
      mockNotion.pages.retrieve.mockResolvedValue({
        id: 'any',
        parent: { type: 'page_id', page_id: 'p-1' },
        properties: {},
        icon: null,
        cover: null
      })
      mockNotion.blocks.children.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })
      mockNotion.pages.create
        .mockResolvedValueOnce({ id: 'dup-a', url: 'https://notion.so/dup-a' })
        .mockResolvedValueOnce({ id: 'dup-b', url: 'https://notion.so/dup-b' })

      const result = (await pages(mockNotion as any, {
        action: 'duplicate',
        page_ids: ['orig-a', 'orig-b']
      })) as DuplicatePageResult

      expect(result.processed).toBe(2)
      expect(result.results).toHaveLength(2)
    })

    it('throws without page_id or page_ids', async () => {
      await expect(pages(mockNotion as any, { action: 'duplicate' })).rejects.toThrow('page_id or page_ids required')
    })
  })

  describe('duplicate (reverse tests for official MCP behavior)', () => {
    it('replicates official: duplicate page with empty relation property succeeds', async () => {
      // Notion API rejects `relation: []` — must filter out empty relations
      const originalPage = {
        id: 'src-page',
        parent: { type: 'database_id', database_id: 'db-1' },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'X' }] },
          EmptyRel: { type: 'relation', relation: [] }, // drop
          NonEmptyRel: { type: 'relation', relation: [{ id: 'a' }] } // keep
        }
      }
      mockNotion.pages.retrieve.mockResolvedValue(originalPage)
      mockNotion.databases.retrieve.mockRejectedValue(new Error('not used'))
      mockNotion.blocks.children.list.mockResolvedValue({ results: [], next_cursor: null })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-page',
        url: 'https://notion.so/dup-page'
      })

      const result = (await pages(mockNotion as any, {
        action: 'duplicate',
        page_id: 'src-page'
      })) as any

      expect(result.results[0].duplicate_id).toBe('dup-page')
      const createArgs = mockNotion.pages.create.mock.calls[0][0]
      // EmptyRel should be filtered out
      expect(createArgs.properties).not.toHaveProperty('EmptyRel')
      // Non-empty preserved (Bug #7 strips top-level `type`)
      expect(createArgs.properties.NonEmptyRel).toEqual({ relation: [{ id: 'a' }] })
    })

    it('replicates official: duplicate page with omitted (no value) property succeeds', async () => {
      // Notion returns properties without value fields for server-managed or unset
      const originalPage = {
        id: 'src-page',
        parent: { type: 'database_id', database_id: 'db-1' },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'X' }] },
          OmittedField: { type: 'select' }, // no select field — omitted by Notion
          FormulaField: { type: 'formula', formula: { type: 'number', number: 42 } }
        }
      }
      mockNotion.pages.retrieve.mockResolvedValue(originalPage)
      mockNotion.databases.retrieve.mockRejectedValue(new Error('not used'))
      mockNotion.blocks.children.list.mockResolvedValue({ results: [], next_cursor: null })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-page',
        url: 'https://notion.so/dup-page'
      })

      const result = (await pages(mockNotion as any, {
        action: 'duplicate',
        page_id: 'src-page'
      })) as any

      expect(result.results[0].duplicate_id).toBe('dup-page')
      const createArgs = mockNotion.pages.create.mock.calls[0][0]
      // formula filtered, omitted dropped
      expect(createArgs.properties).not.toHaveProperty('OmittedField')
      expect(createArgs.properties).not.toHaveProperty('FormulaField')
      expect(createArgs.properties.Name).toBeDefined()
    })

    // Bug #33 (NEW from real-Notion differential test on test page 2026-07-04):
    // Notion API `blocks.children.append` rejects blocks that have nested
    // children when those children are missing — e.g. a `table` block with
    // `has_children: true` needs `table.children` populated with `table_row`s.
    // populateDeepChildren now fetches nested children before appending, and
    // the sanitize loop recursively strips metadata fields on nested blocks.
    it('replicates official: duplicate page with nested-children blocks succeeds (Bug #33)', async () => {
      const originalPage = {
        id: 'src-page',
        parent: { type: 'database_id', database_id: 'db-1' },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'X' }] }
        }
      }
      // Top-level blocks.children.list returns the toggle/table blocks
      // with `has_children: false` (children already populated by
      // populateDeepChildren, which we simulate in this test by setting
      // `has_children: false` so it doesn't try to re-fetch and clobber).
      const tableBlock = {
        id: 'table-1',
        type: 'table',
        has_children: false,
        table: {
          table_width: 2,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              id: 'row-1',
              type: 'table_row',
              has_children: false,
              parent: { type: 'block_id', block_id: 'table-1' },
              created_time: '2026-01-01',
              table_row: { cells: [[{ plain_text: 'A' }], [{ plain_text: 'B' }]] }
            }
          ]
        }
      }
      const paraBlock = {
        id: 'para-1',
        type: 'paragraph',
        has_children: false,
        paragraph: { rich_text: [{ plain_text: 'hi' }] }
      }
      mockNotion.pages.retrieve.mockResolvedValue(originalPage)
      mockNotion.databases.retrieve.mockRejectedValue(new Error('not used'))
      // Top-level fetch returns the two blocks with nested children already
      // populated (simulating what populateDeepChildren does in production).
      // Sub-block fetches return empty to avoid infinite recursion in the mock.
      mockNotion.blocks.children.list.mockImplementation(async (args: any) => {
        if (args?.block_id === 'src-page') {
          return { results: [paraBlock, tableBlock], next_cursor: null }
        }
        return { results: [], next_cursor: null }
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-page',
        url: 'https://notion.so/dup-page'
      })

      await pages(mockNotion as any, { action: 'duplicate', page_id: 'src-page' })

      // The append payload must contain the table block WITH its children,
      // and the child row must have metadata stripped (id/parent/created_time gone).
      const appendArgs = mockNotion.blocks.children.append.mock.calls[0][0]
      expect(appendArgs.children).toHaveLength(2)
      const sentTable = appendArgs.children[1]
      expect(sentTable.table.children).toHaveLength(1)
      const sentRow = sentTable.table.children[0]
      expect(sentRow.id).toBeUndefined()
      expect(sentRow.parent).toBeUndefined()
      expect(sentRow.created_time).toBeUndefined()
      expect(sentRow.table_row.cells).toEqual([[{ plain_text: 'A' }], [{ plain_text: 'B' }]])
    })

    // Bug #34 (NEW from real-Notion differential test on test page 2026-07-04):
    // Notion API `blocks.children.append` rejects child_page and child_database
    // blocks outright (no type field is accepted). These have to be created via
    // separate pages.create calls. For duplicate, we drop them — the original
    // child pages still exist at their own URLs and can be duplicated
    // separately if needed.
    it('replicates official: duplicate drops child_page/child_database (Bug #34)', async () => {
      const originalPage = {
        id: 'src-page',
        parent: { type: 'database_id', database_id: 'db-1' },
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'X' }] }
        }
      }
      const paraBlock = {
        id: 'para-1',
        type: 'paragraph',
        has_children: false,
        paragraph: { rich_text: [{ plain_text: 'hi' }] }
      }
      const childPageBlock = {
        id: 'child-page-1',
        type: 'child_page',
        has_children: false,
        child_page: { title: 'Sub page' }
      }
      const childDbBlock = {
        id: 'child-db-1',
        type: 'child_database',
        has_children: false,
        child_database: { title: 'Sub DB' }
      }
      mockNotion.pages.retrieve.mockResolvedValue(originalPage)
      mockNotion.databases.retrieve.mockRejectedValue(new Error('not used'))
      mockNotion.blocks.children.list.mockImplementation(async (args: any) => {
        if (args?.block_id === 'src-page') {
          return { results: [paraBlock, childPageBlock, childDbBlock], next_cursor: null }
        }
        return { results: [], next_cursor: null }
      })
      mockNotion.pages.create.mockResolvedValue({
        id: 'dup-page',
        url: 'https://notion.so/dup-page'
      })

      await pages(mockNotion as any, { action: 'duplicate', page_id: 'src-page' })

      const appendArgs = mockNotion.blocks.children.append.mock.calls[0][0]
      // Only the paragraph should make it through — child_page/child_database dropped
      expect(appendArgs.children).toHaveLength(1)
      expect(appendArgs.children[0].type).toBe('paragraph')
      expect(appendArgs.children.find((b: any) => b.type === 'child_page')).toBeUndefined()
      expect(appendArgs.children.find((b: any) => b.type === 'child_database')).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // unknown action
  // ---------------------------------------------------------------------------
  describe('unknown action', () => {
    it('throws on unknown action with tool name and closest-match hint', async () => {
      // 'getts' is one typo away from 'get'
      await expect(pages(mockNotion as any, { action: 'getts' as any })).rejects.toThrow("Did you mean 'get'?")
    })

    it('throws on completely unknown action without hint', async () => {
      await expect(pages(mockNotion as any, { action: 'explode' as any })).rejects.toThrow(
        "Unknown action: 'explode' for pages."
      )
    })
  })

  // ---------------------------------------------------------------------------
  // get_markdown (Notion SDK v5.22+ pages.retrieveMarkdown)
  // ---------------------------------------------------------------------------
  describe('get_markdown', () => {
    it('returns markdown + truncated + unknown_block_ids from the SDK', async () => {
      mockNotion.pages.retrieveMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '# Hello\n\nWorld',
        truncated: false,
        unknown_block_ids: []
      })

      const result = await pages(mockNotion as any, {
        action: 'get_markdown',
        page_id: 'p1'
      })

      expect(result).toEqual({
        action: 'get_markdown',
        page_id: 'p1',
        markdown: '# Hello\n\nWorld',
        truncated: false,
        unknown_block_ids: []
      })
      expect(mockNotion.pages.retrieveMarkdown).toHaveBeenCalledWith({ page_id: 'p1' })
    })

    it('throws without page_id', async () => {
      await expect(pages(mockNotion as any, { action: 'get_markdown' })).rejects.toThrow('page_id is required')
    })
  })

  // ---------------------------------------------------------------------------
  // replace_content (Notion SDK v5.22+ updateMarkdown type=replace_content)
  // ---------------------------------------------------------------------------
  describe('replace_content', () => {
    it('replaces whole page content with new_str', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: 'NEW',
        truncated: false,
        unknown_block_ids: []
      })

      const result = await pages(mockNotion as any, {
        action: 'replace_content',
        page_id: 'p1',
        new_str: 'NEW'
      })

      expect(result).toMatchObject({ action: 'replace_content', page_id: 'p1', replaced: true })
      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'replace_content',
        replace_content: { new_str: 'NEW', allow_deleting_content: true }
      })
    })

    it('throws without new_str', async () => {
      await expect(
        pages(mockNotion as any, {
          action: 'replace_content',
          page_id: 'p1'
        })
      ).rejects.toThrow('new_str is required for replace_content action')
    })
  })

  // ---------------------------------------------------------------------------
  // insert_markdown (Notion SDK v5.22+ updateMarkdown type=insert_content)
  // ---------------------------------------------------------------------------
  describe('insert_markdown', () => {
    it('inserts at end when position is end', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: 'x\nINSERTED',
        truncated: false,
        unknown_block_ids: []
      })

      await pages(mockNotion as any, {
        action: 'insert_markdown',
        page_id: 'p1',
        content: 'INSERTED',
        position: 'end'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'insert_content',
        insert_content: { content: 'INSERTED', position: { type: 'end' } }
      })
    })

    it('inserts at start when position is start', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '',
        truncated: false,
        unknown_block_ids: []
      })

      await pages(mockNotion as any, {
        action: 'insert_markdown',
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
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '',
        truncated: false,
        unknown_block_ids: []
      })

      await pages(mockNotion as any, {
        action: 'insert_markdown',
        page_id: 'p1',
        content: 'AFTER',
        after_block_id: 'block-xyz'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'insert_content',
        insert_content: { content: 'AFTER', after: 'block-xyz' }
      })
    })

    it('throws without content', async () => {
      await expect(
        pages(mockNotion as any, {
          action: 'insert_markdown',
          page_id: 'p1'
        })
      ).rejects.toThrow('content is required for insert_markdown action')
    })
  })

  // ---------------------------------------------------------------------------
  // update_content (Notion SDK v5.22+ search & replace)
  // ---------------------------------------------------------------------------
  describe('update_content', () => {
    it('replaces first match by default', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '',
        truncated: false,
        unknown_block_ids: []
      })

      await pages(mockNotion as any, {
        action: 'update_content',
        page_id: 'p1',
        updates: [{ old_str: 'foo', new_str: 'bar' }]
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'update_content',
        update_content: {
          content_updates: [{ old_str: 'foo', new_str: 'bar' }],
          allow_deleting_content: false
        }
      })
    })

    it('passes replace_all_matches=true when set', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '',
        truncated: false,
        unknown_block_ids: []
      })

      await pages(mockNotion as any, {
        action: 'update_content',
        page_id: 'p1',
        updates: [{ old_str: 'Q1', new_str: 'Q2', replace_all_matches: true }]
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'update_content',
        update_content: {
          content_updates: [{ old_str: 'Q1', new_str: 'Q2', replace_all_matches: true }],
          allow_deleting_content: false
        }
      })
    })

    it('throws when updates is missing or empty', async () => {
      await expect(pages(mockNotion as any, { action: 'update_content', page_id: 'p1' })).rejects.toThrow(
        'updates is required for update_content action'
      )
      await expect(pages(mockNotion as any, { action: 'update_content', page_id: 'p1', updates: [] })).rejects.toThrow(
        'updates is required for update_content action'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // replace_content_range (Notion SDK v5.22+ replace specific markdown range)
  // ---------------------------------------------------------------------------
  describe('replace_content_range', () => {
    it('replaces content within a specific content_range', async () => {
      mockNotion.pages.updateMarkdown.mockResolvedValueOnce({
        object: 'page_markdown',
        id: 'p1',
        markdown: '',
        truncated: false,
        unknown_block_ids: []
      })

      await pages(mockNotion as any, {
        action: 'replace_content_range',
        page_id: 'p1',
        content: 'NEW CONTENT',
        content_range: 'OLD CONTENT'
      })

      expect(mockNotion.pages.updateMarkdown).toHaveBeenCalledWith({
        page_id: 'p1',
        type: 'replace_content_range',
        replace_content_range: {
          content: 'NEW CONTENT',
          content_range: 'OLD CONTENT',
          allow_deleting_content: false
        }
      })
    })

    it('throws without content or content_range', async () => {
      await expect(pages(mockNotion as any, { action: 'replace_content_range', page_id: 'p1' })).rejects.toThrow(
        'content and content_range required for replace_content_range action'
      )
    })
  })
})
