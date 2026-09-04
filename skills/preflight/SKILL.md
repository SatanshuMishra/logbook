---
name: preflight
description: Use at the start of work to pick up an existing thread.
---

## Resolving a supplied identifier

1. Call `list_threads`, paging with `list_threads.cursor` set to `list_threads.next_cursor` for as long as `list_threads.next_cursor` stays non-null and a match has not yet turned up.
2. Gather the resolution order as four checks, the first hit winning: an exact id match against the full ULID, then an exact case-insensitive match against the slug, then an exact case-insensitive match against the title, then a single case-insensitive substring match against the slug or the title.
3. Gather which completion criteria this session is working, directly following a single resolved match, skipping straight past the printed roster below and landing on that same focus question.
4. Call `resume_thread` with `resume_thread.thread_id` set to that single resolved match and `resume_thread.focus` set to those criterion ids.

## Falling through to the printed roster

1. Print the identifier that was typed and, for an ambiguous case, its matching candidate threads, naming zero matches or two-or-more candidates at the substring check plainly, then continue into the printed roster and the choice below.
2. Gather a bare number given at invocation as no match, since a roster table does not exist yet and row order shifts with activity, then continue into the printed roster and the choice below.
3. Gather that the focus-criteria question sits at the end of this path the same as it sits at the end of the identifier path above, since a single match skips the printed table and not that question.

## Sequence

1. Call `list_threads`.
2. Present the roster text `list_threads` returns, verbatim, with nothing added.
3. Wait for the human to choose one thread from that roster.
4. Wait for the human to name the completion criteria being worked this session.
5. Call `resume_thread` with `resume_thread.thread_id` set to the chosen thread id and `resume_thread.focus` set to those criterion ids.
6. Print the returned `resume_thread.briefing` verbatim.
7. Stop.
