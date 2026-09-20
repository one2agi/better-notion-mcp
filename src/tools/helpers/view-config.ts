/**
 * View Configuration Helper
 * Builds ergonomic and defensive view configurations for the Notion Views API.
 * Automatically resolves multilingual/natural language property names to real property IDs,
 * infers types from schema, and injects required sort constraints to prevent 400 validation errors.
 */

import { NotionMCPError } from './errors.js'

export interface SchemaProperty {
  id: string
  name: string
  type: string
  raw?: any
  [key: string]: any
}

/**
 * Resolve a property from the schema by name (exact or case-insensitive) or property_id.
 */
export function resolvePropertyFromSchema(
  schema: Record<string, any> | undefined,
  propIdentifier: string
): SchemaProperty | null {
  if (!schema || !propIdentifier) return null

  // 1. Exact key match
  if (schema[propIdentifier]) {
    const prop = schema[propIdentifier]
    return {
      id: prop.id || propIdentifier,
      name: prop.name || propIdentifier,
      type: prop.type,
      raw: prop
    }
  }

  const lowerIdentifier = propIdentifier.toLowerCase()

  // 2. Case-insensitive key or prop.name match
  for (const [key, prop] of Object.entries(schema)) {
    if (key.toLowerCase() === lowerIdentifier || prop?.name?.toLowerCase() === lowerIdentifier) {
      return {
        id: prop?.id || key,
        name: prop?.name || key,
        type: prop?.type,
        raw: prop
      }
    }
  }

  // 3. Match by prop.id
  for (const [key, prop] of Object.entries(schema)) {
    if (prop?.id === propIdentifier) {
      return {
        id: prop.id,
        name: prop.name || key,
        type: prop.type,
        raw: prop
      }
    }
  }

  return null
}

/**
 * Find the first property matching the given type (or list of candidate types).
 */
export function findPropertyByType(
  schema: Record<string, any> | undefined,
  typeOrTypes: string | string[]
): SchemaProperty | null {
  if (!schema) return null
  const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes]

  for (const [key, prop] of Object.entries(schema)) {
    if (prop?.type && types.includes(prop.type)) {
      return {
        id: prop.id || key,
        name: prop.name || key,
        type: prop.type,
        raw: prop
      }
    }
  }
  return null
}

/**
 * Normalize sort field for group_by config.
 * Notion API requires a `sort` object in group_by (e.g. `{ type: 'manual' }`),
 * or it throws a 400 validation error.
 */
function normalizeGroupSort(sort: any): { type: 'manual' | 'ascending' | 'descending' } {
  if (typeof sort === 'string') {
    if (sort === 'ascending' || sort === 'descending' || sort === 'manual') {
      return { type: sort }
    }
    return { type: 'manual' }
  }
  if (sort && typeof sort === 'object' && sort.type) {
    return { type: sort.type }
  }
  return { type: 'manual' }
}

/**
 * Map schema property type to Notion view group_by type.
 */
function mapToGroupByPropertyType(schemaType?: string): string {
  if (!schemaType) return 'status'
  switch (schemaType) {
    case 'people':
      return 'person'
    case 'title':
    case 'rich_text':
    case 'url':
    case 'email':
    case 'phone_number':
      return 'text'
    default:
      return schemaType
  }
}

/**
 * Build a defensive group_by configuration with property resolution and auto-injected sort.
 */
