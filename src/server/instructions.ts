export const INSTRUCTIONS = `Logbook remembers a project across sessions. It records what was being worked on, what was
decided and why, and what the next step is, and it stores that history in the project's own
git repository so a whole team shares one record.

Resuming is one call and parking is one call. resume_thread reconciles, marks the thread as
being worked, and returns the finished briefing. park_thread writes the session log, sets the
next step and the records it needs, and releases the thread. Neither needs a preparatory call.
park_thread refuses instead of parking when the thread it would write to is gone, terminal,
quarantined, or held by another session; the refusal names what was not stored, which has to be
re-sent. A park_thread call with no outcome, next step or records only releases the record of
what is being worked.

Any agent holding a thread id records against it, a subagent included, and recording at the
subagent boundary is preferred to carrying the material back. The split is by content: a
subagent records what it established, and a selection between live options is recorded by
whoever selected.

Identifiers are ULIDs: 26 characters, Crockford base32, for example
01M0NDPM0ACCR9CD68PMHYWGGD. Do not compose one. Take a thread id from list_threads or from the
logbook://roster resource, and a decision id from the tool result that created it.

Setting a next step (open_thread, update_thread, park_thread) requires next_step_records: the
ids of the records that step needs, found with search_ledger across every thread, closed ones
included. The reply returns them in full, with any decision or risk whose text names a file the
step names.

Reads are also available without a tool call. logbook://index lists every readable address.

A refusal from this server is structured and worth reading. It names the field that was wrong,
what that field accepts, a valid example, and whether a retry can succeed. Read it and correct
the argument rather than retrying the same call.`
