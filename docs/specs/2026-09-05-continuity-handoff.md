# SPEC: Continuity Hand-off

Status: Approved for planning. No code written against it yet.
Thread: not yet opened. The ledger store was wiped on 2026-09-04 and holds no threads, so this document names no thread id and discharges no criterion.
Parent commit: `3d3148fe`, version 5.0.0, suite green 800/800.
Identifiers: invariants are `I#`, units are `U#`, rulings are `H#`. Rulings are lettered `H` rather than `R` because `R#` is frozen — `docs/specs/2026-08-25-post-cutover-repair.md` already numbers its design rulings `R1`–`R10`, and the goal-model specification reserves the letter against reuse.

---

## 1. What is wrong

> A fresh session cannot learn where the previous one stopped. The record says which goals are open and what happened last session. It says nothing about where inside an unfinished goal the work halted, and nothing about which documents describe the route.

The consequence is the one the product exists to prevent. A second person picking up a thread must reconstruct position from git history, from the diff, and from guesswork — the re-derivation Logbook was built to remove.

Six defects produce it.

**The route is unreachable.** A thread has no writable field for the documents that describe its work. `artifacts` exists on the schema and renders in the briefing, and no tool input accepts it — the slot exists and the door does not. Worse, the field is declared `union-by-id` in the merge strategy table at `src/merge/field-merge.ts:16-34` while `mergeThreadTraced` never reads it and the merged record it builds at `src/merge/field-merge.ts:242-260` has no `artifacts` key at all. Every merge drops the whole array. Nothing writes it today, so nothing is lost yet; a writer added without wiring the merge would lose data on the first sync.

**Declared focus does not survive the session that declared it.** `focus` is written to the session pointer and never to the record (`src/domain/pointer.ts:30,63,75`), and `park_thread` releases the pointer. One production site reads it (`src/render/briefing.ts:418`), where it reorders risks and key decisions within their section and does nothing else. Measured against forty risks, the twenty focused and the twenty unfocused clip to the identical length; each focus id costs 28 bytes against the payload budget, so declaring focus makes the briefing marginally shorter for everyone. The lanes were load-bearing when `cbebe5ca` introduced them with hard caps; `955ab941` deleted every cap, and `f1d6504b` reintroduced focus three commits later into a renderer that no longer drops anything.

**Focus is demanded before the briefing that would inform it.** `skills/preflight/SKILL.md:15-16` waits for the human to name criterion ids at step 8 and prints the briefing at step 10. A person resuming with no context has seen only a roster row — title, slug, a done-over-total count, a timestamp — and is asked for identifiers that row does not carry.

**`next_step` is unconstrained.** `skills/debrief/SKILL.md` asks for "the next step a later session picks up, as one plain sentence" and says nothing further. `park_thread`'s schema describes the field as replacing the stored value. Neither states what belongs in it, so `continue MSP 3` and a usable instruction are equally valid.

**A retired risk comes back.** `update_thread.risks_retire` filters the entry out of the array at `src/server/tools/update_thread.ts:378` and leaves no marker. `unionByIdWithConflict` at `src/merge/field-merge.ts:121-145` never receives the merge base, so an id present on one side only is pushed unconditionally at `:141`. A deletion and an addition are the same call. The resurrection is already filed at `docs/specs/2026-08-26-briefing-scoping-repair.md:110` and has never been fixed.

**Nothing is recorded unless a session records it.** Six hooks are declared in `hooks/hooks.json:3-26` and not one writes a session log entry. Only `log_session_event`, `park_thread` when supplied an `outcome`, and `close_thread` ever write one. There is no `SubagentStop` hook, so a subagent finishing writes nothing. `src/cli/session-end.ts:26-37` only reports. A session that resumes, works, and is killed leaves `refs/logbook/ledger` on the commit it held at resume, with the thread's running summary still describing the previous session.

