/**
 * Databases Composite Tool Type Definitions
 * Notion API 2025-09-03
 */

/**
 * Aggregation types for `aggregate` and `group_by` actions.
 * Computed client-side over the result set; no Notion API call.
 */
export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'unique_count'

export interface AggregationSpec {
  type: AggregationType
  /** Property name to aggregate over. Required for sum/avg/min/max; ignored for count/unique_count (set to any for count). */
  property?: string
  /** Output key in the results map. Defaults to `${type}_${property}` when omitted. */
  alias?: string
}

export interface DatabasesInput {
  action:
    | 'create'
    | 'get'
    | 'query'
    | 'create_page'
    | 'update_page'
    | 'delete_page'
    | 'create_data_source'
    | 'update_data_source'
    | 'update_database'
    | 'list_templates'
    | 'aggregate'
    | 'group_by'
    | 'create_view'
    | 'list_views'
    | 'get_view'
    | 'update_view'
    | 'delete_view'

  // Common params
  database_id?: string
  data_source_id?: string

  // Create database params
  parent_id?: string
  title?: string
  description?: string
  properties?: Record<string, any>
  is_inline?: boolean
  icon?: string
  cover?: string

  // Query params
  filters?: any
  filter?: any
  sorts?: any[]
  limit?: number
  search?: string

  // Aggregation params (for aggregate / group_by actions)
  aggregations?: AggregationSpec[]
  group_by?: any

  // Page operations params (create/update/delete database items)
  page_id?: string
  page_ids?: string[]
  page_properties?: Record<string, any>
  template?: string | { type: 'default' | 'none' | 'template_id'; template_id?: string; timezone?: string }
  template_id?: string

  // Bulk operations
  pages?: Array<{
    page_id?: string
    properties: Record<string, any>
    template?: string | { type: 'default' | 'none' | 'template_id'; template_id?: string; timezone?: string }
    template_id?: string
  }>

  // View operations params
  view_id?: string
  name?: string
  type?: string
  view_type?: string
  configuration?: Record<string, any>
  date_property?: string
  date_property_id?: string
  end_date_property?: string
  end_date_property_id?: string
  placement?: any
  position?: any
  visible_properties?: string[]

  // Form view params
  is_form_closed?: boolean
  closed?: boolean
  is_closed?: boolean
  anonymous_submissions?: boolean
  anonymous?: boolean
  allow_anonymous?: boolean
  submission_permissions?: 'none' | 'comment_only' | 'reader' | 'read_and_write' | 'editor' | string
  permissions?: string
  permission?: string

  // Chart view params
  chart_type?: 'column' | 'bar' | 'line' | 'donut' | 'number'
  x_axis?: any
  y_axis?: any
  value?: any
  stack_by?: any
  x_axis_property?: string
  y_axis_property?: string
  x_axis_property_id?: string
  y_axis_property_id?: string
  results_mode?: boolean
  chart_sort?: 'manual' | 'x_ascending' | 'x_descending' | 'y_ascending' | 'y_descending'
  color_theme?:
    | 'gray'
    | 'blue'
    | 'yellow'
    | 'green'
    | 'purple'
    | 'teal'
    | 'orange'
    | 'pink'
    | 'red'
    | 'auto'
    | 'colorful'
  color_by_value?: boolean
  show_data_labels?: boolean
  hide_empty_groups?: boolean
  height?: 'small' | 'medium' | 'large' | 'extra_large'
  legend_position?: 'off' | 'bottom' | 'side'
  axis_labels?: 'none' | 'x_axis' | 'y_axis' | 'both'
  grid_lines?: 'none' | 'horizontal' | 'vertical' | 'both'
  y_axis_min?: number
  y_axis_max?: number
  target?: number | { value: number; label?: string; color?: string; dash_style?: 'solid' | 'dash' }
  target_line?: number
  reference_lines?: any[]
  caption?: string
  cumulative?: boolean
  smooth_line?: boolean
  hide_line_fill_area?: boolean
  group_style?: 'stacked' | 'clustered' | 'normal' | 'percent' | 'side_by_side'
  donut_labels?: 'none' | 'value' | 'name' | 'name_and_value'
  hide_title?: boolean

