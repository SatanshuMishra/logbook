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

## F9a — `S4`'s wording is false for `park_thread` under some argument sets, and a shipped test pins the opposite

- **Surfaced by:** U9 planning
- **Evidence:** `src/server/tools/park_thread.ts:370` returns
  `{ ok: false, refusal: otherSessionRefusal(pointer.thread_id) }` when a foreign session holds the
  pointer and an `outcome` was supplied. The shipped test
  `park.refuses-when-another-session-took-the-pointer` (`test/spawn/resume.test.ts:884`) pins that
  refusal. SPEC section 6.4 states `S4` as "Every write tool succeeds when no pointer exists and when
  a foreign session holds one", with no argument qualifier.
- **Why it is above the ceiling:** `S4` is U9's invariant, and U9 discharges it by driving each write
  tool with a recipe that carries no dependency on pointer state — for `park_thread` the no-argument
  call, which returns `ok` with `status: 'nothing-to-park'` and `status: 'not-the-worked-thread'` in
  the two states. Asserting the stronger reading would put two invariants on one event with different
  verdicts, which SPEC section 6.1 rule 2 forbids outright. Correcting `S4`'s wording is an edit to an
  approved and frozen SPEC, which `OR0` forbids a planner from making.
- **Not folded in.**

## F9b — a decision recorded with no scope renders as empty brackets on the thread resource

- **Surfaced by:** U9 planning
- **Evidence:** `src/server/resource-render.ts:50-51` renders every spine key decision as
  `` `- ${escapeStored(keyDecision.id)} -> ${escapeStored(keyDecision.decision_id)} [${escapeStored(keyDecision.scope)}] ${escapeStored(keyDecision.title)}` ``.
  `KeyDecision.scope` is a required string in the record schema (`src/schema/thread.ts`, the
  `KeyDecisionSchema` `scope` field, `content(z.string().max(caps.KEY_DECISION_SCOPE_MAX)...)`), with no
  `.min(1)`, so an absent scope is stored as the empty string and this line renders `[]`.
- **Why it is above the ceiling:** `B12` requires an omitted scope to be "stored absent and reported
  absent". U9 discharges the reporting half on the surface it owns — `record_decision`'s response
  reports `scope: null`. The thread resource is `src/server/resource-render.ts`, which SPEC section 9
  assigns to `U6`, and rendering `[]` instead of omitting the bracket pair is a display choice on
  another unit's surface, not a defect U9's acceptance list names.
- **Not folded in.**

## F9c — `U8-A` turns two shipped golden briefing tests red and does not update them

- **Surfaced by:** U9 planning, while reconstructing its own parent commit.
- **Evidence:** A tree carrying `main` plus `U1`, `U4`, `U5` and `U8`, built by applying those
  plans' own FIND/REPLACE blocks with zero mismatches, runs
  `node --test --experimental-strip-types test/unit/briefing.test.ts` and reports
  `tests 22, pass 20, fail 2, exit 1`. Both failures are golden whole-output assertions, and both
  differ from their expectation by exactly one line, which `actual` carries and `expected` does not:

      + '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead\n'

  `briefing.renders-exact-output-for-a-full-thread` fails at `test/unit/briefing.test.ts:209`;
  `briefing.omits-empty-list-sections-entirely` fails at `test/unit/briefing.test.ts:239`.

  The cause: `U8-A` renders that marker whenever the previous session contributed no log entries and
  the stored `spine.last_session` is non-empty. Both fixtures are pure renderer calls that pass no
  session entries and set `last_session` to a non-empty string, so both take the legacy branch.

  Ownership is the gap. `U5` creates and updates both tests — it names them at
  `U5-briefing-hides-nothing.md:382-383` and rewrites both at `:1006` and `:3648`. `U8`'s section 5
  lists only `test/unit/session-log.test.ts`, `test/unit/briefing-last-session.test.ts` and
  `test/spawn/resume.test.ts`; `grep -n "renders-exact-output\|omits-empty-list"` over
  `U8-derived-last-session.md` returns nothing.

- **Why it is above the ceiling:** the defect is in `U8-A`'s test list, and `U8` merges before `U9`
  is cut. `U9` cannot fix it without editing another unit's plan, which `OR9` forbids, or without
  editing tests that unit owns. It is not a reconstruction artefact: both plans applied cleanly and
  the other 20 tests in the file pass.
- **Consequence if unaddressed:** `U8-A`'s own `## 8. Full verification` runs `npm test` and will go
  red on two tests that are not `concurrent.distinct-ids`, so `OR19`'s stop condition halts its
  implementer. `U9`'s parent would then be a red trunk.
- **Not folded in.**

## F9d — `A6`'s census cannot see whether supplying an optional argument does anything

- **Surfaced by:** U9 planning, by running the invariant's own inertness mutation against it.
- **Evidence:** the census drives each optional argument twice on equivalent fresh fixtures — once
  omitted, once with a sentinel — and diffs the two results to derive where the argument lands. That
  shape detects a value the caller never supplied appearing when the argument is omitted, which is
  what `A6`'s "no code derives a substitute" clause forbids, and it produced a genuine red at the
  parent naming the fabricated value `criterion 1`. But the mutation that drops the WRITE of a
  newly-added optional argument, while leaving the argument published, left the census silent: both
  runs then land nothing, the derived landing-site set is empty, and there is nothing to classify.
  Measured directly — reverting `B11`'s `criterion_id` write turned no assertion in the census red,
  and only the dedicated behavioural test
  `decision.criterion_id-is-stored-on-the-key-decision-when-supplied` caught it.
