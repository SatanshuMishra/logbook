# MSP-6 — The sync receipt names both shas

## 0. Identity

- **Closes:** D13.
- **Depends on:** two earlier MSPs, for two separate reasons.
  - MSP-1 (`fix/msp-1-materialisation-stamp`) renames the on-disk stamp file from `last-synced` to `last-materialised` and renames `markSynced` to `markMaterialised`. This plan's third test reads the file by its post-rename name. The concrete, checkable precondition is stop condition 1 in section 11.
  - MSP-0 (`fix/msp-0-utf8-source-census`) removes the pinned version literal from `test/contract/cutover-manifests-agree.test.ts`, without which this plan's version bump turns that test red. No source change in this plan depends on MSP-0. The concrete, checkable precondition is stop condition 8 in section 11.
- **Required by:** nothing.
- **Branch name:** `fix/msp-6-sync-receipt-shas`, cut from `main`, pull request targets `main`.
- **Version bump:** Baseline `1.0.7` -> `1.0.8` per orchestrator rulings O1 and O1a. O1a split MSP-4 in two, which shifts every baseline below it by one patch; the step in section 4 is a read-then-increment, so it is correct whatever the ladder actually holds. The step in section 4 is written as a read-then-increment, so a shifted ladder does not invalidate it.
- **SPEC anchors:** section 7 MSP-6; section 6 ruling R8; section 5 defect D13.

### What this MSP is for, in plain words

`sync_ledger` is the tool that reconciles this machine's copy of the logbook with the shared copy on the git remote, and pushes. When it succeeds it tells the caller what it did — for example `pushed`.

The caller has no way to check that claim. The result carries an `action` word and a `ref` field, and `ref` is a fixed module constant (`'refs/logbook/ledger'`), not a value read from anywhere. No commit id appears in the result at all. The strongest evidence that a push landed is `git push` having exited zero, and the result never names even that.

This MSP makes the result carry a **receipt**: the commit id this machine holds, and the commit id the shared copy holds, read back from the remote *after* the push. When those two agree, the caller can verify the push landed instead of trusting the word `pushed`.

---

## 1. Acceptance criteria (the ceiling)

Verbatim from SPEC section 7, MSP-6:

1. A test asserts that after a successful push the reported `remote_sha` is read from the remote **after** the push and equals `local_sha`. Red on the parent, where no sha is reported at all.
2. A test asserts that after a rejected push the action does not claim `pushed` and the shas reflect the true divergence.
3. A test asserts the materialisation stamp still reflects the remote after a rejected push. The audit confirms this test fails today.
4. `npm test` green.

That list is the complete definition of done for this MSP. Anything discovered above it is appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence, and is **not** folded into this plan.

---

## 2. Ground truth

Every excerpt below was read from the working tree on branch `docs/post-cutover-repair-spec`, whose `src/`, `test/`, `hooks/` and `scripts/` trees are byte-identical to `main` at `0ade582`. Line numbers are the ones actually read.

### 2.1 `src/merge/sync.ts:17-20` — the outcome type that carries no sha

```ts
export type SyncOutcome =
  | { ok: true; action: 'noop' | 'pushed' | 'fast-forwarded' | 'merged'; ref: string }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'offline' | 'rejected'; detail: string }
```

What is wrong: the success variant carries a word and a ref name. Neither is a value read from git.

### 2.2 `src/merge/sync.ts:39-42` — `readRef`, the local read that already exists

```ts
const readRef = (rt: Runtime, repo: string, ref: string): string | null => {
  const result = git(rt, repo, ['rev-parse', ref])
  return result.ok ? result.stdout.trim() : null
}
```

What is wrong: nothing here is defective. `readRef` is quoted because step 2 inserts the remote read-back helpers immediately after it and needs an anchor that appears exactly once, and because the local half of the receipt is this function.

### 2.3 `src/merge/sync.ts:236-251` — `fastForward` and `pushPlain`

```ts
const fastForward = (rt: Runtime, layout: StoreLayout, localVal: string | null, remoteVal: string): AttemptOutcome => {
  const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, remoteVal, localVal)
  if (cas.ok) {
    syncWorkingCopy(rt, layout)
    return { kind: 'return', outcome: { ok: true, action: 'fast-forwarded', ref: LEDGER_REF } }
  }
  if (cas.cause === 'ref-moved') return { kind: 'retry' }
  return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: cas.message } }
}

const pushPlain = (rt: Runtime, layout: StoreLayout): AttemptOutcome => {
  const result = git(rt, layout.projectRoot, ['push', REMOTE_NAME, `${LEDGER_REF}:${LEDGER_REF}`])
  if (result.ok) return { kind: 'return', outcome: { ok: true, action: 'pushed', ref: LEDGER_REF } }
  if (isLeaseRejection(result.stderr)) return { kind: 'retry' }
  return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: result.stderr.trim() } }
}
```

What is wrong: line 248 turns `git push` exiting zero into the word `pushed` and reads nothing back from the remote. Between the push exiting zero and the caller reading the result, the remote may have accepted a different value, or lost the ref; nothing here would notice.

### 2.4 `src/merge/sync.ts:312-323` — the push inside `performMerge`

