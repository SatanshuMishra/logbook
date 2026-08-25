# MSP-2 — A losing retry cannot destroy the winner's write

## 0. Identity

- **Closes:** D11.
- **Depends on:** MSP-0 (`fix/msp-0-utf8-source-census`), for one reason only: MSP-0 removes the pinned version literal from `test/contract/cutover-manifests-agree.test.ts`, without which this plan's version bump turns that test red. No source change in this plan depends on MSP-0. The concrete, checkable precondition is stop condition 7 in section 11.
- **Required by:** MSP-4.
- **Branch name:** `fix/msp-2-cas-retry-reread`, cut from `main`, pull request targets `main`.
- **Version bump:** Baseline `1.0.2` -> `1.0.3` per orchestrator ruling O1. The step in section 4 is written as a read-then-increment, so a shifted ladder does not invalidate it.
- **SPEC anchors:** section 7 MSP-2; section 6 ruling R3; section 5 defect D11.

### What this MSP is for, in plain words

Records are stored as commits on a git ref, `refs/logbook/ledger`. To write, the code builds a new commit and then does a **compare-and-swap**: it moves the ref only if the ref still holds the value it read at the start. If another process moved the ref first, the compare-and-swap fails and the code retries.

The retry is where the damage is. It re-reads the *ref*, but it keeps using the record the caller handed it at the start — a snapshot taken before the other process wrote. It then lays that stale snapshot over the newly-won tree. If the other process changed the same record, its change is gone, and both processes are told they succeeded.

This MSP makes the retry read the record it is about to overwrite, and refuse rather than overwrite when that record changed underneath it.

---

## 1. Acceptance criteria (the ceiling)

Verbatim from SPEC section 7, MSP-2:

1. A two-writer test in which the second writer loses the compare-and-swap asserts the first writer's field survives, **or** that the second writer received a retryable refusal. It asserts that no outcome exists in which a writer is told it succeeded while its predecessor's committed field is gone. Red on the parent — the audit's probe reproduces exactly this.
2. `test/store/concurrency.test.ts` and `test/sync/cas-retry.test.ts` stay green.
3. Inertness: restoring the stale-record reuse turns criterion 1 red.
4. `npm test` green.

That list is the complete definition of done for this MSP. Anything discovered above it is appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence, and is **not** folded into this plan.

---

## 2. Ground truth

Every excerpt below was read from the working tree on branch `docs/post-cutover-repair-spec`, whose `src/`, `test/`, `hooks/` and `scripts/` trees are byte-identical to `main` at `0ade582`. Line numbers are the ones actually read.

### 2.1 `src/store/write-path.ts:206-221` — the compare-and-swap and its retry

```ts
    const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, newCommit, oldRef)
    if (cas.ok) {
      return { ok: true, ref: LEDGER_REF, before: oldRef, after: newCommit }
    }

    if (cas.cause === 'ref-moved') {
      oldRef = readCurrentRef()
      continue
    }

    rollback()
    return { ok: false, reason: 'io', detail: cas.message }
  }

  rollback()
  return { ok: false, reason: 'ref-moved', detail: `${LEDGER_REF} moved ${MAX_ATTEMPTS} times; giving up` }
```

What is wrong: line 212 re-reads the ref and nothing else. `targets` was computed once at line 154 from the caller's in-memory records and is never recomputed, so the next pass through the loop lays exactly the same blobs over whatever the winner just committed.

### 2.2 `src/store/write-path.ts:68-81` — the head of `buildTree`, which does the overwriting

```ts
const buildTree = (
  rt: Runtime,
  layout: StoreLayout,
  runGit: typeof git,
  oldRef: string | null,
  targets: Target[]
): TreeResult =>
  withSharedIndex(writeIndexScratchDir(layout), (indexFile) => {
    if (oldRef !== null) {
      const readTree = runGit(rt, layout.projectRoot, ['read-tree', oldRef], { indexFile })
      if (!readTree.ok) {
        return { ok: false, detail: `read-tree: ${readTree.stderr}` }
      }
    }
```

