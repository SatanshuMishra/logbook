# SPEC: Post-Cutover Repair

Status: proposed 2026-08-25; approval is criterion 1 of thread `thirteenth-unit`
Date: 2026-08-25
Repository: https://github.com/SatanshuMishra/logbook
Baseline: `main` at `0ade582`, plugin version `1.0.0`, working tree clean, in sync with `origin/main`
Target: plugin version `1.1.0`

---

## 1. Why this exists

The 1.0.0 cutover merged as `0ade582` with every gate green except one that was skipped. Within
twenty-four hours, ordinary hand use of the shipped plugin surfaced seven defects. One of them
surfaced *during the hand-off that was writing up the other six*, and cost that session its entire
narrative until the operator noticed a status string and re-sent the call.

Not one of the seven was caught by a test, a census, a review round, or CI.

That is the fact this SPEC is built around. The suite is not weak: it holds closed censuses that
halt on the unclassifiable, a seeded-mutation gate, a three-way tool registry census, and a
refusal-producer scan driven off the type graph. Those instruments are real and they work. They
share one blind spot, and every defect below fell through it.

### 1.1 The blind spot, stated once

**Every gate in this repository inspects a channel that a silent defect never enters.**

- The refusal censuses (`test/contract/no-path.test.ts:1145`, `test/support/refusal-census.ts:193`)
  audit the *content* of refusals that were produced. They have no opinion on a refusal that
  should have been produced and was not.
- The `rejects-invalid` census derives its cases from mutations of the *published input schema*
  (`test/spawn/resume.test.ts:251-269`). A semantically wrong call whose arguments are
  schema-valid is never generated.
- `src/server/register.ts:106-110` routes `ok: true` to `toolOk`, which sets no `isError`. A no-op
  that returns a success is indistinguishable on the wire from work performed.

So a tool can accept a valid payload, perform no write, destroy the payload, and report success,
and there is no instrument in the repository pointed at that event.

### 1.2 The four causes

Every defect in section 5 reduces to one of these. Each MSP names the cause it attacks.

| Code | Cause | Plain meaning |
| --- | --- | --- |
| **C1** | **Success is reported for work not done.** | A call returns `ok: true` having written nothing, or having written less than it claims. The caller cannot tell. |
| **C2** | **A write destroys data while reporting success.** | Caller-supplied content, or a concurrent writer's committed record, is dropped on a path that returns success. |
| **C3** | **Absence is indistinguishable from emptiness.** | A read returns "nothing" whether nothing exists, nothing was materialised, or materialisation failed. |
| **C4** | **A published description states behaviour the code does not implement.** | Tool descriptions, a filename, and the machine's standing rule each describe software that is not there. |

C1 and C2 are the two the thread named first, and they are taken first.

---

## 2. Evidence base

Seven parallel audits were run against the baseline on 2026-08-25. Six read the shipped tree; one
established the Model Context Protocol's error contract from primary sources. Four produced
executable reproductions. Nothing in the repository was modified.

| Audit | Scope | Reproduction |
| --- | --- | --- |
| A1 | `record_decision` and the spine | `repro-f1.ts`, plus cap-boundary, lost-update and 8-way concurrency probes |
| A2 | `park_thread` and the pointer lifecycle | `repro-f7.ts` (four scenarios plus an inertness control), `repro-c7.ts` |
| A3 | Store roots and the sync receipt | `repro-f6.ts`, `repro-f3.ts` |
| A4 | The write guard | three probes against the shipped module |
| A5 | Thread schema and the census obligations | classifier probe against real Zod output |
| A6 | The standing continuity rule versus the shipped code | 81 claims classified, closed list |
| A7 | The MCP error contract | primary spec, SEP registry, SDK source, six reference servers |

**Evidence law, binding on every agent that executes this SPEC.** Every claim in an
implementation PR body, commit message or decision record cites a `path:line` the author
personally opened, or a command with its exit code. Never infer behaviour from a function name, a
test name, a description string, or this document. Section 5 is a summary; where it disagrees with
the code, the code wins and this document is corrected.

**Reproductions are session-scoped and will not survive.** Each MSP that inherits one re-authors it
as a committed test *before* the fix, per section 8. A probe referenced but not committed is
treated as absent.

---

## 3. Scope, and the boundary this SPEC was required to settle

Criterion 1 of thread `thirteenth-unit` requires this SPEC to settle its own boundary against two
criteria already declared on that thread, before anything else is decided. Both are settled here.

### 3.1 Criterion 4, the write-guard weakening: IN SCOPE

`src/hooklib/guard.ts:90-92` returns `allow` for any tool name matching a prefix *shape*, before
the store root is resolved and without reading a single argument. The membership check against the
real registry existed at `d57d9ee` with two dedicated tests, and both were deleted by the cutover
commit `a375f85`.

It is in scope for three reasons and one non-reason.

1. Decision `0176` establishes it is the only item in its group that the cutover **introduced**
   rather than inherited. A change that lowers security posture relative to its parent is a defect
   in the diff, which places it with the other cutover regressions and not with inherited debt.
2. It is the same cause as the rest: a control that reports a decision it did not make.
3. Audit A4 refutes the objection that would have kept it out. Importing the registry from the
   hook costs ~37 ms with zero subprocess spawns, and the plugin-size budget walks `hooks/` only
   (181 lines of 400), not `src/`.

The non-reason: decision `0169` scheduled *security* work after the thirteenth unit. That group is
the hostile-hook-body execution chain, a different surface on a different file. Taking c4 here does
**not** close that group and does not disturb decision `0169`'s ordering.

### 3.2 Criterion 7, the never-active lifecycle gap: IN SCOPE, and it collapses into D2

c7 asks whether the gap is "confirmed dissolved by the three-state model, or fixed by pairing an
entry transition with a reliable exit". Audit A2 establishes the answer is neither alone. It needs
two axes kept apart, and conflating them is what makes the question look answerable by assertion.

**On the thread-status axis the gap is dissolved.** `src/schema/thread.ts:35` declares
`'open' | 'done' | 'abandoned'`. There is no `active` status to fail to enter. Every thread is born
`open` (`src/server/tools/open_thread.ts:120`) and every `open` thread has both terminal
transitions available (`src/domain/lifecycle.ts:55-68`). Decision `0179` predicted this and
instructed whoever took the item to confirm it against the new schema before planning a fix for a
state machine that no longer has the state. Confirmed, with the citation above.

**On the pointer axis it relocated, and one exit is genuinely stuck.** "Being worked" is now a
per-machine file, `state/active-thread.json`, carrying `{thread_id, written_at, session_id}`
(`src/domain/pointer.ts:9,15,17`). It has exactly one writer (`resume_thread.ts:60-61`) and one
releaser (`park_thread.ts`). Five of six release paths are reachable. The sixth is not: a
**quarantined** thread record makes `park_thread` refuse `retryable: false` without releasing
(`park_thread.ts:157-159`), while `resume_thread` refuses the same record. The pointer cannot be
cleared by any tool, and `src/hooklib/guard.ts:106-110` denies hand-editing the store. The only
escape is resuming a different thread, which overwrites the pointer. That is an escape hatch, not
a designed exit.

**c7 is therefore taken together with D2, and D2 goes first.** The pointer's two self-healing
exits, `stale-pointer-released` and `terminal-pointer-released`, are *exactly two of the six
branches that destroy the caller's session log*. Making the exit more reliable before fixing the
discard widens the data-loss surface instead of narrowing it. Specifying them apart would produce
a fix that makes the product worse.

### 3.3 What this SPEC covers

The seven findings recorded on the thread, the two criteria above, and the defects the audits
found in the same surfaces while establishing those seven. Section 5 is the closed list.

Growth beyond the reported seven is deliberate and bounded by one rule: an item is in only if it
is **cutover-shipped** and either **(a)** a prerequisite to one of the declared fixes, **(b)** the
same defect at a second site, which the receipts standard requires be swept rather than left, or
**(c)** the actual root cause of a declared finding whose reported mechanism was wrong. Every
item in section 5 carries which of these applies. Anything failing that rule is in section 10,
filed and not fixed.

