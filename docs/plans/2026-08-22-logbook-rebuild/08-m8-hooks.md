# M8 — Hooks

**Depends on:** M5.

**Ships:** six hook events on bindings that match their conditions, the hand-off notice moved to session end, the once-per-session verbatim latch, the write guard, the two fat command-line entry points, and a plugin half under 400 lines.

**Read first:** SPEC §8 (all), §11.5's hook table, §11.9 item 2.

The rule that governs this unit: **state the condition and its natural cadence first, then bind the event whose firing matches it** (§8.1). Where no event matches, add an explicit latch. Every defect in this area came from binding a per-session condition to a per-turn or per-tool-call event.

---

## Premise checks

- [ ] **P1. M5 is merged and green on `main`.**
- [ ] **P2. `SessionEnd` carries an `end_reason` and `SessionStart` carries a `source`.** Capture one of each from a live session's hook input and read the fields. If either is absent, the binding table in Task 1 is re-derived before code is written — the whole unit rests on those two fields.
- [ ] **P3. The current matcher is unanchored.** `grep -n 'mcp__' hooks/hooks.json` shows `mcp__(plugin_logbook_)?ledger__.*` with no anchors. This is the defect Task 4 fixes; confirm it still exists before claiming to fix it.
- [ ] **P4. The plugin half is 1,878 lines today.** `find hooks -name '*.mjs' | xargs wc -l | tail -1`. Record the number. The 400-line gate is measured against the new tree, not this one, but the ratio is what the unit is judged on.
- [ ] **P5. A hook process cannot reach the running MCP server.** Confirm nothing in the harness passes a server address to a hook. This is why the command-line entry point is not deleted (§8.4).

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | Across 10 simulated turns with a thread open, the hand-off notice fires **zero** times; at session end it fires **once** | `handoff.fires-once` passes |
| A2 | Every hook's stdout is pure JSON | `hook.<name>.stdout-pure`, six tests |
| A3 | Every hook exits under half its declared budget against its corpus | `hook.<name>.no-hang`, six tests |
| A4 | A handler that throws produces a non-zero exit and a diagnostic | `hook.<name>.crash-is-visible`, six tests |
| A5 | The write guard covers the plugin-namespaced tool form and is anchored | `contract.hook-matcher-covers-tools` passes |
| A6 | A store reached through a symlink is still guarded; canonicalisation failure refuses | `hook.guard.denies-symlinked-store` passes |
| A7 | Every hook event fixture type-checks against the pinned published hook types | `hook.fixtures.typecheck` passes |
| A8 | The plugin half is under 400 lines | `contract.plugin-half-under-400` passes |
| A9 | `PreCompact` is gone | `hook.precompact-absent` passes |

**Red on the parent commit:** `handoff.fires-once`. §11.5 records the current behaviour as 8 of 8 turns firing.

**Inertness mutation:** in `rebuild/hooks/hooks.json`, move the hand-off notice's binding from `SessionEnd` back to `Stop`. `handoff.fires-once` must turn red on the zero-during-turns assertion, not on the fires-once-at-end assertion.

---

## Files

**Create:** `rebuild/hooks/hooks.json`; `rebuild/hooks/session-start.ts`, `session-end.ts`, `user-prompt-submit.ts`, `pre-tool-use.ts`, `post-tool-use.ts`, `stop.ts`; `rebuild/hooks/lib/io.ts`; `rebuild/src/hooklib/guard.ts`, `resume-intent.ts`, `transcript.ts`; `rebuild/bin/logbook-cli.ts`; `rebuild/src/cli/session-start.ts`, `session-end.ts`; `rebuild/test/hooks/*.test.ts`; `rebuild/test/fixtures/hook-events/*.json`; `rebuild/test/contract/matcher.test.ts`, `plugin-size.test.ts`.

**Modify:** `package.json` — add `rebuild/test/hooks/` to `rebuild:test`.

---

## Task 1: The binding table and the hook contract

**Files:** `rebuild/hooks/hooks.json`, `rebuild/hooks/lib/io.ts`

This is the table, condition first (§8.1):

| Event | Condition it reports | Latch | Can block |
|---|---|---|---|
| `SessionStart` | a session began; `source` distinguishes startup from resume, clear, compact and fork | none | no |
| `UserPromptSubmit` | the user asked to resume; regex-gated | none | yes, unused |
| `PreToolUse` | this call touches the ledger store | none | **yes, used** |
| `PostToolUse` | a project commit happened; gated on the command being commit-shaped | none | no |
| `SessionEnd` | **the session is ending**; `end_reason` distinguishes a resume-termination from a real exit | none | no, and that is correct |
| `Stop` | the briefing was printed verbatim | **once per session, keyed on session id** | yes, used once |

