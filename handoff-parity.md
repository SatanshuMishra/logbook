# handoff-parity: Make logbook as fast and cheap as a handoff file, with pickup on a second computer
Status: active
Updated: 2026-11-17T21:04:40.938Z
Next ids: c6 D2 R1 S1

## Goal

Logbook works as fast and token-efficiently as a committed handoff file, commit trailers or native auto memory, stays reliable in what Claude stores and recalls, and lets a user debrief on one computer and preflight on another clone of the same repo with Claude continuing seamlessly.

## Done when

- [ ] c1 In a rerun of logbook-evals stages S1, S2 and S3, logbook's mean cost and mean wall time per run are no higher than the handoff-file arm's (H), measured on the same harness as a logbook 0.20.0 baseline
- [ ] c2 In that rerun, logbook's recall answers score 1.0 on the keyword rubric in every stage, as H does
- [ ] c3 A thread debriefed on one clone is listed and picked up at session start on a fresh clone of the same repo under another home folder, without the user naming it, and the session continues the next step
- [ ] c4 An accepted change that could not reach origin is retried, and a pickup on another clone warns that its copy may be behind instead of silently using older state
- [ ] c5 npm test and npm run lint pass on the final branch

## Where things stand

Interphase handed off the spec handoff-parity: eight Steps in two MSPs, record-in-one-call then pickup-across-clones, with the spec review's seventeen fixes applied. Main's suite is 583 of 583 green.

## Next step

The drive entered amend-spec and runs it next.

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
