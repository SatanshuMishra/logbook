# SPEC: Logbook rebuild

Status: draft for approval, 2026-08-22
Supersedes: `docs/specs/2026-08-04-mcp-server-hardening.md` (1 of 7 criteria met; all four re-planned units returned `premise_holds=false`)
Target: Logbook 1.0.0, TypeScript, current MCP SDK line
Thread: `01M0NDPM0ACCR9CD68PMHYWGGD`

---

## 0. How to read this document

This SPEC is the complete definition of the rebuilt Logbook. It is written so that an implementer who has never seen this project can execute a unit of work without asking a question and without inventing a rule.

Three reading rules:

1. **Every claim about existing behaviour carries a `file:line`.** If a statement here has no citation, it is a design intent, not an observation. Nothing in this document may be justified by a comment, a test name, or another document's summary.
2. **§4 is a firewall, not an appendix.** It lists work that earlier documents called for and that is now deliberately deleted. Re-adopting any of it re-imports scope this rebuild exists to remove.
3. **A premise is re-verified at pickup, not at authoring.** See §2.3. This is the single most important process rule in the document, and it is the one whose absence caused the previous attempt to fail.

---

## 1. Why this rebuild exists

### 1.1 What Logbook is, in plain words

Logbook is a Claude Code plugin that remembers a project across sessions. When a session ends it writes down what was being worked on, what was decided and why, and what the next step is. When a session starts it presents that back, so the next session begins informed instead of blank.

It stores that record in git, in the project's own repository, so that several people working on one project share one history.

### 1.2 The two failures that prompted it

**The tool is hard to call correctly.** Calling the hand-off flow took several attempts because the tool listing did not convey the shape of the data it wanted. Root cause, established in §7.1: the client loads only tool *names* and a server *instructions* string at session start and fetches full schemas on demand, so a thin description forces staged discovery. Not one property in any current tool's input schema carries a `description` field.

**The tool loses state that it exists to keep.** Two defects, and they are one defect:

| | Session 1 (thread opened) | Session 2 onward (thread resumed) |
|---|---|---|
| Active pointer | set | **null** |
| Hand-off gate | fires **every turn**, blocking with exit 2 | **never fires** |
| Correct behaviour | once, at session end | once, at session end |

Measured: 8 of 8 consecutive turns blocked. All four non-terminal threads in this project's own ledger are stuck `paused`, one of them updated the same day it was measured. The mechanism is wrong in both directions because the pointer's lifecycle does not match the condition it gates.

### 1.3 The architectural root causes

Six design decisions produced nearly every catalogued defect. The rebuild is organised around removing them, not around fixing their symptoms.

| | Root cause | Defects it produced | How this SPEC removes it |
|---|---|---|---|
| **E1** | Git plumbing was adopted as the storage *engine*, not as a *transport*. A worktree is a developer's checkout with no concurrency model; using it as a database gives you recursive delete as a state transition, a strategy flag as a conflict resolver, and a directory scan as a sequence generator. | worktree destruction, number collision, silent merge loss, two diverged stores, 50-spawn session start, no durability barrier | §5: no worktree, plumbing writes, compare-and-swap ref moves, record-level merge |
| **E2** | Hook events were chosen by availability, not by semantics. Six of ~31 events are wired; two notifications sit on per-turn and per-tool-call events while reporting per-session conditions. | hand-off nag every turn, compaction nudge every tool call, publication inverted, session start ignores its own cause | §8: each notification's condition and cadence are stated first, then bound to the event that matches |
| **E3** | Skills own rules the server should own. The lifecycle's most important transition is enforced by a Markdown tool list, so editing a Markdown file silently disabled resume and no test could catch it, because no code was wrong. | the entire resume defect; the tool-surface gaps | §7: if a rule is load-bearing the server performs it; skills orchestrate only |
| **E4** | Errors are converted to absence. Nine bare catch blocks, 22 unchecked git calls, a helper that maps both a non-zero exit and a parse failure to `null`. A missing environment variable renders to the user as *"no resumable threads"* — a confident positive claim about a store that was never read. | misconfiguration invisible, git failure silently downgrades the driver, guard degrades on canonicalisation failure | §10: absence and failure are different values, structurally |
| **E5** | Records are written before anyone asks whether they will be read. 248 KB of session logs and a checkpoint directory, neither with a reader. | two write-only stores | §6: every record type names its reader in this document |
| **E6** | Truth is declared twice and reconciled never. Schema in two places, validation on write but not on read, error text re-derived rather than projected from the schema that already knows the answer. | validation drift, unhelpful refusals, environment-dependent test results | §6.1: one declaration emits type, validator, wire schema and refusal text |

### 1.4 Why the previous attempt failed

Not because its SPEC was too short. The 2026-08-04 hardening SPEC is 128,787 bytes.

It failed because **its premises were never checked against code before it was approved.** Decision 0054 re-planned its four unstarted units against the actual tree; **all four returned `premise_holds = false`.** Compounding that: eighteen consecutive review rounds each found a real defect while the suite was at 100% pass, and **nine of those defects were introduced by the fix for the one before.**

The countermeasures are §2.3 (premise re-verification), §2.4 (acceptance is a ceiling), and §11 (a test suite where green means something).

---

## 2. Governing rules

These bind every unit of work. A unit that violates one is not done, regardless of its own acceptance criteria.

### 2.1 Robust and simple beats complex and fragile

Robustness and simplicity are **joint criteria, not a trade**. A design that needs a fourth special case to stay correct is the wrong design. Where a defect class can be *deleted* rather than *guarded*, delete it. This SPEC applies that twice at architectural scale: there is no worktree to tear down (§5.2), and there is no stored `active` to drift (§6.4).

### 2.2 The server enforces; prose does not

> What the server enforces is robust. What depends on the agent remembering is where the ledger rots.

If a property matters, the server refuses the write that violates it. A rule stated in a skill file, a description, or this document is not a mechanism. Every invariant in §6 is enforced by a refusal at the server boundary.

### 2.3 A premise is re-verified at pickup

Before any unit of work begins, its stated premises are checked against the current tree and the check is recorded. If a premise no longer holds, the unit is re-planned before code is written, not adapted while writing it.

This is a hard gate. It is the direct countermeasure to the failure in §1.4.

### 2.4 Acceptance is a ceiling

Each unit declares its acceptance criteria before work starts. Those criteria are the complete definition of done for that unit. Anything discovered above them is filed as a **new** item; it is never folded into the work in hand and never reopens a unit that met its criterion.

Treating an acceptance list as a floor makes done unsatisfiable, and work against an unsatisfiable criterion cannot terminate. That is what "infinitely grew in scope through reviewer loops" describes.

### 2.5 Fix what you introduce; defer what you inherit

A unit repairs the defects it creates. A defect it merely encounters is filed with a named owner and a remedy, never silently absorbed and never silently dropped.

### 2.6 Preserve the distinction

This project's recurring failure shape is a change that collapsed a distinction the previous version was carrying — four times in one unit of work. Every change states which distinction it preserves and which it collapses before it ships.

### 2.7 Every claim cites a location the author opened

No behaviour is inferred from a name, a comment, a test title, or another agent's report. Comments are treated as unreliable and are never authored.

### 2.8 This repository is the plugin

Working-tree edits do not reach the running plugin until reinstall and restart. **Observing this session's own ledger is never verification of a working-tree change.** Every verification runs against a spawned build under test.

---

## 3. Scope

### 3.1 In scope

A complete replacement for the plugin, in TypeScript, comprising: the MCP server, the hook set, the skills, the command-line entry point that hooks call, the storage layer, and the test suite. It ships as 1.0.0 through a single cutover.

### 3.2 Out of scope, explicitly

