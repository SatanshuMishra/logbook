# U2 — Store cost and safety (B: safety)

## 0. Identity

| | |
|---|---|
| **Closes** | Defect `D16` (the duplicate-store guard compares only siblings inside one root, so a second store for the same project under a different root is missed — live on this machine now) and the sync half of defect `D20` (one sync path re-commits unvalidated remote bytes) |
| **Depends on** | `U1 Schema foundations` and `U2 …-a` must both already be merged into `main` before this branch is cut. Section 11 carries the checks that prove both |
| **Required by** | Nothing in wave 1 |
| **Wave** | 1, second position, second half |
| **Branch name** | `perf/u2-store-cost-and-safety-b`, cut from `main` |
| **Version bump** | Baseline `1.5.1` -> `1.5.2` per orchestrator ruling OR1, as adjusted for the split recorded in section 3. Applied as a read-then-increment in step 5, never as a hard-coded pair |
| **Owns** | `src/store/single-store.ts`, `src/merge/sync.ts` |
| **Creates** | No new source or test files |
| **Does not touch** | `src/store/records.ts`, `src/store/read-path.ts`, `src/store/write-path.ts`, `src/server/`, `src/schema/` |

This document is self-contained. The implementer reads this file and the repository, and nothing else.

### Three plain-language definitions used throughout

- **The store** is the per-project directory this plugin keeps its records in. It lives outside the project's working tree, under a path built from an environment value plus a key derived from the project's absolute path.
- **A plugin-data root** is the directory that holds one *install* of the plugin's per-project stores. One machine can have more than one, because the same plugin can be installed from more than one source.
- **The passthrough** is the code path that takes a record file arriving from the shared remote copy which this version cannot parse, and writes it into this machine's ledger unchanged, without any validation.

---

## 1. Acceptance criteria (the ceiling)

1. **A second store for the same project under a different plugin-data root is refused.** The guard no longer looks only at directories beside its own. Discharges `B40`. Proven by `store.refuses-a-second-store-under-another-plugin-data-root`.
2. **The refusal names both installs.** It names the store key and the other install's directory name, so a human can act on it without reading code. Discharges `B40`.
3. **The refusal contains no absolute filesystem path.** The already-shipped path-free census over every refusal producer still passes. Discharges `B40` without regressing the shipped privacy property.
4. **A store belonging to a different project is not mistaken for a duplicate**, even when it happens to sit under the same key in another root. Discharges `B40`. Proven by `store.a-second-store-for-another-project-under-another-root-is-ok`.
5. **A same-root duplicate is still refused**, exactly as before. Proven by the already-shipped `store.refuses-a-second-store`.
6. **A sync carrying remote record bytes this version cannot parse is refused, and nothing is written.** The local ledger reference does not move. Discharges `B40`. Proven by `sync.refuses-a-remote-record-it-cannot-parse`.
7. **The refused sync deletes nothing.** The remote's copy of the unparseable record is still there afterwards, byte for byte. Discharges `B40` without losing the append-only guarantee. Proven by the same test.
8. **The refusal names the record file that could not be parsed**, so the person who has to fix it knows which one. Discharges `B40`.

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is NOT folded into this plan.

---

## 2. Ground truth

### 2.1 `src/store/single-store.ts:1` — the filesystem import

```ts
import { readFileSync, readdirSync } from 'node:fs'
```

The widened check needs `statSync`, which can be asked whether a path exists without raising an error when it does not.

### 2.2 `src/store/single-store.ts:38-40` — the guard's head

```ts
export const ensureSingleStore = (rt: Runtime, layout: StoreLayout): Ok<StoreLayout> | Refusal => {
  void rt
  const pluginDataRoot = path.dirname(layout.root)
```

`void rt` is there because the guard currently logs nothing. The widened check has one condition it must report rather than swallow, so the runtime stops being unused.

### 2.3 `src/store/single-store.ts:67-80` — the guard's whole population

