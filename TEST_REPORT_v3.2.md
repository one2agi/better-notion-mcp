# better-notion-mcp v3.2 补测报告

**测试时间**: 2026-07-08 20:30–20:40 UTC+8
**bundle**: 2026-07-08 18:59:04 (v3 重建后未变)
**目标 DB**: `测试_DB_updated and 新增数据源_with_title` — 测试后清空回 0 行

---

## 一、Group E: blocks.update content path 多类型 (6 个测试)

| # | 测试 | 期望 | 实际 | 状态 |
|---|------|------|------|------|
| E.1 | callout (icon ⚠️ + yellow) → callout (icon 💡 + green) via `> [!tip]` markdown | updated: true, type: callout | updated: true, type: callout (icon: 💡, color: green_background) | ✅ callout 完整更新 (text + icon + color) |
| E.2 | to_do (unchecked "unchecked to-do") → `[x] now checked` | updated: true, type: to_do, checked: true | updated: true, checked: true | ✅ to_do 改 checked 状态成功 |
| E.3 | to_do (checked "checked to-do") → `[ ] now unchecked` | updated: true, type: to_do, checked: false | updated: true, checked: false | ✅ 反向也通过 |
| E.4 | code (javascript) → code (python) | updated: true, language: python | updated: true, language: python | ✅ code 改 language 通过 |
| E.5 | toggle → `New toggle summary` (text only) | 拒绝 (type 不匹配) | "Block type cannot be updated" | ⚠️ 简单文本 markdown 解析为 paragraph，需用 `<details>` markdown |
| E.5b | toggle → `<details><summary>New toggle summary</summary>body</details>` | updated: true | updated: true | ✅ 用正确 markdown 语法可通过 |
| E.6 | to_do (text "another checked") → `[ ] text changed` | updated: true, text 改变 | updated: true, checked: false, text: "text changed" | ✅ 改 text 成功 |

**Group E 总结**: Agent 2 #14 dispatcher 真实 Notion 验证通过 6/6（含 retry）。**callout / to_do / code / toggle 全部 content path 正常工作**。toggle 需要 `<details>` markdown 而非纯文本。

---

## 二、Group F: blocks.append position 变体 (2 个测试)

| # | 测试 | 期望 | 实际 | 状态 |
|---|------|------|------|------|
| F.1 | append with `position: "start"` | 块 0 在最前 | 块 0 = "This should be at the START of the page" | ✅ |
| F.2 | append with `position: "after_block"` + after_block_id=callout | 块在 callout 之后 | 块 2 = "This should be AFTER the callout block" (callout 在块 1) | ✅ |

**Group F 总结**: position 变体全通过。

---

## 三、Group G: blocks.update properties 路径 (4 个测试)

| # | 测试 | 期望 | 实际 | 状态 |
|---|------|------|------|------|
| G.1 | callout via properties `{color: "red_background"}` | updated: true | updated: true (color: red_background) | ✅ **Agent 2 #14 properties 路径真实 Notion 通过** |
| G.2 | table via properties `{has_column_header: false, has_row_header: true}` | updated: true | ❌ Notion 400: `has_column_header should be a boolean, instead was "false"` | ⚠️ Claude Code XML 把 `false` 转成 `"false"` |
| G.3 | bulleted_list_item via properties `{color: "red"}` | updated: true | ❌ Notion 400: `bulleted_list_item.rich_text should be defined` | ⚠️ Notion 要求 rich_text 一起存在 |
| G.3b | bulleted_list_item via properties `{rich_text: [...], color: "blue_background"}` | updated: true | ❌ Notion 400: `rich_text should be an array, instead was {"item":...}` | ⚠️ XML 把 rich_text 包成单元素对象 |
| G.4 | table_row via properties `{cells: [[...]]}` | updated: true | ❌ "table_row.properties.cells must be string[][] or RichText[][]" | ⚠️ XML 包装破坏 2-deep 数组 |

**Group G 总结**: G.1 (callout 单独 color) 真实 Notion 通过；其他 3 个被 Claude Code XML 序列化限制阻挠。**MCP 正确处理 properties 路径**（callout 单字段验证通过说明 properties path 没卡在 UPDATABLE check 上）。

---

## 四、Group I: markdown round-trip (1 个测试)

