/**
 * Property Codecs Registry
 * High-cohesion bidirectional adapters between human-friendly and Notion API property values.
 */

import * as RichText from './richtext.js'

export interface PropertyCodec<T = any> {
  type: string
  isReadonly?: boolean
  /** 人类友好值 / 扁平值 -> Notion API 属性对象 */
  toNotion(value: any, context?: { schemaType?: string; isUpdate?: boolean; key?: string }): any
  /** Notion API 属性对象 -> 人类友好扁平值 */
  fromNotion(notionProp: any): T
  /** Notion API 属性对象 -> 标量值 (用于排序/聚合/分组) */
  toScalar?(notionProp: any): number | string | boolean | string[] | null
}

export const PAGE_ID_REGEX = /([a-f0-9]{32})/

/** Extract a 32-char hex page ID from a Notion URL, or return the input as-is if it's already a raw ID */
export function extractPageId(value: any): string {
  if (typeof value !== 'string') return String(value)
  const match = value.match(PAGE_ID_REGEX)
  if (match) return match[1]
  // Also accept hyphenated UUIDs as-is
  return value
}

/** Convert a single string or array value to Notion relation format */
export function toRelation(value: any): { relation: { id: string }[] } {
  if (typeof value === 'string') {
    if (value === '') return { relation: [] }
    // Try parsing as JSON array (e.g. '["id1", "id2"]')
    if (value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
          return { relation: parsed.map((v: string) => ({ id: extractPageId(v) })) }
        }
      } catch {
        // Not valid JSON, treat as single value
      }
    }
    return { relation: [{ id: extractPageId(value) }] }
  }
  if (Array.isArray(value)) {
    return {
      relation: value.map((v: any) => (typeof v === 'object' && v !== null && 'id' in v ? v : { id: extractPageId(v) }))
    }
  }
  return value
}

export const titleCodec: PropertyCodec = {
  type: 'title',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { title: [] }
    }
    if (typeof value === 'string') {
      return { title: [RichText.text(value)] }
    }
    return value
  },
  fromNotion(p) {
    if (!p.title) return undefined
    const title = p.title
    const len = title.length
    const arr = new Array(len)
    for (let j = 0; j < len; j++) arr[j] = title[j].plain_text || ''
    return arr.join('')
  },
  toScalar(prop) {
    return Array.isArray(prop.title) ? prop.title.map((t: any) => t.plain_text).join('') : null
  }
}

export const richTextCodec: PropertyCodec = {
  type: 'rich_text',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { rich_text: [] }
    }
    if (typeof value === 'string') {
      return { rich_text: [RichText.text(value)] }
    }
    return value
  },
  fromNotion(p) {
    if (!p.rich_text) return undefined
    const richText = p.rich_text
    const len = richText.length
    const arr = new Array(len)
    for (let j = 0; j < len; j++) arr[j] = richText[j].plain_text || ''
    return arr.join('')
  },
  toScalar(prop) {
    return Array.isArray(prop.rich_text) ? prop.rich_text.map((t: any) => t.plain_text).join('') : null
  }
}

export const numberCodec: PropertyCodec = {
  type: 'number',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { number: null }
    }
    if (typeof value === 'number') {
      return { number: value }
    }
    if (typeof value === 'string') {
      const num = Number(value)
      return { number: Number.isNaN(num) ? null : num }
    }
    return value
  },
  fromNotion(p) {
    return p.number !== undefined ? p.number : undefined
  },
  toScalar(prop) {
    return typeof prop.number === 'number' ? prop.number : null
  }
}

export const checkboxCodec: PropertyCodec = {
  type: 'checkbox',
  toNotion(value) {
    if (value === null || value === undefined) {
      return { checkbox: null }
    }
    if (typeof value === 'boolean') {
      return { checkbox: value }
    }
    return value
  },
  fromNotion(p) {
    return p.checkbox !== undefined ? p.checkbox : undefined
  },
  toScalar(prop) {
    return typeof prop.checkbox === 'boolean' ? prop.checkbox : null
  }
}

export const selectCodec: PropertyCodec = {
  type: 'select',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { select: null }
    }
    if (typeof value === 'string') {
      return { select: { name: value } }
    }
    return value
  },
  fromNotion(p) {
    return p.select?.name
  },
  toScalar(prop) {
    return prop.select?.name ?? null
  }
}

