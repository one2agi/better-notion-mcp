# Databases Tool - Full Documentation

## Overview
Database operations: create, get, query, **aggregate**, **group_by**, create_page, update_page, delete_page, create_data_source, update_data_source, update_database, list_templates, **create_view**, **list_views**, **get_view**, **update_view**, **delete_view**.

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
5. **views** -> Create, list, retrieve, update, and delete rich database views (table, board, calendar, timeline, gallery, list, form, chart)



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

### create_view
Create a new view for a database (Notion API 2025-09-03 Views Endpoints). Automatically resolves natural property names, infers configuration parameters, and applies defensive schema adaptations.

**Supported view types:**
- `table` — Tabular grid with optional `group_by`
- `board` — Kanban board grouped by status or select column
- `calendar` — Calendar view mapped to a date property
- `timeline` — Gantt / roadmap timeline with start and optional end date properties
- `gallery` — Visual card gallery with cover previews
- `list` — Compact vertical list
- `form` — Public or workspace form for survey/data collection
- `chart` — Native data visualizations (column, bar, line, donut, number KPI cards)

#### 1. Standard Views (Table, Board, Calendar, Timeline, Gallery)

**Table view with custom visible properties:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "All Active Tasks",
  "type": "table",
  "visible_properties": ["Name", "Status", "Assignee", "Due Date"],
  "filters": {"property": "Status", "status": {"does_not_equal": "Done"}},
  "sorts": [{"property": "Due Date", "direction": "ascending"}]
}
```

**Board view (Kanban) grouped by Status:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Sprint Board",
  "type": "board",
  "group_by": "Status"
}
```

**Calendar view mapped to a date property:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Editorial Calendar",
  "type": "calendar",
  "date_property": "Publish Date"
}
```

**Timeline view with start and end dates:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Project Roadmap",
  "type": "timeline",
  "date_property": "Start Date",
  "end_date_property": "End Date"
}
```

**Gallery view:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Asset Gallery",
  "type": "gallery",
  "configuration": {
    "cover": {"type": "page_cover"}
  }
}
```

#### 2. Form View
Configures form submission behavior, permissions, and anonymous submissions:
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Bug Intake Form",
  "type": "form",
  "is_form_closed": false,
  "anonymous_submissions": true,
  "submission_permissions": "read_and_write"
}
```
- `is_form_closed`: `true` to close form responses, `false` to accept responses (synonyms: `closed`, `is_closed`)
- `anonymous_submissions`: Allow anonymous respondents without requiring Notion login (synonyms: `anonymous`, `allow_anonymous`)
- `submission_permissions`: Permission level: `'none'`, `'comment_only'`, `'reader'`, `'read_and_write'`, `'editor'` (synonyms: `permissions`, `permission`, `readonly`, `edit`)

#### 3. Chart View
Visualizes database metrics directly inside Notion pages.

**Chart Types (`chart_type`):**
- `column` — Vertical bar chart
- `bar` — Horizontal bar chart
- `line` — Trend line chart (supports `cumulative`, `smooth_line`, `hide_line_fill_area`)
- `donut` — Proportional ring chart (supports `donut_labels`: `'none' | 'value' | 'name' | 'name_and_value'`)
- `number` — KPI scorecard single metric

**Column chart with aggregation and target reference line:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Revenue by Region",
  "type": "chart",
  "chart_type": "column",
  "x_axis": "Region",
  "y_axis": {"property": "Revenue", "aggregator": "sum"},
  "target": 100000,
  "color_theme": "blue"
}
```

**Stacked / Clustered Bar chart:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Tasks by Assignee & Status",
  "type": "chart",
  "chart_type": "bar",
  "x_axis": "Assignee",
  "y_axis": "count",
  "stack_by": "Status",
  "group_style": "side_by_side",
  "show_data_labels": true
}
```

**Number KPI Card:**
```json
{
  "action": "create_view",
  "database_id": "xxx",
  "name": "Total Pipeline Value",
  "type": "chart",
  "chart_type": "number",
  "value": {"property": "Deal Size", "aggregator": "sum"}
}
```

**Chart parameters:**
- `chart_type`: `'column' | 'bar' | 'line' | 'donut' | 'number'`
- `x_axis`: Property name string or object (`{"property": "Status", "sort": {"type": "manual"}}`)
- `y_axis`: Aggregation target — string property name, `"count"`, or `{"property": "Amount", "aggregator": "sum"}`
- `value`: For `number` charts — property name or `{ property, aggregator }` (defaults to count)
- `stack_by`: Property name or object to group/segment data series
- `group_style`: `'normal'` (stacked), `'percent'` (100% stacked), or `'side_by_side'` (clustered)
- `target` / `target_line`: Number or reference line object (e.g. `{"value": 50000, "label": "Q3 Target", "color": "green", "dash_style": "dash"}`)
- `reference_lines`: Array of reference line objects
- `color_theme`: `'gray' | 'blue' | 'yellow' | 'green' | 'purple' | 'teal' | 'orange' | 'pink' | 'red' | 'auto' | 'colorful'`
- `color_by_value`: Color individual categories distinctly
- `show_data_labels`: Display values directly on bars/columns
- `hide_empty_groups`: Suppress categories with zero items
- `height`: `'small' | 'medium' | 'large' | 'extra_large'`
- `legend_position`: `'off' | 'bottom' | 'side'`
- `axis_labels`: `'none' | 'x_axis' | 'y_axis' | 'both'`
- `grid_lines`: `'none' | 'horizontal' | 'vertical' | 'both'`

### list_views
List all views belonging to a database.
```json
{
  "action": "list_views",
  "database_id": "xxx",
  "limit": 10
}
```

### get_view
Retrieve full details and raw configuration of a specific view.
```json
{
  "action": "get_view",
  "view_id": "xxx"
}
```

### update_view
Update an existing view's name, filter, sorting, placement, or configuration. Automatically fetches and merges existing view settings when updating partial options.

**1. Rename and update filter/sort:**
```json
{
  "action": "update_view",
  "view_id": "xxx",
  "name": "Q3 Completed Deliverables",
  "filters": {"property": "Status", "select": {"equals": "Done"}},
  "sorts": [{"property": "Completed Date", "direction": "descending"}]
}
```

**2. Update chart options:**
```json
{
  "action": "update_view",
  "view_id": "xxx",
  "chart_type": "bar",
  "group_style": "side_by_side",
  "target": 150000
}
```

### delete_view
Permanently remove a view by its ID.
```json
{
  "action": "delete_view",
  "view_id": "xxx"
}
```

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
- `group_by` - `{ property }` (for group_by action, property must be select/multi_select/status; also used in board/table views)
- `view_id` - View ID (for get_view, update_view, delete_view)
- `name` - View display name (for create_view, update_view)
- `type` / `view_type` - View type: `table`, `board`, `calendar`, `timeline`, `gallery`, `list`, `form`, `chart`
- `configuration` - Direct view configuration object
- `visible_properties` - Array of property names to display in the view
- `date_property` / `end_date_property` - Property names for calendar/timeline date mapping
- `is_form_closed` - Close/open form submissions (for form view)
- `anonymous_submissions` - Allow anonymous form submissions (for form view)
- `submission_permissions` - Submission permission level (for form view)
- `chart_type` - Chart visual type: `column`, `bar`, `line`, `donut`, `number`
- `x_axis` / `y_axis` - Chart category and aggregation properties
- `stack_by` - Chart segmentation property
- `group_style` - Chart grouping style: `normal` (stacked), `percent`, `side_by_side` (clustered)
- `target` / `target_line` - Reference target line value or specification
- `color_theme` - Chart color palette
