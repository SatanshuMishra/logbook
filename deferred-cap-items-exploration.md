# deferred-cap-items-exploration: Explore the deferred cap and budget items and put each to the human
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c4 D8 R3 S3

## Goal

Explore the ten items deferred by the cap and budget specification, auditing and researching each as far as needed, and explain every proposed change to the human in plain English so they can approve or decline it. This thread explores and explains; it implements nothing until the human approves a specific change.

## Done when

- [x] c1 Every deferred item has a written breakdown in plain English carrying four things: what the change is, what problem it solves, why that thing is a problem, and why this change is the best approach among the alternatives considered. evidence: A python structural check over docs/2026-09-11-deferred-cap-items-breakdown.md exited 0: 10 item sections numbered 1 to 10, each with non-empty What changes, The problem it solves, Why that is a problem, and Why this approach subsections, 0 items failing. Not observed mechanically: whether the prose reads as plain English. That is the human's judgment.
- [x] c2 Each proposed change is explained at both the atomic level, what this one change does on its own, and the macro level, how it fits the other nine and what the system looks like after all of them, so the human can approve or decline each one independently. evidence: The same check exited 0 on the atomic and macro parts: every one of the 10 item sections has a non-empty On its own subsection and a non-empty Against the other nine subsection, which names the items it makes unnecessary, resolves, or is independent of. Not observed mechanically: whether each relationship stated there is complete.
- [x] c3 No production code is changed for any deferred item before the human has approved that specific item. evidence: Branch docs/deferred-cap-items-breakdown carries 0 commits beyond origin/main (git log origin/main..HEAD is empty). git diff --name-only HEAD over src, bin and hooks lists nothing, and there are no untracked files under them. The only working-tree changes are docs/specs/2026-09-09-cap-and-budget-architecture.md, modified, and docs/specs/2026-09-11-deferred-cap-items.md, untracked. No production code was changed by this thread.

## Where things stand

Converted from the old ledger.

## Next step

The spec is recorded at docs/specs/2026-09-11-deferred-cap-items.md, uncommitted on branch docs/deferred-cap-items-breakdown, with scope closed by decision 01M2GKAHSZ2FFS9VE0R9ZV96D3. Next: write the implementation plan from that spec's nine-step Suggested order. Proposed: close this exploration thread and open an implementation thread that succeeds it.

## Decisions in force