| Excluded | Authority | Note |
|---|---|---|
| Migrating existing ledger data | 0064 | New store starts empty; the old store is frozen in place and remains readable by the old plugin |
| Any read-time upcast or schema-version tolerance | 0064 | There is no v1 data to read |
| Non-git projects, and the second storage driver | 0067 | Outside a git repository the plugin declines to operate; the parity suite is deleted |
| A database at any layer, as store or as index | 0062 | Binary merge disqualifies it against the team-sync purpose |
| Protocol logging and sampling | 0069 | Both deprecated by the specification itself |
| Elicitation | 0069 | A dialog answer bypasses the transcript, which is what the session log records |
| Resource subscriptions, roots, tasks, icons | 0069 | Deprecated, or zero call sites in the client |
| A separate SDK verification spike | 0068 | Discharged by the real-spawn contract tests in §11 |
| Hierarchy (parent and predecessor links) | §6.2 | Reintroduce only with a deterministic active-leaf pointer, and only past ~15 threads |

### 3.3 Deferred, named, and unplanned

Non-git support (0067). The natural shape is a git repository initialised inside the plugin data directory, so one driver still serves both. Not planned, not scheduled.

---

## 4. The firewall: recommendations that are now void

Eighteen recommendations carried forward from earlier documents are deleted by decisions 0064–0067. They are listed so that a reader who finds them in an older artifact knows they are dead.

### 4.1 Voided by 0064 (clean break, empty store)

| Voided | Where it came from |
|---|---|
| "Existing ledgers keep working" as a shipping invariant | hardening SPEC invariant I2 |
| "Quarantine rather than crash on non-conforming data already on disk" | hardening SPEC invariant I3(c) |
| A committed migration script and its dry-run-against-a-copy gate | hardening SPEC MSP-7 |
| The entire `upcast` repair, including the unrecorded eighth defect that collapses hyphens and corrupts 203 stored entries on read | thread risk; 0054 |
| Read-time upcast in the drivers as the migration mechanism | 0016 |
| A documented migration path from 0.2.x | hardening SPEC MSP-13 |
| Legacy tolerance for over-cap stored scalars | 0046 |
| The owner ruling blocking three caps "contradicted by their own production data" | 0054 |

The last one matters: those caps were contradicted by *existing* records. With no existing records, caps are chosen freely against the new model.

### 4.2 Voided by 0067 (git only)

| Voided | Where it came from |
|---|---|
| The two-driver parity suite and every "measure on both backends" obligation | hardening SPEC MSP-0B; 0029 |
| The non-git pointer location as a sibling of the store | 0043 |
| Local-driver implementations of the transaction contract | hardening SPEC MSP-8 |
| The caveat that record deletion is unimplementable on the non-git backend | 0062 |
| One of the three pointer-store states | 0040 |

### 4.3 Voided by 0061 and 0065 (team sync ships in v1)

| Voided | Where it came from |
|---|---|
| Sequencing multi-user safety last, at version 0.9.0 | hardening SPEC MSP-11 |
| Treating number collision, synthetic identity and the merge gap as known issues rather than blockers | hardening SPEC criticals 3 and 6 |
| The one-person branch: "if it is for one person, it is 430 lines of dead weight" | open-questions report §5.7 |
| Making the commit-provenance idea conditional on a separate identity fix | 0063 |
| Deferring the multi-user question until a second user appears | 0061, rejected option |

### 4.4 Superseded by newer observation

The August report rejected Resources, Prompts, Logging and Sampling, and deferred structured output as speculative. Those verdicts rested on *documentation silence*. They are superseded by 0069, which rests on tapped protocol traffic from a purpose-built plugin server with a control run, plus the current specification text. See §7.2.

---

## 5. Storage

### 5.1 Where things live

| Location | Contents | Tracked by git? |
|---|---|---|
| `<plugin-data>/<project-key>/records/` | The working copy: plain JSON and Markdown files, one per record | No — these are materialised from the ref |
| `<plugin-data>/<project-key>/state/` | The active-thread pointer, the last-synced ref value, the derived index | No, and never committed |
| `<project>/.git`, ref `refs/logbook/ledger` | The committed ledger history | It **is** git |

`<project-key>` is derived from the absolute project path and **must be injective**: the current derivation maps `/a/b-c` and `/a/b/c` to the same key. The rebuild hashes the canonical absolute path rather than substituting separators.

**One store per project, always.** The current design derives the data root from an environment variable that differs per install source, which is why two stores for this project exist right now, eight decisions apart. The rebuild resolves the store from the project path alone and refuses to operate if it finds a second store for the same project, naming both paths.

### 5.2 Why there is no worktree

The ledger is a set of files. Materialising it through `git worktree` buys nothing and costs a checkout that must be provisioned, locked, and destroyed. Measured consequences of that choice in the current build:

- Provisioning deletes the live directory **even when the lock was not acquired** — reproduced: waited the full 10.2 s timeout, failed to acquire, deleted a second session's uncommitted file anyway (`git-ref-driver.mjs:369-385`).
- A lock older than 10 s is declared stale and removed, so a slow holder is robbed — reproduced in 0.6 s.
- The lock covers provisioning only, then releases, long before the writes it should protect.
- Two worktrees for this repository are registered right now; because both use the same basename, git disambiguated the administrative directory to `ledger-worktree1`.
- `git worktree remove` appears nowhere in the source. The lifecycle is create-and-abandon.

None of this is a locking bug to fix. It is a checkout that should not exist.

### 5.3 The write path

A write is a pure function from (current ref value, record changes) to a new commit, and it touches nothing else.

```
1. Write each changed record to the working copy via a durable atomic write (§5.5).
2. For each changed record: git hash-object -w  ->  blob id
3. Build the new tree from the previous tree plus the changed entries,
   using a TEMPORARY index supplied through GIT_INDEX_FILE.
4. git commit-tree <tree> -p <old-ref-value>   with the CALLER'S identity
5. git update-ref refs/logbook/ledger <new> <old>     <- compare-and-swap
   If <old> no longer matches, the ref moved underneath us: re-read, re-merge, retry.
```

**Binding invariants, each proven by a test in §11.4:**

| # | Invariant | Why |
|---|---|---|
| I-1 | No ledger operation reads or writes `HEAD` | Branch switching, rebase, bisect and stash all move `HEAD`; the ledger must be invisible to them |
| I-2 | No ledger operation touches the project's index | Writing a record must never disturb a developer's staged changes. Enforced by `GIT_INDEX_FILE` pointing at a temporary file |
| I-3 | No ledger operation writes into the project's working tree | The records live in the plugin data directory |
| I-4 | Every ref move is a compare-and-swap against the expected old value | Two processes must not clobber each other; the current `update-ref` passes no old value at four call sites |
| I-5 | The ledger ref lives outside `refs/heads/` | It is a real ref, so garbage collection protects it, but it never appears in `git branch` and cannot be checked out by accident |
| I-6 | Ledger commits carry the caller's `user.name` and `user.email` | All 160 existing commits are authored by a synthetic unroutable identity, so no change is attributable to a human |
| I-7 | Ledger commits are made with hooks disabled | The project's own hooks must not run against ledger writes |

I-1 through I-3 are what make the answer to *"does this survive switching from `development` to `feat/feature-a`?"* structurally yes rather than probably.

### 5.4 The read path

Reads are ordinary filesystem reads of the working copy. **Zero subprocesses.**

This is the whole reason the measured cost collapses. Today a session start costs **50 git subprocesses and 1.18 s**, because each of three command-line children re-runs an eleven-spawn provisioning prologue that deletes and rebuilds a checkout. With a plain working copy there is nothing to provision: the roster is a directory read.

The working copy is refreshed from the ref only when the ref has moved — detected by comparing the ref value against the last-synced value in `state/`.

