# Databases Tool - Full Documentation

## Overview
Database operations: create, get, query, **aggregate**, **group_by**, create_page, update_page, delete_page, create_data_source, update_data_source, update_database, list_templates.

## Architecture
- **Database** = container holding one or more data sources
- **Data Source** = has schema (properties) and rows (pages)

## Input format
Nested-object / array parameters (`properties`, `page_properties`, `pages`,
`filters`, `sorts`, `aggregations`, `group_by`) accept either a parsed
object/array **or** a JSON stringification of one. Pass the string form when
the calling MCP client serializes arguments as XML (e.g. Claude Code) — XML
serialization drops nested content, so the JSON-string workaround is required
in that environment.

Example:
```json
{
  "action": "query",
  "database_id": "xxx",
  "filters": "{\"property\":\"Status\",\"select\":{\"equals\":\"Active\"}}"
}
```

## Workflow
1. create -> Creates database + initial data source
2. get -> Retrieves data_source_id
3. query/create_page/update_page -> Uses data_source_id (auto-fetched)
4. **aggregate / group_by** -> Walks the entire data source with auto-pagination, computes analytics client-side after fetch



## Actions

### create
Create a new database with initial data source. Supports ergonomic property schema declarations (e.g. `{ type: "title" }`, `"title"`, `{ select: ["Todo", "Done"] }`, `{ type: "select", options: ["Todo", "Done"] }`, or `"checkbox"`):
```json
{
  "action": "create",
  "parent_id": "xxx",
  "title": "Tasks",
  "properties": {
    "Name": { "type": "title" },
    "Status": { "type": "select", "options": ["Todo", "Done"] },
    "Completed": "checkbox",
    "Estimate": "number"
  }
}
```

### get
```json
{"action": "get", "database_id": "xxx"}
```

### query
```json
{"action": "query", "database_id": "xxx", "filters": {"property": "Status", "select": {"equals": "Done"}}}
```

### aggregate
Compute one or more analytics over a single property across **every row** in the data source. No filters, no manual rollup — `aggregate` walks every page and reduces.

```json
{
  "action": "aggregate",
  "database_id": "xxx",
  "aggregations": [
    {"type": "count", "alias": "total"},
    {"type": "count", "property": "Status", "alias": "done_count"},
    {"type": "sum", "property": "Hours", "alias": "total_hours"},
    {"type": "avg", "property": "Hours", "alias": "avg_hours"},
    {"type": "min", "property": "Hours"},
    {"type": "max", "property": "Hours"},
    {"type": "unique_count", "property": "Owner", "alias": "unique_owners"}
  ]
}
```

**Aggregation types:**
- `count` — number of rows (omit `property` for total, or set to a specific property to count non-null values)
- `sum`, `avg`, `min`, `max` — numeric only (other types silently skipped per row)
- `unique_count` — number of distinct values (works for select, multi_select, people, rich_text, date)

Each aggregation accepts an optional `alias` for the result key. Response: `{ aggregations: { alias_or_type_property: value, ... }, total_rows_scanned: 42 }`.

**Performance note:** For very large data sources (>5k rows) consider exporting with an explicit filter via `query` first, then `aggregate` over the smaller dataset.

### group_by
Group rows by a property value and compute per-group aggregations. Use for breakdowns like "tasks per owner" or "sum of revenue per region".

- `group_by`: accepts either a property name string shorthand (e.g. `"Status"`) or object `{"property": "Status"}`.
- `aggregations`: optional! If omitted or empty, automatically defaults to `[{"type": "count"}]`.

```json
{
  "action": "group_by",
  "database_id": "xxx",
  "group_by": "Status"
}
```

Or with custom aggregations:
```json
{
  "action": "group_by",
  "database_id": "xxx",
  "group_by": {"property": "Status"},
  "aggregations": [
    {"type": "count", "alias": "n"},
    {"type": "sum", "property": "Hours", "alias": "hours"}
  ]
}
```

