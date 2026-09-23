/**
 * Markdown to Notion Blocks Converter
 * Converts markdown text to Notion block format
 * Supports: headings, paragraphs, lists, code, quotes, dividers,
 *           tables, toggles, callouts, images, bookmarks, embeds,
 *           equations, columns, table of contents, breadcrumb
 */

import { isSafeUrl } from './security.js'

export interface NotionBlock {
  object: 'block'
  type: string
  [key: string]: any
}

export interface MarkdownWarning {
  code: string
  message: string
  block_index: number
  original_line: string
}

export interface MarkdownParseResult {
  blocks: NotionBlock[]
  warnings: MarkdownWarning[]
}

export interface RichText {
  type: 'text' | 'mention'
  text: {
    content: string
    link?: { url: string } | null
  }
  mention?: {
    page?: { id: string }
    database?: { id: string }
    [key: string]: any
  }
  annotations: {
    bold: boolean
    italic: boolean
    strikethrough: boolean
    underline: boolean
    code: boolean
    color: string
  }
  plain_text?: string
  href?: string | null
}

/** Create a mention rich text element (no text property - Notion API rejects it on mentions) */
function createMention(
  mentionData: RichText['mention'],
  title: string,
  formatting: { bold: boolean; italic: boolean; code: boolean; strikethrough: boolean }
): RichText {
  return {
    type: 'mention',
    mention: mentionData,
    plain_text: title,
    annotations: {
      bold: formatting.bold,
      italic: formatting.italic,
      strikethrough: formatting.strikethrough,
      underline: false,
      code: formatting.code,
      color: 'default'
    }
  } as RichText
}

// Regular expressions for block parsing
const CALLOUT_REGEX =
  /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|ERROR|DANGER)\]\s*(?:\{([^}]+)\})?\s*(.*)/i
const HTML_CALLOUT_OPEN_REGEX = /^<callout(?:\s+([^>]*))?>/i
const IMAGE_REGEX = /^\s*!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]+)")?\s*\)\s*$/
const BOOKMARK_REGEX = /^\s*\[\s*(bookmark|embed|书签|网页书签)\s*\]\(\s*([^)\s]+)(?:\s+"([^"]+)")?\s*\)\s*$/i
const CHECKED_LIST_REGEX = /^\s*[-*+]\s\[([ xX])\](?:\s|$)/
const BULLETED_LIST_REGEX = /^\s*[-*+]\s/
const NUMBERED_LIST_REGEX = /^\s*\d+\.\s/
const DIVIDER_REGEX = /^[-*]{3,}$/
const MENTION_ID_REGEX = /([a-f0-9]{32})/
const INLINE_SUMMARY_REGEX = /^<details>\s*<summary>(.*?)<\/summary>(.*?)(<\/details>)?$/
const SUMMARY_REGEX = /<summary>(.*?)<\/summary>/
const COLUMN_REGEX = /^:::column(?:\{width=([\d.]+)\})?$/
const TABLE_SEPARATOR_REGEX = /^[-:]+$/
const SYNCED_REF_REGEX = /^:::synced\s*\{\s*(?:from=)?["']?([^"'}]+)["']?\s*\}(?::::)?$/

/**
 * Sanitizes block AST before sending to Notion API (e.g. blocks.children.append).
 * Notion API rejects column_ratio in format when creating column blocks.
 */
export function sanitizeBlocksForAppend(blocks: NotionBlock[]): NotionBlock[] {
  for (const block of blocks) {
    if (block.type === 'column' && (block as any).column?.format?.column_ratio !== undefined) {
      delete (block as any).column.format.column_ratio
      if (Object.keys((block as any).column.format).length === 0) {
        delete (block as any).column.format
      }
    }
    if (block.type === 'column_list' && (block as any).column_list?.children) {
      for (const col of (block as any).column_list.children) {
        if (col.type === 'column' && col.column?.format?.column_ratio !== undefined) {
          delete col.column.format.column_ratio
          if (Object.keys(col.column.format).length === 0) {
            delete col.column.format
          }
        }
      }
    }
  }
  return blocks
}

/**
 * Convert markdown string to Notion blocks
 */
class MarkdownParser {
  private lines: string[]
  private blocks: NotionBlock[] = []
  private currentList: NotionBlock[] = []
  private currentListType: 'bulleted' | 'numbered' | null = null
  private warnings: MarkdownWarning[] = []

  constructor(markdown: string) {
    this.lines = markdown.split('\n')
  }

  public getWarnings(): MarkdownWarning[] {
    return this.warnings
  }

  private addWarning(code: string, message: string, line: string): void {
    this.warnings.push({
      code,
      message,
      block_index: this.blocks.length,
      original_line: line
    })
  }

  public parse(): NotionBlock[] {
    for (let i = 0; i < this.lines.length; i++) {
      i = this.parseBlock(i)
    }

    // Flush remaining list
    if (this.currentList.length > 0) {
      for (let j = 0; j < this.currentList.length; j++) {
        this.blocks.push(this.currentList[j])
      }
    }

    return this.blocks
  }

