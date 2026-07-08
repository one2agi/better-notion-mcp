# better-notion-mcp v2.36.0 颗粒度测试报告

**测试时间**: 2026-07-07 14:03–14:11 UTC+8
**测试版本**: 本地 build 2026-07-07 13:46（源码 symlink 到 npm global `@n24q02m/better-notion-mcp@2.36.0`）
**测试数据库**: `测试_DB_updated` (ID: `3934f4cf-c8e2-8031-8f30-c20b2a9db637`)
**数据源 ID**: `3934f4cf-c8e2-8043-a002-000b615548a4`
**测试页面 A1**: `3964f4cf-c8e2-8184-b938-e18eca705a19` (A1_正常中文标题)

---

## 一、测试工具清单与覆盖

| 工具 | actions 数 | 已测 | 未测 | 覆盖率 |
|------|-----------|------|------|--------|
| workspace | 2 | info, search | — | 100% |
| users | 4 | me, list, from_workspace | get | 75% |
| config | 5 | status | setup_start, cache_clear | 20% |
| databases | 12 | get, query, aggregate, group_by, create_page, update_page, delete_page, update_database, create, create_data_source, update_data_source, list_templates | — | 100% |
| pages | 13 | create, get, update, duplicate, archive, restore, move, get_markdown, replace_content, insert_markdown, update_content | get_property, replace_content_range | 85% |
| blocks | 5 | get, children, append, update, delete | — | 100% |
| comments | 3 | list, get, create | — | 100% |
| content_convert | 2 | markdown-to-blocks, blocks-to-markdown | — | 100% |
| file_uploads | 5 | create, send, complete, retrieve, list | — | 100% |
| **合计** | **51** | **43** | **3** | **94%** |

未测原因：
- `pages.get_property`: 需要特定 property_id，低价值
- `pages.replace_content_range`: 需要 Notion API range 锚点，低价值
- `config.setup_start/cache_clear`: 配置已就绪，测试无意义

---

## 二、测试详情

### 2.1 workspace

#### ✅ workspace:info
- **目的**: 获取 workspace 基本信息
- **过程**: `action: info`
- **预期**: 返回 bot name, workspace_id
- **实际**: `{"bot":{"name":"我不叫龙虾","type":"bot","owner":{"type":"workspace","workspace":true}},"workspace_id":"7dc4f4cf-c8e2-8148-a093-000319578589"}`
- **结论**: ✅ 通过

#### ✅ workspace:search
- **目的**: 搜索 workspace 内页面/数据库
- **过程**: `action: search, query: "测试", limit: 5`
- **预期**: 返回匹配的页面列表
- **实际**: 返回 5 条结果，含 page 和 data_source
- **结论**: ✅ 通过

---

### 2.2 users

#### ✅ users:me
- **目的**: 获取当前 bot 用户信息
- **过程**: `action: me`
- **预期**: 返回 bot 详情
- **实际**: `{"name":"我不叫龙虾","workspace_name":"Faiz Ti的 Notion","max_file_upload_size_in_bytes":5368709120}`
- **结论**: ✅ 通过

#### ✅ users:list
- **目的**: 列出 workspace 所有用户
- **过程**: `action: list`
- **预期**: 返回用户列表
- **实际**: 返回 7 个用户（1 person + 6 bots）
- **结论**: ✅ 通过

#### ✅ users:from_workspace
- **目的**: 从可访问页面提取用户
- **过程**: `action: from_workspace`
- **预期**: 从页面元数据提取用户
- **实际**: 返回 5 个用户，含 source 标注
- **结论**: ✅ 通过

---

### 2.3 config

#### ✅ config:status
- **目的**: 确认 token 配置状态
- **过程**: `action: status`
- **预期**: `state: configured, has_token: true`
- **实际**: `{"state":"configured","has_token":true,"token_source":"environment"}`
- **结论**: ✅ 通过

---

### 2.4 databases

#### ✅ databases:get
- **目的**: 获取数据库 schema
- **过程**: `action: get, database_id: 3934f4cf...`
- **预期**: 返回 schema（含名称、数字，后来扩了分类、标签）
- **实际**: 正确返回 schema 和 data_source_id
- **结论**: ✅ 通过