export function buildGroupByConfig(groupByInput: any, schema?: Record<string, any>): any {
  if (!groupByInput) return undefined

  if (typeof groupByInput === 'string') {
    const resolved = resolvePropertyFromSchema(schema, groupByInput)
    const propertyId = resolved ? resolved.id : groupByInput
    const schemaType = resolved ? resolved.type : 'status'
    const type = mapToGroupByPropertyType(schemaType)

    const config: any = {
      type,
      property_id: propertyId,
      sort: { type: 'manual' }
    }

    if (type === 'status') {
      config.group_by = 'option'
    } else if (type === 'date' || type === 'created_time' || type === 'last_edited_time') {
      config.group_by = 'day'
    } else if (type === 'text') {
      config.group_by = 'exact'
    }

    return config
  }

  if (typeof groupByInput === 'object') {
    const rawProp = groupByInput.property || groupByInput.property_name || groupByInput.property_id
    const resolved = rawProp ? resolvePropertyFromSchema(schema, rawProp) : null
    const propertyId = groupByInput.property_id || (resolved ? resolved.id : rawProp)
    const schemaType = resolved ? resolved.type : undefined
    const type = groupByInput.type || mapToGroupByPropertyType(schemaType)

    const result: any = {
      ...groupByInput,
      type,
      property_id: propertyId,
      sort: normalizeGroupSort(groupByInput.sort)
    }

    delete result.property
    delete result.property_name

    if (type === 'status' && !result.group_by) {
      result.group_by = 'option'
    } else if ((type === 'date' || type === 'created_time' || type === 'last_edited_time') && !result.group_by) {
      result.group_by = 'day'
    } else if (type === 'text' && !result.group_by) {
      result.group_by = 'exact'
    }

    return result
  }

  return groupByInput
}

function coerceBoolean(val: any): boolean {
  if (typeof val === 'boolean') return val
  if (typeof val === 'string') {
    return val.toLowerCase() === 'true'
  }
  return Boolean(val)
}

export const VALID_FORM_PERMISSIONS = ['none', 'comment_only', 'reader', 'read_and_write', 'editor'] as const
export const PERMISSION_SYNONYMS: Record<string, string> = {
  readonly: 'reader',
  read: 'reader',
  edit: 'editor',
  write: 'editor',
  comment: 'comment_only',
  read_write: 'read_and_write'
}

/**
 * Build a form view configuration with ergonomic alias mapping and permission validation.
 */
export function buildFormConfiguration(inputConfig: Record<string, any> = {}): any {
  const config: any = { ...inputConfig }

  const closedVal = config.is_form_closed ?? config.closed ?? config.is_closed
  const anonVal = config.anonymous_submissions ?? config.anonymous ?? config.allow_anonymous
  const permVal = config.submission_permissions ?? config.permissions ?? config.permission

  delete config.closed
  delete config.is_closed
  delete config.anonymous
  delete config.allow_anonymous
  delete config.permissions
  delete config.permission
  delete config.properties

  if (closedVal !== undefined) {
    config.is_form_closed = coerceBoolean(closedVal)
  }
  if (anonVal !== undefined) {
    config.anonymous_submissions = coerceBoolean(anonVal)
  }
  if (permVal !== undefined) {
    const lowerPerm = typeof permVal === 'string' ? permVal.toLowerCase().trim() : permVal
    const normalizedPerm = PERMISSION_SYNONYMS[lowerPerm] || lowerPerm
    if (!VALID_FORM_PERMISSIONS.includes(normalizedPerm as any)) {
      throw new NotionMCPError(
        `Invalid submission_permissions: "${permVal}"`,
        'VALIDATION_ERROR',
        `submission_permissions must be one of: ${VALID_FORM_PERMISSIONS.join(', ')}`
      )
    }
    config.submission_permissions = normalizedPerm
  }

  return {
    type: 'form',
    ...config
  }
}

export const VALID_CHART_TYPES = ['column', 'bar', 'line', 'donut', 'number'] as const
export const VALID_GROUP_STYLES = ['normal', 'percent', 'side_by_side'] as const
export const GROUP_STYLE_SYNONYMS: Record<string, string> = {
  stacked: 'normal',
  stack: 'normal',
  clustered: 'side_by_side',
  cluster: 'side_by_side',
  grouped: 'side_by_side',
  sidebyside: 'side_by_side',
  'side-by-side': 'side_by_side',
  side_by_side: 'side_by_side',
  percentage: 'percent'
}

export const VALID_REFERENCE_LINE_COLORS = [
  'gray',
  'lightgray',
  'brown',
  'yellow',
  'orange',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
] as const

/**
 * Normalize reference lines to satisfy Notion API schema contract:
 * requires `color` and `dash_style`.
 */
