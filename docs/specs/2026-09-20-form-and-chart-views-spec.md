# Better Notion MCP: 表单视图 (Form) 与图表视图 (Chart) 架构设计与实现规范 (Spec)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Better Notion MCP 扩展官方 Notion Views API (`2025-09-03` / `2026-03-11`) 中最核心的「表单视图 (form)」与「图表视图 (chart)」能力，构建具有高内聚、深模块 (Deep Module)、单次调用闭环 (One-Call Closure) 与极高人体工学宽容度 (Ergonomic Adaptation) 的数据采集与可视化视图引擎。

**Architecture:** 严格遵循架构设计红线与深模块哲学，严禁新增任何浅层独立小工具。所有表单与图表能力全面内聚在现有的 `databases` 复合工具中，由 `action: 'create_view' | 'update_view'` 统合分发。所有列名解析、类型推导、聚合算子推导、必填排序注入与表单别名宽容度均在深模块 `src/tools/helpers/view-config.ts` 内部闭环，向调用方提供平坦、简单、具备抗脆弱防御的极简接口。

**Tech Stack:** TypeScript (strict mode, ESM), `@notionhq/client` v5.22.0 (Views API), Vitest, Biome, Bun runtime.

**Spec Reference:** Notion Official Views API Guide (`https://developers.notion.com/guides/data-apis/working-with-views.md`)

---

## 1. 业务目标与产品价值（面向产品经理视角）

### 1.1 业务背景与用户痛点

在企业知识库、项目管理与数据协作场景中，Notion Database 是核心业务中枢。目前 Better Notion MCP 已经成功支持了表格 (table)、看板 (board)、日历 (calendar)、时间线 (timeline)、画廊 (gallery) 与列表 (list) 6 种展示型视图。然而在真实业务流转中，存在两个阻断自动化飞轮的“关键交互断层”：

1. **前端数据采集断层 (Data Intake Gap)**：
   - **痛点**：团队和 AI 智能体在需要自动化搭建“客户工单提报”、“需求问卷”、“Bug 反馈中心”或“外部候选人登记”时，无法通过 API 创建表单视图 (`form`)，亦无法通过程序设置表单的开放状态 (`is_form_closed`)、匿名提交权限 (`anonymous_submissions`) 与提报人权限 (`submission_permissions`)。
   - **后果**：用户必须切换回 Notion UI 手工配置表单，阻断了企业工作流全自动化的闭环。

2. **高层数据洞察断层 (Data Insights Gap)**：
   - **痛点**：数据库中积累了大量项目工时、销售额、任务状态等高价值结构化数据，但在生成管理层周报、项目复盘或仪表盘 (Dashboard) 时，AI 智能体无法创建图表视图 (`chart`)，包括柱状图 (column)、条形图 (bar)、折线图 (line)、环形图 (donut) 以及核心 KPI 单值指标卡 (number)。
   - **后果**：数据难以视觉化呈现，用户只能看到密密麻麻的数据表格，极大削弱了 AI 自动化汇报的产品表现力与交付价值。

### 1.2 产品核心价值与北极星目标

```
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│   数据采集入口   │ ───►  │     数据流转治理     │ ───►  │  决策洞察看板   │
│ Form View (表单) │       │ Table / Board / List │       │ Chart View (图表)│
└─────────────────┘       └──────────────────────┘       └─────────────────┘
   一键生成外部问卷             状态跟踪 / 任务协同           柱状/折线/单值KPI
   权限控制 / 匿名开关                                      自动聚合 / 渐变高亮
```

1. **全链路端到端交付闭环 (Collection -> Process -> Visualization)**：
   - 表单视图负责低摩擦、可控边界的数据收集；
   - 原有表格/看板负责协同与流转；
   - 图表视图负责管理层监控与指标自动化视觉呈现。
   - 彻底补全 Notion Database “采-管-看”的最后两块拼图。

2. **极简 Agent 体验 (One-Call Closure & Zero Cognitive Load)**：
   - 智能体无需理解 Notion 底层晦涩的 `property_id`（如 `f98a2c1...`）、复杂的 AST 结构以及各种嵌套强制字段（如 `sort: { type: 'manual' }`）。
   - 智能体只需一句直觉式指令：
     - *“以‘阶段’为 X 轴，‘预估工时’求和生成柱状图”* (`{ action: 'create_view', type: 'chart', chart_type: 'column', x_axis: '阶段', y_axis: '预估工时' }`)
     - *“创建一个只允许团队内成员提交的 Bug 反馈表单”* (`{ action: 'create_view', type: 'form', anonymous_submissions: false, submission_permissions: 'comment_only' }`)
   - 首次调用成功率目标：**100%**（通过底层防御式推导彻底消除 400 Validation Error）。

