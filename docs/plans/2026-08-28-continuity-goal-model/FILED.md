# Filed, not fixed — discovered during planning

Items found above a unit's acceptance ceiling. Each carries its evidence and the unit whose
planning surfaced it. Nothing here is folded into a plan.

An item in this file has been established by exactly one planner against the tree it read. The
absence of a second confirmation is not evidence that the item is wrong, and the presence of an
item is not evidence that it has been checked by anyone else.

Appends only. Never edit an item another planner wrote.

## F3a — The goal-model specification is not on `main`, and U3's receipt cannot run without it

- **Surfaced by:** U3 planning
- **Evidence:** `git diff --stat main...HEAD` prints `docs/specs/2026-08-28-continuity-goal-model.md | 497 +++++++++++++++++++++`, an addition on `docs/continuity-goal-model-spec`. The file therefore does not exist at `main`'s tip `e5f0195`. U3's census test derives its promise population from that exact path; on a branch cut from `e5f0195` it throws `ENOENT` and cannot run at all.
- **Why it is above the ceiling:** U3's ceiling is criteria 1-7 in `U3-promises.md` section 1, all of which concern `README.md` and the test that censuses it. Landing the documentation branch on `main` is a merge-ordering act no unit owns and no planner may perform. U3's plan routes around it with stop condition 2 rather than folding it in.
- **Not folded in.**

## F3b — The SPEC's section 8 gives `B36` the goal `LG16`, but its section 11.1 maps `LG16` to `B42` alone

- **Surfaced by:** U3 planning
- **Evidence:** `docs/specs/2026-08-28-continuity-goal-model.md:383` reads `| **B36** | `README.md` carries `LG1`-`LG17` ... | LG10, LG15, LG16 |`. Line 470 of the same file reads `` `LG16` -> B42 `` with no mention of `B36`. The two coverage statements disagree about whether `B36` discharges `LG16`.
- **Why it is above the ceiling:** U3's ceiling is built from `B36`'s own text and its `Green` cell, both of which are unambiguous and neither of which changes under either reading. Reconciling two coverage tables inside a frozen specification is an edit to the SPEC, which `OR0` and `OR9` forbid every planner.
- **Not folded in.**

## F0a — A third store race loses a record on the ordinary success path, and seals the loss permanently

- **Surfaced by:** U0 planning
- **Evidence:** `test/spawn/decisions.test.ts:797` reads `test('concurrent.distinct-ids', async () => {`, and line 819 hardcodes `    const CHILD_COUNT = 8`. The three sites `OR18` names were read at the exact lines it cites: `src/store/write-path.ts:149-160` is `const writeTargetsToDisk = ...` looping only `for (const { change, target } of targets)`, so it writes only its own call's record files; `src/store/records.ts:171` is `        markMaterialised(storeLayout, result.after)`, stamping the store at the whole new ref; `src/store/read-path.ts:204` is `  if (currentValue === cached) return { ok: true, materialised: false }`, which short-circuits forever once the stamp equals the ref. `OR18` records the reproduction as 46 of 60 iterations at 24 concurrent children, and the CI rate as 3 failures in 60 pooled `test` job runs across the last 20 workflow runs.
- **Why it is above the ceiling:** `OR18` scope item 3 states U0's scope is "Nothing else. Not the store defect". The SPEC's section 10 accepted two named races as worded (`01M13F4HW3YQWJSF7T4GM47GP8` and `01M13F4HW3552M57R3SZ4B5V5P`), and both require a retry or a mid-swap `mkdirSync`; this one needs neither. Folding it into U0 would fix a defect the SPEC never scoped, in a unit whose entire diff is a CI trigger.
- **Not folded in.**

## F0b — `main` has no required status checks, so trunk CI observes and blocks nothing

- **Surfaced by:** U0 planning
- **Evidence:** `docs/plans/2026-08-28-continuity-goal-model/ORCHESTRATOR-RULINGS.md:468-470` records, as a measured fact, that `gh api repos/:owner/:repo/branches/main/protection` returns `404 Branch not protected` and that `.../rulesets` and `.../rules/branches/main` both return `[]`, and states "These are positive answers, not access failures. Nothing is a required status check." This planner did not re-run those calls; the citation is to the ruling line personally read, not to a command personally run.
- **Why it is above the ceiling:** `OR18` ruling 5 states that adding branch protection "is a repository-administration act, not a plan step, and no unit performs it." U0's criteria 1 and 2 are satisfied by a workflow trigger and a job condition; neither can make a check required. U0's plan states plainly in its own body that the check it adds blocks nothing.
- **Not folded in.**

