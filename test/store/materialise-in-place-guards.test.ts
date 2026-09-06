import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { isDurableWriteTempPath } from '../../src/store/durable-write.ts'
import {
  pruneRecordsAbsentFromRef,
  verifyMaterialisedNamesRoundTrip
} from '../../src/store/materialise-in-place.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const STAMP_FILE_NAME = 'last-materialised'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(path.join(tmpdir(), 'logbook-in-place-guards-plugin-data-'))
  const dir = path.join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const withScratchDir = <T>(prefix: string, fn: (dir: string) => T): T => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true, 'fixture could not compute the store layout')
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      landed: '',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const forceNextOpenToMaterialise = (layout: StoreLayout): void => {
  rmSync(path.join(layout.state, STAMP_FILE_NAME), { force: true })
}

const gitStdout = (rt: Runtime, repo: string, args: string[], stdin?: string): string => {
  const result = git(rt, repo, args, stdin === undefined ? {} : { stdin })
  assert.equal(result.ok, true, `fixture could not run git ${args.join(' ')}`)
  if (!result.ok) throw new Error('unreachable')
  return result.stdout.trim()
}

const listTreePaths = (rt: Runtime, repo: string, ref: string): string[] =>
  gitStdout(rt, repo, ['ls-tree', '-r', '--name-only', ref])
    .split('\n')
    .filter((line) => line.length > 0)
    .sort()

const listRecordPaths = (root: string): string[] => {
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const relPath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? walk(path.join(dir, entry.name), relPath) : [relPath]
    })
  return walk(root, '').sort()
}

const readRecordsTree = (root: string): Record<string, string> =>
  Object.fromEntries(listRecordPaths(root).map((relPath) => [relPath, readFileSync(path.join(root, relPath), 'utf8')]))

const seedOneThread = (
  rt: Runtime,
  repo: string,
  slug: string
): Extract<RecordChange, { kind: 'thread' }> => {
  const seeded = openStore(rt, repo)
  assert.equal(seeded.ok, true, 'fixture could not open the store to seed it')
  if (!seeded.ok) throw new Error('unreachable')
  const thread = makeThread(rt, slug)
  const committed = seeded.value.commit([thread], `seed ${slug}`)
  assert.equal(committed.ok, true, 'fixture could not commit the seed thread')
  return thread
}

test('store.a-durable-write-temp-file-in-the-records-tree-survives-a-re-materialisation', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seed = seedOneThread(rt, repo, 'temp-file-bystander')
      const layout = layoutIn(rt, repo)

      const tempName = `${seed.record.id}.json.durable-write-9f1c4b7e2a.tmp`
      assert.equal(
        isDurableWriteTempPath(tempName),
        true,
        `the fixture name ${tempName} must match the predicate the store uses to recognise its own in-flight writes`
      )
      const tempPath = path.join(layout.records, 'threads', tempName)
      writeFileSync(tempPath, '{"partial":"an in-flight durable write"}', 'utf8')

      forceNextOpenToMaterialise(layout)

      const opened = openStore(runtimeWithHome(pluginData), repo)
      assert.equal(opened.ok, true, 're-materialising over a seeded store must still open it')

      assert.equal(
        existsSync(tempPath),
        true,
        `a durable-write temp file belonging to another writer must survive materialisation; ${tempPath} was removed, and the records tree now holds ${JSON.stringify(listRecordPaths(layout.records))}`
      )
      assert.equal(
        existsSync(path.join(layout.records, 'threads', `${seed.record.id}.json`)),
        true,
        'the seeded record must still be on disk after the re-materialisation'
      )
    })
  })
})

test('store.a-record-absent-from-the-ledger-ref-is-removed-from-the-records-tree', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seed = seedOneThread(rt, repo, 'stray-record-neighbour')
      const layout = layoutIn(rt, repo)

      const stray = makeThread(rt, 'stray-record')
      const strayPath = path.join(layout.records, 'threads', `${stray.record.id}.json`)
      writeFileSync(strayPath, JSON.stringify(stray.record), 'utf8')

      forceNextOpenToMaterialise(layout)

      const opened = openStore(runtimeWithHome(pluginData), repo)
      assert.equal(opened.ok, true, 're-materialising over a seeded store must still open it')

      assert.equal(
        existsSync(strayPath),
        false,
        `a record the ledger ref does not carry must not survive materialisation; ${strayPath} is still on disk, and the records tree holds ${JSON.stringify(listRecordPaths(layout.records))}`
      )
      assert.equal(
        existsSync(path.join(layout.records, 'threads', `${seed.record.id}.json`)),
        true,
        'pruning the stray record must not take the seeded record with it'
      )
    })
  })
})

