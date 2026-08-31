import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { GitBufferOpts, GitBufferResult, GitOpts, GitResult } from './git.ts'

export const REQUIRED_TREE_ENTRY_MODE = '100644'
export const REQUIRED_TREE_ENTRY_TYPE = 'blob'

const FORBIDDEN_REDUCED_PATH_SEGMENTS = new Set(['', '.', '..', '.git', 'git~1'])
const DEFAULT_IGNORABLE_CODE_POINT_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g
const TRAILING_DOT_OR_SPACE_PATTERN = /[. ]+$/
const NEWLINE_BYTE = 0x0a

const reducePathSegmentForForbiddenComparison = (segment: string): string =>
  segment
    .normalize('NFC')
    .replace(DEFAULT_IGNORABLE_CODE_POINT_PATTERN, '')
    .toLowerCase()
    .replace(TRAILING_DOT_OR_SPACE_PATTERN, '')

export type GitRunner = (rt: Runtime, repo: string, args: string[], opts?: GitOpts) => GitResult
export type GitBufferRunner = (rt: Runtime, repo: string, args: string[], opts?: GitBufferOpts) => GitBufferResult

export type MaterialiseTreeDeps = { runGit: GitRunner; runGitBuffer: GitBufferRunner }

export type MaterialiseTreeOutcome = { ok: true } | { ok: false; detail: string }

type RawTreeEntry = { mode: string; type: string; objectId: string; relPath: string }
type ValidatedTreeEntry = { objectId: string; relPath: string }

const parseTreeListing = (
  listing: string
): { ok: true; entries: RawTreeEntry[] } | { ok: false; detail: string } => {
  const entries: RawTreeEntry[] = []
  for (const record of listing.split('\0')) {
    if (record.length === 0) continue
    const tabIndex = record.indexOf('\t')
    if (tabIndex === -1) {
      return { ok: false, detail: `a ledger tree entry could not be parsed: ${JSON.stringify(record)}` }
    }
    const meta = record.slice(0, tabIndex)
    const relPath = record.slice(tabIndex + 1)
    const metaParts = meta.split(' ')
    if (metaParts.length !== 3) {
      return { ok: false, detail: `a ledger tree entry has an unexpected shape: ${JSON.stringify(record)}` }
    }
    const [mode, type, objectId] = metaParts as [string, string, string]
    entries.push({ mode, type, objectId, relPath })
  }
  return { ok: true, entries }
}

const validateEntries = (
  entries: RawTreeEntry[],
  destination: string
): { ok: true; entries: ValidatedTreeEntry[] } | { ok: false; detail: string } => {
  const validated: ValidatedTreeEntry[] = []
  for (const entry of entries) {
    if (entry.mode !== REQUIRED_TREE_ENTRY_MODE) {
      return {
        ok: false,
        detail: `ledger tree entry ${entry.relPath} has mode ${entry.mode}; only ${REQUIRED_TREE_ENTRY_MODE} is permitted`
      }
    }
    if (entry.type !== REQUIRED_TREE_ENTRY_TYPE) {
      return {
        ok: false,
        detail: `ledger tree entry ${entry.relPath} has type ${entry.type}; only ${REQUIRED_TREE_ENTRY_TYPE} is permitted`
      }
    }
    if (entry.relPath.length === 0 || entry.relPath.startsWith('/')) {
      return { ok: false, detail: `ledger tree entry has an unusable path: ${JSON.stringify(entry.relPath)}` }
    }
    const segments = entry.relPath.split('/')
    if (
      segments.some(
        (segment) =>
          segment.length === 0 ||
          FORBIDDEN_REDUCED_PATH_SEGMENTS.has(reducePathSegmentForForbiddenComparison(segment))
      )
    ) {
      return { ok: false, detail: `ledger tree entry ${entry.relPath} has a forbidden path segment` }
    }
    const resolved = path.resolve(destination, entry.relPath)
    if (!resolved.startsWith(destination + path.sep)) {
      return { ok: false, detail: `ledger tree entry ${entry.relPath} resolves outside the materialisation destination` }
    }
    validated.push({ objectId: entry.objectId, relPath: entry.relPath })
  }
  return { ok: true, entries: validated }
}