**Per-record read isolation.** One unreadable record must never make every other record unreachable. Today a single corrupt thread file breaks the whole roster, because the roster reads all threads to answer about any of them. In the rebuild, a record that fails to parse is reported as `quarantined` in place, with its path and the parse error, and every other record is still returned.

### 5.5 Durability

An atomic write is not a durable write. The current implementation renames without flushing, so a rename can be visible while its content is not.

The full sequence, required at every record write:

```
1. write the temporary file in the SAME directory as the target
2. fsync the temporary file
3. rename it over the target
4. fsync the containing DIRECTORY
```

Step 4 is the one everyone omits, and it is the one that makes the rename itself survive. Node does not document a directory-flush API; the implementation opens the directory and calls `fsync` on the handle. If that proves unavailable on a supported platform, the shortfall is recorded as an accepted risk in §14 rather than silently skipped.

### 5.6 Sync and merge

```
sync:
  1. fetch the ledger ref into a local tracking ref
  2. if remote == local        -> nothing to do
  3. if remote is ancestor      -> push, done
  4. if local is ancestor       -> fast-forward, refresh working copy, done
  5. otherwise                  -> MERGE (below), commit the result, push with lease
```

**The merge is performed by the server, in the server's own code, over records.** Not by a git strategy flag, and not by a registered merge driver.

Why not a strategy flag: no flag understands what a record means. Today everything except session logs falls through to a merge that takes the remote side wholesale, reports success with exit code 0, and then force-pushes. That silently discards a teammate's thread record.

Why not a registered merge driver: it must be installed into every clone's git configuration, and where it is absent it falls back to the destructive default. A mechanism that silently degrades to the exact failure it prevents is not a mechanism.

**The merge algorithm, per record type:**

| Record | Field | Rule |
|---|---|---|
| Any | Field present on one side only | Take it |
| Any | Both sides identical | Take it |
| Thread | `completion_criteria[]` | Union by criterion id. Same id, different text: conflict |
| Thread | `spine.key_decisions[]`, `spine.open_risks[]`, `spine.out_of_scope[]` | Union by element id |
| Thread | `status`, `title`, `slug`, `blocked_by`, `closure` | Both sides changed to different values: **conflict** |
| Thread | `spine.active_goal`, `spine.next_step`, `spine.last_session` | Both sides changed: **conflict** |
| Decision | any | Immutable; two decisions cannot collide because ids are ULIDs (0075) |
| Session log | any | Union by entry id; distinct files never conflict |

**On conflict the server refuses.** It records the conflict, leaves both sides intact and addressable, surfaces them through `resolve_conflict`, and does not push. It never picks a side.

This is the direct reason every collection element needs an identity two people can mint offline without coordination.

---

## 6. The record model

### 6.1 One declaration, four consumers

Every record type is declared exactly once. From that single declaration the build derives:

1. the TypeScript type,
2. the runtime validator for data read from disk,
3. the wire schema published to the client,
4. the text of a refusal when validation fails.

The fourth is the one the current build lacks. Its validator discards the structured detail the schema library already produced, keeping only a path and a message — which is why a refusal can say `expected: 'type object'` while the schema three lines away declares exactly which property was required. **Reproduced during the authoring of this SPEC**: a refusal named the field and the limit but not which of several values violated it, and its example field was null.

**Rule: a refusal is generated from the schema, never hand-written.** It names the field, states what is accepted, gives a valid example, and says whether a retry can succeed.

### 6.2 Thread

```
id                  ULID, immutable
slug                short name, unique per project, validated as strictly as any other slug
title               one line
status              "open" | "done" | "abandoned"
blocked_by          string | null      (see 6.4)
completion_criteria [ { id: "c1", text, done: bool, kind: "planned"|"detour", struck_by: id|null } ]
spine {
  active_goal       one line, why this thread exists
  next_step         the single next action
  last_session      what the previous session did
  open_risks        [ { id, scope, text, refs[] } ]
  key_decisions     [ { id, decision_id, title, scope } ]
  out_of_scope      [ { id, text } ]
}
created_at          ISO-8601, anchored pattern
updated_at          ISO-8601, anchored pattern
```

Fields deliberately absent, each with the reason:

| Absent | Reason |
|---|---|
| `active` as a stored status | Derived from the pointer (0073). Storing it is the root cause of both named defects |
| `blocked` as a status | Now a field, not a state (0073) |
| `vcs_ref` | Zero readers, no validation, already collecting garbage in live data |
| `external_refs` | Zero readers, empty in every existing thread |
| `parent_id`, `predecessor_id` | Hierarchy is out of scope until ~15 threads and a deterministic active-leaf pointer |
| `abandoned_reason` | Belongs in the session log, which already receives it |
| `closure_statement` as a column | The gate stays; the text lives in the session log |
| `schema_version` | Nothing to upcast from (0064) |

**Every collection element carries a stable id.** This is not decoration. It is what makes offline merge possible (§5.6) and what makes retiring one risk an O(1) operation instead of resubmitting all fourteen — the "retirement ratchet" that is why the current project's risk list only ever grows.

### 6.3 Decision

Immutable, append-only, one file each.

```
id          ULID
thread_id   ULID
title       one line
context     prose
options     string[]
outcome     prose
commit      the project HEAD sha at the time of recording
created_at  ISO-8601
```

**Immutability is structural, not conventional:** there is no tool that amends a decision, and the write guard denies direct edits into the store. A reversal is a *new* record that supersedes the old; the old file and its id remain. Verified against live data: zero of 60 existing records has ever been modified after creation.

`supersedes: [id, ...]` is an optional field on the **new** record. Nothing edits the old one.

`commit` is included here and **not** on threads. On a thread it would repeat the `vcs_ref` mistake. On a decision it answers "what did the code look like when this was decided", and it is only meaningful because I-6 makes the surrounding history attributable.

### 6.4 Lifecycle

Three stored states. Two derived facts.

```
                    open ──────► done          (gated, §6.5)
                      │
                      └────────► abandoned     (reason required)
```

| Fact | How it is known |
|---|---|
| The thread is being worked **right now** | The pointer names it. Not stored on the thread |
| The thread is blocked | `blocked_by` is non-null. Not a state |

**Parking is releasing the pointer. Resuming is writing it.** Both are idempotent by construction, which removes an entire class of illegal-transition failures — including the one that currently makes a second hand-off on a resumed thread impossible.

**Crash detection is unchanged and still trivial:** a pointer naming a thread at session start means a previous session ended without parking.

**The pointer is machine-local and is never committed.** It lives in `state/` (§5.1), outside the ledger ref, so "being worked right now" is a fact about one checkout on one machine and nothing else. Two consequences follow, and both are deliberate. Crash detection is per-machine: a session killed on one laptop is detected on that laptop, not by a teammate. And **Logbook does not lock a thread across teammates** — two people can resume the same thread simultaneously and neither is told. That is a coordination problem, not a storage problem, and a committed lock would be worse: it would need a network round trip to acquire, would strand the thread when a machine died holding it, and would fail exactly when the network is unavailable, which is the offline case team sync exists to serve. What protects the work is not a lock but the merge in §5.6: two people editing one thread produce a field-level merge, and a genuine conflict refuses rather than picking a side. See §14 item 9.

**Blockage renders or it does not exist.** Because `blocked_by` is a field rather than a state, the roster and the briefing can only show that a thread is blocked by rendering its reason. This structurally repairs the current defect where the roster announces `blocked` and never says why — capture-and-hide, which is worse than either showing or not capturing.

### 6.5 The done gate

`done` requires **all** of:

1. at least one un-struck completion criterion exists,
2. every un-struck criterion is marked done,
3. a non-empty closure statement is supplied.

The server evaluates this inside the transition and **refuses** the move when it fails. The thread does not change state, and the refusal names every outstanding criterion by id and text — not merely that the gate failed.