### 3.4 What this SPEC does not cover

- **The hooks-path un-takeover** (criterion 2) and **the six installer items** (criterion 3,
  decision `0170`). A different surface; decision `0171` already fixed their ordering.
- **The surviving security HIGH** (criterion 5), a hostile branch's tracked hook body executing on
  commit. Decision `0169` placed it after the thirteenth unit and this SPEC does not move it.
- **Running the mutation gate against the merged trunk** (criterion 6). It is a gate run, not a
  code change, and section 8.4 states what this SPEC's own diff owes it.
- **Reviving, editing or migrating the predecessor ledger** at `refs/heads/_ledger`. Frozen by
  decision `0064`, read with `git show`, never through a tool.
- **Applying** the corrected standing rule to the operator's global configuration. This SPEC
  authors the replacement text as an in-repo artifact; installing it is the human's act on the
  human's timing, per the thread's own out-of-scope list. See ruling R9.
- **A closure field on `open_risks`.** Decisions `0168` and `0172` name this as a structural hole:
  the spine has no surface on which a filed item can be shown closed, so the only way to remove
  one is to delete it, which is indistinguishable from resolving it. It is real, it is
  load-bearing, and it is **pre-cutover**, so rule 3.3 excludes it. Ruling R6 constrains MSP-7 not
  to foreclose it.

---

## 4. Invariants

These hold at **every** merge, not only at the end of the ladder. An MSP that would break one is
not independently shippable and must be re-cut.

| ID | Invariant |
| --- | --- |
| **I1** | **Green branch.** `npm test` passes on the merge commit. A PR that breaks the branch it merges into is not an MSP. |
| **I2** | **No new silent success.** No change may introduce a code path that returns `ok: true` while performing less than the tool's description promises. Where a call cannot do what was asked, it refuses through `src/server/errors.ts:31`, or it returns a success whose structured result names exactly what it did and did not do. |
| **I3** | **No record disappears.** No change may cause an existing on-disk record to stop being read. Concretely: a new thread-record field is `.optional()` or carries a `.default()`, never required. A required field quarantines every existing record, and quarantine is silent at every surface a user looks at (`src/store/read-path.ts:101-122`; filtered at `src/server/resources.ts:151`, `src/server/completions.ts:33`, `src/server/tools/open_thread.ts:89`). |
| **I4** | **Both version files agree.** `package.json` and `.claude-plugin/plugin.json` bump in the same commit; `node scripts/check-packaging.mjs` passes. |
| **I5** | **No new comments.** Per project standard, no explanatory comments, docstrings or section headers in any language. Tooling pragmas and shebangs only. |
| **I6** | **Evidence, not inference.** Every `Verified:` line in a PR body describes a check actually run. A check not run is `--not-verified "<thing> - not run"`. Never a placeholder. |
| **I7** | **Dogfood hazard.** This repository *is* the installed plugin, and it is installed twice (section 5, D6). Working-tree edits do not affect the running plugin until reinstall and restart. **Never verify a change by observing this session's own ledger behaviour.** Every acceptance test drives a fixture store in a temp directory. |
| **I8** | **The census is never narrowed to obtain a green.** A census that halts is answered by classifying the new item, never by excluding it from the population, pinning a count, or adding it to an allowlist. |
| **I9** | **Acceptance is a ceiling.** Each MSP's acceptance criteria are fixed before it starts. Anything found above them is filed as a new item, never folded in, and never reopens an MSP that already met its criteria. |

---

## 5. Defect inventory

Seventeen defects, closed list. **Reported** means it is one of the seven the thread recorded, or
one of the two boundary criteria. **Found** means an audit surfaced it while establishing those,
and the rule-3.3 letter that admits it is given.

| ID | Defect | Cause | Origin |
| --- | --- | --- | --- |
| D1 | `record_decision` records a decision that is invisible on its own thread | C1 | Reported |
| D2 | `park_thread` destroys the caller's session log on six branches | C1, C2 | Reported |
| D3 | No thread-to-thread lineage can be recorded, though the server tells callers to record it | C4 | Reported |
| D4 | The materialisation stamp is written even when materialisation failed | C3 | Found (c) |
| D5 | `last-synced` names a fact it does not record | C4 | Reported |
| D6 | An empty store is indistinguishable from a project with no ledger | C3 | Reported |
| D7 | The machine's standing continuity rule describes the replaced plugin | C4 | Reported |
| D8 | Predecessor decision citations resolve to nothing in the new store | C4 | Reported |
| D9 | The write guard auto-approves on a name shape, not registry membership | C1 | Reported (c4) |
| D10 | The active-thread pointer has an exit no tool can reach | C1 | Reported (c7) |
| D11 | A losing compare-and-swap retry silently destroys the winner's write | C2 | Found (a) |
| D12 | The thread byte cap refuses without naming the field or the number | C4 | Found (a) |
| D13 | `sync_ledger`'s receipt cannot be verified by the caller that receives it | C1 | Found (b) |
| D14 | Four published descriptions state behaviour the code does not implement | C4 | Found (b) |
| D15 | The SessionStart roster's status token is a constant | C4 | Found (b) |
| D16 | A source file is invisible to `grep` | C3 | Found (a) |
| D17 | A successful tool's prose is dropped before the model reads it | C1 | Found (b) |

### D1 — `record_decision` records a decision that is invisible on its own thread

`src/server/tools/record_decision.ts:155` commits exactly one change, `{ kind: 'decision' }`. The
thread is loaded at `:110` only to check it exists and is open, and is never written back. The
file lands at `records/decisions/<ULID>.json` and `thread.updated_at` is not bumped.

The reported symptom understates it. The briefing's `Decisions:` section is **also** spine-driven:
`src/server/tools/resume_thread.ts:63-66` maps over `thread.spine.key_decisions` and resolves each
`decision_id`. There is no directory-scan fallback anywhere, and the `Store` interface
(`src/store/records.ts:23-29`) exposes `readDecision(id)` with no plural. So an unlinked decision
is absent from **both** briefing sections and from `logbook://thread/{id}`, and is retrievable only
by already knowing its 26-character ULID. The reverse index exists in the data —
`src/schema/decision.ts:11` stores `thread_id` — and nothing reads it.

Reproduced: `record_decision` returns `ok: true` with a `decision_id`, the file exists on disk, and
the rendered briefing shows `Key decisions:` and `Decisions:` both empty.

Linking is possible today, by a second call: `update_thread` with
`key_decisions_add: [{decision_id, title, scope}]` (`src/server/tools/update_thread.ts:64-68,
165-177`), which correctly refuses an id that does not resolve to a stored decision (`:109-116`).
Nothing tells the caller this is required, and no skill mentions decisions at all.

### D2 — `park_thread` destroys the caller's session log on six branches

Six branches return `ok: true` and drop `input.outcome` unreferenced. `emptyStatusReply`
(`park_thread.ts:108-121`) and `releasedStatusReply` (`:123-137`) take a status argument only;
`input` is not in their parameter lists and not in their closures.

| Line | Condition | Status returned | Pointer |
| --- | --- | --- | --- |
| `:263` | no pointer at all | `nothing-to-park` | untouched |
| `:268` | supplied `thread_id` is not the pointed-at thread | `not-the-worked-thread` | untouched |
| `:272` | pointer owned by another session | `not-the-worked-thread` | untouched |
| `:149` | thread record gone | `stale-pointer-released` | **deleted** |
| `:164` | thread already `done` or `abandoned` | `terminal-pointer-released` | **deleted** |
| `:254` | pointer file corrupt | `stale-pointer-released` | **deleted** |

The three that delete the pointer are the worst: they discard the log *and* remove the state a
retry would need, so the natural second attempt lands on `nothing-to-park` and discards it again.

Reproduced across all four reachable scenarios with an 8000-character marker payload, then swept
across the whole plugin-data store and every git object on every ref: zero bytes present. Scenario
E, the inertness control, uses the identical marker with a held pointer and the log persists.