const readBatchContents = (
  buffer: Buffer,
  entries: ValidatedTreeEntry[]
): { ok: true; contents: Buffer[] } | { ok: false; detail: string } => {
  const contents: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const headerEnd = buffer.indexOf(NEWLINE_BYTE, offset)
    if (headerEnd === -1) {
      return {
        ok: false,
        detail: `git cat-file --batch output ended before a header for ${entry.relPath} (${entry.objectId})`
      }
    }
    const header = buffer.subarray(offset, headerEnd).toString('utf8')
    if (header.endsWith(' missing')) {
      return { ok: false, detail: `git could not read the object for ${entry.relPath} (${entry.objectId}): ${header}` }
    }
    const headerMatch = /^([0-9a-f]+) (\S+) (\d+)$/.exec(header)
    if (headerMatch === null) {
      return {
        ok: false,
        detail: `git cat-file --batch produced an unreadable header for ${entry.relPath}: ${JSON.stringify(header)}`
      }
    }
    const size = Number(headerMatch[3])
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (contentEnd >= buffer.length || buffer[contentEnd] !== NEWLINE_BYTE) {
      return {
        ok: false,
        detail: `git cat-file --batch output was truncated while reading ${entry.relPath} (${entry.objectId})`
      }
    }
    contents.push(buffer.subarray(contentStart, contentEnd))
    offset = contentEnd + 1
  }
  return { ok: true, contents }
}

const writeEntries = (destination: string, entries: ValidatedTreeEntry[], contents: Buffer[]): void => {
  entries.forEach((entry, index) => {
    const destPath = path.resolve(destination, entry.relPath)
    mkdirSync(path.dirname(destPath), { recursive: true })
    writeFileSync(destPath, contents[index] as Buffer)
  })
}

export const materialiseTreeInto = (
  rt: Runtime,
  repo: string,
  ref: string,
  destination: string,
  deps: MaterialiseTreeDeps
): MaterialiseTreeOutcome => {
  const destinationAbs = path.resolve(destination)

  try {
    mkdirSync(destinationAbs, { recursive: true })
  } catch (error) {
    return {
      ok: false,
      detail: `the materialisation destination ${destinationAbs} could not be created: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const listing = deps.runGit(rt, repo, ['ls-tree', '-r', '-z', '--full-tree', ref])
  if (!listing.ok) {
    return { ok: false, detail: `the ledger tree could not be listed (git ls-tree exit ${listing.code}): ${listing.stderr.trim()}` }
  }

  const parsed = parseTreeListing(listing.stdout)
  if (!parsed.ok) return parsed

  const validated = validateEntries(parsed.entries, destinationAbs)
  if (!validated.ok) return validated

  if (validated.entries.length === 0) return { ok: true }

  const batchInput = `${validated.entries.map((entry) => entry.objectId).join('\n')}\n`
  const batch = deps.runGitBuffer(rt, repo, ['cat-file', '--batch'], { stdin: batchInput })
  if (!batch.ok) {
    const detail = batch.overflow
      ? `git cat-file --batch exceeded the buffer ceiling of ${batch.maxBuffer} bytes while materialising ${ref}: ${batch.stderr}`
      : `the ledger tree's contents could not be read (git cat-file --batch exit ${batch.code}): ${batch.stderr.trim()}`
    return { ok: false, detail }
  }

  const contentsResult = readBatchContents(batch.stdout, validated.entries)
  if (!contentsResult.ok) return contentsResult

  try {
    writeEntries(destinationAbs, validated.entries, contentsResult.contents)
  } catch (error) {
    return {
      ok: false,
      detail: `a materialised file could not be written under ${destinationAbs}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return { ok: true }
}
