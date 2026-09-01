---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Gather the next step a later session picks up, as one plain sentence.
3. Call `park_thread` with `park_thread.outcome` set to that summary and `park_thread.next_step` set to that sentence.
4. Print the returned `park_thread.status` and the returned `park_thread.spine_fields_updated`.
5. Print the refusal text `park_thread` returns in place of a status.
6. Print the summary from step 1 and the sentence from step 2 alongside that refusal text, so the record of this session survives a refused call.
7. Stop.
