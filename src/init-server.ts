/**
 * Better Notion MCP Server
 * Using composite tools for human-friendly AI agent interactions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools/registry.js'

export async function initServer() {
  // Get Notion token from environment
  const notionToken = process.env.NOTION_TOKEN

  if (!notionToken) {
    console.error('NOTION_TOKEN environment variable is required')
    console.error('Get your token from https://www.notion.so/my-integrations')
    process.exit(1)
  }

  // Create MCP server
  const server = new Server(
    {
      name: '@n24q02m/better-notion-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  )

  // Register composite tools
  registerTools(server, notionToken)

  // Connect stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return server
}
