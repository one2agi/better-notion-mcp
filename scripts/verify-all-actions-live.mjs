import assert from 'node:assert'
import fs from 'node:fs'
import { Client } from '@notionhq/client'

// 1. 加载凭据与客户端
const envPath = '/home/morav/.config/better-notion-mcp/.env'
let token = process.env.NOTION_TOKEN
if (!token && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('NOTION_TOKEN=')) {
      token = trimmed.slice('NOTION_TOKEN='.length).trim()
    }
  }
}

if (!token) {
  console.error('❌ 未找到 NOTION_TOKEN！')
  process.exit(1)
}

const notion = new Client({ auth: token })

// 引入原生运行时生产库路径
const { databases } = await import('/home/morav/.local/lib/better-notion-mcp/build/src/tools/composite/databases.js')
const { blocks } = await import('/home/morav/.local/lib/better-notion-mcp/build/src/tools/composite/blocks.js')

const ACCEPTANCE_PAGE_ID = '3de4f4cf-c8e2-80f9-acbd-dff14d6ec10e'
const TARGET_DB_ID = 'db41a4e0-c924-4029-b82d-5bcb22d76cbf'

console.log('================================================================================')
console.log('🧪 Better Notion MCP 重构后全生命周期真实在线闭环验收启动')
console.log('================================================================================\n')

const report = {
  tested_actions: [],
  failed_actions: [],
  details: {}
}

async function runStep(name, fn) {
  process.stdout.write(`▶ 测试中: ${name}... `)
  try {
    const res = await fn()
    report.tested_actions.push(name)
    report.details[name] = res
    console.log('✅ PASS')
    return res
  } catch (err) {
    report.failed_actions.push({ name, error: err.message || String(err) })
    console.log(`❌ FAIL: ${err.message || err}`)
    throw err
  }
}

// 1. 测试容器操作：从零创建全新子数据库 (包含人体工学数组选项自适应)
let createdDbId = null
await runStep('1. databases.create (从零建库 + 扁平选项自适应 + 标题校验)', async () => {
  const res = await databases(notion, {
    action: 'create',
    parent_id: ACCEPTANCE_PAGE_ID,
    title: '🧪 重构全矩阵实测库 (Live All-Matrix DB)',
    is_inline: true,
    icon: '📊',
    properties: {
      任务名称: { title: {} },
      处理阶段: { select: ['📋 待评审', '🚀 进行中', '✅ 完结'] },
      优先级标签: { multi_select: ['P0-核心', 'P1-重要', '安全合规'] },
      预估工时: { number: {} },
      完成状态: { checkbox: {} }
    }
  })
  assert.ok(res.database_id, '未返回 database_id')
  assert.ok(res.created, 'created 必须为 true')
  createdDbId = res.database_id
  return { database_id: res.database_id, url: res.url }
})

// 2. 测试容器信息读取：databases.get
await runStep('2. databases.get (读取新建库元数据与 Schema 映射)', async () => {
  const res = await databases(notion, {
    action: 'get',
    database_id: createdDbId
  })
  assert.strictEqual(res.database_id, createdDbId)
  assert.ok(res.schema['任务名称'], '必须包含 任务名称 标题属性')
  assert.ok(res.schema['处理阶段'], '必须包含 处理阶段 select 属性')
  return { title: res.title, schemaKeys: Object.keys(res.schema) }
})

// 3. 测试容器更新：databases.update_database
await runStep('3. databases.update_database (更新数据库标题与描述)', async () => {
  const res = await databases(notion, {
    action: 'update_database',
    database_id: createdDbId,
    title: '🧪 重构全矩阵实测库 (已动态重命名)',
    description: '此数据库由重构后的 containers.ts 自动化创建与更新'
  })
  assert.ok(res.updated, 'updated 必须为 true')
  return { updated: true }
})

// 4. 测试模板列表查询：databases.list_templates
await runStep('4. databases.list_templates (查询数据源模板列表)', async () => {
  const res = await databases(notion, {
    action: 'list_templates',
    database_id: createdDbId
  })
  assert.strictEqual(typeof res.total, 'number')
  return { total: res.total }
})

// 5. 测试批量创建记录行：databases.create_page (batch mode)
let pageIds = []
await runStep('5. databases.create_page (批量并发写入 3 条任务数据)', async () => {
  const res = await databases(notion, {
    action: 'create_page',
    database_id: createdDbId,
    pages: [
      {
        properties: {
          任务名称: '任务 1: 内存分析引擎重构',
          处理阶段: '🚀 进行中',
          优先级标签: ['P0-核心'],
          预估工时: 16,
          完成状态: false
        }
      },
      {
        properties: {
          任务名称: '任务 2: 多维视图防冲刷合并',
          处理阶段: '✅ 完结',
          优先级标签: ['P0-核心', '安全合规'],
          预估工时: 24,
          完成状态: true
        }
      },
      {
        properties: {
          任务名称: '任务 3: 架构规范与实施计划归档',
          处理阶段: '📋 待评审',
          优先级标签: ['P1-重要'],
          预估工时: 8,
          完成状态: false
        }
      }
    ]
  })
  assert.strictEqual(res.processed, 3)
  pageIds = res.results.map((r) => r.page_id)
  assert.strictEqual(pageIds.length, 3)
  return { processed: res.processed, page_ids: pageIds }
})

