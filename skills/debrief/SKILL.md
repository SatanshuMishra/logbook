---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Gather what this session landed, by naming which goals moved and what their checks returned, what was verified rather than assumed, and what was started and where exactly it stopped.
3. Gather the next action a later session takes first, specific enough to begin without re-deriving anything, naming the file and the place in it for an action that involves one, and stated as an action rather than as a goal or a phase name.
4. Call `park_thread` with `park_thread.outcome` set to the summary, `park_thread.landed` set to what landed, and `park_thread.next_step` set to the next action.
5. Print the returned `park_thread.status` and the returned `park_thread.spine_fields_updated`.
6. Print the refusal text `park_thread` returns in place of a status.
7. Print the summary, the landing and the next action alongside that refusal text, so the record of this session survives a refused call.
8. Stop.
