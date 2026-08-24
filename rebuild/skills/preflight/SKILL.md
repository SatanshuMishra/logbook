---
name: preflight
description: Use at the start of work to pick up an existing thread.
---

## Sequence

1. Call `list_threads`.
2. Present the returned `list_threads.threads` as a roster.
3. Wait for the human to choose one thread from that roster.
4. Call `resume_thread` with `resume_thread.thread_id` set to the chosen thread id.
5. Print the returned `resume_thread.briefing` verbatim.
6. Stop.
