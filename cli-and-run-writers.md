# cli-and-run-writers: Logbook command line and run writers
Status: active
Updated: 2026-11-03T22:57:23.390Z
Next ids: c6 D4 R2 S1

## Goal

A process with no Claude Code session, such as the pipeline's background drive, reads and writes a thread through a logbook command with the same checks, commits and push as the MCP tools, while a session holds and edits the same thread, with neither refusing nor losing the other's writes and every commit naming its writer. Spec 1 of the unattended-runs program, root R-C.

## Done when

- [x] c1 The logbook command writes update_thread, record_decision and park_thread through each tool's own handler and reads decisions in force, with the exits and output lines the shared contract states. evidence: the 15 command.* acceptance tests in test/spawn/cli/logbook-command.test.ts pass at a523570a, and the conformance auditor judged 5.1 to 5.4 MET
- [x] c2 A command write is never blocked by and never discards a session's pending or refused working-copy edit, and neither side loses the other's writes. evidence: writers.* tests for 5.5, 5.6 and command.run-and-session-write-one-thread-together pass, conformance auditor MET on 5.5, 5.6 and 5.12
- [x] c3 Compare-and-swap retries carry no count cap, and fetch and push carry no wall-clock limit, with git run non-interactively and with dead-peer detection. evidence: writers.commit-lands-after-another-thread-moves-the-ref-25-times and the five git.* tests pass; conformance auditor MET on 5.7 and 5.8
- [x] c4 Every commit names its writer, run:<slug> or the session id. evidence: the three writers.* trailer tests for 5.9 pass, and every command test asserts the Writer: line
- [ ] c5 The pull request is open, bound with the ccd_pr tools, with Auto-Fix on, and the logbook version bumped.

## Where things stand

Pull request 305 (mitosis/cli-and-run-writers at a523570a into feat/cli-and-run-writers) is open as ready, assigned, carrying the review comment and bound to this session, with logbook at 0.19.0; review went green in round 2 with every advisory fixed. Auto-Fix is off: the app refuses to enable it for a pull request opened through GitHub MCP, so the owner turns it on. CI was running at open with 4 checks passing and 4 pending.

## Next step

Run SHIP=1 ~/.mitosis/logbook/cli-and-run-writers/run.zsh --resume --proven-head cli-and-run-writers=a523570a, then open the pull request with mitosis's title and body through GitHub MCP, assign it, post review/cli-and-run-writers.comment.md, bind it and turn on Auto-Fix.

Needs: D1, D2, D3, R1.

## Decisions in force

- D1 The run's stages are driven from this session rather than by pipeline drive start: the drive is the code being rebuilt by the parallel pipeline spec and was the source of the halts this program fixes, so each stage runs here by the pipeline:run skill's own steps.
- D2 Interphase hand-off: build the spec as one MSP on feat/cli-and-run-writers: One MSP, cli-and-run-writers, built by mitosis 0.11.0 from the run home's run.zsh on feat/cli-and-run-writers, with the prevent rules for expand-contract, reliable-coding, secure-coding and tests appended to the worker rules.
- D3 Ship: push the reviewed MSP head and open it as a ready pull request: Ship cli-and-run-writers=a523570a as the proven head and open it ready for review into feat/cli-and-run-writers through GitHub MCP, then bind it and turn on Auto-Fix.

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
