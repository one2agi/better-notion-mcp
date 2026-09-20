/**
 * Database Views Orchestration
 * Notion API 2025-09-03 Views Endpoints
 */

import type { Client } from '@notionhq/client'
import { getDataSourceSchema, resolveDataSourceId } from '../../helpers/data-source.js'
import { NotionMCPError } from '../../helpers/errors.js'
import { normalizeId } from '../../helpers/id.js'
import { parseMaybeJSON } from '../../helpers/json-input.js'
import { autoPaginate } from '../../helpers/pagination.js'
import { buildViewConfiguration } from '../../helpers/view-config.js'
import { resolveDatabaseFilter } from './query-helpers.js'
import type {
  CreateViewActionResponse,
  DatabasesInput,
  DeleteViewActionResponse,
  GetViewActionResponse,
  ListViewsActionResponse,
  UpdateViewActionResponse
} from './types.js'

/**
 * Assemble flat and ergonomic view parameters into raw configuration dictionary.
 */
export function buildViewRawConfig(
  input: DatabasesInput,
  parsedConfig?: Record<string, any>,
  visibleProps?: string[]
): Record<string, any> {
  const formClosed = input.is_form_closed ?? input.closed ?? input.is_closed
  const anonSub = input.anonymous_submissions ?? input.anonymous ?? input.allow_anonymous
  const subPerm = input.submission_permissions ?? input.permissions ?? input.permission
  const targetVal = input.target ?? input.target_line
  const xAxis = input.x_axis ?? input.x_axis_property ?? input.x_axis_property_id
  const yAxis = input.y_axis ?? input.y_axis_property ?? input.y_axis_property_id
  const chartSort = input.chart_sort

  const raw: Record<string, any> = {
    ...(parsedConfig || {}),
    ...(input.group_by ? { group_by: input.group_by } : {}),
    ...(input.date_property ? { date_property: input.date_property } : {}),
    ...(input.date_property_id ? { date_property_id: input.date_property_id } : {}),
    ...(input.end_date_property ? { end_date_property: input.end_date_property } : {}),
    ...(input.end_date_property_id ? { end_date_property_id: input.end_date_property_id } : {}),
    ...(visibleProps ? { visible_properties: visibleProps } : {}),
    // Form params
    ...(formClosed !== undefined ? { is_form_closed: formClosed } : {}),
    ...(anonSub !== undefined ? { anonymous_submissions: anonSub } : {}),
    ...(subPerm !== undefined ? { submission_permissions: subPerm } : {}),
    // Chart params
    ...(input.chart_type ? { chart_type: input.chart_type } : {}),
    ...(xAxis !== undefined ? { x_axis: xAxis } : {}),
    ...(yAxis !== undefined ? { y_axis: yAxis } : {}),
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.stack_by !== undefined ? { stack_by: input.stack_by } : {}),
    ...(input.color_theme ? { color_theme: input.color_theme } : {}),
    ...(input.color_by_value !== undefined ? { color_by_value: input.color_by_value } : {}),
    ...(input.show_data_labels !== undefined ? { show_data_labels: input.show_data_labels } : {}),
    ...(input.hide_empty_groups !== undefined ? { hide_empty_groups: input.hide_empty_groups } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.legend_position ? { legend_position: input.legend_position } : {}),
    ...(input.axis_labels ? { axis_labels: input.axis_labels } : {}),
    ...(input.grid_lines ? { grid_lines: input.grid_lines } : {}),
    ...(input.y_axis_min !== undefined ? { y_axis_min: input.y_axis_min } : {}),
    ...(input.y_axis_max !== undefined ? { y_axis_max: input.y_axis_max } : {}),
    ...(targetVal !== undefined ? { target: targetVal } : {}),
    ...(input.reference_lines ? { reference_lines: input.reference_lines } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.cumulative !== undefined ? { cumulative: input.cumulative } : {}),
    ...(input.smooth_line !== undefined ? { smooth_line: input.smooth_line } : {}),
    ...(input.hide_line_fill_area !== undefined ? { hide_line_fill_area: input.hide_line_fill_area } : {}),
    ...(input.group_style ? { group_style: input.group_style } : {}),
    ...(input.donut_labels ? { donut_labels: input.donut_labels } : {}),
    ...(input.hide_title !== undefined ? { hide_title: input.hide_title } : {})
  }

  if (chartSort !== undefined) {
    raw.sort = typeof chartSort === 'object' && (chartSort as any)?.type ? chartSort : { type: chartSort }
  }

  delete raw.chart_sort
  delete raw.x_axis_property
  delete raw.x_axis_property_id
  delete raw.y_axis_property
  delete raw.y_axis_property_id
  delete raw.results_mode

  return raw
}

/**
 * Check if the input contains any view configuration parameters.
 */
