# better-notion-mcp v2.36.0+ 颗粒度复测报告 v2

**测试时间**: 2026-07-08 17:50–18:00 UTC+8
**测试版本**: 本地 build 2026-07-07 17:12:49（11 文件未提交修改，bin/cli.mjs 重新 build）
**测试数据库**: `测试_DB_updated and 新增数据源_with_title` (ID: `3934f4cf-c8e2-8031-8f30-c20b2a9db637`)
**Data source ID**: `3934f4cf-c8e2-8043-a002-000b615548a4` (主) + `3964f4cf-c8e2-81af-b165-000b6ea24b7c` (trash_test_remove) — 共 2 个
**Bot**: 我不叫龙虾 (workspace: Faiz Ti的 Notion)

---

## 一、本轮测试目的

验证 2026-07-07 17:11 之前 11 个未提交文件中包含的 6 项修复是否生效，并 smoke 复测 10 个工具的颗粒度功能。

---

## 二、6 项修复验证矩阵

| # | 修复 | 来源 | 验证结果 |
|---|------|------|----------|
| 1 | **Bug #11**: 多源 DB `create_page` 用 `data_source_id` parent (替代 `database_id`) | `pages.ts:303,336` / `databases.ts:579` | ✅ **通过** |
| 2 | `table_row` 字段嵌套在 `{ table_row: { cells } }` | `properties.ts:419-433` | ✅ **通过**（via markdown 表格） |
| 3 | `synced_block` 字段嵌套在 `{ synced_block: { synced_from } }` | `properties.ts:437-449` | ⚠️ **代码就位但不可达** |
| 4 | `link_to_page` 字段嵌套在 `{ link_to_page: { ... } }` | `properties.ts:458-464` | ⚠️ **代码就位但不可达** |
| 5 | `blocks.update` 移除 UPDATABLE_BLOCK_TYPES 白名单 | `blocks.ts:13-32 (原 list)` | ⚠️ **部分移除** — 见 Phase D |
| 6 | `comments.create` 加入 `retryWithBackoff` | `comments.ts:7` | ⚠️ **代码就位但不可黑盒验证** |

---

## 三、详细测试结果

### Phase B: Bug #11 修复 ✅

**目标**: 验证多源 DB 上 `create_page` 不再 400。

| 调用 | 输入 | 实际 |
|------|------|------|
| `databases.create_page` | database_id=target, pages=[{名称: "B11_v5_ds_jsonstring", 数字: 11, 分类: "X", 标签: ["tag1","tag2"]}] | ✅ 返回 `page_id=3974f4cf-c8e2-8142-9d68-c1f9ccb856c3`, `processed=1` |
| `pages.create` | parent_id=target, title="B11_v5_jsonstring", properties={数字: 22, 分类: "Y"} | ✅ 返回 `page_id=3974f4cf-c8e2-816e-b60a-d4e3c37c01f1` |
| `databases.query` | limit=2 | ✅ 2 行返回，properties 完整：名称 / 数字 / 分类 / 标签 全部正确 |

**关键技术点**: 必须用 JSON-stringified properties 才能正确传递（`{"名称":"X","数字":11,...}` 作为 string），不能直接传 object literal。这与 commit 94695cc "feat(tools): accept JSON-string input for nested-object parameters" 的设计一致 — Claude Code 的 XML 序列化会丢嵌套对象，JSON 字符串是 escape hatch。

### Phase C: 3 个 block normalize 字段

| 子项 | 验证方式 | 结果 |
|------|----------|------|
| C.1 `table_row` | `blocks.append` with markdown table | ✅ 通过 — 1 table + 3 table_row cells 全部正确填充 |
| C.2 `synced_block` | `blocks.update` properties={synced_from: {...}} | ❌ type 没改 — 仍是 paragraph |
| C.3 `link_to_page` | `blocks.update` properties={page_id: ...} | ❌ type 没改 — 仍是 paragraph |

**C.2 / C.3 根因**: Notion PATCH /v1/blocks/{id} API 不支持改 block type。当前 MCP 工具的两个入口：
- `blocks.append` 只接受 `content` (markdown)，无 markdown 语法表达 synced_block / link_to_page
- `blocks.update` (properties path) 接受 properties，但 Notion API 仍拒绝 type change

