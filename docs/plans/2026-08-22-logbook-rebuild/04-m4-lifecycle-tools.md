# M4 — Lifecycle tools

**Depends on:** M3.

**Ships:** `open_thread`, `update_thread`, `close_thread`, `amend_criteria`, `bind_branch`, the done gate, and cap enforcement at the tool boundary.

**Read first:** SPEC §6.4, §6.5, §6.6, §7.3, §10.2, §11.5, and `00-overview.md` §5.2 for why `bind_branch` is here.

---

## Premise checks

- [ ] **P1. M3 is merged and green.** `npm run rebuild:test` exits 0 on `main`, including `rebuild/test/spawn/`.
- [ ] **P2. `ALL_TOOLS` is the single registration list.** Read `rebuild/src/server/register.ts` and confirm the three censuses iterate it. If a tool can register outside it, the description census is a sample rather than a census and the unit is re-planned.
- [ ] **P3. Caps are declared as values, not inlined at call sites.** Read `rebuild/src/schema/caps.ts`.
- [ ] **P4. The store exposes `commit` with a change list.** Confirm `RecordChange` covers `thread`.
- [ ] **P5. `bind_branch` is still unassigned in the SPEC's delivery table.** Confirm §13.2 names it in no unit. If a later amendment assigned it elsewhere, drop it from this unit rather than shipping it twice.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | The done gate refuses and names **every** outstanding criterion by id and text | `gate.names-every-outstanding` passes |
| A2 | Every tool this unit ships has a spawn contract test and a rejection test | `open_thread.spawn.contract` … `bind_branch.rejects-invalid`, ten tests |
| A3 | Every property of every input schema has a non-empty description; the build fails otherwise | `contract.every-property-described` passes as a census |
| A4 | A cap violation refuses the whole call and names field, limit, observed size and remedy | `caps.refuse-whole-call` passes |
| A5 | A cap is asserted on the contribution, not on the merged result | `caps.assert-contribution` passes |
| A6 | Collection **counts** are capped, not only element sizes | `caps.count-is-capped` passes |
| A7 | A criterion changes only through `amend_criteria` and only with a decision reference | `criteria.requires-decision-ref` passes |
| A8 | A struck criterion is retained and rendered struck, never deleted | `criteria.strike-retains` passes |

**Red on the parent commit:** `gate.names-every-outstanding`.

**Inertness mutation:** in `rebuild/src/domain/done-gate.ts`, change the refusal to report only the **first** outstanding criterion instead of all of them. `gate.names-every-outstanding` must turn red.

---

## Files

**Create:** `rebuild/src/domain/lifecycle.ts`, `done-gate.ts`, `criteria.ts`, `spine.ts`; `rebuild/src/server/tools/open-thread.ts`, `update-thread.ts`, `close-thread.ts`, `amend-criteria.ts`, `bind-branch.ts`; `rebuild/test/unit/done-gate.test.ts`, `criteria.test.ts`, `caps.test.ts`; `rebuild/test/spawn/lifecycle.test.ts`; `rebuild/test/contract/described.test.ts`.

---

## Task 1: The description census

**Files:** `rebuild/test/contract/described.test.ts`

Do this **first**, before any tool exists. A census written after the tools is a census written to pass.

- [ ] **Step 1: Write `contract.every-property-described`**

Walk every entry in `ALL_TOOLS`. For each, take `z.toJSONSchema(spec.input)` and recurse over `properties`, `items` and nested objects. Assert every leaf and every object node has a non-empty `description` of at least 10 characters. A node the walker cannot classify halts the census.

Then assert the same over the **live listing** from a spawned server, not only over the local `ALL_TOOLS` value. What reaches the client is the only thing that matters, and the two can differ if registration transforms the schema.

- [ ] **Step 2: Confirm it passes vacuously now and will not stay vacuous**

Assert `ALL_TOOLS.length > 0` in the same test. A census over an empty list is not a census. This assertion is why the test is written first: it is red today and every later unit keeps it honest.

- [ ] **Step 3: Commit**

```bash
git add rebuild/test/contract/described.test.ts
git commit -m "test(rebuild): fail the build when any tool property lacks a description"
```

---

## Task 2: The done gate

**Files:** `rebuild/src/domain/done-gate.ts`, `lifecycle.ts`, `rebuild/test/unit/done-gate.test.ts`

**Produces:**

```ts
export type GateFailure = { outstanding: Criterion[]; reason: 'no-criteria' | 'criteria-open' | 'no-closure' }
export const evaluateDoneGate: (thread: Thread, closure: string) => Ok<void> | GateFailure
export const transition: (rt: Runtime, thread: Thread, to: 'done' | 'abandoned', detail: string) => Ok<Thread> | Refusal
```

