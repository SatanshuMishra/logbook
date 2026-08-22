# M6 — Decisions, session logs and the sync tools

**Depends on:** M4 for the tool surface, M2 for the merge engine. Runs in parallel with M5.

**Ships:** `record_decision` with supersession, `log_session_event`, structural immutability, `sync_ledger`, `resolve_conflict`, and the §11.6 scenario at the spawned-server layer.

**Read first:** SPEC §6.3, §5.6, §7.3, §11.5, §11.6, and `00-overview.md` §5.2 and §5.3.

---

## Premise checks

- [ ] **P1. M4 and M2 are both merged and green on `main`.** This unit is the first that needs both.
- [ ] **P2. `Decision.commit` is nullable.** Read `rebuild/src/schema/decision.ts`. If it is required, `record_decision` cannot succeed on an unborn branch and the unit is re-planned.
- [ ] **P3. Decisions are ULID-identified with no counter.** `grep -rn "counter\|nextNumber\|allocate" rebuild/src/` returns nothing in the decision path. A project-wide counter is what 0075 removed and what makes offline recording collide.
- [ ] **P4. `sync` returns a distinguishable conflict outcome carrying every conflict.** Read `rebuild/src/merge/sync.ts`.
- [ ] **P5. No tool amends a record.** `grep -rln "amendDecision\|updateDecision" rebuild/src/` returns nothing.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | Concurrent recordings produce distinct identifiers under **real** concurrency | `concurrent.distinct-ids` passes |
| A2 | A failed recording leaves zero files and consumes no identifier | `write.no-orphan-record` passes |
| A3 | No tool can amend a recorded decision | `decision.is-immutable` passes as a census over `ALL_TOOLS` |
| A4 | A reversal is a new record; the superseded file and id remain | `decision.supersede-retains` passes |
| A5 | A second process reading mid-write sees a consistent store and destroys nothing | `concurrent.second-process-destroys-nothing` passes |
| A6 | The §11.6 scenario passes through two spawned servers | `sync.two-clones-offline.spawn` passes |
| A7 | A refused merge is resolvable per field without the server ever picking a side | `conflict.resolve-names-the-winner` passes |
| A8 | Every tool this unit ships has spawn and rejection tests | eight tests |

**Red on the parent commit:** `sync.two-clones-offline.spawn`.

**Inertness mutation:** in `rebuild/src/server/tools/record-decision.ts`, replace `rt.ulid()` with a value derived from the store's current decision count. `concurrent.distinct-ids` must turn red. That mutation reintroduces exactly the number collision 0075 removed.

---

## Files

**Create:** `rebuild/src/server/tools/record-decision.ts`, `log-session-event.ts`, `sync-ledger.ts`, `resolve-conflict.ts`; `rebuild/test/store/concurrency.test.ts`; `rebuild/test/spawn/decisions.test.ts`; `rebuild/test/sync/two-clones-spawn.test.ts`, `resolve.test.ts`.

---

## Task 1: `record_decision`

**Files:** `rebuild/src/server/tools/record-decision.ts`, `rebuild/test/spawn/decisions.test.ts`

`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

- [ ] **Step 1: Write the description**

> Writes down one decision the moment it is made, with the reasoning that produced it, and returns the new record's id. Takes the thread it belongs to, a one-line title, the situation that forced the choice, the options that were on the table as a list of strings, and the outcome that was chosen. A decision cannot be edited afterwards by any tool here; reversing one means recording a new decision that names the old one in `supersedes`, and the old record stays readable. It also stores the project's current commit, so a later reader can see what the code looked like when this was settled.

- [ ] **Step 2: Write the failing tests**

```
decision.is-immutable          a census over ALL_TOOLS: no tool's input schema accepts a decision
                               id in a position that would rewrite an existing record. Any tool the
                               classifier cannot place halts the census
decision.supersede-retains     record A, then record B with supersedes [A]; assert A's file still
                               exists, parses, and is readable through readDecision
decision.records-project-head  on a repo with commits, commit is the current HEAD sha; on an
                               unborn branch, commit is null and the call still succeeds
concurrent.distinct-ids        eight REAL concurrent processes each record a decision against one
                               store; assert eight files, eight distinct ids, and eight parseable
                               records. Not a Promise.all over one process, and not a mock clock
write.no-orphan-record         a recording injected to fail after the blob is written leaves zero
                               new files under records/decisions/ and the next successful recording
                               is unaffected
```

`decision.records-project-head` is where `readProjectHead` from M1 Task 6 is exercised, and it is what keeps I-1's reconciliation honest: reading `HEAD` is best-effort metadata and never gates the write.

- [ ] **Step 3: Implement**

Immutability is structural, not conventional (§6.3): there is no tool that amends a decision and M8's write guard denies direct edits into the store. `supersedes` is an optional field on the **new** record; nothing edits the old one.

- [ ] **Step 4: Run to green and commit**

```bash
git add rebuild/src/server/tools/record-decision.ts rebuild/test/spawn/decisions.test.ts
git commit -m "feat(rebuild): record an immutable decision with the commit it was made against"
```

---

## Task 2: `log_session_event` and concurrency

**Files:** `rebuild/src/server/tools/log-session-event.ts`, `rebuild/test/store/concurrency.test.ts`

`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

- [ ] **Step 1: Write the description**

