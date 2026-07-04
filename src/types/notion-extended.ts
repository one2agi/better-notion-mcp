/**
 * Notion SDK type augmentations.
 *
 * The official `@notionhq/client` SDK type definitions are incomplete in one
 * place that better-notion-mcp relies on: `pages.update` accepts `parent` in
 * the Notion API (used to move a page), but `UpdatePageParameters` does not
 * include it. This file exports a typed workaround. Once the SDK is patched
 * upstream, this file can be removed.
 *
 * Reference: https://www.notion.so/reference/page#move-a-page
 */
import type { Client, UpdatePageResponse } from '@notionhq/client'
import type { UpdatePageParameters } from '@notionhq/client/build/src/api-endpoints/pages'

/**
 * `pages.update` accepts `parent` in the Notion API (used to move a page), but
 * `UpdatePageParameters` does not include it. Local workaround.
 */
export type UpdatePageWithParentParameters = UpdatePageParameters & {
  parent: { type: 'page_id'; page_id: string } | { type: 'data_source_id'; data_source_id: string }
}

/**
 * Type-safe escape hatch: cast `notion.pages.update` to a function that accepts
 * `parent`. Used at the single call site that needs to move a page.
 *
 * Use this instead of `as any` so the bypass is documented and the call-site
 * retains parameter type-checking.
 */
export function updatePageWithParent(
  notion: Client,
  args: UpdatePageWithParentParameters
): Promise<UpdatePageResponse> {
  return (notion.pages.update as (args: UpdatePageWithParentParameters) => Promise<UpdatePageResponse>)(args)
}
