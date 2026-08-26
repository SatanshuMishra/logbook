# PLAN: briefing scoping repair — seven units, five waves

Spec: `docs/specs/2026-08-26-briefing-scoping-repair.md`, frozen at the commit that adds it.
Parent: `06fc0ae`, v1.1.3. Baseline receipt, run at planning time: `npm test` exit 0, **400/400**, 48.1s;
`npm run typecheck` exit 0.

Not executed through `mitosis` — directed. Each unit is dispatched to an implementer by the orchestrator.

## 0. Three ground-truth findings that changed this ladder

**0.1 — `renderBriefing` has TWO callers, and their decision-loading blocks are parallel twins.**
`src/server/tools/resume_thread.ts:83` and `src/server/resources.ts:108`, with twin loaders at
`resume_thread.ts:63-81` and `resources.ts:63-83`. **Nothing in the suite forces them to agree.** Changing
one and not the other makes the tool and the resource silently diverge — the adjacent-instance defect
class this repository has already shipped three times. Every unit touching either must touch both.

**0.2 — De-inlining needs zero renderer changes.** Measured: passing `[]` at `resume_thread.ts:83` drops
the briefing from **112,983 to 24,042 bytes** with no line changed in `briefing.ts`. The de-inlining
surface and the renderer-budget surface are separable, and the smaller one carries most of the value.
U1 is therefore small, early, and independent of the renderer rewrite.

**0.3 — The renderer is pinned by FIVE test files, not two.** Beyond `test/unit/briefing.test.ts` and
`test/spawn/decisions.test.ts`: `test/store/lineage.test.ts:61-63`, `test/spawn/resume.test.ts:369`, and
`test/spawn/forgery.test.ts:377-390`.

> **The sharp one.** `forgery.test.ts:377-390` asserts that a hostile `blocked_by` reaches the client
> **present and escaped**, on *both* briefing surfaces. A budget that DROPS the `blocked_by` line turns it
> red. `blocked_by` is therefore **guaranteed core** and may never be truncated. This constraint is not
> discretionary.

## 1. Version policy — one bump, at the end

**No unit bumps the version.** A single release commit closes the ladder: `1.1.3 → 1.2.0` (minor: new
field, new resource behaviour), touching `package.json:3` and `.claude-plugin/plugin.json:3`.

This is deliberate. Two branches bumping identically produce byte-identical hunks, merge without conflict,
and land the trunk one rung short — measured, and invisible to `cutover-manifests-agree`, which guards
intra-commit agreement and never monotonic advance. Eliminating the hazard beats managing it.

The release commit also repairs `package-lock.json:3,9`, which is **tracked, reads `0.2.8`, is three rungs
stale, and is asserted by nothing**.

## 2. The wave plan

```
W1   U1  de-inline                        (alone)
        |
W2   U2  thread-resource split  ||  U3  criterion_id field        (parallel)
        |                              |
W3   U4  merge proof            ||  U5  writers + existence check (parallel)
        \______________________________/
        |
W4   U6  renderer: budget + lanes + tail  (alone)
        |
W5   U7  backfill                         (alone)
        |
     REL bump 1.1.3 -> 1.2.0 + lockfile    (alone)
```

| Wave | Units | Parallel? | Why |
|---|---|---|---|
| W1 | U1 | no | Touches `briefing.ts`, both callers, and `briefing.test.ts`. Everything downstream wants one of those. |
| W2 | U2, U3 | **yes** | Zero file overlap: U2 owns `server/resources.ts` + `resource-render.ts`; U3 owns `schema/thread.ts`. |
| W3 | U4, U5 | **yes** | Zero file overlap: U4 owns `merge/*` + `resolve_conflict.ts`; U5 owns `record_decision.ts`, `update_thread.ts`, `domain/spine.ts`. Both need U3. |
| W4 | U6 | no | Sole owner of `briefing.ts` and all five pinning test files. |
| W5 | U7 | no | Needs the field (U3) and something that reads it (U6). |

## 3. The units

### U1 — stop inlining decision bodies · W1 · ~150 lines

**Delivers 79% of the total win.**

| | |
|---|---|
| **Source** | `src/render/briefing.ts` (param type, drop `renderDecisionLine` at `:20-21` and its spread at `:42`), `src/server/tools/resume_thread.ts:63-83`, **`src/server/resources.ts:63-83,108` — the twin, mandatory** |
| **Tests** | `test/unit/briefing.test.ts` (whole-document assertions at `:85-171`), `test/spawn/decisions.test.ts:304-313` |
| **Red on parent** | a linked decision whose `outcome` carries a distinctive sentinel — assert the sentinel is **absent** from the briefing. Red today via `briefing.ts:20-21`. |
| **Inertness** | restore the spread at `:42`; the test must go red. |

