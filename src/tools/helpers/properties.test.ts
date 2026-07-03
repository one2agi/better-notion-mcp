import { describe, expect, it } from 'vitest'
import { buildSchemaMap, convertToNotionProperties, extractPageProperties, filterToSchemaKeys, findTitleColumnName, normalizeBlockProperties, READONLY_PROPERTY_TYPES, readPropertyValue, sanitizeReadonlyProperties } from './properties'

const richText = (content: string) => ({
  type: 'text',
  text: { content, link: null },
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default'
  }
})

describe('convertToNotionProperties', () => {
  it('returns empty object for empty properties', () => {
    expect(convertToNotionProperties({})).toEqual({})
  })

  describe('null and undefined values', () => {
    it('passes null through as-is', () => {
      const result = convertToNotionProperties({ field: null })
      expect(result).toEqual({ field: null })
    })

    it('passes undefined through as-is', () => {
      const result = convertToNotionProperties({ field: undefined })
      expect(result).toEqual({ field: undefined })
    })
  })

  describe('string values with schema', () => {
    it('converts title schema type', () => {
      const result = convertToNotionProperties({ Name: 'Hello' }, { Name: 'title' })
      expect(result).toEqual({
        Name: { title: [richText('Hello')] }
      })
    })

    it('converts rich_text schema type', () => {
      const result = convertToNotionProperties({ Description: 'Some text' }, { Description: 'rich_text' })
      expect(result).toEqual({
        Description: { rich_text: [richText('Some text')] }
      })
    })

    it('converts date schema type', () => {
      const result = convertToNotionProperties({ Due: '2025-01-15' }, { Due: 'date' })
      expect(result).toEqual({
        Due: { date: { start: '2025-01-15' } }
      })
    })

    it('converts url schema type', () => {
      const result = convertToNotionProperties({ Website: 'https://example.com' }, { Website: 'url' })
      expect(result).toEqual({
        Website: { url: 'https://example.com' }
      })
    })

    it('converts email schema type', () => {
      const result = convertToNotionProperties({ Email: 'test@example.com' }, { Email: 'email' })
      expect(result).toEqual({
        Email: { email: 'test@example.com' }
      })
    })

    it('converts phone_number schema type', () => {
      const result = convertToNotionProperties({ Phone: '+1234567890' }, { Phone: 'phone_number' })
      expect(result).toEqual({
        Phone: { phone_number: '+1234567890' }
      })
    })

    it('converts status schema type to status format (not select)', () => {
      const result = convertToNotionProperties({ Status: 'Not started' }, { Status: 'status' })
      expect(result).toEqual({
        Status: { status: { name: 'Not started' } }
      })
    })

    it('does not fall back to select when schema type is status', () => {
      const result = convertToNotionProperties({ State: 'In progress' }, { State: 'status' })
      expect(result).not.toEqual({ State: { select: { name: 'In progress' } } })
      expect(result).toEqual({ State: { status: { name: 'In progress' } } })
    })

    it('converts empty string for status field (API validates option names, not this layer)', () => {
      const result = convertToNotionProperties({ Status: '' }, { Status: 'status' })
      expect(result).toEqual({ Status: { status: { name: '' } } })
    })
  })

  describe('string values with mixed schema (status vs select fallback)', () => {
    it('converts status field via schema while falling back to select for unschematized field', () => {
      const result = convertToNotionProperties({ Status: 'In Progress', Priority: 'High' }, { Status: 'status' })
      expect(result).toEqual({
        Status: { status: { name: 'In Progress' } },
        Priority: { select: { name: 'High' } }
      })
    })
  })

  describe('string values without schema (auto-detect)', () => {
    it('detects "Name" key as title', () => {
      const result = convertToNotionProperties({ Name: 'My Page' })
      expect(result).toEqual({
        Name: { title: [richText('My Page')] }
      })
    })

    it('detects "Title" key as title', () => {
      const result = convertToNotionProperties({ Title: 'My Page' })
      expect(result).toEqual({
        Title: { title: [richText('My Page')] }
      })
    })

    it('detects lowercase "title" key as title', () => {
      const result = convertToNotionProperties({ title: 'My Page' })
      expect(result).toEqual({
        title: { title: [richText('My Page')] }
      })
    })

    it('falls back to select (not status) for keys containing "status" when schema is missing', () => {
      // Without schema, we cannot distinguish a `select` column named "Status" from an actual
      // `status` column, so default to `select` (Notion API rejects `{ status: ... }` on a
      // select column). Real `status` columns are handled by the schema-aware branch above.
      const result = convertToNotionProperties({ Status: 'Active' })
      expect(result).toEqual({
        Status: { select: { name: 'Active' } }
      })
    })

    it('falls back to select for other string keys', () => {
      const result = convertToNotionProperties({ Category: 'Active' })
      expect(result).toEqual({
        Category: { select: { name: 'Active' } }
      })
    })

    it('falls back to select (not status) for "Status" key when schema is missing', () => {
      // Most "Status"-named columns in Notion are actually `select` type, not `status`.
      // Without schema we cannot tell them apart, so default to select to avoid
      // sending `{ status: ... }` to a select column (which Notion API rejects).
      const result = convertToNotionProperties({ Status: 'Active' })
      expect(result).toEqual({
        Status: { select: { name: 'Active' } }
      })
    })

    it('falls back to select (not status) for "状态" key when schema is missing', () => {
      const result = convertToNotionProperties({ 状态: '进行中' })
      expect(result).toEqual({
        状态: { select: { name: '进行中' } }
      })
    })

    it('falls back to select (not status) for arbitrary key when schema is missing', () => {
      const result = convertToNotionProperties({ State: 'In progress' })
      expect(result).toEqual({
        State: { select: { name: 'In progress' } }
      })
    })
  })

  describe('number values', () => {
    it('converts number to Notion number format', () => {
      const result = convertToNotionProperties({ Price: 42 })
      expect(result).toEqual({
        Price: { number: 42 }
      })
    })

    it('converts zero', () => {
      const result = convertToNotionProperties({ Count: 0 })
      expect(result).toEqual({
        Count: { number: 0 }
      })
    })

    it('converts negative numbers', () => {
      const result = convertToNotionProperties({ Balance: -100.5 })
      expect(result).toEqual({
        Balance: { number: -100.5 }
      })
    })
  })

  describe('boolean values', () => {
    it('converts true to checkbox', () => {
      const result = convertToNotionProperties({ Done: true })
      expect(result).toEqual({
        Done: { checkbox: true }
      })
    })

    it('converts false to checkbox', () => {
      const result = convertToNotionProperties({ Done: false })
      expect(result).toEqual({
        Done: { checkbox: false }
      })
    })
  })

  describe('array values', () => {
    it('converts array of strings to multi_select', () => {
      const result = convertToNotionProperties({ Tags: ['frontend', 'react', 'typescript'] })
      expect(result).toEqual({
        Tags: {
          multi_select: [{ name: 'frontend' }, { name: 'react' }, { name: 'typescript' }]
        }
      })
    })

    it('preserves pre-formatted relation objects within a relation array', () => {
      const result = convertToNotionProperties({ Projects: ['abc123', { id: 'def456' }] }, { Projects: 'relation' })
      expect(result).toEqual({
        Projects: {
          relation: [{ id: 'abc123' }, { id: 'def456' }]
        }
      })
    })

    it('handles mixed string and non-string elements in a relation array (should not crash)', () => {
      const result = convertToNotionProperties({ Projects: ['abc123', 456, null] }, { Projects: 'relation' })
      expect(result).toEqual({
        Projects: {
          relation: [{ id: 'abc123' }, { id: '456' }, { id: 'null' }]
        }
      })
    })

    it('passes array of objects through as-is', () => {
      const relations = [{ id: 'abc-123' }, { id: 'def-456' }]
      const result = convertToNotionProperties({ Related: relations })
      expect(result).toEqual({
        Related: relations
      })
    })

    it('passes empty array through as-is', () => {
      const result = convertToNotionProperties({ Items: [] })
      expect(result).toEqual({
        Items: []
      })
    })

    describe('mixed type arrays', () => {
      it('passes mixed array starting with string through as-is', () => {
        const mixed = ['tag', 123]
        const result = convertToNotionProperties({ Mixed: mixed })
        expect(result).toEqual({
          Mixed: mixed
        })
      })

      it('passes mixed array starting with number through as-is', () => {
        const mixed = [123, 'tag']
        const result = convertToNotionProperties({ Mixed: mixed })
        expect(result).toEqual({
          Mixed: mixed
        })
      })

      it('passes through non-string non-array values within an array if not a relation schema', () => {
        const mixed = [true, { complex: true }]
        const result = convertToNotionProperties({ Items: mixed })
        expect(result).toEqual({ Items: mixed })
      })
    })
  })

  describe('object values', () => {
    it('passes objects through as-is (already in Notion format)', () => {
      const notionDate = { date: { start: '2025-01-01', end: '2025-01-31' } }
      const result = convertToNotionProperties({ Period: notionDate })
      expect(result).toEqual({
        Period: notionDate
      })
    })

    it('passes complex nested objects through as-is', () => {
      const formula = { formula: { expression: 'prop("Price") * 1.1' } }
      const result = convertToNotionProperties({ Total: formula })
      expect(result).toEqual({
        Total: formula
      })
    })
  })

  describe('relation values with schema', () => {
    it('converts a single page ID string to relation format', () => {
      const result = convertToNotionProperties({ Project: 'abc123def456' }, { Project: 'relation' })
      expect(result).toEqual({
        Project: { relation: [{ id: 'abc123def456' }] }
      })
    })

    it('converts a UUID string to relation format', () => {
      const result = convertToNotionProperties(
        { Project: '12345678-1234-1234-1234-123456789abc' },
        { Project: 'relation' }
      )
      expect(result).toEqual({
        Project: { relation: [{ id: '12345678-1234-1234-1234-123456789abc' }] }
      })
    })

    it('converts a Notion URL to relation format by extracting the page ID', () => {
      const result = convertToNotionProperties(
        { Project: 'https://www.notion.so/My-Page-abc123def45678901234567890abcdef' },
        { Project: 'relation' }
      )
      expect(result).toEqual({
        Project: { relation: [{ id: 'abc123def45678901234567890abcdef' }] }
      })
    })

    it('converts a Notion URL with query params to relation format', () => {
      const result = convertToNotionProperties(
        { Project: 'https://www.notion.so/workspace/abc123def45678901234567890abcdef?v=xyz' },
        { Project: 'relation' }
      )
      expect(result).toEqual({
        Project: { relation: [{ id: 'abc123def45678901234567890abcdef' }] }
      })
    })

    it('converts an array of page ID strings to relation format', () => {
      const result = convertToNotionProperties({ Projects: ['abc123', 'def456'] }, { Projects: 'relation' })
      expect(result).toEqual({
        Projects: { relation: [{ id: 'abc123' }, { id: 'def456' }] }
      })
    })

    it('converts an array of Notion URLs to relation format', () => {
      const result = convertToNotionProperties(
        {
          Projects: [
            'https://www.notion.so/Page-A-abc123def45678901234567890abcdef',
            'https://www.notion.so/Page-B-fedcba09876543210987654321fedcba'
          ]
        },
        { Projects: 'relation' }
      )
      expect(result).toEqual({
        Projects: {
          relation: [{ id: 'abc123def45678901234567890abcdef' }, { id: 'fedcba09876543210987654321fedcba' }]
        }
      })
    })

    it('converts a JSON array string to relation format', () => {
      const result = convertToNotionProperties({ Projects: '["abc123", "def456"]' }, { Projects: 'relation' })
      expect(result).toEqual({
        Projects: { relation: [{ id: 'abc123' }, { id: 'def456' }] }
      })
    })

    it('falls back to single value if JSON array contains non-string elements', () => {
      const result = convertToNotionProperties({ Projects: '["abc123", 123]' }, { Projects: 'relation' })
      expect(result).toEqual({
        Projects: { relation: [{ id: '["abc123", 123]' }] }
      })
    })

    it('converts empty string to empty relation array', () => {
      const result = convertToNotionProperties({ Project: '' }, { Project: 'relation' })
      expect(result).toEqual({
        Project: { relation: [] }
      })
    })

    it('converts empty array to empty relation', () => {
      const result = convertToNotionProperties({ Projects: [] }, { Projects: 'relation' })
      expect(result).toEqual({
        Projects: { relation: [] }
      })
    })

    it('passes through pre-formatted relation objects as-is', () => {
      const value = { relation: [{ id: 'abc123' }] }
      const result = convertToNotionProperties({ Project: value }, { Project: 'relation' })
      expect(result).toEqual({
        Project: value
      })
    })

    it('treats malformed JSON starting with [ as a single value', () => {
      const result = convertToNotionProperties({ Project: '[invalid' }, { Project: 'relation' })
      expect(result).toEqual({
        Project: { relation: [{ id: '[invalid' }] }
      })
    })

    it('handles JSON array with non-string elements by falling back to single value', () => {
      const result = convertToNotionProperties({ Project: '[123]' }, { Project: 'relation' })
      expect(result).toEqual({
        Project: { relation: [{ id: '[123]' }] }
      })
    })

    it('passes through non-string non-array values as-is (coverage for line 36)', () => {
      // If the value is a number, it will be auto-detected as a number property
      const result = convertToNotionProperties({ Project: 123 }, { Project: 'relation' })
      expect(result).toEqual({
        Project: { number: 123 }
      })
    })
  })

  it('passes through unsupported types as-is (e.g. BigInt) (coverage for line 117)', () => {
    const bigIntValue = BigInt(9007199254740991)
    const result = convertToNotionProperties({ BigField: bigIntValue })
    expect(result).toEqual({ BigField: bigIntValue })
  })

  describe('mixed properties with schema', () => {
    it('converts multiple property types in a single call', () => {
      const properties = {
        Name: 'Project Alpha',
        Description: 'A cool project',
        Priority: 'High',
        Score: 95,
        Active: true,
        Tags: ['urgent', 'review'],
        Due: '2025-06-01',
        Metadata: { custom: true },
        Notes: null
      }
      const schema: Record<string, string> = {
        Name: 'title',
        Description: 'rich_text',
        Due: 'date'
      }

      const result = convertToNotionProperties(properties, schema)

      expect(result).toEqual({
        Name: { title: [richText('Project Alpha')] },
        Description: { rich_text: [richText('A cool project')] },
        Priority: { select: { name: 'High' } },
        Score: { number: 95 },
        Active: { checkbox: true },
        Tags: { multi_select: [{ name: 'urgent' }, { name: 'review' }] },
        Due: { date: { start: '2025-06-01' } },
        Metadata: { custom: true },
        Notes: null
      })
    })
  })
})