test('store.a-record-the-prune-deletes-is-named-in-the-log-the-materialisation-leaves', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      seedOneThread(rt, repo, 'pruned-record-log-neighbour')
      const layout = layoutIn(rt, repo)

      const stray = makeThread(rt, 'pruned-record-log-subject')
      const strayRelPath = `threads/${stray.record.id}.json`
      writeFileSync(path.join(layout.records, strayRelPath), JSON.stringify(stray.record), 'utf8')

      forceNextOpenToMaterialise(layout)

      const logged: Record<string, unknown>[] = []
      const openingRt: Runtime = {
        ...runtimeWithHome(pluginData),
        log: (record) => {
          logged.push(record)
        }
      }

      const opened = openStore(openingRt, repo)
      assert.equal(opened.ok, true, 're-materialising over a seeded store must still open it')

      const pruneLogs = logged.filter((record) => record.event === 'store.materialise-prune-removed')
      assert.equal(
        pruneLogs.length,
        1,
        `a prune that deletes a record must leave exactly one log naming what it removed; the open logged ${JSON.stringify(logged.map((record) => record.event))}`
      )

      const pruneLog = pruneLogs[0] as Record<string, unknown>
      assert.deepEqual(
        pruneLog.removed,
        [strayRelPath],
        `the prune log must name every record path it deleted, but it carried ${JSON.stringify(pruneLog.removed)}`
      )
      assert.equal(pruneLog.removed_count, 1, 'the prune log must carry the number of records it deleted')
      assert.equal(pruneLog.records, layout.records, 'the prune log must name the records tree it deleted from')
      assert.equal(
        pruneLog.ref,
        gitStdout(rt, repo, ['rev-parse', LEDGER_REF]),
        'the prune log must name the ledger commit the deletion was justified against'
      )
      assert.equal(pruneLog.level, 'warn', 'a destructive step must be logged at a level an operator reads')

      assert.equal(
        existsSync(path.join(layout.records, strayRelPath)),
        false,
        'the fixture requires the logged record to have genuinely been deleted'
      )
    })
  })
})

test('store.a-stale-record-the-filesystem-will-not-let-go-refuses-the-open-and-invites-no-retry', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seed = seedOneThread(rt, repo, 'undeletable-stale-record-neighbour')
      const layout = layoutIn(rt, repo)

      const threadsDir = path.join(layout.records, 'threads')
      const stray = makeThread(rt, 'undeletable-stale-record')
      const strayPath = path.join(threadsDir, `${stray.record.id}.json`)
      writeFileSync(strayPath, JSON.stringify(stray.record), 'utf8')

      forceNextOpenToMaterialise(layout)
      chmodSync(threadsDir, 0o555)
      try {
        const opened = openStore(runtimeWithHome(pluginData), repo)

        assert.equal(
          opened.ok,
          false,
          `a records tree still holding a record the ledger ref dropped disagrees with the ref, so the open must be refused; it succeeded and the tree holds ${JSON.stringify(listRecordPaths(layout.records))}`
        )
        if (opened.ok) return

        assert.equal(
          opened.retryable,
          false,
          'a deletion the filesystem forbids fails identically on every repeat, so the refusal must not invite one'
        )
        assert.match(
          opened.message,
          /could not be deleted/,
          `the refusal must name the deletion that failed, but the message read: ${opened.message}`
        )
        assert.doesNotMatch(
          opened.message,
          /did not materialise/,
          `a record that could not be deleted must not be reported as the unrelated case of a ref holding records that were never written, but the message read: ${opened.message}`
        )
        assert.notEqual(
          opened.example,
          'git rev-parse refs/logbook/ledger',
          'the refusal must offer a remedy for the deletion that failed, not a command that only reads the ledger ref'
        )

        assert.equal(
          existsSync(strayPath),
          true,
          'a refused open must leave the records tree exactly as it found it'
        )
        assert.equal(
          existsSync(path.join(threadsDir, `${seed.record.id}.json`)),
          true,
          'the refusal must not have taken the seeded record with it'
        )
      } finally {
        chmodSync(threadsDir, 0o755)
      }
    })
  })
})

