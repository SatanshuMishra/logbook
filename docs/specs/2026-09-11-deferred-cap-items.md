# Deferred cap and budget items

Date: 2026-09-11, rewritten 2026-09-13, scope closed 2026-09-14
Status: specified, not implemented
Thread: 01M27RYQF9SPPG38G3SSE7SSMW
Verified against: `origin/main` at `fffab54a`
Supersedes, for cap design: the four-test rule in `docs/specs/2026-09-09-cap-and-budget-architecture.md`

---

## The principle

Ruled by the human on 2026-09-12. Decision `01M2EDYZM14YM1Y30CDP6MPHTM`.

**Logbook does not impose a one-size-fits-all numeric cap on what a writer stores.**

- Stored content varies from thread to thread and project to project, so no single number fits.
- A cap set too high licenses unconcise writing.
- A cap set too low refuses valid concise entries, or forces the agent to cut and lose information.
- Instead, set invariants, structure and skills that guide the model to work in a trusted manner.

**A cap or budget that only moves the cost later, or that makes Claude Code less accurate, is not a saving.**

This principle governs this specification and every future change to logbook's limits, including the second pass described under "Scope".

---

## Scope

Ruled by the human on 2026-09-14. Decision `01M2GKAHSZ2FFS9VE0R9ZV96D3`.

### In scope

The ten items below, exactly as ruled. The length caps listed under item 5 are in scope because their ruling named them.

### Out of scope, left intact on purpose

**Every other cap in logbook stays exactly as it is.** Several of them conflict with the principle. That is known and deliberate: widening this specification to cover them would grow its scope without end.

They get a **second pass, in a fresh session, after this specification is fully implemented and shipped.** That pass applies the principle above. Known members include:

- `SESSION_BODY_MAX`, 32,000 characters, set by the human in decision `01M24GFGJZEQE7JT4VJCRDBQS3`
- every count cap, such as `KEY_DECISIONS_MAX_ELEMENTS` 200, `CRITERIA_MAX_ELEMENTS` 40, the per-call element caps, and `SESSION_UNPARKED_ENTRIES_MAX` 25
- the briefing's render budget and floors
- the findings under "Deferred to the second pass" at the end of this document

That list is a starting point, not a census. The second pass enumerates every limit fresh.

### Not a concern: compatibility across versions

The human is currently logbook's only user. The stored-shape changes ship as **one release**, with no expand-then-contract migration. Revisit this once logbook has other users.

---

## Read this first

### What logbook is

- A **thread** is one unit of work, stored as a JSON file in the project's git repository.
- The **spine** is the running summary inside a thread: active goal, next step, risks, decision links.
- A **goal** (the code calls it a criterion) is one statement of what "done" means for the thread.
- The **briefing** is the text a new session reads to pick the thread up.

### What the principle replaces

The specification admitted a cap if it passed one of four tests. **Test 4, "nothing else bounds it", is retired.** It justified a cap by the absence of another cap, which is circular, and it was item 9's entire case.

### What still counts as a legitimate limit

The principle is about what may be **stored**. Three kinds of limit are not chosen caps on stored content:

| Kind | Example | Why it survives |
|---|---|---|
| The environment's own limit | Node cannot build a string over 536,870,888 characters | Nobody chose it |
| A display count that loses nothing | "5 unknown keys shown, +N more" | Refuses nothing; the total is still reported |
| The reader's budget | The briefing's 12,000-character budget | Bounds what is **shown**. The full record stays readable at `logbook://thread/{id}` |

### Two terms used throughout

| | Write-time cap | Render-time limit |
|---|---|---|
| Applies when | Something is stored | Something stored is shown |
| Effect | Refuses the whole call | Shortens what the briefing shows |

**Escaping** rewrites characters that could forge Markdown structure as tokens. A line break becomes the six characters `U+000A`, so escaping can turn one character into six.

---

## The map