- **Why it is above the ceiling:** `A6` as the SPEC states it covers omission only — "a call
  omitting it stores null and the response reports it absent. No code derives a substitute." The
  census discharges exactly that. Whether every published optional argument is also honoured when
  supplied is a second, wider property the SPEC does not state, and inventing it here would be
  promoting a finding into a verification mandate.
- **Consequence if unaddressed:** a future optional argument could ship published and inert, and
  this census would not notice. Today each such argument has its own behavioural test; nothing
  enforces that it must.
- **Not folded in.**

## F2e — The U2-A plan document still prescribes `git checkout-index` and rejects the mechanism the branch actually shipped

- **Surfaced by:** U2-A delivery
- **Evidence:** `docs/plans/2026-08-28-continuity-goal-model/U2-store-cost-and-safety-a.md` step 6 (`:370-452`), its inertness-mutation section 7.2 (`:895-903`) and its finding section 8.6 (`:1110-1132`) all describe materialisation as `git read-tree` loading the ledger tree into a private index followed by `git checkout-index -a` writing every file out of it — confirmed by reading all three ranges. The paragraph rejecting the alternative sits inside step 6 itself, at `:456`, not in section 8.5 as an earlier note located it; the text re-confirmed at that exact line reads: "Rejected: `git cat-file --batch`, one long-lived process fed every blob id on standard input. It is the smaller edit and needs no index file, but it returns the whole store's contents through the shared git helper's standard-output buffer, which `src/store/git.ts:68-72` leaves at Node's 1 MiB default; and its output frames each blob by BYTE length while that helper decodes to a string, so slicing the frames apart is wrong for any record containing a character outside ASCII. `checkout-index` writes to disk and never puts record content through a buffer at all." The branch that actually shipped, `perf/u2a-store-cost`, does the opposite in a new module: `src/store/materialise-tree.ts:159` calls `deps.runGit(rt, repo, ['ls-tree', '-r', '-z', '--full-tree', ref])` for the listing and `:172-173` calls `deps.runGitBuffer(rt, repo, ['cat-file', '--batch'], { stdin: batchInput })` for the contents — read directly on that branch, `checkout-index` does not appear anywhere in the shipped module. `checkout-index` writes a tree entry straight to the filesystem however the operating system interprets its mode; a git tree entry recorded with file mode `120000` is a symbolic link, a filesystem entry that points at a second path rather than holding data itself, and `checkout-index` would create a real one on disk. The shipped module instead refuses any such entry before writing anything: `validateEntries` at `src/store/materialise-tree.ts:58-64` rejects any tree entry whose mode is not the plain-file mode `100644` (`REQUIRED_TREE_ENTRY_MODE`, line 6), and the dedicated test `store.a-non-regular-tree-entry-is-refused` (`test/store/materialise-refuses-non-regular-entries.test.ts:65-106`) crafts a `120000` entry pointing at a real file, confirms `openStore` refuses it, and then confirms with `lstatSync(...).isSymbolicLink()` that no symbolic link was ever created on disk (`:91-102`). A decision id `01M1AZ7R8Q35SFNAB2HRERT5DZ` was supplied for the switch away from `checkout-index`, but this pass could not locate that identifier anywhere in the repository's text — decision records are stored in the plugin's own per-project data store outside this checkout, which this pass does not connect to — so the identifier itself is `[unverified]`; the switch and its reason are independently established from the two module bodies and the refusal test above, without needing the identifier.
- **Why it is above the ceiling:** rewriting a frozen plan document's prose is not a step any unit's acceptance criteria name, and none of U2-A's nine criteria (`U2-store-cost-and-safety-a.md:29-37`) concern the plan file's own text. Per the standing rule that the code wins where a document and the code disagree, the plan document is a stale artifact and the shipped module is what is true now.
- **Not folded in.**

## F2f — The plan cites a test, `roster.subprocess-census`, that was never shipped under that name or any other

- **Surfaced by:** U2-A delivery
- **Evidence:** `docs/plans/2026-08-28-continuity-goal-model/U2-store-cost-and-safety-a.md:35` (acceptance criterion 7) reads "Proven jointly by `store.open-does-not-read-every-record` and the already-shipped `roster.subprocess-census`", and `:774` repeats the name in the criteria-to-test table: "`store.open-does-not-read-every-record` plus `roster.subprocess-census` in `test/store/roster.test.ts` (already shipped), which asserts a whole roster read over fifty threads costs at most one subprocess." A search for `subprocess-census` across the shipped branch's source and test trees returns exactly these two lines of plan prose and nothing under `src/` or `test/`. The test that exists at the cited file is named `roster.is-subprocess-free` (`test/store/roster.test.ts:50`), and its assertion at `:74-77` reads `assert.ok(getSubprocessCallCounter() <= 1, ...)` with the message "expected the whole roster read over 50 threads to cost at most one subprocess, counted ...` — which is the exact behaviour the plan's own sentence describes, under a different name. This was independently corroborated at `docs/plans/2026-08-25-post-cutover-repair/MSP-1-materialisation-stamp.md:224`, a document from an earlier unit, which names the same test `roster.is-subprocess-free` at the same file and line range.
- **Why it is above the ceiling:** correcting a frozen plan document's prose is not a step named in any of U2-A's acceptance criteria. The correct name is recorded here, and belongs in the pull request body rather than in an edit to the plan.
- **Not folded in.**

