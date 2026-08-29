# U2 — Store cost and safety (A: cost)

## 0. Identity

| | |
|---|---|
| **Closes** | Defect `D13` (opening the store recursively walks every record file to count them) and defect `D14` (materialisation spawns one `git cat-file -p` subprocess per record) |
| **Depends on** | `U1 Schema foundations` must already be merged into `main` before this branch is cut. Section 11 carries the check that proves it |
| **Required by** | `U2 …-b` (the safety half) edits `src/merge/sync.ts`, which this plan also edits. `…-b` is cut only after this one merges |
| **Wave** | 1, second position |
| **Branch name** | `perf/u2-store-cost-and-safety-a`, cut from `main` |
| **Version bump** | Baseline `1.6.1` -> `1.6.2` per orchestrator rulings OR1, OR23 and OR25. Applied as a read-then-increment in step 9, never as a hard-coded pair |
| **Owns** | `src/store/records.ts`, `src/store/read-path.ts`, `src/merge/sync.ts` |
| **Creates** | `test/store/open-cost.test.ts`, `test/store/materialise-cost.test.ts` |
| **Does not touch** | `src/store/single-store.ts`, `src/store/write-path.ts`, `src/schema/`, `src/server/`, `README.md` |
| **SPEC anchors** | Section 9 unit U2; section 8 rules B37 and B38; section 6 invariants O5 and S1; section 7 defects D13 and D14 |

This document is self-contained. The implementer reads this file and the repository, and nothing else.

### Two plain-language definitions used throughout

- **The ledger ref** is `refs/logbook/ledger`, a git reference inside the project's own repository that holds every stored record as a git tree. It is not a branch and is never checked out.
- **Materialising** is copying the records out of that ref onto disk, into the store's `records/` directory, so ordinary file reads can serve them.

---

## 1. Acceptance criteria (the ceiling)

1. **Opening the store no longer reads every record.** The number of directory entries the open path examines does not grow with the number of records the store holds. Discharges `B37`. Proven by `store.open-does-not-read-every-record`.
2. **The stamp-versus-ref comparison stands in for the walk.** When materialisation has just rebuilt the records tree, the open path performs no disk scan at all. Discharges `B37`.
3. **A store holding none of the records the ledger ref carries still reports the named anomaly.** The count of records found on disk is still reported as `0`, and the count in the ref is still reported. Discharges `B37` without losing detection. Proven by the already-shipped `read.absent-records-under-a-current-stamp-are-reported`.
4. **Materialisation costs a fixed number of subprocesses.** Rebuilding the records tree spawns the same number of git subprocesses for four records as for forty, and that number is at most three. Discharges `B38`. Proven by `store.materialisation-cost-does-not-grow-with-record-count`.
5. **A ledger tree naming a blob that cannot be read is still a whole-call failure.** No partial tree is ever swapped into place, and no stamp is written. Discharges `B38` without losing safety. Proven by the already-shipped `read.a-record-blob-that-cannot-be-read-is-a-failure`.
6. **Sync materialisation costs a fixed number of subprocesses too.** The merge path's copy of the ledger tree is read the same batched way. Discharges `B38` across both materialising call sites.
7. **The number of records a discovery surface reads does not grow as records accumulate.** This is invariant `O5`. Proven jointly by `store.open-does-not-read-every-record` and the already-shipped `roster.subprocess-census`.
8. **No caller can observe records on disk that differ from the tree in the ref, for any write that has returned.** This is invariant `S1`. Proven by the already-shipped concurrency receipts in `test/store/concurrency.test.ts`.
9. **Before-and-after timings are recorded.** The measurement procedure in section 8 is run and its numbers are written into the pull request body. This is the SPEC Green-cell clause "Store-open and materialisation timings recorded before and after", and it is the evidence for the cost claims `B37` and `B38` make.

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is NOT folded into this plan.

---

## 2. Ground truth

### 2.1 `src/store/records.ts:1` — the filesystem import

```ts
import { readdirSync } from 'node:fs'
```

Only `readdirSync` is imported, and it returns every entry in a directory at once. The early-exit scan that closes defect `D13` needs `opendirSync`, which reads a directory incrementally and can stop at the first record.

### 2.2 `src/store/records.ts:81-96` — the recursive count

```ts
const diskRecordCount = (dir: string): number => {
  try {
    let total = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        total += diskRecordCount(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        total += 1
      }
    }
    return total
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return 0
    throw error
  }
}
```

This walks the whole records tree and counts every `.json` file, on every store open. Its only caller compares the total against zero, so all the counting past the first file is discarded work. This is defect `D13`.

### 2.3 `src/store/records.ts:117-135` — the open-path check

```ts
const ensureMaterialised = (rt: Runtime, layout: StoreLayout): Ok<void> | Refusal => {
  const outcome = syncWorkingCopy(rt, layout)
  if (!outcome.ok) return materialisationRefusal(outcome.detail)

  if (diskRecordCount(layout.records) > 0) return { ok: true, value: undefined }

  const inRef = refRecordCount(rt, layout)
  if (inRef === null || inRef === 0) return { ok: true, value: undefined }

  rt.log({
    level: 'error',
    event: 'store.materialisation-anomaly',
    records_in_ref: inRef,
    records_on_disk: 0,
    detail: 'the ledger ref holds records this store has not materialised'
  })

  return { ok: true, value: undefined }
}
```

`syncWorkingCopy` already returns whether it rebuilt the tree, and that answer is discarded. When it did rebuild, the tree on disk was written from the ref moments earlier and the walk cannot find anything wrong, so the walk is pure cost. This is the other half of defect `D13`.

### 2.4 `src/store/read-path.ts:69-76` — the tree-listing line parser

