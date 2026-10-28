# hr-logbook-truth: Harness redesign run 5: logbook tells the truth about holds, working copies and test homes
Status: parked
Updated: 2026-10-28T08:14:36.917Z
Next ids: c4 D4 R2 S1

## Goal

Run 5 of the harness-redesign program (~/.mitosis/harness-redesign/PROGRAM.md, standard lane): a hold left by an ended session is released at the next session start, the briefing names any difference between a working copy and its committed copy, and no test writes under the real HOME, each proven by a locked test written before the build.

## Done when

- [x] c1 G1: a hold whose session has ended is released at the next session start; proof: a test where a thread is held by a session that ended sees the hold released when a new session starts. evidence: the five locked hold-liveness tests and the two hold-process tests pass at holds-and-pickup head 662ce341 (suite 526 of 526), and review round 3 is green
- [x] c2 G2: the briefing compares the working copy of a state document with the committed copy and names any difference instead of showing a stale next step; proof: a test that edits the working copy without committing sees the briefing name the difference. evidence: the three locked working-copy-difference tests pass at holds-and-pickup head 662ce341 (suite 526 of 526), and review round 3 is green
- [x] c3 G3: tests never write under the real HOME; proof: a test fails when any test writes under the real HOME. evidence: the locked test/lint/home-isolation.test.ts (census, fixture proof and empty-HOME child suite) passes alone at test-home head 4442351d, and test-home's review is green.

## Where things stand

Integration is in its second lighthouse run: run 1 found one failure (U1, list_threads structured output did not carry the working-copy difference), diagnosed fixable and fixed on feat/hr-logbook-truth at 6aa93068 (receipt test 42d4903c), pushed; lighthouse run 2 retests from run 1 into the run home's lighthouse/run-2. A narrowed take-back race remains in takeBackHolds (its re-check and takeHold's write use separate reads); the validator rejected it as not introduced by the last round, so it does not block and goes to the final report. The checkout's uncommitted receipts.config.json and untracked .lighthouse/ belong to someone else and stay untouched.

## Next step

Read lighthouse run 2's launch.json; on green it has opened the FEATURE pull request, otherwise record its failures as integration round 2 and fix them in ~/.mitosis/runs/logbook/hr-logbook-truth/integration.

## Decisions in force

- D1 interphase hand-off: build hold liveness, working-copy differences and test-home isolation as two MSPs: Process liveness, with a 24-hour transcript rule only for holds from the earlier release; G2 names differing parts via a shared changedParts; G3 is a lint census plus a child-suite backstop. Two MSPs: holds-and-pickup (Steps hold-liveness, working-copy-difference) and test-home.

## Open risks

- R1 Commits in this run pass receipts' tripwire through its RECEIPTS_ACK acknowledgement rather than a receipt, because the receipts CLI is not on agents' PATH; each use is an I6 assumption in review/<msp>.assumptions.txt and goes to the final report.

## Settled, do not reopen

## Where the details live

- Program: ~/.mitosis/harness-redesign/PROGRAM.md (intent I1 to I6, contracts K1 to K7, overrides O1 to O10; this is run 5 of the harness-redesign program, Wave A beside run 1 VMLab)
- Audit evidence: ~/.mitosis/harness-redesign/audit/vmlab-logbook.md, logbook section
- Worked example of the overrides: ~/.mitosis/VMLab/hr-vmlab-capabilities/ (CHARTER.md, worker-rules.txt, run.zsh, receipts-lock.txt)
- Spec, decisions, record and items: docs/specs/hr-logbook-truth.{md,decisions.md,record.json,items.json} in this checkout
- Run home: ~/.mitosis/logbook/hr-logbook-truth (CHARTER.md with the Locked list, run.zsh, worker-rules.txt, receipts-lock.txt, review/, rounds.md with one verdict line per MSP round)
- Review records, verdicts and diagnoses per round: ~/.mitosis/logbook/hr-logbook-truth/review/round-<n>/; test-home's green-head suite and slow-check runs: review/green/
- Ship result with each pull request's title and body: ~/.mitosis/logbook/hr-logbook-truth/ship-1.json
