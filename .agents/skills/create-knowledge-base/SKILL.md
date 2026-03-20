---
name: create-knowledge-base
description: Create a structured Notion knowledge base — define schema, create database, populate template pages
argument-hint: "[topic or domain]"
---

# Create Knowledge Base

Guide the user through creating a structured Notion knowledge base using better-notion-mcp.

## Steps

1. **Define the knowledge domain** — ask the user what they want to organize (e.g., technical docs, meeting notes, project tracker).

2. **Design database schema** using the `databases` tool:
   - `databases(action="create", parent_id="<page_id>", title="Knowledge Base Name", properties={...})`
   - Common property types: title, rich_text, select, multi_select, date, url, checkbox
   - Include relevant categories, tags, and status fields

3. **Create template pages** using the `pages` tool:
   - `pages(action="create", parent_id="<database_id>", properties={...}, content=[...])`
   - Create 2-3 example entries to demonstrate the schema
   - Include content blocks showing the expected structure

4. **Add content structure** using the `blocks` tool:
   - Add headings, callouts, toggles for organized content
   - Use `blocks(action="append", parent_id="<page_id>", children=[...])`

5. **Verify and present**:
   - `databases(action="query", database_id="<id>")` to show the created entries
   - Present the knowledge base structure to the user

## When to Use

- Setting up a new project documentation space
- Creating a structured repository for research or notes
- Building a team wiki or knowledge base
- Organizing reference materials by category