- [ ] **Step 1: Write the failing tests**

```
gate.requires-a-criterion        a thread whose every criterion is struck refuses with
                                 reason "no-criteria"
gate.requires-all-done           one un-struck criterion open -> refuses
gate.requires-closure            all done, empty closure -> refuses with "no-closure"
gate.names-every-outstanding     three of five criteria open -> the refusal message contains all
                                 THREE ids AND all three texts; asserted by set equality over ids
                                 parsed out of the message, not by substring on one of them
gate.refusal-leaves-state        after a refused transition, re-read the thread and assert
                                 status is unchanged and updated_at is unchanged
```

`gate.names-every-outstanding` is A1 and it is the one the inertness mutation targets. §6.5 requires the refusal to name every outstanding criterion "not merely that the gate failed", and a first-only message is the plausible wrong implementation.

- [ ] **Step 2: Implement**

Three stored states only: `open`, `done`, `abandoned` (§6.4). There is no stored `active` and no stored `blocked`; being worked is the pointer's business (M5) and blockage is the `blocked_by` field.

`transition` to `abandoned` requires a non-empty reason, which is written to the session log rather than onto the thread (§6.2). `transition` to `done` requires a non-empty closure statement, likewise written to the session log; the gate stays, the text does not become a column.

The gate is fourteen lines with one caller, and it refuses rather than truncating or warning. It is the model every other refusal in the system follows (§6.5).

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/domain/done-gate.ts rebuild/src/domain/lifecycle.ts rebuild/test/unit/done-gate.test.ts
git commit -m "feat(rebuild): refuse a close that leaves any criterion outstanding"
```

---

## Task 3: Caps at the tool boundary

**Files:** `rebuild/src/domain/spine.ts`, `rebuild/test/unit/caps.test.ts`

- [ ] **Step 1: Write the failing tests**

```
caps.refuse-whole-call     a call whose spine.next_step exceeds 500 characters is refused whole;
                           re-read the thread and assert NOTHING changed, including the fields
                           the same call would have written successfully
caps.assert-contribution   a thread already holding 39 risks accepts a call adding one; a thread
                           holding 40 refuses the call that would add the forty-first. The
                           assertion is on what this call contributes plus what is stored, never
                           on a re-serialised merged spine that the caller did not author
caps.count-is-capped       200 key_decisions accepted, 201 refused. The current build has no count
                           cap here, which is how 5,000 entries and 825 KB passed unremarked
caps.after-escaping        a value that is 480 characters raw and 620 characters after escaping is
                           refused; escaping inflates ordinary input several-fold
caps.refusal-is-complete   the refusal names the field, the limit, the observed size and a remedy
```

`caps.assert-contribution`'s framing matters: §6.6 says asserting on a merged result bricks the tool against data already on disk. There is no legacy data here (0064), but the same call shape recurs the moment a merge (M2) produces a spine larger than any single caller authored.

- [ ] **Step 2: Implement, run to green, commit**

```bash
git add rebuild/src/domain/spine.ts rebuild/test/unit/caps.test.ts
git commit -m "feat(rebuild): cap collection counts and refuse the whole call over a limit"
```

---

## Task 4: `open_thread` and `update_thread`

**Files:** `rebuild/src/server/tools/open-thread.ts`, `update-thread.ts`, `rebuild/test/spawn/lifecycle.test.ts`

Descriptions must be at least three or four sentences, lead with what a caller most needs, carry a literal example of the trickiest argument, state any non-obvious effect, and **never** instruct the model ("always do X", "you must call Y first" reads as prompt injection and fails review) — §7.3.

- [ ] **Step 1: Write the two tools' specs**

`open_thread` — `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

> Creates a new thread of work and returns its id. A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion stating what finishing looks like; a thread with no criterion can never be closed, so the call is refused without one. Criteria are supplied as plain strings and the server assigns each one a stable id and its display ordinal, so `["the merge test passes in both push orders", "the plan is committed"]` is a complete value. The slug is lowercase letters, digits and hyphens, up to 64 characters, for example `merge-and-sync`.

`update_thread` — `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

> Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just `criteria_done: ["<criterion ulid>"]` changes nothing else. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The reply reports what changed, not what the record now holds.

- [ ] **Step 2: Write the spawn and rejection tests**

Per tool, the two mandatory tests of §11.5:

```
<tool>.spawn.contract   real binary over real stdio: the tool appears in the listing, a valid call
                        returns a result conforming to its declared output schema, and stderr
                        contains nothing meant for stdout