  private parseBlock(i: number): number {
    const line = this.lines[i]

    // Flush list if we're not in a list anymore
    if (this.currentListType && !isListItem(line)) {
      for (let j = 0; j < this.currentList.length; j++) {
        this.blocks.push(this.currentList[j])
      }
      this.currentList = []
      this.currentListType = null
    }

    // Cache trimmed line for performance to avoid repeated string allocations
    const trimmedLine = line.trim()

    // Skip empty lines
    if (!trimmedLine) {
      return i
    }

    // Table of Contents [toc]
    if (trimmedLine === '[toc]' || trimmedLine === '[TOC]') {
      this.blocks.push(createTableOfContents())
      return i
    }

    // Breadcrumb [breadcrumb]
    if (trimmedLine === '[breadcrumb]' || trimmedLine === '[BREADCRUMB]') {
      this.blocks.push(createBreadcrumb())
      return i
    }

    // Equation block $...$
    if (trimmedLine.startsWith('$$')) {
      const eqData = parseEquationBlock(this.lines, i, trimmedLine)
      this.blocks.push(eqData.block)
      return eqData.endIndex
    }

    // Callout > [!TYPE] content or > [!TYPE]\n> content
    const calloutMatch = line.match(CALLOUT_REGEX)
    if (calloutMatch) {
      const calloutData = parseCalloutBlock(this.lines, i, calloutMatch)
      this.blocks.push(calloutData.block)
      return calloutData.endIndex
    }

    // HTML Callout <callout color="..." icon="...">
    const htmlCalloutMatch = trimmedLine.match(HTML_CALLOUT_OPEN_REGEX)
    if (htmlCalloutMatch) {
      const calloutData = parseHtmlCallout(this.lines, i, htmlCalloutMatch)
      this.blocks.push(calloutData.block)
      return calloutData.endIndex
    }

    // Image ![alt](url)
    const imageMatch = trimmedLine.match(IMAGE_REGEX)
    if (imageMatch) {
      const url = imageMatch[2]
      if (isSafeUrl(url)) {
        this.blocks.push(createImage(url, imageMatch[1]))
      } else {
        this.addWarning('UNSAFE_URL', `Unsafe image URL rejected; downgraded to paragraph: ${url}`, line)
        this.blocks.push(createParagraph(line))
      }
      return i
    }

    // Bookmark/Embed [bookmark](url) or [embed](url) or [书签](url) or [网页书签](url)
    const bookmarkMatch = trimmedLine.match(BOOKMARK_REGEX)
    if (bookmarkMatch) {
      const linkText = bookmarkMatch[1].toLowerCase()
      const isEmbed = linkText.includes('embed')
      const type = isEmbed ? 'embed' : 'bookmark'
      const url = bookmarkMatch[2]
      const caption = bookmarkMatch[3]
      if (isSafeUrl(url)) {
        if (type === 'embed') {
          this.blocks.push(createEmbed(url))
        } else {
          this.blocks.push(createBookmark(url, caption))
        }
      } else {
        this.addWarning('UNSAFE_URL', `Unsafe ${type} URL rejected; downgraded to paragraph: ${url}`, line)
        this.blocks.push(createParagraph(line))
      }
      return i
    }

    // Toggle <details><summary>Title</summary>
    if (trimmedLine === '<details>' || trimmedLine.startsWith('<details>')) {
      const toggleData = parseToggle(this.lines, i)
      if (toggleData.unclosed) {
        this.addWarning('MALFORMED_BLOCK', `Unclosed <details> toggle starting at line ${i + 1}`, line)
      }
      this.blocks.push(createToggle(toggleData.title, toggleData.children))
      return toggleData.endIndex
    }

    // Column layout :::columns
    if (trimmedLine === ':::columns') {
      const columnData = parseColumns(this.lines, i)
      this.blocks.push(createColumnList(columnData.columns, columnData.widthRatios))
      return columnData.endIndex
    }

    // Synced block reference :::synced{from="block_id"}:::
    const syncedRefMatch = trimmedLine.match(SYNCED_REF_REGEX)
    if (syncedRefMatch) {
      this.blocks.push(createSyncedBlock(syncedRefMatch[1]))
      return i
    }

    // Original synced block :::synced ... :::end
    if (trimmedLine === ':::synced') {
      const syncedData = parseSyncedBlock(this.lines, i)
      this.blocks.push(createSyncedBlock(null, syncedData.children))
      return syncedData.endIndex
    }

    // Table (pipe-delimited)
    if (line.includes('|') && trimmedLine.startsWith('|')) {
      const tableData = parseTable(this.lines, i)
      if (tableData) {
        this.blocks.push(createTable(tableData.headers, tableData.rows, tableData.hasHeader))
        return tableData.endIndex
      }
    }

    // Heading
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      this.blocks.push(createHeading(1, line.slice(2)))
    } else if (line.startsWith('## ') && !line.startsWith('### ')) {
      this.blocks.push(createHeading(2, line.slice(3)))
    } else if (line.startsWith('### ') && !line.startsWith('#### ')) {
      this.blocks.push(createHeading(3, line.slice(4)))
    } else if (line.startsWith('#### ') && !line.startsWith('##### ')) {
      this.blocks.push(createHeading(4, line.slice(5)))
    }

    // Code block
    else if (line.startsWith('```')) {
      const codeData = parseCodeBlock(this.lines, i, line)
      if (codeData.warning) {
        this.addWarning('MALFORMED_BLOCK', codeData.warning, line)
      }
      this.blocks.push(codeData.block)
      return codeData.endIndex
    }

    // Task list / Checkbox list - [ ] or - [x]
    else if (CHECKED_LIST_REGEX.test(line)) {
      const match = line.match(CHECKED_LIST_REGEX)
      const checked = match ? match[1].toLowerCase() === 'x' : false
      const text = line.replace(CHECKED_LIST_REGEX, '')
      this.currentListType = 'bulleted'
      this.currentList.push(createTodoItem(text, checked))
    }
    // Bulleted list
    else if (BULLETED_LIST_REGEX.test(line)) {
      const text = line.replace(BULLETED_LIST_REGEX, '')
      this.currentListType = 'bulleted'
      this.currentList.push(createBulletedListItem(text))
    }
    // Numbered list
    else if (NUMBERED_LIST_REGEX.test(line)) {
      const text = line.replace(NUMBERED_LIST_REGEX, '')
      this.currentListType = 'numbered'
      this.currentList.push(createNumberedListItem(text))
    }
    // Quote
    else if (line.startsWith('> ')) {
      this.blocks.push(createQuote(line.slice(2)))
    }
    // Divider
    else if (DIVIDER_REGEX.test(line)) {
      this.blocks.push(createDivider())
    }
    // Regular paragraph
    else {
      this.blocks.push(createParagraph(line))
    }

    return i
  }
}

export function markdownToBlocks(markdown: string): MarkdownParseResult {
  const parser = new MarkdownParser(markdown)
  const blocks = parser.parse()
  const warnings = parser.getWarnings()
  return { blocks, warnings }
}

/**
 * Convert Notion blocks to markdown
 */
function indentChildren(children: NotionBlock[]): string {
  // Optimized: use highly optimized C++ RegExp engine instead of creating thousands of intermediate JS array/string objects
  return blocksToMarkdown(children).replace(/^/gm, '  ')
}