## F2g — `roster.is-subprocess-free` does not discharge invariant `O5`, and the roster's record reads still grow with the terminal pile

- **Surfaced by:** U2-A delivery
- **Evidence:** `O5` is stated at `docs/specs/2026-08-28-continuity-goal-model.md:245`: "For every discovery surface, the number of records it reads does not grow as terminal records accumulate." `roster.is-subprocess-free` (`test/store/roster.test.ts:50-80`) asserts `getSubprocessCallCounter() <= 1` (`:74-77`) — a count of git subprocesses, a different quantity from the count of records read that `O5` names. The same test calls `opened.value.readThreads()` at `:68` and asserts at `:70` that it returns all 50 seeded threads, so it demonstrates that every record is read, not that the number read is bounded. `resetSubprocessCallCounter()` is called at `:66`, after `openStore` has already returned at `:62`, so any work `openStore` itself performs is excluded from the count the test checks; this same caveat was recorded independently, before this unit, at `docs/plans/2026-08-25-post-cutover-repair/MSP-1-materialisation-stamp.md:224`, and is re-confirmed here against the shipped test body rather than taken on trust. Separately, `src/render/roster.ts:19` declares `const TERMINAL_STATUSES = new Set<Thread['status']>(['done', 'abandoned'])`, and `selectRosterThreads` at `:21-23` filters a thread list against that set — filtering happens after the full list has already been read by `readThreads()`, not before. So as terminal threads accumulate in the store, `readThreads()` reads strictly more record files while the roster still renders the same surviving rows: exactly the growth `O5` forbids for a discovery surface.

  What this unit did prove is the open-path half of the same invariant. `store.open-does-not-read-every-record` (`test/store/open-cost.test.ts:49-78`) bounds the directory entries the open path examines at a fixed ceiling. A second test this unit adds beyond the frozen plan's own file-in-full listing, `store.open-directory-scan-does-not-grow-with-record-count` (`test/store/open-cost.test.ts:107-116`), goes further and asserts equality of that count between 4 records and 40 (`assert.equal` at `:111-115`) — the non-growth clause itself, not merely a ceiling. In plain words, this test counts directory entries examined by the open path's existence probe; it does not count record files read, so it does not on its own discharge `O5`'s records-read clause. This drafting pass read the assertion's message template directly in the code and confirms it says what the supplied failure text claims it says; the specific numbers were observed by executing the test rather than supplied untested — a test dispatch ran it against the parent commit `82dab09` with substitute instrumentation and read exit code 1, an independent code review reproduced the same red on a scratchpad copy by removing the early `return true` from `holdsAnyRecord`, and after the rename the same mutation was re-applied and re-run, again producing exit code 1. The verbatim assertion message from the post-rename run, as reported to this drafting pass rather than executed by it, reads: "opening a store holding 4 records examined 5 directory entries and opening one holding 40 records examined 41; the number of directory entries examined must not depend on how many records the store holds".
- **Why it is above the ceiling:** making the roster's record reads independent of the terminal pile needs an index over terminal records inside `readThreads`, which changes the store's read surface and the roster's contract — neither of which any U2-A criterion asks for. U2-A's ceiling is `B37` (the open path's walk) and `B38` (materialisation's subprocess count), and the SPEC's own `Green` cell for the U2 row (`docs/specs/2026-08-28-continuity-goal-model.md:410`) asks only for "Store-open and materialisation timings recorded before and after. `S1` asserted by the existing concurrency receipt. The guard detects the second live store on this machine" — it does not ask for `O5` over the roster.
- **Consequence if unaddressed:** `O5` is only partially discharged. The open path's record reads no longer grow with the store's size; the roster's still do, in proportion to how many threads have ever reached a terminal status.
- **Not folded in.**

## F2h — correction and extension of `F2d`: the tree listing still runs through the 1 MiB default buffer, while the shipped content read uses a 256 MiB one

