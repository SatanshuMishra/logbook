# SPEC: the resumption briefing is bounded, ranked and scoped to the work that is next

Status: APPROVED, frozen at the commit this file is committed in.
Thread: `briefing-size` (`01M0ZPJPJQH29VTH7V5VZ21TPZ`)
Parent commit: `06fc0ae`, version 1.1.3, suite green 400/400.

## 1. What is wrong

`resume_thread` returns a briefing of **113,073 characters** across 193 lines — roughly 28,000 tokens,
about 15% of a fresh session's context window. It exceeds the harness ceiling on a tool result and must
be spilled to a file before it can be read at all.

Measured composition, reproduced offline by importing the real renderer and feeding it the live record:

| Section | Items | Chars | Share |
|---|---:|---:|---:|
| `Decisions:` — every decision's full `outcome` body | 65 | 88,951 | **78.7%** |
| `Open risks:` | 40 | 13,683 | 12.1% |
| `Key decisions:` — titles, duplicating the above | 65 | 7,177 | 6.3% |
| Header | 7 | 1,535 | 1.4% |
| `Completion criteria:` | 7 | 1,263 | 1.1% |
| `Out of scope:` | 3 | 450 | 0.4% |
| `Related:` | 0 | 8 | 0.0% |

No risk exceeds 486 characters; mean 339. The bloat is one section doing one wrong thing.

### 1.1 The mechanism

`renderBriefing` (`src/render/briefing.ts:32-67`) maps unconditionally over five collections with no
filter, limit or budget — six spread sites at `:55-65`, mapped at `:38-42`. `resume_thread`
(`src/server/tools/resume_thread.ts:63-66`) eagerly resolves **every** linked decision record and inlines
its full `outcome` through `renderDecisionLine` (`briefing.ts:20-21`). `outcome` is capped at 4,000
characters each (`src/schema/caps.ts:31`).

**`renderBriefing` has TWO callers, and their decision-loading blocks are parallel twins:**
`resume_thread.ts:83` / `:63-81`, and `src/server/resources.ts:108` / `:63-83`. **Nothing in the suite
forces them to agree.** Changing one and not the other makes the tool and the resource silently diverge —
the adjacent-instance defect class this repository has shipped three times. Every change to either lands
on both.

De-inlining is separable from the renderer: measured, passing `[]` at `resume_thread.ts:83` drops the
briefing from 112,983 to **24,042 bytes** with no line changed in `briefing.ts`.

### 1.2 Why the caps did not catch it

The caps are correct and fire as designed. They are the wrong shape.

`THREAD_RECORD_SERIALISED_MAX_BYTES = 65536` (`caps.ts:39`) is enforced on the **thread record**, which
stores a decision as a ~238-byte link `{id, decision_id, title, scope}` (`src/schema/thread.ts:19`). The
4,000-character body lives in a **separate record** (`src/schema/decision.ts:9-19`) the cap never sees.
Measured amplification: **5.7x**. The live record is 37,423 of 65,536 bytes — legally, comfortably under.

There is no token, budget or truncate concept anywhere in the render path: zero grep matches. No test
asserts an upper bound; the only length assertions are `briefing.length > 0`
(`test/spawn/resume.test.ts:443,448`).

### 1.3 This is a regression with a named commit

`docs/specs/2026-08-02-preflight-briefing-redesign.md` decided all of the corrective behaviour: the
briefing sizes with the current step (`:36-38`), the whole payload stays under 3,000 characters
(`:43-45`, verified at 2,546 at `:566-569`), `Decisions:` renders title only (`:219-220`), sections are
omitted when empty (`:186-187`), and omissions surface as NOT SHOWN counts with a retrieval path
(`:229-232`, `:309-314`). The pre-cutover renderer at `2ab9eaf:src/render/briefing.mjs` implemented all
of it.

Commit **`0b736d5`** (23 Aug 2026), subject *"render a briefing that always shows why a thread is
blocked"*, dropped every part of it. No commit body, no decision record, no spec authority. Tests at
`test/unit/briefing.test.ts:145,216-218,248` and `test/spawn/decisions.test.ts:310-314` were then written
to expect the full-body dump, which is why nothing caught it. `docs/rules/continuity-ledger.md:178-179`
still claims decisions "are read on demand" — false of the shipped code since that date.

