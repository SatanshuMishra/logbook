---
name: file
description: Use at the start of work to open a new thread and its state document.
---

## Sequence

1. Gather what the work is, the action that comes next, and what must be true for the work to be done.
2. Call `open_thread` with `slug` set to a short name of lowercase letters, digits and hyphens, `title` set to a one-line name for the work, `goal` set to what the work is, `next_step` set to the action that comes next, and `criteria` set to what must be true for the work to be done, one entry each.
3. Add `details` to that call, one entry each, when there are pointers to where the details live, such as the path of a spec.
4. Tell the user in one sentence which thread you opened and the path of its state document.
5. Continue the work, keeping that document true by editing it with the Edit tool when logbook asks.
