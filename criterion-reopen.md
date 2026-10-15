# criterion-reopen: Reopen a done completion criterion with a recorded reason
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c4 D3 R1 S1

## Goal

Let a criterion marked done be reopened through amend_criteria with a required decision_id, keeping its id and its earlier result as history, so risks, key decisions and the next step anchored to it return to the live view; then have the debrief reopen a criterion that a found risk shows incomplete.

## Done when

- [x] c1 amend_criteria reopens a done criterion only with a recorded decision, keeping its id and its earlier result readable. evidence: Run live through the installed 11.1.0 plugin against this project's own ledger, whose records predate reopened_by. Reopen returned the same criterion id; the stored record then read done false, reopened_by set to decision 01M2M62KQ37G81SMWDXBEXTTQH, and the earlier result and result_status preserved, while the other two criteria kept no reopened_by field at all. The briefing rendered it [reopened] with that earlier result beside it. A second reopen was refused naming criterion_id and a reopen carrying an unresolvable decision was refused naming decision_id.
- [x] c2 Risks and a next step anchored to a reopened criterion return to the live view of the briefing. evidence: The spawn test anchors a risk and next_step_criterion_id to a criterion, marks it done, asserts the risk falls to the settled lane, reopens it, and asserts the risk renders under Open risks and the briefing narrows back to that criterion. Red against unchanged source, green after.
- [x] c3 The debrief skill reopens a criterion that a found risk shows incomplete instead of recording a whole-thread risk. evidence: skills.test.ts asserts the debrief gathers risks on criteria the record shows as done, records a decision, calls amend_criteria reopen carrying it, then calls update_thread risks_add; skill.cannot-strand drives that sequence end to end against a live server.

## Where things stand

Converted from the old ledger.

## Next step

Decide whether to close this thread; all three criteria are done and the reopen operation is verified live at 11.1.0.

## Decisions in force

- D1 The reopen spec has no merge-rule step; a done criterion against a reopened one is settled by review: Drop it. Two clones that both change one thread's criteria now produce a single conflict on that thread file, and the reviewer composes the record with each criterion done or reopened as it should read, which is exactly what a rule would have had to decide for them. The spec still owes the stored shape of the earlier result, the refusals, the briefing lanes and the debrief step. The blocker is cleared: nothing this thread plans now touches a file resolve-conflict-repairs owned, and that work is released in 11.0.0.
- D2 Reopen c1 to test the shipped reopen against this project's own ledger: Reopen c1 against this thread's own record. The gap is exactly what c1 claims, so the honest move is to reopen the criterion rather than record a risk beside it, and a throwaway thread would not exercise a record written before the field existed. c1 is marked done again on what the live run returns.

## Open risks

## Settled, do not reopen

## Where the details live

- debrief PR whose placement this replaces: https://github.com/SatanshuMishra/logbook/pull/259
- spec the deferral came from: docs/specs/2026-09-11-deferred-cap-items.md
- the reopen PR: https://github.com/SatanshuMishra/logbook/pull/263
- the reopen spec: docs/specs/2026-09-15-criterion-reopen.md
- Old ledger record: thread 01M2K3JHTD9RYEWTV0QXHD2FR7 in refs/logbook/archive/ledger