test('store.a-record-that-appears-on-disk-after-the-prune-listed-the-tree-is-not-deleted', () => {
  withScratchDir('logbook-in-place-guards-prune-ordering-', (records) => {
    const ref = '4f3a1c9e0b7d2568a1f0c3d4e5b6a7980c1d2e3f'
    const carriedRelPath = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json'
    const staleRelPath = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAW.json'
    const arrivingRelPath = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAX.json'

    mkdirSync(path.join(records, 'threads'))
    writeFileSync(path.join(records, carriedRelPath), '{"marker":"a record the ledger ref carries"}', 'utf8')
    writeFileSync(path.join(records, staleRelPath), '{"marker":"a record the ledger ref dropped"}', 'utf8')

    let refReads = 0
    const readObservedRef = (): string => {
      refReads += 1
      writeFileSync(
        path.join(records, arrivingRelPath),
        '{"marker":"a peer record already committed to the ledger ref and only then written to disk"}',
        'utf8'
      )
      return ref
    }

    const outcome = pruneRecordsAbsentFromRef(testRuntime(), records, ref, [carriedRelPath], readObservedRef)

    assert.equal(
      refReads,
      1,
      `the prune must re-read the ledger ref exactly once to justify its deletions, but it read the ref ${refReads} times`
    )
    assert.equal(
      outcome.ok,
      true,
      `a prune that observes the ref it was given must complete, but it reported: ${outcome.ok ? '' : outcome.detail}`
    )
    assert.equal(
      existsSync(path.join(records, staleRelPath)),
      false,
      `the fixture requires the delete loop to have genuinely run, so a record on disk before the call and absent from the ledger ref must be gone; the records tree holds ${JSON.stringify(listRecordPaths(records))}`
    )
    assert.equal(
      existsSync(path.join(records, arrivingRelPath)),
      true,
      `a writer commits to the ledger ref before it writes the file, so a record that appears on disk after the tree was listed is already carried by the ref this prune observed; the prune read the ref before it listed the tree and deleted ${arrivingRelPath}, leaving ${JSON.stringify(listRecordPaths(records))}`
    )
    assert.equal(
      existsSync(path.join(records, carriedRelPath)),
      true,
      'a record the ledger ref carries must survive the prune'
    )
  })
})

test('store.a-record-name-the-filesystem-folded-is-reported-as-a-name-round-trip-failure', () => {
  withScratchDir('logbook-in-place-guards-round-trip-', (records) => {
    const carriedName = '01ARZ3NDEKTSV4RRFFQ69G5FAV.json'
    const foldedName = '01arz3ndektsv4rrffq69g5fav.json'
    mkdirSync(path.join(records, 'threads'))
    writeFileSync(path.join(records, 'threads', foldedName), '{"marker":"the bytes under the folded name"}', 'utf8')

    const outcome = verifyMaterialisedNamesRoundTrip(records, LEDGER_REF, [`threads/${carriedName}`])

    assert.equal(
      outcome.ok,
      false,
      `a name the ledger ref carries that no directory entry matches exactly must be reported, but the sweep passed over ${JSON.stringify(readdirSync(path.join(records, 'threads')))}`
    )
    if (outcome.ok) return

    assert.equal(
      outcome.cause,
      'name-round-trip',
      'a folded record name is its own permanent cause, not the generic materialisation failure'
    )
    assert.match(
      outcome.detail,
      new RegExp(carriedName.replace('.', '\\.')),
      `the detail must name the record the ledger ref carries, but it read: ${outcome.detail}`
    )
    assert.match(
      outcome.detail,
      /different record's bytes/,
      `the detail must name the dangerous artefact, which is the file left under the folded name carrying another record, but it read: ${outcome.detail}`
    )
    assert.match(
      outcome.detail,
      /structurally valid record/,
      `the detail must say those wrong bytes read back as a valid record, which is why the collision is silent, but it read: ${outcome.detail}`
    )
  })
})

test('store.a-symlinked-records-directory-is-refused-and-its-target-survives', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      withScratchDir('logbook-in-place-guards-symlink-target-', (scratch) => {
        const rt = runtimeWithHome(pluginData)
        seedOneThread(rt, repo, 'symlinked-records-directory')
        const layout = layoutIn(rt, repo)

        const target = path.join(scratch, 'elsewhere')
        mkdirSync(target)
        const sentinelPath = path.join(target, 'sentinel.txt')
        writeFileSync(sentinelPath, 'a file that has nothing to do with the ledger\n', 'utf8')

        rmSync(layout.records, { recursive: true, force: true })
        symlinkSync(target, layout.records)

        forceNextOpenToMaterialise(layout)

        const opened = openStore(runtimeWithHome(pluginData), repo)

        assert.equal(
          opened.ok,
          false,
          `a records directory that is a symbolic link points materialisation at a tree the store does not own, so the open must be refused; it succeeded and the link target now holds ${JSON.stringify(readdirSync(target))}`
        )
        assert.equal(
          existsSync(sentinelPath),
          true,
          `a refused open must leave the link target untouched; ${sentinelPath} was removed, and the target now holds ${JSON.stringify(readdirSync(target))}`
        )
      })
    })
  })
})

