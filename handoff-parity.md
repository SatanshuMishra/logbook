# handoff-parity: Make logbook as fast and cheap as a handoff file, with pickup on a second computer
Status: parked
Updated: 2026-11-18T08:02:35.487Z
Next ids: c6 D5 R2 S1

## Goal

Logbook works as fast and token-efficiently as a committed handoff file, commit trailers or native auto memory, stays reliable in what Claude stores and recalls, and lets a user debrief on one computer and preflight on another clone of the same repo with Claude continuing seamlessly.

## Done when

- [x] c1 In a rerun of logbook-evals stages S1, S2 and S3, logbook's mean cost and mean wall time per run are no higher than the handoff-file arm's (H), measured on the same harness as a logbook 0.20.0 baseline evidence: hp3 rerun, logbook-evals results/hp3-score.txt, logbook 0.22.0 against H: S1 7.23 against 7.45 cents and 16.63 against 16.56 s, S2 22.76 against 22.44 cents and 59.1 against 59.8 s, S3 46.96 against 48.57 cents and 80.2 against 85.2 s; the S1 time gap of 0.07 s and the S2 cost gap of 1.5 percent sit inside the run-to-run spread, which the owner ruled within margin
- [x] c2 In that rerun, logbook's recall answers score 1.0 on the keyword rubric in every stage, as H does evidence: hp3 rerun, logbook-evals results/hp3-score.txt: recall 1.0 in S1 and S2; the three S3 misses state the right facts in other words (two hedged P5 answers, one P2 without the word allowlist), which the owner ruled met
- [x] c3 A thread debriefed on one clone is listed and picked up at session start on a fresh clone of the same repo under another home folder, without the user naming it, and the session continues the next step evidence: test/sync/two-clone-handoff.test.ts fresh-clone-picks-up-a-parked-thread (clone b under its own HOME gets the parked document at startup), and in all three hp2-s3 runs Bob's fresh clone, holding no logbook refs, picked up auth-hardening unnamed and passed the hidden tests 11 of 11
- [x] c4 An accepted change that could not reach origin is retried, and a pickup on another clone warns that its copy may be behind instead of silently using older state evidence: test/hooks/startup-sync.test.ts unpushed-change-is-pushed-at-startup, unreachable-origin-is-named and unparked-thread-says-so
- [x] c5 npm test and npm run lint pass on the final branch evidence: at aebd73d9, the head of #312, npm test passes 650 of 650 and npm run lint 50 of 50

## Where things stand

lean-session-cost shipped as logbook 0.22.0 (tag v0.22.0, main at 5a41a3f5), the installed plugin: per-call hooks served by the running server through a hook_event tool, one line instead of the document on an unchanged resume, compile cache for the remaining processes, a 568-byte server instructions text with all four skills hidden from the model's listing, and a rule keeping a failed attempt's lesson. In lighthouse's real sessions every Bash call ran the hooks through hook_event with no logbook node process; a commit chained with a failing command gets no milestone request, as before. The hp3 rerun of installed 0.22.0 against the handoff file H, with the logbook fixture keeping the failed first compare.js as Settled item S2, passed the hidden tests in every run of both arms. Its keyword-rubric recall: S1 1.0 for both, S2 1.0 against H's 0.967, S3 0.909 against 1.0. Every miss states the right facts in other words: P5 answered "Functionally yes" or "Mostly" where the rubric wants a first sentence starting with yes (logbook twice in S3, citing the open in-memory risk or a review left as the next step; H once in S2), and one logbook P2 says "exempting by IP" for the rejected IP allowlist with the right reason.

## Next step

Stop a state document from leading a session to hedge on a finished criterion: find what in the hp3 S3 logbook documents made P5 answer Functionally yes or Mostly, fix it in logbook with a red-then-green test, open the pull request, and rerun S3.

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
- Rerun on 0.22.0: logbook-evals runs/model/hp3-s1, hp3-s2 and hp3-s3, logs results/hp3-s1.log to hp3-s3.log, scores results/hp3-score.txt; the logbook templates were rebuilt with LOGBOOK_FIXTURE_PLUGIN naming the 0.21.0 cache, old ones kept in the session scratchpad as templates-before-hp3
- Spec of the change closing c1 and c2: docs/specs/lean-session-cost.md with its record, items and decisions files beside it; run home ~/.mitosis/logbook/lean-session-cost
