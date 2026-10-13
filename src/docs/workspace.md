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
- Use `filter.object = "data_source"` or `filter.object = "database"` for databases
- Filtering by custom page/database properties (e.g. `filter.property = "Status"`) is **not supported** by the Notion search API. To filter database records by properties, use `databases.query` instead.
- Search results automatically resolve and include `parent.title` (e.g. "Roadmap Hub", "Tasks DB", "Workspace") with intelligent caching to avoid redundant API calls.
- When the search candidate pool reaches safety limits or requested limits with more items available, the response includes `is_truncated: true` and actionable `suggestion` guidance.

## Actions

### info
```json
{"action": "info"}
```
Returns bot identity (id, name, type) and bot owner info.

### search
```json
{"action": "search", "query": "meeting notes", "filter": {"object": "page"}, "limit": 10}
```

Search databases:
```json
{"action": "search", "query": "tasks", "filter": {"object": "database"}}
```

Filter by parent:
```json
{"action": "search", "query": "milestone", "parent_id": "3de4f4cf-c8e2-80f9-acbd-dff14d6ec10e"}
```

Sort results:
```json
{"action": "search", "query": "project", "sort": {"direction": "descending", "timestamp": "last_edited_time"}}
```

## Parameters
- `query` - Search query (searches object titles)
- `parent_id` - Filter search results to direct children of a specific parent page or database ID
- `filter.object` - "page", "data_source", or "database"
- `sort.direction` - "ascending" or "descending"
- `sort.timestamp` - "last_edited_time" or "created_time"
- `limit` - Max results

## Output Fields
- `action` - Always "search"
- `query` - Query string passed
- `total` - Total results returned
- `results` - Array of search items:
  - `id` - Page or database ID
  - `object` - "page" or "data_source"
  - `title` - Extracted item title
  - `url` - Notion page/database URL
  - `last_edited_time` - ISO timestamp
  - `database_id` - Database ID for data_source objects
  - `parent` - Parent container object `{ type, id?, title? }`
- `is_truncated` - Boolean flag indicating if results were truncated due to pool or limit caps
- `suggestion` - Actionable guidance if search results were truncated
