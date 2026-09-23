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

// 引入原生运行时生产产物
const { pages } = await import('/home/morav/.local/lib/better-notion-mcp/build/src/tools/composite/pages.js')
const { blocks } = await import('/home/morav/.local/lib/better-notion-mcp/build/src/tools/composite/blocks.js')

const TARGET_PAGE_ID = '3e44f4cf-c8e2-8070-8369-fdc15ed057a8'

console.log('================================================================================')
console.log('🚀 Better Notion MCP 统一客户端 AST 解析引擎 — 真机端到端验收')
console.log(`🎯 目标测试页面: ${TARGET_PAGE_ID}`)
console.log('================================================================================\n')

const testMarkdown = `# 架构重构最终验收

[bookmark](https://github.com "GitHub 官方")

<details>
<summary>## 核心架构设计</summary>
折叠正文内容：100% 保真还原大折叠标题！
</details>

> [!NOTE]
> 默认素雅纯净卡片（透明底/轻边框）

<callout color="default" icon="🚀">
原生 HTML Callout 标签内容，拒绝源码泄漏！
</callout>
`

try {
  // Step 1: replace_content 写入测试内容
  console.log('▶ Step 1: 执行 pages.replace_content 写入富文本 Markdown...')
  const replaceRes = await pages(notion, {
    action: 'replace_content',
    page_id: TARGET_PAGE_ID,
    new_str: testMarkdown
  })
  console.log('   replace_content 响应:', replaceRes)
  assert.strictEqual(replaceRes.replaced, true)
  assert.ok(replaceRes.block_count > 0, 'block_count 必须大于 0')
  console.log(`   ✅ 成功写入 ${replaceRes.block_count} 个 Notion Block！\n`)

  // Step 2: 获取底层真实 Block 树并严格校验
  console.log('▶ Step 2: 校验 Notion 真实 Block 树结构与保真度...')
  const childrenRes = await blocks(notion, {
    action: 'children',
    block_id: TARGET_PAGE_ID
  })
  const childBlocks = childrenRes.blocks || []
  console.log(`   获取到 ${childBlocks.length} 个直接子 Block:`)
  for (const b of childBlocks) {
    console.log(`     - [${b.type}] id=${b.id}`)
  }

  // 2.1 校验书签 Block
  const bookmarkBlock = childBlocks.find((b) => b.type === 'bookmark')
  assert.ok(bookmarkBlock, '必须存在原生 bookmark Block')
  assert.strictEqual(bookmarkBlock.bookmark.url, 'https://github.com')
  console.log('   ✅ 原生网络书签卡片存在: url = https://github.com')

  // 2.2 校验折叠大标题 Block
  const toggleHeading = childBlocks.find((b) => b.type === 'heading_2')
  assert.ok(toggleHeading, '必须存在 heading_2 Block')
  assert.strictEqual(toggleHeading.heading_2.is_toggleable, true, 'heading_2 必须是折叠标题 (is_toggleable: true)')
  const headingText = toggleHeading.heading_2.rich_text?.[0]?.plain_text
  assert.strictEqual(headingText, '核心架构设计', '折叠标题文本中严禁残留 "##"')
  console.log('   ✅ 原生折叠大标题存在: is_toggleable = true, plain_text = "核心架构设计" (无 ## 残留)')

  // 2.3 校验 Callout Block 与素雅风格
  const calloutBlocks = childBlocks.filter((b) => b.type === 'callout')
  assert.strictEqual(calloutBlocks.length, 2, '必须存在 2 个 callout Block (1 个 Alert + 1 个 HTML <callout>)')

  // 第一个 Callout (> [!NOTE])
  const noteCallout = calloutBlocks[0]
  assert.strictEqual(noteCallout.callout.color, 'default', 'GitHub Alert Callout 必须是素雅纯净风 (color: default)')
  console.log('   ✅ GitHub Alert Callout: color = default (素雅纯净底色)')

  // 第二个 Callout (<callout color="default" icon="🚀">)
  const htmlCallout = calloutBlocks[1]
  assert.strictEqual(htmlCallout.callout.color, 'default', 'HTML Callout 必须是 color: default')
  assert.strictEqual(htmlCallout.callout.icon?.emoji, '🚀', 'HTML Callout 必须正确解析 icon="🚀"')
  const htmlCalloutText = htmlCallout.callout.rich_text?.[0]?.plain_text
  assert.ok(htmlCalloutText?.includes('原生 HTML Callout 标签内容'), 'HTML Callout 正文必须正确解析')
  console.log('   ✅ 原生 HTML Callout: color = default, icon = 🚀, 内容完美保真')

  // 2.4 校验无泄露为普通文本的 <callout> 标签
  const paragraphBlocks = childBlocks.filter((b) => b.type === 'paragraph')
  for (const p of paragraphBlocks) {
    const text = p.paragraph.rich_text?.map((r) => r.plain_text).join('') || ''
    assert.ok(!text.includes('<callout'), '普通段落中严禁泄露 <callout> 源码标签')
    assert.ok(!text.includes('</callout>'), '普通段落中严禁泄露 </callout> 源码标签')
  }
  // 2.5 校验 pages: get 导出的完整 Markdown 内容
  console.log('▶ Step 2.5: 执行 pages.get 校验客户端 AST 导出的 Markdown 内容...')
  const getRes = await pages(notion, {
    action: 'get',
    page_id: TARGET_PAGE_ID
  })
  console.log('   pages.get content 内容预览:\n------------------------------------')
  console.log(getRes.content)
  console.log('------------------------------------')
  assert.ok(getRes.content.includes('[bookmark](https://github.com "GitHub 官方")'), 'pages.get 导出的内容必须包含高保真书签链接与标题')
  assert.ok(getRes.content.includes('<summary>## 核心架构设计</summary>'), 'pages.get 导出的内容必须包含折叠大标题')
  assert.ok(getRes.content.includes('> [!NOTE] 默认素雅纯净卡片'), 'pages.get 导出的内容必须包含素雅 Alert')
  console.log('   ✅ pages.get 校验通过: 客户端 AST 生成的 Markdown 100% 完美保真！\n')

  // Step 3: 读取端反向转译校验 (get_markdown)
  console.log('▶ Step 3: 执行 pages.get_markdown 校验反向提取保真度...')
  const markdownRes = await pages(notion, {
    action: 'get_markdown',
    page_id: TARGET_PAGE_ID
  })
  console.log('   提取到的 Markdown 内容预览:\n------------------------------------')
  console.log(markdownRes.markdown)
  console.log('------------------------------------')

  assert.ok(
    markdownRes.markdown.includes('[bookmark]('),
    '导出的 Markdown 必须包含还原后的 [bookmark](url)'
  )
  assert.ok(
    !markdownRes.markdown.includes('<unknown'),
    '导出的 Markdown 中严禁泄露 Notion 官方服务端的 <unknown ... alt="bookmark"/> 垃圾占位符'
  )
  assert.ok(
    markdownRes.markdown.includes('<callout icon="🚀">'),
    '导出的 Markdown 必须包含解析正确的 <callout icon="🚀">'
  )
  console.log('   ✅ get_markdown 校验通过: 成功还原 [bookmark]，无 <unknown 垃圾标签泄漏！\n')

  // Step 4: 清理测试页面，恢复干净初始状态
  console.log('▶ Step 4: 清理真机测试页面 (replace_content with "")...')
  const cleanRes = await pages(notion, {
    action: 'replace_content',
    page_id: TARGET_PAGE_ID,
    new_str: ''
  })
  console.log('   清理响应:', cleanRes)
  const afterClean = await blocks(notion, {
    action: 'children',
    block_id: TARGET_PAGE_ID
  })
  assert.strictEqual((afterClean.blocks || []).length, 0, '清理后页面子 Block 必须为 0')
  console.log('   ✅ 真机测试页面已彻底还原为空白初始状态！\n')

  console.log('================================================================================')
  console.log('🎉 恭喜！Better Notion MCP 客户端 AST 解析引擎端到端真机验收 100% 通过！')
  console.log('================================================================================')
} catch (error) {
  console.error('\n❌ 真机验收失败:', error)
  process.exit(1)
}