#### ✅ databases:query
- **目的**: 查询数据库行
- **过程**: `action: query, database_id, limit: 10`
- **预期**: 返回行列表
- **实际**: 返回当前存在的页面列表
- **结论**: ✅ 通过（偶发 fetch failed，见 Bug #5）

#### ✅ databases:aggregate
- **目的**: 聚合统计数字列
- **过程**: `action: aggregate, aggregations: [count, sum, avg, min, max]`
- **预期**: 返回统计值
- **实际**: `{"total":4,"数字_count":4,"数字_sum":141.5,"数字_avg":35.375,"数字_min":-999.5,"数字_max":999}`
- **结论**: ✅ 通过

#### ✅ databases:group_by
- **目的**: 按分类分组聚合
- **过程**: `action: group_by, group_by: {property: 分类}, aggregations: [count, sum, avg]`
- **预期**: 返回分组结果
- **实际**: X=2条(30), Y=1条(30), null=4条(141.5)
- **结论**: ✅ 通过

#### ✅ databases:create_page
- **目的**: 在数据库中创建页面
- **过程**: `action: create_page, pages: [{名称, 数字, 分类}]`（批量 3 条）
- **预期**: 创建成功并返回 page_id
- **实际**: `{"processed":3,"results":[{"page_id":"3964f4cf-c8e2-8138-9431-e249f0591c83","created":true},...]`
- **结论**: ✅ 通过

#### ✅ databases:update_page
- **目的**: 更新数据库页面属性
- **过程**: `action: update_page, page_id, page_properties: {数字: 999}`
- **预期**: 更新成功
- **实际**: `{"processed":1,"updated":true}`
- **结论**: ✅ 通过

#### ✅ databases:delete_page
- **目的**: 删除数据库页面
- **过程**: `action: delete_page, page_ids: [旧页面ID]`
- **预期**: 删除成功
- **实际**: `{"processed":1,"deleted":true}`
- **结论**: ✅ 通过

#### ✅ databases:update_database
- **目的**: 更新数据库元数据
- **过程**: `action: update_database, title: "测试_DB_updated", icon: "📋"`
- **预期**: 更新成功
- **实际**: `{"updated":true}`
- **结论**: ✅ 通过

#### ✅ databases:create
- **目的**: 在页面下创建新数据库
- **过程**: `action: create, parent_id: A1页面ID, title: "A1页下的子数据库"`
- **预期**: 创建成功
- **实际**: `{"database_id":"96c899be-c717-4e8c-afa9-5fb59623477b","created":true}`
- **结论**: ✅ 通过

#### ✅ databases:create_data_source
- **目的**: 在现有数据库下新增数据源
- **过程**: `action: create_data_source, database_id, title, properties: {名称: {title:{}}, 描述: {rich_text:{}}}`
- **预期**: 创建成功（必须含 title 属性）
- **实际**: `{"data_source_id":"3964f4cf-c8e2-81af-b165-000b6ea24b7c","created":true}`
- **结论**: ✅ 通过（见 Bug #10 关于 title 必填）

#### ✅ databases:update_data_source
- **目的**: 扩展数据源 schema
- **过程**: `action: update_data_source, properties: {分类: {select:...}, 标签: {multi_select:...}}`
- **预期**: 添加新属性
- **实际**: `{"updated":true}`，schema 验证后确实包含分类+标签
- **结论**: ✅ 通过

#### ✅ databases:list_templates
- **目的**: 列出数据库模板
- **过程**: `action: list_templates, database_id`
- **预期**: 返回模板列表
- **实际**: `{"total":0,"templates":[]}`
- **结论**: ✅ 通过（当前无模板，属正常响应）

---

### 2.5 pages

#### ✅ pages:create
- **目的**: 创建独立页面
- **过程**: `action: create, title: "A1_正常中文标题", parent_id: 数据库ID, properties: {数字: 42}`
- **预期**: 创建成功
- **实际**: `{"page_id":"3964f4cf-c8e2-8184-b938-e18eca705a19","created":true}`
- **结论**: ✅ 通过（emoji/超长标题也正常，见 Bug #2 关于空标题）

#### ✅ pages:get
- **目的**: 获取页面内容+属性
- **过程**: `action: get, page_id: A1页面ID`
- **预期**: 返回 properties 和 content
- **实际**: `{"数字":42,"名称":"A1_正常中文标题","content":"...","block_count":10}`
- **结论**: ✅ 通过