## F0c — `receipts.yml` pins its actions to mutable tags while `rebuild.yml` pins full commit shas

- **Surfaced by:** U0 planning
- **Evidence:** `.github/workflows/receipts.yml` uses `      - uses: actions/checkout@v4` and `      - uses: actions/setup-node@v4` in both of its jobs. `.github/workflows/rebuild.yml:13` uses `      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5` and `:16` uses `      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`. A `v4` tag is mutable and can be repointed by its owner at any commit; a 40-character sha cannot. The two workflow files in one repository therefore apply different supply-chain postures to the same two actions.
- **Why it is above the ceiling:** `OR18` ruling 1 keeps `receipts.yml` out of U0 entirely, and `OR18` scope item 3 is "Nothing else". U0's acceptance criterion 4 requires that file to be left unedited. The existing `workflow-hardening.checkout-credentials` census reads only the `with:` block of a checkout step and does not classify the action reference, so nothing currently fails on this.
- **Not folded in.**

## F10a — `escapeStored` is not injective, so no total inverse can exist for it

- **Surfaced by:** U10 planning
- **Evidence:** `src/render/escape.ts:39-82` (`escapeStored`) and `test/unit/escape.test.ts:81`
  (`escape.stored-is-idempotent-over-the-escapable-and-markdown-leading-population`). An idempotent
  map that is not the identity cannot be injective: `f(f(x)) = f(x)` plus injectivity forces
  `f(x) = x`. Measured against the shipped module on Node `v26.4.0` / Unicode 17.0:
  `escapeStored('\n')` returns `'U+000A'` and `escapeStored('U+000A')` also returns `'U+000A'`, so
  two distinct inputs share one stored form. The same holds for all 263 code points the encoder can
  emit a token for. Consequence: a value whose raw text already contains `U+` followed by the
  canonical hex of an emitted code point does not survive escape-then-unescape.
  `POINTER_PATTERN` in orchestrator ruling `OR15` refuses the literal text `U+000A` and `U+000D`,
  which closes 2 of those 263 cases and only on `pointer`-class fields.
- **Why it is above the ceiling:** U10's ceiling is `B43` — an inverse plus a round-trip census over
  the escaped character set. That census passes: all 263 transforms are individually reversible
  (1315 samples, 0 irreversible). Non-injectivity is a property of the encoding scheme, not of any
  transform in the escaped set, and removing it means abandoning idempotency, which six modules
  outside U10's ownership rely on when they re-escape already-stored text.
- **Not folded in.**

## F10b — the write path escapes before storing, which is the deeper cause of `D12`

- **Surfaced by:** U10 planning
- **Evidence:** `escapeStored` is called on caller-supplied text before the value is committed in ten
  modules: `src/domain/spine.ts:188-207`, `src/domain/criteria.ts:144,190`,
  `src/server/tools/open_thread.ts:99,104`, `record_decision.ts:156-178`, `park_thread.ts:247`,
  `update_thread.ts:254`, `log_session_event.ts:84,89`, `close_thread.ts:92`,
  `bind_branch.ts:78`, `resolve_conflict.ts:343-382`. The renderer escapes again at read time
  (`src/render/briefing.ts:68`, `src/render/roster.ts:67`, `src/server/resource-render.ts:18`), so
  the write-time pass buys no rendering safety that the read-time pass does not already provide.
- **Why it is above the ceiling:** `LG5` is fully discharged only when the stored bytes equal the
  supplied bytes. That means moving escaping off the write path entirely, which changes ten modules
  U10 does not own and which SPEC section 9 assigns to U4, U8 and U9. `B43` asks for the inverse,
  not for the relocation.
- **Not folded in.**

## F1a — a key decision may name a criterion that does not exist on the thread

- **Surfaced by:** U1 planning
- **Evidence:** `src/server/tools/update_thread.ts:208-215` validates `criterion_id` on every risk in
  `risks_add` and refuses a dangling one via `danglingRiskCriterionRefusal`. The sibling block at
  `src/server/tools/update_thread.ts:223-228` builds `newKeyDecisions` and copies only
  `decision_id`, `title` and `scope` — it neither carries `criterion_id` through nor validates it.
  The schema field exists and parses (`src/schema/thread.ts:81`).