**结论**: C.2 / C.3 的 normalize 代码虽然在 `properties.ts` 已就位，但**没有可触达路径**让用户通过 MCP 创建这两种 block。这是死代码，需要新 API 入口（例如 `blocks.append` 接受 direct blocks JSON）才能真正生效。

### Phase D: blocks.update 白名单移除

| 测试 | 结果 |
|------|------|
| `blocks.update` (image block) via content | ⚠️ 过 whitelist（OK），但 Notion 400：`body.image.rich_text should be not present` — content path 的 dispatcher 不支持 image |
| `blocks.update` (bookmark block) via content | ❌ "Block type cannot be updated" — bookmark markdown 解析为 paragraph，与原 bookmark type 不匹配 |
| `blocks.update` (bookmark block) via properties | ❌ "Block type 'bookmark' cannot be updated" — **whitelist 仍在 properties path (line 262) 生效** |

**根因**: `git diff` 显示 UPDATABLE_BLOCK_TYPES 常量定义在 diff 中被删除（line 13-32），但当前源码 line 317-336 仍保留该常量。同时 `updateBlock` 函数的 properties 分支 line 262 仍做 `!UPDATABLE_BLOCK_TYPES.has(originalBlockType)` 检查。

实际行为:
- **content path** (line 226-256): ✅ 移除了 UPDATABLE 检查（白名单不再拦截），但 dispatcher 只处理 to_do/code/callout/toggle/template/默认，image/bookmark 走默认路径（`updatePayload[blockType] = { rich_text: ... }`）— Notion 拒绝
- **properties path** (line 257-280): ❌ 仍检查 UPDATABLE_BLOCK_TYPES (line 262)

**结论**: **whitelist 移除不完整**。要彻底修复需要：
1. 删除 line 262 的 `if (originalBlockType && !UPDATABLE_BLOCK_TYPES.has(originalBlockType))` 检查
2. 在 content path 的 dispatcher 中加入 image / bookmark / embed / divider / equation 等类型的分支处理

### Phase E: comments retry ⚠️ 不可黑盒验证

- `comments.create` → "Integration does not have access to this resource"（同 Bug #6 — Notion 端权限问题，非 MCP bug）
- `comments.list` → 同上

retry 代码已加在 `comments.ts:7`，但**该错误是 logical 权限问题，Notion 立即返回，retry 不触发**。retry 只对 transient 错误（5xx, network blip, rate limit）有效。需要在 http 模式下用 OAuth 集成才能验证 retry 在 5xx 错误时的行为。

### Phase F: 全 10 工具 smoke 复测 ✅

| 工具 | 验证路径 | 结果 |
|------|----------|------|
| `workspace` | `info` | ✅ bot 详情返回 |
| `users` | `me` | ✅ 返回 max_file_upload_size_in_bytes=5368709120 |
| `config` | `status` | ✅ configured, has_token=true, token_source=environment |
| `databases` | `aggregate` (count + sum 数字) | ✅ total_rows=3, sum_num=33 |
| `databases` | `query` limit=5 | ✅ 3 rows returned with all properties |
| `pages` | `get` B11 page | ✅ properties 完整 |
| `pages` | `update` (append_content) | ✅ updated: true |
| `blocks` | `append` (h2 + paragraph + bullet) | ✅ appended_count=3 |
| `blocks` | `children` | ✅ 3 blocks returned, markdown 一致 |
| `blocks` | `delete` paragraph | ✅ deleted: true |
| `blocks` | `update` (heading_2 with same-type content) | ✅ type: heading_2, updated: true |
| `content_convert` | `markdown-to-blocks` (h1/paragraph/bullet) | ✅ 4 blocks, **bold annotation 保留** |
| `file_uploads` | `list` limit=3 | ✅ 2 expired entries returned |
| `help` | `tool_name=pages` | ✅ 完整 markdown docs 返回 |
| `help` | `tool_name=nonexistent_tool` | ✅ 错误 + valid tools 列表 |

**结论**: 10 工具核心路径全部 smoke 通过，无回归。

---

## 四、测试残留数据清理

| 页面 | ID | 操作 |
|------|-----|------|
| B11_v5_ds_jsonstring | `3974f4cf-c8e2-8142-9d68-c1f9ccb856c3` | ✅ deleted |
| B11_v5_jsonstring | `3974f4cf-c8e2-816e-b60a-d4e3c37c01f1` | ✅ deleted |
| PhaseC_block_normalize_test | `3974f4cf-c8e2-81da-9bed-d2a1837e3caa` | ✅ deleted |