3. **极致架构优雅度与 Token 节省 (Deep Composite Tool)**：
   - 绝不因新增能力增加独立小工具（如 `create_form_view` / `create_chart_view`），所有动作归并入 `databases` 复合工具。
   - 保持全局工具清单极度紧凑（Token 占用压缩 ~77%），避免大模型产生工具选择疲劳与路由幻觉。

---

## 2. 交互契约与接口设计

### 2.1 复合工具路由规范 (Deep Composite Seam)

所有能力一律通过 `databases` 复合工具的现有动作进行触发：
- `action: 'create_view'`：创建新的 Form 视图或 Chart 视图；
- `action: 'update_view'`：增量更新视图名称、筛选、排序或视图特有配置（开闭表单、图表轴调整、颜色调整等）；
- `action: 'get_view'` / `list_views` / `delete_view'`：无需额外改动，原生兼容并返回完备的 Form / Chart 视图元数据与删除闭环。

### 2.2 DatabasesInput 扩展定义

在 `src/tools/composite/databases.ts` 中对 `DatabasesInput` 接口进行人体工学扩展：

```typescript
export interface DatabasesInput {
  action:
    | 'create'
    | 'get'
    | 'query'
    | 'create_page'
    | 'update_page'
    | 'delete_page'
    | 'create_data_source'
    | 'update_data_source'
    | 'update_database'
    | 'list_templates'
    | 'aggregate'
    | 'group_by'
    | 'create_view'
    | 'list_views'
    | 'get_view'
    | 'update_view'
    | 'delete_view'

  // 通用标识
  database_id?: string
  data_source_id?: string
  view_id?: string
  name?: string
  title?: string
  type?: string
  view_type?: string

  // 现有通用视图参数
  configuration?: Record<string, any>
  filters?: any
  filter?: any
  sorts?: any[]
  placement?: any
  position?: any
  visible_properties?: string[]

  // ==========================================
  // Chart (图表视图) 人体工学扁平参数
  // ==========================================
  chart_type?: 'column' | 'bar' | 'line' | 'donut' | 'number'
  x_axis?: string | Record<string, any>
  y_axis?: string | Record<string, any>
  value?: string | Record<string, any> // number 单值图表专用
  stack_by?: string | Record<string, any> // column / bar / line 堆叠分组 (支持自然语言列名)
  x_axis_property?: string // results 原始结果模式别名
  y_axis_property?: string // results 原始结果模式别名
  x_axis_property_id?: string
  y_axis_property_id?: string
  results_mode?: boolean // 显式声明明细结果模式 (无聚合)

  // Chart 格式与样式控制
  chart_sort?: 'manual' | 'x_ascending' | 'x_descending' | 'y_ascending' | 'y_descending'
  color_theme?:
    | 'gray'
    | 'blue'
    | 'yellow'
    | 'green'
    | 'purple'
    | 'teal'
    | 'orange'
    | 'pink'
    | 'red'
    | 'auto'
    | 'colorful'
  color_by_value?: boolean
  show_data_labels?: boolean
  hide_empty_groups?: boolean // 是否隐藏无数据的空柱/空分组
  height?: 'small' | 'medium' | 'large' | 'extra_large'
  legend_position?: 'off' | 'bottom' | 'side'
  axis_labels?: 'none' | 'x_axis' | 'y_axis' | 'both'
  grid_lines?: 'none' | 'horizontal' | 'vertical' | 'both'
  y_axis_min?: number
  y_axis_max?: number
  target?: number | { value: number; label?: string; color?: string; dash_style?: 'solid' | 'dash' } // 极简目标参考线
  target_line?: number // 极简目标参考线数值别名
  reference_lines?: Array<{
    id?: string
    value: number
    label: string
    color: 'gray' | 'lightgray' | 'brown' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'pink' | 'red'
    dash_style: 'solid' | 'dash'
  }>
  caption?: string

  // Chart 子图特有参数
  cumulative?: boolean // line: 累计曲线
  smooth_line?: boolean // line: 平滑曲线
  hide_line_fill_area?: boolean // line: 隐藏曲线下方阴影填充
  group_style?: 'normal' | 'percent' | 'side_by_side' // bar / column 堆叠模式
  donut_labels?: 'none' | 'value' | 'name' | 'name_and_value' // donut 切片标签
  hide_title?: boolean // number: 是否隐藏指标标题

  // 通用视图快速筛选栏
  quick_filters?: Record<string, any>

  // ==========================================
  // Form (表单视图) 人体工学扁平参数与别名
  // ==========================================
  is_form_closed?: boolean
  closed?: boolean // 宽容别名
  is_closed?: boolean // 宽容别名
  anonymous_submissions?: boolean
  anonymous?: boolean // 宽容别名
  allow_anonymous?: boolean // 宽容别名
  submission_permissions?: 'none' | 'comment_only' | 'reader' | 'read_and_write' | 'editor' | string
  permissions?: string // 宽容别名
  permission?: string // 宽容别名
}
```

