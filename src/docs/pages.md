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
{"action": "get_property", "page_id": "xxx", "property_id": "prop_id_or_name"}
```
Accepts either canonical property IDs or human-readable property names (including non-ASCII/Chinese names). For empty properties, returns a typed fallback value (e.g. `""` for rich text, `[]` for relations, `null` for select) instead of dropping fields.

### update
Update page metadata, properties, and/or content in a single call.
```json
{
  "action": "update",
  "page_id": "xxx",
  "properties": {
    "Status": "Done",
    "Source URL": ""
  },
  "cover": "none",
  "content": "## Updated Content",
  "replace": true
}
```
- **Clearing properties**: Pass `""` or `null` to clear fields (URL, email, phone, date, number, select, status, relation, people, files).
- **Clearing cover**: Pass `cover: "none"` or `null` to remove page cover.
- **Read-only property safety**: Server-managed properties (e.g. `Last edited time`, `formula`, `rollup`) are safely filtered out, and reported in the response under `ignored_properties`.
- **Content aliases**: Accepts `content`, `markdown`, or `new_str`.

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

## Markdown Support & High-Fidelity Engine

All primary page write actions (`create`, `replace_content`, `update` with `content`, and `blocks: append`) are backed by our client-side unified high-fidelity AST engine (`markdownToBlocks`). This guarantees 100% fidelity without silent demotion:

- **Bookmarks**: `[bookmark](url "caption")` and `[书签](url)` create native Notion bookmark preview blocks.
- **Toggles**: `<details><summary>## Heading 2 Toggle</summary>body</details>` create native heading toggles with `##` cleanly stripped.
- **Clean Callouts**: Both GitHub alert syntax `> [!NOTE]` and native HTML `<callout color="default" icon="💡">` create elegant callouts. Default background color is `default` (clean transparent/border card instead of harsh saturated color), with optional inline attributes `{color="..." icon="..."}` for custom styling.
- **Rich Elements**: Tables, code blocks, dividers, equations ($$), and nested lists are fully supported with complete AST fidelity.

### replace_content
**DESTRUCTIVE.** Overwrite the entire page content with a single markdown string using the client-side high-fidelity AST engine.
```json
{"action": "replace_content", "page_id": "xxx", "new_str": "# New Page\n\n[bookmark](https://github.com \"GitHub\")"}
```
- Required: `new_str` (the full new markdown). Accepts `content` or `markdown` as aliases.
- Optional: `allow_deleting_content` (defaults to `true`).
Existing blocks are cleared, and new content is parsed and appended via client-side AST in batches of <= 100 blocks. Block IDs from old content are **lost** — use this for full rewrites where rich content fidelity is required.

## Server-Side Markdown Actions (Notion API 2025-09-03 + SDK v5.22+)

Actions that use **Notion server-side markdown endpoints** (`get_markdown`, `insert_markdown`, `update_content`, `replace_content_range`). These are fast, atomic, and preserve existing **block IDs** (so comments/reactions on untouched blocks survive edits).

Requires integration token to be issued against Notion API 2025-09-03 or later. Older tokens fall back to SDK error.

> **Note on Server-Side Parser**: The server-side write endpoints (`insert_markdown`, `update_content`, `replace_content_range`) rely on Notion's hosted markdown engine, which only supports standard CommonMark and may demote special blocks (like `[bookmark]`) to plain text/links. For rich-content operations, use `replace_content`, `update`, or `blocks.append`.

### get_markdown
Render the whole page as a single markdown string.
```json
{"action": "get_markdown", "page_id": "xxx"}
```
**Faster than `get`** for long pages: skips per-block JSON parsing. Unknown bookmark placeholders like `<unknown alt="bookmark"/>` are automatically normalized to `[bookmark](url)` for seamless round-trip fidelity.
Response: `{ markdown: "...", truncated: false, unknown_block_ids: [] }`

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
Replace markdown within a specific range anchor (Notion API 2025-09-03 range format).
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
| Overwrite whole page with rich content (bookmarks, toggles, callouts) | `replace_content` |
| Add rich content to end or update properties | `update` (with `content`, `replace: false`) |
| Add text to start/end in-place (preserves block IDs) | `insert_markdown` |
| Change specific phrases/words | `update_content` (search & replace) |
| Replace a specific known range | `replace_content_range` |
| Modify a single block in place | `blocks: update` |

For rich content with `[bookmark]`/toggles/callouts, use `pages.create`, `pages.replace_content`, `pages.update` + `content`, or `blocks.append`.
