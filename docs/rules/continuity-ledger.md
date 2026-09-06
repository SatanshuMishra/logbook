# Logbook continuity (standing rule)

Logbook is a Claude Code plugin that records what happened across coding sessions in a project, so a
later session can pick up context instead of re-deriving it. It stores that record in the project's
own git repository. This file states what the shipped software actually does. Where this file and the
code disagree, the code wins and this file is wrong.

The plugin exposes tools over the Model Context Protocol under the server key `ledger`. It also ships
two skills: `logbook:preflight`, which picks up an existing thread of work, and `logbook:debrief`,
which ends this session's work on one. Both skills do nothing but call the tools below.

## The twelve tools

These are all of them. There are no others.

`open_thread`, `update_thread`, `close_thread`, `amend_criteria`, `bind_branch`, `resume_thread`,
`park_thread`, `record_decision`, `log_session_event`, `sync_ledger`, `resolve_conflict`,
`list_threads`.

Over the wire each is named `mcp__ledger__<tool>`.

## Where the record lives

Everything sits under one per-project directory. The plugin resolves it from the environment value
`CLAUDE_PLUGIN_DATA` plus a key derived from the project's canonicalised absolute path. It is not in
the project's working tree, and it is never edited by hand.

Two directories sit under that root.

- `records/` is the readable copy: `threads/<ULID>.json`, `decisions/<ULID>.json`,
  `sessions/<thread ULID>/<entry ULID>.json`, and `bindings/<ULID>.json`. Every record is JSON and
  every identifier is a ULID, a 26-character sortable identifier such as
  `01M0NDPM0ACCR9CD68PMHYWGGD`.
- `state/` holds small bookkeeping files, including `origin.json`, which records the real project
  path, and `active-thread.json`, described under "Being worked now" below.

The durable copy is git-native. Every write also lands as a commit on a dedicated ref,
`refs/logbook/ledger`, inside the host project's own repository. That ref is **not a branch** and
never appears in a branch listing. Nothing is ever checked out for it; the readable copy in
`records/` is written out from the ref's tree by hand, which the code calls materialising. A stamp
file named `last-materialised` records the last successful materialisation, and is written only when
materialisation fully succeeded.

`sync_ledger` reconciles this machine's copy with the shared copy on the remote `origin`, and pushes.
Its result names `sync_ledger.local_sha`, the commit this machine holds, and
`sync_ledger.remote_sha`, the commit the shared copy holds, read back from the remote after the push.
Equality of the two is the receipt that the push arrived. Where that read-back cannot be performed
both fields are null and the result does not claim `pushed`.

Two consequences of the layout are worth knowing before relying on it.

- `state/` is per-install. If the plugin is installed from more than one source, the active-thread
  pointer and the stop-gate file do **not** follow you between them.
- When the record count on disk disagrees with the count in the ref's tree, opening the store reports
  a named anomaly rather than staying silent about it.

## Writes into the store are guarded, and the guard is not a security boundary

A hook runs before certain tool calls. `Write`, `Edit`, `MultiEdit` and `NotebookEdit` aimed inside
the store are denied. A `Bash` command whose text names the store, the ref, or the environment key
produces a confirmation prompt — `ask`, not `deny`. The guard says of itself that it prompts for
confirmation and is not a security boundary. Treat it as a guard rail, never as protection.

A tool name matching the ledger pattern is auto-approved when it names a tool the plugin actually
registers. That check narrows the auto-approve surface; it does not close it. The event the guard
receives carries no server identity, so a different server registered under the key `ledger` that
exposed a tool named `open_thread` would be auto-approved exactly as this plugin's own is.

## A thread has three states

`open`, `done`, `abandoned`. `open` is the only non-terminal one, and it is the state every new
thread starts in.

- A thread is created by `open_thread` and requires at least one entry in
  `open_thread.completion_criteria`; without one it could never be closed.
- `close_thread` moves an open thread to `done` or to `abandoned`, and nothing else writes the state.
  Closing as abandoned requires a reason, which is written to the session log rather than onto the
  thread.
- `done` and `abandoned` are terminal and cannot be undone through any tool. Reopening means creating
  a new thread that names the old one through `open_thread.predecessor_id`, and the briefing renders
  that link under `Related:`.

There is no `paused` state and no `blocked` state, and no state named `active`. Parking a thread does
not change its state.

## Being worked now is a pointer, not a state

What the previous implementation expressed as an `active` state is a file, `active-thread.json`,
under `state/`. It carries three fields: `pointer.thread_id`, `pointer.written_at`, and
`pointer.session_id`. Reading it discards any other key the stored JSON holds, so a field the
pointer does not declare is ignored rather than reported corrupt.

- `resume_thread` writes the whole pointer and returns `resume_thread.briefing`.
- `park_thread` releases it. The thread stays `open`; parking is not closing, and a parked thread
  appears in the next roster.
- `close_thread` releases it too, but only when the pointer names the thread being closed; a pointer
  naming a different thread is left untouched, so closing one thread never takes another session's
  hold.
- At session start, a pointer left behind by a different session is reported as a crash report,
  because its `pointer.session_id` does not match this session's. That comparison is on session
  identity, never on elapsed time.

