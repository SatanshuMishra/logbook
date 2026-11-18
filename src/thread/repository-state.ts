import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { git } from '../store/git.ts'

const HEAD_ARGS = ['rev-parse', '--verify', '--quiet', 'HEAD']
const GIT_DIR_ARGS = ['rev-parse', '--absolute-git-dir']
const INDEX_FILE_NAME = 'index'
const STATUS_ARGS = ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']
const ENTRY_SEPARATOR = '\0'
const STATUS_PREFIX_LENGTH = 3
const ABSENT = 'absent'

const pathOfEntry = (entry: string): string =>
  entry.length > STATUS_PREFIX_LENGTH && entry[2] === ' ' ? entry.slice(STATUS_PREFIX_LENGTH) : entry

const fileStamp = (root: string, entry: string): string => {
  try {
    const stats = statSync(path.join(root, pathOfEntry(entry)))
    return `${entry}\t${stats.size}\t${stats.mtimeMs}`
  } catch {
    return `${entry}\t${ABSENT}`
  }
}

const repositoryIndex = (rt: Runtime, root: string): string | null => {
  const gitDir = git(rt, root, GIT_DIR_ARGS)
  return gitDir.ok ? path.join(gitDir.stdout.trim(), INDEX_FILE_NAME) : null
}

export const repositoryState = (rt: Runtime, root: string): string | null => {
  const indexFile = repositoryIndex(rt, root)
  if (indexFile === null) return null
  const status = git(rt, root, STATUS_ARGS, { indexFile })
  if (!status.ok) return null
  const head = git(rt, root, HEAD_ARGS)
  const entries = status.stdout.split(ENTRY_SEPARATOR).filter((entry) => entry.length > 0)
  const stamps = [head.ok ? head.stdout.trim() : '', ...entries.map((entry) => fileStamp(root, entry))]
  return createHash('sha256').update(stamps.join('\n'), 'utf8').digest('hex')
}
