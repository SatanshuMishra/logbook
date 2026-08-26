# Filed, not fixed — discovered during planning

Items found above an MSP acceptance ceiling. Each carries its evidence and the MSP whose
planning surfaced it. Nothing here is folded into the ladder.


## F7a — `cutover.manifests-agree` hard-codes the version, so EVERY MSP's bump breaks it

- **Surfaced by:** MSP-7 planning
- **Evidence:** `test/contract/cutover-manifests-agree.test.ts:8` reads `const EXPECTED_VERSION = '1.0.0'`. After bumping both manifests to `1.1.0` in a scratch copy of the tree, `node --test test/contract/cutover-manifests-agree.test.ts` failed with `AssertionError [ERR_ASSERTION]: .../package.json version is 1.1.0, expected 1.0.0` and `'1.1.0' !== '1.0.0'`.
- **Why it is above the ceiling:** MSP-7 acceptance criterion 6 (`npm test` green) forces MSP-7 to repair its own instance, so the local repair is in scope. What is above the ceiling is the LADDER-WIDE fact: orchestrator ruling O1 gives all ten MSPs a version bump, so this same test fails for MSP-0 through MSP-9 as well. Which MSP owns the permanent de-pinning is a cross-MSP decision no single planner can settle.
- **Not folded in.**

## F7b — `open_thread` does not echo `predecessor_id` in its output schema

- **Surfaced by:** MSP-7 planning
- **Evidence:** `src/server/tools/open_thread.ts:31-44` defines `OpenThreadOutputSchema` with exactly `thread_id`, `slug`, `status`, `completion_criteria`. Nothing in the suite forces input/output symmetry: `test/spawn/lifecycle.test.ts` validates `structuredContent` against the published output schema in that direction only, and `test/contract/described.test.ts:70-71` censuses `spec.input` alone. Adding the field to the input therefore leaves a caller with no confirmation that the lineage was stored.
- **Why it is above the ceiling:** MSP-7's acceptance criteria 1-6 name the record field, the input field, the refusal, the render section and the I3 guard. None of them names the output schema.
- **Not folded in.**

## F7c — `renderBlockage` is duplicated character-for-character in two renderers

