# M5 — Resume and park

**Depends on:** M4. **Must not run in parallel with M9** — both touch the preflight surface (§13.3).

**Ships:** `resume_thread`, `park_thread`, pointer ownership, and crash detection.

**Read first:** SPEC §6.4, §7.3, §9, §11.5, §1.2.

This unit repairs the defect that prompted the rebuild. Read §1.2's table before writing anything: the active pointer is set in session 1 and null from session 2 onward, and the hand-off gate fires every turn in session 1 and never afterwards. Both directions are wrong because the pointer's lifecycle does not match the condition it gates.

---

## Premise checks

- [ ] **P1. M4 is merged and green.**
- [ ] **P2. There is no stored `active` status.** `grep -rn "'active'" rebuild/src/schema/thread.ts` returns nothing. If a status enum member named `active` exists, the root cause of both named defects is still present and the unit is re-planned.
- [ ] **P3. There is no stored `blocked` status.** Same check for `'blocked'`; `blocked_by` as a field is expected and correct.
- [ ] **P4. `state/` is outside the ledger ref.** Read `rebuild/src/store/layout.ts` and confirm nothing under `state/` is passed to `write-path.ts` as a `RecordChange`.
- [ ] **P5. The done gate refuses inside the transition.** Confirm `transition` calls `evaluateDoneGate` rather than a caller calling both.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | Open, park, resume, park again — **the second park succeeds** | `resume.round-trip` passes |
| A2 | Resuming twice on one thread is not an error and leaves one pointer | `resume.idempotent` passes |
| A3 | A pointer left set by a killed session is reported at the next session start | `handoff.detects-crash` passes |
| A4 | Resuming is one call and parking is one call | `resume.is-one-call` and `park.is-one-call` pass |
| A5 | The pointer is never committed to the ledger ref | `pointer.is-never-committed` passes |
| A6 | Both tools have spawn and rejection tests | four tests |

**Red on the parent commit:** `resume.round-trip`. §11.5 names this as the reproduction of the current permanent-`paused` defect, and it is the single most important assertion in the rebuild.

**Inertness mutation:** in `rebuild/src/server/tools/resume-thread.ts`, replace the `writePointer` call with a no-op. `resume.round-trip` must turn red — and it must turn red at the **second park**, not at the resume, because that is the shape of the reported defect.

---

## Files

**Create:** `rebuild/src/domain/pointer.ts`; `rebuild/src/server/tools/resume-thread.ts`, `park-thread.ts`; `rebuild/src/render/briefing.ts` (first version; M10 adds the census); `rebuild/test/unit/pointer.test.ts`; `rebuild/test/spawn/resume.test.ts`.

---

## Task 1: The pointer

**Files:** `rebuild/src/domain/pointer.ts`, `rebuild/test/unit/pointer.test.ts`

**Produces:** `Pointer`, `readPointer`, `writePointer`, `releasePointer` (signatures in `00-overview.md` §3).

- [ ] **Step 1: Write the failing tests**

```
pointer.write-is-idempotent    writing the same thread id twice leaves one pointer file whose
                               contents are equal apart from written_at
pointer.release-is-idempotent  releasing twice succeeds; releasing when none is set succeeds
pointer.release-only-own       releasing while the pointer names a DIFFERENT thread leaves that
                               pointer untouched and reports that it did
pointer.is-never-committed     write a pointer, perform a ledger commit, and assert the ledger
                               ref's tree contains no path under state/ -- asserted with
                               `git ls-tree -r --name-only LEDGER_REF`, over the whole tree
pointer.survives-nothing       the pointer file lives under state/, so a fresh clone of the project
                               has no pointer; asserted by cloning the fixture repo and reading
```

**Parking is releasing the pointer; resuming is writing it.** Both are idempotent by construction, which removes an entire class of illegal-transition failures — including the one that currently makes a second hand-off on a resumed thread impossible (§6.4).

`pointer.is-never-committed` is A5 and it is what makes §6.4's two deliberate consequences true: crash detection is per-machine, and Logbook does not lock a thread across teammates. §14 item 9 accepts both.

- [ ] **Step 2: Implement**

The pointer is one JSON file at `state/active-thread.json` written through M1's `durableWrite`. `readPointer` returns `null` when the file is absent and a `Refusal` is **not** used for that case — absence here is a genuine successful read finding nothing (§10.3). A file that exists and does not parse is an error, not a `null`.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/domain/pointer.ts rebuild/test/unit/pointer.test.ts
git commit -m "feat(rebuild): track the worked thread in a machine-local pointer"
```

---

## Task 2: The briefing renderer

**Files:** `rebuild/src/render/briefing.ts`

`resume_thread` returns the rendered briefing, so the renderer lands here. M10 adds the census that proves no interpolation site bypasses M1's `escapeStored`; this unit uses the helper at every site and M10 proves it.

- [ ] **Step 1: Implement `renderBriefing(thread, decisions, pointer)`**

Every stored value reaches the output through `escapeStored`, with no exception. Criteria render as `c<ordinal>` using the recomputed ordinal, never the ULID, because the ordinal is what a human reads.

**Blockage renders or it does not exist.** Because `blocked_by` is a field rather than a state, the briefing can only show that a thread is blocked by rendering its reason (§6.4). A thread with `blocked_by` set renders the reason inline; there is no code path that prints the word blocked without it. This structurally repairs the current defect where the roster announces `blocked` and never says why.

- [ ] **Step 2: Write the failing test**

```
briefing.blocked-renders-its-reason   a thread with blocked_by set renders a line containing the
                                      reason text; a census over the renderer asserts no output
                                      branch emits the word "blocked" without the reason in the
                                      same line