- **Surfaced by:** U2-A delivery
- **Evidence:** `src/store/materialise-tree.ts:159` calls `deps.runGit(rt, repo, ['ls-tree', '-r', '-z', '--full-tree', ref])`, and `:172-173` calls `deps.runGitBuffer(rt, repo, ['cat-file', '--batch'], { stdin: batchInput })`. `src/store/git.ts:22` declares `export const GIT_BUFFER_MAX_BYTES = 256 * 1024 * 1024`; the plain `git` helper's `spawnSync` call at `:79-83` sets no `maxBuffer`, so Node's 1 MiB default applies to it, while the `gitBuffer` helper's `spawnSync` call at `:103-107` sets `maxBuffer: GIT_BUFFER_MAX_BYTES` at line 105. So the listing call — which scales with how many records the ledger ref holds — reads through the small unbounded-by-config buffer, and only the content call reads through the large one.

  This condition was measured against this machine's live ledger ref today by running two commands: `git ls-tree -r -z --full-tree refs/logbook/ledger | wc -c`, which returned 33508 bytes, and `git ls-tree -r --full-tree refs/logbook/ledger | wc -l`, which returned 300 entries — roughly 31 times under the 1 MiB ceiling, against a prior session's figure of 32618 bytes across 292 entries. The two agree on order of magnitude and differ by the 8 entries the ref gained between them, so the 33508/300 figure is the fresher. This drafting pass did not run either command itself; both were run by the dispatching orchestrator on this machine today, and are reported here as measured rather than supplied untested.

  The failure mode is loud, not silent: `spawnSync` sets `result.error` with code `ENOBUFS` on overflow, and the plain `git` helper returns `{ ok: false, code: -1, stderr: result.error.message }` at `:84-85` — the call fails outright rather than returning a truncated listing. `gitBuffer` recognises the same code explicitly via `isBufferOverflow` at `:97` (`error.code === 'ENOBUFS'`) and reports it as a named `overflow` case at `:108-117`.

  This condition is pre-existing, not introduced by this unit: on the parent commit `82dab09`, `src/store/read-path.ts:154` already listed the tree with `countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])`, wrapping the same plain `git` helper, and the parent's `src/store/git.ts` has no `gitBuffer` function at all — so on the parent every git call, buffered or not, went through the same 1 MiB default.

  This corrects and supersedes part of `F2d`'s reasoning above. `F2d` reasoned that `git cat-file --batch` "would have put the entire store's contents through that same buffer, which is one reason U2's plan writes the tree out with `git checkout-index` instead" — `git cat-file --batch` did ship, and it reads through the dedicated `gitBuffer` helper at 256 MiB, not through the 1 MiB helper `F2d` described. `F2d`'s underlying observation about the plain `git` helper having no `maxBuffer` remains true and is what this item extends to the still-unbuffered `ls-tree` call.
- **Why it is above the ceiling:** U2-A's criteria concern the number of subprocesses materialisation spawns (`B38`), not the buffer size any helper reads its output through. `src/store/git.ts` is not owned by U2-A (`U2-store-cost-and-safety-a.md`'s Owns row lists `src/store/records.ts`, `src/store/read-path.ts`, `src/merge/sync.ts`), so widening the listing call's buffer would be a change to a file this unit does not own.
- **Not folded in.**

## F2i — an unguarded cleanup inside two nested `finally` blocks in the merge path can replace the outcome it was meant to preserve

- **Surfaced by:** U2-A delivery
- **Evidence:** `src/merge/sync.ts:351-353` reads:
  ```
      } finally {
        if (baseScratch !== null) rmSync(baseScratch, { recursive: true, force: true })
      }
  ```
  and `:354-356`, the block it sits inside, reads:
  ```
    } finally {
      rmSync(theirsScratch, { recursive: true, force: true })
    }
  ```
  Neither `rmSync` call is wrapped in its own `try`/`catch`. A prior note cited line 159 for this defect, which does not match the current file at either the shipped branch or `main`; the exact current lines were located by reading the whole function (`performMerge`, `:270-357`) and are 352 and 355 for the two calls themselves.

  A `finally` block runs on the way out of a function whether that function is returning normally or throwing an error. If the statement inside a `finally` block itself throws — here, `rmSync` can throw if the scratch directory it is asked to remove is busy, or if a permission changed after it was created — that new error replaces whatever the function was in the middle of returning or throwing, so the original outcome of the merge attempt is lost and the caller is told about a cleanup failure instead of about the actual merge result. Elsewhere in the same unit's own new module, cleanup is written the other way: `discardScratchDir` in `src/store/read-path.ts:94-105` wraps its `rmSync` in a `try`/`catch` and logs the failure via `rt.log` rather than letting it propagate, which is the pattern these two sites in `src/merge/sync.ts` do not follow.
- **Why it is above the ceiling:** U2-A's criteria concern materialisation's subprocess count on the merge path (`B38`), not the error-propagation shape of the merge path's scratch-directory cleanup. `src/merge/sync.ts` is owned by this unit for the materialisation change alone; restructuring its cleanup's error handling is a separate change to the same file, not named by any of the nine acceptance criteria.
- **Not folded in.**

## F2j — the early-exit directory scan holds one open directory handle per level of recursion

- **Surfaced by:** U2-A delivery
- **Evidence:** `src/store/records.ts:98-111` (`holdsAnyRecord`, the function this unit introduces to close defect `D13`) reads:
  ```
  const holdsAnyRecord = (dir: string): boolean => {
    const handle = openDirOrNull(dir)
    if (handle === null) return false
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        recordScanCount += 1
        if (entry.isFile() && entry.name.endsWith('.json')) return true
        if (entry.isDirectory() && holdsAnyRecord(path.join(dir, entry.name))) return true
      }
      return false
    } finally {
      handle.closeSync()
    }
  }
  ```
  The recursive call at line 105 happens from inside the `try` block, before the `finally` at `:108-110` runs `handle.closeSync()`. So descending into a subdirectory does not close the parent directory's handle first; every ancestor directory on the current path stays open for the whole depth of the descent, and each is closed only as the recursion unwinds back out of it.

  An operating system caps how many files and directory handles one process may have open at the same time; exceeding that cap raises the error `EMFILE`. Because this function holds a handle for the whole depth of its descent instead of closing each one before recursing into the next, the number of handles open at any moment is measured against the depth of the records tree, not against how many records exist at one level.

  The honest limit on this: the records tree's known shape is shallow — `records/threads/`, `records/decisions/`, `records/sessions/<thread ULID>/`, and `records/bindings/` are each at most two levels deep from `layout.records` — so the practical depth reachable today is small, and no `EMFILE` has been observed or reproduced. This is a structural observation about how the function is shaped, not a reproduced failure.