export const multiSelectCodec: PropertyCodec = {
  type: 'multi_select',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { multi_select: [] }
    }
    if (Array.isArray(value)) {
      return {
        multi_select: value.map((v) => (typeof v === 'object' && v !== null && 'name' in v ? v : { name: String(v) }))
      }
    }
    if (typeof value === 'string') {
      return { multi_select: [{ name: value }] }
    }
    return value
  },
  fromNotion(p) {
    if (!p.multi_select) return undefined
    const ms = p.multi_select
    const arr = new Array(ms.length)
    for (let j = 0; j < ms.length; j++) arr[j] = ms[j].name
    return arr
  },
  toScalar(prop) {
    return Array.isArray(prop.multi_select) ? prop.multi_select.map((o: any) => o.name) : null
  }
}

export const statusCodec: PropertyCodec = {
  type: 'status',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { status: null }
    }
    if (typeof value === 'string') {
      return { status: { name: value } }
    }
    return value
  },
  fromNotion(p) {
    return p.status?.name
  },
  toScalar(prop) {
    return prop.status?.name ?? null
  }
}

export const dateCodec: PropertyCodec = {
  type: 'date',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { date: null }
    }
    if (typeof value === 'string') {
      return { date: { start: value } }
    }
    if (typeof value === 'object' && value !== null && 'start' in value && !('date' in value)) {
      return { date: value }
    }
    return value
  },
  fromNotion(p) {
    if (!p.date) return undefined
    const d = p.date
    return d.start + (d.end ? ` to ${d.end}` : '')
  },
  toScalar(prop) {
    return prop.date?.start ?? null
  }
}

export const urlCodec: PropertyCodec = {
  type: 'url',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { url: null }
    }
    if (typeof value === 'string') {
      return { url: value }
    }
    return value
  },
  fromNotion(p) {
    return p.url !== undefined ? p.url : undefined
  }
}

export const emailCodec: PropertyCodec = {
  type: 'email',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { email: null }
    }
    if (typeof value === 'string') {
      return { email: value }
    }
    return value
  },
  fromNotion(p) {
    return p.email !== undefined ? p.email : undefined
  }
}

export const phoneNumberCodec: PropertyCodec = {
  type: 'phone_number',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { phone_number: null }
    }
    if (typeof value === 'string') {
      return { phone_number: value }
    }
    return value
  },
  fromNotion(p) {
    return p.phone_number !== undefined ? p.phone_number : undefined
  }
}

export const relationCodec: PropertyCodec = {
  type: 'relation',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { relation: [] }
    }
    return toRelation(value)
  },
  fromNotion(p) {
    if (!p.relation) return undefined
    const rel = p.relation
    const arr = new Array(rel.length)
    for (let j = 0; j < rel.length; j++) arr[j] = rel[j].id
    return arr
  }
}

export const peopleCodec: PropertyCodec = {
  type: 'people',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { people: [] }
    }
    if (Array.isArray(value)) {
      return {
        people: value.map((v) => (typeof v === 'object' && v !== null && 'id' in v ? v : { id: extractPageId(v) }))
      }
    }
    if (typeof value === 'string') {
      return { people: [{ id: extractPageId(value) }] }
    }
    return value
  },
  fromNotion(p) {
    if (!p.people) return undefined
    const ppl = p.people
    const arr = new Array(ppl.length)
    for (let j = 0; j < ppl.length; j++) arr[j] = ppl[j].name || ppl[j].id
    return arr
  },
  toScalar(prop) {
    return Array.isArray(prop.people) ? prop.people.map((p: any) => p.id) : null
  }
}

export const filesCodec: PropertyCodec = {
  type: 'files',
  toNotion(value) {
    if (value === null || value === undefined || value === '') {
      return { files: [] }
    }
    if (Array.isArray(value)) {
      return {
        files: value.map((v) =>
          typeof v === 'object' && v !== null ? v : { name: String(v), external: { url: String(v) } }
        )
      }
    }
    if (typeof value === 'string') {
      return { files: [{ name: value, external: { url: value } }] }
    }
    return value
  },
  fromNotion(p) {
    if (!p.files) return undefined
    const files = p.files
    const arr = new Array(files.length)
    for (let j = 0; j < files.length; j++) {
      const f = files[j]
      arr[j] = f.file?.url || f.external?.url || f.name
    }
    return arr
  }
}

