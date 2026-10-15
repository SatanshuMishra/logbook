# briefing-once-per-session: Brief a session once per thread, shipped as logbook 12.0.0
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c6 D1 R1 S1

## Goal

Re-opening a thread inside one session cost as much context as meeting it for the first time, because resume_thread always rendered the whole briefing and the preflight skill always printed it. Make the briefing arrive only when the session needs it, decided by the server rather than by the model, without weakening the verbatim print or giving anything a way to skip a briefing it does owe.

## Done when

- [x] c1 A session is briefed in full the first time it meets a thread and gets the head of that briefing every time after evidence: The contract test passes and the full suite is 1127 tests green on main at 14270097. Observed live on 2026-09-16: a second resume of thread 01M2MCZHA78N2MD45HHT9TSYSK returned 680 characters of head against 5704 for the whole briefing. Not observed live: the first resume of a thread this session did not open, because the roster held no such thread; that half rests on the contract test alone.
- [x] c2 Opening a thread counts as meeting it, so the file skill no longer reads back the briefing of a thread the session just wrote evidence: Observed live on 2026-09-16 through the MCP boundary: the file skill opened thread 01M2MCZHA78N2MD45HHT9TSYSK and that thread's own resume returned the head, 680 characters, carrying the line naming what it leaves out. Nothing was read back to the session that the session had just written.
- [x] c3 No input can ask for less than the rule gives; the only override asks for the whole text back evidence: The input is a strict object and the contract test asserts an unknown key is refused. The one added field, full_briefing, returned the whole 5704-character briefing live on a thread this session had already met. Not observed, because it does not exist: any value of any input that suppresses a briefing the rule would render.
- [x] c4 The preflight skill and the verbatim gate are unchanged, and the head is owed and paid exactly as a whole briefing is evidence: skills/preflight/SKILL.md carries no change in the merged diff, test/contract/skills.test.ts passes unedited, and test/hooks/stop-gate-owes-the-handle.test.ts proves a head left unechoed blocks the turn while an echoed one pays the debt. This session also printed a head verbatim under the live gate and the turn ended without a block.
- [x] c5 The change is released and running evidence: Pull requests 265 and 266 merged on 2026-09-16, local main fast-forwarded to 14270097 with package.json and plugin.json at 12.0.0, and claude plugin update logbook reported 11.1.0 to 12.0.0 at commit 1427009. This session loaded the file skill from the 12.0.0 install path and resume_thread publishes the two-form description.

## Where things stand

Converted from the old ledger.

## Next step

Nothing. This thread is filed after the fact, as the record of work that shipped and was verified live on 2026-09-16.

## Decisions in force

## Open risks

## Settled, do not reopen

## Where the details live

- the spec: docs/specs/2026-09-15-briefing-once-per-session.md
- the implementation plan: docs/plans/2026-09-15-briefing-once-per-session-PLAN.md
- the feature pull request: https://github.com/SatanshuMishra/logbook/pull/265
- the release pull request: https://github.com/SatanshuMishra/logbook/pull/266
- Old ledger record: thread 01M2MD3TPZB4BJCZ3R6Y41KN1M in refs/logbook/archive/ledger
