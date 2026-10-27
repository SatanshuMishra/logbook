import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPOSITORY_ROOT, readSourceRecord } from '../../support/metrics-source.ts'


const environmentWithoutMetrics = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== 'PLUGIN_METRICS_DIR' && name !== 'PLUGIN_METRICS_PARENT')
  )

test('metrics.writer-conforms-to-shared-fixtures', () => {
  const outputFolder = mkdtempSync(path.join(os.tmpdir(), 'logbook-metrics-conform-'))
  try {
    const result = spawnSync(
      process.execPath,
      ['metrics/conform.ts', 'metrics/fixtures/cases.json', outputFolder],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8', env: environmentWithoutMetrics() }
    )
    assert.equal(result.status, 0, result.stderr)
    const expected: unknown = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, 'metrics/fixtures/expected.json'), 'utf8'))
    assert.deepEqual(JSON.parse(result.stdout), expected)
  } finally {
    rmSync(outputFolder, { recursive: true, force: true })
  }
})

test('metrics.source-names-every-copy', () => {
  const source = readSourceRecord()
  assert.equal(source.repository, 'SatanshuMishra/pipeline')
  assert.ok(source.ref === 'origin/main' || source.ref === 'origin/feat/unified-metrics', source.ref)
  assert.match(source.commit, /^[0-9a-f]{40}$/)
  assert.deepEqual(
    Object.keys(source.files).sort(),
    [
      'metrics/metrics-writer.ts',
      'metrics/conform.ts',
      'metrics/fixtures/cases.json',
      'metrics/fixtures/expected.json',
      'metrics/schema/line.schema.json',
      'metrics/schema/catalogue.schema.json',
      'metrics/metrics-format.md'
    ].sort()
  )
  assert.equal(source.files['metrics/metrics-writer.ts']?.from, 'metrics/metrics-writer.ts')
  assert.equal(source.files['metrics/conform.ts']?.from, 'metrics/conform.ts')
  assert.equal(source.files['metrics/fixtures/cases.json']?.from, 'metrics/fixtures/cases.json')
  assert.equal(source.files['metrics/fixtures/expected.json']?.from, 'metrics/fixtures/expected.json')
  assert.equal(source.files['metrics/schema/line.schema.json']?.from, 'metrics/schema/line.schema.json')
  assert.equal(source.files['metrics/schema/catalogue.schema.json']?.from, 'metrics/schema/catalogue.schema.json')
  assert.equal(source.files['metrics/metrics-format.md']?.from, 'docs/metrics-format.md')
})

test('metrics.copies-match-recorded-hashes', () => {
  const source = readSourceRecord()
  const mismatched = Object.entries(source.files)
    .map(([file, entry]) => ({
      file,
      recorded: entry.sha256,
      actual: createHash('sha256').update(readFileSync(path.join(REPOSITORY_ROOT, file))).digest('hex')
    }))
    .filter(({ recorded, actual }) => recorded !== actual)
  assert.deepEqual(mismatched, [])
})