// Readonly Codecs
export const formulaCodec: PropertyCodec = {
  type: 'formula',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'formula' in value)) {
      return value
    }
    return { type: 'formula', formula: value }
  },
  fromNotion(p) {
    if (!p.formula) return undefined
    const f = p.formula
    return f.type ? (f[f.type] ?? null) : null
  },
  toScalar(prop) {
    if (prop.formula?.type === 'number' && typeof prop.formula.number === 'number') {
      return prop.formula.number
    }
    if (prop.formula?.type === 'string') {
      if (prop.formula.string === null) return null
      const parsed = parseFloat(prop.formula.string)
      return Number.isNaN(parsed) ? prop.formula.string : parsed
    }
    if (prop.formula?.type === 'boolean') {
      return prop.formula.boolean ?? null
    }
    if (prop.formula?.type === 'date') {
      return prop.formula.date?.start ?? null
    }
    return null
  }
}

export const rollupCodec: PropertyCodec = {
  type: 'rollup',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'rollup' in value)) {
      return value
    }
    return { type: 'rollup', rollup: value }
  },
  fromNotion(p) {
    return p.rollup
  }
}

export const createdTimeCodec: PropertyCodec = {
  type: 'created_time',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'created_time' in value)) {
      return value
    }
    return { type: 'created_time', created_time: value }
  },
  fromNotion(p) {
    return p.created_time
  }
}

export const lastEditedTimeCodec: PropertyCodec = {
  type: 'last_edited_time',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'last_edited_time' in value)) {
      return value
    }
    return { type: 'last_edited_time', last_edited_time: value }
  },
  fromNotion(p) {
    return p.last_edited_time
  }
}

export const createdByCodec: PropertyCodec = {
  type: 'created_by',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'created_by' in value)) {
      return value
    }
    return { type: 'created_by', created_by: value }
  },
  fromNotion(p) {
    return p.created_by ? p.created_by.name || p.created_by.id : undefined
  }
}

export const lastEditedByCodec: PropertyCodec = {
  type: 'last_edited_by',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'last_edited_by' in value)) {
      return value
    }
    return { type: 'last_edited_by', last_edited_by: value }
  },
  fromNotion(p) {
    return p.last_edited_by ? p.last_edited_by.name || p.last_edited_by.id : undefined
  }
}

export const uniqueIdCodec: PropertyCodec = {
  type: 'unique_id',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'unique_id' in value)) {
      return value
    }
    return { type: 'unique_id', unique_id: value }
  },
  fromNotion(p) {
    if (!p.unique_id) return undefined
    const u = p.unique_id
    return u.prefix ? `${u.prefix}-${u.number}` : u.number
  }
}

export const verificationCodec: PropertyCodec = {
  type: 'verification',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'verification' in value)) {
      return value
    }
    return { type: 'verification', verification: value }
  },
  fromNotion(p) {
    return p.verification
  }
}

export const buttonCodec: PropertyCodec = {
  type: 'button',
  isReadonly: true,
  toNotion(value) {
    if (typeof value === 'object' && value !== null && ('type' in value || 'button' in value)) {
      return value
    }
    return { type: 'button', button: value }
  },
  fromNotion(p) {
    return p.button
  }
}

export const PROPERTY_CODECS: Record<string, PropertyCodec> = {
  title: titleCodec,
  rich_text: richTextCodec,
  number: numberCodec,
  checkbox: checkboxCodec,
  select: selectCodec,
  multi_select: multiSelectCodec,
  status: statusCodec,
  date: dateCodec,
  url: urlCodec,
  email: emailCodec,
  phone_number: phoneNumberCodec,
  relation: relationCodec,
  people: peopleCodec,
  files: filesCodec,
  formula: formulaCodec,
  rollup: rollupCodec,
  created_time: createdTimeCodec,
  last_edited_time: lastEditedTimeCodec,
  created_by: createdByCodec,
  last_edited_by: lastEditedByCodec,
  unique_id: uniqueIdCodec,
  verification: verificationCodec,
  button: buttonCodec
}
