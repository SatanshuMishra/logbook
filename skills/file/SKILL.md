---
name: file
description: Use at the start of work to open a new thread.
---

## Sequence

1. Gather what the work is, the action that comes next, what finishing looks like for the parts already settled, and what has happened in this session so far.
2. Call `open_thread` with `open_thread.active_goal` set to what the work is, `open_thread.next_step` set to the action that comes next, and `open_thread.completion_criteria` carrying the parts of finishing that are already settled.
3. Present the criteria the reply returns, one line each, naming the party standing behind it.
4. Wait for the human to name which of those criteria they stand behind and in whose words.
5. Call `update_thread` with `update_thread.criteria_settled` carrying that answer.
6. Call `log_session_event` with `log_session_event.body` set to what happened in this session before the thread existed.
7. Call `resume_thread` with `resume_thread.thread_id` set to the id the opened thread returned.
8. Print the returned `resume_thread.briefing` verbatim.
9. Stop.
