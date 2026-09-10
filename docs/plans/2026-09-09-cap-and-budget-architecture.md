# Cap and Budget Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate write-time caps from render-time limits, give each its own rule, fix six shipped defects the audit found, and record why every remaining number is the number it is.

**Architecture:** A write-time cap survives as a hard refusal only if it records an external fact, breaks rather than costs, forces a decision, or is the only bound on its field. Everything else is removed, and the whole-record byte cap becomes the bound. Render-time limits become floors — a guaranteed minimum per field — rather than ceilings. A register under `docs/registers/` records every limit's value and reason, checked by a census whose population comes from a source scan rather than one file's export list.

**Tech Stack:** TypeScript run directly by Node via type stripping (no build step), Zod schemas, `node:test`, git-native storage on a dedicated ref, MCP server over the `@modelcontextprotocol/sdk`.

**Spec:** `docs/specs/2026-09-09-cap-and-budget-architecture.md`

## Global Constraints

- **Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository; installing rewrites tracked files and turns the suite red.
- **No code comments, ever.** No explanatory comments, no docstrings, no JSDoc prose. Tooling pragmas and shebangs are permitted only where functionally required.
- **No emojis** in code, commits, plans, docs or UI.
- **Merge, never rebase.** A rebase onto a moved `main` has already orphaned a tip in this repository once.
- **One pull request per shippable unit**, opened only through `node ~/.claude/lib/git/pr.mjs pr-create`. Ad-hoc `gh pr create` is denied at the gate.
- **Every fix ships an acceptance test that is red on the parent commit and green on the fix**, asserting the reported symptom rather than a proxy for it. Prove it by checking the test out onto the parent and watching it fail.
- **Every fix ships an inertness mutation.** Revert or empty the thing the fix added; the assertion must turn red. A test that survives that mutation is not testing the fix.
- **Target roughly 200 lines per reviewable change**, 400 as a hard ceiling.
- Verification is diff-scoped: `node --test <the files you touched>`. Run `npm test` once before opening the pull request.

---

## How this plan is decomposed

Ten shippable units. Each is one pull request. Each leaves the application working when merged alone, and each is revertible without touching its neighbours.

| Unit | Ships | Depends on |
|---|---|---|
| MSP 1 | The stop-gate stops misfiring (C2, C3) | nothing |
| MSP 2 | Line breaks render as line breaks (C1) | nothing |
| MSP 3 | Header fields capped after escaping (C5) | nothing |
| MSP 4 | The dead copy of the briefing is deleted (C4) | nothing |
| MSP 5 | Two false documented behaviours corrected (C6) | nothing |
| MSP 6 | The limits register and its census (C11, C12) | nothing |
| MSP 7 | Write-time caps classified and relaxed (C7, C8) | MSP 6 |
| MSP 8 | Render limits become floors (C9) | MSP 6 |
| MSP 9 | Session log: newest whole, older as headlines (C10) | MSP 2, MSP 8 |
| MSP 10 | Record whether a session had to go back (C13) | nothing |

**Order matters in exactly three places.** MSP 9 needs MSP 2, because until line breaks are real, an entry has one line and "first line" means the whole entry. MSP 7 and MSP 8 need MSP 6, so every number they change ships with its reason recorded rather than becoming a second generation of unexplained values. Everything else can ship in any order.

---

## MSP 1 — The stop-gate stops misfiring

**What ships.** A session that ends before a briefing exists no longer marks itself as checked. The hook's own block message is no longer silently truncated.

**Why merging this alone is safe.** Both changes are inside the hook that gates session end. Nothing reads their internal state but the hook itself. The failure mode today is a false block; after this change it is fewer blocks, never more.

**What proves it.** An acceptance test drives four stop events in the sequence that produced the live failure and asserts the fourth is silent, plus a test asserting the block message contains the briefing's final line. Both are red on the parent commit.

**The symptom being fixed, in one sentence.** The gate demanded a briefing be reproduced verbatim nineteen hours after it had already been reproduced, because it recorded "checked" against an empty transcript eleven seconds before the briefing existed.

### Task 1.1: The latch is written after the check, not before

**Files:**
- Modify: `src/hooklib/stop-gate.ts:56-72` — read this function in full before editing
- Modify: `test/hooks/stop-gate-store-shape.test.ts:39-43` — this test currently pins the defect
- Test: `test/hooks/stop-gate-latch-order.test.ts` (create)

**Interfaces:**
- Consumes: `verbatimEchoVerdict` as it exists today; `findLastResumeBriefing` from `src/hooklib/transcript.ts:102-120`
- Produces: no signature change. This is a statement reorder inside one function.

- [ ] **Step 1: Read the function and confirm the ordering defect**

Read `src/hooklib/stop-gate.ts:56-72`. Confirm that the call writing the gate state executes before the early return taken when `findLastResumeBriefing` yields nothing. Write down the two line numbers; the rest of this task depends on them.

- [ ] **Step 2: Write the failing acceptance test**

Create `test/hooks/stop-gate-latch-order.test.ts`. It drives the gate four times against a temporary store with `CLAUDE_PLUGIN_DATA` pointed at a scratch directory, in this exact sequence, which is the sequence that produced the live failure:

1. A stop event for session A, with a transcript containing no `resume_thread` result. Assert the verdict is silent.
2. A transcript is then written containing a `resume_thread` result and an assistant message reproducing its briefing exactly.
3. A stop event for session A again. **Assert the verdict is silent** — the echo is present, so there is nothing to block.
4. A stop event for session B, same transcript. **Assert the verdict is silent** — a new session id must not resurrect a debt that the transcript shows was paid.