```

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/render/briefing.ts
git commit -m "feat(rebuild): render a briefing that always shows why a thread is blocked"
```

---

## Task 3: `resume_thread`

**Files:** `rebuild/src/server/tools/resume-thread.ts`

`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: **true**`.

- [ ] **Step 1: Write the description**

> Picks up one thread and returns its finished briefing in a single call: it reconciles the store, marks the thread as the one being worked on this machine, and renders what the previous session left. Takes one thread id, a 26-character ULID such as `01M0NDPM0ACCR9CD68PMHYWGGD`, which comes from `list_threads` or the `logbook://roster` resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.

Note what the description does **not** do: it never says "print this verbatim" or "call this first". An instruction to the model in a tool description reads as prompt injection and fails review (§7.3). The verbatim rule lives in the skill (M9) and the latch that checks it lives in a hook (M8).

- [ ] **Step 2: Write the failing tests**

```
resume.round-trip     open a thread, park it, resume it, park it AGAIN, and assert the second park
                      succeeds and returns a changed-set naming the released pointer
resume.idempotent     resume twice; assert no error and exactly one pointer file
resume.is-one-call    a spawned client performs a complete resume with exactly ONE tools/call;
                      asserted by counting requests on the transport, not by reading the source
resume.unknown-thread a resume for an id with no record refuses, naming the id, retryable false
```

`resume.is-one-call` is A4. Today resuming is three chained calls, which is exactly what the user saw collapse into "Called 3 times" (§7.3), and counting the calls is the only assertion that cannot be satisfied by a wrapper that still chains internally.

- [ ] **Step 3: Implement**

One handler: reconcile, `writePointer`, `renderBriefing`, return. No preparatory call, no index rebuild the caller must remember, no separate reconcile tool. `resume_thread` is idempotent because §6.4 makes writing the pointer idempotent.

- [ ] **Step 4: Run to green and commit**

```bash
git add rebuild/src/server/tools/resume-thread.ts
git commit -m "feat(rebuild): resume a thread and return its briefing in one call"
```

---

## Task 4: `park_thread` and crash detection

**Files:** `rebuild/src/server/tools/park-thread.ts`, `rebuild/test/spawn/resume.test.ts`

`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: **true**`.

- [ ] **Step 1: Write the description**

> Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the six running-summary fields, and releases the record of what is being worked. Takes the session's outcome as text plus whichever summary fields changed; the thread id is optional because the machine already knows which thread is being worked. Parking a thread that is already parked is not an error. The thread stays open — parking is not closing, and a parked thread appears in the next session's roster.

- [ ] **Step 2: Write the failing tests**

```
park.is-one-call            one tools/call performs log, spine refresh and release
park.twice-succeeds         parking an already-parked thread returns ok with an empty changed-set
handoff.detects-crash       write a pointer, discard the process without parking, start a fresh
                            server, and assert the session-start report names the thread as
                            left open by a previous session
park.refreshes-the-spine    after parking, last_session and next_step hold what the call supplied,
                            and the other four spine fields are unchanged
```

`handoff.detects-crash` proves §6.4's claim that crash detection stays trivial: a pointer naming a thread at session start means a previous session ended without parking. It is trivial only because there is no stored `active` to disagree with the pointer.

- [ ] **Step 3: Implement, run to green**

- [ ] **Step 4: Run the inertness mutation and record it**

Replace `writePointer` in `resume-thread.ts` with a no-op. Confirm `resume.round-trip` turns red **at the second park**. Restore.

- [ ] **Step 5: Commit and open the pull request**

```bash
git add rebuild/src/server/tools/park-thread.ts rebuild/test/spawn/resume.test.ts
git commit -m "feat(rebuild): park a thread in one call and detect an unparked crash"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m5-resume-and-park --base main \
  --title "fix(threads): let a resumed thread be handed off again" \
  --what "A thread that was picked up in an earlier session can now be handed off at the end of the next one." \
  --what "Picking up a thread and putting it down are each a single call instead of a chain of three." \
  --why "Every thread resumed after its first session became permanently stuck, because what marks a thread as being worked was set once and never restored." \
  --verified "resume round trip with a second park - passing" \
  --verified "inertness mutation removing the pointer write - the second park turned red" \
  --not-verified "behaviour of the installed plugin - unchanged by design, the new tree is not loaded"
```
