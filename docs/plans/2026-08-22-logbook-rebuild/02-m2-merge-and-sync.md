# M2 — Merge and sync

**Depends on:** M1. Runs in parallel with M3.

**Ships:** field-level merge over records, conflict refusal, fetch/merge/push, and retry on a moved ref.

**Read first:** SPEC §5.6, §6.2, §6.3, §11.6, §11.7, and `00-overview.md` §3 and §5.3.

---

## Premise checks

- [ ] **P1. M1 is merged and green.** `git log --oneline main | grep -q 'rebuild the record model'` and `npm run rebuild:test` exits 0 on `main`.
- [ ] **P2. Every collection element carries a ULID.** `node --test rebuild/test/unit/records.test.ts` passes `model.every-element-has-id`. Without this the merge has nothing to key on and the unit is re-planned.
- [ ] **P3. `casUpdateRef` refuses distinguishably on a moved ref.** Read `rebuild/src/store/ref.ts` and confirm a `ref-moved` cause is returned rather than a generic failure.
- [ ] **P4. Git supports a leased push.** `git push --help` documents `--force-with-lease`.
- [ ] **P5. A local bare repository serves as a remote.** `git init --bare` in a temporary directory, clone it, push, and confirm the ref lands.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | Two teammates diverged offline lose nothing, collide on no identifier, corrupt no file, converge, and do so in either push order | `sync.two-clones-offline.store` passes |
| A2 | A genuine scalar conflict refuses, leaves both sides addressable, and pushes nothing | `sync.conflict-refuses` passes |
| A3 | A ref moved between read and write causes a re-read and retry, never a clobber | `sync.cas-retry` passes |
| A4 | Every field rule in §5.6 is exercised, including the take-one-side and both-identical rows | `merge.rule-table-is-covered` passes as a census |

**On A1 and the SPEC's §11.6.** §13.2 makes `sync.two-clones-offline` M2's acceptance, but §11.6 describes it as two spawned MCP servers recording decisions through a tool — a surface that does not exist until M6, and M3 runs in parallel with this unit. This unit therefore ships the scenario at the store layer, with two real clones and two real node processes; M6 ships the same five properties through spawned servers as `sync.two-clones-offline.spawn`. See `00-overview.md` §5.3 and decision 0080.

**Red on the parent commit:** `sync.two-clones-offline.store`.

**Inertness mutation:** in `rebuild/src/merge/sync.ts`, replace the merge branch of the five-way comparison with "take the remote side and push". `sync.two-clones-offline.store` must turn red at property 1 — that mutation is precisely what the current build does today, and it is what silently discards a teammate's thread record (§5.6).

---

## Files

**Create:** `rebuild/src/merge/field-merge.ts`, `conflict.ts`, `sync.ts`; `rebuild/test/support/clone-fixture.ts`; `rebuild/test/unit/field-merge.test.ts`; `rebuild/test/sync/two-clones.test.ts`, `conflict.test.ts`, `cas-retry.test.ts`.

**Modify:** `package.json` — add `rebuild/test/sync/` to `rebuild:test`.

---

## Task 1: The field-merge engine

**Files:** `rebuild/src/merge/field-merge.ts`, `conflict.ts`, `rebuild/test/unit/field-merge.test.ts`

**Produces:** `mergeThread`, `mergeDecision`, `mergeSession`, `Conflict`, `MergeResult<T>` (signatures in `00-overview.md` §3).

- [ ] **Step 1: Encode the rule table as data, not as branches**

```ts
type FieldRule = 'take-present' | 'union-by-id' | 'conflict-on-divergence'
export const THREAD_RULES: Record<keyof Thread | `spine.${keyof Spine}`, FieldRule>
```

