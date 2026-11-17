# handoff-parity: Make logbook as fast and cheap as a handoff file, with pickup on a second computer
Status: active
Updated: 2026-11-17T23:41:18.702Z
Next ids: c6 D2 R2 S1

## Goal

Logbook works as fast and token-efficiently as a committed handoff file, commit trailers or native auto memory, stays reliable in what Claude stores and recalls, and lets a user debrief on one computer and preflight on another clone of the same repo with Claude continuing seamlessly.

## Done when

- [ ] c1 In a rerun of logbook-evals stages S1, S2 and S3, logbook's mean cost and mean wall time per run are no higher than the handoff-file arm's (H), measured on the same harness as a logbook 0.20.0 baseline
- [ ] c2 In that rerun, logbook's recall answers score 1.0 on the keyword rubric in every stage, as H does
- [ ] c3 A thread debriefed on one clone is listed and picked up at session start on a fresh clone of the same repo under another home folder, without the user naming it, and the session continues the next step
- [ ] c4 An accepted change that could not reach origin is retried, and a pickup on another clone warns that its copy may be behind instead of silently using older state
- [ ] c5 npm test and npm run lint pass on the final branch

## Where things stand

Pull request #312 (mitosis/record-in-one-call into feat/handoff-parity) carries all eight Steps; the drive marked its lint failure unfixable and parked in awaiting-merge. Commit 559744c6, made in the scratch worktree and not yet pushed, makes lint pass 50 of 50. The rerun puts the built plugin at S1 0.093, S2 0.242 and S3 0.546 dollars against the handoff file's 0.075, 0.225 and 0.458; work sessions already match it. The gap comes from three places: read-only sessions are asked to record at Stop, a hand-off loads MCP tools and syncs again after park, and a crowded repository picks up the newer thread.

## Next step

In /private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/fe446180-dc5e-4960-9895-ea442f94e2fa/scratchpad/wt/logbook-built, make src/hook/stop.ts skip the provisional ask when HEAD and the worktree are unchanged since pickup, put the other open free threads' documents in the startup context within its ceiling, and let park_thread take edits and note so a hand-off is one logbook command; then run npm test and npm run lint, push to mitosis/record-in-one-call, and rerun the hp stages.

Needs: D1, R1.

## Decisions in force

- D1 hand-off: build the handoff-parity spec as two pull requests through the pipeline drive: Build both MSPs with the mitosis drive from the FEATURE branch, the pickup-across-clones MSP after record-in-one-call, then measure cost, wall time, turns and recall against the handoff-file arm with the built plugin.

## Open risks

- R1 Merging #312 before the parity fixes reach its branch strands them, so they would need a second pull request.

## Settled, do not reopen

## Where the details live

- Audit data and harness: /Users/satanshumishra/Documents/DevLabs/logbook-evals (README.md indexes it; results/runs_flat.jsonl and results/answers_long.jsonl hold the per-run figures)
- Baseline figures (0.19.0): S1 H 0.076 dollars, 20 s, 4.5 turns, 83k context; L 0.137 dollars, 33 s, 14.1 turns, 193k context. S3 H 0.456, L 0.829 dollars
- Cost driver traced in runs/model/s1/L-clean-continue-r1: 8 of 18 tool calls were logbook's (2 tool lookups, resume, read plus 4 separate edits at debrief)
- Second-device gaps: results/det/d2_checkout_sync.json (M2 teammate discovery GAP; M3 resume syncs first PASS)
- Lighthouse profile: /Users/satanshumishra/Documents/DevLabs/logbook/.lighthouse/profile.json
- Parity rerun: logbook-evals runs/model/hp-s1, hp-s2 and hp-s3, scored by harness/hp_score.py into results/hp_scores.jsonl; arm L is the installed 0.20.0, arm L2 loads the folder named by LOGBOOK_PLUGIN_L2
