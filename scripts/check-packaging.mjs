#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REQUIRED_FILES = [
  'bin/logbook-cli.ts',
  'bin/logbook-server.ts',
  'hooks/hooks.json',
  'hooks/lib/io.ts',
  'hooks/post-tool-use.ts',
  'hooks/pre-tool-use.ts',
  'hooks/session-end.ts',
  'hooks/session-start.ts',
  'hooks/stop.ts',
  'hooks/user-prompt-submit.ts',
  'skills/debrief/SKILL.md',
  'skills/preflight/SKILL.md',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.mcp.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.npmrc',
  'scripts/check-packaging.mjs'
]

export const EXACT_DEPENDENCIES = {
  '@modelcontextprotocol/sdk': '1.30.0',
  ulid: '3.0.2',
  zod: '4.4.3'
}

export const REQUIRED_ENGINE_NODE = '>=22.19'

export const SERVER_ARGS = ['${CLAUDE_PLUGIN_ROOT}/bin/logbook-server.ts']

export const FORBIDDEN_SERVER_ENV_KEYS = [
  'LEDGER_BACKEND',
  'LEDGER_BRANCH',
  'LEDGER_DISABLE_TRAILER',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES'
]

export const REQUIRED_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop']

export const EVENT_HOOK_FILES = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'user-prompt-submit',
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  SessionEnd: 'session-end',
  Stop: 'stop'
}

export const LEGACY_EXTENSION_ROOTS = ['bin', 'hooks', 'skills', 'src', 'test']
export const LEGACY_EXTENSIONS = new Set(['.mjs', '.cjs'])

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

async function checkRequiredFiles(root, problems) {
  for (const rel of REQUIRED_FILES) {
    try {
      await stat(join(root, rel))
    } catch {
      problems.push(`missing required file: ${rel}`)
    }
  }
}

async function readJsonFile(root, rel, problems) {
  let raw
  try {
    raw = await readFile(join(root, rel), 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    problems.push(`${rel}: invalid JSON (${err.message})`)
    return null
  }
}

async function checkPackageManifest(root, problems) {
  const pkg = await readJsonFile(root, 'package.json', problems)
  if (!pkg) return

  const deps = pkg.dependencies ?? {}
  const names = Object.keys(deps).sort()
  const expected = Object.keys(EXACT_DEPENDENCIES).sort()
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) {
    problems.push(`package.json: dependencies must be exactly ${expected.join(', ')} (found ${names.join(', ') || 'none'})`)
  }
  for (const [name, version] of Object.entries(EXACT_DEPENDENCIES)) {
    const actual = deps[name]
    if (actual === undefined) continue
    if (!SEMVER_PATTERN.test(actual)) {
      problems.push(`package.json: ${name} must be exact-pinned with no range operator (found "${actual}")`)
    } else if (actual !== version) {
      problems.push(`package.json: ${name} must be pinned to ${version} (found "${actual}")`)
    }
  }

  const devDeps = pkg.devDependencies
  const devDepsIsObject = typeof devDeps === 'object' && devDeps !== null && !Array.isArray(devDeps)
  if (!devDepsIsObject || Object.keys(devDeps).length === 0) {
    problems.push('package.json: devDependencies must be a non-empty object')
  }

  if (pkg.engines?.node !== REQUIRED_ENGINE_NODE) {
    problems.push(`package.json: engines.node must be exactly "${REQUIRED_ENGINE_NODE}" (found ${JSON.stringify(pkg.engines?.node)})`)
  }

  const buildLikeScriptNames = ['build', 'prepack', 'prepare-build']
  for (const scriptName of buildLikeScriptNames) {
    if (pkg.scripts && scriptName in pkg.scripts) {
      problems.push(`package.json: scripts.${scriptName} must be absent (this plugin ships TypeScript source, not a build output)`)
    }
  }
}

async function checkPluginManifest(root, problems) {
  const plugin = await readJsonFile(root, '.claude-plugin/plugin.json', problems)
  if (!plugin) return
  if ('userConfig' in plugin) {
    problems.push('.claude-plugin/plugin.json: userConfig must be absent (former entries were controls that did nothing; a reappearing one is dead weight)')
  }
}