```ts
  const conflictingKeys = siblingKeys.filter(
    (name) => readOriginProjectRoot(pluginDataRoot, name) === layout.projectRoot
  )

  if (conflictingKeys.length > 0) {
    return {
      ok: false,
      field: 'store',
      accepted: 'exactly one store directory per project',
      example: ownKey,
      retryable: false,
      message: `two stores exist for this project: ${ownKey} and ${conflictingKeys.join(', ')}`
    }
  }
```

`siblingKeys` was built a few lines earlier from the directories inside `pluginDataRoot`, with the store's own key filtered out. So the guard can only ever see a duplicate that sits *beside* it inside one install. A second install of the plugin produces a store under a different root, and because the key is a pure function of the project path it carries **the same key** — the one name the guard deliberately excludes. This is defect `D16`.

**Observed on this machine, read-only, while this plan was written.** Two stores exist for one project, under two installs, under the same key:

```
~/.claude/plugins/data/logbook-inline/7990e2da6a6d59afa32ba08df0f657ea/state/origin.json
~/.claude/plugins/data/logbook-logbook/7990e2da6a6d59afa32ba08df0f657ea/state/origin.json
```

Both files record the same `project_root`. Two further projects on this machine are duplicated the same way. The shape the widened guard must detect is therefore: **the same key, under a sibling of the plugin-data root, whose `origin.json` names the same project.** Nothing on disk was modified, moved or deleted.

### 2.4 `src/merge/sync.ts` — the reads that precede the merge

```ts
      const ours = readOursRecordSet(store, layout)
      const theirs = readScratchRecordSet(theirsScratch)
      const base = baseScratch !== null ? readScratchRecordSet(baseScratch) : null

      const { changes: mergedChanges, conflicts } = computeMerge(ours, theirs, base)
```

`readScratchRecordSet` sorts the remote's files into two piles: records it could parse, and a `passthrough` pile of files it could not.

### 2.5 `src/merge/sync.ts` — the passthrough

```ts
      const changes: RecordChange[] = [
        ...mergedChanges,
        ...theirs.passthrough.map((file) => ({ kind: 'raw' as const, relPath: file.relPath, content: file.content }))
      ]
```

Every unparseable remote file is turned into a `raw` change. The store's own validation opens with `if (change.kind === 'raw') return null`, so a `raw` change is written into this machine's ledger without being checked at all. This is the sync half of defect `D20`: the one path on which bytes from a shared remote enter the local ledger with no validation of any kind.

### 2.6 `src/merge/sync.ts` — where those changes are written

```ts
      const commitResult = writeRecords(rt, layout, changes, message, writeOps)
```

---

## 3. Divergences from the SPEC

1. **The decomposition procedure this ladder was expected to run does not exist on disk.** `~/.claude/skills/mitosis/SKILL.md` is absent; it is staged for deletion in the operator's configuration repository and `~/.claude/skills` is a symlink into that working tree. Ruling applied: orchestrator ruling `OR20` — this ladder depends on no external decomposition procedure. Nothing was restored.

2. **Wave 1 is partially ordered: this unit follows `U1`.** Ruling applied: orchestrator ruling `OR17`. Section 11 carries the check.

3. **This unit is split in two, and this document is the second half.** The applied diff for the whole unit measured 473 changed lines, above the 400-line ceiling. Ruling applied: orchestrator ruling `OR16`. The first half carries `B37` and `B38` (cost); this half carries `B40` (safety) at a measured 149 changed lines. Both halves edit `src/merge/sync.ts`, so this one is cut only after the first merges. The three edits this plan makes to that file are all inside `performMerge`, which the first half does not touch, so its FIND strings are unaffected by it.

4. **One already-shipped test asserts the behaviour `B40` removes, and is therefore replaced rather than kept.** `sync.preserves-a-remote-only-quarantined-record` (`test/sync/conflict.test.ts:142`) asserts that the merge succeeds and re-commits the unparseable remote record. `B40` states that path is closed. The test is replaced by `sync.refuses-a-remote-record-it-cannot-parse`, which asserts strictly more than the old one did: the refusal, its reason, the record it names, that the local reference did not move, and that the remote's copy survives untouched. This is a mandated behaviour change, not a weakened test, and no test is deleted, skipped or focused to obtain a green.

