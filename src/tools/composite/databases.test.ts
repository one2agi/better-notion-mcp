import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AggregateDatabaseResponse,
  type CreateDatabasePageResponse,
  type CreateDatabaseResponse,
  type CreateDataSourceResponse,
  type DeleteDatabasePageResponse,
  databases,
  type GetDatabaseResponse,
  type GroupByDatabaseResponse,
  type ListDataSourceTemplatesResponse,
  type QueryDatabaseResponse,
  resolutionCache,
  schemaCache,
  type UpdateDatabasePageResponse,
  type UpdateDatabaseResponse,
  type UpdateDataSourceResponse
} from './databases.js'

const mockNotion = {
  databases: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn()
  },
  pages: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn()
  },
  dataSources: {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    query: vi.fn(),
    listTemplates: vi.fn()
  },
  request: vi.fn()
}

const notion = mockNotion as any

function makeDbRetrieveResponse(overrides: Record<string, any> = {}) {
  return {
    id: 'db-1',
    title: [{ plain_text: 'Test DB' }],
    description: [{ plain_text: 'A test database' }],
    url: 'https://notion.so/db-1',
    is_inline: false,
    created_time: '2025-01-01T00:00:00.000Z',
    last_edited_time: '2025-01-02T00:00:00.000Z',
    data_sources: [{ id: 'ds-1', name: 'Source 1' }],
    ...overrides
  }
}

function makeDataSourceResponse(overrides: Record<string, any> = {}) {
  return {
    id: 'ds-1',
    title: [{ plain_text: 'Source 1' }],
    properties: {
      Name: { type: 'title', id: 'prop-1' },
      Status: {
        type: 'select',
        id: 'prop-2',
        select: { options: [{ name: 'Active' }, { name: 'Done' }] }
      }
    },
    ...overrides
  }
}