What is wrong: nothing in `buildTree` itself. `read-tree oldRef` correctly preserves every path the caller is **not** writing, which is why a race over a *different* record is already safe. The damage is confined to paths the caller **is** writing, which the caller's blobs then replace unconditionally.

### 2.3 `src/store/write-path.ts:154-172` — where `targets` and `oldRef` are established

```ts
  const targets = changes.map((change) => ({
    change,
    relPath: relativePathFor(change),
    target: path.join(layout.records, relativePathFor(change))
  }))

  const backups = targets.map(({ target }) => captureBackup(target))
  const rollback = (): void => {
    for (const backup of backups) {
      restoreBackup(rt, backup)
    }
  }

  const readCurrentRef = (): string | null => {
    const result = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
    return result.ok ? result.stdout.trim() : null
  }

  let oldRef = readCurrentRef()
```

`relPath` is the repository-relative path of the record inside the ledger tree, for example `threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json`. It is the exact key needed to ask git what that record held in any given commit.

### 2.3b `src/store/write-path.ts:132-140` — the insertion point for the record read

```ts
  try {
    unlinkSync(backup.target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}
```

What is wrong: nothing here is defective. This is the tail of `restoreBackup`, quoted because step 1 inserts the `blobAt` helper immediately after it and needs an anchor that appears exactly once.

### 2.3c `test/store/concurrency.test.ts:8-9` and `:227-232` — the two test edit sites

The import anchor at lines 8-9:

```ts
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
```

The end of the file, lines 227-232:

```ts
      } finally {
        rmSync(scriptDir, { recursive: true, force: true })
      }
    })
  })
})
```

What is wrong: nothing here is defective. The file imports no git helper, so the new test cannot read the committed record from the ledger ref without the import added in step 5.1; and the second block is the unique anchor the new test is appended after.

### 2.4 `src/store/write-path.ts:19-21` — the result type the refusal must fit into

```ts
export type CommitResult =
  | { ok: true; ref: string; before: string | null; after: string }
  | { ok: false; reason: 'ref-moved' | 'io' | 'invalid'; detail: string }
```

`'ref-moved'` already exists as a failure reason, produced today at line 221 when the retry budget is exhausted. The refusal this MSP adds reuses it, so no consumer gains a case it does not already handle.

### 2.5 `test/store/concurrency.test.ts:148-232` — the test that must stay green

Its second process, driven from `beforeCas` at line 185, first moves the ledger ref by committing a **different** record (`threadRemote`) and only then opens the store. The writer's own target is `threads/${threadInFlight.record.id}.json`, which is absent from both the pre-race ref and the post-race ref. It then asserts at line 215:

```ts
        assert.equal(writeResult.ok, true, "process A's commit must survive process B opening the store mid-write")
```

and at line 217:

```ts
        assert.equal(writeResult.before, remoteRef)
```

So a retry that refuses unconditionally would turn this test red, and the retry must also carry the newly-read ref into `before`.

### 2.6 `test/sync/cas-retry.test.ts:110-161` — the second test that must stay green

Its `beforeCas` racer commits `threads/${threadDId}.json`, again a path the writer does not target, and the test then asserts at lines 147-149 that the sync `merged` and at lines 153-161 that all four threads are reachable on both the local ref and the remote. Same conclusion: a benign race over a different record must still retry and succeed.

### 2.7 `test/store/write-path.test.ts`, test name `write.retries-on-moved-ref` — the third test that must stay green

Its child process writes the literal path `threads/child-thread.json` while the parent writes `threads/${parentChange.record.id}.json`. Different paths again, and the test asserts `result.ok` is `true` and that both records are reachable afterwards.

### 2.8 The inherited probe

