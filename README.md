# Better Notion MCP

> **基于社区优秀项目 [n24q02m/better-notion-mcp](https://github.com/n24q02m/notion)（现名 `n24q02m/notion`）演进的独立增强版，由 [one2agi](https://one2agi.com) 独立维护。**  
> 专为 AI Agent（Claude, Cursor, Antigravity 等）深度打造的高保真 Markdown 读写管线与企业级 Notion MCP 基础设施。

[🌐 官方网站](https://one2agi.com) · [🧭 导航知识库](https://way.one2agi.com) · [💬 交流社区](https://one2agi.com) · [📦 仓库主页](https://github.com/one2agi/better-notion-mcp)

[![Maintained by one2agi](https://img.shields.io/badge/maintained%20by-one2agi-blue?style=flat&logo=github)](https://github.com/one2agi)
[![npm](https://img.shields.io/npm/v/@faize555/better-notion-mcp?logo=npm&logoColor=white)](https://www.npmjs.com/package/@faize555/better-notion-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)](#)
[![Notion](https://img.shields.io/badge/Notion_API-000000?logo=notion&logoColor=white)](#)

## Table of contents

- [设计哲学与特点](#设计哲学与特点)
- [Features](#features)
- [Install](#install)
- [Tools](#tools)
- [Configuration](#configuration)
- [Remote OAuth 部署与使用 (Self-Hosted)](#remote-oauth-部署与使用-self-hosted-oauth-21)
- [Comparison](#comparison)
- [Security & Trust Model](#security--trust-model)
- [Build from Source](#build-from-source)
- [项目起源与致敬](#项目起源与致敬)
- [License](#license)

## 设计哲学与特点

### 为什么拒绝原生 Notion API 的粗暴堆砌？

市面上多数 Notion MCP 仅仅是将官方 20+ 个原子 REST API 机械映射，导致 AI Agent 在实际落地中频频“翻车”：上下文撑爆、JSON Block 语法死板、工具频频选错、偶发限流即崩溃。

Better Notion MCP 秉承 4 条直率犀利的设计哲学：

#### 1. Markdown-First：AI 呼吸的是文本，不是层层嵌套的 JSON 垃圾
* **痛点**：Notion 原生 API 采用极度碎片化的 Block 模型，一篇简短页面就会解包出成千上万行带有 `rich_text`、`annotations` 的臃肿 JSON，瞬间吞噬模型宝贵的 Context 窗口。
* **解法**：**全链路「Markdown 进，Markdown 出」**。内置高保真 AST 双向解析器，无论是 Callout、Toggle、分栏、代码高亮还是复合表格，在 Agent 视野中均呈现为自然、干净的 Markdown。Token 消耗**断崖式削减 70% 以上**。

#### 2. Composite Mega-Tools：拒绝 API 碎片化，收敛决策成本
* **痛点**：将几十个低级 API 粗暴塞给 Agent，只会让 Schema 长度爆炸，模型在“先查页面、再查块、再改属性”的多轮往返中频频迷失或选错工具。
* **解法**：**按业务领域收敛为 8 大复合工具（收敛 53 项原子动作）**。`pages`、`databases`、`blocks` 等按业务领域高度内聚。单次调用即可原子更新正文、标题、图标与封面，一击必中，彻底消灭冗余 Roundtrip。

#### 3. Agent-Native 韧性与自愈：错误不应成为会话的终点
* **痛点**：Notion API 偶发 429 限流、网络抖动或参数轻微偏差，直接抛异常导致整个智能体执行链路夭折。
* **解法**：**内置指数退避重试（`retryWithBackoff`）与 AI 自愈建议系统（`suggestFixes`）**。当参数缺失或权限异常时，直接返回结构化、可落地的纠错指示，Agent 看完即可就地自我修复，具备真正的生产级无人值守鲁棒性。

#### 4. 纯粹与同构：单机极简，上云坚固
* **痛点**：既要本地调试，又要团队多租户接入，往往被迫维护多套代码或绑定复杂的边缘 Serverless 平台。
* **解法**：**双模同构，剥离冗余胶水层**。本地使用 Stdio + Integration Token 秒级即用；生产环境提供标准 Node.js / Docker 容器，基于 OAuth 2.1 + PKCE 实现多用户安全隔离与会话管理。

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

## 项目起源与致敬

- **上游原作**：本项目最初源自社区优秀开源先锋 [n24q02m/better-notion-mcp](https://github.com/n24q02m/notion)（作者 [@n24q02m](https://github.com/n24q02m)，现仓库更名为 `notion`）。致敬原作者在 Notion AST 高保真解析与复合工具架构上的奠基性探索！
- **独立维护的增强版**：本项目当前由 **[one2agi](https://one2agi.com)** 独立维护演进。我们剥离了冗余边缘宿主负担，专注于提供高鲁棒性、双模同构（本地 Stdio + 私有 OAuth HTTP）的企业级交付体验，持续打造高保真自主 Agent 生产工具链。

- **官方网站**: [https://one2agi.com](https://one2agi.com)
- **AI 导航与知识库**: [https://way.one2agi.com](https://way.one2agi.com)
- **GitHub 组织**: [https://github.com/one2agi](https://github.com/one2agi)

## License

MIT -- See [LICENSE](LICENSE).
