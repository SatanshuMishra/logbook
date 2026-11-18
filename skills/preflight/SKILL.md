---
name: preflight
description: Use at the start of work to pick up an existing thread and continue it from its state document.
disable-model-invocation: true
---

## Sequence

1. When logbook already put the thread's state document in your context at session start, continue from it with no call.
2. Otherwise run `logbook resume_thread --args '{"thread_id":"<slug>"}'` in Bash, which is the `resume_thread` command, with the slug the user named at invocation.
3. When the user named no slug, choose the thread the work belongs to from the roster logbook put in your context at session start, or from `list_threads`, asking the user to pick one only when nothing settles it.
4. The state document is in your context to work from, so never print the document or any part of it.
5. Tell the user in one sentence which thread you resumed and its next step.
6. Continue the work from that next step.
