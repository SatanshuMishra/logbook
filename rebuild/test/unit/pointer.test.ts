import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readPointer, writePointer, releasePointer, releasePointerIfOwned } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo, rawGit } from '../support/git-fixture.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-pointer-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
}

const pointerFileName = 'active-thread.json'

test('pointer.write-is-idempotent', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const threadId = rt.ulid()
      const first = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a' }
      writePointer(rt, layout, first)
      const afterFirst = readdirSync(layout.state).filter((name) => name === pointerFileName)
      assert.deepEqual(afterFirst, [pointerFileName])

      const second = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a' }
      assert.notEqual(first.written_at, second.written_at)
      writePointer(rt, layout, second)
      const afterSecond = readdirSync(layout.state).filter((name) => name === pointerFileName)
      assert.deepEqual(afterSecond, [pointerFileName])

      const result = readPointer(rt, layout)
      assert.deepEqual(result, second)
    })
  })
})

test('pointer.release-is-idempotent', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      assert.doesNotThrow(() => releasePointer(rt, layout))
      assert.equal(readPointer(rt, layout), null)

      writePointer(rt, layout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-b' })
      assert.notEqual(readPointer(rt, layout), null)

      assert.doesNotThrow(() => releasePointer(rt, layout))
      assert.equal(readPointer(rt, layout), null)
      assert.doesNotThrow(() => releasePointer(rt, layout))
      assert.equal(readPointer(rt, layout), null)
    })
  })
})

test('pointer.release-only-own', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      assert.equal(releasePointerIfOwned(rt, layout, rt.ulid()), 'already-clear')

      const owner = rt.ulid()
      const other = rt.ulid()
      const original = { thread_id: owner, written_at: rt.now(), session_id: 'session-c' }
      writePointer(rt, layout, original)

      const outcome = releasePointerIfOwned(rt, layout, other)
      assert.equal(outcome, 'not-owned')
      assert.deepEqual(readPointer(rt, layout), original)

      const ownedOutcome = releasePointerIfOwned(rt, layout, owner)
      assert.equal(ownedOutcome, 'released')
      assert.equal(readPointer(rt, layout), null)
    })
  })
})

test('pointer.survives-nothing', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const sourceLayout = layoutIn(rt, repo)
      writePointer(rt, sourceLayout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-d' })
      assert.notEqual(readPointer(rt, sourceLayout), null)

      const cloneParent = mkdtempSync(join(tmpdir(), 'logbook-pointer-clone-'))
      const clonePath = join(cloneParent, 'clone')
      try {
        const clone = rawGit(repo, ['clone', repo, clonePath])
        assert.equal(clone.status, 0)

        const cloneLayout = layoutIn(rt, clonePath)
        assert.notEqual(cloneLayout.root, sourceLayout.root)
        assert.equal(readPointer(rt, cloneLayout), null)
      } finally {
        rmSync(cloneParent, { recursive: true, force: true })
      }
    })
  })
})

test('pointer.unparseable-file-raises-instead-of-returning-null', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      writeFileSync(join(layout.state, pointerFileName), 'not-json{{{', 'utf8')

      assert.throws(() => readPointer(rt, layout))
    })
  })
})