- **Why it is above the ceiling:** U1's ceiling is the schema. SPEC rule `B1` names
  `src/server/tools/update_thread.ts:209-215` as the refusal shape to reuse, and that file is owned
  by U4 in wave 2. Invariant `A2` is shared across U1, U4 and U9; this is the U4 share.
- **Not folded in.**

## F1b — a binding record reaches the ledger ref without passing the store's own validator

- **Surfaced by:** U1 planning
- **Evidence:** `src/server/tools/bind_branch.ts:104` commits a binding as
  `{ kind: 'raw', relPath: …, content: JSON.stringify(validated.value) }`. `RecordChange`
  (`src/store/write-path.ts:13-17`) has no `binding` member, and `validateChange`
  (`src/store/records.ts:34`) returns `null` immediately for `kind === 'raw'`. `bind_branch` does
  parse the record itself first (`src/server/tools/bind_branch.ts:100-103`), so the shipped path is
  validated; any future writer of a raw binding blob would not be.
- **Why it is above the ceiling:** U1's invariant `A5` is a Job-A invariant whose enforcer the SPEC
  fixes as the tool (SPEC section 6.2), and the tool already parses. Closing the store-level gap
  needs `src/store/write-path.ts` and `src/server/tools/bind_branch.ts`, which the tree does not
  require in order to typecheck or pass, so `OR11` does not permit U1 to reach them. It overlaps the
  surface `B40` opens in U2.
- **Not folded in.**

## F1c — `OPEN_RISKS_MAX_ELEMENTS` is now named for something wider than it bounds

- **Surfaced by:** U1 planning
- **Evidence:** after U1, the constant's only remaining uses are
  `src/server/tools/update_thread.ts:71` and `:76`, where it bounds one call's `risks_add` and
  `risks_retire` payload. It no longer bounds the stored `spine.open_risks` collection: U1 removes
  that use from `src/schema/thread.ts:93` and from `src/domain/spine.ts:28`. A name that says
  `OPEN_RISKS` for a per-call batch bound will be read as an accumulation cap by the next reader.
- **Why it is above the ceiling:** renaming it requires editing
  `src/server/tools/update_thread.ts`, which SPEC section 9 assigns to U4 in wave 2. U4 is already
  editing that file. Suggested name: `RISKS_PER_CALL_MAX_ELEMENTS`.
- **Not folded in.**

## F10c — correction to F10a's module count

- **Surfaced by:** U10 planning, during the conformance audit of the U10 plan
- **Evidence:** `F10a` above says "six modules outside U10's ownership" re-escape already-stored text. The measured number is **ten**, each verified by reading the call site: `src/render/briefing.ts:68`, `src/render/roster.ts:67`, `src/server/resource-render.ts:18`, `src/server/resources.ts:52`, `src/server/prompts.ts:22`, `src/cli/session-start.ts:24`, `src/domain/lifecycle.ts:9`, `src/domain/spine.ts:188-207`, `src/schema/refusal.ts:37`, `src/server/tools/resolve_conflict.ts:343-382`. Filed items are append-only, so `F10a` is corrected here rather than edited.
- **Why it is above the ceiling:** it corrects the record of an item that is itself above the ceiling. `F10a`'s conclusion is unchanged — the count only strengthens it.
- **Not folded in.**

## F6a — a third private copy of the schema flattener ships in `test/unit/field-class.test.ts`

- **Surfaced by:** U6 planning
- **Evidence:** `docs/plans/2026-08-28-continuity-goal-model/U1-schema-foundations.md:1626` gives
  `test/unit/field-class.test.ts` its own `const flattenSchemaNodes = (value: unknown, path: string): SchemaNode[] => {`,
  byte-identical in behaviour to the one at `test/contract/described.test.ts:20-46`. `OR15` rules
  that U6 lifts that function into `test/support/schema-nodes.ts` "so both tests import one copy";
  the third copy did not exist when `OR15` was written.
- **Why it is above the ceiling:** U6's acceptance criterion for the lift names exactly two importers,
  `test/contract/described.test.ts` and U6's own census. Converting a test file that U1-B ships is an
  edit to another unit's shipped artifact and is not required for any U6 criterion.
- **Not folded in.**

