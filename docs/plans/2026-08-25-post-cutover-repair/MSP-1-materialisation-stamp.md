# MSP-1 — The materialisation stamp tells the truth

## 0. Identity

- **Closes:** D4, D5, and the `stop-gate` half of D6.
- **Depends on:** MSP-0 (`fix/msp-0-utf8-source-census`), for one reason only: MSP-0 removes the pinned version literal from `test/contract/cutover-manifests-agree.test.ts`, without which this plan's version bump turns that test red. No source change in this plan depends on MSP-0. The concrete, checkable precondition is stop condition 7 in section 11.
- **Required by:** MSP-6, which consumes the renamed stamp file and the renamed function.
- **Branch name:** `fix/msp-1-materialisation-stamp`, cut from `main`, pull request targets `main`.
- **Version bump:** Baseline `1.0.1` -> `1.0.2` per orchestrator ruling O1. The step in section 4 is written as a read-then-increment, so a shifted ladder does not invalidate it.
- **SPEC anchors:** section 7 MSP-1; section 6 rulings R4 and R5; section 5 defects D4, D5, D6.

### What this MSP is for, in plain words

The plugin keeps a copy of the project's logbook records on disk. That copy is rebuilt ("materialised") out of a git ref named `refs/logbook/ledger`, which is the real source of truth. Next to that copy the plugin writes one small file — a **stamp** — holding the commit id the copy was last built from. On the next run, if the stamp already names the current commit, the plugin skips the rebuild.

Two things are wrong with that today.

1. The rebuild can fail and the stamp is written anyway. The stamp then claims a rebuild that never happened, and every later run skips the rebuild because the stamp looks current. The copy stays empty forever and nothing reports it.
2. The stamp is named `last-synced`, which reads as "last backed up to the shared copy". It records nothing of the kind. It records the last local rebuild.

This MSP makes the stamp truthful and renames it for what it actually records.

---

## 1. Acceptance criteria (the ceiling)

Verbatim from SPEC section 7, MSP-1:

1. A test in which `ls-tree` fails asserts the stamp is **not** written and the next `openStore` re-attempts materialisation rather than short-circuiting. Red on the parent.
2. A test asserting a store whose records are absent while the stamp names the current tip re-materialises or reports, and never silently returns zero threads. Red on the parent.
3. A test asserting `stop-gate` does not leave a store holding `state/` and an empty `records/`.
4. A store carrying the pre-rename filename still opens.
5. Inertness: reverting the stamp-on-success guard turns criterion 1 red again.
6. `npm test` green.

That list is the complete definition of done for this MSP. Anything discovered above it is appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence, and is **not** folded into this plan.

---

## 2. Ground truth

Every excerpt below was read from the working tree on branch `docs/post-cutover-repair-spec`, whose `src/`, `test/`, `hooks/` and `scripts/` trees are byte-identical to `main` at `0ade582`. Line numbers are the ones actually read.

### 2.1 `src/store/read-path.ts:38-55` — the stamp helpers

```ts
const lastSyncedPath = (layout: StoreLayout): string => path.join(layout.state, 'last-synced')

const readLastSynced = (layout: StoreLayout): string | null => {
  try {
    return readFileSync(lastSyncedPath(layout), 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const writeLastSynced = (layout: StoreLayout, value: string): void => {
  writeFileSync(lastSyncedPath(layout), value, 'utf8')
}

export const markSynced = (layout: StoreLayout, ref: string): void => {
  writeLastSynced(layout, ref)
}
```

What is wrong: the filename literal `'last-synced'` and the exported name `markSynced` both claim a synchronisation with a remote. Nothing on this path contacts a remote — `writeRecords` (`src/store/write-path.ts:141-222`) runs `git commit-tree` and `git update-ref` against the local repository only, and the caller that writes this stamp is `src/store/records.ts:112`, immediately after that purely local write.

### 2.2 `src/store/read-path.ts:66-83` — `materialiseTree`

```ts
const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): void => {
  const list = countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!list.ok) return

  rmSync(layout.records, { recursive: true, force: true })
  mkdirSync(layout.records, { recursive: true })

  const lines = list.stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = countedMaterialiseGit(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) continue
    const target = path.join(layout.records, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }
}
```

What is wrong: the return type is `void`, so neither failure exit is observable by the caller. Line 68 (`if (!list.ok) return`) abandons the whole rebuild silently. Line 78 (`if (!content.ok) continue`) drops one record and carries on, producing a partial copy the caller cannot distinguish from a complete one.

### 2.3 `src/store/read-path.ts:85-99` — `syncWorkingCopy`

```ts
export const syncWorkingCopy = (rt: Runtime, layout: StoreLayout, runGit: typeof git = countedGit): void => {
  const current = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
  const currentValue = current.ok ? current.stdout.trim() : null
  const cached = readLastSynced(layout)

  if (currentValue === cached) return

  if (currentValue === null) {
    writeLastSynced(layout, '')
    return
  }

  materialiseTree(rt, layout, currentValue)
  writeLastSynced(layout, currentValue)
}
```

What is wrong: line 98 writes the stamp unconditionally, one statement after a call whose failure it cannot see. Line 90 then short-circuits every later call whose ref equals that stamp. Together these two lines are the mechanism by which a store becomes permanently empty and permanently reported as current.

### 2.4 `src/store/records.ts:93` and `:110-114` — `openStore`

```ts
  syncWorkingCopy(rt, storeLayout)
```

```ts
      const result = writeRecords(rt, storeLayout, changes, message)
      if (result.ok) {
        markSynced(storeLayout, result.after)
      }
      return result
```

What is wrong: line 93 discards the outcome of the rebuild, so `openStore` returns a `Store` whose records directory may be empty while `refs/logbook/ledger` holds records. Nothing compares the two.

### 2.5 `src/store/records.ts:9-10` — the imports that must move with the rename

```ts
import { createStoreDirectories, layoutFor, type StoreLayout } from './layout.ts'
import { markSynced, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
```

What is wrong: line 10 imports `markSynced` by its old name, so the rename does not compile until this line moves with it; and the file imports neither `git` nor `LEDGER_REF`, both of which the record-count comparison in step 5 needs.

### 2.6 `src/store/records.ts:74-79` — the insertion point for the record-count comparison

```ts
      detail
    )
  }
}

export const openStore = (rt: Runtime, projectRoot: string): Ok<Store> | Refusal => {
```

What is wrong: nothing here is defective. This is the closing brace of `checkRecordsReadable` and the opening line of `openStore`, quoted because step 5 inserts the new helpers between them and needs an anchor that appears exactly once.

### 2.7 `src/server/tools/resolve_conflict.ts:13` and `:641` — the third call site