`docs/audits/2026-08-25-post-cutover-repair-probes/probe-lostupdate.ts` reproduces the defect. Its shape, at lines 40-51, is the one this plan's test adopts: hold a base record, build writer A's version from it, and from inside `beforeCas` land writer B's version of **the same record**, then observe the final record. Its lines 58-60 print the verdict:

```ts
console.log('  key_decisions (A wrote 1) :', final.spine.key_decisions.length, final.spine.key_decisions.map(k=>k.title))
console.log('  open_risks    (B wrote 1) :', final.spine.open_risks.length, final.spine.open_risks.map(r=>r.text))
console.log('\nVERDICT: B lost =', final.spine.open_risks.length === 0, '| A lost =', final.spine.key_decisions.length === 0)
```

`probe-concurrent.ts` and `probe-concurrent2.ts` drive the same defect through many forked children and read the ledger ref directly rather than the materialised copy. Their contribution to this plan is that assertion target: the committed record is read with `git cat-file -p ${LEDGER_REF}:threads/<id>.json`, never from the on-disk copy, because the on-disk copy is a cache that a rollback can rewrite. Nothing in the probes directory is a test, and none of it is in the tsconfig include set.

### 2.9 Suite idiom this plan's test follows

Established by reading `test/store/concurrency.test.ts`, `test/store/write-path.test.ts` and `test/support/`:

- The suite contains **no** `describe`, `it`, `suite`, `before`, `after`, `beforeEach` or `afterEach` anywhere. Every test is a flat top-level `test('name', () => { ... })` from `node:test`. This plan therefore gives an exact `test(...)` name string and no `describe(...)` name, because none exist to match.
- `import assert from 'node:assert/strict'`, `import { test } from 'node:test'`, `assert.equal` rather than `assert.strictEqual`.
- Test names are `<subject>.<kebab-case-predicate>`, all lowercase. The subject already used for concurrent-writer behaviour in this file is `concurrent.`.
- The repository fixture is `withRepo` from `test/support/git-fixture.ts`; the plugin-data directory is a file-local `withPluginData` wrapper using `mkdtempSync` and `rmSync`. Both already exist in this file at lines 23-30.

### 2.10 The git primitive this plan relies on

`git rev-parse <commit>:<path>` prints the blob id of that path in that commit and exits `0`; when the path is absent from that commit it exits `128` and prints `fatal: path '<path>' does not exist in '<commit>'` on stderr. Measured in a scratch repository on this machine. `src/store/git.ts:57-84` maps a non-zero exit to `{ ok: false, ... }`, so both "absent" and "the ref does not resolve" collapse to the same observable, which is the correct reading for this comparison.

---

## 3. Divergences from the SPEC

**3.1 The choice R3 leaves open is settled here as a conditional refusal, and the condition is byte equality of the record in the two trees.**

SPEC section 6, ruling R3 says: "The implementing MSP chooses re-apply where the change is expressible as a function of the current record, and refuses otherwise, but under no circumstance writes a blob derived from a record it did not read."

At this call site the change is **not** expressible as a function of the current record. `writeRecords` receives `RecordChange` values (`src/store/write-path.ts:13-17`), each of which carries a whole finished record — no delta, no base, no merge function. There is nothing to re-apply.

The plan therefore refuses, but only where a refusal is warranted: on a `ref-moved` retry it reads each record it is about to write out of **both** the tree it planned against and the tree that won, and continues only where the two are byte-identical. Where they are identical, the record in the winning tree *is* the record the caller derived from, read and confirmed, so continuing does not write a blob derived from a record it did not read. Where they differ, it refuses.

Rejected alternative, in one line: refusing on every `ref-moved` retry regardless of which record moved, rejected because a race over a *different* record destroys nothing and the three tests named in sections 2.5, 2.6 and 2.7 all require that retry to succeed, so an unconditional refusal breaks acceptance criterion 2.

Second rejected alternative, in one line: three-way merging the stale record against the winner's version using `src/merge/field-merge.ts`, rejected because `writeRecords` holds no merge base for the caller's snapshot, and a merge without a base cannot tell an intentional overwrite from a lost update.

