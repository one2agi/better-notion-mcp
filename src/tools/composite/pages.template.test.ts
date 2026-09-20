import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDataSourceCache, resolutionCache, schemaCache } from '../helpers/data-source.js'
import { NotionMCPError } from '../helpers/errors.js'
import { clearPageTitleCache, pages } from './pages.js'

function createMockNotion() {
  return {
    pages: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      move: vi.fn(),
      retrieveMarkdown: vi.fn(),
      updateMarkdown: vi.fn(),
      properties: { retrieve: vi.fn() }
    },
    databases: {
      retrieve: vi.fn()
    },
    dataSources: {
      retrieve: vi.fn(),
      query: vi.fn(),
      listTemplates: vi.fn()
    },
    blocks: {
      retrieve: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      children: {
        list: vi.fn(),
        append: vi.fn()
      }
    }
  }
}

let mockNotion: ReturnType<typeof createMockNotion>

describe('pages - deep template instantiation', () => {
  beforeEach(() => {
    mockNotion = createMockNotion()
    clearDataSourceCache()
    clearPageTitleCache()
    schemaCache.clear()
    resolutionCache.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Default mock setup: database parent resolves to ds-1
    mockNotion.databases.retrieve.mockResolvedValue({
      id: 'db-1',
      title: [{ plain_text: 'Sprint DB' }],
      data_sources: [{ id: 'ds-1', name: 'Sprint Source' }]
    })

    mockNotion.dataSources.retrieve.mockResolvedValue({
      id: 'ds-1',
      properties: {
        Title: { id: 'title-id', name: 'Title', type: 'title', title: {} }
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
      id: 'page-new-1',
      url: 'https://notion.so/page-new-1'
    })

    mockNotion.blocks.children.append.mockResolvedValue({
      results: [{ id: 'block-appended-1' }]
    })
  })

  it('instantiates page with template: "default"', async () => {
    const res = await pages(mockNotion as any, {
      action: 'create',
      parent_id: 'db-1',
      title: '第 10 周评审',
      template: 'default'
    })

    expect(res).toEqual({
      action: 'create',
      page_id: 'page-new-1',
      url: 'https://notion.so/page-new-1',
      created: true
    })

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'data_source_id', data_source_id: 'ds-1' },
        template: { type: 'default' }
      })
    )
    expect(mockNotion.dataSources.listTemplates).not.toHaveBeenCalled()
  })

  it('instantiates page with template: { type: "default" }', async () => {
    await pages(mockNotion as any, {
      action: 'create',
      parent_id: 'db-1',
      title: '第 10 周评审',
      template: { type: 'default' }
    })

    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: { type: 'default' }
      })
    )
  })

  it('instantiates page with UUID template string', async () => {
    const templateUuid = 'f834f4cf-c8e2-82ce-9e7a-01fa08c5951f'
    await pages(mockNotion as any, {
      action: 'create',
      parent_id: 'db-1',
      title: '第 10 周评审',
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
    expect(mockNotion.dataSources.listTemplates).not.toHaveBeenCalled()
  })

  it('instantiates page with template_id parameter', async () => {
    const templateUuid = 'f834f4cf-c8e2-82ce-9e7a-01fa08c5951f'
    await pages(mockNotion as any, {
      action: 'create',
      parent_id: 'db-1',
      title: '第 10 周评审',
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

  it('resolves template by human-readable name case-insensitively with whitespace trimming', async () => {
    await pages(mockNotion as any, {
      action: 'create',
      parent_id: 'db-1',
      title: '第 10 周评审',
      template: '  sprint 评审模板  '
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

  it('throws friendly error listing available templates when template name is not found', async () => {
    await expect(
      pages(mockNotion as any, {
        action: 'create',
        parent_id: 'db-1',
        title: '第 10 周评审',
        template: '季度总结模板'
      })
    ).rejects.toThrow(NotionMCPError)

    try {
      await pages(mockNotion as any, {
        action: 'create',
        parent_id: 'db-1',
        title: '第 10 周评审',
        template: '季度总结模板'
      })
    } catch (err: any) {
      expect(err.message).toContain('季度总结模板')
      expect(err.message).toContain('Sprint 评审模板')
      expect(err.message).toContain('Bug 缺陷报告')
    }
  })

  it('supports one-call closure: instantiates template AND appends content', async () => {
    const res = await pages(mockNotion as any, {
      action: 'create',
      parent_id: 'db-1',
      title: 'Sprint 10 评审报告',
      template: 'Sprint 评审模板',
      content: '# 本周进展\n- 任务A完成\n- 任务B提测'
    })

    expect(res).toEqual({
      action: 'create',
      page_id: 'page-new-1',
      url: 'https://notion.so/page-new-1',
      created: true
    })

    // 1. Template passed to pages.create
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          type: 'template_id',
          template_id: 't-sprint-uuid-1111'
        }
      })
    )

    // 2. Dynamic content appended via blocks.children.append
    expect(mockNotion.blocks.children.append).toHaveBeenCalledWith(
      expect.objectContaining({
        block_id: 'page-new-1',
        children: expect.any(Array)
      })
    )
  })

  it('throws validation error when template is specified but parent is a plain page', async () => {
    mockNotion.databases.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })
    mockNotion.dataSources.retrieve.mockRejectedValueOnce({ code: 'object_not_found' })

    await expect(
      pages(mockNotion as any, {
        action: 'create',
        parent_id: 'plain-page-1',
        title: '测试页面',
        template: 'default'
      })
    ).rejects.toThrow('Templates can only be applied when creating pages in a database/data source')
  })
})
