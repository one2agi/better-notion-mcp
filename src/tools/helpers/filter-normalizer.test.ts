import { describe, expect, it } from 'vitest'
import { isFlatFilter, normalizeFilter } from './filter-normalizer.js'

describe('filter-normalizer', () => {
  const mockProperties: Record<string, any> = {
    Name: { id: 'title', type: 'title' },
    Status: { id: 'status', type: 'status' },
    Department: { id: 'select', type: 'select' },
    Tags: { id: 'multi_select', type: 'multi_select' },
    IsActive: { id: 'checkbox', type: 'checkbox' },
    PriorityScore: { id: 'number', type: 'number' },
    DueDate: { id: 'date', type: 'date' },
    RelatedProject: { id: 'relation', type: 'relation' },
    Description: { id: 'rich_text', type: 'rich_text' },
    Assignee: { id: 'people', type: 'people' },
    ContactEmail: { id: 'email', type: 'email' },
    Phone: { id: 'phone_number', type: 'phone_number' },
    Website: { id: 'url', type: 'url' }
  }

  describe('isFlatFilter', () => {
    it('returns false for null, undefined, or non-object', () => {
      expect(isFlatFilter(null)).toBe(false)
      expect(isFlatFilter(undefined)).toBe(false)
      expect(isFlatFilter('string')).toBe(false)
      expect(isFlatFilter(123)).toBe(false)
    })

    it('returns false for native Notion compound filters', () => {
      expect(isFlatFilter({ and: [] })).toBe(false)
      expect(isFlatFilter({ or: [] })).toBe(false)
    })

    it('returns false for native Notion single-property filters', () => {
      expect(isFlatFilter({ property: 'Status', status: { equals: 'Done' } })).toBe(false)
      expect(isFlatFilter({ timestamp: 'created_time', created_time: { past_week: {} } })).toBe(false)
    })

    it('returns true for flat key-value filter objects', () => {
      expect(isFlatFilter({ Status: 'Done' })).toBe(true)
      expect(isFlatFilter({ Department: 'R&D', IsActive: true })).toBe(true)
    })
  })

  describe('normalizeFilter', () => {
    it('returns original filter if already native Notion filter', () => {
      const nativeFilter = { and: [{ property: 'Status', status: { equals: 'Done' } }] }
      expect(normalizeFilter(mockProperties, nativeFilter)).toEqual(nativeFilter)
    })

    it('returns original filter if null or empty', () => {
      expect(normalizeFilter(mockProperties, null)).toBe(null)
      expect(normalizeFilter(mockProperties, {})).toEqual({})
    })

    it('maps select and status flat values to equals', () => {
      const flat = { Status: 'Done', Department: 'R&D' }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        and: [
          { property: 'Status', status: { equals: 'Done' } },
          { property: 'Department', select: { equals: 'R&D' } }
        ]
      })
    })

    it('maps checkbox boolean values to equals', () => {
      const flat = { IsActive: true }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        property: 'IsActive',
        checkbox: { equals: true }
      })
    })

    it('maps number values to equals', () => {
      const flat = { PriorityScore: 10 }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        property: 'PriorityScore',
        number: { equals: 10 }
      })
    })

    it('maps multi_select and relation values to contains', () => {
      const flat = { Tags: 'Urgent', RelatedProject: 'proj-123' }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        and: [
          { property: 'Tags', multi_select: { contains: 'Urgent' } },
          { property: 'RelatedProject', relation: { contains: 'proj-123' } }
        ]
      })
    })

    it('maps text/title/rich_text values to equals', () => {
      const flat = { Name: 'My Task' }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        property: 'Name',
        title: { equals: 'My Task' }
      })
    })

    it('supports case-insensitive property name matching against schema', () => {
      const flat = { status: 'In Progress' }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        property: 'Status',
        status: { equals: 'In Progress' }
      })
    })

    it('maps people values to contains', () => {
      const flat = { Assignee: 'user-uuid' }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        property: 'Assignee',
        people: { contains: 'user-uuid' }
      })
    })

    it('maps email, phone_number, and url values to equals', () => {
      const flat = {
        ContactEmail: 'test@example.com',
        Phone: '+1234567890',
        Website: 'https://example.com'
      }
      const normalized = normalizeFilter(mockProperties, flat)
      expect(normalized).toEqual({
        and: [
          { property: 'ContactEmail', email: { equals: 'test@example.com' } },
          { property: 'Phone', phone_number: { equals: '+1234567890' } },
          { property: 'Website', url: { equals: 'https://example.com' } }
        ]
      })
    })
  })
})
