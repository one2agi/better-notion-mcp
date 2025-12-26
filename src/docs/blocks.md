# Blocks Tool - Full Documentation

## Overview
Block-level content: get, children, append, update, delete.

## Important
- **Page IDs are valid block IDs** (page is root block)
- Use for **precise edits** within pages
- For full page content, use pages tool instead

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

### delete
```json
{"action": "delete", "block_id": "block-id"}
```

## Parameters
- `block_id` - Block ID (required)
- `content` - Markdown content (for append/update)
