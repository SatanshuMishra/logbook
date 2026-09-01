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
const ABSENT = { kind: 'absent' } as const

test('pointer.write-is-idempotent', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const threadId = rt.ulid()
      const first = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a', focus: [] }
      writePointer(rt, layout, first)
      const afterFirst = readdirSync(layout.state)
      assert.deepEqual(afterFirst, [pointerFileName])

      const second = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a', focus: [] }
      assert.notEqual(first.written_at, second.written_at)
      writePointer(rt, layout, second)
      const afterSecond = readdirSync(layout.state)
      assert.deepEqual(afterSecond, [pointerFileName])

      const result = readPointer(rt, layout)
      assert.deepEqual(result, { kind: 'pointer', value: second })
    })
  })
})

test('pointer.release-is-idempotent', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      assert.doesNotThrow(() => releasePointer(rt, layout))
      assert.deepEqual(readPointer(rt, layout), ABSENT)

      writePointer(rt, layout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-b', focus: [] })
      assert.notDeepEqual(readPointer(rt, layout), ABSENT)

      assert.doesNotThrow(() => releasePointer(rt, layout))
      assert.deepEqual(readPointer(rt, layout), ABSENT)
      assert.doesNotThrow(() => releasePointer(rt, layout))
      assert.deepEqual(readPointer(rt, layout), ABSENT)
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
      const original = { thread_id: owner, written_at: rt.now(), session_id: 'session-c', focus: [] }
      writePointer(rt, layout, original)

      const outcome = releasePointerIfOwned(rt, layout, other)
      assert.equal(outcome, 'not-owned')
      assert.deepEqual(readPointer(rt, layout), { kind: 'pointer', value: original })

      const ownedOutcome = releasePointerIfOwned(rt, layout, owner)
      assert.equal(ownedOutcome, 'released')
      assert.deepEqual(readPointer(rt, layout), ABSENT)
    })
  })
})

test('pointer.survives-nothing', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const sourceLayout = layoutIn(rt, repo)
      writePointer(rt, sourceLayout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-d', focus: [] })
      assert.notDeepEqual(readPointer(rt, sourceLayout), ABSENT)

      const cloneParent = mkdtempSync(join(tmpdir(), 'logbook-pointer-clone-'))
      const clonePath = join(cloneParent, 'clone')
      try {
        const clone = rawGit(repo, ['clone', repo, clonePath])
        assert.equal(clone.status, 0)

        const cloneLayout = layoutIn(rt, clonePath)
        assert.notEqual(cloneLayout.root, sourceLayout.root)
        assert.deepEqual(readPointer(rt, cloneLayout), ABSENT)
      } finally {
        rmSync(cloneParent, { recursive: true, force: true })
      }
    })
  })
})

test('pointer.unparseable-file-reports-corrupt', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      writeFileSync(join(layout.state, pointerFileName), 'not-json{{{', 'utf8')

      const result = readPointer(rt, layout)
      assert.equal(result.kind, 'corrupt')
      if (result.kind !== 'corrupt') return
      assert.ok(result.reason.length > 0)
      assert.doesNotMatch(result.reason, /[\\/]/, 'the corrupt reason must not leak a filesystem path')
    })
  })
})

test('pointer.wrong-shape-json-reports-corrupt', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      writeFileSync(join(layout.state, pointerFileName), JSON.stringify({ thread_id: 'nope' }), 'utf8')

      const result = readPointer(rt, layout)
      assert.equal(result.kind, 'corrupt')
      if (result.kind !== 'corrupt') return
      assert.ok(result.reason.length > 0)
      assert.doesNotMatch(result.reason, /[\\/]/, 'the corrupt reason must not leak a filesystem path')
    })
  })
})

test('pointer.focus-round-trips', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const focus = [rt.ulid(), rt.ulid()]
      const written = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-focus', focus }
      writePointer(rt, layout, written)

      const result = readPointer(rt, layout)
      assert.deepEqual(result, { kind: 'pointer', value: written })
    })
  })
})

test('pointer.reads-forward-a-pointer-file-with-no-focus-key', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      const threadId = rt.ulid()
      const writtenAt = rt.now()
      writeFileSync(
        join(layout.state, pointerFileName),
        JSON.stringify({ thread_id: threadId, written_at: writtenAt, session_id: 'session-pre-focus' }),
        'utf8'
      )

      const result = readPointer(rt, layout)
      assert.deepEqual(result, {
        kind: 'pointer',
        value: { thread_id: threadId, written_at: writtenAt, session_id: 'session-pre-focus', focus: [] }
      })
    })
  })
})

test('pointer.malformed-focus-reports-corrupt', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      writeFileSync(
        join(layout.state, pointerFileName),
        JSON.stringify({ thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-bad-focus', focus: ['not-a-ulid'] }),
        'utf8'
      )

      const result = readPointer(rt, layout)
      assert.equal(result.kind, 'corrupt')
      if (result.kind !== 'corrupt') return
      assert.ok(result.reason.length > 0)
      assert.doesNotMatch(result.reason, /[\\/]/, 'the corrupt reason must not leak a filesystem path')
    })
  })
})