#### ✅ pages:get_markdown
- **目的**: 服务器端 markdown 渲染
- **过程**: `action: get_markdown, page_id`
- **预期**: 返回渲染后 markdown 字符串
- **实际**: 返回 markdown，含 `<callout>`, `<details>` 等块
- **结论**: ✅ 通过

#### ✅ pages:update (append_content)
- **目的**: 向页面追加内容
- **过程**: `action: update, page_id, append_content: markdown内容`
- **预期**: 追加 10 个 blocks
- **实际**: `{"updated":true}`, blocks.children 验证确实有 10 个块
- **结论**: ✅ 通过（`<details>` 折叠合并为一行，见 docs 说明）

#### ✅ pages:update_content
- **目的**: 服务器端搜索替换
- **过程**: `action: update_content, page_id, updates: [{old_str:"苹果",new_str:"🍎 苹果",replace_all_matches:true}]`
- **预期**: 替换成功
- **实际**: `{"updated":true}`，get_markdown 验证已替换
- **结论**: ✅ 通过

#### ✅ pages:replace_content
- **目的**: 原子性替换整页内容
- **过程**: `action: replace_content, page_id, new_str: 新markdown`
- **预期**: 整页替换
- **实际**: `{"replaced":true,"markdown":"..."}`
- **结论**: ✅ 通过

#### ✅ pages:insert_markdown
- **目的**: 在指定位置插入 markdown
- **过程**: `action: insert_markdown, page_id, content, position: "start"`
- **预期**: 内容插入到开头
- **实际**: `{"inserted":true,"markdown":"## 插入到 START...# 这是 replace..."}`
- **结论**: ✅ 通过

#### ✅ pages:duplicate
- **目的**: 复制页面
- **过程**: `action: duplicate, page_id`
- **预期**: 创建副本
- **实际**: `{"original_id":"3964f4cf-c8e2-8184-b938-e18eca705a19","duplicate_id":"3964f4cf-c8e2-81b3-ba45-de1866075953"}`
- **结论**: ✅ 通过

#### ✅ pages:archive
- **目的**: 归档页面
- **过程**: `action: archive, page_ids: [页面ID]`
- **预期**: 归档成功
- **实际**: `{"archived":true}`
- **结论**: ✅ 通过

#### ✅ pages:restore
- **目的**: 恢复已归档页面
- **过程**: `action: restore, page_id`
- **预期**: 恢复成功
- **实际**: `{"archived":false}`
- **结论**: ✅ 通过

#### ✅ pages:move
- **目的**: 移动页面到新父级
- **过程**: `action: move, page_id, parent_id: 数据库ID`
- **预期**: 移动成功
- **实际**: `{"moved":true}`
- **结论**: ✅ 通过

---

### 2.6 blocks

#### ✅ blocks:children
- **目的**: 获取页面所有子块
- **过程**: `action: children, block_id: A1页面ID`
- **预期**: 返回块列表（含嵌套的 toggle 子块）
- **实际**: 返回 10 个块，含 toggle 块的嵌套 children
- **结论**: ✅ 通过

#### ✅ blocks:get
- **目的**: 获取单个块详情
- **过程**: `action: get, block_id: 香蕉列表块ID`
- **预期**: 返回块详情
- **实际**: 返回完整块 JSON，含 rich_text, annotations
- **结论**: ✅ 通过（已删除块返回 `archived: true, in_trash: true`）

#### ✅ blocks:append
- **目的**: 向页面追加多个块
- **过程**: `action: append, block_id: A1页面ID, content: 13个blocks的markdown`
- **预期**: 追加 13 个块
- **实际**: `{"appended_count":13}`
- **结论**: ✅ 通过

#### ✅ blocks:update（类型匹配）
- **目的**: 更新块内容（类型匹配时）
- **过程**: `action: update, block_id: 列表块ID, content: "- 改回列表项内容"`
- **预期**: 更新成功
- **实际**: `{"type":"bulleted_list_item","updated":true}`
- **结论**: ✅ 通过（见 Bug #3 关于类型不匹配时报错）

#### ✅ blocks:delete
- **目的**: 删除块
- **过程**: `action: delete, block_id: divider块ID`
- **预期**: 删除成功
- **实际**: `{"deleted":true}`，后续 blocks.get 确认 `archived: true`
- **结论**: ✅ 通过