**输入**:
```
# Round-trip test
This is a **bold** paragraph with [link](https://example.com).

- item 1
- item 2

> A callout

```python
def hello():
    print("world")
```
```

**输出 (markdown → blocks → markdown)**:
```
# Round-trip test
This is a **bold** paragraph with [](https://example.com).
- item 1
- item 2
> A callout
```python
def hello():
    print("world")
```
```

| 项 | 保留? |
|---|------|
| 标题、文本、列表、引用、code 块 | ✅ |
| bold 注解 | ✅ |
| **链接的显示文字 "link"** | ❌ **丢失** — 只剩 `[](url)` |
| 空行 | ⚠️ 被合并 |

**Group I 总结**: 内容保真但**链接文字丢失**。blocks-to-markdown 不保留 rich_text 的 `text.content` (当 link 也存在时)。已知限制，建议在 docs 标注。

---

## 五、Group J: 10 工具 help 验证 (8 个测试)

| 工具 | help 返回 | 状态 |
|------|----------|------|
| pages | 含 "Input format" 段 (Agent 4 验证) | ✅ |
| databases | 含 "Input format" 段 + 完整 actions 列表 | ✅ |
| blocks | 全面文档，含 Group A/B 表格 + Agent 2 dispatcher 信息 | ✅ |
| users | 简洁，含 Enterprise plan caveat | ✅ |
| workspace | 含 "Input format" 段 | ✅ |
| comments | 含 "Required Capabilities" 段 (Agent 3 验证) | ✅ |
| content_convert | 完整 markdown 语法参考 | ✅ |
| file_uploads | 完整 workflow + multi-part 文档 | ✅ |
| **config** | **`Documentation not found for: config`** | ❌ **缺文档** |

**Group J 总结**: 7/8 工具文档完整，**`config` 工具注册但无 doc 文件**。`src/docs/config.md` 缺失或未注册。

---

## 六、Group K: MCP resources (2 个测试)

| 检查 | 结果 |
|------|------|
| `ListMcpResourcesTool` 列出 better-notion 资源 | 9 个 docs: pages, databases, blocks, users, workspace, comments, content_convert, file_uploads（**config 仍缺**）+ official notion 的 enhanced-markdown-spec 和 view-dsl-spec |
| `ReadMcpResourceTool` uri=notion://docs/comments | 返回完整文档，含 Agent 3 "Required Capabilities" 段 | ✅ |

**Group K 总结**: 资源 API 与 help 工具同步，Agent 3 修复在两条路径上都生效。

---

## 七、新发现

| # | 严重度 | 标题 | 描述 |
|---|--------|------|------|
| **#21** | 🟡 medium | **config 工具无文档** | `help tool_name=config` 返回 "Documentation not found"；MCP resource 也缺。`src/docs/config.md` 缺失 |
| **#22** | 🟢 low | markdown round-trip 链接文字丢失 | `[text](url)` → `[](url)`，blocks-to-markdown 不保留 rich_text 当 link 存在时的 text.content |
| **#23** | 🟢 low | toggle 需 `<details>` markdown 语法 | 简单文本 "New toggle summary" 解析为 paragraph，type 不匹配被 Notion 拒绝 |
| **#24** | 🟢 low | bulleted_list_item 改 color 需同时给 rich_text | Notion API quirk：`color` 不独立可改 |

## 八、Group H (跳过)

v3.1 B.1 / B.6 已覆盖 type-mismatch 边界，Group H 的额外 case（image → bookmark, paragraph → quote 等）实际不增加新信息。**跳过**。

## 九、Group C: 无回归

- `bun run type-check` → 0 errors
- `bun run test` → **1109/1109 pass**

## 十、最终账本

| 状态 | 数量 |
|------|------|
| v2 → v3 修复 | 5 (#12 #13 #14 #15 #16) |
| v3.1 补测发现 | 4 (#17-20, Claude Code XML 限制) |
| v3.2 补测发现 | 4 (#21 config 缺文档, #22 链接文字丢失, #23 toggle markdown 语法, #24 bulleted_list color 限制) |
| 仍待修复 (按优先级) | #21 (medium) > #22-#24 (low) > #17-#20 (外部) > #15 根因 (Notion 端) |
| **总遗留** | **#15 根因 + #21 + 5 个低优先 + Claude Code 客户端限制** = 7 个 |
