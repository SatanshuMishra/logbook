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
