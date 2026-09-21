/**
 * Tool Registry - 8 composite Notion tools + 2 infra tools (config, help)
 * Consolidated registration for maximum coverage with minimal tools
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import type { Client } from '@notionhq/client'
import { getState } from '../credential-state.js'
// Import composite tools
import { blocks } from './composite/blocks.js'
import { commentsManage } from './composite/comments.js'
import { config } from './composite/config.js'
import { contentConvert } from './composite/content.js'
import { databases } from './composite/databases.js'
import { fileUploads } from './composite/file-uploads.js'
import { pages } from './composite/pages.js'
import { users } from './composite/users.js'
import { workspace } from './composite/workspace.js'
import { readDocContent } from './helpers/docs-reader.js'
import { aiReadableMessage, findClosestMatch, NotionMCPError } from './helpers/errors.js'
import { wrapToolResult } from './helpers/security.js'
import {
  ALL_TOOL_NAMES,
  ALL_TOOL_NAMES_STRING,
  AVAILABLE_RESOURCE_URIS,
  PRECOMPUTED_RESOURCES,
  RESOURCE_MAP,
  TOKEN_FREE_TOOLS,
  TOOLS,
  VALID_HELP_TOOL_NAMES,
  VALID_HELP_TOOLS_STRING
} from './tool-definitions.js'

/**
 * Register all tools with MCP server
 * @param notionClientFactory - Returns a Notion Client.
 *   Called per tool invocation to support both singleton (stdio) and per-request (HTTP) patterns.
 */
export function registerTools(server: Server, notionClientFactory: () => Client) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }))

  // Resources handlers for full documentation
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: PRECOMPUTED_RESOURCES
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params
    const resource = RESOURCE_MAP.get(uri)

    if (!resource) {
      throw new NotionMCPError(
        `Resource not found: ${uri}`,
        'RESOURCE_NOT_FOUND',
        `Available: ${AVAILABLE_RESOURCE_URIS}`
      )
    }

    const content = await readDocContent(resource.file, {
      displayName: resource.name,
      suggestion: 'Check resource URI',
      securitySuggestion: 'Invalid resource URI'
    })

    return {
      contents: [{ uri, mimeType: 'text/markdown', text: content }]
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    if (!args) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No arguments provided'
          }
        ],
        isError: true
      }
    }

    // Credential guard. In stdio mode the server exits at startup if
    // NOTION_TOKEN is missing (see main.ts startServer('stdio')); reaching
    // this branch means HTTP mode where the per-subject token store is
    // empty for the current caller. help and content_convert work without
    // a token.
    if (!TOKEN_FREE_TOOLS.has(name)) {
      const credState = getState()
      if (credState !== 'configured') {
        const publicUrl = process.env.PUBLIC_URL
        const setupInstructions = publicUrl
          ? `Notion access token is not present for this session. Open ${publicUrl}/authorize in your browser to complete the Notion OAuth flow, then retry the tool.`
          : 'Notion access token is not present. In stdio mode set NOTION_TOKEN env var (https://www.notion.so/my-integrations). In HTTP mode complete the OAuth flow at <PUBLIC_URL>/authorize.'
        return {
          content: [{ type: 'text', text: setupInstructions }],
          isError: true
        }
      }
    }

    try {
      let result
      const notion = notionClientFactory()

      switch (name) {
        case 'pages':
          result = await pages(notion, args as any)
          break
        case 'databases':
          result = await databases(notion, args as any)
          break
        case 'blocks':
          result = await blocks(notion, args as any)
          break
        case 'users':
          result = await users(notion, args as any)
          break
        case 'workspace':
          result = await workspace(notion, args as any)
          break
        case 'comments':
          result = await commentsManage(notion, args as any)
          break
        case 'content_convert':
          result = await contentConvert(args as any)
          break
        case 'config':
          result = await config(args as any)
          break
        case 'file_uploads':
          result = await fileUploads(notion, args as any)
          break
        case 'help': {
          const toolName = (args as { tool_name: string }).tool_name
          // Security: validate tool_name against allowlist to prevent path traversal
          if (!VALID_HELP_TOOL_NAMES.has(toolName)) {
            throw new NotionMCPError(
              `Invalid tool name: ${toolName}`,
              'VALIDATION_ERROR',
              `Valid tools: ${VALID_HELP_TOOLS_STRING}`
            )
          }

          const content = await readDocContent(`${toolName}.md`, {
            displayName: toolName,
            suggestion: 'Check tool_name',
            securitySuggestion: 'Invalid tool_name'
          })
          result = { tool: toolName, documentation: content }
          break
        }
        default: {
          const closest = findClosestMatch(name, ALL_TOOL_NAMES)
          const suggestion = closest ? ` Did you mean '${closest}'?` : ''
          throw new NotionMCPError(
            `Unknown tool: ${name}.${suggestion}`,
            'UNKNOWN_TOOL',
            `Available tools: ${ALL_TOOL_NAMES_STRING}`
          )
        }
      }

      const jsonText = JSON.stringify(result, null, 2)
      return {
        content: [
          {
            type: 'text',
            text: wrapToolResult(name, jsonText)
          }
        ]
      }
    } catch (error) {
      const enhancedError =
        error instanceof NotionMCPError
          ? error
          : new NotionMCPError((error as Error).message, 'TOOL_ERROR', 'Check the error details and try again')

      return {
        content: [
          {
            type: 'text',
            text: aiReadableMessage(enhancedError)
          }
        ],
        isError: true
      }
    }
  })
}
