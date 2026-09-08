# Errata: SPEC Continuity Recording Model

This document corrects statements in `docs/specs/2026-09-06-continuity-recording-model.md` that are
false, self-contradictory, or point at the wrong place. An erratum never changes what was built,
never relaxes a requirement, and never edits the specification's own text — the approved SPEC
stays exactly as approved, and the correction lives here beside it. Entries are append-only.
Each names the exact anchor — a verbatim substring of the SPEC — that it corrects.

## E1 — the `SubagentStop` payload does carry `stop_hook_active`

- **Anchor:** `It carries **no** `stop_hook_active` equivalent`
- **The SPEC says:** "It carries **no** `stop_hook_active` equivalent, which `S10` accounts for by keying the gate to `agent_id` instead."
- **Correction:** the payload does carry `stop_hook_active`. The design conclusion is unaffected — the gate keys to `agent_id` and reads `stop_hook_active` nowhere — but it now rests on a decision about failure direction rather than on the field being absent.
- **Ground:** `test/fixtures/hook-events/subagent-stop.json:12` carries `"stop_hook_active": false` in a live capture. `test/fixtures/hook-types.d.ts:87` declares it a required boolean, and `test/hooks/fixtures-typecheck.test.ts` compiles the fixture against that type, so the pin is machine-enforced rather than prose. The capture landed in commit `94fb8a67`. The spec sourced the claim from external documentation, and the plan flagged it unverified in advance at `docs/plans/2026-09-06-continuity-recording-model.md:791`, and required a capture before any code proceeded at `docs/plans/2026-09-06-continuity-recording-model.md:819`.
- **Effect on shipped behaviour:** none. `src/hooklib/subagent-stop-gate.ts:50-69` reads `stop_hook_active` nowhere.

## E2 — a `SubagentStop` event does not mean a subagent finished

- **Anchor:** ``SubagentStop` is the subagent equivalent of `Stop`: subagent hooks run only while that subagent is running`
- **The SPEC says:** "`SubagentStop` is the subagent equivalent of `Stop`: subagent hooks run only while that subagent is running, and a `Stop` hook declared for a subagent is converted to `SubagentStop`."
- **Correction:** an event carrying an empty `agent_type` has no matching subagent start; it is an internal fork of the main thread rather than a subagent finishing. The merged gate refuses those events. The spec never contemplated this case, so nothing in it is relaxed — this records a distinction the document lacks.
- **Ground:** `src/hooklib/subagent-stop-gate.ts:56` returns a silent verdict on an empty `agent_type`, and `hooks/subagent-stop.ts:18` coerces an absent or non-string field to the empty string so a payload missing it is refused rather than crashing. Pinned by `test/hooks/subagent-stop-gate.test.ts:147-165` and `:167-188`. The guard shipped in `26835acf`. Decision `01M1YYTGQNNMCKJFB4FSSQVPDJ` on thread `01M1X4AGKS5B0V1HX4BNF8596Q` records it, together with the joined-corpus measurement behind it: across 10,008 September hook events joined against 1,954 subagent starts, an empty `agent_type` correlates with no matching start with zero exceptions, and roughly four in five events are internal forks. Those corpus figures are recorded in that decision and are not re-derivable from this repository, which pins exactly one capture — and that capture carries a real `agent_type` (`test/fixtures/hook-events/subagent-stop.json:9`).
- **Effect on shipped behaviour:** none by this erratum; the guard is already merged.

## E3 — `S8` is true of neither gate

- **Anchor:** `the gate is cleared by the ledger head moving from the value recorded at that fire. No write is inspected for content`
- **The SPEC says:** "| **S8** | For every gate fire, the gate is cleared by the ledger head moving from the value recorded at that fire. No write is inspected for content, and no write is attributed to an actor | `C-8` |"
- **Correction:** the `SubagentStop` gate records no head at its fire and clears on no head at all — it is damped by a per-`agent_id` marker file. The `Stop` gate does record a head at its fire, but a moved head does not clear it alone: the changed paths must also be filed under the held thread. The clause "no write is attributed to an actor" survives, because a thread is not an actor.
- **Ground:** the subagent gate reads the head only as a liveness precondition at `src/hooklib/subagent-stop-gate.ts:63-64` and then discards it; the marker written at `:66` and checked at `:58` is what damps it, and `test/hooks/subagent-stop-gate.test.ts:87-102` asserts that a record reaching the ledger between two subagents still blocks the second. The `Stop` gate's held-thread path filter is at `src/hooklib/stop-gate.ts:192-198`, pinned at `test/hooks/stop-gate-ledger-presence.test.ts:138-156`. The two halves went false at different times. The `Stop` half was already false when the spec landed: `b0b47afe` introduced the held-thread path filter on 2026-09-05, a day before the spec commit `3c2932f7`, and is an ancestor of `fcc15258` — the tree the spec's own line 45 (`docs/specs/2026-09-06-continuity-recording-model.md:45`) says every citation was checked against. Decision `01M1YZA2377NZEHEMR0EZC4BAV` rules the session-wide head check a defect in merged code rather than a design choice to preserve. The `SubagentStop` half was falsified by the implementation in two steps: `6724fbc4` removed the gate's own head write as a no-op, after which it cleared against a head recorded at the `Stop` gate's fire rather than at its own; `10d5c266` then removed the head comparison entirely, so every subagent is asked rather than only the first.
- **Effect on shipped behaviour:** none. The behaviour `10d5c266` produced is the intended one.

