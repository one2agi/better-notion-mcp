import { describe, expect, it } from 'vitest'
import { NotionMCPError } from './errors.js'
import {
  buildGroupByConfig,
  buildViewConfiguration,
  findPropertyByType,
  resolvePropertyFromSchema
} from './view-config.js'

describe('view-config helper', () => {
  const mockSchema = {
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
    截止日期: {
      id: 'date-id',
      name: '截止日期',
      type: 'date',
      date: {}
    },
    结束时间: {
      id: 'end-date-id',
      name: '结束时间',
      type: 'date',
      date: {}
    },
    负责人: {
      id: 'people-id',
      name: '负责人',
      type: 'people',
      people: {}
    },
    关联任务: {
      id: 'relation-id',
      name: '关联任务',
      type: 'relation',
      relation: { database_id: 'other-db' }
    },
    预计工时: {
      id: 'number-id',
      name: '预计工时',
      type: 'number',
      number: { format: 'number' }
    },
    是否紧急: {
      id: 'checkbox-id',
      name: '是否紧急',
      type: 'checkbox',
      checkbox: {}
    }
  }

  describe('resolvePropertyFromSchema & findPropertyByType', () => {
    it('should resolve property by exact Chinese name', () => {
      const prop = resolvePropertyFromSchema(mockSchema, '阶段')
      expect(prop).toBeDefined()
      expect(prop?.id).toBe('status-id')
      expect(prop?.type).toBe('status')
    })

    it('should resolve property case-insensitively', () => {
      const prop = resolvePropertyFromSchema(mockSchema, 'name')
      expect(prop?.id).toBe('title-id')
    })

    it('should resolve property by property_id directly', () => {
      const prop = resolvePropertyFromSchema(mockSchema, 'status-id')
      expect(prop?.name).toBe('阶段')
      expect(prop?.type).toBe('status')
    })

    it('should return null when property is not in schema', () => {
      const prop = resolvePropertyFromSchema(mockSchema, 'non-existent')
      expect(prop).toBeNull()
    })

    it('should find first property by type', () => {
      const dateProp = findPropertyByType(mockSchema, 'date')
      expect(dateProp).toBeDefined()
      expect(dateProp?.id).toBe('date-id')
      expect(dateProp?.name).toBe('截止日期')
    })

    it('should return null when finding non-existent type', () => {
      const urlProp = findPropertyByType(mockSchema, 'url')
      expect(urlProp).toBeNull()
    })
  })

  describe('buildGroupByConfig', () => {
    it('should resolve string property name to status group_by config with sort manual', () => {
      const config = buildGroupByConfig('阶段', mockSchema)
      expect(config).toEqual({
        type: 'status',
        property_id: 'status-id',
        group_by: 'option',
        sort: { type: 'manual' }
      })
    })

    it('should resolve select property with sort manual', () => {
      const config = buildGroupByConfig('优先级', mockSchema)
      expect(config).toEqual({
        type: 'select',
        property_id: 'select-id',
        sort: { type: 'manual' }
      })
    })

    it('should resolve date property with default group_by day and sort manual', () => {
      const config = buildGroupByConfig('截止日期', mockSchema)
      expect(config).toEqual({
        type: 'date',
        property_id: 'date-id',
        group_by: 'day',
        sort: { type: 'manual' }
      })
    })

    it('should resolve person property with sort manual', () => {
      const config = buildGroupByConfig('负责人', mockSchema)
      expect(config).toEqual({
        type: 'person',
        property_id: 'people-id',
        sort: { type: 'manual' }
      })
    })

    it('should resolve number, checkbox, and relation properties with sort manual', () => {
      expect(buildGroupByConfig('预计工时', mockSchema)).toEqual({
        type: 'number',
        property_id: 'number-id',
        sort: { type: 'manual' }
      })
      expect(buildGroupByConfig('是否紧急', mockSchema)).toEqual({
        type: 'checkbox',
        property_id: 'checkbox-id',
        sort: { type: 'manual' }
      })
      expect(buildGroupByConfig('关联任务', mockSchema)).toEqual({
        type: 'relation',
        property_id: 'relation-id',
        sort: { type: 'manual' }
      })
    })

    it('Reverse Test Defense: should inject sort manual when user provides group_by object without sort', () => {
      // Notion API throws 400 validation error if sort is missing in group_by
      const input = {
        type: 'status',
        property_id: 'status-id'
      }
      const config = buildGroupByConfig(input, mockSchema)
      expect(config.sort).toEqual({ type: 'manual' })
      expect(config.property_id).toBe('status-id')
      expect(config.type).toBe('status')
    })

    it('should normalize string sort to { type: sort } and preserve custom sort', () => {
      const inputWithStringSort = {
        property: '阶段',
        sort: 'ascending'
      }
      const config1 = buildGroupByConfig(inputWithStringSort, mockSchema)
      expect(config1.sort).toEqual({ type: 'ascending' })

      const inputWithObjectSort = {
        property: '阶段',
        sort: { type: 'descending' }
      }
      const config2 = buildGroupByConfig(inputWithObjectSort, mockSchema)
      expect(config2.sort).toEqual({ type: 'descending' })
    })

    it('should fallback to direct property_id if schema is missing or property not in schema', () => {
      const config = buildGroupByConfig('unknown-id')
      expect(config).toEqual({
        type: 'status',
        property_id: 'unknown-id',
        group_by: 'option',
        sort: { type: 'manual' }
      })
    })
  })

  describe('buildViewConfiguration', () => {
    describe('board view', () => {
      it('should build board configuration with group_by resolved from Chinese property name', () => {
        const config = buildViewConfiguration('board', { group_by: '阶段' }, mockSchema)
        expect(config).toEqual({
          type: 'board',
          group_by: {
            type: 'status',
            property_id: 'status-id',
            group_by: 'option',
            sort: { type: 'manual' }
          }
        })
      })

      it('should auto-find status or select property if group_by is omitted in board view', () => {
        const config = buildViewConfiguration('board', {}, mockSchema)
        expect(config.type).toBe('board')
        expect(config.group_by).toBeDefined()
        expect(config.group_by.property_id).toBe('status-id')
        expect(config.group_by.sort).toEqual({ type: 'manual' })
      })

      it('should throw validation error if board view has no group_by and schema lacks status/select column', () => {
        const noStatusSchema = {
          Name: { id: 'title-id', type: 'title' }
        }
        expect(() => buildViewConfiguration('board', {}, noStatusSchema)).toThrow(NotionMCPError)
      })

      it('should preserve board options like card_layout and cover_size', () => {
        const config = buildViewConfiguration(
          'board',
          {
            group_by: '阶段',
            card_layout: 'compact',
            cover_size: 'medium'
          },
          mockSchema
        )
        expect(config.card_layout).toBe('compact')
        expect(config.cover_size).toBe('medium')
      })
    })

    describe('calendar view', () => {
      it('should resolve date_property name to date_property_id', () => {
        const config = buildViewConfiguration('calendar', { date_property: '截止日期' }, mockSchema)
        expect(config).toEqual({
          type: 'calendar',
          date_property_id: 'date-id'
        })
      })

      it('should auto-find first date property if date_property is omitted', () => {
        const config = buildViewConfiguration('calendar', {}, mockSchema)
        expect(config).toEqual({
          type: 'calendar',
          date_property_id: 'date-id'
        })
      })

      it('should throw validation error if calendar view cannot find any date property', () => {
        const noDateSchema = {
          Name: { id: 'title-id', type: 'title' }
        }
        expect(() => buildViewConfiguration('calendar', {}, noDateSchema)).toThrow(NotionMCPError)
      })

      it('should preserve calendar options view_range and show_weekends', () => {
        const config = buildViewConfiguration(
          'calendar',
          {
            date_property: '截止日期',
            view_range: 'week',
            show_weekends: false
          },
          mockSchema
        )
        expect(config.view_range).toBe('week')
        expect(config.show_weekends).toBe(false)
      })
    })

    describe('timeline view', () => {
      it('should resolve date_property and end_date_property', () => {
        const config = buildViewConfiguration(
          'timeline',
          {
            date_property: '截止日期',
            end_date_property: '结束时间',
            show_table: true
          },
          mockSchema
        )
        expect(config).toEqual({
          type: 'timeline',
          date_property_id: 'date-id',
          end_date_property_id: 'end-date-id',
          show_table: true
        })
      })

      it('should auto-find date property for timeline if date_property is omitted', () => {
        const config = buildViewConfiguration('timeline', {}, mockSchema)
        expect(config.type).toBe('timeline')
        expect(config.date_property_id).toBe('date-id')
      })
    })

    describe('table view', () => {
      it('should build table view configuration with optional group_by and wrap_cells', () => {
        const config = buildViewConfiguration(
          'table',
          {
            group_by: '阶段',
            wrap_cells: true,
            show_vertical_lines: true
          },
          mockSchema
        )
        expect(config).toEqual({
          type: 'table',
          group_by: {
            type: 'status',
            property_id: 'status-id',
            group_by: 'option',
            sort: { type: 'manual' }
          },
          wrap_cells: true,
          show_vertical_lines: true
        })
      })

      it('should build simple table view when no extra options passed', () => {
        const config = buildViewConfiguration('table')
        expect(config).toEqual({ type: 'table' })
      })
    })

    describe('gallery view', () => {
      it('should build gallery view and format cover option', () => {
        const config = buildViewConfiguration(
          'gallery',
          {
            cover: 'page_cover',
            cover_size: 'large'
          },
          mockSchema
        )
        expect(config).toEqual({
          type: 'gallery',
          cover: { type: 'page_cover' },
          cover_size: 'large'
        })
      })
    })

    describe('list view', () => {
      it('should build simple list view', () => {
        const config = buildViewConfiguration('list')
        expect(config).toEqual({ type: 'list' })
      })
    })

    describe('form view', () => {
      it('should build standard form configuration', () => {
        const config = buildViewConfiguration('form', {
          is_form_closed: false,
          anonymous_submissions: true,
          submission_permissions: 'reader'
        })
        expect(config).toEqual({
          type: 'form',
          is_form_closed: false,
          anonymous_submissions: true,
          submission_permissions: 'reader'
        })
      })

      it('should adapt aliases closed and anonymous to official fields', () => {
        const config = buildViewConfiguration('form', {
          closed: true,
          anonymous: true,
          submission_permissions: 'editor'
        })
        expect(config).toEqual({
          type: 'form',
          is_form_closed: true,
          anonymous_submissions: true,
          submission_permissions: 'editor'
        })
      })

      it('should map permission synonyms to valid Notion API values', () => {
        expect(buildViewConfiguration('form', { submission_permissions: 'readonly' }).submission_permissions).toBe(
          'reader'
        )
        expect(buildViewConfiguration('form', { submission_permissions: 'read' }).submission_permissions).toBe('reader')
        expect(buildViewConfiguration('form', { submission_permissions: 'edit' }).submission_permissions).toBe('editor')
        expect(buildViewConfiguration('form', { submission_permissions: 'write' }).submission_permissions).toBe(
          'editor'
        )
        expect(buildViewConfiguration('form', { submission_permissions: 'comment' }).submission_permissions).toBe(
          'comment_only'
        )
      })

      it('should throw validation error on invalid permission value', () => {
        expect(() => {
          buildViewConfiguration('form', { submission_permissions: 'admin' })
        }).toThrow(NotionMCPError)
      })

      it('should strip properties field in form view as it is not supported by Notion API', () => {
        const config = buildViewConfiguration('form', {
          is_form_closed: false,
          properties: [{ property_id: 'status-id', visible: true }]
        })
        expect(config.properties).toBeUndefined()
      })
    })

    describe('chart view', () => {
      it('should build column chart with default chart_type and auto-injected group_by sort', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段'
          },
          mockSchema
        )
        expect(config).toEqual({
          type: 'chart',
          chart_type: 'column',
          x_axis: {
            type: 'status',
            property_id: 'status-id',
            group_by: 'option',
            sort: { type: 'manual' }
          }
        })
      })

      it('should merge hide_empty_groups into x_axis', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            hide_empty_groups: true
          },
          mockSchema
        )
        expect(config.x_axis).toEqual({
          type: 'status',
          property_id: 'status-id',
          group_by: 'option',
          sort: { type: 'manual' },
          hide_empty_groups: true
        })
      })

      it('should resolve stack_by and inject sort manual', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            chart_type: 'bar',
            group_style: 'stacked',
            x_axis: '阶段',
            stack_by: '优先级'
          },
          mockSchema
        )
        expect(config.stack_by).toEqual({
          type: 'select',
          property_id: 'select-id',
          sort: { type: 'manual' }
        })
        expect(config.chart_type).toBe('bar')
        expect(config.group_style).toBe('normal')
      })

      it('Reverse Test Defense: group_style normalization (normal, percent, side_by_side)', () => {
        // contract: body.configuration.group_style should be "normal", "percent", "side_by_side", null, or undefined
        expect(
          buildViewConfiguration('chart', { x_axis: '阶段', group_style: 'stacked' }, mockSchema).group_style
        ).toBe('normal')
        expect(buildViewConfiguration('chart', { x_axis: '阶段', group_style: 'normal' }, mockSchema).group_style).toBe(
          'normal'
        )
        expect(
          buildViewConfiguration('chart', { x_axis: '阶段', group_style: 'clustered' }, mockSchema).group_style
        ).toBe('side_by_side')
        expect(
          buildViewConfiguration('chart', { x_axis: '阶段', group_style: 'side_by_side' }, mockSchema).group_style
        ).toBe('side_by_side')
        expect(
          buildViewConfiguration('chart', { x_axis: '阶段', group_style: 'percent' }, mockSchema).group_style
        ).toBe('percent')
        expect(() =>
          buildViewConfiguration('chart', { x_axis: '阶段', group_style: 'invalid_style' }, mockSchema)
        ).toThrow(NotionMCPError)
      })

      it('Reverse Test Defense: should never include property_id when aggregator is count', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            y_axis: {
              property: '阶段',
              aggregator: 'count'
            }
          },
          mockSchema
        )
        expect(config.y_axis).toEqual({
          aggregator: 'count'
        })
        expect((config.y_axis as any).property_id).toBeUndefined()
      })

      it('should infer sum aggregator for number property string in y_axis', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            y_axis: '预计工时'
          },
          mockSchema
        )
        expect(config.y_axis).toEqual({
          property_id: 'number-id',
          aggregator: 'sum'
        })
      })

      it('should infer percent_checked for checkbox and earliest_date for date', () => {
        const checkboxConfig = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            y_axis: '是否紧急'
          },
          mockSchema
        )
        expect(checkboxConfig.y_axis).toEqual({
          property_id: 'checkbox-id',
          aggregator: 'percent_checked'
        })

        const dateConfig = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            y_axis: '截止日期'
          },
          mockSchema
        )
        expect(dateConfig.y_axis).toEqual({
          property_id: 'date-id',
          aggregator: 'earliest_date'
        })
      })

      it('should support explicit aggregator in y_axis object', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            y_axis: {
              property: '预计工时',
              aggregator: 'average'
            }
          },
          mockSchema
        )
        expect(config.y_axis).toEqual({
          property_id: 'number-id',
          aggregator: 'average'
        })
      })

      it('should handle number KPI card with default count value when value is omitted', () => {
        const config = buildViewConfiguration('chart', {
          chart_type: 'number'
        })
        expect(config).toEqual({
          type: 'chart',
          chart_type: 'number',
          value: {
            aggregator: 'count'
          }
        })
      })

      it('should map y_axis to value for number KPI card', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            chart_type: 'number',
            y_axis: '预计工时'
          },
          mockSchema
        )
        expect(config).toEqual({
          type: 'chart',
          chart_type: 'number',
          value: {
            property_id: 'number-id',
            aggregator: 'sum'
          }
        })
      })

      it('should wrap flat target/target_line into reference_lines', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            chart_type: 'line',
            x_axis: '截止日期',
            y_axis: '预计工时',
            target: 100
          },
          mockSchema
        )
        expect(config.reference_lines).toEqual([{ value: 100, label: '目标', color: 'gray', dash_style: 'dash' }])
        expect(config.target).toBeUndefined()
      })

      it('Reverse Test Defense: reference_lines must enforce color and dash_style schema contract', () => {
        // contract: body.configuration.reference_lines[0].color should be "gray"..."red", dash_style should be "solid"|"dash"
        const config = buildViewConfiguration('chart', { x_axis: '阶段', target: 50 }, mockSchema)
        expect(config.reference_lines).toEqual([{ value: 50, label: '目标', color: 'gray', dash_style: 'dash' }])

        const customConfig = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            reference_lines: [{ value: 80, color: 'blue', dash_style: 'solid', label: '上限' }]
          },
          mockSchema
        )
        expect(customConfig.reference_lines).toEqual([{ value: 80, label: '上限', color: 'blue', dash_style: 'solid' }])
      })

      it('should sanitize incompatible options for donut, line, column, bar, and number charts', () => {
        const donutConfig = buildViewConfiguration(
          'chart',
          {
            chart_type: 'donut',
            x_axis: '阶段',
            stack_by: '优先级',
            group_style: 'stacked',
            smooth_line: true,
            cumulative: true,
            hide_line_fill_area: true
          },
          mockSchema
        )
        expect(donutConfig.group_style).toBeUndefined()
        expect(donutConfig.smooth_line).toBeUndefined()
        expect(donutConfig.cumulative).toBeUndefined()
        expect(donutConfig.hide_line_fill_area).toBeUndefined()
        expect(donutConfig.stack_by).toBeUndefined()

        const lineConfig = buildViewConfiguration(
          'chart',
          {
            chart_type: 'line',
            x_axis: '阶段',
            group_style: 'stacked',
            donut_labels: 'name_and_value',
            smooth_line: true,
            cumulative: true,
            hide_line_fill_area: false
          },
          mockSchema
        )
        expect(lineConfig.group_style).toBeUndefined()
        expect(lineConfig.donut_labels).toBeUndefined()
        expect(lineConfig.smooth_line).toBe(true)
        expect(lineConfig.cumulative).toBe(true)
        expect(lineConfig.hide_line_fill_area).toBe(false)

        const columnConfig = buildViewConfiguration(
          'chart',
          {
            chart_type: 'column',
            x_axis: '阶段',
            group_style: 'stacked',
            stack_by: '优先级',
            smooth_line: true,
            cumulative: true,
            hide_line_fill_area: true,
            donut_labels: 'name'
          },
          mockSchema
        )
        expect(columnConfig.smooth_line).toBeUndefined()
        expect(columnConfig.cumulative).toBeUndefined()
        expect(columnConfig.hide_line_fill_area).toBeUndefined()
        expect(columnConfig.donut_labels).toBeUndefined()
        expect(columnConfig.group_style).toBe('normal')
        expect(columnConfig.stack_by).toBeDefined()

        const barConfig = buildViewConfiguration(
          'chart',
          {
            chart_type: 'bar',
            x_axis: '阶段',
            smooth_line: true,
            cumulative: true,
            hide_line_fill_area: true,
            donut_labels: 'value'
          },
          mockSchema
        )
        expect(barConfig.smooth_line).toBeUndefined()
        expect(barConfig.cumulative).toBeUndefined()
        expect(barConfig.hide_line_fill_area).toBeUndefined()
        expect(barConfig.donut_labels).toBeUndefined()

        const numberConfig = buildViewConfiguration(
          'chart',
          {
            chart_type: 'number',
            x_axis: '阶段',
            group_style: 'stacked'
          },
          mockSchema
        )
        expect(numberConfig.x_axis).toBeUndefined()
        expect(numberConfig.group_style).toBeUndefined()
      })

      it('should provide default label fallback when target or reference_lines is object without label', () => {
        const configWithTargetObj = buildViewConfiguration(
          'chart',
          {
            chart_type: 'line',
            x_axis: '阶段',
            target: { value: 150 }
          },
          mockSchema
        )
        expect(configWithTargetObj.reference_lines).toEqual([
          { value: 150, label: '目标', color: 'gray', dash_style: 'dash' }
        ])

        const configWithRefLineObj = buildViewConfiguration(
          'chart',
          {
            chart_type: 'line',
            x_axis: '阶段',
            reference_lines: [{ value: 200, color: 'red', dash_style: 'solid' }]
          },
          mockSchema
        )
        expect(configWithRefLineObj.reference_lines).toEqual([
          { value: 200, label: '目标', color: 'red', dash_style: 'solid' }
        ])
      })

      it('should preserve existing value structure for number chart without forcing count aggregator', () => {
        const existingValueConfig = buildViewConfiguration(
          'chart',
          {
            chart_type: 'number',
            value: { property_id: 'number-id', aggregator: 'sum' }
          },
          mockSchema
        )
        expect(existingValueConfig.value).toEqual({
          property_id: 'number-id',
          aggregator: 'sum'
        })
      })

      it('Reverse Test Defense: should strip property_id even when object aggregator is uppercase COUNT', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            x_axis: '阶段',
            y_axis: {
              property: '阶段',
              aggregator: 'COUNT'
            }
          },
          mockSchema
        )
        expect(config.y_axis).toEqual({
          aggregator: 'count'
        })
        expect((config.y_axis as any).property_id).toBeUndefined()
      })

      it('should throw friendly validation error when chart_type is invalid', () => {
        expect(() => {
          buildViewConfiguration('chart', { chart_type: 'pie' as any })
        }).toThrow(NotionMCPError)
      })

      it('should accept string number for target and target_line', () => {
        const config = buildViewConfiguration(
          'chart',
          {
            chart_type: 'bar',
            x_axis: '阶段',
            target: '120'
          },
          mockSchema
        )
        expect(config.reference_lines).toEqual([{ value: 120, label: '目标', color: 'gray', dash_style: 'dash' }])
      })

      it('should handle uppercase or mixed-case form permissions', () => {
        const config = buildViewConfiguration('form', {
          submission_permissions: 'ReadOnly'
        })
        expect(config.submission_permissions).toBe('reader')
      })
    })

    describe('visible_properties mapping', () => {
      it('should convert visible_properties array of names to view property configs', () => {
        const config = buildViewConfiguration(
          'table',
          {
            visible_properties: ['Name', '阶段', '截止日期']
          },
          mockSchema
        )
        expect(config.properties).toEqual([
          { property_id: 'title-id', visible: true },
          { property_id: 'status-id', visible: true },
          { property_id: 'date-id', visible: true }
        ])
      })
    })
  })
})
