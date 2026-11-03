import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'

export type GitResult = { ok: true; stdout: string } | { ok: false; code: number; stderr: string }

export type Identity = { name: string; email: string }

export type GitOpts = { stdin?: string; indexFile?: string; identity?: Identity }

export type GitBufferOpts = GitOpts

export type GitBufferResult =
  | { ok: true; stdout: Buffer }
  | { ok: false; overflow: true; maxBuffer: number; stderr: string }
  | { ok: false; overflow: false; code: number; stderr: string }

export const GIT_BUFFER_MAX_BYTES = 256 * 1024 * 1024

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

const DEAD_PEER_CONFIG: readonly (readonly [string, string])[] = [
  ['http.lowSpeedLimit', '1'],
  ['http.lowSpeedTime', '60']
]

const callerConfigCount = (env: Readonly<Record<string, string | undefined>>): number => {
  const text = env.GIT_CONFIG_COUNT
  if (text === undefined || !/^[0-9]+$/.test(text)) return 0
  const count = Number(text)
  return Number.isSafeInteger(count) ? count : 0
}

const deadPeerConfigEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> => {
  const first = callerConfigCount(env)
  return Object.fromEntries([
    ...DEAD_PEER_CONFIG.flatMap(([key, value], offset) => [
      [`GIT_CONFIG_KEY_${first + offset}`, key],
      [`GIT_CONFIG_VALUE_${first + offset}`, value]
    ]),
    ['GIT_CONFIG_COUNT', String(first + DEAD_PEER_CONFIG.length)]
  ])
}

const buildGitEnv = (rt: Runtime, indexFile: string, opts: GitOpts): Record<string, string | undefined> => ({
  ...sanitisedRuntimeEnv(rt.env),
  ...identityEnv(opts.identity),
  ...deadPeerConfigEnv(rt.env),
  GIT_INDEX_FILE: indexFile,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GCM_INTERACTIVE: 'never',
  GIT_PAGER: 'cat',
  GIT_NO_LAZY_FETCH: '1',
  HOME: rt.env.HOME
})

const stdioFor = (opts: GitOpts): ['pipe' | 'ignore', 'pipe', 'pipe'] => [
  opts.stdin !== undefined ? 'pipe' : 'ignore',
  'pipe',
  'pipe'
]

const isBufferOverflow = (error: NodeJS.ErrnoException): boolean => error.code === 'ENOBUFS'

