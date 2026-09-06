#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'

const POINTER_HOOK_NAME = 'pre-commit'
const TRACKED_HOOK_RELATIVE_PATH = 'scripts/githooks/pre-commit'
const POINTER_HOOK_MODE = 0o700
const HOOKS_DIR_NAME = 'hooks'
const HOOKS_PATH_KEY = 'core.hooksPath'
const PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPath'
const UNSET_HOOKS_PATH_COMMAND = `  git config --unset ${HOOKS_PATH_KEY}`
const NO_HOOK_LINE = 'No hook was installed by this run.'
const RERUN_LINE = 'then re-run: node scripts/install-githooks.mjs'

const escapeForOperator = (value) => JSON.stringify(value)

const shellQuote = (value) => `'${value.split("'").join("'\\''")}'`

const runGit = (args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error) {
    throw new Error(`failed to run "git ${args.join(' ')}": ${escapeForOperator(result.error.message)}`)
  }
  return result
}

const runGitOrThrow = (args) => {
  const result = runGit(args)
  if (result.status !== 0) {
    throw new Error(`"git ${args.join(' ')}" exited with status ${result.status}: ${escapeForOperator(result.stderr.trim())}`)
  }
  return result.stdout.trim()
}

const stripTrailingNewline = (value) => value.replace(/\n$/, '')

const readGitConfig = (key) => {
  const result = runGit(['config', '--get', key])
  if (result.status === 0) {
    if (typeof result.stdout !== 'string') {
      throw new Error(`"git config --get ${key}" produced no readable stdout`)
    }
    return stripTrailingNewline(result.stdout)
  }
  if (result.status === 1) {
    return null
  }
  throw new Error(`"git config --get ${key}" exited with status ${result.status}: ${escapeForOperator(result.stderr.trim())}`)
}

const resolveRealPathOrLiteral = (candidatePath) => {
  try {
    return realpathSync(candidatePath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return candidatePath
    }
    throw new Error(`failed to resolve real path of ${escapeForOperator(candidatePath)}: ${escapeForOperator(error.message)}`)
  }
}

const isInsideGitWorkTree = () => {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
  if (result.error) {
    return false
  }
  return result.status === 0 && result.stdout.trim() === 'true'
}

const buildPointerHookSource = () =>
  [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'repo_root=$(git rev-parse --show-toplevel)',
    'if ! cd "$repo_root"; then',
    '  echo "install-githooks pointer: failed to cd to repository root \\"$repo_root\\"" >&2',
    '  exit 1',
    'fi',
    '',
    `target="${TRACKED_HOOK_RELATIVE_PATH}"`,
    'if [ ! -x "$target" ]; then',
    '  echo "install-githooks pointer: commit blocked - missing or non-executable hook target \\"$repo_root/$target\\"" >&2',
    '  exit 1',
    'fi',
    '',
    'exec "$target" "$@"',
    ''
  ].join('\n')

const describeStatKind = (stat) => {
  if (stat.isFile()) return 'a regular file'
  if (stat.isDirectory()) return 'a directory'
  if (stat.isSymbolicLink()) return 'a symbolic link'
  if (stat.isBlockDevice()) return 'a block device'
  if (stat.isCharacterDevice()) return 'a character device'
  if (stat.isFIFO()) return 'a FIFO'
  if (stat.isSocket()) return 'a socket'
  return 'of an unrecognised kind'
}

const statOrNull = (targetPath, subject) => {
  try {
    return statSync(targetPath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw new Error(`failed to inspect ${subject} at ${escapeForOperator(targetPath)}: ${escapeForOperator(error.message)}`)
  }
}

const executePermissionFailure = (targetPath) => {
  try {
    accessSync(targetPath, constants.X_OK)
    return null
  } catch (error) {
    return typeof error?.code === 'string' ? error.code : 'an unnamed error'
  }
}

const renderConfigValue = (value) => (value === null ? 'unset' : escapeForOperator(value))

const configuredPathOrNull = (value, key) => {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error(`"git config --get ${key}" produced ${escapeForOperator(String(value))}, which is not a string`)
  }
  return value === '' ? null : value
}

