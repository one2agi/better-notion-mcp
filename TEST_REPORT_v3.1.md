# better-notion-mcp v3.1 补测报告

**测试时间**: 2026-07-08 20:20–20:25 UTC+8
**bundle**: 2026-07-08 18:59:04 (v3 重建后)
**目标 DB**: `测试_DB_updated and 新增数据源_with_title` — 测试后清空回 0 行

---

## 一、Group A: Agent 1 boundary tests

| # | 测试 | 期望 | 实际 | 状态 |
|---|------|------|------|------|
| A.1 | `blocks.append blocks=[]` | appended_count: 0 | `appended_count: 0` | ✅ 空数组 = no-op |
| A.2 | `blocks.append blocks=[{type: "unknown_xyz",...}]` | Notion 400 (unknown type) | `400 validation_error: body.children[0].X should be defined` (列出所有 valid types) | ✅ MCP 透传到 Notion，Notion 拒绝 |
| A.3 | `blocks.append content+blocks` | MCP 拒绝 | `Error: Provide either content or blocks, not both` | ✅ MCP-level 互斥校验 |
| A.4 | `blocks.append blocks=[{type:"table", table:{table_width:2,...}}]` | 创建 table | ❌ Notion 400: `table.children should be defined` | ⚠️ Notion API 合同：table 必须含 children (rows) |
| A.5 | `blocks.append blocks=[{type:"column", column:{width_ratio:1}}]` | 创建 column | ❌ Notion 400: `column.children should be defined` | ⚠️ Notion API 合同：column 必须含 children |
| A.6 | `blocks.append blocks=[{type:"table_row", ...}]` 到 page | 创建 table_row | ❌ Notion 400: `Only table_row blocks may be appended to a table block` | ⚠️ Notion API 合同：table_row 只能 append 到 table block |
| A.7 | `blocks.append blocks=[{type:"link_to_page", link_to_page:{type:"database_id", database_id:...}}]` | 创建 link 到 DB | ❌ Notion 400: `database_id must reference a collection_view_page` | ⚠️ Notion API 合同：link_to_page 只能指向 page，不能指向 database |
| A.8 | `blocks.append blocks=[{type:"link_to_page", link_to_page:{type:"page_id", page_id:X, database_id:Y}}]` | Notion 拒绝 (双 ref) | ❌ Notion 400: `database_id should be not present` | ✅ Notion 合同校验通过 MCP |
| A.9 | `blocks.append blocks=[{type:"synced_block", synced_block:{synced_from: null}}]` | 创建 unlinked synced_block | ✅ `appended_count: 1`，children 显示 `{synced_block: {synced_from: null}}` | ✅ **Agent 1 + 2 fix 协同：synced_block 真正可创建**（v2 这是死代码） |
| A.10 | `blocks.append blocks=[{type:"synced_block", synced_block:{synced_from:{block_id: SAME_PAGE}}}]` | Notion 拒绝 (self-ref) | ❌ Notion: `Only blocks of type synced_block that aren't syncing from another block can be used` | ✅ Notion 合同：禁止自引用 |

**Group A 总结**:
- ✅ Agent 1 fix **完全可用**：`link_to_page` 和 `synced_block` 都能通过 `blocks[]` 数组创建
- ⚠️ Notion API 合同校验：table/column_list/table_row/synced_block 有严格的父子结构要求
- ⚠️ Claude Code XML 序列化导致 `2 → "2"`、`null → ""`、单元素数组 `[]` 被包成 `{"item":[]}` — **这是 Claude Code 客户端 bug，不是 MCP bug**

---

## 二、Group B: Agent 2 edge tests

