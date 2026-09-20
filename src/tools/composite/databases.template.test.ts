import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDataSourceCache, resolutionCache, schemaCache } from '../helpers/data-source.js'
import { NotionMCPError } from '../helpers/errors.js'
import { databases } from './databases.js'

const mockNotion = {
  databases: {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  dataSources: {
    retrieve: vi.fn(),
    query: vi.fn(),
    listTemplates: vi.fn()
  },
  pages: {
    create: vi.fn()
  }
}

const notion = mockNotion as any

describe('databases - template support in create_page', () => {
  beforeEach(() => {
    schemaCache.clear()
    resolutionCache.clear()
    clearDataSourceCache()
    vi.resetAllMocks()

    mockNotion.databases.retrieve.mockResolvedValue({
      id: 'db-1',
      title: [{ plain_text: 'Test DB' }],
      data_sources: [{ id: 'ds-1', name: 'Source 1' }]
    })

    mockNotion.dataSources.retrieve.mockResolvedValue({
      id: 'ds-1',
      properties: {
        Name: { id: 'title-id', name: 'Name', type: 'title', title: {} },
        Status: { id: 'status-id', name: 'Status', type: 'status', status: {} }
      }
    })

    mockNotion.dataSources.listTemplates.mockResolvedValue({
      templates: [
        {
          id: 't-sprint-uuid-1111',
          name: 'Sprint 评审模板',
          is_default: false
        },
        {
          id: 't-bug-uuid-2222',
          name: 'Bug 缺陷报告',
          is_default: true
        }
      ],
      has_more: false,
      next_cursor: null
    })

    mockNotion.pages.create.mockResolvedValue({
      id: 'page-1',
      url: 'https://notion.so/page-1'
    })
  })

  it('supports template: "default" in databases.create_page', async () => {
    const res = await databases(notion, {
      action: 'create_page',
      database_id: 'db-1',
      page_properties: { Name: 'Task with Default Template' },
      template: 'default'
    })

    expect(res).toEqual({
      action: 'create_page',
      database_id: 'db-1',
      data_source_id: 'ds-1',
      processed: 1,
      results: [{ page_id: 'page-1', url: 'https://notion.so/page-1', created: true }]
    })

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'data_source_id', data_source_id: 'ds-1' },
        template: { type: 'default' }
      })
    )
  })

  it('supports template UUID in databases.create_page', async () => {
    const templateUuid = 'f834f4cf-c8e2-82ce-9e7a-01fa08c5951f'
    await databases(notion, {
      action: 'create_page',
      database_id: 'db-1',
      page_properties: { Name: 'Task with UUID Template' },
      template: templateUuid
    })

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          type: 'template_id',
          template_id: templateUuid
        }
      })
    )
  })

  it('supports template_id in databases.create_page', async () => {
    const templateUuid = 'f834f4cf-c8e2-82ce-9e7a-01fa08c5951f'
    await databases(notion, {
      action: 'create_page',
      database_id: 'db-1',
      page_properties: { Name: 'Task with template_id' },
      template_id: templateUuid
    })

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          type: 'template_id',
          template_id: templateUuid
        }
      })
    )
  })

  it('resolves template by name in databases.create_page', async () => {
    await databases(notion, {
      action: 'create_page',
      database_id: 'db-1',
      page_properties: { Name: 'Sprint Kickoff' },
      template: 'Sprint 评审模板'
    })

    expect(mockNotion.dataSources.listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        data_source_id: 'ds-1'
      })
    )

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          type: 'template_id',
          template_id: 't-sprint-uuid-1111'
        }
      })
    )
  })

  it('supports per-page template in batch pages array', async () => {
    mockNotion.pages.create
      .mockResolvedValueOnce({ id: 'page-1', url: 'https://notion.so/page-1' })
      .mockResolvedValueOnce({ id: 'page-2', url: 'https://notion.so/page-2' })

    const res: any = await databases(notion, {
      action: 'create_page',
      database_id: 'db-1',
      pages: [
        {
          properties: { Name: 'Bug 1' },
          template: 'Bug 缺陷报告'
        },
        {
          properties: { Name: 'Review 1' },
          template: 'default'
        }
      ]
    })

    expect(res.processed).toBe(2)
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          type: 'template_id',
          template_id: 't-bug-uuid-2222'
        }
      })
    )
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          type: 'default'
        }
      })
    )
  })

  it('throws friendly error when template name is not found in databases.create_page', async () => {
    await expect(
      databases(notion, {
        action: 'create_page',
        database_id: 'db-1',
        page_properties: { Name: 'Task' },
        template: '未知模板'
      })
    ).rejects.toThrow(NotionMCPError)

    try {
      await databases(notion, {
        action: 'create_page',
        database_id: 'db-1',
        page_properties: { Name: 'Task' },
        template: '未知模板'
      })
    } catch (err: any) {
      expect(err.message).toContain('未知模板')
      expect(err.message).toContain('Sprint 评审模板')
      expect(err.message).toContain('Bug 缺陷报告')
    }
  })
})