function calloutToMarkdown(block: NotionBlock, lines: string[]): void {
  const calloutText = richTextToMarkdown(block.callout.rich_text)
  const calloutIcon = block.callout.icon?.emoji || ''
  const calloutType = getCalloutTypeFromIcon(calloutIcon)

  const attrs: string[] = []
  if (block.callout.color && block.callout.color !== 'default') {
    attrs.push(`color="${block.callout.color}"`)
  }
  const defaultIcon = CALLOUT_ICONS[calloutType] || 'ℹ️'
  if (calloutIcon && calloutIcon !== defaultIcon) {
    attrs.push(`icon="${calloutIcon}"`)
  }

  const attrStr = attrs.length > 0 ? `{${attrs.join(' ')}}` : ''
  const prefix = attrStr ? `> [!${calloutType}]${attrStr}` : `> [!${calloutType}]`
  lines.push(calloutText ? `${prefix} ${calloutText}` : prefix)

  if (block.callout.children?.length > 0) {
    const childMd = blocksToMarkdown(block.callout.children)
    lines.push(childMd.replace(/^/gm, '> '))
  }
}

function toggleToMarkdown(block: NotionBlock, lines: string[]): void {
  const toggleText = richTextToMarkdown(block.toggle.rich_text)
  lines.push('<details>')
  lines.push(`<summary>${toggleText}</summary>`)
  if (block.toggle.children && block.toggle.children.length > 0) {
    lines.push('')
    lines.push(blocksToMarkdown(block.toggle.children))
  }
  lines.push('</details>')
}

function tableToMarkdown(block: NotionBlock, lines: string[]): void {
  const tableRows = block.table?.children || []
  if (tableRows.length > 0) {
    for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
      const row = tableRows[rowIdx]
      const rawCells = row.table_row?.cells || []

      if (rawCells.length === 0) {
        lines.push('|  |')
        if (rowIdx === 0 && block.table?.has_column_header) {
          lines.push('|  |')
        }
        continue
      }

      let rowStr = '|'
      let headerSep = '|'
      const isFirstRowHeader = rowIdx === 0 && block.table?.has_column_header

      for (let i = 0; i < rawCells.length; i++) {
        // Optimization: Consolidate row cell rendering and header separator generation
        // into a single loop, eliminating redundant array mappings on cell data.
        rowStr += ` ${richTextToMarkdown(rawCells[i])} |`
        if (isFirstRowHeader) {
          headerSep += ' --- |'
        }
      }

      lines.push(rowStr)
      if (isFirstRowHeader) {
        lines.push(headerSep)
      }
    }
  }
}

function columnListToMarkdown(block: NotionBlock, lines: string[]): void {
  lines.push(':::columns')
  const columns = block.column_list?.children || []
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const col = columns[colIdx]
    const ratio = col.column?.format?.column_ratio
    lines.push(ratio !== undefined ? `:::column{width=${ratio}}` : ':::column')
    const columnChildren = col.column?.children || []
    if (columnChildren.length > 0) {
      lines.push(blocksToMarkdown(columnChildren))
    }
    if (colIdx < columns.length - 1) {
      lines.push('')
    }
  }
  lines.push(':::end')
}

function syncedBlockToMarkdown(block: NotionBlock, lines: string[]): void {
  const syncedFrom = block.synced_block?.synced_from
  if (syncedFrom?.block_id) {
    lines.push(`:::synced{from="${syncedFrom.block_id}"}:::`)
    return
  }
  lines.push(':::synced')
  const children = block.synced_block?.children || []
  if (children.length > 0) {
    lines.push(blocksToMarkdown(children))
  }
  lines.push(':::end')
}

type BlockHandler = (block: NotionBlock, lines: string[]) => void