5. **The closure refuses rather than dropping.** `B40` says the passthrough is closed but does not say what replaces it. Dropping the unparseable files would make the merge commit delete a record from the ledger, which the promise that nothing recorded is ever rewritten or deleted forbids. Refusing writes nothing and deletes nothing, so both copies survive and a human resolves it. Rejected: passing the bytes through after checking only their shape — that still commits unvalidated bytes, which is the thing being closed.

6. **Only the other side's unparseable files refuse the sync, not the shared ancestor's.** The ancestor's files are already in history and are never re-committed by the merge, so refusing on them would block every future sync over something this change cannot repair. Rejected: refusing on either side.

7. **The `raw` change kind is kept.** It has a second, legitimate producer — `src/server/tools/bind_branch.ts` writes binding records through it. Removing the kind is not what `B40` asks for; closing the one path that fed it unvalidated remote bytes is.

8. **No divergence was found between the SPEC's cited line numbers and the working tree.**

---

## 4. The change, step by step

### Step 1 — `src/store/single-store.ts` — REPLACE the filesystem import

FIND:

```ts
import { readFileSync, readdirSync } from 'node:fs'
```

REPLACE:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
```

Rationale: `B40` — the widened check asks whether a candidate directory exists without treating its absence as an error.

### Step 2 — `src/store/single-store.ts` — INSERT the cross-root check and stop ignoring the runtime

FIND:

```ts
export const ensureSingleStore = (rt: Runtime, layout: StoreLayout): Ok<StoreLayout> | Refusal => {
  void rt
  const pluginDataRoot = path.dirname(layout.root)
```

REPLACE:

```ts
const conflictsUnderOtherRoots = (
  rt: Runtime,
  pluginDataRoot: string,
  ownKey: string,
  projectRoot: string
): string[] => {
  const parent = path.dirname(pluginDataRoot)
  const ownRootName = path.basename(pluginDataRoot)

  let rootNames: string[]
  try {
    rootNames = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== ownRootName)
  } catch (error) {
    rt.log({ level: 'error', event: 'store.cross-root-scan-skipped', code: errnoCode(error) })
    return []
  }

  const found: string[] = []
  for (const name of rootNames) {
    const candidate = statSync(path.join(parent, name, ownKey), { throwIfNoEntry: false })
    if (candidate === undefined || !candidate.isDirectory()) continue
    if (readOriginProjectRoot(path.join(parent, name), ownKey) === projectRoot) {
      found.push(`${name}/${ownKey}`)
    }
  }
  return found
}