`renderBriefing`'s third parameter becomes `{ resolved: number, dangling: string[], quarantined: string[] }`.
The resolution loop **stays** in both callers — it costs server-side I/O, not tokens, and is the only
dangling detector — but its payload no longer reaches the renderer. Commit `0b736d5` could reinline
because the renderer *had* the bodies; this makes the regression structurally unrepeatable.

Those integrity counts currently reach stderr only. Surface them.

### U2 — split the thread resource · W2 ‖ U3 · ~150-230 lines

| | |
|---|---|
| **Source** | `src/server/resources.ts` (`ADDRESSES :23-32`, the `registerResource` block, point `:108` at the new renderer), `src/server/resource-render.ts` (new `renderThreadDetail`) |
| **Tests** | **`test/spawn/resources.test.ts` — INSEPARABLE, see below**, plus a new detail-render test |
| **Red on parent** | the thread resource contains **every** risk id and **every** criterion id on the thread. Red today: `renderBriefing` prints no ids at all. |

> **Inseparability, verified.** `resolveShapeToUri` at `test/spawn/resources.test.ts:118-128` is a
> **hardcoded shape→URI map** returning `null` for anything unknown. Add the address without the test edit
> and `resource.index-addresses-resolve` halts on `'unclassifiable'` at `:164`; add the test edit without
> the address and the shape never appears. **Neither half is green alone. They ship in one commit.**

`renderThreadDetail` is complete and **body-free**, bounded by the record's own 65,536-byte cap. It is
`src/server/resource-render.ts`, **not** a new file under `src/server/tools/` — see §5, constraint C3.

### U3 — the `criterion_id` field · W2 ‖ U2 · ~10-15 lines

| | |
|---|---|
| **Source** | `src/schema/thread.ts` — `Risk` `:18`/`RiskSchema :64-72`, `KeyDecision` `:19`/`KeyDecisionSchema :74-79` |
| **Tests** | a schema unit test |
| **Red on parent** | `ThreadRecord.parse(threadWithCriterionIdOnARisk)` **returns** the field. Red today: `z.object` is strip mode, so it is silently dropped. |

```
criterion_id?: Ulid    // .optional(), NEVER .nullable()
```

Empirically verified against the live store: `.optional()` → **92/92 risks and 131/131 links valid, zero
quarantine**. Required → **0/92 valid, 100% quarantine**, and the roster surfaces drop quarantined records
**silently** (`list_threads.ts:84-90` logs to stderr; `resources.ts:149-151` does not log at all).

The smallest unit in the ladder, and the one three others depend on. Ship it early and alone-ish.

### U4 — prove the field survives merge · W3 ‖ U5 · ~0-45 lines

| | |
|---|---|
| **Source** | likely **none**. `merge/field-merge.ts`, `merge/conflict.ts`, `server/tools/resolve_conflict.ts` |
| **Tests** | `test/unit/field-merge.test.ts`, `test/sync/resolve.test.ts` |
| **Red on parent** | on a parent carrying U3: two sides diverging on one element's `criterion_id` produce a conflict carrying the whole element; a one-sided add survives the merge intact. |

`spine.open_risks` and `spine.key_decisions` are already `'union-by-id'` (`field-merge.ts:30-31`), and
`unionByIdWithConflict:135` compares whole elements with `isDeepStrictEqual`. `THREAD_RULES` has no
vocabulary for element fields at all. **This unit's job is to convert "we believe it is fine" into an
asserted invariant.** If it needs no source change, that is a result, not a failure — say so in the receipt.

**Rejected:** a `riskContent` projection copying `criterionContent` at `:146-153`. It would suppress a
real signal in the one case where divergence means something.

### U5 — writers accept it, and cannot dangle · W3 ‖ U4 · ~35-60 lines

| | |
|---|---|
| **Source** | `src/server/tools/update_thread.ts` (`RiskAddSchema :13-23`, `KeyDecisionAddSchema :25-31`, existence check near `:188`), `src/server/tools/record_decision.ts` (`deriveScope :54-61`, `:205-210`), `src/domain/spine.ts` (`:78`, `:122`) |
| **Tests** | `test/unit/caps.test.ts`, `test/spawn/decisions.test.ts`, `test/contract/no-path.test.ts` |
| **Red on parent** | `risks_add` with a `criterion_id` naming **no criterion on the thread** is refused, naming the field. Red today: no such check exists. |

The one genuine dangling path: `risks_add` accepts caller-supplied content with **no cross-check against
`completion_criteria`**. Model the check on the `decision_id` check already at `:201-207`.