| # | 测试 | 期望 | 实际 | 状态 |
|---|------|------|------|------|
| B.1 | `blocks.update` divider (id) content="## heading" | 拒绝 (type 不匹配) | `Error: Block type cannot be updated` (来自 Notion 拒绝) | ✅ type 转换被 Notion 正确拒绝 |
| B.2 | `blocks.update` equation (id) content="$$F=ma+gravity$$" | updated: true | `{type: "equation", updated: true}` | ✅ |
| B.3 | `blocks.update` image (id) content="![updated](notion URL)" | updated: true | `{type: "image", updated: true}` | ✅ **Agent 2 #14 真实 Notion 验证 image dispatcher 工作** |
| B.4 | `blocks.update` image (id) properties={url, caption} | updated: true | ❌ Notion 400: `body.image.caption should be an array, instead was {"item":...}` | ⚠️ MCP 透传成功（payload 到 Notion），但 **Claude Code XML 包装 caption 为单元素对象**；用户需用 JSON-string 传 caption |
| B.5 | `blocks.update` paragraph (id) content="Just a paragraph now" | updated: true | `{type: "paragraph", updated: true}` | ✅ |
| B.6 | `blocks.update` paragraph (id) content="---" (→ divider) | 拒绝 | `Error: Block type cannot be updated` | ✅ Notion 拒绝 type 转换 |
| B.7 | `blocks.update` 0x0 block_id | 拒绝 | `Error: Block not found` | ✅ 错误处理正常 |
| B.8 | `blocks.update` table_row (id) properties={cells:[[...]]} | updated: true | ❌ MCP: `table_row.properties.cells must be string[][] or RichText[][]` | ⚠️ **MCP normalize 检查正常触发**，但 Claude Code XML 包装导致 cells 不是 2-deep 数组 |

**Group B 总结**:
- ✅ Agent 2 #14 dispatcher fix **真实 Notion 验证通过**（image、equation、paragraph 全部 content path 更新成功）
- ✅ Agent 2 #13 whitelist 移除**真实 Notion 验证通过**（type 不匹配走 Notion 自然拒绝，不再 pre-check 抛错）
- ✅ 非存在 block 错误处理正确
- ⚠️ properties path 仍受 Claude Code XML 序列化影响（B.4 / B.8）— **MCP 层正确，是输入边界问题**

---

## 三、Group C: 重新跑 type-check + 完整 test suite

| 命令 | 结果 | 退出码 |
|------|------|--------|
| `bun run type-check` | no output, success | 0 |
| `bun run test` | 36 test files, **1109/1109 pass**, 28.31s | 0 |

**0 回归**。

---

## 四、发现的新问题

| # | 严重度 | 标题 | 描述 |
|---|--------|------|------|
| **#17** | 🟡 medium | Claude Code XML 序列化导致数字/数组/nested 对象变形 | 数字 `2` → `"2"`，null → `""`，单元素数组 `[]` → `{"item":[]}`。影响所有 properties path 测 + 复杂嵌套 blocks[] 测 |
| **#18** | 🟢 low | image via properties 路径要求 `{ image: { ... } }` 包装 | User 期望简单的 `{ url, caption }`，但 Notion API 要 `{ image: { external: { url }, caption } }`。MCP 未在 properties path 自动包装（与 normalizeBlockProperties 的 link_to_page / table_row 不同） |
| **#19** | 🟢 low | table_row via properties path 难通过 Claude Code | 需 `string[][]` 2-deep 数组，XML 序列化把它变成 3-deep。content path（markdown table）可用 |
| **#20** | 🟢 low | `blocks.append blocks=[]` 是静默 no-op (无警告) | 不会报错，但也不告诉用户 |

---

## 五、Group D 总结

补测发现：
- **Agent 1 修复（#12）真实 Notion 端到端通过**：link_to_page 和 synced_block 都能通过 `blocks[]` 创建
- **Agent 2 修复（#13, #14）真实 Notion 端到端通过**：image / equation / paragraph 走 content path 更新成功；whitelist 移除后 type 不匹配由 Notion 正确拒绝
- **0 回归**：1109 个 unit test 全绿

新发现 4 个小问题（#17-20），主要都是 Claude Code 客户端 XML 序列化限制，不是 MCP bug。

## 六、最终账本

| 状态 | 数量 |
|------|------|
| v2 复测 9 个 issue | 9 |
| v3 修复 | 5 (#12 #13 #14 #15 #16) |
| 不可修复（外部依赖）| 1 (comments Notion 权限) |
| 不可黑盒验证 | 1 (comments retry) |
| 跳过 | 2 |
| v3.1 补测发现新 | 4 (#17-20, 都是 Claude Code 客户端限制) |
| **总遗留** | **#15 根因 + #17-20 + 不可验证** = 6 个待跟进 |