**3.2 The ladder lands on `1.1.1`, not `1.1.0`.** SPEC section 7 states the ladder lands on `1.1.0`; MSP-9 merges last and the ladder lands on `1.1.1`. This does not affect any step in this plan.

**3.3 The pull request tool path.** SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib` in this repository; the tool is the operator's global one at `node ~/.claude/lib/git/pr.mjs pr-create`, which section 10 uses.


**3.4 The manifest-agreement test pins a version literal, and this plan does not repair it.**

`test/contract/cutover-manifests-agree.test.ts:8` reads `const EXPECTED_VERSION = '1.0.0'`, and
lines 54-58, 63-67 and 77 assert both manifests and the wire version equal it. Every version bump
in this ladder therefore turns `cutover.manifests-agree` red, which would make this plan's own
`npm test` acceptance criterion unreachable.

That repair is owned by MSP-0, permanently and once, by deriving the expected version from
`package.json` instead of pinning a literal. This plan writes no edit to that file: re-pinning the
constant to a new number here would be editing a change-detector test, and it would break again the
moment the ladder order shifted. The precondition is checkable and appears as a stop condition in
section 11.

---

## 4. The change, step by step

Apply in the order given. The tree is type-correct after step 2 and after step 4.

### Step 1 — `src/store/write-path.ts` — INSERT-AFTER `restoreBackup`

Rationale: ruling R3 — "The retry must re-read the *record* from the newly-won tree". This is the read.

FIND (the closing lines of `restoreBackup`, unique in the file):

```ts
  try {
    unlinkSync(backup.target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export const writeRecords = (
```

REPLACE:

```ts
  try {
    unlinkSync(backup.target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

const blobAt = (
  rt: Runtime,
  layout: StoreLayout,
  runGit: typeof git,
  ref: string | null,
  relPath: string
): string | null => {
  if (ref === null) return null
  const result = runGit(rt, layout.projectRoot, ['rev-parse', `${ref}:${relPath}`])
  return result.ok ? result.stdout.trim() : null
}

export const writeRecords = (
```

### Step 2 — `src/store/write-path.ts` — REPLACE the `ref-moved` retry branch

Rationale: ruling R3 — "**Refusing is acceptable; overwriting is not.** A refusal on a lost race is a retryable, diagnosable outcome; a silent overwrite is undetectable by either writer."

FIND:

```ts
    if (cas.cause === 'ref-moved') {
      oldRef = readCurrentRef()
      continue
    }
```

REPLACE:

```ts
    if (cas.cause === 'ref-moved') {
      const wonRef = readCurrentRef()
      const changedUnderneath = targets.filter(
        ({ relPath }) =>
          blobAt(rt, layout, runGit, oldRef, relPath) !== blobAt(rt, layout, runGit, wonRef, relPath)
      )
      if (changedUnderneath.length > 0) {
        rt.log({
          level: 'error',
          event: 'store.cas-retry-refused',
          ref: LEDGER_REF,
          contested_records: changedUnderneath.length
        })
        rollback()
        return {
          ok: false,
          reason: 'ref-moved',
          detail: `${LEDGER_REF} moved and ${changedUnderneath.length} of the record(s) being written changed in the winning commit; the write was refused rather than overwriting them`
        }
      }
      oldRef = wonRef
      continue
    }
```

### Step 3 — `package.json` and `.claude-plugin/plugin.json` — REPLACE the version line in both

Rationale: invariant I4 — both manifests move in the same commit.

Run this exact command from the repository root. It reads the current version, increments the patch, and writes the same value into both files by replacing only the version line, so no other formatting changes:

```bash
node -e "
const fs = require('node:fs')
const readVersion = (file) => {
  const raw = fs.readFileSync(file, 'utf8')
  const match = raw.match(/^  \"version\": \"(\d+)\.(\d+)\.(\d+)\",?\$/m)
  if (match === null) throw new Error('no version line in ' + file)
  return { raw, match }
}
const pkg = readVersion('package.json')
const plugin = readVersion('.claude-plugin/plugin.json')
if (pkg.match[0].replace(/,\$/, '') !== plugin.match[0].replace(/,\$/, '')) {
  throw new Error('package.json and .claude-plugin/plugin.json disagree before the bump')
}
const next = pkg.match[1] + '.' + pkg.match[2] + '.' + String(Number(pkg.match[3]) + 1)
for (const file of ['package.json', '.claude-plugin/plugin.json']) {
  const raw = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, raw.replace(/^  \"version\": \"\d+\.\d+\.\d+\"/m, '  \"version\": \"' + next + '\"'))
}
process.stdout.write('version ' + next + '\n')
"
```

Expected exit code `0`. Expected stdout under the baseline: `version 1.0.3`.


Then confirm the result with these two commands.

```bash
git --no-pager diff --no-color -U0 -- package.json .claude-plugin/plugin.json
```

Expected exit code `0`. The two `index <sha>..<sha> 100644` lines are content hashes and are not predictable; the four load-bearing lines are the two removed and two added `"version"` lines, and under the baseline the output contains exactly these four:

```
-  "version": "1.0.2",
+  "version": "1.0.3",
-  "version": "1.0.2",
+  "version": "1.0.3",
```

```bash
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout contains `check-packaging: ok`.

---

## 5. Tests

One existing file is modified. No new test file is created: `test/store/concurrency.test.ts` is already the home for concurrent-writer behaviour, and the test admission gate's "one behaviour, one home" rule places this beside `concurrent.second-process-destroys-nothing` rather than in a second file.

### 5.1 MODIFY `test/store/concurrency.test.ts` — add the `git` import

The test asserts against the committed ledger ref rather than the on-disk copy, because `rollback()` rewrites the on-disk copy and only the ref is the source of truth.

FIND:

```ts
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
```

REPLACE:

```ts
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
```

### 5.2 MODIFY `test/store/concurrency.test.ts` — INSERT-AFTER the final test

FIND (the last six lines of the file, unique within it):

```ts
      } finally {
        rmSync(scriptDir, { recursive: true, force: true })
      }
    })
  })
})
```

REPLACE:

```ts
      } finally {
        rmSync(scriptDir, { recursive: true, force: true })
      }
    })
  })
})

test('concurrent.same-record-loser-refuses-rather-than-overwrites', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)

      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const contested = makeThread(rt, 'contested-thread')
      const seedCommit = seeded.value.commit([contested], 'seed the contested thread')
      assert.equal(seedCommit.ok, true)
      if (!seedCommit.ok) return

      const layout = layoutIn(rt, repo)
      const base = expectLoaded(seeded.value.readThread(contested.record.id), 'the seeded contested record')

      const writerA: RecordChange = {
        kind: 'thread',
        record: { ...base, spine: { ...base.spine, next_step: 'A wrote this next step' }, updated_at: rt.now() }
      }
      const writerB: RecordChange = {
        kind: 'thread',
        record: { ...base, spine: { ...base.spine, active_goal: 'B wrote this active goal' }, updated_at: rt.now() }
      }

      let writerBLanded = false
      const beforeCas = (): void => {
        if (writerBLanded) return
        const landed = writeRecords(rt, layout, [writerB], 'B: change the active goal')
        assert.equal(landed.ok, true, "the winning writer's commit must land before the losing writer retries")
        writerBLanded = landed.ok
      }

      const writerAResult = writeRecords(rt, layout, [writerA], 'A: change the next step', { beforeCas })

      assert.equal(writerBLanded, true, 'the fixture requires the winning writer to have committed')

      assert.equal(
        writerAResult.ok,
        false,
        'the writer that lost the race must be refused, never told it succeeded over a record it did not read'
      )
      if (writerAResult.ok) return
      assert.equal(writerAResult.reason, 'ref-moved')
      assert.ok(writerAResult.detail.length > 0, 'the refusal must say why the write was refused')

      const committed = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:threads/${contested.record.id}.json`])
      assert.equal(committed.ok, true)
      if (!committed.ok) return
      const survivor = JSON.parse(committed.stdout) as Thread

      assert.equal(
        survivor.spine.active_goal,
        'B wrote this active goal',
        "the winning writer's committed field must survive the losing writer's retry"
      )
      assert.equal(
        survivor.spine.next_step,
        base.spine.next_step,
        'the refused writer must not have laid its stale record over the winner'
      )

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) return
      const readBack = expectLoaded(
        reopened.value.readThread(contested.record.id),
        'the contested record read back through the store'
      )
      assert.deepEqual(readBack, survivor, 'the store must read back exactly the record the ledger ref holds')
    })
  })
})
```

### 5.3 Which test discharges which acceptance criterion

| Criterion | Test name | File |
| --- | --- | --- |
| 1 | `concurrent.same-record-loser-refuses-rather-than-overwrites` | `test/store/concurrency.test.ts` |
| 2 | `concurrent.second-process-destroys-nothing` and `sync.cas-retry`, both unchanged | `test/store/concurrency.test.ts`, `test/sync/cas-retry.test.ts` |
| 3 | `concurrent.same-record-loser-refuses-rather-than-overwrites` under the mutation in section 7 | `test/store/concurrency.test.ts` |
| 4 | `npm test` in section 8 | — |

The single new test asserts both halves of criterion 1 at once: the losing writer receives a retryable refusal (`writerAResult.ok` is `false`, `reason` is `'ref-moved'`), **and** the winner's field survives (`survivor.spine.active_goal`). Together with the assertion that the loser's field is absent, no outcome remains in which a writer is told it succeeded while its predecessor's committed field is gone.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time; `0ade582` at authoring time.

The new test compiles on the parent. It imports only `git`, `openStore`, `writeRecords`, `layoutFor`, `LEDGER_REF` and the file-local helpers `runtimeWithHome`, `withPluginData`, `layoutIn`, `makeThread` and `expectLoaded`, all of which already exist there. No substitute procedure is needed.

Apply steps 5.1 and 5.2 only, commit them (section 9, commit 1), and run:

```bash
node --test "test/store/concurrency.test.ts"
```

Expected exit code `1`. The failing test is `concurrent.same-record-loser-refuses-rather-than-overwrites`, and the first failing assertion is:

```
assert.equal(
  writerAResult.ok,
  false,
  'the writer that lost the race must be refused, never told it succeeded over a record it did not read'
)
```

reported as:

```
Expected values to be strictly equal:

