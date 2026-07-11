/**
 * File Uploads Composite Tool
 * Upload, manage, and retrieve files in Notion
 * Maps to: POST/GET /v1/file_uploads endpoints (API 2025-09-03)
 */

import type { Client } from '@notionhq/client'
import { NotionMCPError, throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import { isValidBase64 } from '../helpers/id.js'
import { autoPaginate } from '../helpers/pagination.js'

// Maximum file size per request (10MB) to prevent OOM
const MAX_FILE_SIZE_MB = 10
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

export interface FileUploadsInput {
  action: 'create' | 'send' | 'complete' | 'retrieve' | 'list'

  // Common params
  file_upload_id?: string

  // Create params
  filename?: string
  content_type?: string
  mode?: 'single' | 'multi_part'
  number_of_parts?: number

  // Send params
  part_number?: number
  file_content?: string // Base64 encoded content for send action

  // List params
  limit?: number
}

/**
 * Unified file uploads tool - handles all file upload operations
 * Maps to: /v1/file_uploads endpoints
 */
export async function fileUploads(notion: Client, input: FileUploadsInput): Promise<any> {
  return withErrorHandling(async () => {
    switch (input.action) {
      case 'create':
        return await createFileUpload(notion, input)

      case 'send':
        return await sendFileUpload(notion, input)

      case 'complete':
        return await completeFileUpload(notion, input)

      case 'retrieve':
        return await retrieveFileUpload(notion, input)

      case 'list':
        return await listFileUploads(notion, input)

      default:
        throwUnknownAction(input.action, ['create', 'send', 'complete', 'retrieve', 'list'], 'file_uploads')
    }
  })()
}

/**
 * Create a file upload session
 * Maps to: POST /v1/file_uploads
 */
async function createFileUpload(notion: Client, input: FileUploadsInput): Promise<any> {
  if (!input.filename) {
    throw new NotionMCPError('filename is required for create action', 'VALIDATION_ERROR', 'Provide filename')
  }

  if (!input.content_type) {
    throw new NotionMCPError(
      'content_type is required for create action',
      'VALIDATION_ERROR',
      'Provide content_type (e.g., "image/png", "application/pdf")'
    )
  }

  const params: any = {
    filename: input.filename,
    content_type: input.content_type
  }

  if (input.mode === 'multi_part' && input.number_of_parts) {
    params.mode = 'multi_part'
    params.number_of_parts = input.number_of_parts
  }

  const response: any = await notion.fileUploads.create(params)

  return {
    action: 'create',
    file_upload_id: response.id,
    status: response.status,
    filename: response.filename,
    content_type: response.content_type,
    upload_url: response.upload_url,
    created: true
  }
}

/**
 * Send file data to an upload session
 * Maps to: POST /v1/file_uploads/{id}/send
 */
async function sendFileUpload(notion: Client, input: FileUploadsInput): Promise<any> {
  if (!input.file_upload_id) {
    throw new NotionMCPError(
      'file_upload_id is required for send action',
      'VALIDATION_ERROR',
      'Provide file_upload_id from create step'
    )
  }

  if (!input.file_content) {
    throw new NotionMCPError(
      'file_content is required for send action',
      'VALIDATION_ERROR',
      'Provide base64-encoded file content'
    )
  }

  // Check file size before processing to prevent OOM (cheap length check first)
  const approximateSize = (input.file_content.length * 3) / 4
  if (approximateSize > MAX_FILE_SIZE_BYTES) {
    throw new NotionMCPError(
      `File content exceeds maximum size of ${MAX_FILE_SIZE_MB}MB per request.`,
      'VALIDATION_ERROR',
      "Split the file into smaller parts and use the 'part_number' parameter for multi-part upload."
    )
  }

  // Validate base64 format after size check (regex is more expensive)
  if (!isValidBase64(input.file_content)) {
    throw new NotionMCPError(
      'file_content is not valid base64 encoding',
      'VALIDATION_ERROR',
      'Encode the file as base64 first. Example: Buffer.from(fileBytes).toString("base64"). The string must only contain A-Z, a-z, 0-9, +, /, and = padding.'
    )
  }

  // Auto-retrieve content_type and filename from upload session if not provided
  let contentType = input.content_type
  let filename = input.filename
  if (!contentType || !filename) {
    const uploadInfo: any = await notion.fileUploads.retrieve({
      file_upload_id: input.file_upload_id
    })
    contentType = contentType || uploadInfo.content_type || 'application/octet-stream'
    filename = filename || uploadInfo.filename || 'file'
  }

  const fileBuffer = Buffer.from(input.file_content, 'base64')
  const blob = new Blob([fileBuffer], { type: contentType })

  const params: any = {
    file_upload_id: input.file_upload_id,
    file: { data: blob, filename }
  }

  if (input.part_number !== undefined) {
    params.part_number = String(input.part_number)
  }

  const response: any = await notion.fileUploads.send(params)

  return {
    action: 'send',
    file_upload_id: input.file_upload_id,
    part_number: input.part_number,
    status: response.status || 'sent'
  }
}

/**
 * Complete a file upload session.
 *
 * Idempotent and mode-aware: Notion's `complete` endpoint is multi-part-only.
 * Single-part uploads auto-finalize to `status='uploaded'` inside `send()`,
 * so calling `complete()` afterwards returns 400 from the live API. We
 * retrieve current state first and short-circuit when the upload is already
 * finalized.
 *
 * Maps to: POST /v1/file_uploads/{id}/complete
 */
async function completeFileUpload(notion: Client, input: FileUploadsInput): Promise<any> {
  if (!input.file_upload_id) {
    throw new NotionMCPError(
      'file_upload_id is required for complete action',
      'VALIDATION_ERROR',
      'Provide file_upload_id'
    )
  }

  // Step 1: check current status so we don't call SDK when not needed.
  const current: any = await notion.fileUploads.retrieve({
    file_upload_id: input.file_upload_id
  })

  // Step 2: already finalized by single-part send() — synthetic success.
  if (current.status === 'uploaded') {
    return {
      action: 'complete',
      file_upload_id: input.file_upload_id,
      status: 'uploaded',
      completed: true,
      note: 'Upload already finalized by send(); complete() is multi-part-only.'
    }
  }

  // Step 3: still in progress and multi-part — finalize via SDK.
  if (current.status === 'pending' && current.mode === 'multi_part') {
    const response: any = await notion.fileUploads.complete({
      file_upload_id: input.file_upload_id
    })
    return {
      action: 'complete',
      file_upload_id: input.file_upload_id,
      status: response.status || 'uploaded',
      completed: true
    }
  }

  // Step 4: any other state (failed, expired, single-pending, ...) is not safe to finalize.
  throw new NotionMCPError(
    `Cannot complete upload in status '${current.status}'`,
    'UNEXPECTED_STATE',
    'Check upload status with retrieve() and verify mode is multi_part if needed.'
  )
}

/**
 * Retrieve file upload details
 * Maps to: GET /v1/file_uploads/{id}
 */
async function retrieveFileUpload(notion: Client, input: FileUploadsInput): Promise<any> {
  if (!input.file_upload_id) {
    throw new NotionMCPError(
      'file_upload_id is required for retrieve action',
      'VALIDATION_ERROR',
      'Provide file_upload_id'
    )
  }

  const response: any = await notion.fileUploads.retrieve({
    file_upload_id: input.file_upload_id
  })

  return {
    action: 'retrieve',
    file_upload_id: response.id,
    status: response.status,
    filename: response.filename,
    content_type: response.content_type,
    created_time: response.created_time
  }
}

/**
 * List all file uploads
 * Maps to: GET /v1/file_uploads
 */
async function listFileUploads(notion: Client, input: FileUploadsInput): Promise<any> {
  const allResults = await autoPaginate(async (cursor) => {
    const response: any = await notion.fileUploads.list({
      start_cursor: cursor,
      page_size: 100
    })
    return {
      results: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more
    }
  })

  const results = input.limit ? allResults.slice(0, input.limit) : allResults

  return {
    action: 'list',
    total: results.length,
    file_uploads: results.map((f: any) => ({
      file_upload_id: f.id,
      filename: f.filename,
      content_type: f.content_type,
      status: f.status,
      created_time: f.created_time
    }))
  }
}