Criteria are set at creation (at least one is required) and afterwards change only through `amend_criteria`, which requires a resolving decision reference to insert, rewrite or strike. A struck criterion is retained and rendered struck, never deleted.

This gate is the model for every other refusal in the system: fourteen lines, one caller, and it refuses rather than truncating or warning.

### 6.6 Caps

Caps exist as a runaway guard. They are enforced by **refusal of the whole call**, never by truncation, and the refusal names the field, its limit, the observed size, and a remedy.

Two rules the current build gets wrong:

- **Assert on the contribution, not the merged result.** Asserting on a merged spine bricks the tool against data already on disk.
- **Cap collection *counts*, not only element sizes.** The current spine cap set has no count cap on recorded decisions, so 5,000 entries and 825 KB pass unremarked, and 300 recordings grew one briefing from 483 to 39,483 characters.

Caps are enforced **after** escaping, not before, because escaping inflates ordinary input several-fold.

Because there is no legacy data (0064), cap values are chosen against the new model rather than negotiated against existing records.

---

## 7. The MCP surface

### 7.1 What the client actually does, and why it changes the design

Three observed facts govern everything in this section.

**Tool search is on by default.** At session start the client loads only tool **names** and the server **instructions** string. Full schemas are fetched on demand. This is the root cause of §1.2's first failure: repeated calls were the client discovering the tool in stages.

Three consequences:

| Consequence | What follows |
|---|---|
| Tool count is nearly free | Consolidate for *clarity*, never for budget |
| A tool name is now a retrieval key | Names must be searchable, not merely unique |
| `description` and `instructions` are truncated at **2 KB each** | The most important sentence goes first |

**Schema constraints are not enforced.** They are injected into the model's prompt as text. There is no strict-mode field in an MCP tool definition, so `minimum`, `maxLength`, `pattern` and `minItems` are advisory. **Everything is re-validated server-side, always.**

**A root-level `oneOf`, `anyOf` or `allOf` is forbidden.** It has caused a 400 that broke entire sessions. The client's own repair is to flatten the schema and write the constraint into the description in prose — which is the strongest available endorsement of prose over schema.

### 7.2 Which primitives are built

| Primitive | Verdict | Basis |
|---|---|---|
| Tools | **Build** | The only primitive the model invokes autonomously |
| Resources, with templates | **Build** | Observed: the client requests the plugin server's resource list unprompted; the model reads them through built-in tools |
| Structured output (`outputSchema`) | **Build** | The protocol validates results against it — the one place correctness is enforced for free |
| Tool annotations | **Build** | Near-zero cost; lets the client reason about read-only, destructive and concurrency-safe calls |
| Argument completions | **Build** | Drives the autocomplete that lets a caller pick a thread without guessing an id |
| Pagination, list-changed | **Build** | Needed by the roster and session logs regardless |
| Prompts | **Build, at most two** | Observed human-only: three resource tools exist for the model and **zero** prompt tools |
| Protocol logging | **Do not build** | Deprecated by the specification; its own migration advice is to write to stderr |
| Sampling | **Do not build** | Deprecated, unimplemented by the client, and wrong for a component whose premise is refusing rather than inferring |
| Elicitation, roots, subscriptions, tasks, icons | **Do not build** | Deprecated, or zero call sites |

**Resource templates are readable but not discoverable.** The client never requests the template list — confirmed client-wide by a control run against the same binary configured as a user server. A templated address therefore works only if the shape was published somewhere the model already reads. §7.4 publishes it.

### 7.3 The tools

Twelve tools. Two of them exist specifically to collapse the multi-call chains that produced §1.2's first failure.

| Tool | Read-only | Destructive | Idempotent | What it does |
|---|---|---|---|---|
| `list_threads` | yes | no | yes | The roster: every non-terminal thread with its state, progress and next step |
| `resume_thread` | no | no | **yes** | Reconciles, writes the pointer, returns the rendered briefing — **one call** |
| `park_thread` | no | no | **yes** | Writes the session log, refreshes the spine, releases the pointer — **one call** |
| `open_thread` | no | no | no | Creates a thread with at least one completion criterion |
| `update_thread` | no | no | no | Mid-session progress: criterion completion, spine fields, risks |
| `close_thread` | no | **yes** | no | `done` (gated) or `abandoned` (reason required) |
| `amend_criteria` | no | no | no | Plan changes; insert, rewrite or strike, each needing a decision reference |
| `record_decision` | no | no | no | Appends an immutable decision record |
| `log_session_event` | no | no | no | Appends a session-log entry |
| `sync_ledger` | no | no | yes | Fetch, merge, push |
| `bind_branch` | no | no | yes | Links a working branch to a thread |
| `resolve_conflict` | no | no | no | Resolves a refused merge by naming the winning side per field |

**`resume_thread` and `park_thread` are the headline change.** Today resuming is three chained calls — refresh the index, reconcile, render the briefing — which is exactly what the user saw collapse into *"Called 3 times"*. Chained tools are a named anti-pattern: if a human engineer cannot say which tool to call, a model cannot either. One call per workflow step.

`resume_thread` is idempotent because §6.4 makes writing the pointer idempotent. Calling it twice on one thread is not an error.

#### Description rules, binding

Every tool description:

1. is **at least 3–4 sentences**, and states the exact shape of every format-sensitive argument;
2. leads with the sentence a caller most needs, because the budget is 2 KB and truncation takes the tail;
3. contains a **literal example** of the trickiest argument;
4. states any effect that is not obvious from the name — including whether the call is expensive;
5. **never** contains instructions to the model of the form "always do X" or "you must call Y first". That reads as prompt injection and fails review.

Every **property** in every input schema also carries a `description`. The current build has zero. This is the single highest-value keyword available, and its absence is the mechanical cause of §1.2's first failure.

Where a closed set exists, it is an `enum`. `status` is `["open","done","abandoned"]` and nothing else.

#### Structured output

Every tool declares an `outputSchema` and returns `structuredContent` conforming to it, **plus** a hand-authored human-readable `content` block. Two traps, both real:

- declaring an output schema and returning no structured content **throws**;
- there is no general auto-fallback that fills in the text block for you.

Validation is skipped when a result is an error, so an error result never has to satisfy the success schema.

#### Effect reports

A write tool returns **what changed**, not what the record now is. A call that removes two recorded decisions returns their ids. This closes the class where deletion, no-op and success are indistinguishable, and it collapses one measured return from 6,269 bytes to a fraction of that.

### 7.4 Resources

| Address | Contents |
|---|---|
| `logbook://index` | **A static resource listing every address shape below.** This exists because templates are not discoverable (§7.2) |
| `logbook://roster` | The resumable roster, same content as `list_threads` |
| `logbook://thread/{id}` | One thread record, rendered |
| `logbook://decision/{id}` | One decision record |
| `logbook://session/{thread_id}/{entry_id}` | One session-log entry |

Resource URIs are **not namespaced by the client** — the plugin owns its own scheme, so collision avoidance is this project's responsibility. `logbook://` is the scheme.

Publishing session logs here is what gives them a reader (0074). They are read on demand and never loaded into a briefing by default, so 248 KB of previously dead weight costs nothing until something asks for it.

The server identifier a caller passes is `plugin:logbook:ledger`; tool and command names namespace as `mcp__plugin_logbook_ledger__*`. A matcher written against the bare server name never fires — see §8.3.

### 7.5 Prompts

Two, both human entry points only: `preflight` and `debrief`.

They are convenience, and **nothing depends on them**. A prompt cannot be invoked without a human keystroke, so no automatic behaviour may route through one. The skills in §9 remain the model-invocable path.

### 7.6 Server instructions

The `instructions` string is the only text never deferred by tool search. It is 2 KB of always-resident real estate, and the current build sends none.

