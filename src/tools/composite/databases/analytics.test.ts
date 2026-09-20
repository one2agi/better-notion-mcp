import { describe, expect, it, vi } from 'vitest'
import { aggregateDatabase, computeAggregation, fetchAllDataSourcePages, groupByDatabase } from './analytics.js'

describe('analytics', () => {
  describe('computeAggregation', () => {
    const mockPages = [
      {
        id: 'p1',
        properties: {
          Amount: { type: 'number', number: 10 },
          Category: { type: 'select', select: { name: 'Work' } }
        }
      },
      {
        id: 'p2',
        properties: {
          Amount: { type: 'number', number: 20 },
          Category: { type: 'select', select: { name: 'Work' } }
        }
      },
      {
        id: 'p3',
        properties: {
          Amount: { type: 'number', number: 30 },
          Category: { type: 'select', select: { name: 'Personal' } }
        }
      },
      {
        id: 'p4',
        properties: {
          Amount: { type: 'number', number: null },
          Category: { type: 'select', select: null }
        }
      }
    ]

    it('should compute count accurately regardless of property', () => {
      expect(computeAggregation(mockPages, { type: 'count' })).toBe(4)
      expect(computeAggregation([], { type: 'count' })).toBe(0)
    })

    it('should return null when property is required but missing', () => {
      expect(computeAggregation(mockPages, { type: 'sum' })).toBeNull()
      expect(computeAggregation(mockPages, { type: 'avg' })).toBeNull()
      expect(computeAggregation(mockPages, { type: 'min' })).toBeNull()
      expect(computeAggregation(mockPages, { type: 'max' })).toBeNull()
      expect(computeAggregation(mockPages, { type: 'unique_count' })).toBeNull()
    })

    it('should compute sum, avg, min, and max for numeric properties', () => {
      expect(computeAggregation(mockPages, { type: 'sum', property: 'Amount' })).toBe(60)
      expect(computeAggregation(mockPages, { type: 'avg', property: 'Amount' })).toBe(20)
      expect(computeAggregation(mockPages, { type: 'min', property: 'Amount' })).toBe(10)
      expect(computeAggregation(mockPages, { type: 'max', property: 'Amount' })).toBe(30)
    })

    it('should return null for numeric aggregations when no numeric values exist', () => {
      const emptyPages = [mockPages[3]] // Amount is null
      expect(computeAggregation(emptyPages, { type: 'sum', property: 'Amount' })).toBeNull()
      expect(computeAggregation(emptyPages, { type: 'avg', property: 'Amount' })).toBeNull()
      expect(computeAggregation(emptyPages, { type: 'min', property: 'Amount' })).toBeNull()
      expect(computeAggregation(emptyPages, { type: 'max', property: 'Amount' })).toBeNull()
    })

    it('should compute unique_count correctly and ignore null/undefined', () => {
      expect(computeAggregation(mockPages, { type: 'unique_count', property: 'Category' })).toBe(2)
    })
  })

  describe('fetchAllDataSourcePages', () => {
    it('should query dataSource and handle smart search filter', async () => {
      const mockNotion: any = {
        dataSources: {
          retrieve: vi.fn().mockResolvedValue({
            properties: {
              Title: { type: 'title' }
            }
          }),
          query: vi.fn().mockResolvedValue({
            results: [{ id: 'p1', properties: {} }],
            has_more: false,
            next_cursor: null
          })
        }
      }

      const pages = await fetchAllDataSourcePages(mockNotion, 'db-1', 'ds-1', null, 'findme')
      expect(mockNotion.dataSources.query).toHaveBeenCalledWith({
        data_source_id: 'ds-1',
        filter: {
          or: [{ property: 'Title', rich_text: { contains: 'findme' } }]
        },
        start_cursor: undefined,
        page_size: 100
      })
      expect(pages).toHaveLength(1)
    })
  })

  describe('aggregateDatabase and groupByDatabase validation', () => {
    it('aggregateDatabase should throw when database_id is missing', async () => {
      const mockNotion: any = {}
      await expect(aggregateDatabase(mockNotion, { action: 'aggregate' })).rejects.toThrow('database_id required')
    })

    it('groupByDatabase should throw when group_by is missing', async () => {
      const mockNotion: any = {}
      await expect(groupByDatabase(mockNotion, { action: 'group_by', database_id: 'db-1' })).rejects.toThrow(
        'group_by required'
      )
    })
  })
})