## F6b — the thread resource reads every binding record in the store to render one thread's bindings

- **Surfaced by:** U6 planning
- **Evidence:** there is no per-thread binding index. `src/server/tools/bind_branch.ts:80` already
  scans the whole directory the same way: `const existingSlots = readAllRecordFiles<Binding>(bindingsDir, BindingRecord)`.
  `B27` gives the thread resource the same scan, so the cost of reading one thread record grows with
  the total number of bindings ever written, including bindings for terminal threads.
- **Why it is above the ceiling:** `B27` mandates that bindings render, and U6's acceptance criteria
  assert that they do. Read cost is `LG13`, discharged by `B37`, `B38` and `B39`, which are U2's.
- **Not folded in.**

## F6c — two clip markers will exist, one in `src/render/` and one in `src/server/resource-render.ts`

- **Surfaced by:** U6 planning
- **Evidence:** `src/render/briefing.ts:65-66` already carries `TEXT_CLIPPED_BULLET`, and SPEC rule
  `B24` says "The clip-marker helper is extracted so every surface shares one implementation" — that
  extraction lands in `src/render/`, which U5 owns. The sessions listing U6 adds clips each entry's
  first line and therefore needs a marker of its own before that helper exists.
- **Why it is above the ceiling:** U6 may not edit `src/render/`; converging the two markers is a
  change to a file U5 owns and is not named by `B25`, `B26`, `B27` or `B28`.
- **Not folded in.**

## F6d — the sessions listing inherits the `U+000A` escape collision when it takes a first line

- **Surfaced by:** U6 planning
- **Evidence:** `src/server/tools/log_session_event.ts:89` stores `escapeStored(input.body)`, and
  `src/render/escape.ts:39-82` rewrites every line break to the literal text `U+000A`, so a stored
  body contains no raw line break. The sessions listing therefore splits on the literal token
  `U+000A` to find a first line. `OR22` records that `escapeStored('U+000A')` and
  `escapeStored('\n')` both return `'U+000A'`, so a body whose raw text already contained the
  characters `U+000A` splits at a place the author never wrote a line break.
- **Why it is above the ceiling:** the collision is `LG5`, discharged by `B43` in U10 and by the
  new-criterion work `OR22` names `F10b`. `B25` asks for a first line, not for an injective encoding.
- **Not folded in.**

## F6e — `resources/list` becomes a sixth model-facing surface the forgery census does not cover

- **Surfaced by:** U6 planning
- **Evidence:** `test/spawn/forgery.test.ts:228-234` declares its population as exactly five surfaces:
  `type Surfaces = { briefingTool: string; briefingResource: string; rosterTool: string; rosterResource: string; sessionStartRoster: string }`.
  `B28` gives the thread resource template a `list` callback, and the entries it returns carry the
  thread's title and slug into `resources/list`, which the model reads. Every such value passes
  through `escapeStored`, which `test/contract/render-census.test.ts` proves for
  `src/server/resources.ts`, so the defence is present; the forgery test does not assert it on this
  surface.
- **Why it is above the ceiling:** widening the forgery population is not named by `B25`, `B26`,
  `B27` or `B28`, and it is not a clause of U6's `Green` cell.
- **Not folded in.**

## F2a — after `B37`, the store-open path's remaining cost is one git subprocess, and it dominates everything else

- **Surfaced by:** U2 planning
- **Evidence:** measured by loading the parent's and the change's `openStore` into one process and alternating, median of 31 repetitions, Node v26.4.0. Warm store open: 6.51 ms at 200 records and 6.61 ms at 800 on the parent; 6.66 ms and 6.82 ms after the change. The directory walk `B37` removes, measured in isolation over 21 repetitions, is 0.131 ms at 200 records and 5.289 ms at 12 800. The remainder is the single `git rev-parse refs/logbook/ledger` that `syncWorkingCopy` performs at `src/store/read-path.ts:200` on every open, at roughly 6.5 ms per call on this machine.
- **Why it is above the ceiling:** U2's acceptance criteria 1 and 2 require that the open path stop reading every record, which the change does — the entries examined go from N+4 to a constant 5. Removing the `rev-parse` itself would mean caching or otherwise avoiding the ref read, which is the stamp-versus-ref comparison the SPEC's `B37` explicitly keeps as the thing that stands in for the walk. It is a different change against a different rule.
- **Not folded in.**

