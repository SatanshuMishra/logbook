---
name: preflight
description: Use at the start of work to pick up an existing thread.
---

## Sequence

1. Gather the identifier the human names at invocation, an id, a slug, or a title, treating a bare number as no identifier since no roster has been printed yet and row order shifts with activity.
2. Call `list_threads` given a named identifier, paging with `list_threads.cursor` set to `list_threads.next_cursor` for as long as `list_threads.next_cursor` stays non-null and a match has not yet turned up.
3. Gather the resolution order as four checks, the first hit winning: an exact id match against the full ULID, then an exact case-insensitive match against the slug, then an exact case-insensitive match against the title, then a single case-insensitive substring match against the slug or the title.
4. Print the identifier that was typed and, for an ambiguous case, its matching candidate threads, naming zero matches or two-or-more candidates at the substring check plainly, absent a single resolved match.
5. Call `list_threads` absent a single resolved match.
6. Present the roster text `list_threads` returns, verbatim, with nothing added, absent a single resolved match.
7. Wait for the human to choose one thread from that roster, absent a single resolved match.
8. Wait for the human to name the completion criteria being worked this session.
9. Call `resume_thread` with `resume_thread.thread_id` set to the resolved or chosen thread id and `resume_thread.focus` set to those criterion ids.
10. Print the returned `resume_thread.briefing` verbatim.
11. Stop.
