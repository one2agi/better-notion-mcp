# Comments Tool - Full Documentation

## Overview
Comments: list, create.

## Threading
- Use `page_id` for new discussion
- Use `discussion_id` (from list) for replies

## Actions

### list
```json
{"action": "list", "page_id": "xxx"}
```

### create (new discussion)
```json
{"action": "create", "page_id": "xxx", "content": "Great work!"}
```

### create (reply)
```json
{"action": "create", "discussion_id": "thread-id", "content": "I agree"}
```

## Parameters
- `page_id` - Page ID
- `discussion_id` - Discussion ID (for replies)
- `content` - Comment content