export function hasViewConfigInput(
  input: DatabasesInput,
  parsedConfig?: Record<string, any>,
  visibleProps?: string[]
): boolean {
  if (parsedConfig && Object.keys(parsedConfig).length > 0) return true
  if (visibleProps && visibleProps.length > 0) return true
  return (
    input.group_by !== undefined ||
    input.date_property !== undefined ||
    input.date_property_id !== undefined ||
    input.end_date_property !== undefined ||
    input.end_date_property_id !== undefined ||
    input.is_form_closed !== undefined ||
    input.closed !== undefined ||
    input.is_closed !== undefined ||
    input.anonymous_submissions !== undefined ||
    input.anonymous !== undefined ||
    input.allow_anonymous !== undefined ||
    input.submission_permissions !== undefined ||
    input.permissions !== undefined ||
    input.permission !== undefined ||
    input.chart_type !== undefined ||
    input.x_axis !== undefined ||
    input.y_axis !== undefined ||
    input.value !== undefined ||
    input.stack_by !== undefined ||
    input.x_axis_property !== undefined ||
    input.y_axis_property !== undefined ||
    input.x_axis_property_id !== undefined ||
    input.y_axis_property_id !== undefined ||
    input.chart_sort !== undefined ||
    input.color_theme !== undefined ||
    input.color_by_value !== undefined ||
    input.show_data_labels !== undefined ||
    input.hide_empty_groups !== undefined ||
    input.height !== undefined ||
    input.legend_position !== undefined ||
    input.axis_labels !== undefined ||
    input.grid_lines !== undefined ||
    input.y_axis_min !== undefined ||
    input.y_axis_max !== undefined ||
    input.target !== undefined ||
    input.target_line !== undefined ||
    input.reference_lines !== undefined ||
    input.caption !== undefined ||
    input.cumulative !== undefined ||
    input.smooth_line !== undefined ||
    input.hide_line_fill_area !== undefined ||
    input.group_style !== undefined ||
    input.donut_labels !== undefined ||
    input.hide_title !== undefined
  )
}

/**
 * Create a view for a database / data source
 * Maps to: POST /v1/views (API 2025-09-03)
 */
export async function createView(notion: Client, input: DatabasesInput): Promise<CreateViewActionResponse> {
  if (!input.database_id && !input.data_source_id) {
    throw new NotionMCPError(
      'database_id or data_source_id required for create_view action',
      'VALIDATION_ERROR',
      'Provide database_id or data_source_id'
    )
  }

  const name = input.name || input.title
  if (!name) {
    throw new NotionMCPError('name required for create_view action', 'VALIDATION_ERROR', 'Provide name for the view')
  }

  const viewType = (input.view_type || input.type) as any
  if (!viewType) {
    throw new NotionMCPError(
      'type required for create_view action',
      'VALIDATION_ERROR',
      'Provide type for the view (e.g. table, board, list, calendar, timeline, gallery)'
    )
  }

  const { databaseId, dataSourceId: resolvedDsId } = await resolveDataSourceId(
    notion,
    input.database_id || input.data_source_id!
  )
  const dataSourceId = input.data_source_id || resolvedDsId
  const schema = await getDataSourceSchema(notion, dataSourceId)

  const parsedConfig = parseMaybeJSON<Record<string, any>>(input.configuration, 'configuration')
  const visibleProps = parseMaybeJSON<string[]>(input.visible_properties, 'visible_properties')
  const rawConfig = buildViewRawConfig(input, parsedConfig, visibleProps)

  const configuration = buildViewConfiguration(viewType, rawConfig, schema)

  const rawFilter = input.filters !== undefined ? input.filters : input.filter
  const filter = rawFilter !== undefined ? await resolveDatabaseFilter(notion, dataSourceId, rawFilter) : undefined
  const sorts = input.sorts ? parseMaybeJSON(input.sorts, 'sorts') : undefined

  const createParams: any = {
    database_id: databaseId,
    data_source_id: dataSourceId,
    name,
    type: viewType,
    configuration
  }
  if (filter !== undefined) createParams.filter = filter
  if (sorts !== undefined) createParams.sorts = sorts
  const placement = parseMaybeJSON(input.placement, 'placement')
  const position = parseMaybeJSON(input.position, 'position')
  if (placement !== undefined) createParams.placement = placement
  if (position !== undefined) createParams.position = position
  if (input.quick_filters !== undefined) {
    createParams.quick_filters = parseMaybeJSON(input.quick_filters, 'quick_filters')
  }

  const view: any = await notion.views.create(createParams)

  return {
    action: 'create_view',
    view_id: view.id,
    name: view.name || name,
    type: view.type || viewType,
    url: view.url,
    database_id: databaseId,
    data_source_id: dataSourceId,
    created: true,
    view
  }
}

/**
 * List views for a database
 * Maps to: GET /v1/views (API 2025-09-03)
 */
