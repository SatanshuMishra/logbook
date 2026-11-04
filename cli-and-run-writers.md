# cli-and-run-writers: Logbook command line and run writers
Status: parked
Updated: 2026-11-04T08:12:51.182Z
Next ids: c6 D4 R3 S1

## Goal

A process with no Claude Code session, such as the pipeline's background drive, reads and writes a thread through a logbook command with the same checks, commits and push as the MCP tools, while a session holds and edits the same thread, with neither refusing nor losing the other's writes and every commit naming its writer. Spec 1 of the unattended-runs program, root R-C.

## Done when

- [x] c1 The logbook command writes update_thread, record_decision and park_thread through each tool's own handler and reads decisions in force, with the exits and output lines the shared contract states. evidence: the 15 command.* acceptance tests in test/spawn/cli/logbook-command.test.ts pass at a523570a, and the conformance auditor judged 5.1 to 5.4 MET
- [x] c2 A command write is never blocked by and never discards a session's pending or refused working-copy edit, and neither side loses the other's writes. evidence: writers.* tests for 5.5, 5.6 and command.run-and-session-write-one-thread-together pass, conformance auditor MET on 5.5, 5.6 and 5.12
- [x] c3 Compare-and-swap retries carry no count cap, and fetch and push carry no wall-clock limit, with git run non-interactively and with dead-peer detection. evidence: writers.commit-lands-after-another-thread-moves-the-ref-25-times and the five git.* tests pass; conformance auditor MET on 5.7 and 5.8
- [x] c4 Every commit names its writer, run:<slug> or the session id. evidence: the three writers.* trailer tests for 5.9 pass, and every command test asserts the Writer: line
- [ ] c5 The pull request is open, bound with the ccd_pr tools, with Auto-Fix on, and the logbook version bumped.

## Where things stand

The work is in main at 605a4ea with logbook at 0.19.0, and pipeline clean has removed the run's worktrees, branches, run folders and spec files, keeping nothing. The installed logbook plugin has not been updated to 0.19.0, because the owner's session installs it after its parallel builds finish. Auto-Fix was never on for pull request 306, which the app refuses for a pull request opened through GitHub MCP. The owner's checkout stays at 1fdd0f0f, because its uncommitted receipts.config.json blocks the fast-forward.

## Next step

After the owner's session installs logbook 0.19.0, run pipeline installed for logbook@logbook against main, then strike or tick c5 and close the thread.

## Decisions in force

- D1 The run's stages are driven from this session rather than by pipeline drive start: the drive is the code being rebuilt by the parallel pipeline spec and was the source of the halts this program fixes, so each stage runs here by the pipeline:run skill's own steps.

## Open risks

- R2 pipeline 0.12.3 checks, suite and integration-plan refuse an interphase record holding an unproven criterion, so integration ran without criterion 5.11, and 5.11 is proven by nothing.

## Settled, do not reopen

## Where the details live

- Archive: ~/.mitosis/logbook/archive/cli-and-run-writers/, holding the spec, items, decisions, record, record-proven.json and every review file
- Drive spec: /Users/satanshumishra/Documents/DevLabs/pipeline/docs/specs/runs-complete-unattended.decisions.md
- Diagnosis: ~/.claude/projects/-Users-satanshumishra-Documents-DevLabs-pipeline/memory/run-halts-root-causes.md
