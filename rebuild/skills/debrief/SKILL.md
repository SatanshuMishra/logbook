---
name: debrief
description: Use when wrapping up work, at session hand-off.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Call `park_thread` with `park_thread.outcome` set to that summary.
3. Print the returned `park_thread.status`.
4. Stop.