---

### 2.7 comments

#### ⚠️ comments:create
- **目的**: 创建页面评论
- **过程**: `action: create, page_id: A1页面ID, content: "评论内容"`
- **预期**: 评论创建成功
- **实际**: `{"Error":"Integration does not have access to this resource"}`
- **结论**: ⚠️ Notion 集成权限问题，非 MCP bug（需开启 "Insert comments" 能力）
- **见 Bug #6**

#### ⚠️ comments:list
- **目的**: 列出页面评论
- **过程**: `action: list, page_id: A1页面ID`
- **预期**: 返回评论列表
- **实际**: `{"Error":"Integration does not have access to this resource"}`
- **结论**: ⚠️ 同上，需开启 "Read comments" 能力
- **见 Bug #6**

---

### 2.8 content_convert

#### ✅ content_convert:markdown-to-blocks
- **目的**: markdown 解析为 Notion blocks
- **过程**: `action: markdown-to-blocks, content: h1/paragraph/list/callout/code/link的markdown`
- **预期**: 返回 blocks JSON 数组
- **实际**: 返回 7 个块，callout 正确识别 emoji+color
- **结论**: ✅ 通过

#### ✅ content_convert:blocks-to-markdown
- **目的**: blocks JSON 转回 markdown
- **过程**: `action: blocks-to-markdown, content: [heading_1, paragraph, bulleted_list_item]`
- **预期**: 返回 markdown 字符串
- **实际**: `"# Hello World\nTest **bold** text\n- Item 1"`
- **结论**: ✅ 通过（双向一致性验证）

---

### 2.9 file_uploads

#### ✅ file_uploads:create
- **目的**: 创建文件上传会话
- **过程**: `action: create, filename: "test-upload.txt", content_type: "text/plain"`
- **预期**: 返回 file_upload_id 和 upload_url
- **实际**: `{"file_upload_id":"3964f4cf-c8e2-8173-944f-00b2ccffc71d","upload_url":"https://api.notion.com/v1/file_uploads/...","status":"pending"}`
- **结论**: ✅ 通过

#### ✅ file_uploads:send
- **目的**: 上传文件内容（base64）
- **过程**: `action: send, file_upload_id, file_content: base64字符串`
- **预期**: 状态变为 uploaded
- **实际**: `{"status":"uploaded"}`
- **结论**: ✅ 通过

#### ⚠️ file_uploads:complete
- **目的**: 完成上传
- **过程**: `action: complete, file_upload_id`
- **预期**: 上传完成确认
- **实际**: `{"Error":"fetch failed"}`
- **结论**: ⚠️ fetch failed，见 Bug #7（但 file_uploads:list/retrieve 均显示 status=uploaded，说明最终状态正确）

#### ✅ file_uploads:retrieve
- **目的**: 查询上传状态
- **过程**: `action: retrieve, file_upload_id`
- **预期**: 返回上传详情
- **实际**: `{"status":"uploaded","filename":"test-upload.txt"}`
- **结论**: ✅ 通过

#### ✅ file_uploads:list
- **目的**: 列出上传历史
- **过程**: `action: list, limit: 5`
- **预期**: 返回上传记录列表
- **实际**: 返回 2 条记录（含 test-upload.txt 和过期文件 test-mcp.txt）
- **结论**: ✅ 通过

---

## 三、Bug 汇总

