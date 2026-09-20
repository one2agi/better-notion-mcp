/**
 * Database Analytics & Aggregation Engine
 * Notion API 2025-09-03
 */

import type { Client } from '@notionhq/client'
import { resolveDataSourceId } from '../../helpers/data-source.js'
import { NotionMCPError } from '../../helpers/errors.js'
import { parseMaybeJSON } from '../../helpers/json-input.js'
import { autoPaginate } from '../../helpers/pagination.js'
import { readPropertyValue } from '../../helpers/properties.js'
import { getSmartSearchFilter, resolveDatabaseFilter } from './query-helpers.js'
import type { AggregateDatabaseResponse, AggregationSpec, DatabasesInput, GroupByDatabaseResponse } from './types.js'

/**
 * Resolve data source, optionally apply a smart-search filter, then fetch ALL pages
 * via autoPaginate. Used by both `aggregate` and `group_by`.
 */
export async function fetchAllDataSourcePages(
  notion: Client,
  _databaseId: string,
  dataSourceId: string,
  filter: any,
  search: string | undefined
): Promise<any[]> {
  let effectiveFilter = filter
  if (search && !effectiveFilter) {
    effectiveFilter = await getSmartSearchFilter(notion, dataSourceId, search)
  }
  const queryParams: any = { data_source_id: dataSourceId }
  if (effectiveFilter) queryParams.filter = effectiveFilter

  return autoPaginate(async (cursor) => {
    const response: any = await notion.dataSources.query({
      ...queryParams,
      start_cursor: cursor,
      page_size: 100
    })
    return {
      results: response.results,
      next_cursor: response.next_cursor,
      has_more: response.has_more
    }
  })
}

/**
 * Compute a single aggregation over a flat list of pages.
 * Returns null if the aggregation cannot be computed (e.g. sum on no rows).
 */
export function computeAggregation(pages: any[], spec: AggregationSpec): number | null {
  const { type, property } = spec

  if (type === 'count') {
    return pages.length
  }

  if (!property) {
    // sum/avg/min/max/unique_count all need a property
    return null
  }

  if (type === 'unique_count') {
    const seen = new Set<string>()
    for (const p of pages) {
      const v = readPropertyValue(p, property)
      if (v === null || v === undefined) continue
      seen.add(typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    return seen.size
  }

  // sum / avg / min / max need numeric values
  const numericPages = pages.filter((p) => {
    const v = readPropertyValue(p, property)
    return typeof v === 'number' && !Number.isNaN(v)
  })
  const values = numericPages.map((p) => readPropertyValue(p, property) as number)

  if (values.length === 0) return null

  if (type === 'sum') {
    let s = 0
    for (const v of values) s += v
    return s
  }
  if (type === 'avg') {
    let s = 0
    for (const v of values) s += v
    return s / values.length
  }
  if (type === 'min') {
    return Math.min(...values)
  }
  if (type === 'max') {
    return Math.max(...values)
  }

  return null
}

/**
 * Aggregate action: compute count/sum/avg/min/max/unique_count over a (filtered) data source.
 * Maps to: client-side aggregation over POST /v1/data_sources/{id}/query results.
 */
export async function aggregateDatabase(notion: Client, input: DatabasesInput): Promise<AggregateDatabaseResponse> {
  if (!input.database_id) {
    throw new NotionMCPError(
      'database_id required for aggregate action',
      'VALIDATION_ERROR',
      'Provide database_id (or data_source_id)'
    )
  }
  const aggregations = parseMaybeJSON<NonNullable<DatabasesInput['aggregations']>>(input.aggregations, 'aggregations')
  if (!aggregations || aggregations.length === 0) {
    throw new NotionMCPError(
      'aggregations required for aggregate action',
      'VALIDATION_ERROR',
      'Provide at least one aggregation spec, e.g. [{type: "count", alias: "total"}]'
    )
  }

  const { databaseId, dataSourceId } = await resolveDataSourceId(notion, input.database_id)
  const filter = await resolveDatabaseFilter(notion, dataSourceId, input.filters)
  const pages = await fetchAllDataSourcePages(notion, databaseId, dataSourceId, filter, input.search)

  const results: Record<string, number | null> = {}
  for (const spec of aggregations) {
    const alias = spec.alias ?? (spec.property ? `${spec.type}_${spec.property}` : spec.type)
    results[alias] = computeAggregation(pages, spec)
  }

  return {
    action: 'aggregate',
    database_id: databaseId,
    data_source_id: dataSourceId,
    total_rows_scanned: pages.length,
    results
  }
}

/**
 * group_by action: group rows by a property value, compute aggregations per group.
 * Maps to: client-side groupBy over POST /v1/data_sources/{id}/query results.
 */
export async function groupByDatabase(notion: Client, input: DatabasesInput): Promise<GroupByDatabaseResponse> {
  if (!input.database_id) {
    throw new NotionMCPError(
      'database_id required for group_by action',
      'VALIDATION_ERROR',
      'Provide database_id (or data_source_id)'
    )
  }
  let rawGroupBy = input.group_by
  if (typeof rawGroupBy === 'string') {
    if (rawGroupBy.trim().startsWith('{')) {
      rawGroupBy = parseMaybeJSON(rawGroupBy, 'group_by')
    } else {
      rawGroupBy = { property: rawGroupBy }
    }
  }
  const groupBy = rawGroupBy
  if (!groupBy) {
    throw new NotionMCPError(
      'group_by required for group_by action',
      'VALIDATION_ERROR',
      'Provide group_by: { property: "Owner" }'
    )
  }
  let aggregations = parseMaybeJSON<NonNullable<DatabasesInput['aggregations']>>(input.aggregations, 'aggregations')
  if (!aggregations || aggregations.length === 0) {
    aggregations = [{ type: 'count' }]
  }

  const groupByProperty = groupBy.property
  if (!groupByProperty) {
    throw new NotionMCPError(
      'group_by.property required for group_by action',
      'VALIDATION_ERROR',
      'Provide group_by: { property: "Owner" }'
    )
  }

  const { databaseId, dataSourceId } = await resolveDataSourceId(notion, input.database_id)
  const filter = await resolveDatabaseFilter(notion, dataSourceId, input.filters)
  const pages = await fetchAllDataSourcePages(notion, databaseId, dataSourceId, filter, input.search)

  // Group pages by the group_by property value
  const groups = new Map<string, any[]>()
  for (const p of pages) {
    const v = readPropertyValue(p, groupByProperty)
    const key = v === null || v === undefined ? null : String(v)
    const list = groups.get(key as string) ?? []
    list.push(p)
    groups.set(key as string, list)
  }

  const out: GroupByDatabaseResponse['groups'] = []
  // Sort groups by key (null last) for stable output
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })
  for (const key of sortedKeys) {
    const groupPages = groups.get(key)!
    const groupAggs: Record<string, number | null> = {}
    const aggregationsList = aggregations as AggregationSpec[]
    for (const spec of aggregationsList) {
      const alias = spec.alias ?? (spec.property ? `${spec.type}_${spec.property}` : spec.type)
      groupAggs[alias] = computeAggregation(groupPages, spec)
    }
    out.push({
      key,
      count: groupPages.length,
      aggregations: groupAggs
    })
  }

  return {
    action: 'group_by',
    database_id: databaseId,
    data_source_id: dataSourceId,
    total_rows_scanned: pages.length,
    group_by_property: groupByProperty,
    groups: out
  }
}