const resolveConfiguredPath = (value, workTreeTop) =>
  resolveRealPathOrLiteral(path.isAbsolute(value) ? value : path.resolve(workTreeTop, value))

const renderRefusal = (headline, facts, remedy) =>
  [`install-githooks: ${headline}`, ...facts, NO_HOOK_LINE, ...remedy, RERUN_LINE].join('\n')

const refuse = (kind, message) => ({ kind, exitCode: 1, writeHook: false, message })

const approve = (kind) => ({ kind, exitCode: 0, writeHook: true, message: null })

const hooksPathRemedy = () => [
  "Clear the setting so git dispatches hooks through this repository's own hooks directory:",
  UNSET_HOOKS_PATH_COMMAND
]

const priorHooksPathRemedy = (repoHooksDir, hooksPathReal) => [
  "Drop the dispatcher so git dispatches hooks through this repository's own hooks directory. This installer can verify that itself:",
  UNSET_HOOKS_PATH_COMMAND,
  `Otherwise, only if you have checked that the dispatcher at ${escapeForOperator(hooksPathReal)} really does re-run this repository's own hooks, record that claim. This installer cannot check it for you:`,
  `  git config ${PRIOR_HOOKS_PATH_KEY} ${shellQuote(repoHooksDir)}`
]

const classifyDispatcher = (hooksPathReal, configLine, repoHooksDir) => {
  const dispatcherStat = statOrNull(hooksPathReal, `the directory named by ${HOOKS_PATH_KEY}`)
  const ownHooksLine = `this repository's own hooks directory: ${escapeForOperator(repoHooksDir)}`

  if (dispatcherStat === null) {
    return refuse(
      'hooks-path-missing',
      renderRefusal(
        `git dispatches every hook through ${HOOKS_PATH_KEY}, and that directory does not exist, so no commit is gated at all.`,
        [configLine, `it resolves to: ${escapeForOperator(hooksPathReal)}`, ownHooksLine],
        hooksPathRemedy()
      )
    )
  }

  if (!dispatcherStat.isDirectory()) {
    return refuse(
      'hooks-path-not-a-directory',
      renderRefusal(
        `git dispatches every hook through ${HOOKS_PATH_KEY}, and that path is not a directory, so no commit is gated at all.`,
        [
          configLine,
          `it resolves to: ${escapeForOperator(hooksPathReal)}, which is ${describeStatKind(dispatcherStat)}`,
          ownHooksLine
        ],
        hooksPathRemedy()
      )
    )
  }

  const dispatcherHookPath = path.join(hooksPathReal, POINTER_HOOK_NAME)
  const dispatcherHookStat = statOrNull(dispatcherHookPath, `the ${POINTER_HOOK_NAME} named by ${HOOKS_PATH_KEY}`)
  const hookLocationLine = `that ${POINTER_HOOK_NAME} would be at: ${escapeForOperator(dispatcherHookPath)}`

  if (dispatcherHookStat === null) {
    return refuse(
      'dispatcher-hook-missing',
      renderRefusal(
        `the directory git dispatches hooks through contains no ${POINTER_HOOK_NAME}, so no commit is gated at all.`,
        [configLine, hookLocationLine, ownHooksLine],
        hooksPathRemedy()
      )
    )
  }

  if (!dispatcherHookStat.isFile()) {
    return refuse(
      'dispatcher-hook-not-a-regular-file',
      renderRefusal(
        `the ${POINTER_HOOK_NAME} git dispatches through is not a regular file, so git can never execute it.`,
        [configLine, `${hookLocationLine}, which is ${describeStatKind(dispatcherHookStat)}`, ownHooksLine],
        hooksPathRemedy()
      )
    )
  }

  const executeFailure = executePermissionFailure(dispatcherHookPath)
  if (executeFailure !== null) {
    return refuse(
      'dispatcher-hook-not-executable',
      renderRefusal(
        `the ${POINTER_HOOK_NAME} git dispatches through is not executable, so git can never run it.`,
        [configLine, hookLocationLine, `an execute check on it failed with ${executeFailure}`, ownHooksLine],
        hooksPathRemedy()
      )
    )
  }

  return null
}

