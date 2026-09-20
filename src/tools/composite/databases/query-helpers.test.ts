import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDataSourceCache } from '../../helpers/data-source.js'
import {
  buildSearchFilter,
  formatDatabaseResults,
  getSmartSearchFilter,
  resolveDatabaseFilter
} from './query-helpers.js'

describe('query-helpers', () => {
  beforeEach(() => {
    clearDataSourceCache()
  })

  it('buildSearchFilter should construct or-clauses across title and rich_text properties', () => {
    const properties = {
      Name: { type: 'title' },
      Description: { type: 'rich_text' },
      Status: { type: 'select' }
    }
    const filter = buildSearchFilter(properties, 'urgent')
    expect(filter).toEqual({
      or: [
        { property: 'Name', rich_text: { contains: 'urgent' } },
        { property: 'Description', rich_text: { contains: 'urgent' } }
      ]
    })
  })

  it('buildSearchFilter should return null if no text properties match or properties empty', () => {
    expect(buildSearchFilter(null, 'test')).toBeNull()
    expect(buildSearchFilter({ Status: { type: 'select' } }, 'test')).toBeNull()
  })

  it('formatDatabaseResults should extract page properties and attach page_id and url', () => {
    const rawPages = [
      {
        id: 'page-1',
        url: 'https://notion.so/page-1',
        properties: {
          Name: { id: 'title', type: 'title', title: [{ plain_text: 'Task 1' }] }
        }
      }
    ]
    const formatted = formatDatabaseResults(rawPages)
    expect(formatted).toHaveLength(1)
    expect(formatted[0].page_id).toBe('page-1')
    expect(formatted[0].url).toBe('https://notion.so/page-1')
    expect(formatted[0].Name).toBe('Task 1')
  })

  it('resolveDatabaseFilter should normalize flat filters using data source schema', async () => {
    const mockNotion: any = {
      dataSources: {
        retrieve: vi.fn().mockResolvedValue({
          properties: {
            Status: { id: 'status-id', type: 'status' }
          }
        })
      }
    }
    const filter = await resolveDatabaseFilter(mockNotion, 'ds-123', { Status: 'Done' })
    expect(filter).toEqual({
      property: 'Status',
      status: { equals: 'Done' }
    })
  })

  it('getSmartSearchFilter should retrieve data source schema and build search filter', async () => {
    const mockNotion: any = {
      dataSources: {
        retrieve: vi.fn().mockResolvedValue({
          properties: {
            Title: { type: 'title' }
          }
        })
      }
    }
    const filter = await getSmartSearchFilter(mockNotion, 'ds-456', 'keyword')
    expect(filter).toEqual({
      or: [{ property: 'Title', rich_text: { contains: 'keyword' } }]
    })
  })
})