- D1 No one-size-fits-all numeric cap on stored content; remove the record byte caps: Adopt the principle; it governs all ten deferred items. Remove THREAD_RECORD_SERIALISED_MAX_BYTES and DECISION_RECORD_SERIALISED_MAX_BYTES; the latter is registered as derived equal to the former, so it loses its reason with it. Store the full entry. The one-line summary is rejected for the live thread record because that record is read in full every session, so a summary only adds cost; it stays right for old session entries, where C10 already ships it. The write cap protects nothing the render does not: fitsBudget at briefing.ts:69-71 bounds the briefing independent of record size. Items 3, 4 and 7 resolve by deleting the guard code they concern. The spec's test 4, nothing else bounds it, is retired as circular.
- D2 Remove the length caps on prose, labels and pointers; guide conciseness instead: Remove them. Keep rules that are not numbers, such as the slug pattern, and the two caps that look like external facts, DECISION_COMMIT_MAX 64 (a SHA-256 hex length) and BINDING_BRANCH_MAX 255 (a filesystem name limit), which the register records as unrecorded, so their external basis is inference to confirm before relying on it. Guidance says what each field is for, because a length cannot tell one 900-character decision from three bundled into 300. The header render clip at briefing.ts:82 is computed from these caps, so it is reworked in the same change and the next step renders whole. Deferred item 5 evaporates, since every field it concerned loses its cap. Count caps are not decided here, and neither is SESSION_BODY_MAX, which an earlier explicit ruling set (decision 01M24GFGJZEQE7JT4VJCRDBQS3) and which is put back to the human rather than reversed by inference.
- D3 Every risk declares its anchor, and the next step can name the goal it advances: Every risk declares an anchor, either a criterion or an explicit whole-thread value. Existing unanchored risks migrate as whole-thread, which renders exactly as today. Also adopted: the next step can optionally name the criterion it advances; the briefing then shows risks on that criterion plus whole-thread risks, and one count line pointing to logbook://thread/{id} for risks on other open goals, so fetching on demand is safe because the reader is told something is there. With no criterion named on the next step, the briefing shows risks on all open criteria plus whole-thread risks, which is today's behaviour. Both are schema changes, and they carry the cross-version constraint in the breakdown document: older installs strip unknown fields on parse.
- D4 Read errors quarantine the one record; Node's string ceiling is the only read bound: Catch every read error in readRecordFile and quarantine that record with the error code, extending the pattern already shipped at session-entry-bound.ts:23. No chosen number. The accepted cost: a file under the ceiling still loads fully, measured at 5.5GB for 300MB. It is accepted because the largest thread record ever measured is 39KB, so a 300MB record is corruption or malice rather than a busy project.
- D5 Items 1, 2 and 6: record the identifier gaps, escape artifacts at write, take five keys before escaping: Item 1 is recorded, not fixed. Identifiers are only ever sorted (field-merge.ts:105, session-log.ts:7, session-entry-bound.ts:43); nothing counts them or assumes no gaps. Once item 10 deletes the byte guard, the raw prospective record that forced minting earlier is dead code in four tools, so minting can return after validation as part of that deletion. Item 2: escape the artifact label and pointer at write, so every stored string follows one rule. Its earlier ordering constraint behind item 5 is gone, because the ruling on length caps removes both artifact caps. Item 6: slice to five keys before escaping and clipping, with the remainder counted from issue.keys.length. Correction: its trigger is a tool call's own arguments, because only tool inputs are strict objects (register.ts:68); stored records strip unknown keys on parse, so a record arriving over sync never reaches this path.
- D6 Risks: no duplicates by anchor plus normalised text; removal stays a retire flag: Removal stays the retire flag; no hard delete is added. The retire flag's only cost was bytes counted against the record cap, and decision 01M2EDYZM14YM1Y30CDP6MPHTM removes that cap, so the human's ask is met by what already exists. Everything else in 01M2EDZKZB1WRQ1E2JB3TGFEB6 stands. Identity is anchor plus minimally normalised text (trim, collapse whitespace, case-fold), compared against live risks only. A match succeeds and returns the existing risk id instead of refusing, and says so. A skill tells the model to read live risks before adding and to retire any saying the same thing in other words. Merge-time dedup is deferred.
- D7 This spec covers only the ten ruled items; every other cap waits for a second pass: Scope is closed at the ten ruled items: decisions 01M2EDYZM14YM1Y30CDP6MPHTM, 01M2EDZAYDQZM9H42WEWKPMC9T, 01M2EE5PCA4YHSAENB3NQ87W1T, 01M2EDZXXQ4GZXRK985HV2TSJ0, 01M2EE06CDM6YKZBMFFWYY0JBJ and 01M2EE0FYF2FH25A42A9ZF4YYM. The length caps named in 01M2EDZAYDQZM9H42WEWKPMC9T are in scope because that ruling already covered them. Every cap not named in those decisions stays exactly as it is, including SESSION_BODY_MAX, all count caps and SESSION_UNPARKED_ENTRIES_MAX, until a second pass in a fresh session after this spec ships. The principle is recorded in the spec so that pass applies it. Findings adjacent to the ten are recorded as deferred and not built. There is no expand-then-contract rollout: the stored-shape changes ship as one release, because cross-version compatibility does not apply while the human is the only user. The rollout risk is retired.

## Open risks

- R1 The deferred register carries at least five confirmed factual errors: RISK_TEXT_MAX still exists, RISK_TEXT_FLOOR does not exist, C7 never shipped, the record_decision site is line 241 not 266, and the claimed inline duplicate of the 65536 bound is not there. Every remaining citation must be verified against the tree before it is written into a breakdown, or the document will inherit them. Bears on c1.
- R2 Two of the ten items were found to be non-defects and a third was found to be narrower than described, so the thread's goal of putting ten proposed changes to the human may resolve to fewer. Declining an item is a real outcome the breakdown has to support, not a gap in it. Bears on c2.

## Settled, do not reopen

- S1 Out of scope: Every cap not named in the ten rulings, including SESSION_BODY_MAX and all count caps, stays intact for a second pass in a fresh session after this spec ships (decision 01M2GKAHSZ2FFS9VE0R9ZV96D3).
- S2 Out of scope: Compatibility across logbook versions, and any expand-then-contract rollout, while the human is logbook's only user.

## Where the details live

- the deferred register, all ten items with citations: logbook://session/01M24FHCMWGH0SHARH12CARCZ1/01M27NY255Y56BG57AWZBGW7XG
- the specification the predecessor thread implemented: docs/specs/2026-09-09-cap-and-budget-architecture.md
- the four-test rule that admits or rejects a write-time cap: docs/specs/2026-09-09-cap-and-budget-architecture.md:100
- the write-time caps item ten would supersede: src/schema/caps.ts
- the render budget and its floors: src/render/briefing.ts:36
- the limits register, 99 rows: docs/registers/size-limits.json
- the spec for the ten ruled items, with the governing principle and scope: docs/specs/2026-09-11-deferred-cap-items.md
- Old ledger record: thread 01M27RYQF9SPPG38G3SSE7SSMW in refs/logbook/archive/ledger
