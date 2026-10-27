# logbook-metrics: Logbook records its own metrics in the shared plugin-metrics store
Status: active
Updated: 2026-10-27T03:10:30.702Z
Next ids: c5 D2 R1 S1

## Goal

Logbook records metrics personalised to its purpose (keeping a piece of work's state true across sessions, compactions and /clear) in the shared ~/.plugin-metrics JSON Lines store, through a word-for-word copy of the pipeline's TypeScript reference writer, with a catalogue and a small skill that answers about logbook alone; carried through the full pipeline lane up to the first build, which waits on the shared writer.

## Done when

- [x] c1 The spec, decisions file, record and items for logbook-metrics are in docs/specs/, with intent I1 to I6 copied word for word and every delegated answer citing an intent line or binding decision evidence: check_record --complete, check_spec and check_items pass after the 11 review fixes, the tree guard verified clean, and the record is handed-off
- [ ] c2 The FEATURE branch is pushed and the run home ~/.mitosis/logbook/logbook-metrics/ holds CHARTER.md, worker-rules.txt, dispatch.zsh and run.zsh, plus accept.zsh in the repository
- [ ] c3 run.zsh --plan-only passes with no fatal finding and no build has run
- [ ] c4 The thread is parked with a next step gated on the shared writer existing on origin/feat/unified-metrics or origin/main

## Where things stand

Stage 2 of pipeline:run, full lane, set-up. The FEATURE branch feat/logbook-metrics is cut from main at 579cc66c. Plan: 6 Steps in 3 stacked MSPs (metrics-writer, thread-events, thread-summary), 17 criteria, 5.17 unproven. Lighthouse readiness passes with an untracked .lighthouse/profile.json; receipts set-up is skipped because the committed tree holds receipts.config.json. GLOSSARY.md and docs/adr/0001-a-metrics-run-is-one-thread.md are written uncommitted. The run home holds CHARTER.md, worker-rules.txt and dispatch.zsh; ~/.mitosis/logbook/accept.zsh is reused.

## Next step

Copy items.json and graph.json into the run home, write run.zsh, and run it with --plan-only until it passes; then record the hand-off boundary and park.

## Decisions in force

- D1 Interphase hand-off boundary: build waits on the shared writer: Park. The first build starts with /Users/satanshumishra/.mitosis/logbook/logbook-metrics/run.zsh once the dependency check in the pipeline checkout lists the writer files, then the rest of pipeline:run (Stage 3 review, Validate, Ship).

## Open risks

## Settled, do not reopen

## Where the details live

- Pipeline spec (format description until the writer ships): /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.md
- Pipeline decisions and intent I1 to I6: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.decisions.md
- Pipeline ADRs: docs/adr/0010-plugin-metrics-share-one-jsonl-store.md and 0011-each-run-records-only-its-own-spend.md in the pipeline checkout
- This spec and its decisions, record and items: docs/specs/logbook-metrics.{md,decisions.md,record.json,items.json} in the logbook checkout
- Run home: ~/.mitosis/logbook/logbook-metrics/
