import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolutionCache, schemaCache } from '../helpers/data-source.js'
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
    query: vi.fn()
  },
  views: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn()
  }
}

const notion = mockNotion as any

describe('databases - views API', () => {
  beforeEach(() => {
    schemaCache.clear()
    resolutionCache.clear()
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
        阶段: {
          id: 'status-id',
          name: '阶段',
          type: 'status',
          status: {
            options: [
              { id: 's1', name: '未开始' },
              { id: 's2', name: '进行中' },
              { id: 's3', name: '已完成' }
            ]
          }
        },
        截止日期: {
          id: 'date-id',
          name: '截止日期',
          type: 'date',
          date: {}
        },
        优先级: {
          id: 'select-id',
          name: '优先级',
          type: 'select',
          select: {
            options: [
              { id: 'o1', name: 'High' },
              { id: 'o2', name: 'Low' }
            ]
          }
        },
        预计工时: {
          id: 'number-id',
          name: '预计工时',
          type: 'number',
          number: { format: 'number' }
        }
      }
    })
  })

  describe('create_view', () => {
    it('should create board view with resolved natural language group_by and auto-injected sort manual', async () => {
      mockNotion.views.create.mockResolvedValueOnce({
        id: 'view-board-1',
        name: '看板视图',
        type: 'board',
        url: 'https://notion.so/view-board-1',
        data_source_id: 'ds-1',
        configuration: {
          type: 'board',
          group_by: {
            type: 'status',
            property_id: 'status-id',
            group_by: 'option',
            sort: { type: 'manual' }
          }
        }
      })

      const response: any = await databases(notion, {
        action: 'create_view',
        database_id: 'db-1',
        name: '看板视图',
        type: 'board',
        group_by: '阶段'
      })

      expect(response).toEqual({
        action: 'create_view',
        view_id: 'view-board-1',
        name: '看板视图',
        type: 'board',
        url: 'https://notion.so/view-board-1',
        database_id: 'db-1',
        data_source_id: 'ds-1',
        created: true,
        view: expect.any(Object)
      })

      expect(mockNotion.views.create).toHaveBeenCalledWith({
        database_id: 'db-1',
        data_source_id: 'ds-1',
        name: '看板视图',
        type: 'board',
        configuration: {
          type: 'board',
          group_by: {
            type: 'status',
            property_id: 'status-id',
            group_by: 'option',
            sort: { type: 'manual' }
          }
        }
      })
    })

    it('should create calendar view and auto-detect first date property when omitted', async () => {
      mockNotion.views.create.mockResolvedValueOnce({
        id: 'view-cal-1',
        name: '日历视图',
        type: 'calendar',
        url: 'https://notion.so/view-cal-1',
        data_source_id: 'ds-1'
      })

      const response: any = await databases(notion, {
        action: 'create_view',
        database_id: 'db-1',
        name: '日历视图',
        type: 'calendar'
      })

      expect(response.created).toBe(true)
      expect(response.view_id).toBe('view-cal-1')
      expect(mockNotion.views.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'calendar',
          configuration: {
            type: 'calendar',
            date_property_id: 'date-id'
          }
        })
      )
    })

    it('should normalize filters, sorts, placement and position', async () => {
      mockNotion.views.create.mockResolvedValueOnce({
        id: 'view-filtered-1',
        name: '进行中任务',
        type: 'table',
        url: 'https://notion.so/view-filtered-1'
      })

      await databases(notion, {
        action: 'create_view',
        database_id: 'db-1',
        name: '进行中任务',
        type: 'table',
        filters: { 阶段: '进行中' },
        sorts: [{ property: '截止日期', direction: 'ascending' }],
        position: { type: 'end' }
      })

      expect(mockNotion.views.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '进行中任务',
          type: 'table',
          filter: {
            property: '阶段',
            status: { equals: '进行中' }
          },
          sorts: [{ property: '截止日期', direction: 'ascending' }],
          position: { type: 'end' }
        })
      )
    })

    it('should create form view with alias normalization', async () => {
      mockNotion.views.create.mockResolvedValueOnce({
        id: 'form-view-id',
        type: 'form',
        name: '意见收集表单',
        url: 'https://notion.so/form-view-id',
        configuration: {
          type: 'form',
          is_form_closed: true,
          anonymous_submissions: true,
          submission_permissions: 'editor'
        }
      })

      const result: any = await databases(notion, {
        action: 'create_view',
        database_id: 'db-1',
        name: '意见收集表单',
        type: 'form',
        closed: true,
        anonymous: true,
        submission_permissions: 'edit'
      } as any)

      expect(mockNotion.views.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '意见收集表单',
          type: 'form',
          configuration: {
            type: 'form',
            is_form_closed: true,
            anonymous_submissions: true,
            submission_permissions: 'editor'
          }
        })
      )
      expect(result.view_id).toBe('form-view-id')
    })

    it('should create column chart view with x_axis, stack_by, target, and quick_filters', async () => {
      mockNotion.views.create.mockResolvedValueOnce({
        id: 'chart-view-id',
        type: 'chart',
        name: '任务状态分布',
        url: 'https://notion.so/chart-view-id'
      })

      await databases(notion, {
        action: 'create_view',
        database_id: 'db-1',
        name: '任务状态分布',
        type: 'chart',
        chart_type: 'column',
        group_style: 'stacked',
        x_axis: '阶段',
        stack_by: '优先级',
        y_axis: '预计工时',
        target: 100,
        hide_empty_groups: true,
        quick_filters: [{ property_id: 'status-id' }]
      } as any)

      expect(mockNotion.views.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chart',
          configuration: expect.objectContaining({
            type: 'chart',
            chart_type: 'column',
            group_style: 'normal',
            x_axis: expect.objectContaining({
              property_id: 'status-id',
              sort: { type: 'manual' },
              hide_empty_groups: true
            }),
            stack_by: expect.objectContaining({
              property_id: 'select-id',
              sort: { type: 'manual' }
            }),
            y_axis: {
              property_id: 'number-id',
              aggregator: 'sum'
            },
            reference_lines: [{ value: 100, label: '目标', color: 'gray', dash_style: 'dash' }]
          }),
          quick_filters: [{ property_id: 'status-id' }]
        })
      )
    })

    it('should create number KPI card view with value mapping', async () => {
      mockNotion.views.create.mockResolvedValueOnce({
        id: 'number-view-id',
        type: 'chart',
        name: '工时总计',
        url: 'https://notion.so/number-view-id'
      })

      await databases(notion, {
        action: 'create_view',
        database_id: 'db-1',
        name: '工时总计',
        type: 'chart',
        chart_type: 'number',
        y_axis: '预计工时'
      } as any)

      expect(mockNotion.views.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chart',
          configuration: expect.objectContaining({
            type: 'chart',
            chart_type: 'number',
            value: {
              property_id: 'number-id',
              aggregator: 'sum'
            }
          })
        })
      )
    })

    it('should throw validation error if required fields are missing', async () => {
      await expect(
        databases(notion, {
          action: 'create_view',
          name: 'No DB'
        } as any)
      ).rejects.toThrow(NotionMCPError)

      await expect(
        databases(notion, {
          action: 'create_view',
          database_id: 'db-1'
        } as any)
      ).rejects.toThrow(NotionMCPError)
    })
  })

  describe('list_views', () => {
    it('should list views with pagination and return concise key info (id, name, type, url)', async () => {
      mockNotion.views.list
        .mockResolvedValueOnce({
          results: [
            { id: 'v1', name: 'Table 1', type: 'table', url: 'https://notion.so/v1' },
            { id: 'v2', name: 'Board 1', type: 'board', url: 'https://notion.so/v2' }
          ],
          next_cursor: 'cursor-2',
          has_more: true
        })
        .mockResolvedValueOnce({
          results: [{ id: 'v3', name: 'Cal 1', type: 'calendar', url: 'https://notion.so/v3' }],
          next_cursor: null,
          has_more: false
        })

      const response: any = await databases(notion, {
        action: 'list_views',
        database_id: 'db-1'
      })

      expect(response).toEqual({
        action: 'list_views',
        database_id: 'db-1',
        data_source_id: 'ds-1',
        total: 3,
        views: [
          { id: 'v1', name: 'Table 1', type: 'table', url: 'https://notion.so/v1' },
          { id: 'v2', name: 'Board 1', type: 'board', url: 'https://notion.so/v2' },
          { id: 'v3', name: 'Cal 1', type: 'calendar', url: 'https://notion.so/v3' }
        ]
      })
      expect(mockNotion.views.list).toHaveBeenCalledTimes(2)
    })

    it('should respect limit parameter in list_views', async () => {
      mockNotion.views.list.mockResolvedValueOnce({
        results: [
          { id: 'v1', name: 'Table 1', type: 'table', url: 'https://notion.so/v1' },
          { id: 'v2', name: 'Board 1', type: 'board', url: 'https://notion.so/v2' }
        ],
        next_cursor: null,
        has_more: false
      })

      const response: any = await databases(notion, {
        action: 'list_views',
        database_id: 'db-1',
        limit: 1
      })

      expect(response.total).toBe(1)
      expect(response.views).toHaveLength(1)
      expect(response.views[0].id).toBe('v1')
    })

    it('should throw validation error if database_id is missing', async () => {
      await expect(
        databases(notion, {
          action: 'list_views'
        } as any)
      ).rejects.toThrow(NotionMCPError)
    })
  })

  describe('get_view', () => {
    it('should retrieve view details by view_id', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'v1',
        name: 'All Tasks',
        type: 'table',
        url: 'https://notion.so/v1',
        data_source_id: 'ds-1',
        configuration: { type: 'table' },
        filter: null,
        sorts: []
      })

      const response: any = await databases(notion, {
        action: 'get_view',
        view_id: 'v1'
      })

      expect(response).toEqual({
        action: 'get_view',
        view_id: 'v1',
        name: 'All Tasks',
        type: 'table',
        url: 'https://notion.so/v1',
        data_source_id: 'ds-1',
        configuration: { type: 'table' },
        filter: null,
        sorts: [],
        view: expect.any(Object)
      })
      expect(mockNotion.views.retrieve).toHaveBeenCalledWith({ view_id: 'v1' })
    })

    it('should throw validation error if view_id is missing', async () => {
      await expect(
        databases(notion, {
          action: 'get_view'
        } as any)
      ).rejects.toThrow(NotionMCPError)
    })
  })

  describe('update_view', () => {
    it('should update view with name and configuration', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'v1',
        name: 'Old Name',
        type: 'board',
        data_source_id: 'ds-1'
      })

      mockNotion.views.update.mockResolvedValueOnce({
        id: 'v1',
        name: 'New Name',
        type: 'board'
      })

      const response: any = await databases(notion, {
        action: 'update_view',
        view_id: 'v1',
        name: 'New Name',
        group_by: '阶段'
      })

      expect(response).toEqual({
        action: 'update_view',
        view_id: 'v1',
        updated: true,
        view: expect.any(Object)
      })

      expect(mockNotion.views.update).toHaveBeenCalledWith(
        expect.objectContaining({
          view_id: 'v1',
          name: 'New Name',
          configuration: {
            type: 'board',
            group_by: {
              type: 'status',
              property_id: 'status-id',
              group_by: 'option',
              sort: { type: 'manual' }
            }
          }
        })
      )
    })

    it('should update form view with is_form_closed and submission_permissions', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view_form',
        name: '表单视图',
        type: 'form',
        data_source_id: 'ds-1'
      })

      mockNotion.views.update.mockResolvedValueOnce({
        id: 'view_form',
        name: '表单视图',
        type: 'form'
      })

      await databases(notion, {
        action: 'update_view',
        view_id: 'view_form',
        closed: true,
        submission_permissions: 'none'
      } as any)

      expect(mockNotion.views.update).toHaveBeenCalledWith(
        expect.objectContaining({
          view_id: 'view_form',
          configuration: {
            type: 'form',
            is_form_closed: true,
            submission_permissions: 'none'
          }
        })
      )
    })

    it('should update chart view configuration and pass quick_filters', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view_chart',
        name: '图表视图',
        type: 'chart',
        data_source_id: 'ds-1'
      })

      mockNotion.views.update.mockResolvedValueOnce({
        id: 'view_chart',
        name: '图表视图',
        type: 'chart'
      })

      await databases(notion, {
        action: 'update_view',
        view_id: 'view_chart',
        chart_type: 'bar',
        x_axis: '阶段',
        quick_filters: [{ property_id: 'status-id' }]
      } as any)

      expect(mockNotion.views.update).toHaveBeenCalledWith(
        expect.objectContaining({
          view_id: 'view_chart',
          configuration: expect.objectContaining({
            type: 'chart',
            chart_type: 'bar',
            x_axis: expect.objectContaining({
              property_id: 'status-id',
              sort: { type: 'manual' }
            })
          }),
          quick_filters: [{ property_id: 'status-id' }]
        })
      )
    })

    it('should incrementally update view configuration without wiping out existing configuration', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view_existing_line_chart',
        name: '趋势图',
        type: 'chart',
        data_source_id: 'ds-1',
        configuration: {
          type: 'chart',
          chart_type: 'line',
          x_axis: { property_id: 'date-id', sort: { type: 'manual' } },
          y_axis: { property_id: 'number-id', aggregator: 'sum' },
          smooth_line: true
        }
      })

      mockNotion.views.update.mockResolvedValueOnce({
        id: 'view_existing_line_chart',
        name: '趋势图',
        type: 'chart'
      })

      await databases(notion, {
        action: 'update_view',
        view_id: 'view_existing_line_chart',
        show_data_labels: true
      } as any)

      expect(mockNotion.views.update).toHaveBeenCalledWith(
        expect.objectContaining({
          view_id: 'view_existing_line_chart',
          configuration: expect.objectContaining({
            type: 'chart',
            chart_type: 'line',
            x_axis: expect.objectContaining({ property_id: 'date-id', sort: { type: 'manual' } }),
            y_axis: { property_id: 'number-id', aggregator: 'sum' },
            smooth_line: true,
            show_data_labels: true
          })
        })
      )
    })

    it('should preserve existing number KPI card value structure during incremental update', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view_existing_number_card',
        name: '指标卡',
        type: 'chart',
        data_source_id: 'ds-1',
        configuration: {
          type: 'chart',
          chart_type: 'number',
          value: { property_id: 'number-id', aggregator: 'sum' },
          caption: '旧说明'
        }
      })

      mockNotion.views.update.mockResolvedValueOnce({
        id: 'view_existing_number_card',
        name: '指标卡',
        type: 'chart'
      })

      await databases(notion, {
        action: 'update_view',
        view_id: 'view_existing_number_card',
        caption: '新说明'
      } as any)

      expect(mockNotion.views.update).toHaveBeenCalledWith(
        expect.objectContaining({
          view_id: 'view_existing_number_card',
          configuration: expect.objectContaining({
            type: 'chart',
            chart_type: 'number',
            value: { property_id: 'number-id', aggregator: 'sum' },
            caption: '新说明'
          })
        })
      )
    })

    it('should map chart_sort to sort and clean dead properties in view update', async () => {
      mockNotion.views.retrieve.mockResolvedValueOnce({
        id: 'view_sort_test',
        name: '排序测试',
        type: 'chart',
        data_source_id: 'ds-1',
        configuration: {
          type: 'chart',
          chart_type: 'column',
          x_axis: { property_id: 'status-id', sort: { type: 'manual' } }
        }
      })

      mockNotion.views.update.mockResolvedValueOnce({
        id: 'view_sort_test',
        name: '排序测试',
        type: 'chart'
      })

      await databases(notion, {
        action: 'update_view',
        view_id: 'view_sort_test',
        chart_sort: 'x_ascending'
      } as any)

      expect(mockNotion.views.update).toHaveBeenCalledWith(
        expect.objectContaining({
          view_id: 'view_sort_test',
          configuration: expect.objectContaining({
            type: 'chart',
            sort: { type: 'x_ascending' }
          })
        })
      )
      const updateCall = mockNotion.views.update.mock.calls[mockNotion.views.update.mock.calls.length - 1][0]
      expect(updateCall.configuration.chart_sort).toBeUndefined()
    })

    it('should throw validation error if view_id is missing in update_view', async () => {
      await expect(
        databases(notion, {
          action: 'update_view',
          name: 'New Name'
        } as any)
      ).rejects.toThrow(NotionMCPError)
    })
  })

  describe('delete_view', () => {
    it('should delete view by view_id', async () => {
      mockNotion.views.delete.mockResolvedValueOnce({
        id: 'v1',
        object: 'view'
      })

      const response: any = await databases(notion, {
        action: 'delete_view',
        view_id: 'v1'
      })

      expect(response).toEqual({
        action: 'delete_view',
        view_id: 'v1',
        deleted: true
      })
      expect(mockNotion.views.delete).toHaveBeenCalledWith({ view_id: 'v1' })
    })

    it('should throw validation error if view_id is missing in delete_view', async () => {
      await expect(
        databases(notion, {
          action: 'delete_view'
        } as any)
      ).rejects.toThrow(NotionMCPError)
    })
  })
})