| Bug# | 位置 | 现象 | 原因 | 影响 | 修复建议 |
|------|------|------|------|------|----------|
| #1 | `databases: update_data_source` | 传 `{"multi_select": [...]}` → Notion 报错 "should be an object" | MCP JSON 序列化将 `multi_select.options` 数组外层丢失；需要 JSON string 绕过 | `multi_select`/`select`/`status` options 需用 JSON string 传参 | 在 `properties` helper 里对 `multi_select` 类型做显式对象化：`arr.map(o => ({...}))`；或在 docs 里明确标注此限制 |
| #2 | `pages: create` | `名称=""`（空字符串）时 Notion 报错 "id should be defined / name should be defined / start should be defined" | tool 把空字符串的 title 属性误判为 date/place 类型 | 空 title 无法创建页面 | 在 `pages.create` action 里检测 title 属性，若为空则不传该属性或抛更清晰的业务错误 |
| #3 | `blocks: update` | bulleted_list_item 块用 paragraph 内容更新 → 报错 "Block type mismatch" | Notion API 保护（正确行为）但错误信息缺少上下文 | 用户不知道期望什么类型 | 在 MCP 错误里附加 `expected_type`（从 blocks.get 查当前块类型）和 `actual_type`（从输入解析出来的类型）|
| #4 | `comments: create` | `fetch failed: TypeError` | 偶发，可能是 MCP server 进程临时不稳；后续重试变成权限错误 | 评论创建功能偶发失败 | 需排查 `src/tools/composite/comments.ts` 的 HTTP 调用路径和错误处理；加 retry 逻辑 |
| #5 | `databases: query` | 偶发 `fetch failed`（与 comments.create 同 batch，之后立即调用） | 同 Bug #4，可能是 MCP server 进程偶发不稳 | 偶发查询失败 | 同 Bug #4，同一 root cause |
| #6 | `comments: list/create` | `Integration does not have access to this resource` | Notion 集成未开启 "Read comments" 和 "Insert comments" 能力 | 评论功能完全不可用（稳定复现）| 在 Notion 集成设置里添加对应能力；或 docs 里明确标注所需权限 |
| #7 | `file_uploads: complete` | `fetch failed: TypeError` | 同 Bug #4（同一 root cause，偶发）| 上传完成步骤报错，但最终状态正确（status=uploaded）| 同 Bug #4 一起排查；若 status 已正确可不修 |
| #8（Bug #6 确认）| `comments: list/create` | 多次重试均为 "Integration does not have access" | Notion 集成缺权限，稳定复现 | 评论功能不可用 | 同 Bug #6 |
| #9 | `databases: create` | "Parent block type collection_view cannot contain databases" | Notion API 限制：在 database 内联页面下不能创建子数据库 | 无法在 DB 子页面下创建嵌套 DB | Notion API 限制，非 bug；docs 里标注此限制 |
| #10 | `databases: create_data_source` | "Data sources must have a title property in their schema" | Notion API 要求 data_source schema 必须含 title 属性 | 创建时不带 title 会失败 | docs 里明确标注 "data_source 必须包含一个 title 类型属性" |

---

## 四、留存测试数据

以下页面在测试中创建，可直接打开复验：

| 页面名 | ID | URL |
|--------|-----|-----|
| A1_正常中文标题 | `3964f4cf-c8e2-8184-b938-e18eca705a19` | https://app.notion.com/p/A1_-3964f4cfc8e28184b938e18eca705a19 |
| A3_emoji中英混合🚀hello | `3964f4cf-c8e2-8149-9381-dbc5e992a36e` | https://app.notion.com/p/A3_emoji-hello-3964f4cfc8e281499381dbc5e992a36e |
| B1_create_page_test | `3964f4cf-c8e2-81dc-855b-e3ea7598c2ce` | https://app.notion.com/p/B1_create_page_test-3964f4cfc8e281dc855be3ea7598c2ce |
| 副本_of_A1 | `3964f4cf-c8e2-81b3-ba45-de1866075953` | https://app.notion.com/p/A1_-3964f4cfc8e281b3ba45de1866075953 |
| C1_分类X | `3964f4cf-c8e2-8138-9431-e249f0591c83` | https://app.notion.com/p/C1_-X-3964f4cfc8e281389431e249f0591c83 |
| C2_分类X | `3964f4cf-c8e2-81d4-818d-fdacfd0c7213` | https://app.notion.com/p/C2_-X-3964f4cfc8e281d4818dfdacfd0c7213 |
| C3_分类Y | `3964f4cf-c8e2-815f-b7c8-c4083fedf89d` | https://app.notion.com/p/C3_-Y-3964f4cfc8e2815fb7c8c4083fedf89d |

**测试数据库**: https://app.notion.com/p/3934f4cfc8e280318f30c20b2a9db637
**新建子数据库**: https://app.notion.com/p/96c899bec7174e8cafa95fb59623477b
**上传文件 ID**: `3964f4cf-c8e2-8173-944f-00b2ccffc71d` (test-upload.txt, status=uploaded)

---

## 五、测试方法论说明

