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

    it('throws VALIDATION_ERROR when database has no data sources', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-empty',
        data_sources: []
      })

      await expect(resolveDataSourceId(mockNotion, 'db-empty')).rejects.toThrow('Database has no data sources')
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