```ts
      const pushResult = git(rt, layout.projectRoot, [
        'push',
        `--force-with-lease=${LEDGER_REF}:${remoteVal}`,
        REMOTE_NAME,
        `${LEDGER_REF}:${LEDGER_REF}`
      ])
      if (!pushResult.ok) {
        if (isLeaseRejection(pushResult.stderr)) return { kind: 'retry' }
        return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: pushResult.stderr.trim() } }
      }

      return { kind: 'return', outcome: { ok: true, action: 'merged', ref: LEDGER_REF } }
```

Same defect, second site.

### 2.5 `src/merge/sync.ts:337` — `ls-remote` already runs here, once, before the push

```ts
  const lsRemote = git(rt, repo, ['ls-remote', REMOTE_NAME, LEDGER_REF])
```

What is relevant: this read happens at the **start** of the attempt, and its result is used only as a presence test (`lsRemote.stdout.trim().length > 0` at line 346). It is not a read-back after the push, and no sha is extracted from it.

### 2.6 `src/merge/sync.ts:357-361` — the noop path, where both shas are already in hand

```ts
  const localVal = readRef(rt, repo, LEDGER_REF)

  if (localVal === remoteVal) {
    return { kind: 'return', outcome: { ok: true, action: 'noop', ref: LEDGER_REF } }
  }
```

What is wrong: the noop result names neither value, even though the decision to report `noop` was made by comparing exactly those two shas one line earlier. The information the caller needs is already in scope and is thrown away.

### 2.7 `src/server/tools/sync_ledger.ts:12-17` — the published output schema

```ts
const SyncLedgerOutputSchema = z.object({
  action: z
    .enum(['noop', 'pushed', 'fast-forwarded', 'merged'])
    .describe('what sync did: nothing changed, a plain push, a fast-forward of the local ledger, or a real merge of both sides'),
  ref: z.string().describe('the ledger ref that sync acted on')
})
```

What is wrong: the published schema offers a caller no field that could carry evidence. `action` is a word and `ref` is a constant, so a caller that wants to verify the push has nothing to read.

### 2.8 `src/server/tools/sync_ledger.ts:78-84` — the handler's success branch

```ts
    if (outcome.ok) {
      return {
        ok: true,
        text: `sync ${outcome.action === 'noop' ? 'found nothing to do' : outcome.action}.`,
        structured: { action: outcome.action, ref: outcome.ref }
      }
    }
```

What is wrong: the handler forwards only `action` and `ref`, so even once `sync` carries the two shas the tool would still drop them before the caller sees them.

### 2.9 `src/store/ref.ts:6` — why `ref` proves nothing

```ts
export const LEDGER_REF = 'refs/logbook/ledger'
```

The `ref` field of every success result is this module constant, so it is identical on every call whatever happened.

### 2.10 The contract test that constrains the schema change

`test/contract/described.test.ts:64-92`, test name `contract.every-property-described`, walks every tool's schema and classifies each property node. Two facts from `classifyDescribedNode` at lines 55-62 and `carriesUnwalkedSubschema` at lines 49-52 bear on this MSP:

- A property with no `description`, or with one shorter than 10 trimmed characters, is `'forbidden'` and the census throws.
- A property node carrying `anyOf`, `oneOf`, `allOf`, `$defs` or `$ref` is `'unclassifiable'` and the census also throws.

Measured on this repository's zod (`4.4.3`) with `z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })`, a `z.string().nullable()` property renders as `{ "anyOf": [{ "type": "string" }, { "type": "null" }], "description": "..." }`. That would be `'unclassifiable'`.

It does not halt this census, because `described.test.ts` walks **input** schemas only — `declare(spec.name, spec.input ...)` at line 70 and `tool.inputSchema` at line 88. `sync_ledger`'s input is `NO_ARGUMENTS`. Output schemas are not censused there. The `.describe()` calls in step 6 are still written on every new property, because they are what the caller reads.

### 2.11 The spawn contract test that validates the published output

`test/sync/resolve.test.ts:334-344`, test name `sync_ledger.spawn.contract`, calls the tool over a spawned server and runs `assertConformsToOutputSchema`. Its validator, `validateAgainstSchema` at lines 115-145, does two things that matter here:

- For every name in the schema's `required` array it asserts `key in value`. So the handler must always emit both new keys, including when their value is `null`.
- It type-checks only when `schema.type` is a string. A nullable property has no `type`, so its value is not type-checked. Emitting `null` is accepted.

### 2.12 The tests that assert specific action words, and must stay green

- `test/sync/quiescence.test.ts`, test name `sync.merge-quiesces-and-advances-merge-base`, asserts `firstPush.action` is `'pushed'`, `pushC.action` is `'pushed'`, `mergeOutcome.action` is `'merged'`, and both final idle syncs are `'noop'`.
- `test/sync/cas-retry.test.ts`, test name `sync.cas-retry`, asserts `pushA.action` is `'pushed'`, `fastForwardBen.action` is `'fast-forwarded'`, `pushC.action` is `'pushed'` and `mergeResult.action` is `'merged'`.

Both run against a local bare remote that answers `ls-remote` normally, so under the change in section 4 every one of those read-backs succeeds and every one of those words is unchanged.

### 2.13 The inherited probe

`docs/audits/2026-08-25-post-cutover-repair-probes/repro-f3.ts` is the probe this MSP inherits. Its PROBE 1, at lines 37-48, establishes that the duplicate-store guard cannot see a second install root. Its contribution to *this* MSP is narrower and is the reason it is shared with MSP-1: at line 59 it reads the state directory by filename,

```ts
console.log('root B has state/last-synced:', existsSync(path.join(layB.value.state, 'last-synced')))
```

