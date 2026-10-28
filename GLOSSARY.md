# Logbook

Logbook keeps the state of a piece of work true across Claude Code sessions, compactions and /clear, in the project's own git repository.

## Language

**Thread**:
One piece of work whose present state logbook keeps, named by its slug.
_Avoid_: task, ticket, job

**State document**:
The one markdown file that holds a thread's present state in eight fixed sections, versioned as commits on refs/logbook/threads.
_Avoid_: ledger entry, notes

**Working copy**:
The editable copy of a thread's state document at ~/.logbook/<repository key>/<slug>.md, which logbook checks and commits after each edit.

**Pickup**:
A session start, resume, compaction or /clear that puts a held thread's state document back in the session's context.
_Avoid_: briefing, reload

**Handover**:
A /clear that passes the thread a session holds to the session that follows it.

**Update request**:
Logbook's request that the session edit a thread's state document, made after a milestone or at the end of a turn.
_Avoid_: nudge, reminder

**Check rule**:
The named check of logbook's document checker that a refused edit broke.

**Thread run**:
The metrics run of one thread, named <slug>.<UTC start>, holding every metrics event about that thread and its run summary.
_Avoid_: session run

**Hold**:
The record that one session is working on a thread, naming that session and the Claude Code process it runs in.
_Avoid_: lock, claim

**Roster**:
The list of open threads, one line each with its status and next step, shown at a session's startup and by list_threads.
_Avoid_: thread list, index