Step 4 is the assertion that fails today. Under the current ordering, step 1 writes the latch for session A having checked nothing, and step 4's fresh id re-runs the check for the first time.

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/hooks/stop-gate-latch-order.test.ts`
Expected: FAIL on the step 4 assertion.

- [ ] **Step 4: Move the state write below the early return**

Edit `src/hooklib/stop-gate.ts` so the gate state is written only on a path that actually performed the comparison. Do not change the comparison itself; that is Task 1.2's neighbour, not this one.

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test test/hooks/stop-gate-latch-order.test.ts`
Expected: PASS, all four assertions.

- [ ] **Step 6: Invert the test that pinned the defect**

`test/hooks/stop-gate-store-shape.test.ts:39-43` asserts the latch IS written on a silent verdict. Read it, then rewrite it to assert the opposite: on a silent verdict caused by there being no briefing to check, no gate state is written. Keep every other assertion in that file unchanged.

- [ ] **Step 7: Prove the inertness mutation**

Revert the reorder from step 4, leaving the new test in place. Run `node --test test/hooks/stop-gate-latch-order.test.ts` and confirm it goes red again. Restore the fix.

- [ ] **Step 8: Run the neighbouring suites**

Run: `node --test test/hooks/*.test.ts`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/hooklib/stop-gate.ts test/hooks/stop-gate-latch-order.test.ts test/hooks/stop-gate-store-shape.test.ts
git commit -m "fix(stop-gate): record the verbatim check only after performing it"
```

### Task 1.2: The block message is no longer silently truncated

**Files:**
- Modify: `hooks/lib/io.ts:49` — read `:26-50` in full before editing
- Test: `test/hooks/stop-gate-block-reason-length.test.ts` (create)

**Interfaces:**
- Consumes: `clipGraphemes`, and `MAX_FIELD_GRAPHEMES` at `hooks/lib/io.ts:7`
- Produces: no signature change.

- [ ] **Step 1: Read the clip site and record the numbers**

Read `hooks/lib/io.ts:26-50`. Note that the clip helper used at `:49` appends no marker, and that `BANNER_MAX_GRAPHEMES` at `src/cli/session-start.ts:12` is deliberately equal to `MAX_FIELD_GRAPHEMES` so the banner clips itself first. **Whatever you change here, that equality must hold or be deliberately broken with a recorded reason.**

- [ ] **Step 2: Write the failing acceptance test**

Create `test/hooks/stop-gate-block-reason-length.test.ts`. Build a thread whose briefing renders to more than 10,000 characters, drive a stop event that blocks on it, and capture the hook's stderr.

Assert: **the emitted block message contains the briefing's final line.** That is the symptom — a reader is told to reproduce a text they were not given in full.

Do not assert a length. A length assertion passes for the wrong reason if the message is truncated somewhere else.

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/hooks/stop-gate-block-reason-length.test.ts`
Expected: FAIL — the final line is absent.

- [ ] **Step 4: Choose and apply one of two fixes**

Either raise the limit above the briefing budget, or append the same shortening marker every other surface in this codebase uses. **Prefer raising it.** A marker on this surface is honest but useless: a truncated demand for a verbatim reproduction is unsatisfiable either way. Record which you chose and why in the commit body.

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test test/hooks/stop-gate-block-reason-length.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the inertness mutation**

Restore the old limit. Confirm the test goes red. Restore the fix.

- [ ] **Step 7: Confirm the banner equality still holds**

Run: `node --test test/unit/session-start.test.ts`
Expected: PASS. If it fails, the banner's own limit needs the same treatment in this commit.

- [ ] **Step 8: Commit**

```bash
git add hooks/lib/io.ts test/hooks/stop-gate-block-reason-length.test.ts
git commit -m "fix(hooks): stop silently truncating the message that demands a verbatim echo"
```

### Task 1.3: Open the pull request

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: the same pass count as on `main`, plus the two new tests.

- [ ] **Step 2: Open it**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/stop-gate-misfires --base main \
  --title "fix(stop-gate): stop demanding a briefing that was already given" \
  --what "A session that ends before a briefing exists no longer records itself as checked, so a later session cannot be blocked for a debt the record shows was paid." \
  --what "The message demanding a verbatim reproduction is no longer silently cut short of the text it demands." \
  --why "The gate recorded its verdict before performing the check, so a stop event arriving eleven seconds before the briefing marked the session satisfied having examined nothing. A session fork nineteen hours later invalidated that mark and ran the check for the first time, blocking work." \
  --why "The block message was truncated at ten thousand characters with no marker. The largest briefing in the live store produces a message three hundred and five characters below that line." \
  --risk "The block message may now be longer than before, which costs context on a path that only runs when the gate blocks." \
  --verified "node --test test/hooks - all pass" \
  --verified "acceptance test red on parent commit, green on this change - confirmed by checkout" \
  --not-verified "behaviour under a third concurrent session id - not exercised"
