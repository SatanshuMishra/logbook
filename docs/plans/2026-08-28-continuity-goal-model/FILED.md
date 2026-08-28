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
