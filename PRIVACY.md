# Privacy Policy — Better Notion MCP

**Last updated:** 2026-10-12

## Data Collection & Processing

Better Notion MCP acts as a secure semantic pipeline between MCP clients (Claude, Cursor, Antigravity, etc.) and the official Notion API. It does **not** collect, store, or transmit any user data, credentials, or workspace content beyond what is necessary to process the immediate tool request.

## Stdio Mode (Local Deployment)

When running locally via `npx`, global `npm`, or Docker in stdio mode:

- **Zero External Telemetry**: All data and tool executions stay exclusively within your local machine.
- **Credential Isolation**: Your `NOTION_TOKEN` is read directly from your local environment variables and is transmitted strictly to `https://api.notion.com`.

## OAuth 2.1 Mode (Self-Hosted HTTP)

When self-hosting the HTTP server for multi-tenant or team access:

- **Authentication**: Uses Notion OAuth 2.1 with PKCE S256 code challenges.
- **Token Storage**: User tokens are isolated in-memory or securely encrypted per authenticated session identity. Access tokens are used strictly to communicate with the Notion API on behalf of the authorized user.
- **No Content Database**: No Notion page content, databases, blocks, or conversation history are persisted to external databases.
- **Credential Sanitization**: The kernel automatically sanitizes all exception traces to strip access tokens and authorization secrets before errors surface to clients.

## Third-Party Services

- **Notion API** (`api.notion.com`): Data submitted through tools is subject to [Notion's Privacy Policy](https://www.notion.so/Privacy-Policy-3468d120cf614d4c9014c09f6aab3571).

## Contact

For privacy or security inquiries: **hi@one2agi.com**
