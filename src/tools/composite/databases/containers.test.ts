import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as RichText from '../../helpers/richtext.js'
import {
  createDatabase,
  createDataSource,
  getDatabase,
  listDataSourceTemplates,
  normalizePropertyOptions,
  queryDatabase,
  updateDatabaseContainer,
  updateDataSource,
  validateTitleProperty
} from './containers.js'

describe('databases/containers', () => {
  const mockNotion = {
    databases: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn()
    },
    dataSources: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      query: vi.fn(),
      listTemplates: vi.fn()
    }
  }

  const notion = mockNotion as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('normalizePropertyOptions', () => {
    it('normalizes array-style options for multi_select, select, and status', () => {
      const input = {
        Tags: { multi_select: [{ name: 'A' }, { name: 'B' }] },
        Category: { select: [{ name: 'Tech' }] },
        Status: { status: [{ name: 'Done' }] },
        Count: { number: {} }
      }

      const normalized = normalizePropertyOptions(input)
      expect(normalized).toEqual({
        Tags: { multi_select: { options: [{ name: 'A' }, { name: 'B' }] } },
        Category: { select: { options: [{ name: 'Tech' }] } },
        Status: { status: { options: [{ name: 'Done' }] } },
        Count: { number: {} }
      })
    })

    it('normalizes string array options like ["A", "B"] into [{ name: "A" }, { name: "B" }]', () => {
      const input = {
        Category: { select: ['Tech', 'Design'] },
        Tags: { multi_select: ['AI', 'MCP'] }
      }
      const normalized = normalizePropertyOptions(input)
      expect(normalized).toEqual({
        Category: { select: { options: [{ name: 'Tech' }, { name: 'Design' }] } },
        Tags: { multi_select: { options: [{ name: 'AI' }, { name: 'MCP' }] } }
      })
    })

    it('leaves already normalized options unchanged', () => {
      const input = {
        Tags: { multi_select: { options: [{ name: 'A' }] } }
      }
      expect(normalizePropertyOptions(input)).toEqual(input)
    })
  })

  describe('validateTitleProperty', () => {
    it('passes when at least one title property exists', () => {
      expect(() => {
        validateTitleProperty({
          Name: { title: {} },
          Description: { rich_text: {} }
        })
      }).not.toThrow()
    })

    it('throws VALIDATION_ERROR when no title property exists', () => {
      expect(() => {
        validateTitleProperty({
          Description: { rich_text: {} }
        })
      }).toThrowError(/must include a title property/)
    })
  })

  describe('createDatabase', () => {
    it('validates required fields', async () => {
      await expect(createDatabase(notion, { action: 'create' } as any)).rejects.toThrowError(
        /parent_id, title, and properties required/
      )
    })

    it('creates database with formatted payload and initial_data_source', async () => {
      mockNotion.databases.create.mockResolvedValueOnce({
        id: 'db-123',
        url: 'https://notion.so/db-123',
        data_sources: [{ id: 'ds-123' }]
      })

      const res = await createDatabase(notion, {
        action: 'create',
        parent_id: 'parent-1',
        title: 'Project Roadmap',
        properties: { Name: { title: {} } },
        description: 'Roadmap desc',
        is_inline: true,
        icon: '🚀'
      })

      expect(mockNotion.databases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'page_id', page_id: 'parent-1' },
          title: [RichText.text('Project Roadmap')],
          initial_data_source: {
            properties: { Name: { title: {} } }
          },
          description: [RichText.text('Roadmap desc')],
          is_inline: true,
          icon: { type: 'emoji', emoji: '🚀' }
        })
      )

      expect(res).toEqual({
        action: 'create',
        database_id: 'db-123',
        data_source_id: 'ds-123',
        url: 'https://notion.so/db-123',
        created: true
      })
    })

    it('normalizes array-style options and validates title property in createDatabase', async () => {
      mockNotion.databases.create.mockResolvedValueOnce({
        id: 'db-456',
        url: 'https://notion.so/db-456'
      })

      await createDatabase(notion, {
        action: 'create',
        parent_id: 'parent-1',
        title: 'Project Roadmap',
        properties: {
          Name: { title: {} },
          Status: { select: ['待处理', '已处理'] }
        }
      })

      expect(mockNotion.databases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          initial_data_source: {
            properties: {
              Name: { title: {} },
              Status: { select: { options: [{ name: '待处理' }, { name: '已处理' }] } }
            }
          }
        })
      )
    })

    it('throws VALIDATION_ERROR in createDatabase if title property is missing', async () => {
      await expect(
        createDatabase(notion, {
          action: 'create',
          parent_id: 'parent-1',
          title: 'No Title DB',
          properties: {
            Status: { select: [{ name: 'Done' }] }
          }
        })
      ).rejects.toThrowError(/must include a title property/)
    })
  })

  describe('getDatabase', () => {
    it('validates database_id', async () => {
      await expect(getDatabase(notion, { action: 'get' } as any)).rejects.toThrowError(/database_id required/)
    })

    it('retrieves database and constructs schema map', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-123',
        title: [{ plain_text: 'DB Title' }],
        description: [{ plain_text: 'DB Description' }],
        url: 'https://notion.so/db-123',
        is_inline: false,
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-02T00:00:00.000Z',
        data_sources: [{ id: 'ds-123', name: 'Main' }]
      })
      mockNotion.dataSources.retrieve.mockResolvedValueOnce({
        properties: {
          Name: { id: 'title-id', type: 'title', title: {} }
        }
      })

      const res = await getDatabase(notion, { action: 'get', database_id: 'db-123' })
      expect(res).toEqual({
        action: 'get',
        database_id: 'db-123',
        title: 'DB Title',
        description: 'DB Description',
        url: 'https://notion.so/db-123',
        is_inline: false,
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-02T00:00:00.000Z',
        data_source: { id: 'ds-123', name: 'Main' },
        schema: {
          Name: { id: 'title-id', type: 'title' }
        }
      })
    })
  })

  describe('queryDatabase', () => {
    it('validates database_id', async () => {
      await expect(queryDatabase(notion, { action: 'query' } as any)).rejects.toThrowError(/database_id required/)
    })

    it('queries data source and returns formatted items', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-123',
        data_sources: [{ id: 'ds-123' }]
      })
      mockNotion.dataSources.query.mockResolvedValueOnce({
        results: [
          {
            id: 'page-1',
            url: 'https://notion.so/page-1',
            properties: {
              Name: { type: 'title', title: [{ plain_text: 'Task 1' }] }
            }
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const res = await queryDatabase(notion, {
        action: 'query',
        database_id: 'db-123',
        limit: 10
      })

      expect(res.action).toBe('query')
      expect(res.database_id).toBe('db-123')
      expect(res.data_source_id).toBe('ds-123')
      expect(res.total).toBe(1)
      expect(res.results[0].Name).toBe('Task 1')
    })
  })

  describe('createDataSource', () => {
    it('validates required fields and title property', async () => {
      await expect(createDataSource(notion, { action: 'create_data_source' } as any)).rejects.toThrowError(
        /database_id, title, and properties required/
      )

      await expect(
        createDataSource(notion, {
          action: 'create_data_source',
          database_id: 'db-123',
          title: 'Source 2',
          properties: { Desc: { rich_text: {} } }
        } as any)
      ).rejects.toThrowError(/must include a title property/)
    })

    it('creates data source with normalized properties', async () => {
      mockNotion.dataSources.create.mockResolvedValueOnce({
        id: 'ds-new'
      })

      const res = await createDataSource(notion, {
        action: 'create_data_source',
        database_id: 'db-123',
        title: 'Source 2',
        properties: {
          Name: { title: {} },
          Tags: { multi_select: [{ name: 'Bug' }] }
        }
      })

      expect(mockNotion.dataSources.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'database_id', database_id: 'db-123' },
          title: [RichText.text('Source 2')],
          properties: {
            Name: { title: {} },
            Tags: { multi_select: { options: [{ name: 'Bug' }] } }
          }
        })
      )

      expect(res).toEqual({
        action: 'create_data_source',
        data_source_id: 'ds-new',
        database_id: 'db-123',
        created: true
      })
    })
  })

  describe('updateDataSource', () => {
    it('validates data_source_id and presence of updates', async () => {
      await expect(updateDataSource(notion, { action: 'update_data_source' } as any)).rejects.toThrowError(
        /data_source_id required/
      )

      await expect(
        updateDataSource(notion, {
          action: 'update_data_source',
          data_source_id: 'ds-123'
        } as any)
      ).rejects.toThrowError(/No updates provided/)
    })

    it('updates data source fields', async () => {
      mockNotion.dataSources.update.mockResolvedValueOnce({})

      const res = await updateDataSource(notion, {
        action: 'update_data_source',
        data_source_id: 'ds-123',
        title: 'New DS Name',
        properties: {
          Category: { select: [{ name: 'Design' }] }
        }
      })

      expect(mockNotion.dataSources.update).toHaveBeenCalledWith({
        data_source_id: 'ds-123',
        title: [RichText.text('New DS Name')],
        properties: {
          Category: { select: { options: [{ name: 'Design' }] } }
        }
      })
      expect(res).toEqual({
        action: 'update_data_source',
        data_source_id: 'ds-123',
        updated: true
      })
    })
  })

  describe('updateDatabaseContainer', () => {
    it('validates database_id and presence of updates', async () => {
      await expect(updateDatabaseContainer(notion, { action: 'update_database' } as any)).rejects.toThrowError(
        /database_id required/
      )

      await expect(
        updateDatabaseContainer(notion, {
          action: 'update_database',
          database_id: 'db-123'
        } as any)
      ).rejects.toThrowError(/No updates provided/)
    })

    it('rejects clearing database icon', async () => {
      await expect(
        updateDatabaseContainer(notion, {
          action: 'update_database',
          database_id: 'db-123',
          icon: 'none'
        })
      ).rejects.toThrowError(/Notion does not support clearing a database icon/)
    })

    it('updates database container fields', async () => {
      mockNotion.databases.update.mockResolvedValueOnce({})

      const res = await updateDatabaseContainer(notion, {
        action: 'update_database',
        database_id: 'db-123',
        title: 'Updated Database',
        icon: '📚'
      })

      expect(mockNotion.databases.update).toHaveBeenCalledWith({
        database_id: 'db123',
        title: [RichText.text('Updated Database')],
        icon: { type: 'emoji', emoji: '📚' }
      })
      expect(res).toEqual({
        action: 'update_database',
        database_id: 'db-123',
        updated: true
      })
    })
  })

  describe('listDataSourceTemplates', () => {
    it('validates database_id', async () => {
      await expect(listDataSourceTemplates(notion, { action: 'list_templates' } as any)).rejects.toThrowError(
        /database_id required/
      )
    })

    it('lists templates from resolved data source', async () => {
      mockNotion.databases.retrieve.mockResolvedValueOnce({
        id: 'db-123',
        data_sources: [{ id: 'ds-123' }]
      })
      mockNotion.dataSources.listTemplates.mockResolvedValueOnce({
        results: [
          {
            id: 'tmpl-1',
            name: 'Bug Report Template',
            properties: {}
          }
        ],
        next_cursor: null,
        has_more: false
      })

      const res = await listDataSourceTemplates(notion, {
        action: 'list_templates',
        database_id: 'db-123'
      })

      expect(res).toEqual({
        action: 'list_templates',
        database_id: 'db-123',
        data_source_id: 'ds-123',
        total: 1,
        templates: [
          {
            template_id: 'tmpl-1',
            title: 'Bug Report Template',
            properties: {}
          }
        ]
      })
    })
  })
})