const BLOCK_HANDLERS: Record<string, BlockHandler> = {
  heading_1: (block, lines) => {
    const text = richTextToMarkdown(block.heading_1.rich_text)
    if (block.heading_1.is_toggleable) {
      lines.push('<details>')
      lines.push(`<summary># ${text}</summary>`)
      if (block.heading_1.children && block.heading_1.children.length > 0) {
        lines.push('')
        lines.push(blocksToMarkdown(block.heading_1.children))
      }
      lines.push('</details>')
    } else {
      lines.push(`# ${text}`)
      if (block.heading_1.children?.length > 0) {
        lines.push(blocksToMarkdown(block.heading_1.children))
      }
    }
  },
  heading_2: (block, lines) => {
    const text = richTextToMarkdown(block.heading_2.rich_text)
    if (block.heading_2.is_toggleable) {
      lines.push('<details>')
      lines.push(`<summary>## ${text}</summary>`)
      if (block.heading_2.children && block.heading_2.children.length > 0) {
        lines.push('')
        lines.push(blocksToMarkdown(block.heading_2.children))
      }
      lines.push('</details>')
    } else {
      lines.push(`## ${text}`)
      if (block.heading_2.children?.length > 0) {
        lines.push(blocksToMarkdown(block.heading_2.children))
      }
    }
  },
  heading_3: (block, lines) => {
    const text = richTextToMarkdown(block.heading_3.rich_text)
    if (block.heading_3.is_toggleable) {
      lines.push('<details>')
      lines.push(`<summary>### ${text}</summary>`)
      if (block.heading_3.children && block.heading_3.children.length > 0) {
        lines.push('')
        lines.push(blocksToMarkdown(block.heading_3.children))
      }
      lines.push('</details>')
    } else {
      lines.push(`### ${text}`)
      if (block.heading_3.children?.length > 0) {
        lines.push(blocksToMarkdown(block.heading_3.children))
      }
    }
  },
  heading_4: (block, lines) => {
    lines.push(`#### ${richTextToMarkdown(block.heading_4.rich_text)}`)
    if (block.heading_4.children?.length > 0) {
      lines.push(blocksToMarkdown(block.heading_4.children))
    }
  },
  paragraph: (block, lines) => {
    lines.push(richTextToMarkdown(block.paragraph.rich_text))
  },
  bulleted_list_item: (block, lines) => {
    lines.push(`- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}`)
    if (block.bulleted_list_item.children?.length > 0) {
      lines.push(indentChildren(block.bulleted_list_item.children))
    }
  },
  numbered_list_item: (block, lines) => {
    lines.push(`1. ${richTextToMarkdown(block.numbered_list_item.rich_text)}`)
    if (block.numbered_list_item.children?.length > 0) {
      lines.push(indentChildren(block.numbered_list_item.children))
    }
  },
  to_do: (block, lines) => {
    lines.push(`- [${block.to_do.checked ? 'x' : ' '}] ${richTextToMarkdown(block.to_do.rich_text)}`)
    if (block.to_do.children?.length > 0) {
      lines.push(indentChildren(block.to_do.children))
    }
  },
  code: (block, lines) => {
    lines.push(`\`\`\`${block.code.language || ''}`)
    lines.push(richTextToMarkdown(block.code.rich_text))
    lines.push('```')
  },
  quote: (block, lines) => {
    lines.push(`> ${richTextToMarkdown(block.quote.rich_text)}`)
    if (block.quote.children?.length > 0) {
      const childMd = blocksToMarkdown(block.quote.children)
      lines.push(childMd.replace(/^/gm, '> '))
    }
  },
  divider: (_, lines) => {
    lines.push('---')
  },
  callout: (block, lines) => {
    calloutToMarkdown(block, lines)
  },
  toggle: (block, lines) => {
    toggleToMarkdown(block, lines)
  },
  image: (block, lines) => {
    const imageUrl = block.image?.file?.url || block.image?.external?.url || ''
    const caption = block.image?.caption ? richTextToMarkdown(block.image.caption) : ''
    lines.push(`![${caption}](${imageUrl})`)
  },
  bookmark: (block, lines) => {
    const captionText = block.bookmark.caption
      ?.map((rt: RichText) => rt.plain_text ?? rt.text?.content ?? '')
      .filter((s: string) => s.length > 0)
      .join('')
    if (captionText) {
      lines.push(`[bookmark](${block.bookmark.url} "${captionText}")`)
    } else {
      lines.push(`[bookmark](${block.bookmark.url})`)
    }
  },
  embed: (block, lines) => {
    lines.push(`[embed](${block.embed.url})`)
  },
  equation: (block, lines) => {
    lines.push(`$$${block.equation.expression}$$`)
  },
  table: (block, lines) => {
    tableToMarkdown(block, lines)
  },
  column_list: (block, lines) => {
    columnListToMarkdown(block, lines)
  },
  synced_block: (block, lines) => {
    syncedBlockToMarkdown(block, lines)
  },
  table_of_contents: (_, lines) => {
    lines.push('[toc]')
  },
  breadcrumb: (_, lines) => {
    lines.push('[breadcrumb]')
  },
  file: (block, lines) => mediaToMarkdown(block, lines),
  pdf: (block, lines) => mediaToMarkdown(block, lines),
  video: (block, lines) => mediaToMarkdown(block, lines),
  audio: (block, lines) => mediaToMarkdown(block, lines),
  child_page: (block, lines) => {
    lines.push(`[${block.child_page.title}](${block.id})`)
  },
  child_database: (block, lines) => {
    lines.push(`[${block.child_database.title}](${block.id})`)
  }
}

function mediaToMarkdown(block: NotionBlock, lines: string[]): void {
  const mediaData = block[block.type]
  const mediaUrl = mediaData?.file?.url || mediaData?.external?.url || ''
  const mediaCaption = mediaData?.caption ? richTextToMarkdown(mediaData.caption) : ''
  const mediaName = mediaData?.name || mediaCaption || block.type
  lines.push(`[${mediaName}](${mediaUrl})`)
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = []

  for (const block of blocks) {
    const handler = BLOCK_HANDLERS[block.type]
    if (handler) {
      handler(block, lines)
    }
  }

  return lines.join('\n')
}

/**
 * Parse inline markdown formatting to rich text
 * Supports: bold, italic, code, strikethrough, links, mentions, colors
 */
class InlineParser {
  private richText: RichText[] = []
  private current = ''
  private bold = false
  private italic = false
  private code = false
  private strikethrough = false
  private noMoreCloseBrackets = false
  private noMoreMentionCloseBrackets = false
  private i = 0
  private warnings: MarkdownWarning[] = []

  constructor(private readonly text: string) {}

  public getWarnings(): MarkdownWarning[] {
    return this.warnings
  }

  private flushCurrent(): void {
    if (this.current) {
      this.richText.push(
        createRichText(this.current, {
          bold: this.bold,
          italic: this.italic,
          code: this.code,
          strikethrough: this.strikethrough
        })
      )
      this.current = ''
    }
  }