true !== false

the writer that lost the race must be refused, never told it succeeded over a record it did not read
```

because on the parent the retry re-reads only the ref, rebuilds the tree from the winner's commit, and lays writer A's stale blob over writer B's record, returning `{ ok: true }`.

`concurrent.second-process-destroys-nothing` passes in the same run on the parent, and must still pass after the fix.

---

## 7. Inertness mutation

One mutation, for acceptance criterion 3 ("restoring the stale-record reuse turns criterion 1 red").

**The exact edit to revert.** In `src/store/write-path.ts`, replace the whole block added by step 2:

```ts
    if (cas.cause === 'ref-moved') {
      const wonRef = readCurrentRef()
      const changedUnderneath = targets.filter(
        ({ relPath }) =>
          blobAt(rt, layout, runGit, oldRef, relPath) !== blobAt(rt, layout, runGit, wonRef, relPath)
      )
      if (changedUnderneath.length > 0) {
        rt.log({
          level: 'error',
          event: 'store.cas-retry-refused',
          ref: LEDGER_REF,
          contested_records: changedUnderneath.length
        })
        rollback()
        return {
          ok: false,
          reason: 'ref-moved',
          detail: `${LEDGER_REF} moved and ${changedUnderneath.length} of the record(s) being written changed in the winning commit; the write was refused rather than overwriting them`
        }
      }
      oldRef = wonRef
      continue
    }