```

---

## MSP 2 — Line breaks render as line breaks

**What ships.** A paragraph break in a stored session summary arrives in the briefing as a paragraph break, not as the six-character token `U+000A`.

**Why merging this alone is safe.** The change affects how stored text is rendered, not what is stored. No record changes. The verbatim-echo gate compares a briefing to its own reproduction within one session, so both sides change together.

**What proves it.** A stored value with two line breaks renders with two real line breaks and no escape token, and a stored line break followed by a heading marker does not produce a line beginning with one. The forgery suite's line-count and line-start-marker inertness helpers stay green.

**The symptom being fixed.** A two-paragraph session summary arrives as one unbroken wall of text studded with escape tokens, costing six characters per line break and removing the structure a reader would use to skim.

### Task 2.1: Permit a line break without permitting forged structure

**Files:**
- Modify: `src/render/escape.ts:22-42` — read the whole module before editing
- Test: `test/unit/escape-newline.test.ts` (create)
- Check: `test/spawn/forgery.test.ts` — do not edit; it must stay green

**Interfaces:**
- Consumes: `escapeStored` and `toEscaped` as they exist today
- Produces: `escapeStored` keeps its signature. Its output changes for inputs containing line breaks and for nothing else.

- [ ] **Step 1: Read the escape module and enumerate what it protects against**

Read `src/render/escape.ts` in full, and `src/render/escape.ts:10` where the indent threshold lives. Write down every class of character it currently escapes and why. **This is the one task in this plan where the reason for the existing behaviour matters more than the behaviour.**

- [ ] **Step 2: Read the forgery tests before writing anything**

Read `test/spawn/forgery.test.ts:358-409`. Two helpers there define what "inert" means in this codebase: a hostile render and a control render must produce the same line count and the same sequence of line-start markers, and exactly one rendered line may carry a payload. **A newline that a stored value can introduce changes the line count. That is precisely what those helpers detect.** Understand this before proceeding; it is the reason this task is not a one-line change.

- [ ] **Step 3: Write the failing behaviour test**

Create `test/unit/escape-newline.test.ts` with two assertions.

First: a stored value containing two line breaks between prose renders with two real line breaks and no `U+000A` token.

Second, and this is the one that constrains the implementation: a stored value containing a line break followed by `## ` renders without producing a line that begins with a heading marker. State the expected output exactly.

- [ ] **Step 4: Run it and watch it fail**

Run: `node --test test/unit/escape-newline.test.ts`
Expected: FAIL on the first assertion — the token is present.

- [ ] **Step 5: Implement**

Permit a line break, and neutralise whatever follows it that would forge structure. The mechanism is your choice; the two assertions from step 3 define correctness. Do not widen the change to any other character class.

- [ ] **Step 6: Run it and watch it pass**

Run: `node --test test/unit/escape-newline.test.ts`
Expected: PASS, both assertions.

- [ ] **Step 7: Run the forgery suite, which is the real gate**

Run: `node --test test/spawn/forgery.test.ts`
Expected: PASS. **If any test here fails, stop.** A failure means a stored value can now change the shape of the page, which is worse than the defect being fixed.

- [ ] **Step 8: Run the render census**

Run: `node --test test/contract/render-census.test.ts`
Expected: PASS. This census requires every interpolated stored value in the render path to resolve statically to one of three helpers; a new helper halts it.

- [ ] **Step 9: Prove the inertness mutation**

Restore the old escaping. Confirm `test/unit/escape-newline.test.ts` goes red. Restore the fix.

- [ ] **Step 10: Commit**

```bash
git add src/render/escape.ts test/unit/escape-newline.test.ts
git commit -m "fix(render): render a stored line break as a line break"
```

### Task 2.2: Update the goldens and open the pull request

- [ ] **Step 1: Run the briefing suite and read every failure**

Run: `node --test test/unit/briefing.test.ts`
Expected: byte-exact goldens at `:99` and `:233` may fail if their fixtures contain line breaks. **Read each diff before changing a golden.** A golden that changed in a way you cannot explain from this task is a defect, not a stale expectation.

- [ ] **Step 2: Update only the goldens whose diff you can explain**

- [ ] **Step 3: Run the full suite**

Run: `npm test`

- [ ] **Step 4: Open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/render-real-line-breaks --base main \
  --title "fix(render): render a stored line break as a line break" \
  --what "A paragraph break in a stored summary now appears in the briefing as a paragraph break." \
  --what "Six characters of budget per line break are returned to the page." \
  --why "Every line break was rewritten as a six character escape token, so a multi-paragraph summary arrived as one unbroken wall and a reader could not skim it. The same tokens made the verbatim echo gate unsatisfiable for any reader who reproduced the text as prose." \
  --risk "Escaping exists to stop a stored value forging headings or list markers. This change permits a line break, which is the character that makes forging structure possible." \
  --verified "test/spawn/forgery.test.ts - all pass, including the line-count and line-start-marker inertness helpers" \
  --verified "test/contract/render-census.test.ts - pass" \
  --not-verified "rendering under a locale with different grapheme segmentation - not exercised"
```

---

## MSP 3 — Header fields capped after escaping

**What ships.** Each of the six briefing header fields is capped at 500 characters measured after escaping.

**Why merging this alone is safe.** Measured lossless on every thread in the live store: the largest header field anywhere is 486 characters after escaping, and plain text at the 500-character write cap escapes to exactly 500.

**What proves it.** The known breaching fixture reports within budget, a header filled with plain text at its write caps carries no shortening marker, and every thread in a read-only copy of the live store renders byte-identically before and after.

**The symptom being fixed.** Escaping can expand one stored character into six, so a field satisfying its write cap can occupy 3,000 characters of page. This is the measured cause of the only known case where a briefing exceeds its budget.

### Task 3.1: Cap the six header fields

**Files:**
- Modify: `src/render/briefing.ts` at `:176-177`, `:361`, `:373`, `:379`, `:384`, `:388`
- Test: `test/unit/briefing-header-cap.test.ts` (create)

**Interfaces:**
- Consumes: `escapeStored`, `clipWithMarker` from `src/render/clip.ts`
- Produces: no signature change to `renderBriefing`.

- [ ] **Step 1: Confirm all six sites**

Read each of the six lines. Confirm each renders through `escapeStored` with no clip argument. **`:379` is the legacy `spine.last_session` path and is easy to miss — it is the field the breaching fixture exercises.**

- [ ] **Step 2: Write the failing acceptance test**

Create `test/unit/briefing-header-cap.test.ts`.

First assertion, the symptom: render `test/support/briefing-over-budget-fixture.ts` and assert `withinBudget` is true. It is false today.

Second assertion, the losslessness claim this change rests on: build a thread with all six header fields filled with plain ASCII at their write caps, render it, and assert **no header field carries the shortening marker.**

- [ ] **Step 3: Run it and watch the first assertion fail**

Run: `node --test test/unit/briefing-header-cap.test.ts`
Expected: FAIL on `withinBudget`.

- [ ] **Step 4: Implement**

Apply a 500-character post-escape cap at each of the six sites, using the existing clip helper so the marker behaviour matches every other surface.

- [ ] **Step 5: Run it and watch both assertions pass**

Run: `node --test test/unit/briefing-header-cap.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm no live thread changed**

