/**
 * Comments Composite Tool Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commentsManage } from './comments'

// Mock Notion Client
const mockNotion = {
  comments: {
    list: vi.fn(),
    retrieve: vi.fn(),
    create: vi.fn()
  },
  blocks: {
    retrieve: vi.fn()
  }
}

describe('commentsManage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('should list comments for a page', async () => {
      mockNotion.comments.list.mockResolvedValue({
        results: [
          {
            id: 'comment-1',
            created_time: '2024-01-01',
            created_by: { id: 'user-1' },
            discussion_id: 'disc-1',
            rich_text: [{ type: 'text', text: { content: 'Test comment' } }],
            parent: { type: 'page_id', page_id: 'page-1' }
          },
          {
            id: 'comment-2',
            created_time: '2024-01-02',
            created_by: { id: 'user-2' },
            discussion_id: 'disc-1',
            rich_text: [{ type: 'text', text: { content: 'Another comment' } }],
            parent: { type: 'page_id', page_id: 'page-1' }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'list',
        page_id: 'page-1'
      })

      expect(result.page_id).toBe('page-1')
      expect(result.total_comments).toBe(2)
      expect(result.results[0]).toEqual({
        id: 'comment-1',
        created_time: '2024-01-01',
        created_by: { id: 'user-1' },
        discussion_id: 'disc-1',
        text: 'Test comment',
        parent: { type: 'page_id', page_id: 'page-1' }
      })
      expect(mockNotion.comments.list).toHaveBeenCalledWith({
        block_id: 'page-1',
        start_cursor: undefined
      })
    })

    it('should return empty results when no comments', async () => {
      mockNotion.comments.list.mockResolvedValue({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'list',
        page_id: 'page-1'
      })

      expect(result.total_comments).toBe(0)
      expect(result.results).toEqual([])
    })

    it('should throw COMMENTS_404_OAUTH_BUG for any 404 from comments.list regardless of code', async () => {
      // BUG #2: previously gated on NOTION_OAUTH_CLIENT_ID env var; now driven by
      // HTTP status (404) + tool context. This test covers the Notion-documented
      // object_not_found shape (no explicit status field).
      const notFoundError = new Error('Not found')
      ;(notFoundError as any).status = 404
      ;(notFoundError as any).code = 'object_not_found'
      mockNotion.comments.list.mockRejectedValue(notFoundError)

      await expect(
        commentsManage(mockNotion as any, {
          action: 'list',
          page_id: 'page-1'
        })
      ).rejects.toMatchObject({
        code: 'COMMENTS_404_OAUTH_BUG'
      })
    })

    it('should re-throw as NOT_FOUND when the error has no HTTP status', async () => {
      const notFoundError = new Error('Not found')
      ;(notFoundError as any).code = 'object_not_found'
      // No status → fall through to NOT_FOUND mapping (preserves prior behaviour
      // for SDKs that don't expose HTTP status).
      mockNotion.comments.list.mockRejectedValue(notFoundError)
      await expect(
        commentsManage(mockNotion as any, {
          action: 'list',
          page_id: 'page-1'
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Page or database not found'
      })
    })

    it('should re-throw non-object_not_found errors', async () => {
      const rateLimitError = new Error('Rate limited')
      ;(rateLimitError as any).code = 'rate_limited'
      mockNotion.comments.list.mockRejectedValue(rateLimitError)

      await expect(
        commentsManage(mockNotion as any, {
          action: 'list',
          page_id: 'page-1'
        })
      ).rejects.toThrow()

      // Should NOT be caught as COMMENTS_LIST_UNAVAILABLE
      await expect(
        commentsManage(mockNotion as any, {
          action: 'list',
          page_id: 'page-1'
        })
      ).rejects.not.toMatchObject({
        code: 'COMMENTS_LIST_UNAVAILABLE'
      })
    })

    it('should include display_name when present', async () => {
      mockNotion.comments.list.mockResolvedValue({
        results: [
          {
            id: 'comment-1',
            created_time: '2024-01-01',
            created_by: { id: 'user-1' },
            discussion_id: 'disc-1',
            rich_text: [{ type: 'text', text: { content: 'Hello' } }],
            display_name: 'John Doe',
            parent: { type: 'page_id', page_id: 'page-1' }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'list',
        page_id: 'page-1'
      })

      expect(result.results[0].display_name).toBe('John Doe')
    })

    it('should throw without page_id', async () => {
      await expect(commentsManage(mockNotion as any, { action: 'list' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'page_id required for list action',
        suggestion: 'Provide page_id'
      })
    })

    it('should handle errors during pagination', async () => {
      mockNotion.comments.list
        .mockResolvedValueOnce({
          results: [
            {
              id: 'c1',
              created_time: '2024-01-01',
              created_by: { id: 'u1' },
              discussion_id: 'd1',
              rich_text: [],
              parent: { type: 'page_id', page_id: 'p1' }
            }
          ],
          has_more: true,
          next_cursor: 'next'
        })
        .mockRejectedValueOnce(new Error('Pagination failed'))

      await expect(
        commentsManage(mockNotion as any, {
          action: 'list',
          page_id: 'page-1'
        })
      ).rejects.toThrow('Pagination failed')
    })
  })

  describe('get', () => {
    it('should retrieve a single comment', async () => {
      mockNotion.comments.retrieve.mockResolvedValue({
        id: 'comment-1',
        created_time: '2024-01-01',
        created_by: { id: 'user-1' },
        discussion_id: 'disc-1',
        rich_text: [{ type: 'text', text: { content: 'Test comment' } }],
        parent: { type: 'page_id', page_id: 'page-1' }
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'get',
        comment_id: 'comment-1'
      })

      expect(result.action).toBe('get')
      expect(result.comment_id).toBe('comment-1')
      expect(result.created_time).toBe('2024-01-01')
      expect(result.created_by).toEqual({ id: 'user-1' })
      expect(result.discussion_id).toBe('disc-1')
      expect(result.text).toBe('Test comment')
      expect(result.rich_text).toEqual([{ type: 'text', text: { content: 'Test comment' } }])
      expect(result.parent).toEqual({ type: 'page_id', page_id: 'page-1' })
      expect(mockNotion.comments.retrieve).toHaveBeenCalledWith({
        comment_id: 'comment-1'
      })
    })

    it('should handle undefined rich_text with _note field', async () => {
      mockNotion.comments.retrieve.mockResolvedValue({
        id: 'comment-1',
        created_time: '2024-01-01',
        created_by: { id: 'user-1' },
        discussion_id: 'disc-1',
        rich_text: undefined,
        parent: { type: 'page_id', page_id: 'page-1' }
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'get',
        comment_id: 'comment-1'
      })

      expect(result.text).toBe('')
      expect(result.rich_text).toBeUndefined()
      expect(result._note).toContain('rich_text unavailable')
    })

    it('should include display_name when present', async () => {
      mockNotion.comments.retrieve.mockResolvedValue({
        id: 'comment-1',
        created_time: '2024-01-01',
        created_by: { id: 'user-1' },
        discussion_id: 'disc-1',
        rich_text: [{ type: 'text', text: { content: 'Hello' } }],
        display_name: 'Jane Doe',
        parent: { type: 'page_id', page_id: 'page-1' }
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'get',
        comment_id: 'comment-1'
      })

      expect(result.display_name).toBe('Jane Doe')
    })

    it('should throw without comment_id', async () => {
      await expect(commentsManage(mockNotion as any, { action: 'get' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'comment_id required for get action',
        suggestion: 'Provide comment_id'
      })
    })

    it('should throw when Notion API returns an error', async () => {
      // enhanceError wraps via mapGenericError → preserves original message
      mockNotion.comments.retrieve.mockRejectedValue(new Error('Retrieve failed'))

      await expect(
        commentsManage(mockNotion as any, {
          action: 'get',
          comment_id: 'comment-1'
        })
      ).rejects.toMatchObject({
        message: 'Retrieve failed',
        code: 'UNKNOWN_ERROR'
      })
    })
  })

  describe('create (new discussion)', () => {
    it('should create a comment with page_id', async () => {
      mockNotion.comments.create.mockResolvedValue({
        id: 'comment-new',
        discussion_id: 'disc-new'
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'create',
        page_id: 'page-1',
        content: 'New comment'
      })

      expect(result.action).toBe('create')
      expect(result.comment_id).toBe('comment-new')
      expect(result.discussion_id).toBe('disc-new')
      expect(result.created).toBe(true)
      expect(mockNotion.comments.create).toHaveBeenCalledWith({
        rich_text: [
          expect.objectContaining({
            type: 'text',
            text: { content: 'New comment', link: null }
          })
        ],
        parent: { page_id: 'page-1' }
      })
    })

    it('should throw without content', async () => {
      await expect(commentsManage(mockNotion as any, { action: 'create', page_id: 'page-1' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'content required for create action',
        suggestion: 'Provide comment content'
      })
    })

    it('should throw without page_id or discussion_id', async () => {
      await expect(commentsManage(mockNotion as any, { action: 'create', content: 'Hello' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Either page_id or discussion_id is required for create action'
      })
    })

    it('should throw when Notion API returns an error', async () => {
      // Use UNAUTHORIZED code so retryWithBackoff throws immediately without delay
      const err = new Error('Create failed')
      ;(err as any).code = 'UNAUTHORIZED'
      mockNotion.comments.create.mockRejectedValue(err)

      // UNAUTHORIZED is wrapped via mapNotionError → "Invalid or missing Notion API token"
      await expect(
        commentsManage(mockNotion as any, {
          action: 'create',
          page_id: 'page-1',
          content: 'Hello'
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED'
      })
    })
  })

  describe('create (reply)', () => {
    it('should create a reply with discussion_id', async () => {
      mockNotion.comments.create.mockResolvedValue({
        id: 'comment-reply',
        discussion_id: 'disc-1'
      })

      const result = await commentsManage(mockNotion as any, {
        action: 'create',
        discussion_id: 'disc-1',
        content: 'Reply text'
      })

      expect(result.action).toBe('create')
      expect(result.comment_id).toBe('comment-reply')
      expect(result.discussion_id).toBe('disc-1')
      expect(result.created).toBe(true)
      expect(mockNotion.comments.create).toHaveBeenCalledWith({
        rich_text: [
          expect.objectContaining({
            type: 'text',
            text: { content: 'Reply text', link: null }
          })
        ],
        discussion_id: 'disc-1'
      })
      expect(mockNotion.comments.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ parent: expect.anything() })
      )
    })
  })

  describe('unknown action', () => {
    it('should throw on unsupported action', async () => {
      await expect(commentsManage(mockNotion as any, { action: 'delete' as any })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      })
    })
  })

  // BUG #2 RED TESTS: comments wrapper must surface OAuth 404 disambiguation
  // via HTTP status, not just code. Tests below must FAIL before the fix and
  // PASS after.
  describe('OAuth 404 disambiguation (HTTP-status based, no env gate)', () => {
    it('list: should report COMMENTS_404_OAUTH_BUG when status=404 even with NOTION_OAUTH_CLIENT_ID UNSET', async () => {
      const oauthBugError = Object.assign(new Error('404 Not Found'), {
        status: 404,
        code: 'object_not_found'
      })
      mockNotion.comments.list.mockRejectedValue(oauthBugError)

      const originalVal = process.env.NOTION_OAUTH_CLIENT_ID
      delete process.env.NOTION_OAUTH_CLIENT_ID
      try {
        await expect(
          commentsManage(mockNotion as any, {
            action: 'list',
            page_id: 'page-1'
          })
        ).rejects.toMatchObject({
          code: 'COMMENTS_404_OAUTH_BUG',
          suggestion: expect.stringMatching(/action="get".*comment_id|action="create".*discussion_id/s)
        })
      } finally {
        if (originalVal !== undefined) process.env.NOTION_OAUTH_CLIENT_ID = originalVal
      }
    })

    it('create: should report COMMENTS_404_OAUTH_BUG when status=404 (any code, e.g. restricted_resource)', async () => {
      // Use NOT_FOUND code so retryWithBackoff short-circuits on attempt 1.
      // status=404 + tool=comments still drives the new HTTP-status-based mapper path.
      const oauthBugError = Object.assign(new Error('404 Not Found'), {
        status: 404,
        code: 'NOT_FOUND'
      })
      mockNotion.comments.create.mockRejectedValue(oauthBugError)

      await expect(
        commentsManage(mockNotion as any, {
          action: 'create',
          page_id: 'page-1',
          content: 'Hello'
        })
      ).rejects.toMatchObject({
        code: 'COMMENTS_404_OAUTH_BUG',
        suggestion: expect.stringMatching(/action="get".*comment_id|action="create".*discussion_id/s)
      })
    })

    it('create: surfaces 404 disambiguation for arbitrary codes (retried path)', async () => {
      // restricted_resource is NOT in the retry stop-list, so retryWithBackoff will retry.
      // The test asserts the wrapper still emits COMMENTS_404_OAUTH_BUG after retries exhaust.
      const oauthBugError = Object.assign(new Error('404 Not Found'), {
        status: 404,
        code: 'restricted_resource'
      })
      mockNotion.comments.create.mockRejectedValue(oauthBugError)

      await expect(
        commentsManage(mockNotion as any, {
          action: 'create',
          page_id: 'page-1',
          content: 'Hello'
        })
      ).rejects.toMatchObject({
        code: 'COMMENTS_404_OAUTH_BUG'
      })
    }, 10_000)
  })

  // Note: verifyBlockExists was removed — its logic is no longer needed
  // since the code now directly re-throws the original error on object_not_found
})
