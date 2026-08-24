#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const POINTER_HOOK_NAME = 'pre-commit'
const TRACKED_HOOK_RELATIVE_PATH = 'scripts/githooks/pre-commit'
const POINTER_HOOK_MODE = 0o700

const escapeForOperator = (value) => JSON.stringify(value)

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

const readGitConfig = (key) => {
  const result = runGit(['config', '--get', key])
  if (result.status === 0) {
    return result.stdout.trim()
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

const determineReachability = (workTreeTop) => {
  const gitCommonDir = runGitOrThrow(['rev-parse', '--git-common-dir'])
  const commonDirAbsolute = path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(process.cwd(), gitCommonDir)
  const commonDirReal = resolveRealPathOrLiteral(commonDirAbsolute)
  const repoHooksDir = path.join(commonDirReal, 'hooks')

  const hooksPathConfig = readGitConfig('core.hooksPath')

  if (hooksPathConfig === null || hooksPathConfig.trim() === '') {
    return { reachable: true, reachableViaInference: false, repoHooksDir, hooksPathConfig, priorHooksPathConfig: null }
  }

  const hooksPathAbsolute = path.isAbsolute(hooksPathConfig) ? hooksPathConfig : path.resolve(workTreeTop, hooksPathConfig)
  const hooksPathReal = resolveRealPathOrLiteral(hooksPathAbsolute)
  const repoHooksDirReal = resolveRealPathOrLiteral(repoHooksDir)

  if (hooksPathReal === repoHooksDirReal) {
    return { reachable: true, reachableViaInference: false, repoHooksDir, hooksPathConfig, priorHooksPathConfig: null }
  }

  const priorHooksPathConfig = readGitConfig('continuity.priorHooksPath')
  const priorIsEmpty = priorHooksPathConfig === null || priorHooksPathConfig.trim() === ''

  return { reachable: priorIsEmpty, reachableViaInference: priorIsEmpty, repoHooksDir, hooksPathConfig, priorHooksPathConfig }
}

const renderConfigValue = (value) => (value === null ? 'unset' : escapeForOperator(value))

const reportUnreachable = ({ hooksPathConfig, priorHooksPathConfig }) => {
  const lines = [
    "install-githooks: the repository's own hooks directory is not reachable from git's active hook dispatch chain.",
    'core.hooksPath points somewhere else, and continuity.priorHooksPath is set to a location that does not fall',
    "back to this repository's own hooks directory, so a pointer written there would never run.",
    `core.hooksPath = ${renderConfigValue(hooksPathConfig)}`,
    `continuity.priorHooksPath = ${renderConfigValue(priorHooksPathConfig)}`,
    'No hook was written.',
    'Clear or repoint continuity.priorHooksPath so the plugin dispatcher falls back to this repository, then re-run:',
    '  node scripts/install-githooks.mjs'
  ]
  process.stderr.write(`${lines.join('\n')}\n`)
}

const reportInferredReachability = ({ hooksPathConfig }) => {
  const lines = [
    "install-githooks: core.hooksPath points somewhere other than this repository's own hooks directory, and",
    'continuity.priorHooksPath is unset, so this installer is ASSUMING the dispatcher at core.hooksPath falls back',
    "to this repository's own hooks directory. That assumption could not be verified from here.",
    `core.hooksPath = ${renderConfigValue(hooksPathConfig)}`,
    'The pre-commit hook was written anyway. If commits stop being type-checked, confirm that dispatcher actually',
    'falls back to this repository.'
  ]
  process.stderr.write(`${lines.join('\n')}\n`)
}

const describeExistingKind = (stat) => {
  if (stat.isDirectory()) return 'a directory'
  if (stat.isSymbolicLink()) return 'a symbolic link'
  if (stat.isBlockDevice()) return 'a block device'
  if (stat.isCharacterDevice()) return 'a character device'
  if (stat.isFIFO()) return 'a FIFO'
  if (stat.isSocket()) return 'a socket'
  return 'not a regular file'
}

const statExistingTarget = (targetPath) => {
  try {
    return lstatSync(targetPath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw new Error(`failed to inspect existing hook at "${targetPath}": ${escapeForOperator(error.message)}`)
  }
}

const assertTrackedHookExecutable = (workTreeTop) => {
  const trackedHookPath = path.join(workTreeTop, TRACKED_HOOK_RELATIVE_PATH)
  let stat
  try {
    stat = statSync(trackedHookPath)
  } catch (error) {
    throw new Error(
      `refusing to install a pointer hook: the tracked hook at "${trackedHookPath}" could not be inspected: ${escapeForOperator(error.message)}`
    )
  }
  if (!stat.isFile()) {
    throw new Error(`refusing to install a pointer hook: the tracked hook at "${trackedHookPath}" is not a regular file`)
  }
  if ((stat.mode & 0o100) === 0) {
    throw new Error(
      `refusing to install a pointer hook: the tracked hook at "${trackedHookPath}" is not owner-executable; run chmod +x on it, then re-run: node scripts/install-githooks.mjs`
    )
  }
}

const installPointerHook = (repoHooksDir) => {
  const desiredSource = buildPointerHookSource()
  const targetPath = path.join(repoHooksDir, POINTER_HOOK_NAME)

  try {
    mkdirSync(repoHooksDir, { recursive: true })
  } catch (error) {
    throw new Error(`failed to create hooks directory "${repoHooksDir}": ${escapeForOperator(error.message)}`)
  }

  const existingStat = statExistingTarget(targetPath)
  if (existingStat !== null) {
    if (!existingStat.isFile()) {
      throw new Error(
        `refusing to install over "${targetPath}": it already exists and is ${describeExistingKind(existingStat)}, not a regular file. ` +
          'Remove it manually, then re-run: node scripts/install-githooks.mjs'
      )
    }
    let existingSource
    try {
      existingSource = readFileSync(targetPath, 'utf8')
    } catch (error) {
      throw new Error(`failed to read existing hook at "${targetPath}": ${escapeForOperator(error.message)}`)
    }
    if (existingSource !== desiredSource) {
      throw new Error(
        `refusing to overwrite "${targetPath}": a pre-commit hook already exists there that this installer did not write. ` +
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
    throw new Error(`failed to write hook to "${targetPath}": ${escapeForOperator(error.message)}`)
  }
}

const main = () => {
  if (!isInsideGitWorkTree()) {
    process.stderr.write('install-githooks: no git repository was found here, so no pre-commit hook was installed\n')
    process.exit(0)
  }

  const workTreeTop = runGitOrThrow(['rev-parse', '--show-toplevel'])
  const reachability = determineReachability(workTreeTop)

  if (!reachability.reachable) {
    reportUnreachable(reachability)
    process.exit(1)
  }

  if (reachability.reachableViaInference) {
    reportInferredReachability(reachability)
  }

  assertTrackedHookExecutable(workTreeTop)
  installPointerHook(reachability.repoHooksDir)
  process.exit(0)
}

try {
  main()
} catch (error) {
  process.stderr.write(`install-githooks: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