**Read `2ab9eaf:src/render/briefing.mjs` before implementing the renderer. Do not reinvent what shipped.**

### 1.4 The armed defect underneath

`src/merge/field-merge.ts:177-178` sorts criteria **by ULID** and renumbers 1..N positionally. ULIDs are
time-ordered, so a criterion inserted at position 0 receives a *later* ULID and sorts *last* after any
merge. `src/schema/thread.ts:49-53` states the ordinal is recomputed on render and never merged.

Measured on the live thread by replaying `refs/logbook/ledger`:

| | |
|---|---:|
| Criteria whose ordinal changes on the next merge | 5 of 7 |
| Tagged risks that would then point at a different criterion | 29 of 29 |
| Tagged links that would then point at a different criterion | 33 of 34 |
| **Tags corrupted today** | **0** |

The single criterion insert happened at ledger commit 10, before any risk or link existed. The corruption
does not accumulate; it fires entirely on the first merge. This is why §6.3 exists and why it is last.

## 2. Evidence law

Where this document disagrees with the code, **the code wins and this document is corrected**. A
correction is a recorded decision against the thread, never a silent edit. Anything discovered above a
unit's declared acceptance criterion is **filed as a new item**, never folded into work already scoped.

## 3. Boundary

### In scope

The render path, the thread resource, the `criterion_id` field and its write sites, the write-time
existence check, the risk read surface, the budget and its tests, and the backfill.

### Out of scope, filed as new items

| Item | Evidence |
|---|---|
| `toolOk` emits every payload twice — all twelve tools | `src/server/errors.ts:39-42` |
| Merge **resurrects retired risks**: deletion loses to presence | `field-merge.ts:140`; deletion at `update_thread.ts:186` |
| Merge output bypasses schema validation entirely | `sync.ts:342`; an 80-risk thread was produced against a cap of 40 |
| Merge sorts criteria by ULID and destroys ordinals — the root defect `criterion_id` routes around | `field-merge.ts:177-178` |
| `previous_session` is a sidecar field invisible in the render | `resume_thread.ts:26-28` |
| Green-path `resolve_conflict` on spine array elements has zero coverage | — |
| A `'thread'` sentinel distinguishing deliberate-thread-wide from untagged | §4.1 |
| Local-quarantine then remote-clobber on sync — `unverified-reasoned` | `sync.ts:83-100,197-199` |
| `logbook://roster` bypasses `MAX_PAGE_SIZE` | `resources.ts:153` vs `list_threads.ts:8` |
| The session-start hook is unbounded — ~810 chars per open thread, every session | `src/cli/session-start.ts:32-39` |
| **The store-anomaly detector barely works** — `ensureMaterialised` returns early once disk holds ≥1 record, and `records_on_disk` is a hardcoded literal `0` | `src/store/records.ts:117-133,121,130` |
| **Two live stores exist** under different plugin-data roots; `logbook-logbook` is 6 commits behind (141 on disk vs 144 in the ref) and the duplicate guard cannot see across roots | `src/store/single-store.ts:40,45` |
| **`main` has no branch protection and no required checks**; three failed `ci` runs merged anyway | `gh api .../protection` → 404; rulesets `[]` |
| **`package-lock.json` is tracked, reads `0.2.8`, three rungs stale, asserted by nothing** | `package-lock.json:3,9` |
| **`receipts.config.json` is 9 of 12 required settings short**; `downgrade_tags` carries 3 of 4 | `receipts.config.json` |
| `receipts.config.json:2` references `./receipts.config.schema.json`, which does not exist | — |
| `build.integration_branch` is `"main"` while `gates.G8.integration_branch` is `"integration"`, a branch that does not exist | `receipts.config.json:16,35` |
| The recorded mutation score 66.60 is against `1c5d082`, not HEAD — ten `src/` commits since | ledger decision `01M0XS7XBNJ4FTGWFBEGPWGYV8` |
| `continuity-ledger.md`'s prose "The twelve tools… These are all of them" is not a censused code span and would go false silently | `continuity-rule-census.test.ts:11` |

### Executing this

Not through `mitosis` — directed. Each unit is dispatched to an implementer by the orchestrator.

## 4. The design

### 4.1 The field

```
criterion_id?: Ulid    // z.string().regex(ULID_PATTERN).optional()   — the RANKING key
scope: string          // unchanged, still required                   — the HUMAN annotation
```