This file holds one literal NUL byte at offset 11234, which makes `grep -r` skip it silently. Read with `node -e "process.stdout.write(require('fs').readFileSync('src/server/tools/resolve_conflict.ts','latin1'))"`. Its highest byte value is 125, and a UTF-8 read-and-write round trip of the whole file is byte-identical, so an ordinary text edit of it is safe.

Line 13:

```ts
import { markSynced } from '../../store/read-path.ts'
```

Line 641:

```ts
    markSynced(layout.value, commitResult.after)
```

What is wrong: nothing here is defective either. It is listed because the SPEC's change list for this MSP does not name it, and the rename does not compile without it. See section 3.

### 2.8 `src/store/layout.ts:85-92` — `createStoreDirectories`

```ts
export const createStoreDirectories = (layout: StoreLayout): void => {
  mkdirSync(layout.records, { recursive: true })
  mkdirSync(layout.state, { recursive: true })
  const originPath = path.join(layout.state, 'origin.json')
  if (!existsSync(originPath)) {
    writeFileSync(originPath, JSON.stringify({ project_root: layout.projectRoot }), 'utf8')
  }
}
```

What is wrong: nothing, for the caller it was written for. It becomes wrong when a caller needs only `layout.state`, because it also creates an empty `records/` directory and writes `state/origin.json`, which together look like a materialised store.

### 2.9 `src/hooklib/stop-gate.ts:4` and `:57-59` — the half-built store

```ts
import { createStoreDirectories, layoutFor } from '../store/layout.ts'
```

```ts
  const pledge = findLastResumeBriefing(event.transcript_path)
  createStoreDirectories(layout.value)
  writeGate(rt, layout.value.state, event.session_id)
```

What is wrong: the stop hook needs one directory, `layout.state`, so it can write `stop-gate.json` into it. It calls a function that also creates an empty `records/` directory and writes `state/origin.json`. That leaves a directory tree that looks like a store, holds no records, and carries no stamp.

### 2.10 `test/contract/skills.test.ts:282` and `test/spawn/resume.test.ts:294` — the two sentinel sets

Both files carry this byte-identical line:

```ts
const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced'])
```

What is wrong: the literal names the pre-rename filename. Each set excludes known non-pointer files from a census of the `state/` directory (`test/contract/skills.test.ts:292`, `test/spawn/resume.test.ts:301`) that `JSON.parse`s every file it does not exclude. The stamp holds a bare sha, not JSON, so after the rename the new filename would be parsed and both censuses would turn red.

### 2.11 `package.json:3` and `.claude-plugin/plugin.json:3` — the two version lines

Both files carry this byte-identical line at line 3:

```json
  "version": "1.0.0",
```

What is wrong: nothing, at the baseline. It is quoted because step 15 rewrites exactly this line in both files and nothing else, and because invariant I4 requires the two to stay equal.

### 2.12 The three tests that constrain the design

- `test/store/read-path.test.ts:115-137`, test name `read.refreshes-only-on-ref-move`, asserts `getMaterialiseCallCounter()` is `0` across a second `openStore` over an already-materialised store. Any unconditional extra materialisation in `openStore` breaks it.
- `test/store/roster.test.ts:50-80`, test name `roster.is-subprocess-free`, resets the subprocess counter **after** `openStore` returns, so work done inside `openStore` is not counted.
- `test/hooks/stop-gate-fresh-data-dir.test.ts:24-50`, test name `hook.stop-survives-a-fresh-data-directory`, asserts that after a stop run the `CLAUDE_PLUGIN_DATA` directory is non-empty and contains a `stop-gate.json`. The stop hook must therefore keep creating `layout.state`.

### 2.13 Suite idiom this plan's tests follow

Established by reading `test/store/read-path.test.ts`, `test/store/write-path.test.ts`, `test/hooks/stop-gate-fresh-data-dir.test.ts` and `test/support/`:

- The suite contains **no** `describe`, `it`, `suite`, `before`, `after`, `beforeEach` or `afterEach` anywhere. Every test is a flat top-level `test('name', () => { ... })` from `node:test`. This plan therefore gives exact `test(...)` name strings and no `describe(...)` names, because none exist to match.
- `import assert from 'node:assert/strict'` and `import { test } from 'node:test'`.
- Test names are `<subject>.<kebab-case-predicate>`, all lowercase, British `-ise` spelling.
- Temporary directories come from `mkdtempSync(join(tmpdir(), 'prefix-'))` inside a file-local higher-order wrapper whose `finally` calls `rmSync(dir, { recursive: true, force: true })`. `test/contract/temp-dirs-are-atomic.test.ts` enforces this: `mkdtempSync` is allowed, a `mkdirSync` whose path argument references a clock is forbidden, and `cpSync` halts the census.
- The project repository fixture is `withRepo` from `test/support/git-fixture.ts`.
- Every relative import carries the `.ts` extension (`allowImportingTsExtensions`), and type-only imports use `import type`.

### 2.14 The probes this MSP inherits

- `docs/audits/2026-08-25-post-cutover-repair-probes/repro-f3.ts` PROBE 2 (lines 51-59) creates a store root through `createStoreDirectories` with no materialisation and prints its contents; PROBE 3 (lines 62-76) wipes the records while the stamp still names the tip, reopens, and prints `threads visible after reopen : 0 (0 = store stays EMPTY, no re-materialise, no error)`.
- `docs/audits/2026-08-25-post-cutover-repair-probes/repro-f6.ts` establishes, at lines 53-59, that after a purely local commit the stamp equals the local tip while `origin` carries no ledger ref at all, and at lines 62-82 that a failed sync leaves the stamp advanced anyway.

Nothing in the probes directory is a test, and none of it is in the tsconfig include set. Section 5 re-authors PROBE 2 and PROBE 3 as committed tests; section 3.7 records why `repro-f6.ts` produces no separate test in this MSP.

---

## 3. Divergences from the SPEC

**3.1 A third `markSynced` call site exists that the SPEC's change list does not name.**

SPEC section 7, MSP-1 lists the changes as `src/store/read-path.ts`, `src/store/records.ts:112`, `src/hooklib/stop-gate.ts:58`, and the two test sentinel sets. A closed census over every tracked file found a fourth code site: `src/server/tools/resolve_conflict.ts:13` (the import) and `:641` (the call). Verbatim text for both is in section 2.7.

Ruling applied: report it and route around it. The rename cannot compile without it, and `npm test` must pass on the merge commit. Steps 8 and 9 of section 4 therefore edit that file. This adds two changed lines and no behaviour.

