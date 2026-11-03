# cli-and-run-writers: Logbook command line and run writers
Status: active
Updated: 2026-11-03T22:26:26.205Z
Next ids: c6 D3 R2 S1

## Goal

A process with no Claude Code session, such as the pipeline's background drive, reads and writes a thread through a logbook command with the same checks, commits and push as the MCP tools, while a session holds and edits the same thread, with neither refusing nor losing the other's writes and every commit naming its writer. Spec 1 of the unattended-runs program, root R-C.

## Done when

- [ ] c1 The logbook command writes update_thread, record_decision and park_thread through each tool's own handler and reads decisions in force, with the exits and output lines the shared contract states.
- [ ] c2 A command write is never blocked by and never discards a session's pending or refused working-copy edit, and neither side loses the other's writes.
- [ ] c3 Compare-and-swap retries carry no count cap, and fetch and push carry no wall-clock limit, with git run non-interactively and with dead-peer detection.
- [ ] c4 Every commit names its writer, run:<slug> or the session id.
- [ ] c5 The pull request is open, bound with the ccd_pr tools, with Auto-Fix on, and the logbook version bumped.

## Where things stand

The build committed all five Lanes on mitosis/cli-and-run-writers (base 97f2e838) and the glossary terms are committed on top (head f595cdd1), unpushed because the gate judged one property weak: git.network-code-holds-no-wall-clock-timer is a source scan no mutant can fail. The round 1 suite passes 555 of 557; its two failures are old-model tests that still list src/cli as removed. Lint fails on the census, which has no rule for bin/logbook, and on home isolation, which only re-runs that suite. The release Step also deleted the userConfig assertion with the old version test. Planned fixes: drop src/cli from the removed paths, classify bin/logbook by exact path as a new-tree launcher, and restore the userConfig check. Reconcile lists src/server/tools/sync_ledger.ts as declared but unwritten; its handler never took a context argument, and this shows as a pull-request trade-off without blocking the ship. code-reviewer, security-reviewer and conformance-auditor are reviewing round 1.

## Next step

When the three round 1 reviewers finish, run pipeline candidates on their replies, the validator, verdict, then the fix pass with the planned fixes, keeping every fix off the locked test files.

Needs: D1, D2, R1.

## Decisions in force

- D1 The run's stages are driven from this session rather than by pipeline drive start: the drive is the code being rebuilt by the parallel pipeline spec and was the source of the halts this program fixes, so each stage runs here by the pipeline:run skill's own steps.
- D2 Interphase hand-off: build the spec as one MSP on feat/cli-and-run-writers: One MSP, cli-and-run-writers, built by mitosis 0.11.0 from the run home's run.zsh on feat/cli-and-run-writers, with the prevent rules for expand-contract, reliable-coding, secure-coding and tests appended to the worker rules.

## Open risks

- R1 mitosis 0.11.0 still requires --timeout; run.zsh passes 86400 seconds per Worker until the interphase and mitosis spec removes it.

## Settled, do not reopen

## Where the details live

- Spec: docs/specs/cli-and-run-writers.md
- Items: docs/specs/cli-and-run-writers.items.json
- Decisions: docs/specs/cli-and-run-writers.decisions.md
- Record: docs/specs/cli-and-run-writers.record.json
- Run home: ~/.mitosis/logbook/cli-and-run-writers/
- Drive spec: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/runs-complete-unattended.decisions.md
- Diagnosis: ~/.claude/projects/-Users-satanshumishra-Documents-DevLabs-pipeline/memory/run-halts-root-causes.md
- MSP worktree: ~/.mitosis/runs/logbook/cli-and-run-writers/trees/cli-and-run-writers
- Review files: ~/.mitosis/logbook/cli-and-run-writers/review/
