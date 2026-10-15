# e2e-handoff-610: End-to-end hand-off pass over the live 6.1.0 server
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c2 D2 R1 S1

## Goal

## Done when

- [x] c1 The fixture runs open, record, park, resume and close against the live server and leaves no pointer held. evidence: Open, record, resume and park have all run against the live 6.1.0 server; park reported pointer_released true and the re-resume rendered last session, landed and next step. The remaining half of the check reads list_threads after the close, so it cannot be run before the close this criterion gates.

## Where things stand

open, record and resume run against 6.1.0; omitted scope reported null, spine link still written, decision line renders without an empty bracket.

## Next step

Resume this fixture, confirm the briefing renders landed and next_step, then close it as done.

## Decisions in force

- D1 The fixture closes as done rather than abandoned: Mark the criterion done through update_thread and close as done, so the close-time gate and the pointer release are both exercised. Recorded with a criterion_id and no scope on purpose, to see what the live 6.1.0 server reports for the scope.

## Open risks

## Settled, do not reopen

## Where the details live

- Old ledger record: thread 01M1VXZMQQK32GR2W5RA06FKY2 in refs/logbook/archive/ledger
