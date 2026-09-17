import { describe, expect, it } from 'vitest'
import {
  ALL_TOOL_NAMES,
  ALL_TOOL_NAMES_STRING,
  AVAILABLE_RESOURCE_URIS,
  PRECOMPUTED_RESOURCES,
  RESOURCE_MAP,
  RESOURCES,
  TOKEN_FREE_TOOLS,
  TOOLS,
  VALID_HELP_TOOL_NAMES,
  VALID_HELP_TOOLS_STRING
} from './tool-definitions.js'

describe('tool-definitions', () => {
  describe('TOOLS metadata', () => {
    it('should export 10 tools', () => {
      expect(TOOLS).toHaveLength(10)
    })

    it('should include all expected tools with valid schemas', () => {
      const toolNames = TOOLS.map((t) => t.name)
      expect(toolNames).toEqual([
        'pages',
        'databases',
        'blocks',
        'users',
        'workspace',
        'comments',
        'content_convert',
        'file_uploads',
        'help',
        'config'
      ])

      for (const tool of TOOLS) {
        expect(tool.description).toBeTruthy()
        expect(tool.annotations).toBeDefined()
        expect(tool.inputSchema).toBeDefined()
        expect(tool.inputSchema.type).toBe('object')
      }
    })

    it('documents batch page_ids support for archive and restore actions in pages tool description', () => {
      const pagesTool = TOOLS.find((t) => t.name === 'pages')
      expect(pagesTool).toBeDefined()
      expect(pagesTool!.description).toContain('archive (page_id | page_ids)')
      expect(pagesTool!.description).toContain('restore (page_id | page_ids)')
    })
  })

  describe('RESOURCES metadata', () => {
    it('should export 8 documentation resources', () => {
      expect(RESOURCES).toHaveLength(8)
    })

    it('should precompute resources with markdown mimeType', () => {
      expect(PRECOMPUTED_RESOURCES).toHaveLength(8)
      for (const r of PRECOMPUTED_RESOURCES) {
        expect(r.mimeType).toBe('text/markdown')
        expect(r.uri).toMatch(/^notion:\/\/docs\//)
      }
    })

    it('should precompute O(1) resource map and available URIs string', () => {
      expect(RESOURCE_MAP.size).toBe(8)
      expect(RESOURCE_MAP.get('notion://docs/pages')).toBeDefined()
      expect(AVAILABLE_RESOURCE_URIS).toContain('notion://docs/pages')
    })
  })

  describe('Derived tool sets and strings', () => {
    it('should identify token-free tools correctly', () => {
      expect(TOKEN_FREE_TOOLS.has('help')).toBe(true)
      expect(TOKEN_FREE_TOOLS.has('content_convert')).toBe(true)
      expect(TOKEN_FREE_TOOLS.has('config')).toBe(true)
      expect(TOKEN_FREE_TOOLS.has('pages')).toBe(false)
    })

    it('should precompute valid help tools (excluding help itself)', () => {
      expect(VALID_HELP_TOOL_NAMES.size).toBe(9)
      expect(VALID_HELP_TOOL_NAMES.has('pages')).toBe(true)
      expect(VALID_HELP_TOOL_NAMES.has('help')).toBe(false)
      expect(VALID_HELP_TOOLS_STRING).toContain('pages')
      expect(VALID_HELP_TOOLS_STRING).not.toContain('help')
    })

    it('should precompute all tool names and string', () => {
      expect(ALL_TOOL_NAMES).toHaveLength(10)
      expect(ALL_TOOL_NAMES_STRING).toContain('pages')
      expect(ALL_TOOL_NAMES_STRING).toContain('config')
    })
  })
})
