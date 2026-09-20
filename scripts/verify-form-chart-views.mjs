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

// 引入原生运行时编译后的 databases 工具
const { databases } = await import('/home/morav/.local/lib/better-notion-mcp/build/src/tools/composite/databases.js')

const TARGET_DB_ID = 'db41a4e0-c924-4029-b82d-5bcb22d76cbf'
const REPORT = {
  startedAt: new Date().toISOString(),
  tests: []
}

console.log('🚀 开始 Form & Chart 视图在线端到端实测验收...')
console.log(`🎯 目标数据库: ${TARGET_DB_ID}`)

let formViewRes
let columnChartViewRes
let kpiViewRes

try {
  // -------------------------------------------------------------
  // Test 1: Form 视图在线创建
  // -------------------------------------------------------------
  console.log('\n==================================================')
  console.log('▶ Test 1: Form 视图在线创建 (📝 需求收集表单)')
  console.log('==================================================')

  formViewRes = await databases(notion, {
    action: 'create_view',
    database_id: TARGET_DB_ID,
    name: '📝 需求收集表单 (Live Test)',
    type: 'form',
    closed: false,
    anonymous: true,
    submission_permissions: 'reader'
  })

  console.log(
    '✓ 创建响应:',
    JSON.stringify(
      {
        view_id: formViewRes.view_id,
        name: formViewRes.name,
        type: formViewRes.type,
        url: formViewRes.url,
        config: formViewRes.view?.configuration
      },
      null,
      2
    )
  )

  assert.ok(formViewRes.view_id, 'Test 1 断言失败: view_id 必须存在')
  assert.ok(formViewRes.url, 'Test 1 断言失败: url 必须存在')
  assert.strictEqual(formViewRes.type, 'form', 'Test 1 断言失败: type 必须为 form')
  assert.strictEqual(formViewRes.view?.configuration?.type, 'form', 'Test 1 断言失败: configuration.type 必须为 form')
  assert.strictEqual(
    formViewRes.view?.configuration?.is_form_closed,
    false,
    'Test 1 断言失败: is_form_closed 必须为 false'
  )
  assert.strictEqual(
    formViewRes.view?.configuration?.anonymous_submissions,
    true,
    'Test 1 断言失败: anonymous_submissions 必须为 true'
  )
  assert.strictEqual(
    formViewRes.view?.configuration?.submission_permissions,
    'reader',
    'Test 1 断言失败: submission_permissions 必须为 reader'
  )
  console.log('✅ Test 1 断言完全通过！Form 视图创建成功且权限别名正确映射。')

  REPORT.tests.push({
    test: 'Test 1: Form 视图在线创建',
    status: 'PASSED',
    view_id: formViewRes.view_id,
    url: formViewRes.url
  })

  // -------------------------------------------------------------
  // Test 2: 堆叠柱状图在线创建 (Column Chart)
  // -------------------------------------------------------------
  console.log('\n==================================================')
  console.log('▶ Test 2: 堆叠柱状图在线创建 (📊 任务状态堆叠柱状图)')
  console.log('==================================================')

  columnChartViewRes = await databases(notion, {
    action: 'create_view',
    database_id: TARGET_DB_ID,
    name: '📊 任务状态堆叠柱状图 (Live Test)',
    type: 'chart',
    chart_type: 'column',
    group_style: 'stacked',
    x_axis: '阶段',
    stack_by: '优先级',
    y_axis: '预估工时',
    target: 50
  })

  console.log(
    '✓ 创建响应:',
    JSON.stringify(
      {
        view_id: columnChartViewRes.view_id,
        name: columnChartViewRes.name,
        type: columnChartViewRes.type,
        url: columnChartViewRes.url,
        config: columnChartViewRes.view?.configuration
      },
      null,
      2
    )
  )

  assert.ok(columnChartViewRes.view_id, 'Test 2 断言失败: view_id 必须存在')
  assert.strictEqual(columnChartViewRes.type, 'chart', 'Test 2 断言失败: type 必须为 chart')

  const chartConfig = columnChartViewRes.view?.configuration
  assert.strictEqual(chartConfig?.type, 'chart', 'Test 2 断言失败: configuration.type 必须为 chart')
  assert.strictEqual(chartConfig?.chart_type, 'column', 'Test 2 断言失败: chart_type 必须为 column')
  assert.strictEqual(chartConfig?.group_style, 'normal', 'Test 2 断言失败: group_style 必须规范化为 normal')

  // 验证属性自动解析与 manual sort 注入
  assert.ok(chartConfig?.x_axis?.property_id, 'Test 2 断言失败: x_axis.property_id 必须被自动解析')
  assert.strictEqual(chartConfig?.x_axis?.sort?.type, 'manual', 'Test 2 断言失败: x_axis 必须注入 sort manual 防御')
  assert.ok(chartConfig?.stack_by?.property_id, 'Test 2 断言失败: stack_by.property_id 必须被自动解析')
  assert.strictEqual(chartConfig?.stack_by?.sort?.type, 'manual', 'Test 2 断言失败: stack_by 必须注入 sort manual 防御')

  // 验证 y_axis 聚合推断与 target 映射
  assert.ok(chartConfig?.y_axis?.property_id, 'Test 2 断言失败: y_axis.property_id 必须被自动解析')
  assert.strictEqual(chartConfig?.y_axis?.aggregator, 'sum', 'Test 2 断言失败: number 列默认聚合器必须推断为 sum')
  assert.ok(Array.isArray(chartConfig?.reference_lines), 'Test 2 断言失败: reference_lines 必须为数组')
  assert.strictEqual(chartConfig?.reference_lines[0]?.value, 50, 'Test 2 断言失败: reference_lines[0].value 必须为 50')
  console.log('✅ Test 2 断言完全通过！堆叠柱状图属性解析、manual sort、数值聚合与目标线全部正确。')

  REPORT.tests.push({
    test: 'Test 2: 堆叠柱状图在线创建 (Column Chart)',
    status: 'PASSED',
    view_id: columnChartViewRes.view_id,
    url: columnChartViewRes.url
  })

  // -------------------------------------------------------------
  // Test 3: 单值指标卡在线创建 (Number KPI Card)
  // -------------------------------------------------------------
  console.log('\n==================================================')
  console.log('▶ Test 3: 单值指标卡在线创建 (🔢 任务总工时 KPI)')
  console.log('==================================================')

  kpiViewRes = await databases(notion, {
    action: 'create_view',
    database_id: TARGET_DB_ID,
    name: '🔢 任务总工时 KPI (Live Test)',
    type: 'chart',
    chart_type: 'number',
    y_axis: '预估工时'
  })

  console.log(
    '✓ 创建响应:',
    JSON.stringify(
      {
        view_id: kpiViewRes.view_id,
        name: kpiViewRes.name,
        type: kpiViewRes.type,
        url: kpiViewRes.url,
        config: kpiViewRes.view?.configuration
      },
      null,
      2
    )
  )

  assert.ok(kpiViewRes.view_id, 'Test 3 断言失败: view_id 必须存在')
  assert.strictEqual(kpiViewRes.type, 'chart', 'Test 3 断言失败: type 必须为 chart')

  const kpiConfig = kpiViewRes.view?.configuration
  assert.strictEqual(kpiConfig?.type, 'chart', 'Test 3 断言失败: configuration.type 必须为 chart')
  assert.strictEqual(kpiConfig?.chart_type, 'number', 'Test 3 断言失败: chart_type 必须为 number')
  assert.ok(kpiConfig?.value?.property_id, 'Test 3 断言失败: value.property_id 必须存在')
  assert.strictEqual(kpiConfig?.value?.aggregator, 'sum', 'Test 3 断言失败: value.aggregator 必须为 sum')
  assert.strictEqual(kpiConfig?.x_axis, undefined, 'Test 3 断言失败: number KPI 严禁包含 x_axis 污染字段')
  console.log('✅ Test 3 断言完全通过！单值指标卡 value 结构自动推导且无多余维度污染。')

  REPORT.tests.push({
    test: 'Test 3: 单值指标卡在线创建 (Number KPI Card)',
    status: 'PASSED',
    view_id: kpiViewRes.view_id,
    url: kpiViewRes.url
  })

  // -------------------------------------------------------------
  // Test 4: 视图列表核验 (List Views)
  // -------------------------------------------------------------
  console.log('\n==================================================')
  console.log('▶ Test 4: 视图列表核验 (List Views)')
  console.log('==================================================')

  const listRes = await databases(notion, {
    action: 'list_views',
    database_id: TARGET_DB_ID
  })

  console.log(`✓ 检索到总计 ${listRes.total} 个视图`)
  const viewIdSet = new Set(listRes.views.map((v) => v.id))

  assert.ok(viewIdSet.has(formViewRes.view_id), `Test 4 断言失败: 未在列表中检索到 Form 视图 (${formViewRes.view_id})`)
  assert.ok(
    viewIdSet.has(columnChartViewRes.view_id),
    `Test 4 断言失败: 未在列表中检索到 Column Chart 视图 (${columnChartViewRes.view_id})`
  )
  assert.ok(viewIdSet.has(kpiViewRes.view_id), `Test 4 断言失败: 未在列表中检索到 KPI 视图 (${kpiViewRes.view_id})`)
  console.log('✅ Test 4 断言完全通过！新建的 3 个视图均完整存在于数据库视图索引中。')

  REPORT.tests.push({
    test: 'Test 4: 视图列表核验 (List Views)',
    status: 'PASSED',
    total_views: listRes.total
  })

  // -------------------------------------------------------------
  // Test 5: 视图更新与安全清理 (Update & Delete)
  // -------------------------------------------------------------
  console.log('\n==================================================')
  console.log('▶ Test 5: 视图更新与安全清理 (Update & Delete)')
  console.log('==================================================')

  // 5.1 更新堆叠柱状图名称为正式交付名称
  const updatedChartName = '📊 任务状态堆叠柱状图 (Live 验收交付)'
  console.log(`正在更新 Column Chart 视图名称 -> "${updatedChartName}"...`)
  const updateRes = await databases(notion, {
    action: 'update_view',
    view_id: columnChartViewRes.view_id,
    name: updatedChartName
  })

  assert.strictEqual(updateRes.updated, true, 'Test 5 断言失败: updateRes.updated 必须为 true')
  assert.strictEqual(updateRes.view?.name, updatedChartName, 'Test 5 断言失败: 更新后名称不匹配')
  console.log('✓ 视图重命名成功:', updateRes.view?.name)

  // 5.2 清理 Form 测试视图与 KPI 测试视图，保留最具有代表性的堆叠柱状图供 PM 验收
  console.log(`正在安全删除临时 Form 视图 (${formViewRes.view_id})...`)
  const delFormRes = await databases(notion, {
    action: 'delete_view',
    view_id: formViewRes.view_id
  })
  assert.strictEqual(delFormRes.deleted, true, 'Test 5 断言失败: Form 视图删除失败')
  console.log('✓ Form 视图删除成功')

  console.log(`正在安全删除临时 KPI 视图 (${kpiViewRes.view_id})...`)
  const delKpiRes = await databases(notion, {
    action: 'delete_view',
    view_id: kpiViewRes.view_id
  })
  assert.strictEqual(delKpiRes.deleted, true, 'Test 5 断言失败: KPI 视图删除失败')
  console.log('✓ KPI 视图删除成功')

  // 5.3 检索最终保留的柱状图视图详情
  const finalViewRes = await databases(notion, {
    action: 'get_view',
    view_id: columnChartViewRes.view_id
  })

  console.log(
    '✓ 最终保留验收视图详情:',
    JSON.stringify(
      {
        id: finalViewRes.view?.id,
        name: finalViewRes.view?.name,
        type: finalViewRes.view?.type,
        url: finalViewRes.view?.url,
        configuration: finalViewRes.view?.configuration
      },
      null,
      2
    )
  )

  console.log('✅ Test 5 断言完全通过！视图更新与环境安全清理成功，已保留最具代表性的堆叠柱状图。')

  REPORT.tests.push({
    test: 'Test 5: 视图更新与安全清理 (Update & Delete)',
    status: 'PASSED',
    retained_view: {
      id: finalViewRes.view?.id,
      name: finalViewRes.view?.name,
      url: finalViewRes.view?.url
    }
  })

  REPORT.completedAt = new Date().toISOString()
  REPORT.allPassed = true

  console.log('\n🎉 ==================================================')
  console.log('🎉 全部 5 项在线端到端实测验证 100% 通过！')
  console.log('🎉 验收页面直达链接: https://app.notion.com/p/one2agi/3de4f4cfc8e280f9acbddff14d6ec10e')
  console.log(`🎉 最终保留视图直达: ${finalViewRes.view?.url}`)
  console.log('==================================================\n')
} catch (err) {
  console.error('\n❌ 实测验收失败:', err)
  REPORT.allPassed = false
  REPORT.error = err?.message || String(err)

  // 异常时尽力清理测试视图
  if (formViewRes?.view_id) {
    try {
      await databases(notion, { action: 'delete_view', view_id: formViewRes.view_id })
    } catch {}
  }
  if (columnChartViewRes?.view_id) {
    try {
      await databases(notion, { action: 'delete_view', view_id: columnChartViewRes.view_id })
    } catch {}
  }
  if (kpiViewRes?.view_id) {
    try {
      await databases(notion, { action: 'delete_view', view_id: kpiViewRes.view_id })
    } catch {}
  }

  process.exit(1)
}