**3.2 The grep-invisible file is valid UTF-8; its invisibility is a NUL byte, not a non-UTF-8 byte.**

SPEC section 5, D16 describes `src/server/tools/resolve_conflict.ts` as carrying "a non-UTF-8 byte". Measured: the file's highest byte value is 125, it holds exactly one NUL byte (0x00) at offset 11234, and a UTF-8 read-and-write round trip is byte-identical. A NUL byte is valid UTF-8; what it triggers is `grep`'s binary-content heuristic.

Consequence for this plan, and it is load-bearing: a post-rename sweep run as `grep -rn markSynced src` returns nothing **whether or not the call site at line 641 still exists**. Section 8 therefore specifies `git grep`, which has no binary-skip on tracked text and does find both hits. Correcting D16 itself belongs to MSP-0 and is not touched here.

**3.3 The `openStore` record-count comparison is R5's first clause, not its second.**

SPEC section 7, MSP-1 says it implements "ruling R4 and clause 2 of R5". R5's numbered clause 1 is the `openStore` record-count comparison and its clause 2 is the `stop-gate` change. This plan implements both, because acceptance criterion 2 cannot be discharged by the stamp-on-success guard alone: in that scenario the stamp was written at a moment when materialisation genuinely succeeded and the records were deleted afterwards, so the guard never runs. Only a comparison against the ref detects it.

**3.4 A failed materialisation makes `openStore` refuse, rather than open and log.**

Ruling R5 clause 1 requires "a **named, reported anomaly**, never silence" but does not say through which surface. Chosen: `openStore` returns a `Refusal` when materialisation fails or when the ref holds records the store could not materialise after one repair attempt. Rejected, in one line: open the store and only log the failure, which leaves the silent-empty-store symptom reachable by every caller that does not read the log, and that symptom is the whole defect.

**3.9 The anomaly is reported and not healed, because healing breaks an existing test.**

Acceptance criterion 2 permits either outcome: a store whose records are absent "re-materialises **or** reports, and never silently returns zero threads". An earlier draft of this plan healed — it cleared the stamp and re-materialised. Measured against the real suite, that turns `test/spawn/resume.test.ts` red: its fixture deletes a thread's only record file on purpose to simulate a pointer whose thread is gone, and expects `park_thread` to answer `stale-pointer-released`. Healing resurrects the file, so `park_thread` answers `parked` instead. That is one new suite failure, which breaks acceptance criterion 6 and invariant I1.

Chosen: report. `openStore` emits the named `store.materialisation-anomaly` event and returns the store, so a caller that reads zero threads can no longer confuse an unmaterialised store with a project that has no ledger. Rejected, in one line: refuse instead of reporting, which would make `openStore` fail outright in that same fixture and break `park_thread` more severely than healing did.

A failed materialisation still refuses; that is a different path, it is what divergence 3.4 rules, and it does not touch this fixture.

**3.5 The ladder lands on `1.1.1`, not `1.1.0`.** SPEC section 7 states the ladder lands on `1.1.0`; MSP-9 merges last and the ladder lands on `1.1.1`. This does not affect any step in this plan.

**3.6 The pull request tool path.** SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib` in this repository; the tool is the operator's global one at `node ~/.claude/lib/git/pr.mjs pr-create`, which section 10 uses.

**3.7 `repro-f6.ts` yields no separate test, and this is a deliberate ruling rather than an omission.**

That probe demonstrates that the stamp names the local tip while `origin` holds no ledger ref — that is, that the file called `last-synced` is not evidence about any remote. There is no assertion that can fail on that today and pass afterwards, because the code's behaviour is unchanged by this MSP: the stamp still records the local materialisation point. What changes is its **name**, and the rename is what discharges the finding. Criterion 4's test pins that a store written under either name still opens. The assertion that the stamp is not a push receipt is authored in MSP-6, which owns the sync surface. Chosen: no separate test here. Rejected, in one line: assert in this MSP that the stamp differs from the remote sha, which would require this MSP's tests to build a remote and push, pulling the whole sync surface into a change that does not touch it.

**3.8 The manifest-agreement test pins a version literal, and this plan does not repair it.**

`test/contract/cutover-manifests-agree.test.ts:8` reads `const EXPECTED_VERSION = '1.0.0'`, and lines 54-58, 63-67 and 77 assert both manifests and the wire version equal it. Every version bump in this ladder therefore turns `cutover.manifests-agree` red, which would make this plan's own `npm test` acceptance criterion unreachable.

That repair is owned by MSP-0, permanently and once, by deriving the expected version from `package.json` instead of pinning a literal. This plan writes no edit to that file: re-pinning the constant to a new number here would be editing a change-detector test, and it would break again the moment the ladder order shifted. The precondition is checkable and appears as stop condition 7 in section 11.

---

## 4. The change, step by step

Apply in the order given. Steps 1 through 8 are the rename and leave the tree type-correct; steps 9 through 16 are the behaviour change and leave the tree type-correct; step 17 is the version bump. Section 9 maps these ranges onto commits. Within a range an intermediate step may leave an unused import or an ignored return value; `tsconfig.json` sets `strict` but not `noUnusedLocals`, so neither breaks the typecheck.

Every FIND string below was copied from the file named and is unique within that file.

### Step 1 — `src/store/read-path.ts` — REPLACE the stamp helpers

Rationale: ruling R4 clause 3 — "`last-synced` is renamed `last-materialised`, and `markSynced` becomes `markMaterialised`", shipping with "a read that accepts either name and writes only the new one".

FIND:

```ts
const lastSyncedPath = (layout: StoreLayout): string => path.join(layout.state, 'last-synced')