| Field | Rule | Source |
|---|---|---|
| any field present on one side only | `take-present` | §5.6 row 1 |
| any field identical on both sides | `take-present` | §5.6 row 2 |
| `completion_criteria` | `union-by-id`; same id and different text is a conflict | §5.6 |
| `spine.key_decisions`, `spine.open_risks`, `spine.out_of_scope` | `union-by-id` | §5.6 |
| `status`, `title`, `slug`, `blocked_by`, `closure` | `conflict-on-divergence` | §5.6 |
| `spine.active_goal`, `spine.next_step`, `spine.last_session` | `conflict-on-divergence` | §5.6 |
| `created_at` | `take-present` — immutable after creation | §6.2 |
| `updated_at` | take the later value; it is derived, never authored | §6.2 |

A table makes A4's census possible. A cascade of `if` branches does not.

- [ ] **Step 2: Write the failing census test `merge.rule-table-is-covered`**

Walk every property of `ThreadRecord.jsonSchema`, including `spine.*`. For each, assert `THREAD_RULES` names a rule. A property with no rule is **unclassifiable and halts the census** — that is what stops a field added in a later unit from silently defaulting to "take theirs".

Then, for each rule, assert at least one behavioural test exercises it, by name.

- [ ] **Step 3: Write the failing behavioural tests**

```
merge.takes-the-only-side        theirs sets blocked_by, ours leaves it null -> merged has theirs
merge.takes-identical            both set the same title -> merged has it, no conflict
merge.unions-criteria            ours adds criterion X, theirs adds Y -> merged has both, ordinals
                                 recomputed 1..n by created order, no conflict
merge.conflicts-on-same-id       ours and theirs both carry criterion id C with different text
                                 -> Conflict naming record, field and both values
merge.conflicts-on-scalar        ours sets next_step to A, theirs to B -> Conflict
merge.decision-never-conflicts   two decisions with distinct ULIDs merge to two records
merge.session-unions             two session entry sets union by entry id
```

`merge.unions-criteria` is where `00-overview.md` §5.1 pays off: because criterion ids are ULIDs, two offline additions union cleanly instead of colliding on `c5`.

- [ ] **Step 4: Implement, run to green**

`mergeThread(base, ours, theirs)` is a pure function returning either a merged record or **every** conflict found, not the first. A caller that must resolve conflicts needs the whole list.

- [ ] **Step 5: Commit**

```bash
git add rebuild/src/merge rebuild/test/unit/field-merge.test.ts
git commit -m "feat(rebuild): merge records field by field against a declared rule table"
```

---

## Task 2: The two-clone fixture

**Files:** `rebuild/test/support/clone-fixture.ts`

**Produces:**

```ts
export type Teammate = { name: string; repo: string; store: Store; rt: Runtime; goOffline: () => void; goOnline: () => void }
export const withTwoClones: (fn: (ana: Teammate, ben: Teammate, remote: string) => void) => void
```

- [ ] **Step 1: Build the fixture, all real**

A real bare repository as the shared remote. Two real clones. Each teammate gets its own plugin-data root, its own `Runtime` with its own seeded ULID factory, and its own git identity (`ana`/`ana@example.test`, `ben`/`ben@example.test`) so `sync.identity` stays meaningful across the pair.

`goOffline` points the clone's `origin` at a path that does not exist. **That is real, not simulated** (§11.6) — the fetch genuinely fails, which is the behaviour under test.

- [ ] **Step 2: Commit**

```bash
git add rebuild/test/support/clone-fixture.ts
git commit -m "test(rebuild): add a two-clone fixture over a real bare remote"
```

---

## Task 3: Sync

**Files:** `rebuild/src/merge/sync.ts`, `rebuild/test/sync/cas-retry.test.ts`, `conflict.test.ts`

**Produces:**

```ts
export type SyncOutcome =
  | { ok: true; action: 'noop' | 'pushed' | 'fast-forwarded' | 'merged'; ref: string }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'offline' | 'rejected'; detail: string }
export const sync: (rt: Runtime, store: Store, layout: StoreLayout) => SyncOutcome
```

- [ ] **Step 1: Write the failing tests**