<tool>.rejects-invalid  inputs GENERATED from the tool's own published schema, negated: each is
                        refused as a tool error naming the field, the accepted shape, an example
                        and retryability
```

`rejects-invalid` uses `rebuild/test/support/schema-arbitrary.ts` (M3). The generator reads the **published JSON Schema from a live `tools/list`**, produces a valid instance, then produces one mutation per constraint — drop a required property, exceed a `maxLength`, violate a `pattern`, undershoot a `minItems`, wrong `type`. An input generated this way cannot be hard-coded by construction and cannot drift from the schema (§11.7).

- [ ] **Step 3: Implement both tools, run to green, commit**

```bash
git add rebuild/src/server/tools/open-thread.ts rebuild/src/server/tools/update-thread.ts rebuild/test/spawn/lifecycle.test.ts
git commit -m "feat(rebuild): open a thread and record progress on it"
```

---

## Task 5: `close_thread` and `amend_criteria`

**Files:** `rebuild/src/server/tools/close-thread.ts`, `amend-criteria.ts`, `rebuild/src/domain/criteria.ts`, `rebuild/test/unit/criteria.test.ts`

- [ ] **Step 1: Write the failing criteria tests**

```
criteria.requires-decision-ref   insert, rewrite and strike each refuse without a decision id, and
                                 each refuses with a decision id that resolves to no record
criteria.strike-retains          after a strike, the criterion is still present with struck_by set
                                 to the decision id; it is absent from the outstanding set the done
                                 gate reports; and readThread still returns it
criteria.ordinals-recompute      inserting between two criteria renumbers ordinals 1..n while every
                                 id is unchanged
```

`criteria.ordinals-recompute` is the observable consequence of `00-overview.md` §5.1: the id is stable and offline-mintable, the `c1` label is a rendering.

- [ ] **Step 2: Write `close_thread`'s spec**

`readOnlyHint: false`, `destructiveHint: **true**`, `idempotentHint: false`. It is the one tool in this unit that is destructive, and the annotation says so.

> Closes one thread as either done or abandoned, and this cannot be undone through any tool. Closing as done is gated: every criterion that has not been struck must already be marked done and a closure statement must be supplied, and if any criterion is still open the call is refused and names each one. Closing as abandoned needs a reason instead, which is written to the session log rather than onto the thread. Reopening later means creating a new thread that references this one.

- [ ] **Step 3: Implement, run to green, commit**

```bash
git add rebuild/src/server/tools/close-thread.ts rebuild/src/server/tools/amend-criteria.ts rebuild/src/domain/criteria.ts rebuild/test/unit/criteria.test.ts
git commit -m "feat(rebuild): close a thread through the gate and amend criteria by decision"
```

---

## Task 6: `bind_branch`

**Files:** `rebuild/src/server/tools/bind-branch.ts`

§13.2 assigns this tool to no unit; `00-overview.md` §5.2 assigns it here because A2 already requires spawn and rejection tests for every tool this unit ships. §14 item 6 keeps `bind_branch` in v1 and defers drift signals until a second user exists — **so this unit ships the binding and no drift detection.**

- [ ] **Step 1: Write the spec**

`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: **true**`.

> Links a working git branch to a thread so a later session can tell which thread a branch belongs to. Takes a thread id and a branch name; binding the same pair twice is not an error and changes nothing. The binding is stored with the ledger and shared with the team, unlike the record of which thread is being worked right now, which stays on one machine. Nothing warns when a branch and its thread drift apart; that is deliberate and deferred.

- [ ] **Step 2: Implement, add the two mandatory tests, run to green**

- [ ] **Step 3: Run the inertness mutation and record it**

Change `done-gate.ts` to report only the first outstanding criterion; confirm `gate.names-every-outstanding` turns red; restore.

- [ ] **Step 4: Commit and open the pull request**

```bash
git add rebuild/src/server/tools/bind-branch.ts
git commit -m "feat(rebuild): bind a working branch to a thread"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m4-lifecycle-tools --base main \
  --title "feat(tools): open, update, close and amend threads through the server" \
  --what "Closing a thread with work outstanding now lists every unfinished criterion by name instead of only saying the check failed." \
  --what "Every argument the server accepts explains itself in the tool listing, so a caller does not discover the shape by trial." \
  --why "Not one argument in any tool carried a description, which is why calling the hand-off flow took several attempts." \
  --verified "description census over the live tool listing - every property described" \
  --verified "inertness mutation on the done gate - gate.names-every-outstanding red" \
  --not-verified "whether the model chooses to call these tools - unmeasurable until the evaluation harness opens"
```