export const ensureSingleStore = (rt: Runtime, layout: StoreLayout): Ok<StoreLayout> | Refusal => {
  const pluginDataRoot = path.dirname(layout.root)
```

Rationale: `B40` — a second install's store for the same project always carries the same key, because the key is computed from the project path alone. So the search is exact: for each sibling install, look for that one key and read the project it claims.

Three decisions inside this function, each with the option that was rejected:

- **The candidate directory is checked with `statSync` before its `origin.json` is read.** Rejected: reading `origin.json` directly for every sibling and catching the failure. Measured on a directory with 1 175 siblings, the exception-raising form costs 5.96 ms and this form costs 1.86 ms.
- **A parent directory that cannot be listed is reported and the check yields nothing, rather than refusing.** Rejected: refusing on an unlistable parent. The guard is a safety check layered on top of shipped behaviour, and making it fail the store open where it previously succeeded would turn an environment quirk into an outage. The condition is named in the log rather than swallowed.
- **Only the current key is searched under each sibling install.** Rejected: enumerating every key under every sibling install and reading all of their `origin.json` files. That is the only shape that would also catch a store written by some past version under a different key scheme, and it costs the product of the two counts on every store open. The measured cost of the exact form on this machine's real plugin-data parent is 0.06 ms; the exhaustive form is not bounded by anything.

### Step 3 — `src/store/single-store.ts` — REPLACE the conflict decision

FIND:

```ts
  const conflictingKeys = siblingKeys.filter(
    (name) => readOriginProjectRoot(pluginDataRoot, name) === layout.projectRoot
  )

  if (conflictingKeys.length > 0) {
    return {
      ok: false,
      field: 'store',
      accepted: 'exactly one store directory per project',
      example: ownKey,
      retryable: false,
      message: `two stores exist for this project: ${ownKey} and ${conflictingKeys.join(', ')}`
    }
  }
```

REPLACE:

```ts
  const conflicts = [
    ...siblingKeys.filter((name) => readOriginProjectRoot(pluginDataRoot, name) === layout.projectRoot),
    ...conflictsUnderOtherRoots(rt, pluginDataRoot, ownKey, layout.projectRoot)
  ]

  if (conflicts.length > 0) {
    return {
      ok: false,
      field: 'store',
      accepted: 'exactly one store directory per project',
      example: ownKey,
      retryable: false,
      message: `two stores exist for this project: ${ownKey} and ${conflicts.join(', ')}`
    }
  }
```

Rationale: `B40` — one population, one refusal. A same-root conflict is still named by its key alone; a cross-root conflict is named as the install directory and the key, which is what distinguishes it, and which contains no absolute path.

### Step 4 — `src/merge/sync.ts` — INSERT the refusal that closes the passthrough

FIND:

```ts
      const { changes: mergedChanges, conflicts } = computeMerge(ours, theirs, base)
```

REPLACE:

```ts
      if (theirs.passthrough.length > 0) {
        const named = theirs.passthrough.map((file) => file.relPath).join(', ')
        return {
          kind: 'return',
          outcome: {
            ok: false,
            reason: 'rejected',
            detail: `the shared ledger carries ${theirs.passthrough.length} record file(s) this version cannot parse: ${named}; nothing was merged and nothing was pushed, so both copies are unchanged`
          }
        }
      }

      const { changes: mergedChanges, conflicts } = computeMerge(ours, theirs, base)
```

Rationale: `B40` — this is the one path on which remote bytes entered the ledger unvalidated, and it now stops before anything is written. The existing `rejected` outcome is reused rather than a new one added, because the sync tool already renders that outcome's detail into a refusal, so no file outside this plan's ownership has to change. The record paths named are relative, so the refusal still carries no absolute path.

### Step 5 — `src/merge/sync.ts` — DELETE the passthrough itself

FIND:

```ts
      const changes: RecordChange[] = [
        ...mergedChanges,
        ...theirs.passthrough.map((file) => ({ kind: 'raw' as const, relPath: file.relPath, content: file.content }))
      ]

      const message
```

REPLACE:

```ts
      const message
```

Rationale: `B40` — with step 4 in place this branch is unreachable, and leaving it would leave the closed path looking open to the next reader.

### Step 6 — `src/merge/sync.ts` — REPLACE the write call

FIND:

```ts
      const commitResult = writeRecords(rt, layout, changes, message, writeOps)
```

REPLACE:

```ts
      const commitResult = writeRecords(rt, layout, mergedChanges, message, writeOps)
```

Rationale: step 5 removed the local the call was reading.

### Step 7 — the version bump, as a read-then-increment

Run these four commands in order. Do not hard-code a version pair.

```
node -e "const v=require('./package.json').version.split('.').map(Number); v[2]+=1; console.log(v.join('.'))"
```

Take the value it prints and call it `NEXT`. This unit's Conventional Commits type is `fix`, which increments the third number and leaves the first two alone.

```
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" NEXT
node -e "const fs=require('fs');const p='.claude-plugin/plugin.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" NEXT
node scripts/check-packaging.mjs
```

The last command must print `check-packaging: ok` and exit 0.

---

## 5. Tests

### 5.1 `test/store/single-store.test.ts` — MODIFIED, exact insertion

Two tests are added immediately before the existing `store.single-store-with-no-sibling-is-ok`. Nothing already in the file is changed or removed. Both use the file's existing `writeOrigin` helper and its existing `escapeRegExp` helper.

FIND:

```ts
test('store.single-store-with-no-sibling-is-ok', () => {
```

REPLACE:

```ts
test('store.refuses-a-second-store-under-another-plugin-data-root', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const projectRoot = '/tmp/some/shared/project'
    const sharedKey = 'store-key-shared'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, projectRoot)
    writeOrigin(path.join(pluginDataParent, 'install-b'), sharedKey, projectRoot)

    const layout: StoreLayout = {
      root: path.join(pluginDataParent, 'install-a', sharedKey),
      records: path.join(pluginDataParent, 'install-a', sharedKey, 'records'),
      state: path.join(pluginDataParent, 'install-a', sharedKey, 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, false, 'a second store for this project under another plugin-data root must be refused')
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.retryable, false)
    assert.match(result.message, /install-b/)
    assert.match(result.message, new RegExp(escapeRegExp(sharedKey)))
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(pluginDataParent)))
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.a-second-store-for-another-project-under-another-root-is-ok', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const sharedKey = 'store-key-shared'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, '/tmp/project/one')
    writeOrigin(path.join(pluginDataParent, 'install-b'), sharedKey, '/tmp/project/two')

    const layout: StoreLayout = {
      root: path.join(pluginDataParent, 'install-a', sharedKey),
      records: path.join(pluginDataParent, 'install-a', sharedKey, 'records'),
      state: path.join(pluginDataParent, 'install-a', sharedKey, 'state'),
      projectRoot: '/tmp/project/one'
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, true, 'a same-keyed store belonging to a different project must not be treated as a duplicate')
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.single-store-with-no-sibling-is-ok', () => {
```

### 5.2 `test/sync/conflict.test.ts` — MODIFIED, one test replaced

The whole of `sync.preserves-a-remote-only-quarantined-record` is replaced. It is the test that pins the behaviour `B40` removes; see section 3 item 4 for why replacing it is not weakening it.

FIND:

```ts
test('sync.preserves-a-remote-only-quarantined-record', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)

    const badDecisionId = 'not-a-valid-decision-record'
    const malformedContent = '{"this is not a valid decision record":true}'
    const rawWrite = writeRecords(
      ben.rt,
      benLayout,
      [{ kind: 'raw', relPath: `decisions/${badDecisionId}.json`, content: malformedContent }],
      'ben: record a decision the schema will reject'
    )
    assert.equal(rawWrite.ok, true)

    const pushBadDecision = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushBadDecision.ok, true)
    if (!pushBadDecision.ok) return
    assert.equal(pushBadDecision.action, 'pushed')

    const threadB = makeThread(ana.rt, 'thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)
    assert.equal(mergeOutcome.ok, true)
    if (!mergeOutcome.ok) return
    assert.equal(mergeOutcome.action, 'merged')

    const remoteRecordExists = git(ana.rt, remote, ['cat-file', '-e', `${LEDGER_REF}:decisions/${badDecisionId}.json`])
    assert.equal(remoteRecordExists.ok, true)

    const remoteRecordContent = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:decisions/${badDecisionId}.json`])
    assert.equal(remoteRecordContent.ok, true)
    if (!remoteRecordContent.ok) return
    assert.equal(remoteRecordContent.stdout, malformedContent)
  })
})
```

REPLACE:

```ts
test('sync.refuses-a-remote-record-it-cannot-parse', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)

    const badDecisionId = 'not-a-valid-decision-record'
    const badRelPath = `decisions/${badDecisionId}.json`
    const malformedContent = '{"this is not a valid decision record":true}'
    const rawWrite = writeRecords(
      ben.rt,
      benLayout,
      [{ kind: 'raw', relPath: badRelPath, content: malformedContent }],
      'ben: record a decision the schema will reject'
    )
    assert.equal(rawWrite.ok, true)

    const pushBadDecision = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushBadDecision.ok, true)
    if (!pushBadDecision.ok) return
    assert.equal(pushBadDecision.action, 'pushed')

    const threadB = makeThread(ana.rt, 'thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const anaRefBefore = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(anaRefBefore.ok, true)
    if (!anaRefBefore.ok) return

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(mergeOutcome.ok, false, 'a merge carrying remote bytes this version cannot parse must be refused')
    if (mergeOutcome.ok) return
    assert.equal(mergeOutcome.reason, 'rejected')
    assert.match(mergeOutcome.detail, new RegExp(badRelPath))

    const anaRefAfter = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(anaRefAfter.ok, true)
    if (!anaRefAfter.ok) return
    assert.equal(anaRefAfter.stdout.trim(), anaRefBefore.stdout.trim(), 'the refused merge must not advance the local ledger ref')

    const remoteRecordContent = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:${badRelPath}`])
    assert.equal(remoteRecordContent.ok, true, 'the refusal must leave the remote copy of the record intact')
    if (!remoteRecordContent.ok) return
    assert.equal(remoteRecordContent.stdout, malformedContent)
  })
})
```

### 5.3 Already-shipped tests this change must not break

| Test | File | What it protects |
|---|---|---|
| `store.refuses-a-second-store` | `test/store/single-store.test.ts` | The same-root duplicate is still refused, and the message still names both keys and no absolute path |
| `store.single-store-with-no-sibling-is-ok` | `test/store/single-store.test.ts` | A lone store still opens |
| `store.plugin-data-listing-failure-is-path-free` | `test/store/single-store.test.ts` | An unlistable plugin-data root still produces the path-free refusal it did before |
| `store.refusal-leaves-no-new-directory` | `test/store/single-store.test.ts` | The guard creates nothing while refusing |
| `no-path` census over every refusal producer | `test/contract/no-path.test.ts` | The widened refusal still leaks no absolute path |
| `sync.conflict-refuses`, `conflict.resolve-names-the-winner`, `sync.clears-a-stale-conflict-file-on-the-next-clean-sync` | `test/sync/` | Ordinary conflict handling is unchanged |

### 5.4 Which test discharges which criterion

| Criterion | Discharged by |
|---|---|
| 1, 2, 3 | `store.refuses-a-second-store-under-another-plugin-data-root` and the `no-path` census |
| 4 | `store.a-second-store-for-another-project-under-another-root-is-ok` |
| 5 | `store.refuses-a-second-store` (already shipped) |
| 6, 7, 8 | `sync.refuses-a-remote-record-it-cannot-parse` |

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time, which contains `U1` and `U2 …-a`.

Both new assertions compile on the parent, because neither adds a new export. Copy both test files in and run them before applying any step.

### 6.1 The guard

```
node --test test/store/single-store.test.ts
```

Expected: exit code 1, with this exact assertion message:

```
a second store for this project under another plugin-data root must be refused
```

`store.a-second-store-for-another-project-under-another-root-is-ok` passes on the parent. It is a control, not a receipt: it exists to prove the widened check does not start refusing things it should not.

### 6.2 The sync refusal

```
node --test test/sync/conflict.test.ts
```

Expected: exit code 1, with this exact assertion message:

```
a merge carrying remote bytes this version cannot parse must be refused
```

Both were run on the parent while authoring, and those are the messages they produced. `npx tsc -p tsconfig.json --noEmit` exited 0 on the parent with both test files in place.

---

## 7. Inertness mutation

### 7.1 Criteria 1, 2 and 3 — the widened guard

Revert: in `src/store/single-store.ts`, replace

```ts
    ...conflictsUnderOtherRoots(rt, pluginDataRoot, ownKey, layout.projectRoot)