```

with the pre-fix four-line form, which restores the stale-record reuse:

```ts
    if (cas.cause === 'ref-moved') {
      oldRef = readCurrentRef()
      continue
    }
```

**The exact test that must turn red.**

```bash
node --test "test/store/concurrency.test.ts"
```

Expected exit code `1`, with `concurrent.same-record-loser-refuses-rather-than-overwrites` failing on `assert.equal(writerAResult.ok, false, ...)`, reported as `Expected values to be strictly equal:\n\ntrue !== false` under the message `the writer that lost the race must be refused, never told it succeeded over a record it did not read`.

`concurrent.second-process-destroys-nothing` must still pass under the mutation. If it fails too, the mutation was applied wrongly.

**The exact restore.** Apply the two blocks above in reverse: replace the four-line form with the block step 2 specifies. Then re-run:

```bash
node --test "test/store/concurrency.test.ts"
```

Expected exit code `0`.

---

## 8. Full verification

Run each of these from the repository root, in this order.

| # | Command | Expected exit code | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | `0` | no line containing `error TS`; the two `> logbook@` banner lines are normal npm output and are not a failure |
| 2 | `node --test "test/store/concurrency.test.ts"` | `0` | `fail 0` |
| 3 | `node --test "test/sync/cas-retry.test.ts"` | `0` | `fail 0` |
| 4 | `node --test "test/store/write-path.test.ts"` | `0` | `fail 0` |
| 5 | `node --test "test/store/**/*.test.ts"` | `0` | `fail 0` |
| 6 | `node --test "test/sync/**/*.test.ts"` | `0` | `fail 0` |
| 7 | `npm test` | `0` | `fail 0` |
| 8 | `node scripts/check-packaging.mjs` | `0` | `check-packaging: ok` |

Commands 2, 3 and 4 are listed separately from 5 and 6 because they are the three tests acceptance criterion 2 and sections 2.5 to 2.7 name individually. Running them alone makes it visible which one broke if one does.

---

## 9. Commits

Three commits, in this order. There is no refactor in this MSP, so no refactor commit exists to keep separate from the behaviour change.

**Commit 1 — the test, before the fix**

```
test(store): pin that a losing compare-and-swap retry cannot destroy the winner
```

Files: `test/store/concurrency.test.ts`.
Plan steps: 5.1 and 5.2.
This commit is intentionally red. The branch is squash-merged, so no red commit reaches `main`.

**Commit 2 — the behaviour fix**

```
fix(store): refuse a compare-and-swap retry that would overwrite an unread record
```

Files: `src/store/write-path.ts`.
Plan steps: 1 and 2.

**Commit 3 — the version bump**

```
chore(release): bump the plugin version for the compare-and-swap retry fix
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Plan steps: 3.

