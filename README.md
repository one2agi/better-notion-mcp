# Better Notion MCP

mcp-name: io.github.one2agi/better-notion-mcp

**Markdown-first Notion for AI agents -- pages, databases, blocks, and comments in one call.**

[![npm](https://img.shields.io/npm/v/@faize555/better-notion-mcp?logo=npm&logoColor=white)](https://www.npmjs.com/package/@faize555/better-notion-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)](#)
[![Notion](https://img.shields.io/badge/Notion_API-000000?logo=notion&logoColor=white)](#)

## Table of contents

- [Features](#features)
- [Install](#install)
- [Tools](#tools)
- [Configuration](#configuration)
- [Remote OAuth 部署与使用 (Self-Hosted)](#remote-oauth-部署与使用-self-hosted-oauth-21)
- [Deploy to Cloudflare](#deploy-to-cloudflare)
- [Comparison](#comparison)
- [Security & Trust Model](#security--trust-model)
- [Build from Source](#build-from-source)
- [License](#license)

## Features

- **Markdown in, Markdown out** -- human-readable content instead of raw JSON blocks
- **8 composite tools, 53 actions** -- one call instead of chaining 2+ atomic Notion endpoints (plus `config` and `help`)
- **Atomic metadata & content updates** -- update page body, title, icon, and cover in a single `replace_content` transaction
- **High-fidelity AST parser** -- native Notion callouts, toggles, bookmarks, table cell line-breaks (`<br>`), and syntax shielding
- **Auto-pagination and bulk operations** -- no manual cursor handling or looping
- **Tiered token optimization** -- ~77% reduction via compressed descriptions + on-demand `help` tool
- **Dual transport** -- local stdio (integration token) or remote HTTP (OAuth 2.1, no token to paste)

## Install

### 1. Zero-Install with `npx` (Recommended)

Run directly via `npx` without manual installation (Node.js >= 24) with a Notion integration token from <https://www.notion.so/my-integrations> (starts with `ntn_`):

```jsonc
// MCP client config (e.g. Claude Desktop / Cursor / Windsurf / Antigravity / .mcp.json)
{
  "mcpServers": {
    "better-notion-mcp": {
      "command": "npx",
      "args": ["-y", "@faize555/better-notion-mcp@latest"],
      "env": { "NOTION_TOKEN": "ntn_your_token_here" }
    }
  }
}
```

### 2. Global Install via `npm`

Install globally on your machine:

```bash
npm install -g @faize555/better-notion-mcp
```

Then configure your MCP client with the installed binary:

```jsonc
{
  "mcpServers": {
    "better-notion-mcp": {
      "command": "better-notion-mcp",
      "env": { "NOTION_TOKEN": "ntn_your_token_here" }
    }
  }
}
```

### 3. Docker (stdio)

Build and run locally with Docker:

```bash
# Build the Docker image
docker build -t better-notion-mcp .

# Run container in stdio mode
docker run --rm -i -e NOTION_TOKEN=ntn_your_token_here better-notion-mcp
```

## Tools

Eight composite Notion tools (53 actions) plus two infrastructure tools (`config`, `help`):

| Tool | Actions | Description |
|:-----|:--------|:------------|
| `pages` | `create`, `get`, `get_property`, `update`, `move`, `archive`, `restore`, `duplicate`, `get_markdown`, `replace_content`, `insert_markdown`, `update_content`, `replace_content_range` | Create, read, update, and organize pages; native markdown (Notion SDK v5.22+); atomic metadata updates (`icon`, `cover`, `title`) |
| `databases` | `create`, `get`, `query`, `create_page`, `update_page`, `delete_page`, `create_data_source`, `update_data_source`, `update_database`, `list_templates`, `aggregate`, `group_by`, `create_view`, `list_views`, `get_view`, `update_view`, `delete_view` | Database CRUD, page management, views lifecycle, and analytics (count/sum/avg/group) |
| `blocks` | `get`, `children`, `append`, `update`, `delete` | Read and manipulate block content |
| `users` | `list`, `get`, `me`, `from_workspace` | List and retrieve user information |
| `workspace` | `info`, `search` | Workspace metadata and cross-workspace search |
| `comments` | `list`, `get`, `create`, `update`, `delete` | Page and block comments full lifecycle (list, get, create discussion/reply, update, delete) |
| `content_convert` | `markdown-to-blocks`, `blocks-to-markdown` | Convert between Markdown and Notion blocks (uses a `direction` parameter) |
| `file_uploads` | `create`, `send`, `complete`, `retrieve`, `list` | Upload files to Notion (single or multi-part) |
| `config` | `status`, `setup_start`, `setup_reset`, `setup_complete`, `set`, `cache_clear` | Inspect and manage credential state and configuration lifecycle |
| `help` | - | Get full documentation for any composite tool (`tool_name` parameter) |

> **Note on nested-object arguments**: Parameters typed as objects/arrays
> (`properties`, `filters`, `sorts`, `aggregations`, `updates`, etc.) also
> accept a **JSON string** of the same shape. Required when the calling MCP
> client serializes arguments as XML (e.g. Claude Code), because XML
> serialization silently drops nested content to `{}`. Pass
> `'{"数字":42}'` instead of `{"数字":42}` in that case.

### MCP Resources

| URI | Description |
|:----|:------------|
| `notion://docs/pages` | Page operations reference |
| `notion://docs/databases` | Database operations reference |
| `notion://docs/blocks` | Block operations reference |
| `notion://docs/users` | User operations reference |
| `notion://docs/workspace` | Workspace operations reference |
| `notion://docs/comments` | Comment operations reference |
| `notion://docs/content_convert` | Content conversion reference |
| `notion://docs/file_uploads` | File upload reference |

## Configuration

| Variable | Required | Default | Description |
|:---------|:---------|:--------|:------------|
| `NOTION_TOKEN` | Yes (stdio) | - | Notion integration token |
| `TRANSPORT_MODE` / `MCP_TRANSPORT` | No | `stdio` | Set either to `http` for remote mode (or pass `--http`) |
| `PUBLIC_URL` | No (http) | - | Server's public URL for OAuth redirect links |
| `NOTION_OAUTH_CLIENT_ID` | Yes (http) | - | Notion Public Integration client ID |
| `NOTION_OAUTH_CLIENT_SECRET` | Yes (http) | - | Notion Public Integration client secret |
| `MCP_AUTH_DISABLE` | No (http) | - | Set to `1` to skip Bearer JWT verification when behind an external auth gateway |
| `PORT` | No | `0` (OS-assigned) | Server port; set explicitly (e.g. `8080`) to bind a fixed port |
| `HOST` | No | - | Bind address (http mode) |

## Remote OAuth 部署与使用 (Self-Hosted OAuth 2.1)

适用场景：**无需用户或 Agent 手动复制粘贴 Notion Token**。通过自建远程 OAuth 2.1 鉴权服务，支持 Google Gemini Spark、Claude Desktop、Cursor 等任何 AI Agent 客户端通过标准协议一键弹窗授权并安全调用。

### 1. 服务端部署（3 步完成）

#### 步骤 1：创建 Notion Public Integration
1. 访问 [Notion 开发者中心](https://www.notion.so/my-integrations) 新建集成；
2. 类型选择 **Public（公共集成）**；
3. **Redirect URIs** 填写：`https://<你的域名>/callback`；
4. 勾选所需读写权限，保存并获取 **Client ID** 与 **Client Secret**。

#### 步骤 2：Docker 运行服务
创建 `docker-compose.yml`：

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
      - PUBLIC_URL=https://<你的域名>
      - NOTION_OAUTH_CLIENT_ID=<你的 Client ID>
      - NOTION_OAUTH_CLIENT_SECRET=<你的 Client Secret>
      - CREDENTIAL_SECRET=<32字节随机hex密钥>
```

> **提示**：`CREDENTIAL_SECRET` 用于生成 EdDSA 签名密钥，保证容器重启后 OAuth 身份不失效（可通过 `openssl rand -hex 32` 生成）。

#### 步骤 3：配置 Nginx HTTPS 反向代理
必须开启 HTTPS 并支持 Streamable HTTP / SSE 长连接：

```nginx
server {
    listen 443 ssl http2;
    server_name <你的域名>;

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

验证服务健康：`curl https://<你的域名>/health` 返回 `{"status":"ok"}` 即部署成功。

---

### 2. 客户端接入使用

#### 接入方式 A：Google Gemini Spark (官方连接应用)
1. 打开 [Gemini Spark Connected Apps](https://gemini.google.com/spark/apps)；
2. 点击 **Add a custom app**，在 **MCP Server URL** 输入：`https://<你的域名>/mcp`；
3. 服务端内置 RFC 8414 与 RFC 7591 协议，Gemini 会**自动探测端点**，无需手动配置 Client Secret；
4. 点击 **Connect** -> 确认 Google 账号绑定 -> 自动跳转 Notion 授权页面并确认；
5. 授权成功后，在 Gemini 对话框中直接输入 `@<你的应用名> 列出我的页面` 即可使用。

#### 接入方式 B：Cursor / Claude Desktop / 通用 Agent 客户端
在支持远程 MCP 的客户端配置中，直接指定服务地址：

```jsonc
{
  "mcpServers": {
    "better-notion": {
      "url": "https://<你的域名>/mcp"
    }
  }
}
```
客户端发起请求时，会自动通过 OAuth 2.1 PKCE 引导在浏览器中完成授权并静默换取 Token。

## Deploy to Cloudflare

Run your own multi-user better-notion-mcp serverless on Cloudflare (Worker + Container + KV).

**Prerequisites:** a Cloudflare account on the **Workers Paid plan** — required for Containers (the Cloudflare free tier does not include Containers) — and the `wrangler` CLI.

1. `git clone https://github.com/one2agi/better-notion-mcp && cd better-notion-mcp`
2. `wrangler login`
3. Provision the KV namespace and paste its id into `wrangler.jsonc`:
   ```bash
   wrangler kv namespace create better-notion-kv
   ```
4. Set secrets:
   ```bash
   wrangler secret put CREDENTIAL_SECRET
   wrangler secret put NOTION_OAUTH_CLIENT_ID
   wrangler secret put NOTION_OAUTH_CLIENT_SECRET
   ```
   `CREDENTIAL_SECRET` is REQUIRED: it derives a deterministic OAuth signing key so
   user identity survives container recreation.
5. Push the http image to the CF managed registry and deploy:
   ```bash
   wrangler containers push better-notion-mcp:beta
   wrangler deploy
   ```
6. Complete the Notion OAuth flow in the browser at your Worker domain.

Per-user Notion access tokens are encrypted into KV (`MCP_STORAGE_BACKEND=cf-kv`),
so they survive scale-to-zero. Do NOT set `MCP_AUTH_DISABLE` on a shared/public
deployment — it collapses all users into a single token bucket.

## Comparison

How better-notion-mcp stacks up against direct competitors in each pillar:

| Capability | better-notion-mcp | makenotion/notion-mcp-server | suekou/mcp-notion-server | awkoy/notion-mcp-server |
|---|---|---|---|---|
| Markdown in / out | Yes (round-trip on pages + blocks) | No (raw Notion JSON) | partial (experimental, append + opt-in convert) | Yes (round-trip + GFM) |
| Composite tool design | Yes (8 composite tools, 53 actions) | No (22 endpoint-mapped tools) | partial (simplified + raw JSON tools) | Yes (2 dispatch tools, 35+ ops) |
| File uploads to Notion | Yes (`file_uploads`, single + multi-part) | No | No | Yes (`upload_file`, single + multi-part) |
| Comments | Yes (`comments`: list/get/create/update/delete) | Yes | Yes | Yes |
| Remote HTTP + OAuth 2.1 transport | Yes (per-JWT-sub multi-user) | partial (HTTP + bearer token, no OAuth) | No (stdio token only) | No (stdio token only) |
| Self-hostable | Yes (Docker, own OAuth app) | Yes | Yes | Yes |
| License | MIT | ? | MIT | MIT |

## Security & Trust Model

- **OAuth 2.1 + PKCE S256** -- Secure authorization with code challenge
- **Rate limiting** -- 120 req/min/IP on HTTP transport
- **Session owner binding** -- IP check + TTL for pending token binds
- **Null safety** -- Handles Notion API quirks (comments.list 404, undefined rich_text)

| Mode | Storage | Encryption | Who can read your data? |
|---|---|---|---|
| HTTP self-host | In-memory `Map<sub, OAuthToken>` | In-process only | Only you (admin = user) |
| stdio (local) | Local process memory / env variable | Local OS user isolation | Only your local system |

## Build from Source

```bash
git clone https://github.com/one2agi/better-notion-mcp.git
cd better-notion-mcp
bun install
bun run dev
```

## License

MIT -- See [LICENSE](LICENSE).
