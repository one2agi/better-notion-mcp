# Content Convert Tool - Full Documentation

## Overview
Convert: markdown-to-blocks, blocks-to-markdown.

## Note
Most tools (pages, blocks) handle markdown automatically. Use this for preview/validation only.

## Actions

### markdown-to-blocks
```json
{"direction": "markdown-to-blocks", "content": "# Heading\nParagraph\n- List item"}
```

### blocks-to-markdown
```json
{"direction": "blocks-to-markdown", "content": [{"type": "paragraph", "paragraph": {...}}]}
```

## Parameters
- `direction` - "markdown-to-blocks" or "blocks-to-markdown"
- `content` - String (markdown) or array (blocks)