**The Stop gate proves the wrong thing.** `ledgerPresenceVerdict` at `src/hooklib/stop-gate.ts:76-92` blocks when the session holds the pointer and the ledger ref has not moved since resume. Any movement clears it, including a commit on an unrelated thread — the repo's own test demonstrates exactly that. `resume_thread` does not count, because it writes only the pointer and the baseline (`src/server/tools/resume_thread.ts:99-100`). The gate proves that something reached the ledger, never that the thing describes this session's work.

---

## 2. Evidence law

Where this document and the code disagree, the code wins and this document is wrong. Every claim in section 1 carries a `path:line` or a stated measurement.

A finding surfaced during implementation that sits above a unit's acceptance ceiling is filed, not folded in. A unit that grows to absorb an adjacent defect has stopped being reviewable.

---

## 3. Scope

### In

Seven units, listed in section 5. Together they delete declared focus, give the hand-off record a second field, make `artifacts` writable and actually merged, convert both removals to tombstones, put the continuation rule in the briefing, teach both skills what the record is for, and tighten the Stop gate to the held thread.

### Out

**The base-blind array merge.** `unionByIdWithConflict` cannot distinguish a deletion from an addition because it never sees the merge base. Tombstones work around this one collection at a time. A general fix touches criteria, risks, key decisions and out-of-scope together and changes conflict behaviour across the sync path. Filed. See `H7`.

**Migration of existing records.** Ruled out. No data written by an earlier version is carried forward, and no unit budgets for reading an older shape.

**`spine.last_session`.** Already reduced to a legacy fallback that renders only when a thread has no session entries. Left exactly as it is.

**Automatic capture of session content.** A hook holds a session id, a thread id and a timestamp. It does not hold what the session did, so no hook can write the record that is missing. The remedy is behavioural and lands in `U6`.

---

## 4. Invariants

- **I1 — No resurrection.** A removed artifact or a retired risk that meets a machine which has not removed it stays removed, or raises a conflict. It never silently returns.
- **I2 — Removal is invisible.** A retired artifact or risk never renders in the briefing. The tombstone is a mechanism for surviving a sync, not a history feature.
- **I3 — Artifacts carry no state.** An artifact has an id, a label, a pointer, and a tombstone. It never carries a done, complete, current, or in-progress flag.
- **I4 — Nothing infers position.** No code reads a criterion's ordinal, a file's contents, or git state to decide where a session resumes. Position comes from `spine.landed` and `spine.next_step` alone.
- **I5 — The server authors nothing.** Every stored value is supplied by the caller. Logbook validates, refuses, and stores. It makes no model call and holds no API credential.
- **I6 — A declared merge strategy is wired.** No field appears in the merge strategy table without the merge reading it. A census asserts the two are the same set.
- **I7 — Red on parent.** Each unit ships a test that fails on its parent commit and passes on the unit.
- **I8 — The goals are the authority.** A route is a proposal for satisfying the goals. Where a route and the goals diverge, the goals win, and no code or rendering may present a route as authoritative over a goal.
- **I9 — The Stop gate proves the held thread.** The gate clears only on ledger movement that touches the thread this session holds. Movement on any other thread does not clear it.

---

## 5. Units

Seven units across five waves. Files are disjoint within a wave; across waves they are sequenced.

