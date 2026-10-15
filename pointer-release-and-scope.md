# pointer-release-and-scope: Closing a thread releases the pointer, and a decision's scope derives
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c6 D5 R1 S1

## Goal

Two defects found by a live end-to-end pass over the 6.0.0 hand-off path. Closing a thread leaves the active-thread pointer naming it, and a decision recorded with a criterion_id but no scope renders an empty scope label. Both are reproduced and neither is fixed.

## Done when

- [x] c1 Closing a thread releases the active-thread pointer, so the next session reports no crash and no stale hold, and a park after a close is not refused for naming the wrong thread. evidence: node --test test/spawn/close.test.ts exit 0, 4 cases passing, red on parent 4458ba76 at exit 1 with 3 failing, and inert when the release line is deleted. Merged to main, now at b4ca0b89.
- [~] c2 record_decision given a criterion_id and no scope renders the derived criterion label on the spine instead of an empty one. struck: struck in the old ledger
- [x] c3 A full hand-off pass over the live server leaves no stale pointer and renders every hand-off field, run end to end rather than asserted from source. evidence: Ran open, record, resume, park, resume, close against the live 6.1.0 server on fixture 01M1VXZMQQK32GR2W5RA06FKY2. park returned pointer_released true; close returned status done, split verified 0 and unverified-reasoned 1. list_threads after the close reports 1 of 1 resumable with 3 terminal excluded, the fixture gone. list_threads carries no pointer column, so the pointer itself was confirmed at the store instead: state/active-thread.json under 7990e2da is absent after the close and present again after the next resume, naming this thread and this session id. Every hand-off field rendered on the re-resume: last session, landed, next step, key decisions, criteria. The decision recorded with a criterion_id and no scope returned scope null with linked true, and its spine line rendered with no empty bracket.
- [~] c4 The continuity-ledger rule describes what record_decision actually does with an omitted scope: it is stored as given and reported as null, never derived from a criterion ordinal. Both the in-repo copy and the global copy say so. struck: struck in the old ledger
- [x] c5 The continuity-ledger rule describes what record_decision actually does with an omitted scope: the spine link is written with an empty scope and the result reports null, with nothing derived from a criterion ordinal. Both the in-repo copy and the global copy say so. evidence: grep -n lowest-numbered returned exit 1 with no output in both files, on logbook main b4ca0b89 and .windful-ocean main ad1cd6dd, both clean and level with origin. npm test in logbook exit 0, 818 tests, 818 pass, 0 fail, 0 skipped. The two rule paths are hard links to one file, same device and inode, byte-identical.

## Where things stand

6.1.0 released and installed. main at ade6b607 with eight pull requests merged this session: the pointer release on close, empty-scope rendering on both decision and risk lines, the githook installer refusing unreachable chains, the store materialiser writing in place, two documentation corrections, and the version bump. Suite 850 passing, typecheck exit 0. c1 and the documentation criterion are both done and verified.

## Next step

Restart Claude Code so the 6.1.0 server loads, then run /logbook:preflight pointer-release-and-scope and execute c3 against the live server: open a thread, record a decision, park with landed, resume it, close it, then call list_threads and confirm no pointer is held. The running server is 6.0.0 until that restart; 6.1.0 is already in the plugin cache and the marketplace clone is at ade6b60 with plugin.json reading 6.1.0.

## Decisions in force

- D1 The empty decision scope is correct; the documentation is what is wrong: Correct the documentation. The narrow reinstatement was rejected on merits even though it breaks no test: an ordinal is a display position recomputed on every criterion insert at src/domain/criteria.ts:112-113, field merge at src/merge/field-merge.ts:181 and conflict repair at src/server/tools/resolve_conflict.ts:294, so a stored criterion N decays silently while the criterion_id already on the link stays correct. That id is not an unwired anchor: src/render/briefing.ts:162-167 reads it to split key decisions into live and settled lanes. Reinstating would therefore re-accept defect D2 in permanent append-only records to duplicate a pointer that is already right. c2 is struck and replaced by a documentation criterion. The identical stale sentence in the global copy at ~/.claude/rules/common/continuity-ledger.md:131 ships as its own pull request, because installing a global rule puts it in force immediately.
- D2 close_thread releases the pointer only when it names the thread being closed, and only after the commit: close_thread calls releasePointerIfOwned with the id of the thread it just closed, immediately after the ledger commit succeeds, and reports nothing new in its output. The release is conditional on the pointer naming that same thread, so a pointer naming a different thread is left untouched and no other session's hold is taken. A pointer naming the closed thread is released even when a different session wrote it, because a terminal thread can no longer be resumed, parked with an outcome or updated, so that hold protects nothing, and park_thread already releases a terminal-named pointer by the same thread-id-only rule. Making the pointer read treat a terminal thread as absent was rejected because it would hide the file rather than delete it, would stop releasePointerIfOwned from ever unlinking it, and would make park_thread's terminal-pointer-released branch unreachable. The release goes after the commit so that a refused close never gives up a hold the session still needs in order to park with an outcome.
- D3 Criterion checks name a state, never a test count: The check names a state and carries no number. Naming 814 would be correct today and wrong on the next test addition, which is exactly the change-detector the testing rule prohibits; a criterion check exists to decide whether the criterion is true, and a count decides only whether the suite changed size. The criterion is amended by striking it and inserting a replacement, because amend_criteria carries a new check only on an insert and a rewrite would leave the bad check attached. Recorded separately from the shipping work because it corrects my own error in composing the earlier criterion, not any lead's work.
- D4 The records tree is materialised in place; the whole-directory rename swap is deleted: The materialiser's whole-directory rename swap is removed; the ledger tree is now written into the records directory in place with per-file atomic writes, followed by a prune that deletes only paths the ref no longer carries and is guarded by re-reading the ref after listing the disk. The swap's sole justification was whole-tree read atomicity, which the read surface never provided, since readAllRecordFiles does an unsynchronised readdirSync then reads each file separately, so the swap was destroying cross-record consistency rather than protecting it; three distinct user-visible failures fell out of that one unsynchronised rename, including erasure of a record a concurrent session had already committed and written. Teaching the test classifier to honour retryable was rejected because it would encode a retry contract for a refusal that should not exist, and would oblige every real client, a second session or a teammate or an MCP caller, to carry that retry loop. The prune must list the disk before re-reading the ref: because a writer commits to the ref before writing the file, an unmoved ref proves no peer record is on disk that the ref lacks, and inverting that order reopens the erasure this change exists to close.

## Open risks

## Settled, do not reopen

## Where the details live

- the abandoned e2e fixture whose closing statement names both findings: logbook://thread/01M1TS2R00D433GDNSG8CPQTTA
- close_thread, which does not release the pointer today: src/server/tools/close_thread.ts
- record_decision, where the scope derivation lives: src/server/tools/record_decision.ts
- the pointer domain, holding active-thread read and write: src/domain/pointer.ts
- Old ledger record: thread 01M1TSFK1TX695BXS8EZBR8QBT in refs/logbook/archive/ledger
