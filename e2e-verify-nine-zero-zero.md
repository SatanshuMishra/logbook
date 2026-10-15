# e2e-verify-nine-zero-zero: E2E verification of the 9.0.0 upgrade
Status: abandoned: abandoned in the old ledger
Updated: 2026-10-15T19:18:59.811Z
Next ids: c4 D2 R1 S1

## Goal

Exercise every behaviour the 6.1.0 to 9.0.0 upgrade changed, against the live installed server, and abandon this thread once each has been observed.

## Done when

- [x] c1 a criterion at proposed settledness can be marked done and carries its result evidence: update_thread returned ok for a proposed criterion carrying a result and a status
- [ ] c2 an unsettled criterion cannot be marked done
- [ ] c3 the human asked for a live end to end test, and the rewrite path writes the check it is given

## Where things stand

Converted from the old ledger.

## Next step

Attempt an amend_criteria rewrite against the criterion marked done on this thread and confirm the refusal from pull request 229 fires.

## Decisions in force

- D1 Rewrite one criterion's check to prove the 9.0.0 rewrite path writes it: Rewrite and read it back, because a release note is not an observation.

## Open risks

## Settled, do not reopen

## Where the details live

- Old ledger record: thread 01M2197HN7HBGWA8KXN3T2BQ0X in refs/logbook/archive/ledger