`.optional()`, not `.nullable()`. Measured against the vendored zod: `.nullable()` still requires the key
to be **present**, so it REJECTS every legacy record and quarantines all 105 live items. Quarantine is
silent at every user-facing surface (invariant I3).

`scope` is **not** replaced. Record schemas use plain `z.object`, which **strips unknown keys**, so
removing `scope` would silently delete the 42 authored prose values on the next write — "shipped
regressions", "tooling", "MSP-9 dispatch". That is authored content, not extraneous material.

**Absence means unanchored.** No sentinel: `criterion_id` is typed as a ULID, so a sentinel needs a union,
which reintroduces the `anyOf` shape to populate a distinction no data supports.

> **GOVERNING INVARIANT.** A missing or wrong tag must never be able to hide an item.
> Unanchored items render in the **live** lane. Never the collapsed one.

The Decision **record** gains nothing. Anchoring there would force the renderer to load all 65 decision
records merely to rank them — reintroducing the exact eager load this repair removes.

### 4.2 The merge path changes nothing

`spine.open_risks` is already `'union-by-id'` (`field-merge.ts:30`), `spine.key_decisions` at `:31`.
`unionByIdWithConflict` (`:120-144`) compares whole elements with `isDeepStrictEqual` at `:135`, so a
`criterion_id` divergence on one element id already becomes a conflict carrying the whole element.
`THREAD_RULES` (`:16-33`) has no vocabulary for element fields at all — `Risk.text` and
`KeyDecision.title` are absent from it too — and its guarding census (`test/unit/field-merge.test.ts:326-346`)
walks only to depth 2.

**Rejected:** a `riskContent` projection copying the `criterionContent` precedent at `:146-153`. It would
suppress a real signal in the one case where divergence means something.

`resolve_conflict.ts` needs nothing structurally: it validates through `ThreadRecord.parse` (`:601`) and
its indexed-field pattern (`:28`) already matches `open_risks[<ULID>]`.

**The one real gap is write-time.** `update_thread.risks_add` accepts caller-supplied content with no
cross-check against `completion_criteria`. An existence check lands near `update_thread.ts:188`, modelled
on the `decision_id` check already at `:201-207`.

Reference direction is safe: criteria are **never deleted**, only struck and retained forever
(`src/domain/criteria.ts:74-81,227-229`; all 7 write sites enumerated). Risks **are** deleted
(`update_thread.ts:186`), so Risk→Criterion is the safe direction.

### 4.3 The renderer loses access to the bodies

`renderBriefing`'s third parameter changes from `Decision[]` to:

```
{ resolved: number, dangling: string[], quarantined: string[] }
```

Commit `0b736d5` could reinline bodies because the renderer **had** them. Taking the payload out of its
reach makes the regression **structurally unrepeatable** rather than merely forbidden. The resolution
loop stays in `resume_thread.ts:63-74` — it costs server-side I/O, not tokens, and it is the only
dangling/quarantine detector — but its output no longer reaches the renderer. Those counts surface in the
briefing instead of only reaching a log.

### 4.4 Two surfaces

| Surface | Renderer | Bound |
|---|---|---|
| `resume_thread` | `renderBriefing` — ranked, laned, bounded | `BRIEFING_MAX_CHARS` |
| `logbook://thread/{id}` | `renderThreadDetail` — complete, ids on everything | the record's own 65,536-byte cap |

Both are body-free. The detail surface is **pull**: the reader asks for it.

This one split gives risks a read path, gives criterion ids a read path, and lets the NOT SHOWN tail name
**one** address rather than three. **Rejected:** a `list_risks` tool, which breaks the continuity rule's
explicit "The twelve tools. These are all of them." **Rejected:** a `logbook://risks/{id}` resource, which
adds a third address to solve what splitting the existing one solves free.

It also repairs a live break: `update_thread.criteria_done` and `risks_retire` both **demand** ULIDs
(`update_thread.ts:35-38,68-71`), while `open_thread` (`:157`) and `amend_criteria` (`:106`) return them
at mint time only. Nothing returns them afterwards. A session that *resumes* a thread cannot use two of
the twelve tools correctly today.

### 4.5 Lanes

Ranked, not filtered. Derived from the only lifecycle signal the data carries — the anchored criterion's
state.