### 2.3 人体工学宽容度规则 (Ergonomic Adaptation Rules)

为了确保调用方即使输入模糊、自然语言或非标准语法，系统依然能准确解析并生成官方合法的标准结构，系统全面实施以下 10 大自适应规则：

1. **多语言自然列名自适应解析 (Natural Language Property Resolution)**：
   - 无论传入中文名（`"阶段"`）、英文名（`"Status"`）还是真实 ID（`"f8a3..."`），`resolvePropertyFromSchema` 统一通过 4 级梯次解析真实 `property_id` 与对应 `type`。
2. **X 轴分组必填排序自动注入 (Defensive Sort Injection)**：
   - Notion API 规定图表的 `x_axis`（以及 `stack_by`）底层是一个 `group_by` 结构，**必须携带 `sort` 对象**（如 `{ type: 'manual' }`），否则直接返回 400 校验错误。
   - **防护规则**：若调用方未指定 `sort`，系统一律自动注入 `{ type: 'manual' }`，将致命 400 扼杀在进入网络层之前。
3. **`stack_by` 堆叠分组自然语言解析**：
   - 当调用方配置彩色分段堆叠柱状图时，支持直接传 `stack_by: "优先级"`，系统自动将其转换为带 `sort: { type: 'manual' }` 的标准 `group_by` 结构，享受与 `x_axis` 完全一致的宽容度。
4. **21 种官方全量聚合算子支持与智能推导 (21 Aggregators & Smart Inference)**：
   - 官方完整支持的 21 种算子全量放行：
     - 行数统计：`count`（纯行数计数，**严格剔除 property_id**）、`count_values`（非空行数，**必带 property_id**）；
     - 数值计算：`sum`（求和）、`average`（均值）、`median`（中位数）、`min`（最小）、`max`（最大）、`range`（极差）；
     - 占比与勾选率：`percent_checked`（已勾选百分比，完成率看板专用）、`checked`、`unchecked`、`percent_unchecked`、`percent_empty`、`percent_not_empty`；
     - 里程碑日期：`earliest_date`（最早交付日）、`latest_date`（最晚交付日）、`date_range`（工期跨度）；
     - 唯一性：`unique`（去重成员计数）。
   - **智能推导**：`y_axis: "工时"` 自动匹配数值列并注入 `{ aggregator: 'sum' }`；`y_axis: "count"` 自动设为 `{ aggregator: 'count' }` 并主动剔除 `property_id`。漏传 `y_axis` 时一律安全兜底为 `{ aggregator: 'count' }`。
5. **双数据模式自适应切换 (Grouped Mode vs Results Mode)**：
   - 若 Agent 传入 `results_mode: true` 或同时传入了 `x_axis_property` 和 `y_axis_property`（但未传聚合器），系统自动装配为“明细模式（Results Mode）”（使用 `x_axis_property_id` 与 `y_axis_property_id`，不生成聚合器对象），直接呈现每行散点/明细数据。
6. **极简目标参考线自动包装 (`target` -> `reference_lines`)**：
   - 允许 Agent 传入平坦数字 `target: 100` 或 `target_line: 100`，系统自动将其提升包装为：
     `[{ value: 100, label: "Target", color: "red", dash_style: "dash" }]`，无需 Agent 自行拼装嵌套数组。
7. **`hide_empty_groups` 隐藏无数据空柱保护**：
   - 支持显式传 `hide_empty_groups: true`，在配置中生成该字段，使柱状图/条形图自动过滤 0 条目的无意义空标签，提升大屏整洁度。
