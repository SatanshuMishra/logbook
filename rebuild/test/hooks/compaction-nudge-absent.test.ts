import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { census, type Classified } from '../support/census.ts'
import { TREE_ROOT, runHookProcess, readFixture, controlledEnv, freshTmpDir } from './hook-process.ts'

const NUDGE_PHRASE = ['approaching the ', 'compaction threshold'].join('')

const FORBIDDEN_TOKENS = [
  'NUDGE_TEXT',
  'computeNudgeThreshold',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES',
  NUDGE_PHRASE
]

const SCAN_ROOTS = ['src', 'hooks', 'bin', 'skills']
const SCAN_EXTENSIONS = new Set(['.ts', '.md'])

const LEDGER_NUDGE_ENV_PREFIX = 'LEDGER_NUDGE'

const PLUGIN_MANIFEST_MARKER = path.join('.claude-plugin', 'plugin.json')
const PLUGIN_MANIFEST_MAX_ASCENT = 10

const OVERSIZED_TRANSCRIPT_BYTES = 2000000

type TokenHit = { file: string; token: string }

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkFiles(full)
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) return [full]
    return []
  })
}

const populationFor = (files: readonly string[]): TokenHit[] =>
  files.flatMap((file) => {
    const content = readFileSync(file, 'utf8')
    return FORBIDDEN_TOKENS.filter((token) => content.includes(token)).map((token) => ({ file, token }))
  })

const classifyTokenHit = (_item: TokenHit): Classified<TokenHit>['verdict'] | 'unclassifiable' => 'forbidden'

const describeTokenViolations = (population: readonly TokenHit[]): string =>
  [
    `hook.compaction-nudge-absent: ${population.length} forbidden compaction-nudge token occurrences found`,
    ...population.map((item) => `${item.file} [${item.token}]`)
  ].join('\n')

const findPluginManifestPath = (): string => {
  let dir = TREE_ROOT
  for (let step = 0; step < PLUGIN_MANIFEST_MAX_ASCENT; step += 1) {
    const candidate = path.join(dir, PLUGIN_MANIFEST_MARKER)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `hook.compaction-nudge-absent: walked up from ${TREE_ROOT} without finding an ancestor containing ${PLUGIN_MANIFEST_MARKER}`
  )
}

test('hook.compaction-nudge-absent', () => {
  const scannedFiles = SCAN_ROOTS.flatMap((root) => walkFiles(path.join(TREE_ROOT, root)))
  assert.ok(scannedFiles.length > 0, 'hook.compaction-nudge-absent: the scan walked zero files; the roots drifted')

  const population = populationFor(scannedFiles)
  assert.doesNotThrow(() => census(population, classifyTokenHit), describeTokenViolations(population))

  const hooksJsonPath = path.join(TREE_ROOT, 'hooks', 'hooks.json')
  const hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as { env?: Record<string, unknown> }
  assert.deepEqual(
    Object.keys(hooksJson.env ?? {}).filter((key) => key.startsWith(LEDGER_NUDGE_ENV_PREFIX)),
    [],
    `hook.compaction-nudge-absent: ${hooksJsonPath} declares a LEDGER_NUDGE* env key`
  )

  const pluginManifestPath = findPluginManifestPath()
  const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, 'utf8')) as { userConfig?: Record<string, unknown> }
  assert.deepEqual(
    Object.keys(pluginManifest.userConfig ?? {}).filter((key) => key.toLowerCase().includes('nudge')),
    [],
    `hook.compaction-nudge-absent: ${pluginManifestPath} declares a userConfig key mentioning "nudge"`
  )
})

test('hook.compaction-nudge-absent.post-tool-use-emits-no-additional-context', () => {
  const home = freshTmpDir('logbook-nudge-home-')
  const data = freshTmpDir('logbook-nudge-data-')
  try {
    const transcriptPath = path.join(home, 'transcript.jsonl')
    writeFileSync(transcriptPath, Buffer.alloc(OVERSIZED_TRANSCRIPT_BYTES, '0'))

    const fixture = readFixture('post-tool-use.json') as object
    const event = { ...fixture, transcript_path: transcriptPath }

    const result = runHookProcess('post-tool-use', JSON.stringify(event), {
      env: controlledEnv({ HOME: home, CLAUDE_PLUGIN_DATA: data })
    })

    assert.equal(result.status, 0, `hook.compaction-nudge-absent: post-tool-use exited nonzero: ${result.stderr}`)

    const parsed: unknown = JSON.parse(result.stdout)
    assert.deepEqual(
      parsed,
      {},
      'the PostToolUse hook emitted output for an oversized transcript; the compaction nudge has been reintroduced'
    )
    assert.equal('hookSpecificOutput' in (parsed as object), false)
    assert.equal(result.stdout.includes(NUDGE_PHRASE), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  }
})