```ts
const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex === -1) return null
  const meta = line.slice(0, tabIndex).split(' ')
  const blobId = meta[2]
  if (blobId === undefined) return null
  return { blobId, relPath: line.slice(tabIndex + 1) }
}
```

Its only caller is `materialiseTree`, whose per-blob loop is defect `D14`. Once that loop goes, nothing reads git's tree listing line by line and this function has no caller left.

### 2.5 `src/store/read-path.ts:153-191` — one subprocess per record

```ts
const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseOutcome => {
  const list = countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!list.ok) {
    return { ok: false, detail: `the ledger tree could not be listed (git ls-tree exit ${list.code})` }
  }

  const newTreeDir = freshRecordsScratchDir(layout)
  const lines = list.stdout.split('\n').filter((line) => line.length > 0)
  let unreadable = 0
  let currentTarget = newTreeDir
  try {
    mkdirSync(newTreeDir, { recursive: true })
    for (const line of lines) {
      const parsed = parseLsTreeLine(line)
      if (parsed === null) continue
      const content = countedMaterialiseGit(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
      if (!content.ok) {
        unreadable += 1
        continue
      }
      currentTarget = path.join(newTreeDir, parsed.relPath)
      mkdirSync(path.dirname(currentTarget), { recursive: true })
      writeFileSync(currentTarget, content.stdout, 'utf8')
    }
  } catch (error) {
    discardScratchDir(rt, newTreeDir)
    return {
      ok: false,
      detail: `writing ${currentTarget} into the records scratch tree failed: ${describeError(error)}`
    }
  }

  if (unreadable > 0) {
    discardScratchDir(rt, newTreeDir)
    return { ok: false, detail: `${unreadable} record blob(s) in the ledger tree could not be read` }
  }

  return swapRecordsTreeIntoPlace(rt, layout, newTreeDir)
}
```

One `git cat-file -p` process is started for every record in the ledger tree. Measured against a fixture store: 51 subprocesses for 50 records, 201 for 200 — exactly one per record plus one for the listing. This is defect `D14`.

### 2.6 `src/merge/sync.ts:140-147` and `:151-175` — the same defect on the merge path

```ts
const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex === -1) return null
  const meta = line.slice(0, tabIndex).split(' ')
  const blobId = meta[2]
  if (blobId === undefined) return null
  return { blobId, relPath: line.slice(tabIndex + 1) }
}
```

```ts
const materialiseRefToScratch = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseResult => {
  const listing = git(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!listing.ok) {
    return { ok: false, detail: `git ls-tree failed for ${ref}: ${listing.stderr.trim()}` }
  }

  const scratch = mkdtempSync(path.join(tmpdir(), 'logbook-sync-scratch-'))
  const lines = listing.stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = git(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) {
      rmSync(scratch, { recursive: true, force: true })
      return {
        ok: false,
        detail: `git cat-file could not read blob ${parsed.blobId} (${parsed.relPath}) from ${ref}: ${content.stderr.trim()}`
      }
    }
    const target = path.join(scratch, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }
  return { ok: true, scratch }
}
```

The same one-process-per-record shape. The merge path calls this function twice in one attempt — once for the other side's tree and once for the shared ancestor's — and retries up to five times, so the cost is up to ten times the record count in subprocesses.

---

## 3. Divergences from the SPEC

1. **The decomposition procedure this ladder was expected to run does not exist on disk.** `~/.claude/skills/mitosis/SKILL.md` is absent; it is staged for deletion in the operator's configuration repository and `~/.claude/skills` is a symlink into that working tree. Ruling applied: orchestrator ruling `OR20` — this ladder depends on no external decomposition procedure, and the planning brief plus the orchestrator rulings are jointly self-contained. Nothing was restored and nothing else was investigated.

2. **Wave 1 is partially ordered: this unit follows `U1`.** SPEC section 9 calls wave 1 "fully parallel", but `U1` may add a `binding` branch to `validateChange` in `src/store/records.ts`, and SPEC section 9 assigns that file to this unit. Ruling applied: orchestrator ruling `OR17` — this unit is cut from a `main` that already contains `U1`, and section 11 carries the check that proves it.

3. **This unit is split in two, and this document is the first half.** The applied diff for the whole unit measured 473 changed lines, above the 400-line ceiling. Ruling applied: orchestrator ruling `OR16` — the split is decided here, not by the implementer. This half carries `B37` and `B38` (cost) at a measured 328 changed lines; the second half carries `B40` (safety) at 149. The second half is cut only after this one merges, because both edit `src/merge/sync.ts`.

4. **`B38` is applied to both materialising call sites, not only the one SPEC section 7 cites.** Defect `D14` cites `src/store/read-path.ts:165-168` alone, but `src/merge/sync.ts` carries a byte-for-byte equivalent loop and is assigned to this unit by SPEC section 9. `B38` is worded as a property of materialisation rather than of one function, so leaving the twin in place would leave the rule false of the system. Rejected: fixing only the cited site and filing the twin — that would leave the worst instance of the defect unfixed, since the merge path runs the loop twice per attempt.

5. **No divergence was found between the SPEC's cited line numbers and the working tree.** Every line range quoted in section 2 was read at the current tip and matches.

---

## 4. The change, step by step

Apply in this order. The tree typechecks after step 5 and again after step 7.

### Step 1 — `src/store/records.ts` — REPLACE the filesystem import

FIND:

```ts
import { readdirSync } from 'node:fs'
```

REPLACE:

```ts
import { opendirSync, readdirSync, type Dir } from 'node:fs'
```

Rationale: `B37` needs a directory read that can stop at the first record instead of listing every entry.

### Step 2 — `src/store/records.ts` — REPLACE the recursive count with an early-exit scan

FIND:

```ts
const diskRecordCount = (dir: string): number => {
  try {
    let total = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        total += diskRecordCount(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        total += 1
      }
    }
    return total
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return 0
    throw error
  }
}
```