8. **表单权限同义词模糊映射 (Submission Permissions Normalization)**：
   - 无论传入 `'readonly'`、`'read'` 均自动归一化映射为官方枚举 `'reader'`；
   - 传入 `'edit'` 自动归一化映射为 `'editor'`；
   - 传入 `'comment'` 自动归一化映射为 `'comment_only'`；
   - 传入 `'read_write'` 自动归一化映射为 `'read_and_write'`；
   - 彻底避免因自然语言轻微不符导致的官方枚举校验阻断。
9. **表单参数别名与布尔宽容 (Form Alias Normalization)**：
   - 接收 `closed` / `is_closed` 自动映射为 `is_form_closed`；
   - 接收 `anonymous` / `allow_anonymous` 自动映射为 `anonymous_submissions`；
   - 接收字符串形式布尔值（如 `"true"` / `"false"`）自动转为原生 boolean。
10. **图表子类型特有字段防御性清洗 (Subtype Parameter Sanitization)**：
    - 针对不同子图类型，清洗互不兼容的字段（例如：为 `donut` 剔除 `group_style`、`smooth_line`；为 `number` 仅保留 `value`、`hide_title` 与核心格式），防止 Notion API 报非法字段。

---

## 3. 核心架构与模块变动

严格遵守深模块 (Deep Module) 原则：接口极小化，内部实现极深，知识与逻辑高度收敛在单一局部 (Locality)。

```
databases(notion, input) (Composite Action Seam)
     │
     ├─► 提取扁平入参 (chart_type, x_axis, y_axis, is_form_closed, ...)
     │
     ▼
buildViewConfiguration(type, rawConfig, schema) (src/tools/helpers/view-config.ts)
     │
     ├─► case 'chart' ──► buildChartConfiguration()
     │                         ├─► buildGroupByConfig(x_axis) (自动注入 sort: manual)
     │                         ├─► buildChartAggregation(y_axis / value) (智能推导 sum/count)
     │                         └─► 规范化子图参数 (group_style / donut_labels / smooth_line)
     │
     ├─► case 'form'  ──► buildFormConfiguration()
     │                         └─► 别名归一化 (closed -> is_form_closed, 权限枚举校验)
     │
     ▼
notion.views.create({ database_id, type, configuration, ... })
```

### 3.1 模块 1: `src/tools/helpers/view-config.ts` (核心深模块增强)

**职责**：全面承载 Form 与 Chart 的配置组装、校验、推导与防御，向外输出符合 Notion Views API 规范的 AST。

**主要变动与代码实现规范**：

1. **扩展类型定义**：
   ```typescript
   export interface ChartAggregationInput {
     aggregator?: string
     property?: string
     property_id?: string
     property_name?: string
   }
   ```

2. **新增 `buildChartAggregation` 辅助函数**：
   - 处理字符串：
     - `"count"` / `"行数"` / `"计数"` -> `{ aggregator: 'count' }`
     - 自然语言属性名 -> 通过 Schema 匹配：若是 `number` 则默认 `aggregator: 'sum'`；否则默认 `count_values`
   - 处理对象：提取 `property` / `property_id` 并从 Schema 匹配；若 `aggregator === 'count'` 则主动删除 `property_id`。

3. **新增 `buildChartConfiguration` 函数**：
   - 校验 `chart_type`：必须是 `'column' | 'bar' | 'line' | 'donut' | 'number'` 之一；
   - 区分 `number` 模式与多维分组模式：
     - `number` 模式：处理 `value`，兜底 `count`，保留 `hide_title`；
     - 多维分组模式：
       - 处理 `x_axis`：调用 `buildGroupByConfig`，自动注入 `sort: { type: 'manual' }`；若未提供则尝试自动寻找 candidate（首选 select/status/date）；
       - 处理 `y_axis`：调用 `buildChartAggregation`，若未提供则默认 `{ aggregator: 'count' }`；
       - 处理 `stack_by`：若提供，调用 `buildGroupByConfig` 规整；
   - 注入通用格式字段（`sort`, `color_theme`, `height`, `show_data_labels`, `color_by_value`, `legend_position`, `grid_lines`, `reference_lines` 等）；
   - 按子图类型保留特有字段，清洗无关字段。

4. **新增 `buildFormConfiguration` 函数**：
   - 归一化提取 `is_form_closed`（兼容 `closed` / `is_closed`）；
   - 归一化提取 `anonymous_submissions`（兼容 `anonymous` / `allow_anonymous`）；
   - 归一化提取 `submission_permissions`（兼容 `permissions` / `permission`），并严格校验有效枚举（`none`, `comment_only`, `reader`, `read_and_write`, `editor`）。

