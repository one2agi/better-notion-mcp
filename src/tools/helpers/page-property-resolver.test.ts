import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type GetPagePropertyResult, getPageProperty } from './page-property-resolver.js'

function createMockNotion() {
  return {
    pages: {
      retrieve: vi.fn(),
      properties: {
        retrieve: vi.fn()
      }
    }
  }
}

let mockNotion: ReturnType<typeof createMockNotion>

describe('page-property-resolver helper', () => {
  beforeEach(() => {
    mockNotion = createMockNotion()
  })

  it('returns paginated title joining text', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      results: [
        { type: 'title', title: { plain_text: 'Part 1 ' } },
        { type: 'title', title: { plain_text: 'Part 2' } }
      ],
      next_cursor: null,
      has_more: false
    })

    const result: GetPagePropertyResult = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: 'title'
    })

    expect(result).toEqual({
      action: 'get_property',
      page_id: 'p1',
      property_id: 'title',
      type: 'title',
      value: 'Part 1 Part 2'
    })
  })

  it('returns paginated rich_text joining text', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      results: [
        { type: 'rich_text', rich_text: { plain_text: 'Hello ' } },
        { type: 'rich_text', rich_text: { plain_text: 'World' } }
      ],
      next_cursor: null,
      has_more: false
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '%60rich'
    })

    expect(result.value).toBe('Hello World')
    expect(result.type).toBe('rich_text')
  })

  it('returns relation IDs', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      results: [
        { type: 'relation', relation: { id: 'rel-1' } },
        { type: 'relation', relation: { id: 'rel-2' } }
      ],
      next_cursor: null,
      has_more: false
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '%60rel'
    })

    expect(result.value).toEqual(['rel-1', 'rel-2'])
  })

  it('returns people with id and name', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      results: [
        { type: 'people', people: { id: 'user-1', name: 'Alice' } },
        { type: 'people', people: { id: 'user-2', name: 'Bob' } }
      ],
      next_cursor: null,
      has_more: false
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '%60people'
    })

    expect(result.value).toEqual([
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' }
    ])
  })

  it('returns rollup value from first result', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      results: [{ type: 'rollup', rollup: { type: 'number', number: 42 } }],
      next_cursor: null,
      has_more: false
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '%60rollup'
    })

    expect(result.value).toEqual({ type: 'number', number: 42 })
  })

  it('returns non-paginated property as raw value', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      type: 'select',
      select: { id: 'sel-1', name: 'Active', color: 'green' }
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '%60select'
    })

    expect(result.value).toEqual({ id: 'sel-1', name: 'Active', color: 'green' })
    expect(result.type).toBe('select')
  })

  it('resolves Chinese property name to property_id via page.properties', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      properties: {
        源链接: { id: 'prop_url_id', type: 'url' }
      }
    })
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      type: 'url',
      url: 'https://example.com'
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '源链接'
    })

    expect(result.property_id).toBe('prop_url_id')
    expect(result.value).toBe('https://example.com')
  })

  it('resolves English property name case-insensitively', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      properties: {
        Status: { id: 'prop_status_id', type: 'status' }
      }
    })
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      type: 'status',
      status: { name: 'In Progress' }
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: 'status'
    })

    expect(result.property_id).toBe('prop_status_id')
    expect(result.value).toEqual({ name: 'In Progress' })
  })

  it('supports property_name alias as input', async () => {
    mockNotion.pages.retrieve.mockResolvedValueOnce({
      id: 'p1',
      properties: {
        Tags: { id: 'prop_tags_id', type: 'multi_select' }
      }
    })
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      type: 'multi_select',
      multi_select: [{ name: 'tag1' }]
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_name: 'Tags'
    })

    expect(result.property_id).toBe('prop_tags_id')
    expect(result.value).toEqual([{ name: 'tag1' }])
  })

  it('returns typed empty array for relation when results is empty', async () => {
    mockNotion.pages.properties.retrieve.mockResolvedValueOnce({
      type: 'property_item',
      property_item: { type: 'relation', id: '%60empty_rel' },
      results: [],
      next_cursor: null,
      has_more: false
    })

    const result = await getPageProperty(mockNotion as any, {
      page_id: 'p1',
      property_id: '%60empty_rel'
    })

    expect(result.type).toBe('relation')
    expect(result.value).toEqual([])
  })

  it('throws when page_id is missing', async () => {
    await expect(getPageProperty(mockNotion as any, { property_id: 'title' })).rejects.toThrow(
      'page_id is required for get_property action'
    )
  })

  it('throws when property_id and property_name are missing', async () => {
    await expect(getPageProperty(mockNotion as any, { page_id: 'p1' })).rejects.toThrow(
      'property_id is required for get_property action'
    )
  })
})
