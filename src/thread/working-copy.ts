import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { stripHeaderLines } from '../doc/document.ts'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { durableWrite } from '../store/durable-write.ts'
import { git } from '../store/git.ts'
import { headerOf, threeWay, withHeader } from './merge.ts'
import { copyBasePath, workingCopyPath, type RepoPaths } from './paths.ts'

export type WorkingCopy = { file: string; text: string | null; base: string | null }

export type Carried =
  | { kind: 'copy'; text: string }
  | { kind: 'unedited'; text: string }
  | { kind: 'merged'; text: string; conflicted: boolean }

const BLOB_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const BASE_LINE_END = '\n'
const CARRY_LABELS = ['working copy', 'copy base', 'stored'] as const

const notAFile = (file: string): Refusal => ({
  ok: false,
  field: 'working_copy',
  accepted: 'a readable file at the working copy path, or nothing there',
  example: file,
  retryable: true,
  message: `the working copy ${file} is not a readable file, so nothing was committed; move whatever is at that path aside so logbook can write the document there again`
})

const unmerged = (file: string): Refusal => ({
  ok: false,
  field: 'working_copy',
  accepted: 'a working copy git can merge onto the stored version',
  example: file,
  retryable: true,
  message: `logbook could not merge the working copy ${file} onto the newer stored version, so nothing was committed`
})

const writeFile = (rt: Runtime, file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  durableWrite(file, text, { log: rt.log })
}

export const writeWorkingCopy = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  text: string,
  baseBlob: string | null
): Ok<string> | Refusal => {
  const file = workingCopyPath(paths, slug)
  if (!file.ok) return file
  const baseFile = copyBasePath(paths, slug)
  if (!baseFile.ok) return baseFile
  writeFile(rt, file.value, text)
  if (baseBlob === null) rmSync(baseFile.value, { force: true })
  else writeFile(rt, baseFile.value, `${baseBlob}${BASE_LINE_END}`)
  return file
}

const readBase = (file: string): string | null => {
  const read = (): string | null => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return null
    }
  }
  const content = read()
  if (content === null || !content.endsWith(BASE_LINE_END)) return null
  const blob = content.slice(0, -BASE_LINE_END.length)
  return BLOB_ID_PATTERN.test(blob) ? blob : null
}

const readCopy = (file: string): Ok<string | null> | Refusal => {
  try {
    if (!statSync(file).isFile()) return notAFile(file)
    return { ok: true, value: readFileSync(file, 'utf8') }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: true, value: null } : notAFile(file)
  }
}

export const readWorkingCopy = (paths: RepoPaths, slug: string): Ok<WorkingCopy> | Refusal => {
  const file = workingCopyPath(paths, slug)
  if (!file.ok) return file
  const baseFile = copyBasePath(paths, slug)
  if (!baseFile.ok) return baseFile
  const base = readBase(baseFile.value)
  const text = readCopy(file.value)
  if (!text.ok) return text
  return { ok: true, value: { file: file.value, text: text.value, base } }
}

export const readBaseText = (rt: Runtime, paths: RepoPaths, base: string): string | null => {
  if (!BLOB_ID_PATTERN.test(base)) return null
  const read = git(rt, paths.root, ['cat-file', 'blob', base])
  return read.ok ? read.stdout : null
}

export const comparisonText = (rt: Runtime, paths: RepoPaths, slug: string, stored: string): string => {
  const baseFile = copyBasePath(paths, slug)
  if (!baseFile.ok) return stored
  const base = readBase(baseFile.value)
  return (base === null ? null : readBaseText(rt, paths, base)) ?? stored
}

export const carryOnto = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  copy: string,
  base: string | null,
  stored: { text: string; blob: string }
): Ok<Carried> | Refusal => {
  if (base === null || base === stored.blob) return { ok: true, value: { kind: 'copy', text: copy } }
  const baseText = readBaseText(rt, paths, base)
  if (baseText === null) return { ok: true, value: { kind: 'copy', text: copy } }
  if (stripHeaderLines(copy) === stripHeaderLines(baseText)) {
    return { ok: true, value: { kind: 'unedited', text: stored.text } }
  }
  const header = headerOf(baseText)
  const merged = threeWay(
    rt,
    paths,
    CARRY_LABELS,
    { ours: copy, theirs: stored.text, base: withHeader(baseText, header) },
    header
  )
  if (merged.ok) return { ok: true, value: { kind: 'merged', ...merged.value } }
  rt.log({ level: 'warn', event: 'reconcile.working-copy-unmerged', slug, reason: merged.error })
  const file = workingCopyPath(paths, slug)
  return unmerged(file.ok ? file.value : slug)
}