It states: what Logbook is in two sentences; that resuming is one call and parking is one call; that identifiers are ULIDs and where to get one rather than guessing; that reads are available as resources at `logbook://index`; and that refusals are structured and worth reading rather than retrying blindly.

---

## 8. Hooks

### 8.1 The rule that governs this section

**State the condition and its natural cadence first. Then bind the event whose firing matches it.** Where no event matches, add an explicit latch.

The current build binds a per-session condition to a per-turn event and a per-session condition to a per-tool-call event. Both over-fire, and one of them *blocks*.

### 8.2 The hook set

| Event | Condition it reports | Why this event | Latch |
|---|---|---|---|
| `SessionStart` | A session began | Fires once per session, and carries a `source` field distinguishing startup from resume, clear, compact and fork — which the current build never reads | none needed |
| `UserPromptSubmit` | The user asked to resume | Genuinely per-prompt. Regex-gated: 46 ms and **zero** subprocesses when it does not match | none needed |
| `PreToolUse` | This call touches the ledger store | Genuinely per-tool-call. In-process, no subprocess | none needed |
| `PostToolUse` | A project commit happened | Gated on the command being commit-shaped | none needed |
| `SessionEnd` | **The session is ending** | Fires once per session and carries an `end_reason`, so a resume-termination is distinguishable from a real exit | none needed |
| `Stop` | The briefing was printed verbatim | The verbatim gate genuinely evaluates a turn's output | **once per session**, keyed on session id |

Removed: **`PreCompact`**, whose checkpoints have no reader and whose writer bypasses its own guard.

**The hand-off notice moves from `Stop` to `SessionEnd`.** `Stop` fires when the assistant finishes responding — per turn, not per session. Bound there, the notice fired 8 times in 8 turns while work was plainly in progress, blocking each time with exit code 2 and instructing the model to park a thread that was being actively worked.

`SessionEnd` cannot block, and that is correct: forcing a hand-off mid-work *is* the defect. A notice that fires 40 times in a 40-turn session is trained into noise, so the one case that matters — a genuinely abandoned thread from a crashed session — is ignored too.

The compaction nudge is either removed or latched once per session. Its condition today is transcript **file size**, which only ever grows, so once true it is true forever; it was observed attaching to every single tool result during the authoring of this SPEC.

### 8.3 Hook contracts

- Every hook is a subprocess reading one JSON event on stdin and replying on stdout.
- **stdout carries JSON and nothing else.** The first non-whitespace character decides how the reply is parsed; a single stray byte silently discards the decision with no error and exit 0.
- Exit code 2 blocks, on the events where blocking is supported. Any other non-zero does **not** block — a mistyped script path exits 127 and silently disables a policy gate.
- Context and message outputs are capped at 10,000 characters.
- **A hook that times out fails open.** The write guard must therefore be fast enough that its budget is never the thing standing between a caller and the store.
- The `PreToolUse` matcher must cover the `mcp__plugin_logbook_ledger__*` form and be **anchored**, so it does not fire on unrelated tools whose names merely contain a matching substring.

### 8.4 The plugin half shrinks

The plugin half is currently 1,878 lines, of which only about 19% is genuinely constrained by being a Claude Code plugin. The rest is ledger logic that belongs in the server.

Target: **under 400 lines**, which is the gate M8 is held to. Each hook becomes: read stdin, make one call, translate the answer into a hook verdict.

What moves to the server: roster rendering, resume-intent detection, ledger-root derivation, ledger-path matching for the guard predicate, and the git-hook installer. What stays in the plugin: the guard *decision*, and transcript parsing — the transcript path is given only to hooks.

**The command-line entry point is not deleted.** A hook process cannot talk to the running MCP server, so a second entry point is structurally required. It becomes **fewer, fatter commands** — one for session start, one for session end — rather than the current nine call sites, each paying a fresh process start.

Hooks call ledger logic **in process**. Today they spawn a Node child for work they could call directly, while already importing from the same source tree; about 0.21 s of every session start is spent starting processes the parent could have called as functions. The subprocess boundary was standing in for a type checker. TypeScript supplies that guarantee without the process.

---

## 9. Skills

Two: `preflight` and `debrief`. They orchestrate; they hold no rules.

**This is the direct repair of root cause E3.** The lifecycle's most important transition currently lives in a Markdown `allowed-tools` list: the resume skill is permitted only four read-side tools, so the transition it needs is not merely unused, it is *forbidden*. Editing a Markdown file silently disabled resume, and no test caught it because no code was wrong.

In the rebuild:

- `preflight` calls `list_threads`, presents the roster, **waits for the human to choose**, calls `resume_thread`, prints the returned briefing verbatim, and stops.
- `debrief` gathers the session's outcome and calls `park_thread`.

Neither skill can strand a thread, because `resume_thread` performs the pointer write itself and `park_thread` releases it. The rules are in the server.

**Never auto-select a thread** by recency, by modification time, or by branch. Present and stop.

---

## 10. The error contract

### 10.1 Two channels, used correctly

| | Protocol error | Tool error (`isError: true`) |
|---|---|---|
| Use for | Unknown tool, malformed request, server fault | **Every validation failure**, every business-rule refusal |
| Client behaviour | Less likely to result in recovery | Provided to the model **to enable self-correction** |

Rule: a validation failure is never a protocol error.

### 10.2 The shape of a refusal

Every refusal states four things:

1. **which field** was wrong,
2. **what is accepted**, generated from the schema (§6.1),
3. **a valid example**,
4. **whether a retry can succeed**.

The current build fails on 2 and 3 and it is the open criterion that three corrective units failed to close. Reproduced during this SPEC's authoring: a cap refusal named the field and the limit, and its example field was `null`, so the caller could not tell which of several values was too long.

### 10.3 Absence is not failure

Root cause E4, stated as a rule: **a read that failed is an error; only a read that succeeded and found nothing is empty.**

The signature failure to eliminate: an unset environment variable currently renders to the user as *"no resumable threads"* — a confident positive claim about a store that was never read. In the rebuild, an unreadable store is an error naming the store path and the reason.

Every swallowed exception is removed. A hook that crashes reports that it crashed.

### 10.4 Text from storage is never server-authored

Ledger text reaches the model in the briefing, the roster, decision reads and the pointer diagnostic. Stored text must not be able to forge server-authored instruction — a stored title containing a heading marker must render as one line with the marker inert.

Escaping covers the **union** of the format class and the blank class; these are not the same set. Clipping is by grapheme, never by code unit, because slicing code units emits lone surrogates that non-JavaScript clients refuse to decode.

A test asserts that **no** interpolation site in the briefing or roster renderer bypasses the escaping helper. That is a census over the renderer, not a sample.

Refusals never disclose an absolute filesystem path. The directory travels on a non-emitted property so every call site is covered at once.

---

## 11. Testing

### 11.1 The bar

> If a green pipeline does not prove the plugin works when used live, it is a bad test and a waste of time.

This is achievable for most of the system and **not all of it**. §11.9 names the gap plainly rather than pretending it away.

### 11.2 What is wrong with the current suite, measured

The problem is not 101 files. It is where the weight sits.

| Measurement | Value |
|---|---|
| Individual tests | 1,044 (a later run under a scrubbed environment reports 1,059; the suite is not stable across environments, which is itself defect §11.8) |
| Tests that drive the **real server** | **16 (1.5%)** |
| Tests that call module functions with a hand-built context | **1,028 (98.5%)** |
| Tools declaring an output schema | **0** |
| Coverage command | none exists |

Two findings settle the argument:

**The suite is green and it means nothing.** Eighteen consecutive review rounds each found a real defect at 100% pass, and **nine were introduced by the fix for the one before.**