- **Why it is above the ceiling:** U2-A's criterion 1 (`store.open-does-not-read-every-record`) asks that the open path stop reading every record, which `holdsAnyRecord` achieves by returning at the first record found. Restructuring the recursion to close a handle before descending into the next one is a separate change to the same function that no acceptance criterion names.
- **Not folded in.**

## F2k — the store layout does not require its root, `CLAUDE_PLUGIN_DATA`, to be an absolute path

- **Surfaced by:** U2-A delivery
- **Evidence:** `src/store/layout.ts:65-75` reads the environment value under the key `CLAUDE_PLUGIN_DATA` (declared at `:14`) and refuses only when it is unset or empty:
  ```
    const pluginData = rt.env[CLAUDE_PLUGIN_DATA]
    if (pluginData === undefined || pluginData.length === 0) {
      return {
        ok: false,
        field: CLAUDE_PLUGIN_DATA,
        accepted: 'a non-empty absolute path set in the environment',
        example: '/Users/example/.claude/plugin-data',
        retryable: true,
        message: `${CLAUDE_PLUGIN_DATA} is not set; the store cannot be located without it`
      }
    }
  ```
  The refusal's own text and its `accepted` field both describe the expected value as "a non-empty absolute path", but nothing in the function checks that shape: a search of the whole file for `path.isAbsolute` and `path.resolve` returns no calls on `pluginData` anywhere in it — the value is joined straight into `path.join(pluginData, key)` at `:78` and used as-is. This file is unchanged by U2-A (it is outside this unit's Owns row) and was read on the shipped branch to confirm the condition is identical to `main`.

  A relative value would be interpreted against whatever directory the current process happens to be running in when the store is opened, rather than against a fixed location. The same project could then resolve to different store roots depending on where the server or CLI happened to be started from, even though the environment variable's text never changed.
- **Why it is above the ceiling:** U2-A's criteria concern the cost of opening and materialising a store, not the validation of where the store root is located, and `src/store/layout.ts` is not among the files this unit owns. The neighbouring surface that does compare store roots against each other, the duplicate-store guard in `src/store/single-store.ts`, is owned by unit U2-B (`docs/plans/2026-08-28-continuity-goal-model/U2-store-cost-and-safety-b.md:13`), which is the unit that next touches this area of the store.
- **Not folded in.**

## F2l — `readOursRecordSet` drops locally-quarantined records with no capture, while the plan reasons only about the `theirs` and `base` sides

- **Surfaced by:** U2-B planning
- **Evidence:** `src/merge/sync.ts:84-101` (`readOursRecordSet`) reads this machine's own store and keeps only the unquarantined records, for all three record types, each behind a bare `if (!slot.quarantined) ...` with no branch for the quarantined case: threads at `:86-88`, decisions at `:89-92`, and session entries at `:94-99` —
  ```ts
      const entries: SessionEntry[] = []
      for (const slot of store.readSessionEntries(threadId)) {
        if (!slot.quarantined) entries.push(slot.record)
      }
      sessionsByThread.set(threadId, entries)
  ```
  A quarantined local record is simply absent from the returned set: nothing is logged, nothing is counted, and nothing is added to any `passthrough` list. `readScratchRecordSet` (`:104-139`), which builds the `theirs` and `base` sides of the same merge from the remote's scratch checkout, does the opposite for every one of the same three record types — `:112-113`, `:120-121` and `:130-131` route a quarantined slot into `captureQuarantined` (`:106-108`), which appends it to a `passthrough` array this plan's section 2.5 and step 4 are built entirely around consuming and refusing on.
- **Why it is above the ceiling:** this unit's acceptance criteria 6-8 concern a remote record this version cannot parse; `readOursRecordSet` reads the local side of the merge, not the remote side, and none of the eight criteria in section 1 name it. Closing the asymmetry means deciding what a merge should do with a local record already known to be unreadable — refuse, as this plan now does for the remote side, or something else — which is a new decision, not a correction to `B40`.
- **Not folded in.**

## F2m — An unbounded directory scan runs on every store open, over a parent directory the plugin does not own

- **Surfaced by:** U2-B review
- **Evidence:** `src/store/single-store.ts` (`conflictsUnderOtherRoots`) runs `readdirSync` over `path.dirname(pluginDataRoot)` — the plugin-data root's PARENT directory — on every store open, then does one `statSync` per directory found there. Store open gates all twelve tools, so this scan runs on every tool call this session makes. If the plugin-data root sits one level below a busy directory such as the system temporary directory or the user's home directory, that parent can hold thousands of entries, and anyone able to create files in that parent directory — which the plugin does not own or control — can inflate the scan's cost on every subsequent tool call. The ruled design already accounted for one axis of this and is not in question here: only the store's own key is probed under each sibling root, never an exhaustive enumeration of every key under every sibling (plan section 4, step 2 rationale, third bullet), and the plan deliberately rejected caching the negative result because a duplicate store appearing mid-session would then go undetected until restart (plan section 8.5, closing paragraph). The axis this reasoning did not cover is the NUMBER OF SIBLING ROOTS itself — nothing bounds how many directories can sit beside the plugin-data root, and nothing was measured against an adversarially populated one.
- **Why it is above the ceiling:** acceptance criteria 1-5 require the widened guard to detect a cross-root duplicate and to leave a non-duplicate store alone; none of them bound the cost of the scan against a hostile or merely large parent directory. Section 8.5's own cost table measures a directory of 1,175 siblings as a realistic worst case drawn from test fixtures, not as an adversarial one, and states the guard is not traded away for a few milliseconds — it does not evaluate an unbounded sibling count.
- **Not folded in.**

