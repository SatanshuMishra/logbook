# Errata: SPEC Continuity Goal Model

This document corrects statements in `docs/specs/2026-08-28-continuity-goal-model.md` that are
false, self-contradictory, or point at the wrong place. An erratum never changes what was built,
never relaxes a requirement, and never edits the specification's own text — the approved SPEC
stays exactly as approved, and the correction lives here beside it. Entries are append-only.
Each names the exact anchor — a verbatim substring of the SPEC — that it corrects.

## E1 — section 8's `B36` row claims a goal it does not discharge

- **Anchor:** `LG10, LG15, LG16`
- **The SPEC says:** section 8, `B36` row: "`README.md` carries `LG1`–`LG17` in user language and the non-goals of section 3.2, including the single-session limit. It makes no performance claim, bound by decision `01M130DZJP1X0SMH3TGZNV2066`" with Goal cell `LG10, LG15, LG16`
- **Correction:** section 11.1 is right and the `B36` Goal cell overstates. `B36` publishes `LG16` in the README; it does not discharge it. `B36`'s Goal cell should read `LG10, LG15`.
- **Ground:** section 8's own preamble (`docs/specs/2026-08-28-continuity-goal-model.md:314`) states: "Each rule states the mandated behaviour, what it refuses, and the goal it discharges." So the Goal column names what a rule discharges. Section 11.1 (`docs/specs/2026-08-28-continuity-goal-model.md:470`) maps `` `LG16` → B42 `` and does not name `B36` for `LG16`. `LG16` is "Logbook never executes anything it stores" (`docs/specs/2026-08-28-continuity-goal-model.md:118`); no README text can make that true. `B42` — "No module outside a closed allowlist may spawn a process, and no record type is imported into any module on that list" (`docs/specs/2026-08-28-continuity-goal-model.md:328`) — is what makes it true, and invariant `S2` traces to `LG16` (`docs/specs/2026-08-28-continuity-goal-model.md:254`) and is assigned to `U1` in section 11.4 (`docs/specs/2026-08-28-continuity-goal-model.md:484`). The two tables agree on `LG10` and `LG15`, which section 11.1 maps to `B36` alone; `LG16` is the only one of the three with a behavioural discharge elsewhere, and it is the only one the two tables disagree on.
- **Effect on shipped behaviour:** none. `B36` shipped in `U3` and `B42` shipped in `U1`; both are unchanged. This is a coverage-bookkeeping correction.

## E2 — `S4` is stated without the qualifier that makes it true

- **Anchor:** `Every write tool succeeds when no pointer exists and when a foreign session holds one`
- **The SPEC says:** `| **S4** | Every write tool succeeds when no pointer exists and when a foreign session holds one | LG2 |`
- **Correction:** it holds for every call that carries no dependency on pointer state. `park_thread` supplied with an `outcome` is the one exception: when a foreign session holds the pointer it refuses, deliberately, because parking over that pointer would lose the other session's outcome text.
- **Ground:** the refusal is at `src/server/tools/park_thread.ts:362` (`otherSessionRefusal`, called when `pointer.session_id !== rt.sessionId` and `input.outcome !== undefined`) and is pinned by the shipped test `park.refuses-when-another-session-took-the-pointer` at `test/spawn/resume.test.ts:1044`. The specification's own section 6.1 rule 3 (`docs/specs/2026-08-28-continuity-goal-model.md:216`) requires an invariant to be "True of the system as it will be when its unit lands — never aspirationally", and `S4` as worded is false of the landed system. Rule 2 (`docs/specs/2026-08-28-continuity-goal-model.md:215`) forbids two invariants governing one event with different verdicts, which is why the stronger reading cannot simply be asserted instead. Ruling `OR33` already established that `U9` discharges the true reading.
- **Effect on shipped behaviour:** none. `U9` shipped `S4`'s census against the true reading.

## E3 — section 3.2 cites the wrong section for its enforcement claim

- **Anchor:** `never by a mechanical check — see section 6.4.`
- **The SPEC says:** `These are non-goals, stated once. They are enforced by decision records and review, never by a mechanical check — see section 6.4.`
- **Correction:** the supporting reference is section 6.1 rule 6, and section 6.6 is the applied case. Section 6.4 is the Job S table, whose own subtitle (`docs/specs/2026-08-28-continuity-goal-model.md:249`) reads "*Enforced by a test or census. Falsified by a red build.*" — the opposite enforcement mechanism from the one the sentence asserts.
- **Ground:** three strands, together settling that this is a wrong reference rather than a deliberate contrast. (1) Section 6.1 rule 6 (`docs/specs/2026-08-28-continuity-goal-model.md:219`) states the sentence's exact proposition: "Invariants guard drift, never a deliberate design act... A decision record and review guard choices; a mechanical check pointed at a choice is either trivially passed or permanently arguable." (2) The specification cites that rule for that same proposition twice elsewhere: at `docs/specs/2026-08-28-continuity-goal-model.md:276`, "Rule 6: it guards a deliberate act", rejecting one of section 3.2's own candidate non-goals in section 6.6; and at `docs/specs/2026-08-28-continuity-goal-model.md:476`, "Rule 6 of section 6.1 applies", closing with rule 6's own words about checks that are "trivially passed or permanently arguable". (3) Every other cross-reference in the document — `docs/specs/2026-08-28-continuity-goal-model.md:180`, `:324` and `:383` — is a supporting citation, never a contrast; had a contrast been intended the sentence would name it, and it does not.
- **Effect on shipped behaviour:** none. Documentation only.