const classifyPredecessor = (priorValue, priorLine, hooksPathReal, configLine, repoHooksDir, repoHooksDirReal, workTreeTop) => {
  const ownHooksLine = `this repository's own hooks directory: ${escapeForOperator(repoHooksDir)}`

  if (priorValue === null) {
    return refuse(
      'prior-undetermined',
      renderRefusal(
        `git dispatches hooks through another directory and ${PRIOR_HOOKS_PATH_KEY} records no fallback to this repository, so whether that dispatcher ever hands control back here cannot be determined from this repository.`,
        [
          configLine,
          priorLine,
          `the dispatcher resolves to: ${escapeForOperator(hooksPathReal)}`,
          ownHooksLine,
          'This installer refuses to assume a fallback it cannot read.'
        ],
        priorHooksPathRemedy(repoHooksDir, hooksPathReal)
      )
    )
  }

  const priorReal = resolveConfiguredPath(priorValue, workTreeTop)

  if (priorReal === hooksPathReal) {
    return refuse(
      'prior-is-the-dispatcher',
      renderRefusal(
        `${PRIOR_HOOKS_PATH_KEY} names the dispatcher itself, so git's hook chain is a cycle that never reaches this repository.`,
        [configLine, priorLine, `both resolve to: ${escapeForOperator(hooksPathReal)}`, ownHooksLine],
        priorHooksPathRemedy(repoHooksDir, hooksPathReal)
      )
    )
  }

  if (priorReal === repoHooksDirReal) {
    return approve('prior-is-the-repository')
  }

  return refuse(
    'prior-points-elsewhere',
    renderRefusal(
      `${PRIOR_HOOKS_PATH_KEY} names neither the dispatcher nor this repository, so the hook chain never reaches this repository.`,
      [
        configLine,
        priorLine,
        `the recorded fallback resolves to: ${escapeForOperator(priorReal)}`,
        `the dispatcher resolves to: ${escapeForOperator(hooksPathReal)}`,
        ownHooksLine
      ],
      priorHooksPathRemedy(repoHooksDir, hooksPathReal)
    )
  )
}

const classifyHookChain = ({ repoHooksDir, workTreeTop, hooksPathConfig, priorHooksPathConfig }) => {
  const hooksPathValue = configuredPathOrNull(hooksPathConfig, HOOKS_PATH_KEY)
  if (hooksPathValue === null) {
    return approve('hooks-path-unset')
  }

  const hooksPathReal = resolveConfiguredPath(hooksPathValue, workTreeTop)
  const repoHooksDirReal = resolveRealPathOrLiteral(repoHooksDir)
  if (hooksPathReal === repoHooksDirReal) {
    return approve('hooks-path-is-the-repository')
  }

  const configLine = `${HOOKS_PATH_KEY} = ${renderConfigValue(hooksPathConfig)}`
  const dispatcherVerdict = classifyDispatcher(hooksPathReal, configLine, repoHooksDir)
  if (dispatcherVerdict !== null) {
    return dispatcherVerdict
  }

  const priorValue = configuredPathOrNull(priorHooksPathConfig, PRIOR_HOOKS_PATH_KEY)
  const priorLine = `${PRIOR_HOOKS_PATH_KEY} = ${renderConfigValue(priorHooksPathConfig)}`
  return classifyPredecessor(priorValue, priorLine, hooksPathReal, configLine, repoHooksDir, repoHooksDirReal, workTreeTop)
}

const resolveRepoHooksDir = () => {
  const gitCommonDir = runGitOrThrow(['rev-parse', '--git-common-dir'])
  const commonDirAbsolute = path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(process.cwd(), gitCommonDir)
  return path.join(resolveRealPathOrLiteral(commonDirAbsolute), HOOKS_DIR_NAME)
}