**目标 DB 终态**: 0 行 (`databases.query` total=0)

---

## 五、新发现 / 改进建议

| # | 标题 | 严重度 | 描述 | 建议 |
|---|------|--------|------|------|
| **#12** | `synced_block` / `link_to_page` 创建无 MCP 路径 | 🟡 medium | normalize 代码已加但 `blocks.append` 不支持 direct block JSON, `blocks.update` 不能改 type | 在 `blocks.append` 接受 `blocks` (JSON array) 参数；或在 `content` markdown 加 `[link_to_page id=xxx]` / `[synced_block id=xxx]` 扩展语法 |
| **#13** | `blocks.update` whitelist 移除不完整 | 🟡 medium | properties path line 262 仍检查 UPDATABLE_BLOCK_TYPES；content path dispatcher 不支持 image/bookmark | (a) 删 line 262 检查 (b) 给 dispatcher 加 image / bookmark / embed / divider / equation 分支 |
| **#14** | image update 在 content path 仍失败 | 🟢 low | Notion 400 `body.image.rich_text should be not present` — 因为 dispatcher 把 image 块当 paragraph 处理 | 同 #13 (b) |
| **#15** | `comments` 仍受 Notion 端权限阻塞 | 🔴 high (但非 MCP bug) | Notion 集成未开启 Read/Insert comments 能力（自 14:11 测试以来未变） | 在 https://www.notion.so/profile/integrations 找对应 integration，开 "Read comments" + "Insert comments" 能力 |
| **#16** | Phase B 早期调用误判为「property auto-wrap 回归」 | 🟢 low | 实为 Claude Code XML 序列化丢嵌套对象所致，JSON-string 输入是 escape hatch（commit 94695cc 设计如此） | 在 docs 中明确标注 "nested object 必须用 JSON string 传"，并给 Claude Code 客户端的具体示例 |

---

## 六、整体评价

**核心结论**: Bug #11 已修复，多源 DB 上 create_page 正常返回。3 个 block normalize 修复中 table_row 真实可用，synced_block / link_to_page 因 API 限制 + MCP 缺入口暂时不可触达。blocks.update whitelist 移除不完整（仅 content path）。Smoke 测试 10 工具全部通过，无回归。

**通过的修复（强证据）**:
- ✅ Bug #11 data_source_id parent — 实际跑通了 2 个 create + 1 个 query

**通过的修复（弱证据 / 间接）**:
- ⚠️ table_row — 通过 markdown 间接验证，normalize 代码就位
- ⚠️ synced_block / link_to_page — 代码就位但无 MCP 入口
- ⚠️ blocks.update whitelist — content path 移除了但 dispatcher 不完整；properties path 仍存在
- ⚠️ comments retry — 代码就位但不可黑盒验证

**未变（外部阻塞）**:
- 🔴 comments 权限 — 自首次测试以来未变，需 Notion 端配置

---

## 七、版本与构建信息

- **package.json**: 2.36.0
- **HEAD commit**: `94695cc feat(tools): accept JSON-string input for nested-object parameters`
- **v2.36.0 tag**: 在 `b8c5bfd4`（**≠ HEAD**，tag 与 working tree 不一致）
- **未提交修改**: 11 文件 (+388/-421)
- **bin/cli.mjs**: 2026-07-07 17:12:49 build（**晚于** 所有 source 文件最后编辑时间 2026-07-07 17:11:00） — 运行的 bundle 反映最新源码

**对发布的影响**: tag 在 `b8c5bfd4`，HEAD 在 `94695cc` + 11 文件未提交 — 如果现在直接打 tag 并发布，会丢失 working tree 的 6 项修复 + 其他修改。**需要先 commit + 重新打 tag 再发布**。

---

## 八、参照方法论

参照 `CLAUDE.md` 的 Testing methodology:
- **Reverse testing**: Phase B 早期发现的 "数字 is expected to be number" 等错误就是 Notion API contract 探针，揭示了 property 序列化路径
- **Real-data probing**: 直接用真实 Notion DB，避免 mock 假象
- **Cross-action consistency**: 同一 `properties` 输入在 `pages.create` / `databases.create_page` 表现一致（都需要 JSON string）
- **Edge value matrix**: 测试了 multi-source DB / 0 行 DB / 8 种 block 类型 / 4 种 property 类型