The sharpest statement of the defect: **at 8001 characters the tool protects the caller with a
structured refusal naming `outcome` (`park_thread.ts:90-97`); at 8000 characters it destroys the
log and reports success.**

`resolve_conflict` faces the identical "nothing to do" situation on the same server and **refuses**
(`src/server/tools/resolve_conflict.ts:78-85`, fired at `:244` and `:260`). The stated contract is
`resolve_conflict`'s. `park_thread` is the exception to it.

Two constraints on any fix. `test/spawn/resume.test.ts:388` carries a deliberate design statement
that the no-op *is* intended — "parking before any resume in this session must be a no-op" — and
must be explicitly overruled, not quietly edited. And two tests are already named
`park.refuses-...` (`:602`, `:741`) while asserting a success, so correcting them repairs a
pre-existing mislabel.

### D3 — No thread-to-thread lineage can be recorded, though the server tells callers to record it

`open_thread` accepts exactly `title`, `slug`, `completion_criteria`
(`src/server/tools/open_thread.ts:10-29`, a `z.strictObject`). Version 0.2.8 at commit `2ab9eaf`
accepted four more (`2ab9eaf:src/tools/open-thread.mjs`), and its briefing rendered a conditional
`## RELATED` block (`2ab9eaf:src/render/briefing.mjs:137-146`).

`grep -rni "predecessor\|parent_id\|successor\|lineage" src/` returns zero hits.

The evidence that this is a defect and not a retirement is that the shipped server still promises
the capability. `src/server/tool-support.ts:38` refuses a terminal thread with: *"open a new
thread that references this one instead"* — and ships no field with which to reference it.

The four lost fields are **not** equally wanted, and treating them as one item would restore two
fields the project deliberately deleted:

- `predecessor_id` was read by real code (`2ab9eaf:src/tools/get-resume-brief.mjs:20-27`) and had
  referential integrity enforced at write time. **Genuinely lost.**
- `parent_id` was read by the same renderer, but every historical record carries `parent_id: null`.
  **Zero real usage.**
- `vcs_ref` and `external_refs` were **write-only across the whole 0.2.8 tree** — three sites each,
  all writes, no reader. Decision `0063` deleted them for exactly that reason: *"stop storing what
  nothing READS."* `bind_branch` is not their replacement; 0.2.8 shipped `bind-branch.mjs` and
  `vcs_ref` simultaneously, so one cannot be the other's successor.

### D4 — The materialisation stamp is written even when materialisation failed

`src/store/read-path.ts:66-68`: `materialiseTree` returns silently when `ls-tree` fails.
`src/store/read-path.ts:97-98`: the stamp is written immediately afterwards regardless of outcome.
`:90` then short-circuits every later call when the cached value equals the current ref.

The result is a store that is **permanently empty and permanently reported as synced**. Reproduced:
records wiped, stamp still naming the local tip, reopen yields zero threads, no error at any
surface. `:77-78` (`if (!content.ok) continue`) has the same shape and yields a *partial* store
stamped as fully materialised.

This is the actual root cause of D6, whose reported mechanism was wrong. It is also the mechanism
behind an anomaly audit A1 observed and could not explain: a rollback restores record files but
leaves the stamp, so the working copy silently disagrees with the ref.

### D5 — `last-synced` names a fact it does not record

The file records the last commit **materialised into the local working copy**. It is written by
`src/store/records.ts:112` immediately after a purely local compare-and-swap, and `writeRecords`
(`src/store/write-path.ts:141-222`) never contacts a remote. In `performMerge` the ordering is
explicit: `src/merge/sync.ts:310` materialises and stamps, `:312` pushes, `:318-320` returns on
push failure with no rollback of the stamp.

Reproduced: after a local commit with no remote configured at all, the stamp named the current
tip while `origin` carried no ledger ref. After a deliberately failed push, the stamp had advanced
anyway.

A reader asking "is my ledger backed up" reads a file called `last-synced`, sees the current tip,
and answers yes. The true answer is unknown. Blast radius is bounded: `state/` is unreachable from
the commit builder (`write-path.ts:33-38`), so the ledger tree holds only `decisions/`, `sessions/`
and `threads/`, and a stale stamp cannot reach a teammate's clone.

### D6 — An empty store is indistinguishable from a project with no ledger

`list_threads` returns an empty list, the roster resource returns an empty list, and SessionStart
prints `Logbook: no resumable threads.` (`src/cli/session-start.ts:21,37`). `readAllRecordFiles`
swallows `ENOENT` and returns `[]` (`src/store/read-path.ts:124-131`). No error, no warning, no
distinction.

**The reported mechanism was wrong and is corrected here.** The store directory is only a
materialised cache; the authority is `refs/logbook/ledger` inside the project's own repository,
shared by every install. `openStore` calls `syncWorkingCopy` (`src/store/records.ts:93`), so
resolving to a fresh second root does **not** by itself produce an empty read. Measured on this
machine: both roots now hold identical content under the identical key `7990e2da6a6d59afa32ba08df0f657ea`.

What actually produces the empty read is D4, plus one more site: `src/hooklib/stop-gate.ts:58`
calls `createStoreDirectories` with no materialisation, leaving a store holding
`state/origin.json` and nothing else. That is precisely the state the second root sat in from
00:29:05 to 10:40:51 on 2026-08-25, proven by birth timestamps — `state/last-synced` did not exist,
and `syncWorkingCopy` writes it on every path.

The duplicate-store guard can never catch this, for two independent reasons. It scans only inside
the current `CLAUDE_PLUGIN_DATA` (`src/store/single-store.ts:40-48`), and `projectKey`
(`src/store/project-key.ts:3-4`) depends only on the canonical path, so both roots share a
byte-identical key that `.filter(name !== ownKey)` (`:48`) excludes anyway. **Widening the scan
would not help**, which is why ruling R5 does not widen it.

One genuine cross-root harm does survive: `state/` is per-root and never shared, so
`active-thread.json` and `stop-gate.json` diverge between installs. Switching install source
silently loses the active-thread pointer, and the crash report at `src/cli/session-start.ts:43-47`
then never fires.

### D7 — The machine's standing continuity rule describes the replaced plugin

Audit A6 enumerated the rule file's factual claims as a closed list of **81** and classified every
one: 27 true, 24 false, 7 half-false, 9 no-longer-applicable, 3 unverifiable.

The previous session recorded "wrong on six mechanics". All six are confirmed wrong, and the count
is an undercount; at least ten are. The most damaging class is not vocabulary drift:

**Four tools the rule instructs the agent to call do not exist** — `transition_thread`,
`get_resume_brief`, `read_decision`, `rebuild_index`. The registry holds twelve names
(`src/server/tools/index.ts:15-28`), and none of those four is among them. A standing rule that
directs every session on this machine to call absent tools is a first-class defect, not stale
documentation.

The rest, in brief: the five-state lifecycle is three states; hand-off transitions nothing;
zombie detection keys on a pointer, not a status; decisions are ULIDs in JSON, not four-digit
MADR markdown; `record_decision` does not link the spine; there is no `ledger-worktree/`, no
`orphan-branch` backend, no `_ledger` branch, no configurability, no `index/`, and no non-git
mode; `blocked` is not a state and `blocked_by` cannot be set by any tool; and the SessionStart
roster carries no progress field while exposing an `updated_at` the rule implies is absent.

### D8 — Predecessor decision citations resolve to nothing in the new store

The pre-cutover ledger numbers decisions `0001`-`0180` and stores them as MADR markdown at
`decisions/<NNNN>-<slug>.md`. The 1.0.0 store mints ULIDs and writes JSON at
`records/decisions/<ULID>.json` (`src/server/tools/record_decision.ts:139`,
`src/store/records.ts:52-53`). Four-digit references already written into this thread's criteria
and decision records resolve to nothing inside the store that now holds them.

The convention is settled and needs recording, not deciding: a predecessor decision is cited as
`_ledger:decisions/<NNNN>-<slug>.md` and read with `git show`. The two identifier shapes cannot be
confused, so the rule is unambiguous once written down.