const statExistingTarget = (targetPath) => {
  try {
    return lstatSync(targetPath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw new Error(`failed to inspect existing hook at ${escapeForOperator(targetPath)}: ${escapeForOperator(error.message)}`)
  }
}

const assertTrackedHookExecutable = (workTreeTop) => {
  const trackedHookPath = path.join(workTreeTop, TRACKED_HOOK_RELATIVE_PATH)
  let stat
  try {
    stat = statSync(trackedHookPath)
  } catch (error) {
    throw new Error(
      `refusing to install a pointer hook: the tracked hook at ${escapeForOperator(trackedHookPath)} could not be inspected: ${escapeForOperator(error.message)}`
    )
  }
  if (!stat.isFile()) {
    throw new Error(`refusing to install a pointer hook: the tracked hook at ${escapeForOperator(trackedHookPath)} is not a regular file`)
  }
  if ((stat.mode & 0o100) === 0) {
    throw new Error(
      `refusing to install a pointer hook: the tracked hook at ${escapeForOperator(trackedHookPath)} is not owner-executable; run chmod +x on it, then re-run: node scripts/install-githooks.mjs`
    )
  }
}

const installPointerHook = (repoHooksDir) => {
  const desiredSource = buildPointerHookSource()
  const targetPath = path.join(repoHooksDir, POINTER_HOOK_NAME)

  try {
    mkdirSync(repoHooksDir, { recursive: true })
  } catch (error) {
    throw new Error(`failed to create hooks directory ${escapeForOperator(repoHooksDir)}: ${escapeForOperator(error.message)}`)
  }

  const existingStat = statExistingTarget(targetPath)
  if (existingStat !== null) {
    if (!existingStat.isFile()) {
      throw new Error(
        `refusing to install over ${escapeForOperator(targetPath)}: it already exists and is ${describeStatKind(existingStat)}, not a regular file. ` +
          'Remove it manually, then re-run: node scripts/install-githooks.mjs'
      )
    }
    let existingSource
    try {
      existingSource = readFileSync(targetPath, 'utf8')
    } catch (error) {
      throw new Error(`failed to read existing hook at ${escapeForOperator(targetPath)}: ${escapeForOperator(error.message)}`)
    }
    if (existingSource !== desiredSource) {
      throw new Error(
        `refusing to overwrite ${escapeForOperator(targetPath)}: a pre-commit hook already exists there that this installer did not write. ` +
          'Back it up or remove it manually, then re-run: node scripts/install-githooks.mjs'
      )
    }
  }

  const tempPath = path.join(repoHooksDir, `.${POINTER_HOOK_NAME}.tmp-${process.pid}-${process.hrtime.bigint()}`)
  try {
    writeFileSync(tempPath, desiredSource, { mode: POINTER_HOOK_MODE })
    chmodSync(tempPath, POINTER_HOOK_MODE)
    renameSync(tempPath, targetPath)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {}
    throw new Error(`failed to write hook to ${escapeForOperator(targetPath)}: ${escapeForOperator(error.message)}`)
  }
}

const main = () => {
  if (!isInsideGitWorkTree()) {
    process.stderr.write('install-githooks: no git repository was found here, so no pre-commit hook was installed\n')
    process.exit(0)
  }

  const workTreeTop = runGitOrThrow(['rev-parse', '--show-toplevel'])
  const repoHooksDir = resolveRepoHooksDir()
  const verdict = classifyHookChain({
    repoHooksDir,
    workTreeTop,
    hooksPathConfig: readGitConfig(HOOKS_PATH_KEY),
    priorHooksPathConfig: readGitConfig(PRIOR_HOOKS_PATH_KEY)
  })

  if (!verdict.writeHook) {
    if (typeof verdict.message !== 'string' || verdict.message.trim() === '') {
      throw new Error(`the hook chain classifier refused with kind "${verdict.kind}" but produced no diagnosis`)
    }
    process.stderr.write(`${verdict.message}\n`)
    process.exit(verdict.exitCode)
  }

  assertTrackedHookExecutable(workTreeTop)
  installPointerHook(repoHooksDir)
  process.exit(verdict.exitCode)
}

try {
  main()
} catch (error) {
  process.stderr.write(`install-githooks: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
