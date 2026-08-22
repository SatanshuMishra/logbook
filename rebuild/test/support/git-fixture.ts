import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type RawGitResult = { status: number; stdout: string; stderr: string }

const FIXTURE_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

export const rawGit = (repo: string, args: string[]): RawGitResult => {
  const result = spawnSync('git', ['-C', repo, ...args], {
    env: FIXTURE_ENV,
    encoding: 'utf8'
  })
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

export const withRepo = <T>(fn: (repo: string) => T): T => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-git-fixture-'))
  try {
    runSetupStep(repo, ['init', '--initial-branch=main'])
    runSetupStep(repo, ['config', 'user.name', 'Logbook Fixture'])
    runSetupStep(repo, ['config', 'user.email', 'fixture@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
    runSetupStep(repo, ['add', 'README.md'])
    runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
    return fn(repo)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

export const withRepoNoIdentity = <T>(fn: (repo: string) => T): T => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-git-fixture-no-identity-'))
  try {
    runSetupStep(repo, ['init', '--initial-branch=main'])
    return fn(repo)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}
