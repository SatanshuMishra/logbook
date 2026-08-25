# Post-cutover repair: audit probes (evidence, not tests)

Provenance of the reproductions and probes behind
[`docs/specs/2026-08-25-post-cutover-repair.md`](../../specs/2026-08-25-post-cutover-repair.md).
Written during the seven parallel audits of 2026-08-25, recovered from a session scratchpad before
it was lost.

## These are not receipts

SPEC section 2 rules that reproductions are session-scoped, that each MSP re-authors the
reproduction it inherits as a committed test *before* its fix, and that **a probe referenced but
not committed is treated as absent**. Preserving these files does not change that. They are kept
here to make re-authoring cheap and to show what was actually observed on 2026-08-25 — never as
the acceptance test any MSP owes, and never as a substitute for one.

Nothing here is in the tsconfig `include` set, runs in CI, or is referenced by the shipped tree.

## Mapping

SPEC section 2 names these explicitly:

| Audit | Scope | Named reproduction |
| --- | --- | --- |
| A1 | `record_decision` and the spine | `repro-f1.ts` |
| A2 | `park_thread` and the pointer lifecycle | `repro-f7.ts`, `repro-c7.ts` |
| A3 | Store roots and the sync receipt | `repro-f6.ts`, `repro-f3.ts` |

The remaining files are the supporting probes section 2 refers to collectively — cap-boundary,
lost-update and concurrency probes for A1, three probes against the shipped write-guard module for
A4, and a classifier probe against real Zod output for A5. Their individual assignments were not
recorded, so read each file rather than trusting an assignment reconstructed here.

`cites.txt` holds the source citations gathered for A7, the Model Context Protocol error contract.

## Running one

These were run under the repository's own toolchain against the shipped 1.0.0 tree at `4f379e7`.
A probe that no longer reproduces is evidence the surrounding code moved, not evidence the defect
was fixed — confirm against the code before drawing either conclusion.