## F2b — the widened duplicate-store guard costs ~4 ms per store open when the plugin-data root sits in a large directory

- **Surfaced by:** U2 planning
- **Evidence:** same paired measurement as F2a. With the plugin-data root placed directly inside a directory holding 1 175 sibling directories, warm store open goes from 6.51 ms to 10.61 ms at 200 records and 6.61 ms to 10.13 ms at 800. With the plugin-data root placed inside a directory holding one sibling, it goes from 6.69 ms to 6.66 ms and from 6.94 ms to 6.82 ms — no measurable cost. On this machine's real installed layout the parent holds 23 sibling directories and the scan measures 0.06 ms.
- **Why it is above the ceiling:** U2's criteria 1 through 5 require the guard to detect the cross-root duplicate, which it does. Removing the residual cost means caching the negative result for the lifetime of the process, which was considered and rejected inside the plan because it would let a duplicate appearing while a server runs go undetected until restart. Trading a safety guard for four milliseconds is a decision, not an optimisation, and belongs to whoever owns that guard's contract.
- **Not folded in.**

## F2c — every store test fixture places `CLAUDE_PLUGIN_DATA` directly inside the system temporary directory

- **Surfaced by:** U2 planning
- **Evidence:** `test/store/read-path.test.ts:23`, `test/store/materialisation.test.ts:23`, `test/store/roster.test.ts:19-20` and `test/store/single-store.test.ts:21` all build the plugin-data root with `mkdtempSync(join(tmpdir(), '...'))`. On this machine `tmpdir()` holds 1 202 entries, of which 1 175 are directories. Any check that reasons about the plugin-data root's *parent* therefore sees a junk drawer in tests and a small, curated directory in an install — a 1 175-to-23 difference that makes suite timing depend on how full the developer's temporary directory happens to be.
- **Why it is above the ceiling:** U2's criteria say nothing about fixture layout, and correcting it means editing four test files that U2 does not otherwise touch. One line each — nest the plugin-data root one directory deeper — would make the fixtures resemble an install and remove the machine-dependent timing.
- **Not folded in.**

## F2d — the shared git helper reads command output through `spawnSync`'s default 1 MiB buffer, with no `maxBuffer` set

- **Surfaced by:** U2 planning
- **Evidence:** `src/store/git.ts:68-72` calls `spawnSync('git', [...], { env, encoding: 'utf8', ...input })` and never sets `maxBuffer`, so Node's 1 MiB default applies. Any git command whose standard output exceeds that is truncated and the call reports an error. Commands on the current read path that scale with stored history include `git ls-tree -r --full-tree` over the whole ledger; `git cat-file --batch`, the obvious batching alternative to the per-blob loop, would have put the entire store's contents through that same buffer, which is one reason U2's plan writes the tree out with `git checkout-index` instead of reading it through standard output.
- **Why it is above the ceiling:** U2's criteria concern the number of subprocesses materialisation spawns, not the buffer the shared helper reads them through. Changing it means editing `src/store/git.ts`, which SPEC section 9 assigns to no unit in this ladder.
- **Not folded in.**

## F5a — the roster drops every terminal thread with no count and no address

- **Surfaced by:** U5 planning
- **Evidence:** `src/render/roster.ts:19-28` — `const TERMINAL_STATUSES = new Set<Thread['status']>(['done', 'abandoned'])`
  and `selectRosterThreads` filters those threads out before `paginateRoster` computes `total`, so
  `renderRoster`'s header `Roster: N of M resumable threads.` counts only the survivors. A person
  reading the roster is not told how many threads were excluded, and no address in the output resolves
  to them. `O2` reads "For every item omitted by any display rule — cap, lane or **relevance** — the
  output carries a count of what was omitted and an address that resolves to it", and this is a
  relevance rule.