async function checkVersionsAgree(root, problems) {
  const pkg = await readJsonFile(root, 'package.json', problems)
  const plugin = await readJsonFile(root, '.claude-plugin/plugin.json', problems)
  if (!pkg || !plugin) return

  const pkgVersion = pkg.version
  const pluginVersion = plugin.version
  if (typeof pkgVersion !== 'string' || !SEMVER_PATTERN.test(pkgVersion)) {
    problems.push(`package.json: version must be a plain semver like 1.0.0 (found ${JSON.stringify(pkgVersion)})`)
  }
  if (typeof pluginVersion !== 'string' || !SEMVER_PATTERN.test(pluginVersion)) {
    problems.push(`.claude-plugin/plugin.json: version must be a plain semver like 1.0.0 (found ${JSON.stringify(pluginVersion)})`)
  }
  if (pkgVersion !== pluginVersion) {
    problems.push(`version mismatch: package.json has ${JSON.stringify(pkgVersion)}, .claude-plugin/plugin.json has ${JSON.stringify(pluginVersion)}`)
  }

  const lock = await readJsonFile(root, 'package-lock.json', problems)
  if (!lock) {
    problems.push('package-lock.json: could not be read or parsed; version fields cannot be checked against package.json')
    return
  }
  const lockRootVersion = lock.version
  const lockPackagesVersion = lock.packages?.['']?.version
  if (lockRootVersion !== pkgVersion) {
    problems.push(`version mismatch: package.json has ${JSON.stringify(pkgVersion)}, package-lock.json version has ${JSON.stringify(lockRootVersion)}`)
  }
  if (lockPackagesVersion !== pkgVersion) {
    problems.push(`version mismatch: package.json has ${JSON.stringify(pkgVersion)}, package-lock.json packages[""].version has ${JSON.stringify(lockPackagesVersion)}`)
  }
}

async function checkNpmrc(root, problems) {
  let raw
  try {
    raw = await readFile(join(root, '.npmrc'), 'utf8')
  } catch {
    return
  }
  const lines = raw.split('\n').map((line) => line.trim())
  if (!lines.includes('engine-strict=true')) {
    problems.push('.npmrc: must contain the line engine-strict=true')
  }
}

async function checkMcpDeclaration(root, problems) {
  const mcp = await readJsonFile(root, '.mcp.json', problems)
  if (!mcp) return
  const serverKeys = Object.keys(mcp.mcpServers ?? {})
  if (serverKeys.length !== 1 || serverKeys[0] !== 'ledger') {
    problems.push(`.mcp.json: mcpServers must declare exactly one server, "ledger" (found ${serverKeys.join(', ') || 'none'})`)
  }
  const server = mcp.mcpServers?.ledger
  if (!server) {
    problems.push('.mcp.json: mcpServers.ledger is missing (the mcp__ledger__* surface depends on this key)')
    return
  }
  if (server.command !== 'node') {
    problems.push(`.mcp.json: ledger server command must be "node" (found ${JSON.stringify(server.command)})`)
  }
  const args = Array.isArray(server.args) ? server.args : []
  const argsMatch = args.length === SERVER_ARGS.length && args.every((a, i) => a === SERVER_ARGS[i])
  if (!argsMatch) {
    problems.push(`.mcp.json: ledger server args must be exactly ${JSON.stringify(SERVER_ARGS)} (found ${JSON.stringify(server.args)})`)
  }
  if ('env' in server) {
    problems.push('.mcp.json: ledger server env key must be absent (nothing reads it; a reappearing env key is a regression)')
  }
}

async function checkHooksBindings(root, problems) {
  const hooksDoc = await readJsonFile(root, 'hooks/hooks.json', problems)
  if (!hooksDoc) return
  if ('env' in hooksDoc) {
    problems.push('hooks/hooks.json: top-level env key must be absent')
  }
  const events = hooksDoc.hooks ?? {}
  const eventNames = Object.keys(events)
  const unexpected = eventNames.filter((name) => !REQUIRED_HOOK_EVENTS.includes(name))
  if (unexpected.length > 0) {
    problems.push(`hooks/hooks.json: unexpected event binding(s): ${unexpected.join(', ')} (only ${REQUIRED_HOOK_EVENTS.join(', ')} are allowed)`)
  }
  for (const eventName of REQUIRED_HOOK_EVENTS) {
    const groups = events[eventName]
    if (!Array.isArray(groups) || groups.length === 0) {
      problems.push(`hooks/hooks.json: missing binding for ${eventName}`)
      continue
    }
    const hookFile = EVENT_HOOK_FILES[eventName]
    const expectedCommand = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/' + hookFile + '.ts"'
    let sawCommand = false
    for (const group of groups) {
      const entries = Array.isArray(group.hooks) ? group.hooks : []
      for (const entry of entries) {
        sawCommand = true
        if (entry.type !== 'command') {
          problems.push(`hooks/hooks.json: ${eventName} hook type must be "command" (found ${JSON.stringify(entry.type)})`)
        }
        if (entry.command !== expectedCommand) {
          problems.push(`hooks/hooks.json: ${eventName} command must be exactly ${JSON.stringify(expectedCommand)} (found ${JSON.stringify(entry.command)})`)
        }
      }
    }
    if (!sawCommand) {
      problems.push(`hooks/hooks.json: ${eventName} has no command entries`)
    }
  }
}

