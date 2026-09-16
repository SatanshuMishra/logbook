# The briefing renders once per session per thread

Date: 2026-09-15
Status: specified
Thread: none. The `ledger` MCP server failed to connect for the session that wrote this spec, so no thread was filed against it.
Verified against: `main` at `618c2240`

---

## Read this first

- A **thread** is one unit of work, stored as a JSON file in the project's git repository.
- The **briefing** is the text a session reads to pick a thread up. `resume_thread` renders it and returns it in the tool result.
- A **session** is one Claude Code session. Its id reaches the server as `CLAUDE_CODE_SESSION_ID`, `src/runtime/runtime.ts:13`.
- The **state directory** is machine-local scratch under `CLAUDE_PLUGIN_DATA`, `src/store/layout.ts:7`. Nothing in it is committed and nothing in it reaches another clone.
- The **verbatim gate** is the Stop hook that refuses to let a turn end until the briefing `resume_thread` returned has been printed word for word, `src/hooklib/stop-gate.ts:66`.
- The **handle** is the short form this spec introduces: the head of the briefing and nothing else.

---

## The problem

Every `resume_thread` renders the whole briefing, whatever the session already knows.

`src/server/tools/resume_thread.ts:83` calls `renderBriefingWithPasses` unconditionally and returns the result in the `briefing` field. The render is bounded at 12000 characters, `BRIEFING_MAX_CHARS` in `src/render/briefing.ts:31`, and the whole reply at 12418 bytes, `RESUME_PAYLOAD_MAX_BYTES` on the next line. Step 10 of `skills/preflight/SKILL.md` then prints that text verbatim, so a full briefing lands in the session twice: once as the tool result, once as the echo.

That is the right cost when a session meets a thread for the first time, and it buys nothing when the same session re-opens the same thread to add one decision or record one risk. The material is already in the window; the second copy displaces work.

### What is not the cause

The verbatim gate is not what forces the second echo. `verbatimEchoVerdict` writes a per-session latch and returns silent for every later stop event in that session, which `test/hooks/stop-gate-latch-order.test.ts:122` pins as deliberate. On a mid-session re-open the hook is already disarmed; only step 10 of the skill compels the print. The three-copy case, tool result plus block reason plus echo, exists only for the first resume of a session.

---

## The rule

A session is briefed in full the first time it meets a thread, and gets the handle every time after. Opening a thread counts as meeting it: the session supplied the goal, the next step and the criteria, so it holds what the briefing would say. A new session renders the full briefing again, for every thread.

| Situation | What the session has been briefed on | What `resume_thread` returns |
|---|---|---|
| Fresh session, first resume of any thread | nothing, the session id is new | full briefing |
| Same thread parked mid-session, then resumed for more work | that thread | handle |
| A different thread parked or closed, this one opened | the other thread, not this one | full briefing |
| Same thread, resumed a third and fourth time | that thread | handle |
| A thread this session opened itself | that thread, recorded by `open_thread` | handle |

The server applies the rule. There is no input that asks for less, so the short form is a shortcut the server grants and never a discretion the model exercises. The only override forces the full briefing back, for a session that lost it.

Every failure path renders the full briefing. A missing record, an unparseable one, a shape that does not match, or a session id that does not match all read as "this session has been briefed on nothing".

---

## Scope

### In scope

The briefed record, the handle render, the override input on `resume_thread`, the rule doc, and the tests for all four.

### Out of scope, on purpose

**No change to `skills/preflight/SKILL.md`.** The handle travels in the same `briefing` field, so step 10 stays "print the returned `resume_thread.briefing` verbatim" and the pinned position of that step, second-to-last, `test/contract/skills.test.ts:549`, is untouched. The skill gains no conditional and therefore no judgement call.

**No change to the verbatim gate.** Whatever `resume_thread` returned is what the session owes verbatim. When that is the handle, the handle is what gets echoed, and `findLastResumeBriefing`, `src/hooklib/transcript.ts:102`, needs no knowledge of which form it found.