| # | Unit | Wave | Owns | Red-on-parent test asserts | Schema? |
|---|---|---|---|---|---|
| **U1** | Remove focus | 1 | `src/domain/pointer.ts`, `src/render/briefing.ts`, `src/server/tools/resume_thread.ts`, `src/server/tools/update_thread.ts`, `skills/preflight/SKILL.md`, `test/unit/briefing-focus.test.ts`, `test/spawn/focus.test.ts`, `test/support/published.ts`, `test/support/optional-argument-recipes.ts` | `resume_thread` rejects a `focus` argument as an unrecognised key, and the briefing renders no Focus line | no |
| **U7** | Stop gate names the thread | 1 | `src/hooklib/stop-gate.ts` | A commit touching only an unrelated thread leaves the gate blocking | no |
| **U2** | Schema | 2 | `src/schema/thread.ts`, `src/schema/caps.ts` | `spine.landed`, `Artifact.retired` and `Risk.retired` each parse and default as declared; nothing reads them | yes |
| **U3** | Merge | 3 | `src/merge/field-merge.ts` | A one-sided artifact survives a merge, a one-sided tombstone raises a conflict, and the census fails on a declared-but-unwired field | no |
| **U4** | Writers | 4 | `src/server/tools/park_thread.ts`, `src/server/tools/update_thread.ts`, `src/server/tools/open_thread.ts` | `park_thread` stores `landed`; `artifacts_add` and `artifacts_retire` round-trip; `risks_retire` marks rather than deletes | no |
| **U5** | Briefing | 5 | `src/render/briefing.ts` | `landed` renders beside the next step, a retired artifact and a retired risk render nowhere, and the continuation rule renders verbatim | no |
| **U6** | Skills | 5 | `skills/preflight/SKILL.md`, `skills/debrief/SKILL.md` | `preflight` resumes before it asks anything; `debrief` passes both hand-off fields | no |

`U1` runs first because it is a pure deletion, and because it frees `briefing.ts` and `update_thread.ts` for the later waves.

`U2` lands every new field nullable. Nothing reads them in that wave, so the unit ships without a behaviour change.

### What each unit changes

**U1.** `focus` leaves the pointer schema, the briefing, both tools that accept it, and the preflight skill. Three fields leave the published wire contract: `resume_thread.focus`, `update_thread.focus_written`, `update_thread.focus_not_written_reason`. This is a breaking output change and is stated as one. Two census support files carry recipes for the deleted arguments and halt on an entry they cannot classify, so both are updated in this unit rather than after it. Deleting the field also removes the guard at `src/domain/pointer.ts:30` that makes a malformed `focus` fatal, so a pointer file carrying garbage in that key moves from corrupt to parsed-and-ignored. That is a widening and is accepted.

**U7.** `ledgerPresenceVerdict` gains a path filter. It already holds the ledger head recorded at resume, so it diffs that commit against the current head and clears only when a changed path names the held thread — the thread record itself, or a session entry beneath it. The blocking message says which thread it is waiting for.

**U2.** `spine.landed` is added as a nullable string capped at 500 characters, matching the other spine scalars. `Artifact` gains `retired: boolean`, defaulting false. `Risk` gains the same.

The tombstone is a boolean rather than a ULID naming a decision, unlike `Criterion.struck_by`. Two reasons. Striking a criterion is a scope decision and is worth attributing; removing a supporting document is not, and requiring a recorded decision to drop a stale bookmark is disproportionate — `risks_retire` takes no decision today. And a boolean merges correctly where a timestamp does not: two machines that independently retire the same entry both hold `true` and agree, where two differing timestamps would raise a conflict that means nothing. Since `I2` keeps the field out of every rendering, it carries no information a reader would ever see, so it is sized for the merge alone.

**U3.** `artifacts` is wired into `mergeThreadTraced` and into the merged object literal — the two edits the existing census does not distinguish, which is why the field passes its check today while being dropped by every merge. The tombstone field participates in the content comparison, so a removal on one side and not the other raises a conflict rather than losing. A new census asserts that every field in the strategy table is actually read by the merge, which is `I6`.

**U4.** `park_thread` accepts `landed` alongside `next_step`; both stay optional, so omitting them remains a pure pointer release. `open_thread` accepts an initial artifact list. `update_thread` gains `artifacts_add` and `artifacts_retire`, matching the shape of `risks_add` and `risks_retire`. `risks_retire` stops filtering the array and sets `retired_by` instead.

**U5.** The briefing renders `landed` immediately before the next step, under a heading naming the two together as the hand-off. Retired artifacts and retired risks are excluded from the render. The slot vacated by the deleted Focus line carries the continuation rule, verbatim:

> Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.