**Removed: `PreCompact`**, whose checkpoints have no reader and whose writer bypasses its own guard (§8.2).

- [ ] **Step 1: Write `lib/io.ts`**

```ts
export type HookVerdict = { block: false; json: object } | { block: true; reason: string }
export const runHook: (name: string, handler: (event: unknown) => HookVerdict) => Promise<never>
```

`runHook` reads one JSON event from stdin, calls the handler, writes **one JSON object and nothing else** to stdout, and exits 0 or 2. The first non-whitespace character of stdout decides how the reply is parsed; a single stray byte silently discards the decision with no error and exit 0 (§8.3). Every diagnostic goes to stderr.

Exit 2 blocks on the events where blocking is supported. Any other non-zero does **not** block, which is why a mistyped script path exits 127 and silently disables a policy gate (§8.3). `runHook` therefore never exits with anything but 0 or 2, and an unexpected throw exits 1 **with a stderr diagnostic** so the failure is at least visible.

Context and message outputs are clipped to 10,000 characters, by grapheme (§10.4).

- [ ] **Step 2: Write the failing contract tests**

For each of the six hooks:

```
hook.<name>.stdout-pure       first non-whitespace character of stdout is "{" and the whole of
                              stdout parses as one JSON object
hook.<name>.no-hang           run against the fixture corpus with a wall clock at HALF the hook's
                              declared timeout; assert it exits. A timed-out hook fails open,
                              silently disabling the gate, so half the budget is the bar
hook.<name>.crash-is-visible  a handler that throws produces a non-zero exit AND a stderr
                              diagnostic, never a silent success
```

- [ ] **Step 3: Write `hooks.json` with the bindings above and commit**

```bash
git add rebuild/hooks/hooks.json rebuild/hooks/lib/io.ts rebuild/test/hooks
git commit -m "feat(rebuild): bind each hook to the event whose cadence matches its condition"
```

---

## Task 2: The fixture corpus and its type gate

**Files:** `rebuild/test/fixtures/hook-events/*.json`, `rebuild/test/hooks/fixtures.test.ts`

- [ ] **Step 1: Capture real payloads**

Capture one payload per event from a live session — not hand-written, not inferred from a name (§2.7). Include, for `SessionStart`, one payload per `source` value observed, and for `SessionEnd`, one per `end_reason` observed.

- [ ] **Step 2: Pin the published hook types alongside the corpus**

Copy the client's published hook event types into `rebuild/test/fixtures/hook-types.d.ts` and record the client version they came from in the fixture directory's own manifest JSON.

- [ ] **Step 3: Write `hook.fixtures.typecheck`**

A test that runs `tsc --noEmit` over a generated file which assigns every fixture to its pinned type. **A fixture that stops type-checking fails the build.**

This is the only available mitigation for §11.9 item 2: no machine-readable schema is published for hook payloads, and the shipped types are de facto normative but never stated to be. The mitigation is pinned types plus live re-capture on every client upgrade, and this test is what makes a drift loud instead of silent. Record it as a standing risk in the pull request, not as a closed item.

- [ ] **Step 4: Commit**

```bash
git add rebuild/test/fixtures rebuild/test/hooks/fixtures.test.ts
git commit -m "test(rebuild): pin hook event fixtures against the published types"
```

---

## Task 3: The hand-off notice moves to session end

**Files:** `rebuild/hooks/session-end.ts`, `rebuild/hooks/stop.ts`, `rebuild/test/hooks/handoff.test.ts`

- [ ] **Step 1: Write the failing test `handoff.fires-once`**

Simulate a session: one `SessionStart`, ten `Stop` events with a thread open and the pointer set, then one `SessionEnd`. Assert the notice fires **zero** times across the ten `Stop` events and **exactly once** at `SessionEnd`. Assert separately that no invocation exits 2.

Then the negative case: with no pointer set, `SessionEnd` fires the notice zero times.

- [ ] **Step 2: Implement**

`Stop` fires when the assistant finishes responding — per turn, not per session. Bound there, the notice fired 8 times in 8 turns while work was plainly in progress, blocking each time with exit 2 and instructing the model to park a thread that was being actively worked (§8.2).

`SessionEnd` cannot block, and **that is correct**: forcing a hand-off mid-work is the defect. A notice that fires 40 times in a 40-turn session is trained into noise, so the one case that matters — a genuinely abandoned thread from a crashed session — is ignored too.

`Stop` keeps one job: the verbatim gate, which genuinely evaluates a turn's output. It is **latched once per session, keyed on session id**, and the latch lives in `state/` alongside the pointer.

The compaction nudge is removed with `PreCompact`. Its condition was transcript file size, which only ever grows, so once true it was true forever; it was observed attaching to every single tool result (§8.2).

- [ ] **Step 3: Write `hook.precompact-absent`**