describe('databases', () => {
  beforeEach(() => {
    schemaCache.clear()
    resolutionCache.clear()
    vi.resetAllMocks()
  })

  describe('create', () => {
    it('should use schemaCache on repeated calls', async () => {
      mockNotion.databases.retrieve.mockResolvedValue(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({ id: 'ds-1', properties: { Name: { title: {} } } })

      // First call - populates cache
      await databases(notion, { action: 'get', database_id: 'db-1' })
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      await databases(notion, { action: 'get', database_id: 'db-1' })
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledTimes(1)
    })

    it('should create a database with initial_data_source', async () => {
      mockNotion.databases.create.mockResolvedValueOnce({
        id: 'db-new',
        url: 'https://notion.so/db-new',
        data_sources: [{ id: 'ds-new' }]
      })

      const result = (await databases(notion, {
        action: 'create',
        parent_id: 'page-1',
        title: 'My DB',
        properties: { Name: { title: {} } }
      })) as CreateDatabaseResponse

      expect(result).toEqual({
        action: 'create',
        database_id: 'db-new',
        data_source_id: 'ds-new',
        url: 'https://notion.so/db-new',
        created: true
      })

      expect(mockNotion.databases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'page_id', page_id: 'page-1' },
          initial_data_source: { properties: { Name: { title: {} } } }
        })
      )
    })

    it('should include description and is_inline when provided', async () => {
      mockNotion.databases.create.mockResolvedValueOnce({
        id: 'db-2',
        url: 'https://notion.so/db-2',
        data_sources: [{ id: 'ds-2' }]
      })

      await databases(notion, {
        action: 'create',
        parent_id: 'page-1',
        title: 'Inline DB',
        description: 'Some description',
        is_inline: true,
        properties: { Name: { title: {} } }
      })

      const call = mockNotion.databases.create.mock.calls[0][0]
      expect(call.description).toBeDefined()
      expect(call.description[0].text.content).toBe('Some description')
      expect(call.is_inline).toBe(true)
    })

    it('should include icon and cover when provided', async () => {
      mockNotion.databases.create.mockResolvedValueOnce({
        id: 'db-icon',
        url: 'https://notion.so/db-icon',
        data_sources: [{ id: 'ds-icon' }]
      })

      await databases(notion, {
        action: 'create',
        parent_id: 'page-1',
        title: 'DB with icon',
        properties: { Name: { title: {} } },
        icon: 'robot:gray',
        cover: 'https://example.com/cover.jpg'
      })

      const call = mockNotion.databases.create.mock.calls[0][0]
      expect(call.icon).toBeDefined()
      expect(call.cover).toBeDefined()
    })

    it('should throw when required params are missing', async () => {
      await expect(databases(notion, { action: 'create', parent_id: 'page-1', title: 'No Props' })).rejects.toThrow(
        'parent_id, title, and properties required'
      )

      await expect(databases(notion, { action: 'create' })).rejects.toThrow('parent_id, title, and properties required')
    })
  })

  describe('get', () => {
    it('should return schema with data source info', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValueOnce(makeDataSourceResponse())

      const result = (await databases(notion, { action: 'get', database_id: 'db-1' })) as GetDatabaseResponse

      expect(result).toEqual({
        action: 'get',
        database_id: 'db-1',
        title: 'Test DB',
        description: 'A test database',
        url: 'https://notion.so/db-1',
        is_inline: false,
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-02T00:00:00.000Z',
        data_source: { id: 'ds-1', name: 'Source 1' },
        schema: {
          Name: { type: 'title', id: 'prop-1' },
          Status: { type: 'select', id: 'prop-2', options: ['Active', 'Done'] }
        }
      })
    })

    it('should format multi_select options and formula expressions', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValueOnce(
        makeDataSourceResponse({
          properties: {
            Tags: {
              type: 'multi_select',
              id: 'prop-3',
              multi_select: { options: [{ name: 'A' }, { name: 'B' }] }
            },
            Total: {
              type: 'formula',
              id: 'prop-4',
              formula: { expression: 'prop("Price") * prop("Qty")' }
            }
          }
        })
      )

      const result = (await databases(notion, { action: 'get', database_id: 'db-1' })) as GetDatabaseResponse

      expect(result.schema.Tags.options).toEqual(['A', 'B'])
      expect(result.schema.Total.expression).toBe('prop("Price") * prop("Qty")')
    })

    it('should handle empty data_sources array', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse({ data_sources: [] }))

      const result = (await databases(notion, { action: 'get', database_id: 'db-1' })) as GetDatabaseResponse

      expect(result.data_source).toBeNull()
      expect(result.schema).toEqual({})
      expect(mockNotion.dataSources.retrieve).not.toHaveBeenCalled()
    })

    it('should throw when database_id is missing', async () => {
      await expect(databases(notion, { action: 'get' })).rejects.toThrow('database_id required')
    })
  })

  describe('query', () => {
    it('should use smart search filter when search is provided', async () => {
      mockNotion.databases.retrieve.mockResolvedValue(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValue({
        id: 'ds-1',
        properties: { Name: { type: 'title', title: {} } }
      })
      mockNotion.dataSources.query.mockResolvedValue({ results: [], next_cursor: null, has_more: false })

      await databases(notion, {
        action: 'query',
        database_id: 'db-1',
        search: 'findme'
      })

      expect(mockNotion.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            or: [{ property: 'Name', rich_text: { contains: 'findme' } }]
          }
        })
      )
    })
    it('should return null search filter when no text properties exist', async () => {
      mockNotion.databases.retrieve.mockResolvedValue(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValue({
        id: 'ds-1',
        properties: { Date: { type: 'date', date: {} } }
      })
      mockNotion.dataSources.query.mockResolvedValue({ results: [], next_cursor: null, has_more: false })

      await databases(notion, {
        action: 'query',
        database_id: 'db-1',
        search: 'findme'
      })

      expect(mockNotion.dataSources.query).toHaveBeenCalledWith(
        expect.not.objectContaining({
          filter: expect.anything()
        })
      )
    })

    it('should query via data source and format results', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'page-1',
            url: 'https://notion.so/page-1',
            properties: {
              Name: { type: 'title', title: [{ plain_text: 'Item 1' }] },
              Status: { type: 'select', select: { name: 'Active' } }
            }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, { action: 'query', database_id: 'db-1' })) as QueryDatabaseResponse

      expect(result.action).toBe('query')
      expect(result.database_id).toBe('db-1')
      expect(result.data_source_id).toBe('ds-1')
      expect(result.total).toBe(1)
      expect(result.results[0]).toEqual({
        page_id: 'page-1',
        url: 'https://notion.so/page-1',
        Name: 'Item 1',
        Status: 'Active'
      })
    })

    it('should pass filters and sorts to query', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const filter = { property: 'Status', select: { equals: 'Active' } }
      const sorts = [{ property: 'Name', direction: 'ascending' }]

      await databases(notion, {
        action: 'query',
        database_id: 'db-1',
        filters: filter,
        sorts
      })

      expect(mockNotion.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          data_source_id: 'ds-1',
          filter,
          sorts,
          page_size: 100
        })
      )
    })

    it('should build OR filter for smart search on text properties', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValueOnce(
        makeDataSourceResponse({
          properties: {
            Name: { type: 'title', id: 'prop-1' },
            Notes: { type: 'rich_text', id: 'prop-5' },
            Count: { type: 'number', id: 'prop-6' }
          }
        })
      )
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [],
        next_cursor: null,
        has_more: false
      })

      await databases(notion, {
        action: 'query',
        database_id: 'db-1',
        search: 'hello'
      })

      expect(mockNotion.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            or: [
              { property: 'Name', rich_text: { contains: 'hello' } },
              { property: 'Notes', rich_text: { contains: 'hello' } }
            ]
          }
        })
      )
    })

    it('should limit results when limit is specified', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', url: 'u1', properties: {} },
          { id: 'p2', url: 'u2', properties: {} },
          { id: 'p3', url: 'u3', properties: {} }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'query',
        database_id: 'db-1',
        limit: 2
      })) as QueryDatabaseResponse

      expect(result.total).toBe(2)
      expect(result.results).toHaveLength(2)
    })

    it('should format various property types in results', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'page-2',
            url: 'https://notion.so/page-2',
            properties: {
              Name: { type: 'title', title: [{ plain_text: 'Test' }] },
              Desc: { type: 'rich_text', rich_text: [{ plain_text: 'A desc' }] },
              Tags: { type: 'multi_select', multi_select: [{ name: 'X' }, { name: 'Y' }] },
              Count: { type: 'number', number: 42 },
              Done: { type: 'checkbox', checkbox: true },
              Link: { type: 'url', url: 'https://example.com' },
              Email: { type: 'email', email: 'a@b.com' },
              Phone: { type: 'phone_number', phone_number: '123' },
              Due: { type: 'date', date: { start: '2025-01-01', end: '2025-01-31' } }
            }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, { action: 'query', database_id: 'db-1' })) as QueryDatabaseResponse
      const page = result.results[0]

      expect(page.Name).toBe('Test')
      expect(page.Desc).toBe('A desc')
      expect(page.Tags).toEqual(['X', 'Y'])
      expect(page.Count).toBe(42)
      expect(page.Done).toBe(true)
      expect(page.Link).toBe('https://example.com')
      expect(page.Email).toBe('a@b.com')
      expect(page.Phone).toBe('123')
      expect(page.Due).toBe('2025-01-01 to 2025-01-31')
    })

    it('should throw when no data sources exist', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse({ data_sources: [] }))

      await expect(databases(notion, { action: 'query', database_id: 'db-1' })).rejects.toThrow(
        'Database has no data sources'
      )
    })

    it('should resolve data_source_id when database_id is not found', async () => {
      // databases.retrieve returns NOT_FOUND
      mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
      // dataSources.retrieve succeeds (fallback path)
      mockNotion.dataSources.retrieve
        .mockResolvedValueOnce({
          id: 'ds-fallback',
          parent: { database_id: 'db-parent' }
        })
        .mockResolvedValueOnce(makeDataSourceResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'query',
        database_id: 'ds-fallback'
      })) as QueryDatabaseResponse

      expect(result.database_id).toBe('db-parent')
    })

    it('should throw when ID is neither database nor data source', async () => {
      mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
      mockNotion.dataSources.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })

      await expect(databases(notion, { action: 'query', database_id: 'bad-id' })).rejects.toThrow(
        'is not a valid database or data source'
      )
    })

    it('should throw when database_id is missing', async () => {
      await expect(databases(notion, { action: 'query' })).rejects.toThrow('database_id required')
    })
  })

  describe('create_page', () => {
    beforeEach(() => {
      schemaCache.clear()
      resolutionCache.clear()
      mockNotion.databases.retrieve.mockResolvedValue(makeDbRetrieveResponse())
      mockNotion.dataSources.retrieve.mockResolvedValue(makeDataSourceResponse())
    })

    it('should create a page with page_properties', async () => {
      mockNotion.pages.create.mockResolvedValueOnce({
        id: 'new-page-1',
        url: 'https://notion.so/new-page-1'
      })

      const result = (await databases(notion, {
        action: 'create_page',
        database_id: 'db-1',
        page_properties: { Name: 'New Item', Status: 'Active' }
      })) as CreateDatabasePageResponse

      expect(result.action).toBe('create_page')
      expect(result.database_id).toBe('db-1')
      expect(result.data_source_id).toBe('ds-1')
      expect(result.processed).toBe(1)
      expect(result.results[0]).toEqual({
        page_id: 'new-page-1',
        url: 'https://notion.so/new-page-1',
        created: true
      })

      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // Bug #11: must use data_source_id parent so multi-source databases work
          // (Notion API 2025-09-03 rejects database_id parent when DB has 2+ data sources)
          parent: { type: 'data_source_id', data_source_id: 'ds-1' }
        })
      )
    })

    it('should use data_source_id parent for multi-source databases (Bug #11 reverse test)', async () => {
      // Reverse contract from real Notion API 400:
      //   "Databases with multiple data sources are not supported in this API version."
      //   additional_data.error_type = "multiple_data_sources_for_database"
      // Root cause: bundle sent parent.database_id which Notion rejects when the
      // database has 2+ data sources. Fix uses parent.data_source_id — works for
      // both single- and multi-source DBs.
      mockNotion.pages.create.mockResolvedValueOnce({
        id: 'new-page-multi',
        url: 'https://notion.so/new-page-multi'
      })

      const result = (await databases(notion, {
        action: 'create_page',
        database_id: 'db-1',
        page_properties: { Name: 'Multi-source DB page' }
      })) as CreateDatabasePageResponse

      expect(result.processed).toBe(1)
      // The key assertion: parent MUST be data_source_id, not database_id.
      // If we ever regress, this catches it before users hit the 400 in prod.
      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'data_source_id', data_source_id: 'ds-1' }
        })
      )
      // And we must NOT send the wrong parent type.
      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.parent.database_id).toBeUndefined()
    })

    it('should create multiple pages with pages array', async () => {
      mockNotion.pages.create
        .mockResolvedValueOnce({ id: 'p-1', url: 'https://notion.so/p-1' })
        .mockResolvedValueOnce({ id: 'p-2', url: 'https://notion.so/p-2' })

      const result = (await databases(notion, {
        action: 'create_page',
        database_id: 'db-1',
        pages: [{ properties: { Name: 'Item 1' } }, { properties: { Name: 'Item 2' } }]
      })) as CreateDatabasePageResponse

      expect(result.processed).toBe(2)
      expect(result.results).toHaveLength(2)
      expect(mockNotion.pages.create).toHaveBeenCalledTimes(2)
    })

    it('should throw when database_id is missing', async () => {
      await expect(databases(notion, { action: 'create_page', page_properties: { Name: 'X' } })).rejects.toThrow(
        'database_id required'
      )
    })

    it('should throw when neither pages nor page_properties provided', async () => {
      await expect(databases(notion, { action: 'create_page', database_id: 'db-1' })).rejects.toThrow(
        'pages or page_properties required'
      )
    })

    it('should convert a status field string to status format (not select)', async () => {
      mockNotion.dataSources.retrieve.mockResolvedValueOnce(
        makeDataSourceResponse({
          properties: {
            Name: { type: 'title', id: 'prop-1' },
            State: { type: 'status', id: 'prop-3' }
          }
        })
      )
      mockNotion.pages.create.mockResolvedValueOnce({ id: 'p-status', url: 'https://notion.so/p-status' })

      await databases(notion, {
        action: 'create_page',
        database_id: 'db-1',
        page_properties: { Name: 'Todo item', State: 'Not started' }
      })

      expect(mockNotion.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            State: { status: { name: 'Not started' } }
          })
        })
      )
    })

    it('should throw with item index when pages array item is missing the properties wrapper', async () => {
      await expect(
        databases(notion, {
          action: 'create_page',
          database_id: 'db-1',
          pages: [{ Name: 'Flat item' } as any]
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('index 0'),
        code: 'VALIDATION_ERROR'
      })
    })

    it('should throw with correct index when second item is missing the properties wrapper', async () => {
      mockNotion.pages.create.mockResolvedValueOnce({ id: 'p-1', url: 'https://notion.so/p-1' })

      await expect(
        databases(notion, {
          action: 'create_page',
          database_id: 'db-1',
          pages: [{ properties: { Name: 'Valid' } }, { Name: 'Flat' } as any]
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('index 1'),
        code: 'VALIDATION_ERROR'
      })
      expect(mockNotion.pages.create).not.toHaveBeenCalled()
    })

    it('should throw when pages array item has null properties', async () => {
      await expect(
        databases(notion, {
          action: 'create_page',
          database_id: 'db-1',
          pages: [{ properties: null } as any]
        })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('should throw when pages array item is null', async () => {
      await expect(
        databases(notion, {
          action: 'create_page',
          database_id: 'db-1',
          pages: [null as any]
        })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })
  })

  describe('update_page', () => {
    it('should throw when item in pages array is missing page_id', async () => {
      await expect(
        databases(notion, {
          action: 'update_page',
          pages: [{ properties: { Status: 'Done' } }] as any
        })
      ).rejects.toThrow('page_id required for each item')
    })

    it('should update a single page with page_id and page_properties', async () => {
      mockNotion.pages.update.mockResolvedValueOnce({ id: 'page-1' })

      const result = (await databases(notion, {
        action: 'update_page',
        page_id: 'page-1',
        page_properties: { Status: 'Done' }
      })) as UpdateDatabasePageResponse

      expect(result.action).toBe('update_page')
      expect(result.processed).toBe(1)
      expect(result.results[0]).toEqual({ page_id: 'page-1', updated: true })
      expect(mockNotion.pages.update).toHaveBeenCalledWith(expect.objectContaining({ page_id: 'page-1' }))
    })

    it('should send `{ select: { name } }` (not `{ status: { name } }`) for a Status property on update_page when no schema is available', async () => {
      // update_page does not fetch the schema, so convertToNotionProperties falls back to
      // heuristic conversion. Most "Status"-named Notion columns are actually `select`,
      // so the fallback must use `select`, not `status` (which Notion API rejects for select columns).
      mockNotion.pages.update.mockResolvedValueOnce({ id: 'page-1' })

      await databases(notion, {
        action: 'update_page',
        page_id: 'page-1',
        page_properties: { Status: 'Active' }
      })

      expect(mockNotion.pages.update).toHaveBeenCalledWith({
        page_id: 'page-1',
        properties: { Status: { select: { name: 'Active' } } }
      })
    })

    it('should throw when pages array is provided but contains no properties', async () => {
      await expect(
        databases(notion, {
          action: 'update_page',
          pages: [{}, { something: 'else' }] as any
        })
      ).rejects.toThrow('Item at index 0 in the pages array is missing the "properties" key')
    })

    it('should update multiple pages with pages array', async () => {
      mockNotion.pages.update.mockResolvedValueOnce({ id: 'page-1' }).mockResolvedValueOnce({ id: 'page-2' })

      const result = (await databases(notion, {
        action: 'update_page',
        pages: [
          { page_id: 'page-1', properties: { Status: 'Done' } },
          { page_id: 'page-2', properties: { Status: 'Active' } }
        ]
      })) as UpdateDatabasePageResponse

      expect(result.processed).toBe(2)
      expect(result.results).toEqual([
        { page_id: 'page-1', updated: true },
        { page_id: 'page-2', updated: true }
      ])
    })

    it('should throw when neither pages nor page_id+page_properties provided', async () => {
      await expect(databases(notion, { action: 'update_page' })).rejects.toThrow(
        'pages or page_id+page_properties required'
      )
    })

    it('should throw with item index when pages array item is missing properties', async () => {
      await expect(
        databases(notion, {
          action: 'update_page',
          pages: [{ page_id: 'p-1', properties: null } as any]
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining('index 0'),
        code: 'VALIDATION_ERROR'
      })
    })
  })

  describe('delete_page', () => {
    it('should delete pages provided in pages array', async () => {
      mockNotion.pages.update.mockResolvedValue({})

      const result = (await databases(notion, {
        action: 'delete_page',
        pages: [{ page_id: 'p1' }, { page_id: 'p2' }] as any
      })) as DeleteDatabasePageResponse

      expect(result.processed).toBe(2)
      expect(mockNotion.pages.update).toHaveBeenCalledTimes(2)
    })

    it('should delete pages by page_ids', async () => {
      mockNotion.pages.update.mockResolvedValueOnce({}).mockResolvedValueOnce({})

      const result = (await databases(notion, {
        action: 'delete_page',
        page_ids: ['page-1', 'page-2']
      })) as DeleteDatabasePageResponse

      expect(result.action).toBe('delete_page')
      expect(result.processed).toBe(2)
      expect(result.results).toEqual([
        { page_id: 'page-1', deleted: true },
        { page_id: 'page-2', deleted: true }
      ])

      for (const call of mockNotion.pages.update.mock.calls) {
        expect(call[0].archived).toBe(true)
      }
    })

    it('should delete a single page by page_id', async () => {
      mockNotion.pages.update.mockResolvedValueOnce({})

      const result = (await databases(notion, {
        action: 'delete_page',
        page_id: 'page-solo'
      })) as DeleteDatabasePageResponse

      expect(result.processed).toBe(1)
      expect(result.results[0]).toEqual({ page_id: 'page-solo', deleted: true })
      expect(mockNotion.pages.update).toHaveBeenCalledWith({
        page_id: 'page-solo',
        archived: true
      })
    })

    it('should throw when no page ids provided', async () => {
      await expect(databases(notion, { action: 'delete_page' })).rejects.toThrow('page_id or page_ids required')
    })
  })

  describe('create_data_source', () => {
    it('should create a data source with required params', async () => {
      mockNotion.dataSources.create.mockResolvedValueOnce({ id: 'ds-new' })

      const result = (await databases(notion, {
        action: 'create_data_source',
        database_id: 'db-1',
        title: 'New Source',
        properties: { Name: { title: {} } }
      })) as CreateDataSourceResponse

      expect(result).toEqual({
        action: 'create_data_source',
        data_source_id: 'ds-new',
        database_id: 'db-1',
        created: true
      })

      expect(mockNotion.dataSources.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'database_id', database_id: 'db-1' },
          properties: { Name: { title: {} } }
        })
      )
    })

    it('should include description when provided', async () => {
      mockNotion.dataSources.create.mockResolvedValueOnce({ id: 'ds-2' })

      await databases(notion, {
        action: 'create_data_source',
        database_id: 'db-1',
        title: 'With Desc',
        description: 'My description',
        properties: { Name: { title: {} } }
      })

      const call = mockNotion.dataSources.create.mock.calls[0][0]
      expect(call.description).toBeDefined()
      expect(call.description[0].text.content).toBe('My description')
    })

    it('should throw when required params are missing', async () => {
      await expect(databases(notion, { action: 'create_data_source', database_id: 'db-1' })).rejects.toThrow(
        'database_id, title, and properties required'
      )

      await expect(databases(notion, { action: 'create_data_source', title: 'X', properties: {} })).rejects.toThrow(
        'database_id, title, and properties required'
      )
    })
  })

  describe('update_data_source', () => {
    it('should update data source title', async () => {
      mockNotion.dataSources.update.mockResolvedValueOnce({})

      const result = (await databases(notion, {
        action: 'update_data_source',
        data_source_id: 'ds-1',
        title: 'Renamed'
      })) as UpdateDataSourceResponse

      expect(result).toEqual({
        action: 'update_data_source',
        data_source_id: 'ds-1',
        updated: true
      })

      const call = mockNotion.dataSources.update.mock.calls[0][0]
      expect(call.data_source_id).toBe('ds-1')
      expect(call.title[0].text.content).toBe('Renamed')
    })

    it('should update description and properties together', async () => {
      mockNotion.dataSources.update.mockResolvedValueOnce({})

      await databases(notion, {
        action: 'update_data_source',
        data_source_id: 'ds-1',
        description: 'Updated desc',
        properties: { Priority: { select: {} } }
      })

      const call = mockNotion.dataSources.update.mock.calls[0][0]
      expect(call.description[0].text.content).toBe('Updated desc')
      expect(call.properties).toEqual({ Priority: { select: {} } })
    })

    it('should throw when data_source_id is missing', async () => {
      await expect(databases(notion, { action: 'update_data_source', title: 'X' })).rejects.toThrow(
        'data_source_id required'
      )
    })

    it('should throw when no updates are provided', async () => {
      await expect(databases(notion, { action: 'update_data_source', data_source_id: 'ds-1' })).rejects.toThrow(
        'No updates provided'
      )
    })
  })

  describe('update_database', () => {
    it('should update database title', async () => {
      mockNotion.databases.update.mockResolvedValueOnce({})

      const result = (await databases(notion, {
        action: 'update_database',
        database_id: 'db-1',
        title: 'New Title'
      })) as UpdateDatabaseResponse

      expect(result).toEqual({
        action: 'update_database',
        database_id: 'db-1',
        updated: true
      })

      const call = mockNotion.databases.update.mock.calls[0][0]
      // normalizeId strips hyphens for Notion API call
      expect(call.database_id).toBe('db1')
      expect(call.title[0].text.content).toBe('New Title')
    })

    it('should update icon and cover', async () => {
      mockNotion.databases.update.mockResolvedValueOnce({})

      await databases(notion, {
        action: 'update_database',
        database_id: 'db-1',
        icon: '📋',
        cover: 'https://example.com/cover.jpg'
      })

      const call = mockNotion.databases.update.mock.calls[0][0]
      expect(call.icon).toEqual({ type: 'emoji', emoji: '📋' })
      expect(call.cover).toEqual({
        type: 'external',
        external: { url: 'https://example.com/cover.jpg' }
      })
    })

    it('should update parent_id, description, and is_inline', async () => {
      mockNotion.databases.update.mockResolvedValueOnce({})

      await databases(notion, {
        action: 'update_database',
        database_id: 'db-1',
        parent_id: 'new-parent',
        description: 'Updated',
        is_inline: true
      })

      const call = mockNotion.databases.update.mock.calls[0][0]
      expect(call.parent).toEqual({ type: 'page_id', page_id: 'new-parent' })
      expect(call.description[0].text.content).toBe('Updated')
      expect(call.is_inline).toBe(true)
    })

    it('should throw when database_id is missing', async () => {
      await expect(databases(notion, { action: 'update_database', title: 'X' })).rejects.toThrow('database_id required')
    })

    it('should throw when no updates are provided', async () => {
      await expect(databases(notion, { action: 'update_database', database_id: 'db-1' })).rejects.toThrow(
        'No updates provided'
      )
    })
  })

  describe('list_templates', () => {
    it('should list templates from first data source', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.listTemplates.mockResolvedValueOnce({
        templates: [
          {
            id: 'tmpl-1',
            properties: {
              Name: { title: [{ plain_text: 'Template A' }] }
            }
          },
          {
            id: 'tmpl-2',
            properties: {
              title: { title: [{ plain_text: 'Template B' }] }
            }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'list_templates',
        database_id: 'db-1'
      })) as ListDataSourceTemplatesResponse

      expect(result.action).toBe('list_templates')
      expect(result.database_id).toBe('db-1')
      expect(result.data_source_id).toBe('ds-1')
      expect(result.total).toBe(2)
      expect(result.templates[0].template_id).toBe('tmpl-1')
      expect(result.templates[0].title).toBe('Template A')
    })

    it('should use specific data_source_id when provided', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.listTemplates.mockResolvedValueOnce({
        templates: [],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'list_templates',
        database_id: 'db-1',
        data_source_id: 'ds-custom'
      })) as ListDataSourceTemplatesResponse

      expect(result.data_source_id).toBe('ds-custom')
      expect(mockNotion.dataSources.listTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ data_source_id: 'ds-custom' })
      )
    })

    it('should throw when no data sources exist', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse({ data_sources: [] }))

      await expect(databases(notion, { action: 'list_templates', database_id: 'db-1' })).rejects.toThrow(
        'Database has no data sources'
      )
    })

    it('should throw when database_id is missing', async () => {
      await expect(databases(notion, { action: 'list_templates' })).rejects.toThrow('database_id required')
    })
  })

  describe('ID resolution', () => {
    it('should use resolutionCache on repeated calls', async () => {
      mockNotion.databases.retrieve.mockResolvedValue(makeDbRetrieveResponse())
      mockNotion.dataSources.listTemplates.mockResolvedValue({ templates: [], next_cursor: null, has_more: false })

      // First call
      await databases(notion, { action: 'list_templates', database_id: 'db-1' })
      expect(mockNotion.databases.retrieve).toHaveBeenCalledTimes(1)

      // Second call
      await databases(notion, { action: 'list_templates', database_id: 'db-1' })
      expect(mockNotion.databases.retrieve).toHaveBeenCalledTimes(1)
    })

    it('should resolve data_source_id when database retrieval fails with object_not_found', async () => {
      mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-123',
        parent: { database_id: 'db-456' }
      })
      mockNotion.dataSources.listTemplates.mockResolvedValueOnce({ templates: [], next_cursor: null, has_more: false })

      const result = await databases(notion, {
        action: 'list_templates',
        database_id: 'ds-123'
      })

      expect(result.action).toBe('list_templates')
      expect(mockNotion.databases.retrieve).toHaveBeenCalled()
      expect(mockNotion.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: 'ds123' })
    })

    it('should use normalized ID when data source has no parent database_id', async () => {
      mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-123',
        parent: {} // No database_id
      })
      mockNotion.dataSources.listTemplates.mockResolvedValueOnce({ templates: [], next_cursor: null, has_more: false })

      const result = (await databases(notion, {
        action: 'list_templates',
        database_id: 'ds-123'
      })) as ListDataSourceTemplatesResponse

      // normalizeId('ds-123') -> 'ds123'
      expect(result.database_id).toBe('ds123')
      expect(result.data_source_id).toBe('ds-123')
    })

    it('should throw NOT_FOUND when both database and data source are not found', async () => {
      mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
      mockNotion.dataSources.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })

      await expect(
        databases(notion, {
          action: 'list_templates',
          database_id: 'non-existent'
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: expect.stringContaining('is not a valid database or data source')
      })
    })

    it('should throw NOT_FOUND when data source retrieval fails with generic error', async () => {
      mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
      mockNotion.dataSources.retrieve.mockRejectedValueOnce(new Error('Generic failure'))

      await expect(
        databases(notion, {
          action: 'list_templates',
          database_id: 'ds-123'
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: expect.stringContaining('is not a valid database or data source')
      })
    })

    it('should rethrow non-object_not_found errors from database retrieval', async () => {
      const error = new Error('API Error') as any
      error.code = 'internal_server_error'
      mockNotion.databases.retrieve.mockRejectedValueOnce(error)

      await expect(
        databases(notion, {
          action: 'list_templates',
          database_id: 'db-1'
        })
      ).rejects.toThrow('API Error')
    })
    it('should throw when pages array is provided but contains no page_ids', async () => {
      await expect(
        databases(notion, {
          action: 'delete_page',
          pages: [{}, { something: 'else' }] as any
        })
      ).rejects.toThrow('page_id or page_ids required')
    })
  })

  describe('unknown action', () => {
    it('should throw on unknown action with tool name', async () => {
      await expect(databases(notion, { action: 'invalid' as any })).rejects.toThrow(
        "Unknown action: 'invalid' for databases."
      )
    })

    it('should suggest closest match for typo in action', async () => {
      // 'querry' is one typo away from 'query'
      await expect(databases(notion, { action: 'querry' as any })).rejects.toThrow("Did you mean 'query'?")
    })
  })

  describe('aggregate', () => {
    it('should count all rows when given a count aggregation', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: {} },
          { id: 'p2', properties: {} },
          { id: 'p3', properties: {} }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'count', alias: 'total' }]
      })) as AggregateDatabaseResponse

      expect(result).toEqual({
        action: 'aggregate',
        database_id: 'db-1',
        data_source_id: 'ds-1',
        total_rows_scanned: 3,
        results: { total: 3 }
      })
    })

    it('should sum a numeric property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Hours: { type: 'number', number: 5 } } },
          { id: 'p2', properties: { Hours: { type: 'number', number: 3 } } },
          { id: 'p3', properties: { Hours: { type: 'number', number: 7 } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'sum', property: 'Hours', alias: 'total_hours' }]
      })) as AggregateDatabaseResponse

      expect(result.results).toEqual({ total_hours: 15 })
    })

    it('should average a numeric property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Hours: { type: 'number', number: 6 } } },
          { id: 'p2', properties: { Hours: { type: 'number', number: 12 } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'avg', property: 'Hours', alias: 'avg_hours' }]
      })) as AggregateDatabaseResponse

      expect(result.results.avg_hours).toBe(9) // 6 + 12 / 2
    })

    it('should sum a formula property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Earned: { type: 'formula', formula: { type: 'number', number: 100 } } } },
          { id: 'p2', properties: { Earned: { type: 'formula', formula: { type: 'number', number: 50 } } } },
          { id: 'p3', properties: { Earned: { type: 'formula', formula: { type: 'number', number: 75 } } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'sum', property: 'Earned', alias: 'total_earned' }]
      })) as AggregateDatabaseResponse

      expect(result.results).toEqual({ total_earned: 225 })
    })

    it('should return null for sum/avg when no rows have the property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [{ id: 'p1', properties: { Other: { type: 'number', number: 5 } } }],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [
          { type: 'sum', property: 'Hours', alias: 'total_hours' },
          { type: 'avg', property: 'Hours', alias: 'avg_hours' }
        ]
      })) as AggregateDatabaseResponse

      expect(result.results).toEqual({ total_hours: null, avg_hours: null })
    })

    it('should count unique values for a select property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Owner: { type: 'select', select: { name: 'Alice' } } } },
          { id: 'p2', properties: { Owner: { type: 'select', select: { name: 'Bob' } } } },
          { id: 'p3', properties: { Owner: { type: 'select', select: { name: 'Alice' } } } },
          { id: 'p4', properties: { Owner: { type: 'select', select: null } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'unique_count', property: 'Owner', alias: 'unique_owners' }]
      })) as AggregateDatabaseResponse

      // Alice + Bob = 2 unique; null Owner skipped
      expect(result.results.unique_owners).toBe(2)
    })

    it('should find min and max of a numeric property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Score: { type: 'number', number: 42 } } },
          { id: 'p2', properties: { Score: { type: 'number', number: 7 } } },
          { id: 'p3', properties: { Score: { type: 'number', number: 99 } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [
          { type: 'min', property: 'Score', alias: 'lowest' },
          { type: 'max', property: 'Score', alias: 'highest' }
        ]
      })) as AggregateDatabaseResponse

      expect(result.results).toEqual({ lowest: 7, highest: 99 })
    })

    it('should throw when database_id is missing', async () => {
      await expect(
        databases(notion, {
          action: 'aggregate',
          aggregations: [{ type: 'count' }]
        })
      ).rejects.toThrow('database_id required for aggregate action')
    })

    it('should throw when aggregations is missing or empty', async () => {
      await expect(databases(notion, { action: 'aggregate', database_id: 'db-1' })).rejects.toThrow(
        'aggregations required for aggregate action'
      )

      await expect(databases(notion, { action: 'aggregate', database_id: 'db-1', aggregations: [] })).rejects.toThrow(
        'aggregations required for aggregate action'
      )
    })

    it('should count unique values for a formula boolean property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: true } } } },
          { id: 'p2', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: false } } } },
          { id: 'p3', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: true } } } },
          { id: 'p4', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: true } } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'unique_count', property: 'IsActive', alias: 'distinct_active' }]
      })) as AggregateDatabaseResponse

      // true + false = 2 unique booleans
      expect(result.results.distinct_active).toBe(2)
    })

    it('should return null for sum on a formula boolean property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: true } } } },
          { id: 'p2', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: false } } } },
          { id: 'p3', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: true } } } },
          { id: 'p4', properties: { IsActive: { type: 'formula', formula: { type: 'boolean', boolean: true } } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'sum', property: 'IsActive', alias: 'sum_active' }]
      })) as AggregateDatabaseResponse

      // Booleans are not aggregable numerically -> null
      expect(result.results.sum_active).toBeNull()
    })

    it('should count unique values for a formula date property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-01' } } } }
          },
          {
            id: 'p2',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-02' } } } }
          },
          {
            id: 'p3',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-01' } } } }
          },
          {
            id: 'p4',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-03' } } } }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'unique_count', property: 'DueDate', alias: 'distinct_dates' }]
      })) as AggregateDatabaseResponse

      // 2025-01-01, 2025-01-02, 2025-01-03 = 3 unique dates
      expect(result.results.distinct_dates).toBe(3)
    })

    it('should return null for sum on a formula date property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-01' } } } }
          },
          {
            id: 'p2',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-02' } } } }
          },
          {
            id: 'p3',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-01' } } } }
          },
          {
            id: 'p4',
            properties: { DueDate: { type: 'formula', formula: { type: 'date', date: { start: '2025-01-03' } } } }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'sum', property: 'DueDate', alias: 'sum_dates' }]
      })) as AggregateDatabaseResponse

      // Dates are not numeric -> null
      expect(result.results.sum_dates).toBeNull()
    })

    it('should count unique values for a non-numeric formula string property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            properties: { PriorityLabel: { type: 'formula', formula: { type: 'string', string: 'urgent' } } }
          },
          { id: 'p2', properties: { PriorityLabel: { type: 'formula', formula: { type: 'string', string: 'low' } } } },
          {
            id: 'p3',
            properties: { PriorityLabel: { type: 'formula', formula: { type: 'string', string: 'urgent' } } }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: [{ type: 'unique_count', property: 'PriorityLabel', alias: 'distinct_labels' }]
      })) as AggregateDatabaseResponse

      // urgent + low = 2 unique labels
      expect(result.results.distinct_labels).toBe(2)
    })
  })

  describe('group_by', () => {
    it('should group by a select property and count per group', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Owner: { type: 'select', select: { name: 'Alice' } } } },
          { id: 'p2', properties: { Owner: { type: 'select', select: { name: 'Bob' } } } },
          { id: 'p3', properties: { Owner: { type: 'select', select: { name: 'Alice' } } } },
          { id: 'p4', properties: { Owner: { type: 'select', select: { name: 'Alice' } } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'group_by',
        database_id: 'db-1',
        group_by: { property: 'Owner' },
        aggregations: [{ type: 'count' }]
      })) as GroupByDatabaseResponse

      // Groups are sorted by key alphabetically; null last
      expect(result).toEqual({
        action: 'group_by',
        database_id: 'db-1',
        data_source_id: 'ds-1',
        total_rows_scanned: 4,
        group_by_property: 'Owner',
        groups: [
          { key: 'Alice', count: 3, aggregations: { count: 3 } },
          { key: 'Bob', count: 1, aggregations: { count: 1 } }
        ]
      })
    })

    it('should group by with sum on numeric property', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'p1',
            properties: { Owner: { type: 'select', select: { name: 'Alice' } }, Hours: { type: 'number', number: 5 } }
          },
          {
            id: 'p2',
            properties: { Owner: { type: 'select', select: { name: 'Alice' } }, Hours: { type: 'number', number: 3 } }
          },
          {
            id: 'p3',
            properties: { Owner: { type: 'select', select: { name: 'Bob' } }, Hours: { type: 'number', number: 7 } }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'group_by',
        database_id: 'db-1',
        group_by: { property: 'Owner' },
        aggregations: [{ type: 'count' }, { type: 'sum', property: 'Hours', alias: 'total_hours' }]
      })) as GroupByDatabaseResponse

      expect(result.groups).toEqual([
        { key: 'Alice', count: 2, aggregations: { count: 2, total_hours: 8 } },
        { key: 'Bob', count: 1, aggregations: { count: 1, total_hours: 7 } }
      ])
    })

    it('should put null property values into a null-keyed group at the end', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          { id: 'p1', properties: { Owner: { type: 'select', select: { name: 'Alice' } } } },
          { id: 'p2', properties: { Owner: { type: 'select', select: null } } },
          { id: 'p3', properties: { Owner: { type: 'select', select: { name: 'Bob' } } } }
        ],
        next_cursor: null,
        has_more: false
      })

      const result = (await databases(notion, {
        action: 'group_by',
        database_id: 'db-1',
        group_by: { property: 'Owner' },
        aggregations: [{ type: 'count' }]
      })) as GroupByDatabaseResponse

      expect(result.groups.map((g) => g.key)).toEqual(['Alice', 'Bob', null])
      expect(result.groups[2].count).toBe(1)
    })

    it('should throw when database_id is missing', async () => {
      await expect(
        databases(notion, {
          action: 'group_by',
          group_by: { property: 'Owner' },
          aggregations: [{ type: 'count' }]
        })
      ).rejects.toThrow('database_id required for group_by action')
    })

    it('should throw when group_by is missing', async () => {
      await expect(
        databases(notion, {
          action: 'group_by',
          database_id: 'db-1',
          aggregations: [{ type: 'count' }]
        })
      ).rejects.toThrow('group_by required for group_by action')
    })
  })

  // ---------------------------------------------------------------------------
  // JSON-string fallback (Claude Code XML serialization workaround)
  // ---------------------------------------------------------------------------
  describe('JSON-string input fallback (Claude Code XML serialization workaround)', () => {
    it('create_database accepts properties as JSON-stringified object', async () => {
      mockNotion.databases.create.mockResolvedValue({
        id: 'db-new',
        data_sources: [{ id: 'ds-new' }]
      })

      await databases(mockNotion as any, {
        action: 'create',
        parent_id: 'parent-page',
        title: 'JSON Test DB',
        properties: '{"Name":{"title":{}},"Status":{"select":{}}}' as unknown as Record<string, any>
      })

      const callArgs = mockNotion.databases.create.mock.calls[0][0]
      // API 2025-09-03: properties live under initial_data_source
      expect(callArgs.initial_data_source.properties).toEqual({
        Name: { title: {} },
        Status: { select: {} }
      })
    })

    it('create_page accepts page_properties as JSON-stringified object', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-1',
        data_sources: [{ id: 'ds-1' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        id: 'ds-1',
        properties: { 数字: { type: 'number', id: 'pn' } }
      })
      mockNotion.pages.create.mockResolvedValue({ id: 'new-page' })

      await databases(mockNotion as any, {
        action: 'create_page',
        database_id: 'db-1',
        page_properties: '{"数字":99}' as unknown as Record<string, any>
      })

      const callArgs = mockNotion.pages.create.mock.calls[0][0]
      expect(callArgs.properties).toEqual({ 数字: { number: 99 } })
    })

    it('query accepts filters as JSON-stringified object', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      mockNotion.dataSources.query.mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null })

      await databases(mockNotion as any, {
        action: 'query',
        database_id: 'db-1',
        filters: '{"property":"Status","select":{"equals":"Active"}}'
      })

      expect(mockNotion.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { property: 'Status', select: { equals: 'Active' } }
        })
      )
    })

    it('aggregate accepts aggregations as JSON-stringified array', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-1',
        data_sources: [{ id: 'ds-1' }]
      })
      mockNotion.dataSources.query.mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null })

      await databases(mockNotion as any, {
        action: 'aggregate',
        database_id: 'db-1',
        aggregations: '[{"type":"count","alias":"total"}]' as unknown as Parameters<typeof databases>[1]['aggregations']
      })

      expect(mockNotion.dataSources.query.mock.calls[0][0].filter).toBeUndefined()
    })

    it('group_by accepts group_by as JSON-stringified object', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-1',
        data_sources: [{ id: 'ds-1' }]
      })
      mockNotion.dataSources.query.mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null })

      await databases(mockNotion as any, {
        action: 'group_by',
        database_id: 'db-1',
        group_by: '{"property":"Owner"}' as unknown as Parameters<typeof databases>[1]['group_by'],
        aggregations: '[{"type":"count"}]' as unknown as Parameters<typeof databases>[1]['aggregations']
      })

      expect(mockNotion.dataSources.query).toHaveBeenCalled()
    })

    it('throws NotionMCPError on malformed JSON string', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce(makeDbRetrieveResponse())
      await expect(
        databases(mockNotion as any, {
          action: 'query',
          database_id: 'db-1',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentionally invalid JSON for test
          filters: '{not-valid'
        })
      ).rejects.toThrow(/Failed to parse JSON string/)
    })
  })
})

