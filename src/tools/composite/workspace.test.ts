import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceInput, WorkspaceResult } from './workspace.js'
import { clearWorkspaceCache, workspace } from './workspace.js'

const mockNotion = {
  users: {
    retrieve: vi.fn()
  },
  pages: {
    retrieve: vi.fn()
  },
  databases: {
    retrieve: vi.fn()
  },
  dataSources: {
    retrieve: vi.fn()
  },
  search: vi.fn(),
  request: vi.fn()
}

describe('workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    clearWorkspaceCache()
  })

  describe('info', () => {
    it('should return bot info and cache it', async () => {
      mockNotion.users.retrieve.mockResolvedValue({
        id: 'bot-1',
        type: 'bot',
        name: 'My Integration',
        bot: { owner: { type: 'workspace', workspace: true } }
      })

      const client = { ...mockNotion } as any

      // First call
      const result1 = (await workspace(client, { action: 'info' })) as Extract<WorkspaceResult, { action: 'info' }>

      expect(result1.bot.id).toBe('bot-1')
      expect(mockNotion.users.retrieve).toHaveBeenCalledTimes(1)

      // Second call (should be cached)
      const result2 = (await workspace(client, { action: 'info' })) as Extract<WorkspaceResult, { action: 'info' }>

      expect(result2.bot.id).toBe('bot-1')
      expect(mockNotion.users.retrieve).toHaveBeenCalledTimes(1)
    })

    it('should expire cache after TTL', async () => {
      mockNotion.users.retrieve.mockResolvedValue({
        id: 'bot-1',
        type: 'bot',
        name: 'My Integration',
        bot: { owner: { type: 'workspace', workspace: true } }
      })

      const client = { ...mockNotion } as any

      await workspace(client, { action: 'info' })
      expect(mockNotion.users.retrieve).toHaveBeenCalledTimes(1)

      // Advance time by 6 minutes (TTL is 5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000)

      await workspace(client, { action: 'info' })
      expect(mockNotion.users.retrieve).toHaveBeenCalledTimes(2)
    })

    it('should default name to Bot when missing', async () => {
      mockNotion.users.retrieve.mockResolvedValue({
        id: 'bot-1',
        type: 'bot',
        bot: {}
      })

      const result = (await workspace({ ...mockNotion } as any, { action: 'info' })) as Extract<
        WorkspaceResult,
        { action: 'info' }
      >

      expect(result.bot.name).toBe('Bot')
    })
  })

  describe('search', () => {
    it('should search with query', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'My Page' }] } },
            url: 'https://notion.so/page-1',
            last_edited_time: '2024-01-01'
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, { action: 'search', query: 'My Page' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(result.action).toBe('search')
      expect(result.query).toBe('My Page')
      expect(result.total).toBe(1)
      expect(result.results[0]).toEqual({
        id: 'page-1',
        object: 'page',
        title: 'My Page',
        url: 'https://notion.so/page-1',
        last_edited_time: '2024-01-01'
      })
    })

    it('should search without query (empty string)', async () => {
      mockNotion.search.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(result.action).toBe('search')
      expect(result.query).toBeUndefined()
      expect(result.total).toBe(0)
      expect(result.results).toEqual([])
      expect(mockNotion.search).toHaveBeenCalledWith(expect.objectContaining({ query: '' }))
    })

    it('should apply filter by object type', async () => {
      mockNotion.search.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      await workspace(mockNotion as any, {
        action: 'search',
        filter: { object: 'page' }
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { value: 'page', property: 'object' }
        })
      )
    })

    it('adaptively maps filter.object = "database" to "data_source"', async () => {
      mockNotion.search.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      await workspace(mockNotion as any, {
        action: 'search',
        filter: { object: 'database' as any }
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { value: 'data_source', property: 'object' }
        })
      )
    })

    it('adaptively normalizes native Notion { property: "object", value: "page" } filter', async () => {
      mockNotion.search.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      await workspace(mockNotion as any, {
        action: 'search',
        filter: { property: 'object', value: 'page' } as any
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { value: 'page', property: 'object' }
        })
      )
    })

    it('throws VALIDATION_ERROR with actionable suggestion when filter.property is passed', async () => {
      await expect(
        workspace(mockNotion as any, {
          action: 'search',
          filter: { property: 'Status', value: 'Done' } as any
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining(
          'workspace.search does not support filtering by page properties (such as "Status")'
        ),
        suggestion: expect.stringContaining('databases.query')
      })

      // Also verify JSON string format
      await expect(
        workspace(mockNotion as any, {
          action: 'search',
          filter: '{"property":"Status","value":"Done"}' as any
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining(
          'workspace.search does not support filtering by page properties (such as "Status")'
        ),
        suggestion: expect.stringContaining('databases.query')
      })
    })

    it('should apply sort options', async () => {
      mockNotion.search.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      await workspace(mockNotion as any, {
        action: 'search',
        sort: { direction: 'ascending', timestamp: 'created_time' }
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { direction: 'ascending', timestamp: 'created_time' }
        })
      )
    })

    it('should default sort direction and timestamp', async () => {
      mockNotion.search.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      await workspace(mockNotion as any, {
        action: 'search',
        sort: {}
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { direction: 'descending', timestamp: 'last_edited_time' }
        })
      )
    })

    it('should respect limit parameter', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          { id: 'p1', object: 'page', properties: {}, url: '', last_edited_time: '' },
          { id: 'p2', object: 'page', properties: {}, url: '', last_edited_time: '' },
          { id: 'p3', object: 'page', properties: {}, url: '', last_edited_time: '' }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, {
        action: 'search',
        limit: 2
      })) as Extract<WorkspaceResult, { action: 'search' }>

      expect(result.total).toBe(2)
      expect(result.results).toHaveLength(2)
    })

    it('should extract title from Name property for pages', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: { Name: { title: [{ plain_text: 'Named Page' }] } },
            url: '',
            last_edited_time: ''
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(result.results[0].title).toBe('Named Page')
    })

    it('should extract title for databases', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'db-1',
            object: 'database',
            title: [{ plain_text: 'My Database' }],
            url: '',
            last_edited_time: ''
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(result.results[0].title).toBe('My Database')
    })

    it('extracts multi-span rich text titles completely without truncation', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-composite',
            object: 'page',
            properties: {
              title: {
                title: [{ plain_text: '第一阶段: ' }, { plain_text: '核心架构重构' }]
              }
            },
            url: '',
            last_edited_time: ''
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(result.results[0].title).toBe('第一阶段: 核心架构重构')
    })

    it('should default to Untitled when no title found', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: {},
            url: '',
            last_edited_time: ''
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(result.results[0].title).toBe('Untitled')
    })

    it('filters search results by parent_id and enriches parent metadata', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'Matched Child' }] } },
            url: 'https://notion.so/page-1',
            last_edited_time: '2026-01-01',
            parent: { type: 'page_id', page_id: 'parent-123' }
          },
          {
            id: 'page-2',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'Unmatched Other Child' }] } },
            url: 'https://notion.so/page-2',
            last_edited_time: '2026-01-01',
            parent: { type: 'page_id', page_id: 'other-parent' }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const res = (await workspace(mockNotion as any, {
        action: 'search',
        query: 'Child',
        parent_id: 'parent-123'
      })) as Extract<WorkspaceResult, { action: 'search' }>

      expect(res.results).toHaveLength(1)
      expect(res.results[0].id).toBe('page-1')
      expect(res.results[0].parent).toEqual({ type: 'page_id', id: 'parent-123' })
      expect(res.total).toBe(1)
    })

    it('normalizes UUID hyphens when filtering by parent_id', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'Child under DB' }] } },
            url: 'https://notion.so/page-1',
            last_edited_time: '2026-01-01',
            parent: { type: 'database_id', database_id: '12345678-1234-1234-1234-123456789abc' }
          },
          {
            id: 'page-2',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'Child under Block' }] } },
            url: 'https://notion.so/page-2',
            last_edited_time: '2026-01-01',
            parent: { type: 'block_id', block_id: 'abcdef01-abcd-abcd-abcd-abcdef012345' }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      // Query with unhyphenated target ID for database parent
      const resDb = (await workspace(mockNotion as any, {
        action: 'search',
        parent_id: '12345678123412341234123456789abc'
      })) as Extract<WorkspaceResult, { action: 'search' }>

      expect(resDb.results).toHaveLength(1)
      expect(resDb.results[0].id).toBe('page-1')
      expect(resDb.results[0].parent).toEqual({
        type: 'database_id',
        id: '12345678-1234-1234-1234-123456789abc'
      })

      // Query with hyphenated target ID for block parent
      const resBlock = (await workspace(mockNotion as any, {
        action: 'search',
        parent_id: 'abcdef01-abcd-abcd-abcd-abcdef012345'
      })) as Extract<WorkspaceResult, { action: 'search' }>

      expect(resBlock.results).toHaveLength(1)
      expect(resBlock.results[0].id).toBe('page-2')
      expect(resBlock.results[0].parent).toEqual({
        type: 'block_id',
        id: 'abcdef01-abcd-abcd-abcd-abcdef012345'
      })
    })

    it('enriches parent metadata on search results without parent_id filter', async () => {
      mockNotion.search.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'Page with Parent' }] } },
            url: 'https://notion.so/page-1',
            last_edited_time: '2026-01-01',
            parent: { type: 'workspace', workspace: true }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const res = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
        WorkspaceResult,
        { action: 'search' }
      >

      expect(res.results[0].parent).toEqual({ type: 'workspace', id: undefined, title: 'Workspace' })
    })

    describe('parent title resolution and caching', () => {
      it('resolves parent.title from search candidates without external API call when parent is present in results', async () => {
        mockNotion.search.mockResolvedValue({
          results: [
            {
              id: 'parent-page-1',
              object: 'page',
              properties: { title: { title: [{ plain_text: 'Main Roadmap' }] } },
              url: 'https://notion.so/parent-page-1',
              last_edited_time: '2026-01-01'
            },
            {
              id: 'child-page-1',
              object: 'page',
              properties: { title: { title: [{ plain_text: 'Q1 Milestone' }] } },
              url: 'https://notion.so/child-page-1',
              last_edited_time: '2026-01-01',
              parent: { type: 'page_id', page_id: 'parent-page-1' }
            }
          ],
          next_cursor: null,
          has_more: false
        })

        const res = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
          WorkspaceResult,
          { action: 'search' }
        >

        expect((res.results[1].parent as any)?.title).toBe('Main Roadmap')
        expect(mockNotion.pages.retrieve).not.toHaveBeenCalled()
      })

      it('concurrently fetches parent.title via notion.pages.retrieve / notion.databases.retrieve when parent is not in search results', async () => {
        mockNotion.search.mockResolvedValue({
          results: [
            {
              id: 'child-p1',
              object: 'page',
              properties: { title: { title: [{ plain_text: 'Task Item' }] } },
              url: 'https://notion.so/child-p1',
              last_edited_time: '2026-01-01',
              parent: { type: 'page_id', page_id: 'ext-page-99' }
            },
            {
              id: 'child-p2',
              object: 'data_source',
              title: [{ plain_text: 'Tasks DB Source' }],
              url: 'https://notion.so/child-p2',
              last_edited_time: '2026-01-01',
              parent: { type: 'database_id', database_id: 'ext-db-88' }
            },
            {
              id: 'child-p3',
              object: 'page',
              properties: { title: { title: [{ plain_text: 'Row Page' }] } },
              url: 'https://notion.so/child-p3',
              last_edited_time: '2026-01-01',
              parent: { type: 'data_source_id', data_source_id: 'ext-ds-77' }
            }
          ],
          next_cursor: null,
          has_more: false
        })

        mockNotion.pages.retrieve.mockResolvedValueOnce({
          id: 'ext-page-99',
          object: 'page',
          properties: { title: { title: [{ plain_text: 'External Project Page' }] } }
        })
        mockNotion.databases.retrieve.mockResolvedValueOnce({
          id: 'ext-db-88',
          object: 'database',
          title: [{ plain_text: 'Project Management DB' }]
        })
        mockNotion.dataSources.retrieve.mockResolvedValueOnce({
          id: 'ext-ds-77',
          object: 'data_source',
          title: [{ plain_text: 'Tasks Data Source' }]
        })

        const res = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
          WorkspaceResult,
          { action: 'search' }
        >

        expect(res.results[0].parent).toEqual({
          type: 'page_id',
          id: 'ext-page-99',
          title: 'External Project Page'
        })
        expect(res.results[1].parent).toEqual({
          type: 'database_id',
          id: 'ext-db-88',
          title: 'Project Management DB'
        })
        expect(res.results[2].parent).toEqual({
          type: 'data_source_id',
          id: 'ext-ds-77',
          title: 'Tasks Data Source'
        })
        expect(mockNotion.pages.retrieve).toHaveBeenCalledWith({ page_id: 'ext-page-99' })
        expect(mockNotion.databases.retrieve).toHaveBeenCalledWith({ database_id: 'ext-db-88' })
        expect(mockNotion.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: 'ext-ds-77' })
      })

      it('gracefully falls back without blocking search when parent retrieve fails with 404 or unauthorized', async () => {
        mockNotion.search.mockResolvedValue({
          results: [
            {
              id: 'child-p1',
              object: 'page',
              properties: { title: { title: [{ plain_text: 'Child under private parent' }] } },
              url: 'https://notion.so/child-p1',
              last_edited_time: '2026-01-01',
              parent: { type: 'page_id', page_id: 'private-parent-123' }
            }
          ],
          next_cursor: null,
          has_more: false
        })

        mockNotion.pages.retrieve.mockRejectedValueOnce(new Error('Object not found (404)'))
        mockNotion.databases.retrieve.mockRejectedValueOnce(new Error('Object not found (404)'))

        const res = (await workspace(mockNotion as any, { action: 'search' })) as Extract<
          WorkspaceResult,
          { action: 'search' }
        >

        expect(res.results).toHaveLength(1)
        expect(res.results[0].id).toBe('child-p1')
        expect(res.results[0].parent).toEqual({
          type: 'page_id',
          id: 'private-parent-123',
          title: undefined
        })
      })

      it('reuses in-memory cache for parent title on repeated queries', async () => {
        const client = { ...mockNotion } as any
        mockNotion.search.mockResolvedValue({
          results: [
            {
              id: 'child-p1',
              object: 'page',
              properties: { title: { title: [{ plain_text: 'Child 1' }] } },
              url: 'https://notion.so/child-p1',
              last_edited_time: '2026-01-01',
              parent: { type: 'page_id', page_id: 'cached-parent-1' }
            }
          ],
          next_cursor: null,
          has_more: false
        })

        mockNotion.pages.retrieve.mockResolvedValueOnce({
          id: 'cached-parent-1',
          object: 'page',
          properties: { title: { title: [{ plain_text: 'Cached Parent Page' }] } }
        })

        // First search call: fetches parent via retrieve
        const res1 = (await workspace(client, { action: 'search' })) as Extract<WorkspaceResult, { action: 'search' }>
        expect((res1.results[0].parent as any)?.title).toBe('Cached Parent Page')
        expect(mockNotion.pages.retrieve).toHaveBeenCalledTimes(1)

        // Second search call: should hit cache
        const res2 = (await workspace(client, { action: 'search' })) as Extract<WorkspaceResult, { action: 'search' }>
        expect((res2.results[0].parent as any)?.title).toBe('Cached Parent Page')
        expect(mockNotion.pages.retrieve).toHaveBeenCalledTimes(1)
      })
    })

    it('provides actionable guidance when searching in_trash or archived items', async () => {
      const mockNotion = { search: vi.fn() }
      await expect(
        workspace(mockNotion as any, {
          action: 'search',
          query: 'deleted page',
          in_trash: true
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/Notion REST API does not support searching deleted or archived pages/),
        suggestion: expect.stringMatching(/pages\.restore/)
      })

      await expect(
        workspace(mockNotion as any, {
          action: 'search',
          query: 'archived page',
          archived: true
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/Notion REST API does not support searching deleted or archived pages/),
        suggestion: expect.stringMatching(/pages\.restore/)
      })
    })

    it('does not throw when in_trash or archived is false or "false"', async () => {
      mockNotion.search.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null
      })

      const res = await workspace(mockNotion as any, {
        action: 'search',
        query: 'active page',
        in_trash: 'false' as any,
        archived: false
      })

      expect(res.action).toBe('search')
    })

    it('filters search results by parent_id from a Notion URL', async () => {
      mockNotion.search.mockResolvedValueOnce({
        results: [
          {
            id: 'page-1',
            object: 'page',
            properties: { title: { title: [{ plain_text: 'Child under URL folder' }] } },
            url: 'https://notion.so/page-1',
            last_edited_time: '2026-01-01',
            parent: { type: 'page_id', page_id: '3de4f4cf-c8e2-80f9-acbd-dff14d6ec10e' }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const res = await workspace(mockNotion as any, {
        action: 'search',
        query: 'Child',
        parent_id: 'https://app.notion.com/p/Folder-3de4f4cfc8e280f9acbddff14d6ec10e'
      })

      expect(res.action).toBe('search')
      if (res.action === 'search') {
        expect(res.results).toHaveLength(1)
        expect(res.results[0].id).toBe('page-1')
      }
    })

    describe('truncation status transparency', () => {
      it('marks is_truncated: true and provides suggestion when parent_id search candidate pool hits limit', async () => {
        // Mock 3 pages with has_more: true
        mockNotion.search
          .mockResolvedValueOnce({
            results: [{ id: 'p1', object: 'page', properties: {}, url: '', last_edited_time: '' }],
            has_more: true,
            next_cursor: 'cur-1'
          })
          .mockResolvedValueOnce({
            results: [{ id: 'p2', object: 'page', properties: {}, url: '', last_edited_time: '' }],
            has_more: true,
            next_cursor: 'cur-2'
          })
          .mockResolvedValueOnce({
            results: [{ id: 'p3', object: 'page', properties: {}, url: '', last_edited_time: '' }],
            has_more: true,
            next_cursor: 'cur-3'
          })

        const res = (await workspace(mockNotion as any, {
          action: 'search',
          parent_id: 'some-parent-id'
        })) as Extract<WorkspaceResult, { action: 'search' }>

        expect(res.is_truncated).toBe(true)
        expect(res.suggestion).toContain('truncated')
      })

      it('marks is_truncated: true and provides suggestion when limit is reached with more results available', async () => {
        mockNotion.search.mockResolvedValueOnce({
          results: [
            { id: 'p1', object: 'page', properties: {}, url: '', last_edited_time: '' },
            { id: 'p2', object: 'page', properties: {}, url: '', last_edited_time: '' }
          ],
          has_more: true,
          next_cursor: 'cur-1'
        })

        const res = (await workspace(mockNotion as any, {
          action: 'search',
          limit: 2
        })) as Extract<WorkspaceResult, { action: 'search' }>

        expect(res.is_truncated).toBe(true)
        expect(res.suggestion).toContain('limit')
      })

      it('does not set is_truncated when all results are fetched', async () => {
        mockNotion.search.mockResolvedValueOnce({
          results: [{ id: 'p1', object: 'page', properties: {}, url: '', last_edited_time: '' }],
          has_more: false,
          next_cursor: null
        })

        const res = (await workspace(mockNotion as any, {
          action: 'search'
        })) as Extract<WorkspaceResult, { action: 'search' }>

        expect(res.is_truncated).toBeUndefined()
        expect(res.suggestion).toBeUndefined()
      })
    })
  })

  describe('unknown action', () => {
    it('should throw on unsupported action', async () => {
      await expect(workspace(mockNotion as any, { action: 'delete' as any })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      })
    })
  })

  // ---------------------------------------------------------------------------
  // JSON-string fallback (Claude Code XML serialization workaround)
  // ---------------------------------------------------------------------------
  describe('JSON-string input fallback (Claude Code XML serialization workaround)', () => {
    it('search accepts filter as JSON-stringified object', async () => {
      mockNotion.search.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null
      })

      await workspace(mockNotion as any, {
        action: 'search',
        query: 'foo',
        filter: '{"object":"page"}' as unknown as WorkspaceInput['filter']
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { value: 'page', property: 'object' }
        })
      )
    })

    it('search accepts sort as JSON-stringified object', async () => {
      mockNotion.search.mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null
      })

      await workspace(mockNotion as any, {
        action: 'search',
        query: 'foo',
        sort: '{"direction":"ascending","timestamp":"created_time"}' as unknown as WorkspaceInput['sort']
      })

      expect(mockNotion.search).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: { direction: 'ascending', timestamp: 'created_time' }
        })
      )
    })

    it('throws NotionMCPError on malformed filter JSON', async () => {
      await expect(
        workspace(mockNotion as any, {
          action: 'search',
          filter: '{not-valid' as unknown as WorkspaceInput['filter']
        })
      ).rejects.toThrow(/Failed to parse JSON string/)
    })
  })
})