  // Quick filters
  quick_filters?: any
}

export interface CreateDatabaseResponse {
  action: 'create'
  database_id: string
  data_source_id?: string
  url: string
  created: boolean
}

export interface GetDatabaseResponse {
  action: 'get'
  database_id: string
  title: string
  description: string
  url: string
  is_inline: boolean
  created_time: string
  last_edited_time: string
  data_source: {
    id: string
    name: string
  } | null
  schema: Record<string, any>
}

export interface QueryDatabaseResponse {
  action: 'query'
  database_id: string
  data_source_id: string
  total: number
  results: Record<string, any>[]
}

export interface CreateDatabasePageResponse {
  action: 'create_page'
  database_id: string
  data_source_id: string
  processed: number
  results: {
    page_id: string
    url: string
    created: boolean
  }[]
}

export interface UpdateDatabasePageResponse {
  action: 'update_page'
  processed: number
  results: {
    page_id: string
    updated: boolean
  }[]
}

export interface DeleteDatabasePageResponse {
  action: 'delete_page'
  processed: number
  results: {
    page_id: string
    deleted: boolean
  }[]
}

export interface CreateDataSourceResponse {
  action: 'create_data_source'
  data_source_id: string
  database_id: string
  created: boolean
}

export interface UpdateDataSourceResponse {
  action: 'update_data_source'
  data_source_id: string
  updated: boolean
}

export interface UpdateDatabaseResponse {
  action: 'update_database'
  database_id: string
  updated: boolean
}

export interface ListDataSourceTemplatesResponse {
  action: 'list_templates'
  database_id: string
  data_source_id: string
  total: number
  templates: {
    template_id: string
    title: string
    properties: any
  }[]
}

export interface CreateViewActionResponse {
  action: 'create_view'
  view_id: string
  name: string
  type: string
  url?: string
  database_id?: string
  data_source_id?: string
  created: boolean
  view: any
}

export interface ListViewsActionResponse {
  action: 'list_views'
  database_id: string
  data_source_id?: string
  total: number
  views: Array<{
    id: string
    name: string
    type: string
    url?: string
  }>
}

export interface GetViewActionResponse {
  action: 'get_view'
  view_id: string
  name: string
  type: string
  url?: string
  data_source_id?: string
  configuration?: any
  filter?: any
  sorts?: any
  view: any
}

export interface UpdateViewActionResponse {
  action: 'update_view'
  view_id: string
  updated: boolean
  view: any
}

export interface DeleteViewActionResponse {
  action: 'delete_view'
  view_id: string
  deleted: boolean
}

export interface AggregateDatabaseResponse {
  action: 'aggregate'
  database_id: string
  data_source_id?: string
  total_rows_scanned: number
  results: Record<string, number | null>
}

export interface GroupByDatabaseResponse {
  action: 'group_by'
  database_id: string
  data_source_id?: string
  total_rows_scanned: number
  group_by_property: string
  groups: Array<{
    key: string | null
    count: number
    aggregations: Record<string, number | null>
  }>
}

export type DatabasesResponse =
  | CreateDatabaseResponse
  | GetDatabaseResponse
  | QueryDatabaseResponse
  | AggregateDatabaseResponse
  | GroupByDatabaseResponse
  | CreateDatabasePageResponse
  | UpdateDatabasePageResponse
  | DeleteDatabasePageResponse
  | CreateDataSourceResponse
  | UpdateDataSourceResponse
  | UpdateDatabaseResponse
  | ListDataSourceTemplatesResponse
  | CreateViewActionResponse
  | ListViewsActionResponse
  | GetViewActionResponse
  | UpdateViewActionResponse
  | DeleteViewActionResponse