**The suite is structurally blind.** The tool-level fixture always creates a **non-git** temporary directory, so no tool test anywhere has ever exercised the git-backed path — which is where the critical defects live. This is worse than a weak assertion: the fixture quietly builds a *different system* than production. With the rebuild git-only (0067), that fixture defect would be fatal.

**Proof that assertions can be inert:** deleting three lines of production code left the suite fully passing at the count measured that day (971). The three totals in this section — 971, 1,044 and 1,059 — are separate measurements on different days and under different environments; none is reconciled, and that is the point of §11.8.

### 11.3 Anti-patterns, and what replaces each

| Anti-pattern | Why green lies | Replacement |
|---|---|---|
| A hand-built context no real caller produces | Skips parsing, validation and marshalling entirely | Generate inputs from the server's own published schema; drive them through the real transport |
| The fixture builds a different system than production | Not a bad assertion — a substituted system | The fixture builds a **real git repository** |
| Asserting a rejected promise at an MCP boundary | Tool failures resolve **in band** as an error result; they do not reject. The assertion passes only when something *else* broke | Assert the error flag **and** the payload |
| Mocking git, the SDK, or the client | Encodes your belief, then verifies your belief | Use the real thing. Git is local and cheap |
| Asserting that functions call each other | Implementation detail; breaks on behaviour-preserving refactors | Assert observable behaviour at a public surface |
| Snapshot-everything, assert-not-null | A snapshot regenerated to go green is a rubber stamp; a truthiness check passes for `1`, `"false"` and `[]` | Assert the value |
| Coverage as a target | A high number does not imply quality | Report it; gate on mutation score instead |

### 11.4 The layers, and what each is for

| Layer | Proves | Cannot prove | Count | Gate |
|---|---|---|---|---|
| Pure logic and property tests | The done gate, merge rules, caps, state transitions | Anything crossing a boundary | ~300 | blocking |
| Real-git store tests | Actual git semantics: refs, plumbing, merges, compare-and-swap | The MCP layer | ~80 | blocking |
| **Real-spawn contract tests** | Framing, handshake, schema validation, stdout hygiene, entry point, environment, the shipped artifact | What the model chooses to do | **~60** | blocking |
| Hook subprocess tests | The stdin/stdout contract, exit codes, anti-hang | That the harness sends these payloads | ~40 | blocking |
| Cross-boundary contract tests | Hook matcher against live tool names; skill references against live schemas | — | ~10 | blocking |
| Two-clone merge scenarios | Two people diverge offline and lose nothing | Network, auth, a real forge | ~10 | blocking |
| Inspector smoke | An **independent** client implementation reaches the server | Correctness — it has no assertions | 1 | blocking |
| Mutation testing | That the assertions assert | That the right behaviours were chosen | diff-scoped | blocking |
| End-to-end in a real session | The harness loads the plugin and the tools fire | Determinism | ~5 | nightly, non-blocking |

About 500 tests replacing 1,044. Real-transport coverage goes from **16 tests to about 60** — from 1.5% of the suite to about 12%, so roughly four times the count and eight times the proportion.

**Why real-spawn is not the expensive top layer here.** For a stdio server it is the only honest in-band entry point. The in-memory linked transport speaks an older protocol era than the server ships against, and the in-process handler entry belongs to the HTTP path, which this server does not have.

**What only a real spawn can catch:**

- **Stray stdout.** The transport *is* stdout. One stray write — yours or a dependency's — breaks it with a parse error naming only the first character of the stray output. The in-memory transport passes objects by reference, so it is structurally blind to this.
- A broken entry point, shebang, or executable bit.
- Bad module resolution in the built artifact.
- Environment stripping: a spawned child receives only an allowlist, so a server depending on an inherited variable works in process and dies when spawned.

### 11.5 Named tests

Every tool gets at least one of each of the first two. Named tests below are the ones that are load-bearing rather than routine.

**Per tool, mandatory**

| Test | Asserts |
|---|---|
| `<tool>.spawn.contract` | Real binary spawned over real stdio: the tool appears in the listing, a valid call returns a result conforming to its declared output schema, and stderr contains nothing meant for stdout |
| `<tool>.rejects-invalid` | Inputs **generated from the tool's own published schema**, negated: each is refused as a tool error naming the field, the accepted shape, an example, and retryability |

**The two named defects**

| Test | Asserts | Red on |
|---|---|---|
| `resume.round-trip` | Open a thread, park it, resume it, park it again. **The second park succeeds.** | The parent commit — this is the reproduction of the current permanent-`paused` defect |
| `resume.idempotent` | Calling resume twice on one thread is not an error and leaves one pointer | — |
| `handoff.fires-once` | Across 10 simulated turns with a thread open, the hand-off notice fires **zero** times; at session end it fires **once** | The parent commit — currently 8 of 8 turns fire |
| `handoff.detects-crash` | A pointer left set by a killed session is reported at the next session start | — |
| `worktree.absent` | The string `worktree` appears nowhere in the storage layer, and no directory is created inside the project | — |
| `store.survives-branch-switch` | Write records; check out a different branch; check out a third; **every record still reads identically**, and `git status` is unchanged before and after a ledger write | — |
| `store.leaves-index-alone` | Stage a file in the project, perform a ledger write, assert the staged set is byte-identical | — |
| `store.never-reads-head` | A ledger write performed with `HEAD` detached, mid-rebase, and on an unborn branch all succeed | — |

**Team sync — the gate from the first unit onward**

`sync.two-clones-offline` is the acceptance test for 0065 and is described in full in §11.6.

| Test | Asserts |
|---|---|
| `sync.two-clones-offline` | Two real clones, diverged offline, merged: nothing lost, no collision, no corruption, convergence, order-independent |
| `sync.conflict-refuses` | Both sides change one scalar differently: the server refuses, both sides remain addressable, nothing is pushed |
| `sync.cas-retry` | A ref moved by another process between read and write causes a re-read and retry, not a clobber |
| `sync.identity` | Every ledger commit carries the caller's configured name and email, not a synthetic one |

**Durability and concurrency**

| Test | Asserts |
|---|---|
| `write.atomic-on-failure` | A write injected to fail at its third step leaves the store **byte-identical** to before |
| `write.no-orphan-record` | A failed decision recording leaves zero files behind and consumes no identifier |
| `concurrent.distinct-ids` | Concurrent recordings produce distinct identifiers, tested with **real** concurrency, not a mock |
| `concurrent.second-process-destroys-nothing` | Process A writes without committing; process B starts and reads; A's record still resolves and B sees a consistent store |
| `read.quarantines-one-bad-record` | One deliberately corrupt record is reported quarantined **in place**, and every other record still returns |

**Trust boundary**

| Test | Asserts |
|---|---|
| `render.no-unescaped-site` | A **census** over the renderer: every interpolation site passes through the escaping helper. Halts on anything it cannot classify |
| `render.title-cannot-forge-heading` | A stored title containing a heading marker and newlines renders as one line, marker inert |
| `render.roster-cannot-forge-instruction` | The same, for the session-start roster, which reaches the model before any user turn |
| `error.discloses-no-path` | No refusal carries an absolute filesystem path |

**Cross-boundary contracts**

| Test | Asserts |
|---|---|
| `contract.hook-matcher-covers-tools` | The write-guard matcher is checked against tool names taken from a **live listing**, including the plugin-namespaced form |
| `contract.skill-references-exist` | Every tool name and argument referenced in a skill file exists in a live listing and its schema |
| `contract.instructions-within-budget` | Server instructions and every tool description are under 2 KB |
| `contract.every-property-described` | A census: every property of every input schema has a non-empty description. **Fails the build otherwise** |

**Hook behaviour**