Assert `PreCompact` appears in no key of `rebuild/hooks/hooks.json` and that no file exists at `rebuild/hooks/pre-compact.ts`.

- [ ] **Step 4: Run to green and commit**

```bash
git add rebuild/hooks/session-end.ts rebuild/hooks/stop.ts rebuild/test/hooks/handoff.test.ts
git commit -m "fix(hooks): raise the hand-off notice once at session end instead of every turn"
```

---

## Task 4: The write guard

**Files:** `rebuild/src/hooklib/guard.ts`, `rebuild/hooks/pre-tool-use.ts`, `rebuild/test/contract/matcher.test.ts`

- [ ] **Step 1: Write the failing tests**

```
contract.hook-matcher-covers-tools   take tool names from a LIVE listing of a spawned server;
                                     assert the matcher fires on every one in its plugin-namespaced
                                     form; assert it does NOT fire on a synthetic tool name that
                                     merely CONTAINS a matching substring, which is what an
                                     unanchored matcher does
hook.guard.denies-symlinked-store    a store reached through a symlink is still denied; a
                                     canonicalisation failure REFUSES rather than narrowing to a
                                     permissive answer
guard.is-in-process                  the guard makes zero subprocesses; asserted with the git call
                                     counter and a spawn counter
```

`contract.hook-matcher-covers-tools` takes its names from a live listing rather than a literal list, because a literal list is a change-detector that goes stale the moment a tool is added.

- [ ] **Step 2: Implement**

The matcher is **anchored** and covers the `mcp__plugin_logbook_ledger__*` form (§8.3). What stays in the plugin is the guard **decision**; what moves to the server side is the ledger-path matching predicate (§8.4).

The guard must be fast enough that its budget is never the thing standing between a caller and the store, because **a hook that times out fails open** (§8.3). That is why it is in-process: today hooks spawn a Node child for work they could call directly while already importing from the same source tree, and about 0.21 s of every session start goes on starting processes the parent could have called as functions (§8.4). TypeScript supplies the type guarantee the subprocess boundary was standing in for.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/hooklib/guard.ts rebuild/hooks/pre-tool-use.ts rebuild/test/contract/matcher.test.ts
git commit -m "feat(hooks): guard ledger writes in process behind an anchored matcher"
```

---

## Task 5: The two fat commands and the size gate

**Files:** `rebuild/bin/logbook-cli.ts`, `rebuild/src/cli/session-start.ts`, `session-end.ts`, `rebuild/hooks/session-start.ts`, `user-prompt-submit.ts`, `post-tool-use.ts`, `rebuild/test/contract/plugin-size.test.ts`

- [ ] **Step 1: Implement the command-line entry point**

**It is not deleted.** A hook process cannot talk to the running MCP server, so a second entry point is structurally required (§8.4). It becomes **fewer, fatter commands** — one for session start, one for session end — rather than the current nine call sites each paying a fresh process start.

`logbook-cli session-start` reads the event on stdin and returns the roster plus any crash report in one reply. `logbook-cli session-end` returns the hand-off verdict.

- [ ] **Step 2: Implement the three remaining hooks**

Each is: read stdin, make one call, translate the answer into a hook verdict (§8.4).

`user-prompt-submit.ts` is regex-gated and makes **zero subprocesses when it does not match**. §8.2 measures the matching path at 46 ms; the non-matching path must not spawn at all.

`post-tool-use.ts` is gated on the command being commit-shaped before it does anything else.

- [ ] **Step 3: Write the failing size gate**

```
contract.plugin-half-under-400   sum the non-blank lines of every file under rebuild/hooks/;
                                 assert the total is under 400
```

Target under 400 lines, which is the gate this unit is held to (§8.4). What moves to the server: roster rendering, resume-intent detection, ledger-root derivation, ledger-path matching, and the git-hook installer. What stays: the guard decision and transcript parsing, because the transcript path is given only to hooks.

- [ ] **Step 4: Run to green, run the inertness mutation, commit**

Move the hand-off binding from `SessionEnd` back to `Stop`; confirm `handoff.fires-once` turns red on the zero-during-turns assertion; restore.

- [ ] **Step 5: Open the pull request**

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m8-hooks --base main \
  --title "fix(hooks): notify once per session instead of once per turn" \
  --what "The hand-off reminder appears once when a session ends, and never interrupts work in progress." \
  --what "The reminder can no longer stop a turn, because being pushed to hand off mid-work was the problem." \
  --why "The reminder was attached to the end of every assistant turn, so it fired eight times in eight turns and blocked each one." \
  --verified "ten simulated turns plus one session end - zero notices during, one at the end" \
  --verified "plugin-side line count - under 400" \
  --not-verified "that the harness sends these exact payloads - no machine-readable schema is published, fixtures are pinned and re-captured"
```