which is the read this plan's third test performs under the post-rename filename. Nothing in the probes directory is a test, and none of it is in the tsconfig include set.

### 2.14 `ls-remote` output, measured

`git ls-remote <remote> refs/logbook/ledger` prints one line per matching ref, `<40-hex sha>` then a single TAB then the ref name, then a newline. When the ref is absent from the remote it exits `0` and prints nothing. Both measured in a scratch repository on this machine. `ls-remote` appears zero times in the test suite today, so this plan authors the idiom.

### 2.15 Suite idiom this plan's tests follow

Established by reading `test/sync/quiescence.test.ts`, `test/sync/cas-retry.test.ts`, `test/sync/conflict.test.ts` and `test/support/clone-fixture.ts`:

- The suite contains **no** `describe`, `it`, `suite`, `before`, `after`, `beforeEach` or `afterEach` anywhere. Every test is a flat top-level `test('name', () => { ... })` from `node:test`. This plan therefore gives exact `test(...)` name strings and no `describe(...)` names, because none exist to match.
- `import assert from 'node:assert/strict'`, `import { test } from 'node:test'`, `assert.equal` rather than `assert.strictEqual`.
- Test names are `<subject>.<kebab-case-predicate>`, all lowercase, British `-ise` spelling. The subject used across `test/sync/` for `sync()` behaviour is `sync.`.
- Two-clone fixtures come from `withTwoClones` in `test/support/clone-fixture.ts`, which provisions a bare remote plus two clones, each with its own plugin-data directory, and removes all of them in its `finally`. Unused teammates are underscore-prefixed, as at `test/sync/conflict.test.ts:44`.
- Every `test/sync/` file redeclares its own `layoutIn` and `makeThread` helpers rather than importing them. That duplication is the idiom.
- The production `git` helper from `src/store/git.ts` is what tests use to inspect refs; `rawGit` from `test/support/git-fixture.ts` is for setting up the project repository's own git state.

---

## 3. Divergences from the SPEC

**3.1 A fifth `action` value is added, because R8 requires a success that does not claim `pushed`.**

SPEC section 6, ruling R8 says: "Where the read-back cannot be performed, the fields are null and the action does not claim `pushed`." The sentence describes an outcome that still carries an action and still carries the two fields, so it is a success, not a refusal. None of the four existing action words is honest for it: the push was made, its arrival was not confirmed.

Ruled here: the action enum gains `'pushed-unverified'`. This satisfies invariant I2, which permits "a success whose structured result names exactly what it did and did not do".

Rejected alternative, in one line: turning an unconfirmable read-back into a refusal, rejected because it reports a failure for a push that probably succeeded, and R8's own wording keeps an action in the result.

**3.2 Acceptance criterion 3's wording is read as "the stamp is not a push receipt".**

SPEC section 7, MSP-6 criterion 3 says "A test asserts the materialisation stamp still reflects the remote after a rejected push." Taken at face value that is unsatisfiable, and SPEC section 5, D5 says why: the stamp "records the last commit **materialised into the local working copy**", it is written after a purely local compare-and-swap, and `writeRecords` "never contacts a remote". After a rejected push the local ref has advanced and the remote has not, so the stamp reflects the **local** tip and cannot reflect the remote.

The claim D13 actually establishes is the one this criterion exists to pin: "A test asserting that the stamp still reflects the remote after a rejected push would fail today." That is a statement that the stamp is not evidence about the remote. The test in section 5.2 asserts exactly that, in three assertions: after a rejected push the stamp equals the local ledger tip, the stamp does not equal the sha the remote holds, and the two sides have genuinely diverged. MSP-1 renames the stamp to `last-materialised` for the same reason, and this test is the assertion that the new name is the accurate one.

**3.3 The ladder lands on `1.1.1`, not `1.1.0`.** SPEC section 7 states the ladder lands on `1.1.0`; MSP-9 merges last and the ladder lands on `1.1.1`. This does not affect any step in this plan.

**3.4 The pull request tool path.** SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib` in this repository; the tool is the operator's global one at `node ~/.claude/lib/git/pr.mjs pr-create`, which section 10 uses.


**3.5 The manifest-agreement test pins a version literal, and this plan does not repair it.**

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

Apply in the order given. The tree is type-correct after step 7 and after step 9. Steps 1 through 6 leave the tree type-broken between them, because the outcome type gains required fields before every construction site supplies them; that is why they are one commit.

### Step 1 — `src/merge/sync.ts` — REPLACE the outcome type

Rationale: ruling R8 — "`SyncLedgerOutputSchema` gains `local_sha` and `remote_sha`", which the sync layer must carry out.

FIND:

```ts
export type SyncOutcome =
  | { ok: true; action: 'noop' | 'pushed' | 'fast-forwarded' | 'merged'; ref: string }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'offline' | 'rejected'; detail: string }
```

REPLACE:

```ts
export type SyncAction = 'noop' | 'pushed' | 'pushed-unverified' | 'fast-forwarded' | 'merged'

export type SyncOutcome =
  | { ok: true; action: SyncAction; ref: string; local_sha: string | null; remote_sha: string | null }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'offline' | 'rejected'; detail: string }