describe('update_page schema injection (RC-1)', () => {
  beforeEach(() => {
    schemaCache.clear()
    resolutionCache.clear()
    vi.clearAllMocks()
  })

  it('wraps a rich_text string value using the row schema', async () => {
    mockNotion.pages.retrieve.mockResolvedValue({
      id: 'page-1',
      parent: { type: 'data_source_id', data_source_id: 'ds-1', database_id: 'db-1' }
    })
    mockNotion.databases.retrieve.mockResolvedValue({ id: 'db-1', data_sources: [{ id: 'ds-1' }] })
    mockNotion.dataSources.retrieve.mockResolvedValue({
      id: 'ds-1',
      properties: {
        文本: { id: 'aVcE', type: 'rich_text', rich_text: {} },
        名称: { id: 'title', type: 'title', title: {} }
      }
    })
    mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

    await databases(notion, { action: 'update_page', page_id: 'page-1', page_properties: { 文本: '新值' } })

    expect(mockNotion.pages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-1',
        properties: { 文本: { rich_text: [expect.objectContaining({ text: { content: '新值', link: null } })] } }
      })
    )
  })

  it('strips readonly properties (e.g. formula) before update', async () => {
    mockNotion.pages.retrieve.mockResolvedValue({
      id: 'page-1',
      parent: { type: 'data_source_id', data_source_id: 'ds-1', database_id: 'db-1' }
    })
    mockNotion.databases.retrieve.mockResolvedValue({ id: 'db-1', data_sources: [{ id: 'ds-1' }] })
    mockNotion.dataSources.retrieve.mockResolvedValue({
      id: 'ds-1',
      properties: {
        名称: { id: 'title', type: 'title', title: {} },
        公式: { id: 'f1', type: 'formula', formula: {} }
      }
    })
    mockNotion.pages.update.mockResolvedValue({ id: 'page-1' })

    await databases(notion, {
      action: 'update_page',
      page_id: 'page-1',
      page_properties: { 名称: '标题', 公式: { type: 'formula', formula: { expression: '1' } } }
    })

    const passed = (mockNotion.pages.update.mock.calls[0][0] as any).properties
    expect(passed).not.toHaveProperty('公式')
    expect(passed).toHaveProperty('名称')
  })
})