`group_by.property` must be a `select`, `multi_select`, or `status` type. Response:
```json
{
  "groups": [
    {"key": "Todo", "n": 5, "hours": 12.5},
    {"key": "Done", "n": 8, "hours": 24.0}
  ],
  "total_rows_scanned": 13
}
```

### create_page
Create pages in a database. Supports flat object rows, property aliases, and initial Markdown body content (One-Call Closure):

**1. Batch create with flat objects and Markdown body:**
```json
{
  "action": "create_page",
  "database_id": "xxx",
  "pages": [
    {"Name": "Task 1", "Status": "Todo", "content": "# Scope\nInitial requirements..."},
    {"Name": "Task 2", "Status": "In Progress"}
  ]
}
```

**2. Single page create with `properties` alias and `content`:**
```json
{
  "action": "create_page",
  "database_id": "xxx",
  "properties": {"Name": "Bug Report", "Severity": "High"},
  "content": "> [!IMPORTANT]\n> Production incident reproduction steps"
}
```

### update_page
Update database pages (supports single page, homogeneous batch, and heterogeneous batch with auto-adaptation):

**1. Homogeneous batch update (same properties for multiple pages):**
```json
{
  "action": "update_page",
  "database_id": "xxx",
  "page_ids": ["page-1", "page-2"],
  "page_properties": {"Status": "Done"}
}
```

**2. Heterogeneous batch update (different properties per page with auto-adaptation):**
```json
{
  "action": "update_page",
  "database_id": "xxx",
  "pages": [
    {"page_id": "page-1", "Status": "Done"},
    {"id": "page-2", "properties": {"Status": "In Progress"}}
  ]
}
```

**3. Single page update:**
```json
{"action": "update_page", "page_id": "yyy", "page_properties": {"Status": "Done"}}
```

> **Performance tip**: Providing `database_id` automatically activates single-pass Schema pre-resolution, sharing the column mapping across all batch items and cutting API network round-trips by ~50%.

### delete_page
Bulk archive / soft-delete pages. Accepts string array or JSON-stringified array via `page_ids`, or heterogeneous array via `pages`:
```json
{"action": "delete_page", "page_ids": ["yyy", "zzz"]}
```
Or via `pages`:
```json
{"action": "delete_page", "pages": [{"id": "yyy"}, "zzz"]}
```

### update_database
Update database container metadata. To update schema properties, use `update_data_source` instead.
```json
{"action": "update_database", "database_id": "xxx", "title": "Updated Title", "icon": "clipboard"}
```

### create_data_source
```json
{"action": "create_data_source", "database_id": "xxx", "title": "Q2 Data", "properties": {"Status": {"select": {"options": [{"name": "Active"}]}}}}
```

### update_data_source
```json
{"action": "update_data_source", "data_source_id": "xxx", "title": "Renamed Source", "properties": {"Status": {"select": {"options": [{"name": "Active"}, {"name": "Archived"}]}}}}
```

### list_templates
List all templates for a database's data source.
```json
{"action": "list_templates", "database_id": "xxx"}
```
Optionally specify `data_source_id` to target a specific data source (defaults to first).

## Parameters
- `database_id` - Database ID
- `data_source_id` - Data source ID
- `parent_id` - Parent page ID (for create/update_database)
- `title` - Title (for database or data source)
- `description` - Description
- `properties` - Schema properties (for create/update data source)
- `is_inline` - Display as inline (boolean, for create/update_database)
- `icon` - Emoji, external URL (`https://...`), or built-in shorthand (`name:color`, e.g. `document:gray`) (for update_database)
- `cover` - External URL (`https://...`) or built-in shorthand (e.g. `gradient_1`, `solid_beige`, `nasa_carina_nebula`) (for update_database)
- `filters` / `sorts` / `limit` - Query options
- `search` - Smart search across text fields
- `page_id` - Single page ID (for update_page)
- `page_ids` - Multiple page IDs (for delete_page)
- `page_properties` - Properties to update (for update_page)
- `pages` - Array of pages for bulk operations
- `aggregations` - Array of `{ type, property?, alias? }` (for aggregate / group_by)
- `group_by` - `{ property }` (for group_by action, property must be select/multi_select/status)
