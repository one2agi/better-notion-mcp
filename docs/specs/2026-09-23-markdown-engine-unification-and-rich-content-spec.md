# Better Notion MCP: Markdown 引擎统一与富文本高保真重构规范 (Spec)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底消除 Better Notion MCP 现存的“解析引擎分裂、静默降级、工具契约断层、双向转换不对称、Alert 强制彩色背景、HTML 标签泄漏”六大核心缺陷。重构写入链路，全量收敛至客户端高保真 AST 引擎；Callout 默认回归素雅极简风格并原生支持 `<callout>` 标签；抹平官方服务端 `<unknown>` 泄漏，实现“读 ➔ 改 ➔ 写”100% 无损闭环。

**Architecture:** 
1. **写入内核归一**：彻底废弃 Notion 官方有损的 `updateMarkdown` 写入链路。页面的全量新建（`create`）、全量覆写（`replace_content`）、局部更新（`update`）与块追加（`append`）在底层统一走 MCP 客户端自研的 `markdownToBlocks` AST 引擎，通过批量 Block API 原生交付。
2. **样式素雅重塑**：重构 `CALLOUT_COLORS` 映射字典，默认背景色全面重置为 `default`（素雅纯白/透明边框卡片）。支持尾随属性扩展（`> [!NOTE]{color="blue"}`），并将 `<callout>` HTML 容器标签纳为一等公民原生解析，彻底杜绝源码泄漏为普通段落。
3. **双向无损往返**：在读取端（`pages.get` 与 `pages.get_markdown`）平滑消解官方服务端吐出的 `<unknown url="..." alt="bookmark"/>`，对齐还原为标准 `[bookmark](url)`，彻底解决语法泄漏。
4. **契约真诚一致**：重写 Tool Schema 与文档，向 AI 暴露真实可靠的富文本全量支持契约。

**Tech Stack:** TypeScript (strict mode, ESM), `@notionhq/client` v5.22.0+, Vitest, Biome, Bun runtime.

**Spec Reference:** Notion Official Enhanced Markdown Guide (`https://developers.notion.com/guides/data-apis/enhanced-markdown.md`), Notion Page Content Guide (`https://developers.notion.com/guides/data-apis/working-with-markdown-content.md`).

---

## 1. 业务目标与产品价值（面向产品经理视角）

### 1.1 业务背景与用户痛点

在基于 Notion 的 AI Agent 应用、自动化知识库同步与内容排版场景中，Markdown 是 AI 与系统交互的第一契约（Markdown-First）。然而目前系统存在六大影响用户体验与交付质量的致命隐患：

```
当前破碎链路 (Current Broken Pipeline):
输入 Markdown (含书签/折叠) 
   │
   ├──► 调用 pages: replace_content ──► Notion 官方 updateMarkdown (CommonMark 只认基础纯文本)
   │                                        │
   │                                        ▼
   │                                ❌ 静默丢弃书签，折叠标题残存 "##"，零告警返回 replaced: true
   │
   └──► 调用 pages: get_markdown ────► Notion 官方 retrieveMarkdown
                                            │
                                            ▼
                                    ❌ 书签导出为 <unknown url="..." alt="bookmark"/> 垃圾占位符
                                       (无法拿该 Markdown 再次写回，读改写链路彻底断裂)
```

1. **解析引擎分裂与功能不可预期**：
   - 同样的 Markdown，调用 `blocks.append` 生成原生漂亮书签与大折叠标题；调用 `pages.replace_content` 却瞬间降级成残缺文字。用户与 AI 无法预知哪次调用会翻车。
2. **静默降级导致半成品发布**：
   - 当格式丢失时，接口既不报错也不抛警告，直接返回成功，给 AI 带来虚假安全感，导致发布排版受损的半成品页面。
3. **GitHub Alert 强制高饱和刺眼底色**：
   - 现存逻辑强制为 `> [!NOTE]` 绑定 `blue_background`，无法做到素雅纯净卡片，逼迫追求高级感的用户退回普通引用块。
4. **HTML 标签解析无防呆**：
   - 用户尝试书写 `<callout color="default">` 时，标签源码原封不动暴露在页面上，严重破坏页面美感。