```

with

```ts
    ...[]
```

Run: `node --test test/store/single-store.test.ts`

Must turn red with: `a second store for this project under another plugin-data root must be refused`

Restore: put the call back and re-run; the test must pass.

### 7.2 Criteria 6, 7 and 8 — the closed passthrough

Revert: in `src/merge/sync.ts`, change

```ts
      if (theirs.passthrough.length > 0) {
```

to

```ts
      if (theirs.passthrough.length > 0 && false) {
```

and change the write call back to the parent's form by restoring the `changes` array exactly as quoted in section 2.5 and calling `writeRecords(rt, layout, changes, message, writeOps)`.

Run: `node --test test/sync/conflict.test.ts`

Must turn red with: `a merge carrying remote bytes this version cannot parse must be refused`

Restore: re-apply steps 4, 5 and 6 and re-run; the test must pass.

---

## 8. Full verification

### 8.1 Typecheck

```
npx tsc -p tsconfig.json --noEmit
```

Expect exit code 0 and no output.

### 8.2 Packaging

```
node scripts/check-packaging.mjs
```

Expect exit code 0 and the output `check-packaging: ok`.

### 8.3 The two receipts and the path-free census

```
node --test test/store/single-store.test.ts test/sync/conflict.test.ts test/contract/no-path.test.ts
```

Expect exit code 0 and the output to contain `fail 0`.

### 8.4 The full suite

```
npm test
```

Expect exit code 0 and the output to contain `fail 0`.

Any failure of `concurrent.distinct-ids` in `test/spawn/decisions.test.ts` is IN SCOPE for this unit's surface and must be reported, never re-run away. STOP and report; do not improvise, and do not edit, skip, focus or delete any test.

### 8.5 The cost the widened guard adds, measured

The guard runs on every store open, so its cost is part of this change and is reported rather than assumed. Measured while the plan was written, by loading the parent's and the change's `openStore` into one process and alternating between them against separate fixture stores, median of thirty-one repetitions, on Node v26.4.0:

| Plugin-data root placed in | Records | Parent | Change |
|---|---|---|---|
| a directory holding 1 175 sibling directories | 200 | 6.51 ms | 10.61 ms |
| a directory holding 1 175 sibling directories | 800 | 6.61 ms | 10.13 ms |
| a directory holding one sibling directory | 200 | 6.69 ms | 6.66 ms |
| a directory holding one sibling directory | 800 | 6.94 ms | 6.82 ms |

Read this way: the guard costs about four milliseconds per store open when the plugin-data root sits directly inside a directory with roughly twelve hundred other directories, and nothing measurable when it sits in a small one. On this machine's real installed layout the plugin-data root has 23 siblings and the scan measures 0.06 ms.

The four-millisecond case is what the test fixtures produce, because they place the plugin-data root directly in the system temporary directory. It is not what an install produces. The cost was not reduced further by caching the answer for the lifetime of the process, because that would let a duplicate store that appears while a server is running go undetected until restart, and a safety guard is not traded for four milliseconds.

### 8.6 Confirming the guard's population is real, read-only

This is an observation of the machine, not a suite check, and it opens no store and calls no tool. It confirms the shape section 2.3 describes still exists:

```
find ~/.claude/plugins/data -maxdepth 4 -name origin.json
```

Two of the printed paths differ only in the install directory name and carry the same key. Reading either file shows the same `project_root`. Nothing is modified, moved or deleted.

**Operational consequence, which the pull request must state.** Once this change is installed, a project that has two stores on one machine stops opening until a human removes one of them. That is the guard doing its job — the alternative is two divergent histories for one project, which is the defect. The refusal names both installs and the key, which is what a human needs to choose which to remove. This plan does not remove either, and no step here touches any store on this machine.

---

## 9. Commits

Refactor and behaviour change never share a commit. There are three commits.

### Commit 1

```
fix(store): detect a second store for this project under another plugin-data root
```

Files: `src/store/single-store.ts`, `test/store/single-store.test.ts`

Contains plan steps 1, 2, 3 and test 5.1.

### Commit 2

```
fix(sync): refuse a merge carrying remote record bytes this version cannot parse
```

Files: `src/merge/sync.ts`, `test/sync/conflict.test.ts`

Contains plan steps 4, 5, 6 and test 5.2.

### Commit 3

```
chore: bump the plugin version
```

Files: `package.json`, `.claude-plugin/plugin.json`

Contains plan step 7.

---

## 10. Pull request

Opened with the operator's global tool. Ad-hoc `gh pr create`, `gh api` posts to the pulls endpoint and the GitHub pull-request tool are refused at the gate. A title and body are fixed at creation and never rewritten afterwards, so `gh pr edit` is never run.

If a check was not run, change its line to `--not-verified "<thing> - not run"`.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head perf/u2-store-cost-and-safety-b \
  --base main \
  --title "fix(store): close two ways foreign data reached the ledger" \
  --what "A project that has two stores on this machine is now refused at open, naming both of them, instead of one being used and the other silently ignored." \
  --what "A sync whose shared copy holds a record file this version cannot read is now refused, and neither copy is changed, instead of those bytes being written into the local history unchecked." \
  --why "The duplicate check only looked at directories beside its own, so a second install of this plugin produced a second history for the same project that nothing noticed." \
  --why "One merge path wrote unreadable remote files straight into the local history without any validation, which was the only way unchecked outside data could get in." \
  --risk "A machine that already has two stores for one project will stop opening that project until a human deletes one of them; the refusal names both." \
  --verified "npm test - 440 tests, 0 fail, exit 0" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok, exit 0" \
  --verified "store open with the widened check, plugin-data root holding 23 siblings - 0.06 ms added" \
  --not-verified "the duplicate this machine actually has - observed read-only, not resolved and not opened"
```

**Diff size, measured by applying every step of this plan to a throwaway copy of the tree and reading `git diff --numstat`:**

| Part | Insertions | Deletions | Total |
|---|---|---|---|
| `src/store/single-store.ts` | 38 | 7 | 45 |
| `src/merge/sync.ts` | 13 | 6 | 19 |
| `test/store/single-store.test.ts` | 54 | 0 | 54 |
| `test/sync/conflict.test.ts` | 18 | 9 | 27 |
| version bump | 2 | 2 | 4 |
| **Total** | **125** | **24** | **149** |

Production code is 64 of those lines and tests are 85. The number is below the 200-line target, so this half is not split further.

---

## 11. Stop conditions

Each of these invalidates the plan. In every case: **STOP and report; do not improvise.**

### 11.1 `U1` has not landed

```
git log --oneline main | grep -c "u1-schema-foundations\|schema foundations"
```

If the count is `0`, STOP and report; do not improvise.

### 11.2 The first half of this unit has not landed

This plan's FIND strings for `src/merge/sync.ts` assume the first half already merged. Run:

```
grep -c "checkout-index" src/merge/sync.ts
```

If this prints `0`, the cost half has not landed and this branch was cut too early. STOP and report; do not improvise.

Then confirm the content arrived rather than trusting a merge status:

```
git merge-base --is-ancestor origin/main HEAD
```

If this exits non-zero, STOP and report; do not improvise.

### 11.3 A FIND string does not match exactly once

Before applying any step, run each of these and confirm each prints exactly `1`:

```
grep -c "^import { readFileSync, readdirSync } from 'node:fs'$" src/store/single-store.ts
grep -c "^  void rt$" src/store/single-store.ts
grep -c "^  const conflictingKeys = siblingKeys.filter($" src/store/single-store.ts
grep -c "^      const { changes: mergedChanges, conflicts } = computeMerge(ours, theirs, base)$" src/merge/sync.ts
grep -c "^      const changes: RecordChange\[\] = \[$" src/merge/sync.ts
grep -c "^      const commitResult = writeRecords(rt, layout, changes, message, writeOps)$" src/merge/sync.ts
grep -c "^test('sync.preserves-a-remote-only-quarantined-record', () => {$" test/sync/conflict.test.ts
grep -c "^test('store.single-store-with-no-sibling-is-ok', () => {$" test/store/single-store.test.ts
```

If any prints anything other than `1`, a file has moved under this plan. STOP and report; do not improvise.

### 11.4 The two version files disagree before the change

```
node -e "const a=require('./package.json').version;const b=require('./.claude-plugin/plugin.json').version;console.log(a===b?'match':'MISMATCH '+a+' '+b)"
```

If this prints anything other than `match`, STOP and report; do not improvise. A version merely higher than `1.5.1` is not a stop condition — it means the ladder shifted, and step 7 reads whatever is there and increments it.

### 11.5 The suite

```
Run: npm test
Any failure of `concurrent.distinct-ids` in `test/spawn/decisions.test.ts` is IN SCOPE for
this unit's surface and must be reported, never re-run away. STOP and report; do not
improvise, and do not edit, skip, focus or delete any test.
```

### 11.6 Never run an install

`node_modules` is tracked in this repository and an install rewrites tracked files. Never run `npm ci` or `npm install`, for any reason, including a dependency that appears to be missing. If anything appears to require one, STOP and report; do not improvise.

### 11.7 Never touch a store on this machine

Section 8.6 reads the plugin-data directory. Nothing in this plan modifies, moves or deletes any store, and no `mcp__plugin_logbook_ledger__*` tool is ever called. If any step appears to require one, STOP and report; do not improvise.
