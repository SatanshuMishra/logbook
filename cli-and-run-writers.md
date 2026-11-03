# cli-and-run-writers: Logbook command line and run writers
Status: active
Updated: 2026-11-03T20:31:20.056Z
Next ids: c6 D1 R1 S1

## Goal

A process with no Claude Code session, such as the pipeline's background drive, reads and writes a thread through a logbook command with the same checks, commits and push as the MCP tools, while a session holds and edits the same thread, with neither refusing nor losing the other's writes and every commit naming its writer. Spec 1 of the unattended-runs program, root R-C.

## Done when

- [ ] c1 The logbook command writes update_thread, record_decision and park_thread through each tool's own handler and reads decisions in force, with the exits and output lines the shared contract states.
- [ ] c2 A command write is never blocked by and never discards a session's pending or refused working-copy edit, and neither side loses the other's writes.
- [ ] c3 Compare-and-swap retries carry no count cap, and fetch and push carry no wall-clock limit, with git run non-interactively and with dead-peer detection.
- [ ] c4 Every commit names its writer, run:<slug> or the session id.
- [ ] c5 The pull request is open, bound with the ccd_pr tools, with Auto-Fix on, and the logbook version bumped.

## Where things stand

The spec, record and items are written and pass interphase's checks: 12 criteria (5.11 unproven, host PATH) and 5 Steps in one MSP, command-writer-path, working-copy-base, git-without-wall-clock, command-line and release, after the check-author Step. The one spec review is running.

## Next step

Apply the spec review's real findings, re-render and recheck, then hand off: glossary terms, guard verify, record handed-off, and start the mitosis build.

## Decisions in force

## Open risks

## Settled, do not reopen

## Where the details live

- Decisions: docs/specs/cli-and-run-writers.decisions.md
- Record: docs/specs/cli-and-run-writers.record.json
- Run home: ~/.mitosis/logbook/cli-and-run-writers/
- Drive spec: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/runs-complete-unattended.decisions.md
- Diagnosis: ~/.claude/projects/-Users-satanshumishra-Documents-DevLabs-pipeline/memory/run-halts-root-causes.md
