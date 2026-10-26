# logbook-metrics: Logbook records its own metrics in the shared plugin-metrics store
Status: active
Updated: 2026-10-26T23:26:01.745Z
Next ids: c5 D1 R1 S1

## Goal

Logbook records metrics personalised to its purpose (keeping a piece of work's state true across sessions, compactions and /clear) in the shared ~/.plugin-metrics JSON Lines store, through a word-for-word copy of the pipeline's TypeScript reference writer, with a catalogue and a small skill that answers about logbook alone; carried through the full pipeline lane up to the first build, which waits on the shared writer.

## Done when

- [ ] c1 The spec, decisions file, record and items for logbook-metrics are in docs/specs/, with intent I1 to I6 copied word for word and every delegated answer citing an intent line or binding decision
- [ ] c2 The FEATURE branch is pushed and the run home ~/.mitosis/logbook/logbook-metrics/ holds CHARTER.md, worker-rules.txt, dispatch.zsh and run.zsh, plus accept.zsh in the repository
- [ ] c3 run.zsh --plan-only passes with no fatal finding and no build has run
- [ ] c4 The thread is parked with a next step gated on the shared writer existing on origin/feat/unified-metrics or origin/main

## Where things stand

Stage 1 of pipeline:run, full lane. The checkout is in sync with origin/main; its only local change is an uncommitted receipts.config.json from a receipts doctor run, and the committed tree already holds receipts.config.json, so the receipts set-up is skipped. The lighthouse readiness gate reports one open item: no lighthouse profile, to be answered by lighthouse:init --unattended.

## Next step

Invoke pipeline:run and follow Stage 1 (Sync and the logbook continuity), then run interphase:feature with the request and "Interview me first.", answering every round from intent lines I1 to I6 and the binding decisions in /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.decisions.md.

## Decisions in force

## Open risks

## Settled, do not reopen

## Where the details live

- Pipeline spec (format description until the writer ships): /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.md
- Pipeline decisions and intent I1 to I6: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.decisions.md
- Pipeline ADRs: docs/adr/0010-plugin-metrics-share-one-jsonl-store.md and 0011-each-run-records-only-its-own-spend.md in the pipeline checkout
