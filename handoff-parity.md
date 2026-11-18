# handoff-parity: Make logbook as fast and cheap as a handoff file, with pickup on a second computer
Status: active
Updated: 2026-11-18T00:10:49.052Z
Next ids: c6 D2 R2 S1

## Goal

Logbook works as fast and token-efficiently as a committed handoff file, commit trailers or native auto memory, stays reliable in what Claude stores and recalls, and lets a user debrief on one computer and preflight on another clone of the same repo with Claude continuing seamlessly.

## Done when

- [ ] c1 In a rerun of logbook-evals stages S1, S2 and S3, logbook's mean cost and mean wall time per run are no higher than the handoff-file arm's (H), measured on the same harness as a logbook 0.20.0 baseline
- [ ] c2 In that rerun, logbook's recall answers score 1.0 on the keyword rubric in every stage, as H does
- [x] c3 A thread debriefed on one clone is listed and picked up at session start on a fresh clone of the same repo under another home folder, without the user naming it, and the session continues the next step evidence: test/sync/two-clone-handoff.test.ts fresh-clone-picks-up-a-parked-thread (clone b under its own HOME gets the parked document at startup), and in all three hp2-s3 runs Bob's fresh clone, holding no logbook refs, picked up auth-hardening unnamed and passed the hidden tests 11 of 11
- [x] c4 An accepted change that could not reach origin is retried, and a pickup on another clone warns that its copy may be behind instead of silently using older state evidence: test/hooks/startup-sync.test.ts unpushed-change-is-pushed-at-startup, unreachable-origin-is-named and unparked-thread-says-so
- [x] c5 npm test and npm run lint pass on the final branch evidence: at aebd73d9, the head of #312, npm test passes 650 of 650 and npm run lint 50 of 50

## Where things stand

Pull request #312 (mitosis/record-in-one-call into feat/handoff-parity) carries all eight Steps, the lint fix, the three parity fixes and the review's fixes, at head aebd73d9; CI runs on it and the drive rests in awaiting-merge. The hp2 rerun of the built plugin against the handoff file: S1 0.080 against 0.073 dollars and 18.5 against 16.2 s, S2 0.237 against 0.243 dollars and 61 against 69 s, S3 0.508 against 0.471 dollars and 89 against 80 s; recall 0.983, 0.967 and 0.939 against 1.0. Continue and hand-off sessions now match or beat the handoff file; the remaining gap is about 2,000 more tokens in each session's first request (state document, update rules, server instructions) and about 0.3 s of hooks per Bash call. Two of the three recall misses answer P5 "functionally yes" or "functionally done", which the keyword rubric scores as not done; one answers "partly", citing the recorded in-memory risk. The rerun measured 1b5f5f43; the review fixes after it change only sessions that edited something.

## Next step

The user reviews and merges #312; then resume this thread and run pipeline drive event --repo /Users/satanshumishra/Documents/DevLabs/logbook --slug handoff-parity --name merged.

Needs: D1.

## Decisions in force

- D1 hand-off: build the handoff-parity spec as two pull requests through the pipeline drive: Build both MSPs with the mitosis drive from the FEATURE branch, the pickup-across-clones MSP after record-in-one-call, then measure cost, wall time, turns and recall against the handoff-file arm with the built plugin.

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