```
sync.cas-retry           a second process moves the ref between this process's read and write;
                         assert one re-read and one retry occurred and both records survive
sync.conflict-refuses    both sides change spine.next_step differently; assert ok is false with
                         reason "conflict", assert BOTH sides' records still parse and are
                         addressable in the store, and assert `git log origin/...` shows no new
                         commit on the remote
sync.offline-is-an-error not-reachable remote yields reason "offline" naming the remote, NOT a
                         success with action "noop"
```

`sync.offline-is-an-error` is §10.3 at the sync boundary: a fetch that failed is an error, and only a fetch that succeeded and found nothing is a no-op.

- [ ] **Step 2: Implement the five-way comparison of §5.6**

1. fetch the ledger ref into a local tracking ref;
2. remote equals local — `noop`;
3. remote is an ancestor of local — push, `pushed`;
4. local is an ancestor of remote — fast-forward, refresh the working copy, `fast-forwarded`;
5. otherwise — merge, commit the result, push with `--force-with-lease`, `merged`.

Ancestry is `git merge-base --is-ancestor`. The merge in step 5 reads both sides' record trees, calls the M1 store to materialise each side's records, applies the Task 1 merge per record, and writes the result through the M1 write path so the durability sequence and the compare-and-swap both apply.

**On conflict the server refuses.** It writes the conflict set to `state/conflicts.json`, leaves both sides intact and addressable, and does not push. **It never picks a side.**

`--force-with-lease` is used and plain `--force` is not. The lease is what makes the push safe after a local merge; a bare force is the mechanism that erases a teammate's work.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/merge/sync.ts rebuild/test/sync
git commit -m "feat(rebuild): fetch, merge and push the ledger ref with a lease"
```

---

## Task 4: The worked example

**Files:** `rebuild/test/sync/two-clones.test.ts`

- [ ] **Step 1: Write `sync.two-clones-offline.store`, following §11.6 exactly**

Setup: `withTwoClones`. Both sync from a common base. Both go offline. Each records a decision **through a real second node process** driving the store library, so the two ULID factories are genuinely independent and the concurrency is real, not a loop. Both come back online. Ana syncs first; Ben must merge rather than clobber.

Assertions, all properties, no literals:

1. **Nothing lost.** Ben's store holds both decisions — asserted by count and by id-set equality.
2. **No collision.** The two identifiers are distinct.
3. **No corruption.** Every merged file parses through its `Declared.parse`, and no file contains `<<<<<<<`, `=======` or `>>>>>>>`.
4. **Convergence.** After Ana's next sync she sees Ben's decision.
5. **Order-independent.** The whole scenario re-runs with Ben pushing first and every assertion holds.

Property 5 is a second `test()` calling the same body with the roles swapped, not a copy of the body.

- [ ] **Step 2: Run and confirm each of the seven failure modes in §11.6's table**

For each row of that table, temporarily introduce the failure and confirm the test goes red at the stated property. Record the seven results in the pull request. This is what proves the test is not inert, and it is more valuable here than anywhere else in the suite because this one test is the 0065 gate.

- [ ] **Step 3: Run the inertness mutation**

Replace the merge branch of `sync` with "take the remote side and push". Confirm `sync.two-clones-offline.store` turns red at property 1. Restore.

- [ ] **Step 4: Commit and open the pull request**

```bash
git add rebuild/test/sync/two-clones.test.ts
git commit -m "test(rebuild): prove two offline teammates merge without loss"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m2-merge-and-sync --base main \
  --title "feat(sync): merge ledger records field by field and refuse on conflict" \
  --what "Two people who worked offline on one project now merge their ledgers without either losing work." \
  --what "A genuine disagreement on one field refuses the sync and leaves both versions readable." \
  --why "Sync took the remote side wholesale, reported success, and force-pushed, which silently discarded the other person's record." \
  --verified "two-clone offline scenario - 5 properties passing in both push orders" \
  --verified "seven failure modes introduced one at a time - each turned the test red" \
  --not-verified "behaviour against a hosted forge - local bare remote only"
```
