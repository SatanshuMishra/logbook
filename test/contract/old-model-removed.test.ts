import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import * as ts from 'typescript'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const REMOVED_PATHS: readonly string[] = [
  'src/domain',
  'src/render',
  'src/merge',
  'src/cli',
  'src/hooklib',
  'evals',
  'hooks/user-prompt-submit.ts',
  'src/schema/caps.ts',
  'src/schema/binding.ts',
  'src/schema/decision.ts',
  'src/schema/escape-record.ts',
  'src/schema/field-class.ts',
  'src/schema/session.ts',
  'src/schema/thread.ts',
  'src/server/tool-support.ts',
  'src/store/layout.ts',
  'src/store/materialise-in-place.ts',
  'src/store/materialise-tree.ts',
  'src/store/project-key.ts',
  'src/store/read-path.ts',
  'src/store/records.ts',
  'src/store/resumable.ts',
  'src/store/single-store.ts',
  'src/store/write-path.ts',
  'test/contract/debrief-spine-update.test.ts',
  'test/contract/matcher.test.ts',
  'test/contract/public-interface.test.ts',
  'test/contract/render-census.test.ts',
  'test/contract/skills.test.ts',
  'test/contract/write-tools-ignore-the-pointer.test.ts',
  'test/fixtures/hook-events',
  'test/fixtures/hook-types.d.ts',
  'test/hooks/stop-gate-owes-the-handle.test.ts',
  'test/hooks/stop-gate-quote-marker-echo.test.ts',
  'test/hooks/stop-gate-store-shape.test.ts',
  'test/lint/assertions-are-not-invariants.test.ts',
  'test/lint/disposal-census.test.ts',
  'test/lint/markdown-construct-census.test.ts',
  'test/lint/proof-suite.test.ts',
  'test/lint/readme-promises-census.test.ts',
  'test/lint/resume-path-has-no-settledness-aggregate.test.ts',
  'test/lint/spec-errata-census.test.ts',
  'test/spawn/amend-criteria.test.ts',
  'test/spawn/blocked-by-writer.test.ts',
  'test/spawn/caps-relaxed.test.ts',
  'test/spawn/completions.test.ts',
  'test/spawn/criterion-reopen.test.ts',
  'test/spawn/decision-standard.test.ts',
  'test/spawn/handshake.test.ts',
  'test/spawn/open-thread.test.ts',
  'test/spawn/park-refuses-unstorable-step.test.ts',
  'test/spawn/resource-address-refusals.test.ts',
  'test/spawn/session-entry-line-breaks.test.ts',
  'test/spawn/step-briefing-resume.test.ts',
  'test/spawn/step-records.test.ts',
  'test/spawn/update-thread.test.ts',
  'test/store/binding-write-validation.test.ts',
  'test/store/concurrency.test.ts',
  'test/store/git-runner-stdin.test.ts',
  'test/store/invariants.test.ts',
  'test/store/large-records.test.ts',
  'test/store/materialisation.test.ts',
  'test/store/materialise-cost.test.ts',
  'test/store/materialise-in-place-guards.test.ts',
  'test/store/materialise-preserves-blob-bytes.test.ts',
  'test/store/materialise-refuses-dotgit-equivalents.test.ts',
  'test/store/materialise-refuses-escaping-entries.test.ts',
  'test/store/materialise-refuses-non-regular-entries.test.ts',
  'test/store/materialise-stays-within-plugin-data.test.ts',
  'test/store/open-cost.test.ts',
  'test/store/pointer.test.ts',
  'test/store/probe-decisions.test.ts',
  'test/store/read-path.test.ts',
  'test/store/records.test.ts',
  'test/store/resumable-cost.test.ts',
  'test/store/roster.test.ts',
  'test/store/single-store.test.ts',
  'test/store/write-cost.test.ts',
  'test/store/write-path.test.ts',
  'test/support/clone-fixture.ts',
  'test/support/counting-client.ts',
  'test/support/criterion-fixture.ts',
  'test/support/escape-indent-reproduction.ts',
  'test/support/local-docs.ts',
  'test/support/resources-fixture.ts',
  'test/support/schema-arbitrary.ts',
  'test/support/schema-nodes.ts',
  'test/support/settledness-census.ts',
  'test/sync/cas-retry.test.ts',
  'test/sync/conflict.test.ts',
  'test/sync/quiescence.test.ts',
  'test/sync/two-clones-spawn.test.ts',
  'test/sync/two-clones.test.ts',
  'test/unit/briefed-record.test.ts',
  'test/unit/briefing-handle.test.ts',
  'test/unit/briefing-hides-nothing.test.ts',
  'test/unit/briefing-line-breaks.test.ts',
  'test/unit/briefing-styling-cost.test.ts',
  'test/unit/briefing.test.ts',
  'test/unit/caps-census.test.ts',
  'test/unit/caps.test.ts',
  'test/unit/clip.test.ts',
  'test/unit/criteria.test.ts',
  'test/unit/decision-schema.test.ts',
  'test/unit/declare.test.ts',
  'test/unit/display-escape.test.ts',
  'test/unit/done-gate.test.ts',
  'test/unit/escape-indent-threshold.test.ts',
  'test/unit/escape-record.test.ts',
  'test/unit/escape.test.ts',
  'test/unit/field-class.test.ts',
  'test/unit/git-boundary.test.ts',
  'test/unit/goal-model-fields.test.ts',
  'test/unit/json-differences.test.ts',
  'test/unit/pointer.test.ts',
  'test/unit/project-key.test.ts',
  'test/unit/records.test.ts',
  'test/unit/refusal.test.ts',
  'test/unit/risk-identity.test.ts',
  'test/unit/roster.test.ts',
  'test/unit/session-log.test.ts',
  'test/unit/spine-next-step-records.test.ts',
  'test/unit/thread-schema-criterion-id.test.ts',
  'test/unit/thread-schema.test.ts'
]