> Appends one entry to a thread's session log, which is the running narrative of what actually happened. Takes the thread id, who is speaking as a short string such as `claude` or a person's handle, and the entry body as Markdown text up to 8000 characters. Entries are append-only and are never merged with each other, so two people logging at the same time both keep their entries. They are read on demand at `logbook://session/{thread_id}/{entry_id}` and are never loaded into a briefing by default.

That last sentence is 0074 made visible: publishing session logs as resources is what gives them a reader, so previously dead weight costs nothing until something asks for it (§7.4).

- [ ] **Step 2: Write the failing test**

```
concurrent.second-process-destroys-nothing   process A writes a record without committing; process
                                             B starts and reads the store; assert A's record still
                                             resolves after A commits, and that B saw a consistent
                                             store with no partial record
```

This is the direct replacement for the current build's reproduced failure, where provisioning deleted a second session's uncommitted file even when the lock was not acquired (§5.2). There is no lock here to fail; there is no checkout to provision. The test proves the defect class is gone rather than guarded.

- [ ] **Step 3: Implement, run to green, commit**

```bash
git add rebuild/src/server/tools/log-session-event.ts rebuild/test/store/concurrency.test.ts
git commit -m "feat(rebuild): append session log entries that two processes cannot destroy"
```

---

## Task 3: `sync_ledger` and `resolve_conflict`

**Files:** `rebuild/src/server/tools/sync-ledger.ts`, `resolve-conflict.ts`, `rebuild/test/sync/resolve.test.ts`

Both are assigned here by `00-overview.md` §5.2; §13.2 names them in no unit.

- [ ] **Step 1: Write the two descriptions**

`sync_ledger` — `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: **true**`.

> Brings this machine's ledger and the shared one into agreement: it fetches, works out which side is ahead, merges record by record when both moved, and pushes. Takes no arguments. When two people changed the same single-value field to different things it refuses instead of choosing, keeps both versions readable, pushes nothing, and reports what disagreed so `resolve_conflict` can settle it. Running it when nothing changed is cheap and reports that nothing changed, which is different from reporting that it could not reach the shared copy.

`resolve_conflict` — `readOnlyHint: false`, `destructiveHint: **true**`, `idempotentHint: false`.

> Settles a sync that was refused because two people changed the same field to different values, by naming which side wins for each disagreement. Takes a list of `{ record, field, winner }` where winner is either `local` or `remote`, and every disagreement the last sync reported must appear exactly once; a partial list is refused and names what is missing. The losing value is discarded, which is why the server never does this on its own.

- [ ] **Step 2: Write the failing tests**

```
conflict.resolve-names-the-winner   produce a real conflict through two clones; resolve it naming
                                    local for one field and remote for another; assert the merged
                                    record carries exactly those two values and the sync then pushes
conflict.partial-list-refused       a resolution omitting one reported conflict is refused, naming
                                    the omitted record and field
conflict.server-never-picks         a census over sync.ts: no code path writes a merged record when
                                    the conflict list is non-empty. Halts on an unclassifiable branch
```

- [ ] **Step 3: Implement, run to green, commit**

```bash
git add rebuild/src/server/tools/sync-ledger.ts rebuild/src/server/tools/resolve-conflict.ts rebuild/test/sync/resolve.test.ts
git commit -m "feat(rebuild): sync the ledger and resolve a refused merge by naming the winner"
```

---

## Task 4: The §11.6 scenario through spawned servers

**Files:** `rebuild/test/sync/two-clones-spawn.test.ts`

- [ ] **Step 1: Write `sync.two-clones-offline.spawn`**

The setup of §11.6 verbatim, now with the surface it was written for: a real bare repository as the shared remote, two real clones, **two real server processes, one per teammate, each spawned over real stdio**. Both sync from a common base through `sync_ledger`. Both go offline by pointing the remote at a path that does not exist. Each records a decision **through `record_decision`**. Both come back online. Ana syncs first; Ben must merge rather than clobber.

The same five properties as M2's store-layer version: nothing lost, no collision, no corruption, convergence, order-independence.

- [ ] **Step 2: Confirm the row a spawn catches and the store layer cannot**

§11.6's table has one row that only this layer reaches: *the server writes a diagnostic to stdout, breaking the transport* — green in memory, red here because the client cannot parse the reply. Introduce that failure deliberately, confirm the test goes red, and record the result. That row is the reason this test exists at both layers rather than one.

- [ ] **Step 3: Run the inertness mutation and record it**

Replace `rt.ulid()` in `record-decision.ts` with a count-derived value; confirm `concurrent.distinct-ids` turns red; restore.

- [ ] **Step 4: Commit and open the pull request**

```bash
git add rebuild/test/sync/two-clones-spawn.test.ts
git commit -m "test(rebuild): drive the two-teammate merge through two spawned servers"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m6-decisions-and-sync-tools --base main \
  --title "feat(tools): record decisions and settle a refused ledger sync" \
  --what "Decisions are written once and never edited, and reversing one keeps the original readable." \
  --what "Two people who recorded decisions while offline end up with both, and a real disagreement is handed back to a person to settle." \
  --why "Concurrent recordings could take the same number and overwrite each other, and a merge took one side without saying so." \
  --verified "eight concurrent processes recording - eight distinct identifiers" \
  --verified "two spawned servers, offline, both push orders - five properties passing" \
  --not-verified "behaviour against a hosted forge - local bare remote only"
```