const readLastSynced = (layout: StoreLayout): string | null => {
  try {
    return readFileSync(lastSyncedPath(layout), 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const writeLastSynced = (layout: StoreLayout, value: string): void => {
  writeFileSync(lastSyncedPath(layout), value, 'utf8')
}

export const markSynced = (layout: StoreLayout, ref: string): void => {
  writeLastSynced(layout, ref)
}
```

REPLACE:

```ts
const STAMP_FILE_NAME = 'last-materialised'
const LEGACY_STAMP_FILE_NAME = 'last-synced'

const stampPath = (layout: StoreLayout): string => path.join(layout.state, STAMP_FILE_NAME)

const legacyStampPath = (layout: StoreLayout): string => path.join(layout.state, LEGACY_STAMP_FILE_NAME)

const readStampFile = (target: string): string | null => {
  try {
    return readFileSync(target, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const readStamp = (layout: StoreLayout): string | null => {
  const current = readStampFile(stampPath(layout))
  if (current !== null) return current
  return readStampFile(legacyStampPath(layout))
}

const writeStamp = (layout: StoreLayout, value: string): void => {
  writeFileSync(stampPath(layout), value, 'utf8')
}

export const markMaterialised = (layout: StoreLayout, ref: string): void => {
  writeStamp(layout, ref)
}
```

### Step 2 — `src/store/read-path.ts` — REPLACE the stamp calls inside `syncWorkingCopy`

Rationale: ruling R4 clause 3 again. This step carries the rename into the one function that used the deleted helpers, so the rename commit compiles on its own. It changes no behaviour: the function still returns `void` and still writes the stamp unconditionally.

FIND:

```ts
  const cached = readLastSynced(layout)

  if (currentValue === cached) return

  if (currentValue === null) {
    writeLastSynced(layout, '')
    return
  }

  materialiseTree(rt, layout, currentValue)
  writeLastSynced(layout, currentValue)
}
```

REPLACE:

```ts
  const cached = readStamp(layout)

  if (currentValue === cached) return

  if (currentValue === null) {
    writeStamp(layout, '')
    return
  }

  materialiseTree(rt, layout, currentValue)
  writeStamp(layout, currentValue)
}
```

### Step 3 — `src/store/records.ts` — REPLACE the `read-path.ts` import

Rationale: ruling R4 clause 3 — the renamed function must be imported under its new name for the rename commit to compile.

FIND:

```ts
import { markSynced, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
```

REPLACE:

```ts
import { markMaterialised, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
```

### Step 4 — `src/store/records.ts` — REPLACE the `markSynced` call

Rationale: ruling R4 clause 3, the same rename at its only call site in this file.

FIND:

```ts
        markSynced(storeLayout, result.after)
```

REPLACE:

```ts
        markMaterialised(storeLayout, result.after)
```

### Step 5 — `src/server/tools/resolve_conflict.ts` — REPLACE the import at line 13

Rationale: divergence 3.1 — this call site is not in the SPEC's change list and the rename does not compile without it.

FIND:

```ts
import { markSynced } from '../../store/read-path.ts'
```

REPLACE:

```ts
import { markMaterialised } from '../../store/read-path.ts'
```

### Step 6 — `src/server/tools/resolve_conflict.ts` — REPLACE the call at line 641

Rationale: divergence 3.1, the same rename at its only call site in this file.

FIND:

```ts
    markSynced(layout.value, commitResult.after)
```

REPLACE:

```ts
    markMaterialised(layout.value, commitResult.after)
```

### Step 7 — `test/contract/skills.test.ts` — REPLACE the sentinel set

Rationale: ruling R4 clause 3 names this exact line as part of the same change. Both names are listed because the read accepts either filename, so a store carrying the pre-rename name is still legal and its stamp is still a non-pointer file. Dropping `'last-synced'` would make the census halt on a legacy store. This classifies the renamed item rather than excluding anything.

FIND:

```ts
const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced'])
```

REPLACE:

```ts
const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced', 'last-materialised'])
```

### Step 8 — `test/spawn/resume.test.ts` — REPLACE the sentinel set

Rationale: ruling R4 clause 3 names this second sentinel set. The line is byte-identical to step 7's; apply the same FIND and REPLACE in this file.

FIND:

```ts
const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced'])
```

REPLACE:

```ts
const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced', 'last-materialised'])
```

**Checkpoint.** The rename is complete and the tree is type-correct. Section 11 stop condition 4 is checked here.

### Step 9 — `src/store/read-path.ts` — REPLACE `materialiseTree`

Rationale: ruling R4 clause 1 — "`materialiseTree` returns a success/failure result instead of returning silently, and `:77-78`'s `continue` becomes a recorded failure".

FIND:

```ts
const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): void => {
  const list = countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!list.ok) return

  rmSync(layout.records, { recursive: true, force: true })
  mkdirSync(layout.records, { recursive: true })

  const lines = list.stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = countedMaterialiseGit(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) continue
    const target = path.join(layout.records, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }
}
```

REPLACE:

```ts
export type MaterialiseOutcome = { ok: true } | { ok: false; detail: string }

const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseOutcome => {
  const list = countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!list.ok) {
    return { ok: false, detail: `the ledger tree could not be listed (git ls-tree exit ${list.code})` }
  }

  rmSync(layout.records, { recursive: true, force: true })
  mkdirSync(layout.records, { recursive: true })

  const lines = list.stdout.split('\n').filter((line) => line.length > 0)
  let unreadable = 0
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = countedMaterialiseGit(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) {
      unreadable += 1
      continue
    }
    const target = path.join(layout.records, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }

  if (unreadable > 0) {
    return { ok: false, detail: `${unreadable} record blob(s) in the ledger tree could not be read` }
  }
  return { ok: true }
}
```

### Step 10 — `src/store/read-path.ts` — REPLACE `syncWorkingCopy`

Rationale: ruling R4 clause 2 — "The stamp at `:97-98` is written **only** when materialisation fully succeeded. A partial or failed materialisation leaves the stamp unwritten, so the next call retries rather than short-circuiting at `:90`." The FIND below is the text step 2 produced, not the original.

FIND:

```ts
export const syncWorkingCopy = (rt: Runtime, layout: StoreLayout, runGit: typeof git = countedGit): void => {
  const current = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
  const currentValue = current.ok ? current.stdout.trim() : null
  const cached = readStamp(layout)

  if (currentValue === cached) return

  if (currentValue === null) {
    writeStamp(layout, '')
    return
  }

  materialiseTree(rt, layout, currentValue)
  writeStamp(layout, currentValue)
}
```

REPLACE:

```ts
export type SyncWorkingCopyOutcome = { ok: true; materialised: boolean } | { ok: false; detail: string }

export const syncWorkingCopy = (
  rt: Runtime,
  layout: StoreLayout,
  runGit: typeof git = countedGit
): SyncWorkingCopyOutcome => {
  const current = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
  const currentValue = current.ok ? current.stdout.trim() : null
  const cached = readStamp(layout)

  if (currentValue === cached) return { ok: true, materialised: false }

  if (currentValue === null) {
    writeStamp(layout, '')
    return { ok: true, materialised: false }
  }

  const outcome = materialiseTree(rt, layout, currentValue)
  if (!outcome.ok) {
    rt.log({ level: 'error', event: 'store.materialisation-failed', ref: currentValue, detail: outcome.detail })
    return outcome
  }

  writeStamp(layout, currentValue)
  return { ok: true, materialised: true }
}
```

### Step 11 — `src/store/records.ts` — REPLACE the layout and read-path imports

Rationale: ruling R5 clause 1 — the record-count comparison needs `git` and `LEDGER_REF`, neither of which this file imports today.

FIND:

```ts
import { createStoreDirectories, layoutFor, type StoreLayout } from './layout.ts'
import { markMaterialised, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
```

REPLACE:

```ts
import { git } from './git.ts'
import { createStoreDirectories, layoutFor, type StoreLayout } from './layout.ts'
import { markMaterialised, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
import { LEDGER_REF } from './ref.ts'
```

### Step 12 — `src/store/records.ts` — INSERT-AFTER `checkRecordsReadable`

Rationale: ruling R5 clause 1 — "`openStore` compares the record count materialised on disk against the record count present in the ref's tree. A ref that holds records over a store that materialised none is a **named, reported anomaly**, never silence." The criterion this discharges permits either re-materialising or reporting; this reports, and section 3.9 records why.

FIND:

```ts
      detail
    )
  }
}

export const openStore = (rt: Runtime, projectRoot: string): Ok<Store> | Refusal => {
```

REPLACE:

```ts
      detail
    )
  }
}

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