```

### Step 2 — `src/merge/sync.ts` — INSERT-AFTER `readRef`

Rationale: ruling R8 — "`sync_ledger` performs an `ls-remote` read-back and reports the remote ref's sha as read **after** the push, alongside the local sha. Equality of the two is the receipt."

FIND:

```ts
const readRef = (rt: Runtime, repo: string, ref: string): string | null => {
  const result = git(rt, repo, ['rev-parse', ref])
  return result.ok ? result.stdout.trim() : null
}
```

REPLACE:

```ts
const readRef = (rt: Runtime, repo: string, ref: string): string | null => {
  const result = git(rt, repo, ['rev-parse', ref])
  return result.ok ? result.stdout.trim() : null
}

const readRemoteLedgerSha = (rt: Runtime, repo: string): string | null => {
  const result = git(rt, repo, ['ls-remote', REMOTE_NAME, LEDGER_REF])
  if (!result.ok) return null
  const line = result.stdout.split('\n').find((entry) => entry.trim().length > 0)
  if (line === undefined) return null
  const sha = line.split('\t')[0]
  if (sha === undefined) return null
  const trimmed = sha.trim()
  return trimmed.length === 0 ? null : trimmed
}

type PushReceipt = { local_sha: string | null; remote_sha: string | null; verified: boolean }

const readBackAfterPush = (rt: Runtime, layout: StoreLayout): PushReceipt => {
  const remoteSha = readRemoteLedgerSha(rt, layout.projectRoot)
  if (remoteSha === null) return { local_sha: null, remote_sha: null, verified: false }
  const localSha = readRef(rt, layout.projectRoot, LEDGER_REF)
  if (localSha === null) return { local_sha: null, remote_sha: null, verified: false }
  return { local_sha: localSha, remote_sha: remoteSha, verified: localSha === remoteSha }
}
```

### Step 3 — `src/merge/sync.ts` — REPLACE `fastForward`'s success return

Rationale: ruling R8 — "`SyncLedgerOutputSchema` gains `local_sha` and `remote_sha`" makes the two fields required on every success, and after a fast-forward the local ref has been set to exactly the remote value that was fetched, so both are already in hand and no extra subprocess is spent.

FIND:

```ts
    return { kind: 'return', outcome: { ok: true, action: 'fast-forwarded', ref: LEDGER_REF } }
```

REPLACE:

```ts
    return {
      kind: 'return',
      outcome: { ok: true, action: 'fast-forwarded', ref: LEDGER_REF, local_sha: remoteVal, remote_sha: remoteVal }
    }
```

### Step 4 — `src/merge/sync.ts` — REPLACE `pushPlain`'s success return

Rationale: ruling R8 — the read-back after the push, and "Where the read-back cannot be performed, the fields are null and the action does not claim `pushed`."

FIND:

```ts
  if (result.ok) return { kind: 'return', outcome: { ok: true, action: 'pushed', ref: LEDGER_REF } }
```

REPLACE:

```ts
  if (result.ok) {
    const receipt = readBackAfterPush(rt, layout)
    return {
      kind: 'return',
      outcome: {
        ok: true,
        action: receipt.verified ? 'pushed' : 'pushed-unverified',
        ref: LEDGER_REF,
        local_sha: receipt.local_sha,
        remote_sha: receipt.remote_sha
      }
    }
  }
```

### Step 5 — `src/merge/sync.ts` — REPLACE the merge push's success return

Rationale: same ruling, second push site.

FIND:

```ts
      return { kind: 'return', outcome: { ok: true, action: 'merged', ref: LEDGER_REF } }
```

REPLACE:

```ts
      const mergeReceipt = readBackAfterPush(rt, layout)
      return {
        kind: 'return',
        outcome: {
          ok: true,
          action: mergeReceipt.verified ? 'merged' : 'pushed-unverified',
          ref: LEDGER_REF,
          local_sha: mergeReceipt.local_sha,
          remote_sha: mergeReceipt.remote_sha
        }
      }
```

### Step 6 — `src/merge/sync.ts` — REPLACE the noop return

Rationale: ruling R8 — the two fields are required on every success, and a noop is decided by the local and fetched remote values being equal, so reporting them costs nothing and keeps the success variant total.

FIND:

```ts
    return { kind: 'return', outcome: { ok: true, action: 'noop', ref: LEDGER_REF } }
```

REPLACE:

```ts
    return {
      kind: 'return',
      outcome: { ok: true, action: 'noop', ref: LEDGER_REF, local_sha: localVal, remote_sha: remoteVal }
    }
```

### Step 7 — `src/server/tools/sync_ledger.ts` — REPLACE the output schema

Rationale: ruling R8 — "`SyncLedgerOutputSchema` gains `local_sha` and `remote_sha`". Every property carries a `.describe()` longer than 10 characters, matching the rule `test/contract/described.test.ts` enforces on schema properties.

FIND:

```ts
const SyncLedgerOutputSchema = z.object({
  action: z
    .enum(['noop', 'pushed', 'fast-forwarded', 'merged'])
    .describe('what sync did: nothing changed, a plain push, a fast-forward of the local ledger, or a real merge of both sides'),
  ref: z.string().describe('the ledger ref that sync acted on')
})
```

REPLACE:

```ts
const SyncLedgerOutputSchema = z.object({
  action: z
    .enum(['noop', 'pushed', 'pushed-unverified', 'fast-forwarded', 'merged'])
    .describe('what sync did: nothing changed, a push whose arrival on the shared copy was confirmed, a push whose arrival could not be confirmed, a fast-forward of the local ledger, or a real merge of both sides'),
  ref: z.string().describe('the ledger ref that sync acted on'),
  local_sha: z
    .string()
    .nullable()
    .describe('the commit this machine holds on the ledger ref when sync finished, or null when it could not be read'),
  remote_sha: z
    .string()
    .nullable()
    .describe('the commit the shared copy holds on the ledger ref, read back from the remote after any push, or null when it could not be read')
})
```

### Step 8 — `src/server/tools/sync_ledger.ts` — REPLACE the handler's success branch

Rationale: ruling R8 — the caller receives the receipt. Both keys are always present, including when their value is null, because the published schema lists them as required.

FIND:

```ts
        structured: { action: outcome.action, ref: outcome.ref }