Write a throwaway script under the scratchpad that renders every thread in a **copy** of the live store before and after, and diff the two. Expected: byte-identical on every thread. **Never write to the real store.** Report the copy's timestamp in the commit body; the store is written by ongoing sessions.

- [ ] **Step 7: Prove the inertness mutation**

Remove the cap. Confirm the `withinBudget` assertion goes red. Restore.

- [ ] **Step 8: Run the briefing suites**

Run: `node --test test/unit/briefing.test.ts test/unit/briefing-hides-nothing.test.ts test/contract/resume-payload-envelope.test.ts`
Expected: all pass.

- [ ] **Step 9: Commit and open the pull request**

```bash
git add src/render/briefing.ts test/unit/briefing-header-cap.test.ts
git commit -m "fix(render): cap each header field after escaping"

node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/header-post-escape-cap --base main \
  --title "fix(render): cap each briefing header field after escaping" \
  --what "A briefing whose header expands under escaping now fits its budget instead of exceeding it and reporting success." \
  --why "Escaping can turn one stored character into six, so a field that satisfies its five hundred character write cap could occupy three thousand characters of page. Six header fields had no limit at all on the rendered side, and were the only measured cause of a briefing exceeding its budget." \
  --verified "the over-budget fixture goes from thirteen thousand eight hundred and forty six characters breaching to three thousand one hundred and forty six fitting" \
  --verified "every thread in a read-only copy of the live store renders byte-identically before and after" \
  --not-verified "behaviour when a header field is entirely astral-plane characters - not exercised"
```

---

## MSP 4 — The dead copy of the briefing is deleted

**What ships.** `resume_thread` returns the briefing once instead of twice.

**Why merging this alone is safe.** The removed copy is discarded by the client before it reaches the transcript. Measured: 979 of 984 tests pass with it emptied, and the four failures are in one prompt-injection file, none of which asserts that the text block carries the briefing.

**The trap that makes this one change and not two.** `test/contract/resume-payload-envelope.test.ts:119-125` asserts only that the size prediction is not too low. Removing the copy without changing the count leaves it green while the budget over-predicts by half, silently wasting the space just freed.

**What proves it.** A two-sided assertion that the predicted payload size is within tolerance of the actual size, which fails if the copy is removed without the count or the count without the copy. Plus the full suite at the same pass count as the default branch.

### Task 4.1: Remove the text copy and correct the count atomically

**Files:**
- Modify: `src/server/tools/resume_thread.ts:104` (the text copy) — read `:100-110` first
- Modify: `src/render/briefing.ts:23` — `BRIEFING_COPIES_IN_RESUME_PAYLOAD`, 2 becomes 1
- Modify: `test/spawn/forgery.test.ts:234-239, 301-304, 331-338` — the only consumer of the text copy
- Test: `test/contract/resume-payload-single-copy.test.ts` (create)

**Interfaces:**
- Consumes: `toolOk` at `src/server/errors.ts:37-40`
- Produces: **the structured reply is unchanged.** Do not touch `structuredContent`. The tool declares an output schema, the protocol requires a conforming structured result, and the SDK throws without one at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:196-206`. Removing it fails thirteen tests across three directories.

- [ ] **Step 1: Write the failing test that catches the trap**

Create `test/contract/resume-payload-single-copy.test.ts`. Render a briefing of known length, build the reply, and assert the predicted payload size is within a stated tolerance of the actual serialised size — **a two-sided assertion, not the one-sided one that ships today.**

That two-sided form is what turns red if the count and the reality disagree in either direction.

- [ ] **Step 2: Run it and confirm it passes today**

Run: `node --test test/contract/resume-payload-single-copy.test.ts`
Expected: PASS. Today the count and reality agree at two copies. This test exists to fail in step 4 if you change one without the other.

- [ ] **Step 3: Remove the text copy**

Edit `src/server/tools/resume_thread.ts` so the reply's text content no longer carries the briefing. Leave `structuredContent` exactly as it is.

- [ ] **Step 4: Run the new test and watch it fail**

Run: `node --test test/contract/resume-payload-single-copy.test.ts`
Expected: FAIL — prediction is now roughly twice the reality. **This failure is the point of the task.**

- [ ] **Step 5: Correct the count**

Set `BRIEFING_COPIES_IN_RESUME_PAYLOAD` to 1 at `src/render/briefing.ts:23`.

- [ ] **Step 6: Run it and watch it pass**

Run: `node --test test/contract/resume-payload-single-copy.test.ts`
Expected: PASS.

- [ ] **Step 7: Repair the four forgery tests**

`test/spawn/forgery.test.ts` reads `result.content[0]` at `:234-239` and uses it at `:301-304` and `:331-338`. Those tests are about prompt injection, not about which slot carries the briefing. **Repoint them at the structured briefing.** Two of the four currently fail by their own control precondition, and their messages say so; read those messages before changing anything.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: the same pass count as on `main`.

- [ ] **Step 9: Prove the inertness mutation**

Restore the text copy while leaving the count at 1. Confirm the new test goes red in the opposite direction. Restore.

- [ ] **Step 10: Commit and open the pull request**

```bash
git add src/server/tools/resume_thread.ts src/render/briefing.ts test/spawn/forgery.test.ts test/contract/resume-payload-single-copy.test.ts
git commit -m "fix(resume): return the briefing once, not twice"

