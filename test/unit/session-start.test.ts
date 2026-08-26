import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { renderThreadListing } from '../../src/cli/session-start.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-session-start-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: 'a session start thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'write the next test',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const seededListing = (slug: string, fn: (listing: string) => void): void => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const committed = opened.value.commit([makeThread(rt, slug)], `seed one open thread for ${slug}`)
      assert.equal(committed.ok, true)
      fn(renderThreadListing(rt, repo))
    })
  })
}

test('session-start.roster-line-carries-no-status-token', () => {
  seededListing('session-start-no-token', (listing) => {
    const threadLines = listing.split('\n').filter((line) => line.startsWith('- '))
    assert.equal(threadLines.length, 1, `expected exactly one thread line, got: ${listing}`)
    const threadLine = threadLines[0] as string
    assert.equal(
      threadLine.includes('[open]'),
      false,
      `the roster line still carries the constant status token: ${threadLine}`
    )
    assert.doesNotMatch(
      threadLine,
      /^- \[[^\]]*\]/,
      `the roster line still opens with a bracketed status token: ${threadLine}`
    )
  })
})

test('session-start.roster-line-still-carries-slug-title-next-step-and-id', () => {
  seededListing('session-start-fields', (listing) => {
    const threadLines = listing.split('\n').filter((line) => line.startsWith('- '))
    assert.equal(threadLines.length, 1, `expected exactly one thread line, got: ${listing}`)
    const threadLine = threadLines[0] as string
    assert.ok(threadLine.startsWith('- session-start-fields: '), threadLine)
    assert.ok(threadLine.includes('a session start thread'), threadLine)
    assert.ok(threadLine.includes('-- next: write the next test'), threadLine)
    assert.match(threadLine, /\(id [0-9A-HJKMNP-TV-Z]{26}\)$/, threadLine)
  })
})