### D9 — The write guard auto-approves on a name shape, not registry membership

`src/hooklib/guard.ts:14` defines a pattern whose suffix class is `[A-Za-z][A-Za-z0-9_]*`, and
`:90-92` returns `allow` on a match. The branch returns **before** `resolveStoreRoot` is called at
`:98` and reads zero arguments. Probed: with `CLAUDE_PLUGIN_DATA` unset entirely, an invented
ledger-prefixed name still returns `allow`.

Four names from the deleted JavaScript tree — `read_decision`, `get_resume_brief`, `rebuild_index`,
`reconcile` — still auto-approve today. They are the same names D7's stale rule tells agents to call.

**Severity: MEDIUM, and the criterion names the wrong vector.** A fabricated tool name is not
exploitable, because a name matching no registered tool never dispatches. The reachable vector is
*name collision*: any project whose `.mcp.json` declares a server keyed `ledger` — the exact shape
this repository itself uses (`.mcp.json:3`) — has every one of its tools auto-approved with no
prompt and no argument inspection. Those are genuinely dispatchable tools. This is privilege
amplification after a trust decision, not a bypass of one.

**A registry check narrows this; it does not close it.** The PreToolUse event carries no field
naming which MCP server a call routes to, so a hostile server named `ledger` exposing a tool named
`open_thread` still auto-approves after the fix. Any claim of closure would be false.

Two findings that bound the work. No exception path in the guard fails open into `allow` — all
three catches were traced and land in `silent`, `ask` or `deny`. And path containment is compared
after `realpath`, with symlinks, `..`, relative paths and macOS case-variance all covered; the only
uncovered vector is a hardlink, which realpath cannot distinguish by design.

### D10 — The active-thread pointer has an exit no tool can reach

A thread record that fails schema validation is quarantined rather than rejected
(`src/store/read-path.ts:101-122`). If the pointer names such a record, `park_thread` refuses with
`retryable: false` **without releasing** (`park_thread.ts:157-159`), and `resume_thread` refuses
the same record before reaching `writePointer` (`resume_thread.ts:47-49`). Direct repair is denied
by the guard. Reproduced in `repro-c7.ts`: the pointer survives both calls; the only escape is
resuming an unrelated healthy thread, which overwrites it.

This is the entire remaining substance of criterion 7 once the status axis is dissolved.

### D11 — A losing compare-and-swap retry silently destroys the winner's write

On a `ref-moved` retry, `src/store/write-path.ts:212` re-reads the **ref** but reuses the caller's
stale in-memory record, and `buildTree` (`:77-104`) then lays that stale blob over the new tree.

Reproduced: two processes commit concurrently, both report success, and the second writer's field
is gone from the final record. **The losing write is destroyed and the winner is told it
succeeded.**

This is live today on every tool that writes more than one record — `close_thread:105-111` and
`park_thread:210-216` both do. It is admitted under rule 3.3(a) because D1's fix adds a third such
writer and would extend the hazard from occasional multi-record writes to every decision recorded.

### D12 — The thread byte cap refuses without naming the field or the number

Two caps govern `spine.key_decisions` and they disagree. The element cap of 200
(`src/schema/caps.ts:22`) is enforced by `src/domain/spine.ts:63-76`, refuses the whole call, and
names the field, the limit, the observed count and a remedy. The whole-record cap of 65536 bytes
(`src/schema/caps.ts:39`, enforced at `src/schema/thread.ts:124-137`) bites **first** — measured at
**130** maximum-length entries — is invisible to `contributeToSpine`, and produces a refusal that
names neither `key_decisions` nor the byte count.

Admitted under 3.3(a): D1's cap-boundary policy routes through this refusal, and shipping D1 over
a refusal that violates the project's own "name the field that was wrong" contract would put a new
defect on the surface D1 exists to repair.

### D13 — `sync_ledger`'s receipt cannot be verified by the caller that receives it

`SyncLedgerOutputSchema` is `{action, ref}` (`src/server/tools/sync_ledger.ts:12-17`), where `ref`
is the module constant `'refs/logbook/ledger'` (`src/store/ref.ts:6`), not a value. No sha appears
anywhere in the result. The strongest live evidence a push landed is `git push` exiting zero
(`sync.ts:248,318`), which the payload never names.

`ls-remote` appears **zero** times in the entire test suite. A test asserting that the stamp still
reflects the remote after a rejected push would fail today.

Admitted under 3.3(b): D5 establishes that no file in the store proves a push landed, and this is
the surface that should have proved it.

### D14 — Four published descriptions state behaviour the code does not implement

| Description | Claim | Code |
| --- | --- | --- |
| `park_thread.ts:240` | "refreshes the six running-summary fields" | accepts `last_session` and `next_step` only (`:29-39`) |
| `resume_thread.ts:38` | "reconciles the store" | `syncWorkingCopy` materialises from the **local** ref; no fetch, no remote contact (`src/store/read-path.ts:85-99`) |
| `list_threads.ts:69` | "A thread that is blocked shows what it is blocked on" | no tool can set `blocked_by`; it is initialised to `null` at `open_thread.ts:121` and never written again |
| `record_decision.ts` description and D7's rule | linking happens | it does not (D1) |

`blocked_by` is a fully dead field that is nonetheless carried on the schema
(`src/schema/thread.ts:36`), rendered in the roster (`src/render/roster.ts:69`) and the briefing
(`src/render/briefing.ts:39`), and merged with a `conflict-on-divergence` rule
(`src/merge/field-merge.ts:21`).

Admitted under 3.3(b): D7 fixes a document that lies about this server. Fixing it while the
server's own descriptions lie in the same way would repair the copy and leave the original.

### D15 — The SessionStart roster's status token is a constant

`src/cli/session-start.ts:36` filters to `status === 'open'` and `:24` then renders
`[${status}]`. The bracket always reads `[open]` and carries no information. Visible in every
session on this machine.

### D16 — A source file is invisible to `grep`

`src/server/tools/resolve_conflict.ts` contains a non-UTF-8 byte. `file` reports it as `data` and
plain `grep` silently returns nothing for it — no error, no warning, no match.

This is decision `0134`'s hazard recurring at a new site. Admitted under 3.3(a): this SPEC adds
census axes that scan source text, and a census that silently skips a file is a green obtained by
leaving the population, which invariant I8 forbids.

### D17 — A successful tool's prose is dropped before the model reads it