**No new field on the `resume_thread` output.** `RESUME_PAYLOAD_SCAFFOLD_BYTES`, `src/render/briefing.ts:38`, encodes the serialised size of the envelope around the briefing, and `test/contract/resume-payload-single-copy.test.ts:94` asserts the prediction never falls below the reply the server actually serialises. A new field would have to move that constant. The handle says what it is in its own text instead.

**No PreCompact hook.** A compaction keeps the session id while dropping the briefing from the window, so the server can withhold a briefing the session no longer holds. `test/hooks/precompact-absent.test.ts` pins the deliberate absence of that hook, so this spec covers the hole with the override and leaves clearing the record on compaction to a separate decision.

**No change to `skills/file/SKILL.md`.** The skill keeps its `resume_thread` call and its verbatim print; what it prints is the handle, because `open_thread` records the thread it just created as one this session has met. A session does not need read back to it what it just wrote.

**No cap on `next_step`.** The full briefing renders `next_step` unclipped, `src/render/briefing.ts:523`, and can exceed its budget on a long one. The handle inherits that behaviour unchanged, including the breach log. Capping stored fields belongs to `docs/specs/2026-09-11-deferred-cap-items.md`.

---

## Section 1: the briefed record

A new module `src/domain/briefed.ts`, mirroring the shape and the failure discipline of `src/domain/pointer.ts`.

One file, `briefed.json`, in the state directory beside `active-thread.json`. It is machine-local and per-session; it never enters the ledger, because which threads one session has already read is worthless to another clone.

```
{ "session_id": "<the session id>", "thread_ids": ["<ULID>", "..."] }
```

`readBriefed(rt, layout)` returns the set of thread ids this session has been briefed on. It returns the empty set when the file is absent, when it does not parse, when it does not match the shape, when any element is not a ULID, or when `session_id` differs from `rt.sessionId`. Unreadable and unparseable cases log at `warn`, matching `readRecordingGateState`, `src/hooklib/recording-gate-state.ts:40`. No case returns a non-empty set for a session that cannot be proven to own the record.

`open_thread` calls `recordBriefed` on the thread it creates, after the commit succeeds and only then. A layout that will not resolve is not an error here: the record is a saving, and failing to write it costs one whole briefing.

`recordBriefed(rt, layout, threadId)` writes `{ session_id: rt.sessionId, thread_ids }` through `durableWrite`, where `thread_ids` is the prior set plus this thread when the record already belongs to this session, and `[threadId]` otherwise. The list is capped at `BRIEFED_THREADS_MAX = 100`, oldest dropped first. Dropping an id costs one extra full briefing, which is the safe direction.

## Section 2: the handle render

`renderHandle` in `src/render/briefing.ts`, built from the helpers the full briefing already uses so that every stored value passes an escape or clip function; `src/render/briefing.ts` is censused for exactly that at `test/contract/render-census.test.ts:16`.

```
# Your Preflight Briefing

**Thread:** <title>
**Status:** <status>
**Blockage:** none
**Currently being worked:** yes
**Criteria:** <done> of <total> done

**Next step:**

<next_step>

**Not shown:**
- this session was already briefed on this thread, so only the head of the briefing is shown
See logbook://thread/<id> for the complete record.
```

The heading, the four header lines and the `Next step` block are the existing renderers: `BRIEFING_HEADING`, the `Thread` and `Status` lines from `assembleBriefing`, `renderBlockage` and `renderPointerStatus`, `src/render/briefing.ts:229`. `Criteria` counts unstruck criteria by the same rule the roster uses, `toRosterRow` in `src/render/roster.ts:34`, but reproduced locally rather than imported: `test/contract/resume-path-has-no-settledness-aggregate.test.ts:251` refuses any import that widens the forward closure of the briefing renderer onto files the resume path never runs, and importing the roster does exactly that.