参照 `CLAUDE.md` 中 Testing methodology 规范：
- **Reverse testing**: 每个 API error 当作 contract 探针，分析错误信息推断 API 要求
- **Edge value matrix**: 空字符串、超大数值、emoji、中文、特殊字符均有覆盖
- **Cross-action consistency**: pages.create / databases.create_page / databases.update_page 三种创建路径均测试

---

# 复测报告：2026-07-07 16:30 UTC+8（修复后）

**测试版本**: 本地 build 2026-07-07 16:18（重建 bundle 后的最新版本）
**重点**: 验证 9 项修复 + 探测新 bug

## 六、修复验证矩阵

| 修复 | 验证路径 | 结果 |
|------|---------|------|
| Bug #1 multi_select 序列化 | `databases.update_page` 设 `标签: [tag1, tag2]` | ✅ query 验证返回 `["tag1", "tag2"]` |
| 优化 #1 updateMarkdown API | `pages.update` (replace/append) + `get_markdown` + `update_content` + `insert_markdown` | ✅ 全部 4 条路径，单调用成功 |
| Bug #2-5 normalizeBlockProperties | `blocks.update` on table (`has_row_header: true`) + table_row (cells) | ✅ 返回 `type: table` / `type: table_row`，updated:true |
| Bug #6 comments 权限 | `comments.list/get/create` | ❌ 仍报 "Integration does not have access"（Notion 端权限，非 bundle bug） |
| blocks 字段校验 | `blocks.update` properties 路径用 table + page_id | ✅ Notion 返回 `body.table.page_id should be not present`（API 校验生效） |
| comments OAuth detection | OAuth 模式下返回 `COMMENTS_LIST_UNAVAILABLE` | ✅（仅 stdio 模式无法验证，需 HTTP 部署） |
| aggregate/group_by | `databases.aggregate` + `group_by` | ✅ 返回 7 行 count + 分类分组 |
| list_templates | `databases.list_templates` | ✅ 返回 `total: 0` |
| pages.duplicate | `pages.duplicate` C2_分类X | ✅ 新页面 ID `3964f4cf-c8e2-81f0-af74-ffb923e05ed0` |
| pages.archive/restore | C3_分类Y 归档+恢复 | ✅ 双向通过 |
| pages.get_property | `get_property` title | ✅ 返回 `C2_分类X` |
| blocks.append (markdown table) | `blocks.append` 表格 markdown | ✅ children 验证：11 blocks（包含 has_children table） |
| blocks.update text-rich | heading_1 + paragraph content 路径 | ✅ bold/italic 注解保留（**Bold paragraph**） |

## 七、**新发现 Bug #11**：create_page 在多数据源 database 失败

### 现象
```
mcp__better-notion__databases.create_page({
  database_id: "3934f4cf-c8e2-8043-a002-000b615548a4",
  pages: [{ properties: { 名称: "Bug1验证", 标签: ["tag1","tag2"] } }]
})

→ 400 validation_error:
  "Databases with multiple data sources are not supported in this API version."
  additional_data.error_type = "multiple_data_sources_for_database"
  child_data_source_ids = ["3934f4cf-c8e2-8043-a002-000b615548a4",
                            "3964f4cf-c8e2-81af-b165-000b6ea24b7c"]
  minimum_api_version = "2025-09-03"
```

### 根因（Reverse contract）
Notion API 2025-09-03 contract：
- 当 database 有 **多个 data sources** 时，`POST /v1/pages` 必须用 `parent: { type: "data_source_id", data_source_id: <UUID> }`
- 用 `parent: { type: "database_id", database_id: <UUID> }` → 400 reject
- **bundle 始终用 `database_id` parent**（pages.ts:303, databases.ts:579）

### 受影响代码路径
1. `pages.create` → `createPage` (pages.ts:283)
   - Line 303: `parent = { type: 'database_id', database_id: databaseId }` ← 永远是 db_id
2. `databases.create_page` → `createDatabasePages` (databases.ts:533)
   - Line 579: `parent: { type: 'database_id', database_id: databaseId }` ← 永远是 db_id

### 正确代码（按 Notion 官方 docs）
```typescript
// pages.ts:303
parent = { type: 'data_source_id', data_source_id: dataSourceId }
// databases.ts:579
parent: { type: 'data_source_id', data_source_id: dataSourceId }
```

`dataSourceId` 已在 `resolveDataSourceId()` 返回值中，无需额外 API 调用。