## E4 — `B69` states `S8`'s false claim as a behavioural rule

- **Anchor:** `**B69** Both gates record the ledger head at the moment they fire, and clear when that head has moved.`
- **The SPEC says:** `- **B69** Both gates record the ledger head at the moment they fire, and clear when that head has moved. No write is inspected for content, and no write is attributed to an actor.`
- **Correction:** the same defect as `E3`, stated for the behavioural rule rather than the invariant. The `SubagentStop` gate records no head at its fire and clears on no head at all, damped instead by a per-`agent_id` marker file; the `Stop` gate does record a head at its fire, but a moved head alone does not clear it — the changed paths must also be filed under the held thread.
- **Ground:** see `E3` for the full grounding and the when-it-broke split between the two gates; this is the same defect as it appears in the behavioural-rule table rather than the invariant table.
- **Effect on shipped behaviour:** none.

## E5 — `S9`'s fresh-turn condition is not required when the client sends no prompt id

- **Anchor:** `a fresh human turn has entered the transcript since the last fire. Neither condition alone stands it down |`
- **The SPEC says:** "| **S9** | The `Stop` gate stands down silently for the remainder of the session once both conditions hold: it has fired at least twice for this thread, and a fresh human turn has entered the transcript since the last fire. Neither condition alone stands it down | `C-8` |"
- **Correction:** the fire count alone does stand the gate down whenever the client sends no `prompt_id`, because an absent prompt id is treated as a fresh turn by design. The "for the remainder of the session" clause survives.
- **Ground:** `src/hooklib/stop-gate.ts:168-171` computes the fresh-turn predicate as `event.prompt_id === null || fireState.prompt_id_at_last_fire !== event.prompt_id`. Pinned deliberately at `test/hooks/stop-gate-recording-assertions.test.ts:194-209`, whose own assertion message states the reason: an unobservable prompt id must resolve toward silence, never toward an endless block. Changed by `bcfeadc3`, whose commit message names `S9`.
- **Effect on shipped behaviour:** none.

## E6 — `B70`'s first sentence carries `S9`'s false condition, and its second half survives

- **Anchor:** `The `Stop` gate stands down silently for the rest of the session once it has fired at least twice for this thread **and** a fresh human turn has entered the transcript since the last fire.`
- **The SPEC says:** "- **B70** The `Stop` gate stands down silently for the rest of the session once it has fired at least twice for this thread **and** a fresh human turn has entered the transcript since the last fire. Neither condition alone stands it down. The `SubagentStop` gate needs no separate damping: `B68` keys it to `agent_id`, which is unique per subagent instance, so it is one-shot by construction and needs no `stop_hook_active` equivalent."
- **Correction:** the first sentence takes `E5`'s correction. The rest of `B70` survives and is what shipped: the `SubagentStop` gate does need no separate damping, because `B68` keys it to `agent_id` and the marker file makes it one-shot. That surviving clause rests on the capability claim `E1` corrects without itself being false, because it states what the design needs rather than what the payload carries. `E7` corrects `B68` on a different point — the "once per `agent_id`" upper bound — and the keying clause this entry relies on survives that correction intact.
- **Ground:** see `E1` and `E5`, plus the marker at `src/hooklib/subagent-stop-gate.ts:58` and `:66`.
- **Effect on shipped behaviour:** none.

## E7 — `B68`'s "once per `agent_id`" is an upper bound, not a guarantee

- **Anchor:** `**B68** The `SubagentStop` gate presents `R-1` through `R-6`, once per `agent_id`.`
- **The SPEC says:** "- **B68** The `SubagentStop` gate presents `R-1` through `R-6`, once per `agent_id`."
- **Correction:** at most once per `agent_id`, and only when every one of these further preconditions holds — a resolvable store layout, a path-safe `agent_id`, a path-safe `session_id`, a non-empty `agent_type`, a resume baseline matching this session, and a readable ledger head. An internal fork receives a distinct `agent_id` and zero presentations. `S10` states the same rule as an upper bound and is true as written.
- **Ground:** `src/hooklib/subagent-stop-gate.ts:51-64` for the preconditions, `:58` for the marker check, and `test/hooks/subagent-stop-gate.test.ts:46-59` for the at-most-once pin.
- **Effect on shipped behaviour:** none.
