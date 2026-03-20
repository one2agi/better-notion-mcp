---
name: sync-project
description: Sync codebase context to Notion — scan project, create/update pages, link related content
argument-hint: "[project path or name]"
---

# Sync Project to Notion

Sync codebase information and context to a Notion workspace for documentation and tracking.

## Steps

1. **Scan project structure**:
   - Read the project's README, CLAUDE.md, package.json/pyproject.toml
   - Identify key components, dependencies, and architecture

2. **Create or find project page**:
   - Search existing pages: `pages(action="search", query="Project: <name>")`
   - If not found, create: `pages(action="create", parent_id="<workspace_page>", ...)`

3. **Update project documentation**:
   - Architecture overview (from code analysis)
   - Key files and their purposes
   - Dependencies and versions
   - Recent changes (from git log)

4. **Link related content**:
   - Cross-reference related pages using Notion mentions
   - Update database entries if project is tracked in a database

5. **Report sync results** to the user.

## When to Use

- After major project changes or releases
- Setting up documentation for a new project
- Periodic project documentation updates
- Onboarding new team members (sync current state)