test('store.a-record-path-that-becomes-a-directory-in-a-later-commit-still-opens', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seed = seedOneThread(rt, repo, 'blob-then-directory')
      const layout = layoutIn(rt, repo)

      const collidingRelPath = `threads/${seed.record.id}.json`
      assert.deepEqual(
        listTreePaths(rt, repo, LEDGER_REF),
        [collidingRelPath],
        'the fixture requires the seeded ref to carry exactly the path the next commit turns into a directory'
      )
      assert.equal(
        existsSync(path.join(layout.records, collidingRelPath)),
        true,
        'the fixture requires the seeded record to be materialised as a file before the ref moves'
      )

      const nestedBlob = gitStdout(rt, repo, ['hash-object', '-w', '--stdin'], '{"nested":"under a former blob"}\n')
      const nestedTree = gitStdout(rt, repo, ['mktree'], `100644 blob ${nestedBlob}\tnested.json\n`)
      const collidingTree = gitStdout(rt, repo, ['mktree'], `040000 tree ${nestedTree}\t${seed.record.id}.json\n`)
      const rootTree = gitStdout(rt, repo, ['mktree'], `040000 tree ${collidingTree}\tthreads\n`)
      const parent = gitStdout(rt, repo, ['rev-parse', LEDGER_REF])
      const nextCommit = gitStdout(rt, repo, [
        'commit-tree',
        rootTree,
        '-p',
        parent,
        '-m',
        'turn a record path into a directory'
      ])
      gitStdout(rt, repo, ['update-ref', LEDGER_REF, nextCommit, parent])

      const nestedRelPath = `${collidingRelPath}/nested.json`
      assert.deepEqual(
        listTreePaths(rt, repo, LEDGER_REF),
        [nestedRelPath],
        'the fixture requires the moved ref to carry a blob nested under the former record path'
      )

      forceNextOpenToMaterialise(layout)

      const opened = openStore(runtimeWithHome(pluginData), repo)
      assert.equal(
        opened.ok,
        true,
        `a ledger ref that turns a record path into a directory must still open; the refusal was: ${opened.ok ? '' : opened.message}`
      )
      if (!opened.ok) return

      assert.deepEqual(
        listRecordPaths(layout.records),
        [nestedRelPath],
        'a store that opened after the type collision must hold exactly the paths its ledger ref carries'
      )
    })
  })
})

test('store.a-ref-path-that-cannot-round-trip-through-the-filesystem-is-not-silently-dropped', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const upperName = '01ARZ3NDEKTSV4RRFFQ69G5FAV.json'
      const lowerName = '01arz3ndektsv4rrffq69g5fav.json'
      const upperContent = '{"marker":"the upper-case name"}\n'
      const lowerContent = '{"marker":"the lower-case name"}\n'

      const upperBlob = gitStdout(rt, repo, ['hash-object', '-w', '--stdin'], upperContent)
      const lowerBlob = gitStdout(rt, repo, ['hash-object', '-w', '--stdin'], lowerContent)
      const threadsTree = gitStdout(
        rt,
        repo,
        ['mktree'],
        `100644 blob ${upperBlob}\t${upperName}\n100644 blob ${lowerBlob}\t${lowerName}\n`
      )
      const rootTree = gitStdout(rt, repo, ['mktree'], `040000 tree ${threadsTree}\tthreads\n`)
      const commit = gitStdout(rt, repo, ['commit-tree', rootTree, '-m', 'two record names differing only in case'])
      gitStdout(rt, repo, ['update-ref', LEDGER_REF, commit])

      const refContents: Record<string, string> = {
        [`threads/${upperName}`]: upperContent,
        [`threads/${lowerName}`]: lowerContent
      }
      assert.deepEqual(
        listTreePaths(rt, repo, LEDGER_REF),
        Object.keys(refContents).sort(),
        'the fixture requires the ledger ref to carry both case variants of one record name'
      )

      const opened = openStore(rt, repo)

      if (!opened.ok) {
        assert.match(
          opened.message,
          /folded one of the ledger ref's record names onto another/,
          `a filesystem that cannot keep both names apart must be refused for that reason and no other, but the refusal read: ${opened.message}`
        )
        assert.match(
          opened.message,
          /read back carrying a different record's bytes/,
          `the refusal must name the harm, which is one record's name serving another record's bytes, but it read: ${opened.message}`
        )
        assert.equal(
          opened.retryable,
          false,
          `a filesystem folds the same two names on every repeat, so the refusal must not invite one; it read: ${opened.message}`
        )
        return
      }

      assert.deepEqual(
        readRecordsTree(layout.records),
        refContents,
        `a store that opened over a ledger ref carrying two names differing only in case must hold every one of those names on disk with its own bytes; its records tree holds ${JSON.stringify(readRecordsTree(layout.records))} against a ref holding ${JSON.stringify(refContents)}`
      )
    })
  })
})
