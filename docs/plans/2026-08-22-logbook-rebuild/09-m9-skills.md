# M9 — Skills

**Depends on:** M8. **Must not run in parallel with M5** — both touch the preflight surface (§13.3).

**Ships:** `preflight` and `debrief` as pure orchestration, holding no rules.

**Read first:** SPEC §9, §1.3 root cause E3, §11.5's cross-boundary table.

This is the direct repair of root cause E3. The lifecycle's most important transition currently lives in a Markdown `allowed-tools` list: the resume skill is permitted only four read-side tools, so the transition it needs is not merely unused, it is **forbidden**. Editing a Markdown file silently disabled resume, and no test caught it because no code was wrong.

---

## Premise checks

- [ ] **P1. M8 is merged and green on `main`.**
- [ ] **P2. M5 is merged.** These two units must not be in flight together; confirm no open pull request touches `resume-thread.ts` or `park-thread.ts`.
- [ ] **P3. `resume_thread` performs the pointer write itself.** Read `rebuild/src/server/tools/resume-thread.ts`. If the skill would have to perform the transition, the E3 repair has not landed and this unit is re-planned rather than worked around.
- [ ] **P4. The current preflight skill's `allowed-tools` omits the transition.** `grep -n 'allowed-tools' skills/preflight/SKILL.md`. Confirm the defect exists before claiming to have removed it.
- [ ] **P5. A live tool listing is obtainable in a test.** M3's `spawnServer` plus `tools/list` — Task 2's contract test depends on it.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | Every tool name and argument a skill references exists in a live listing and its schema | `contract.skill-references-exist` passes as a census |
| A2 | Neither skill holds a rule | `contract.skills-hold-no-rules` passes as a census |
| A3 | `preflight` presents and stops | `skill.preflight-presents-and-stops` passes |
| A4 | Neither skill can strand a thread | `skill.cannot-strand` passes |

**Red on the parent commit:** `contract.skill-references-exist`.

**Inertness mutation:** in `rebuild/skills/preflight/SKILL.md`, rename one referenced tool to a name no server registers. `contract.skill-references-exist` must turn red. This is the exact failure that no test caught in the current build.

---

## Files

**Create:** `rebuild/skills/preflight/SKILL.md`, `rebuild/skills/debrief/SKILL.md`; `rebuild/test/contract/skills.test.ts`.

---

## Task 1: Write the two skills

**Files:** `rebuild/skills/preflight/SKILL.md`, `rebuild/skills/debrief/SKILL.md`

They orchestrate; they hold no rules (§9).

- [ ] **Step 1: Write `preflight`**

Its whole content is the sequence: call `list_threads`, present the roster, **wait for the human to choose**, call `resume_thread`, print the returned briefing verbatim, stop.

**Never auto-select a thread** by recency, by modification time, or by branch. Present and stop.

There is no `allowed-tools` list that can forbid what the skill needs, because the skill needs exactly the two tools it names and the transition is performed inside `resume_thread`. Neither skill can strand a thread, because `resume_thread` performs the pointer write itself and `park_thread` releases it (§9).

- [ ] **Step 2: Write `debrief`**

Its whole content: gather the session's outcome, call `park_thread`. Nothing about the done gate, nothing about caps, nothing about which transitions are legal. **The rules are in the server**, and a rule restated in a skill is a rule that can drift from the one that is enforced.

- [ ] **Step 3: Commit**

```bash
git add rebuild/skills
git commit -m "feat(rebuild): orchestrate preflight and debrief without holding any rule"
```

---

## Task 2: The cross-boundary census

**Files:** `rebuild/test/contract/skills.test.ts`

- [ ] **Step 1: Write the failing census `contract.skill-references-exist`**

Parse both `SKILL.md` files for every token matching a tool-name shape and every token matching an argument reference. For each tool name, assert it appears in a **live listing** from a spawned server. For each argument, assert it appears in that tool's published input schema. A token the parser cannot classify as either a tool name, an argument, or ordinary prose **halts the census**.

This is the test whose absence let a Markdown edit silently disable resume. It runs against a live listing rather than a literal list for the same reason M8's matcher test does: a literal list is a change-detector.

- [ ] **Step 2: Write the failing census `contract.skills-hold-no-rules`**

Classify every imperative sentence in both files as either an **orchestration step** (call a named tool, present something, wait, print, stop) or a **rule** (a constraint on data, a transition condition, a limit, a gate). Assert zero rules. Any sentence the classifier cannot place halts the census.

A classifier this blunt will halt often at first. That is the point: each halt is a sentence someone must look at and either rewrite as a step or move into the server. A census that never halts is not doing anything.

- [ ] **Step 3: Write the behavioural tests**

```
skill.preflight-presents-and-stops   the documented sequence contains no step after printing the
                                     briefing, and contains an explicit wait before resume_thread
skill.cannot-strand                  following the documented preflight sequence and then the
                                     documented debrief sequence against a spawned server leaves
                                     no pointer set; following preflight alone leaves exactly one
```

`skill.cannot-strand` is the behavioural form of §9's claim, driven through the real server rather than read off the Markdown.

- [ ] **Step 4: Run to green**

- [ ] **Step 5: Run the inertness mutation and record it**

Rename a referenced tool in `preflight/SKILL.md` to a name no server registers; confirm `contract.skill-references-exist` turns red; restore.

- [ ] **Step 6: Commit and open the pull request**

```bash
git add rebuild/test/contract/skills.test.ts
git commit -m "test(rebuild): fail the build when a skill names a tool the server does not serve"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m9-skills --base main \
  --title "refactor(skills): move every rule out of the skill files into the server" \
  --what "The two skill files now only say which call to make and when to stop, and hold no rule of their own." \
  --what "A skill that names a tool or an argument the server does not serve now fails the build." \
  --why "The most important step of resuming a thread was permitted by a list in a Markdown file, so editing that file disabled resume and no test could catch it." \
  --verified "skill reference census against a live tool listing - every name and argument resolves" \
  --verified "inertness mutation renaming a referenced tool - census turned red" \
  --not-verified "whether the model chooses to invoke a skill - unmeasurable until the evaluation harness opens"
```
