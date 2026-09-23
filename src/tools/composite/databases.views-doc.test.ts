import { describe, expect, it } from 'vitest'
import { readDocContent } from '../helpers/docs-reader.js'

describe('databases doc views alignment', () => {
  it('should document views actions and view types in databases.md', async () => {
    const doc = await readDocContent('databases.md', { displayName: 'databases' })
    expect(doc).toContain('create_view')
    expect(doc).toContain('list_views')
    expect(doc).toContain('get_view')
    expect(doc).toContain('update_view')
    expect(doc).toContain('delete_view')
    expect(doc).toContain('chart_type')
  })
})