| Lane | Contains | Rendered as | Cap |
|---|---|---|---|
| **A — current** | `criterion_id` = the current criterion | in full | 8 risks / 10 titles |
| **B — live + unanchored** | other un-struck un-done criteria, **or no `criterion_id`** | in full | 4 risks / 5 titles |
| **C — settled** | `criterion_id` names a done or struck criterion | **count + the address that expands it** | — |

Ids: **shown** items print theirs (`risks_retire` and `criteria_done` both require one). **Collapsed**
lanes print a count and an address, never 40 ids — printing a 26-char ULID on all 105 items costs ~2,730
characters. Criteria always print theirs; there are 7.

### 4.6 The budget

```
BRIEFING_MAX_CHARS       = 12000    // the rendered string
RESUME_PAYLOAD_MAX_BYTES = 24000    // the serialized CallToolResult
```

The prior spec's 3,000 is **unreachable at today's caps** and this spec says so rather than quietly
missing it. Measured guaranteed core on the live thread, before a single risk renders: spine scalars
1,284 + seven criteria with ids ~1,900 + out-of-scope 567 + header ~200 = **~3,950**. Meeting 3,000 would
mean truncating the situation, which is the one thing the position evidence supports front-loading.

Built up: core 3,950 + Lane A risks (8x342) + Lane B risks (4x342) + Lane A titles (10x120) + Lane B
titles (5x120) + tails ≈ 10,600. 12,000 is the smallest round ceiling with headroom. **Ruled by the
human.** It is a worst-case ceiling, not a target: a typical thread renders well below it.

12,000 chars ≈ 3,000 tokens against today's ≈28,000. A **91% reduction**.

The payload number exists because `toolOk` (`errors.ts:39-42`) emits the briefing as both `content[0].text`
and `structuredContent` — measured 2.01x. Predecessor decision `0022` holds that *a filtered string
shipped alongside an unfiltered object is not a reduction*; asserting only the string would measure a
different quantity than the baseline. **That rule is re-ratified here as live**, not inherited.

### 4.7 Enforcement: rank, emit in priority order, truncate the tail

A **guaranteed core** (header, status, goal, next step, criteria) always renders. The **discretionary
remainder** shares `12000 − core` by lane priority. A **mandatory NOT SHOWN tail** names what was cut and
the address that retrieves it.

**Rejected:** refusing to render over budget — the briefing is the primary read path and refusing leaves
the reader with nothing. **Rejected:** collapsing until it fits — non-deterministic, and can collapse the
situation itself. Nothing vanishes silently.

### 4.8 Constraints the rewrite must respect

| Constraint | Source |
|---|---|
| Every interpolated stored value wrapped in `escapeStored`, statically resolvable | `test/contract/render-census.test.ts:371-375,405-410` |
| **Exactly one** rendered line may carry the thread title | `test/spawn/forgery.test.ts:344-348` |
| Sections omitted entirely when empty, never an empty heading | prior spec `:186-187` |
| Every new schema node carries a `.describe()` of ≥10 characters | `test/contract/described.test.ts:13,55-62` |
| A `PUBLISHED_CLAIMS` entry if a new field is named in a tool description | `test/support/published.ts:63-154` |

## 5. Invariants

- **I1 — green branch.** Every unit leaves `main` working on merge. A unit that breaks the trunk is not
  a unit.
- **I2 — red on parent.** Every unit ships a test red on its parent commit and green on the fix,
  asserting the **reported symptom or the budget**, never the rendered string. Five existing tests freeze
  the defect as correct; a string assertion would re-freeze the new output.
- **I3 — no quarantine.** No schema change may reject an existing record.
- **I4 — acceptance is a ceiling.** Discoveries above it are filed, not folded in.
- **I5 — nothing hidden silently.** Every omission carries a count and a retrieval address.
- **I6 — no npm install.** `node_modules` is tracked; `yaml` is vendored by hand. `npm install` rewrites
  tracked files and prunes it.
- **I7 — mutation scope.** `stryker` mutates `src/render/**` at break threshold 70 and its runner
  executes only `test/unit/**` and `test/store/**`. Renderer tests live in `test/unit/`.

## 6. Rulings

### 6.1 Budget — 12,000 characters
Human-ruled against architect's measurement that 3,000 is unreachable. Tightening the storage caps to
reach 3,000 is a separate change to the storage contract with its own migration; it does not gate this.