Reference direction is safe: criteria are **never deleted**, only struck and retained
(`domain/criteria.ts:74-81,227-229`, all 7 write sites enumerated). Risks **are** deleted
(`update_thread.ts:186`).

**Watch two censuses.** New tool-input fields must be `.optional()` or `.default()`, never `.nullable()` —
measured: `.nullable()` emits `anyOf` and halts `every-property-described` at `described.test.ts:48-62`.
Every new node needs a `.describe()` of ≥10 chars.

### U6 — the renderer: budget, lanes, truncated tail · W4 · ~250 lines

**The largest unit. Sole owner of `briefing.ts` and all five pinning test files.**

| | |
|---|---|
| **Source** | `src/render/briefing.ts` |
| **Tests** | `test/unit/briefing.test.ts` (rewrite `:85-171`), `test/store/lineage.test.ts:61-63`, `test/spawn/resume.test.ts:369`, `test/spawn/forgery.test.ts:377-390`, `test/spawn/decisions.test.ts` |
| **Red on parent** | (a) the largest schema-admissible thread renders within `BRIEFING_MAX_CHARS`; (b) a risk on a **done** criterion collapses while an **unanchored** risk renders in full. |
| **Inertness** | revert the budget clamp; (a) must go red. |

```
BRIEFING_MAX_CHARS       = 12000
RESUME_PAYLOAD_MAX_BYTES = 24000
```

Budget and lanes ship **together**, not split. Splitting means rewriting the same five pinning test files
twice, and `49daa01` is the precedent: one optional field plus its render shipped **undivided across 12
files, 233 insertions**, because the exact-output test had to move in the same commit.

**Guaranteed core, never truncated:** header, status, **`blocked_by`**, goal, next step, criteria.
`blocked_by` is core because `forgery.test.ts:377-390` asserts a hostile value reaches the client present
and escaped — dropping the line turns it red on both surfaces.

**Lanes** — a stable sort on facts already in the record. No scoring function (spec §6.4).

| Lane | Contains | Rendered | Cap |
|---|---|---|---|
| A | `criterion_id` = current criterion | full | 8 risks / 10 titles |
| B | other live criteria, **or unanchored** | full | 4 risks / 5 titles |
| C | `criterion_id` names a done/struck criterion | count + the address | — |

**Unanchored → B, never C.** A missing tag must not hide an item.