- **Surfaced by:** MSP-7 planning
- **Evidence:** `src/render/briefing.ts:23-24` and `src/render/roster.ts:62-63` are both `const renderBlockage = (blockedBy: string | null): string =>` / `  blockedBy === null ? 'Blockage: none' : ${'`'}Blocked: ${'${'}escapeStored(blockedBy)}${'`'}` — identical text at both sites, read at commit `9f66931`.
- **Why it is above the ceiling:** MSP-7 acceptance criterion 4 governs only that render-census obligations are met by classification. De-duplicating an unrelated existing helper is a refactor no criterion names.
- **Not folded in.**

## F7d — a committed audit probe builds a `Thread` literal that no gate compiles or runs

- **Surfaced by:** MSP-7 planning
- **Evidence:** `docs/audits/2026-08-25-post-cutover-repair-probes/probe-caps.ts:12-16` constructs a full thread record literal and calls `ThreadRecord.parse` at line 54. `tsconfig.json:14` includes only `src/**/*.ts`, `bin/**/*.ts`, `hooks/**/*.ts`, `test/**/*.ts`, and `package.json`'s `test` script globs only `test/**`, so the file is neither typechecked nor run.
- **Why it is above the ceiling:** no MSP-7 criterion covers `docs/`. Recorded because a future REQUIRED thread-record field would silently invalidate this preserved evidence with no gate reporting it.
- **Not folded in.**

## F7e — correction to F7c's evidence line (shell-escaping artifact)

- **Surfaced by:** MSP-7 planning
- **Evidence:** F7c's evidence quotes `renderBlockage` through a mangled shell escape. The correct verbatim text, identical at `src/render/briefing.ts:23-24` and `src/render/roster.ts:62-63` at commit `9f66931`, is a one-expression arrow returning the string `Blockage: none` when `blockedBy === null`, and otherwise a template literal whose head is `Blocked: ` followed by an interpolation of `escapeStored(blockedBy)`. Nothing else about F7c changes.
- **Why it is above the ceiling:** it is a correction to an already-filed item, not new work.
- **Not folded in.**

## F0a — the new UTF-8/NUL census covers three roots; `test/`, `skills/` and `scripts/` stay unscanned

- **Surfaced by:** MSP-0 planning
- **Evidence:** SPEC section 7 MSP-0 criterion 1 names exactly `src/`, `hooks/` and `bin/`. A sweep of the whole tree for NUL bytes and strict-UTF-8 decode failures found the one file already known (`src/server/tools/resolve_conflict.ts`, offset 11234) and nothing else, so nothing is broken today. But `tsconfig.json:14` also compiles `test/**/*.ts`, and `package.json:12` globs six directories under `test/`; a NUL byte introduced into any of those, or into `skills/` or `scripts/`, would make that file binary to `grep` with no census reporting it.
- **Why it is above the ceiling:** MSP-0 acceptance criterion 1 fixes the census population at three named roots. Widening it is a different population and a different criterion.
- **Not folded in.**

## F5a — `hooks/hooks.json` carries a second, uncensused copy of the ledger tool-name shape

- **Surfaced by:** MSP-5 planning
- **Evidence:** `hooks/hooks.json:10` sets the PreToolUse matcher to `"^(Write|Edit|MultiEdit|NotebookEdit|Bash|mcp__(?:plugin_logbook_)?ledger__[A-Za-z][A-Za-z0-9_]*)$"` — the same suffix character class as `src/hooklib/guard.ts:14`, duplicated in a JSON file. MSP-5 adds a `guardApproved` axis to the census at `test/support/published.ts:81-99`, and that axis reads `src/server/tool-names.ts`; nothing reads the matcher. The two can diverge silently, and `node scripts/check-packaging.mjs` checks only the six hook `command` strings (`scripts/check-packaging.mjs:202-226`), never the matcher.
- **Why it is above the ceiling:** MSP-5's six acceptance criteria name the guard module, the names module, the census axis, the inertness mutation, the PR body and `npm test`. None names `hooks/hooks.json`.
- **Not folded in.**

## F5b — a hard link into the store evades the write guard's `deny`, and the README gap list does not say so

- **Surfaced by:** MSP-5 planning
- **Evidence:** running the committed probe `docs/audits/2026-08-25-post-cutover-repair-probes/probe2.mjs` against the current tree prints `silent  | HARDLINK (outside store) -> store file`. `isWithinCanonicalRoot` (`src/hooklib/guard.ts:38-42`) resolves through `realpathSync.native` (`:28`), which resolves symbolic links but has nothing to resolve for a hard link — the canonical path of the outside directory entry *is* the outside path, so a `Write` through it mutates store data and draws no verdict. SPEC section 5 D9 names this: *"the only uncovered vector is a hardlink, which realpath cannot distinguish by design."* The README's five confirmed gaps (`README.md:77-81`) do not list it.
- **Why it is above the ceiling:** MSP-5 criterion 5 requires the README gap list to state that the registry check narrows and does not close the auto-approve surface. Adding a sixth, unrelated gap about path containment is a different edit that no criterion names.
- **Not folded in.**

## F5c — any non-tool module added under `src/server/tools/` halts the registry census

- **Surfaced by:** MSP-5 planning
- **Evidence:** `test/support/published.ts:64-70` enumerates every `.ts` file in `src/server/tools/` and excludes exactly one basename, `index` (`:62,69`). Measured: placing a names-only module at `src/server/tools/names.ts` turned `contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent` red with `census halted on an unclassifiable item: "names"`. MSP-5 routes around this by placing the module at `src/server/tool-names.ts` instead, because invariant I8 forbids answering a halting census with a second excluded basename.
- **Why it is above the ceiling:** MSP-5's criteria are discharged by placing the module outside that directory. Teaching the `files` axis to classify a support module structurally — rather than by name — is a redesign of an existing census that no criterion names. Recorded because every later change that wants a helper next to the tool modules meets the same wall.
- **Not folded in.**

## F1a — `materialiseTree` still skips an unparseable `ls-tree` line in silence

- **Surfaced by:** MSP-1 planning
- **Evidence:** `src/store/read-path.ts:75-76`, read verbatim:
  ```ts
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
  ```
  `parseLsTreeLine` (`src/store/read-path.ts:57-64`) returns `null` when the line carries no tab or no blob id. That `continue` drops the entry with no record and no report, exactly the shape ruling R4 corrects one line lower at `:77-78`.
- **Why it is above the ceiling:** MSP-1 acceptance criterion 1 covers the `ls-tree` failure and ruling R4 clause 1 names only "`:77-78`'s `continue`". Nothing in criteria 1 to 6 reaches this third skip.
- **Not folded in.**

## F1b — `src/merge/sync.ts` discards the materialisation result at three call sites

- **Surfaced by:** MSP-1 planning
- **Evidence:** `git grep -n "syncWorkingCopy(rt, layout)" -- src/merge/sync.ts` returns three lines, `src/merge/sync.ts:239`, `:310` and `:335`, each an expression statement:
  ```ts
    syncWorkingCopy(rt, layout)
  ```
  Once MSP-1 changes `syncWorkingCopy` to return `{ ok: true; materialised: boolean } | { ok: false; detail: string }`, all three continue to compile and all three continue to ignore a failure that `openStore` now refuses on.
- **Why it is above the ceiling:** MSP-1's six acceptance criteria name `src/store/read-path.ts`, `src/store/records.ts`, `src/hooklib/stop-gate.ts` and the two test sentinel sets. `src/merge/sync.ts` is named by MSP-6, and MSP-6's criteria are about the push receipt, not about materialisation failures.
- **Not folded in.**

## F2a — a reader can observe another writer's uncommitted record in the materialised copy

- **Surfaced by:** MSP-2 planning
- **Evidence:** `src/store/write-path.ts:178-181` writes the caller's record into the store before the tree is built and before any compare-and-swap:
  ```ts
    for (const { change, target } of targets) {
      mkdirSync(path.dirname(target), { recursive: true })
      durableWrite(target, contentFor(change), { log: rt.log })
    }
  ```
  `src/store/read-path.ts:90` then short-circuits when the ledger ref has not moved:
  ```ts
    if (currentValue === cached) return
  ```
  So a second process that calls `openStore` while the first is mid-write, and that does not itself move the ref first, reads the first process's uncommitted record out of the materialised copy. `test/store/concurrency.test.ts:209-213` does not catch this: its reader moves the ref before opening, which forces a re-materialisation that erases the in-flight file.
- **Why it is above the ceiling:** MSP-2 acceptance criterion 1 is about a losing compare-and-swap destroying a committed field. This is a read-visibility defect that occurs with no race on the ref at all, and criterion 2 only requires the two named test files to stay green.
- **Not folded in.**

## F6a — a refused sync still gives the caller no sha to reason about

- **Surfaced by:** MSP-6 planning
- **Evidence:** `src/server/tools/sync_ledger.ts:22-46` builds both failure payloads, and neither carries a commit id. `rejectedRefusal` reads:
  ```ts
      message: 'the push to the shared ledger to origin was rejected; retry the call.'
  ```
  Ruling R8 adds `local_sha` and `remote_sha` to `SyncLedgerOutputSchema`, which is the success schema only; `src/server/errors.ts:12-19` shows the refusal payload is a fixed five-field shape with no room for either value.
- **Why it is above the ceiling:** MSP-6 acceptance criterion 2 requires that after a rejected push "the action does not claim `pushed`", which a refusal satisfies by carrying no action at all. Extending the refusal shape to carry the divergence is a change to `src/server/errors.ts` that no MSP-6 criterion reaches.
- **Not folded in.**

## F3a — `park_thread`'s published description is further from the code after MSP-3

- **Surfaced by:** MSP-3 planning
- **Evidence:** `src/server/tools/park_thread.ts:240`, read at planning time, states "Takes the
  outcome as text plus whichever summary fields changed" and "Parking a thread that is already
  parked is not an error". After MSP-3, `outcome` is optional, six branches refuse when it is
  supplied, and a seventh status value `quarantined-pointer-released` exists, so the first sentence
  understates the input contract and the second is true only for the `outcome`-omitted form.
- **Why it is above the ceiling:** SPEC section 7's MSP-3 acceptance list has seven criteria and
  none of them mentions the tool description. SPEC section 5 D14 assigns every published-description
  claim on `park_thread` to MSP-8; this is new material for that MSP, not for MSP-3.
- **Not folded in.**

## F4a — `record_decision`'s published description understates the tool after MSP-4b

- **Surfaced by:** MSP-4 planning
- **Evidence:** `src/server/tools/record_decision.ts:101`, read at planning time, describes a tool
  that "Writes down one decision the moment it is made [...] and returns the new record's id". After
  MSP-4b it also writes the spine link in the same commit, accepts an optional `scope`, and can
  return `linked: false` with a reason. The description mentions none of that.
- **Why it is above the ceiling:** SPEC section 7's MSP-4 acceptance list has eight criteria and
  none mentions the description. SPEC section 5 D14 enumerates four published descriptions that
  state behaviour the code does not implement, and `record_decision`'s is not among them
  (`docs/audits/2026-08-25-post-cutover-repair-probes/cites.txt` lines 475-477 map D14 to
  `park_thread`, `resume_thread`, `list_threads` and `open_thread`), so MSP-8 does not inherit it
  either.
- **Not folded in.**

## F4b — two more byte-cap refusals still name neither the field nor the number

- **Surfaced by:** MSP-4 planning
- **Evidence:** `src/server/tools/park_thread.ts:68-75` and `src/server/tools/close_thread.ts:34-41`
  each carry their own `wholeRecordCapRefusal`, both with the message
  `the thread record after this change failed its stored-shape validation: ${issue}`. MSP-4a repairs
  only the copy in `src/server/tool-support.ts`, which is the single site SPEC section 7 names for
  MSP-4 ("`src/server/tool-support.ts:48-56` so the whole-record cap refusal names the field and the
  observed byte count").
- **Why it is above the ceiling:** MSP-4 acceptance criterion 4 asks for one refusal to name its
  field and byte count, and MSP-4a discharges it at the named site. Repairing two further copies in
  two other files is new surface, and D12's admission under SPEC rule 3.3(a) is scoped to the path
  D1 routes through.
- **Not folded in.**

## F3b — every SPEC line citation into `park_thread.ts` is stale after MSP-3

- **Surfaced by:** MSP-3 planning
- **Evidence:** applying the MSP-3 plan mechanically to a copy of `src/server/tools/park_thread.ts`
  grows it from 275 lines to 376. In the post-change file the `description` string sits at
  `:322-323`, the `annotations` line at `:326` (now reading `idempotentHint: false`, which ruling
  R2 clause 4 required and MSP-3 carried), the `outcome` input field at `:22-29`, and the output
  status enum at `:44-52` with the added value `quarantined-pointer-released`. SPEC section 5 D14
  cites `park_thread.ts:240-243` and `:29-39`; both are stale once MSP-3 merges.
  `src/server/tools/list_threads.ts` is untouched by MSP-3, so `:68-69` still holds.
- **Why it is above the ceiling:** MSP-3's seven acceptance criteria say nothing about published
  descriptions or about line citations in other MSPs' source material. This is material MSP-8's
  planner needs before it reads D14, not work MSP-3 owes.
- **Not folded in.**

## F8a — `list_threads` names a second unreachable capability, "with its state"

- **Surfaced by:** MSP-8 planning
- **Evidence:** `src/server/tools/list_threads.ts:69` says the roster shows the threads
  "each with its state, how far along it is, and the single next action the last session left".
  No `state` or `status` key exists in the reply. `RosterRowSchema`
  (`src/server/tools/list_threads.ts:24-33`) publishes exactly `id`, `slug`, `title`, `blocked_by`,
  `criteria_done`, `criteria_total`, `next_step`, `updated_at`, and the `RosterRow` type
  (`src/render/roster.ts:4-13`) carries the same eight fields. `selectRosterThreads`
  (`src/render/roster.ts:19-23`) filters terminal threads out before the row is built, so a
  per-row lifecycle state is not merely unpublished, it is absent by construction.
- **Why it is above the ceiling:** MSP-8 acceptance criterion 1 scopes its census to capabilities
  "reachable through its published **input** schema". This is a claim about the **output** schema,
  a different population. Scoping the census to the declared population and filing this is not
  narrowing a census — nothing is excluded from the population criterion 1 declares, and no
  allowlist is added.
- **Not folded in.**

## F8b — giving `blocked_by` a writer turns a dead merge rule into a live conflict surface

- **Surfaced by:** MSP-8 planning
- **Evidence:** `src/merge/field-merge.ts:21` sets `blocked_by: 'conflict-on-divergence'`, and
  `:41` and `:242` carry it through the scalar resolution. Until MSP-8 no published tool could set
  the field, so `open_thread.ts:121` wrote `null` on every record and the rule could only ever
  compare two nulls. `test/unit/field-merge.test.ts:235-252`
  (`merge.conflict-on-divergence-field-cleared-to-null-still-conflicts`) already proves that two
  clones holding different `blocked_by` values produce a refused sync that a human must settle
  through `resolve_conflict`. Once `update_thread` can write the field, that path is reachable in
  normal use for the first time.
- **Why it is above the ceiling:** none of MSP-8's four acceptance criteria concerns merge
  behaviour, and the rule, its resolution path and its test all already exist and pass. Whether
  `conflict-on-divergence` is the right rule for a blockage reason — as against `take-later`, which
  `updated_at` uses — is a design question for a separate unit of work.
- **Not folded in.**

## F9a — eight README statements are already false today, for reasons this ladder does not touch

- **Surfaced by:** MSP-9 planning
- **Evidence:** each is quoted verbatim with the line read at authoring time, and the deciding source line beside it.
  1. `README.md:16` — "everything under `src/`, `bin/`, and `hooks/` is a `.ts` file". `hooks/hooks.json` exists and is not a `.ts` file; the same README cites it at `README.md:34`.
  2. `README.md:38` — names three scripts. `git ls-files scripts` returns six: `check-packaging.mjs`, `d6-check.cjs`, `generate-audit-md.mjs`, `githooks/pre-commit`, `install-githooks.mjs`, `pre-commit-typecheck.sh`.
  3. `README.md:42` — the root-file list omits `receipts.config.json`, `package-lock.json` and `.gitignore`, all tracked. `receipts.config.json` is load-bearing; it configures the CI enforcer.
  4. `README.md:50` — "Two things sit under that root". A third is created: `src/store/write-path.ts:31` — `export const writeIndexScratchDir = (layout: StoreLayout): string => path.join(layout.root, 'write-index')`, created at `src/store/write-path.ts:55` and reached from every commit at `:75`.
  5. `README.md:63` — "the ledger's own MCP tools". The matcher is a name pattern, not an identity check: `hooks/hooks.json:11` — `"matcher": "^(Write|Edit|MultiEdit|NotebookEdit|Bash|mcp__(?:plugin_logbook_)?ledger__[A-Za-z][A-Za-z0-9_]*)$"`. Any server keyed `ledger` matches.
  6. `README.md:73` — "repeated in every `ask`/`deny` message it returns". `NOT_A_BOUNDARY` appears at `src/hooklib/guard.ts:103,117,122`, all three `ask`. Neither `deny` message carries it: `src/hooklib/guard.ts:102` and `:110`.
  7. `README.md:78` — "An unresolvable store is a silent store". The code distinguishes two kinds at `src/hooklib/guard.ts:44`; the silent one is `unconfigured` (`:99`), while `unresolvable` is `deny`/`ask` (`:100-104`). The README documents that correctly one table earlier at `README.md:70`, so the gap list contradicts its own table.
  8. `README.md:31-40` — the "What ships" table has no row for `.github/`, which holds two tracked workflows, `rebuild.yml` and `receipts.yml`.
- **Why it is above the ceiling:** SPEC section 7 MSP-9 scopes the README work to "any README correction the ladder has made necessary". None of these eight is made necessary by any of R1-R10; each was already false at `0ade582`. MSP-9 repairs only the five statements the ladder or its own new `docs/rules/` directory falsifies.
- **Not folded in.**

## F9b — the preflight prompt advertises a slug that `resume_thread` refuses

- **Surfaced by:** MSP-9 planning
- **Evidence:** `src/server/prompts.ts:49` declares the prompt argument as `z.string().optional().describe('optionally, the id or slug of the thread already chosen to resume')`, and `src/server/prompts.ts:22` emits `` `Call resume_thread for "${escapeStored(thread)}" and show me the returned briefing verbatim.` ``. But `resume_thread` constrains its input to a ULID: `src/server/tools/resume_thread.ts:10` — `const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)`, applied at `:13`. A slug never matches `ULID_PATTERN`, so the advertised path terminates in a refusal. The MCP *resource* does resolve slugs (`src/server/resources.ts:56-61`), which is what makes the prompt's promise look plausible.
- **Why it is above the ceiling:** this is a defect in shipped code, not a documentation claim. No ruling among R1-R10 addresses it, and MSP-9's four acceptance criteria are all about the replacement document, its tool-name census, the PR body, and `npm test`. Fixing a tool-input contract is outside every one of them.
- **Not folded in.**

## F9c — `src/server/instructions.ts` states park_thread behaviour that ruling R2 falsifies, and no MSP appears to own it

- **Surfaced by:** MSP-9 planning
- **Evidence:** `src/server/instructions.ts:6-7` is the prose the server hands the model at connect time, and it reads in part "park_thread writes the session log, refreshes the running summary, and releases the thread." Ruling R2 makes `park_thread`'s `outcome` optional, and with it omitted the call is a pure pointer release that writes no session log and refreshes no summary. After R2 lands, that sentence describes only one of two legal forms. MSP-8 is titled "Every published description matches the code" and covers published *tool* descriptions; `instructions.ts` is the server-level instruction block, not a tool description, so it may fall between the two.
- **Why it is above the ceiling:** MSP-9's changes are scoped by SPEC section 7 to the replacement rule, the citation convention, and README corrections. `src/server/instructions.ts` is production TypeScript and is none of those.
- **Not folded in.**

## F9d — the continuity-rule census checks one direction only; a newly registered tool can go undocumented

- **Surfaced by:** MSP-9 planning
- **Evidence:** MSP-9 acceptance criterion 2 reads "No tool name appears in the replacement that is absent from `src/server/tools/index.ts`. A test asserts this against the live registry, so the document cannot rot silently the way its predecessor did." The test MSP-9 specifies discharges exactly the first sentence. The reverse — a tool present in `TOOL_SPECS` but named nowhere in `docs/rules/continuity-ledger.md` — is not asserted, so adding a thirteenth tool would leave the document silently incomplete. The predecessor rule rotted in both directions: it named four tools that do not exist (`transition_thread`, `get_resume_brief`, `read_decision`, `rebuild_index`) and it also never mentioned `bind_branch`, `log_session_event`, `resolve_conflict` or `list_threads`, all of which are in `src/server/tools/index.ts:15-28`.
- **Why it is above the ceiling:** criterion 2's operative sentence is one-directional, and "A test asserts **this**" refers to it. A second, reverse assertion is a second criterion, not a restatement of the declared one. MSP-9's document does in fact name all twelve, so the gap is latent rather than live.
- **Not folded in.**

## F9c-note — orchestrator correction: MSP-3 DOES own the `instructions.ts` prose

- **Surfaced by:** orchestrator review of F9c
- **Evidence:** F9c states that `src/server/instructions.ts:6-7` "may fall between" MSP-8 and MSP-9 and that no MSP appears to own it. It is owned. `docs/plans/2026-08-25-post-cutover-repair/MSP-3-park-thread-refuses.md` carries section 2.9, "`src/server/instructions.ts:5-7` - the server's standing instructions", and Step 14, "`src/server/instructions.ts` - REPLACE - stop promising parking always succeeds", and lists the file in its commit file list. That is the same prose F9c quotes, at the same lines.
- **Disposition:** F9c's evidence about the sentence being falsified by ruling R2 is correct and is left standing; only its ownership conclusion is wrong. No new work is scheduled by it. F9c itself is not edited, per ruling O8.
- **F9b is unaffected and remains a genuine unowned defect.**

## F0b — MSP-0's version bump falsifies `README.md:5`, which cites the two files it bumped

- **Surfaced by:** MSP-0 execution, `code-reviewer` pass over the applied diff.
- **Evidence:** `README.md:5` reads verbatim ``Current version: 1.0.0 (`package.json:3`, `.claude-plugin/plugin.json:3`).`` (read directly at commit `5e43c3f`). Commit `5e43c3f` set both cited lines to `1.0.1`, so the sentence and both of its `path:line` citations are now false. Nothing guards it: `grep -rn "Current version" test scripts` exits `1` with no output, and `npm test` is green at 349/349 with this statement already false.
- **Why it is above the ceiling:** MSP-0's acceptance is three criteria — the census test exists, it is red on the parent and green on the fix, and `npm test` is green. All three are met and verified; this breaks none of them. The declared in-scope exception is a test that passes at the parent `1592265` and fails on the applied tree, and no test asserts this line at either commit. The MSP-0 plan is frozen and names exactly five files; `README.md` is not among them, and its section 9 fixes three commits with exact file lists. F9a already records that the ladder's README rung is scoped to "any README correction the ladder has made necessary", which is precisely what this is. Orchestrator ruling O1 gives every rung a version bump, so a re-pinned literal here would be falsified nine more times — the same change-detector pattern MSP-0 just removed from `test/contract/cutover-manifests-agree.test.ts`.
- **Dissent recorded:** `code-reviewer` classified this IN SCOPE as a regression introduced by this diff. The factual claim is correct and is not disputed; only the scope conclusion is overruled, on the four grounds above.
- **Not folded in.**

## F0c — the census discards the read-failure cause, so two different faults print identically

- **Surfaced by:** MSP-0 execution, found independently by both `code-reviewer` and `conformance-auditor`.
- **Evidence:** `test/contract/source-is-greppable-text.test.ts:29-35` reads `const readBytes = (absolutePath: string): Buffer | null => {` / `  try {` / `    return readFileSync(absolutePath)` / `  } catch {` / `    return null` / `  }` / `}`. The catch takes no binding, so `EACCES`, `ENOENT`, `EMFILE` and `EIO` all collapse to `null` and surface as the same `census halted on an unclassifiable item: {...}` message with no cause.
- **Why it is above the ceiling:** the behaviour is fail-closed and the census still halts loudly naming the path, so no acceptance criterion is affected. Only diagnosability is lost. The file body is quoted verbatim in the frozen plan's section 4 step 2 and was reproduced byte-exactly by instruction; changing it is a plan amendment, not an execution detail.
- **Not folded in.**

## F0d — the "missing root" assertion cannot fire for a genuinely missing root

- **Surfaced by:** MSP-0 execution, `code-reviewer`.
- **Evidence:** `test/contract/source-is-greppable-text.test.ts:61` calls `const population = scanSourceRoots(PROJECT_ROOT)` before the per-root loop at `:62-67`, and `walkRoot` at `:18` calls `readdirSync` with no guard. `readdirSync` on an absent directory throws `ENOENT: no such file or directory, scandir '...'`, so a deleted `src/` propagates that raw error and the message at `:65` — ``a census over a missing root proves nothing`` — never renders.
- **Why it is above the ceiling:** the test fails loudly on either branch, so the census cannot pass vacuously and no acceptance criterion is touched. The assertion is not dead: it still fires for a root that exists but is empty. The gap is message quality on one branch only.
- **Not folded in.**

## F0e — three symbols are exported from a test file with no consumer

- **Surfaced by:** MSP-0 execution, `code-reviewer`.
- **Evidence:** `test/contract/source-is-greppable-text.test.ts:15`, `:26` and `:37` declare `export type SourceByteEntry`, `export const scanSourceRoots` and `export const classifySourceBytes`. `grep -rn "scanSourceRoots\|classifySourceBytes" test src scripts` finds no hit outside that file (exit `1`).
- **Why it is above the ceiling:** unreachable public surface affects no criterion. It invites a future test to import a classifier from a `.test.ts` file rather than from `test/support/`, which is a placement question for whoever needs the reuse.
- **Not folded in.**

## F0f — every scanned file is read twice on every run

- **Surfaced by:** MSP-0 execution, `code-reviewer`.
- **Evidence:** `test/contract/source-is-greppable-text.test.ts:68-71` passes `describePopulation(PROJECT_ROOT, population)` as the third argument to `assert.doesNotThrow`. That is a call, evaluated eagerly, and it classifies the whole population at `:53` before `census` classifies it again. Each classification reads from disk, so 73 files cost ~146 reads, plus a third read per violation from the `.map` at `:57`.
- **Why it is above the ceiling:** the rendered message is correct and the receipt's parent-commit failure did name `resolve_conflict.ts [forbidden]`, so nothing is wrong with the output. The cost is wasted I/O and a narrow time-of-check/time-of-use window.
- **Not folded in.**

## F0g — `SEMVER_PATTERN` rejects prerelease and build-metadata versions that npm accepts

- **Surfaced by:** MSP-0 execution, `code-reviewer`.
- **Evidence:** `test/contract/cutover-manifests-agree.test.ts:8` reads `const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/`, anchored to exactly three numeric parts. A valid prerelease such as `1.1.0-rc.1` or build metadata such as `1.0.1+build.5` is legal in `package.json` and would turn this test red.
- **Why it is above the ceiling:** it is not a regression — the literal pin `'1.0.0'` it replaced would have failed on those forms too. Recorded so the constraint is known before a first release candidate rather than discovered by it.
- **Not folded in.**

## F0h — `package-lock.json` carries a third version, already drifted before this ladder

- **Surfaced by:** MSP-0 execution, `code-reviewer`.
- **Evidence:** `package-lock.json` root `version` and `packages[""].version` are both `0.2.8`. Read at parent `1592265` via `git show 1592265:package-lock.json`, both fields were already `0.2.8`, so this diff did not cause it. `cutover.manifests-agree` covers `package.json`, `.claude-plugin/plugin.json` and the wire version, and does not cover the lockfile.
- **Why it is above the ceiling:** pre-existing at the parent and outside every MSP-0 criterion. Note for whoever takes it: `node_modules` is tracked in this repository and `npm install` must never be run here, so this cannot be repaired by regenerating the lockfile, and whether the lockfile belongs in the agreement contract at all is the prior question.
- **Not folded in.**

## F0i — sibling contract tests resolve the repository root by two different conventions

- **Surfaced by:** MSP-0 execution, `code-reviewer`.
- **Evidence:** `test/contract/source-is-greppable-text.test.ts:9` reads `const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))`, a hardcoded two-level ascent. `test/contract/cutover-manifests-agree.test.ts:22-32` instead walks upward looking for `.claude-plugin/plugin.json` under a bounded `REPO_ROOT_MAX_ASCENT` and throws a named `RepoRootNotFoundError` on failure.
- **Why it is above the ceiling:** the hardcoded form is fail-closed — a wrong root makes `readdirSync` throw `ENOENT` rather than silently scanning the wrong tree — so no criterion is at risk. The cost is a second convention for one job, and extracting the marker-based resolver into `test/support/` touches a file MSP-0 does not own.
- **Not folded in.**

## F0j — coordinated version drift across all three surfaces is no longer detectable

- **Surfaced by:** MSP-0 execution, `conformance-auditor`.
- **Evidence:** `test/contract/cutover-manifests-agree.test.ts:53-85` after the de-pin asserts shape (`assert.match(packageJsonVersion, SEMVER_PATTERN)`), manifest agreement (`assert.strictEqual(pluginJsonVersion, packageJsonVersion)`) and wire agreement, all derived from `package.json`. If `package.json`, `.claude-plugin/plugin.json` and the wire version all moved together to the same well-formed but unintended value, the suite stays green; at parent `1592265` the literal pin would have caught it. Net assertion count in that file went 10 to 7.
- **Why it is above the ceiling:** the de-pin is mandated by the frozen plan's section 4 step 3 and its section 3.5 ruling, and the test's declared contract is agreement — its name is `cutover.manifests-agree` — not a specific value. The trade is recorded here so it is explicit rather than implied; MSP-0 acceptance criterion 3 required the de-pin to reach a green `npm test` at all.
- **Not folded in.**

## F0k — no CI ever runs against a merged trunk state, because both workflows trigger on `pull_request` only

- **Surfaced by:** MSP-0 execution, found while verifying MSP-0's two merged pull requests (Wave 1).
- **Evidence:** "There is no CI on main at all. Both `.github/workflows/receipts.yml` and `rebuild.yml` trigger on `pull_request` only, with no push trigger, and `gh run list --branch main` returns nothing. Every green check on a pull request runs against GitHub's computed merge-with-base, never against the merge commit that lands. Invariant I1 says `npm test` passes on every merge commit and nothing enforces it after merge." No line number within either workflow file is recorded, and no commit sha is given for this finding (a separate later hand-verification names commit `0d7c07c`, but that is not part of this quote).
- **Why it is above the ceiling:** recorded as an open risk rather than fixed, because fixing it would extend a frozen scope; the frozen MSP-0 plan names exactly five files, and neither workflow file is among them.
- **Not folded in.**


# Filed, not fixed — discovered during execution (MSP-1 onward)

Items found above an MSP acceptance ceiling while the unit was being IMPLEMENTED rather than while
it was being planned. Each carries its evidence and the MSP whose execution surfaced it. Nothing
here is folded into the ladder.

Two id schemes coexist in this file, and the reason is recorded so that nothing here reads as an
inconsistency to be repaired. The `F` block above holds the planning-phase items AND MSP-0's
execution-phase items, `F0b` through `F0k`. From MSP-1 onward the planning phase had already taken
`F1a`, `F1b`, `F2a` and the rest, and execution surfaced DIFFERENT defects that the ladder's own
working notes ALSO called `F1a` and `F1b`. Appending those under the same names would file two
unrelated defects under one id. Execution-phase items from MSP-1 onward therefore take an `E`
prefix. MSP-0's execution items stayed on `F` because no planning id collided there: `F0a` is
planning, `F0b` through `F0k` are execution, and nothing had to fork.

A reader looking for every execution-phase item looks in two places: `F0b` through `F0k` above, and
this section.


## E1a — three `sync.ts` call sites discard `syncWorkingCopy`'s new result, so a failed materialisation is still reported as fast-forwarded or merged

- **Surfaced by:** MSP-1 execution, Wave 2, filed as finding `B1`.
- **Evidence:** the diff changed `syncWorkingCopy`'s return type from `void` to a result, `ensureMaterialised` checks it, and three of its four call sites in `src/merge/sync.ts` at lines 239, 310 and 335 discard it as a bare statement; `fastForward` still reports `fast-forwarded` and `performMerge` still pushes and reports `merged` when the materialisation behind them failed. Severity HIGH, read at commit `0d7c07c8942db4b6f8ed8cc7ca3e9e103d3d3b26`. The fourth call site — the one that does check the result — is not named or given a line number in the record.
- **Why it is above the ceiling:** it breaks none of MSP-1's six criteria and none of its ten gates, and it is not a regression, so the ceiling rule places it above the line the same way it placed `F2A` above MSP-2's.
- **Not folded in.**

## E2a — `blobAt` folds a failed git lookup into the same `null` as a genuinely absent record, letting a stale record overwrite the winner on double failure

- **Surfaced by:** MSP-2 execution, Wave 2, filed as `F2A` against its own diff.
- **Evidence:** `blobAt` at `src/store/write-path.ts:150` folds a non-zero git exit, a spawn error and a genuinely absent path into the same `null`. If both lookups for one record fail inside the same retry, `null` is not unequal to `null`, the retry continues, and the stale record is written over the winner — the defect MSP-2 closes, reached through the error path instead of the race path, which the record states is in tension with ruling R3's under-no-circumstance language. The named remedy is `classifyFailure` at `src/store/ref.ts:12-13`. Read at commit `0d7c07c8942db4b6f8ed8cc7ca3e9e103d3d3b26`, pull request 66. No numeric severity label is given for `F2A`; it is referred to elsewhere only as "the most consequential of the wave's filed items."
- **Why it is above the ceiling:** `F2A` is not a regression this diff introduced — before the fix the retry overwrote the winner on every lost race, and after it the overwrite survives only when a git subprocess fails, so the change is strictly an improvement and the standing rule that a unit owns what its own diff breaks does not reach it. Criterion 1 is discharged by a test that asserts over the race path, which is the path the criterion and the audit probe both describe; the acceptance list is a ceiling, so an item discovered above it is filed rather than folded in.
- **Not folded in.**

## E3a — `park_thread` checks the caller's session identity only when `thread_id` is omitted, letting a second local session park a thread the first session holds

- **Surfaced by:** MSP-3 execution, Wave 2, a security-reviewer finding filed as `F3e`.
- **Evidence:** `park_thread` compares `pointer.session_id` to `rt.sessionId` only on the branch where `thread_id` is omitted; when `thread_id` is supplied and matches the pointer, control reaches `parkResolvedThread` with the caller's session identity never inspected, and `releasePointerIfOwned` checks only `thread_id`, so it is no backstop. It is reachable with no exotic precondition: `list_threads` hands any local session the thread ids, so a second session parks a thread the first holds by naming it. A security-reviewer characterised it MEDIUM, pre-existing and byte-identical at the parent commit, with a six-line fix reusing the existing `otherSessionRefusal` constructor in a file MSP-3 already edits; its six new refusal branches are a strict tightening with no regression, but MSP-3 did add one more action reachable through that pre-existing gap, which is its own criterion 4 working as specified. Neither source gives a file path or a line number for `park_thread`'s comparison logic itself.
- **Why it is above the ceiling:** filed at MEDIUM with the fix written down, and Wave 2 merges. The security rule's stop-and-escalate ordering is for a security issue a change introduces; this one is byte-identical at the parent, and halting three units whose every gate is green over inherited debt is the escalation the ladder exists to prevent.
- **Not folded in.**

## E4a — `record_decision` reads the thread before `writeRecords` re-reads its CAS baseline, so a rival write in that gap is silently overwritten with no per-record version token to catch it

- **Surfaced by:** MSP-4b execution, Wave 3, correcting the SPEC's recorded mitigation for defect `D11`.
- **Evidence:** `record_decision` reads the thread at `record_decision.ts:152`, then `writeRecords` reads its compare-and-swap baseline fresh and later at `write-path.ts:184`. If a rival write landed in that gap, the baseline already contains it, so the first swap succeeds and returns at `write-path.ts:219-221`. The `changedUnderneath` guard is gated on `cas.cause === 'ref-moved'` at `write-path.ts:223` and therefore never runs; it covers only a rival landing during this call's own attempt. `buildTree` then stamps the stale content over the rival's at `write-path.ts:94-104`, unconditionally, and no per-record version token exists anywhere in the commit path. MSP-4b makes `record_decision` a two-record writer, widening the exposure. Read at commit `49dce11a634919ed91000a74fd6bee132413b113`; the `concurrent.distinct-ids` test is named as not covering this property. The SPEC's stated mitigation — that MSP-2 is a hard dependency and lands first — does NOT close this window: it narrowed the during-attempt race and left this before-attempt read gap open. `D11` must be scheduled on its own evidence. No severity label is assigned to `D11`'s expanded blast radius in either source.
- **Why it is above the ceiling:** filed, and MSP-4b ships. The fix lives in `src/store/write-path.ts`, a file entirely outside MSP-4b's declared surface; all seven acceptance criteria are met and no test that passed on the parent fails now, so the ceiling rule files it rather than folding it in.
- **Not folded in.**

## E5a — a `Record` type check on the tool-name map verifies value shape only, not key/value correspondence, so a swap of two names compiles

- **Surfaced by:** MSP-5 execution, Wave 4, filed as `F6`.
- **Evidence:** `src/server/tools/index.ts:16-29` — `satisfies Record<LedgerToolName,{name:string}>` checks value shape, not key/value correspondence, so a swap of the names compiles. Severity MEDIUM. The record states the live mitigation: the census's `files` axis catches it because it derives independently. No reproduction command and no measured value are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the live mitigation noted above.
- **Not folded in.**

## E5b — `LEDGER_TOOL_NAMES` is declared `as const` rather than frozen with `Object.freeze`, though no exploit path was found

- **Surfaced by:** MSP-5 execution, Wave 4, filed as `F7`.
- **Evidence:** `src/server/tool-names.ts:1-14` — `LEDGER_TOOL_NAMES` is `as const`, not `Object.freeze`'d. Severity LOW. The record states no exploit path was found. No reproduction command and no measured value are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the absence of an exploit path.
- **Not folded in.**

## E5c — a roster gap: `technical-writer` has no Bash tool, so it cannot produce command receipts, and reported `CAPABILITY-BLOCKED` instead

- **Surfaced by:** MSP-5 execution, Wave 4, filed as `F8`.
- **Evidence:** the `technical-writer` agent has no Bash tool, so it cannot produce command receipts; it emitted `CAPABILITY-BLOCKED` rather than fabricating them. Unlike `F1` through `F7` and `F9` through `F15`, this item carries no severity label. No file path, no line number and no reproduction command are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning.
- **Not folded in.**

## E5d — no read surface exposes a completion criterion's ULID, so marking a criterion done requires reading the store from disk, which the write guard exists to keep callers out of

- **Surfaced by:** MSP-5 execution, tied to confirming MSP-5's criterion 4 some rungs after it merged.
- **Evidence:** verifying criterion 4 required a criterion ULID, which `update_thread` demands and which no read surface exposes: `list_threads` omits them, and both the resume briefing and the `logbook://thread` resource render criteria as `c1` through `c7` labels with no ids. Finding the id meant reading the thread record from disk. `src/hooklib/guard.ts:20` and `test/hooks/guard-registry.test.ts` are cited elsewhere in the same record, but for the underlying criterion-4 fix, not for this filed gap itself. No proposed fix, file path, or severity is given for the missing read-surface gap.
- **Why it is above the ceiling:** filed rather than fixed — no read surface exposes criterion ids, so marking a criterion requires reading the store from disk, which the write guard is designed to keep callers out of.
- **Not folded in.**

## E6a — `readRemoteLedgerSha` publishes `ls-remote` output as `remote_sha` with no hex-shape validation

- **Surfaced by:** MSP-6 execution, Wave 4, filed as `F1`.
- **Evidence:** `readRemoteLedgerSha` at `src/merge/sync.ts:46-55` publishes `ls-remote` output as `remote_sha` with no hex-shape validation. Severity MEDIUM. The stated remedy: validate and return `null` so it degrades to `pushed-unverified`. No reproduction command, no measured value and no test name are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the stated remedy.
- **Not folded in.**

## E6b — the same sync function discards stderr on a failed read-back, collapsing two distinct error causes into one

- **Surfaced by:** MSP-6 execution, Wave 4, filed as `F2`.
- **Evidence:** the record names lines 46-48 of "the same function" as the preceding item, discarding stderr on a failed read-back and collapsing "no ledger ref" with "verification errored". It states no file path of its own; the function is `readRemoteLedgerSha`, which `E6a` records at `src/merge/sync.ts:46-55`. Severity MEDIUM. The record notes `casUpdateRef` in `src/store/ref.ts` already logs this. No reproduction command and no measured value are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the comparison to `casUpdateRef`.
- **Not folded in.**

## E6c — `sync.ts` line 49 takes only the first non-blank line, currently unreachable given `LEDGER_REF`'s shape

- **Surfaced by:** MSP-6 execution, Wave 4, filed as `F3`.
- **Evidence:** `src/merge/sync.ts:49` takes the first non-blank line. Severity LOW. The record states this is unreachable today since `LEDGER_REF` is fully qualified. No reproduction command and no measured value are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the unreachability note.
- **Not folded in.**

## E6d — a widening cast in the sync receipt test now costs a static guarantee

- **Surfaced by:** MSP-6 execution, Wave 4, filed as `F4`.
- **Evidence:** `test/sync/receipt.test.ts:16-18` — a widening cast now costs a static guarantee. Severity LOW. The log does not describe what the cast widens from or to, gives no reproduction command, and gives no measured value.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity.
- **Not folded in.**

## E6e — the noop and fast-forwarded paths publish a pre-attempt `remote_sha` though the schema promises a post-push read-back, so it can go stale

- **Surfaced by:** MSP-6 execution, Wave 4, filed as `F5`.
- **Evidence:** the `noop` and `fast-forwarded` code paths publish a pre-attempt `remote_sha` while the schema says read-back-after-push. Severity LOW. The record characterises this as "honest but can be stale." No file path, no line number and no reproduction command are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity.
- **Not folded in.**

## E7a — the `predecessor_id` merge path has no real test; an early-return fixture masks the take-present dispatch path

- **Surfaced by:** MSP-7 execution, Wave 4, filed as `F9`.
- **Evidence:** the `predecessor_id` merge path has no real test. `test/unit/field-merge.test.ts:357` asserts only the path name, and the `baseThread` fixture at `:58-69` omits the field, so the early `isDeepStrictEqual` return at `src/merge/field-merge.ts:63-65` fires before take-present dispatches. Severity MEDIUM. No reproduction command and no measured value are given.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity.
- **Not folded in.**

## E7b — `mergeSpine` rebuilds a record by explicit key enumeration with no spread, the adjacent-gap instance of a known defect class, filed as a spine risk

- **Surfaced by:** MSP-7 execution, Wave 4 (attributed to MSP-8 at hand-off; both sources state MSP-7).
- **Evidence:** `mergeSpine` at `src/domain/spine.ts:204-220`, filed as `F10`. Severity MEDIUM, read at commit `f17e92772d493539f2ae5d20a6a94ddaf326fe93`. The defect class is described as a record rebuilt by explicit key enumeration with no spread, and nothing forces its completeness at compile time, so an added optional field is silently dropped; `field-merge.ts` was the first known member and MSP-7 closed it, `mergeSpine` is the second, open member. The record states this instance is latent only because Spine currently carries no optional field. Neither source describes the fix, a PR number, a reproduction command or a measured value; the wording "naming all six keys" used for this item elsewhere does not appear in either source and is not carried here.
- **Why it is above the ceiling:** both open instances are filed against the class and MSP-7 ships at its declared ceiling. Folding them in would breach G0's rule that acceptance is a ceiling and not a floor, and it would do so on the exact unit whose plan was already the largest of the three.
- **Not folded in.**

## E7c — the same record-rebuilding defect class recurs in the conflict merge module

- **Surfaced by:** MSP-7 execution, Wave 4 (attributed to MSP-8 at hand-off; both sources state MSP-7).
- **Evidence:** `src/merge/conflict.ts:3-8`, severity LOW, filed as `F11`. The session log's entire description of this item is "same class" — it does not describe the symbol at that location beyond calling it the same defect class as `mergeSpine` (`E7b`). The decision record adds that this is the second open member of the class (a record rebuilt by explicit key enumeration with no spread, nothing forcing its completeness at compile time), latent only because `conflict.ts` currently carries no optional field, read at commit `f17e92772d493539f2ae5d20a6a94ddaf326fe93`. Neither source names a PR number, a reproduction command or a dispatched-fix description.
- **Why it is above the ceiling:** both open instances are filed against the class and MSP-7 ships at its declared ceiling. Folding them in would breach G0's rule that acceptance is a ceiling and not a floor, and it would do so on the exact unit whose plan was already the largest of the three.
- **Not folded in.**

## E7d — `loadThreadForReference` and `loadThread` are near-duplicate functions

- **Surfaced by:** MSP-7 execution, Wave 4, filed as `F12`.
- **Evidence:** `loadThreadForReference` and `loadThread` are near-duplicate, at `src/server/tool-support.ts:42-47` and `:64-70` respectively. Severity LOW. The log does not describe what differs between the two functions, and gives no reproduction command.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity.
- **Not folded in.**

## E7e — `open_thread`'s prose description never mentions the new lineage capability

- **Surfaced by:** MSP-7 execution, Wave 4, filed as `F13`.
- **Evidence:** `open_thread`'s prose description never mentions the new capability, at `src/server/tools/open_thread.ts:84-85`. Severity LOW. The log does not state which "new capability" specifically beyond what is inferable from the rest of the session (predecessor lineage), and gives no reproduction command.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity.
- **Not folded in.**

## E7f — a pre-existing two-state existence oracle in `tool-support.ts`, unresolved and carried forward

- **Surfaced by:** MSP-7 execution, Wave 4, filed as `F14`.
- **Evidence:** a pre-existing two-state existence oracle at `src/server/tool-support.ts:15-29`. Severity LOW. The log does not describe what the "two-state existence oracle" checks or why two states are considered wrong, and gives no reproduction command.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the description "pre-existing."
- **Not folded in.**

## E7g — `resolvePredecessor` applies no status filter while a sibling roster function filters out done/abandoned threads (speculative)

- **Surfaced by:** MSP-7 execution, Wave 4, filed as `F15`.
- **Evidence:** `resolvePredecessor` applies no status filter while `selectRosterThreads` filters `done`/`abandoned`. Severity LOW. The source marks this finding "speculative" explicitly, and gives no file path, no line number and no reproduction command.
- **Why it is above the ceiling:** the session records this among the wave's "FILED ITEMS" rather than fixed in place; it gives no item-specific ceiling reasoning beyond the severity and the "speculative" label.
- **Not folded in.**

## E8a — `update_thread` persists `blocked_by` text raw while every sibling free-text writer escapes at write time, and `render/roster.ts` copies it raw into `list_threads` output

- **Surfaced by:** MSP-8 execution, MSP-8's own HIGH finding, filed as `F1`.
- **Evidence:** `update_thread.ts:257` persists the caller's `blocked_by` text raw, while every sibling free-text writer in the codebase escapes at write time, including `spine.ts:204-207` on `update_thread`'s own call path and `resolve_conflict.ts:362-365` on `blocked_by` specifically. `render/roster.ts:36` then copies the value raw into the structured JSON `list_threads` returns, so render-time escaping never reaches it. The gap was inert while `blocked_by` had no writer; this diff makes it live. Severity HIGH. Read at commit `426ac1cdc1e922dbe252047af0bad89bd3a7abe4`, pull request 74, with the suite green at 393 of 393.
- **Why it is above the ceiling:** filed, not folded in, and scheduled as the next rung ahead of MSP-9. No test regresses here, the suite stays green at 393, so the ladder's regression rule — a test that passes on the parent and fails on the applied tree — does not reach this finding, and `receipts.md` is explicit that a reviewer finding which breaks no gate is filed rather than fixed in flight, because re-review rounds are not a substitute for an executable check.
- **Not folded in.**

## E8b — `resolve_conflict.ts` is missing its own post-escape cap check, filed as a real member of the same defect class rather than folded into the `blocked_by` fix

- **Surfaced by:** the remediation rung that followed MSP-8 and fixed its `blocked_by` finding (`E8a`); the source record does not state an MSP number for this rung.
- **Evidence:** `resolve_conflict.ts`'s own missing post-escape cap check, id `R-3`, is filed as a real member of the same defect class rather than folded in. No severity label, no line number, and no description of what the missing cap check would need to do are given for `R-3` itself; it is distinct from the `resolve_conflict.ts:362-365` reference cited in `E8a`.
- **Why it is above the ceiling:** the record states only "is FILED as a real member of the same class rather than folded in," with no further reasoning given beyond that clause.
- **Not folded in.**

## E8c — a shared escape-then-cap helper across five tool files plus `spine.ts` is filed rather than built now, to keep the security fix from carrying a cross-cutting refactor

- **Surfaced by:** the remediation rung that followed MSP-8 and fixed its `blocked_by` finding (`E8a`); the source record does not state an MSP number for this rung.
- **Evidence:** "Alternative D," the shared helper across five tool files plus `spine.ts`, is filed. The five tool files are not individually named or path-cited in the record.
- **Why it is above the ceiling:** mixing a cross-cutting refactor into a security fix violates the rule separating refactor from behavior-change commits.
- **Not folded in.**

## E9a — census row 103 held a stale verdict, proving the frozen census can go stale, and the other 194 rows were never independently re-verified

- **Surfaced by:** MSP-9 execution.
- **Evidence:** `renderThreadLine` at `src/cli/session-start.ts:23-25` interpolates exactly four fields — `slug`, `title`, `next_step`, `id` — with no fifth segment; `status` appears in the render path only as a listing filter at `:36` and never reaches the rendered text. `test/unit/session-start.test.ts:61` asserts the absence and `:79` asserts the four survivors, both passing. So census row 103's claim is FALSE of the shipped code. Row 105 is cited as an existing correct example ("false | omitted") for comparison. Read at commit `9d8c11332b74f6aa6309d0b79d18a2fa9c3e1d55`. Row 103 proves at least one verdict in the frozen census went stale against a tree that moved under it, and because the prescribed walk matches dispositions while taking every verdict as given, the remaining 194 rows carry unquantified staleness of the same kind; none of them are individually identified or re-checked in the record.
- **Why it is above the ceiling:** the consequence is the durable part, and it is filed rather than folded in — row 103 proves at least one verdict in the frozen census went stale against a tree that moved under it.
- **Not folded in.**

## Named at hand-off but not recoverable from the ledger

Five defects were named when the execution phase was handed off, but could not be grounded in any
session log or decision record. Both corpora were searched in full: 70 session logs, of which 8
carry content, and 62 decision records. These are recorded as UNVERIFIED POINTERS, not as filed
defects. No evidence for them exists in the ledger, no entry above covers them, and nothing here
asserts that the defect is real.

- A Wave 2 item that the plan's NUL-byte routing had gone stale. The only NUL-byte material in either corpus is a pre-implementation correction to MSP-0's census, which was resolved in the same decision rather than filed.
- A Wave 2 item about retry probe cost scaling with passthrough records. The terms `passthrough`, `pass-through` and `probe cost` appear nowhere in either corpus.
- A Wave 2 item that `writeRecords` exceeds the file-length guideline. `writeRecords` appears in the corpus only in the context of its compare-and-swap logic; no length or diff-size claim about it exists.
- Three lower-severity MSP-1 review items. The Wave 2 debrief states "Fifteen items across the three units" and names only two of them individually; no three MSP-1-specific items are itemised anywhere.
- An MSP-4a HIGH finding that `close_thread.ts`, `park_thread.ts` and `resolve_conflict.ts` each duplicate the refusal factory. The string `close_thread` does not occur anywhere in the 62-record decision corpus.