REPLACE:

```ts
let recordScanCount = 0

export const resetRecordScanCounter = (): void => {
  recordScanCount = 0
}

export const getRecordScanCounter = (): number => recordScanCount

const openDirOrNull = (dir: string): Dir | null => {
  try {
    return opendirSync(dir)
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
}

const holdsAnyRecord = (dir: string): boolean => {
  const handle = openDirOrNull(dir)
  if (handle === null) return false
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      recordScanCount += 1
      if (entry.isFile() && entry.name.endsWith('.json')) return true
      if (entry.isDirectory() && holdsAnyRecord(path.join(dir, entry.name))) return true
    }
    return false
  } finally {
    handle.closeSync()
  }
}
```

Rationale: `B37` — the open path needs to know only whether any record exists, so it stops at the first one. The counter is the same instrumentation idiom the sibling module already ships as `getSubprocessCallCounter` and `getMaterialiseCallCounter`, and it exists so the cost claim is checkable by a test rather than asserted in prose.

### Step 3 — `src/store/records.ts` — REPLACE the open-path check

FIND:

```ts
  if (diskRecordCount(layout.records) > 0) return { ok: true, value: undefined }
```

REPLACE:

```ts
  if (outcome.materialised) return { ok: true, value: undefined }

  if (holdsAnyRecord(layout.records)) return { ok: true, value: undefined }
```

Rationale: `B37` — a rebuild that just wrote the tree from the ref is itself the proof that disk matches the ref, so the stamp-versus-ref comparison stands in for the walk. The scan runs only where that comparison leaves the question open, which is exactly the case the anomaly report exists for.

### Step 4 — `src/store/read-path.ts` — DELETE the now-callerless line parser

FIND:

```ts
const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex === -1) return null
  const meta = line.slice(0, tabIndex).split(' ')
  const blobId = meta[2]
  if (blobId === undefined) return null
  return { blobId, relPath: line.slice(tabIndex + 1) }
}

export type MaterialiseOutcome
```

REPLACE:

```ts
export type MaterialiseOutcome
```

Rationale: `B38` removes its only caller.

### Step 5 — `src/store/read-path.ts` — INSERT the index-file cleanup helper

FIND:

```ts
const discardScratchDir = (rt: Runtime, dir: string): void => {
```

REPLACE:

```ts
const discardIndexFile = (rt: Runtime, indexFile: string): void => {
  try {
    rmSync(indexFile, { force: true })
  } catch (error) {
    rt.log({ level: 'error', event: 'store.materialise-index-cleanup-failed', detail: describeError(error) })
  }
}

const discardScratchDir = (rt: Runtime, dir: string): void => {
```

Rationale: `B38` uses a git index file to carry the tree between two commands. The shared `git` helper deletes an index file only when it allocated it itself, so a caller that supplies one owns its removal. The failure is logged rather than swallowed.

### Step 6 — `src/store/read-path.ts` — REPLACE the per-record loop with one batched checkout

FIND:

```ts
const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseOutcome => {
  const list = countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!list.ok) {
    return { ok: false, detail: `the ledger tree could not be listed (git ls-tree exit ${list.code})` }
  }

  const newTreeDir = freshRecordsScratchDir(layout)
  const lines = list.stdout.split('\n').filter((line) => line.length > 0)
  let unreadable = 0
  let currentTarget = newTreeDir
  try {
    mkdirSync(newTreeDir, { recursive: true })
    for (const line of lines) {
      const parsed = parseLsTreeLine(line)
      if (parsed === null) continue
      const content = countedMaterialiseGit(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
      if (!content.ok) {
        unreadable += 1
        continue
      }
      currentTarget = path.join(newTreeDir, parsed.relPath)
      mkdirSync(path.dirname(currentTarget), { recursive: true })
      writeFileSync(currentTarget, content.stdout, 'utf8')
    }
  } catch (error) {
    discardScratchDir(rt, newTreeDir)
    return {
      ok: false,
      detail: `writing ${currentTarget} into the records scratch tree failed: ${describeError(error)}`
    }
  }

  if (unreadable > 0) {
    discardScratchDir(rt, newTreeDir)
    return { ok: false, detail: `${unreadable} record blob(s) in the ledger tree could not be read` }
  }

  return swapRecordsTreeIntoPlace(rt, layout, newTreeDir)
}
```

REPLACE:

```ts
const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseOutcome => {
  const newTreeDir = freshRecordsScratchDir(layout)
  const indexFile = path.join(recordsScratchRoot(layout), `materialise-index-${randomUUID()}`)

  try {
    mkdirSync(newTreeDir, { recursive: true })
  } catch (error) {
    return { ok: false, detail: `the records scratch tree could not be created: ${describeError(error)}` }
  }

  try {
    const readTree = countedMaterialiseGit(rt, layout.projectRoot, ['read-tree', ref], { indexFile })
    if (!readTree.ok) {
      discardScratchDir(rt, newTreeDir)
      return { ok: false, detail: `the ledger tree could not be read (git read-tree exit ${readTree.code})` }
    }

    const checkout = countedMaterialiseGit(
      rt,
      layout.projectRoot,
      ['checkout-index', '-a', `--prefix=${newTreeDir}${path.sep}`],
      { indexFile }
    )
    if (!checkout.ok) {
      discardScratchDir(rt, newTreeDir)
      return { ok: false, detail: `the ledger tree could not be written out (git checkout-index exit ${checkout.code})` }
    }
  } finally {
    discardIndexFile(rt, indexFile)
  }

  return swapRecordsTreeIntoPlace(rt, layout, newTreeDir)
}
```

Rationale: `B38` — `git read-tree` loads the whole ledger tree into a private index and `git checkout-index -a` writes every file out of it in one process, creating intermediate directories itself. Two subprocesses, whatever the record count.