export function normalizeReferenceLines(input: any): any[] | undefined {
  if (input === undefined || input === null) return undefined
  const lines = Array.isArray(input) ? input : [input]
  return lines.map((item) => {
    if (typeof item === 'number') {
      return { value: item, label: '目标', color: 'gray', dash_style: 'dash' }
    }
    if (typeof item === 'object' && item !== null) {
      const value =
        typeof item.value === 'string' && item.value.trim() !== '' && !Number.isNaN(Number(item.value))
          ? Number(item.value)
          : item.value
      const lowerColor = typeof item.color === 'string' ? item.color.toLowerCase().trim() : undefined
      const color =
        lowerColor && (VALID_REFERENCE_LINE_COLORS as readonly string[]).includes(lowerColor) ? lowerColor : 'gray'
      const dash_style = item.dash_style === 'solid' ? 'solid' : 'dash'
      const line: any = { value, color, dash_style }
      line.label = item.label !== undefined ? String(item.label) : '目标'
      return line
    }
    return item
  })
}

/**
 * Build a chart aggregation object for y_axis or number KPI value.
 * Infers appropriate aggregator based on schema property type.
 * Enforces Reverse Test Defense: aggregator 'count' MUST NOT contain property_id.
 */
export function buildChartAggregation(aggInput: any, schema?: Record<string, any>): any {
  if (!aggInput) return undefined

  if (typeof aggInput === 'string') {
    const lower = aggInput.toLowerCase().trim()
    if (lower === 'count' || lower === '行数' || lower === '计数') {
      return { aggregator: 'count' }
    }

    const resolved = resolvePropertyFromSchema(schema, aggInput)
    const propertyId = resolved ? resolved.id : aggInput
    const schemaType = resolved?.type

    let aggregator = 'unique'
    if (schemaType === 'number') {
      aggregator = 'sum'
    } else if (schemaType === 'checkbox') {
      aggregator = 'percent_checked'
    } else if (schemaType === 'date' || schemaType === 'created_time' || schemaType === 'last_edited_time') {
      aggregator = 'earliest_date'
    }

    return {
      property_id: propertyId,
      aggregator
    }
  }

  if (typeof aggInput === 'object' && aggInput !== null) {
    const rawAgg = aggInput.aggregator
    const rawProp = aggInput.property || aggInput.property_name || aggInput.property_id
    const lowerAgg = typeof rawAgg === 'string' ? rawAgg.toLowerCase().trim() : rawAgg

    if (lowerAgg === 'count' || lowerAgg === '行数' || lowerAgg === '计数') {
      return { aggregator: 'count' }
    }

    const resolved = rawProp ? resolvePropertyFromSchema(schema, rawProp) : null
    const propertyId = aggInput.property_id || (resolved ? resolved.id : rawProp)
    const schemaType = resolved?.type

    let aggregator = lowerAgg || rawAgg
    if (!aggregator) {
      if (schemaType === 'number') {
        aggregator = 'sum'
      } else if (schemaType === 'checkbox') {
        aggregator = 'percent_checked'
      } else if (schemaType === 'date' || schemaType === 'created_time' || schemaType === 'last_edited_time') {
        aggregator = 'earliest_date'
      } else {
        aggregator = 'unique'
      }
    }

    const result: any = {
      ...aggInput,
      aggregator
    }
    if (propertyId) {
      result.property_id = propertyId
    }
    delete result.property
    delete result.property_name

    return result
  }

  return aggInput
}

/**
 * Build a chart view configuration with automatic property resolution,
 * defensive manual sort injection on group_by (x_axis / stack_by),
 * number KPI card mapping, and subtype parameter sanitization.
 */
