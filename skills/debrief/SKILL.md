---
name: debrief
description: Use at session hand-off to bring the thread's state document up to date and park the thread.
---

## Sequence

1. Read the working copy of the thread's state document, at the path logbook gave, when it is not already in your context.
2. Bring the working copy up to date with the Edit tool under the update rules: describe the present only, with finished work as one line naming where its proof is; tick a criterion only with "evidence: <what proves it>"; record what was decided under Decisions in force, with its reason; remove each decision or risk that no longer constrains future work, or move it to Settled, do not reopen; and end with a "## This update" section holding one line saying what changed and one line "Removed: <id> because <reason>" for each id removed.
3. Never print the document or any part of it.
4. Gather the next action a later session takes first, specific enough to begin without working anything out again, naming the file and the place in it when it involves one.
5. Call `park_thread` with `next_step` set to that action.
6. When `park_thread` refuses with violations in the working copy, fix each one with the Edit tool and call `park_thread` again.
7. Tell the user in one sentence that the thread is parked and what its next step is.