node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/single-briefing-copy --base main \
  --title "fix(resume): return the briefing once rather than twice" \
  --what "The reply carries the briefing once. Roughly two point seven percent more briefing fits in the same budget." \
  --what "The payload size prediction is now checked in both directions, so a future change that makes it too generous fails instead of passing quietly." \
  --why "The reply carried the briefing twice and the client discarded one copy before it reached the transcript. The existing size check only asserted the prediction was not too low, so removing a copy would have left it green while wasting half the freed space." \
  --risk "The prompt injection tests inspected the removed slot and were repointed. They test injection, not transport, but they are the only coverage that slot had." \
  --verified "full suite - same pass count as main" \
  --verified "prediction within tolerance of actual in both directions" \
  --not-verified "behaviour against an MCP client that reads the text slot rather than the structured one - only one client was observed"
```

---

## MSP 5 — Two false documented behaviours corrected

**What ships.** The continuity rule document stops asserting two things that are not true of the shipped code.

**Why merging this alone is safe.** Documentation only. No code path changes.

**What proves it.** Each corrected claim is checked against a cited call site or a cited test that contradicts it, named in the commit body. There is no automated check on this prose today, which is why the claims drifted.

### Task 5.1: Correct the in-repository copy

**Files:**
- Modify: `docs/rules/continuity-ledger.md:186-194`
- Test: `test/contract/continuity-rule-census.test.ts` — read it; it currently classifies backticked tool names only

- [ ] **Step 1: Confirm both claims are false against the code**

Claim one: "Every size cap is enforced by refusing the whole call. Nothing is shortened." Confirm at least three shortening call sites, starting with `src/render/briefing.ts:85`, `src/render/roster.ts:91`, `hooks/lib/io.ts:49`.

Claim two: the whole-record refusal "is reported without naming which field overflowed and without naming the number." Read `src/server/tool-support.ts:115-125` and `test/store/whole-record-cap.test.ts:80-119`, which asserts it names the field, the observed bytes and the cap.

- [ ] **Step 2: Rewrite both passages to describe what ships**

State plainly that most caps refuse but several surfaces shorten with a marker, and that the whole-record refusal names its heaviest field and both numbers on the paths that pre-check, while two paths surface an unnamed root refusal. **Name which paths, so a reader can tell which they hit.**

- [ ] **Step 3: Commit and open the pull request**

```bash
git add docs/rules/continuity-ledger.md
git commit -m "docs(rules): describe cap behaviour as it actually ships"
```

### Task 5.2: Correct the global copy, in its own repository

**Files:**
- Modify: `/Users/satanshumishra/Documents/DevLabs/.windful-ocean/.claude/rules/common/continuity-ledger.md:183-194`

- [ ] **Step 1: Confirm the same two claims are present there**

- [ ] **Step 2: Check for the three further drifts**

That copy also says there are two skills where there are three, describes the pointer read as dropping a stored `focus` key rather than any undeclared key, and omits the pointer release on thread close. Fix all five things in one change.

- [ ] **Step 3: Open a pull request against that repository**

That repository blocks direct pushes to its default branch. Branch, commit, and open a pull request through the same centralized tool with `--repo` naming that repository. **This rule is loaded into every session on this machine, so the change takes effect for all work the moment it merges.** Say so in the risk field.

---

## MSP 6 — The limits register and its census

**What ships.** A register recording every limit's location, value, basis and reason, and a census that fails when a limit exists with no row or a row disagrees with the live constant.

**Why merging this alone is safe.** Adds a document and a test. Changes no runtime behaviour and no limit value.

**What proves it.** A census that halts naming any limit with no register row, asserts every row's value equals the live constant, and is itself proved capable of halting by a control test. Plus an anti-vacuity guard so an empty sweep cannot pass.

### Task 6.1: Build the register loader and its schema

**Files:**
- Create: `docs/registers/size-limits.json`
- Create: `test/support/limits-register.ts`
- Pattern to follow: `test/unit/disposal-census.test.ts:145-171` loads a JSON register and throws on a malformed row

**Interfaces:**
- Produces: a loader exporting the parsed rows, and a row type with fields `name`, `site`, `value`, `basis`, `reason`, `mirrors`, `mirror_relation`. `basis` is one of `measured`, `derived`, `external`, `chosen`, `unrecorded`. `reason` is a string, or null **only** when `basis` is `unrecorded`.

- [ ] **Step 1: Read the existing register precedent**

Read `docs/registers/` and `test/unit/disposal-census.test.ts:119-171`. Follow that file's loading and halting behaviour rather than inventing one.

- [ ] **Step 2: Write the schema and a test for the null rule**

Assert that a row with `basis: "chosen"` and `reason: null` is refused, and a row with `basis: "unrecorded"` and `reason: null` is accepted. That single rule is what stops the register filling with invented rationales.

- [ ] **Step 3: Run, implement, run**

Run: `node --test test/support/limits-register.test.ts`

- [ ] **Step 4: Commit**

```bash
git commit -m "test(register): add the size-limits register schema and loader"
```

### Task 6.2: Populate the register from a source scan

**Files:**
- Modify: `docs/registers/size-limits.json`
- Create: `test/contract/limits-register-census.test.ts`
- Pattern to follow: `test/support/source-census.ts:43` provides a configured TypeScript program; `test/contract/render-census.test.ts:581` uses it

- [ ] **Step 1: Write the population sweep**

The census population comes from an AST walk of production source, **not** from `Object.keys(caps)`. Deriving it from one file's exports is the circularity that let at least thirty-three limits accumulate elsewhere while a census claimed completeness.

Declare the predicate syntactically and record it in the test's own message: every `export const` in `src/schema/caps.ts`, plus every module-level constant in production source whose name matches a stated pattern and whose initialiser is a numeric literal or arithmetic over literals. **A judgement call inside the predicate is a hole in the census.**

- [ ] **Step 2: Write the three assertions**

Every swept site has a register row, or the census halts naming the site. Every row's `value` equals the live constant. Every row's `basis` and `reason` are consistent with the null rule.

- [ ] **Step 3: Write an anti-vacuity guard and a control test**

Follow the house pattern at `test/unit/caps-census.test.ts:64-67` and `:77-80`: assert the swept population is non-empty, and prove the halt can actually fire.

- [ ] **Step 4: Populate every row**

Write `basis: "unrecorded"` and `reason: null` wherever nothing is known. **Expect roughly sixty such rows. That is the correct output, not a failure.** Do not invent a rationale to fill a cell.

For the six with a recorded derivation, copy the reason and cite its location. They are the whole-record byte cap, the briefing character budget, the resume payload byte budget, the banner grapheme limit, the session first-line entry count, and the last-session render limit.

- [ ] **Step 5: Run the census**

Run: `node --test test/contract/limits-register-census.test.ts`
Expected: PASS with every limit covered.

- [ ] **Step 6: Retire the superseded role table**

`test/unit/caps-census.test.ts:14-57` holds a one-role-per-name table the register supersedes. Remove it and its bijection assertions. **Keep `:169-193`, the refusal-shape assertions, unchanged** — they are still worth having; they simply stop pretending to check a value.

- [ ] **Step 7: Commit**

```bash
git commit -m "test(register): census every size limit against the register"
```

### Task 6.3: Make a duplicated number impossible or loud

**Files:**
- Modify: `src/schema/ids.ts:2` — build the slug pattern from the slug length constant
- Modify: `src/server/tools/resolve_conflict.ts:34,35,36,458` and `src/schema/example.ts:39` — import the identifier pattern rather than restating its length
- Modify: `src/server/tools/log_session_event.ts:17,81`, `src/server/tools/open_thread.ts:207`, `src/server/tools/list_threads.ts:70` — interpolate every number in prose
- Modify: `test/support/published.ts:160,168` — build the pinned phrases the same way

- [ ] **Step 1: Confirm the pattern-source risk before touching the regex**

Three call sites compare a pattern's `.source` as a string: `src/schema/example.ts:38,41,47`, `src/server/resources.ts:74`, and `test/contract/content-rendered.test.ts:46,60`. A pattern built from a template must produce a character-identical `.source`. **Assert that equality in a test before changing the regex**, so the build is red if it differs rather than mysteriously failing elsewhere.

- [ ] **Step 2: Compute the patterns**

- [ ] **Step 3: Interpolate every prose number**

`src/server/tools/list_threads.ts:21` already interpolates its constant while `:70` hard-codes the same number in the same file. Follow the form already there.

- [ ] **Step 4: Add the AST rule that stops the class returning**

Forbid a bare multi-digit numeric literal inside a description string under `src/server/tools/`. Follow `test/contract/no-literal-identifiers.test.ts` as the template. **Note that that file itself restates the identifier length at `:52` and must be made subject to its own rule.**

- [ ] **Step 5: Run the full suite, then commit and open the pull request**

```bash
npm test
git commit -m "refactor(schema): compute every duplicated limit rather than restating it"