**U6.** `preflight` loses the focus steps and resumes as soon as a thread is chosen, printing the briefing before asking anything. It gains the instruction that a session records as it goes rather than only at hand-off. `debrief` gains the questions that fill the two fields — for `landed`, which goals moved and what their checks returned, what was verified rather than assumed, and what was started and where it stopped; for `next_step`, the single next action, specific enough to begin without re-deriving, naming a file and place when one is involved.

---

## 6. Rulings

### H1 — Focus is deleted, not repaired

Human-ruled. Focus reorders two lists and does nothing else; the measurement shows a focused item clipping identically to an unfocused one, and each declared id costs the briefing about fourteen characters. The mechanism it belongs to was deleted three commits before it was introduced. Repairing it would mean rebuilding the caps that made lane membership decide survival, which `955ab941` removed on purpose.

### H2 — The hand-off does not point into the artifact list

Human-ruled. Naming one artifact as current assumes one document is the route, which is a workflow assumption rather than a fact — a migration needs its schema note, its runbook and its rollback plan at once. Logbook cannot validate a pointer or an anchor, so a structured reference buys nothing it can act on, and a vague action is not rescued by a second field.

### H3 — Artifacts carry no completion state

Human-ruled. Artifacts are supporting documents; the goal is what stays checkable. The one hand-maintained status field in this repository's own documents is currently false, which is what a state flag on a pointer produces.

### H4 — Removal is a tombstone in storage and absent from the briefing

Human-ruled. A struck criterion renders because a scope change is history worth reading. A removed artifact does not, because a stale bookmark is not. The marker exists so the removal survives a second machine, not so a reader sees it.

### H5 — Logbook makes no model call

Human-ruled, after the alternative was put and examined. Sampling — the protocol mechanism by which a server asks the client for a completion — is deprecated as of protocol version `2026-07-28`, so a server-side call would need its own credential and its own network dependency. It would also reach a model holding strictly less context than the session that just did the work. The prompting lives in the skill, where the context already is; the schema is the gate.

### H6 — No migration

Human-ruled. No data written by an earlier version is carried forward, and no unit budgets for reading an older record shape.

### H7 — The base-blind array merge stays out of scope

Human-ruled. The general fix is correct and materially larger. Tombstones address the two collections this specification touches.

### H8 — The goals are the authority, not a fallback

Human-ruled, correcting an earlier draft of this document. An earlier form of the continuation rule read "where no route is listed, run the checks on the open goals" — presenting the goals as a backup for a missing plan. That inverts the relationship. Goals are invariants: when a route's requirements are fully met the goals are also met, and checking work against them is continuous rather than terminal.

---

## 7. Known risks

| Risk | What makes it real |
|---|---|
| A future collection is added without a tombstone and resurrects on sync | The merge stays base-blind by `H7`. `I6`'s census proves a field is wired, not that it is safe to delete from |
| `landed` and `next_step` hold text that is present but useless | The schema can refuse an absent or oversized value. It cannot refuse a vague one — `continue the parser work` is a valid string |
| Removing three published output fields breaks a consumer outside this repository | No versioning policy is documented anywhere in the repo, and no compatibility promise is stated for the tool output schemas. Practice is to state the break and ship |
| `U7` blocks a session that legitimately recorded against a different thread | The gate is a prompt, not a write, and it re-evaluates every turn. A session that means to record elsewhere records on the held thread as well, which is the behaviour the gate exists to produce |
| `U1` widens pointer parsing | Deleting the `focus` key deletes the only check that makes a malformed value in it fatal. Accepted: a pointer whose required fields are sound is not corrupt because of a key nothing reads |

---

## 8. Verification

The governing standard is the project's diff-scoped verification. Each unit runs it over the files it owns; the full suite runs once at the close of the ladder, not per unit.

Every unit ships the test named in its section 5 row, and that test is red on the unit's parent commit before it is green on the unit — `I7`. A unit whose test passes on the parent has not demonstrated the change.

The honesty ladder applies to every claim made in a unit's pull request. A check that was run reports its result as a number or a state. A check that was not run is recorded as not run. No unit reports a verification it did not perform.
