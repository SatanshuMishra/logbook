# hr-logbook-truth: Harness redesign run 5: logbook tells the truth about holds, working copies and test homes
Status: active
Updated: 2026-10-28T06:02:37.035Z
Next ids: c4 D2 R1 S1

## Goal

Run 5 of the harness-redesign program (~/.mitosis/harness-redesign/PROGRAM.md, standard lane): a hold left by an ended session is released at the next session start, the briefing names any difference between a working copy and its committed copy, and no test writes under the real HOME, each proven by a locked test written before the build.

## Done when

- [ ] c1 G1: a hold whose session has ended is released at the next session start; proof: a test where a thread is held by a session that ended sees the hold released when a new session starts.
- [ ] c2 G2: the briefing compares the working copy of a state document with the committed copy and names any difference instead of showing a stale next step; proof: a test that edits the working copy without committing sees the briefing name the difference.
- [ ] c3 G3: tests never write under the real HOME; proof: a test fails when any test writes under the real HOME.

## Where things stand

The first mitosis build (two MSPs: holds-and-pickup, test-home) is running from feat/hr-logbook-truth, whose head 52622d6a holds the five locked acceptance files; all eleven locked tests fail there for the absent behaviour, and the receipt lock is in the run home's receipts-lock.txt. Because the brief lane did not fit, the request runs the full review loop, still without an interview. The checkout's uncommitted receipts.config.json and untracked .lighthouse/ belong to someone else and stay untouched; GLOSSARY.md's uncommitted Hold and Roster terms are this run's and ship with the first MSP.

## Next step

When the build ends, read mitosis's last JSON line in build-1.log, run the locked checks at each MSP head, then start review round 1 per MSP.

Needs: D1.

## Decisions in force

- D1 interphase hand-off: build hold liveness, working-copy differences and test-home isolation as two MSPs: Process liveness, with a 24-hour transcript rule only for holds from the earlier release; G2 names differing parts via a shared changedParts; G3 is a lint census plus a child-suite backstop. Two MSPs: holds-and-pickup (Steps hold-liveness, working-copy-difference) and test-home.

## Open risks

## Settled, do not reopen

## Where the details live

- Program: ~/.mitosis/harness-redesign/PROGRAM.md (intent I1 to I6, contracts K1 to K7, overrides O1 to O10; this is run 5 of the harness-redesign program, Wave A beside run 1 VMLab)
- Audit evidence: ~/.mitosis/harness-redesign/audit/vmlab-logbook.md, logbook section
- Worked example of the overrides: ~/.mitosis/VMLab/hr-vmlab-capabilities/ (CHARTER.md, worker-rules.txt, run.zsh, receipts-lock.txt)
- Spec, decisions, record and items: docs/specs/hr-logbook-truth.{md,decisions.md,record.json,items.json} in this checkout
- Run home: ~/.mitosis/logbook/hr-logbook-truth (CHARTER.md with the Locked list, run.zsh, worker-rules.txt, receipts-lock.txt, review/, rounds.md)