const exitedBeforeReadingStdin = (result: { error?: Error; status: number | null }): boolean =>
  (result.error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE' && result.status !== null

const bufferOverflowMessage = (args: string[]): string =>
  `git ${args.join(' ')} produced more than GIT_BUFFER_MAX_BYTES (${GIT_BUFFER_MAX_BYTES}) bytes of output; refusing rather than risk mistaking a truncated read for a short ledger`

export type GitRun = { code: number; stdout: string; stderr: string }

export const gitRun = (rt: Runtime, repo: string, args: string[], opts: GitOpts = {}): GitRun => {
  const indexFile = opts.indexFile ?? freshIndexPath()
  const env = buildGitEnv(rt, indexFile, opts)
  try {
    const result = spawnSync('git', ['-C', repo, ...args], {
      env,
      encoding: 'utf8',
      stdio: stdioFor(opts),
      maxBuffer: GIT_BUFFER_MAX_BYTES,
      ...(opts.stdin !== undefined ? { input: opts.stdin } : {})
    })
    if (result.error && !exitedBeforeReadingStdin(result)) {
      if (isBufferOverflow(result.error as NodeJS.ErrnoException)) {
        return { code: -1, stdout: '', stderr: bufferOverflowMessage(args) }
      }
      return { code: -1, stdout: '', stderr: result.error.message }
    }
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  } finally {
    removeSelfAllocatedIndex(indexFile, opts)
  }
}

export type GitDetachedOpts = GitOpts

const DEAD_PEER_SSH_COMMAND = 'ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4'

const keepGitsExitStatus = (): void => {}

type DetachedOutput = { folder: string; stdoutPath: string; stderrPath: string }

type DetachedStart = { ok: true; output: DetachedOutput; child: ChildProcess } | { ok: false; run: GitRun }

const DETACHED_OUTPUT_PREFIX = 'logbook-git-detached-'

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const failedRun = (error: unknown): GitRun => ({ code: -1, stdout: '', stderr: errorMessage(error) })

const isSet = (value: string | undefined): boolean => value !== undefined && value !== ''

const sshCommandConfigured = (rt: Runtime, repo: string): boolean => {
  if (isSet(rt.env.GIT_SSH_COMMAND) || isSet(rt.env.GIT_SSH)) return true
  const configured = gitRun(rt, repo, ['config', '--get', 'core.sshCommand'])
  return configured.code === 0 && configured.stdout.trim() !== ''
}

const deadPeerSshEnv = (rt: Runtime, repo: string): Record<string, string> =>
  sshCommandConfigured(rt, repo) ? {} : { GIT_SSH_COMMAND: DEAD_PEER_SSH_COMMAND }

const createDetachedOutput = (): DetachedOutput => {
  const folder = mkdtempSync(join(tmpdir(), DETACHED_OUTPUT_PREFIX))
  return { folder, stdoutPath: join(folder, 'stdout'), stderrPath: join(folder, 'stderr') }
}

const removeDetachedOutput = (rt: Runtime, output: DetachedOutput): void => {
  try {
    rmSync(output.folder, { recursive: true, force: true })
  } catch (error) {
    rt.log({ level: 'warn', event: 'git.detached-output-unremoved', reason: errorMessage(error) })
  }
}

const withOutputFile = <T>(file: string, use: (fd: number) => T): T => {
  const fd = openSync(file, 'w', 0o600)
  try {
    return use(fd)
  } finally {
    closeSync(fd)
  }
}

const spawnDetachedGit = (
  rt: Runtime,
  repo: string,
  args: string[],
  opts: GitDetachedOpts,
  output: DetachedOutput
): ChildProcess => {
  const env = {
    ...buildGitEnv(rt, opts.indexFile ?? join(output.folder, 'index'), opts),
    ...deadPeerSshEnv(rt, repo),
    LC_ALL: 'C'
  }
  return withOutputFile(output.stdoutPath, (stdoutFd) =>
    withOutputFile(output.stderrPath, (stderrFd) =>
      spawn('git', ['-C', repo, ...args], {
        env,
        detached: true,
        stdio: [opts.stdin !== undefined ? 'pipe' : 'ignore', stdoutFd, stderrFd]
      })
    )
  )
}

const startDetachedRun = (rt: Runtime, repo: string, args: string[], opts: GitDetachedOpts): DetachedStart => {
  try {
    const output = createDetachedOutput()
    try {
      return { ok: true, output, child: spawnDetachedGit(rt, repo, args, opts, output) }
    } catch (error) {
      removeDetachedOutput(rt, output)
      return { ok: false, run: failedRun(error) }
    }
  } catch (error) {
    return { ok: false, run: failedRun(error) }
  }
}

const exitedRun = (output: DetachedOutput, code: number | null): GitRun => {
  try {
    return {
      code: code ?? -1,
      stdout: readFileSync(output.stdoutPath, 'utf8'),
      stderr: readFileSync(output.stderrPath, 'utf8')
    }
  } catch (error) {
    return failedRun(error)
  }
}

export const gitDetached = (rt: Runtime, repo: string, args: string[], opts: GitDetachedOpts = {}): Promise<GitRun> => {
  const started = startDetachedRun(rt, repo, args, opts)
  if (!started.ok) return Promise.resolve(started.run)
  const { output, child } = started
  return new Promise<GitRun>((resolve) => {
    let settled = false
    const settle = (result: () => GitRun): void => {
      if (settled) return
      settled = true
      const run = result()
      removeDetachedOutput(rt, output)
      resolve(run)
    }
    child.on('error', (error) => settle(() => failedRun(error)))
    child.on('exit', (code) => settle(() => exitedRun(output, code)))
    if (opts.stdin !== undefined) {
      child.stdin?.on('error', keepGitsExitStatus)
      child.stdin?.end(opts.stdin)
    }
  })
}

const PUSH_HELPER_PATH = join(import.meta.dirname, '..', '..', 'bin', 'logbook-push.ts')

export const startBackgroundPush = (rt: Runtime, repo: string): ChildProcess => {
  const child = spawn(process.execPath, [PUSH_HELPER_PATH, repo], {
    detached: true,
    stdio: 'ignore',
    env: sanitisedRuntimeEnv(rt.env)
  })
  child.on('error', (error) => rt.log({ level: 'warn', event: 'git.background-push-unstarted', reason: error.message }))
  return child
}

export const git = (rt: Runtime, repo: string, args: string[], opts: GitOpts = {}): GitResult => {
  const run = gitRun(rt, repo, args, opts)
  return run.code === 0 ? { ok: true, stdout: run.stdout } : { ok: false, code: run.code, stderr: run.stderr }
}

export const gitBuffer = (rt: Runtime, repo: string, args: string[], opts: GitBufferOpts = {}): GitBufferResult => {
  const indexFile = opts.indexFile ?? freshIndexPath()
  const env = buildGitEnv(rt, indexFile, opts)
  try {
    const result = spawnSync('git', ['-C', repo, ...args], {
      env,
      stdio: stdioFor(opts),
      maxBuffer: GIT_BUFFER_MAX_BYTES,
      ...(opts.stdin !== undefined ? { input: opts.stdin } : {})
    })
    if (result.error && !exitedBeforeReadingStdin(result)) {
      if (isBufferOverflow(result.error as NodeJS.ErrnoException)) {
        return {
          ok: false,
          overflow: true,
          maxBuffer: GIT_BUFFER_MAX_BYTES,
          stderr: bufferOverflowMessage(args)
        }
      }
      return { ok: false, overflow: false, code: -1, stderr: result.error.message }
    }
    const code = result.status ?? -1
    if (code === 0) {
      return { ok: true, stdout: result.stdout as Buffer }
    }
    return { ok: false, overflow: false, code, stderr: (result.stderr as Buffer).toString('utf8') }
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

export const readProjectHead = (rt: Runtime, repo: string | null): string | null => {
  if (repo === null) return null
  const result = git(rt, repo, ['rev-parse', 'HEAD'])
  return result.ok ? result.stdout.trim() : null
}