Rejected: `git cat-file --batch`, one long-lived process fed every blob id on standard input. It is the smaller edit and needs no index file, but it returns the whole store's contents through the shared git helper's standard-output buffer, which `src/store/git.ts:68-72` leaves at Node's 1 MiB default; and its output frames each blob by BYTE length while that helper decodes to a string, so slicing the frames apart is wrong for any record containing a character outside ASCII. `checkout-index` writes to disk and never puts record content through a buffer at all.

Four properties of this pair were confirmed by running them against a fixture repository at git 2.55.0 before this plan was written, because each one is load-bearing:

- writing out a record whose content is not plain ASCII produces a byte-identical file;
- `git read-tree` given a reference that is a blob rather than a tree exits 128, so a corrupt ref is still a whole-call failure;
- `git checkout-index` given a tree that names a blob which does not exist exits 1, and leaves a partly-written directory, which is why the scratch directory is discarded before returning;
- the index file must sit inside a directory that already exists, which is why `newTreeDir` is created first.

### Step 7 — `src/merge/sync.ts` — DELETE the now-callerless line parser

FIND:

```ts
const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex === -1) return null
  const meta = line.slice(0, tabIndex).split(' ')
  const blobId = meta[2]
  if (blobId === undefined) return null
  return { blobId, relPath: line.slice(tabIndex + 1) }
}

type MaterialiseResult
```

REPLACE:

```ts
type MaterialiseResult
```

Rationale: `B38` removes its only caller on this path too.

### Step 8 — `src/merge/sync.ts` — REPLACE the merge path's per-record loop

FIND:

```ts
const materialiseRefToScratch = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseResult => {
  const listing = git(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!listing.ok) {
    return { ok: false, detail: `git ls-tree failed for ${ref}: ${listing.stderr.trim()}` }
  }

  const scratch = mkdtempSync(path.join(tmpdir(), 'logbook-sync-scratch-'))
  const lines = listing.stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = git(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) {
      rmSync(scratch, { recursive: true, force: true })
      return {
        ok: false,
        detail: `git cat-file could not read blob ${parsed.blobId} (${parsed.relPath}) from ${ref}: ${content.stderr.trim()}`
      }
    }
    const target = path.join(scratch, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }
  return { ok: true, scratch }
}
```

REPLACE:

```ts
const materialiseRefToScratch = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseResult => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'logbook-sync-scratch-'))
  const indexFile = path.join(scratch, 'materialise-index')
  try {
    const readTree = git(rt, layout.projectRoot, ['read-tree', ref], { indexFile })
    if (!readTree.ok) {
      rmSync(scratch, { recursive: true, force: true })
      return { ok: false, detail: `git read-tree failed for ${ref}: ${readTree.stderr.trim()}` }
    }
    const checkout = git(rt, layout.projectRoot, ['checkout-index', '-a', `--prefix=${scratch}${path.sep}`], {
      indexFile
    })
    if (!checkout.ok) {
      rmSync(scratch, { recursive: true, force: true })
      return { ok: false, detail: `git checkout-index failed for ${ref}: ${checkout.stderr.trim()}` }
    }
  } finally {
    rmSync(indexFile, { force: true })
  }
  return { ok: true, scratch }
}
```

Rationale: `B38` on the merge path. The index file is placed inside the scratch directory and removed before the directory is handed to the caller, so the record readers that walk `threads`, `decisions` and `sessions` never see it.

### Step 9 — the version bump, as a read-then-increment

Run these four commands in order. Do not hard-code a version pair.

```
node -e "const v=require('./package.json').version.split('.').map(Number); v[2]+=1; console.log(v.join('.'))"
```

Take the value it prints and call it `NEXT`. This unit's Conventional Commits type is `perf`, which increments the third number and leaves the first two alone.

```
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" NEXT
node -e "const fs=require('fs');const p='.claude-plugin/plugin.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" NEXT
node scripts/check-packaging.mjs
```

The last command must print `check-packaging: ok` and exit 0.

---

## 5. Tests

### 5.1 `test/store/open-cost.test.ts` — NEW FILE, given in full

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { getRecordScanCounter, openStore, resetRecordScanCounter } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SEEDED_RECORD_COUNT = 40
const RECORD_SCAN_CEILING = 8

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-open-cost-'))
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
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('store.open-does-not-read-every-record', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const changes: RecordChange[] = []
      for (let index = 0; index < SEEDED_RECORD_COUNT; index += 1) {
        changes.push(makeThread(rt, `open-cost-${index}`))
      }
      const committed = seeded.value.commit(changes, `seed ${SEEDED_RECORD_COUNT} threads`)
      assert.equal(committed.ok, true)

      resetRecordScanCounter()

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) return
      assert.equal(reopened.value.readThreads().length, SEEDED_RECORD_COUNT)

      assert.equal(
        getRecordScanCounter() <= RECORD_SCAN_CEILING,
        true,
        `opening a store holding ${SEEDED_RECORD_COUNT} records examined ${getRecordScanCounter()} directory entries, above the ceiling of ${RECORD_SCAN_CEILING}`
      )
    })
  })
})
```

### 5.2 `test/store/materialise-cost.test.ts` — NEW FILE, given in full

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { getMaterialiseCallCounter, resetMaterialiseCallCounter } from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const MATERIALISE_SUBPROCESS_CEILING = 3

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-materialise-cost-'))
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
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const materialiseSubprocessesFor = (recordCount: number): number =>
  withRepo((repo) =>
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) throw new Error('expected the seeding open to succeed')

      const changes: RecordChange[] = []
      for (let index = 0; index < recordCount; index += 1) {
        changes.push(makeThread(rt, `materialise-cost-${index}`))
      }
      const committed = seeded.value.commit(changes, `seed ${recordCount} threads`)
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) throw new Error('expected layoutFor to succeed')

      rmSync(join(layout.value.state, 'last-materialised'), { force: true })
      resetMaterialiseCallCounter()

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) throw new Error('expected the re-materialising open to succeed')
      assert.equal(reopened.value.readThreads().length, recordCount)

      return getMaterialiseCallCounter()
    })
  )

test('store.materialisation-cost-does-not-grow-with-record-count', () => {
  const few = materialiseSubprocessesFor(4)
  const many = materialiseSubprocessesFor(40)

  assert.equal(
    few,
    many,
    `materialising 4 records cost ${few} subprocesses and 40 records cost ${many}; the cost must not depend on how many records the ledger holds`
  )
  assert.equal(
    many <= MATERIALISE_SUBPROCESS_CEILING,
    true,
    `materialising 40 records cost ${many} subprocesses, above the ceiling of ${MATERIALISE_SUBPROCESS_CEILING}`
  )
})
```