node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head chore/limits-register --base main \
  --title "chore(schema): record every size limit and its reason in one register" \
  --what "Every enforced size limit now has a row recording where it lives, what it is, and why. Roughly sixty rows say the reason was never recorded, which is now visible instead of invisible." \
  --what "Changing a limit fails the build until its recorded reason is updated or the change reverted." \
  --what "Numbers that appeared in two places are computed from one, so they can no longer drift apart in silence." \
  --why "Of roughly ninety two limits, six had a written derivation and about sixty had nothing recorded anywhere. Twenty two sites restated a number defined elsewhere and sixteen could drift with no test turning red. The existing census took its population from one file's export list, so a limit defined anywhere else satisfied it by being invisible." \
  --risk "The register is a second place a value is written. If someone updates it mechanically without re-reading the reason, the reason rots while the census stays green." \
  --verified "full suite - same pass count as main" \
  --verified "census halts on an unregistered constant - proved by a control test" \
  --not-verified "whether the predicate catches a limit named outside its pattern - stated as a known limit of the sweep"
```

---

## MSP 7 — Write-time caps classified and relaxed

**What ships.** Fields recording evidence or narrative stop having their own length limit. Fields stating a decision keep theirs. Separately-stored records get an explicitly chosen bound with headroom.

**Why merging this alone is safe.** Every change only accepts more than before. Nothing that succeeds today starts failing.

**What proves it.** Each relaxed field accepts a value one character over its former cap and stores it verbatim, and a record grown past the byte cap by a relaxed field is still refused with a named field.

**Depends on MSP 6**, so each relaxation is recorded with its reason as it happens.

### Task 7.1: Remove the caps on evidence and narrative fields

**Files:**
- Modify: `src/schema/thread.ts` — criterion result at `:86`, settled_by at `:116`, risk text at `:130`
- Modify: `src/schema/decision.ts:28,34` — context and outcome
- Modify: `docs/registers/size-limits.json` — the same change removes their rows or marks them removed
- Test: `test/unit/caps-relaxed.test.ts` (create)

**Interfaces:**
- Produces: the listed fields accept any length. The whole-record byte cap at `src/schema/caps.ts:48` becomes their only bound.

- [ ] **Step 1: Write the failing test**

Create `test/unit/caps-relaxed.test.ts`. For each relaxed field, assert a value one character over its former cap is accepted and stored verbatim.

**Assert the verbatim part, not just acceptance.** The reason `settled_by` is on this list is that it holds a human's quoted words, and a stored value that is accepted but altered is worse than one refused.

- [ ] **Step 2: Run and watch it fail**

Run: `node --test test/unit/caps-relaxed.test.ts`
Expected: FAIL — each value is refused.

- [ ] **Step 3: Remove the length constraint from each field**

Remove it. Do not raise it. A raised cap is a new arbitrary number.

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Check what the record cap now catches instead**

Write a test asserting that a thread grown past the whole-record byte cap by a relaxed field is still refused, and that the refusal names a field. This is the bound that replaces the ones removed; if it does not fire, this task has removed a limit and put nothing in its place.

- [ ] **Step 6: Read the test that may break**

Read `test/unit/caps.test.ts:34-60`. It asserts an oversized field refuses the whole call and leaves the prior record byte-identical. **Determine which field it exercises.** If that field is one you relaxed, repoint the test at a field that kept its cap — the behaviour it pins is still correct and must stay covered. Do not delete it.

- [ ] **Step 7: Run the full suite, commit**

### Task 7.2: Set the separately-stored bounds with stated headroom

**Files:**
- Modify: `src/schema/caps.ts:46` — session body
- Modify: `docs/registers/size-limits.json`

- [ ] **Step 1: Do not choose the number yourself**

The specification states no number deliberately. Compute a proposal with the arithmetic shown, and **stop for a human ruling** the way the briefing budget was ruled on. A number chosen by an agent and recorded as "chosen" satisfies the register's format while defeating its purpose.

The measurement to show: across twenty-five entries, bodies ran a median of 2,669 characters against a cap of 8,000, largest 7,814. **Present that measurement with its caveat: the sample is selected by the cap, so writers who needed more already trimmed or split and appear as compliant entries or not at all.**

- [ ] **Step 2: Apply the ruled number and record the ruling as the reason**

- [ ] **Step 3: Commit and open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head refactor/write-caps-by-purpose --base main \
  --title "refactor(schema): keep a write cap only where it does work" \
  --what "Pasted evidence, quoted human words, findings and decision reasoning no longer have their own length limit. The record size limit bounds them instead." \
  --what "Fields that state a decision keep their limit, because the shortness is the point rather than a side effect." \
  --why "Two hundred criteria at their own field caps permit roughly eight times what a whole record is allowed to be, so the per-field caps were not bounding the record. One capped field holds a human quote, where shortening corrupts the thing being stored." \
  --risk "More content now reaches the briefing, which must triage it. The render side changes ship separately." \
  --verified "every relaxed field accepts a value over its former cap and stores it verbatim" \
  --verified "a record grown past the byte cap is still refused, naming a field" \
  --not-verified "the effect on real record sizes over time - no thread has been written under the new limits yet"
```