5. **`buildViewConfiguration` 扩展主分支**：
   - 新增 `case 'chart': return buildChartConfiguration(config, schema)`
   - 新增 `case 'form': return buildFormConfiguration(config)`

### 3.2 模块 2: `src/tools/composite/databases.ts` (复合工具路由集成)

**职责**：在 `create_view` 与 `update_view` 执行前，将 Agent 传入的顶层人体工学扁平参数自动提升并合并至 `rawConfig`，交由 `buildViewConfiguration` 处理。

**主要变动**：
在 `createView` 与 `updateView` 中组装 `rawConfig` 时加入图表与表单字段映射：

```typescript
// 提取 Form 扁平参数与别名
const formClosed = input.is_form_closed ?? input.closed ?? input.is_closed
const anonSub = input.anonymous_submissions ?? input.anonymous ?? input.allow_anonymous
const subPerm = input.submission_permissions ?? input.permissions ?? input.permission

const rawConfig = {
  ...(parsedConfig || {}),
  // 现有字段
  ...(input.group_by ? { group_by: input.group_by } : {}),
  ...(input.date_property ? { date_property: input.date_property } : {}),
  ...(input.date_property_id ? { date_property_id: input.date_property_id } : {}),
  ...(visibleProps ? { visible_properties: visibleProps } : {}),

  // 图表字段直通
  ...(input.chart_type ? { chart_type: input.chart_type } : {}),
  ...(input.x_axis ? { x_axis: input.x_axis } : {}),
  ...(input.y_axis ? { y_axis: input.y_axis } : {}),
  ...(input.value ? { value: input.value } : {}),
  ...(input.stack_by ? { stack_by: input.stack_by } : {}),
  ...(input.x_axis_property ? { x_axis_property: input.x_axis_property } : {}),
  ...(input.y_axis_property ? { y_axis_property: input.y_axis_property } : {}),
  ...(input.color_theme ? { color_theme: input.color_theme } : {}),
  ...(input.color_by_value !== undefined ? { color_by_value: input.color_by_value } : {}),
  ...(input.show_data_labels !== undefined ? { show_data_labels: input.show_data_labels } : {}),
  ...(input.height ? { height: input.height } : {}),
  ...(input.group_style ? { group_style: input.group_style } : {}),
  ...(input.donut_labels ? { donut_labels: input.donut_labels } : {}),
  ...(input.smooth_line !== undefined ? { smooth_line: input.smooth_line } : {}),
  ...(input.hide_title !== undefined ? { hide_title: input.hide_title } : {}),

  // 图表高级格式与样式直通
  ...(input.color_theme ? { color_theme: input.color_theme } : {}),
  ...(input.color_by_value !== undefined ? { color_by_value: input.color_by_value } : {}),
  ...(input.show_data_labels !== undefined ? { show_data_labels: input.show_data_labels } : {}),
  ...(input.hide_empty_groups !== undefined ? { hide_empty_groups: input.hide_empty_groups } : {}),
  ...(input.height ? { height: input.height } : {}),
  ...(input.target !== undefined ? { target: input.target } : {}),
  ...(input.target_line !== undefined ? { target_line: input.target_line } : {}),
  ...(input.reference_lines ? { reference_lines: input.reference_lines } : {}),
  ...(input.group_style ? { group_style: input.group_style } : {}),
  ...(input.donut_labels ? { donut_labels: input.donut_labels } : {}),
  ...(input.smooth_line !== undefined ? { smooth_line: input.smooth_line } : {}),
  ...(input.hide_title !== undefined ? { hide_title: input.hide_title } : {}),
  ...(input.results_mode !== undefined ? { results_mode: input.results_mode } : {}),

  // 表单字段直通
  ...(formClosed !== undefined ? { is_form_closed: formClosed } : {}),
  ...(anonSub !== undefined ? { anonymous_submissions: anonSub } : {}),
  ...(subPerm !== undefined ? { submission_permissions: subPerm } : {})
}

// 快速筛选栏 (quick_filters) 直通支持
if (input.quick_filters !== undefined) {
  createParams.quick_filters = parseMaybeJSON(input.quick_filters, 'quick_filters')
}
```

### 3.3 模块 3: `src/tools/tool-definitions.ts` (工具定义与描述压缩)

**职责**：更新 MCP Tool 的 JSON Schema 与 description，遵循 ~77% 压缩哲学，用极少 Token 赋予 Agent 准确决策能力。

