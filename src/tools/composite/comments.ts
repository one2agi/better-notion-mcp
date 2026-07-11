/**
 * Comments Composite Tool
 * Manage page comments: list, get, create
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, retryWithBackoff, throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import { autoPaginate } from '../helpers/pagination.js'
import * as RichText from '../helpers/richtext.js'

export interface CommentsManageInput {
  page_id?: string
  comment_id?: string
  discussion_id?: string
  action: 'list' | 'get' | 'create'
  content?: string // For create action
}

/**
 * Manage comments (list, get, create)
 * Maps to: GET /v1/comments, GET /v1/comments/{id}, POST /v1/comments
 */
export async function commentsManage(notion: Client, input: CommentsManageInput): Promise<any> {
  return withErrorHandling(
    async () => {
      switch (input.action) {
        case 'list': {
          if (!input.page_id) {
            throw new NotionMCPError('page_id required for list action', 'VALIDATION_ERROR', 'Provide page_id')
          }
          const pageId: string = input.page_id

          try {
            const comments = await autoPaginate(async (cursor) => {
              return await notion.comments.list({
                block_id: pageId,
                start_cursor: cursor
              })
            })

            return {
              page_id: input.page_id,
              total_comments: comments.length,
              results: comments.map((comment: any) => ({
                id: comment.id,
                created_time: comment.created_time,
                created_by: comment.created_by,
                discussion_id: comment.discussion_id,
                text: RichText.extractPlainText(comment.rich_text),
                ...(comment.display_name ? { display_name: comment.display_name } : {}),
                parent: comment.parent
              }))
            }
          } catch (error: any) {
            // Re-throw so the outer withErrorHandling can apply the HTTP-status-based
            // OAuth 404 disambiguation. The previous env-gated path only caught the
            // bug for explicitly-OAuth deployments and missed internal tokens hitting
            // the same Notion API behavior.
            throw error
          }
        }
        case 'get': {
          if (!input.comment_id) {
            throw new NotionMCPError('comment_id required for get action', 'VALIDATION_ERROR', 'Provide comment_id')
          }

          const comment: any = await notion.comments.retrieve({
            comment_id: input.comment_id
          })

          const text = RichText.extractPlainText(comment.rich_text)

          return {
            action: 'get',
            comment_id: comment.id,
            created_time: comment.created_time,
            created_by: comment.created_by,
            discussion_id: comment.discussion_id,
            text,
            ...(comment.rich_text ? { rich_text: comment.rich_text } : {}),
            ...(comment.display_name ? { display_name: comment.display_name } : {}),
            parent: comment.parent,
            ...(!comment.rich_text && {
              _note:
                'rich_text unavailable in Notion API version 2025-09-03 for comments.retrieve. Comment content was set during creation.'
            })
          }
        }

        case 'create': {
          if (!input.content) {
            throw new NotionMCPError(
              'content required for create action',
              'VALIDATION_ERROR',
              'Provide comment content'
            )
          }

          // Either page_id or discussion_id must be provided
          if (!input.page_id && !input.discussion_id) {
            throw new NotionMCPError(
              'Either page_id or discussion_id is required for create action',
              'VALIDATION_ERROR',
              'Use page_id for new discussion, discussion_id for replies'
            )
          }

          const createParams: any = {
            rich_text: [RichText.text(input.content)]
          }

          // Add parent or discussion_id based on input
          if (input.discussion_id) {
            createParams.discussion_id = input.discussion_id
          } else {
            createParams.parent = {
              page_id: input.page_id
            }
          }

          // Wrap create so the outer withErrorHandling can apply the HTTP-status-based
          // OAuth 404 disambiguation to 404s raised by Notion (any code).
          const comment = await retryWithBackoff(() => notion.comments.create(createParams), {
            maxRetries: 3,
            context: { tool: 'comments' }
          })

          return {
            action: 'create',
            comment_id: comment.id,
            // Notion API returns `discussion_id` but the SDK response type omits it.
            // Cast to access the real runtime value; safe because the API contract
            // is documented at https://developers.notion.com/reference/create-a-comment.
            discussion_id: (comment as { discussion_id: string }).discussion_id,
            created: true
          }
        }

        default:
          throwUnknownAction(input.action, ['list', 'get', 'create'], 'comments')
      }
    },
    { tool: 'comments' }
  )()
}