| # | Item | Ruling | Decision |
|---|---|---|---|
| 10 | Stored record size cap | Removed; store the full entry | `01M2EDYZM14YM1Y30CDP6MPHTM` |
| 9 | Risks accumulate | No cap: no duplicates, declared anchors, next step names its goal | `01M2EE5PCA4YHSAENB3NQ87W1T`, `01M2EDZXXQ4GZXRK985HV2TSJ0` |
| 8 | Unbounded file read | No bound: quarantine the one unreadable record | `01M2EE06CDM6YKZBMFFWYY0JBJ` |
| 5 | Caps measured after escaping | Evaporates: the length caps are removed | `01M2EDZAYDQZM9H42WEWKPMC9T` |
| 3 | A fifth copy of the size check | Deleted with item 10 | `01M2EDYZM14YM1Y30CDP6MPHTM` |
| 4 | Size guard missing on two operations | Deleted with item 10 | `01M2EDYZM14YM1Y30CDP6MPHTM` |
| 7 | Refusal re-serialises the payload | Deleted with item 10 | `01M2EDYZM14YM1Y30CDP6MPHTM` |
| 2 | Artifacts stored unescaped | Escape them at write | `01M2EE0FYF2FH25A42A9ZF4YYM` |
| 6 | Every unknown key escaped | Take five first | `01M2EE0FYF2FH25A42A9ZF4YYM` |
| 1 | Refused calls consume ids | Recorded; resolves with item 10 | `01M2EE0FYF2FH25A42A9ZF4YYM` |

**Shape of the whole:** three items are rebuilt around the principle (10, 9, 8). Four disappear because the caps they serve are gone (5, 3, 4, 7). Three survive because none of them was ever a number (2, 6, 1).

---

## Item 10 — Remove the cap on stored record size

### What changes

- Delete `THREAD_RECORD_SERIALISED_MAX_BYTES`, 65,536 bytes, at `src/schema/caps.ts:43`.
- Delete `DECISION_RECORD_SERIALISED_MAX_BYTES` at `caps.ts:44`. The register calls it "derived, equal to" the thread cap, so it loses its reason along with it.
- Store the full entry. No summary layer.

### The problem it solves

- A thread record over 65,536 bytes is refused, whatever it contains.
- Every later write to that thread is refused too, including the write that would let it close.

### Why that is a problem

- **One number for every project.** Its registered basis is 1.68 times the largest record that existed in August 2026: one project's history, applied to all of them.
- **It protects nothing.** The briefing is bounded separately by `fitsBudget` at `src/render/briefing.ts:69-71`, whatever the record's size. When the floors cannot all fit, the briefing says so (`briefing.ts:474`).
- **It wedges threads.** See item 9.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Raise the number | Still one number for everyone. It only postpones the wedge |
| Keep the cap, add deletion tools | Still decides what a writer may record |
| One-line summary per record, full record on demand | **Saves nothing for the live record.** Goal, next step, goals and risks are read in full every session, so a summary adds its own cost plus an extra round trip. Summaries pay off only where the full content usually goes unread, which is old session entries, and C10 already does that |
| **Remove the cap, store the full entry** | The render layer already governs what reaches the reader |

### What it costs

- The ledger in git grows with whatever writers record.
- A very large record costs time and memory to read. Item 8 handles the case where a file cannot be read at all.
- The stored shape stops enforcing 65,536 bytes on read (`src/schema/thread.ts:226-236`) in the same release that stops enforcing it on write.

### On its own

No write is refused for record size, and the briefing stays exactly as it is.

### Against the other nine

- **Makes 3, 4 and 7 unnecessary.** Their code is deleted along with the guard.
- **Removes the wedge half of item 9.** The clutter half is solved only by item 9's own ruling.
- **Resolves item 1.** Minting was moved early only to serve the guard.
- **Raises the stakes of item 8**, since larger records make clean failure on an unreadable file matter more.
- Independent of 2, 5 and 6.

---

## Item 9 — Stop risks piling up, without a cap

### What changes

Four parts, none of them a number.

1. **No duplicates.** Adding a risk whose anchor and normalised text match a live risk returns the existing risk's id and says so. It does not refuse. Normalised means trimmed, with whitespace collapsed and case ignored.
2. **Removal stays the retire flag.** Retired risks already leave the briefing (`briefing.ts:555`). No hard delete is added; see "Why this approach".
3. **Every risk declares its anchor**: either the goal it threatens, or explicitly the whole thread.
4. **The next step can name the goal it advances.** The briefing then shows risks on that goal, whole-thread risks, and one line counting the rest with where to read them, such as "4 more risks on other open goals at `logbook://thread/{id}`".

Plus a skill: before adding a risk, read the live ones and retire any that say the same thing in other words.

### The problem it solves

- **Risks only grow.** `src/domain/spine.ts:27` sets no limit for them.
- **Nothing stops a duplicate.** `update_thread.ts:385` mints a fresh id for every input.
- **A risk with no goal shows in every briefing forever** (`briefing.ts:243-249`).

### Why that is a problem