describe('extractPageProperties', () => {
  it('extracts title', () => {
    const props = {
      Name: {
        type: 'title',
        title: [{ plain_text: 'Hello ' }, { plain_text: 'World' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Name: 'Hello World' })
  })

  it('handles empty title correctly', () => {
    const props = {
      Name: {
        type: 'title',
        title: []
      }
    }
    expect(extractPageProperties(props)).toEqual({ Name: '' })
  })

  it('extracts rich_text', () => {
    const props = {
      Desc: {
        type: 'rich_text',
        rich_text: [{ plain_text: 'Some ' }, { plain_text: 'text' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Desc: 'Some text' })
  })

  it('extracts select', () => {
    const props = {
      Status: {
        type: 'select',
        select: { name: 'Done' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Status: 'Done' })
  })

  it('extracts multi_select', () => {
    const props = {
      Tags: {
        type: 'multi_select',
        multi_select: [{ name: 'A' }, { name: 'B' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Tags: ['A', 'B'] })
  })

  it('extracts number', () => {
    const props = {
      Price: {
        type: 'number',
        number: 42
      }
    }
    expect(extractPageProperties(props)).toEqual({ Price: 42 })
  })

  it('extracts checkbox', () => {
    const props = {
      Done: {
        type: 'checkbox',
        checkbox: true
      }
    }
    expect(extractPageProperties(props)).toEqual({ Done: true })
  })

  it('extracts url', () => {
    const props = {
      Link: {
        type: 'url',
        url: 'https://example.com'
      }
    }
    expect(extractPageProperties(props)).toEqual({ Link: 'https://example.com' })
  })

  it('extracts email', () => {
    const props = {
      Email: {
        type: 'email',
        email: 'test@example.com'
      }
    }
    expect(extractPageProperties(props)).toEqual({ Email: 'test@example.com' })
  })

  it('extracts phone_number', () => {
    const props = {
      Phone: {
        type: 'phone_number',
        phone_number: '123-456-7890'
      }
    }
    expect(extractPageProperties(props)).toEqual({ Phone: '123-456-7890' })
  })

  it('extracts date with start and end', () => {
    const props = {
      Timeline: {
        type: 'date',
        date: { start: '2023-01-01', end: '2023-01-31' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Timeline: '2023-01-01 to 2023-01-31' })
  })

  it('extracts date with start only', () => {
    const props = {
      Date: {
        type: 'date',
        date: { start: '2023-01-01' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Date: '2023-01-01' })
  })

  it('extracts relation', () => {
    const props = {
      Related: {
        type: 'relation',
        relation: [{ id: 'id1' }, { id: 'id2' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Related: ['id1', 'id2'] })
  })

  it('extracts rollup', () => {
    const rollupValue = { type: 'number', number: 100, function: 'sum' }
    const props = {
      Total: {
        type: 'rollup',
        rollup: rollupValue
      }
    }
    expect(extractPageProperties(props)).toEqual({ Total: rollupValue })
  })

  it('extracts people with name', () => {
    const props = {
      Assignee: {
        type: 'people',
        people: [
          { name: 'Alice', id: 'a1' },
          { name: 'Bob', id: 'b2' }
        ]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Assignee: ['Alice', 'Bob'] })
  })

  it('extracts people falling back to id', () => {
    const props = {
      Assignee: {
        type: 'people',
        people: [{ id: 'a1' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Assignee: ['a1'] })
  })

  it('extracts files (url, external url, name fallback)', () => {
    const props = {
      Attachments: {
        type: 'files',
        files: [{ file: { url: 'internal.png' } }, { external: { url: 'external.png' } }, { name: 'fallback.txt' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Attachments: ['internal.png', 'external.png', 'fallback.txt'] })
  })

  it('extracts formula string', () => {
    const props = {
      Calc: {
        type: 'formula',
        formula: { type: 'string', string: 'result' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Calc: 'result' })
  })

  it('extracts formula returning null when type is unsupported', () => {
    const props = {
      Calc: {
        type: 'formula',
        formula: { type: 'unknown' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Calc: null })
  })

  it('extracts formula returning null when type is missing', () => {
    const props = {
      Calc: {
        type: 'formula',
        formula: {}
      }
    }
    expect(extractPageProperties(props)).toEqual({ Calc: null })
  })

  it('extracts created_time', () => {
    const props = {
      Created: {
        type: 'created_time',
        created_time: '2023-01-01T00:00:00Z'
      }
    }
    expect(extractPageProperties(props)).toEqual({ Created: '2023-01-01T00:00:00Z' })
  })

  it('extracts last_edited_time', () => {
    const props = {
      Edited: {
        type: 'last_edited_time',
        last_edited_time: '2023-01-02T00:00:00Z'
      }
    }
    expect(extractPageProperties(props)).toEqual({ Edited: '2023-01-02T00:00:00Z' })
  })

  it('extracts created_by name', () => {
    const props = {
      Author: {
        type: 'created_by',
        created_by: { name: 'Alice', id: 'a1' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Author: 'Alice' })
  })

  it('extracts created_by falling back to id', () => {
    const props = {
      Author: {
        type: 'created_by',
        created_by: { id: 'a1' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Author: 'a1' })
  })

  it('extracts last_edited_by name', () => {
    const props = {
      Editor: {
        type: 'last_edited_by',
        last_edited_by: { name: 'Bob', id: 'b1' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Editor: 'Bob' })
  })

  it('extracts last_edited_by falling back to id', () => {
    const props = {
      Editor: {
        type: 'last_edited_by',
        last_edited_by: { id: 'b1' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Editor: 'b1' })
  })

  it('extracts status', () => {
    const props = {
      Progress: {
        type: 'status',
        status: { name: 'In Progress' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Progress: 'In Progress' })
  })

  it('extracts unique_id with prefix', () => {
    const props = {
      ID: {
        type: 'unique_id',
        unique_id: { prefix: 'TASK', number: 123 }
      }
    }
    expect(extractPageProperties(props)).toEqual({ ID: 'TASK-123' })
  })

  it('extracts unique_id without prefix', () => {
    const props = {
      ID: {
        type: 'unique_id',
        unique_id: { number: 456 }
      }
    }
    expect(extractPageProperties(props)).toEqual({ ID: 456 })
  })

  it('ignores unsupported or malformed properties', () => {
    const props = {
      BadTitle: {
        type: 'title'
        // missing .title
      },
      UnknownType: {
        type: 'magical_type'
      }
    }
    expect(extractPageProperties(props)).toEqual({})
  })

  it('handles null, undefined or empty input', () => {
    expect(extractPageProperties(null)).toEqual({})
    expect(extractPageProperties(undefined)).toEqual({})
    expect(extractPageProperties({})).toEqual({})
  })

  it('only reads p.type once per iteration (uses cached local)', () => {
    // Define a getter for `type` that counts accesses. The optimized
    // extractor caches the value into a local on the first read, so the
    // remaining 20+ branches in the if/else chain don't trigger the getter.
    let typeReads = 0
    const props: any = {
      Name: new Proxy(
        { title: [{ plain_text: 'X' }], _type: 'title' },
        {
          get(target, prop) {
            if (prop === 'type') {
              typeReads++
              return target._type
            }
            return (target as any)[prop]
          }
        }
      )
    }
    expect(extractPageProperties(props)).toEqual({ Name: 'X' })
    expect(typeReads).toBe(1)
  })

  it('extracts files with mixed file/external/name shapes', () => {
    const props = {
      Files: {
        type: 'files',
        files: [
          { file: { url: 'https://internal/file1.pdf' }, name: 'A' },
          { external: { url: 'https://external/file2.png' }, name: 'B' },
          { name: 'just-a-name.txt' }
        ]
      }
    }
    expect(extractPageProperties(props)).toEqual({
      Files: ['https://internal/file1.pdf', 'https://external/file2.png', 'just-a-name.txt']
    })
  })

  it('extracts people with names + ids fallback', () => {
    const props = {
      Owners: {
        type: 'people',
        people: [{ name: 'Alice', id: 'u1' }, { id: 'u2' }]
      }
    }
    expect(extractPageProperties(props)).toEqual({ Owners: ['Alice', 'u2'] })
  })

  it('extracts date range', () => {
    const props = {
      Window: {
        type: 'date',
        date: { start: '2026-01-01', end: '2026-01-31' }
      }
    }
    expect(extractPageProperties(props)).toEqual({ Window: '2026-01-01 to 2026-01-31' })
  })
})

describe('property helpers', () => {
  describe('findTitleColumnName', () => {
    it('returns the title column name from a schema', () => {
      expect(findTitleColumnName({ Subject: 'title', Body: 'rich_text' })).toBe('Subject')
      expect(findTitleColumnName({ 名称: 'title', 状态: 'select' })).toBe('名称')
    })

    it('returns null when no title column exists', () => {
      expect(findTitleColumnName({ Body: 'rich_text', Status: 'select' })).toBeNull()
    })

    it('returns null for empty schema', () => {
      expect(findTitleColumnName({})).toBeNull()
    })
  })

  describe('filterToSchemaKeys', () => {
    it('drops keys not in the schema', () => {
      const out = filterToSchemaKeys(
        { Name: 'X', Status: 'Active' },
        { Title: 'title', Status: 'select' }
      )
      expect(out).toEqual({ Status: 'Active' })
    })

    it('preserves keys whose names match the schema even if values are not schema-shaped', () => {
      const out = filterToSchemaKeys(
        { Status: { select: { name: 'Active' } }, Other: 'foo' },
        { Status: 'select' }
      )
      expect(out).toEqual({ Status: { select: { name: 'Active' } } })
    })

    it('returns empty object when nothing matches', () => {
      const out = filterToSchemaKeys({ Foo: 'bar' }, { Status: 'select' })
      expect(out).toEqual({})
    })
  })

  describe('sanitizeReadonlyProperties', () => {
    it('strips all 8 readonly types and keeps writable types', () => {
      const input = {
        Name: { type: 'title', title: [{ plain_text: 'A' }] },
        Status: { type: 'select', select: { name: 'Active' } },
        Score: { type: 'number', number: 5 },
        Created: { type: 'created_time' },
        Edited: { type: 'last_edited_time' },
        Author: { type: 'created_by' },
        Editor: { type: 'last_edited_by' },
        UID: { type: 'unique_id' },
        RollupCol: { type: 'rollup' },
        FormulaCol: { type: 'formula' },
        Verify: { type: 'verification' }
      }
      const out = sanitizeReadonlyProperties(input)
      expect(Object.keys(out).sort()).toEqual(['Name', 'Score', 'Status'])
    })

    it('returns empty object for undefined input', () => {
      expect(sanitizeReadonlyProperties(undefined)).toEqual({})
    })

    it('passes through properties without a type field', () => {
      const input = { Plain: { foo: 'bar' } }
      expect(sanitizeReadonlyProperties(input)).toEqual({ Plain: { foo: 'bar' } })
    })
  })

  describe('sanitizeReadonlyProperties (reverse tests for official MCP behavior)', () => {
    it('replicates official MCP: filters all read-only + server-managed property types', () => {
      // What official MCP does: skip these before forwarding to Notion API
      const input = {
        // Writable (preserve)
        Name: { type: 'title', title: [{ plain_text: 'A' }] },
        Status: { type: 'select', select: { name: 'Active' } },
        Tags: { type: 'multi_select', multi_select: [{ name: 'a' }] },
        Score: { type: 'number', number: 42 },
        Done: { type: 'checkbox', checkbox: true },
        Date: { type: 'date', date: { start: '2026-01-01' } },
        URL: { type: 'url', url: 'https://x.com' },
        Email: { type: 'email', email: 'a@b.com' },
        Phone: { type: 'phone_number', phone_number: '123' },
        Files: { type: 'files', files: [{ file: { url: 'x' } }] },
        People: { type: 'people', people: [{ id: 'u' }] },
        StatusType: { type: 'status', status: { name: 'OK' } },
        Relation: { type: 'relation', relation: [{ id: 'p' }] },
        Rollup: { type: 'rollup', rollup: { number: 1, array: [] } },

        // Server-managed (drop)
        Created: { type: 'created_time', created_time: '2026-01-01' },
        Edited: { type: 'last_edited_time', last_edited_time: '2026-01-01' },
        Author: { type: 'created_by', created_by: { id: 'u' } },
        Editor: { type: 'last_edited_by', last_edited_by: { id: 'u' } },
        UID: { type: 'unique_id', unique_id: { number: 1 } },
        Formula: { type: 'formula', formula: { type: 'number', number: 42 } },
        Verify: { type: 'verification' }
      }
      const out = sanitizeReadonlyProperties(input)
      const expectedKept = ['Name', 'Status', 'Tags', 'Score', 'Done', 'Date', 'URL', 'Email', 'Phone', 'Files', 'People', 'StatusType', 'Relation']
      expect(Object.keys(out).sort()).toEqual(expectedKept.sort())
    })
  })

  describe('sanitizeReadonlyProperties (extended for Bug #23 + #29)', () => {
    it('filters verification type (per Notion API docs)', () => {
      const input = {
        Name: { type: 'title' },
        Verify: { type: 'verification' }
      }
      expect(Object.keys(sanitizeReadonlyProperties(input))).toEqual(['Name'])
    })

    it('drops empty relations (Notion API rejects relation: [])', () => {
      const input = {
        Name: { type: 'title' },
        People: { type: 'relation', relation: [] },
        Items: { type: 'relation', relation: [{ id: 'a' }] }
      }
      const out = sanitizeReadonlyProperties(input)
      expect(Object.keys(out).sort()).toEqual(['Items', 'Name'])
    })

    it('drops empty rich_text / title arrays (Notion API rejects)', () => {
      const input = {
        T1: { type: 'title', title: [] },
        T2: { type: 'title', title: [{ plain_text: 'ok' }] },
        R1: { type: 'rich_text', rich_text: [] },
        R2: { type: 'rich_text', rich_text: [{ plain_text: 'ok' }] }
      }
      const out = sanitizeReadonlyProperties(input)
      expect(Object.keys(out).sort()).toEqual(['R2', 'T2'])
    })

    it('drops empty people / files arrays', () => {
      const input = {
        P: { type: 'people', people: [] },
        F: { type: 'files', files: [] },
        P2: { type: 'people', people: [{ id: 'u' }] }
      }
      const out = sanitizeReadonlyProperties(input)
      expect(Object.keys(out)).toEqual(['P2'])
    })

    it('drops properties with null select/status value (Notion API rejects)', () => {
      const input = {
        HasValue: { type: 'select', select: { name: 'A' } },
        NullSelect: { type: 'select', select: null },
        NullStatus: { type: 'status', status: null },
        HasStatus: { type: 'status', status: { name: 'OK' } }
      }
      const out = sanitizeReadonlyProperties(input)
      expect(Object.keys(out).sort()).toEqual(['HasStatus', 'HasValue'])
    })
  })

  describe('READONLY_PROPERTY_TYPES', () => {
    it('contains exactly the 8 known readonly types including verification', () => {
      expect([...READONLY_PROPERTY_TYPES].sort()).toEqual([
        'created_by',
        'created_time',
        'formula',
        'last_edited_by',
        'last_edited_time',
        'rollup',
        'unique_id',
        'verification'
      ])
    })

    it('contains verification in readonly set (per Notion API docs)', () => {
      expect(READONLY_PROPERTY_TYPES.has('verification')).toBe(true)
    })
  })
})

describe('normalizeBlockProperties', () => {
  it('converts string[][] cells to RichText[][] for table_row', () => {
    const out = normalizeBlockProperties('table_row', { cells: [['A', 'B'], ['C', 'D']] })
    // Notion API: cells is RichText[][] — each cell is itself an array of RichText
    expect(out.cells).toHaveLength(2)
    expect(out.cells[0]).toHaveLength(2)
    expect(out.cells[0][0]).toHaveLength(1)
    expect(out.cells[0][0][0]).toMatchObject({ type: 'text' })
  })

  it('passes through RichText[][] cells', () => {
    const cells = [[{ type: 'text', text: { content: 'A' } }]]
    expect(normalizeBlockProperties('table_row', { cells }).cells).toBe(cells)
  })

  it('throws on invalid table_row.cells', () => {
    expect(() => normalizeBlockProperties('table_row', { cells: 'bad' })).toThrow(/cells/)
  })

  it('handles synced_block null (unlink)', () => {
    expect(normalizeBlockProperties('synced_block', { synced_from: null })).toEqual({ synced_from: null })
  })

  it('handles synced_block { block_id } (link)', () => {
    expect(normalizeBlockProperties('synced_block', { synced_from: { block_id: 'x' } })).toEqual({
      synced_from: { block_id: 'x' }
    })
  })

  it('throws on invalid synced_block shape', () => {
    expect(() => normalizeBlockProperties('synced_block', { synced_from: 42 })).toThrow(/synced_from/)
  })

  it('link_to_page requires exactly one target', () => {
    expect(() => normalizeBlockProperties('link_to_page', {})).toThrow(/exactly one/)
    expect(() => normalizeBlockProperties('link_to_page', { page_id: 'p', database_id: 'd' })).toThrow(
      /exactly one/
    )
    expect(normalizeBlockProperties('link_to_page', { page_id: 'p' })).toEqual({ page_id: 'p' })
  })

  it('column requires width_ratio in (0, 1]', () => {
    expect(() => normalizeBlockProperties('column', { width_ratio: 0 })).toThrow(/width_ratio/)
    expect(() => normalizeBlockProperties('column', { width_ratio: 2 })).toThrow(/width_ratio/)
    expect(normalizeBlockProperties('column', { width_ratio: 0.5 })).toEqual({ width_ratio: 0.5 })
  })

  it('passes through unknown block types', () => {
    expect(normalizeBlockProperties('paragraph', { foo: 'bar' })).toEqual({ foo: 'bar' })
  })
})

describe('readPropertyValue', () => {
  const pageOf = (type: string, value: any) => ({ properties: { Field: { type, [type]: value } } })

  it('returns number for number type', () => {
    expect(readPropertyValue(pageOf('number', 42), 'Field')).toBe(42)
  })

  it('returns boolean for checkbox', () => {
    expect(readPropertyValue(pageOf('checkbox', true), 'Field')).toBe(true)
  })

  it('returns name for select', () => {
    expect(readPropertyValue(pageOf('select', { name: 'A' }), 'Field')).toBe('A')
  })

  it('returns null for missing property', () => {
    expect(readPropertyValue({ properties: {} }, 'Field')).toBeNull()
  })

  it('returns null for missing page', () => {
    expect(readPropertyValue(null, 'Field')).toBeNull()
  })

  it('returns formula.number for number formula', () => {
    expect(readPropertyValue(pageOf('formula', { type: 'number', number: 42 }), 'Field')).toBe(42)
  })

  it('returns formula.date.start for date formula', () => {
    expect(readPropertyValue(pageOf('formula', { type: 'date', date: { start: '2025-01-01' } }), 'Field')).toBe(
      '2025-01-01'
    )
  })

  it('returns formula.boolean for boolean formula', () => {
    expect(readPropertyValue(pageOf('formula', { type: 'boolean', boolean: true }), 'Field')).toBe(true)
  })
})

describe('buildSchemaMap', () => {
  it('builds type+id map from properties', () => {
    const out = buildSchemaMap({
      Name: { type: 'title', id: 'p1' },
      Status: { type: 'select', id: 'p2', select: { options: [{ name: 'A' }, { name: 'B' }] } }
    })
    expect(out.Name).toEqual({ type: 'title', id: 'p1' })
    expect(out.Status.options).toEqual(['A', 'B'])
  })

  it('includes formula expression', () => {
    const out = buildSchemaMap({
      F: { type: 'formula', id: 'p1', formula: { expression: 'prop("X")' } }
    })
    expect(out.F.expression).toBe('prop("X")')
  })

  it('includes multi_select options', () => {
    const out = buildSchemaMap({
      Tags: { type: 'multi_select', id: 'p3', multi_select: { options: [{ name: 'x' }, { name: 'y' }] } }
    })
    expect(out.Tags.options).toEqual(['x', 'y'])
  })

  it('skips options when includeOptions=false', () => {
    const out = buildSchemaMap(
      { Status: { type: 'select', id: 'p2', select: { options: [{ name: 'A' }] } } },
      { includeOptions: false }
    )
    expect(out.Status).toEqual({ type: 'select', id: 'p2' })
  })

  it('returns empty object for undefined input', () => {
    expect(buildSchemaMap(undefined)).toEqual({})
  })
})