### 5.3 No existing test file is modified by this half

The four already-shipped tests below are load-bearing for this change and must pass unmodified. They are listed so the implementer knows what they protect, not because anything is done to them.

| Test | File | What it protects |
|---|---|---|
| `read.absent-records-under-a-current-stamp-are-reported` | `test/store/materialisation.test.ts` | The anomaly report survives step 3. Asserts exactly one `store.materialisation-anomaly` event with `records_in_ref` 1 and `records_on_disk` 0 |
| `read.a-record-blob-that-cannot-be-read-is-a-failure` | `test/store/materialisation.test.ts` | A tree naming a missing blob still fails the whole call and leaves no stamp, after step 6 |
| `read.failed-materialisation-leaves-no-stamp` | `test/store/materialisation.test.ts` | A ledger ref pointing at a blob still fails, after step 6 |
| `read.a-pre-rename-stamp-still-opens` | `test/store/materialisation.test.ts` | A store carrying only the older stamp filename still opens without rebuilding, after step 3 |

### 5.4 Which test discharges which criterion

| Criterion | Discharged by |
|---|---|
| 1, 2 | `store.open-does-not-read-every-record` |
| 3 | `read.absent-records-under-a-current-stamp-are-reported` (already shipped) |
| 4, 6 | `store.materialisation-cost-does-not-grow-with-record-count` |
| 5 | `read.a-record-blob-that-cannot-be-read-is-a-failure` (already shipped) |
| 7 (`O5`) | `store.open-does-not-read-every-record` plus `roster.subprocess-census` in `test/store/roster.test.ts` (already shipped), which asserts a whole roster read over fifty threads costs at most one subprocess |
| 8 (`S1`) | `concurrent.second-process-destroys-nothing`, `concurrent.same-record-loser-refuses-rather-than-overwrites` and `concurrent.same-record-disk-diverges-from-ref-after-loser-rollback` in `test/store/concurrency.test.ts` (already shipped) |
| 9 | The measurement procedure in section 8 |

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time. At authoring time that is `e5f0195`.

### 6.1 `store.materialisation-cost-does-not-grow-with-record-count` — runs red directly

This test compiles on the parent, because both counter functions it imports already exist. Copy the file in and run it before applying any step:

```
node --test test/store/materialise-cost.test.ts
```

Expected: exit code 1, with this exact assertion message:

```
materialising 4 records cost 5 subprocesses and 40 records cost 41; the cost must not depend on how many records the ledger holds
```

This was run on the parent while authoring, and that is the message it produced.

### 6.2 `store.open-does-not-read-every-record` — cannot compile on the parent

The test imports `getRecordScanCounter` and `resetRecordScanCounter` from `src/store/records.ts`. Neither exists on the parent, so the file does not compile there and cannot be run red as written.

Substitute procedure, run on the parent commit, before applying any step:

1. Apply this single temporary edit to `src/store/records.ts`.

   FIND:

   ```ts
   const diskRecordCount = (dir: string): number => {
     try {
       let total = 0
       for (const entry of readdirSync(dir, { withFileTypes: true })) {
   ```

   REPLACE:

   ```ts
   let recordScanCount = 0

   export const resetRecordScanCounter = (): void => {
     recordScanCount = 0
   }

   export const getRecordScanCounter = (): number => recordScanCount

   const diskRecordCount = (dir: string): number => {
     try {
       let total = 0
       for (const entry of readdirSync(dir, { withFileTypes: true })) {
         recordScanCount += 1
   ```

2. Copy in `test/store/open-cost.test.ts` and run:

   ```
   node --test test/store/open-cost.test.ts
   ```

   Expected: exit code 1, with this exact assertion message:

   ```
   opening a store holding 40 records examined 41 directory entries, above the ceiling of 8
   ```

3. Discard the temporary edit:

   ```
   git checkout -- src/store/records.ts
   ```

This substitute was run on the parent while authoring. `npm run typecheck` exited 0 with the temporary edit applied, and the assertion message above is the one it produced.

---

## 7. Inertness mutation

One per acceptance criterion that carries a behavioural change. Each mutation is applied to the finished change, the named test must turn red, then the mutation is reversed.

### 7.1 Criterion 1 and 2 — `B37`

Revert: in `src/store/records.ts`, replace

```ts
  if (outcome.materialised) return { ok: true, value: undefined }

  if (holdsAnyRecord(layout.records)) return { ok: true, value: undefined }
```

with

```ts
  if (holdsAnyRecord(layout.records)) return { ok: true, value: undefined }
```

and inside `holdsAnyRecord`, replace

```ts
      if (entry.isFile() && entry.name.endsWith('.json')) return true
```

with

```ts
      if (entry.isFile() && entry.name.endsWith('.json')) { continue }
```

Run: `node --test test/store/open-cost.test.ts`