5. **双向转换不对称**：
   - 读出 `<unknown url="..." alt="bookmark"/>`，写回变成普通超链接，运营无法完成“先读取 ➔ 本地微调 ➔ 再无损写回”的基础闭环。

### 1.2 产品核心价值与交付目标

```
重构后统一闭环链路 (Unified High-Fidelity Pipeline):
输入 Markdown (GFM 习惯 / 官方增强语法)
   │
   ▼
[统一客户端 AST 引擎 (markdownToBlocks)]
   │
   ├── 100% 保真解析：[bookmark] -> 原生 Bookmark 块
   ├── 100% 保真解析：<details><summary>## -> 原生 Heading Toggle 块
   ├── 100% 保真解析：<callout> 与 > [!NOTE] -> 默认素雅 default 边框卡片
   │
   ▼
[Notion 原生 Block 树批量原子交付]
   │
   ▼
✅ 页面排版 100% 真实还原，零降级，零语法泄漏，往返完全对称！
```

* **核心目标 1（零静默降级）**：全量覆写（`replace_content`）与页面更新（`update`）对书签、各级折叠大标题、代码高亮、表格、公式 100% 保真还原。
* **核心目标 2（默认素雅高级）**：所有 Callout 默认无刺眼高饱和底色（使用透明底/轻边框 `default`），支持显式设置自定义颜色，支持原生 `<callout>` 标签。
* **核心目标 3（读改写无损闭环）**：无论是通过 `pages: get` 还是 `pages: get_markdown` 读取的页面，导出 Markdown 统一为标准格式，原样写回零损耗。
* **核心目标 4（契约诚信度）**：Tool Schema 准确传达能力边界，彻底消除信息断层。

---

## 2. 交互契约与语法规范

### 2.1 Callout 排版规范（素雅第一，灵活调色）

#### 规范 1：GFM Alert 默认素雅化
* **输入**：
  ```markdown
  > [!NOTE]
  > 这是一个默认提示框
  ```
* **渲染结果**：Notion 原生 Callout 块，图标 `ℹ️`，**`color: "default"`（素雅无色背景/透明底边框）**。
* **注意**：原有的硬编码 `blue_background` / `green_background` 等高饱和底色彻底废除。

#### 规范 2：GFM Alert 显式调色扩展
* **输入**：
  ```markdown
  > [!TIP]{color="green_background" icon="💡"}
  > 显式指定彩色底色与图标
  ```
* **渲染结果**：Notion 原生 Callout 块，图标 `💡`，`color: "green_background"`。

#### 规范 3：原生 HTML `<callout>` 标签一等公民支持
* **输入**：
  ```markdown
  <callout color="default" icon="💡">
  精细化控制素雅卡片内容
  - 允许包含列表
  - 允许富文本
  </callout>
  ```
* **渲染结果**：Notion 原生 Callout 块，颜色 `default`，图标 `💡`，内部正常解析列表或段落。
* **绝不在正文泄露 `<callout>` 或 `</callout>` 源码**。

---

### 2.2 书签与折叠标题规范

#### 规范 1：真实网络书签卡片
* **输入**：
  ```markdown
  [bookmark](https://github.com/octocat "GitHub 官方")
  [书签](https://github.com/octocat)
  ```
* **渲染结果**：Notion 原生 `bookmark` 块（具有卡片预览、favicon 与标题），`url: "https://github.com/octocat"`，caption: `"GitHub 官方"`。

#### 规范 2：折叠大标题（Heading Toggle）
* **输入形式 A (HTML 习惯)**：
  ```markdown
  <details>
  <summary>## 核心架构设计</summary>
  折叠正文内容
  </details>
  ```
* **输入形式 B (Notion 官方 Enhanced Markdown 习惯)**：
  ```markdown
  ## 核心架构设计 {toggle="true"}
  	折叠正文内容
  ```
* **渲染结果**：Notion 原生 `heading_2` 块，**`is_toggleable: true`**，且标题纯文本为 `"核心架构设计"`（**绝对不残存 `"## "` 源码字符**）。

---

### 2.3 双向读取对称规范（Round-trip Symmetry）

当页面中已存在原生 Bookmark 块时：
* 调用 `pages: get` 导出：`[bookmark](url "caption")`
* 调用 `pages: get_markdown` 导出：服务端原本吐出 `<unknown url="https://app.notion.com/p/...#..." alt="bookmark"/>`，**客户端在返回前拦截并自动转译为 `[bookmark](url)`**。
* **验收标准**：读取到的 Markdown，直接作为 `pages: replace_content` 的 `new_str` 写回，页面结构 100% 维持不变。