```

REPLACE:

```ts
        structured: {
          action: outcome.action,
          ref: outcome.ref,
          local_sha: outcome.local_sha,
          remote_sha: outcome.remote_sha
        }
```

### Step 9 — `package.json` and `.claude-plugin/plugin.json` — REPLACE the version line in both

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

Expected exit code `0`. Expected stdout under the baseline: `version 1.0.8`.

Then confirm the result with this command.

```bash
git --no-pager diff --no-color -U0 -- package.json .claude-plugin/plugin.json
```

Expected exit code `0`. The two `index <sha>..<sha> 100644` lines are content hashes and are not predictable; the four load-bearing lines are the two removed and two added `"version"` lines, and under the baseline the output contains exactly these four:

```
-  "version": "1.0.7",
+  "version": "1.0.8",
-  "version": "1.0.7",
+  "version": "1.0.8",
```

Then confirm the result with this command.

```bash
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout contains `check-packaging: ok`.

---

## 5. Tests

One new file. No existing test file is modified.

### 5.1 CREATE `test/sync/receipt.test.ts`

Entire file contents, first character to last:

```ts
import assert from 'node:assert/strict'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync } from '../../src/merge/sync.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Teammate } from '../support/clone-fixture.ts'
import { withTwoClones } from '../support/clone-fixture.ts'

const STAMP_FILE_NAME = 'last-materialised'

type SyncReceiptFields = { local_sha: string | null; remote_sha: string | null }

const receiptOf = (outcome: object): Partial<SyncReceiptFields> => outcome as Partial<SyncReceiptFields>

const layoutIn = (teammate: Teammate): StoreLayout => {
  const result = layoutFor(teammate.rt, teammate.repo)
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

const installRemoteHook = (remote: string, name: string, body: string): void => {
  const hookPath = join(remote, 'hooks', name)
  writeFileSync(hookPath, body, 'utf8')
  chmodSync(hookPath, 0o755)
}

const denyEveryPush = (remote: string): void => {
  installRemoteHook(remote, 'pre-receive', '#!/bin/sh\nexit 1\n')
}

const acceptThenDropEveryPush = (remote: string): void => {
  installRemoteHook(remote, 'post-receive', `#!/bin/sh\ngit update-ref -d ${LEDGER_REF}\n`)
}

const refIn = (rt: Runtime, repo: string): string => {
  const result = git(rt, repo, ['rev-parse', LEDGER_REF])
  assert.equal(result.ok, true, `expected ${LEDGER_REF} to resolve in the repository under test`)
  if (!result.ok) throw new Error('expected the ledger ref to resolve')
  return result.stdout.trim()
}

const seedAndCommit = (teammate: Teammate, slug: string): void => {
  const change = makeThread(teammate.rt, slug)
  const committed = teammate.store.commit([change], `${teammate.name}: create ${slug}`)
  assert.equal(committed.ok, true, `expected ${teammate.name} to commit ${slug}`)
}

test('sync.receipt-names-both-shas-after-a-push', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)
    seedAndCommit(ana, 'receipt-thread')

    const pushed = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushed.ok, true)
    if (!pushed.ok) return
    assert.equal(pushed.action, 'pushed')

    assert.equal(typeof receiptOf(pushed).local_sha, 'string', 'a confirmed push must report the local commit it pushed')
    assert.equal(typeof receiptOf(pushed).remote_sha, 'string', 'a confirmed push must report the commit read back from the remote')
    assert.equal(receiptOf(pushed).local_sha, receiptOf(pushed).remote_sha, 'the receipt is the two shas agreeing')

    assert.equal(
      receiptOf(pushed).remote_sha,
      refIn(ana.rt, remote),
      'the reported remote sha must be the commit the shared copy actually holds after the push'
    )
    assert.equal(
      receiptOf(pushed).local_sha,
      refIn(ana.rt, ana.repo),
      'the reported local sha must be the commit this machine actually holds'
    )
  })
})

test('sync.a-rejected-push-does-not-claim-pushed', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)

    seedAndCommit(ana, 'accepted-thread')
    const accepted = sync(ana.rt, ana.store, anaLayout)
    assert.equal(accepted.ok, true)
    if (!accepted.ok) return
    assert.equal(accepted.action, 'pushed')
    const remoteBeforeRejection = refIn(ana.rt, remote)
    assert.equal(receiptOf(accepted).remote_sha, remoteBeforeRejection)

    denyEveryPush(remote)

    seedAndCommit(ana, 'rejected-thread')
    const rejected = sync(ana.rt, ana.store, anaLayout)

    assert.equal(rejected.ok, false, 'a push the shared copy refuses must not be reported as a success')
    if (rejected.ok) return
    assert.equal(rejected.reason, 'rejected')

    const localAfter = refIn(ana.rt, ana.repo)
    const remoteAfter = refIn(ana.rt, remote)
    assert.notEqual(localAfter, remoteAfter, 'the fixture requires the two sides to have genuinely diverged')
    assert.equal(remoteAfter, remoteBeforeRejection, 'a rejected push must leave the shared copy where it was')
  })
})

