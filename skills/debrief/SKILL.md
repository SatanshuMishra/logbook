---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Gather what this session landed, by naming which goals moved and what their checks returned, what was verified rather than assumed, and what was started and where exactly it stopped.
3. Gather the next action a later session takes first, specific enough to begin without re-deriving anything, naming the file and the place in it for an action that involves one, and stated as an action rather than as a goal or a phase name.
4. Gather the record of the thread this session worked, read from logbook://thread/ followed by the thread id: the completion criteria it shows as open, and each risk it lists under Open risks with the criterion or the whole thread that risk bears on.
5. Gather the id of a completion criterion that record shows as open that the next action advances, or no id for an action that advances no single criterion.
6. Gather the risks this session found, each with a short scope naming the area it concerns, and each paired with the id of a completion criterion that record shows as open that it threatens, or with null for a risk that bears on the whole thread.
7. Gather, among the found risks, each one that an open risk bearing on the same criterion, or on the whole thread alike, already states in other words, and set it aside in favour of that open risk.
8. Gather the open risks this session showed to be over, and each open risk that repeats another open risk bearing on the same criterion, or on the whole thread alike, in other words, keeping the clearer one of each pair.
9. Call `update_thread` with `update_thread.thread_id` set to the thread this session worked, `update_thread.risks_add` carrying the found risks that were not set aside, each with its text, its scope and its criterion_id, and `update_thread.risks_retire` carrying the open risks gathered as over or repeated.
10. Print the returned `update_thread.risks_added`, `update_thread.risks_already_present` and `update_thread.risks_retired`.
11. Print the refusal text `update_thread` returns in place of those fields, alongside the found risks and the open risks gathered as over or repeated, so the risks this session found survive a refused call.
12. Call `park_thread` with `park_thread.outcome` set to the summary followed by any update_thread refusal text and the risks printed with it, `park_thread.landed` set to what landed, `park_thread.next_step` set to the next action, and `park_thread.next_step_criterion_id` set to the criterion id that action advances, left out for an action that advances no single criterion.
13. Print the returned `park_thread.status` and the returned `park_thread.spine_fields_updated`.
14. Print the refusal text `park_thread` returns in place of a status.
15. Print the summary, the landing and the next action alongside that refusal text, so the record of this session survives a refused call.
16. Stop.