---

## 3. 架构设计与实现方案

### 3.1 模块职责与变更范围

```
better-notion-mcp/src/
├── tools/
│   ├── helpers/
│   │   ├── markdown.ts          # [MODIFY] AST 核心：重置 CALLOUT 默认色、增加 <callout> 标签解析、支持 {toggle="true"}、抹平 <unknown alt="bookmark"/>
│   │   ├── page-content.ts      # [MODIFY] 重构 replacePageContent：废弃 updateMarkdown 写入，改为清空旧块 + 客户端 AST 批量写入；读取端拦截 unknown 占位符
│   │   └── page-content.test.ts # [MODIFY] 覆盖 replacePageContent 与 getPageMarkdown 的反向测试
│   ├── composite/
│   │   ├── pages.ts             # [MODIFY] 重构 updatePage 的 content 写入分支，废弃 updateMarkdown，统一走客户端 AST 管道
│   │   └── pages.test.ts        # [MODIFY] 验证 pages.replace_content 与 pages.update 真实 Block 树产物
│   └── tool-definitions.ts      # [MODIFY] 更新 pages 与 content_convert 工具描述，消除虚假承诺与信息断层
```

### 3.2 详细设计

#### 1. Markdown AST 解析器重构 (`markdown.ts`)
* **Callout 默认颜色**：
  ```typescript
  // 将所有 Alert 类型的默认背景色全面收敛为 'default'
  export const CALLOUT_COLORS: Record<string, string> = {
    NOTE: 'default',
    TIP: 'default',
    IMPORTANT: 'default',
    WARNING: 'default',
    CAUTION: 'default',
    INFO: 'default',
    SUCCESS: 'default',
    ERROR: 'default',
    DANGER: 'default'
  }
  ```
* **`<callout>` HTML 标签原生解析**：
  * 正则匹配：`/<callout(?:\s+icon="([^"]*)")?(?:\s+color="([^"]*)")?[^>]*>([\s\S]*?)<\/callout>/i`
  * 提取 `icon`、`color`（默认 `'default'`）及内部正文，生成标准 Notion Callout 块结构。
* **`<unknown alt="bookmark"/>` 净化还原**：
  * 在 `sanitizeNotionMarkdown` 中，将 `<unknown\s+url="([^"]*)"\s+alt="bookmark"\s*\/>` 自动还原为 `[bookmark]($1)`，防止语法泄漏。

#### 2. 页面覆写与内容更新彻底收敛 (`page-content.ts` & `pages.ts`)
* **废弃 `updateMarkdown` 写入**：
  * 官方的 `(notion.pages as unknown as PageMarkdownAPI).updateMarkdown` 由于无法支持书签且破坏折叠，**在 `replacePageContent` 和 `updatePage` 中彻底退役**。
* **高保真覆写逻辑 (`replacePageContent`)**：
  1. **清空旧内容**：分页获取页面当前所有一级子块（`notion.blocks.children.list`），通过并发 `notion.blocks.delete` 清空原有旧块；
  2. **解析新内容**：调用 `markdownToBlocks(newStr)`，生成包含完整原生 Block 结构的 AST 树；
  3. **分批原子追加**：通过 `processBatches`（按 Notion 限制每批最大 100 块）调用 `notion.blocks.children.append` 批量写入；
  4. **返回保真结果**：返回 `{ action: 'replace_content', page_id, replaced: true, block_count }`。
* **局部更新与追加 (`updatePage`)**：
  * 当 `replace: true` 时，调用上述高保真覆写逻辑；
  * 当 `replace: false` 或传入 `append_content` 时，调用 `markdownToBlocks` 解析并 `notion.blocks.children.append` 追加，绝不调用 `updateMarkdown`。

---

## 4. 边界矩阵与反向测试防御（Reverse Test Defense）

必须在实施业务代码前，在单测中锁定以下边界防线：

