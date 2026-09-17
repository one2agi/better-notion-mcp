import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type WorkspaceInput, type WorkspaceResult, workspace } from './workspace.js'

const mockNotion = {
  users: {
    retrieve: vi.fn()
  },
  search: vi.fn(),
  request: vi.fn()
}

describe('workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
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

      expect(res.results[0].parent).toEqual({ type: 'workspace', id: undefined })
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
