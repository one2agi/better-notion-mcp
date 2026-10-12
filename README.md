# Better Notion MCP

[🇨🇳 简体中文](README.md) · [🇺🇸 English](README.en.md)

> **基于社区开源项目 [n24q02m/better-notion-mcp](https://github.com/n24q02m/notion)（现名 `n24q02m/notion`）演进的独立增强版，由 [one2agi](https://one2agi.com) 独立维护。**  
> 专为现代 AI Agent（Claude, Cursor, Antigravity, Gemini Spark 等）深度重构的高保真 Markdown 读写管线与企业级 Notion MCP 基础设施。

[🌐 官方网站](https://one2agi.com) · [🧭 导航知识库](https://way.one2agi.com) · [💬 交流社区](https://one2agi.com) · [📦 仓库主页](https://github.com/one2agi/better-notion-mcp)

[![Maintained by one2agi](https://img.shields.io/badge/maintained%20by-one2agi-blue?style=flat&logo=github)](https://github.com/one2agi)
[![npm](https://img.shields.io/npm/v/@faize555/better-notion-mcp?logo=npm&logoColor=white)](https://www.npmjs.com/package/@faize555/better-notion-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](#)
[![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)](#)
[![Notion](https://img.shields.io/badge/Notion_API-000000?logo=notion&logoColor=white)](#)

---

## 目录

- [核心架构设计](#核心架构设计)
- [核心特性](#核心特性)
- [工具矩阵 (10 大工具)](#工具矩阵-10-大工具)
- [快速安装与配置](#快速安装与配置)
  - [1. npx 免安装即用 (推荐)](#1-npx-免安装即用-推荐)
  - [2. 全局安装](#2-全局安装)
  - [3. Docker 容器运行](#3-docker-容器运行)
- [环境配置参考](#环境配置参考)
- [私有化部署：Remote OAuth 2.1 服务](#私有化部署remote-oauth-21-服务)
- [安全与沙盒架构](#安全与沙盒架构)
- [源码构建与测试](#源码构建与测试)
- [项目起源与致敬](#项目起源与致敬)
- [许可证](#许可证)

---

## 核心架构设计

Better Notion MCP 专为大语言模型的上下文优化与长链路工具调用设计，确立了 4 项核心技术支柱：

### 1. 全链路 Markdown 语义流 (Markdown-First)
内置 1700+ 行工业级 AST 双向解析器。无论是 Callout、Toggle、分栏、代码高亮还是复合表格，在 Agent 视野中均呈现为紧凑纯净的 Markdown。写入时自动转为合规的底层 Block 树，**将静态与动态交互 Token 消耗削减 70%~90%**。

### 2. 领域复合工具设计 (Composite Mega-Tools)
摒弃碎片化暴露数十个底层原子 API，按业务领域收敛为 **8 大复合工具（53 项原子动作）+ 2 个系统级工具**。以 `pages` 为例，单次调用即可原子更新正文、标题、图标与封面，消灭多轮冗余网络往返。

### 3. 智能体韧性自愈系统 (Agent Resilience & Self-Healing)
内置指数退避重试（`retryWithBackoff`）与 AI 自愈建议系统（`suggestFixes`）。当遇到限流、抖动或参数校验异常时，直接返回结构化、可落地的纠错指示，赋能 Agent 就地自我修复，保障长流程任务稳定闭环。

### 4. 轻量与同构运行 (Lightweight & Isomorphic)
支持本地单机与云端多租户同构：本地 Stdio + Token 秒级即用；生产环境提供标准 Node.js / Docker 容器，基于 OAuth 2.1 + PKCE 实现多用户安全隔离与会话管理。

---

## 核心特性

- 📄 **全链路 Markdown 直通**：双向高保真 AST 互转，告别底层繁琐的 Block JSON。
- 🛠️ **10 大工具完整矩阵**：8 个 Notion 领域复合工具 + 2 个系统基础设施工具，覆盖官方 95% 以上功能。
- ⚡ **原子多字段覆写**：单次 `replace_content` 即可同时更新正文、标题、图标与封面，无竞态风险。
- 📚 **分层 Token 优化机制**：常驻描述极致精简（静态开销压缩 ~77%），通过 `help` 工具按需动态查阅完整规范。
- 🔄 **内核级自动分页与深层遍历**：`autoPaginate` 自动处理游标与子块深搜，长页面与大库全量完整拉取。
- 🛡️ **生产级安全防护**：敏感凭据在异常链路自动脱敏过滤，杜绝 Token 泄露；HTTP 端支持 OAuth 2.1 PKCE。
- 🌐 **双模运行架构**：无缝支持本地 Stdio 快速直连与远程 HTTP 多租户授权。

---

## 工具矩阵 (10 大工具)

系统共注册 **10 个 MCP 工具**，由 8 个业务复合工具与 2 个基础设施工具构成：

| 工具名称 | 支持动作 (Actions) | 功能定位与核心能力 | Token 机制 |
|:---|:---|:---|:---|
| **`pages`** | `create`, `get`, `get_property`, `update`, `move`, `archive`, `restore`, `duplicate`, `get_markdown`, `replace_content`, `insert_markdown`, `update_content`, `replace_content_range` (共 13 项) | 页面全生命周期管理；原生 Markdown 读写、原子级元数据修改 (`icon`, `cover`, `title`)、服务端快速渲染 | 依赖 API |
| **`databases`** | `create`, `get`, `query`, `create_page`, `update_page`, `delete_page`, `create_data_source`, `update_data_source`, `update_database`, `list_templates`, `aggregate`, `group_by`, `create_view`, `list_views`, `get_view`, `update_view`, `delete_view` (共 17 项) | 数据库 Schema 治理、多维视图配置、数据行批量 CRUD、分组聚合统计 (count/sum/avg) | 依赖 API |
| **`blocks`** | `get`, `children`, `append`, `update`, `delete` (共 5 项) | 页面内部细粒度块级操作；树状层级遍历与增删改查 | 依赖 API |
| **`workspace`** | `info`, `search` (共 2 项) | 跨工作区全局模糊检索与元数据查询 | 依赖 API |
| **`users`** | `list`, `get`, `me`, `from_workspace` (共 4 项) | 团队成员、协作人及机器人身份检索 | 依赖 API |
| **`comments`** | `list`, `get`, `create`, `update`, `delete` (共 5 项) | 页面/块级评论讨论全生命周期管理，自动规避官方 OAuth 404 Bug | 依赖 API |
| **`content_convert`** | `markdown-to-blocks`, `blocks-to-markdown` (共 2 方向) | 纯本地离线 AST 转换引擎，可在本地将 Markdown 文本转换为 Notion Block，无需远程调用 | **纯本地离线 (免 Token)** |
| **`file_uploads`** | `create`, `send`, `complete`, `retrieve`, `list` (共 5 项) | 上传本地文件与附件至 Notion，原生支持大文件分片断点续传 | 依赖 API |
| **`help`** | 指定 `tool_name` | **分层 Token 优化核心**：动态拉取指定工具的详尽参数手册与使用范例 | **纯本地离线 (免 Token)** |
| **`config`** | `status`, `setup_start`, `setup_reset`, `setup_complete`, `set`, `cache_clear` (共 6 项) | **运行时自治核心**：动态检查凭证有效性、探测与重载配置，免去重启客户端的麻烦 | **纯本地离线 (免 Token)** |

> **关于复合对象参数的特别说明**：针对对象或数组类型的参数（如 `properties`, `filters`, `sorts` 等），工具原生支持直接传入标准 JSON 对象，亦支持传入字符串形式的 JSON（针对某些客户端嵌套序列化截断做了自动解包兼容）。

---

## 快速安装与配置

### 1. npx 免安装即用 (推荐)

无需手动下载安装，只需拥有 Node.js (>= 24) 与 Notion 集成 Token（前往 [Notion Integrations](https://www.notion.so/my-integrations) 创建，以 `ntn_` 开头）：

在您的 AI 客户端（如 Claude Desktop, Cursor, Antigravity, Windsurf）配置文件中添加：

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

### 2. 全局安装

通过 npm 进行全局安装：

```bash
npm install -g @faize555/better-notion-mcp
```

客户端配置：

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

### 3. Docker 容器运行 (Stdio 模式)

使用 Docker 构建并在本地 stdio 管道中运行：

```bash
# 构建镜像
docker build -t better-notion-mcp .

# 启动容器
docker run --rm -i -e NOTION_TOKEN=ntn_your_integration_token_here better-notion-mcp
```

---

## 环境配置参考

| 配置项 | 必填 | 默认值 | 作用说明 |
|:---|:---|:---|:---|
| `NOTION_TOKEN` | 是 (本地模式) | - | Notion 内部集成访问凭证 (`ntn_...`) |
| `TRANSPORT_MODE` / `MCP_TRANSPORT` | 否 | `stdio` | 运行模式；设为 `http` 进入远程多租户服务模式 |
| `PORT` | 否 | `8080` | 远程 HTTP 服务监听端口 |
| `HOST` | 否 | `0.0.0.0` | 远程 HTTP 监听地址 |
| `PUBLIC_URL` | 是 (远程模式) | - | 服务的外部公网访问域名 (用于拼接 OAuth 回调地址) |
| `NOTION_OAUTH_CLIENT_ID` | 是 (远程模式) | - | Notion 公共集成 (Public Integration) Client ID |
| `NOTION_OAUTH_CLIENT_SECRET` | 是 (远程模式) | - | Notion 公共集成 Client Secret |
| `CREDENTIAL_SECRET` | 否 (远程模式) | - | 32 字节随机 Hex 密钥，用于 EdDSA 签名保持会话跨重启持久化 |

---

## 私有化部署：Remote OAuth 2.1 服务

适用场景：**团队免密使用**。通过自建远程 OAuth 2.1 服务，使用者无需复制粘贴 Token，点击浏览器一键授权即可使用。

### 1. 创建 Notion Public Integration
1. 访问 [Notion 开发者中心](https://www.notion.so/my-integrations) 新建集成；
2. 类型选择 **Public（公共集成）**；
3. **Redirect URIs** 填写：`https://<你的域名>/callback`；
4. 勾选所需权限，获取 **Client ID** 与 **Client Secret**。

### 2. Docker Compose 编排启动
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

> **提示**：密钥可通过命令 `openssl rand -hex 32` 快速生成。

### 3. Nginx 反向代理配置
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

验证健康状态：`curl https://<你的域名>/health` 返回 `{"status":"ok"}` 即部署成功。

---

## 安全与沙盒架构

- **数据隐私与隔离**：本地 Stdio 模式下仅在您本地操作系统内存中流通，不经过任何第三方中转；HTTP 模式下使用内存化多租户隔离。
- **敏感信息脱敏**：在错误上报与异常抛出链路中，内核自动过滤敏感的 Token 凭据与安全字段。
- **OAuth 2.1 + PKCE S256**：防篡改授权验证流程，保障远程授权交换过程安全可信。

---

## 源码构建与测试

本项目采用 [Bun](https://bun.sh) 与 TypeScript 构建：

```bash
# 1. 克隆代码仓库
git clone https://github.com/one2agi/better-notion-mcp.git
cd better-notion-mcp

# 2. 安装依赖
bun install

# 3. 运行本地开发调试
bun run dev

# 4. 执行全量代码检查与测试套件 (1500+ 测试项)
bun run check
bun run test
```

---

## 项目起源与致敬

- **上游原作**：本项目最初源自社区开源先锋 [n24q02m/better-notion-mcp](https://github.com/n24q02m/notion)（作者 [@n24q02m](https://github.com/n24q02m)，现仓库更名为 `notion`）。致敬原作者在 Notion AST 高保真解析与复合工具架构上的奠基性探索！
- **独立维护的增强版**：本项目当前由 **[one2agi](https://one2agi.com)** 作为独立增强版持续演进。我们剥离了冗余边缘宿主负担，聚焦于更稳定纯粹的 Node.js/Docker 跨平台基座、中文与复合工作流增强，以及面向生产级自主 Agent 的长期交付。

- **官方网站**: [https://one2agi.com](https://one2agi.com)
- **AI 导航与知识库**: [https://way.one2agi.com](https://way.one2agi.com)
- **GitHub 组织**: [https://github.com/one2agi](https://github.com/one2agi)

---

## 许可证

本项目遵循 [MIT License](LICENSE) 开源协议。