  private tryParseMention(): boolean {
    const char = this.text[this.i]
    const next = this.text[this.i + 1]

    // Page mention @[Title](page-id-or-url) — must come before link handling
    // ⚡ Bolt: Added algorithmic short-circuiting to prevent O(N^2) lookaheads on pathological inputs
    // with many `@[` but no `]`.
    if (char === '@' && next === '[' && !this.noMoreMentionCloseBrackets) {
      const closeBracket = this.text.indexOf(']', this.i + 2)
      if (closeBracket === -1) {
        this.noMoreMentionCloseBrackets = true
      } else if (closeBracket + 1 < this.text.length && this.text[closeBracket + 1] === '(') {
        const closeParen = this.text.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          this.flushCurrent()

          const mentionTitle = this.text.slice(this.i + 2, closeBracket)
          const mentionTarget = this.text.slice(closeBracket + 2, closeParen)

          // Extract 32-char hex page ID from Notion URL or use as-is
          const idMatch = mentionTarget.match(MENTION_ID_REGEX)
          const pageId = idMatch ? idMatch[1] : mentionTarget

          this.richText.push(
            createMention({ page: { id: pageId } }, mentionTitle, {
              bold: this.bold,
              italic: this.italic,
              code: this.code,
              strikethrough: this.strikethrough
            })
          )

          this.i = closeParen
          return true
        }
      }
    }
    return false
  }

  private tryParseLink(): boolean {
    const char = this.text[this.i]

    // Link [text](url) — optimized to avoid O(N²) on pathological inputs
    if (char === '[' && !this.noMoreCloseBrackets) {
      const closeBracket = this.text.indexOf(']', this.i + 1)
      if (closeBracket === -1) {
        // No more ] in the rest of the string, skip future indexOf calls
        this.noMoreCloseBrackets = true
      } else if (closeBracket + 1 < this.text.length && this.text[closeBracket + 1] === '(') {
        const closeParen = this.text.indexOf(')', closeBracket + 2)

        if (closeParen !== -1) {
          this.flushCurrent()

          const linkText = this.text.slice(this.i + 1, closeBracket)
          const linkUrl = this.text.slice(closeBracket + 2, closeParen)
          const isSafe = isSafeUrl(linkUrl)

          if (!isSafe) {
            this.warnings.push({
              code: 'UNSAFE_URL',
              message: `Unsafe inline link URL rejected; link dropped: ${linkUrl}`,
              block_index: -1,
              original_line: this.text
            })
          }

          this.richText.push({
            type: 'text',
            text: { content: linkText, link: isSafe ? { url: linkUrl } : null },
            annotations: {
              bold: this.bold,
              italic: this.italic,
              strikethrough: this.strikethrough,
              underline: false,
              code: this.code,
              color: 'default'
            },
            plain_text: linkText
          })

          this.i = closeParen
          return true
        }
      }
    }
    return false
  }

  private tryParseFormatting(): boolean {
    const char = this.text[this.i]
    const next = this.text[this.i + 1]

    // Bold **text**
    if (char === '*' && next === '*') {
      this.flushCurrent()
      this.bold = !this.bold
      this.i++ // Skip next *
      return true
    }
    // Italic *text*
    if (char === '*' && next !== '*') {
      this.flushCurrent()
      this.italic = !this.italic
      return true
    }
    // Code `text`
    if (char === '`') {
      this.flushCurrent()
      this.code = !this.code
      return true
    }
    // Strikethrough ~~text~~
    if (char === '~' && next === '~') {
      this.flushCurrent()
      this.strikethrough = !this.strikethrough
      this.i++ // Skip next ~
      return true
    }

    return false
  }

  public parse(): RichText[] {
    for (this.i = 0; this.i < this.text.length; this.i++) {
      const char = this.text[this.i]

      // Fast path: skip parsing functions if character isn't a potential formatting trigger
      if (char === '@' || char === '[' || char === '*' || char === '`' || char === '~') {
        if (this.tryParseMention()) continue
        if (this.tryParseLink()) continue
        if (this.tryParseFormatting()) continue
      }

      this.current += char
    }

    this.flushCurrent()

    return this.richText.length > 0 ? this.richText : [createRichText(this.text)]
  }
}

/**
 * Parse inline markdown formatting to rich text
 * Supports: bold, italic, code, strikethrough, links, mentions, colors
 */
export function parseRichText(text: string): RichText[] {
  return new InlineParser(text).parse()
}
/**
 * Convert rich text array to plain markdown
 */
function richTextToMarkdown(richText: RichText[]): string {
  if (!richText || !Array.isArray(richText)) return ''

  let result = ''
  for (let i = 0; i < richText.length; i++) {
    const rt = richText[i]
    if (!rt) continue

    // Handle mention elements
    if (rt.type === 'mention' && rt.mention) {
      const title = rt.plain_text || rt.text?.content || 'Untitled'
      const id = rt.mention.page?.id || rt.mention.database?.id || ''
      if (id) {
        result += `@[${title}](${id})`
        continue
      }
      // Fallback for other mention types (user, date, etc.)
      result += title
      continue
    }

    if (!rt.text) continue

    let text = rt.text.content || ''
    const annotations = rt.annotations || ({} as any)

    if (annotations.bold) text = `**${text}**`
    if (annotations.italic) text = `*${text}*`
    if (annotations.code) text = `\`${text}\``
    if (annotations.strikethrough) text = `~~${text}~~`
    if (rt.text.link) text = `[${text}](${rt.text.link.url})`
    result += text
  }

  return result
}

/**
 * Extract plain text from rich text
 * Optimized string accumulation avoids creating intermediate arrays
 * and reduces garbage collection pressure in hot paths.
 */
export function extractPlainText(richText: RichText[]): string {
  if (!richText || !Array.isArray(richText)) return ''
  let result = ''
  const len = richText.length
  for (let i = 0; i < len; i++) {
    const rt = richText[i]
    result += rt.plain_text || rt.text?.content || ''
  }
  return result
}

// ============================================================
// Block Parsing Helpers
// ============================================================

interface ParseResult {
  block: NotionBlock
  endIndex: number
}

function parseCalloutBlock(lines: string[], startIndex: number, match: RegExpMatchArray): ParseResult {
  const calloutType = match[1].toUpperCase()
  const attrStr = match[2]
  const inlineContent = match[3]

  let icon = getCalloutIcon(calloutType)
  let color = getCalloutColor(calloutType)

  if (attrStr) {
    const colorMatch = attrStr.match(/color="([^"]+)"/)
    if (colorMatch) color = colorMatch[1]
    const iconMatch = attrStr.match(/icon="([^"]+)"/)
    if (iconMatch) icon = iconMatch[1]
  }

  const contentLines: string[] = inlineContent ? [inlineContent] : []
  let i = startIndex

  // Collect continuation lines (lines starting with >)
  while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
    i++
    contentLines.push(lines[i].slice(2))
  }

  const calloutContent = contentLines.join('\n')
  return { block: createCallout(calloutContent || calloutType, icon, color), endIndex: i }
}

function parseHtmlCallout(lines: string[], startIndex: number, match: RegExpMatchArray): ParseResult {
  const attrStr = match[1] || ''
  let color = 'default'
  let icon = 'ℹ️'

  const colorMatch = attrStr.match(/color="([^"]+)"/)
  if (colorMatch) color = colorMatch[1]
  const iconMatch = attrStr.match(/icon="([^"]+)"/)
  if (iconMatch) icon = iconMatch[1]

  const firstLine = lines[startIndex]
  const openTagEnd = firstLine.indexOf('>')
  const remainder = openTagEnd !== -1 ? firstLine.slice(openTagEnd + 1) : ''

  // Single-line callout: <callout ...>content</callout>
  if (remainder.includes('</callout>')) {
    const closeIdx = remainder.indexOf('</callout>')
    const innerText = remainder.slice(0, closeIdx).trim()
    return {
      block: createCallout(innerText, icon, color),
      endIndex: startIndex
    }
  }

  const contentLines: string[] = []
  if (remainder.trim()) {
    contentLines.push(remainder.trim())
  }

  let i = startIndex + 1
  while (i < lines.length) {
    const currentLine = lines[i]
    if (currentLine.includes('</callout>')) {
      const closeIdx = currentLine.indexOf('</callout>')
      const beforeClose = currentLine.slice(0, closeIdx)
      if (beforeClose.trim()) {
        contentLines.push(beforeClose.trim())
      }
      break
    }
    contentLines.push(currentLine)
    i++
  }

  const innerText = contentLines.join('\n').trim()
  return {
    block: createCallout(innerText, icon, color),
    endIndex: i < lines.length ? i : lines.length - 1
  }
}

