# Blocks Tool - Full Documentation

## Overview
Block-level content: get, children, append, update, delete.

## Important
- **Page IDs are valid block IDs** (page is root block)
- Use for **precise edits** within pages
- For full page content, use pages tool instead

## Supported Block Types
The markdown converter supports these Notion block types:

| Block Type | Markdown Syntax |
|------------|----------------|
| Headings (1-3) | `# H1`, `## H2`, `### H3` |
| Paragraph | Plain text |
| Bulleted list | `- item` or `* item` |
| Numbered list | `1. item` |
| To-do / Checkbox | `- [ ] task` or `- [x] done` |
| Code block | `` ```language `` ... `` ``` `` |
| Quote | `> text` |
| Divider | `---` or `***` |
| Callout | `> [!NOTE] text`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]`, `> [!INFO]`, `> [!SUCCESS]`, `> [!ERROR]`, `> [!DANGER]` (red_background, alias of ERROR). Multi-line: each line must start with `> `. Avoid CAUTION (emoji rejected by Notion). |
| Toggle | `<details><summary>Title</summary>content</details>`. No nesting (toggle inside toggle fails). |
| Table | Pipe-delimited `\| col1 \| col2 \|` with optional header separator |
| Image | `![alt text](url)` — signed S3 URL (1h expiry), fetch to view content |
| Bookmark | `[bookmark](url)` |
| Embed | `[embed](url)` |
| Equation | `$$expression$$` (inline) or `$$\n...\n$$` (multi-line) |
| Columns | `:::columns` / `:::column` / `:::end` (optional width: `:::column{width=0.7}`) |
| Table of Contents | `[toc]` |
| Breadcrumb | `[breadcrumb]` |

## Rich Text Formatting
Inline formatting within any text content:
- **Bold**: `**text**`
- *Italic*: `*text*`
- `Code`: `` `text` ``
- ~~Strikethrough~~: `~~text~~`
- Links: `[text](url)`
- Page mentions: `@[Page Title](page-id)` - creates an inline @mention, not a hyperlink

## Layout Guide

### Columns

```
:::columns
:::column
Left content
:::column
Right content
:::end
```

Rules:
- `:::column` implicitly closes the previous column. Do NOT add `:::end` between columns.
- Only ONE `:::end` at the very end closes the entire column_list.
- Set width with `:::column{width=0.7}` (decimal 0-1). Ratios should sum to 1.

### Nesting depth limit

Notion API allows max 2 nesting levels per append call. A column with rich content like callouts or toggles exceeds this (`column_list > column > callout > children` = 4 levels).

**Workaround - append in multiple calls:**

1. Append the column_list with simple placeholder content (e.g. paragraphs):
```
:::columns
:::column{width=0.7}
Placeholder
:::column{width=0.3}
Placeholder
:::end
```

2. Read back the page blocks to get each column's block_id.

3. Replace each column's content individually using `update` or `delete` + `append` on the column block_id. Each call is now only 1 level deep (callout or toggle directly inside column).

## Actions

### get
```json
{"action": "get", "block_id": "xxx"}
```

### children
```json
{"action": "children", "block_id": "xxx"}
```
Returns markdown of child blocks.

### append
```json
{"action": "append", "block_id": "page-id", "content": "## New Section\nParagraph text"}
```

### update
```json
{"action": "update", "block_id": "block-id", "content": "Updated text"}
```

## Update Modes (content vs properties)

`blocks.update` accepts **mutually exclusive** inputs:

- **`content`** — markdown string → parsed to a Notion block. Use for text-rich
  block types (paragraph, headings, lists, quote, to_do, code, toggle, callout,
  template). Markdown type MUST match the existing block type, otherwise the
  update errors.
- **`properties`** — direct field object → sent straight to the SDK. Use for
  structural block types that have no markdown representation (table,
  table_row, column, synced_block, link_to_page).

Passing both → error. Passing neither → error.

Note: this action uses the CLIENT-side markdown parser, so `[bookmark](url)`, `[embed](url)`, `[toc]`, and `> [!DANGER]` callouts all work. (The server-side parser used by `pages.replace_content` does NOT support these; see that section in pages.md.)

### Updateable block types

**Group A (text-rich via `content`):** paragraph, heading_1/2/3/4, bulleted_list_item, numbered_list_item, quote, to_do, code, **toggle**, **callout**, **template**

Markdown syntax for the newly-addable types:
| Block | Markdown |
|---|---|
| `heading_4` | `#### text` |
| `toggle` | `<details><summary>Title</summary>body</details>` |
| `callout` | `> [!TIP] text` (NOTE/TIP/WARNING/IMPORTANT/INFO/SUCCESS/ERROR) |
| `template` | *no markdown syntax — use `properties` instead* |

**Group B (structural via `properties`):** `table`, `table_row`, `column`, `synced_block`, `link_to_page`

| Block | properties shape | Notes |
|---|---|---|
| `table` | `{ has_column_header?: bool, has_row_header?: bool }` | Pass-through |
| `table_row` | `{ cells: string[][] \| RichText[][] }` | `string[][]` auto-converts to `RichText[][]` via `parseRichText` |
| `column` | `{ width_ratio: number }` | Validated `0 < x <= 1` |
| `synced_block` | `{ synced_from: { block_id } \| null }` | `null` unlinks |
| `link_to_page` | `{ page_id } \| { database_id } \| { comment_id }` | Exactly one target; comment_id is a valid target per the SDK |

Examples:
```json
// change table style
{"action": "update", "block_id": "table-1", "properties": {"has_column_header": true}}

// replace table row cells
{"action": "update", "block_id": "row-1", "properties": {"cells": [["A","B"],["C","D"]]}}

// set column width
{"action": "update", "block_id": "col-1", "properties": {"width_ratio": 0.7}}

// re-point synced_block to a new source
{"action": "update", "block_id": "sb-1", "properties": {"synced_from": {"block_id": "src-block-id"}}}

// unlink synced_block (clears the synced reference)
{"action": "update", "block_id": "sb-1", "properties": {"synced_from": null}}

// change link_to_page target to a page
{"action": "update", "block_id": "lp-1", "properties": {"page_id": "new-page-id"}}
```

**Omit-preserves-existing semantics**: in `content` mode, missing optional
fields (e.g., callout `icon`/`color`, heading_4 `color`/`is_toggleable`) carry
forward the existing block's values instead of being cleared. Pass an explicit
new value via the markdown syntax to override.

### delete
```json
{"action": "delete", "block_id": "block-id"}
```

## Reading Images & Files from Blocks

When `children` or `get` returns image/file blocks:

### Images
- Rendered as `![caption](signed-url)` in markdown output
- The `signed-url` is a direct HTTPS link to the image (no additional auth required)
- **To view image content**: Fetch/read the URL directly — it returns the raw image bytes
- URL format: `https://prod-files-secure.s3.us-west-2.amazonaws.com/...` with embedded AWS signature
- **Expiry**: ~1 hour. Call `blocks/get` again to get a fresh URL if expired

### Files (PDF, DOCX, etc.)
- Appear as `file` type blocks in the raw `blocks` array
- Access via `block.file.file.url` (Notion-hosted) or `block.file.external.url` (external)
- **To read file content**: Download the signed URL, then parse with appropriate tools
- Same 1-hour expiry applies for Notion-hosted files

### Example: Reading an image from a page
1. `blocks/children` with page_id → find image blocks in response
2. Get URL from `![](url)` in markdown or `block.image.file.url` in raw blocks
3. Fetch the URL to view/analyze the image

## Parameters
- `block_id` - Block ID (required)
- `content` - Markdown content (for append/update)