export function buildChartConfiguration(inputConfig: Record<string, any> = {}, schema?: Record<string, any>): any {
  const rawChartType = inputConfig.chart_type
  if (rawChartType) {
    const normalizedType = String(rawChartType).toLowerCase().trim()
    if (!VALID_CHART_TYPES.includes(normalizedType as any)) {
      throw new NotionMCPError(
        `Invalid chart_type: "${rawChartType}"`,
        'VALIDATION_ERROR',
        `chart_type must be one of: ${VALID_CHART_TYPES.join(', ')}`
      )
    }
  }

  const chartType = rawChartType ? String(rawChartType).toLowerCase().trim() : 'column'
  const config: any = { ...inputConfig, chart_type: chartType }

  if (config.chart_sort !== undefined && config.sort === undefined) {
    config.sort =
      typeof config.chart_sort === 'object' && config.chart_sort.type ? config.chart_sort : { type: config.chart_sort }
  }
  if (config.x_axis === undefined) {
    if (config.x_axis_property !== undefined) config.x_axis = config.x_axis_property
    else if (config.x_axis_property_id !== undefined) config.x_axis = config.x_axis_property_id
  }
  if (config.y_axis === undefined) {
    if (config.y_axis_property !== undefined) config.y_axis = config.y_axis_property
    else if (config.y_axis_property_id !== undefined) config.y_axis = config.y_axis_property_id
  }
  delete config.chart_sort
  delete config.x_axis_property
  delete config.x_axis_property_id
  delete config.y_axis_property
  delete config.y_axis_property_id
  delete config.results_mode

  if (config.target !== undefined || config.target_line !== undefined) {
    const targetVal = config.target !== undefined ? config.target : config.target_line
    const numTarget =
      typeof targetVal === 'string' && targetVal.trim() !== '' && !Number.isNaN(Number(targetVal))
        ? Number(targetVal)
        : targetVal

    if (typeof numTarget === 'number') {
      config.reference_lines = [{ value: numTarget, label: '目标', color: 'gray', dash_style: 'dash' }]
    } else if (Array.isArray(numTarget)) {
      config.reference_lines = normalizeReferenceLines(numTarget)
    } else if (typeof numTarget === 'object' && numTarget !== null) {
      config.reference_lines = normalizeReferenceLines([numTarget])
    }
    delete config.target
    delete config.target_line
  } else if (config.reference_lines !== undefined) {
    config.reference_lines = normalizeReferenceLines(config.reference_lines)
  }

  const hideEmpty = config.hide_empty_groups
  delete config.hide_empty_groups

  if (chartType === 'number') {
    if (config.y_axis !== undefined) {
      config.value = buildChartAggregation(config.y_axis, schema)
      delete config.y_axis
    } else if (config.value !== undefined) {
      if (
        typeof config.value === 'object' &&
        config.value !== null &&
        config.value.aggregator &&
        !config.value.property &&
        !config.value.property_name
      ) {
        // Retain existing valid value structure (e.g. from merged baseConfig)
      } else {
        config.value = buildChartAggregation(config.value, schema)
      }
    } else {
      config.value = { aggregator: 'count' }
    }

    delete config.x_axis
    delete config.group_style
    delete config.stack_by
    delete config.smooth_line
    delete config.cumulative
    delete config.hide_line_fill_area
    delete config.donut_labels
    delete config.y_axis

    return {
      type: 'chart',
      ...config
    }
  }

  if (config.x_axis !== undefined) {
    config.x_axis = buildGroupByConfig(config.x_axis, schema)
    if (hideEmpty !== undefined && config.x_axis) {
      config.x_axis.hide_empty_groups = coerceBoolean(hideEmpty)
    }
  }

  if (config.stack_by !== undefined) {
    config.stack_by = buildGroupByConfig(config.stack_by, schema)
  }

  if (config.y_axis !== undefined) {
    config.y_axis = buildChartAggregation(config.y_axis, schema)
  }

  if (config.group_style !== undefined && config.group_style !== null) {
    const rawStyle = String(config.group_style).toLowerCase().trim()
    const mappedStyle = GROUP_STYLE_SYNONYMS[rawStyle] || rawStyle
    if (!VALID_GROUP_STYLES.includes(mappedStyle as any)) {
      throw new NotionMCPError(
        `Invalid group_style: "${config.group_style}"`,
        'VALIDATION_ERROR',
        `group_style must be one of: normal (stacked), percent, side_by_side (clustered)`
      )
    }
    config.group_style = mappedStyle
  }

  if (chartType === 'donut') {
    delete config.group_style
    delete config.smooth_line
    delete config.cumulative
    delete config.hide_line_fill_area
    delete config.stack_by
  } else if (chartType === 'line') {
    delete config.group_style
    delete config.donut_labels
  } else if (chartType === 'column' || chartType === 'bar') {
    delete config.smooth_line
    delete config.cumulative
    delete config.hide_line_fill_area
    delete config.donut_labels
  }

  return {
    type: 'chart',
    ...config
  }
}