- **Clutter costs accuracy.** A briefing full of stale or repeated risks buries the one that matters for the next step.
- **Under today's size cap, it wedges the thread.** Reported from another project: risks at 41,924 bytes of a 65,368-byte record, and no tool could recover it.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Cap the total number of risks | A chosen number. It refuses a real risk on a thread that genuinely has many |
| Restore a length cap on risk text | Destroys evidence, because a risk is a finding |
| Refuse exact duplicates | The agent rewords and retries, and the reworded copy passes. Returning the existing id leaves nothing to route around |
| Use scope as identity | Scope is free text, so two phrasings defeat it. The anchor is an id |
| Require a goal on every risk | A new thread has no goals yet, and a thread-wide risk would need a false one |
| Hide risks with no goal | A thread-wide risk vanishes, and the reader does not know to fetch it |
| Hard delete a risk | **The next sync undoes it.** Risks merge by id, and a risk present on only one machine is kept (`src/merge/field-merge.ts:143-145`). A retire that differs between machines is raised as a conflict instead (`:139-141`), so it is never lost silently |

### What it costs

- Two schema changes, the anchor and the next step's goal, plus a migration. Existing risks with no goal become whole-thread risks, which render exactly as today.
- Rewordings are caught by the skill, not the tool, because the tool cannot judge meaning.
- Two machines adding the same risk still produce two entries after a sync. Deferred.

### On its own

- No duplicate risks.
- The briefing shows what bears on the next step, and says how many other risks exist and where to read them.

### Against the other nine

- The wedge half is also removed by item 10. The clutter half is solved only here.
- It no longer needs a hard delete, because item 10 removes the only cost of keeping retired risks.
- Independent of 8, 5, 3, 4, 7, 2, 6 and 1.

---

## Item 8 — Quarantine an unreadable record instead of failing everything

### What changes

`readRecordFile` at `src/store/read-path.ts:208` catches every read error, not only "file not found", and quarantines that one record with the error code. There is no size check.

> Amended on 2026-09-14 (decision 01M2H40CVM5RE2M2HQNB40ZYSB): a quarantined record must never be treated as absent where that loses work. Sync refuses to merge when a local record it cannot read is also carried by the other side or the common ancestor and this machine's committed copy differs from the ancestor's, and the cached roster read counts a thread it finds closed as terminal. Both defects predated this item for malformed records; quarantining every read error would have widened them.

### The problem it solves

One oversized file breaks every thread listing in the project.

- Only "not found" is caught; everything else is re-raised (`read-path.ts:213-214`).
- Listing threads reads every file in one loop, with no protection around each file (`src/store/records.ts:326`).
- A file over Node's string ceiling raises exactly that kind of error.
- So `list_threads`, the roster and sync (`src/merge/sync.ts:108`, `:194`) fail for **every** thread.

### Why that is a problem

One bad file, from a teammate's machine or from corruption, blinds the whole ledger rather than just its own thread.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Choose a byte size and check before reading | A chosen number that refuses legitimate records on some project |
| Bound by a share of available memory | The share is chosen, so it is a number in disguise |
| Do nothing | Keeps the project-wide failure |
| **Catch and quarantine** | No number, and it is already the pattern at `src/domain/session-entry-bound.ts:23` |

### What it costs

Files under the ceiling still load fully. Measured on synthetic files, read the way logbook reads records:

| File | Result | Memory after reading |
|---|---|---|
| 600MB | A catchable "string too long" error | — |
| 450MB of dense objects | Parsed in about 9 seconds | 4.1 GB |
| 300MB of dense arrays | Parsed | 5.5 GB |

The cost is accepted because the largest thread record ever measured is 39KB. A 300MB record means corruption or malice, not a busy project. No crash below the ceiling was reproduced.

### On its own

One unreadable record goes dark and the rest of the project stays usable.

### Against the other nine

- Matters more once item 10 lets records grow.
- Independent of everything else, and can ship first.

---

## Item 5 — Caps measured after escaping

### What changes

Nothing gets built for this item. The length-cap ruling removes every cap it concerned. That ruling in full:

- **Removed:** next step, active goal, landed, last session, title, slug length, blocked-by, goal text and check, out-of-scope, key decision title and scope, artifact label and pointer, decision title and option, risk scope and reference. Each goes from the stored shape and from the published input schema of every tool.
- **Kept:** the slug pattern, which is an invariant rather than a number. Also commit hash 64 and branch name 255, which look like external facts. The register records neither with a reason, so confirm that before relying on it.
- **Replaced by:** tool descriptions and skills that say what each field is *for*.
- **Comes with it:** the briefing's header clip at `briefing.ts:82` is computed from these caps, so it is reworked in the same change, and the next step renders whole.