function parseCodeBlock(lines: string[], startIndex: number, line: string): ParseResult & { warning?: string } {
  const language = line.slice(3).trim()
  const codeLines: string[] = []
  let i = startIndex + 1
  while (i < lines.length && !lines[i].startsWith('```')) {
    codeLines.push(lines[i])
    i++
  }
  const warning = i >= lines.length ? `Unclosed code fence starting with \`${line}\`` : undefined
  return { block: createCodeBlock(codeLines.join('\n'), language), endIndex: i, warning }
}

function parseEquationBlock(lines: string[], startIndex: number, trimmedLine: string): ParseResult {
  if (trimmedLine.endsWith('$$') && trimmedLine.length > 4) {
    // Single line equation: $$expression$$
    const expression = trimmedLine.slice(2, -2).trim()
    return { block: createEquation(expression), endIndex: startIndex }
  }
  // Multi-line equation
  const eqLines: string[] = []
  let i = startIndex + 1
  while (i < lines.length && !lines[i].trim().startsWith('$$')) {
    eqLines.push(lines[i])
    i++
  }
  return { block: createEquation(eqLines.join('\n')), endIndex: i }
}
// ============================================================
// Table parsing
// ============================================================

interface TableParseResult {
  headers: string[]
  rows: string[][]
  hasHeader: boolean
  endIndex: number
}

function parseTable(lines: string[], startIndex: number): TableParseResult | null {
  const tableLines: string[] = []
  let i = startIndex

  // Collect all consecutive pipe-delimited lines
  while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].includes('|')) {
    tableLines.push(lines[i])
    i++
  }

  if (tableLines.length < 1) return null

  // Optimization: use a single-pass manual loop instead of chained .map().filter().
  // This reduces array allocations and closure creation in a hot path when parsing markdown tables.
  const parsedRows: string[][] = new Array(tableLines.length)
  for (let r = 0; r < tableLines.length; r++) {
    const line = tableLines[r]
    const split = line.split('|')
    const len = split.length
    if (len < 3) {
      parsedRows[r] = []
      continue
    }
    const cells: string[] = new Array(len - 2)
    for (let c = 1; c < len - 1; c++) {
      cells[c - 1] = split[c].trim()
    }
    parsedRows[r] = cells
  }

  // Check for separator row (contains ---)
  let hasHeader = false
  let headerRow: string[] = []
  const dataRows: string[][] = []

  if (parsedRows.length >= 2) {
    const possibleSeparator = parsedRows[1]
    const isSeparator = possibleSeparator.every((cell: string) => TABLE_SEPARATOR_REGEX.test(cell.trim()))

    if (isSeparator) {
      hasHeader = true
      headerRow = parsedRows[0]
      for (let j = 2; j < parsedRows.length; j++) {
        dataRows.push(parsedRows[j])
      }
    } else {
      headerRow = parsedRows[0]
      for (let j = 1; j < parsedRows.length; j++) {
        dataRows.push(parsedRows[j])
      }
    }
  } else {
    headerRow = parsedRows[0]
  }

  return {
    headers: headerRow,
    rows: dataRows,
    hasHeader,
    endIndex: i - 1
  }
}

// ============================================================
// Toggle parsing (<details>/<summary>)
// ============================================================

interface ToggleParseResult {
  title: string
  children: NotionBlock[]
  endIndex: number
  unclosed: boolean
}

function parseToggle(lines: string[], startIndex: number): ToggleParseResult {
  let i = startIndex
  let title = ''
  const childLines: string[] = []

  const detailsLine = lines[i].trim()

  // Try to extract <summary>...</summary> from the <details> line itself
  const inlineSummaryMatch = detailsLine.match(INLINE_SUMMARY_REGEX)

  if (inlineSummaryMatch) {
    // All-on-one-line or inline summary: <details><summary>Title</summary>[Content][</details>]
    title = inlineSummaryMatch[1]
    const afterSummary = inlineSummaryMatch[2].trim()
    const closedOnSameLine = !!inlineSummaryMatch[3]

    if (closedOnSameLine) {
      // Entire toggle on one line: <details><summary>Title</summary>Content</details>
      if (afterSummary) {
        childLines.push(afterSummary)
      }
      const childContent = childLines.join('\n').trim()
      const children = childContent ? markdownToBlocks(childContent).blocks : []
      return { title, children, endIndex: i, unclosed: false }
    }

    // Inline summary but content continues on subsequent lines
    if (afterSummary) {
      childLines.push(afterSummary)
    }
    i++
  } else {
    // Standard multi-line: <details> on its own line
    i++

    // Look for <summary>...</summary> on the next line
    if (i < lines.length) {
      const summaryMatch = lines[i].match(SUMMARY_REGEX)
      if (summaryMatch) {
        title = summaryMatch[1]
        i++
      }
    }
  }

  // Collect content until matching </details>, tracking nesting depth
  let depth = 1
  let unclosed = false
  while (i < lines.length && depth > 0) {
    const trimmed = lines[i].trim()

    // Check for <details> opens BEFORE </details> closes so that
    // a single-line nested toggle (opens+closes on same line) doesn't
    // prematurely terminate the outer loop.
    if (trimmed.startsWith('<details>') || trimmed === '<details>') {
      depth++
    }
    if (trimmed === '</details>' || trimmed.endsWith('</details>')) {
      depth--
      if (depth === 0) break
    }

    childLines.push(lines[i])
    i++
  }

  // If we exited the loop because i hit lines.length without depth returning to 0,
  // the toggle is unclosed. Caller surfaces this as a MALFORMED_BLOCK warning.
  if (depth > 0) {
    unclosed = true
  }

  // Convert child content to blocks
  const childContent = childLines.join('\n').trim()
  const children = childContent ? markdownToBlocks(childContent).blocks : []

  return { title, children, endIndex: i, unclosed }
}

