import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SMALL_LEDGER = 100
const LARGE_LEDGER = 3000
const TIMED_WRITES = 5
const SEED_BATCH = 200
const GROWTH_FACTOR = 3
const ABSOLUTE_CEILING_MS = 1000
const MEASUREMENT_RUNS = 2

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-write-cost-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const rawRecord = (serial: number): RecordChange => ({
  kind: 'raw',
  relPath: `decisions/write-cost-${serial}.json`,
  content: JSON.stringify({ serial, text: `synthetic record ${serial}` })
})

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

const measureOnce = (): { small: number; large: number } =>
  withRepo((repo) =>
    withPluginData((pluginData) => {
      const rt: Runtime = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) throw new Error('store did not open')
      const store = opened.value
      let serial = 0
      let held = 0

      const seedTo = (target: number): void => {
        while (held < target) {
          const batch: RecordChange[] = []
          const size = Math.min(SEED_BATCH, target - held)
          for (let index = 0; index < size; index += 1) {
            batch.push(rawRecord(serial))
            serial += 1
          }
          const committed = store.commit(batch, `seed ${size} records`)
          assert.equal(committed.ok, true)
          held += size
        }
      }

      const timeWrites = (): number => {
        const samples: number[] = []
        for (let index = 0; index < TIMED_WRITES; index += 1) {
          const change = rawRecord(serial)
          serial += 1
          const started = performance.now()
          const committed = store.commit([change], 'timed write')
          const elapsed = performance.now() - started
          assert.equal(committed.ok, true)
          held += 1
          samples.push(elapsed)
        }
        return median(samples)
      }

      seedTo(SMALL_LEDGER)
      const small = timeWrites()
      seedTo(LARGE_LEDGER)
      const large = timeWrites()
      return { small, large }
    })
  )

test('store.unchanged-one-write-stays-bounded-as-the-ledger-grows', () => {
  for (let run = 0; run < MEASUREMENT_RUNS; run += 1) {
    const { small, large } = measureOnce()
    assert.equal(
      large <= small * GROWTH_FACTOR,
      true,
      `run ${run}: median write at ${LARGE_LEDGER} records was ${large.toFixed(1)} ms, above ${GROWTH_FACTOR} times the ${small.toFixed(1)} ms median at ${SMALL_LEDGER} records`
    )
    assert.equal(
      large < ABSOLUTE_CEILING_MS,
      true,
      `run ${run}: median write at ${LARGE_LEDGER} records was ${large.toFixed(1)} ms, not under ${ABSOLUTE_CEILING_MS} ms`
    )
  }
})
