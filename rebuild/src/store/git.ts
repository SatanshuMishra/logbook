import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'

export type GitResult = { ok: true; stdout: string } | { ok: false; code: number; stderr: string }

export type Identity = { name: string; email: string }

export type GitOpts = { stdin?: string; indexFile?: string; identity?: Identity }

const FORBIDDEN_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_DATE'
] as const

const freshIndexPath = (): string => join(tmpdir(), `logbook-git-index-${randomUUID()}`)

const identityEnv = (identity: Identity | undefined): Record<string, string> =>
  identity
    ? {
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email
      }
    : {}

const sanitisedRuntimeEnv = (
  env: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> => {
  const forbidden: readonly string[] = FORBIDDEN_ENV_KEYS
  return Object.fromEntries(Object.entries(env).filter(([key]) => !forbidden.includes(key)))
}

const removeSelfAllocatedIndex = (indexFile: string, opts: GitOpts): void => {
  if (opts.indexFile !== undefined) return
  try {
    unlinkSync(indexFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export const git = (rt: Runtime, repo: string, args: string[], opts: GitOpts = {}): GitResult => {
  const indexFile = opts.indexFile ?? freshIndexPath()
  const env: Record<string, string | undefined> = {
    ...sanitisedRuntimeEnv(rt.env),
    ...identityEnv(opts.identity),
    GIT_INDEX_FILE: indexFile,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: rt.env.HOME
  }
  try {
    const result = spawnSync('git', ['-C', repo, ...args], {
      env,
      encoding: 'utf8',
      ...(opts.stdin !== undefined ? { input: opts.stdin } : {})
    })
    if (result.error) {
      return { ok: false, code: -1, stderr: result.error.message }
    }
    const code = result.status ?? -1
    if (code === 0) {
      return { ok: true, stdout: result.stdout }
    }
    return { ok: false, code, stderr: result.stderr }
  } finally {
    removeSelfAllocatedIndex(indexFile, opts)
  }
}

const IDENTITY_SETUP_COMMAND = 'git config user.name "<name>" && git config user.email "<email>"'

export const readIdentity = (rt: Runtime, repo: string): Ok<Identity> | Refusal => {
  const name = git(rt, repo, ['config', '--get', 'user.name'])
  const email = git(rt, repo, ['config', '--get', 'user.email'])
  const trimmedName = name.ok ? name.stdout.trim() : ''
  const trimmedEmail = email.ok ? email.stdout.trim() : ''
  if (trimmedName === '' || trimmedEmail === '') {
    return {
      ok: false,
      field: 'user.name, user.email',
      accepted: 'a repository with both user.name and user.email configured',
      example: IDENTITY_SETUP_COMMAND,
      retryable: true,
      message: `no git identity is configured for this repository; set both by running \`${IDENTITY_SETUP_COMMAND}\``
    }
  }
  return { ok: true, value: { name: trimmedName, email: trimmedEmail } }
}

export const readProjectHead = (rt: Runtime, repo: string): string | null => {
  const result = git(rt, repo, ['rev-parse', 'HEAD'])
  return result.ok ? result.stdout.trim() : null
}
