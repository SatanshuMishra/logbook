# logbook-metrics: Logbook records its own metrics in the shared plugin-metrics store
Status: parked
Updated: 2026-10-27T07:27:21.737Z
Next ids: c8 D4 R2 S1

## Goal

Logbook records metrics personalised to its purpose (keeping a piece of work's state true across sessions, compactions and /clear) in the shared ~/.plugin-metrics JSON Lines store, through a word-for-word copy of the pipeline's TypeScript reference writer, with a catalogue and a small skill that answers about logbook alone; carried through the full pipeline lane to its MSP pull requests (D2).

## Done when

- [x] c1 The spec, decisions file, record and items for logbook-metrics are in docs/specs/, with intent I1 to I6 copied word for word and every delegated answer citing an intent line or binding decision evidence: check_record --complete, check_spec and check_items pass after the 11 review fixes, the tree guard verified clean, and the record is handed-off
- [x] c2 The FEATURE branch is pushed and the run home ~/.mitosis/logbook/logbook-metrics/ holds CHARTER.md, worker-rules.txt, dispatch.zsh and run.zsh, plus accept.zsh in the repository evidence: pipeline feature-branch pushed feat/logbook-metrics at 579cc66c (git ls-remote shows it), and the run home holds CHARTER.md, worker-rules.txt, dispatch.zsh, run.zsh, items.json, graph.json and feature.json, with ~/.mitosis/logbook/accept.zsh reused
- [x] c3 run.zsh --plan-only passes with no fatal finding and no build has run evidence: run.zsh --plan-only exited 0 with plan id c64786cab3fa, no fatal finding and no drift, and nothing was spawned
- [x] c4 The thread is parked with a next step gated on the shared writer existing on origin/feat/unified-metrics or origin/main evidence: the next step is gated on the dependency check listing the writer files on origin/feat/unified-metrics or origin/main (Needs: D1), and park_thread follows this update with that next step
- [x] c5 The first build commits both MSPs, metrics-writer and thread-events, with the writer copied from origin/feat/unified-metrics a39ab11 (D2) evidence: run.zsh (plan d32ad79360da) committed mitosis/metrics-writer at 36662637 (gate pass 3/3) and mitosis/thread-events at 0fabaf17 (gate 39 pass, 3 inert negative tests), reconcile clean; metrics/source.json names origin/feat/unified-metrics a39ab110
- [ ] c6 Stage 3 review reaches green or blocked for each MSP, with every confirmed blocker and advisory fixed on its branch
- [ ] c7 Both MSP pull requests are open in stack order, assigned to the owner, each with its pipeline comment posted

## Where things stand

Stage 3 round 1 of pipeline:run, full lane, files in ~/.mitosis/logbook/logbook-metrics/review/round-1/. metrics-writer verdict is diagnose: blockers U1 and U2 (kind failing test, the two lint failures on the copied writer), a diagnosis agent is running, and the fix scopes the lint tests to exempt the files metrics/source.json lists, never editing the copy, as the parent session requires; C1, C2 and S1 were rejected (bar). The thread-events validator is running. thread-events: C1 MEDIUM (an origin-only resume_thread lands in the held thread's run), S1 MEDIUM (unrecognized_keys refusals store caller key names), and LOW C2 to C4, S2, S3. Both conformance audits found every criterion met. Fresh worktrees get the dev tools from symlinks in ~/.mitosis/runs/logbook/logbook-metrics/node_modules to the owner checkout's git-ignored packages; the copied writer passes logbook's strict tsc flags. Plan: 6 Steps in 2 stacked MSPs (metrics-writer, then thread-events, which holds the events, summary, catalogue and skill because they share the recorder, register.ts, session-end.ts and the catalogue), 17 criteria, 5.17 unproven. Lighthouse readiness passes with an untracked .lighthouse/profile.json; receipts set-up is skipped because the committed tree holds receipts.config.json. GLOSSARY.md and docs/adr/0001-a-metrics-run-is-one-thread.md are written uncommitted, and docs/ is gitignored, so Ship must force-add the ADR or leave it local.

## Next step

When the suite runs in ~/.mitosis/logbook/logbook-metrics/review/round-1/ finish, dispatch code-reviewer, security-reviewer and conformance-auditor for each MSP with the rendered briefs there, then collect findings (lint failures on metrics/ as suite findings), Validate and the fix pass.

Needs: D3.

## Decisions in force

- D3 Interphase hand-off boundary: first build restarts from items with tsconfig.json in writer-copy: Restart the first build with run.zsh from the corrected items (plan d32ad79360da), copying the writer from origin/feat/unified-metrics a39ab11, then Stage 3 review, Validate, the fix pass and Ship.

## Open risks


## Settled, do not reopen

## Where the details live

- Pipeline spec (format description until the writer ships): /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.md
- Pipeline decisions and intent I1 to I6: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/unified-metrics.decisions.md
- Pipeline ADRs: docs/adr/0010-plugin-metrics-share-one-jsonl-store.md and 0011-each-run-records-only-its-own-spend.md in the pipeline checkout
- This spec and its decisions, record and items: docs/specs/logbook-metrics.{md,decisions.md,record.json,items.json} in the logbook checkout
- Run home: ~/.mitosis/logbook/logbook-metrics/ (build-1.log holds the first build's output)
