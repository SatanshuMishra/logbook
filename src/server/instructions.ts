export const INSTRUCTIONS = `Logbook remembers a project across sessions. It records what was being worked on, what was
decided and why, and what the next step is, and it stores that history in the project's own
git repository so a whole team shares one record.

Resuming is one call and parking is one call. resume_thread reconciles, marks the thread as
being worked, and returns the finished briefing. park_thread writes the session log, refreshes
the running summary, and releases the thread. Neither needs a preparatory call.

Identifiers are ULIDs: 26 characters, Crockford base32, for example
01M0NDPM0ACCR9CD68PMHYWGGD. Do not compose one. Take a thread id from list_threads or from the
logbook://roster resource, and a decision id from the tool result that created it.

Reads are also available without a tool call. logbook://index lists every readable address.

A refusal from this server is structured and worth reading. It names the field that was wrong,
what that field accepts, a valid example, and whether a retry can succeed. Read it and correct
the argument rather than retrying the same call.`