**Tail:** a mandatory NOT SHOWN block naming what was cut and the one address that retrieves it (U2's).

**Three census constraints.** `src/render/briefing.ts` is in `CENSUSED_FILES`
(`render-census.test.ts:16-24`): every interpolation must statically resolve to `escapeStored(...)` or
`clipGraphemes(escapeStored(...), n)`, else the census halts. `clipGraphemes` exists at
`src/render/escape.ts:40` and the census recognises the idiom, but **it is used nowhere in `src/render/`
today** — there is no size-budget precedent in the render layer. And exactly one rendered line may carry
the thread title (`forgery.test.ts:344-348`).

**Mutation.** `src/render/**` is in the stryker scope at break-70, and the runner executes only
`test/unit/**` and `test/store/**`. `briefing.test.ts:127-149,155-170` are two whole-document
`assert.equal`s carrying the renderer's **entire** mutation defence. Replacing them with weaker
assertions drops the score. **New unit tests must be at least as strong as what they replace** — assert
exact output for a small fixture *and* the budget for a large one. The gate cannot be run locally
(`@stryker-mutator/core` has **zero tracked files** and is absent from disk), so this is a design
obligation, not a check.

### U7 — the backfill · W5 · ~60-90 lines

| | |
|---|---|
| **Source** | a one-shot migration path |
| **Red on parent** | a legacy link with `scope: "criterion 2"` and no `criterion_id` gains the **correct** ULID |

Anchors 63 of 105 live items. The other 42 carry prose naming no criterion — "shipped regressions",
"tooling", "MSP-9 dispatch" — and stay unanchored, rendering in lane B where they belong.

> **This unit's correctness expires.** `field-merge.ts:177-178` sorts criteria **by ULID** and renumbers
> positionally. On the next merge, 5 of 7 criteria change ordinal and **62 of 63 tags** come to point at a
> different criterion. Zero are corrupted today. The mapping is provably correct now and unverifiable
> after. Its test asserts against the criteria list **as it stands at that commit**, never a reconstruction.

Safe because the human confirmed a **single clone**: same-id divergence needs two machines.

## 4. Verification — per unit and per merge

Every unit: `npm run typecheck` (exit 0) and `npm test` (exit 0, ≥400 passing). **Never `npm install` or
`npm ci`** — `node_modules` is tracked and `yaml` is hand-vendored.

**Per merge, by hand, because no CI has ever run against the trunk:**

```
git merge-base --is-ancestor <merged-head> origin/main
git checkout <merge-commit-sha> && npm run typecheck && npm test
```

Confirmed at planning time: both workflows trigger on `pull_request` **only** — 139 runs, zero with
`headBranch: main`. Worse than previously recorded: `main` has **no branch protection and no required
checks** (`404 Branch not protected`, rulesets `[]`), and **three `ci` runs concluded `failure` and their
pull requests merged anyway**. A green check is GitHub's computed merge-with-base, never the commit that
lands.

## 5. Standing constraints for every implementer dispatch

| # | Constraint |
|---|---|
| **C1** | **Both twins or neither.** Any change to `resume_thread.ts`'s decision loading must land the same change at `resources.ts:63-83`. Nothing in the suite forces agreement. |
| **C2** | `.optional()` or `.default()`, **never `.nullable()`**, on anything reaching a tool input. Measured: `.nullable()` emits `anyOf` → census halt. |
| **C3** | **No new file under `src/server/tools/`** unless it is a fully-registered tool — present in `ALL_TOOLS`, published by `listTools()`, in `LEDGER_TOOL_NAMES`, and carrying a `PUBLISHED_CLAIMS` entry. Otherwise the five-axis registry census halts. Helpers live elsewhere. |
| **C4** | **No new *exported* symbol returning `Refusal`** without adding it to the 72-entry list at `no-path.test.ts:74-108` and exercising it, same commit. Module-private producers are free. |
| **C5** | Every new schema node carries `.describe()` of ≥10 characters. |
| **C6** | Acceptance is a **ceiling**. Anything found above it is FILED and reported, never folded in. |
| **C7** | Forbidden without explicit instruction: merging, force-push, rewriting a pushed commit, `npm install`, editing this plan. A PR's title and body are fixed at creation. |
| **C8** | State a line count only after measuring the applied diff. A count stated as fact before measurement is itself a defect. |

## 6. Filed during planning — NOT folded in

New findings from the ground-truth pass. Each is real; none is in this ladder's scope.

| Item | Evidence |
|---|---|
| **The store-anomaly detector barely works.** `ensureMaterialised` returns early once disk holds **≥1** record, and `records_on_disk` is a hardcoded literal `0` | `src/store/records.ts:117-133`, `:121`, `:130` |
| **Two live stores exist** for this project under different plugin-data roots; `logbook-logbook` is 6 commits behind with 141 records on disk vs 144 in the ref, and the duplicate guard cannot see across roots | `src/store/single-store.ts:40,45` |
| **`main` has no branch protection and no required checks**; three failed `ci` runs merged | `gh api .../protection` → 404; rulesets `[]` |
| **`package-lock.json` is tracked, reads `0.2.8`, three rungs stale, asserted by nothing** | `package-lock.json:3,9` |
| **`receipts.config.json` is 9 of 12 required settings short** — `require_receipt_for`, `G11.mode`, `G13.coverage_command`, `G14.mode`/`max_mutants`, `verify.receipt_runs`, `G6.surfaces` all absent; `downgrade_tags` has 3 of 4 | `receipts.config.json` |
| `receipts.config.json:2` references `./receipts.config.schema.json`, **which does not exist** | — |
| `build.integration_branch` is `"main"` while `gates.G8.integration_branch` is `"integration"`, **a branch that does not exist** | `receipts.config.json:16,35` |
| The recorded mutation score **66.60 is against `1c5d082`, not HEAD** — ten `src/` commits since, and the gate cannot be run from this repository | ledger decision `01M0XS7XBNJ4FTGWFBEGPWGYV8` |
| `docs/rules/continuity-ledger.md`'s prose "The twelve tools… These are all of them" is **not** a censused code span and would go false silently | `continuity-rule-census.test.ts:11` |

## 7. What planning did not establish

- **Type-accurate caller/callee facts.** The ground-truth pass reported `CAPABILITY-BLOCKED: needed=Serena activate_project` and fell back to grep over `src/` and `test/`. Every relational fact in §3 is grep-derived, cross-checked against the TypeScript program where a test already builds one. **Each implementer re-verifies its own FIND anchors before editing** — this repository has already shipped one plan whose anchors no longer matched and another whose edit would have silently reversed a deliberate decision.
- **The mutation score at `06fc0ae`.** Unrunnable locally; U6's obligation is stated as design, not measured.
- **An exhaustive sweep of all 32 census files.** Every census bearing on the four axes in play was read; `cutover-*`, `temp-dirs`, `no-sleeps`, `environment-is-injected`, `workflow-hardening` and `source-is-greppable-text` were not, and none is implicated by any file in §3.