const SCANNED_ROOTS: readonly string[] = ['bin', 'hooks', 'src', 'scripts', 'test']

const SCANNED_EXTENSIONS: readonly string[] = ['.ts', '.mjs']

const REMOVED_TOOL_NAMES: readonly string[] = ['amend_criteria', 'bind_branch', 'log_session_event', 'resolve_conflict']

type ImportSite = { file: string; line: number; specifier: string }

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(full)
    return entry.isFile() ? [full] : []
  })

const literalText = (node: ts.Node | undefined): string | null =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : null

const specifierOf = (node: ts.Node): string | null => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return literalText(node.moduleSpecifier)
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return literalText(node.moduleReference.expression)
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return literalText(node.argument.literal)
  if (ts.isCallExpression(node)) {
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
    return isImport || isRequire ? literalText(node.arguments[0]) : null
  }
  return null
}

const importSitesOf = (file: string): ImportSite[] => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): ImportSite[] => {
    const specifier = specifierOf(node)
    const own =
      specifier === null
        ? []
        : [{ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, specifier }]
    return [...own, ...node.getChildren(source).flatMap(visit)]
  }
  return visit(source)
}

const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../')

const withoutQuery = (specifier: string): string => specifier.replace(/[?#].*$/, '')

test('old-model.removed-paths-are-gone', () => {
  const present = REMOVED_PATHS.filter((path) => existsSync(join(REPO_ROOT, path)))
  assert.deepEqual(present, [], `these removed paths still exist: ${present.join(', ')}`)
})

test('old-model.nothing-imports-a-removed-module', () => {
  const files = SCANNED_ROOTS.flatMap((root) => {
    const dir = join(REPO_ROOT, root)
    return existsSync(dir) ? filesUnder(dir) : []
  }).filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)))
  assert.ok(files.length > 0, 'no .ts or .mjs file was found under bin, hooks, src, scripts or test')

  const sites = files.flatMap(importSitesOf).filter((site) => isRelative(site.specifier))
  assert.ok(sites.length > 0, 'no relative import specifier was found')

  const broken = sites
    .filter((site) => !existsSync(resolve(dirname(site.file), withoutQuery(site.specifier))))
    .map((site) => `${relative(REPO_ROOT, site.file)}:${site.line} imports ${site.specifier}, which does not exist`)
  assert.deepEqual(broken, [], broken.join('\n'))

  const removedTargets = sites
    .filter((site) => {
      const target = relative(REPO_ROOT, resolve(dirname(site.file), withoutQuery(site.specifier)))
      return REMOVED_PATHS.some((path) => target === path || target.startsWith(`${path}/`))
    })
    .map((site) => `${relative(REPO_ROOT, site.file)}:${site.line} imports the removed ${site.specifier}`)
  assert.deepEqual(removedTargets, [], removedTargets.join('\n'))
})

test('old-model.versions-say-0.16.0', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
  assert.equal(pkg.version, '0.16.0')

  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
    version?: unknown
    packages?: Record<string, { version?: unknown }>
  }
  assert.equal(lock.version, '0.16.0')
  assert.equal(lock.packages?.['']?.version, '0.16.0')

  const plugin = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(plugin.version, '0.16.0')
  assert.equal('userConfig' in plugin, false, '.claude-plugin/plugin.json still holds userConfig')
})

test('old-model.mutants-name-the-new-files', async () => {
  const specifier = '../../scripts/seeded-mutants.mjs'
  const script = (await import(specifier)) as { MUTANTS: readonly { file: string }[] }
  const files = script.MUTANTS.map((mutant) => mutant.file)
  assert.ok(files.includes('src/doc/check.ts'), `MUTANTS names no mutant of src/doc/check.ts: ${files.join(', ')}`)
  assert.ok(
    files.includes('src/doc/document.ts'),
    `MUTANTS names no mutant of src/doc/document.ts: ${files.join(', ')}`
  )
  const missing = files.filter((file) => !existsSync(join(REPO_ROOT, file)))
  assert.deepEqual(missing, [], `MUTANTS names files that do not exist: ${missing.join(', ')}`)
})

test('old-model.readme-describes-the-state-document', () => {
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8')
  for (const phrase of ['state document', 'refs/logbook/threads', '~/.logbook/', 'sync_ledger', 'pushed to origin']) {
    assert.ok(readme.includes(phrase), `README.md does not hold "${phrase}"`)
  }
  const named = REMOVED_TOOL_NAMES.filter((name) => readme.includes(name))
  assert.deepEqual(named, [], `README.md names removed tools: ${named.join(', ')}`)
})