## F2n — The new sync refusal is blind to any record file outside three known directories, and the merge silently deletes what it cannot see

- **Surfaced by:** U2-B review
- **Evidence:** `readScratchRecordSet` at `src/merge/sync.ts:104-139` populates `passthrough` — the list this unit's new refusal is built to inspect — only from `readAllRecordFiles`, which filters on `name.endsWith('.json')` inside exactly `threads/`, `decisions/` and `sessions/<id>/`. A top-level file, a stray `decisions/x.json.bak`, a `sessions/<id>/notes.md`, or any file under an unknown directory is invisible to `readScratchRecordSet` entirely — it is neither captured as passthrough nor refused. Because `buildTree` (the function that assembles the pushed commit's tree) starts from the local ref and applies only the changes the merge computed, any such invisible remote file is silently DELETED from the shared ledger the moment the merge commit is pushed.
- **Why it is above the ceiling:** acceptance criteria 6-8 concern a record file this version cannot parse; they do not extend to files this version cannot even see. The precise guarantee this unit actually ships is narrower than "a sync carrying remote bytes this version cannot parse is refused" — it is "a sync carrying a `.json` file in `threads/`, `decisions/` or `sessions/<id>/` that this version cannot parse is refused, and nothing outside those three directories is looked at, refused on, or protected from deletion."
- **Not folded in.**

## F2o — Remote-only `bindings/` records are read by neither the merge nor the new guard, and are dropped on push

- **Surfaced by:** U2-B review
- **Evidence:** `readScratchRecordSet` (`src/merge/sync.ts:104-139`) reads only threads, decisions and session entries; it has no branch for `bindings/`. `src/server/tools/bind_branch.ts:105` writes binding records into that directory. A binding record that exists only on the remote — for example written by a peer who pushed since this machine's last sync — is therefore neither merged into the local ledger nor captured as passthrough by this unit's new guard, so a normal merge commit silently omits it from the tree it pushes back, while that pushed commit still names the remote commit it fast-forwarded or merged from as a parent.
- **Why it is above the ceiling:** acceptance criteria 6-8 are scoped to the passthrough this unit closes, and `readScratchRecordSet`'s omission of `bindings/` predates this unit — this unit only added a refusal on the paths that function already reads, not a mechanism to make it read `bindings/`. Closing this needs `readScratchRecordSet` to gain a fourth record class, which is a change to the merge's read surface beyond what any of the eight criteria name.
- **Not folded in.**

## F2p — The cross-root guard is skipped on exactly the store open that creates the duplicate it exists to catch

- **Surfaced by:** U2-B review
- **Evidence:** in `src/store/single-store.ts`, `conflictsUnderOtherRoots` lists the plugin-data root's parent directory to find sibling install roots. When the plugin-data root itself does not yet exist, that listing raises `ENOENT`, the function logs `store.cross-root-scan-skipped` and returns an empty list — no conflict is reported — and `openStore` proceeds to create the plugin-data root's directories and returns a writable store. So the very first store open for a brand-new install, the one moment at which a genuine duplicate would be created, is exactly the open on which the guard cannot run: a whole session can open and write to a duplicate store before the guard gets a chance to see it on the SECOND open.
- **Why it is above the ceiling:** criteria 1-5 test the guard against a duplicate that already exists at open time; none of them cover the creation-time race. Whether this window is reachable in practice depends on the Claude Code harness's own behaviour, which this review could not establish: it could not determine whether the harness pre-creates the plugin-data directory before ever invoking the plugin, and if it does, this window never opens. That is recorded here as a stated unknown, not as a reproduced failure.
- **Not folded in.**

## F2q — A planted `origin.json` in any sibling root produces a permanent, unlocatable lockout

- **Surfaced by:** U2-B review
- **Evidence:** the guard's only test for a conflicting store is string equality of a candidate directory's `origin.json` `project_root` field against this store's own `layout.projectRoot` (`conflictsUnderOtherRoots`, `src/store/single-store.ts`). Nothing checks that the plugin, rather than an arbitrary local actor, wrote that file. Writing a file at `<parent-of-plugin-data-root>/anything/<own-key>/state/origin.json` containing this project's real root is enough to make every future store open for this project refuse permanently, because the refusal is `retryable: false`. This diff widens the reachable attack surface from the plugin's own data root (where the same trick was already possible for a same-root duplicate) to every directory beside it. This requires local filesystem write access next to the plugin-data root — it is not remotely reachable. Because the refusal deliberately carries no absolute path (criterion 3), the victim of this lockout is told that two stores exist but has no way, from the refusal text alone, to locate the second one and remove it.
- **Why it is above the ceiling:** criteria 1-5 require the guard to detect a genuine duplicate and to leak no absolute path; neither criterion considers a planted, forged sibling. Guarding against a locally-planted `origin.json` needs an authenticity check this unit's design does not attempt and none of the acceptance criteria ask for.
- **Not folded in.**