- **Why it is above the ceiling:** U5's `Carries` cell is `B16`-`B22` and `B24`, every one of which is
  a rule about `src/render/briefing.ts`. No behavioural rule in this SPEC touches the roster's
  terminal-thread exclusion, and closing it needs a way to address terminal threads that
  `list_threads` does not currently offer. It also collides directly with `LG14` ("what Logbook loads
  is bounded by open work") and would need its own decision.
- **Not folded in.**

## F5b — `backfillCriterionIds` infers a goal attachment from a scope string and has no production caller

- **Surfaced by:** U5 planning
- **Evidence:** `src/domain/criterion-backfill.ts:11` — `const criterion = criteria.find((candidate) => candidate.ordinal === ordinal)`.
  It parses a scope string of the form `criterion N` and resolves `N` against a criterion's position,
  then writes the resulting id into `Risk.criterion_id` and `KeyDecision.criterion_id`. That is a read
  of `Criterion.ordinal` that is neither a display label nor a display sort, which `S3` forbids, and
  it manufactures an attachment the caller never supplied, which `LG3` forbids. Measured with
  `grep -rn "backfillCriterionIds\|criterionIdForScope" src/ test/`: the only references outside the
  module itself are in `test/unit/criterion-backfill.test.ts`. No production code path calls it.
- **Why it is above the ceiling:** the file is `src/domain/`, which U5 does not own, and no `B#` in
  U5's `Carries` cell names it. U5's `S3` census is therefore scoped to `src/render` and records this
  read as out of scope. A separate read at `src/server/tools/record_decision.ts:57,60` is already
  covered by `B12` in a later unit; this one is covered by nothing.
- **Not folded in.**

## F5c — with the display caps gone, a near-maximal thread returns a reply more than twice its declared byte budget

- **Surfaced by:** U5 planning
- **Evidence:** measured by rendering the suite's own record-byte-maximal fixture
  (`test/unit/briefing.test.ts`, `decisionRecordSizedThread`, 65528 stored bytes) against the changed
  renderer: `passes 10 chars 26834 bytes 55130 withinBudget false`, against
  `BRIEFING_MAX_CHARS = 12000` and `RESUME_PAYLOAD_MAX_BYTES = 24000`. Across the 733-record frontier
  sweep, 227 records exceed a cap. Every one of them reports `withinBudget: false` and
  `src/server/tools/resume_thread.ts:95-102` logs `briefing.budget-exceeded`, so nothing is silent —
  but the reply is still returned at that size. The write-time limit the SPEC's section 10 names as
  the replacement was sized at 65536 bytes and left unchanged, so it does not bound this.
- **Why it is above the ceiling:** U5's criterion 2 is that the budget and its search are untouched,
  which `B16` states in its own words. Bounding the reply means either lowering
  `THREAD_RECORD_SERIALISED_MAX_BYTES` — a schema file another unit owns, already merged — or adding a
  bounded-growth display mechanism this SPEC does not specify. Hiding an item to fit is forbidden: it
  is the exact defect U5 exists to remove.
- **Not folded in.**

## F4a — the criteria-writers census identifies criterion text by property name, and admits any other leaf name

- **Surfaced by:** U4 planning
- **Evidence:** `test/contract/criteria-writers.test.ts:59-62` classifies as `forbidden` any free-text string property whose TOP-LEVEL argument name matches `/criteri/i` on a tool that also takes `thread_id`. Verbatim: `  if (!CRITERIA_DOMAIN_PATTERN.test(entry.topLevelName)) return 'allowed'` / `  if ('pattern' in node || 'enum' in node || 'const' in node) return 'allowed'` / `  return toolHasThreadId ? 'forbidden' : 'allowed'`. U4-B's new `criteria_done[].result` is exactly that shape and is not criterion text, so the census halts on it; U4-B answers the halt by teaching the classifier that a criterion's statement is the leaf named `text` or the bare array element. After that refinement a criteria-domain free-text leaf named anything else — a hypothetical `criteria_rewrite[].wording` — is classified `allowed` on a thread-bearing tool and would not be caught.
- **Why it is above the ceiling:** U4's acceptance ceiling covers `B8`, `B9`, `B10`, `B41`, `A3` and `A4`. Making the "only amend_criteria writes criterion text" census decide by something other than a property name is a new mechanism for an invariant no U4 rule carries.
- **Not folded in.**

## F4b — the whole-record byte-cap refusal names the heaviest field and the observed byte count

- **Surfaced by:** U4 planning
- **Evidence:** `src/server/tool-support.ts:90-100`, read at the tip of `main`. `overByteCapRefusal` calls `heaviestFieldOf(thread)` and emits `message: \`the thread record after this change is ${observed} bytes, over its cap of ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes; its largest field is ${heaviest.field} at ${heaviest.bytes} bytes; remedy: remove or shorten an entry in ${heaviest.field} and retry.\``. Any description of the whole-record cap as refusing "without naming which field overflowed and without naming the number" is wrong about the shipped code.
- **Why it is above the ceiling:** `A1` belongs to the schema unit, not to U4. U4 neither changes nor asserts this refusal; it only records what a caller sees when a `result` pushes a thread record over the cap.
- **Not folded in.**

## F4c — a required tool argument can ship undocumented without the published-claim census noticing

- **Surfaced by:** U4 planning
- **Evidence:** `test/support/published.ts:63-104` declares `PUBLISHED_CLAIMS` as a fixed map of description phrases to the arguments that back them, and `classifyPublishedClaim` (`:191-198`) only checks that each declared phrase appears in the description and that its named arguments exist. It never checks the other direction. U4-A adds a required `check` argument to `open_thread` and to `amend_criteria`, and U4-B adds two required sub-fields to `update_thread.criteria_done`; the whole suite stays green with no claim entry naming any of them. Observed: `npm test` reported `ℹ fail 0` on a throwaway tree carrying all of U4 with `PUBLISHED_CLAIMS` untouched.
- **Why it is above the ceiling:** no `B#` in U4 requires a claim entry, and closing the gap means changing the census to enumerate published arguments rather than published phrases — a change to a shared test-support module that no unit in this ladder owns.
- **Not folded in.**

## F7a — a sync that fast-forwards the ledger ref clears the Stop-hook presence verdict without this session recording anything

- **Surfaced by:** U7 planning
- **Evidence:** `src/merge/sync.ts:260-266` advances `refs/logbook/ledger` to the remote value and returns `action: 'fast-forwarded'`. The `B30` verdict this unit ships compares the ref sha against a per-session baseline, so any commit that reaches the ref clears it, including commits authored by another machine and merely fetched here.
- **Why it is above the ceiling:** `B30` names exactly one exclusion — "excluding commits authored by the post-tool-use hook" — and this unit closes that exclusion by deleting the writer (`B33`). A second exclusion for remote-origin commits is new material the SPEC does not mandate, and it needs its own decision about what "reached the ref" means when a shared remote is involved.
- **Not folded in.**

## F7b — the render census does not collect the session-start banner's own composition site

- **Surfaced by:** U7 planning
- **Evidence:** `test/contract/render-census.test.ts` censuses `src/cli/session-start.ts` (`:21`), but `arrayProducerElements` resolves only array literals, call expressions and identifiers (`:161-180`); `sections` initialises to a conditional expression (`src/cli/session-start.ts:60`), so `joinedElements` returns null and `sections.join('\n\n')` yields no site. Probe run on a pristine copy of `main` in the session scratchpad: replacing that line with `const sections = crashReport === null ? [listing, rt.cwd] : [crashReport, listing]` left `render.no-unescaped-site` GREEN (`✔ render.no-unescaped-site (494.48125ms)`), so an unescaped runtime value reaches the model through that surface unclassified.
- **Why it is above the ceiling:** U7's acceptance ceiling covers `B29`-`B34` and invariant `O3`. Widening a shipped census's expression resolver is neither, and it touches a contract test that no unit in this ladder owns.
- **Not folded in.**

## F7c — three copies of the same thread-record fixture across the test suite

- **Surfaced by:** U7 planning
- **Evidence:** `test/unit/session-start.test.ts:25-45` declares `makeThread`; U7 adds two more near-identical copies in `test/hooks/stop-gate-ledger-presence.test.ts` and `test/hooks/post-tool-use-writes-nothing.test.ts`. `test/support/` holds twelve shared helpers but none for a thread record.
- **Why it is above the ceiling:** extracting it is a refactor across test files this unit does not own, and `test/support/` is a shared surface several units in this ladder write into concurrently.
- **Not folded in.**

## F5d — correction to F5b: the backfill module does have a caller, and `S3` needs an owner for it

- **Surfaced by:** U5 planning, under `OR28`
- **Evidence:** `F5b` stated that `backfillCriterionIds` has "no production caller", from a grep over
  `src/` and `test/` only. Widening the sweep to `scripts/` finds one:
  `scripts/backfill-criterion-id.mjs:5` — `import { backfillCriterionIds } from '../src/domain/criterion-backfill.ts'`
  — and `:22` — `const migrated = backfillCriterionIds(parsedInput.value)`. That file is absent from
  `scripts/check-packaging.mjs`'s `REQUIRED_FILES`, so it is a repository-local migration tool rather
  than something the plugin ships, but it is a caller. `OR28` point 4 therefore applies and U5 does not
  delete the module.
- **Why it is above the ceiling:** the tree-wide `S3` census U5 now ships classifies three reads as
  forbidden — `src/server/tools/record_decision.ts:57` (two) and `src/domain/criterion-backfill.ts:11`.
  The first is removed by `B12` in a later unit. The second is removed by no unit, sits in
  `src/domain/`, and has a caller, so removing it means deciding what happens to that caller. Until
  that is owned, `S3` is partly undischarged after this ladder finishes, and U5 records that in its
  divergence 3.5 rather than narrowing its census.
- **Not folded in.**

## F8a — `last_session` is still written by hand after `B14`, by two other tools

- **Surfaced by:** U8 planning
- **Evidence:** `src/server/tools/update_thread.ts:54-58` publishes `last_session: z.string().max(caps.SPINE_LAST_SESSION_MAX).optional().describe('replaces the spine last_session field when supplied; omit to leave it unchanged')`, writes it at `:237` and reports it at `:243-246`. `src/server/tools/resolve_conflict.ts:399-400` rewrites the same field: `case 'spine.last_session': return { ...thread, spine: { ...thread.spine, last_session: value as string } }`.
- **Why it is above the ceiling:** SPEC `B14` names exactly one tool — "`park_thread` stops accepting `last_session`; it is derived (B23)". `src/server/tools/update_thread.ts` belongs to the declared-focus unit and `resolve_conflict.ts` belongs to no unit in this ladder. Closing `DG6` fully for this field means deciding what a repair path does when the field it repairs no longer has a hand-written writer, which is a new decision.
- **Not folded in.**

## F8b — the thread resource still renders the stored `last_session`, so the two surfaces disagree

- **Surfaced by:** U8 planning
- **Evidence:** `src/server/resource-render.ts:92` renders ``  `Last session: ${escapeStored(thread.spine.last_session)}`  ``. After U8 the briefing renders the previous session's log entries while the thread resource still renders the hand-written string, so one model-facing surface shows derived content and the other shows the legacy field, with nothing saying which is which.
- **Why it is above the ceiling:** SPEC section 9 gives U8 `src/render/briefing.ts` and `src/server/tools/park_thread.ts`. `src/server/resource-render.ts` is the discovery unit's file, and `B23` names only the briefing.
- **Not folded in.**

## F8c — a session entry carries no session identifier, so the session boundary is inferred rather than recorded

- **Surfaced by:** U8 planning
- **Evidence:** `src/schema/session.ts:9-15` declares `SessionEntry` as `{ id, thread_id, actor, body, created_at }` — no session id. The pointer is the only record that carries one (`pointer.session_id`), and `park_thread` releases it (`src/server/tools/park_thread.ts:301`). U8 therefore identifies "the previous session" as the run of entries after the last entry whose `actor` is `logbook:park_thread`. Consequence, measured by probe: an entry a session logs on a thread *before* it calls `resume_thread` is attributed to the previous session.
- **Why it is above the ceiling:** `B23` says only "derived from the previous session's log entries". Stamping a session id onto a session entry is a schema change to `src/schema/session.ts`, which belongs to the schema unit and has already shipped, and it would not repair the entries already written. It is also the "automatic capture of coordinates" the SPEC's section 3.3 records as opened and deliberately not taken.
- **Not folded in.**

## F8d — a session entry whose record failed to parse is dropped from the derived summary, uncounted and unaddressed

- **Surfaced by:** U8 planning
- **Evidence:** the derivation is fed from `store.readSessionEntries(thread.id)`, which returns `Slot<SessionEntry>[]` where a slot is `{ quarantined: true; path; reason }` or `{ quarantined: false; record }` (`src/store/read-path.ts:10-12`). U8 passes only the readable records, so a quarantined entry disappears from the `Last session` section with no count and no address, while the equivalent omission for a decision is counted by the line `- <n> linked decision records could not be read; their ids are listed under Decisions above`.
- **Why it is above the ceiling:** SPEC `B20` fixes the `Not shown` block at exactly two members — the text-clip marker, and dangling or quarantined decision ids — and the briefing unit shipped it that way. Adding a third member is new material, and `O2` speaks of items omitted by a display rule, which an unreadable record is not.
- **Not folded in.**
