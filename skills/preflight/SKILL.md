---
name: preflight
description: Use at the start of work to pick up an existing thread and continue it from its state document.
---

## Sequence

1. Call `resume_thread` with `thread_id` set to the slug the user named at invocation.
2. When the user named no slug, call `list_threads` first, choose from its roster the thread the work belongs to, asking the user to pick one from that roster when nothing they said settles it, and then call `resume_thread` with that thread's slug.
3. The reply puts the thread's state document into your context, so never print the document or any part of it.
4. Tell the user in one sentence which thread you resumed and its next step.
5. Continue the work from that next step.
