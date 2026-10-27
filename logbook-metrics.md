# logbook-metrics: Logbook records its own metrics in the shared plugin-metrics store
Status: parked
Updated: 2026-10-27T19:01:58.068Z
Next ids: c8 D5 R2 S1

## Goal

Logbook records metrics personalised to its purpose (keeping a piece of work's state true across sessions, compactions and /clear) in the shared ~/.plugin-metrics JSON Lines store, through a word-for-word copy of the pipeline's TypeScript reference writer, with a catalogue and a small skill that answers about logbook alone; carried through the full pipeline lane to its MSP pull requests (D2).

## Done when

- [x] c1 The spec, decisions file, record and items for logbook-metrics are in docs/specs/, with intent I1 to I6 copied word for word and every delegated answer citing an intent line or binding decision evidence: check_record --complete, check_spec and check_items pass after the 11 review fixes, the tree guard verified clean, and the record is handed-off
- [x] c2 The FEATURE branch is pushed and the run home ~/.mitosis/logbook/logbook-metrics/ holds CHARTER.md, worker-rules.txt, dispatch.zsh and run.zsh, plus accept.zsh in the repository evidence: pipeline feature-branch pushed feat/logbook-metrics at 579cc66c (git ls-remote shows it), and the run home holds CHARTER.md, worker-rules.txt, dispatch.zsh, run.zsh, items.json, graph.json and feature.json, with ~/.mitosis/logbook/accept.zsh reused
- [x] c3 run.zsh --plan-only passes with no fatal finding and no build has run evidence: run.zsh --plan-only exited 0 with plan id c64786cab3fa, no fatal finding and no drift, and nothing was spawned
- [x] c4 The thread is parked with a next step gated on the shared writer existing on origin/feat/unified-metrics or origin/main evidence: the next step is gated on the dependency check listing the writer files on origin/feat/unified-metrics or origin/main (Needs: D1), and park_thread follows this update with that next step
- [x] c5 The first build commits both MSPs, metrics-writer and thread-events, with the writer copied from origin/feat/unified-metrics a39ab11 (D2) evidence: run.zsh (plan d32ad79360da) committed mitosis/metrics-writer at 36662637 (gate pass 3/3) and mitosis/thread-events at 0fabaf17 (gate 39 pass, 3 inert negative tests), reconcile clean; metrics/source.json names origin/feat/unified-metrics a39ab110
- [x] c6 Stage 3 review reaches green or blocked for each MSP, with every confirmed blocker and advisory fixed on its branch evidence: pipeline verdict printed green in round 2 for metrics-writer and thread-events (review/round-2/<msp>.verdict.json), with blockers U1, U2 and C1 fixed by receipt tests and advisories fixed at c1fcdd33 and cd680a65; final suites pass at c1fcdd33 (463 tests, lint 46/46, typecheck) and 8c241094 (506 tests, lint 46/46, typecheck)
- [x] c7 Both MSP pull requests are open in stack order, assigned to the owner, each with its pipeline comment posted evidence: SatanshuMishra/logbook#296 (mitosis/metrics-writer into feat/logbook-metrics) and #297 (mitosis/thread-events into mitosis/metrics-writer) are open ready for review, both assigned to SatanshuMishra, each with its saved pipeline comment posted

## Where things stand

pipeline:run, full lane, is in Clean-up: SatanshuMishra/logbook#298 (feat/logbook-metrics into main) is merged as 62413ee8, and the owner checkout's main is fast-forwarded to it. Lighthouse run 2 was green; its one pre-existing failure, preflight routing, is not this change's to fix. Criterion 5.17 and three negative acceptance tests (inert at the gate) stay unproven. The ADR docs/adr/0001-a-metrics-run-is-one-thread.md stays local because nothing under docs/ is committed in this public repository. What remains is pipeline metrics --save, pipeline clean for slug logbook-metrics, and closing the thread.

## Next step

The owner starts Clean-up by saying SatanshuMishra/logbook#298 (feat/logbook-metrics into main) merged: then resume_thread logbook-metrics and run pipeline:run's Clean-up for slug logbook-metrics. The preflight-routing neighbour (a plain request to pick up earlier work calls resume_thread without logbook:preflight) failed on both builds and was classed pre-existing; it is not this change's to fix.

Needs: D4.

## Decisions in force

- D4 Ship boundary: both MSPs ship from their green, fully tested heads: Ship now: run SHIP=1 run.zsh --resume with both proven heads, then open both pull requests in stack order, assign them to the owner and post each saved comment; the ADR under docs/ stays local because docs/ is never committed in this public repository.

## Open risks


## Settled, do not reopen

## Where the details live

- Pipeline spec (format description until the writer ships): /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.md
- Pipeline decisions and intent I1 to I6: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.decisions.md
- Pipeline ADRs: docs/adr/0010-plugin-metrics-share-one-jsonl-store.md and 0011-each-run-records-only-its-own-spend.md in the pipeline checkout
- This spec and its decisions, record and items: docs/specs/logbook-metrics.{md,decisions.md,record.json,items.json} in the logbook checkout
- Run home: ~/.mitosis/logbook/logbook-metrics/ (build-1.log holds the first build's output)
