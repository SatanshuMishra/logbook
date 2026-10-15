# Logbook

Logbook is a Claude Code plugin that lets Claude Code continue a piece of work across compactions, `/clear` and new sessions without you explaining it again. It keeps the present state of each piece of work, called a thread, in one short markdown file, the state document, and stores every version of that file as a git commit inside the project's own repository. A later session, yours or a teammate's, is handed that document and carries on from it.

The current version lives in `package.json` and `.claude-plugin/plugin.json`.

## The state document

Each thread has one state document. It describes the present, not a history, in eight fixed sections, always in this order:

| Section | Holds |
|---|---|
| `## Goal` | What the thread is for |
| `## Done when` | The criteria that make it done, each a checkbox item |
| `## Where things stand` | Where the work is now; a finished step leaves it, and its proof goes on the criterion it ticks |
| `## Next step` | The very next thing to do, and where |
| `## Decisions in force` | Decisions that still constrain the work |
| `## Open risks` | Risks that still bear on the work |
| `## Settled, do not reopen` | Questions already settled, so nobody reopens them |
| `## Where the details live` | Pointers to specs, runbooks and other material |

Above the sections sit the title line `# <slug>: <title>`, the `Status:` line (`active`, `blocked: <reason>`, `waiting: <reason>`, `parked`, `done` or `abandoned: <reason>`), the `Updated:` line and the `Next ids:` line, which says the next free number for each kind of item.

The four item sections hold item lines, each with a permanent id: a letter and a number. Criteria are `c` items and carry a box, decisions are `D`, risks are `R` and settled questions are `S`:

```markdown
## Done when
- [x] c1 The login page loads evidence: test login.loads passed
- [ ] c2 A wrong password shows an error
- [~] c3 Remember-me works struck: dropped by D2

## Decisions in force
- D2 Sessions end when the browser closes.

## Open risks
- R1 The old endpoint may still receive traffic. Bears on c2.
```

An item is never renumbered and a number is never reused. A criterion is never deleted: it is ticked `[x]` with `evidence:`, struck `[~]` with `struck:`, or reopened to `[ ]` with `reopened:`.

## Where the working copy lives

The working copy of a thread's state document is `~/.logbook/<repository key>/<slug>.md`. The repository key is the lowercased name of the folder holding the repository's git directory, followed by a hash of that directory's path, so the main checkout, a subfolder and a linked worktree of one repository all share the same working copies.

The working copy sits outside `.git` because Claude Code refuses to edit files inside it. Logbook's `PreToolUse` hook lets Claude `Read` and `Edit` exactly those files, `~/.logbook/<key>/<slug>.md`, without a permission prompt, in every permission mode; it allows nothing else, and `Write` is never allowed.

Every accepted edit becomes a commit on `refs/logbook/threads` in the repository's own `.git`, so the commit history of a document is the log of its thread. The other per-thread files, which session holds which thread and which tools were running, live under `<git common dir>/logbook/`. Nothing logbook does touches your checkout: HEAD, branches, the index and the working tree stay as they were.

## How updates happen

Claude keeps the document true by editing the working copy with the Edit tool when a hook asks it to. The hooks ask at two moments:

- Right after a milestone finishes: a `git commit`, `git push` or `git merge`, a `gh pr create` or `gh pr merge`, a pull request created or merged through an MCP tool, or a subagent's work. They ask at most once per prompt.
- At the end of a turn that changed something, and when a blocked or waiting thread hears from you.

When the edit lands, logbook checks it in the same turn. The checker looks only at structure: lost items, deleted criteria, ticks without evidence, criterion rewording without a new decision, reused ids, and closing as done while a criterion is open. It never judges content. An accepted edit is committed with a note saying what changed and why each removed item left; a refused edit is answered with the line, the id and the fix, and Claude corrects it with one more edit.

The hooks never block a tool or a turn. They add context and nothing else.

