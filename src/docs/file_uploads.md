# File Uploads Tool - Full Documentation

## Overview
Upload, manage, and retrieve files in Notion. Supports single and multi-part upload modes.

## Workflow

### Single-part upload (default, files ≤ 20MB)
1. `create` - Create an upload session (get file_upload_id)
2. `send` - Send file data as base64 (auto-finalizes to `status='uploaded'`)
3. (optional) `complete` - No-op for single-part; returns `note: 'Upload already finalized by send(); complete() is multi-part-only.'`
4. Use the file_upload_id in page/block content to reference the uploaded file

### Multi-part upload (files > 20MB)
1. `create` with `mode='multi_part'` and `number_of_parts` - Create an upload session
2. `send` - Send each part with `part_number` (1..N)
3. `complete` - **Required** to finalize; only valid in `status='pending'` + `mode='multi_part'`
4. Use the file_upload_id in page/block content to reference the uploaded file

> Note: Notion's `complete` endpoint is multi-part-only. Calling it on an already-uploaded session returns HTTP 400. The wrapper handles this gracefully by short-circuiting when status is already `uploaded`.

## Actions

### create
Create a file upload session.
```json
{"action": "create", "filename": "report.pdf", "content_type": "application/pdf"}
```

Multi-part upload (for large files):
```json
{"action": "create", "filename": "video.mp4", "content_type": "video/mp4", "mode": "multi_part", "number_of_parts": 3}
```

### send
Send file data (base64-encoded) to an upload session.
```json
{"action": "send", "file_upload_id": "xxx", "file_content": "<base64-encoded-data>"}
```

For multi-part uploads, specify the part number:
```json
{"action": "send", "file_upload_id": "xxx", "file_content": "<base64-encoded-data>", "part_number": 1}
```

### complete
Complete the upload session. **Multi-part only** — for single-part uploads, `send()` already finalizes the upload and this action is a safe no-op (returns a `note` field explaining the state).
```json
{"action": "complete", "file_upload_id": "xxx"}
```

### retrieve
Get details about a file upload.
```json
{"action": "retrieve", "file_upload_id": "xxx"}
```

### list
List all file uploads with optional limit.
```json
{"action": "list", "limit": 10}
```

## Parameters
- `file_upload_id` - File upload ID (required for send, complete, retrieve)
- `filename` - File name (required for create)
- `content_type` - MIME type (required for create, e.g., "image/png", "application/pdf")
- `mode` - Upload mode: "single" (default) or "multi_part"
- `number_of_parts` - Number of parts for multi-part uploads
- `part_number` - Part number when sending multi-part data
- `file_content` - Base64-encoded file content (for send)
- `limit` - Max results for list action