test('sync.the-materialisation-stamp-is-not-a-push-receipt', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)

    seedAndCommit(ana, 'stamp-accepted-thread')
    const accepted = sync(ana.rt, ana.store, anaLayout)
    assert.equal(accepted.ok, true)

    denyEveryPush(remote)

    seedAndCommit(ana, 'stamp-rejected-thread')
    const rejected = sync(ana.rt, ana.store, anaLayout)
    assert.equal(rejected.ok, false)

    const stamp = readFileSync(join(anaLayout.state, STAMP_FILE_NAME), 'utf8').trim()
    const localAfter = refIn(ana.rt, ana.repo)
    const remoteAfter = refIn(ana.rt, remote)

    assert.equal(stamp, localAfter, 'the stamp records the local materialisation and follows the local ledger ref')
    assert.notEqual(stamp, remoteAfter, 'the stamp is not evidence about the shared copy')
    assert.notEqual(localAfter, remoteAfter, 'the fixture requires the two sides to have genuinely diverged')
  })
})

test('sync.an-unconfirmable-push-does-not-claim-pushed', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)
    acceptThenDropEveryPush(remote)

    seedAndCommit(ana, 'unconfirmable-thread')
    const outcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(outcome.ok, true, 'a push git accepted is still a success')
    if (!outcome.ok) return
    assert.equal(
      outcome.action,
      'pushed-unverified',
      'a push whose arrival cannot be read back must not claim to have been confirmed'
    )
    assert.equal(receiptOf(outcome).local_sha, null, 'an unconfirmable push reports no local sha')
    assert.equal(receiptOf(outcome).remote_sha, null, 'an unconfirmable push reports no remote sha')
  })
})
```

### 5.2 Which test discharges which acceptance criterion

| Criterion | Test name | File |
| --- | --- | --- |
| 1 | `sync.receipt-names-both-shas-after-a-push` | `test/sync/receipt.test.ts` |
| 2 | `sync.a-rejected-push-does-not-claim-pushed` | `test/sync/receipt.test.ts` |
| 3 | `sync.the-materialisation-stamp-is-not-a-push-receipt` | `test/sync/receipt.test.ts` |
| 4 | `npm test` in section 8 | — |

`sync.an-unconfirmable-push-does-not-claim-pushed` covers ruling R8's second sentence, "Where the read-back cannot be performed, the fields are null and the action does not claim `pushed`". Without it the `'pushed-unverified'` branch added in steps 4 and 5 has no test at all, and SPEC section 8.2 records that the Stryker mutate scope does not include `src/merge/sync.ts`, so nothing else would catch it. It is inside the change R8 mandates and is not an extension of the ceiling.

`sync.receipt-names-both-shas-after-a-push` discharges the "read from the remote **after** the push" half of criterion 1 by comparing the reported `remote_sha` against `git rev-parse refs/logbook/ledger` run in the bare remote itself, after `sync` returned. A value carried over from the pre-push `ls-remote` at `src/merge/sync.ts:337` cannot satisfy that assertion, because before the push the remote holds no ledger ref at all in this fixture.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time; `0ade582` at authoring time. MSP-1 is expected to have merged into `main` before this branch is cut; stop condition 1 in section 11 is the check for that.

**All four tests typecheck on the parent.** The two fields step 1 adds are read through the file-local `receiptOf` helper, which widens the outcome to `Partial<SyncReceiptFields>`, so the file compiles against the pre-fix `SyncOutcome` and the absent properties simply evaluate to `undefined` at run time.


**No substitute procedure is needed.** Run the tests on the parent directly and read the runtime failures.

Commit the new test file first (section 9, commit 1), then run:

```bash
node --test "test/sync/receipt.test.ts"
```

Expected exit code `1`. Expected results, per test:

| Test | Result on the parent | The failure you will see |
| --- | --- | --- |
| `sync.receipt-names-both-shas-after-a-push` | **fails** | `assert.equal(typeof receiptOf(pushed).local_sha, 'string', ...)` fails, reported as `Expected values to be strictly equal:\n\n'undefined' !== 'string'` under `a confirmed push must report the local commit it pushed`. On the parent the success variant carries only `action` and `ref`. |
| `sync.a-rejected-push-does-not-claim-pushed` | **fails** | `assert.equal(receiptOf(accepted).remote_sha, remoteBeforeRejection)` fails, with `undefined` on one side and a 40-character sha on the other. |
| `sync.an-unconfirmable-push-does-not-claim-pushed` | **fails** | `assert.equal(outcome.action, 'pushed-unverified', ...)` fails, reported as `Expected values to be strictly equal:\n\n'pushed' !== 'pushed-unverified'` under `a push whose arrival cannot be read back must not claim to have been confirmed`. |
| `sync.the-materialisation-stamp-is-not-a-push-receipt` | **passes** | It asserts a property of the stamp that MSP-1 already established and this MSP does not change: after a rejected push the stamp equals the local ledger tip and differs from the sha the shared copy holds. Criterion 3 does not require a red on the parent, and section 3.2 records why the criterion is read this way. |

Run `npm run typecheck` after commit 1 as well as after commit 2; it exits `0` at both points.

---

## 7. Inertness mutation

SPEC section 7, MSP-6 declares no inertness criterion. One is given anyway, because SPEC section 8.1 requires every fix to ship with one: "revert what the fix added and the assertion must turn red again."

**The exact edit to revert.** In `src/merge/sync.ts`, replace the body of `readBackAfterPush` added by step 2:

```ts
const readBackAfterPush = (rt: Runtime, layout: StoreLayout): PushReceipt => {
  const remoteSha = readRemoteLedgerSha(rt, layout.projectRoot)
  if (remoteSha === null) return { local_sha: null, remote_sha: null, verified: false }
  const localSha = readRef(rt, layout.projectRoot, LEDGER_REF)
  if (localSha === null) return { local_sha: null, remote_sha: null, verified: false }
  return { local_sha: localSha, remote_sha: remoteSha, verified: localSha === remoteSha }
}
```

with a version that reports the local sha on both sides and never contacts the remote, which is the pre-fix behaviour of trusting the push's exit code:

```ts
const readBackAfterPush = (rt: Runtime, layout: StoreLayout): PushReceipt => {
  const localSha = readRef(rt, layout.projectRoot, LEDGER_REF)
  return { local_sha: localSha, remote_sha: localSha, verified: true }
}
```

**The exact test that must turn red.**

```bash
node --test "test/sync/receipt.test.ts"
```

Expected exit code `1`, with `sync.an-unconfirmable-push-does-not-claim-pushed` failing on `assert.equal(outcome.action, 'pushed-unverified', ...)`, reported as `Expected values to be strictly equal:\n\n'pushed' !== 'pushed-unverified'` under `a push whose arrival cannot be read back must not claim to have been confirmed`.

Exactly one test turns red under this mutation. The other three, including `sync.receipt-names-both-shas-after-a-push`, still pass, and that is the expected result rather than a sign the mutation was applied wrongly: after a push that the remote accepted, the local and remote refs hold the same commit, so a `remote_sha` copied from the local ref still equals the sha the remote holds and that test cannot discriminate. `sync.an-unconfirmable-push-does-not-claim-pushed` is the test that can, because in its fixture the remote drops the ref after accepting it.

**The exact restore.** Apply the two blocks above in reverse: replace the three-line body with the six-line body step 2 specifies. Then re-run:

```bash
node --test "test/sync/receipt.test.ts"
```

Expected exit code `0`, with the summary line `fail 0`.

---

## 8. Full verification

Run each of these from the repository root, in this order.

| # | Command | Expected exit code | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | `0` | no line containing `error TS`; the two `> logbook@` banner lines are normal npm output and are not a failure |
| 2 | `node --test "test/sync/receipt.test.ts"` | `0` | `fail 0` |
| 3 | `node --test "test/sync/quiescence.test.ts"` | `0` | `fail 0` |
| 4 | `node --test "test/sync/cas-retry.test.ts"` | `0` | `fail 0` |
| 5 | `node --test "test/sync/resolve.test.ts"` | `0` | `fail 0` |
| 6 | `node --test "test/contract/described.test.ts" "test/contract/published-schema.test.ts" "test/contract/mandatory-tests.test.ts"` | `0` | `fail 0` |
| 7 | `node --test "test/contract/no-path.test.ts"` | `0` | `fail 0` |
| 8 | `node --test "test/sync/**/*.test.ts"` | `0` | `fail 0` |
| 9 | `npm test` | `0` | `fail 0` |
| 10 | `node scripts/check-packaging.mjs` | `0` | `check-packaging: ok` |

Commands 3 and 4 are listed separately because both assert exact `action` words (section 2.12) and are the tests most likely to catch a read-back that fails in a normal fixture. Command 5 is listed separately because `sync_ledger.spawn.contract` validates the published output schema against the real structured result over a spawned server (section 2.11). Command 6 is the schema-contract group: `described.test.ts` for property descriptions, `published-schema.test.ts` for the published input surface, `mandatory-tests.test.ts` for the rule that every published tool has a `<tool>.spawn.contract` and a `<tool>.rejects-invalid` test — both of which already exist for `sync_ledger` in `test/sync/resolve.test.ts` and are not renamed by this MSP.

---

## 9. Commits

Three commits, in this order. There is no refactor in this MSP, so no refactor commit exists to keep separate from the behaviour change.

**Commit 1 — the tests, before the fix**

```
test(sync): pin that the sync receipt names both shas or does not claim a push
```

Files: `test/sync/receipt.test.ts`.
Plan steps: section 5.1.
This commit is intentionally red. It typechecks: the new fields are read through the file-local widening helper. The branch is squash-merged, so no red commit reaches `main`.

**Commit 2 — the behaviour fix**

```
fix(sync): report both ledger shas and never claim an unconfirmed push
```

Files: `src/merge/sync.ts`, `src/server/tools/sync_ledger.ts`.
Plan steps: 1, 2, 3, 4, 5, 6, 7, 8.

**Commit 3 — the version bump**

```
chore(release): bump the plugin version for the sync receipt
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Plan steps: 9.