// ============================================================
// Column parsing (:::columns / :::column / :::end)
// ============================================================

interface ColumnParseResult {
  columns: NotionBlock[][]
  widthRatios: (number | undefined)[]
  endIndex: number
}

function parseColumns(lines: string[], startIndex: number): ColumnParseResult {
  let i = startIndex + 1 // Skip :::columns
  const columns: NotionBlock[][] = []
  const widthRatios: (number | undefined)[] = []
  let currentColumnLines: string[] = []
  let inColumn = false
  let depth = 1

  while (i < lines.length) {
    const line = lines[i].trim()

    if (line === ':::columns' || line === ':::synced') {
      depth++
      currentColumnLines.push(lines[i])
      i++
      continue
    }

    if (line === ':::end') {
      depth--
      if (depth === 0) {
        // Flush last column
        if (inColumn) {
          columns.push(markdownToBlocks(currentColumnLines.join('\n').trim()).blocks)
          currentColumnLines = []
        }
        break
      }
      currentColumnLines.push(lines[i])
      i++
      continue
    }

    const columnMatch = line.match(COLUMN_REGEX)
    if (columnMatch && depth === 1) {
      // Flush previous column (even if empty)
      if (inColumn) {
        columns.push(markdownToBlocks(currentColumnLines.join('\n').trim()).blocks)
        currentColumnLines = []
      }
      inColumn = true
      widthRatios.push(columnMatch[1] ? Number.parseFloat(columnMatch[1]) : undefined)
      i++
      continue
    }

    currentColumnLines.push(lines[i])
    i++
  }

  // If no :::end found, flush remaining
  if (currentColumnLines.length > 0 && (columns.length > 0 || currentColumnLines.some((l) => l.trim()))) {
    columns.push(markdownToBlocks(currentColumnLines.join('\n').trim()).blocks)
  }

  return { columns, widthRatios, endIndex: i }
}

// ============================================================
// Synced block parsing (:::synced / :::end)
// ============================================================

interface SyncedBlockParseResult {
  children: NotionBlock[]
  endIndex: number
}

function parseSyncedBlock(lines: string[], startIndex: number): SyncedBlockParseResult {
  let i = startIndex + 1 // Skip :::synced
  const contentLines: string[] = []
  let depth = 1

  while (i < lines.length) {
    const line = lines[i].trim()
    if (line === ':::synced' || line === ':::columns') {
      depth++
    } else if (line === ':::end') {
      depth--
      if (depth === 0) {
        break
      }
    }
    contentLines.push(lines[i])
    i++
  }

  const childContent = contentLines.join('\n').trim()
  const children = childContent ? markdownToBlocks(childContent).blocks : []
  return { children, endIndex: i }
}

// ============================================================
// Callout helpers
// ============================================================

const CALLOUT_ICONS: Record<string, string> = {
  NOTE: 'ℹ️',
  TIP: '💡',
  IMPORTANT: '❗',
  WARNING: '⚠️',
  CAUTION: '🛑',
  INFO: 'ℹ️',
  SUCCESS: '✅',
  ERROR: '❌',
  DANGER: '❌'
}

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

const CALLOUT_ICON_MAP: Record<string, string> = {
  ℹ️: 'NOTE',
  '💡': 'TIP',
  '❗': 'IMPORTANT',
  '⚠️': 'WARNING',
  '🛑': 'CAUTION',
  '✅': 'SUCCESS',
  '❌': 'ERROR'
}

function getCalloutIcon(type: string): string {
  return CALLOUT_ICONS[type] || 'ℹ️'
}

function getCalloutColor(type: string): string {
  return CALLOUT_COLORS[type] || 'default'
}

function getCalloutTypeFromIcon(icon: string): string {
  return CALLOUT_ICON_MAP[icon] || 'NOTE'
}

// ============================================================
// Block creators
// ============================================================

function createRichText(
  content: string,
  annotations: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean; color?: string } = {}
): RichText {
  return {
    type: 'text',
    text: { content, link: null },
    annotations: {
      bold: annotations.bold || false,
      italic: annotations.italic || false,
      strikethrough: annotations.strikethrough || false,
      underline: false,
      code: annotations.code || false,
      color: annotations.color || 'default'
    },
    plain_text: content
  }
}

function createHeading(level: 1 | 2 | 3 | 4, text: string): NotionBlock {
  const type = `heading_${level}` as 'heading_1' | 'heading_2' | 'heading_3' | 'heading_4'
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: parseRichText(text),
      color: 'default',
      is_toggleable: false
    }
  }
}

function createParagraph(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: parseRichText(text),
      color: 'default'
    }
  }
}

function createBulletedListItem(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: parseRichText(text),
      color: 'default'
    }
  }
}

function createNumberedListItem(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'numbered_list_item',
    numbered_list_item: {
      rich_text: parseRichText(text),
      color: 'default'
    }
  }
}

function createTodoItem(text: string, checked: boolean): NotionBlock {
  return {
    object: 'block',
    type: 'to_do',
    to_do: {
      rich_text: parseRichText(text),
      checked,
      color: 'default'
    }
  }
}

function createCodeBlock(code: string, language: string): NotionBlock {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [createRichText(code)],
      language: language || 'plain text'
    }
  }
}

function createQuote(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: parseRichText(text),
      color: 'default'
    }
  }
}

function createDivider(): NotionBlock {
  return {
    object: 'block',
    type: 'divider',
    divider: {}
  }
}

function createCallout(text: string, icon: string, color: string): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: parseRichText(text),
      icon: { type: 'emoji', emoji: icon },
      color
    }
  }
}