Must turn red with: `opening a store holding 40 records examined 41 directory entries, above the ceiling of 8`

Restore: undo both edits and re-run; the test must pass.

### 7.2 Criterion 4 and 6 — `B38`

Revert: in `src/store/read-path.ts`, replace the two-command body of `materialiseTree` with the parent's per-blob loop exactly as quoted in section 2.5, and restore `parseLsTreeLine` exactly as quoted in section 2.4.

Run: `node --test test/store/materialise-cost.test.ts`

Must turn red with: `materialising 4 records cost 5 subprocesses and 40 records cost 41; the cost must not depend on how many records the ledger holds`

Restore: re-apply steps 4 and 6 and re-run; the test must pass.

---

## 8. Full verification

Run in this order.

### 8.1 Typecheck

```
npm run typecheck
```

Expect exit code 0 and no output.

### 8.2 Packaging

```
node scripts/check-packaging.mjs
```

Expect exit code 0 and the output `check-packaging: ok`.

### 8.3 The two receipts

```
node --test test/store/open-cost.test.ts test/store/materialise-cost.test.ts
```

Expect exit code 0 and the output to contain `pass 2` and `fail 0`.

### 8.4 The full suite

```
npm test
```

Expect exit code 0 and the output to contain `fail 0`. The expected test count is 438: the 436 already on the parent plus the two this half adds. Write the count the run actually printed into the pull request body rather than the one written here.

Any failure of `concurrent.distinct-ids` in `test/spawn/decisions.test.ts` is IN SCOPE for
this unit's surface and must be reported, never re-run away. STOP and report; do not
improvise, and do not edit, skip, focus or delete any test.

### 8.5 The measurement, before and after

The pull request must carry measured numbers, so this procedure is run twice: once on the parent commit and once on the change. It drives a throwaway fixture store in a temporary directory. It must never be pointed at this machine's own ledger, and no `mcp__plugin_logbook_ledger__*` tool is ever called.

Write this file to a scratch directory outside the repository working tree, as `bench.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '<ABSOLUTE PATH TO THE CHECKOUT>/src/store/records.ts'
import { layoutFor } from '<ABSOLUTE PATH TO THE CHECKOUT>/src/store/layout.ts'
import { getMaterialiseCallCounter, resetMaterialiseCallCounter } from '<ABSOLUTE PATH TO THE CHECKOUT>/src/store/read-path.ts'
import type { Runtime } from '<ABSOLUTE PATH TO THE CHECKOUT>/src/runtime/runtime.ts'
import type { RecordChange } from '<ABSOLUTE PATH TO THE CHECKOUT>/src/store/write-path.ts'

const RECORD_COUNT = Number(process.argv[2] ?? '200')
const REPS = 11

let seq = 0
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ulid = (): string => {
  let value = seq
  seq += 1
  const chars: string[] = []
  for (let i = 0; i < 16; i += 1) {
    chars.unshift(ALPHABET[value % 32] as string)
    value = Math.floor(value / 32)
  }
  return `01ARZ3NDEK${chars.join('')}`
}

const repo = mkdtempSync(join(tmpdir(), 'lb-bench-repo-'))
const pluginData = mkdtempSync(join(tmpdir(), 'lb-bench-data-'))
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
execFileSync('git', ['-C', repo, 'init', '-q', '--initial-branch=main'], { env: gitEnv })
execFileSync('git', ['-C', repo, 'config', 'user.name', 'Bench'], { env: gitEnv })
execFileSync('git', ['-C', repo, 'config', 'user.email', 'bench@logbook.test'], { env: gitEnv })
writeFileSync(join(repo, 'README.md'), 'bench\n')
execFileSync('git', ['-C', repo, 'add', 'README.md'], { env: gitEnv })
execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { env: gitEnv })

const rt: Runtime = {
  now: () => new Date(1700000000000 + seq).toISOString(),
  ulid,
  env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData },
  cwd: '/bench',
  log: () => {},
  sessionId: 'bench'
}

const makeThread = (slug: string): RecordChange => ({
  kind: 'thread',
  record: {
    id: ulid(),
    slug,
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'a goal of realistic length for a stored record',
      next_step: 'the next step, also of a realistic length',
      last_session: 'what happened last session, at length',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const seeded = openStore(rt, repo)
if (!seeded.ok) throw new Error('bench: the seeding open failed')
const changes: RecordChange[] = []
for (let i = 0; i < RECORD_COUNT; i += 1) changes.push(makeThread(`bench-thread-${i}`))
const committed = seeded.value.commit(changes, 'seed')
if (!committed.ok) throw new Error(`bench: the seeding commit failed: ${committed.detail}`)

const layout = layoutFor(rt, repo)
if (!layout.ok) throw new Error('bench: layoutFor failed')

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

const warm: number[] = []
for (let i = 0; i < REPS; i += 1) {
  const started = performance.now()
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error('bench: a warm open failed')
  warm.push(performance.now() - started)
}

const cold: number[] = []
let materialiseCalls = 0
for (let i = 0; i < REPS; i += 1) {
  rmSync(join(layout.value.state, 'last-materialised'), { force: true })
  resetMaterialiseCallCounter()
  const started = performance.now()
  const opened = openStore(rt, repo)
  const elapsed = performance.now() - started
  if (!opened.ok) throw new Error('bench: a materialising open failed')
  materialiseCalls = getMaterialiseCallCounter()
  cold.push(elapsed)
}

console.log(
  JSON.stringify({
    records: RECORD_COUNT,
    warm_open_ms_median: Number(median(warm).toFixed(2)),
    materialise_open_ms_median: Number(median(cold).toFixed(2)),
    materialise_subprocesses: materialiseCalls
  })
)

rmSync(repo, { recursive: true, force: true })
rmSync(pluginData, { recursive: true, force: true })
```