Authored change size, counted across all three commits: about 70 changed lines under `src/`, about 175 lines of new test file, and 2 lines in the manifests. Roughly 247 lines in total, under the 400-line ceiling, and no split is taken.

---

## 10. Pull request

Run exactly this, from the repository root, after the branch is pushed:

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/msp-6-sync-receipt-shas --base main \
  --title "fix(sync): report both ledger shas in the sync receipt" \
  --what "The sync result now names the commit this machine holds and the commit the shared copy holds, read back from the remote after the push." \
  --what "A push whose arrival on the shared copy cannot be read back is reported as unverified with no shas, instead of being reported as a completed push." \
  --why "The result carried only a word and a fixed ref name, so the caller had no way to check that anything reached the shared copy." \
  --why "The strongest evidence a push landed was the push command exiting zero, and the result never named even that." \
  --risk "Callers that switch on the reported action now see a fifth value when the read-back cannot be performed." \
  --verified "npm test - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "inertness mutation removing the remote read-back - sync.an-unconfirmable-push-does-not-claim-pushed turns red" \
  --not-verified "mutation (Stryker) - not run against this diff"
```

Expected exit code `0`. Expected stdout contains `https://github.com/SatanshuMishra/logbook/pull/`.

The mutation-scope sentence SPEC section 8.2 requires: the Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`, `src/merge/conflict.ts`, `src/render/**`. This MSP's changes are in `src/merge/sync.ts` and `src/server/tools/sync_ledger.ts`, both of which fall **outside** that scope entirely. The mutation job will report success having mutated nothing in this diff, which is why the flag above is `--not-verified "mutation (Stryker) - not run against this diff"`. Do not upgrade that to a `--verified` line on the strength of a green mutation job; a job that mutated none of your files proves nothing about them.

---

## 11. Stop conditions

For each of these: **STOP and report; do not improvise.**

1. **MSP-1 has not merged.** Before step 1, run:

   ```bash
   git grep -c "last-materialised" -- src/store/read-path.ts
   ```

   Expected exit code `0` and output exactly `src/store/read-path.ts:1`. If the exit code is `1` and there is no output, the stamp rename from `fix/msp-1-materialisation-stamp` is not in this branch's history and this plan's third test will fail with `ENOENT ... last-materialised`. STOP and report; do not improvise.

   Then run:

   ```bash
   git grep -q "^import { markMaterialised," -- src/store/records.ts
   ```

   Expected exit code `0` and no output. Exit code `1` means the same dependency is missing. STOP and report; do not improvise. This form asks only whether the renamed function is imported, so it stays correct however many call sites MSP-1 ends up with.

2. **A FIND string does not match.** Any FIND block in section 4 that does not appear verbatim and exactly once in the named file means the tree is not the one this plan was written against. STOP and report; do not improvise.

3. **`ls-remote` does not print a tab-separated sha.** Before step 2, run this in any clone that has a remote: `git ls-remote origin HEAD`. Expect exit code `0` and a line whose first field is a 40-character hexadecimal sha followed by a tab. If the separator is not a tab, the parser in step 2 cannot extract the sha. STOP and report; do not improvise.

4. **`test/sync/quiescence.test.ts` or `test/sync/cas-retry.test.ts` turns red after step 8.** Run `node --test "test/sync/quiescence.test.ts" "test/sync/cas-retry.test.ts"` immediately after step 8 and expect exit code `0` and `fail 0`. A failure asserting `'pushed-unverified' !== 'pushed'` or `'pushed-unverified' !== 'merged'` means the read-back is failing against an ordinary local bare remote, which is not the behaviour this plan specifies. STOP and report; do not improvise.

5. **`test/contract/described.test.ts` turns red after step 7.** Run `node --test "test/contract/described.test.ts"` immediately after step 7 and expect exit code `0` and `fail 0`. A census halting on an unclassifiable node would mean the output schema is being walked after all, contrary to section 2.10. STOP and report; do not improvise.

6. **The remote hook fixtures do not take effect.** In `sync.a-rejected-push-does-not-claim-pushed`, if `assert.equal(rejected.ok, false, ...)` fails with `true !== false`, the `pre-receive` hook did not run and the push was accepted. In `sync.an-unconfirmable-push-does-not-claim-pushed`, if `assert.equal(outcome.action, 'pushed-unverified', ...)` fails with `'pushed' !== 'pushed-unverified'` **after** step 4 is applied, the `post-receive` hook did not run. Either means this git build or this filesystem is not honouring executable hook files in the bare fixture remote. STOP and report; do not improvise.

7. **The version files disagree before the change.** Run `node -e "const f=(p)=>JSON.parse(require('fs').readFileSync(p,'utf8')).version; process.stdout.write(f('package.json')+' '+f('.claude-plugin/plugin.json')+'\n')"`. Expected exit code `0` and two identical values. If the two values printed are not identical, STOP and report; do not improvise. A version merely higher than `1.0.7` is **not** a stop condition — it means the ladder shifted, and step 9 increments whatever it finds.

8. **The manifest-agreement test still pins a version literal.** Run this before step 1, verbatim:

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
   step 9 and the `npm test` exit code `0` in section 8 both depend on MSP-0 having de-pinned
   that constant permanently.

9. **`npm test` reports a failure in `workflow-hardening-census`.** This stop condition is quoted verbatim:

   ```
   If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
   described by the orchestrator is not yet closed in this checkout. STOP and report.
   Do not edit, skip or delete that test, and do not install anything yourself.
   ```

   That test is outside this MSP's surface and this plan writes no edit to it. Section 8 states
   `npm test` and `npm run typecheck` as ordinary gates expecting exit code `0`, and neither is
   weakened, rescoped, or expressed as a comparison against a known-failing baseline.
