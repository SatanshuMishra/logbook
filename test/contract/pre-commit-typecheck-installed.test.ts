import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { rawGit, withRepo, type RawGitResult } from '../support/git-fixture.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REAL_TSC_BIN_DIR = path.join(PROJECT_ROOT, 'node_modules', '.bin')

const HOOK_TRIGGERING_ENV: Record<string, string | undefined> = {
  PATH: `${REAL_TSC_BIN_DIR}${path.delimiter}${process.env.PATH ?? ''}`,
  HOME: process.env.HOME,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const CHECK_FILE_RELATIVE = 'check.ts'
const TYPE_CLEAN_SOURCE = 'export const total: number = 1 + 1\n'
const TYPE_ERROR_SOURCE = "export const total: number = 'not-a-number'\n"

type CopySpec = { from: string; to: string; mode: number }

const SCRIPTS_TO_COPY: CopySpec[] = [
  { from: path.join(PROJECT_ROOT, 'scripts', 'pre-commit-typecheck.sh'), to: path.join('scripts', 'pre-commit-typecheck.sh'), mode: 0o755 },
  { from: path.join(PROJECT_ROOT, 'scripts', 'githooks', 'pre-commit'), to: path.join('scripts', 'githooks', 'pre-commit'), mode: 0o755 },
  { from: path.join(PROJECT_ROOT, 'scripts', 'install-githooks.mjs'), to: path.join('scripts', 'install-githooks.mjs'), mode: 0o644 }
]

type CopyOutcome = { to: string; copied: boolean; error: string | null }

const copyIfPresent = (repo: string, spec: CopySpec): CopyOutcome => {
  const destination = path.join(repo, spec.to)
  try {
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(spec.from, destination)
    chmodSync(destination, spec.mode)
    return { to: spec.to, copied: true, error: null }
  } catch (error) {
    return { to: spec.to, copied: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const seedFixture = (repo: string): CopyOutcome[] => {
  writeFileSync(
    path.join(repo, 'package.json'),
    `${JSON.stringify(
      {
        name: 'logbook-pre-commit-fixture',
        private: true,
        scripts: { typecheck: 'tsc -p tsconfig.json --noEmit' }
      },
      null,
      2
    )}\n`
  )

  writeFileSync(
    path.join(repo, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          module: 'commonjs',
          strict: true,
          noEmit: true
        },
        include: ['check.ts']
      },
      null,
      2
    )}\n`
  )

  return SCRIPTS_TO_COPY.map((spec) => copyIfPresent(repo, spec))
}

const runInstaller = (repo: string): RawGitResult => {
  const result = spawnSync(process.execPath, ['scripts/install-githooks.mjs'], {
    cwd: repo,
    env: HOOK_TRIGGERING_ENV,
    encoding: 'utf8'
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const commitThroughHook = (repo: string, message: string): RawGitResult => {
  const result = spawnSync('git', ['-C', repo, 'commit', '-m', message], {
    cwd: repo,
    env: HOOK_TRIGGERING_ENV,
    encoding: 'utf8'
  })
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const revListCount = (repo: string): number => {
  const result = rawGit(repo, ['rev-list', '--count', 'HEAD'])
  assert.equal(result.status, 0, `git rev-list --count HEAD failed: ${result.stderr}`)
  const parsed = Number.parseInt(result.stdout.trim(), 10)
  assert.ok(Number.isInteger(parsed), `git rev-list --count HEAD returned unparseable output: ${JSON.stringify(result.stdout)}`)
  return parsed
}

const stageCheckFile = (repo: string, source: string): void => {
  writeFileSync(path.join(repo, CHECK_FILE_RELATIVE), source)
  const added = rawGit(repo, ['add', CHECK_FILE_RELATIVE])
  assert.equal(added.status, 0, `git add of ${CHECK_FILE_RELATIVE} failed: ${added.stderr}`)
}

const describeSetup = (copyOutcomes: CopyOutcome[], installResult: RawGitResult): string =>
  `install-scripts copied: ${JSON.stringify(copyOutcomes)}; installer exit: ${installResult.status}; installer stderr: ${installResult.stderr}`

test('contract.pre-commit-typecheck-installed', () => {
  withRepo((repo) => {
    const copyOutcomes = seedFixture(repo)
    const installResult = runInstaller(repo)
    const setupDescription = describeSetup(copyOutcomes, installResult)

    stageCheckFile(repo, TYPE_CLEAN_SOURCE)
    const countBeforeClean = revListCount(repo)
    const cleanCommit = commitThroughHook(repo, 'fixture: type-clean commit through the installed hook')
    const countAfterClean = revListCount(repo)

    assert.equal(
      cleanCommit.status,
      0,
      `a type-clean staged file must commit successfully through the installed pre-commit hook (${setupDescription}); commit stderr: ${cleanCommit.stderr}`
    )
    assert.equal(
      countAfterClean,
      countBeforeClean + 1,
      'a successful commit of the type-clean file must create exactly one new commit object'
    )

    stageCheckFile(repo, TYPE_ERROR_SOURCE)
    const countBeforeBroken = revListCount(repo)
    const brokenCommit = commitThroughHook(repo, 'fixture: type-error commit must be blocked by the hook')
    const countAfterBroken = revListCount(repo)

    assert.notEqual(
      brokenCommit.status,
      0,
      `a commit carrying a tsc type error must be blocked by the installed pre-commit hook and exit non-zero (${setupDescription}); commit stdout: ${brokenCommit.stdout} stderr: ${brokenCommit.stderr}`
    )
    assert.equal(
      countAfterBroken,
      countBeforeBroken,
      'a commit blocked by the pre-commit hook must not create a new commit object'
    )
  })
})