// 6. 测试批量更新记录行：databases.update_page (batch mode)
await runStep('6. databases.update_page (批量修改已建任务工时与状态)', async () => {
  const res = await databases(notion, {
    action: 'update_page',
    pages: [
      {
        page_id: pageIds[0],
        properties: { 预估工时: 18 }
      },
      {
        page_id: pageIds[2],
        properties: { 处理阶段: '🚀 进行中', 预估工时: 10 }
      }
    ]
  })
  assert.strictEqual(res.processed, 2)
  return { processed: res.processed }
})

// 7. 测试轻量 BI 统计分析：databases.aggregate (5 种数学算子)
await runStep('7. databases.aggregate (流式聚合 5 种数学统计指标)', async () => {
  const res = await databases(notion, {
    action: 'aggregate',
    database_id: createdDbId,
    aggregations: [
      { type: 'count', alias: '总任务数' },
      { type: 'sum', property: '预估工时', alias: '总工时' },
      { type: 'avg', property: '预估工时', alias: '平均工时' },
      { type: 'max', property: '预估工时', alias: '最大工时' },
      { type: 'min', property: '预估工时', alias: '最小工时' }
    ]
  })
  assert.strictEqual(res.results['总任务数'], 3)
  assert.strictEqual(res.results['总工时'], 18 + 24 + 10) // 52
  assert.strictEqual(res.results['平均工时'], (18 + 24 + 10) / 3) // 17.333...
  assert.strictEqual(res.results['最大工时'], 24)
  assert.strictEqual(res.results['最小工时'], 10)
  return res.results
})

// 8. 测试多维度分组统计分析：databases.group_by
await runStep('8. databases.group_by (按处理阶段分类下钻统计)', async () => {
  const res = await databases(notion, {
    action: 'group_by',
    database_id: createdDbId,
    group_by: { property: '处理阶段' },
    aggregations: [
      { type: 'count', alias: '阶段任务数' },
      { type: 'sum', property: '预估工时', alias: '阶段工时' }
    ]
  })
  assert.strictEqual(res.total_rows_scanned, 3)
  assert.strictEqual(res.groups.length, 2) // 进行中 (2), 完结 (1)
  return res.groups
})

// 9. 测试全字段检索与排序：databases.query (search + sorts)
await runStep('9. databases.query (跨文本智能搜索 + 复合降序排序)', async () => {
  const res = await databases(notion, {
    action: 'query',
    database_id: createdDbId,
    search: '引擎',
    sorts: [{ property: '预估工时', direction: 'descending' }]
  })
  assert.strictEqual(res.total, 1)
  assert.strictEqual(res.results[0]['任务名称'], '任务 1: 内存分析引擎重构')
  return { matched: res.total, top: res.results[0]['任务名称'] }
})

// 10. 测试表单视图创建：databases.create_view (type: form)
let formViewId = null
await runStep('10. databases.create_view (表单视图创建 + 匿名权限映射)', async () => {
  const res = await databases(notion, {
    action: 'create_view',
    database_id: createdDbId,
    name: '📝 任务申报表单 (Live Form)',
    type: 'form',
    closed: false,
    anonymous: true,
    submission_permissions: 'reader'
  })
  assert.ok(res.view_id, '未返回 view_id')
  formViewId = res.view_id
  return { view_id: res.view_id, url: res.url }
})

// 11. 测试柱状图表视图创建：databases.create_view (type: chart)
let chartViewId = null
await runStep('11. databases.create_view (柱状图表视图 + 自动注入 manual sort)', async () => {
  const res = await databases(notion, {
    action: 'create_view',
    database_id: createdDbId,
    name: '📊 阶段工时柱状图 (Live Chart)',
    type: 'chart',
    chart_type: 'column',
    x_axis: '处理阶段',
    y_axis: '预估工时',
    target: 30
  })
  assert.ok(res.view_id, '未返回 view_id')
  chartViewId = res.view_id
  return { view_id: res.view_id }
})

// 12. 测试视图增量更新与防冲刷：databases.update_view
await runStep('12. databases.update_view (增量重命名验证防冲刷保护)', async () => {
  const res = await databases(notion, {
    action: 'update_view',
    view_id: chartViewId,
    name: '📊 阶段工时柱状图 (已安全重命名)'
  })
  assert.ok(res.updated, 'updated 必须为 true')
  return { updated: true }
})

// 13. 测试视图列表查询：databases.list_views
await runStep('13. databases.list_views (全量视图检索)', async () => {
  const res = await databases(notion, {
    action: 'list_views',
    database_id: createdDbId
  })
  assert.ok(res.total >= 3, '新建视图应至少有 3 个')
  return { total: res.total, views: res.views.map((v) => v.name) }
})

// 14. 测试视图安全销毁：databases.delete_view
await runStep('14. databases.delete_view (安全销毁临时表单视图)', async () => {
  const res = await databases(notion, {
    action: 'delete_view',
    view_id: formViewId
  })
  assert.ok(res.deleted, 'deleted 必须为 true')
  return { deleted: true }
})

// 15. 测试数据行批量归档销毁：databases.delete_page
await runStep('15. databases.delete_page (批量归档清理已测试数据行)', async () => {
  const res = await databases(notion, {
    action: 'delete_page',
    page_ids: [pageIds[0], pageIds[1]]
  })
  assert.strictEqual(res.processed, 2)
  return { processed: res.processed }
})

console.log('\n================================================================================')
console.log(`🎉 全部 ${report.tested_actions.length} 项全生命周期真机实测 100% 通过！`)
console.log('================================================================================\n')