| Test | Asserts |
|---|---|
| `hook.<name>.stdout-pure` | First non-whitespace character is `{` and the whole of stdout parses |
| `hook.<name>.no-hang` | Runs against its corpus with a wall clock at **half** its declared budget and exits. A timed-out hook fails open, silently disabling the gate |
| `hook.<name>.crash-is-visible` | A handler that throws produces a non-zero exit and a diagnostic, never a silent success |
| `hook.guard.denies-symlinked-store` | A store reached through a symlink is still guarded; canonicalisation failure refuses rather than narrows |
| `hook.fixtures.typecheck` | Every hook event fixture type-checks against the **pinned** published hook types. A fixture that stops type-checking fails the build |

### 11.6 The worked example: two teammates, offline

This is the acceptance test for team sync and the model for every honest test in the suite.

**Setup — all real, nothing hand-built.** A real bare repository as the shared remote; two real clones; two real server processes, one per teammate, each spawned over real stdio.

**Execution.** Both sync from a common base. Both go offline — by pointing the remote at a path that does not exist, which is real, not simulated. Each records a decision. Both come back online. Ana syncs first; Ben must merge rather than clobber.

**Assertions — all properties, no literals.**

1. **Nothing lost.** Ben's store holds **both** decisions.
2. **No collision.** The two identifiers are distinct.
3. **No corruption.** Every merged file parses, and **no file contains conflict markers**.
4. **Convergence.** After Ana's next sync she sees Ben's decision.
5. **Order-independent.** The entire scenario re-runs with Ben pushing first, and every assertion holds.

**What this catches that a mocked test cannot:**

| Failure | Mocked | This test |
|---|---|---|
| Both allocate the same identifier; one file overwrites the other | green | **red at 2** |
| A record merged line-wise into syntactically invalid JSON | green | **red at 3** |
| Sync force-pushes and erases Ana's work | green | **red at 1** |
| Conflict markers written into a record | green | **red at 3** |
| The server writes a diagnostic to stdout, breaking the transport | green in memory | **red — the client cannot parse the reply** |
| The second sync does not fetch, so Ana never converges | green | **red at 4** |
| Merge only works when Ana pushes first | green | **red at 5** |

Every input arrives from a real tool call. Every assertion is a property — count, uniqueness, parseability, convergence. There is nothing to hard-code and nothing to drift.

### 11.7 Inputs are generated, not written

Where a test needs a valid input, it is **generated from the tool's own published schema**. An input cannot then be hard-coded by construction, and it cannot drift from the schema, because it is derived from it.

No maintained general schema-to-generator bridge exists — the obvious candidates were last published in 2019 and 2023 and are dead. The adapter is therefore **written and owned in this repository**, covering the schema subset actually used. It is small because the schemas are simple, and owning it means it cannot rot silently.

For the store, model-based testing generates random legal sequences of operations and compares against a **simplified model** — counters and a state enum. The model must never become a second implementation: comparing the code against a copy of itself proves nothing.

A property failure is fixed by committing a regression test pinned to the reported seed, never by loosening the property.

### 11.8 Determinism, and the referee

- **Clock and identifier generation are injected.** Production wires the real ones; tests wire controlled ones.
- **No test asserts a literal identifier or timestamp.** It asserts the property: correct length, correct alphabet, unique, and the embedded time decodes to the injected clock. Ordering is asserted only across distinct milliseconds, because same-millisecond ordering is not guaranteed.
- **Environment is an injected argument, never defaulted to the ambient process.** The current suite reads the developer's shell: with one variable set it fails 31 tests; scrubbed, it passes all 1,059. A suite whose result depends on who runs it is not a suite.
- No sleeps, no real network, no shared mutable state. Temporary directories are created atomically, never composed from a timestamp.
- **Retry-until-green is forbidden.** A flaky test is quarantined off the critical path with a filed owner.
- **Mutation testing gates the diff**, with an explicit break threshold — never 100%, because equivalent mutants are undecidable.
- Coverage is reported and never gated. It is read for what is *not* covered.

### 11.9 The ceiling: what CI cannot prove

Named plainly, because pretending otherwise is the dishonesty this section exists to prevent.

1. **That the model will choose to invoke a skill or tool.** Skill descriptions are matched by a language model. No deterministic test reaches this. The plugin evaluation harness is the only instrument that measures it, and it is currently gated per organisation and unavailable.
2. **That hook payloads are what the harness actually sends.** No machine-readable schema is published. The shipped types are de facto normative but never stated to be. Mitigation: pin the types alongside the fixture corpus and re-capture from a live session on every client upgrade.
3. **That wire messages conform to the specification.** The official conformance runner drives HTTP servers only and cannot drive stdio. Unresolved.
4. **That a real remote behaves like a local bare repository.** Authentication, rate limits and branch protection are untested.
5. **That the installed plugin behaves like the working tree.** CI tests the tree. Only a packaged-install test narrows this.

**The honest claim green makes is therefore precise:** *every deterministic surface of this plugin behaves correctly through its real interfaces.* Items 1 and 2 are tracked as named risks with a re-check cadence, not closed.

---

## 12. The development loop

### 12.1 Language and build

TypeScript. The deciding argument is distribution: the plugin manifest has **no** platform, operating-system or architecture field, so a compiled language must ship several binaries plus a shell selector, and a shell selector breaks on Windows. TypeScript ships one platform-independent artifact.

- **Development needs no build step.** Node runs TypeScript directly and its test runner runs TypeScript tests. Type stripping is stable, and it leaves stdout untouched — verified, which matters because a single stray byte breaks the transport.
- **Release builds.** Type stripping performs *no type checking*, so a bad import is a runtime crash that reaches the client as a dead pipe. `tsc --noEmit` runs before every commit; the release artifact is compiled.
- The build must restore the executable bit, which the compiler drops.
- **One schema library**, the one the SDK already depends on. Adding a second would mean two schema libraries and two mental models for no gain; the goal of one declaration yielding type, validator and wire schema is met by the SDK's own.

### 12.2 The Inspector

The MCP Inspector is the missing dev loop — it is absent today, with zero mentions repository-wide. Version 2 ships a web interface, a terminal interface and a command line behind one binary.

**Pin the version exactly.** Version 2 was a full rewrite, and nearly all published guidance describes version 1: the proxy port, the old token variable, and "the CLI exits 0 on failure" are all wrong now.

| Question | Where it is answered |
|---|---|
| What tools exist and what is their schema? | Inspector, tools panel |
| Does this tool return the right thing? | Inspector, tools panel, form-filled |
| Why did the server fail to start? | Inspector, console panel — this is the server's stderr |
| What actually went over the wire? | Inspector, protocol panel |
| Did the server break since the last commit? | Inspector command line, in CI, on exit code |
| Does the tool reject invalid input correctly? | A test, not the Inspector — it has **no** schema validation of arguments |
| Is the server connected inside a real session? | The client's own server view |
| Does the model choose to call the tool? | The evaluation harness, when ungated |

**A separate Inspector configuration file is required.** The plugin's own server configuration contains substitutions only the client expands; pointed at the Inspector it fails to resolve a module. Two files, deliberately.

**In CI the Inspector is one smoke step, not a contract test.** Its value is that it is an *independent* client implementation, so it catches "my server only works against my own harness". It has no assertions.

### 12.3 Guard rails that exist from the first commit

| Guard | Why |
|---|---|
| A lint rule forbidding any write to stdout in server code | The transport is stdout. This is the highest-value five minutes in the project |
| `tsc --noEmit` pre-commit | Type stripping does not type check |
| The description census (§11.5) | Zero described properties is the mechanical cause of the reported bug |
| The escaping census (§11.5) | A sampled check over a trust boundary is not a check |

### 12.4 Diagnostics

Structured single-line records to **stderr**, never stdout. This is what the specification now prescribes, and the client already captures stderr to disk per server. Level is set by environment variable, because nothing over the wire sets it any more.

---

## 13. Delivery

### 13.1 Shape

