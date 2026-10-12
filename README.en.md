# Better Notion MCP

[🇺🇸 English](README.en.md) · [🇨🇳 简体中文](README.md)

> **An independently maintained enhanced edition evolved from the outstanding open-source project [n24q02m/better-notion-mcp](https://github.com/n24q02m/notion) (now `n24q02m/notion`), maintained by [one2agi](https://one2agi.com).**  
> A high-fidelity Markdown pipeline and production-grade Notion MCP infrastructure deeply redesigned for modern AI Agents (Claude, Cursor, Antigravity, Gemini Spark, etc.).

[🌐 Official Website](https://one2agi.com) · [🧭 Knowledge Base](https://way.one2agi.com) · [💬 Community](https://one2agi.com) · [📦 GitHub Repo](https://github.com/one2agi/better-notion-mcp)

[![Maintained by one2agi](https://img.shields.io/badge/maintained%20by-one2agi-blue?style=flat&logo=github)](https://github.com/one2agi)
[![npm](https://img.shields.io/npm/v/@faize555/better-notion-mcp?logo=npm&logoColor=white)](https://www.npmjs.com/package/@faize555/better-notion-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)](#)
[![Notion](https://img.shields.io/badge/Notion_API-000000?logo=notion&logoColor=white)](#)

---

## Table of Contents

- [Core Architecture Design](#core-architecture-design)
- [Key Features](#key-features)
- [Tool Matrix (10 Tools)](#tool-matrix-10-tools)
- [Quick Start & Installation](#quick-start--installation)
  - [1. Zero-Install with npx (Recommended)](#1-zero-install-with-npx-recommended)
  - [2. Global Installation via npm](#2-global-installation-via-npm)
  - [3. Docker Container (Stdio Mode)](#3-docker-container-stdio-mode)
- [Configuration Reference](#configuration-reference)
- [Self-Hosted Deployment: Remote OAuth 2.1](#self-hosted-deployment-remote-oauth-21)
- [Security & Sandbox Architecture](#security--sandbox-architecture)
- [Build from Source & Verification](#build-from-source--verification)
- [Origin & Attribution](#origin--attribution)
- [License](#license)

---

## Core Architecture Design

Better Notion MCP is engineered specifically for LLM context optimization and autonomous multi-step execution across 4 technical pillars:

### 1. Markdown-First Semantic Pipeline
Equipped with an in-house 1,700+ line bi-directional AST compiler. Elements like callouts, toggles, multi-column blocks, syntax-highlighted code, and complex tables render as clean, standard Markdown. Writing content automatically compiles into valid Notion Block trees, **reducing static and interaction token consumption by 70% to 90%**.

### 2. Composite Mega-Tools
Instead of exposing dozens of fragmented low-level endpoints, APIs are consolidated into **8 domain composite tools (53 atomic actions) + 2 infrastructure tools**. A single `pages` action can atomically update body content, title, icon, and cover in one transaction, eliminating redundant network hops.

### 3. Agent Resilience & Self-Healing
Features built-in exponential backoff retries (`retryWithBackoff`) and machine-readable fix advice (`suggestFixes`). When encountering transient rate limits or validation errors, structured fix instructions allow the model to self-correct autonomously without aborting tasks.

### 4. Lightweight & Isomorphic Runtimes
Seamlessly bridges local developer workflows and enterprise infrastructure: zero-setup local Stdio with integration tokens, or production Docker deployments with OAuth 2.1 + PKCE multi-user session isolation.

---

## Key Features

- 📄 **Full Markdown Round-Trip**: High-fidelity bi-directional AST conversion between Markdown and Notion blocks.
- 🛠️ **Complete 10-Tool Matrix**: 8 domain composite tools + 2 infrastructure tools covering 95%+ of Notion API capabilities.
- ⚡ **Atomic Multi-Field Updates**: Modify body text, title, icon, and cover in a single `replace_content` call.
- 📚 **Tiered Token Optimization**: Compact tool descriptions reduce static context by ~77%, with on-demand detailed manual retrieval via `help`.
- 🔄 **Kernel-Level Auto-Pagination**: `autoPaginate` transparently handles cursor loops and recursive deep-child block fetching.
- 🛡️ **Production Security**: Automatic token sanitization on error paths; full OAuth 2.1 PKCE support for HTTP mode.
- 🌐 **Dual Transport**: Seamlessly switch between local Stdio and self-hosted remote HTTP services.

---

## Tool Matrix (10 Tools)

The server registers **10 MCP tools** comprising 8 Notion domain composite tools and 2 infrastructure tools:

| Tool | Actions | Scope & Capabilities | Token Mode |
|:---|:---|:---|:---|
| **`pages`** | `create`, `get`, `get_property`, `update`, `move`, `archive`, `restore`, `duplicate`, `get_markdown`, `replace_content`, `insert_markdown`, `update_content`, `replace_content_range` (13 actions) | Full page lifecycle; native Markdown reading/writing, atomic metadata updates (`icon`, `cover`, `title`), server-side fast rendering. | Notion API |
| **`databases`** | `create`, `get`, `query`, `create_page`, `update_page`, `delete_page`, `create_data_source`, `update_data_source`, `update_database`, `list_templates`, `aggregate`, `group_by`, `create_view`, `list_views`, `get_view`, `update_view`, `delete_view` (17 actions) | Database schema management, multi-view configurations, batch row CRUD, and aggregations (count/sum/avg/group). | Notion API |
| **`blocks`** | `get`, `children`, `append`, `update`, `delete` (5 actions) | Granular block operations; tree traversal and content manipulation. | Notion API |
| **`workspace`** | `info`, `search` (2 actions) | Global fuzzy search and workspace metadata inspection. | Notion API |
| **`users`** | `list`, `get`, `me`, `from_workspace` (4 actions) | Team members, collaborators, and bot user retrieval. | Notion API |
| **`comments`** | `list`, `get`, `create`, `update`, `delete` (5 actions) | Comment discussion lifecycle on pages and blocks, with workarounds for upstream OAuth 404 quirks. | Notion API |
| **`content_convert`** | `markdown-to-blocks`, `blocks-to-markdown` (2 directions) | Pure local offline AST converter. Transforms Markdown into Notion blocks and vice versa without network calls. | **Offline (Token-Free)** |
| **`file_uploads`** | `create`, `send`, `complete`, `retrieve`, `list` (5 actions) | Upload local files and attachments to Notion with chunked multi-part resumption. | Notion API |
| **`help`** | Target `tool_name` | **Core of Tiered Token Optimization**: Dynamically retrieves complete schemas and examples for any composite tool. | **Offline (Token-Free)** |
| **`config`** | `status`, `setup_start`, `setup_reset`, `setup_complete`, `set`, `cache_clear` (6 actions) | **Runtime Autonomy**: Inspects credential health and resets or reloads configuration without restarting the client. | **Offline (Token-Free)** |

> **Note on Complex Arguments**: Parameters typed as objects or arrays (`properties`, `filters`, `sorts`, etc.) accept both raw structured JSON and JSON strings to maintain compatibility across different clients.

---

## Quick Start & Installation

### 1. Zero-Install with npx (Recommended)

Requires Node.js (>= 24) and a Notion integration token from [Notion Integrations](https://www.notion.so/my-integrations) (starts with `ntn_`):

Add to your MCP client configuration (Claude Desktop, Cursor, Antigravity, Windsurf, etc.):

```jsonc
{
  "mcpServers": {
    "better-notion-mcp": {
      "command": "npx",
      "args": ["-y", "@faize555/better-notion-mcp@latest"],
      "env": {
        "NOTION_TOKEN": "ntn_your_integration_token_here"
      }
    }
  }
}
```

### 2. Global Installation via npm

Install globally on your machine:

```bash
npm install -g @faize555/better-notion-mcp
```

Client configuration:

```jsonc
{
  "mcpServers": {
    "better-notion-mcp": {
      "command": "better-notion-mcp",
      "env": {
        "NOTION_TOKEN": "ntn_your_integration_token_here"
      }
    }
  }
}
```

### 3. Docker Container (Stdio Mode)

Build and run in stdio mode via Docker:

```bash
# Build the Docker image
docker build -t better-notion-mcp .

# Run container
docker run --rm -i -e NOTION_TOKEN=ntn_your_integration_token_here better-notion-mcp
```

---

## Configuration Reference

| Variable | Required | Default | Description |
|:---|:---|:---|:---|
| `NOTION_TOKEN` | Yes (Stdio mode) | - | Internal Notion integration token (`ntn_...`) |
| `TRANSPORT_MODE` / `MCP_TRANSPORT` | No | `stdio` | Transport mode. Set to `http` for remote multi-tenant service |
| `PORT` | No | `8080` | Port for remote HTTP transport |
| `HOST` | No | `0.0.0.0` | Bind address for remote HTTP server |
| `PUBLIC_URL` | Yes (HTTP mode) | - | Public URL of the server for OAuth redirect resolution |
| `NOTION_OAUTH_CLIENT_ID` | Yes (HTTP mode) | - | Notion Public Integration Client ID |
| `NOTION_OAUTH_CLIENT_SECRET` | Yes (HTTP mode) | - | Notion Public Integration Client Secret |
| `CREDENTIAL_SECRET` | No (HTTP mode) | - | 32-byte hex key for EdDSA signing across container restarts |

---

## Self-Hosted Deployment: Remote OAuth 2.1

Ideal for **team-wide tokenless access**. Users authenticate via standard OAuth 2.1 web authorization rather than copying and pasting private tokens.

### 1. Create a Notion Public Integration
1. Visit [Notion Developers](https://www.notion.so/my-integrations) and create an integration;
2. Select type **Public**;
3. Set **Redirect URIs** to: `https://<your-domain>/callback`;
4. Grant required read/write permissions and copy the **Client ID** and **Client Secret**.

### 2. Docker Compose Setup
Create `docker-compose.yml`:

```yaml
services:
  better-notion-mcp:
    image: better-notion-mcp:latest
    container_name: better-notion-mcp
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - TRANSPORT_MODE=http
      - MCP_TRANSPORT=http
      - PORT=8080
      - HOST=0.0.0.0
      - PUBLIC_URL=https://<your-domain>
      - NOTION_OAUTH_CLIENT_ID=<your-client-id>
      - NOTION_OAUTH_CLIENT_SECRET=<your-client-secret>
      - CREDENTIAL_SECRET=<32-byte-hex-secret>
```

> **Tip**: Generate a secret with: `openssl rand -hex 32`.

### 3. Nginx Reverse Proxy
```nginx
server {
    listen 443 ssl http2;
    server_name <your-domain>;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

Verify service status: `curl https://<your-domain>/health` should return `{"status":"ok"}`.

---

## Security & Sandbox Architecture

- **Data Privacy**: Stdio mode runs entirely within local OS process memory without external intermediaries. HTTP mode maintains in-memory tenant isolation.
- **Credential Sanitization**: The kernel filters sensitive tokens and secrets before error logs reach the model context.
- **OAuth 2.1 + PKCE S256**: Tamper-proof cryptographic authorization flows ensure secure remote credential exchange.

---

## Build from Source & Verification

Built with [Bun](https://bun.sh) and TypeScript:

```bash
# 1. Clone repository
git clone https://github.com/one2agi/better-notion-mcp.git
cd better-notion-mcp

# 2. Install dependencies
bun install

# 3. Local development server
bun run dev

# 4. Linting and full test suite (1500+ tests)
bun run check
bun run test
```

---

## Origin & Attribution

- **Upstream Origin**: Originally derived from the pioneering open-source project [n24q02m/better-notion-mcp](https://github.com/n24q02m/notion) by [@n24q02m](https://github.com/n24q02m) (now renamed to `notion`). We honor the original author's foundational work on Notion AST parsing and composite tool architectures!
- **Independent Enhanced Edition**: Currently maintained and evolved by **[one2agi](https://one2agi.com)**. We streamlined the hosting surface, focused on robust cross-platform Node.js/Docker runtimes, and optimized the suite for production-grade autonomous Agent workflows.

- **Official Website**: [https://one2agi.com](https://one2agi.com)
- **Knowledge Base**: [https://way.one2agi.com](https://way.one2agi.com)
- **GitHub Organization**: [https://github.com/one2agi](https://github.com/one2agi)

---

## License

Licensed under the [MIT License](LICENSE).