Replace `<ABSOLUTE PATH TO THE CHECKOUT>` with the absolute path of the checkout being measured. Run it at two record counts:

```
node --experimental-strip-types --no-warnings <SCRATCH>/bench.ts 50
node --experimental-strip-types --no-warnings <SCRATCH>/bench.ts 200
```

Each command prints one line of JSON. Record `materialise_open_ms_median` and `materialise_subprocesses` for each count, on the parent and on the change, and put those four numbers in the pull request body.

The statistic reported is the median of eleven repetitions. The median is used rather than the mean because the first repetition pays a one-off cost that is not part of what is being measured.

**The numbers this procedure produced while the plan was written**, against the parent and against the finished change on Node v26.4.0 and git 2.55.0:

| Records | Materialising open, parent | Materialising open, change | Subprocesses, parent | Subprocesses, change |
|---|---|---|---|---|
| 50 | 472.59 ms | 84.26 ms | 51 | 2 |
| 200 | 1742.22 ms | 110.00 ms | 201 | 2 |
| 800 | not measured on the parent | 156.53 ms | not measured on the parent | 2 |

The subprocess count on the parent is exactly one per record plus one. On the change it is two at every record count.

**Warm store open** — the path `B37` changes — was measured separately, loading both versions into one process and alternating between them so that process start-up noise cannot be mistaken for a difference. Median of thirty-one repetitions:

| Records | Parent | Change |
|---|---|---|
| 200 | 6.51 ms | 6.66 ms |
| 800 | 6.61 ms | 6.82 ms |

Warm open is dominated by the single `git rev-parse` subprocess it already performed, so `B37` does not move it at store sizes reachable today. What `B37` changes is the growth term. The directory walk in isolation, median of twenty-one repetitions in one process:

| Records | Directory entries examined, parent | Parent | Directory entries examined, change | Change |
|---|---|---|---|---|
| 50 | 54 | 0.100 ms | 5 | 0.123 ms |
| 200 | 204 | 0.131 ms | 5 | 0.135 ms |
| 800 | 804 | 0.342 ms | 5 | 0.136 ms |
| 3 200 | 3 204 | 1.283 ms | 5 | 0.133 ms |
| 12 800 | 12 804 | 5.289 ms | 5 | 0.134 ms |

The entries examined stop growing entirely; the time stops growing from about eight hundred records onward. Below that the change is very slightly slower, by about a fiftieth of a millisecond, which is a fortieth of the cost of the `git rev-parse` on the same path.

### 8.6 A finding this change must carry: the effect on the tracked store defect

There is a store defect that is reproduced, tracked and deliberately **not fixed** by this unit. Stated plainly, because the modules it lives in are the modules this plan edits:

> When several processes write records at the same time, a record can end up present in the ledger ref and absent from `records/` on disk, with the materialisation stamp equal to the ledger ref — which makes the hole permanent, because the stamp-versus-ref comparison then never rebuilds. It was reproduced at 46 of 60 iterations under 24 concurrent writers.

Fixing it is **above this unit's ceiling** and is tracked separately. This plan does not fix it, does not hide it, and does not touch the test that detects it.

But `B38` changes materialisation itself, so the effect on how reachable that defect is must be stated rather than left unexamined.

**Finding: this change makes the defect strictly less reachable, and does not make it more reachable. This is reasoned from the source and from the measured subprocess counts and timings above; it was NOT measured by re-running the 24-writer reproduction.**

The reasoning, in three parts:

1. **The three sites that produce the defect are untouched.** The stamping of the whole new ref after a write, the permanent short-circuit once the stamp equals the ref, and the directory swap that replaces the records tree are all left exactly as they are by every step in this plan.
2. **The window in which the damage happens gets much shorter.** The damage occurs when another process writes a record to disk between the moment this process reads the ledger ref and the moment it swaps its rebuilt tree over the top. That window is the whole of `materialiseTree`. It was measured at 1742 ms for a 200-record store and is 110 ms after this change — about one sixteenth. A shorter window is a smaller chance of an interleaving, never a larger one.
3. **The rebuilt tree has exactly the same contents as before.** Both versions write out precisely the files the ledger tree names, and both fail the whole call rather than swapping a partial tree into place. This was confirmed by running `git checkout-index` against a tree naming a missing blob: it exits non-zero and leaves a partly-written directory, which the code discards before returning.

**The consequence that must not be misread:** because the window shrinks, the already-shipped `concurrent.distinct-ids` test may fail less often after this change than before it. That is a smaller chance of observing the defect, not a fix. No green run of that test, before or after this change, is evidence the defect is gone.

`B37` does not change the defect's reachability at all. The only detection it could have removed is the anomaly report, and step 3 keeps that report firing in exactly the case that produces the defect's signature — a current stamp over a records directory holding nothing.

**This finding is a stop condition, not a note.** Should any evidence appear that this change makes the defect MORE reachable rather than less — a `concurrent.distinct-ids` failure, a new interleaving, or a measurement contradicting the reasoning above — STOP and report; do not improvise, and do not absorb it into this unit. Section 11.5 carries the same instruction.

---

## 9. Commits

Refactor and behaviour change never share a commit. There are three commits.

### Commit 1

```
perf(store): read the ledger tree in one batched checkout
```

Files: `src/store/read-path.ts`, `src/merge/sync.ts`, `test/store/materialise-cost.test.ts`

Contains plan steps 4, 5, 6, 7, 8 and test file 5.2.

### Commit 2

```
perf(store): stop walking every record when opening the store
```

Files: `src/store/records.ts`, `test/store/open-cost.test.ts`

Contains plan steps 1, 2, 3 and test file 5.1.

### Commit 3

```
chore: bump the plugin version
```