---

## MSP 8 — Render limits become floors

**What ships.** Each renderable field declares a guaranteed minimum character count rather than a maximum. The budget allocates above those floors.

**Why merging this alone is safe.** Every field still renders. No item is hidden.

**What proves it.** Every field renders at or above its declared floor under budget pressure; when the floors cannot all fit, the briefing says so on the page rather than reporting success. The render count against the pinned ceiling is reported, not assumed.

**Depends on MSP 6.**

### Task 8.1: Replace the thirteen ceilings with floors

**Files:**
- Modify: `src/render/briefing.ts:49-61` (the thirteen values), `:220-236` (where they are applied), `:256-270` (the derived search bound)
- Modify: `docs/registers/size-limits.json`
- Test: `test/unit/briefing-floors.test.ts` (create)

- [ ] **Step 1: Read the search and understand what the bound is derived from**

The search's upper bound is computed as the maximum of the thirteen values. **Changing any of them changes the number of full renders.** Measured: raising one to 8,000 takes a pinned fixture from 10 renders to 14 against a ceiling of 11.

- [ ] **Step 2: Write the failing test**

Assert that on a thread where the budget is under pressure, every field renders at least its declared floor. Then assert the over-subscribed case: on a thread where the floors cannot all fit, the briefing renders every field at its floor, reports `withinBudget: false`, **and says so on the page.** Today it goes over budget and reports success.

- [ ] **Step 3: Run, implement, run**

- [ ] **Step 4: Report the new render count**

Run the fixture behind `test/unit/briefing.test.ts:842` and report the count. If it exceeds the pinned ceiling, re-pin it **in this commit** with the new number in the message. Do not raise the ceiling speculatively.

- [ ] **Step 5: Confirm every live thread still renders**

Render every thread in a copy of the store before and after. Report any that changed and why.

- [ ] **Step 6: Commit and open the pull request**

```bash
git add src/render/briefing.ts docs/registers/size-limits.json test/unit/briefing-floors.test.ts
git commit -m "refactor(render): guarantee each field a floor rather than capping it"

node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head refactor/render-floors --base main \
  --title "refactor(render): guarantee each field a floor rather than capping it" \
  --what "Each kind of content in the briefing is now promised a minimum length it will not fall below, instead of forbidden a maximum it may not exceed." \
  --what "A briefing that cannot fit even at every floor now says so on the page and in the reply, instead of exceeding its budget and reporting success." \
  --why "Thirteen hand written maximum lengths capped what each field could show. Three already disagreed with the storage limits they appeared to mirror, and one of those could only be understood by tracing a call chain." \
  --risk "The number of full renders is derived from these values, so this change moves it. The new count is reported and the pinned ceiling re-pinned in the same change." \
  --verified "every field renders at or above its floor under budget pressure" \
  --verified "render count against the pinned ceiling - reported in the commit body" \
  --not-verified "behaviour on a record larger than any in the live store - not exercised"
```

---

## MSP 9 — Session log: newest whole, older as headlines

**What ships.** The newest session entry renders complete. Every older entry renders as its first line with its identifier.

**Why merging this alone is safe.** Nothing is hidden — every entry still appears. No item cap is introduced, so no recorded decision or published promise is amended.

