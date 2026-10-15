import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { git } from '../store/git.ts'

export type RepoPaths = { root: string; commonDir: string; logbookDir: string; workingDir: string }

export const THREAD_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const PROJECT_DIR_ENV_KEY = 'CLAUDE_PROJECT_DIR'
const REPO_NAME_LENGTH = 40
const REPO_HASH_LENGTH = 12
const REPO_NAME_UNSAFE = /[^a-z0-9-]/gu

const SLUG_ACCEPTED = `a slug matching ${THREAD_SLUG_PATTERN.source}: lowercase letters, digits and hyphens, starting with a letter or digit, at most 64 characters`
const ID_ACCEPTED = `an id matching ${SESSION_ID_PATTERN.source}: letters, digits, underscores and hyphens, at most 128 characters`

export const startDirectory = (rt: Runtime, fallback: string): string => {
  const projectDir = rt.env[PROJECT_DIR_ENV_KEY]
  return projectDir !== undefined && projectDir !== '' ? projectDir : fallback
}

export const repoKey = (commonDir: string): string => {
  const name = path
    .basename(path.dirname(commonDir))
    .toLowerCase()
    .replace(REPO_NAME_UNSAFE, '-')
    .slice(0, REPO_NAME_LENGTH)
  const hash = createHash('sha256').update(commonDir, 'utf8').digest('hex').slice(0, REPO_HASH_LENGTH)
  return `${name}-${hash}`
}

const outsideRepository = (dir: string): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a directory inside a git repository with a working tree',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: `logbook needs a git repository with a working tree; ${dir} is not inside one`
})

const missingHome = (): Refusal => ({
  ok: false,
  field: 'HOME',
  accepted: 'the absolute path of the home folder',
  example: '/home/me',
  retryable: false,
  message: 'logbook needs HOME to place the working copies'
})

const parseRevParse = (stdout: string): { root: string; commonDir: string } | null => {
  const lines = (stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout).split('\n')
  const [root, commonDir] = lines
  if (lines.length !== 2 || root === undefined || commonDir === undefined) return null
  if (!path.isAbsolute(root) || !path.isAbsolute(commonDir)) return null
  return { root, commonDir }
}

export const findRepository = (rt: Runtime, dir: string): Ok<RepoPaths> | Refusal => {
  const home = rt.env.HOME
  if (home === undefined || home === '') return missingHome()
  const result = git(rt, dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  if (!result.ok) return outsideRepository(dir)
  const found = parseRevParse(result.stdout)
  if (found === null) return outsideRepository(dir)
  return {
    ok: true,
    value: {
      root: found.root,
      commonDir: found.commonDir,
      logbookDir: path.join(found.commonDir, 'logbook'),
      workingDir: path.join(home, '.logbook', repoKey(found.commonDir))
    }
  }
}

const checkName = (pattern: RegExp, accepted: string, example: string, field: string, value: string): Refusal | null =>
  pattern.test(value)
    ? null
    : {
        ok: false,
        field,
        accepted,
        example,
        retryable: true,
        message: `${field} must match ${pattern.source} before logbook builds a file name from it`
      }

export const checkSlug = (field: string, value: string): Refusal | null =>
  checkName(THREAD_SLUG_PATTERN, SLUG_ACCEPTED, 'fix-login', field, value)

export const checkSessionId = (field: string, value: string): Refusal | null =>
  checkName(SESSION_ID_PATTERN, ID_ACCEPTED, '3f2b7c1e-9a4d-4e8b-b6f0-2d5c8a1e7f93', field, value)

const checkToolUseId = (value: string): Refusal | null =>
  checkName(SESSION_ID_PATTERN, ID_ACCEPTED, 'toolu_01AbCdEfGhIjKlMnOpQrStUv', 'tool_use_id', value)

const built = (refusal: Refusal | null, build: () => string): Ok<string> | Refusal =>
  refusal ?? { ok: true, value: build() }

export const workingCopyPath = (paths: RepoPaths, slug: string): Ok<string> | Refusal =>
  built(checkSlug('slug', slug), () => path.join(paths.workingDir, `${slug}.md`))

export const holdPath = (paths: RepoPaths, slug: string): Ok<string> | Refusal =>
  built(checkSlug('slug', slug), () => path.join(paths.logbookDir, 'holds', `${slug}.json`))

export const inflightDir = (paths: RepoPaths, slug: string): Ok<string> | Refusal =>
  built(checkSlug('slug', slug), () => path.join(paths.logbookDir, 'inflight', slug))

export const markerPath = (paths: RepoPaths, slug: string, toolUseId: string): Ok<string> | Refusal =>
  built(checkSlug('slug', slug) ?? checkToolUseId(toolUseId), () =>
    path.join(paths.logbookDir, 'inflight', slug, `${toolUseId}.json`)
  )

export const convertedPath = (paths: RepoPaths, slug: string): Ok<string> | Refusal =>
  built(checkSlug('slug', slug), () => path.join(paths.logbookDir, 'converted', slug))

export const handoverPath = (paths: RepoPaths, sessionId: string): Ok<string> | Refusal =>
  built(checkSessionId('session_id', sessionId), () => path.join(paths.logbookDir, 'handover', `${sessionId}.json`))

export const redirectPath = (paths: RepoPaths, sessionId: string): Ok<string> | Refusal =>
  built(checkSessionId('session_id', sessionId), () => path.join(paths.logbookDir, 'sessions', `${sessionId}.json`))