`toolOk` (`src/server/errors.ts:39-42`) sets both a `content` text block and `structuredContent`.
Claude Code **replaces** the text blocks with `structuredContent` when it is present
([Agent SDK, custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools#return-structured-data)).

So `park_thread`'s sentence *"no thread is currently marked as being worked; nothing to park."* has
never reached a model. Only the bare token `nothing-to-park` did. Every tool's success prose is in
the same position.

The inverse holds on the refusal path and is what makes ruling R2 work: `toolRefusal`
(`errors.ts:31-37`) sets `isError: true` and no `structuredContent`, and that text is delivered in
full.

Admitted under 3.3(b) as a **constraint**, not an MSP. Ruling R10 states the rule it imposes; the
sweep of every existing success payload is filed in section 10.

---

## 6. Design rulings

Ten rulings. Each closes a question where more than one defensible answer exists, so that no
implementing agent has to invent one. Where a ruling rejects an option, the rejection is recorded
with its reason, because the rejected options are the ones a later reader will re-propose.

### R1 — `record_decision` links the decision itself, derives `scope`, and never refuses at the cap

**The link is written by `record_decision`, in the same commit as the decision.** A design where
the caller must remember a second call is the defect, not the remedy.

**`scope` is derived, with an explicit override and an honest failure.** `scope` is required and
`.min(1)` on the spine (`src/server/tools/update_thread.ts:28`), and 1.0.0 has no notion of a
"current criterion" — zero grep hits. It must therefore come from somewhere, and the choice is
load-bearing because a wrong value is written into a record that can never be amended.

1. `record_decision` gains an **optional** `scope` input. When supplied, it is used verbatim.
2. When omitted, `scope` is derived as the **lowest-`ordinal` criterion that is neither `done` nor
   struck**, rendered as the fixed short form `criterion <ordinal>`. Deterministic, ≤ 200
   characters by construction, and meaningful to a reader.
3. When no such criterion exists — every criterion done or struck — the call **refuses**, naming
   `scope`, stating that no open criterion remains to derive it from, and giving the explicit form
   to re-send. It does not invent a value.

Rejected: defaulting to the thread slug or `active_goal`. `active_goal` is capped at 500 and
`scope` at 200, so it can overflow; and both write a value nobody chose into a write-once ledger.
This project has twice rejected writing a value that is false to satisfy a mechanism
(decisions `0154`, `0177`), and the same reasoning applies.

**At the cap, the decision is written and the link is not, and the result says so.** Two caps
apply (D12) and the byte cap bites first, at roughly 130 maximum-length entries. The implementation
constructs the prospective thread record, validates it, and on failure commits the decision alone.

- `RecordDecisionOutputSchema` gains `linked: boolean` and `link_skipped_reason: string | null`.
- On the skip path the call still returns `ok: true`, because the decision **was** recorded, and
  `linked: false` with a populated reason is a faithful report of what happened. This satisfies
  invariant I2 through its second clause, not its first.

Rejected: refusing the whole call at the cap. It converts a call that succeeds today into a
failure, and the thing the caller most needs — the decision on the record — is the thing it would
throw away. Rejected also: silently skipping the link, which is D1 again.

**The cap check happens before the write, never as a `ThreadRecord.parse` rejection after it.**

### R2 — `park_thread` refuses through the existing refusal path, and `outcome` becomes optional

**The channel is settled, and the machinery already exists.** Audit A7 establishes from the
normative spec that "precondition not met" is a *tool execution error*, reported as a successful
JSON-RPC result carrying `isError: true`, with the detail in a `content` text block —
[MCP tools spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools). SEP-1303,
status Final, moved input rejection out of the protocol-error channel for exactly this reason:
protocol errors are caught client-side and the model never sees why
([SEP-1303](https://modelcontextprotocol.io/seps/1303-input-validation-errors-as-tool-execution-errors.md)).
Reference servers choose `isError` six to one.

`src/server/errors.ts:31-37` already does precisely this. **No new channel is built.** The lossy
branches return `{ ok: false, refusal }` and `src/server/register.ts:110` does the rest.

Two facts make the simpler carve-out impossible and force the input change. `outcome` is
**required and `.min(1)`** (`park_thread.ts:21-25`), so every call always carries a non-empty log
and all six branches always destroy one. And `loadThread` refuses a terminal or quarantined thread
with `retryable: false` (`tool-support.ts:31-38,44`), so `log_session_event` is **not** an
available fallback destination — its own `loadThread` call refuses the same records.

The ruling:

1. **`outcome` becomes `.optional()`.** This is a widening and breaks no existing caller.
2. **With `outcome` supplied**, any branch that cannot write it **refuses**, and does **not**
   release the pointer. Releasing would delete the state a retry needs, which is what makes the
   three `*-released` branches the worst of the six. The refusal names the precondition, the
   remedy, `retryable`, and — because no MCP convention exists for this and no client will infer
   it — states in words that **the supplied text was not stored and must be re-sent**.
3. **With `outcome` omitted**, `park_thread` is a pure pointer release. All four existing
   no-op and release statuses remain exactly as today. Nothing can be lost because nothing was
   supplied. This is what keeps criterion 7's self-healing exits alive while D2 is fixed.
4. `annotations.idempotentHint` (`park_thread.ts:243`) becomes `false`. It was already wrong: the
   normal form writes a new session entry on every call.
5. `skills/debrief/SKILL.md` gains an explicit failure step. Today it prints
   `park_thread.status` and stops, with no path for a refusal.

`test/spawn/resume.test.ts:388` is **explicitly overruled**. Its message — "parking before any
resume in this session must be a no-op, not a park of the freshly opened thread" — remains correct
about the *pointer*, and is preserved by clause 3. It is wrong that the log may be discarded.

### R3 — A compare-and-swap retry re-reads the record it is about to rewrite

`src/store/write-path.ts:212` re-reads the ref on `ref-moved` and reuses the caller's stale
in-memory record. The retry must re-read the *record* from the newly-won tree and re-apply the
caller's change to it, or refuse the call rather than overwrite.

**Refusing is acceptable; overwriting is not.** A refusal on a lost race is a retryable,
diagnosable outcome; a silent overwrite is undetectable by either writer. The implementing MSP
chooses re-apply where the change is expressible as a function of the current record, and refuses
otherwise, but under no circumstance writes a blob derived from a record it did not read.

### R4 — The stamp is written only on success, and it is renamed for what it records

Two defects under one name, fixed together because fixing the name alone would leave the poisoning.

1. `materialiseTree` (`src/store/read-path.ts:66-68`) returns a success/failure result instead of
   returning silently, and `:77-78`'s `continue` becomes a recorded failure.
2. The stamp at `:97-98` is written **only** when materialisation fully succeeded. A partial or
   failed materialisation leaves the stamp unwritten, so the next call retries rather than
   short-circuiting at `:90`.
3. `last-synced` is renamed `last-materialised`, and `markSynced` becomes `markMaterialised`.
   The two test sentinel sets that name the file (`test/contract/skills.test.ts:282`,
   `test/spawn/resume.test.ts:294`) are updated in the same change.

An existing store carrying the old filename must not break. The rename ships with a read that
accepts either name and writes only the new one; an unreadable or absent stamp is already a safe
state, because it means "materialise again".

### R5 — The store proves itself against the ref; it does not scan for siblings

The duplicate-store guard is not widened. Reading sibling directories inside the plugin data root
means reading directories the harness owns and never named to the plugin, and audit A3 proves it
would not work anyway: both roots share a byte-identical `projectKey`, which
`single-store.ts:48`'s `.filter(name !== ownKey)` excludes regardless of scan breadth.

The correct instrument is already in the design. **The store is a cache; `refs/logbook/ledger` in
the project's own repository is the authority, and it is shared by every install.** So:

1. `openStore` compares the record count materialised on disk against the record count present in
   the ref's tree. A ref that holds records over a store that materialised none is a **named,
   reported anomaly**, never silence. This subsumes D4 and D6 and is entirely in contract.
2. `src/hooklib/stop-gate.ts:58` stops creating a half-built store. It either materialises or it
   does not create the directories.
3. `state/` being per-install is documented as the known consequence it is: the active-thread
   pointer and the stop-gate file do not follow the operator across install sources.

Rejected: stamping the install source into `origin.json`. Each root would stamp its own source and
always agree with itself, so it detects nothing.

### R6 — Lineage restores exactly one field, optional on both sides, with a render section

1. **`predecessor_id` only.** Not `parent_id` — every historical record carries `null`. Not
   `vcs_ref` or `external_refs` — decision `0063` deleted them because nothing read them, and
   restoring them would reverse a ratified decision. `external_refs` additionally collides with the
   census obligation that every element of an array-of-object field carry a ULID `id`
   (`test/unit/records.test.ts:60-79`), because its `id` was an external ticket identifier.
2. **`.optional()` on the tool input, never `.nullable()`.** A nullable input emits `anyOf` with no
   top-level `type`, which `test/contract/described.test.ts:48-53` classifies `unclassifiable` and
   the census halts. Verified by running the real classifier against real Zod output. The three
   existing `.nullable()` uses are all output-only, which is why nobody has hit this.
3. **`.optional()` on the thread record**, per invariant I3. A required field quarantines every
   existing record, and quarantine is silent at every user-facing surface.
4. **A `Related:` section ships in the same change.** Decision `0022` sets the standing rule: *"any
   field worth showing belongs in a render section, never in a sidecar object."* A stored
   `predecessor_id` that renders nowhere is D14 in advance.
5. **The schema change must not foreclose a closure field on `open_risks`.** Section 3.4 files that
   item out of scope, and decisions `0168` and `0172` establish it is load-bearing. MSP-7 leaves
   room for it and does not adopt a merge rule or a census shape that would have to be undone.

`renderBriefing` currently receives `(thread, decisions, pointer)` and cannot see other threads, so
the predecessor is resolved at the two call sites (`src/server/resources.ts:108`,
`src/server/tools/resume_thread.ts:83`) and passed in. Children are **not** rendered; that would
require scanning every thread and is `parent_id` work, which clause 1 excludes.

### R7 — The guard checks a names-only module, and a census keeps the lists from drifting

1. A dedicated module exports the tool names, imported by both `src/server/tools/index.ts` and
   `src/hooklib/guard.ts`. Importing `ALL_TOOLS` directly was measured to work at ~37 ms with zero
   spawns, but couples the hook's import graph to `zod` and the MCP SDK for a list of twelve
   strings. The names-only module makes the guard's zero-spawn property structural rather than
   measured, which matters because `test/hooks/guard-in-process.test.ts:41-44` installs its
   counters before importing the guard.
2. The drift risk the fix introduces — a tool registered but not guard-approved, losing
   auto-approval as a quiet permission prompt — is closed by the mechanism this repo already has.
   `test/support/published.ts:81-99` runs a three-way census over files, registry and published
   list, halting on `unclassifiable`. **A fourth axis, `guardApproved`, is added to that same
   census.** Not a new test, not a pinned count, not an allowlist.
3. **The SPEC claims narrowing, not closure.** The PreToolUse event carries no server identity, so
   a hostile server keyed `ledger` exposing a tool named `open_thread` still auto-approves. This is
   stated in the PR body and in the README's existing gap list, not omitted.

### R8 — The sync receipt names both shas or does not claim a push

`SyncLedgerOutputSchema` gains `local_sha` and `remote_sha`. After a push reports success,
`sync_ledger` performs an `ls-remote` read-back and reports the remote ref's sha as read **after**
the push, alongside the local sha. Equality of the two is the receipt. Where the read-back cannot
be performed, the fields are null and the action does not claim `pushed`.

This is the same instrument the receipts standard already requires at the other end of a merge,
pointed at this one. `ls-remote` currently appears zero times in the test suite.

### R9 — The corrected standing rule ships as an in-repo artifact; the human installs it

The thread's out-of-scope list holds that correcting the operator's global configuration is not
this thread's to do, while the decision that filed D7 holds that it belongs in the SPEC's scope as
a deliverable. Both are right, about different halves.

**This SPEC authors the corrected text and commits it to this repository**, where it is versioned,
reviewable and diffable against the code it describes. **Installing it into the operator's global
rules directory is the human's act**, on the human's timing. MSP-9 produces the artifact and the
PR body states plainly that the rule is not in force until the human copies it.

D8's citation convention is recorded in the same artifact.

### R10 — Load-bearing information goes where the reader actually reads it

Claude Code replaces `content` text blocks with `structuredContent` on a success result, and drops
`structuredContent` entirely on an `isError` result (D17). Therefore:

- **On success**, anything the model must act on lives in the **structured** result. Prose in
  `text` is for humans reading a transcript and must never be the only carrier of a fact.
- **On refusal**, everything lives in the **text** block, which is what `toolRefusal` already does.

**Every acceptance test for a refusal asserts on the `content` text blocks, never on
`structuredContent`.** A test written the other way passes against a result the model cannot read —
which is this SPEC's own defect, reproduced inside its own verification.

---

## 7. MSP ladder

Ten minimum shippable products. Each leaves `main` green on merge (invariant I1), each carries a
red-before-green acceptance test, and each declares its acceptance criteria before it starts
(invariant I9).

**Version policy.** Every MSP bumps the patch version except MSP-7, which adds a schema field and
bumps the minor. Both manifests move in the same commit (invariant I4). The ladder lands on
`1.1.0`.

**Diff-size discipline.** Target ~200 changed lines per pull request, 400 as a ceiling. MSP-3 and
MSP-4 are the two most likely to exceed it; each carries a stated split.

**Dependencies.**

```
MSP-0 ──┬──────────────────────────────► MSP-5
        └──────────────────────────────► MSP-8
MSP-1 ─────────────────────────────────► MSP-6
MSP-2 ─────────────────────────────────► MSP-4
MSP-3, MSP-7   independent
MSP-9   last: it documents the state the ladder ends in
```

MSP-1, MSP-2, MSP-3 and MSP-7 touch disjoint files and are parallel-safe with each other.

---

### MSP-0 — Make the tree greppable

**Closes:** D16. **Cause:** C3. **Depends on:** nothing.

Remove the non-UTF-8 byte from `src/server/tools/resolve_conflict.ts` so the file is text to
`grep` and to every census that scans source.

**Acceptance:**
1. A committed test enumerates every file under `src/`, `hooks/` and `bin/` and asserts each
   decodes as UTF-8. It is a census: it halts on the unclassifiable, with no pinned count and no
   allowlist.
2. That test is **red on the parent commit** and green on the fix.
3. `npm test` green.

**Note for every later MSP:** this must land before any census axis is added, or the added census
silently skips a file and reports green — invariant I8.

---

### MSP-1 — The materialisation stamp tells the truth

**Closes:** D4, D5, and the `stop-gate` half of D6. **Cause:** C3, C4. **Depends on:** nothing.

Implements ruling R4 and clause 2 of R5.

**Changes:** `src/store/read-path.ts` (`materialiseTree` returns a result; `:77-78` records rather
than skips; the stamp writes only on full success; rename), `src/store/records.ts:112`,
`src/hooklib/stop-gate.ts:58`, and the two test sentinel sets naming the old filename.

**Acceptance:**
1. A test in which `ls-tree` fails asserts the stamp is **not** written and the next `openStore`
   re-attempts materialisation rather than short-circuiting. Red on the parent.
2. A test asserting a store whose records are absent while the stamp names the current tip
   re-materialises or reports, and never silently returns zero threads. Red on the parent.
3. A test asserting `stop-gate` does not leave a store holding `state/` and an empty `records/`.
4. A store carrying the pre-rename filename still opens.
5. Inertness: reverting the stamp-on-success guard turns criterion 1 red again.
6. `npm test` green.

---

### MSP-2 — A losing retry cannot destroy the winner's write

**Closes:** D11. **Cause:** C2. **Depends on:** nothing. **Required by:** MSP-4.

Implements ruling R3 in `src/store/write-path.ts` around `:206-212`.

**Acceptance:**
1. A two-writer test in which the second writer loses the compare-and-swap asserts the first
   writer's field survives, **or** that the second writer received a retryable refusal. It asserts
   that no outcome exists in which a writer is told it succeeded while its predecessor's committed
   field is gone. Red on the parent — the audit's probe reproduces exactly this.
2. `test/store/concurrency.test.ts` and `test/sync/cas-retry.test.ts` stay green.
3. Inertness: restoring the stale-record reuse turns criterion 1 red.
4. `npm test` green.

---

### MSP-3 — `park_thread` refuses instead of destroying, and the pointer gains its missing exit

**Closes:** D2, D10. Closes **criterion 7** in combination with section 3.2's recorded
dissolution. **Cause:** C1, C2. **Depends on:** nothing.

Implements ruling R2, plus D10's stuck exit.

**Changes:** `src/server/tools/park_thread.ts` (six branches, the input schema, the output status
enum, the annotation), `skills/debrief/SKILL.md`, and the prose in `src/server/prompts.ts:35` and
`src/server/instructions.ts:6` that promises parking always succeeds.

For D10: a pointer naming a quarantined record must be releasable. The `outcome`-omitted form of
`park_thread` releases it, which gives the stuck exit a designed route without widening
`loadThread`'s contract.

**Split, if the diff exceeds 400 lines:** PR A carries the six branches and the optional
`outcome`; PR B carries the quarantined-pointer exit, the skill, and the prose. PR A first.

**Acceptance:**
1. For each of the six branches, a test supplies a non-empty `outcome`, asserts the call refuses,
   asserts the refusal **text block** names the precondition and states the text was not stored,
   and asserts the pointer is unchanged. Red on the parent, where all six return `ok: true`. Per
   ruling R10 these assert on `content`, never on `structuredContent`.
2. A control test: the same payload with a held pointer still parks and the log persists. This is
   the inertness discriminator — it must stay green throughout.
3. For each release branch, a test with `outcome` **omitted** asserts the pointer is released and
   the existing status is returned unchanged.
4. A test asserts a pointer naming a quarantined record can be released, and that it cannot be
   today. Red on the parent.
5. The seven tests in `test/spawn/resume.test.ts` listed in the audit are updated, and
   `:388`'s design message is rewritten to say what clause 3 of R2 preserves and what it does not.
6. `test/contract/skills.test.ts` stays green with the debrief skill's new failure step.
7. `npm test` green.

---

### MSP-4 — `record_decision` links the decision it records

**Closes:** D1, D12. **Cause:** C1, C4. **Depends on:** MSP-2.

Implements ruling R1.

**Changes:** `src/server/tools/record_decision.ts` (optional `scope` input, derivation, the
two-record commit copying the shape at `src/server/tools/close_thread.ts:105-111`, the two new
output fields), and `src/server/tool-support.ts:48-56` so the whole-record cap refusal names the
field and the observed byte count.

**Do not** route the link through `contributeToSpine` and `commitThread` unmodified. Doing so
produces a refusal naming `key_decisions_add`, a parameter this tool does not have, and changes
the refusal field from `decision` to `thread`, which breaks the retry guard at
`test/spawn/decisions.test.ts:419`.

**Split, if the diff exceeds 400 lines:** PR A carries the cap refusal repair (D12); PR B carries
the linking. PR A first, because PR B's cap path depends on it.

**Acceptance:**
1. A test records a decision and asserts it appears in **both** the `Key decisions:` and
   `Decisions:` sections of the rendered briefing, with no intervening `update_thread`. Red on the
   parent — the audit's `repro-f1.ts` becomes this test.
2. A test asserts `scope` derives to `criterion <ordinal>` of the lowest-ordinal open criterion;
   a second asserts an explicit `scope` overrides it; a third asserts the call refuses, naming
   `scope`, when no open criterion remains.
3. A test saturates the thread to the byte cap and asserts the decision is still recorded, the
   result carries `linked: false` with a populated reason, and the call returns `ok: true`.
4. A test asserts the whole-record cap refusal names the offending field and the observed byte
   count.
5. `test/spawn/decisions.test.ts`'s `concurrent.distinct-ids` stays green, including its retry
   guard.
6. `test/sync/two-clones-spawn.test.ts` stays green; both clones now write the thread record
   offline, so its divergence assertion is re-derived rather than assumed.
7. Inertness: removing the thread record from the commit array turns criterion 1 red.
8. `npm test` green.

---

### MSP-5 — The write guard checks the registry

**Closes:** D9, and **criterion 4**. **Cause:** C1. **Depends on:** MSP-0.

Implements ruling R7.

**Changes:** a names-only module under `src/server/tools/`, imported by
`src/server/tools/index.ts` and `src/hooklib/guard.ts:90-92`; a fourth `guardApproved` axis on the
census at `test/support/published.ts:81-99`; the README gap list.

**Acceptance:**
1. A test drives every name in the **live** registry, in both prefix forms, and asserts `allow`;
   then drives a set of prefixed non-registered names — including `read_decision`,
   `get_resume_brief`, `rebuild_index`, `reconcile` and the names from the deleted `d57d9ee` test —
   and asserts none is allowed. The second block is red on the parent.
2. `test/hooks/guard-in-process.test.ts` stays green, including its zero-spawn assertion.
3. The registry census halts when a name is registered but not guard-approved, and when a name is
   guard-approved but not registered. Both directions carry a control proving the census
   discriminates.
4. Inertness: reverting to the bare pattern test turns criterion 1's second block red.
5. The PR body states that this narrows the surface and does not close it, because the PreToolUse
   event carries no server identity.
6. `npm test` green.

---

### MSP-6 — The sync receipt names both shas

**Closes:** D13. **Cause:** C1. **Depends on:** MSP-1.

Implements ruling R8.

**Changes:** `src/merge/sync.ts` around `:246-251` and `:312-323`,
`src/server/tools/sync_ledger.ts:12-17,79-83`.

**Acceptance:**
1. A test asserts that after a successful push the reported `remote_sha` is read from the remote
   **after** the push and equals `local_sha`. Red on the parent, where no sha is reported at all.
2. A test asserts that after a rejected push the action does not claim `pushed` and the shas
   reflect the true divergence.
3. A test asserts the materialisation stamp still reflects the remote after a rejected push. The
   audit confirms this test fails today.
4. `npm test` green.

---

### MSP-7 — Lineage returns

**Closes:** D3. **Cause:** C4. **Depends on:** nothing. **Version:** minor bump to `1.1.0`.

Implements ruling R6.

**Changes:** `src/server/tools/open_thread.ts` (optional `predecessor_id` input),
`src/schema/thread.ts` (optional record field), `src/merge/field-merge.ts` (a merge rule is forced
at compile time), `src/render/briefing.ts` (a `Related:` section), and the two briefing call sites.

**The census obligations this incurs are known and enumerated.** Audit A5 produced a 33-item closed
checklist. The four hard-coded assertions that must be hand-edited are
`test/unit/field-merge.test.ts:348`, `test/unit/records.test.ts:14`,
`test/unit/briefing.test.ts:127,154`. Two more are compile-time forcings. The checklist also names
explicit negatives — `completions.ts`, `instructions.ts`, `example.ts` and `no-arguments.ts` impose
nothing — so no phantom work is budgeted.

**Acceptance:**
1. A test opens thread B naming thread A as predecessor and asserts B's briefing renders a
   `Related:` section naming A. Red on the parent.
2. A test asserts an unresolvable `predecessor_id` is refused at write time.
3. A test asserts a thread record written **before** this change still parses, still appears in the
   roster, and is not quarantined. This is invariant I3's guard and it is not optional.
4. Every render-census obligation is satisfied by classification, never by narrowing (invariant I8).
5. `node scripts/check-packaging.mjs` passes and both manifests read `1.1.0`.
6. `npm test` green.

---

### MSP-8 — Every published description matches the code

**Closes:** D14, D15. **Cause:** C4. **Depends on:** MSP-0. Best taken after MSP-3 and MSP-4, whose
fixes change what two of these descriptions should say.

**Changes:** `src/server/tools/park_thread.ts:240`, `src/server/tools/resume_thread.ts:38`,
`src/server/tools/list_threads.ts:69`, `src/cli/session-start.ts:24`.

`blocked_by` is decided here rather than left: it is either given a writer, or removed from the
schema, the roster, the briefing and the merge rules, and its promise removed from
`list_threads`' description. **Carrying a field that no tool can set while three surfaces render it
is not a third option.** Removing it is a thread-record schema change and inherits invariant I3.

`resume_thread`'s lead sentence has **2 bytes** of headroom against a 200-byte cap. Correcting it
removes a false clause and therefore shortens it, but nothing else in that sentence may grow.

**Acceptance:**
1. A census asserts that for each tool, every capability its description names is reachable through
   its published input schema. Red on the parent for at least `park_thread` and `list_threads`.
2. A test asserts the SessionStart roster line carries a status token that varies with the thread's
   status, or carries none.
3. Inertness: restoring any one false description turns criterion 1 red.
4. `npm test` green.

---

### MSP-9 — The documentation deliverables

**Closes:** D7, D8. **Cause:** C4. **Depends on:** the whole ladder — it documents the state the
ladder ends in.

Implements ruling R9.

**Changes:** a committed replacement for the standing continuity rule, written against the shipped
code; the citation convention for predecessor decisions; and any README correction the ladder has
made necessary.

**Acceptance:**
1. Every one of the 81 claims audit A6 classified is either true of the shipped code or absent from
   the replacement. The audit's closed list is the checklist, and the replacement is verified
   against it claim by claim.
2. No tool name appears in the replacement that is absent from `src/server/tools/index.ts`. A test
   asserts this against the live registry, so the document cannot rot silently the way its
   predecessor did.
3. The PR body states plainly that the rule is **not in force** until the human installs it.
4. `npm test` green.

---

## 8. Verification

### 8.1 What proves a fix

Per the receipts standard: a re-runnable acceptance test that is **red on the parent commit** and
green on the fix, asserting the **reported symptom** rather than a proxy for it, shipped with an
inertness mutation — revert what the fix added and the assertion must turn red again. A test that
survives that mutation is not testing the fix.

Four MSPs inherit a working reproduction from the audits. Those reproductions are session-scoped
temp files and **will not survive**; each is re-authored as a committed test before its fix. A
probe referenced but not committed is treated as absent.

### 8.2 What the existing gates will and will not cover

Stated so no MSP mistakes a skipped gate for a passed one.

| Gate | Covers this SPEC's diff? |
| --- | --- |
| `npm test` | Yes, every MSP |
| `typecheck` | Yes |
| `test` matrix, Node 22.19 / 24 / 26 | Yes |
| `seeded-mutation` | Yes, but it exercises `src/render/escape.ts` only; it proves the unit layer can kill a mutant, not that this diff is covered |
| `mutation` (Stryker) | **Partial, and this must be said in each PR body.** The mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`, `src/merge/conflict.ts`, `src/render/**`. MSP-1, MSP-2, MSP-7 fall inside it. **MSP-3, MSP-4, MSP-5, MSP-6 and MSP-8 fall outside it entirely** — their changes are in `src/server/tools/`, `src/domain/`, `src/hooklib/` and `src/cli/`, and the job will report success having mutated nothing of theirs |
| `coverage` | No. It ends in an unconditional `exit 0` and cannot fail. Decision `0168` filed it |
| `inspector` | Yes for schema shape |
| `receipts` enforcer | Yes |
| `pr-title-lint` | Yes |

The mutation job's skip path prints its reason and exits zero, which is the shape decision `0128`
named. **No PR in this ladder may write a `Verified: mutation` line unless the job actually
mutated a file in that PR's diff.**

### 8.3 Verification this SPEC's own diff owes

Every PR body composed through `node .claude/lib/git/pr.mjs pr-create`, per the project's
centralized tool. `--verified` lines describe checks run; anything else is `--not-verified`.

### 8.4 Criterion 6, and what this ladder does not discharge

Criterion 6 requires the mutation gate to be run against the merged trunk and its real result
recorded, replacing the not-run status M12 shipped with. **This SPEC does not discharge it.** The
per-PR mutation job is diff-scoped and cannot substitute for a full run over the merged trunk.
MSP-1, MSP-2 and MSP-7 will produce genuine per-PR mutation results inside the mutate scope, and
those are reported honestly as what they are.

---

## 9. Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **The ladder is ten PRs against a plugin the operator uses daily.** Each merge changes the article the next session runs on. | Invariant I1 holds every merge green. Invariant I7 forbids verifying any change by observing this session's own ledger. |
| 2 | **MSP-3 changes behaviour the debrief skill depends on.** A refusing park with an unprepared skill loses the log a different way. | The skill's failure step ships in the same MSP, and `test/contract/skills.test.ts` censuses the skill against the live tool surface. |
| 3 | **MSP-7 opens the thread-record schema, and a required field would silently empty every ledger.** | Invariant I3, plus MSP-7 acceptance criterion 3, which asserts a pre-change record still parses and still appears in the roster. |
| 4 | **MSP-4 makes `record_decision` a multi-record writer, extending D11's blast radius.** | MSP-2 is a hard dependency and lands first. |
| 5 | **A census added over a tree containing an ungreppable file reports a false green.** | MSP-0 is a hard dependency of MSP-5 and MSP-8. |
| 6 | **The MCP client findings in ruling R10 rest on maintainer reproductions, not documentation, and are version-bounded.** The two claude-code issues are open. | R10's rule is safe under either behaviour: putting actionable facts in the structured result on success and in the text block on refusal is correct whether or not the client changes. Re-check on client upgrade. |
| 7 | **Ten MSPs is a long ladder, and acceptance drift is the failure mode this project has met before.** | Invariant I9. Anything found above an MSP's declared criteria is filed in section 10, never folded in. |
| 8 | **`src/server/tools/resolve_conflict.ts` is invisible to `grep` until MSP-0 lands**, so any audit of this SPEC's own progress may silently skip it. | Stated here; MSP-0 is first in the ladder. |

---

## 10. Filed, not fixed

Real, evidenced, and deliberately outside this SPEC's ceiling. Each is filed so it is scheduled
rather than rediscovered.

1. **`open_risks` has no closure field.** Decisions `0168` and `0172`. The only way to remove an
   item is to delete it, which is indistinguishable from resolving it; decision `0172` measured 34
   dropped items, five deleted with no closing record. Pre-cutover, so rule 3.3 excludes it. Ruling
   R6 clause 5 constrains MSP-7 not to foreclose it.
2. **The success-payload sweep.** D17 establishes that every tool's success `text` is dropped
   before the model reads it. MSP-8 fixes the descriptions; a sweep asserting that no tool carries
   a load-bearing fact only in `text` is separate work.
3. **The coverage job cannot fail.** `.github/workflows/rebuild.yml` ends the coverage step in an
   unconditional `exit 0`. Filed by decision `0168`; unchanged.
4. **`receipts.config.json` disagrees with itself and with the standard.** `build.integration_branch`
   is `main` while `gates.G8.integration_branch` is `integration`, a branch this repository does not
   have. Absent keys the standard requires explicit: `claim.require_receipt_for`,
   `gates.G14.mode`, `gates.G11.mode`, `gates.G13.coverage_command`, `verify.receipt_runs`,
   `gates.G6.surfaces`, `agent.loop_skills`.
5. **The hardlink gap in the write guard.** A hardlink from outside the store to a file inside it
   is `silent`; `realpath` cannot distinguish it by design. Low impact — creating the hardlink
   itself requires a `Bash` command the guard would `ask` on. Accepted and documented rather than
   fixed.
6. **`state/` does not follow the operator across install sources.** D6's surviving cross-root
   harm. Ruling R5 documents it; making the pointer portable is a design question, not a fix.
7. **`refs/logbook/sync/origin-ledger` is stale** at `0d5190b` while local and remote agree at
   `568b4d2`. Expected after a `pushPlain` path, but not traced to a specific history.

---

## 11. Decision traceability

| This SPEC | Rests on | Where |
| --- | --- | --- |
| c4 is in scope as a cutover regression | `0176` | write-guard weakening introduced by the diff, not inherited |
| c4 does not close the security group | `0169` | hostile-hook-body chain scheduled after the thirteenth unit |
| c7's status axis is dissolved | `0179` | 1.0.0 collapses five states to three; confirm before fixing |
| c7's history and its two prior recurrences | `0154`, `0177` | the gap recorded, then named as a defect |
| `vcs_ref` and `external_refs` stay deleted | `0063` | stop storing what nothing reads |
| Lineage must render, not sit in a sidecar | `0022` | any field worth showing belongs in a render section |
| No migration path exists, by ratification | `0064`, `0179` | clean break; the old ledger is frozen at `refs/heads/_ledger` |
| A closure field is load-bearing, and is filed | `0168`, `0172` | the spine has no surface on which an item can be shown closed |
| Predecessor decisions are cited by git path | thread `thirteenth-unit` | four-digit numbers resolve to nothing in this store |
| Acceptance is a ceiling | receipts `gates@1.1`, G0 | anything above it is filed, never folded in |
| A gate that cannot be cleared is a tracked downgrade | receipts `gates@1.1`, ladder | `unverified-reasoned` is a first-class outcome; a false `fixed` is not |

Predecessor decisions are cited by number here and read with
`git show refs/heads/_ledger:decisions/<NNNN>-*`. They are **not** resolvable inside the 1.0.0
store, which holds ULIDs only.