Twelve units. Each is independently shippable and merges green. That is free before cutover because the rebuild grows as a **parallel tree** alongside the existing one (0066), so nothing the installed plugin loads is touched until M12. This is what reconciles §2.8 — this repository IS the running plugin — with the claim that intermediate units are safe to merge: they are safe precisely because the running plugin cannot see them.

**Every unit, without exception:**

1. re-verifies its premises against the tree before code is written, and records the result (§2.3);
2. declares its acceptance criteria before starting, and treats them as a ceiling (§2.4);
3. ships at least one assertion **proven red on the parent commit**;
4. ships an **inertness mutation**: revert what the unit added and the assertion must turn red. A test that survives that is not testing the change;
5. fixes what it introduces and files what it inherits (§2.5).

### 13.2 The units

| # | Unit | Depends on | Acceptance |
|---|---|---|---|
| **M1** | **Record model and store** — one declaration per record type emitting type, validator, wire schema and refusal text; plain-directory working copy; plumbing write path; compare-and-swap ref moves; the durability sequence; ULID identities; caller git identity. The stdout lint rule lands here. | — | `store.survives-branch-switch`, `store.leaves-index-alone`, `store.never-reads-head`, `write.atomic-on-failure`, `read.quarantines-one-bad-record`, `worktree.absent`, `sync.identity` all pass. Every record element carries a stable id |
| **M2** | **Merge and sync** — field-level merge, conflict refusal, fetch/merge/push, retry on a moved ref. | M1 | **`sync.two-clones-offline` passes**, plus `sync.conflict-refuses` and `sync.cas-retry`. This is the 0065 gate and it stays green for every later unit |
| **M3** | **Server skeleton** — current SDK line, stdio, server instructions, registration, structured output, annotations, the error contract, and the real-spawn test harness. | M1 | A spawned binary completes the handshake and lists its tools; a deliberate stdout write fails the suite; `contract.instructions-within-budget` passes |
| **M4** | **Lifecycle tools** — `open_thread`, `update_thread`, `close_thread`, `amend_criteria`, the done gate, caps. | M3 | The done gate refuses and names every outstanding criterion; every tool has spawn and rejection tests; `contract.every-property-described` passes |
| **M5** | **Resume and park** — `resume_thread` and `park_thread`, pointer ownership, crash detection. | M4 | **`resume.round-trip` is red on the parent and green here.** `resume.idempotent` passes. Resuming is one call |
| **M6** | **Decisions and session logs** — `record_decision` with supersession, `log_session_event`, immutability. | M4 | `concurrent.distinct-ids` under real concurrency; `write.no-orphan-record`; no tool can amend a recorded decision |
| **M7** | **Reads** — `list_threads`, resources including the static index resource, completions, pagination. | M5, M6 | Every address in `logbook://index` resolves; the roster renders blockage reasons; a resource read never mutates |
| **M8** | **Hooks** — the six events on correct bindings, the session-end notice, the once-per-session verbatim latch, the write guard, in-process calls. | M5 | **`handoff.fires-once` is red on the parent and green here.** Every hook has purity, anti-hang and crash-visibility tests. `contract.hook-matcher-covers-tools` passes. Plugin half under 400 lines |
| **M9** | **Skills** — preflight and debrief as pure orchestration. | M8 | `contract.skill-references-exist` passes; neither skill holds a rule; preflight presents and stops |
| **M10** | **Trust boundary** — escaping, the renderer census, path non-disclosure. | M7 | `render.no-unescaped-site` is a halting census; the forgery tests pass on briefing and roster |
| **M11** | **Dev loop and CI** — Inspector configuration and scripts, the CI pipeline, mutation testing with an explicit threshold, coverage reporting. | M3 | The full gate runs on a clean checkout; a seeded mutation is caught; the Inspector smoke step exits 0 |
| **M12** | **Cutover** — flip the manifest, delete the old tree, ship 1.0.0 with both manifests in agreement. | all | Packaging check passes; a fresh install serves the new server; the old tree is gone |

### 13.3 Ordering

M1 → M2 and M1 → M3 are the only hard serialisations at the start; M2 and M3 then run in parallel. M4 unlocks M5 and M6, which unlock M7. M8 needs M5. M10 needs M7. M11 needs only M3 and can run alongside almost anything. M12 is last.

Two units must **not** run in parallel: M5 and M9 both touch the preflight surface — the same collision that made two units of the previous attempt unsafe.

### 13.4 What "done" means for the whole rebuild

1. Every unit merged or retired by a recorded decision naming the reason.
2. Every defect in the register closed by a named unit or explicitly deferred with an owner. None silently dropped.
3. A refusal from any tool names its field, an accepted example, and whether retry can succeed.
4. No call leaves partial durable state; concurrent calls never collide on an identifier.
5. Stored text cannot forge server-authored instruction on any surface.
6. Two people working offline and merging lose nothing.
7. Ships 1.0.0 with both manifests in agreement.

Items 3, 4, 5 and 7 are the four criteria the previous attempt left open. Item 6 is new and is what 0061 made first-class.

---

## 14. Accepted risks and open questions

Stated rather than resolved. None blocks the work.

| # | Item | Disposition |
|---|---|---|
| 1 | Whether the model reliably chooses to invoke the skills | Unmeasurable until the evaluation harness is ungated. Tracked, re-check when it opens |
| 2 | Whether the published hook types match what the harness sends | De facto normative, never stated. Mitigation: pinned types plus live re-capture on client upgrade |
| 3 | Node does not document a directory-flush API | The implementation opens the directory and flushes the handle. If unavailable on a supported platform, record as an accepted durability shortfall rather than skipping it silently |
| 4 | Wire-level specification conformance | The official runner cannot drive stdio servers. Unresolved; not worked around |
| 5 | Real forge behaviour versus a local bare remote | Authentication, rate limits and branch protection untested |
| 6 | Whether branch bindings and drift detection are worth their weight | Genuinely open. 0061 withdrew the recommendation to cut them because drift detection is inherently multi-user. `bind_branch` ships; drift signals are deferred until a second user exists |
| 7 | How the client renders structured content to the model | Unverified. Does not block: the human-readable block is authored by hand regardless |
| 9 | Two teammates can work one thread at the same time without either being told, because the active pointer is machine-local by design (§6.4) | Accepted. A committed lock needs a network round trip, strands a thread when a machine dies holding it, and fails in the offline case team sync exists for. The field-level merge is the protection instead |
| 8 | The current SPEC's own untracked report | The 3.6 MB open-questions report is untracked and exists on one machine only |

---

## 15. Binding decisions

| # | Decision |
|---|---|
| 0060 | TypeScript is the language a greenfield Logbook would be built in |
| 0061 | The git backend exists for multi-user team sync, so single-user assumptions are defects |
| 0062 | No database at any layer; plain file-per-record stays |
| 0063 | The ledger keeps its own records; git history does not replace them |
| 0064 | Clean break: the rebuild starts on an empty store |
| 0065 | Team sync ships working in v1, gated by a real two-clone merge test |
| 0066 | The rebuild grows as a parallel tree and lands through one cutover |
| 0067 | Git repositories only; non-git deferred out of scope |
| 0068 | Build on the current SDK line, with no separate verification spike |
| 0069 | The MCP surface is tools, resources and structured output, plus annotations, completions and pagination |
| 0070 | Records live in a plain directory and reach an orphan ref through git plumbing, with no worktree |
| 0071 | The server merges records field by field and refuses on a genuine conflict |
| 0072 | The ledger ref lives outside `refs/heads` and no ledger write touches HEAD, the index or the work tree |
| 0073 | A thread stores one of three states; being worked and being blocked are derived or field-borne |
| 0074 | Session logs are kept and given a reader by publishing them as resources |
| 0075 | Decision records are identified by ULID, shown as a short prefix, with no project-wide counter |