async function checkForbiddenEnvKeysAbsent(root, problems) {
  for (const rel of ['.mcp.json', 'hooks/hooks.json']) {
    let raw
    try {
      raw = await readFile(join(root, rel), 'utf8')
    } catch {
      continue
    }
    for (const key of FORBIDDEN_SERVER_ENV_KEYS) {
      if (raw.includes(key)) {
        problems.push(`${rel}: forbidden env key ${key} must not appear anywhere in this file`)
      }
    }
  }
}

async function walkFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

async function checkNoLegacyExtensions(root, problems) {
  for (const dirName of LEGACY_EXTENSION_ROOTS) {
    const files = await walkFiles(join(root, dirName))
    for (const file of files) {
      if (LEGACY_EXTENSIONS.has(extname(file))) {
        problems.push(`${relative(root, file)}: legacy ${extname(file)} module found under ${dirName}/ (this plugin ships TypeScript source)`)
      }
    }
  }
}

async function checkNoDist(root, problems) {
  let info
  try {
    info = await stat(join(root, 'dist'))
  } catch {
    return
  }
  if (info.isDirectory()) {
    problems.push('dist: a build output directory must not exist at the repository root')
  }
}

async function checkMarketplace(root, problems) {
  const mkt = await readJsonFile(root, '.claude-plugin/marketplace.json', problems)
  if (!mkt) return
  if (mkt.name !== 'logbook') {
    problems.push(`.claude-plugin/marketplace.json: name must be "logbook" (found ${JSON.stringify(mkt.name)})`)
  }
  if (!mkt.owner || typeof mkt.owner.name !== 'string' || mkt.owner.name.length === 0) {
    problems.push('.claude-plugin/marketplace.json: owner.name is required')
  }
  const entry = Array.isArray(mkt.plugins) ? mkt.plugins[0] : undefined
  if (!entry) {
    problems.push('.claude-plugin/marketplace.json: plugins[0] is missing')
    return
  }
  if (entry.name !== 'logbook') {
    problems.push(`.claude-plugin/marketplace.json: plugins[0].name must be "logbook" (found ${JSON.stringify(entry.name)})`)
  }
  if (entry.source !== './') {
    problems.push(`.claude-plugin/marketplace.json: plugins[0].source must be "./" (found ${JSON.stringify(entry.source)})`)
  }
}

export async function checkPackaging(root) {
  const problems = []
  await checkRequiredFiles(root, problems)
  await checkPackageManifest(root, problems)
  await checkPluginManifest(root, problems)
  await checkVersionsAgree(root, problems)
  await checkNpmrc(root, problems)
  await checkMcpDeclaration(root, problems)
  await checkHooksBindings(root, problems)
  await checkForbiddenEnvKeysAbsent(root, problems)
  await checkNoLegacyExtensions(root, problems)
  await checkNoDist(root, problems)
  await checkMarketplace(root, problems)
  return { ok: problems.length === 0, problems }
}

async function main(argv) {
  const rootArg = argv[2]
  const root = rootArg
    ? resolve(rootArg)
    : resolve(fileURLToPath(new URL('..', import.meta.url)))
  const { ok, problems } = await checkPackaging(root)
  if (ok) {
    process.stdout.write('check-packaging: ok\n')
    return 0
  }
  process.stderr.write(`check-packaging: ${problems.length} problem(s) found\n`)
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`)
  }
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`check-packaging: fatal ${err.stack || err}\n`)
      process.exit(2)
    })
}