The `Not shown` block carries the line above plus the integrity warnings the full briefing would have shown and this form drops: the count of linked decision records that could not be read, and the count of session log entries that could not be read. A session working from the handle still learns that part of the record is unreadable.

The handle omits the continuation rule, artifacts, the active goal, the last session, landed, related threads, open risks, key decisions, out of scope, the criteria bodies, the settled lane and the decisions block.

Both forms go through `fitsBudget` and both log `briefing.budget-exceeded` on a breach, so the handle gets the same treatment as the full render on a `next_step` long enough to overflow.

## Section 3: `resume_thread`

The input gains one optional field:

```
full_briefing?: boolean
```

Default false. True renders the full briefing whatever the record says, and still records the thread as briefed. No value of any input suppresses a briefing the rule would otherwise render; the override moves in one direction only. Its description names the case it exists for: a session whose context was compacted and which no longer holds the briefing it was given.

The handler, after it loads the thread and writes the pointer, reads the briefed record and renders the full briefing when `full_briefing` is true or the thread id is not in the set, and the handle otherwise. It calls `recordBriefed` only on a full render, since a handle briefs nobody. The other writer is `open_thread`, Section 1.

The output shape does not change: `thread_id`, `briefing`, `previous_session`.

## Section 4: the rule doc

`docs/rules/continuity-ledger.md`, the Resuming section at line 209, gains the rule: the first resume of a thread in a session returns the full briefing, later resumes of that same thread in that same session return its head, and `full_briefing` forces the full text back. The existing sentence, "Print `resume_thread.briefing` exactly as it is returned", stays exactly as it is and stays true of both forms.

## Section 5: tests

Unit, `test/unit/briefed-record.test.ts`: a written record reads back for the same session; a different session id reads as empty; absent, unparseable, wrong-shape and non-ULID records read as empty; the cap drops the oldest id.

Unit, `test/unit/briefing-handle.test.ts`: the handle carries thread, status, blockage, worked-state, criteria count and next step; it carries the line saying why it is short; it carries the unreadable-decision and unreadable-session counts when those exist; it omits every section listed at the end of Section 2; a stored value bearing markdown is escaped in it.

Contract, `test/contract/resume-briefs-once-per-session.test.ts`: a second resume of one thread in one session returns the handle and is strictly shorter than the first; a resume of a second thread in the same session returns the full briefing; a resume of the first thread under a new session id returns the full briefing again; `full_briefing: true` returns the full briefing on a thread already briefed.

Contract, `test/contract/resume-payload-single-copy.test.ts`: extended so the prediction is measured on a handle reply as well as a full one.

Hook, `test/hooks/stop-gate-latch-order.test.ts` or a sibling: a transcript whose `resume_thread` result carries a handle owes that handle verbatim, and echoing it pays the debt.

`test/contract/skills.test.ts` is not edited. It passing unchanged is the evidence that the skill contract did not move.

Three existing spawn tests use `resume_thread` as a way to re-read a thread two or three times inside one
session, `test/spawn/criterion-reopen.test.ts:104` and `test/spawn/resume.test.ts:700`. They pass
`full_briefing: true` at those call sites and keep every assertion. Their breaking without that argument is
what makes this release major rather than minor.

Two censuses constrain the change beyond the sections above. The optional-argument census,
`test/contract/optional-arguments-are-absent.test.ts:79`, requires a registered recipe proving that omitting
`full_briefing` derives no substitute: the whole briefing simply is not forced. The limits register,
`docs/registers/size-limits.json`, gains a row for `BRIEFED_THREADS_MAX` and nineteen rows move, because
inserting lines into `src/render/briefing.ts` shifts every constant declared below them.

## Release

Major, `12.0.0`. The suite decided it: three committed spawn tests of published behaviour failed without being
touched, because a second resume of one thread in one session no longer returns the same text. That is a
contract break under OR44 whatever the shape of the reply, which did not change.
