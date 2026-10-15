# test-cost-and-live-value: Cut the test suite's cost and keep only tests that prove live behaviour
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c5 D2 R1 S1

## Goal

CI spends 15 to 21 minutes on every pull request, and one test accounts for nearly all of it. Find out which tests actually protect behaviour a user of logbook would observe, cut the ones that do not, and bring the suite back to a cost proportionate to what it proves, without losing the properties the expensive tests currently guard.

## Done when

- [x] c1 Every test kept in the suite names the observable behaviour it protects, and every test that names none is deleted evidence: docs/audits/2026-09-16-test-suite-audit.md on main at adbc63f3 lists every test file: 169 rows against 169 files on disk, 0 absent, checked programmatically against the tree after merge. Each row names the observable behaviour in a user's terms, the door the test reaches it through, and a keep or delete verdict against four named deletion rules. All 169 are keep; no rule fired, so no test was deleted. Not observed: thirteen large files were sampled by imports, test names and excerpts rather than read end to end, and are marked sampled in the table, so their keep verdicts are a floor rather than a proof; five rows carry an unsure; subsumption across directories was not assessed; no verdict rests on running or mutating shipped code.
- [x] c2 The suite's cost is proportionate: no single test takes longer than every other test in its layer combined evidence: Ran each tier with the tap reporter on main at adbc63f3 and compared the slowest test's duration_ms against the sum of the rest, as the check states. unit 4060.5 vs 14571.3 (0.28); store 8740.8 vs 54798.5 (0.16); contract 38715.2 vs 64290.4 (0.60); sync 4014.8 vs 65036.8 (0.06); spawn 24672.6 vs 291224.3 (0.08); hooks 1791.4 vs 22523.0 (0.08); lint 2960.9 vs 26889.3 (0.11). Every tier below 1.00, zero failures in each. Before this work the unit layer's slowest test was 231.1s against about 5s for the rest. Scope, per decision 01M2MNM2MY50RATYW6PMJ4DY1E chosen by the human: c2 governs the tiers a pull request pays for. test/scheduled is outside it; it holds exactly one test, the generated sweep at about 225s, so its ratio is unbounded by construction, and that tier exists to keep that test off the gate. Not observed: test/scheduled was counted rather than run for this check; contract at 0.60 is the tier closest to the line and nothing here guards it against a future test pushing it over.
- [x] c3 A pull request's CI finishes in under five minutes of wall clock evidence: gh run view on ci run 35072814116 for pull request 272: lint 35s, typecheck 21s, test (26.x) 180s, test (24.x) 179s, inspector 14s, test (22.19.x) 204s. Every job under 300 seconds and every job succeeded. Pull request 268 measured the slowest job at 3m19s against 21m45s before this work. Not observed: pull requests other than 268, 271 and 272.
- [x] c4 The properties the frontier sweep guards still fail the suite when the renderer breaks them evidence: Deep workflow run 35073282373 on main at adbc63f3, job seeded-mutation, printed: killed escape-treats-an-ordinary-space-as-extraordinary; killed an-over-budget-render-reports-itself-as-fitting; killed risk-text-clips-below-its-guaranteed-floor; killed the-first-live-risk-is-never-rendered; all 4 mutants were killed. The three classes this criterion names each turned the unit layer red: an over-budget render reported as fitting, a field shortened below its floor, and a rendered item dropped. Each mutant is a one-token edit applied alone and restored before the next. Not observed: boundary-conditional mutants. Every mutant here breaks its property at every input shape, so this does not show the pinned sweep catches a defect that appears only at a boundary; the scheduled generated sweep covers that, on trunk.

## Where things stand

Converted from the old ledger.

## Next step

Decide the fate of the frontier sweep at test/unit/briefing-frontier-sweep.test.ts:546: whether its generated grid and frontier search can be replaced by a small set of fixed boundary cases that still fail when the renderer drops an item, breaks a floor, or hides a budget breach.

## Decisions in force

- D1 c2 governs the tiers a pull request pays for, not the scheduled tier: c2 governs the gate tiers only, chosen by the human. The criterion exists because a pull request waited 22 minutes on one test, so its subject is what a pull request pays. The scheduled tier is the mechanism that moved the expensive test off that path, and reading c2 across it would make the fix itself the violation. Splitting the scheduled sweep into several tests to satisfy the letter was rejected as restructuring a test to pass a metric. The wording is left as it stands and this record carries the reading.

## Open risks

## Settled, do not reopen

## Where the details live

- the CI workflow whose jobs are slow: .github/workflows/rebuild.yml
- the frontier sweep, 249.9s of the unit layer's 250s: test/unit/briefing-frontier-sweep.test.ts
- the sweep's generated fixture: test/support/briefing-sweep-fixture.ts
- Old ledger record: thread 01M2MCZHA78N2MD45HHT9TSYSK in refs/logbook/archive/ledger
