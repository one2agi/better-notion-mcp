/**
 * Databases Mega Tool - Updated for Notion API 2025-09-03
 * Supports data_sources architecture and modular submodules
 */

import type { Client } from '@notionhq/client'
import {
  clearDataSourceCache,
  getDataSourceSchema,
  getSchemaTypeMap,
  resolutionCache,
  resolveDataSourceId,
  resolvePageSchema,
  schemaCache
} from '../helpers/data-source.js'
import { throwUnknownAction, withErrorHandling } from '../helpers/errors.js'
import {
  aggregateDatabase,
  computeAggregation,
  fetchAllDataSourcePages,
  groupByDatabase
} from './databases/analytics.js'
import {
  createDatabase,
  createDataSource,
  getDatabase,
  listDataSourceTemplates,
  queryDatabase,
  updateDatabaseContainer,
  updateDataSource
} from './databases/containers.js'
import { createDatabasePages, deleteDatabasePages, updateDatabasePages } from './databases/rows.js'
import type { DatabasesInput, DatabasesResponse } from './databases/types.js'
import { createView, deleteView, getView, listViews, updateView } from './databases/views.js'

export {
  createDatabase,
  createDataSource,
  getDatabase,
  listDataSourceTemplates,
  normalizePropertyOptions,
  queryDatabase,
  updateDatabaseContainer,
  updateDataSource,
  validateTitleProperty
} from './databases/containers.js'
export * from './databases/types.js'

export { createView, deleteView, getView, listViews, updateView } from './databases/views.js'

export {
  aggregateDatabase,
  clearDataSourceCache,
  computeAggregation,
  createDatabasePages,
  deleteDatabasePages,
  fetchAllDataSourcePages,
  getDataSourceSchema,
  getSchemaTypeMap,
  groupByDatabase,
  resolutionCache,
  resolveDataSourceId,
  resolvePageSchema,
  schemaCache,
  updateDatabasePages
}

/**
 * Unified databases tool - handles all database operations
 */
export async function databases(notion: Client, input: DatabasesInput): Promise<DatabasesResponse> {
  return withErrorHandling(async () => {
    switch (input.action) {
      case 'create':
        return await createDatabase(notion, input)

      case 'get':
        return await getDatabase(notion, input)

      case 'query':
        return await queryDatabase(notion, input)

      case 'create_page':
        return await createDatabasePages(notion, input)

      case 'update_page':
        return await updateDatabasePages(notion, input)

      case 'delete_page':
        return await deleteDatabasePages(notion, input)

      case 'create_data_source':
        return await createDataSource(notion, input)

      case 'update_data_source':
        return await updateDataSource(notion, input)

      case 'update_database':
        return await updateDatabaseContainer(notion, input)

      case 'list_templates':
        return await listDataSourceTemplates(notion, input)

      case 'aggregate':
        return await aggregateDatabase(notion, input)

      case 'group_by':
        return await groupByDatabase(notion, input)

      case 'create_view':
        return await createView(notion, input)

      case 'list_views':
        return await listViews(notion, input)

      case 'get_view':
        return await getView(notion, input)

      case 'update_view':
        return await updateView(notion, input)

      case 'delete_view':
        return await deleteView(notion, input)

      default:
        throwUnknownAction(
          input.action,
          [
            'create',
            'get',
            'query',
            'create_page',
            'update_page',
            'delete_page',
            'create_data_source',
            'update_data_source',
            'update_database',
            'list_templates',
            'aggregate',
            'group_by',
            'create_view',
            'list_views',
            'get_view',
            'update_view',
            'delete_view'
          ],
          'databases'
        )
    }
  })()
}