/**
 * Build a complete, type-safe view configuration object.
 */
export function buildViewConfiguration(
  type: string,
  inputConfig: Record<string, any> = {},
  schema?: Record<string, any>
): any {
  const viewType = type?.toLowerCase()
  const config: any = { ...inputConfig }

  // 1. Normalize visible_properties if passed
  if (Array.isArray(config.visible_properties)) {
    const propertyConfigs: any[] = []
    for (const propName of config.visible_properties) {
      const resolved = resolvePropertyFromSchema(schema, propName)
      propertyConfigs.push({
        property_id: resolved ? resolved.id : propName,
        visible: true
      })
    }
    config.properties = propertyConfigs
    delete config.visible_properties
  }

  switch (viewType) {
    case 'board': {
      const groupBy = config.group_by
      if (groupBy) {
        config.group_by = buildGroupByConfig(groupBy, schema)
      } else {
        const candidate = findPropertyByType(schema, ['status', 'select', 'multi_select'])
        if (!candidate) {
          throw new NotionMCPError(
            'A status or select property is required for board view group_by',
            'VALIDATION_ERROR',
            'Specify group_by with a status or select property name, or ensure database has a status or select property.'
          )
        }
        config.group_by = buildGroupByConfig(candidate.id, schema)
      }
      return {
        type: 'board',
        ...config
      }
    }

    case 'calendar': {
      const datePropTarget = config.date_property || config.date_property_id || config.date_property_name
      let datePropertyId: string | undefined

      if (datePropTarget) {
        const resolved = resolvePropertyFromSchema(schema, datePropTarget)
        datePropertyId = resolved ? resolved.id : datePropTarget
      } else {
        const candidate = findPropertyByType(schema, ['date', 'created_time', 'last_edited_time'])
        if (!candidate) {
          throw new NotionMCPError(
            'A date property is required for calendar view',
            'VALIDATION_ERROR',
            'Specify date_property with a valid date column name, or add a date property to the database schema.'
          )
        }
        datePropertyId = candidate.id
      }

      delete config.date_property
      delete config.date_property_name

      return {
        type: 'calendar',
        ...config,
        date_property_id: datePropertyId
      }
    }

    case 'timeline': {
      const datePropTarget = config.date_property || config.date_property_id || config.date_property_name
      let datePropertyId: string | undefined

      if (datePropTarget) {
        const resolved = resolvePropertyFromSchema(schema, datePropTarget)
        datePropertyId = resolved ? resolved.id : datePropTarget
      } else {
        const candidate = findPropertyByType(schema, ['date', 'created_time', 'last_edited_time'])
        if (!candidate) {
          throw new NotionMCPError(
            'A date property is required for timeline view',
            'VALIDATION_ERROR',
            'Specify date_property with a valid date column name, or add a date property to the database schema.'
          )
        }
        datePropertyId = candidate.id
      }

      delete config.date_property
      delete config.date_property_name

      let endDatePropertyId: string | undefined
      const endDatePropTarget = config.end_date_property || config.end_date_property_id || config.end_date_property_name
      if (endDatePropTarget) {
        const resolved = resolvePropertyFromSchema(schema, endDatePropTarget)
        endDatePropertyId = resolved ? resolved.id : endDatePropTarget
        delete config.end_date_property
        delete config.end_date_property_name
      }

      const timelineConfig: any = {
        type: 'timeline',
        ...config,
        date_property_id: datePropertyId
      }
      if (endDatePropertyId) {
        timelineConfig.end_date_property_id = endDatePropertyId
      }
      return timelineConfig
    }

    case 'table': {
      if (config.group_by) {
        config.group_by = buildGroupByConfig(config.group_by, schema)
      }
      return {
        type: 'table',
        ...config
      }
    }

    case 'gallery': {
      if (typeof config.cover === 'string') {
        config.cover = { type: config.cover }
      }
      return {
        type: 'gallery',
        ...config
      }
    }

    case 'list': {
      return {
        type: 'list',
        ...config
      }
    }

    case 'form': {
      return buildFormConfiguration(config)
    }

    case 'chart': {
      return buildChartConfiguration(config, schema)
    }

    default:
      return {
        type: viewType,
        ...config
      }
  }
}
