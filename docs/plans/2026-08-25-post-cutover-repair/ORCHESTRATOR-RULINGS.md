# Orchestrator rulings — post-cutover repair ladder

Cross-MSP facts and choices settled once, centrally, so that ten plan documents agree.

Binding on every agent that produces a plan document under this directory, alongside
`PLANNING-BRIEF.md`. Precedence: the frozen SPEC governs WHAT is built; `PLANNING-BRIEF.md`
governs HOW a plan is written; this file governs the cross-MSP facts no single planner can
settle alone. Where this file names a divergence from the SPEC, this file wins for planning
purposes and the divergence is restated in the affected plan's `## 3. Divergences from the SPEC`.

## O0 — The SPEC is frozen and correct

Do not re-verify it. Do not re-derive its defects. Do not audit its rulings. Do not spend a tool
call proving a defect it already established. You read source for exactly one reason: to copy the
literal current text into FIND blocks and to author the literal REPLACE text. See
`PLANNING-BRIEF.md` section 3.

## O1 — Ladder order, branch names and version bumps

Baseline ladder. Dependencies honoured: MSP-0 before MSP-5 and MSP-8; MSP-1 before MSP-6;
MSP-2 before MSP-4; MSP-8 after MSP-3 and MSP-4; MSP-9 after everything.

| Order | MSP | Branch | Version from -> to |
| --- | --- | --- | --- |
| 1 | MSP-0 | `fix/msp-0-utf8-source-census` | 1.0.0 -> 1.0.1 |
| 2 | MSP-1 | `fix/msp-1-materialisation-stamp` | 1.0.1 -> 1.0.2 |
| 3 | MSP-2 | `fix/msp-2-cas-retry-reread` | 1.0.2 -> 1.0.3 |
| 4 | MSP-3 | `fix/msp-3-park-thread-refuses` | 1.0.3 -> 1.0.4 |
| 5 | MSP-4 | `fix/msp-4-record-decision-links` | 1.0.4 -> 1.0.5 |
| 6 | MSP-5 | `fix/msp-5-guard-registry-check` | 1.0.5 -> 1.0.6 |
| 7 | MSP-6 | `fix/msp-6-sync-receipt-shas` | 1.0.6 -> 1.0.7 |
| 8 | MSP-8 | `fix/msp-8-published-descriptions` | 1.0.7 -> 1.0.8 |
| 9 | MSP-7 | `feat/msp-7-thread-lineage` | 1.0.8 -> 1.1.0 |
| 10 | MSP-9 | `docs/msp-9-continuity-rule` | 1.1.0 -> 1.1.1 |

A split MSP (see O7) consumes one extra patch and shifts everything below it by one. The version
rule in O6 is written so that a shift does not invalidate any plan.

## O2 — DIVERGENCE: the ladder lands on 1.1.1, not 1.1.0

SPEC section 7 states MSP-9 is "last: it documents the state the ladder ends in", that every MSP
bumps patch except MSP-7 which bumps minor, and that "the ladder lands on `1.1.0`". Those three
cannot all hold: landing on 1.1.0 requires MSP-7 to merge tenth, which puts the documentation
MSP before the last behaviour change it must describe.

Ruled: MSP-9 merges last and the ladder lands on `1.1.1`. MSP-9 acceptance criterion 1 requires
every claim in the replacement rule to be true of the **shipped** code; a document merged before
MSP-7 is stale on arrival, and correctness outranks the tidiness of the final version string.

Rejected: MSP-9 ninth and MSP-7 tenth. It buys the round number by shipping a document that
describes a tree that does not exist yet.

Every plan restates this in its section 3 in one line.

## O3 — DIVERGENCE: the pull request tool path

SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib` in
this repository. The tool is the operator's global one:

    node ~/.claude/lib/git/pr.mjs pr-create

Every plan's section 10 uses that path. Ad-hoc `gh pr create`, `gh api` POSTs to the pulls
endpoint and the GitHub MCP create tool are denied at the gate; a plan that instructs any of
them is a defect in the plan.

## O4 — Base branch, parent commit, and what "red on the parent" means

- Every MSP branch is cut from `main` and every pull request targets `main`.
- `main` is at `0ade582` at planning time.
- The SPEC branch `docs/post-cutover-repair-spec` carries `4f379e7` and `9f66931`, and both are
  **documentation only**: `git diff --stat main...HEAD` touches nothing outside `docs/`.
  Therefore `src/`, `test/`, `hooks/`, `skills/` and `scripts/` are byte-identical between
  `0ade582` and `4f379e7`, and the SPEC's line numbers taken at `4f379e7` apply unchanged to a
  branch cut from `main`.
- "Red on the parent" in every plan means: red at the commit the MSP branch was cut from. State
  it as "the tip of `main` at branch-cut time; `0ade582` at authoring time".
- Plan documents are not yet committed. Do not assume an implementer can `git show` them; the
  plan is handed over as a file.

## O5 — Plan file names, one per MSP

    docs/plans/2026-08-25-post-cutover-repair/MSP-0-utf8-source-census.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-1-materialisation-stamp.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-2-cas-retry-reread.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-3-park-thread-refuses.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-4-record-decision-links.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-5-guard-registry-check.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-6-sync-receipt-shas.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-7-thread-lineage.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-8-published-descriptions.md
    docs/plans/2026-08-25-post-cutover-repair/MSP-9-continuity-rule.md

## O6 — The version bump is mechanical, and a shifted ladder must not break the plan

Write section 0's version line as: "Baseline `<from>` -> `<to>` per orchestrator ruling O1."

Write the step itself as a read-then-increment, never as a hard-coded pair:

1. The implementer reads the current version from `package.json`.
2. It increments the PATCH (MSP-7 only: increments the MINOR and sets PATCH to 0).
3. It writes the same value into `package.json` and `.claude-plugin/plugin.json` in one commit
   (invariant I4).
4. It runs `node scripts/check-packaging.mjs` and expects exit 0.

Give the exact commands. Read `scripts/check-packaging.mjs` and any existing version script
before you author them, and match whatever the repository already does rather than inventing a
second way. Give the exact expected `git diff` for the two manifest files under the baseline.

Stop condition for section 11: STOP if `package.json` and `.claude-plugin/plugin.json` disagree
with each other before the change. A version that is merely higher than the baseline means the
ladder shifted and is NOT a stop condition.

## O7 — A split is decided in the plan, never left to the implementer

SPEC section 7 gives MSP-3 and MSP-4 a conditional split ("if the diff exceeds 400 lines"). A
conditional is a decision passed downstream, which `PLANNING-BRIEF.md` section 2 forbids.

The planner counts the lines of the change it actually authored and rules, in the plan, one of:

- **No split.** State the authored line count and that it is under 400.
- **Split.** Produce TWO complete plan documents, `MSP-N-<slug>-a.md` and `MSP-N-<slug>-b.md`,
  each with the full mandatory structure, each with its own branch (`...-a`, `...-b`), its own
  acceptance subset, its own version bump (A takes the MSP's baseline patch, B takes the next),
  and B carrying a stop condition that A must be merged first. The SPEC's stated split content
  governs which half is which; PR A always lands first.

Either way the word "if" does not appear in the instruction to the implementer.

## O8 — Filed items are appended, never rewritten

Anything discovered above an MSP's acceptance ceiling goes to
`docs/plans/2026-08-25-post-cutover-repair/FILED.md` (invariant I9).

Because several planners run concurrently, append with a SINGLE shell append and never a
read-modify-write:

    cat >> docs/plans/2026-08-25-post-cutover-repair/FILED.md <<'FILED_EOF'

    ## F<n> — <one-line title>

    - **Surfaced by:** MSP-N planning
    - **Evidence:** <path:line, plus the verbatim line or command output you personally read>
    - **Why it is above the ceiling:** <which acceptance criterion it exceeds>
    - **Not folded in.**
    FILED_EOF

Number your items `F<MSP number><letter>` (`F3a`, `F3b`, `F7a`) so concurrent planners cannot
collide on a number. Never edit an item another planner wrote.

## O9 — The audits' closed lists did NOT survive; reconstruct them

Only the probes survived, at `docs/audits/2026-08-25-post-cutover-repair-probes/`. The audit
worksheets did not. Two SPEC statements name lists that are therefore not readable anywhere:

- MSP-7: "Audit A5 produced a 33-item closed checklist."
- MSP-9: "Every one of the 81 claims audit A6 classified."

The planner that needs such a list **reconstructs it itself**, by census over the real code, and
writes the reconstructed list into its plan as an explicit numbered checklist that the
implementer can discharge item by item. Do not cite a count you did not produce. If your
reconstruction yields a different count, that is a divergence for section 3, and YOUR enumerated
list governs — the SPEC's number does not.

The four hard-coded assertions MSP-7 names (`test/unit/field-merge.test.ts:348`,
`test/unit/records.test.ts:14`, `test/unit/briefing.test.ts:127,154`) and its explicit negatives
(`completions.ts`, `instructions.ts`, `example.ts`, `no-arguments.ts`) are SPEC findings and are
taken as given per O0 — confirm the line still says what you are about to edit, because you must
copy it into a FIND block anyway, and route around it per `PLANNING-BRIEF.md` section 3 if it
moved.

## O10 — Probe inheritance

Re-author the probe your MSP inherits as a committed test BEFORE the fix (SPEC section 8.1). A
probe referenced but not committed is treated as absent. Sources are read-only evidence at
`docs/audits/2026-08-25-post-cutover-repair-probes/`; nothing there is a test, and none of it is
in the tsconfig include set.

| MSP | Inherits |
| --- | --- |
| MSP-1 | `repro-f6.ts`, `repro-f3.ts` (A3: store roots, sync receipt) |
| MSP-2 | `probe-lostupdate.ts`, `probe-concurrent.ts`, `probe-concurrent2.ts` |
| MSP-3 | `repro-f7.ts`, `repro-c7.ts` (A2: park_thread and the pointer) |
| MSP-4 | `repro-f1.ts` (A1), plus `probe-caps.ts`, `probe-boundary.ts` for the cap work |
| MSP-5 | `probe.ts`, `probe.mjs`, `probe2.mjs`, `measure.mjs`, `timing.mjs`, `verdict.mjs`, `spawnprobe.mjs` (A4: the shipped write-guard module) — read each, the individual assignments were not recorded |
| MSP-6 | `repro-f3.ts` |

`cites.txt` holds the A7 citations behind ruling R10's MCP error contract.

## O11 — The plan is self-contained

The implementer reads the plan and the repository. It does not read the SPEC, this file, the
planning brief, or any other MSP's plan. Therefore:

- Never instruct "see SPEC section X" or "per ruling R4". Quote the sentence you need, inline.
- Never instruct "as in MSP-2's plan". State the literal precondition and make it a stop
  condition.
- Cross-MSP coupling appears twice and only twice: as `Depends on:` in section 0, and as a
  concrete, checkable stop condition in section 11 ("run `<command>`; if the output is not
  `<exact text>`, STOP and report; do not improvise").

## O12 — No plan edits another plan, the SPEC, or the brief

Write only your own plan files, and append-only to `FILED.md`. If your MSP's correctness depends
on another MSP's plan saying something specific, say so in your return summary and let the
orchestrator resolve it. Do not reach into another planner's file.

## O13 — Reading the ungreppable file

`src/server/tools/resolve_conflict.ts` contains a non-UTF-8 byte and is invisible to `grep` until
MSP-0 lands. Read it with something that does not assume UTF-8, for example:

    node -e "process.stdout.write(require('fs').readFileSync('src/server/tools/resolve_conflict.ts','latin1'))"
    xxd src/server/tools/resolve_conflict.ts | grep -v '^.\{9\}\( [0-9a-f]\{4\}\)\{8\}'

Any census a plan adds over `src/` must be authored knowing this file exists (invariant I8).

## O14 — Quality gate before you return

Before returning, dispatch `conformance-auditor` over each plan document you wrote. Give it a
closed obligation list built from: `PLANNING-BRIEF.md` section 2 (the bar), `PLANNING-BRIEF.md`
section 6 (the eleven mandatory headings, in order), invariants I1-I9, and rulings O1-O13 above.
Require one evidence-backed verdict per obligation. Repair every failed obligation yourself, then
return. Do not return a plan with a known unmet obligation; if one genuinely cannot be met, say
so explicitly in your return summary and name it in the plan.

## O15 — MSP-0 de-pins the manifest-agreement test; no later MSP re-pins it

Raised by MSP-7 planning as `F7a` and settled here because it is ladder-wide and no single
planner can settle it.

`test/contract/cutover-manifests-agree.test.ts:8` reads `const EXPECTED_VERSION = '1.0.0'`.
Ruling O1 gives all ten MSPs a version bump, so that constant fails every one of them. Repairing
it is NOT above any MSP's ceiling — every MSP declares `npm test` green as an acceptance
criterion, and the constant makes that criterion unreachable. The only open question is whether
the repair is permanent or repeated ten times.

Ruled: **MSP-0 de-pins it permanently.** The test derives the expected version by reading
`package.json` and asserts that `.claude-plugin/plugin.json` agrees with it, which is what the
test's own name — `cutover.manifests-agree` — already claims it does. The two-manifest agreement
is the invariant worth testing (I4); the literal string `1.0.0` is not.

Rejected: each MSP re-pins the constant to its own number. That is a change-detector test edited
ten times, it breaks the moment the ladder order shifts, and `testing.md` forbids change-detector
tests outright.

Rejected: a separate eleventh MSP for the de-pin. MSP-0 is first, is tiny, and must repair the
test anyway to reach its own criterion 3.

Consequences, and every planner applies them:

- **MSP-0's planner** folds the de-pin into its plan as a numbered step in section 4, with exact
  FIND/REPLACE, and names it in section 8 as part of what makes `npm test` green. It is in scope
  under MSP-0 acceptance criterion 3, not an addition above the ceiling.
- **Every other MSP's planner** writes NO edit to that file. Instead, section 11 gains this stop
  condition, verbatim:

      Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
      If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
      STOP and report; do not improvise, and do not edit this file.

- A plan that already instructs the implementer to update `EXPECTED_VERSION` is corrected to the
  stop condition above.

## O16 — the local verification baseline is red for one missing devDependency; it is closed centrally, not in ten plans

Surfaced by MSP-0/MSP-5 planning, which measured it on an unmodified copy of the tree.

Evidence, re-established at the orchestrator:

- `yaml` is a devDependency (`package.json:30`, `^2.9.0`), imported by exactly one file,
  `test/contract/workflow-hardening-census.test.ts:6`.
- `node_modules` is TRACKED — `git ls-files node_modules` returns 3799 files and `.gitignore`
  carries no `node_modules` entry — but `git log --all -- node_modules/yaml` is empty, so `yaml`
  has never been committed at any commit on any ref.
- `git status --porcelain node_modules` returns zero changes, so nothing in this session altered
  it. The gap is pre-existing, not damage.
- Every CI job runs `npm ci --ignore-scripts` (`.github/workflows/rebuild.yml`,
  `.github/workflows/receipts.yml`), which installs the full devDependency set. **CI is green.**
  A local checkout that has not run an install is red on BOTH `npm test` and `npm run typecheck`,
  the latter because `tsconfig.json` compiles `test/**/*.ts` and `tsc` cannot resolve `yaml`.

**Ruled: the gap is closed once, centrally, before any implementation begins.** It is not encoded
as a workaround into ten plans, and no plan weakens its pass condition to accommodate it.

Rejected: each plan expressing its pass condition as "the failure set matches the baseline". That
converts a real gate into a comparison against a known-broken state, which is exactly the shape
invariant I6 exists to prevent, and it would have every MSP ship an `unverified-reasoned`
downgrade for a reason unrelated to its own change.

Rejected: any plan editing, skipping or deleting `workflow-hardening-census.test.ts`. That is the
canonical reward-hack the receipts standard blocks at G11.

Therefore, in every plan:

- Section 8 states `npm test` and `npm run typecheck` as ordinary gates expecting exit 0. Write
  them plainly.
- Section 11 gains this stop condition, verbatim:

      If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
      described by the orchestrator is not yet closed in this checkout. STOP and report.
      Do not edit, skip or delete that test, and do not install anything yourself.

The closing act itself is the operator's, because this repository deliberately tracks
`node_modules` and the choice between committing `yaml` into it and installing it as a dev-only
dependency is a repository-convention decision no planner or implementer may take.

## O1a — amendment to O1: MSP-4 split, so the baseline shifts by one below it

MSP-3 measured at 382 changed lines and does NOT split. MSP-4 measured at 561 combined and DOES,
into A (161 lines, the cap-refusal repair) and B (404 lines, the linking). Eleven merges, not ten.
The revised baseline:

| Order | MSP | Branch | Version from -> to |
| --- | --- | --- | --- |
| 1 | MSP-0 | `fix/msp-0-utf8-source-census` | 1.0.0 -> 1.0.1 |
| 2 | MSP-1 | `fix/msp-1-materialisation-stamp` | 1.0.1 -> 1.0.2 |
| 3 | MSP-2 | `fix/msp-2-cas-retry-reread` | 1.0.2 -> 1.0.3 |
| 4 | MSP-3 | `fix/msp-3-park-thread-refuses` | 1.0.3 -> 1.0.4 |
| 5 | MSP-4-A | `fix/msp-4-record-decision-links-a` | 1.0.4 -> 1.0.5 |
| 6 | MSP-4-B | `fix/msp-4-record-decision-links-b` | 1.0.5 -> 1.0.6 |
| 7 | MSP-5 | `fix/msp-5-guard-registry-check` | 1.0.6 -> 1.0.7 |
| 8 | MSP-6 | `fix/msp-6-sync-receipt-shas` | 1.0.7 -> 1.0.8 |
| 9 | MSP-8 | `fix/msp-8-published-descriptions` | 1.0.8 -> 1.0.9 |
| 10 | MSP-7 | `feat/msp-7-thread-lineage` | 1.0.9 -> 1.1.0 |
| 11 | MSP-9 | `docs/msp-9-continuity-rule` | 1.1.0 -> 1.1.1 |

The ladder still lands on `1.1.1`, because MSP-7's minor bump resets the patch to zero and so
absorbs any number of patch merges ahead of it. A further split would not change the landing
either. No plan needs re-authoring for this: ruling O6 already makes every version step a
read-then-increment against whatever `package.json` actually holds.

## O17 — MSP-4-B's 404 lines are accepted; do not reopen it

MSP-4-B authored at 404 changed lines against the 400 ceiling and disclosed the overshoot with
the two removals its author considered and rejected. Accepted as authored.

Defect-finding per line declines continuously with review size, with no cliff at any particular
number, so a one-percent overshoot is indistinguishable from the limit in review-quality terms,
while a third pull request costs a real branch, version bump, merge and green-branch obligation
for four lines. The disclosure stays in the plan; a reviewer who reads it should not reopen it.

## O18 — where splitting would destroy a red-on-parent receipt, the receipt wins and the ceiling yields

MSP-8 measured at 610 changed lines against the 400 ceiling and ruled no split. Accepted.

The ceiling exists to protect review quality. The red-on-parent acceptance test exists to prove
the fix works at all. When the two conflict, the receipt wins — a smaller pull request that can
no longer demonstrate its own defect has traded a real guarantee for a review convenience, and
the pillar order puts correctness above efficiency.

MSP-8 is inseparable for a specific, checkable reason. Its criterion 1 requires the description
census RED on the parent for `list_threads`, and that red exists only while `blocked_by` has no
writer. Ship the writer in an earlier pull request and criterion 1 becomes unsatisfiable in both
halves. The census cannot lead either, because a census that is red on its own branch breaks
invariant I1. Writer, corrections and census are therefore one atomic unit. The only genuinely
separable piece, the roster status token, is 91 lines and leaves 519 behind — still over, for the
cost of a second branch, bump and merge.

Composition is disclosed rather than averaged away: of the 610 lines, **45 are production code**
and 565 are tests and census machinery, whose per-line review burden is not comparable.

**The obligations this creates, and they are not optional:**

- The plan states the measured number and the production/test split in its own body.
- The pull request body says the diff is large, gives the split, and names the reason it is not
  divisible. A reviewer must learn the size from the PR, never from the Files Changed tab.
- The number is MEASURED, never estimated. Two leads have now corrected a line count they first
  stated as fact — 424 to 382, and 341 to 610. **State a count only after measuring the applied
  diff.** An estimate written into a plan as fact is a defect in the plan.

This ruling does not license a large diff generally. It licenses one where a split is shown to
break a declared acceptance criterion, and the showing is written down.

## O1b — two section-0 baselines predate the split and are cosmetic; the read-then-increment governs

MSP-5 and MSP-7 were finished before MSP-4's split shifted the ladder, so their identity sections
still declare the pre-split baselines: MSP-5 states `1.0.5 -> 1.0.6` where O1a now says
`1.0.6 -> 1.0.7`, and MSP-7 states `1.0.8 -> 1.1.0` where O1a now says `1.0.9 -> 1.1.0`.

**Neither is a defect and neither plan is re-authored.** Ruling O6 exists for exactly this: the
version step in both is a read-then-increment against whatever `package.json` actually holds, and
both plans state in their own words that a higher starting version means the ladder shifted and is
NOT a stop condition. MSP-7's target is correct under either baseline anyway, because a minor bump
zeroes the patch.

Verified across all eleven plans at the close of planning: every branch name matches O1a exactly,
and every version step is a read-then-increment. This note exists so a reviewer comparing a plan's
label against O1a does not chase a discrepancy that the mechanism already absorbs.