Authored change size, counted across all three commits: about 27 changed lines under `src/`, about 75 lines added to one existing test file, and 2 lines in the manifests. Roughly 104 lines in total, well under the 400-line ceiling, and no split is taken.

---

## 10. Pull request

Run exactly this, from the repository root, after the branch is pushed:

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/msp-2-cas-retry-reread --base main \
  --title "fix(store): refuse a retry that would overwrite an unread record" \
  --what "When two processes write the same record at once, the one that loses the race is now refused with a retryable error instead of being told it succeeded." \
  --what "A race over two different records still retries and succeeds exactly as before, because the retry now compares only the records it is about to write." \
  --why "The retry re-read the ledger ref but kept the caller's original copy of the record, so it wrote that stale copy over whatever the winning process had just committed." \
  --why "Both processes were reported as successful, which made the lost change undetectable from either side." \
  --risk "A caller that writes a record another process changed in the same instant now receives a failure it must retry, where it previously received a success." \
  --verified "npm test - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "inertness mutation restoring the stale-record reuse - concurrent.same-record-loser-refuses-rather-than-overwrites turns red" \
  --not-verified "mutation (Stryker) - result not read"
```

Expected exit code `0`. Expected stdout contains `https://github.com/SatanshuMishra/logbook/pull/`.

