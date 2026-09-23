import { describe, expect, it } from 'vitest'
import { readDocContent } from '../helpers/docs-reader.js'

describe('content_convert doc alignment', () => {
  it('should document <callout> HTML syntax and clean styling in content_convert.md', async () => {
    const doc = await readDocContent('content_convert.md', { displayName: 'content_convert' })
    expect(doc).toContain('<callout')
    expect(doc).toContain('color="default"')
  })
})