**主要变动**：
1. 更新 `databases` 工具的 description：
   ```text
   - create_view (database_id, name, type -> chart_type, x_axis, y_axis, stack_by, target, hide_empty_groups, is_form_closed, anonymous_submissions, submission_permissions, quick_filters, configuration, filters, sorts)
   - update_view (view_id -> name, type, chart_type, x_axis, y_axis, stack_by, target, hide_empty_groups, is_form_closed, quick_filters, configuration, filters, sorts)
   ```
2. 更新 `properties.type.description`：
   `'View type: table, board, list, calendar, timeline, gallery, form, chart (for create_view, update_view)'`
3. 增加关键辅助字段 schema：
   - `chart_type`: enum `['column', 'bar', 'line', 'donut', 'number']`
   - `x_axis`: string or object (自然语言列名或配置对象)
   - `y_axis`: string or object (数值列名求和、"count" 计数或配置对象)
   - `stack_by`: string or object (堆叠分组字段)
   - `target`: number or object (极简目标警戒线)
   - `hide_empty_groups`: boolean
   - `is_form_closed`: boolean
   - `anonymous_submissions`: boolean
   - `submission_permissions`: string
   - `quick_filters`: object

---

## 4. 边界矩阵与反向测试计划 (Reverse Test Defense)

基于真实 Notion Views API 的错误契约，提取出 12 大硬性约束，并设计完整的反向测试防御矩阵：

### 4.1 Notion 官方 API 硬性契约与防御策略

| # | 错误现象 / Notion API 报错契约 | 官方硬性约束 | MCP 防御策略 (Reverse Test Defense) |
|---|-------------------------------|------------|-----------------------------------|
| 1 | `body.configuration.chart_type should be defined` | 图表必须声明 `chart_type` 且为枚举值 | 拦截并校验 `chart_type`，若缺失抛出清晰的 `VALIDATION_ERROR`，列出支持类型 |
| 2 | `body.configuration.x_axis.sort should be defined` | `x_axis` 分组对象必须包含 `sort` 结构 | 当传入自然语言列名或无 sort 对象时，自动注入 `sort: { type: 'manual' }` |
| 3 | `body.configuration.stack_by.sort should be defined` | `stack_by` 堆叠分组对象也必须包含 `sort` 结构 | 当传入自然语言列名 `stack_by: "优先级"` 时，自动解析 Schema 并注入 `sort: { type: 'manual' }` |
| 4 | `body.configuration.y_axis.property_id should not be defined for count` | `aggregator: 'count'` 统计行数时不能带 `property_id` | 当算子为 `'count'` 时，自动剔除 `property_id`；非 count 必须携带有效 `property_id` |
| 5 | `body.configuration.value is required for number chart` | 单值指标卡必须有 `value` 聚合定义 | 若 Agent 未传 `value`，自动默认注入 `{ aggregator: 'count' }`，实现单次调用闭环 |
| 6 | `body.configuration.group_style is not allowed for donut chart` | 子图特有字段不能跨图表类型透传 | 构建器按 `chart_type` 白名单清洗字段，严禁透传无关子图属性 |
| 7 | `body.configuration.submission_permissions is invalid` | 表单提报权限必须属于 5 种预设枚举之一 | 智能模糊映射同义词（`readonly` -> `reader`, `edit` -> `editor`, `comment` -> `comment_only`），其余非法枚举给出友好建议 |
| 8 | Agent 传入 `target: 100` 极简数字 | 官方要求复杂的 `reference_lines` 对象数组 | 自动将 `target` 转换为标准 `reference_lines`（红色虚线 Target: 100） |
| 9 | Agent 传入 `closed: true` 或 `anonymous: true` | Notion API 仅识别 `is_form_closed` 和 `anonymous_submissions` | 人体工学别名归一化映射，宽进严出 |
| 10 | Agent 传入字符串形式布尔值 `"true"` / `"false"` | Notion JSON 契约要求标准 boolean | 类型防御自适应转换，转为原生 boolean |
| 11 | 中文列名与特殊字符列名匹配失败 | 官方底层通过 UUID `property_id` 定位 | 增强 Schema 匹配器，支持中文、大小写不敏感与符号精准解析 |
| 12 | 增量更新视图时传 `null` 清除配置 | Notion 官方更新机制：显式传 `null` 清空字段 | 允许在 `update_view` 中对 nullable 字段传入 `null` 并正确透传 |

### 4.2 单元测试与集成测试用例清单

#### 1. `src/tools/helpers/view-config.test.ts` (单元测试)

