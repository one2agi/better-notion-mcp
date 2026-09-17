/**
 * Tool & Resource Definitions Metadata Dictionary
 * Consolidated MCP schemas, tool contracts, and documentation resource mappings
 */

// Tools that work without a Notion token
export const TOKEN_FREE_TOOLS = new Set(['help', 'content_convert', 'config'])

/**
 * Documentation resources for full tool details
 */
export const RESOURCES = [
  { uri: 'notion://docs/pages', name: 'Pages Tool Docs', file: 'pages.md' },
  { uri: 'notion://docs/databases', name: 'Databases Tool Docs', file: 'databases.md' },
  { uri: 'notion://docs/blocks', name: 'Blocks Tool Docs', file: 'blocks.md' },
  { uri: 'notion://docs/users', name: 'Users Tool Docs', file: 'users.md' },
  { uri: 'notion://docs/workspace', name: 'Workspace Tool Docs', file: 'workspace.md' },
  { uri: 'notion://docs/comments', name: 'Comments Tool Docs', file: 'comments.md' },
  { uri: 'notion://docs/content_convert', name: 'Content Convert Tool Docs', file: 'content_convert.md' },
  { uri: 'notion://docs/file_uploads', name: 'File Uploads Tool Docs', file: 'file_uploads.md' }
]

// Pre-compute resources for ListResourcesRequestSchema
// BOLT OPTIMIZATION: Avoids O(N) allocation on every list resources request
export const PRECOMPUTED_RESOURCES = RESOURCES.map((r) => ({
  uri: r.uri,
  name: r.name,
  mimeType: 'text/markdown'
}))

// Pre-compute map for ReadResourceRequestSchema
// BOLT OPTIMIZATION: O(1) lookup instead of O(N) find
export const RESOURCE_MAP = new Map(RESOURCES.map((r) => [r.uri, r]))
export const AVAILABLE_RESOURCE_URIS = RESOURCES.map((r) => r.uri).join(', ')

/**
 * 10 registered tools (8 composite Notion tools + config + help)
 * covering ~95% of the official Notion API.
 * Compressed descriptions for token optimization (~77% reduction)
 *
 * Decision tree for LLMs:
 * - `pages` = page CRUD (create/read/update/archive standalone pages or database rows)
 * - `databases` = DB schema, query rows, bulk row CRUD
 * - `blocks` = content *within* a page (paragraphs, headings, lists, tables)
 * - `workspace` = search across workspace, get workspace info
 */
