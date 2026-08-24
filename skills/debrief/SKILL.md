---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Call `park_thread` with `park_thread.outcome` set to that summary.
3. Print the returned `park_thread.status`.
4. Stop.