## F2r — The new refusal destroys the pending conflict-resolution file while its own message claims nothing changed

- **Surfaced by:** U2-B review
- **Evidence:** `sync()` at `src/merge/sync.ts:422-425` calls `clearConflicts(layout)` for every non-`conflict` outcome, and this unit's new `rejected` outcome is a non-`conflict` outcome, so it too triggers `clearConflicts`, which unlinks `state/conflicts.json`. Sequence: a sync reports unresolved conflicts and writes that file; the operator begins resolving them; before they finish, a colleague pushes a record this version cannot parse; the operator's next sync now refuses with this unit's new message and, in doing so, deletes the very conflict list they were mid-way through resolving. `resolve_conflict` then reports that no conflicts are recorded, while `sync_ledger` keeps refusing on the unrelated unparseable record — a closed loop in which the original unresolved work is gone with no record of it. This `clearConflicts`-on-`rejected` behaviour is PRE-EXISTING and already reachable from several paths that predate this unit; this unit adds one more instance of it, and it is the first whose refusal message explicitly and specifically promises that both copies are unchanged.
- **Why it is above the ceiling:** acceptance criterion 7 is scoped to the REMOTE's copy of the unparseable record surviving byte for byte, which it does — this finding does not falsify criterion 7. It is above the ceiling because none of the eight criteria address the LOCAL side effect of the refusal on unrelated, already-pending conflict state, and fixing the general `clearConflicts`-on-non-conflict-outcome behaviour is a change to a path this unit did not open.
- **Not folded in.**

## F2s — Every unparseable remote file is read fully into memory on every sync attempt, then never used

- **Surfaced by:** U2-B review
- **Evidence:** `captureQuarantined` at `src/merge/sync.ts:107` performs a full `readFileSync` of each rejected file's contents. After this unit's change, only `relPath` from each captured entry is ever consumed — the refusal message joins only file names (see plan step 4, `theirs.passthrough.map((file) => file.relPath)`), and the file's `content` is discarded once `sync()` returns the refusal. A remote ledger carrying many large unparseable files therefore causes a full-content read of all of them into memory on every single sync attempt, an avoidable cost that recurs on every retry for as long as the condition persists.
- **Why it is above the ceiling:** none of the eight acceptance criteria bound memory use or the cost of building the refusal message; they require only that the refusal happen, name the files, and leave both copies untouched, all of which the current implementation does. Avoiding the read means changing `captureQuarantined`'s contract to defer reading content until it is known to be needed, which is a change to a function this unit did not introduce and whose other caller (the ordinary quarantine path) does need the content.
- **Not folded in.**

## F2t — A symlinked sibling install root is skipped by the very check meant to find it

- **Surfaced by:** U2-B review
- **Evidence:** the root filter inside `conflictsUnderOtherRoots` uses `Dirent.isDirectory()` to decide which entries beside the plugin-data root to treat as candidate install roots. `Dirent.isDirectory()` reports a symbolic link as a link, not as a directory, so a sibling install root that is itself a symlink is filtered out and never probed for a conflicting `origin.json` — the guard misses precisely the kind of duplicate it exists to catch. This was NOT fixed inside this unit for a stated reason recorded in the plan itself: `conflictsUnderOtherRoots`'s inner candidate check deliberately switched to `lstatSync` (which does not follow links) specifically to STOP following symlinks, after a symlinked candidate was found during planning to cause a false lockout. Closing this gap by following links at the outer, root-listing level reopens exactly the failure mode the inner check was changed to avoid, unless root identity is compared in a way that tolerates a link without being fooled by one — for example canonicalising both paths with `realpath` before comparing — which is a decision about identity comparison, not a one-line fix.
- **Why it is above the ceiling:** criteria 1 and 4 require the guard to catch a real duplicate and not a false one; they do not specify whether either side of the comparison may be reached through a symlink, and the plan's own text records the symlink-related false-lockout finding as already resolved for the inner check. Resolving the outer check the same way needs a decision this unit's acceptance list does not contain.
- **Not folded in.**

## F2u — Two deliberately-tolerated conditions are logged at `error` level, against the codebase's own convention

- **Surfaced by:** U2-B review
- **Evidence:** `src/store/single-store.ts` logs both `store.cross-root-scan-skipped` and `store.cross-root-candidate-skipped` at `level: 'error'`, even though both name conditions the design explicitly tolerates and continues past rather than treating as failures (plan section 4, step 2 rationale, second bullet: "The condition is named in the log rather than swallowed", describing exactly this non-fatal continuation). Elsewhere in the codebase, a tolerated-but-notable condition is logged at `level: 'warn'`, not `'error'` — for example in `src/hooklib/commit-note.ts` and `src/runtime/runtime.ts`. Logging a condition the code continues past as though it were an error trains an operator scanning logs to either investigate a non-failure or, worse, to start ignoring error-level lines generally.
- **Why it is above the ceiling:** the plan's own text (section 4, step 2) specifies `error` as the level for both log events; this is a ruled choice, not an oversight the acceptance criteria leave open, so changing it is a deviation from something already decided in this plan rather than a defect this unit's criteria ask to fix.
- **Not folded in.**

## F2v — The fast-forward sync path still moves unvalidated remote bytes onto the local ref, unmitigated by this unit's new refusal