Nothing in the plugin measures a thread's age, and nothing ever closes a thread on its own. Any
staleness judgement is yours to make, from `list_threads`, which reports each thread's
`thread.updated_at`.

## Finishing a thread

Closing as `done` passes a structural gate, evaluated inside `close_thread`:

- at least one criterion that has not been struck, and
- every un-struck criterion marked done, and
- a non-empty closing statement.

When the gate fails the call is refused and the thread does not move. Criteria are set when the thread
is opened. The set of criteria afterwards changes only through `amend_criteria`, which requires
`amend_criteria.decision_id` naming a decision that actually resolves; it inserts, rewrites or
strikes. A struck criterion is retained forever, never deleted. Marking a criterion done is a
different operation and belongs to `update_thread`.

## Decisions

Call `record_decision` when a decision is locked, not at wrap-up.

- It mints a ULID and writes `decisions/<ULID>.json`. There is no four-digit number and no Markdown
  document.
- It writes the link into the thread's running summary itself, in the same commit as the decision.
  There is no second call.
- `record_decision.scope` is optional. Supplied, it is used verbatim. Omitted, it is stored as an
  empty string and reported back as `null`, with no derivation from any criterion.
- If the thread record would exceed its byte cap the decision is still written and only the link is
  skipped. The result reports `record_decision.linked` and `record_decision.link_skipped_reason`, and
  the call still succeeds.
- Reversing a decision means recording a new one that names the old in `record_decision.supersedes`.
  The old record stays readable.

Read a decision through the resource `logbook://decision/{id}`, or through the briefing, which
resolves the decisions linked on the thread. **There is no tool for reading a decision.**

One honest limit: `resolve_conflict` can replace a decision record's contents when the same
identifier exists on both sides of a sync with differing content. Decisions are append-only in
ordinary use, but that repair path is a real exception.

## Citing a decision from before the cutover

The previous implementation numbered decisions `0001` through `0180` and stored them as Markdown.
Those numbers resolve to nothing in the current store, which holds ULIDs only. The two shapes cannot
be confused: a four-digit number is a predecessor record, a 26-character ULID is a current one.

A predecessor decision is cited as `_ledger:decisions/<NNNN>-<slug>.md`.

Read one in two steps. First resolve the slug from the number:

    git ls-tree --name-only refs/heads/_ledger:decisions | grep '^0170'

Then read the exact path it printed:

    git show refs/heads/_ledger:decisions/0170-the-six-lost-items-from-0160-are-recovered-and-entered.md

Never put a wildcard in that path. `git show` with a wildcard does not fail: it exits zero, writes
nothing to standard error, and prints the current `HEAD` commit instead of the record. The exact-path
form fails loudly on a wrong path, which is why it is the only form to use.

That ref is frozen history. Read it with git; no tool reaches it.

## The running summary

Every thread carries a six-field running summary, and the schema requires all six:
`spine.active_goal`, `spine.next_step`, `spine.last_session`, `spine.open_risks`,
`spine.key_decisions` and `spine.out_of_scope`. The thread's state is a sibling field,
`thread.status`, not part of the summary.

`update_thread` records mid-session progress. `park_thread` ends this session's work: it writes the
session log entry, refreshes the summary fields from the values you supply, and releases the pointer.
It does not read the session log to compose the summary — the text you pass is the text that is
stored.

`park_thread.outcome` is optional. Supplied, it writes the session log and refreshes the summary, and
a branch that cannot write it refuses rather than releasing the pointer anyway. Omitted, the call is a
pure pointer release and existing statuses are unchanged; that is also how a pointer naming a
quarantined record is released, reported as `quarantined-pointer-released`.

The summary is what fills the roster's next step and the resumption briefing. Decisions themselves are
never compressed into it; they live in their own records and are read on demand.

## Caps refuse, they do not truncate

Every size cap is enforced by refusing the whole call. Nothing is shortened and nothing is written.
The refusal names the field, its limit, and a remedy. Shorten the value and send it again, or move the
detail into a session log entry through `log_session_event` and keep a pointer to it.

One exception, because it will confuse you otherwise: the cap on the whole serialised thread record is
reported without naming which field overflowed and without naming the number. If a write is refused
and the refusal names no field, that is the cap you have hit.

## Resuming

Never auto-select a thread — not by recency, not by file modification time, not by branch. Present the
roster from `list_threads`, let the human choose, then call `resume_thread`.

`resume_thread.thread_id` accepts a ULID and nothing else. A slug is refused. Take the identifier from
`list_threads` or from `logbook://roster`; never compose one.

Print `resume_thread.briefing` exactly as it is returned. A hook checks that the briefing was echoed
verbatim and blocks otherwise. That hook enforces the verbatim echo only — it does not enforce
stopping, so stopping after the briefing is your duty.

`logbook://index` lists every readable address, and reads are available without a tool call.

## Working rules

- Ledger claims are hints. Verify against the code and against git before acting on one. On conflict
  the code wins, and then the ledger gets fixed.
- Store pointers, not payloads. Records carry paths and identifiers, not the contents of files.
- A refusal from this server names the field that was wrong, what that field accepts, a valid example,
  and whether a retry can succeed. Read it and correct the argument rather than retrying the same
  call.
