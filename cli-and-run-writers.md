# cli-and-run-writers: Logbook command line and run writers
Status: active
Updated: 2026-11-03T20:53:26.656Z
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

The spec is handed off after the one review's eleven fixes, passing every interphase check, the guard and pipeline guarantees; D2 records the hand-off. The mitosis plan (11a33cc9e44c) is clean after each Step's task gained a one-sentence summary for its change line and the pull-request subject and Why lines were shortened under the render caps. The build of five Lanes in one MSP is running in the background, writing to build.out and build.err in the run home.

## Next step

Run ~/.mitosis/logbook/cli-and-run-writers/run.zsh --plan-only, then the build, and read mitosis's last JSON line for the MSP's worktree, base, branch and lane notes.

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
