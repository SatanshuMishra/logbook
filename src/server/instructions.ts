export const INSTRUCTIONS = `Logbook keeps the state of a piece of work across sessions, compactions and /clear, in the
project's own git repository.

Each thread has one state document: a markdown file with the sections Goal, Done when, Where
things stand, Next step, Decisions in force, Open risks, Settled, do not reopen and Where the
details live.

Keep the document true when logbook asks with one Bash command, logbook update_thread --args -
with the JSON on standard input, chained after git commit when a step was committed. Editing the
working copy at ~/.logbook/<repository key>/<slug>.md with the Edit tool is checked and committed
the same way. Logbook commits every accepted update to refs/logbook/threads. The document is put
in your context for you to work from: do not print it.

open_thread starts a thread from a slug, a title, a goal and a next step, with optional criteria and details, and makes this session its holder.
resume_thread picks up a thread by its slug or an old thread id, makes this session its holder and puts its state document in your context.
record_decision adds a decision in force and keeps its context, options with reasons and outcome in the commit.
update_thread sets the next step and its items, ticks criteria with evidence, adds or retires risks and applies exact-text edits, in one commit.
park_thread parks a thread and releases this session's hold, so a later session can pick it up.
close_thread closes a thread as done, refused while a criterion is open, or as abandoned with the reason.
list_threads lists this repository's threads with the status and next step of each.
search_ledger searches every version of every state document, and the archived old ledger, for a text.
sync_ledger fetches the threads of origin, merges them with this repository's threads and pushes the result.

A refusal names the field that was wrong and what that field accepts. Correct the argument
rather than retrying the same call.`
