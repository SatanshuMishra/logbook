import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { formatNextIds, highestIds, parseDocument, stripHeaderLines, type NextIds } from '../doc/document.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { durableWrite } from '../store/durable-write.ts'
import { gitRun, type GitRun } from '../store/git.ts'
import type { RepoPaths } from './paths.ts'

export type Step<T> = { ok: true; value: T } | { ok: false; error: string }

export type Header = { updated: string | null; nextIds: NextIds | null }

export type Merged = { text: string; conflicted: boolean }

const UPDATED_PREFIX = 'Updated: '
const HIGHEST_CONFLICT_EXIT = 127

export const failureOf = (step: string, run: GitRun): string => {
  const detail = run.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
  return `${step} failed: ${detail === '' ? `git exited with code ${run.code}` : detail}`
}

export const headerOf = (text: string): Header => {
  const parsed = parseDocument(text)
  return { updated: parsed.updated, nextIds: parsed.nextIds }
}

const headerLines = (header: Header): string[] => [
  ...(header.updated === null ? [] : [`${UPDATED_PREFIX}${header.updated}`]),
  ...(header.nextIds === null ? [] : [formatNextIds(header.nextIds)])
]

const headerEnd = (lines: readonly string[]): number => {
  const parsed = parseDocument(lines.join('\n'))
  const firstHeading = parsed.sections[0]?.line ?? parsed.noteLine ?? lines.length + 1
  return lines
    .slice(0, firstHeading - 1)
    .reduce((end, line, index) => (line.trim() === '' ? end : index + 1), 0)
}

export const withHeader = (text: string, header: Header): string => {
  const lines = stripHeaderLines(text).split('\n')
  const at = headerEnd(lines)
  return [...lines.slice(0, at), ...headerLines(header), ...lines.slice(at)].join('\n')
}

export const idsOf = (text: string): NextIds => parseDocument(text).nextIds ?? highestIds(text)

export const larger = (left: NextIds, right: NextIds): NextIds => ({
  c: Math.max(left.c, right.c),
  D: Math.max(left.D, right.D),
  R: Math.max(left.R, right.R),
  S: Math.max(left.S, right.S)
})

export const mergeFile = (
  rt: Runtime,
  paths: RepoPaths,
  labels: readonly string[],
  versions: readonly [string, string, string]
): Step<Merged> => {
  mkdirSync(paths.logbookDir, { recursive: true })
  const dir = mkdtempSync(path.join(paths.logbookDir, 'sync-'))
  try {
    const files = versions.map((text, index) => {
      const file = path.join(dir, `version-${index}`)
      durableWrite(file, text, { log: rt.log })
      return file
    })
    const run = gitRun(rt, paths.root, ['merge-file', '-p', ...labels.flatMap((label) => ['-L', label]), ...files])
    if (run.code === 0) return { ok: true, value: { text: run.stdout, conflicted: false } }
    if (run.code > 0 && run.code <= HIGHEST_CONFLICT_EXIT) return { ok: true, value: { text: run.stdout, conflicted: true } }
    return { ok: false, error: failureOf('merge-file', run) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const threeWay = (
  rt: Runtime,
  paths: RepoPaths,
  labels: readonly string[],
  sides: { ours: string; theirs: string; base: string },
  header: Header
): Step<Merged> => {
  const merged = mergeFile(rt, paths, labels, [
    withHeader(sides.ours, header),
    sides.base,
    withHeader(sides.theirs, header)
  ])
  if (!merged.ok) return merged
  const settled = withHeader(merged.value.text, {
    updated: rt.now(),
    nextIds: larger(idsOf(sides.ours), idsOf(sides.theirs))
  })
  return { ok: true, value: { text: settled, conflicted: merged.value.conflicted } }
}