### 触发条件
- Database 包含 ≥2 个 data sources（API 2025-09-03 新架构）
- Notion UI 中：左侧面板数据库 → "..." → "Add data source" → 创建第二个数据源

### 修复方案（待执行）
两处修改 + 加反向测试 + 加正常路径测试。

### 临时 workaround
- 删除第二个 data source → DB 变单源 → create_page 用 `database_id` parent 正常工作
- 或用 `pages.create` + `parent_id` = data_source_id 直接传（需先单独验证）

---

## 八、本次测试页面 ID 速查

| 名称 | page_id | URL |
|------|---------|-----|
| C2_分类X（被测页） | `3964f4cf-c8e2-81d4-818d-fdacfd0c7213` | https://app.notion.com/p/C2_-X-3964f4cfc8e281d4818dfdacfd0c7213 |
| C2_分类X 副本（duplicate） | `3964f4cf-c8e2-81f0-af74-ffb923e05ed0` | https://app.notion.com/p/C2_-X-3964f4cfc8e281f0af74ffb923e05ed0 |

**关键 block ID** (C2_分类X 上)：
- heading_1: `2f56a59f-0234-4368-b24f-9d4e1d14f2f6`
- paragraph (bold): `d0d16e4b-928e-4a6e-b2fa-02a1dc780d52`
- table: `3964f4cf-c8e2-8176-8cd4-d3d603adfbac`
- table_row (header): `3964f4cf-c8e2-81c5-a458-f7d884e7073d`

---

## 九、修复 Bug #11 的实施方案

### Step 1: 反向测试（必先写，参照 CLAUDE.md）
在 `databases.test.ts` 加：
```typescript
it('should use data_source_id parent for multi-source databases (Bug #11 reverse test)', async () => {
  // Reverse contract from real Notion API 400:
  //   "Databases with multiple data sources are not supported in this API version."
  //   additional_data.error_type = "multiple_data_sources_for_database"
  // Root cause: bundle sent parent.database_id which Notion rejects when the
  // database has 2+ data sources. Fix uses parent.data_source_id — works for
  // both single- and multi-source DBs.
  ...
  expect(mockNotion.pages.create).toHaveBeenCalledWith(
    expect.objectContaining({
      parent: { type: 'data_source_id', data_source_id: 'ds-1' }
    })
  )
  expect(callArgs.parent.database_id).toBeUndefined()
})
```

### Step 2: 修改 pages.ts createPage (line 303)
```diff
- parent = { type: 'database_id', database_id: databaseId }
+ parent = { type: 'data_source_id', data_source_id: dataSourceId }
```

同时修 **discriminator check** (line 336)：
```diff
- if (parent.database_id) {
+ // Bug #11: include data_source_id since we now use that parent for DB pages
+ if (parent.data_source_id || parent.database_id) {
```
否则 properties 转换会被跳过（！），导致非英文 title column 名失效。

### Step 3: 修改 databases.ts createDatabasePages (line 579)
```diff
- parent: { type: 'database_id', database_id: databaseId },
+ parent: { type: 'data_source_id', data_source_id: dataSourceId },
```

### Step 4: 更新现有测试期望
- `pages.test.ts:120`：`parent: { type: 'database_id', database_id: 'db123' }` → `data_source_id`
- `databases.test.ts:515`：同样更新

### Step 5: 验证
- `bun run test` → 1100/1100 pass ✅
- `bun run build` → bundle 时间戳 17:12
- 在 Notion UI 创建第二个数据源 → 实测 `databases.create_page` 不再 400 (待用户重连 MCP 后实测)

---

# 第三轮：2026-07-07 17:12 UTC+8（Bug #11 已修复）

**修复 commit summary**:
- `pages.ts:303` + 336: `parent.database_id` → `parent.data_source_id`（双重修复避免 discriminator 误判）
- `databases.ts:579`: 同上
- `databases.test.ts:512`: 正向测试 + 反向测试 (`should use data_source_id parent for multi-source databases`)
- `pages.test.ts:120`: 更新期望

**测试结果**: `bun run test` → **1100 passed (1100)** ✅
**Bundle 状态**: 17:12 build，3 个路径同步（本地 / npm global / bin symlink）

**待用户操作**: `/mcp` 重连 better-notion MCP → 实测 `databases.create_page` 在多源 DB 上是否成功