Files: `package.json`, `.claude-plugin/plugin.json`

Contains plan step 9.

---

## 10. Pull request

Opened with the operator's global tool. Ad-hoc `gh pr create`, `gh api` posts to the pulls endpoint and the GitHub pull-request tool are refused at the gate. A title and body are fixed at creation and never rewritten afterwards, so `gh pr edit` is never run.

Replace each number in the `--verified` lines below with the number section 8 actually printed on this machine. Every `--verified` line names a check listed in section 8; a line whose check you did not run becomes `--not-verified "<thing> - not run"` instead.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head perf/u2-store-cost-and-safety-a \
  --base main \
  --title "perf(store): read the ledger tree once instead of once per record" \
  --what "Copying stored records out of git onto disk now costs two git processes however many records there are, instead of one process per record." \
  --what "Opening the store stops reading every record file just to find out whether any exist." \
  --why "Every store open walked the whole record tree to compute a count that was only ever compared against zero, and every rebuild started a separate git process for each record, so both got slower as history grew." \
  --risk "Records are now written to disk by git itself rather than by this code, so a failure mode inside that command surfaces as a whole-rebuild failure rather than a per-record one." \
  --verified "npm test - 438 tests, 0 fail, exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok, exit 0" \
  --verified "rebuild of a 200-record store - 1742 ms before, 110 ms after" \
  --verified "git processes to rebuild a 200-record store - 201 before, 2 after" \
  --not-verified "directory entries read when opening a 12800-record store - 12804 before and 5 after, measured during planning and not re-run here" \
  --not-verified "the tracked concurrent-write defect - not fixed here and not measured; this change shortens the window it needs, which makes it rarer, not absent"
```

**Diff size, measured by applying every step of this plan to a throwaway copy of the tree and reading `git diff --numstat`:**

| Part | Insertions | Deletions | Total |
|---|---|---|---|
| `src/store/read-path.ts` | 30 | 37 | 67 |
| `src/store/records.ts` | 30 | 13 | 43 |
| `src/merge/sync.ts` | 14 | 27 | 41 |
| `test/store/materialise-cost.test.ts` (new) | 95 | 0 | 95 |
| `test/store/open-cost.test.ts` (new) | 78 | 0 | 78 |
| version bump | 2 | 2 | 4 |
| **Total** | **249** | **79** | **328** |

Production code is 151 of those lines, tests are 173, and the version bump is the remaining 4. The number is above the 200-line target and below the 400-line ceiling, so this half is not split further.

---

## 11. Stop conditions

Each of these invalidates the plan. In every case: **STOP and report; do not improvise.**

### 11.1 `U1` has not landed

Before editing `src/store/records.ts`, run:

```
test -f src/schema/field-class.ts && grep -c "POINTER_PATTERN" src/schema/field-class.ts
```

This must print a number of `1` or greater. `src/schema/field-class.ts` is the module `U1` creates to declare every record field's class, and it is what may add a `binding` branch to `validateChange` in `src/store/records.ts`. A missing file or a non-zero exit means `U1` has not merged and this branch was cut too early. STOP and report; do not improvise.

The check is anchored on that file rather than on a commit subject because `U1` ships as four separate pull requests whose subjects do not share a common string, so a subject search would report zero even after `U1` had fully landed.

Then confirm the content arrived rather than trusting a merge status:

```
git merge-base --is-ancestor origin/main HEAD
```

If this exits non-zero, the branch is not on top of the current `main`. STOP and report; do not improvise.

### 11.2 A FIND string does not match exactly once

`U1` may have changed `src/store/records.ts`, including adding a `binding` branch to `validateChange`. Before applying any step, run each of these and confirm each prints exactly `1`:

```
grep -c "^import { readdirSync } from 'node:fs'$" src/store/records.ts
grep -c "^const diskRecordCount = (dir: string): number => {$" src/store/records.ts
grep -c "^  if (diskRecordCount(layout.records) > 0) return { ok: true, value: undefined }$" src/store/records.ts
grep -c "^const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {$" src/store/read-path.ts
grep -c "^const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseOutcome => {$" src/store/read-path.ts
grep -c "^const discardScratchDir = (rt: Runtime, dir: string): void => {$" src/store/read-path.ts
grep -c "^const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {$" src/merge/sync.ts
grep -c "^const materialiseRefToScratch = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseResult => {$" src/merge/sync.ts
```

If any prints anything other than `1`, the file has moved under this plan. STOP and report; do not improvise.

### 11.3 The two version files disagree before the change

```
node -e "const a=require('./package.json').version;const b=require('./.claude-plugin/plugin.json').version;console.log(a===b?'match':'MISMATCH '+a+' '+b)"
```

If this prints anything other than `match`, STOP and report; do not improvise. A version merely higher than `1.6.1` is not a stop condition — it means the ladder shifted, and step 9 reads whatever is there and increments it.

### 11.4 The suite

```
Run: npm test
Any failure of `concurrent.distinct-ids` in `test/spawn/decisions.test.ts` is IN SCOPE for
this unit's surface and must be reported, never re-run away. STOP and report; do not
improvise, and do not edit, skip, focus or delete any test.
```

### 11.5 The tracked store defect becomes more reachable

Section 8.6 reasons that this change makes the tracked concurrent-write defect less reachable, never more. That reasoning is the thing being relied on. Should anything contradict it — a `concurrent.distinct-ids` failure, or any measurement showing the defect is easier to reach after this change than before — STOP and report; do not improvise, and do not fix, skip, delete, focus or quarantine the defect or its test. Fixing it is outside this unit.

### 11.6 Never run an install

`node_modules` is tracked in this repository and an install rewrites tracked files. Never run `npm ci` or `npm install`, for any reason, including a dependency that appears to be missing. If anything appears to require one, STOP and report; do not improvise.
