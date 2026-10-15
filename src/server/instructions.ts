export const INSTRUCTIONS = `Logbook keeps the state of a piece of work across sessions, compactions and /clear, in the
project's own git repository.

Each thread has one state document: a markdown file with the sections Goal, Done when, Where
things stand, Next step, Decisions in force, Open risks, Settled, do not reopen and Where the
details live.

The working copy of a thread's state document lives at ~/.logbook/<repository key>/<slug>.md,
and logbook's own hook lets you Read and Edit it without a permission prompt. Keep the document
true by editing that file with the Edit tool when logbook asks. Logbook checks each edit and
commits every accepted edit to refs/logbook/threads, so the history of the document is the log
of the thread. The document is put in your context for you to work from: do not print it.

open_thread starts a new thread from a slug, a title, a goal and a next step, with optional criteria and details, and makes this session its holder.
resume_thread picks up a thread by its slug or an old thread id, makes this session its holder and puts its state document in your context.
record_decision adds a decision in force to the document and keeps its context, its options with their reasons and its outcome in the commit.
update_thread sets the next step and the items it needs, ticks criteria with their evidence, and adds or retires risks, in one commit.
park_thread sets a thread's status to parked and releases this session's hold on it, so a later session can pick it up.
close_thread closes a thread as done, which is refused while a criterion is still open, or as abandoned with the reason.
list_threads lists the threads of this repository with the status and next step of each.
search_ledger searches every version of every state document, and the archived old ledger, for a text.
sync_ledger fetches the threads of origin, merges them with this repository's threads and pushes the result.

A refusal names the field that was wrong and what that field accepts. Correct the argument
rather than retrying the same call.`
