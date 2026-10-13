import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDataSourceCache,
  getDataSourceSchema,
  getSchemaTypeMap,
  resolutionCache,
  resolveDataSourceId,
  resolvePageSchema,
  schemaCache
} from './data-source.js'

const mockNotion = {
  databases: {
    retrieve: vi.fn()
  },
  pages: {
    retrieve: vi.fn()
  },
  dataSources: {
    retrieve: vi.fn()
  },
  views: {
    list: vi.fn(),
    retrieve: vi.fn()
  }
} as any

describe('data-source helper module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDataSourceCache()
  })

  describe('resolveDataSourceId', () => {
    it('resolves database container with data_sources and caches result', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-12345678123456781234567812345678',
        data_sources: [{ id: 'ds-12345678123456781234567812345678' }]
      })

      const res = await resolveDataSourceId(mockNotion, 'db-12345678-1234-5678-1234-567812345678')
      expect(res).toEqual({
        databaseId: 'db-12345678123456781234567812345678',
        dataSourceId: 'ds-12345678123456781234567812345678'
      })
      expect(mockNotion.databases.retrieve).toHaveBeenCalledTimes(1)

      // Cached on second call
      const res2 = await resolveDataSourceId(mockNotion, 'db-12345678-1234-5678-1234-567812345678')
      expect(res2).toEqual(res)
      expect(mockNotion.databases.retrieve).toHaveBeenCalledTimes(1)
    })

    it('throws VALIDATION_ERROR with read-only correction guidance when database has no data sources and cannot penetrate', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-empty',
        data_sources: []
      })

      try {
        await resolveDataSourceId(mockNotion, 'db-empty')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.code).toBe('VALIDATION_ERROR')
        expect(err.message).toContain('Database has no data sources')
        expect(err.suggestion).not.toContain('create_data_source')
        expect(err.suggestion).toMatch(/permission|source database|relation/i)
      }
    })

    it('penetrates linked view container via views.list when data_sources is empty and views.list returns stubs without data_source_id', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-linked-view',
        data_sources: []
      })
      mockNotion.views.list.mockResolvedValueOnce({
        results: [
          {
            object: 'view',
            id: 'view-tab-1'
          },
          {
            object: 'view',
            id: 'view-tab-2'
          }
        ]
      })
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view-tab-1',
        data_source_id: 'ds-from-linked-view',
        filter: { property: 'Status', status: { equals: 'In Progress' } },
        sorts: [{ property: 'Date', direction: 'ascending' }]
      })

      const res = await resolveDataSourceId(mockNotion, 'db-linked-view')
      expect(res).toEqual({
        databaseId: 'db-linked-view',
        dataSourceId: 'ds-from-linked-view',
        viewId: 'view-tab-1',
        viewFilter: { property: 'Status', status: { equals: 'In Progress' } },
        viewSorts: [{ property: 'Date', direction: 'ascending' }],
        isLinkedView: true
      })
      expect(mockNotion.views.list).toHaveBeenCalledWith({
        database_id: 'dblinkedview',
        page_size: 10
      })
      expect(mockNotion.views.retrieve).toHaveBeenCalledWith({
        view_id: 'viewtab1'
      })

      // Check cache on second call
      const resCached = await resolveDataSourceId(mockNotion, 'db-linked-view')
      expect(resCached).toEqual(res)
      expect(mockNotion.databases.retrieve).toHaveBeenCalledTimes(1)
      expect(mockNotion.views.list).toHaveBeenCalledTimes(1)
      expect(mockNotion.views.retrieve).toHaveBeenCalledTimes(1)
    })

    it('penetrates linked view with explicit viewId', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-linked-view-2',
        data_sources: []
      })
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view-tab-2',
        data_source_id: 'ds-from-tab-2',
        filter: { property: 'Status', status: { equals: 'Done' } },
        sorts: [{ property: 'Priority', direction: 'descending' }]
      })

      const res = await resolveDataSourceId(mockNotion, 'db-linked-view-2', { viewId: 'view-tab-2' })
      expect(res).toEqual({
        databaseId: 'db-linked-view-2',
        dataSourceId: 'ds-from-tab-2',
        viewId: 'view-tab-2',
        viewFilter: { property: 'Status', status: { equals: 'Done' } },
        viewSorts: [{ property: 'Priority', direction: 'descending' }],
        isLinkedView: true
      })
    })

    it('resolves explicit viewId on entity database with data_sources', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-entity-1',
        data_sources: [{ id: 'ds-main-entity' }]
      })
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view-custom-tab',
        data_source_id: 'ds-main-entity',
        filter: { property: 'Priority', select: { equals: 'Urgent' } },
        sorts: [{ timestamp: 'created_time', direction: 'ascending' }]
      })

      const res = await resolveDataSourceId(mockNotion, 'db-entity-1', { viewId: 'view-custom-tab' })
      expect(res).toEqual({
        databaseId: 'db-entity-1',
        dataSourceId: 'ds-main-entity',
        viewId: 'view-custom-tab',
        viewFilter: { property: 'Priority', select: { equals: 'Urgent' } },
        viewSorts: [{ timestamp: 'created_time', direction: 'ascending' }],
        isLinkedView: false
      })
      expect(mockNotion.views.retrieve).toHaveBeenCalledWith({ view_id: 'viewcustomtab' })
    })

    it('throws NOT_FOUND when specified viewId is not found', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-entity-1',
        data_sources: [{ id: 'ds-main-entity' }]
      })
      const notFoundErr: any = new Error('View not found')
      notFoundErr.code = 'object_not_found'
      mockNotion.views.retrieve.mockRejectedValueOnce(notFoundErr)

      await expect(
        resolveDataSourceId(mockNotion, 'db-entity-1', { viewId: 'view-non-existent' })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'View "view-non-existent" not found'
      })
    })

    it('throws read-only VALIDATION_ERROR when database has no data sources and views.list returns empty', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-no-views',
        data_sources: []
      })
      mockNotion.views.list.mockResolvedValueOnce({
        results: []
      })

      try {
        await resolveDataSourceId(mockNotion, 'db-no-views')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.code).toBe('VALIDATION_ERROR')
        expect(err.suggestion).not.toContain('create_data_source')
      }
    })

    it('throws read-only VALIDATION_ERROR when views.list throws an error', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-views-error',
        data_sources: []
      })
      mockNotion.views.list.mockRejectedValueOnce(new Error('Permission denied for views'))

      try {
        await resolveDataSourceId(mockNotion, 'db-views-error')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.code).toBe('VALIDATION_ERROR')
        expect(err.suggestion).not.toContain('create_data_source')
      }
    })

    it('falls back to data_source_id when database retrieve returns object_not_found', async () => {
      const notFoundErr: any = new Error('Object not found')
      notFoundErr.code = 'object_not_found'
      mockNotion.databases.retrieve.mockRejectedValueOnce(notFoundErr)

      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-fallback-id',
        parent: { database_id: 'db-parent-id' }
      })

      const res = await resolveDataSourceId(mockNotion, 'ds-fallback-id')
      expect(res).toEqual({
        databaseId: 'db-parent-id',
        dataSourceId: 'ds-fallback-id'
      })
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(1)
    })

    it('throws NOT_FOUND when neither database nor data source exists', async () => {
      const notFoundErr: any = new Error('Object not found')
      notFoundErr.code = 'object_not_found'
      mockNotion.databases.retrieve.mockRejectedValueOnce(notFoundErr)
      mockNotion.dataSources.retrieve.mockRejectedValueOnce(new Error('DS not found'))

      await expect(resolveDataSourceId(mockNotion, 'invalid-id')).rejects.toThrow(
        'ID "invalid-id" is not a valid database or data source'
      )
    })
  })

  describe('getDataSourceSchema', () => {
    it('retrieves and caches properties from data source', async () => {
      const mockProps = {
        Name: { type: 'title' },
        Status: { type: 'status' }
      }
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-1',
        properties: mockProps
      })

      const props1 = await getDataSourceSchema(mockNotion, 'ds-1')
      expect(props1).toEqual(mockProps)
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(1)

      // Cached on second call
      const props2 = await getDataSourceSchema(mockNotion, 'ds-1')
      expect(props2).toEqual(mockProps)
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(1)
    })

    it('re-fetches when cache expires', async () => {
      const mockProps = { Name: { type: 'title' } }
      mockNotion.dataSources.retrieve.mockResolvedValue({
        id: 'ds-expired',
        properties: mockProps
      })

      await getDataSourceSchema(mockNotion, 'ds-expired')
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(1)

      // Expire cache manually
      const cached = schemaCache.get('ds-expired')
      if (cached) cached.expiresAt = Date.now() - 1000

      await getDataSourceSchema(mockNotion, 'ds-expired')
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(2)
    })
  })

  describe('getSchemaTypeMap', () => {
    it('returns map of column names to property types', async () => {
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-map',
        properties: {
          标题: { type: 'title' },
          状态: { type: 'status' },
          备注: {} // missing type -> fallback rich_text
        }
      })

      const map = await getSchemaTypeMap(mockNotion, 'ds-map')
      expect(map).toEqual({
        标题: 'title',
        状态: 'status',
        备注: 'rich_text'
      })
    })

    it('returns empty object if schema properties are missing', async () => {
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-empty',
        properties: null
      })

      const map = await getSchemaTypeMap(mockNotion, 'ds-empty')
      expect(map).toEqual({})
    })
  })

  describe('resolvePageSchema', () => {
    it('resolves schema when page has database_id in parent', async () => {
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-123',
        parent: {
          type: 'database_id',
          database_id: 'db-parent-123'
        }
      })

      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-parent-123',
        data_sources: [{ id: 'ds-from-parent' }]
      })

      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-from-parent',
        properties: {
          Name: { type: 'title' },
          Tags: { type: 'multi_select' }
        }
      })

      const schema = await resolvePageSchema(mockNotion, 'page-123')
      expect(schema).toEqual({
        Name: 'title',
        Tags: 'multi_select'
      })
    })

    it('handles parent with data_source_id container holding database_id (API 2025-09-03)', async () => {
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-123',
        parent: {
          type: 'data_source_id',
          data_source_id: 'ds-container',
          database_id: 'd8f4f4cfc8e28278870c01862b9cadfb'
        }
      })

      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'd8f4f4cfc8e28278870c01862b9cadfb',
        data_sources: [{ id: 'ds-real' }]
      })

      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-real',
        properties: {
          Task: { type: 'title' }
        }
      })

      const schema = await resolvePageSchema(mockNotion, 'page-123')
      expect(schema).toEqual({
        Task: 'title'
      })
    })

    it('returns undefined when page parent is a page (not a database)', async () => {
      mockNotion.pages.retrieve.mockResolvedValueOnce({
        id: 'page-subpage',
        parent: {
          type: 'page_id',
          page_id: 'parent-page-id'
        }
      })

      const schema = await resolvePageSchema(mockNotion, 'page-subpage')
      expect(schema).toBeUndefined()
      expect(mockNotion.databases.retrieve).not.toHaveBeenCalled()
    })

    it('returns undefined and does not throw when page retrieve or resolution fails', async () => {
      mockNotion.pages.retrieve.mockRejectedValueOnce(new Error('Permission denied'))

      const schema = await resolvePageSchema(mockNotion, 'forbidden-page')
      expect(schema).toBeUndefined()
    })
  })

  describe('clearDataSourceCache', () => {
    it('clears both resolutionCache and schemaCache', () => {
      resolutionCache.set('test-id', { databaseId: 'db', dataSourceId: 'ds', expiresAt: 999999999999 })
      schemaCache.set('ds', { properties: {}, expiresAt: 999999999999 })

      expect(resolutionCache.size).toBe(1)
      expect(schemaCache.size).toBe(1)

      clearDataSourceCache()

      expect(resolutionCache.size).toBe(0)
      expect(schemaCache.size).toBe(0)
    })
  })
})
