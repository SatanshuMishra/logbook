# handoff-parity: Make logbook as fast and cheap as a handoff file, with pickup on a second computer
Status: parked
Updated: 2026-11-18T05:57:47.391Z
Next ids: c6 D3 R2 S1

## Goal

Logbook works as fast and token-efficiently as a committed handoff file, commit trailers or native auto memory, stays reliable in what Claude stores and recalls, and lets a user debrief on one computer and preflight on another clone of the same repo with Claude continuing seamlessly.

## Done when

- [ ] c1 In a rerun of logbook-evals stages S1, S2 and S3, logbook's mean cost and mean wall time per run are no higher than the handoff-file arm's (H), measured on the same harness as a logbook 0.20.0 baseline
- [ ] c2 In that rerun, logbook's recall answers score 1.0 on the keyword rubric in every stage, as H does
- [x] c3 A thread debriefed on one clone is listed and picked up at session start on a fresh clone of the same repo under another home folder, without the user naming it, and the session continues the next step evidence: test/sync/two-clone-handoff.test.ts fresh-clone-picks-up-a-parked-thread (clone b under its own HOME gets the parked document at startup), and in all three hp2-s3 runs Bob's fresh clone, holding no logbook refs, picked up auth-hardening unnamed and passed the hidden tests 11 of 11
- [x] c4 An accepted change that could not reach origin is retried, and a pickup on another clone warns that its copy may be behind instead of silently using older state evidence: test/hooks/startup-sync.test.ts unpushed-change-is-pushed-at-startup, unreachable-origin-is-named and unparked-thread-says-so
- [x] c5 npm test and npm run lint pass on the final branch evidence: at aebd73d9, the head of #312, npm test passes 650 of 650 and npm run lint 50 of 50

## Where things stand

The change meant to close c1 and c2 is specified as lean-session-cost, six Steps in one pull request: per-call hooks served by the running server through a hook_event tool, one line instead of the document on an unchanged resume, compile cache for the remaining processes, a 568-byte server instructions text with all four skills hidden from the model's listing, and a rule keeping a failed attempt's lesson; the spec passed its one review and is handed off, with criterion 5.9, a real session firing the hooks, left to the product test. Pull request #313 merged feat/handoff-parity into main at 2f89bf82, carrying #312 plus two lighthouse fixes: L1 puts the record command in open_thread's structured reply, and L2 has a startup pickup say it already holds the thread. The drive's clean-up released it as 0.21.0 (tag v0.21.0), deleted the FEATURE branch and ended in ready-pr; 0.21.0 is the installed plugin. c1 and c2 stay open, because lighthouse left cost parity and recall at 1.0 unproven. The hp2 rerun of the built plugin against the handoff file: S1 0.080 against 0.073 dollars and 18.5 against 16.2 s, S2 0.237 against 0.243 dollars and 61 against 69 s, S3 0.508 against 0.471 dollars and 89 against 80 s; recall 0.983, 0.967 and 0.939 against 1.0. Both arms make the same tool calls in S1, so the cost gap is per-session context: about 2,000 more tokens written to the cache at 4 dollars per million (update command and rules, server instructions, skill and tool listings), plus the state document sent again on every resume. The wall-time gap is local, about 2 s per working session, from a node process of about 145 ms per pre-tool, post-tool and stop hook (benchmarked with a held thread). The recall probes pay one more request: the handoff-file fixture keeps the failed first compare.js under Tried and failed, while logbook's rules drop a failed attempt, so Q6 sends logbook sessions into git history. Claude Code 2.1.325 runs mcp_tool hooks on PreToolUse, PostToolUse and Stop against the already running MCP server; a probe showed event fields arrive (objects as JSON text, missing ones empty), no permission prompt, and the returned context reaches the model. Two of the three recall misses answer P5 "functionally yes" or "functionally done", which the keyword rubric scores as not done; one answers "partly", citing the recorded in-memory risk. The rerun measured 1b5f5f43; the review and lighthouse fixes after it change only sessions that edited something or opened a thread.

## Next step

The drive entered fix and runs it next.

## Decisions in force

- D2 hand-off: build the lean-session-cost spec as one pull request through the pipeline drive: Build the six Steps as one MSP with the pipeline drive from feat/lean-session-cost, then rerun logbook-evals S1 to S3 with arms H and L2 on the released plugin to decide c1 and c2.

## Open risks

## Settled, do not reopen

## Where the details live

- Audit data and harness: /Users/satanshumishra/Documents/DevLabs/logbook-evals (README.md indexes it; results/runs_flat.jsonl and results/answers_long.jsonl hold the per-run figures)
- Baseline figures (0.19.0): S1 H 0.076 dollars, 20 s, 4.5 turns, 83k context; L 0.137 dollars, 33 s, 14.1 turns, 193k context. S3 H 0.456, L 0.829 dollars
- Cost driver traced in runs/model/s1/L-clean-continue-r1: 8 of 18 tool calls were logbook's (2 tool lookups, resume, read plus 4 separate edits at debrief)
- Second-device gaps: results/det/d2_checkout_sync.json (M2 teammate discovery GAP; M3 resume syncs first PASS)
- Lighthouse profile: /Users/satanshumishra/Documents/DevLabs/logbook/.lighthouse/profile.json
- Parity rerun: logbook-evals runs/model/hp-s1, hp-s2 and hp-s3, scored by harness/hp_score.py into results/hp_scores.jsonl; arm L is the installed 0.20.0, arm L2 loads the folder named by LOGBOOK_PLUGIN_L2
- Rerun after the parity fixes: logbook-evals runs/model/hp2-s1, hp2-s2 and hp2-s3 with arms H and L2, logs results/hp2-s1.log to hp2-s3.log, scores results/hp2-score.txt
- Spec of the change closing c1 and c2: docs/specs/lean-session-cost.md with its record, items and decisions files beside it; run home ~/.mitosis/logbook/lean-session-cost