**What proves it.** The newest entry renders with no shortening marker, every older entry renders exactly one line, the hides-nothing census stays green, and on a thread where the newest entry alone exceeds the budget it is the only shortened thing on the page.

**Depends on MSP 2** (until line breaks are real, an entry has one line) **and MSP 8** (the floors are what make "whole" bounded).

### Task 9.1: Render the newest entry whole and older ones as first lines

**Files:**
- Modify: `src/render/briefing.ts:158-159` (`renderSessionEntryLine`), `:377` (where entries are rendered)
- Pattern to follow: `src/server/resource-render.ts:22-23` already renders a 200-character first line per entry
- Test: `test/unit/briefing-session-log.test.ts` (create)

- [ ] **Step 1: Write the failing test with three assertions**

First: with several entries, the newest renders complete and carries no shortening marker.

Second: every older entry renders exactly one line, and that line is the entry's first line.

Third, and this is the one that encodes the rule correctly: on a thread where the newest entry alone exceeds the budget, **the newest entry is shortened and it is the only thing on the page that is shortened.** The rule is a priority, not a guarantee — the newest entry is the last thing shortened, not the thing that can never be shortened.

- [ ] **Step 2: Run, implement, run**

- [ ] **Step 3: Confirm nothing is hidden**

Run: `node --test test/unit/briefing-hides-nothing.test.ts`
Expected: PASS. Every entry must still appear. **If this fails, the implementation has introduced an item cap**, which is what decision B16 removed and what this design exists to avoid.

- [ ] **Step 4: Render the live thread and read the page**

Render the open thread from a copy of the store and read the "Last session" section. **This is a judgement made by looking, not by a total.** Confirm the newest entry is readable end to end and the older lines are scannable.

- [ ] **Step 5: Commit and open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/session-log-newest-whole --base main \
  --title "feat(render): render the newest session entry whole and older ones as headlines" \
  --what "The newest session entry appears complete. Older entries appear as one scannable line each rather than as fragments cut mid sentence." \
  --why "Fourteen entries rendered at exactly five hundred and nineteen characters each, every one announcing a topic and stopping before its finding. A reader could act on none of them." \
  --risk "An older entry whose first line is uninformative now shows nothing useful, where before it showed an uninformative fragment." \
  --verified "nothing is hidden - every entry still renders, hides-nothing census passes" \
  --verified "the newest entry is shortened only when it alone exceeds the budget, and is then the only shortened thing on the page" \
  --not-verified "readability across many real threads - one live thread was read"
```

---

## MSP 10 — Record whether a session had to go back

**What ships.** A signal recording when a session, after consuming a briefing, re-reads a file it already read or repeats a search with unchanged arguments.

**Why merging this alone is safe.** Additive telemetry. Nothing reads it yet.

**What proves it.** A test asserting the signal is emitted for a re-read and for a repeated search, and not emitted for a first read. The definition of a repeat is written into the assertion message so a later reader knows what the number counts.

### Task 10.1: Emit the signal

**Files:**
- Modify: the hook that already writes this project's local event log — find it before designing anything
- Test: create alongside

- [ ] **Step 1: Find the existing event log and follow it**

This project already writes hook events to a local JSONL corpus. **Emit to that, not to the ledger.** The ledger records decisions and work and is read by people and future sessions; this is telemetry about the tool's own effectiveness, it is per-machine, and it is disposable.

- [ ] **Step 2: Define "went back" precisely before implementing**

A re-read of a path already read in the same session after a briefing was consumed, or a search whose arguments match an earlier search in the same session. **Write the definition into the test's own assertion message**, so a later reader knows what the number means.

- [ ] **Step 3: Write the failing test, implement, run**

- [ ] **Step 4: Commit and open the pull request**

```bash
git add . && git commit -m "feat(observability): record when a session re-derives what a briefing supplied"

node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/sufficiency-signal --base main \
  --title "feat(observability): record when a session re-derives what a briefing supplied" \
  --what "A local signal now records when a session, after reading a briefing, re-reads a file it already read or repeats a search with unchanged arguments." \
  --why "Every limit in this project is currently judged by size, and size cannot answer whether the reader had enough. Nothing standardised measures sufficiency, and the two instruments that do each need something a summary of prior work does not have." \
  --risk "The signal is a proxy. A re-read can be legitimate, so a raw count will overstate insufficiency until someone reads a sample and calibrates it." \
  --verified "the signal fires for a re-read and a repeated search, and not for a first read" \
  --not-verified "whether the signal correlates with a briefing actually being insufficient - that is the question it exists to start answering"
```

---

## Self-review of this plan

**Spec coverage.** Every change C1 through C13 maps to a task: C1 to 2.1, C2 to 1.1, C3 to 1.2, C4 to 4.1, C5 to 3.1, C6 to 5.1 and 5.2, C7 to 7.1, C8 to 7.2, C9 to 8.1, C10 to 9.1, C11 to 6.1 and 6.2, C12 to 6.3, C13 to 10.1. No change is unassigned and no task implements something the spec does not state.

**Placeholder scan.** One deliberate absence, flagged rather than hidden: Task 7.2 states no number, because the spec requires a human to rule on it. That is a stated stop, not a gap.

**Type consistency.** The register's row fields are named once in Task 6.1 and used unchanged in 6.2, 7.1, 7.2 and 8.1. `basis` takes the same five values throughout. `BRIEFING_COPIES_IN_RESUME_PAYLOAD` is named identically in Task 4.1 steps 5 and 9.

**One risk this plan carries and cannot remove.** Several tasks say "read the source before editing" rather than showing the current code. That is deliberate: the evidence behind this plan came from agents citing file and line, and inventing implementation code for files nobody in this session opened would look authoritative and mislead. Every task states the symptom, the assertion that catches it, and the command that runs it — the parts that can be stated truthfully.