- **Surfaced by:** U2-B review
- **Evidence:** `runAttempt` in `src/merge/sync.ts` routes to `fastForward` whenever the local ledger ref is an ancestor of the remote ref, and that path moves the local ref straight to the remote commit and materialises it with no schema check of any kind — this unit's new passthrough refusal lives inside the merge path (`performMerge`) and never runs on the fast-forward path at all. Two existing mitigations keep this from being equivalent to the hole this unit closes, and stating them is necessary so this finding is not misread as "the fix did nothing": first, the bytes are inert on read, because `readRecordFile` quarantines anything that fails to parse rather than treating it as a valid record; second, `materialiseTreeInto` already enforces entry mode, object type, a check against `.git`-path segments, and destination containment, regardless of which sync path reached it. The precise consequence for how this unit's own claim should be worded: the statement "no remaining path writes unvalidated remote bytes into the local ledger" is not literally true after this unit ships. What IS true, and what this unit actually closes, is narrower: the one path that RE-COMMITS those bytes under this machine's own identity — turning someone else's unparseable file into a change this machine authored and could itself push onward — is closed.
- **Why it is above the ceiling:** none of the eight acceptance criteria mention the fast-forward path; criteria 6-8 are written against, and the shipped test exercises, the merge path specifically. Extending the same protection to fast-forward is a second code path this unit does not touch and the criteria do not name.
- **Not folded in.**

## F2w — Two more copies of already-duplicated helpers, one of which mutates its argument in place

- **Surfaced by:** U2-B review
- **Evidence:** `errnoCode` and `withDetail` as they appear at `src/store/single-store.ts:9-25` are a THIRD copy of helpers that already exist in `src/store/detail.ts`, which are themselves already duplicated a second time at `src/store/layout.ts:16-32`. The copy local to `single-store.ts` is not merely a duplicate in text: its `withDetail` mutates the refusal object it is given in place and returns that same object, whereas the canonical version at `src/store/detail.ts:16-27` correctly constructs and returns a NEW object, leaving its argument untouched. The mutating form is a direct violation of this project's immutability standard (never mutate an existing object; always return a new one).
- **Why it is above the ceiling:** none of the eight acceptance criteria concern code deduplication or the immutability of a helper function; this duplication and its mutating variant are PRE-EXISTING in the sense that the pattern already existed twice before this unit, and this unit's diff neither introduces nor touches these three lines beyond using them as they already stood. Consolidating three copies into one, and fixing the mutating one to return a new object, is a refactor across files this unit does not own the ceiling to make.
- **Not folded in.**

## F2x — An unparseable record in the merge's common ancestor is silently discarded rather than named

- **Surfaced by:** U2-B review
- **Evidence:** `readScratchRecordSet` is also used to build `base` — the three-way merge's common-ancestor snapshot — and that call's own `passthrough` field (`base.passthrough`) is computed but never inspected anywhere afterward; nothing reads it, logs it, or reports it. An unparseable record in the ancestor silently degrades the three-way merge to an effectively two-way one for that record, which is conservative in outcome — it causes the merge to OVER-report conflicts rather than lose data — but the degradation itself happens with no signal to anyone that it occurred. The plan deliberately ruled that only the OTHER side's (`theirs`) unparseable files should refuse the sync, explicitly not the ancestor's, reasoning that the ancestor's files are already committed history and refusing on them would block every future sync over something this change cannot repair (plan section 3, divergence 6). This finding is not a disagreement with that ruling — it does not propose that the ancestor's unparseable files should refuse anything. It is about the fact that the condition is currently invisible rather than merely non-blocking.
- **Why it is above the ceiling:** none of the eight acceptance criteria concern the ancestor snapshot at all; criteria 6-8 are written against `theirs.passthrough`. Naming this condition, for example via a log line, is a new behaviour on a code path the plan's own divergence 6 explicitly decided to leave alone.
- **Not folded in.**

## F2y — Remote-controlled filenames are interpolated into the refusal message with no sanitisation and no cap

- **Surfaced by:** U2-B review
- **Evidence:** the filenames this unit's new refusal joins into its message text — `theirs.passthrough.map((file) => file.relPath).join(', ')` in the step-4 insertion to `src/merge/sync.ts` — come from git tree entries read out of the REMOTE ledger, so their source is a party across the network, not this machine or its operator. A git tree entry's name may contain any byte except `/` and the NUL byte, which permits terminal escape sequences, raw newlines, and Unicode bidirectional-override characters, and the join has no cap on either the number of names or their combined length. This is currently inert for one specific, narrow reason recorded in this same plan's own divergence 12: the refusal `detail` text this construct builds is discarded before it ever reaches an operator's screen, because the operator-visible tool boundary does not carry `detail` through at all (`pickRefusalFields` in `src/server/errors.ts` copies only `field`, `accepted`, `example`, `retryable` and `message`). The bind this creates is precise and must be stated together: if that display defect is fixed so `detail` (or an equivalent field carrying these names) reaches the operator, sanitising these names and capping their count and length becomes REQUIRED in the same change — otherwise fixing the display defect introduces a terminal-injection defect in its place.
- **Why it is above the ceiling:** none of the eight acceptance criteria address sanitisation of remote-controlled text reaching an operator surface; criterion 8 asks only that the refusal name the file, not that the naming be safe against a hostile filename once actually displayed. Because the text is not currently displayed, there is nothing for this unit's own criteria to fail on, which is exactly why this is filed rather than fixed.
- **Not folded in.**