function createToggle(text: string, children: NotionBlock[] = []): NotionBlock {
  const trimmed = text.trim()
  if (trimmed.startsWith('### ')) {
    return {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: parseRichText(trimmed.slice(4)),
        color: 'default',
        is_toggleable: true,
        children
      }
    }
  }
  if (trimmed.startsWith('## ')) {
    return {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: parseRichText(trimmed.slice(3)),
        color: 'default',
        is_toggleable: true,
        children
      }
    }
  }
  if (trimmed.startsWith('# ')) {
    return {
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: parseRichText(trimmed.slice(2)),
        color: 'default',
        is_toggleable: true,
        children
      }
    }
  }
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: parseRichText(text),
      color: 'default',
      children
    }
  }
}

function createImage(url: string, caption: string = ''): NotionBlock {
  return {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url },
      caption: caption ? [createRichText(caption)] : []
    }
  }
}

function createBookmark(url: string, caption?: string): NotionBlock {
  const captionRt = caption ? [createRichText(caption)] : []
  if (captionRt.length > 0) {
    captionRt[0].plain_text = caption
  }
  return {
    object: 'block',
    type: 'bookmark',
    bookmark: { url, caption: captionRt }
  }
}

function createEmbed(url: string): NotionBlock {
  return {
    object: 'block',
    type: 'embed',
    embed: { url }
  }
}

function createEquation(expression: string): NotionBlock {
  return {
    object: 'block',
    type: 'equation',
    equation: { expression }
  }
}

function createTable(headers: string[], rows: string[][], hasHeader: boolean): NotionBlock {
  const tableWidth = headers.length
  const allRows: NotionBlock[] = []

  // Header row
  allRows.push({
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: headers.map((h) => parseRichText(h))
    }
  })

  // Data rows
  for (const row of rows) {
    const cells = []
    for (let c = 0; c < tableWidth; c++) {
      cells.push(parseRichText(row[c] || ''))
    }
    allRows.push({
      object: 'block',
      type: 'table_row',
      table_row: { cells }
    })
  }

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: tableWidth,
      has_column_header: hasHeader,
      has_row_header: false,
      children: allRows
    }
  }
}

function createColumnList(columns: NotionBlock[][], widthRatios?: (number | undefined)[]): NotionBlock {
  const normalizedColumns = [...columns]
  while (normalizedColumns.length < 2) {
    normalizedColumns.push([])
  }

  const columnBlocks = normalizedColumns.map((children, i) => {
    const safeChildren =
      children && children.length > 0
        ? children
        : [
            {
              object: 'block' as const,
              type: 'paragraph',
              paragraph: {
                rich_text: []
              }
            }
          ]

    const col: any = { children: safeChildren }
    const ratio = widthRatios?.[i]
    if (ratio !== undefined) {
      col.format = { column_ratio: ratio }
    }
    return {
      object: 'block' as const,
      type: 'column',
      column: col
    }
  })

  return {
    object: 'block',
    type: 'column_list',
    column_list: {
      children: columnBlocks
    }
  }
}

function createSyncedBlock(fromBlockId?: string | null, children: NotionBlock[] = []): NotionBlock {
  if (fromBlockId) {
    return {
      object: 'block',
      type: 'synced_block',
      synced_block: {
        synced_from: {
          block_id: fromBlockId
        }
      }
    }
  }
  return {
    object: 'block',
    type: 'synced_block',
    synced_block: {
      synced_from: null,
      children
    }
  }
}

function createTableOfContents(): NotionBlock {
  return {
    object: 'block',
    type: 'table_of_contents',
    table_of_contents: { color: 'default' }
  }
}

function createBreadcrumb(): NotionBlock {
  return {
    object: 'block',
    type: 'breadcrumb',
    breadcrumb: {}
  }
}

function isListItem(line: string): boolean {
  return CHECKED_LIST_REGEX.test(line) || BULLETED_LIST_REGEX.test(line) || NUMBERED_LIST_REGEX.test(line)
}

/**
 * Cleans Notion API artifacts from markdown returned by retrieveMarkdown/updateMarkdown.
 * Removes <empty-block/> tags and converts basic HTML <table> elements into GFM tables.
 */
export function sanitizeNotionMarkdown(md: string): string {
  if (!md) return ''

  // 1. Remove <empty-block/> tags
  let cleaned = md.replace(/<empty-block\s*\/?>/gi, '')

  // 2. Normalize <unknown ... alt="bookmark"/> and <unknown ... alt="embed"/>
  cleaned = cleaned.replace(/<unknown\b[^>]*\burl="([^"]+)"[^>]*\balt="bookmark"[^>]*\/?>/gi, '[bookmark]($1)')
  cleaned = cleaned.replace(/<unknown\b[^>]*\balt="bookmark"[^>]*\burl="([^"]+)"[^>]*\/?>/gi, '[bookmark]($1)')
  cleaned = cleaned.replace(/<unknown\b[^>]*\burl="([^"]+)"[^>]*\balt="embed"[^>]*\/?>/gi, '[embed]($1)')
  cleaned = cleaned.replace(/<unknown\b[^>]*\balt="embed"[^>]*\burl="([^"]+)"[^>]*\/?>/gi, '[embed]($1)')

  // 2. Convert simple HTML tables to GFM tables
  cleaned = cleaned.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableBody) => {
    const rowMatches = [...tableBody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    if (rowMatches.length === 0) return ''

    const rows: string[][] = []

    for (const rowMatch of rowMatches) {
      const rowContent = rowMatch[1]
      const thMatches = [...rowContent.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      if (thMatches.length > 0) {
        rows.push(thMatches.map((m) => m[1].trim().replace(/\|/g, '\\|')))
      } else {
        const tdMatches = [...rowContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        rows.push(tdMatches.map((m) => m[1].trim().replace(/\|/g, '\\|')))
      }
    }

    if (rows.length === 0) return ''

    const colCount = Math.max(...rows.map((r) => r.length))
    const formattedRows: string[] = []

    const header = rows[0]
    while (header.length < colCount) header.push('')
    formattedRows.push(`| ${header.join(' | ')} |`)
    formattedRows.push(`| ${new Array(colCount).fill('---').join(' | ')} |`)

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      while (row.length < colCount) row.push('')
      formattedRows.push(`| ${row.join(' | ')} |`)
    }

    return formattedRows.join('\n')
  })

  // 3. Normalize multiple blank lines (3 or more newlines to 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  return cleaned.trim()
}
