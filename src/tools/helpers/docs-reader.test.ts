import { describe, expect, it } from 'vitest'
import { DOCS_DIR, readDocContent } from './docs-reader.js'
import { NotionMCPError } from './errors.js'

describe('docs-reader', () => {
  describe('DOCS_DIR', () => {
    it('should export a valid DOCS_DIR path string', () => {
      expect(typeof DOCS_DIR).toBe('string')
      expect(DOCS_DIR.length).toBeGreaterThan(0)
    })
  })

  describe('readDocContent', () => {
    it('should read an existing markdown documentation file', async () => {
      const content = await readDocContent('pages.md')
      expect(content).toBeDefined()
      expect(typeof content).toBe('string')
      expect(content.length).toBeGreaterThan(0)
    })

    it('should throw NotionMCPError with DOC_NOT_FOUND when file does not exist', async () => {
      await expect(readDocContent('nonexistent-doc-file.md')).rejects.toThrow(NotionMCPError)
      await expect(readDocContent('nonexistent-doc-file.md')).rejects.toMatchObject({
        code: 'DOC_NOT_FOUND',
        message: expect.stringContaining('nonexistent-doc-file.md'),
        suggestion: expect.any(String)
      })
    })

    it('should support custom displayName and suggestion for DOC_NOT_FOUND', async () => {
      await expect(
        readDocContent('missing.md', {
          displayName: 'Custom Tool Docs',
          suggestion: 'Check tool name'
        })
      ).rejects.toMatchObject({
        code: 'DOC_NOT_FOUND',
        message: 'Documentation not found for: Custom Tool Docs',
        suggestion: 'Check tool name'
      })
    })

    it('should throw SECURITY_ERROR on parent directory traversal', async () => {
      await expect(readDocContent('../outside.md')).rejects.toThrow(NotionMCPError)
      await expect(readDocContent('../outside.md')).rejects.toMatchObject({
        code: 'SECURITY_ERROR',
        message: 'Path traversal attempt detected'
      })
    })

    it('should throw SECURITY_ERROR on deep path traversal', async () => {
      await expect(readDocContent('../../etc/passwd')).rejects.toMatchObject({
        code: 'SECURITY_ERROR',
        message: 'Path traversal attempt detected'
      })
    })

    it('should throw SECURITY_ERROR on absolute path', async () => {
      await expect(readDocContent('/etc/passwd')).rejects.toMatchObject({
        code: 'SECURITY_ERROR',
        message: 'Path traversal attempt detected'
      })
    })

    it('should respect custom securitySuggestion on SECURITY_ERROR', async () => {
      await expect(
        readDocContent('../outside.md', {
          securitySuggestion: 'Invalid tool_name'
        })
      ).rejects.toMatchObject({
        code: 'SECURITY_ERROR',
        message: 'Path traversal attempt detected',
        suggestion: 'Invalid tool_name'
      })
    })
  })
})
