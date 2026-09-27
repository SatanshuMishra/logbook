---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what this session established that the ledger does not hold yet: each selection between options, and each fact a later session would otherwise have to work out again. Leave out everything this session already recorded, in any wording, and everything the next action in step 13 will say.
2. Call `record_decision` for each selection between options gathered in step 1.
3. Gather the risks this session found, each with a short scope naming the area it concerns, and each paired with the id of a completion criterion the briefing shows as open that it threatens, or with null for a risk that bears on the whole thread.
4. Gather, among the found risks, each one that an open risk bearing on the same criterion, or on the whole thread alike, already states in other words, and set it aside in favour of that open risk.
5. Gather the open risks this session showed to be over, and each open risk that repeats another open risk bearing on the same criterion, or on the whole thread alike, in other words, keeping the clearer one of each pair.
6. Gather the risks this session found that bear on a criterion the briefing shows as done, each paired with that criterion id.
7. Call `record_decision` recording the reopening of those criteria and the reason each one is reopened.
8. Call `amend_criteria` with `amend_criteria.operation` set to reopen, `amend_criteria.criterion_id` set to one of those criterion ids, and `amend_criteria.decision_id` set to the id that `record_decision` returned, once for each of them.
9. Call `update_thread` with `update_thread.thread_id` set to the thread this session worked, `update_thread.risks_add` carrying the found risks that were not set aside, each with its text, its scope and its criterion_id, and `update_thread.risks_retire` carrying the open risks gathered as over or repeated.
10. Print the returned `update_thread.risks_added`, `update_thread.risks_already_present` and `update_thread.risks_retired`.
11. Print the refusal text `update_thread` returns in place of those fields, alongside the found risks and the open risks gathered as over or repeated, so the risks this session found survive a refused call.
12. Call `log_session_event` once with the facts gathered in step 1 that are not a decision, followed by any refusal text printed in step 11 and the risks printed with it, and skip this call for a session holding none of these.
13. Gather the next action a later session takes first, specific enough to begin without re-deriving anything, naming the file and the place in it for an action that involves one, and stated as an action rather than as a goal or a phase name.
14. Call `search_ledger` to find the records that next action needs: decisions, risks, criteria and session entries about the files and subjects it touches, on this thread and on every other thread, closed ones included, searching with more than one wording.
15. Gather the ids of the records that next action needs, including this session's entries that hold the state the action continues from.
16. Call `park_thread` with `park_thread.next_step` set to the next action and `park_thread.next_step_records` set to those ids, sending no outcome and no landed.
17. Print the returned `park_thread.status` and the returned `park_thread.step_records`.
18. Print the refusal text `park_thread` returns in place of a status, alongside the next action and the record ids, so they survive a refused call.
19. Stop.