### 6.2 Single clone
Human-confirmed: this repository lives on one machine. That removes the backfill's only real hazard —
same-id divergence needs two machines. It also means the ordinal bomb will not fire unprompted, but it
still fires permanently the first time a merge happens.

### 6.3 The backfill ships, last
Human-ruled. It anchors 63 of 105 items; the other 42 name no criterion and stay unanchored. It is
**provably correct today and unverifiable after the first merge**. Its acceptance test asserts the mapping
against the criteria list **as it stands at that commit**, never against a reconstruction.

### 6.4 Robust and simple over black-box and complex
**No relevance-scoring function.** The recency × importance × relevance formula that would be the obvious
reach had its recency term never ablated in the paper that popularised it, and a score produces a
different briefing tomorrow for reasons nobody can reconstruct. Ranking is a **stable sort on facts
already in the record**. Every design element must be explainable in one sentence to someone who has
never seen this codebase.

## 7. The units

Full ladder, dependency order. Wave assignment is in the PLAN, hardened against the file-collision matrix.

| # | Unit | Wave | Red-on-parent test asserts | Schema? |
|---|---|---|---|---|
| **U1** | Stop inlining decision bodies — **both twins** | W1 | a linked decision's `outcome` sentinel is **absent** from the briefing | no |
| **U2** | Split `logbook://thread/{id}` into `renderThreadDetail` | W2 ‖ | the thread resource contains **every** risk id and criterion id | no |
| **U3** | The `criterion_id` field | W2 ‖ | `ThreadRecord.parse` **returns** the field where today `z.object` strips it | **yes** |
| **U4** | Prove the field survives merge and conflicts on divergence | W3 ‖ | divergence on one element's `criterion_id` yields a conflict carrying the whole element | no |
| **U5** | Writers accept it; existence check closes the dangling path | W3 ‖ | `risks_add` with a `criterion_id` naming no criterion is **refused, naming the field** | no |
| **U6** | Renderer: budget, lanes, truncated tail | W4 | the largest schema-admissible thread renders within `BRIEFING_MAX_CHARS`; a **done**-criterion risk collapses while an **unanchored** one renders in full | no |
| **U7** | Backfill `scope` prose onto `criterion_id` | W5 | a legacy link with `scope: "criterion 2"` gains the **correct** ULID | no |

**U1 first** — 79% of the win, zero schema risk, and measured to need no renderer change.
**U2 before U6** — truncating without a read path destroys rather than defers.
**U3 gates U4, U5 and U6** — the field must exist before any of them can be red.
**U6 ships budget and lanes together** — splitting means rewriting the same five pinning test files twice.
**U7 last**, and its correctness expires at the first merge.

**Version policy: no unit bumps.** One release commit closes the ladder at `1.2.0` and repairs the stale
lockfile. Two branches bumping identically merge clean and land a rung short — measured, and invisible to
`cutover-manifests-agree`, which guards intra-commit agreement, never monotonic advance.

**`blocked_by` is guaranteed core and may never be truncated.** `test/spawn/forgery.test.ts:377-390`
asserts a hostile value reaches the client present and escaped on *both* surfaces; dropping the line turns
it red.

## 8. Known risks

| Risk | What makes it real |
|---|---|
| The backfill window closes at the first merge | 62 of 63 tags rewrite at once; correct today, unverifiable after |
| Old clients silently strip the field | `z.object` strips unknown keys (measured). An older install drops `criterion_id` permanently on its next write. No mitigation short of a version marker |
| Merge output is never schema-validated | `sync.ts:342` performs no parse. Any invariant on the new field is enforced on the tool path and unenforced on the merge path |
| The test rewrite drops the mutation score | `test/unit/briefing.test.ts:127-149,155-170` are two whole-document `assert.equal`s carrying the renderer's entire mutation defence. Weaker replacements fail break-70 |

## 9. Verification

Governed by `receipts/gates@1.1`. Acceptance is a ceiling declared before work starts. A gate that cannot
be cleared produces a tracked status — `fixed`, `unverified-reasoned`, `speculative`, `reverted` — never
another review round and never a silent pass.

CI here triggers on `pull_request` only and has never run against the trunk, so a green PR check is
GitHub's computed merge-with-base, not the merge commit that lands. **Every merge is verified by hand on
the merge commit**, and by ancestry plus tree identity rather than by a MERGED status.
