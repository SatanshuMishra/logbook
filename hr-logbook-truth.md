# hr-logbook-truth: Harness redesign run 5: logbook tells the truth about holds, working copies and test homes
Status: active
Updated: 2026-10-28T06:38:26.256Z
Next ids: c4 D3 R2 S1

## Goal

Run 5 of the harness-redesign program (~/.mitosis/harness-redesign/PROGRAM.md, standard lane): a hold left by an ended session is released at the next session start, the briefing names any difference between a working copy and its committed copy, and no test writes under the real HOME, each proven by a locked test written before the build.

## Done when

- [ ] c1 G1: a hold whose session has ended is released at the next session start; proof: a test where a thread is held by a session that ended sees the hold released when a new session starts.
- [ ] c2 G2: the briefing compares the working copy of a state document with the committed copy and names any difference instead of showing a stale next step; proof: a test that edits the working copy without committing sees the briefing name the difference.
- [x] c3 G3: tests never write under the real HOME; proof: a test fails when any test writes under the real HOME. evidence: the locked test/lint/home-isolation.test.ts (census, fixture proof and empty-HOME child suite) passes alone at test-home head 4442351d, and test-home's review is green.

## Where things stand

holds-and-pickup round 1 verdict is loop at 0cc48949: blockers C1, C2 and S1 share one cause (a live session's hold can lack a live process, since only the server records one and only the resume hook takes a hold back) and are all diagnosed fixable; advisories C3, C4 and S2; C5 rejected. Fix attempt 1 (O5) is committed on mitosis/holds-and-pickup at 103c90cb (receipts in test/spawn/tools/hold-take-back.test.ts; suite 523 of 523; ten locked tests pass) and merged into test-home at 4442351d. Round 2 code and security review of holds-and-pickup is running on the fix (O6), and test-home's suite and locked checks are running at 4442351d. test-home is green, its advisory C1 fixed at 0621c6e6. Both heads pass 516 of 516 suite tests and all eleven locked tests pass at test-home's head. Because the brief lane did not fit, the request runs the full review loop, still without an interview. The checkout's uncommitted receipts.config.json and untracked .lighthouse/ belong to someone else and stay untouched; GLOSSARY.md's uncommitted Hold and Roster terms are this run's and ship with the first MSP.

## Next step

Collect round 2 findings for holds-and-pickup, validate and record them; if green, run rerun-plan for both MSPs and ship.

Needs: D1.

## Decisions in force

- D1 interphase hand-off: build hold liveness, working-copy differences and test-home isolation as two MSPs: Process liveness, with a 24-hour transcript rule only for holds from the earlier release; G2 names differing parts via a shared changedParts; G3 is a lint census plus a child-suite backstop. Two MSPs: holds-and-pickup (Steps hold-liveness, working-copy-difference) and test-home.
- D2 Stack test-home on holds-and-pickup: Merged at 4c046142; test-home is stacked on holds-and-pickup, reviewed on the range mitosis/holds-and-pickup...mitosis/test-home.

## Open risks

- R1 Commits in this run pass receipts' tripwire through its RECEIPTS_ACK acknowledgement rather than a receipt, because the receipts CLI is not on agents' PATH; each use is an I6 assumption in review/<msp>.assumptions.txt and goes to the final report.

## Settled, do not reopen

## Where the details live

- Program: ~/.mitosis/harness-redesign/PROGRAM.md (intent I1 to I6, contracts K1 to K7, overrides O1 to O10; this is run 5 of the harness-redesign program, Wave A beside run 1 VMLab)
- Audit evidence: ~/.mitosis/harness-redesign/audit/vmlab-logbook.md, logbook section
- Worked example of the overrides: ~/.mitosis/VMLab/hr-vmlab-capabilities/ (CHARTER.md, worker-rules.txt, run.zsh, receipts-lock.txt)
- Spec, decisions, record and items: docs/specs/hr-logbook-truth.{md,decisions.md,record.json,items.json} in this checkout
- Run home: ~/.mitosis/logbook/hr-logbook-truth (CHARTER.md with the Locked list, run.zsh, worker-rules.txt, receipts-lock.txt, review/, rounds.md with one verdict line per MSP round)
- Round 1 review record, verdicts and diagnoses: ~/.mitosis/logbook/hr-logbook-truth/review/round-1/