export async function listViews(notion: Client, input: DatabasesInput): Promise<ListViewsActionResponse> {
  if (!input.database_id && !input.data_source_id) {
    throw new NotionMCPError(
      'database_id or data_source_id required for list_views action',
      'VALIDATION_ERROR',
      'Provide database_id or data_source_id'
    )
  }

  const { databaseId, dataSourceId: resolvedDsId } = await resolveDataSourceId(
    notion,
    input.database_id || input.data_source_id!
  )
  const dataSourceId = input.data_source_id || resolvedDsId

  const allViews = await autoPaginate(async (cursor) => {
    const response: any = await notion.views.list({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100
    })
    return {
      results: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more
    }
  })

  const results = input.limit ? allViews.slice(0, input.limit) : allViews

  return {
    action: 'list_views',
    database_id: databaseId,
    data_source_id: dataSourceId,
    total: results.length,
    views: results.map((v: any) => ({
      id: v.id,
      name: v.name || 'Untitled',
      type: v.type || 'view',
      url: v.url || `https://notion.so/${(v.id || '').replace(/-/g, '')}`
    }))
  }
}

/**
 * Retrieve a view by ID
 * Maps to: GET /v1/views/{id} (API 2025-09-03)
 */
export async function getView(notion: Client, input: DatabasesInput): Promise<GetViewActionResponse> {
  if (!input.view_id) {
    throw new NotionMCPError('view_id required for get_view action', 'VALIDATION_ERROR', 'Provide view_id')
  }

  const viewId = normalizeId(input.view_id)
  const view: any = await notion.views.retrieve({ view_id: viewId })

  return {
    action: 'get_view',
    view_id: view.id,
    name: view.name || 'Untitled',
    type: view.type,
    url: view.url,
    data_source_id: view.data_source_id,
    configuration: view.configuration,
    filter: view.filter,
    sorts: view.sorts,
    view
  }
}

/**
 * Update a view
 * Maps to: PATCH /v1/views/{id} (API 2025-09-03)
 */
export async function updateView(notion: Client, input: DatabasesInput): Promise<UpdateViewActionResponse> {
  if (!input.view_id) {
    throw new NotionMCPError('view_id required for update_view action', 'VALIDATION_ERROR', 'Provide view_id')
  }

  const viewId = normalizeId(input.view_id)

  const updates: any = {}
  const name = input.name || input.title
  if (name) updates.name = name

  const viewType = input.view_type || input.type

  const parsedConfig = parseMaybeJSON<Record<string, any>>(input.configuration, 'configuration')
  const visibleProps = parseMaybeJSON<string[]>(input.visible_properties, 'visible_properties')

  const hasConfigInput = hasViewConfigInput(input, parsedConfig, visibleProps)

  let dataSourceId = input.data_source_id
  let resolvedType = viewType

  let currentView: any
  const needsViewLookup =
    hasConfigInput || ((!dataSourceId || !resolvedType) && (input.filters !== undefined || input.filter !== undefined))

  if (needsViewLookup) {
    try {
      currentView = await notion.views.retrieve({ view_id: viewId })
      dataSourceId = dataSourceId || currentView?.data_source_id
      resolvedType = resolvedType || currentView?.type
    } catch {
      // Fall back to direct configuration build
    }
  }

  if (hasConfigInput) {
    let schema: any
    if (dataSourceId) {
      try {
        schema = await getDataSourceSchema(notion, dataSourceId)
      } catch {
        // Continue without schema
      }
    }

    const baseConfig = currentView?.configuration || {}
    const rawConfig = buildViewRawConfig(input, { ...baseConfig, ...parsedConfig }, visibleProps)

    updates.configuration = buildViewConfiguration(resolvedType || 'table', rawConfig, schema)
  }

  const rawFilter = input.filters !== undefined ? input.filters : input.filter
  if (rawFilter !== undefined) {
    if (dataSourceId) {
      updates.filter = await resolveDatabaseFilter(notion, dataSourceId, rawFilter)
    } else {
      updates.filter = parseMaybeJSON(rawFilter, 'filters')
    }
  }

  if (input.sorts) {
    updates.sorts = parseMaybeJSON(input.sorts, 'sorts')
  }

  if (input.position !== undefined) {
    updates.position = parseMaybeJSON(input.position, 'position')
  }
  if (input.placement !== undefined) {
    updates.placement = parseMaybeJSON(input.placement, 'placement')
  }
  if (input.quick_filters !== undefined) {
    updates.quick_filters = parseMaybeJSON(input.quick_filters, 'quick_filters')
  }

  const updatedView: any = await notion.views.update({
    view_id: viewId,
    ...updates
  })

  return {
    action: 'update_view',
    view_id: viewId,
    updated: true,
    view: updatedView
  }
}

/**
 * Delete a view
 * Maps to: DELETE /v1/views/{id} (API 2025-09-03)
 */
export async function deleteView(notion: Client, input: DatabasesInput): Promise<DeleteViewActionResponse> {
  if (!input.view_id) {
    throw new NotionMCPError('view_id required for delete_view action', 'VALIDATION_ERROR', 'Provide view_id')
  }

  const viewId = normalizeId(input.view_id)
  await notion.views.delete({ view_id: viewId })

  return {
    action: 'delete_view',
    view_id: viewId,
    deleted: true
  }
}
