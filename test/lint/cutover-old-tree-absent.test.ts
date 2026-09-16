import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'
import { rawGit } from '../support/git-fixture.ts'

export type PathClassification = { path: string; bucket: string }

const DOCS_PREFIX = 'docs/'
const README_FILE = 'README.md'

const REPO_INFRA_PREFIXES = ['node_modules/', '.github/', 'scripts/', '.claude-plugin/']

const REPO_INFRA_EXACT_FILES = new Set([
  '.gitignore',
  '.npmrc',
  '.mcp.json',
  'package.json',
  'package-lock.json',
  'receipts.config.json',
  'tsconfig.json',
  'inspector.config.json',
  'LICENSE',
  'NOTICE'
])

const NEW_TREE_ROOTS = new Set(['bin', 'hooks', 'skills', 'src', 'test'])
const NEW_TREE_SOURCE_EXTENSIONS = new Set(['.ts', '.json', '.md'])
const LEGACY_JS_EXTENSIONS = new Set(['.mjs', '.cjs', '.js'])

export const classify = (filePath: string): PathClassification => {
  if (filePath.startsWith(DOCS_PREFIX) || filePath === README_FILE) {
    return { path: filePath, bucket: 'documentation' }
  }
  if (REPO_INFRA_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return { path: filePath, bucket: 'repository-infrastructure' }
  }
  if (REPO_INFRA_EXACT_FILES.has(filePath)) {
    return { path: filePath, bucket: 'repository-infrastructure' }
  }
  const segments = filePath.split('/')
  const firstSegment = segments[0]
  if (firstSegment !== undefined && NEW_TREE_ROOTS.has(firstSegment) && filePath.includes('/')) {
    const ext = path.extname(filePath)
    if (NEW_TREE_SOURCE_EXTENSIONS.has(ext)) return { path: filePath, bucket: 'new-tree' }
    if (LEGACY_JS_EXTENSIONS.has(ext)) return { path: filePath, bucket: 'legacy-javascript-module' }
    return { path: filePath, bucket: `no-extension-rule:${ext || '<none>'}` }
  }
  return { path: filePath, bucket: 'outside-every-declared-root' }
}

const bucketVerdict = (bucket: string): Classified<PathClassification>['verdict'] | 'unclassifiable' => {
  if (bucket === 'documentation') return 'allowed'
  if (bucket === 'repository-infrastructure') return 'allowed'
  if (bucket === 'new-tree') return 'allowed'
  if (bucket === 'legacy-javascript-module') return 'forbidden'
  return 'unclassifiable'
}

export const verdictOf = (item: PathClassification): Classified<PathClassification>['verdict'] | 'unclassifiable' =>
  bucketVerdict(item.bucket)

const KNOWN_LIMIT =
  'known limit: hooks/hooks.json, skills/debrief/SKILL.md and skills/preflight/SKILL.md occupy the same path in both the legacy and the new tree, so this classifier cannot tell a restored legacy file at one of those exact paths from the genuine new-tree replacement'

const describeViolations = (population: readonly PathClassification[]): string => {
  const violations = population.filter((item) => verdictOf(item) !== 'allowed')
  return [
    `cutover.old-tree-absent: ${violations.length} of ${population.length} tracked paths are a legacy module or cannot be classified`,
    ...violations.map((item) => `${item.path} [${item.bucket}]`)
  ].join('\n')
}

test('cutover.old-tree-absent', () => {
  const startDir = path.dirname(fileURLToPath(import.meta.url))
  const top = rawGit(startDir, ['rev-parse', '--show-toplevel'])
  assert.equal(
    top.status,
    0,
    `cutover.old-tree-absent: git rev-parse --show-toplevel failed from ${startDir}: ${top.stderr}`
  )
  const repoRoot = top.stdout.trim()

  const listed = rawGit(repoRoot, ['ls-files', '-z'])
  assert.equal(listed.status, 0, `cutover.old-tree-absent: git -C ${repoRoot} ls-files -z failed: ${listed.stderr}`)
  const population = listed.stdout.split('\0').filter((entry) => entry.length > 0)

  assert.ok(
    population.length > 0,
    `cutover.old-tree-absent: a census over an empty population proves nothing. ${KNOWN_LIMIT}`
  )
  assert.ok(
    population.includes('package.json'),
    "cutover.old-tree-absent: population does not include 'package.json'; the ls-files paths are not repo-root-relative"
  )

  const classified = population.map(classify)

  const newTreeCount = classified.filter((item) => item.bucket === 'new-tree').length
  assert.ok(
    newTreeCount > 0,
    'cutover.old-tree-absent: the new tree is missing; zero tracked paths classified into the new-tree bucket, so the classifier may be passing everything through an infrastructure rule instead of finding the moved tree'
  )

  assert.doesNotThrow(() => census(classified, verdictOf), describeViolations(classified))
})

test('cutover.old-tree-absent.control.a-restored-legacy-module-is-forbidden-and-named', () => {
  const synthetic = [
    classify('src/server/main.ts'),
    classify('docs/specs/anything.md'),
    classify('src/drivers/git-ref-driver.mjs')
  ]
  assert.deepEqual(
    synthetic.map((item) => item.bucket),
    ['new-tree', 'documentation', 'legacy-javascript-module']
  )
  assert.throws(
    () => census(synthetic, verdictOf),
    (error: unknown) => error instanceof Error && error.message.includes('src/drivers/git-ref-driver.mjs')
  )
})
