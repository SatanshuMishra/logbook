import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type SourceRecord = {
  repository: string
  ref: string
  commit: string
  files: Record<string, { from: string; sha256: string }>
}

export const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export const readSourceRecord = (): SourceRecord =>
  JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, 'metrics', 'source.json'), 'utf8')) as SourceRecord

export const recordedCopies = (): ReadonlySet<string> => new Set(Object.keys(readSourceRecord().files))