- **Chart View 基础与子图构建测试**：
  - `should build column chart with natural language x_axis and auto-injected sort manual`: 验证 `x_axis: "阶段"` 转换为 `{ type: 'status', property_id: 'status-id', group_by: 'option', sort: { type: 'manual' } }`。
  - `should build stacked chart with natural language stack_by`: 验证 `stack_by: "优先级"` 转换为正确的 `group_by` 结构并注入 `sort: { type: 'manual' }`。
  - `should infer y_axis aggregator sum when given a number property string`: 验证 `y_axis: "预计工时"` 转换为 `{ aggregator: 'sum', property_id: 'number-id' }`。
  - `should resolve y_axis count string to aggregator count without property_id`: 验证 `y_axis: "count"` 转换为 `{ aggregator: 'count' }`（无 `property_id`）。
  - `should fallback y_axis to count when omitted in column/bar/line chart`: 验证漏传 `y_axis` 时自动兜底计数。
  - `should wrap target number into standard reference_lines`: 验证 `target: 100` 自动生成符合 Notion 要求的 `reference_lines`。
  - `should pass hide_empty_groups to configuration`: 验证 `hide_empty_groups: true` 正常挂载。
  - `should build number chart with value or default count`: 验证指标卡构建与 `hide_title` 保留。
  - `should clean up incompatible options across chart subtypes`: 验证 line 专属的 `smooth_line` 不会出现在 donut 图配置中。
  - `should throw friendly error when chart_type is missing or invalid`: 验证非法 `chart_type` 抛出 `NotionMCPError`。

- **Form View 基础与宽容度测试**：
  - `should build form configuration with standard fields`: 验证标准 `is_form_closed`, `anonymous_submissions`, `submission_permissions`。
  - `should normalize form aliases (closed, anonymous, permissions)`: 验证别名映射。
  - `should map permission synonyms (readonly -> reader, edit -> editor)`: 验证权限同义词映射。
  - `should coerce string boolean values to native booleans`: 验证 `"true"` 转换。
  - `should throw error for invalid submission_permissions`: 验证权限枚举校验。

#### 2. `src/tools/composite/databases.views.test.ts` (端到端与集成测试)

- `should create chart view via databases tool with flat natural language inputs and target`: 模拟调用 `databases(notion, { action: 'create_view', type: 'chart', chart_type: 'column', x_axis: '阶段', y_axis: '预计工时', target: 50, hide_empty_groups: true })`，断言透传给 `notion.views.create` 的入参 100% 准确。
- `should create form view via databases tool with flat aliases and permission synonyms`: 模拟调用 `databases(notion, { action: 'create_view', type: 'form', closed: true, anonymous: true, permission: 'readonly' })`，断言映射为规范的 `is_form_closed: true, anonymous_submissions: true, submission_permissions: 'reader'`。
- `should pass quick_filters in create_view and update_view`: 验证快捷筛选栏透传。
- `should update chart view configuration via update_view`: 验证增量更新图表轴与外观配置。
- `should update form view configuration via update_view`: 验证更新表单开关状态。

---

## 5. 实施里程碑与验收标准

根据 `writing-plans` 技能标准，以下分解为粒度清晰、独立可测、立即可执行的任务列表（TDD 驱动）：

### Task 1: View Config 构建器扩展 (TDD 单元测试与实现)

**Files:**
- Modify: `src/tools/helpers/view-config.ts`
- Modify: `src/tools/helpers/view-config.test.ts`

**Interfaces:**
- Consumes: `resolvePropertyFromSchema()`, `findPropertyByType()`, `buildGroupByConfig()`
- Produces:
  - `buildChartAggregation(input, schema)`
  - `buildChartConfiguration(config, schema)`
  - `buildFormConfiguration(config)`
  - `buildViewConfiguration('chart' | 'form', config, schema)`

- [ ] **Step 1: 编写 Chart 视图与 Form 视图的失败单元测试**
  在 `view-config.test.ts` 中新增 `describe('chart view')` 与 `describe('form view')`，覆盖契约 1 至 8 的所有用例。
- [ ] **Step 2: 运行测试验证失败**
  运行命令：`bun x vitest run src/tools/helpers/view-config.test.ts`
  预期结果：测试因 `chart` / `form` 分支未实现而 FAIL。
- [ ] **Step 3: 实现 `view-config.ts` 中的 `buildChartAggregation` 与 `buildChartConfiguration`**
  完成图表类型校验、自然语言属性解析、必填 `sort: { type: 'manual' }` 注入、算子推导与子类型参数清洗。