### The problem it solves

`src/domain/spine.ts:51` measured length *after* escaping. A 500-character next step with 10 line breaks measured 550 and was refused.

### Why that is a problem

- A correct write was refused with a count the writer could not reconcile.
- It penalised structured prose relative to run-on text.
- On a cap that exists at all, the refusal pushes the agent to cut content.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Measure raw length first | Correct, but fixes a cap the principle says should not exist |
| Raise caps to absorb escaping | Guesses an expansion factor that varies from 1 to 6 times |
| Turn caps into warnings | Still a chosen threshold, and no warning channel exists in `src/server` |
| **Remove the caps** | No cap, nothing to mis-measure. Guidance can tell one 900-character decision from three bundled into 300; a length cannot |

### What it costs

- No mechanical backstop against a runaway agent pasting a log into a field. What still catches it: the briefing budget, and the record's visibility in git.

> Amended on 2026-09-14 (decision 01M2H5P26VGP2EMW5D1W7WWYPM): the next step renders whole, so the briefing budget does not catch it. A next step longer than the budget yields a briefing flagged over budget but not shortened. A budget-derived ceiling for the next step, disclosed as shortened, is deferred to the render-budget second pass.
- Each removed cap goes from the stored shape as well (`src/schema/thread.ts:70`, `:78`, `:174-179`, `:196`, `:198`, `:203`), because records are checked against it on read and a failing record is quarantined whole (`src/store/read-path.ts:227-229`).

### On its own

A writer is never refused for length.

### Against the other nine

- Removes item 2's old dependency on it.
- A sibling of item 10: the same principle, applied to fields instead of whole records.

---

## Item 3 — A fifth copy of the record size check

### What changes

Deleted with item 10. The inline check at `src/server/tools/record_decision.ts:266` goes, along with the shared guard it duplicated.

### The problem it solves

One check had two definitions: inline at `:266`, and the shared `refuseOverThreadByteCap` used at four other sites.

### Why that is a problem

If one changed and the other did not, no test would notice. The limits census only sees top-level constants, and this check is an expression inside a function.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Extract one shared measurement for both sites | Correct, but maintains a guard item 10 deletes |
| Pin the two together with a test | A test that fails on harmless refactors |
| **Delete with item 10** | Nothing left to drift |

### On its own

No standalone effect; it is part of item 10's deletion.

### Against the other nine

Unnecessary once item 10 lands. Same family as items 4 and 7.

---

## Item 4 — Size guard missing on two goal operations

### What changes

Deleted with item 10. The guard on inserting a goal (`src/server/tools/amend_criteria.ts:170`) is removed, rather than copied to the rewrite and strike operations.

### The problem it solves

Insert checked the record's size before escaping, while rewrite and strike checked only after.

### Why that is a problem

It never gave a wrong answer, because the final commit still refused. It did the expensive escaping first, and it reported a size the writer never sent.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Copy the guard to rewrite and strike | Three copies of a guard item 10 deletes |
| **Delete with item 10** | All three operations become consistent by having none |

### On its own

No standalone effect; it is part of item 10's deletion.

### Against the other nine

Unnecessary once item 10 lands. Same family as items 3 and 7.

---

## Item 7 — The refusal re-serialises what it rejected

### What changes

Deleted with item 10: `refuseOverThreadByteCap` and `heaviestFieldOf` at `src/server/tool-support.ts:97-129`, plus their decision-record twins at `record_decision.ts:92-117`.

### The problem it solves

An over-cap refusal serialised the whole record, then serialised every field again to name the largest one.

### Why that is a problem

The early guard existed to avoid expensive work on a huge payload. JSON serialisation expands control characters just as escaping does, so for the worst-case payload the guard cost what it was meant to avoid, about three times over.

### Why this approach

| Alternative | Why it lost |
|---|---|
| A cheap pre-check before the exact measurement | Optimises a path item 10 deletes |
| **Delete with item 10** | No refusal, so no cost |

### On its own

No standalone effect; it is part of item 10's deletion.

### Against the other nine

Unnecessary once item 10 lands. Same family as items 3 and 4.

---

## Item 2 — Escape artifacts when they are stored

### What changes

`mintArtifacts` at `src/server/tool-support.ts:25-26` escapes an artifact's label and pointer before storing them, as every other stored string already is.

### The problem it solves

Artifacts are the only stored strings saved unescaped.

### Why that is a problem

