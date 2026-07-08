# Pages Tool - Full Documentation

## Overview
Page lifecycle: create, get, get_property, update, move, archive, restore, duplicate.

## Input format

The `properties`, `updates`, `filters`, and any other nested-object parameters accept either a parsed object/array **or** a JSON stringification of one. Pass the string form when the calling MCP client serializes arguments as XML (e.g. Claude Code) — XML serialization drops nested content, so `'{"Name":"Task"}'` is the supported workaround. Primitive values (strings, numbers, booleans) and enums are passed as-is.

Example — these are equivalent:
```json
{"action": "create", "parent_id": "x", "title": "T", "properties": {"Name": "T", "Count": 42}}
```
```json
{"action": "create", "parent_id": "x", "title": "T", "properties": "{\"Name\":\"T\",\"Count\":42}"}
```

## Important
- **parent_id required** for create (cannot create workspace-level pages)
- Returns **markdown content** for get action
- **get_property** supports paginated properties (relation, rollup, rich_text, people)

## Reading Images & Files in Pages
Pages may contain **image blocks** and **file blocks**. These are returned as markdown with signed URLs:

- **Images**: `![caption](https://prod-files-secure.s3.amazonaws.com/...)` — signed S3 URL, expires in 1 hour
- **Files**: Returned as blocks with download URLs in `blocks/children` response

**To read image content**: Fetch the signed URL directly — multimodal LLMs can view the image. The URL is a standard HTTPS link, no auth needed (signature is embedded).

**To read document content** (PDF, DOCX, etc.): Download the file via the signed URL, then use appropriate tools to parse content (e.g., Read tool for images, WebFetch for downloading).

**Important**: Signed URLs expire after ~1 hour. If you need to access a file later, fetch `blocks/get` again to get a fresh URL.

## Actions

### create
```json
{"action": "create", "title": "Meeting Notes", "parent_id": "xxx", "content": "# Agenda\n- Item 1"}
```

### get
```json
{"action": "get", "page_id": "xxx"}
```
Returns all properties including: title, rich_text, select, multi_select, number, checkbox, url, email, phone_number, date, relation, rollup, people, files, formula, created_time, last_edited_time, created_by, last_edited_by, status, unique_id.

### get_property
Retrieve a single page property item with auto-pagination for large properties.
```json
{"action": "get_property", "page_id": "xxx", "property_id": "prop_id"}
```
Use this for paginated properties like relation, rollup, rich_text, or people that may exceed inline limits.

### update
```json
{"action": "update", "page_id": "xxx", "append_content": "\n## New Section"}
```

### move
Move a page to a new parent page.
```json
{"action": "move", "page_id": "xxx", "parent_id": "new_parent_id"}
```

### archive
```json
{"action": "archive", "page_ids": ["xxx", "yyy"]}
```

### restore
```json
{"action": "restore", "page_id": "xxx"}
```

### duplicate
```json
{"action": "duplicate", "page_id": "xxx"}
```

## Parameters
- `page_id` - Page ID (required for most actions)
- `page_ids` - Multiple page IDs for batch operations
- `title` - Page title
- `content` - Markdown content
- `append_content` - Markdown to append
- `parent_id` - Parent page or database ID
- `properties` - Page properties (for database pages)
- `property_id` - Property ID (required for get_property action)
- `icon` - Emoji, external URL (`https://...`), or built-in shorthand (`name:color`, e.g. `document:gray`)
- `cover` - External URL (`https://...`) or built-in shorthand (e.g. `gradient_1`, `solid_beige`, `nasa_carina_nebula`)
- `archived` - Archive status (boolean, for update action)

## Markdown-Native Actions (Notion API 2025-09-03 + SDK v5.22+)

Five additional actions use **server-side markdown endpoints** instead of
block-append round-trips. They are **faster**, **atomic**, and preserve
**block IDs** (so comments/reactions on the original blocks survive edits).

Requires integration token to be issued against Notion API 2025-09-03
or later. Older tokens fall back to SDK error.

### get_markdown
Render the whole page as a single markdown string.
```json
{"action": "get_markdown", "page_id": "xxx"}
```
**Faster than `get`** for long pages: skips per-block JSON parsing.
Response: `{ markdown: "...", truncated: false, unknown_block_ids: [] }`

### Server-side vs client-side parser

The 3 write actions replace_content / insert_markdown / update_content use Notion server-side markdown parsing — NOT this MCP client parser. Special block syntax is silently demoted:

- `[bookmark](url)` - demotes to paragraph link
- `[embed](url)` - demotes to paragraph link
- `[toc]` - demotes to paragraph
- `> [!unsupported_callout_type]` - demotes to plain quote

For these features, use `blocks.append` (or `pages.update` + `content`) instead.

### replace_content
**DESTRUCTIVE.** Overwrite the entire page content with a single markdown string.
```json
{"action": "replace_content", "page_id": "xxx", "new_str": "# New Page\n\nAll old content is gone."}
```
Required: `new_str` (the full new markdown).
Optional: `allow_deleting_content` (defaults to `true`).
Block IDs from old content are **lost** — only use this for full rewrites.

### insert_markdown
Insert markdown at a specific position (does not touch existing content).
```json
{"action": "insert_markdown", "page_id": "xxx", "content": "## P.S.\n\nAppended note.", "position": "end"}
```
- `content` (required) - markdown to insert
- `position` - `"start"` | `"end"` (default `"end"`)
- `after_block_id` (optional) - insert immediately AFTER this specific block ID (overrides `position`)

### update_content
**Server-side search & replace.** Best for surgical edits like "change Q1 → Q2".
```json
{
  "action": "update_content",
  "page_id": "xxx",
  "updates": [
    {"old_str": "Q1 2026", "new_str": "Q2 2026"},
    {"old_str": "draft", "new_str": "final", "replace_all_matches": true}
  ]
}
```
- `updates` (required) - Array of `{ old_str, new_str, replace_all_matches? }`
- Without `replace_all_matches`, only first occurrence is replaced per entry
- Other content is untouched; block IDs preserved
- Allowed only for text-like content; media URLs may not match if Notion re-hosts them

### replace_content_range
Replace markdown within a specific range anchor (Notion API 2025-09-03
range format).
```json
{
  "action": "replace_content_range",
  "page_id": "xxx",
  "content_range": "start_anchor...end_anchor",
  "content": "new markdown here"
}
```
- `content` (required) - replacement markdown
- `content_range` (required) - Notion API range string identifying the slice to replace

### When to use which

| Goal | Best action |
|---|---|
| Read whole page as text | `get_markdown` |
| Replace whole page (atomically) | `replace_content` |
| Add to start/end of page | `insert_markdown` |
| Change specific phrases/words | `update_content` (search & replace) |
| Replace a specific known range | `replace_content_range` |
| Modify a single block in place | `blocks: update` |

For `[bookmark]`/`[embed]`/`[toc]` content, use `blocks.append` (or `pages.update` + `content`) - see server vs client note above.