export const TOOLS = [
  {
    name: 'pages',
    description:
      'Page CRUD for individual pages and database rows.\n\nActions (required params -> optional):\n- create (parent_id -> title, content, properties, icon, cover)\n- get (page_id): returns markdown content\n- get_property (page_id, property_id)\n- update (page_id -> title, content, append_content, properties, icon, cover, archived)\n- move (page_id, parent_id)\n- archive (page_id) / restore (page_id)\n- duplicate (page_id -> parent_id)\n- get_markdown (page_id): server-side markdown render (faster than `get`, requires Notion API 2025-09-03 + SDK v5.22+)\n- replace_content (page_id, new_str): overwrite whole page with markdown (destructive)\n- insert_markdown (page_id, content, position="start"|"end", after_block_id?): insert at position or after block\n- update_content (page_id, updates[{old_str,new_str,replace_all_matches?}]): server-side search & replace\n- replace_content_range (page_id, content, content_range): replace a specific markdown range\n\nUse `databases` instead for querying or bulk row operations. Property format: simple values auto-convert -- string for title/rich_text/select/status, number for number, boolean for checkbox, string[] for multi_select, ISO date "2025-01-15" for date. Example: properties: {"Name": "My Page", "Status": "In Progress", "Tags": ["tag1", "tag2"], "Due": "2025-06-01", "Count": 42, "Done": true}.',
    annotations: {
      title: 'Pages',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'get',
            'get_property',
            'update',
            'move',
            'archive',
            'restore',
            'duplicate',
            'get_markdown',
            'replace_content',
            'insert_markdown',
            'update_content',
            'replace_content_range'
          ]
        },
        page_id: { type: 'string', description: 'Page ID (required for most actions)' },
        page_ids: { type: 'array', items: { type: 'string' }, description: 'Multiple page IDs for batch operations' },
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Markdown content' },
        append_content: { type: 'string', description: 'Markdown to append' },
        parent_id: { type: 'string', description: 'Parent page or database ID' },
        properties: {
          type: 'object',
          description:
            'Page properties (for database pages). Use simple values -- auto-converted to Notion format. String: title/rich_text/select/status. Number: number. Boolean: checkbox. String[]: multi_select. ISO date string: date. Object with Notion structure: pass through as-is.'
        },
        property_id: { type: 'string', description: 'Property ID (for get_property action)' },
        property_name: {
          type: 'string',
          description: 'Property name (alternative to property_id for get_property action)'
        },
        resolve_titles: {
          type: 'boolean',
          description: 'Resolve relation page IDs to {id, title} objects (for get_property action)'
        },
        resolve_relations: {
          type: 'boolean',
          description: 'Resolve relation property page IDs to {id, title} objects (for get action)'
        },
        icon: {
          type: 'string',
          description:
            'Icon: emoji (e.g. "(icon)"), external URL (https://...), or built-in shorthand (name:color, e.g. "document:gray")'
        },
        cover: {
          type: 'string',
          description:
            'Cover image: URL or built-in shorthand (gradient_1..11, solid_red/yellow/blue/beige, nasa_*, met_*, rijksmuseum_*, woodcuts_*)'
        },
        archived: { type: 'boolean', description: 'Archive status' },
        replace: {
          type: 'boolean',
          description:
            'For update action with content: if true, delete existing blocks before appending new content (default false, which appends)'
        },
        // Markdown-native actions parameters
        markdown: {
          type: 'string',
          description: 'Markdown content (alias for content / new_str)'
        },
        new_str: {
          type: 'string',
          description: 'Markdown body for replace_content / insert_markdown / replace_content_range'
        },
        content_range: {
          type: 'string',
          description: 'Existing content to replace for replace_content_range (old_str)'
        },
        position: {
          type: 'string',
          enum: ['start', 'end'],
          description: 'Position for insert_markdown: "start" | "end" (default: "end")'
        },
        after_block_id: {
          type: 'string',
          description: 'Block ID to insert after (insert_markdown only)'
        },
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_str: { type: 'string' },
              new_str: { type: 'string' },
              replace_all_matches: { type: 'boolean' }
            },
            required: ['old_str', 'new_str']
          },
          description: 'Search-and-replace updates for update_content: [{old_str, new_str, replace_all_matches?}]'
        },
        allow_deleting_content: {
          type: 'boolean',
          description:
            'Allow replace_content/update_content to delete unmatched content (default: true for replace_content, false for update_content)'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'databases',
    description:
      'Database schema, query, and bulk row operations.\n\nActions (required params -> optional):\n- create (parent_id -> title, properties, is_inline, icon, cover)\n- get (database_id)\n- query (database_id -> filters, sorts, limit, search)\n- aggregate (database_id, aggregations[{type,property,alias}]): count/sum/avg/min/max/unique_count\n- group_by (database_id, group_by{property}, aggregations): group rows by a property, compute per-group stats\n- create_page (database_id, pages[{properties}])\n- update_page (database_id, page_id, page_properties)\n- delete_page (database_id, page_ids)\n- create_data_source / update_data_source / update_database / list_templates\n\nUse `pages` instead for single page CRUD. Accepts both database_id (from URL) and data_source_id (from workspace search) -- auto-resolved.',
    annotations: {
      title: 'Databases',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'get',
            'query',
            'aggregate',
            'group_by',
            'create_page',
            'update_page',
            'delete_page',
            'create_data_source',
            'update_data_source',
            'update_database',
            'list_templates'
          ]
        },
        database_id: {
          type: 'string',
          description:
            'Database ID (from Notion URL) or data_source_id (from workspace search). Auto-resolved for query/aggregate/group_by/create_page/list_templates.'
        },
        data_source_id: { type: 'string', description: 'Data source ID (for update_data_source action)' },
        parent_id: { type: 'string', description: 'Parent page ID (for create/update_database)' },
        title: { type: 'string', description: 'Title (for database or data source)' },
        description: { type: 'string', description: 'Description' },
        properties: { type: 'object', description: 'Schema properties (for create/update data source)' },
        is_inline: { type: 'boolean', description: 'Display as inline (for create/update_database)' },
        icon: {
          type: 'string',
          description:
            'Icon (for update_database): emoji (e.g. "(icon)"), external URL (https://...), or built-in shorthand (name:color, e.g. "document:gray")'
        },
        cover: {
          type: 'string',
          description:
            'Cover image (for update_database): URL or built-in shorthand (gradient_1..11, solid_red/yellow/blue/beige, nasa_*, met_*, rijksmuseum_*, woodcuts_*)'
        },
        filters: { type: 'object', description: 'Query filters (for query/aggregate/group_by actions)' },
        sorts: { type: 'array', items: { type: 'object' }, description: 'Query sorts' },
        limit: { type: 'number', description: 'Max query results' },
        search: { type: 'string', description: 'Smart search across text fields (for query/aggregate/group_by)' },
        aggregations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max', 'unique_count'] },
              property: {
                type: 'string',
                description: 'Property name (required for sum/avg/min/max/unique_count; ignored for count)'
              },
              alias: { type: 'string', description: 'Output key (default: ${type}_${property})' }
            },
            required: ['type']
          },
          description: 'Aggregation specs (for aggregate/group_by actions)'
        },
        group_by: {
          type: 'object',
          properties: {
            property: { type: 'string', description: 'Property name to group by' }
          },
          required: ['property'],
          description: 'Group-by config (for group_by action)'
        },
        page_id: { type: 'string', description: 'Single page ID (for update_page)' },
        page_ids: { type: 'array', items: { type: 'string' }, description: 'Multiple page IDs (for delete_page)' },
        page_properties: { type: 'object', description: 'Page properties to update (for update_page)' },
        pages: { type: 'array', items: { type: 'object' }, description: 'Array of pages for bulk create/update' }
      },
      required: ['action']
    }
  },
  {
    name: 'blocks',
    description:
      'Read and modify block-level content within pages.\n\nActions (required params -> optional):\n- get (block_id): retrieve single block\n- children (block_id): list child blocks\n- append (block_id, content -> position, after_block_id): add markdown content at position\n- update (block_id, content OR properties): replace block content (mutually exclusive)\n- delete (block_id OR block_ids): remove block(s)\n\nUse `pages` for page metadata/properties. Page IDs are valid block IDs. update has two modes: content (markdown string) or properties (direct fields for structural types or to preserve color on headings). Image/file blocks contain signed URLs (1h expiry). append supports position: "start" (prepend), "end" (default), "after_block" (requires after_block_id).',
    annotations: {
      title: 'Blocks',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'children', 'append', 'update', 'delete']
        },
        block_id: { type: 'string', description: 'Block ID' },
        block_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of block IDs for batch delete action'
        },
        content: { type: 'string', description: 'Markdown content (for append/update)' },
        blocks: {
          type: 'array',
          items: { type: 'object' },
          description:
            'Direct block JSON array for structural types (synced_block, link_to_page, table, table_row, column, column_list). Mutually exclusive with content.'
        },
        position: {
          type: 'string',
          enum: ['start', 'end', 'after_block'],
          description:
            'Insert position for append: start (prepend), end (default), after_block (requires after_block_id)'
        },
        after_block_id: { type: 'string', description: 'Block ID to insert after (when position is after_block)' },
        properties: {
          type: 'object',
          description:
            'Direct block fields for update (for structural types or to preserve color on headings). Mutually exclusive with content.'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'users',
    description:
      'Get user information.\n\nActions (required params):\n- list: all workspace users (requires admin permissions)\n- get (user_id): single user info\n- me: current bot/integration user\n- from_workspace: extract users from accessible pages (use if list fails)',
    annotations: {
      title: 'Users',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'me', 'from_workspace']
        },
        user_id: { type: 'string', description: 'User ID (for get action)' }
      },
      required: ['action']
    }
  },
  {
    name: 'workspace',
    description:
      'Search workspace and get workspace info.\n\nActions (required params -> optional):\n- info: workspace name, plan, and bot user\n- search (-> query, filter.object="page"|"data_source", sort, limit): find pages/databases shared with integration',
    annotations: {
      title: 'Workspace',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['info', 'search']
        },
        query: { type: 'string', description: 'Search query' },
        filter: {
          type: 'object',
          properties: {
            object: {
              type: 'string',
              enum: ['page', 'data_source'],
              description: 'Filter by type: page or data_source (database)'
            }
          }
        },
        sort: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['ascending', 'descending'] },
            timestamp: { type: 'string', enum: ['last_edited_time', 'created_time'] }
          }
        },
        limit: { type: 'number', description: 'Max results' }
      },
      required: ['action']
    }
  },
  {
    name: 'comments',
    description:
      'Manage page comments.\n\nActions (required params -> optional):\n- list (page_id): all comments on a page\n- get (comment_id): single comment\n- create (content -> page_id for new discussion, discussion_id for reply)\n- update (comment_id, content): edit comment text\n- delete (comment_id): delete comment',
    annotations: {
      title: 'Comments',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] },
        page_id: { type: 'string', description: 'Page ID' },
        comment_id: { type: 'string', description: 'Comment ID (for get, update, delete action)' },
        discussion_id: { type: 'string', description: 'Discussion ID (for replies)' },
        content: { type: 'string', description: 'Comment content (for create, update)' }
      },
      required: ['action']
    }
  },
  {
    name: 'content_convert',
    description:
      'Convert between markdown and Notion block JSON. Directions: markdown-to-blocks (input: markdown string), blocks-to-markdown (input: JSON array of Notion blocks or JSON string). Most tools (pages, blocks) handle markdown automatically -- use this only for preview/validation. Supported markdown: headings, lists, to-do, code blocks, blockquotes, dividers, callouts (> [!NOTE]), toggles (<details>), tables, images, bookmarks, embeds, equations ($$), columns (:::columns), [toc], [breadcrumb]. Inline: **bold**, *italic*, `code`, ~~strike~~, [link](url).',
    annotations: {
      title: 'Content Convert',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['markdown-to-blocks', 'blocks-to-markdown'],
          description: 'Conversion direction'
        },
        content: { type: 'string', description: 'Content to convert (string or array/JSON string)' }
      },
      required: ['direction', 'content']
    }
  },
  {
    name: 'file_uploads',
    description:
      'Upload files to Notion.\n\nActions (required params -> optional):\n- create (filename -> content_type, mode="single"|"multi_part", number_of_parts)\n- send (file_upload_id, file_content -> part_number): base64-encoded content; single-part auto-finalizes to status=uploaded\n- complete (file_upload_id): idempotent; required only for multi_part, no-op for already-uploaded single-part\n- retrieve (file_upload_id)\n- list (-> limit)\n\nMax 20MB direct, multi-part for larger files.',
    annotations: {
      title: 'File Uploads',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'send', 'complete', 'retrieve', 'list']
        },
        file_upload_id: { type: 'string', description: 'File upload ID (from create step)' },
        filename: { type: 'string', description: 'Filename (for create)' },
        content_type: { type: 'string', description: 'MIME type (for create, e.g. "image/png")' },
        mode: { type: 'string', enum: ['single', 'multi_part'], description: 'Upload mode (default: single)' },
        number_of_parts: { type: 'number', description: 'Number of parts (for multi_part mode)' },
        part_number: { type: 'number', description: 'Part number (for send in multi_part mode)' },
        file_content: {
          type: 'string',
          description:
            'Base64-encoded file content (for send). Must be valid base64: only A-Z, a-z, 0-9, +, /, = chars. Use Buffer.from(bytes).toString("base64") to encode.'
        },
        limit: { type: 'number', description: 'Max results for list' }
      },
      required: ['action']
    }
  },
  {
    name: 'help',
    description: 'Get full documentation for a tool. Use when compressed descriptions are insufficient.',
    annotations: {
      title: 'Help',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          enum: ['pages', 'databases', 'blocks', 'users', 'workspace', 'comments', 'content_convert', 'file_uploads'],
          description: 'Tool to get documentation for'
        }
      },
      required: ['tool_name']
    }
  },
  {
    name: 'config',
    description:
      'Manage server configuration and credential state.\n\nActions:\n- status: current credential state, token source, setup URL\n- setup_start (-> force): trigger relay setup to configure Notion token via browser\n- setup_reset: clear credentials and config, return to awaiting_setup\n- setup_complete: re-check credentials after external config changes\n- set: update a runtime setting (notion has no mutable settings; returns info)\n- cache_clear: clear any cached state (no-op for notion)',
    annotations: {
      title: 'Config',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'setup_start', 'setup_reset', 'setup_complete', 'set', 'cache_clear']
        },
        force: {
          type: 'boolean',
          description: 'Force setup_start even if already configured'
        },
        key: {
          type: 'string',
          description: 'Setting key (for set action)'
        },
        value: {
          type: 'string',
          description: 'Setting value (for set action)'
        }
      },
      required: ['action']
    }
  }
]

// Pre-compute valid tool names for the help endpoint to avoid allocations on every call
// BOLT OPTIMIZATION: Use Set for O(1) lookups instead of dynamic array creation
export const VALID_HELP_TOOL_NAMES = new Set(TOOLS.map((t) => t.name).filter((name) => name !== 'help'))
export const VALID_HELP_TOOLS_STRING = Array.from(VALID_HELP_TOOL_NAMES).join(', ')

// Pre-compute all tool names for error messages
// BOLT OPTIMIZATION: Avoid O(N) array mapping on every invalid tool call
export const ALL_TOOL_NAMES = TOOLS.map((t) => t.name)
export const ALL_TOOL_NAMES_STRING = ALL_TOOL_NAMES.join(', ')