- **Not a live hole today.** The briefing escapes artifacts when rendering them (`src/render/briefing.ts:118`, `:200`), and no other surface shows them.
- **That safety is an accident of where they render.** A new surface, such as a resource, a CLI listing or an export, would show raw text that can forge Markdown structure, and no test would notice.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Keep relying on render-time escaping | Works by coincidence, and nothing pins that down |
| Test every render surface | Guards the coincidence, and has to be redone for each new surface |
| **Escape at write** | One rule with no exception |

### On its own

Every stored string follows one rule.

### Against the other nine

- Independent.
- Its earlier "item 5 first" constraint is gone: that constraint existed because escaping would distort the artifact caps, and those caps are removed.

---

## Item 6 — Take five unknown keys before escaping them

### What changes

In `src/schema/refusal.ts:38`, take the first five unknown keys, then escape and clip only those five. The "+N more" count still comes from the full list.

### The problem it solves

Every unknown key is escaped and clipped, and then all but five are thrown away.

### Why that is a problem

A call carrying thousands of unknown argument names does thousands of expansions to print five of them.

**Correction to the first breakdown:** this path is reached only through a tool call's own arguments. Tool inputs reject unknown keys (`src/server/register.ts:66-69`), while stored records silently drop them, so a record arriving over sync never gets here. This is an efficiency fix, not an injection defence.

### Why this approach

Reordering changes no output, and no alternative does better. The five-key display is not a chosen cap on content: it refuses nothing and reports the total.

### On its own

A malformed call costs a bounded amount of work to reject.

### Against the other nine

Independent of all nine.

---

## Item 1 — Refused calls consume identifiers

### What changes

No code change of its own. It is recorded here, and it resolves as part of item 10.

### The problem it solves

In `update_thread`, identifiers are minted at `update_thread.ts:382-400`, before the size guard at `:432` and before four settlement checks from `:445` on. A call refused by a settlement check has already used up identifiers.

### Why that is a problem, and why it barely is

- **Nothing breaks.** Identifiers are only ever sorted (`src/merge/field-merge.ts:105`, `src/domain/session-log.ts:7`, `src/domain/session-entry-bound.ts:43`). Nothing counts them or assumes there are no gaps.
- A future reader who assumes one identifier per stored entry could be confused by the gaps.

### Why this approach

| Alternative | Why it lost |
|---|---|
| Run the checks before minting | Changes which refusal a caller sees when two things are wrong, to fix a non-problem |
| Mint lazily | Complicates code that item 10 deletes |
| **Record it, and let item 10 resolve it** | Minting moved early only to build the raw record for the size guard. Once the guard goes, that raw record is dead code in four tools, so minting can move back after validation |

### On its own

No effect.

### Against the other nine

Resolved by item 10.

---

## Suggested order

Ordered by dependency. Each step is independently shippable.

| Step | Items | Depends on |
|---|---|---|
| 1 | 8 — quarantine unreadable records | Nothing |
| 2 | 6 — five keys before escaping | Nothing |
| 3 | 2 — escape artifacts at write | Nothing |
| 4 | 10, with 3, 4, 7 and 1 — remove the record size caps, their guards, and the early minting | Nothing; safer after step 1 |
| 5 | 5 — remove the length caps, rework the header clip, write field-purpose guidance | Nothing; touches the same schema as step 4, so not in parallel with it |
| 6 | 9 — declared risk anchors, with existing risks migrated to whole-thread | Nothing |
| 7 | 9 — risk dedup by anchor plus normalised text | Step 6 |
| 8 | 9 — the next step names its goal, the briefing filters risks, the count line | Step 6 |
| 9 | 9 — the skill guidance on reading and retiring risks | Steps 7 and 8 |

---

## Deferred to the second pass

None of these is built by this specification. Each is recorded so the second pass starts from it.

| Finding | What is known |
|---|---|
| Every cap not named in the ten rulings | Listed under "Scope". The principle applies to each |
| Duplicate risks across machines | Risks merge by id, so the same text added on two machines survives a sync twice (`src/merge/field-merge.ts:211`). Needs the dedup rule applied during the merge |
| Resource pages re-escape stored text | `src/server/resource-render.ts` escapes values already escaped at write. Harmless, since escaping already-escaped text changes nothing, but it hides which values are stored escaped |
| Compatibility across versions | Older installs check today's caps on read and quarantine a failing record (`src/schema/thread.ts:226-236`, `src/store/read-path.ts:227-229`), and silently drop unrecognised fields before writing a record back (`src/server/tool-support.ts:163`). Not a concern while logbook has one user |
