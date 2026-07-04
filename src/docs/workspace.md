# Workspace Tool - Full Documentation

## Overview
Workspace: info, search.

## Input format
Nested-object parameters (`filter`, `sort`) accept either a parsed object
**or** a JSON stringification of one. Pass the string form when the calling
MCP client serializes arguments as XML (e.g. Claude Code) — XML serialization
drops nested content, so the JSON-string workaround is required in that
environment.

## Important
- Search returns only content **shared with integration**
- Use `filter.object = "data_source"` for databases

## Actions

### info
```json
{"action": "info"}
```
Returns bot owner, workspace details.

### search
```json
{"action": "search", "query": "meeting notes", "filter": {"object": "page"}, "limit": 10}
```

Search databases:
```json
{"action": "search", "query": "tasks", "filter": {"object": "data_source"}}
```

Sort results:
```json
{"action": "search", "query": "project", "sort": {"direction": "descending", "timestamp": "last_edited_time"}}
```

## Parameters
- `query` - Search query
- `filter.object` - "page" or "data_source" (database)
- `sort.direction` - "ascending" or "descending"
- `sort.timestamp` - "last_edited_time" or "created_time"
- `limit` - Max results
