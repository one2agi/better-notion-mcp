import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotionMCPError } from '../../helpers/errors.js'
import {
  buildViewRawConfig,
  createView,
  deleteView,
  getView,
  hasViewConfigInput,
  listViews,
  updateView
} from './views.js'

describe('views module', () => {
  describe('buildViewRawConfig', () => {
    it('should map flat form parameters and aliases', () => {
      const config1 = buildViewRawConfig({
        action: 'create_view',
        is_form_closed: true,
        anonymous_submissions: false,
        submission_permissions: 'anyone'
      })
      expect(config1.is_form_closed).toBe(true)
      expect(config1.anonymous_submissions).toBe(false)
      expect(config1.submission_permissions).toBe('anyone')

      const config2 = buildViewRawConfig({
        action: 'create_view',
        closed: true,
        anonymous: true,
        permission: 'workspace'
      })
      expect(config2.is_form_closed).toBe(true)
      expect(config2.anonymous_submissions).toBe(true)
      expect(config2.submission_permissions).toBe('workspace')
    })

    it('should assemble chart parameters and normalize sort and axis properties', () => {
      const config = buildViewRawConfig({
        action: 'create_view',
        chart_type: 'bar',
        x_axis: 'Category',
        y_axis_property: 'Amount',
        chart_sort: 'x_descending',
        target_line: 100,
        color_theme: 'colorful'
      })

      expect(config.chart_type).toBe('bar')
      expect(config.x_axis).toBe('Category')
      expect(config.y_axis).toBe('Amount')
      expect(config.sort).toEqual({ type: 'x_descending' })
      expect(config.target).toBe(100)
      expect(config.color_theme).toBe('colorful')
      expect(config.chart_sort).toBeUndefined()
      expect(config.y_axis_property).toBeUndefined()
    })

    it('should merge parsedConfig and visible_properties properly', () => {
      const config = buildViewRawConfig({ action: 'create_view', group_by: 'Status' }, { custom_key: 'custom_val' }, [
        'prop1',
        'prop2'
      ])

      expect(config.group_by).toBe('Status')
      expect(config.custom_key).toBe('custom_val')
      expect(config.visible_properties).toEqual(['prop1', 'prop2'])
    })
  })

  describe('hasViewConfigInput', () => {
    it('should return true if parsedConfig has keys', () => {
      expect(hasViewConfigInput({ action: 'create_view' }, { some: 'key' })).toBe(true)
    })

    it('should return true if visibleProps has items', () => {
      expect(hasViewConfigInput({ action: 'create_view' }, undefined, ['prop1'])).toBe(true)
    })

    it('should return true if any view param is present', () => {
      expect(hasViewConfigInput({ action: 'create_view', is_form_closed: true })).toBe(true)
      expect(hasViewConfigInput({ action: 'create_view', chart_type: 'donut' })).toBe(true)
      expect(hasViewConfigInput({ action: 'create_view', group_by: 'Category' })).toBe(true)
      expect(hasViewConfigInput({ action: 'create_view', date_property: 'Created' })).toBe(true)
    })

    it('should return false when no view configuration parameters are present', () => {
      expect(hasViewConfigInput({ action: 'create_view', name: 'My View', database_id: '123' })).toBe(false)
    })
  })

  describe('views actions validations', () => {
    const mockNotion = {
      views: {
        create: vi.fn(),
        list: vi.fn(),
        retrieve: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      }
    } as any

    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('createView should require database_id or data_source_id', async () => {
      await expect(
        createView(mockNotion, {
          action: 'create_view',
          name: 'Test'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('createView should require name', async () => {
      await expect(
        createView(mockNotion, {
          action: 'create_view',
          database_id: 'db-1'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('createView should require type', async () => {
      await expect(
        createView(mockNotion, {
          action: 'create_view',
          database_id: 'db-1',
          name: 'Test'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('listViews should require database_id or data_source_id', async () => {
      await expect(
        listViews(mockNotion, {
          action: 'list_views'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('getView should require view_id', async () => {
      await expect(
        getView(mockNotion, {
          action: 'get_view'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('updateView should require view_id', async () => {
      await expect(
        updateView(mockNotion, {
          action: 'update_view'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('deleteView should require view_id', async () => {
      await expect(
        deleteView(mockNotion, {
          action: 'delete_view'
        })
      ).rejects.toThrow(NotionMCPError)
    })

    it('deleteView should delete view successfully', async () => {
      mockNotion.views.delete.mockResolvedValue({})
      const res = await deleteView(mockNotion, {
        action: 'delete_view',
        view_id: '3924f4cf-c8e2-80ab-a43f-cbb4ede3631e'
      })
      expect(res).toEqual({
        action: 'delete_view',
        view_id: '3924f4cfc8e280aba43fcbb4ede3631e',
        deleted: true
      })
      expect(mockNotion.views.delete).toHaveBeenCalledWith({
        view_id: '3924f4cfc8e280aba43fcbb4ede3631e'
      })
    })
  })
})
