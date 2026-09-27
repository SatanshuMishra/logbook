import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const EVALS_ROOT = fileURLToPath(new URL('../../evals', import.meta.url))
const PROOF_TAG = 'proof'
const PROOF_CASES = [
  'handoff',
  'helper',
  'helper-read-only',
  'no-thread-edit',
  'nothing-applies',
  'resume-detail',
  'step-change-names-file',
  'step-change-no-file'
]
const LEDGER_REF = 'refs/logbook/ledger'
const SCAFFOLD_LOCATOR = 'dirname "$0"'
const BUNDLE_FILE = 'fixture.bundle'
const BRIEFING_GRADER = path.join(EVALS_ROOT, 'nothing-applies', 'graders', 'no-unrelated-ruling-in-the-briefing.md')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const frontmatterOf = (file: string): Record<string, unknown> => {
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(readFileSync(file, 'utf8'))
  assert.ok(block !== null, `${file}: no frontmatter between --- lines`)
  const parsed: unknown = parseYaml(block[1] ?? '')
  assert.ok(isPlainObject(parsed), `${file}: frontmatter did not parse to a YAML mapping`)
  return parsed
}

const isProofCase = (caseName: string): boolean => {
  const casePath = path.join(EVALS_ROOT, caseName, 'case.yaml')
  if (!existsSync(casePath)) return false
  const parsed: unknown = parseYaml(readFileSync(casePath, 'utf8'))
  return isPlainObject(parsed) && Array.isArray(parsed.tags) && parsed.tags.includes(PROOF_TAG)
}

const bundleHeads = (bundlePath: string): string[] =>
  execFileSync('git', ['bundle', 'list-heads', bundlePath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.split(' ')[1])
    .filter((ref): ref is string => ref !== undefined)

const RULING_LINE =
  '- decision 01M3J81C2TD0R2F1YXWHJSDX24: Keep HTTP_TIMEOUT_MS in src/config.ts at or below 3000. It may go higher only after the platform team raises the upstream timeout on lb-pay-2.'
const CRITERION_LINE = '- criterion 01M3J81CEHFT6SZYXGG8NH8N7S: c1 [open] [proposed] The README explains retries.'

const briefingWith = (stepNeeds: string[], otherRecords: string[]): string =>
  [
    '# Your Preflight Briefing',
    '',
    '**Thread:** Refresh the service README',
    '**Status:** open',
    '',
    '**Next step:**',
    '',
    '> Add a section to README.md explaining how charge() in src/payments/charge.ts retries failed gateway calls.',
    '',
    '**What this step needs:**',
    '',
    ...stepNeeds,
    '',
    '**Other records on this thread** (one line each; name one in a next step to see it in full):',
    '',
    ...otherRecords,
    '',
    '**Session log:** 0 entries'
  ].join('\n')

const asTraceHoldsIt = (briefing: string): string => JSON.stringify({ type: 'tool_result', content: { briefing } })

test('proof-suite.eight-proof-cases-each-load-a-bundle-beside-their-scaffold', () => {
  const tagged = readdirSync(EVALS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isProofCase(entry.name))
    .map((entry) => entry.name)
    .sort()
  assert.deepEqual(tagged, PROOF_CASES, `evals/ must hold exactly the eight proof cases, found ${JSON.stringify(tagged)}`)

  for (const caseName of PROOF_CASES) {
    const caseDir = path.join(EVALS_ROOT, caseName)
    assert.ok(existsSync(path.join(caseDir, 'prompt.md')), `evals/${caseName}: prompt.md is missing`)
    const graders = existsSync(path.join(caseDir, 'graders'))
      ? readdirSync(path.join(caseDir, 'graders')).filter((name) => name.endsWith('.md'))
      : []
    assert.ok(graders.length > 0, `evals/${caseName}: no graders/*.md`)
    const scaffoldPath = path.join(caseDir, 'scaffold.sh')
    assert.ok(existsSync(scaffoldPath), `evals/${caseName}: scaffold.sh is missing`)
    const scaffold = readFileSync(scaffoldPath, 'utf8')
    assert.ok(scaffold.includes(SCAFFOLD_LOCATOR), `evals/${caseName}/scaffold.sh does not find its bundle through ${SCAFFOLD_LOCATOR}`)
    assert.ok(scaffold.includes(BUNDLE_FILE), `evals/${caseName}/scaffold.sh does not load ${BUNDLE_FILE}`)
    const bundlePath = path.join(caseDir, BUNDLE_FILE)
    assert.ok(existsSync(bundlePath), `evals/${caseName}: ${BUNDLE_FILE} is missing`)
    assert.ok(
      bundleHeads(bundlePath).includes(LEDGER_REF),
      `evals/${caseName}/${BUNDLE_FILE}: git bundle list-heads does not list ${LEDGER_REF}`
    )
  }

  assert.ok(existsSync(BRIEFING_GRADER), `${BRIEFING_GRADER} is missing`)
  const grader = frontmatterOf(BRIEFING_GRADER)
  assert.equal(grader.match, 'not_contains', `${BRIEFING_GRADER}: match must be not_contains`)
  assert.equal(grader.flags, 's', `${BRIEFING_GRADER}: flags must be s`)
  assert.equal(typeof grader.pattern, 'string', `${BRIEFING_GRADER}: pattern must be a string`)
  const unrelatedRuling = new RegExp(String(grader.pattern), String(grader.flags))

  const violation = briefingWith([RULING_LINE], [CRITERION_LINE])
  const clean = briefingWith(['This step names no records.'], [CRITERION_LINE, RULING_LINE])
  assert.ok(unrelatedRuling.test(violation), 'the grader misses the ruling shown under "What this step needs" with real line breaks')
  assert.ok(
    unrelatedRuling.test(asTraceHoldsIt(violation)),
    'the grader misses the ruling shown under "What this step needs" with escaped \\n sequences'
  )
  assert.ok(!unrelatedRuling.test(clean), 'the grader flags a ruling shown only under "Other records on this thread" with real line breaks')
  assert.ok(
    !unrelatedRuling.test(asTraceHoldsIt(clean)),
    'the grader flags a ruling shown only under "Other records on this thread" with escaped \\n sequences'
  )
})