The mutation-scope sentence SPEC section 8.2 requires, to be understood before that last flag is written: the Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`, `src/merge/conflict.ts`, `src/render/**`. This MSP's only source change is in `src/store/write-path.ts`, which falls **inside** that scope, so the job does mutate this diff. Replace the final `--not-verified` line with `--verified "mutation (Stryker) - <the real score the job reported>"` only if the job actually ran and you read its result. Never write a `Verified:` line for a check you did not run.

---

## 11. Stop conditions

For each of these: **STOP and report; do not improvise.**

1. **A FIND string does not match.** Any FIND block in section 4 or 5 that does not appear verbatim and exactly once in the named file means the tree is not the one this plan was written against. STOP and report; do not improvise.

2. **`test/sync/cas-retry.test.ts` turns red after step 2.** Run `node --test "test/sync/cas-retry.test.ts"` immediately after step 2 and expect exit code `0`. A failure means the retry is refusing a race over a record the writer does not target, which is not the behaviour this plan specifies. STOP and report; do not improvise.

3. **`concurrent.second-process-destroys-nothing` turns red after step 2.** Run `node --test "test/store/concurrency.test.ts"` immediately after step 2 and expect exit code `0`. In particular, a failure on `assert.equal(writeResult.before, remoteRef)` means the retry did not carry the newly-read ref into `before`. STOP and report; do not improvise.

4. **`write.retries-on-moved-ref` turns red after step 2.** Run `node --test "test/store/write-path.test.ts"` immediately after step 2 and expect exit code `0`. STOP and report; do not improvise.

5. **`git rev-parse <ref>:<path>` does not behave as section 2.10 states.** Before step 1, run this in any git repository that has at least one commit: `git rev-parse HEAD:does-not-exist.txt`. Expect exit code `128` and `does not exist` on stderr. If it exits `0`, the comparison in step 2 cannot distinguish an absent record from a present one. STOP and report; do not improvise.

6. **The version files disagree before the change.** Run `node -e "const f=(p)=>JSON.parse(require('fs').readFileSync(p,'utf8')).version; process.stdout.write(f('package.json')+' '+f('.claude-plugin/plugin.json')+'\n')"`. Expected exit code `0` and two identical values. If the two values printed are not identical, STOP and report; do not improvise. A version merely higher than `1.0.2` is **not** a stop condition — it means the ladder shifted, and step 3 increments whatever it finds.

7. **The manifest-agreement test still pins a version literal.** Run this before step 1, verbatim:

   ```
   Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
   If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
   STOP and report; do not improvise, and do not edit this file.
   ```

   The runnable form of that same check, which needs no judgement:

   ```bash
   grep -c "^const EXPECTED_VERSION = '" test/contract/cutover-manifests-agree.test.ts
   ```

   If the output is not exactly `0`, MSP-0 has not merged. STOP and report; do not improvise, and
   do not edit this file. On the tree as it stands today that command prints `1` and exits `0`;
   once MSP-0 has merged it prints `0` and exits `1`. This plan writes no edit to
   `test/contract/cutover-manifests-agree.test.ts` under any circumstance: the version bump in
   step 3 and the `npm test` exit code `0` in section 8 both depend on MSP-0 having de-pinned
   that constant permanently.

8. **`npm test` reports a failure in `workflow-hardening-census`.** This stop condition is quoted verbatim:

   ```
   If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
   described by the orchestrator is not yet closed in this checkout. STOP and report.
   Do not edit, skip or delete that test, and do not install anything yourself.
   ```

   That test is outside this MSP's surface and this plan writes no edit to it. Section 8 states
   `npm test` and `npm run typecheck` as ordinary gates expecting exit code `0`, and neither is
   weakened, rescoped, or expressed as a comparison against a known-failing baseline.