When a session starts, resumes, compacts or clears, the `SessionStart` hook puts the held thread's document in Claude's context, with the activity since the last update read from the session transcripts and any tool that was still running when an earlier session ended. Claude never retypes the document, and you see one line naming the thread, its status, its next step and the file path. In a new session, `/logbook:preflight` picks a thread up, `/logbook:file` opens one and `/logbook:debrief` brings the document up to date and parks the thread.

## Tools

The plugin's MCP server, under the key `ledger`, publishes nine tools and no resources or prompts:

| Tool | What it does |
|---|---|
| `open_thread` | Starts a thread from a slug, a title, a goal and a next step, with optional criteria and details, and makes this session its holder |
| `resume_thread` | Picks up a thread by its slug or an old thread id, makes this session its holder and puts its state document in context |
| `record_decision` | Adds a decision in force and keeps its context, its options with their reasons and its outcome in the commit |
| `update_thread` | Sets the next step and the items it needs, ticks criteria with their evidence, and adds or retires risks, in one commit |
| `park_thread` | Sets the status to parked and releases this session's hold, so a later session can pick the thread up |
| `close_thread` | Closes a thread as done, refused while a criterion is open, or as abandoned with the reason |
| `list_threads` | Lists the repository's threads with the status and next step of each |
| `search_ledger` | Searches every version of every state document, and the archived old ledger, for a text |
| `sync_ledger` | Fetches origin's threads, merges them with this repository's and pushes the result |

Every tool that changes a document sends its change through the same checker as an edit. A refusal names the field that was wrong and what it accepts.

## Sharing threads through git

Threads travel with the repository through the remote named `origin`. After every accepted update logbook starts a background `git push` of `refs/logbook/threads` that never delays a reply and gives up after 15 seconds; a push origin rejects changes nothing locally and is left to the next sync.

**Every accepted update is pushed to origin, so nothing secret belongs in a state document.** Anyone who can fetch from origin can read every version of every thread.

`sync_ledger` brings two clones into agreement. It fetches origin's threads, moves the local ref forward when it is behind, pushes when it is ahead, and when both sides changed it merges each state document line by line with `git merge-file` and pushes the merge. A document both sides changed on the same lines keeps git's conflict markers and is named as a conflict; you resolve it by editing the working copy, as with any other update. `resume_thread` syncs first whenever the repository has an origin.

## Migrating from the old ledger

Releases before 0.16.0 kept records as JSON in `refs/logbook/ledger`. The first time logbook works in a repository that has that ref and no `refs/logbook/threads`, it converts each old thread into a state document in one commit, maps each old thread id to its slug so old ids keep resolving, and points `refs/logbook/archive/ledger` at the old ledger. `refs/logbook/ledger` itself is left exactly as it was, and `search_ledger` still searches it. The first resume of a converted thread asks Claude to tidy the document.

## Requirements

Node.js 22.19 or newer. Logbook ships TypeScript source and Node runs it directly through type stripping; there is no build step and no compiled output. Each repository logbook works in must be a git repository with a working tree, and `HOME` must be set.

## Installation

This repository is a Claude Code plugin marketplace named `logbook`, listing one plugin, also named `logbook`.

1. Register the marketplace: `/plugin marketplace add <path to a clone of this repository>`.
2. Install the plugin: `/plugin install logbook@logbook`.

To upgrade an existing install, update the marketplace and then the plugin: `claude plugin marketplace update logbook` followed by `claude plugin update logbook@logbook`.

## Development

| Script | What it does |
|---|---|
| `npm test` | Runs the unit, store, contract, sync, spawn and hook tests with Node's test runner |
| `npm run lint` | Runs the lint tests under `test/lint` |
| `npm run typecheck` | Type-checks the whole tree without emitting output |
| `npm run prepare` | Installs this repository's local git hooks |

## License

Apache 2.0. Keep the `NOTICE` file with your redistribution, and do not market your fork as `logbook`.