- [ ] **Step 4: 实现 `view-config.ts` 中的 `buildFormConfiguration` 并挂载至 `buildViewConfiguration`**
  完成表单别名解析、布尔宽容转换与权限校验。
- [ ] **Step 5: 运行测试验证全绿**
  运行命令：`bun x vitest run src/tools/helpers/view-config.test.ts`
  预期结果：全部测试 PASS。
- [ ] **Step 6: 提交代码**
  ```bash
  git add src/tools/helpers/view-config.ts src/tools/helpers/view-config.test.ts
  git commit -m "feat(views): add form and chart configuration builders with ergonomic adaptation"
  ```

---

### Task 2: Databases 复合工具透传集成与集成测试

**Files:**
- Modify: `src/tools/composite/databases.ts`
- Modify: `src/tools/composite/databases.views.test.ts`

**Interfaces:**
- Consumes: `buildViewConfiguration()`, `notion.views.create()`, `notion.views.update()`
- Produces:
  - `databases(notion, { action: 'create_view', type: 'chart', chart_type, x_axis, y_axis, ... })`
  - `databases(notion, { action: 'create_view', type: 'form', is_form_closed, ... })`
  - `databases(notion, { action: 'update_view', view_id, ... })`

- [ ] **Step 1: 编写 databases.views.test.ts 针对 Form 和 Chart 的失败集成测试**
  在 `databases.views.test.ts` 中新增针对 `create_view` 和 `update_view` 传入 `chart` 与 `form` 扁平参数的 mock 测试。
- [ ] **Step 2: 运行测试验证失败**
  运行命令：`bun x vitest run src/tools/composite/databases.views.test.ts`
  预期结果：因 `databases.ts` 尚未提取图表与表单扁平参数而 FAIL。
- [ ] **Step 3: 在 `databases.ts` 中扩展 `createView` 与 `updateView` 参数提取逻辑**
  在组装 `rawConfig` 时将 `chart_type`, `x_axis`, `y_axis`, `value`, `is_form_closed` 等字段安全并入。
- [ ] **Step 4: 运行测试验证全绿**
  运行命令：`bun x vitest run src/tools/composite/databases.views.test.ts`
  预期结果：全部集成测试 PASS。
- [ ] **Step 5: 提交代码**
  ```bash
  git add src/tools/composite/databases.ts src/tools/composite/databases.views.test.ts
  git commit -m "feat(databases): integrate form and chart view creation and updates in composite tool"
  ```

---

### Task 3: Tool Definitions 压缩描述更新与全库联调构建校验

**Files:**
- Modify: `src/tools/tool-definitions.ts`

**Interfaces:**
- Consumes: MCP JSON Schema 规范
- Produces: 更新后的 `databases` 工具描述与入参规范

- [ ] **Step 1: 更新 `tool-definitions.ts`**
  更新 `databases` 的 action 描述、支持的 view type 枚举说明，以及增加 `chart_type`, `x_axis`, `y_axis`, `is_form_closed` 等紧凑参数定义。
- [ ] **Step 2: 执行代码风格与类型检查**
  运行命令：`bun run check`
  预期结果：Biome 无警告与错误，tsc `--noEmit` 0 错误。
- [ ] **Step 3: 执行全量测试套件验证**
  运行命令：`bun x vitest run`
  预期结果：全量 50+ 个测试文件、1400+ 个测试全部 PASS。
- [ ] **Step 4: 执行一键编译同步并验证一致性**
  运行命令：`bash /mnt/d/project/notion-mcp/rebuild-mcp.sh`
  预期结果：编译成功、时间戳一致、本地 MCP 进程平滑重启。
- [ ] **Step 5: 提交代码**
  ```bash
  git add src/tools/tool-definitions.ts
  git commit -m "feat(tools): expose form and chart parameters in databases tool definition"
  ```

---

## 6. 验收与交付检查清单 (Definition of Done)

- [ ] **架构红线守正**：没有增加任何浅层独立小工具，所有功能统一在 `databases` 工具中闭环。
- [ ] **人体工学宽容度**：中文属性名、大小写混用、布尔别名均能在测试中平滑自适应。
- [ ] **反向测试覆盖**：覆盖 Notion 官方 API 针对 chart_type 必填、x_axis 必带 manual sort、count 算子禁带 property_id 的全部逆向防御用例。
- [ ] **质量门禁通行**：`bun run check` 与 `bun x vitest run` 100% 绿灯，无任何 Lint/Type 错误。
