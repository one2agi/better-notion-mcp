/**
 * Documentation Reader Service
 * Consolidated security-hardened markdown documentation reader
 */

import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NotionMCPError } from './errors.js'

// Get docs directory path - works for both bundled CLI and unbundled/source code
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const DOCS_DIR =
  __dirname.endsWith('bin') || __dirname.endsWith(`bin${sep}`)
    ? join(__dirname, '..', 'build', 'src', 'docs')
    : join(__dirname, '..', '..', 'docs')

export interface ReadDocOptions {
  displayName?: string
  suggestion?: string
  securitySuggestion?: string
}

/**
 * Read documentation content safely with path traversal defense
 *
 * @param fileName Documentation file name or path
 * @param options Optional display name and error suggestions
 * @returns Markdown documentation file content
 */
export async function readDocContent(fileName: string, options?: ReadDocOptions): Promise<string> {
  // Pre-emptive defense against directory traversal in fileName
  if (fileName.includes('..') || isAbsolute(fileName)) {
    throw new NotionMCPError(
      'Path traversal attempt detected',
      'SECURITY_ERROR',
      options?.securitySuggestion ?? 'Invalid path'
    )
  }

  const safeName = basename(fileName)
  const fullPath = join(DOCS_DIR, safeName)
  const rel = relative(DOCS_DIR, fullPath)

  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new NotionMCPError(
      'Path traversal attempt detected',
      'SECURITY_ERROR',
      options?.securitySuggestion ?? 'Invalid path'
    )
  }

  try {
    return await readFile(fullPath, 'utf-8')
  } catch {
    const target = options?.displayName ?? safeName
    throw new NotionMCPError(
      `Documentation not found for: ${target}`,
      'DOC_NOT_FOUND',
      options?.suggestion ?? 'Check resource URI'
    )
  }
}