| 场景编号 | 输入特征 | 预期行为（断言标准） | 防御目标 |
| :--- | :--- | :--- | :--- |
| **RT-01** | `> [!NOTE]\n> 素雅正文` | 产出 `type: "callout"`, `color: "default"`, `emoji: "ℹ️"` | 杜绝强制高饱和蓝底 |
| **RT-02** | `> [!NOTE]{color="blue_background"}\n> 彩色正文` | 产出 `type: "callout"`, `color: "blue_background"` | 允许显式自定义色彩 |
| **RT-03** | `<callout color="default" icon="💡">\n正文\n</callout>` | 产出 `type: "callout"`, `color: "default"`, `emoji: "💡"` | 彻底消灭 HTML 源码泄漏成段落 |
| **RT-04** | `pages.replace_content` 写入 `[bookmark](url)` | 调阅页面块，必须包含 `type: "bookmark"`, `bookmark.url === url` | 杜绝书签降级为普通文字段落 |
| **RT-05** | `pages.replace_content` 写入 `<details><summary>## 标题</summary>内容</details>` | 调阅页面块，必须为 `type: "heading_2"`, `is_toggleable === true`, 标题内无 `##` | 杜绝大折叠破坏与源码残留 |
| **RT-06** | `pages.get_markdown` 读取含书签页面 | 返回 Markdown 必须包含 `[bookmark](url)`，严禁出现 `<unknown` | 杜绝官方占位符语法泄漏 |
| **RT-07** | 空内容覆写 `new_str: ""` | 页面所有子块被清空，`block_count === 0` | 正常清空能力保持可用 |
| **RT-08** | 超长页面覆写 (>100 个 block) | 自动分批（100 块/批）写入成功，无 Notion API 批量上限报错 | 稳定性与批次防御 |

---

## 5. 逐步实施与验证计划

### 阶段一：编写反向测试矩阵 (TDD)
- [ ] 任务 1.1：在 `src/tools/helpers/markdown.test.ts` 中编写 Callout 素雅默认值测试、尾随属性测试及 `<callout>` 标签解析测试（RT-01, RT-02, RT-03）。
- [ ] 任务 1.2：在 `src/tools/helpers/page-content.test.ts` 和 `src/tools/composite/pages.test.ts` 中编写 `replacePageContent` 与 `updatePage` 的富文本保真测试（RT-04, RT-05, RT-06）。
- [ ] 运行 `bun x vitest` 确保上述新增测试准确变红（Red）。

### 阶段二：重构 AST 引擎 (`markdown.ts`)
- [ ] 任务 2.1：更新 `CALLOUT_COLORS`，将默认色重置为 `'default'`。
- [ ] 任务 2.2：在 `parseBlock` 中实现 `<callout>` 原生标签解析与尾随属性提取。
- [ ] 任务 2.3：在 `sanitizeNotionMarkdown` 中增加对 `<unknown alt="bookmark"/>` 自动映射为 `[bookmark](url)`。
- [ ] 运行单测确保阶段一的 AST 相关测试全部变绿（Green）。

### 阶段三：重构写入链路 (`page-content.ts` & `pages.ts`)
- [ ] 任务 3.1：重写 `replacePageContent`，实现“清空已有块 + 客户端 AST 批量写入”，废弃对 `updateMarkdown` 的调用。
- [ ] 任务 3.2：重写 `updatePage` 中的内容处理逻辑，全面接入客户端 AST 管道。
- [ ] 运行单测确保所有 `pages` 写入测试变绿（Green）。

### 阶段四：重塑工具描述契约 (`tool-definitions.ts`)
- [ ] 任务 4.1：更新 `pages.json` / `tool-definitions.ts`，如实说明富文本全量保真、默认素雅排版契约。
- [ ] 运行 `bun run check` 确保类型检查与代码格式规范 100% 达标。

### 阶段五：真实环境端到端验证与编译发布
- [ ] 任务 5.1：在测试页 `https://app.notion.com/p/one2agi/666-3e44f4cfc8e280708369fdc15ed057a8` 上调用 `pages: replace_content` 写入包含真实书签、折叠大标题、素雅 Callout 的复合内容，实测验收页面渲染保真度。
- [ ] 任务 5.2：调用 `pages: get_markdown` 读取该测试页，验证无 `<unknown>` 泄漏，且可无损原样回写。
- [ ] 任务 5.3：执行 `bash /mnt/d/project/notion-mcp/rebuild-mcp.sh` 完成本地编译同步与热重启。
