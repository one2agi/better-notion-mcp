import { describe, expect, it } from 'vitest'
import { extractPageId, PROPERTY_CODECS, toRelation } from './property-codecs.js'

describe('Property Codecs Registry', () => {
  it('registers all required property codecs', () => {
    const expectedTypes = [
      'title',
      'rich_text',
      'number',
      'checkbox',
      'select',
      'multi_select',
      'status',
      'date',
      'url',
      'email',
      'phone_number',
      'relation',
      'people',
      'files',
      'formula',
      'rollup',
      'created_time',
      'last_edited_time',
      'created_by',
      'last_edited_by',
      'unique_id',
      'verification',
      'button'
    ]
    for (const type of expectedTypes) {
      expect(PROPERTY_CODECS[type]).toBeDefined()
      expect(PROPERTY_CODECS[type].type).toBe(type)
    }
  })

  describe('title codec', () => {
    const codec = PROPERTY_CODECS.title
    it('fromNotion extracts plain text', () => {
      expect(
        codec.fromNotion({
          type: 'title',
          title: [{ plain_text: 'Hello ' }, { plain_text: 'World' }]
        })
      ).toBe('Hello World')
      expect(codec.fromNotion({ type: 'title', title: [] })).toBe('')
      expect(codec.fromNotion({ type: 'title' })).toBeUndefined()
    })

    it('toNotion formats string to title array', () => {
      expect(codec.toNotion('My Title')).toMatchObject({
        title: [{ type: 'text', text: { content: 'My Title' } }]
      })
      expect(codec.toNotion('')).toEqual({ title: [] })
      expect(codec.toNotion(null)).toEqual({ title: [] })
      expect(codec.toNotion(undefined)).toEqual({ title: [] })
    })

    it('toScalar extracts plain text', () => {
      expect(
        codec.toScalar?.({
          type: 'title',
          title: [{ plain_text: 'Scalar Title' }]
        })
      ).toBe('Scalar Title')
      expect(codec.toScalar?.({ type: 'title' })).toBeNull()
    })
  })

  describe('rich_text codec', () => {
    const codec = PROPERTY_CODECS.rich_text
    it('fromNotion extracts plain text', () => {
      expect(
        codec.fromNotion({
          type: 'rich_text',
          rich_text: [{ plain_text: 'Text 1' }, { plain_text: ' Text 2' }]
        })
      ).toBe('Text 1 Text 2')
      expect(codec.fromNotion({ type: 'rich_text', rich_text: [] })).toBe('')
      expect(codec.fromNotion({ type: 'rich_text' })).toBeUndefined()
    })

    it('toNotion formats string to rich_text array', () => {
      expect(codec.toNotion('Body text')).toMatchObject({
        rich_text: [{ type: 'text', text: { content: 'Body text' } }]
      })
      expect(codec.toNotion('')).toEqual({ rich_text: [] })
      expect(codec.toNotion(null)).toEqual({ rich_text: [] })
    })

    it('toScalar extracts plain text', () => {
      expect(
        codec.toScalar?.({
          type: 'rich_text',
          rich_text: [{ plain_text: 'Text' }]
        })
      ).toBe('Text')
      expect(codec.toScalar?.({ type: 'rich_text' })).toBeNull()
    })
  })

  describe('number codec', () => {
    const codec = PROPERTY_CODECS.number
    it('fromNotion returns number', () => {
      expect(codec.fromNotion({ type: 'number', number: 42 })).toBe(42)
      expect(codec.fromNotion({ type: 'number', number: 0 })).toBe(0)
      expect(codec.fromNotion({ type: 'number', number: null })).toBeNull()
    })

    it('toNotion converts numbers and numeric strings', () => {
      expect(codec.toNotion(123)).toEqual({ number: 123 })
      expect(codec.toNotion('456')).toEqual({ number: 456 })
      expect(codec.toNotion('invalid')).toEqual({ number: null })
      expect(codec.toNotion('')).toEqual({ number: null })
      expect(codec.toNotion(null)).toEqual({ number: null })
    })

    it('toScalar returns numeric value', () => {
      expect(codec.toScalar?.({ type: 'number', number: 99 })).toBe(99)
      expect(codec.toScalar?.({ type: 'number', number: null })).toBeNull()
      expect(codec.toScalar?.({ type: 'number' })).toBeNull()
    })
  })

  describe('checkbox codec', () => {
    const codec = PROPERTY_CODECS.checkbox
    it('fromNotion returns boolean', () => {
      expect(codec.fromNotion({ type: 'checkbox', checkbox: true })).toBe(true)
      expect(codec.fromNotion({ type: 'checkbox', checkbox: false })).toBe(false)
    })

    it('toNotion converts boolean', () => {
      expect(codec.toNotion(true)).toEqual({ checkbox: true })
      expect(codec.toNotion(false)).toEqual({ checkbox: false })
      expect(codec.toNotion(null)).toEqual({ checkbox: null })
    })

    it('toScalar returns boolean', () => {
      expect(codec.toScalar?.({ type: 'checkbox', checkbox: true })).toBe(true)
      expect(codec.toScalar?.({ type: 'checkbox', checkbox: false })).toBe(false)
      expect(codec.toScalar?.({ type: 'checkbox' })).toBeNull()
    })
  })

  describe('select codec', () => {
    const codec = PROPERTY_CODECS.select
    it('fromNotion returns name', () => {
      expect(codec.fromNotion({ type: 'select', select: { name: 'Active' } })).toBe('Active')
      expect(codec.fromNotion({ type: 'select' })).toBeUndefined()
    })

    it('toNotion converts string to select object', () => {
      expect(codec.toNotion('Tag')).toEqual({ select: { name: 'Tag' } })
      expect(codec.toNotion('')).toEqual({ select: null })
      expect(codec.toNotion(null)).toEqual({ select: null })
    })

    it('toScalar returns name', () => {
      expect(codec.toScalar?.({ type: 'select', select: { name: 'Opt' } })).toBe('Opt')
      expect(codec.toScalar?.({ type: 'select' })).toBeNull()
    })
  })

  describe('multi_select codec', () => {
    const codec = PROPERTY_CODECS.multi_select
    it('fromNotion returns array of names', () => {
      expect(
        codec.fromNotion({
          type: 'multi_select',
          multi_select: [{ name: 'A' }, { name: 'B' }]
        })
      ).toEqual(['A', 'B'])
      expect(codec.fromNotion({ type: 'multi_select' })).toBeUndefined()
    })

    it('toNotion converts array of strings or objects', () => {
      expect(codec.toNotion(['A', 'B'])).toEqual({
        multi_select: [{ name: 'A' }, { name: 'B' }]
      })
      expect(codec.toNotion([{ name: 'A' }])).toEqual({
        multi_select: [{ name: 'A' }]
      })
      expect(codec.toNotion('')).toEqual({ multi_select: [] })
      expect(codec.toNotion(null)).toEqual({ multi_select: [] })
    })

    it('toScalar returns array of names', () => {
      expect(
        codec.toScalar?.({
          type: 'multi_select',
          multi_select: [{ name: 'X' }]
        })
      ).toEqual(['X'])
      expect(codec.toScalar?.({ type: 'multi_select' })).toBeNull()
    })
  })

  describe('status codec', () => {
    const codec = PROPERTY_CODECS.status
    it('fromNotion returns name', () => {
      expect(codec.fromNotion({ type: 'status', status: { name: 'In Progress' } })).toBe('In Progress')
      expect(codec.fromNotion({ type: 'status' })).toBeUndefined()
    })

    it('toNotion converts string to status object', () => {
      expect(codec.toNotion('Done')).toEqual({ status: { name: 'Done' } })
      expect(codec.toNotion('')).toEqual({ status: null })
      expect(codec.toNotion(null)).toEqual({ status: null })
    })

    it('toScalar returns status name', () => {
      expect(codec.toScalar?.({ type: 'status', status: { name: 'Blocked' } })).toBe('Blocked')
      expect(codec.toScalar?.({ type: 'status' })).toBeNull()
    })
  })

  describe('date codec', () => {
    const codec = PROPERTY_CODECS.date
    it('fromNotion extracts date or date range', () => {
      expect(codec.fromNotion({ type: 'date', date: { start: '2025-01-01' } })).toBe('2025-01-01')
      expect(codec.fromNotion({ type: 'date', date: { start: '2025-01-01', end: '2025-01-02' } })).toBe(
        '2025-01-01 to 2025-01-02'
      )
      expect(codec.fromNotion({ type: 'date' })).toBeUndefined()
    })

    it('toNotion wraps string or bare object', () => {
      expect(codec.toNotion('2025-01-01')).toEqual({ date: { start: '2025-01-01' } })
      expect(codec.toNotion({ start: '2025-01-01', end: '2025-01-02' })).toEqual({
        date: { start: '2025-01-01', end: '2025-01-02' }
      })
      expect(codec.toNotion('')).toEqual({ date: null })
      expect(codec.toNotion(null)).toEqual({ date: null })
    })

    it('toScalar returns start date', () => {
      expect(codec.toScalar?.({ type: 'date', date: { start: '2025-01-01' } })).toBe('2025-01-01')
      expect(codec.toScalar?.({ type: 'date' })).toBeNull()
    })
  })

  describe('url, email, phone_number codecs', () => {
    it('url fromNotion & toNotion', () => {
      expect(PROPERTY_CODECS.url.fromNotion({ type: 'url', url: 'https://example.com' })).toBe('https://example.com')
      expect(PROPERTY_CODECS.url.toNotion('https://example.com')).toEqual({ url: 'https://example.com' })
      expect(PROPERTY_CODECS.url.toNotion('')).toEqual({ url: null })
      expect(PROPERTY_CODECS.url.toNotion(null)).toEqual({ url: null })
    })

    it('email fromNotion & toNotion', () => {
      expect(PROPERTY_CODECS.email.fromNotion({ type: 'email', email: 'test@example.com' })).toBe('test@example.com')
      expect(PROPERTY_CODECS.email.toNotion('test@example.com')).toEqual({ email: 'test@example.com' })
      expect(PROPERTY_CODECS.email.toNotion('')).toEqual({ email: null })
      expect(PROPERTY_CODECS.email.toNotion(null)).toEqual({ email: null })
    })

    it('phone_number fromNotion & toNotion', () => {
      expect(PROPERTY_CODECS.phone_number.fromNotion({ type: 'phone_number', phone_number: '+123456' })).toBe('+123456')
      expect(PROPERTY_CODECS.phone_number.toNotion('+123456')).toEqual({ phone_number: '+123456' })
      expect(PROPERTY_CODECS.phone_number.toNotion('')).toEqual({ phone_number: null })
      expect(PROPERTY_CODECS.phone_number.toNotion(null)).toEqual({ phone_number: null })
    })
  })

  describe('relation codec & helpers', () => {
    const codec = PROPERTY_CODECS.relation
    it('extractPageId parses 32-char IDs from URLs', () => {
      expect(extractPageId('https://notion.so/workspace/My-Page-0123456789abcdef0123456789abcdef')).toBe(
        '0123456789abcdef0123456789abcdef'
      )
      expect(extractPageId('01234567-89ab-cdef-0123-456789abcdef')).toBe('01234567-89ab-cdef-0123-456789abcdef')
    })

    it('fromNotion extracts array of IDs', () => {
      expect(
        codec.fromNotion({
          type: 'relation',
          relation: [{ id: 'id1' }, { id: 'id2' }]
        })
      ).toEqual(['id1', 'id2'])
      expect(codec.fromNotion({ type: 'relation' })).toBeUndefined()
    })

    it('toNotion handles string, array, JSON array, and empty values', () => {
      expect(codec.toNotion('0123456789abcdef0123456789abcdef')).toEqual({
        relation: [{ id: '0123456789abcdef0123456789abcdef' }]
      })
      expect(toRelation('0123456789abcdef0123456789abcdef')).toEqual({
        relation: [{ id: '0123456789abcdef0123456789abcdef' }]
      })
      expect(codec.toNotion('["id1", "id2"]')).toEqual({
        relation: [{ id: 'id1' }, { id: 'id2' }]
      })
      expect(codec.toNotion(['id1', 'id2'])).toEqual({
        relation: [{ id: 'id1' }, { id: 'id2' }]
      })
      expect(codec.toNotion('')).toEqual({ relation: [] })
      expect(codec.toNotion(null)).toEqual({ relation: [] })
    })
  })

  describe('people codec', () => {
    const codec = PROPERTY_CODECS.people
    it('fromNotion extracts names or falls back to ids', () => {
      expect(
        codec.fromNotion({
          type: 'people',
          people: [{ name: 'Alice', id: 'u1' }, { id: 'u2' }]
        })
      ).toEqual(['Alice', 'u2'])
      expect(codec.fromNotion({ type: 'people' })).toBeUndefined()
    })

    it('toNotion wraps string array', () => {
      expect(codec.toNotion(['u1', 'u2'])).toEqual({
        people: [{ id: 'u1' }, { id: 'u2' }]
      })
      expect(codec.toNotion([{ id: 'u1' }])).toEqual({
        people: [{ id: 'u1' }]
      })
      expect(codec.toNotion('')).toEqual({ people: [] })
      expect(codec.toNotion(null)).toEqual({ people: [] })
    })

    it('toScalar returns ids array', () => {
      expect(codec.toScalar?.({ type: 'people', people: [{ id: 'u1' }] })).toEqual(['u1'])
      expect(codec.toScalar?.({ type: 'people' })).toBeNull()
    })
  })

  describe('files codec', () => {
    const codec = PROPERTY_CODECS.files
    it('fromNotion extracts URLs or names', () => {
      expect(
        codec.fromNotion({
          type: 'files',
          files: [
            { file: { url: 'https://s3/file.pdf' } },
            { external: { url: 'https://ext/file.pdf' } },
            { name: 'doc.pdf' }
          ]
        })
      ).toEqual(['https://s3/file.pdf', 'https://ext/file.pdf', 'doc.pdf'])
      expect(codec.fromNotion({ type: 'files' })).toBeUndefined()
    })

    it('toNotion wraps URLs as external files', () => {
      expect(codec.toNotion(['https://example.com/a.png'])).toEqual({
        files: [{ name: 'https://example.com/a.png', external: { url: 'https://example.com/a.png' } }]
      })
      expect(codec.toNotion('')).toEqual({ files: [] })
      expect(codec.toNotion(null)).toEqual({ files: [] })
    })
  })

  describe('readonly codecs', () => {
    it('formula codec extracts typed value and toScalar handles numbers, strings, booleans, dates', () => {
      const f = PROPERTY_CODECS.formula
      expect(f.isReadonly).toBe(true)
      expect(f.fromNotion({ type: 'formula', formula: { type: 'string', string: 'result' } })).toBe('result')
      expect(f.fromNotion({ type: 'formula', formula: { type: 'unknown' } })).toBeNull()
      expect(f.fromNotion({ type: 'formula', formula: {} })).toBeNull()
      expect(f.fromNotion({ type: 'formula' })).toBeUndefined()

      expect(f.toScalar?.({ type: 'formula', formula: { type: 'number', number: 42 } })).toBe(42)
      expect(f.toScalar?.({ type: 'formula', formula: { type: 'string', string: '3.14' } })).toBe(3.14)
      expect(f.toScalar?.({ type: 'formula', formula: { type: 'string', string: 'abc' } })).toBe('abc')
      expect(f.toScalar?.({ type: 'formula', formula: { type: 'string', string: null } })).toBeNull()
      expect(f.toScalar?.({ type: 'formula', formula: { type: 'boolean', boolean: true } })).toBe(true)
      expect(f.toScalar?.({ type: 'formula', formula: { type: 'date', date: { start: '2025-01-01' } } })).toBe(
        '2025-01-01'
      )
    })

    it('rollup codec', () => {
      const r = PROPERTY_CODECS.rollup
      expect(r.isReadonly).toBe(true)
      expect(r.fromNotion({ type: 'rollup', rollup: { number: 10 } })).toEqual({ number: 10 })
    })

    it('created_time and last_edited_time codecs', () => {
      expect(
        PROPERTY_CODECS.created_time.fromNotion({ type: 'created_time', created_time: '2025-01-01T00:00:00.000Z' })
      ).toBe('2025-01-01T00:00:00.000Z')
      expect(
        PROPERTY_CODECS.last_edited_time.fromNotion({
          type: 'last_edited_time',
          last_edited_time: '2025-01-02T00:00:00.000Z'
        })
      ).toBe('2025-01-02T00:00:00.000Z')
    })

    it('created_by and last_edited_by codecs', () => {
      expect(
        PROPERTY_CODECS.created_by.fromNotion({ type: 'created_by', created_by: { name: 'Alice', id: 'u1' } })
      ).toBe('Alice')
      expect(PROPERTY_CODECS.created_by.fromNotion({ type: 'created_by', created_by: { id: 'u1' } })).toBe('u1')
      expect(
        PROPERTY_CODECS.last_edited_by.fromNotion({ type: 'last_edited_by', last_edited_by: { name: 'Bob' } })
      ).toBe('Bob')
    })

    it('unique_id codec', () => {
      expect(
        PROPERTY_CODECS.unique_id.fromNotion({ type: 'unique_id', unique_id: { prefix: 'TASK', number: 12 } })
      ).toBe('TASK-12')
      expect(PROPERTY_CODECS.unique_id.fromNotion({ type: 'unique_id', unique_id: { number: 12 } })).toBe(12)
    })

    it('verification and button codecs', () => {
      expect(PROPERTY_CODECS.verification.isReadonly).toBe(true)
      expect(PROPERTY_CODECS.button.isReadonly).toBe(true)
    })
  })
})