const refRecordCount = (rt: Runtime, layout: StoreLayout): number | null => {
  const listing = git(rt, layout.projectRoot, ['ls-tree', '-r', '--name-only', LEDGER_REF])
  if (!listing.ok) return null
  return listing.stdout.split('\n').filter((line) => line.length > 0).length
}

const materialisationRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'records',
      accepted: 'a records directory materialised from the ledger ref',
      example: 'git rev-parse refs/logbook/ledger',
      retryable: true,
      message: 'the ledger ref holds records this store did not materialise; the store was not opened'
    },
    detail
  )

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

export const openStore = (rt: Runtime, projectRoot: string): Ok<Store> | Refusal => {
```

### Step 13 — `src/store/records.ts` — REPLACE the `syncWorkingCopy` call in `openStore`

Rationale: ruling R5 clause 1 — the anomaly is reported, never silence, and divergence 3.4 rules that the report is a refusal.

FIND:

```ts
  syncWorkingCopy(rt, storeLayout)

  const store: Store = {
```

REPLACE:

```ts
  const materialisation = ensureMaterialised(rt, storeLayout)
  if (!materialisation.ok) return materialisation

  const store: Store = {
```

### Step 14 — `src/store/layout.ts` — INSERT-AFTER `createStoreDirectories`

Rationale: ruling R5 clause 2 — `src/hooklib/stop-gate.ts:58` "stops creating a half-built store". The stop hook needs exactly one directory and gets a function that creates exactly that one.

FIND:

```ts
  const originPath = path.join(layout.state, 'origin.json')
  if (!existsSync(originPath)) {
    writeFileSync(originPath, JSON.stringify({ project_root: layout.projectRoot }), 'utf8')
  }
}
```

REPLACE:

```ts
  const originPath = path.join(layout.state, 'origin.json')
  if (!existsSync(originPath)) {
    writeFileSync(originPath, JSON.stringify({ project_root: layout.projectRoot }), 'utf8')
  }
}

export const createStateDirectory = (layout: StoreLayout): void => {
  mkdirSync(layout.state, { recursive: true })
}
```

### Step 15 — `src/hooklib/stop-gate.ts` — REPLACE the import

Rationale: ruling R5 clause 2 — the stop hook takes the narrower function.

FIND:

```ts
import { createStoreDirectories, layoutFor } from '../store/layout.ts'
```

REPLACE:

```ts
import { createStateDirectory, layoutFor } from '../store/layout.ts'
```

### Step 16 — `src/hooklib/stop-gate.ts` — REPLACE the call

Rationale: ruling R5 clause 2. The gate file lives in `state/`; nothing on this path materialises, so it must not create `records/`.

FIND:

```ts
  createStoreDirectories(layout.value)
```

REPLACE:

```ts
  createStateDirectory(layout.value)
```

**Checkpoint.** The behaviour change is complete and the tree is type-correct. Section 11 stop conditions 5 and 6 are checked here.

### Step 17 — `package.json` and `.claude-plugin/plugin.json` — REPLACE the version line in both

Rationale: invariant I4 — both manifests bump in the same commit, and `node scripts/check-packaging.mjs` asserts they agree.

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

Expected exit code `0`. Expected stdout under the baseline: `version 1.0.2`.

Then confirm the result with these two commands.

```bash
git --no-pager diff --no-color -U0 -- package.json .claude-plugin/plugin.json
```

Expected exit code `0`. The two `index <sha>..<sha> 100644` lines are content hashes and are not predictable; the four load-bearing lines are the two removed and two added `"version"` lines, and under the baseline the output contains exactly these four:

```
-  "version": "1.0.1",
+  "version": "1.0.2",
-  "version": "1.0.1",
+  "version": "1.0.2",
```

```bash
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout contains `check-packaging: ok`.

---

## 5. Tests

Two new files. No existing test file gains a test; the only existing test edits are the two sentinel lines in steps 7 and 8.

### 5.1 CREATE `test/store/materialisation.test.ts`

Entire file contents, first character to last:

```ts
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { getMaterialiseCallCounter, resetMaterialiseCallCounter } from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const STAMP_FILE_NAME = 'last-materialised'
const LEGACY_STAMP_FILE_NAME = 'last-synced'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-materialisation-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
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
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const anyStampPresent = (layout: StoreLayout): boolean =>
  existsSync(join(layout.state, STAMP_FILE_NAME)) || existsSync(join(layout.state, LEGACY_STAMP_FILE_NAME))

const stampPathInUse = (layout: StoreLayout): string => {
  const current = join(layout.state, STAMP_FILE_NAME)
  return existsSync(current) ? current : join(layout.state, LEGACY_STAMP_FILE_NAME)
}

const pointLedgerRefAtABlob = (rt: Runtime, repo: string): void => {
  const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: 'not a tree' })
  assert.equal(blob.ok, true, 'fixture could not write the blob the ledger ref is pointed at')
  if (!blob.ok) return
  const updated = git(rt, repo, ['update-ref', LEDGER_REF, blob.stdout.trim()])
  assert.equal(updated.ok, true, 'fixture could not point the ledger ref at a blob')
}

test('read.failed-materialisation-leaves-no-stamp', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      mkdirSync(layout.state, { recursive: true })

      pointLedgerRefAtABlob(rt, repo)

      resetMaterialiseCallCounter()
      const first = openStore(rt, repo)
      assert.equal(first.ok, false, 'a store whose ledger tree cannot be listed must not open silently')
      assert.equal(getMaterialiseCallCounter() > 0, true, 'the first open must have attempted to materialise')
      assert.equal(
        anyStampPresent(layout),
        false,
        'a failed materialisation must leave no stamp under either the current or the pre-rename filename'
      )

      resetMaterialiseCallCounter()
      const second = openStore(rt, repo)
      assert.equal(second.ok, false)
      assert.equal(
        getMaterialiseCallCounter() > 0,
        true,
        'the next open must re-attempt materialisation rather than short-circuit on a stamp'
      )
      assert.equal(anyStampPresent(layout), false)
    })
  })
})

test('read.absent-records-under-a-current-stamp-are-reported', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const seedRt = runtimeWithHome(pluginData)
      const seeded = openStore(seedRt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return
      const thread = makeThread(seedRt, 'stamp-outlives-its-records')
      const committed = seeded.value.commit([thread], 'seed one thread')
      assert.equal(committed.ok, true)

      const layout = layoutIn(seedRt, repo)
      const tip = git(seedRt, repo, ['rev-parse', LEDGER_REF])
      assert.equal(tip.ok, true)
      if (!tip.ok) return
      const stampBefore = readFileSync(stampPathInUse(layout), 'utf8').trim()
      assert.equal(stampBefore, tip.stdout.trim(), 'the fixture requires a stamp naming the current tip')

      rmSync(layout.records, { recursive: true, force: true })
      mkdirSync(layout.records, { recursive: true })

      const events: Record<string, unknown>[] = []
      const watchRt: Runtime = { ...seedRt, log: (record) => { events.push(record) } }

      const reopened = openStore(watchRt, repo)
      assert.equal(reopened.ok, true, 'a store whose records vanished under a current stamp must still open')
      if (!reopened.ok) return

      const anomalies = events.filter((record) => record.event === 'store.materialisation-anomaly')
      assert.equal(
        anomalies.length,
        1,
        'a store holding none of the records the ledger ref carries must report a named anomaly, never silence'
      )
      assert.equal(anomalies[0]?.records_in_ref, 1)
      assert.equal(anomalies[0]?.records_on_disk, 0)
    })
  })
})

test('read.a-pre-rename-stamp-still-opens', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return
      const thread = makeThread(rt, 'legacy-stamp-thread')
      const committed = seeded.value.commit([thread], 'seed one thread')
      assert.equal(committed.ok, true)

      const layout = layoutIn(rt, repo)
      const legacy = join(layout.state, LEGACY_STAMP_FILE_NAME)
      const inUse = stampPathInUse(layout)
      if (inUse !== legacy) renameSync(inUse, legacy)
      assert.equal(existsSync(legacy), true, 'the fixture requires a stamp under the pre-rename filename')
      assert.equal(existsSync(join(layout.state, STAMP_FILE_NAME)), false)

      resetMaterialiseCallCounter()
      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true, 'a store carrying only the pre-rename stamp must still open')
      if (!reopened.ok) return
      assert.equal(reopened.value.readThreads().length, 1)
      assert.equal(
        getMaterialiseCallCounter(),
        0,
        'the pre-rename stamp must be read and honoured, not ignored into a rebuild'
      )
    })
  })
})

test('read.a-record-blob-that-cannot-be-read-is-a-failure', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      mkdirSync(layout.state, { recursive: true })

      const missingBlob = 'a'.repeat(40)
      const innerTree = git(rt, repo, ['mktree', '--missing'], { stdin: `100644 blob ${missingBlob}\tabsent.json\n` })
      assert.equal(innerTree.ok, true, 'fixture could not build a subtree naming a blob that does not exist')
      if (!innerTree.ok) return

      const outerTree = git(rt, repo, ['mktree'], { stdin: `040000 tree ${innerTree.stdout.trim()}\tthreads\n` })
      assert.equal(outerTree.ok, true, 'fixture could not build the tree that carries the unreadable record')
      if (!outerTree.ok) return

      const commit = git(rt, repo, ['commit-tree', outerTree.stdout.trim(), '-m', 'a tree naming an absent blob'])
      assert.equal(commit.ok, true)
      if (!commit.ok) return
      const updated = git(rt, repo, ['update-ref', LEDGER_REF, commit.stdout.trim()])
      assert.equal(updated.ok, true)

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, false, 'a partial materialisation must not be reported as a materialised store')
      assert.equal(
        anyStampPresent(layout),
        false,
        'a partial materialisation must leave no stamp claiming the tree was materialised'
      )
    })
  })
})
```

### 5.2 CREATE `test/hooks/stop-gate-store-shape.test.ts`

This file drives `stopGateVerdict` in process rather than through the hook binary, which is the established idiom for in-process hook tests in this directory: `test/hooks/guard-in-process.test.ts:1-6` opens with the same `node:test`, `node:assert/strict`, `mkdtempSync` and `tmpdir` imports and no `hook-process.ts` helper.

Entire file contents, first character to last:

```ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-shape-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('hook.stop-gate-leaves-no-half-built-store', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })

      const verdict = stopGateVerdict(rt, {
        session_id: 'stop-gate-shape-session',
        cwd: repo,
        transcript_path: join(pluginData, 'no-such-transcript.jsonl'),
        stop_hook_active: false
      })
      assert.equal(verdict.kind, 'silent')

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return

      assert.equal(
        existsSync(join(layout.value.state, 'stop-gate.json')),
        true,
        'the stop gate must still write its own state file'
      )
      assert.equal(
        existsSync(layout.value.records),
        false,
        'the stop gate must not leave a records directory it never materialised'
      )
      assert.equal(
        existsSync(join(layout.value.state, 'origin.json')),
        false,
        'the stop gate must not claim a store root it never materialised'
      )
    })
  })
})
```

### 5.3 Which test discharges which acceptance criterion

| Criterion | Test name | File |
| --- | --- | --- |
| 1 | `read.failed-materialisation-leaves-no-stamp` | `test/store/materialisation.test.ts` |
| 2 | `read.absent-records-under-a-current-stamp-are-reported` | `test/store/materialisation.test.ts` |
| 3 | `hook.stop-gate-leaves-no-half-built-store` | `test/hooks/stop-gate-store-shape.test.ts` |
| 4 | `read.a-pre-rename-stamp-still-opens` | `test/store/materialisation.test.ts` |
| 5 | `read.failed-materialisation-leaves-no-stamp` under the mutation in section 7 | `test/store/materialisation.test.ts` |
| 6 | `npm test` in section 8 | — |

`read.a-record-blob-that-cannot-be-read-is-a-failure` covers ruling R4 clause 1's second half, the `continue` at `:77-78` becoming a recorded failure. It is inside the change R4 mandates and is not an extension of the ceiling.

Criterion 2's test is the committed form of `docs/audits/2026-08-25-post-cutover-repair-probes/repro-f3.ts` PROBE 3, and criterion 3's test is the committed form of that probe's PROBE 2.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time; `0ade582` at authoring time.

Every test in section 5 compiles on the parent. None imports a symbol the rename creates: the two stamp filenames are plain string constants declared inside the test file, `stampPathInUse` reads whichever of the two exists, and `getMaterialiseCallCounter`, `resetMaterialiseCallCounter`, `openStore`, `layoutFor`, `stopGateVerdict` and `git` all already exist there. No substitute procedure is needed.

Commit the two test files first (section 9, commit 1) and run:

```bash
node --test "test/store/materialisation.test.ts" "test/hooks/stop-gate-store-shape.test.ts"
```

Expected exit code `1`, and the summary line `fail 4`. Expected results, per test:

| Test | Result on the parent | The first assertion to fail, and what it prints |
| --- | --- | --- |
| `read.failed-materialisation-leaves-no-stamp` | **fails** | `assert.equal(first.ok, false, ...)`. On the parent `openStore` discards the materialisation outcome and returns a store, so the output carries `Expected values to be strictly equal:` then `true !== false`, under `a store whose ledger tree cannot be listed must not open silently`. |
| `read.absent-records-under-a-current-stamp-are-reported` | **fails** | `assert.equal(anomalies.length, 1, ...)`, printing `0 !== 1` under `a store holding none of the records the ledger ref carries must report a named anomaly, never silence`. On the parent nothing compares the ref against the disk, so no such event is ever emitted. |
| `read.a-pre-rename-stamp-still-opens` | **passes** | On the parent the stamp is already written under the pre-rename filename, so `stampPathInUse` returns it, the rename is skipped, and the store opens. Criterion 4 is a compatibility criterion and the SPEC does not require it red on the parent. |
| `read.a-record-blob-that-cannot-be-read-is-a-failure` | **fails** | `assert.equal(opened.ok, false, ...)`, printing `true !== false` under `a partial materialisation must not be reported as a materialised store`. |
| `hook.stop-gate-leaves-no-half-built-store` | **fails** | `assert.equal(existsSync(layout.value.records), false, ...)`, printing `true !== false` under `the stop gate must not leave a records directory it never materialised`. |

After commit 2, the rename only, re-run the same command. Expected exit code `1` and `fail 4` again: the rename changes which filename is written, not whether the stamp is written on failure, and `stampPathInUse` follows the name in either direction.

After commit 3, the behaviour change, the same command exits `0` with `fail 0`.

---

## 7. Inertness mutation

One mutation, for acceptance criterion 5, "reverting the stamp-on-success guard turns criterion 1 red again".

**The exact edit to revert.** In `src/store/read-path.ts`, inside `syncWorkingCopy`, replace this block, which step 10 produced:

```ts
  const outcome = materialiseTree(rt, layout, currentValue)
  if (!outcome.ok) {
    rt.log({ level: 'error', event: 'store.materialisation-failed', ref: currentValue, detail: outcome.detail })
    return outcome
  }

  writeStamp(layout, currentValue)
  return { ok: true, materialised: true }
```

with this block, which restores the unconditional stamp write:

```ts
  materialiseTree(rt, layout, currentValue)
  writeStamp(layout, currentValue)
  return { ok: true, materialised: true }
```

**The exact test that must turn red.**

```bash
node --test "test/store/materialisation.test.ts"
```

Expected exit code `1`. `read.failed-materialisation-leaves-no-stamp` fails on `assert.equal(first.ok, false, ...)`, printing `Expected values to be strictly equal:` then `true !== false`, under `a store whose ledger tree cannot be listed must not open silently`, because with the stamp written unconditionally the store opens and `ensureMaterialised` never sees a failure.

`read.a-pre-rename-stamp-still-opens` must still pass under the mutation. If it fails too, the mutation was applied wrongly.

**The exact restore.** Apply the two blocks above in reverse: replace the three-line block with the eight-line block. Then re-run:

```bash
node --test "test/store/materialisation.test.ts"
```

Expected exit code `0`, with the summary line `fail 0`.

---

## 8. Full verification

Run each of these from the repository root, in this order.

| # | Command | Expected exit code | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | `0` | no line containing `error TS`; the two `> logbook@` banner lines are normal npm output and are not a failure |
| 2 | `git grep -n markSynced -- src test hooks scripts bin` | `1` | no output; exit `1` is git grep reporting zero matches |
| 3 | `git grep -n "'last-synced'" -- src ':!src/store/read-path.ts'` | `1` | no output; the only place the pre-rename literal may survive under `src/` is the `LEGACY_STAMP_FILE_NAME` constant |
| 4 | `git grep -c LEGACY_STAMP_FILE_NAME -- src/store/read-path.ts` | `0` | `src/store/read-path.ts:2` |
| 5 | `node --test "test/store/materialisation.test.ts" "test/hooks/stop-gate-store-shape.test.ts"` | `0` | `fail 0` |
| 6 | `node --test "test/store/**/*.test.ts"` | `0` | `fail 0` |
| 7 | `node --test "test/hooks/**/*.test.ts"` | `0` | `fail 0` |
| 8 | `node --test "test/contract/skills.test.ts" "test/spawn/resume.test.ts"` | `0` | `fail 0` |
| 9 | `npm test` | `0` | `fail 0` |
| 10 | `node scripts/check-packaging.mjs` | `0` | `check-packaging: ok` |

Command 2 uses `git grep`, not `grep -r`. `src/server/tools/resolve_conflict.ts` carries a NUL byte and `grep -r` skips it silently, so `grep -rn markSynced src` prints nothing whether or not the call site at line 641 still exists. `git grep` has no such skip and does find it. Running the wrong one here converts a live compile error into an apparent pass.

Command 3 deliberately excludes `src/store/read-path.ts` with the pathspec `':!src/store/read-path.ts'`. That one file must keep the pre-rename literal, because it is the value of `LEGACY_STAMP_FILE_NAME` and ruling R4 requires the read to accept either name. Command 4 asserts it is still there: two matching lines, the constant and the path helper that uses it.

---

## 9. Commits

Four commits, in this order. Refactor and behaviour change do not share a commit, and each of commits 2, 3 and 4 leaves the tree type-correct.

**Commit 1 — the tests, before the fix**

```
test(store): pin the materialisation stamp's failure and anomaly behaviour
```

Files: `test/store/materialisation.test.ts`, `test/hooks/stop-gate-store-shape.test.ts`.
Plan steps: sections 5.1 and 5.2.
This commit is intentionally red. The branch is squash-merged, so no red commit reaches `main`.

**Commit 2 — the rename, no behaviour change**

```
refactor(store): rename the materialisation stamp for what it records
```

Files: `src/store/read-path.ts`, `src/store/records.ts`, `src/server/tools/resolve_conflict.ts`, `test/contract/skills.test.ts`, `test/spawn/resume.test.ts`.
Plan steps: 1, 2, 3, 4, 5, 6, 7, 8.

**Commit 3 — the behaviour fix**

```
fix(store): write the materialisation stamp only on a full materialisation
```

Files: `src/store/read-path.ts`, `src/store/records.ts`, `src/store/layout.ts`, `src/hooklib/stop-gate.ts`.
Plan steps: 9, 10, 11, 12, 13, 14, 15, 16.

**Commit 4 — the version bump**

```
chore(release): bump the plugin version for the materialisation stamp fix
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Plan steps: 17.

**Change size, and the split ruling.** Counted across all four commits: about 133 changed lines under `src/`, about 4 lines in existing test files and 2 in the manifests, and about 259 lines of new test file — roughly 398 lines authored in total, of which the reviewable source change is about 133. That is under the 400-line ceiling. **Ruled: no split.** The two halves already ship as separate commits, and a pull request carrying only the rename would have no acceptance criterion of its own and would leave the branch it merged into no better than before, so it is not independently shippable. Rejected, in one line: split the rename into its own pull request, which buys a smaller diff by shipping a change that satisfies none of this MSP's six criteria. The orchestrator reviewed this size and accepted it as authored; a reviewer who reads this disclosure should not reopen it.

---

## 10. Pull request

Run exactly this, from the repository root, after the branch is pushed:

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/msp-1-materialisation-stamp --base main \
  --title "fix(store): write the materialisation stamp only on success" \
  --what "The stamp recording which ledger commit the local record copy was built from is now written only when that rebuild fully succeeded." \
  --what "Opening the store now compares how many records the ledger ref holds against how many are on disk, and refuses with a named reason instead of returning an empty store." \
  --what "The stop hook now creates only the one state directory it writes into, instead of a records directory it never fills." \
  --why "A failed rebuild still wrote the stamp, so every later run skipped the rebuild and the local record copy stayed permanently empty while reporting itself current." \
  --why "The stamp was named for a synchronisation with the shared copy that nothing on that code path performs." \
  --risk "Opening a store whose ledger tree cannot be read now refuses instead of returning an empty store, which turns a previously silent condition into a visible one." \
  --verified "npm test - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "inertness mutation reverting the stamp-on-success guard - read.failed-materialisation-leaves-no-stamp turns red" \
  --not-verified "mutation (Stryker) - result not read"
```

Expected exit code `0`. Expected stdout contains `https://github.com/SatanshuMishra/logbook/pull/`.

The mutation-scope sentence SPEC section 8.2 requires, to be understood before that last flag is written: the Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`, `src/merge/conflict.ts`, `src/render/**`. This MSP's changes to `src/store/read-path.ts`, `src/store/records.ts` and `src/store/layout.ts` fall **inside** that scope, so the job does mutate this diff; its changes to `src/hooklib/stop-gate.ts` and `src/server/tools/resolve_conflict.ts` fall outside it. Replace the final `--not-verified` line with `--verified "mutation (Stryker) - <the real score the job reported>"` only if the job actually ran and you read its result. Never write a `Verified:` line for a check you did not run.

---

## 11. Stop conditions

For each of these: **STOP and report; do not improvise.**

1. **A FIND string does not match.** Any FIND block in section 4 that does not appear verbatim and exactly once in the named file means the tree is not the one this plan was written against. STOP and report; do not improvise.

2. **The `markSynced` census does not hold five sites.** Before step 1, run `git grep -n markSynced -- src test hooks scripts bin`. Expected exit code `0` and exactly five lines. The five path-and-line pairs, in any order git prints them, are `src/store/read-path.ts:53`, `src/store/records.ts:10`, `src/store/records.ts:112`, `src/server/tools/resolve_conflict.ts:13`, `src/server/tools/resolve_conflict.ts:641`. If the output is not exactly those five, STOP and report; do not improvise.

3. **The version files disagree before the change.** Run `node -e "const f=(p)=>JSON.parse(require('fs').readFileSync(p,'utf8')).version; process.stdout.write(f('package.json')+' '+f('.claude-plugin/plugin.json')+'\n')"`. Expected exit code `0` and two identical values. If the two values printed are not identical, STOP and report; do not improvise. A version merely higher than `1.0.1` is **not** a stop condition — it means the ladder shifted, and step 17 increments whatever it finds.

4. **The rename does not stand on its own.** Immediately after step 8, run `npm run typecheck`; expect exit code `0` and no line containing `error TS`. Then run `node --test "test/hooks/stop-gate-fresh-data-dir.test.ts"`; expect exit code `0` and `fail 0`. A typecheck error here means one of steps 1 to 8 was applied wrongly. STOP and report; do not improvise. Do not run this check earlier than step 8: between steps 1 and 4 the tree deliberately does not compile, and a failure before step 8 is expected rather than informative.

5. **The behaviour change breaks the materialise-counter test.** Immediately after step 16, run `node --test "test/store/read-path.test.ts"`; expect exit code `0` and `fail 0`. A failure on `read.refreshes-only-on-ref-move` means `openStore` is now materialising on a path where it must not. STOP and report; do not improvise. Do not run this check earlier than step 16.

6. **`git ls-tree` cannot be pointed at a blob in the test fixture.** In `read.failed-materialisation-leaves-no-stamp`, if `assert.equal(updated.ok, true, 'fixture could not point the ledger ref at a blob')` fails, this git build refuses to set a ref to a non-commit object and the fixture cannot produce a deterministic `ls-tree` failure. STOP and report; do not improvise.

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

   If the output is not exactly `0`, MSP-0 has not merged. STOP and report; do not improvise, and do not edit this file. On the tree as it stands today that command prints `1` and exits `0`; once MSP-0 has merged it prints `0` and exits `1`. This plan writes no edit to `test/contract/cutover-manifests-agree.test.ts` under any circumstance: the version bump in step 17 and the `npm test` exit code `0` in section 8 both depend on MSP-0 having de-pinned that constant permanently.

8. **`npm test` reports a failure in `workflow-hardening-census`.** This stop condition is quoted verbatim:

   ```
   If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
   described by the orchestrator is not yet closed in this checkout. STOP and report.
   Do not edit, skip or delete that test, and do not install anything yourself.
   ```

   That test is outside this MSP's surface and this plan writes no edit to it. Section 8 states
   `npm test` and `npm run typecheck` as ordinary gates expecting exit code `0`, and neither is
   weakened, rescoped, or expressed as a comparison against a known-failing baseline.
