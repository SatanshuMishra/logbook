# Implementation plan: the suite costs what it proves

Date: 2026-09-16
Spec: `docs/specs/2026-09-16-test-cost-and-live-value.md`
Thread: `01M2MCZHA78N2MD45HHT9TSYSK`
Base: `main` at `14270097`

---

## How this is split

Three pull requests, cut so that no two touch the same file. That is the whole basis for the split: this repository merges rather than rebases, and a human gate means a branch can sit open while another lands.

| PR | Sections | Files it touches | Depends on |
|---|---|---|---|
| A | 3, 5 | `test/spawn/completions.test.ts`, `bin/logbook-cli.ts`, `docs/registers/size-limits.json`, `README.md` | nothing |
| B | 1, 2, 6 | the sweep test and its fixture, 24 moved test files, `package.json`, `.github/workflows/rebuild.yml` | nothing |
| C | 4 | `evals/**`, a new workflow file | nothing |

A and B may run in parallel. C is last because it is the only one that costs money to verify.

Sections 1, 2 and 6 travel together because all three touch `rebuild.yml` and the test globs, and splitting them would mean resolving the same conflict twice.

---

## PR A: seed counts and the dead entry point

One commit per section. Both are small and independently revertible.

### A1 — Section 3

In `test/spawn/completions.test.ts`, declare the cap as a named constant whose name carries its provenance, the MCP SDK rather than this repository. Seed `cap + 1`. Leave the three assertions alone; `total` now reads the seeded count.

Verify: `completion.is-bounded` passes at `cap + 1` and fails at `cap`, because `hasMore` goes false. Run the failing case by hand once and restore, rather than committing it.

### A2 — Section 5

Delete `bin/logbook-cli.ts`. Delete its two rows from `docs/registers/size-limits.json`, leaving 86. Rewrite `README.md:76` so it names one entry point.

Verify: `contract.limits-register-census` and `contract.readme-promises-census` green, which together prove no orphan register row, no unregistered live site, and no README promise disturbed.

**PR A is done when** the spawn and contract layers are green and `completion.is-bounded` is under 30 seconds.

---

## PR B: the gate gets fast

Three commits, in this order, because each one changes what the next one measures.

### B1 — Section 1, the sweep

Replace the generated grid and both searches with a pinned table of shapes.

The design constraint that matters: a pinned coordinate can silently stop being a boundary when a cap moves, and a test that silently stops testing the boundary is worse than the slow one it replaced. So every pinned row declares the outcome it is supposed to produce, and the test asserts that it produced it. A cap change then fails loudly and names the row.

Rows are chosen to keep the coverage the grid had, not to sample it:

- all three fills, ascii, cjk and delimiter, because the byte-versus-character divergence is the reason the fill dimension exists
- both anchorings
- criteria counts at 0, `CRITERIA_MAX_ELEMENTS` where the rendered list saturates, and `CRITERIA_RETENTION_MAX_ELEMENTS`
- key-decision counts at 0 and `KEY_DECISIONS_MAX_ELEMENTS`
- bulk counts at 0 and the saturating count for that shape
- criterion text at 0, the clip frontier and its two neighbours, and the largest the record cap admits

The five properties keep their existing assertions unchanged, and the both-sides-of-the-budget coverage checks stay. `briefing.frontier-sweep-one-risk-with-several-references-counts-as-one-item` is already fixed and is not touched.

Verify: the unit layer under 10 seconds, and each of the three mutants from the spec's problem table still reddens it, applied one at a time with the tree restored between.

### B2 — Section 2, the lint move

`git mv` the 24 files the spec names into `test/lint/`. Add an npm script naming `test/lint/**`. Add a CI job that runs it. No file is deleted and no assertion is weakened.

Verify: the union of the files named by `npm test` and by the lint script equals the set before the move, with nothing dropped and nothing counted twice. Check this by listing both globs rather than by eye.

### B3 — Section 6, the workflow

Remove the `seeded-mutation` job from the pull-request path. Add a scheduled workflow with two jobs: the generated sweep B1 removed from the gate, which fails if a pinned constant no longer sits where the search puts it, and a mutation run.

The scheduled sweep is written first and proved to run before the gate loses its sweep, so there is no window where the coverage exists in neither place.

**PR B is done when** every job on the pull-request path is under five minutes and the full suite is green.

---

## PR C: the seam eval

`evals/preflight-records-nothing/` with `prompt.md` invoking the preflight skill, and graders asserting that `resume_thread` was called and that the turn ended without a block.

This is the one section whose done-when cannot be met without spending: every eval case and every judge grader is a billed model call. The case must fail against `main` at `14270097` to be worth anything, and a case that has never been run has proved nothing.

So PR C ships the suite and the workflow, and says plainly in its body that the case is unrun. Whether to spend on the first run is the repository owner's call, not this plan's.

---

## Risks

**The pinned sweep stops testing the boundary.** Mitigated by every row declaring its expected outcome, and by the scheduled generated sweep that recomputes the coordinates. If both of those are somehow wrong at once, the coverage is lost silently. This is the single largest risk in the plan and the reason B3 lands before the gate loses its sweep.

**The lint move drops a file.** Mitigated by comparing glob populations before and after rather than trusting the move.

**`git mv` across 24 files hides a rename as an add plus a delete** in review. Mitigated by making B2 its own commit containing nothing else.

**The three mutants are all unconditional**, so they prove the pinned set catches defects that break a property at every shape. They do not prove it catches a defect that breaks a property only at a boundary. The scheduled sweep is what covers that, and it covers it a day late rather than at the gate. Stated, accepted, not solved.

**`npm ci` rewrites tracked files.** `node_modules` is committed in this repository. No step here installs anything.

---

## What this plan does not do

Everything in the spec's Deferred list, unchanged: the `.control.*` population, the renderer concentration beyond what Section 1 removes, re-homing the layers by resource size, `roster.paginates`, and the audit document.
