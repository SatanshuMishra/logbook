# e2e-verify-nine-one-zero: E2E verification of the 9.1.0 mark-done invariants
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c3 D1 R1 S1

## Goal

Exercise the mark-done invariant text and the empty-result refusal against the running 9.1.0 server, then abandon this thread once both have been observed.

## Done when

- [x] c1 the empty-result refusal carries the six invariants as its remedy evidence: Read from the returned message itself, not from a test asserting it: an empty result produced the refusal, and its remedy carries the lead sentence, all six assertions and the closing line, rendered across multiple lines. Counted the bullets in what came back: six. Before pull request 233 this refusal ended at the id list with no remedy at all, so this could not read the same on the old code. Not observed: whether the newlines survive in a client that collapses them.
- [x] c2 the invariant text reaches a caller verbatim on the result field evidence: Fetched the update_thread schema in this session and read the result field's description as delivered to me, rather than reading the source file. All six assertions present and in order, lead sentence and closing line present, newlines intact. The prior description was 83 bytes of format guidance, so it could not read this way had the change not landed. Not observed: I did not byte-count the delivered string myself; the 992-byte figure is the implementer's measurement, reported rather than confirmed.

## Where things stand

Converted from the old ledger.

## Next step

Send a criteria_done carrying an empty result and read the assembled refusal message, which is the delivery path pull request 233 could not verify end to end because its producer is not exported.

## Decisions in force

## Open risks

## Settled, do not reopen

## Where the details live

- Old ledger record: thread 01M21MV45KRR8JTX9SS7QJSVKG in refs/logbook/archive/ledger
