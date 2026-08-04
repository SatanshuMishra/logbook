# SPEC: Logbook MCP Server Hardening

Status: approved 2026-08-04 by decision `0030`; execution in progress
Date: 2026-08-04
Repository: https://github.com/SatanshuMishra/logbook
Baseline: `main` at `2c8ef31`, plugin version `0.2.0`
Target: plugin version `1.0.0`

---

## 1. Why this exists

A production session lost roughly forty minutes and wrote a false statement into a permanent
decision record. The proximate trigger was a malformed tool-call emission, but the reason it
became expensive is structural: when the server refused the call, the refusal carried no
information the caller could act on, so the model retried the wrong hypothesis twice, then
inferred a mechanism the code does not implement (`update_thread revalidates the whole thread`)
and committed that inference to the ledger as decision `0228`.

A fourteen-agent audit of the server followed. It produced **121 verified defects**: 88 findings
that survived adversarial verification, plus 33 further defects the verifiers found on their own.
Twelve are critical. Every critical either destroys data silently, records something untrue, or
serves untrusted text to the model as authoritative.

This SPEC closes all of them.

### 1.1 The four structural causes

Nearly every defect reduces to one of these. Each MSP below names which it attacks.

| Code | Cause | Plain meaning |
| --- | --- | --- |
| **C1** | No single definition of a valid record | Constraints live wherever a handler first needed them. The same value is accepted through one door and refused through another. The read path enforces nothing. |
| **C2** | No transaction boundary | One tool call writes three or four files in sequence. The third fails, the first two persist, the caller is told the whole call failed, and the natural retry hits a half-moved world. |
| **C3** | Writes are unobservable | Return values report what the record now *is*, never what *changed*. Deletion, no-op and success are indistinguishable. |
| **C4** | Refusals carry no diagnosis | `src/schema/validators.mjs:10` keeps only `instancePath` and `message` and discards ajv's `params`, so no error names the offending field, the allowed values, or whether a retry could ever succeed. |

---

## 2. Evidence base

The authoritative defect list is the audit artifact, committed in-repo by MSP-0:

```
docs/audits/2026-08-04-mcp-audit.json
```

Do not re-derive it; do not trust any restatement of it — including this document and the generated
`docs/audits/2026-08-04-mcp-audit.md` index — over the artifact itself.

Shape: `.result.survivors[]` (88 verified findings, each with `evidence[]` of repo-relative
`file:line`), `.result.missed[]` (33 verifier-found defects), `.result.research[]` (cited MCP and
Claude Code practices), `.result.remedies[].clusters[]` (12 root-cause clusters with fixes).

**Evidence law, binding on every agent that executes this SPEC.** This SPEC exists because an
agent inferred a mechanism instead of reading one. Therefore: every claim in an implementation
PR body, commit message or decision record must cite a `file:line` the author personally opened.
Never infer behavior from a function name, a variable name, a comment, a test name, or another
agent's claim. If a claim cannot be pinned to a line, it is not made.

**Artifact provenance.** The workflow wrote the artifact to a session-scoped temp path that will
not survive indefinitely:
`/private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/93ccbd10-7cbd-4ade-b590-39aacb1f197c/tasks/w69eqd9fo.output`.
MSP-0 copied it into the repository. On 2026-08-04 the committed copy was verified byte-identical
to that original — sha256 `56deb0a723cbc6fc3f90146b7bce7e15b6539cd68718f4348b1cd47f30222251` on
both, `diff` empty — which closes the sole unverified line in PR #35.

---

## 3. Goals and non-goals

### Goals

1. Every refusal tells the caller which layer refused, which field, what is acceptable, and
   whether retrying the same payload can ever succeed.
2. No tool call can leave partial durable state on failure.
3. No write can silently destroy, silently no-op, or silently mutate something the caller did
   not name.
4. One normative definition of a valid record, derived by every layer.
5. Text originating from ledger storage is never presented to the model as server-authored.
6. A second concurrent session cannot destroy the first's work.
7. The plugin reaches `1.0.0` with an on-disk format it can defend.

### Non-goals

- Rewriting the ledger's data model, thread lifecycle, or spine concept. The design is sound;
  its enforcement is not.
- Changing the two-skill split (`preflight` read side, `debrief` write side).
- Adding features. Every MSP closes audited defects and nothing else.
- Migrating existing ledgers to a new storage backend.
- `bin/ledger-cli.mjs` beyond what a server change forces. It is not an MCP surface.

---

## 4. Invariants

These hold at **every** merge, not only at the end. Any MSP that would break one is not
independently shippable and must be re-cut.

| ID | Invariant |
| --- | --- |
| **I1** | **Green branch.** `npm test` passes on the merge commit. A PR that breaks the branch it merges into is not an MSP. |
| **I2** | **Existing ledgers keep working.** Every real ledger on disk today (notably the `.windful-ocean` ledger, 17 threads) remains readable and writable after the merge, or the MSP ships a migration that runs before first use and is proven against a copy of it. |
| **I3** | **No silent tightening.** A constraint that newly rejects previously-accepted input must (a) be announced in the tool description, (b) produce a `retryable:false` structured error naming the accepted form, and (c) quarantine rather than crash when it meets non-conforming data already on disk. |
| **I4** | **Both version files agree.** `package.json` and `.claude-plugin/plugin.json` are bumped in the same commit. `node scripts/check-packaging.mjs` passes. |
| **I5** | **No new comments.** Per project standard, no explanatory comments, docstrings or section headers are added in any language. Tooling pragmas and shebangs only. |
| **I6** | **Evidence, not inference.** Every PR body's Verified lines describe checks actually run. A check not run is `--not-verified "<thing> - not run"`. Never a placeholder. |
| **I7** | **Dogfood risk acknowledged.** This repository *is* the installed plugin. Working-tree edits do not affect the running plugin until reinstall and restart. Never verify a change by observing this session's own ledger behavior. |

---

## 5. Defect inventory

Grouped by class. Counts are approximate groupings across the 121; the artifact is authoritative.

| Class | Count | Representative critical |
| --- | --- | --- |
| Error attribution and recoverability | 17 | ajv `params` discarded; `amend_criteria` `oneOf` produces a 689-char nine-clause error |
| Validation-layer incoherence | 37 | 200-char criterion cap absent from the write schema; `SPINE_CAPS` checked at one call site, against the submitted patch only |
| Silent success and silent destruction | 11 | `out_of_scope` wiped wholesale (crit); `get_resume_brief` consumes the drift snapshot (crit) |
| No transaction, no reservation | 14 | orphan decision files on failure (crit); duplicate decision numbers (crit) |
| Missing read surface | 8 | twelve of fourteen tools require a ULID no tool returns |
| Instruction and server drift | 10 | Stop gate never arms (crit); `paused -> paused` guaranteed failure |
| Storage custody | 9 | `rm -rf` of the shared worktree on every process start (crit) |
| Multi-user safety | 6 | `-X theirs` merge then force-push silently discards local work (crit) |
| Trust boundary and injection | 7 | briefing printed verbatim as authoritative (crit); SessionStart roster injection with no user action (crit) |
| Cost and capacity | 10 | `update_thread` measured returning 6,269 bytes; full index rebuild per call |
| Guard asymmetries (verifier-found) | 9 | `record_decision` lacks the terminal-thread guard its siblings have (crit); `bind_branch` sets a pointer nothing can clear (crit) |

### 5.1 The twelve criticals

| # | Defect | Anchor |
| --- | --- | --- |
| 1 | `get_resume_brief` consumes the drift snapshot; a second call silently loses it | `src/tools/get-resume-brief.mjs:28` |
| 2 | `update_thread` replaces `spine.out_of_scope` wholesale while teaching merge semantics for its siblings | `src/tools/update-thread.mjs:58` |
| 3 | Ledger sync merges `-X theirs` then force-pushes, silently discarding local writes | `src/drivers/git-ref-driver.mjs:488` |
| 4 | `GitRefDriver.init()` unconditionally `rm -rf`s the shared worktree on every process start | `src/tools/context.mjs:10`, `src/drivers/select.mjs:42` |
| 5 | `record_decision` writes the decision file before validating the thread, leaving orphans on failure | `record-decision.mjs:66` vs `:76` |
| 6 | `nextDecisionNumber` is read-max-then-increment with no reservation; concurrent calls collide | `src/drivers/local-driver.mjs:189` |
| 7 | `scope` is regex-only, so risks file under nonexistent criteria and become permanently invisible | `src/schema/patterns.mjs:24` |
| 8 | The Stop gate fires on the active-thread pointer, which the documented flow never sets | `hooks/lib/stop.mjs:101` |
| 9 | Briefing interpolates every field raw into a string the skill orders printed verbatim | `src/render/briefing.mjs:45` |
| 10 | SessionStart roster injects unescaped ledger text before the user types anything | `hooks/lib/roster.mjs:33` |
| 11 | `record_decision` has no terminal-thread guard; a `done` thread's spine keeps mutating | `src/tools/record-decision.mjs:42-51` |
| 12 | `bind_branch` sets the active pointer for a thread of any status, and nothing can clear it | `src/tools/bind-branch.mjs:14` |

---

## 6. Pull requests

PR creation in this repository is an established, working path — PRs #32, #33 and #34 landed this
way. No precondition, no tooling gap, no decision required before MSP-1.

Open one PR per MSP, autonomously, using this repository's existing PR path. Merge remains
human-gated: open PRs freely, never merge one. The title grammar and mandatory body fields are in
section 8.

---

## 7. MSP ladder

Thirteen MSPs. Each is independently shippable: merging it leaves `main` green and the plugin
working. Later MSPs assume earlier ones only where the Depends column says so.

### Version policy

`0.x` semantics: minor bumps carry breaking changes, patch bumps do not.

| MSP | Version after | Breaking |
| --- | --- | --- |
| MSP-0 | 0.2.0 (unchanged) | no |
| MSP-0B | 0.2.0 (unchanged) | no |
| MSP-1 | 0.2.1 | no |
| MSP-2 | 0.2.2 | no |
| MSP-3 | 0.3.0 | input tightening |
| MSP-4 | 0.4.0 | new tool + FSM change |
| MSP-5 | 0.5.0 | new tools |
| MSP-6 | 0.6.0 | return shape |
| MSP-7 | 0.7.0 | record schema |
| MSP-8 | 0.8.0 | driver contract |
| MSP-9 | 0.8.1 | no |
| MSP-10 | 0.8.2 | no |
| MSP-11 | 0.9.0 | merge semantics |
| MSP-12 | 0.9.1 | no |
| MSP-13 | 1.0.0 | release |

Every version bump edits `package.json:3` and `.claude-plugin/plugin.json:3` in one commit and is
proven by `node scripts/check-packaging.mjs`.

---

### MSP-0 — Ground the evidence and unblock PR tooling

**Status: shipped.** PR #35, squash-merged to `main` as `945b2a0` on 2026-08-04.

**Attacks:** none directly. Makes every later MSP auditable.
**Depends:** nothing.
**Version:** 0.2.0 (unchanged).

**Changes**
- Copy the workflow artifact to `docs/audits/2026-08-04-mcp-audit.json` and commit it.
- Write `docs/audits/2026-08-04-mcp-audit.md`: the 121 defects as a table of
  `id | dimension | severity | verdict | title | anchor`, generated from the JSON, not retyped.
- No tooling precondition. PR creation already works in this repository (section 6).

**Acceptance**
- `docs/audits/2026-08-04-mcp-audit.json` exists and parses; its `.result.survivors | length` is 88
  and `.result.missed | length` is 33.
- Every subsequent MSP can cite a defect by a stable id in that file.

**Verify:** `node -e "const a=require('./docs/audits/2026-08-04-mcp-audit.json'); ..."` asserting
both counts; `npm test`.

**PR title:** `docs(audit): commit the mcp server audit evidence base`

---

### MSP-0B — Close the audit coverage gap

**Attacks:** unknown defect density in three unaudited areas.
**Depends:** MSP-0. **Version:** 0.2.0 (unchanged). No production code change.
**Gates:** MSP-7, MSP-9, MSP-11 must not start until this lands. **MSP-1 through MSP-6 are not
gated** and proceed in parallel.

**Why.** The first audit covered five dimensions but three areas were only grepped, not read:
`src/drift/*` internals, `src/schema/upcast.mjs`, and every `GitRefDriver` payload measurement.
Absence of findings there is not evidence of absence. Two of the twelve criticals already live in
`git-ref-driver.mjs` and were found incidentally rather than systematically, which is a signal that
its defect density is at least as high as the audited files, not lower.

Three later MSPs are specified from partial knowledge of exactly these areas: MSP-7's migration
script names two `upcast.mjs` defects and assumes there are no others; MSP-9 and MSP-11 rewrite
`GitRefDriver` behavior; MSP-11's merge driver must handle records `src/drift/*` produces.

**Changes**
- Scoped audit, same evidence law and adversarial verification as the first pass, over exactly:
  `src/drift/{classification,disposition,reattach,slug,reconcile,snapshot}.mjs`;
  `src/schema/upcast.mjs` and the full v1 to v2 path; `src/drivers/{git-ref-driver,git-ledger,select,layout}.mjs`.
- Re-measure every byte-size figure in this SPEC against `GitRefDriver`, since the deployed
  backend is the git one and all current numbers came from `LocalDriver`.
- Append results to `docs/audits/2026-08-04-mcp-audit.json` under a `supplement` key. Do not
  rewrite the original.
- Amend MSP-7, MSP-9, MSP-11 in this SPEC with whatever the supplement finds. If it finds nothing,
  record that as a decision so the gap is closed by evidence rather than by silence.

**Acceptance**
- Every file listed above has been opened and read, evidenced by `file:line` citations.
- The `update_thread` return size, the `list_threads` size, and the index-rebuild cost are each
  measured on **both** backends and both figures recorded.
- MSP-7, MSP-9 and MSP-11 each carry either an amendment or an explicit no-change decision.

**Verify:** `npm test` (unchanged, this MSP ships no production code); the supplement parses and
its counts are asserted.

**PR title:** `docs(audit): audit the drift, upcast and git-ref surfaces`

---

### MSP-1 — Legible refusals

**Attacks:** C4. **Closes:** the 17 error-attribution defects, including the incident's root cause.
**Depends:** MSP-0.
**Version:** 0.2.1. Non-breaking: only error *content* changes.

**Changes**
- `src/tools/shared.mjs`: one `LedgerError` base carrying
  `{code, layer, field, expected, example, retryable, remedy}`. `ToolError`, `ToolValidationError`
  and `CapViolationError` extend it and populate every field.
- `src/schema/validators.mjs:9-11`: stop discarding `e.params`. Project structured detail:
  `additionalProperties` emits `e.params.additionalProperty`; `const` emits `allowedValue`; `enum`
  emits `allowedValues`; `pattern` emits the regex plus one conforming example. Keep a rendered
  English line, derived from the structured record.
- `src/tools/schemas.mjs:72-109`: replace `criteriaAmendOperation`'s three-branch `oneOf` with a
  discriminated form — `op` as an `enum`, then `allOf` of `if/then` on `op`. This collapses the
  measured 689-character nine-clause error to one clause naming one hypothesis.
- `bin/ledger-server.mjs`: render `LedgerError` into the tool result as `isError: true` with a
  message whose **first line** is `<code>: <field>: <what is accepted>` and whose second line is
  `retryable: true|false`. Reserve JSON-RPC protocol errors for malformed requests only.

**`retryable` is the load-bearing field.** In the incident, two parameters never arrived; the
error read as a schema complaint that a shape-retry could never fix. `retryable:false` plus
`remedy: "the parameter did not arrive; re-emit the call"` ends that loop in one round.

**Acceptance (falsifiable)**
- A call omitting `options` on `record_decision` returns an error whose text names `options`, says
  the parameter is absent, and carries `retryable:false`.
- A malformed `amend_criteria` operation returns exactly one hypothesis clause naming the invalid
  `op` value and listing the three valid ones. Measured length under 200 characters.
- No error message in the suite exceeds 400 characters.

**Verify:** new unit tests driving `callTool` for each error class; `npm test`.

**PR title:** `fix(errors): make every refusal name its field, its remedy and its retryability`

---

### MSP-2 — Validate before you write

**Attacks:** C2 (ordering half). **Closes:** criticals 5 and 11's write-ordering component, plus
the partial-write ghost-thread defects.
**Depends:** MSP-1 (for the error shape). **Version:** 0.2.2. Non-breaking.

**Changes**
- `src/tools/record-decision.mjs`: build the candidate thread and run full record validation
  **before** `driver.writeDecision` at `:66`. The decision file becomes the last durable write.
- Apply the same reordering wherever a throwing side effect follows a durable write:
  `transition-thread.mjs:39` vs `:40-45`, `open-thread.mjs:18` vs `:19`, `archive-thread.mjs:24`
  vs `:28`, `reopen.mjs:28` vs `:29-30`.
- Any side effect that cannot move before the record write becomes non-throwing and is reported in
  the result instead (`warnings[]`), notably `writeActiveThread`, which throws from
  `src/util/active-thread.mjs:26-27` when `CLAUDE_PLUGIN_DATA` is unset on a non-git project.

**Acceptance**
- A `record_decision` call that fails thread validation leaves **zero** files in `decisions/`.
  Test drives a real `LocalDriver` against a temp ledger and asserts the directory listing.
- A `record_decision` call that fails does **not** advance `nextDecisionNumber`.
- `open_thread` with `CLAUDE_PLUGIN_DATA` unset either succeeds with a warning or writes nothing.
  It never leaves a thread with no pointer and no error path.

**Verify:** `npm test`.

**PR title:** `fix(writes): validate the full record before any durable write`

---

### MSP-3 — Close the guard asymmetries

**Attacks:** C1 (spot fixes). **Closes:** criticals 7, 11, 12 and nine verifier-found guard gaps.
**Depends:** MSP-1. **Version:** 0.3.0 — tightens accepted input, so minor per policy.

**Changes**
- `record_decision`: import and apply `isTerminal` as its two sibling spine writers do
  (`update-thread.mjs:109`); call `assertSpineCaps`; add `maxLength: 120` to `title` to match
  `SPINE_CAPS.decisionTitleMaxChars`.
- `bind_branch`: set the active pointer only for a thread whose status is `active`; add a clear
  path for a pointer whose thread is not active, so session end cannot deadlock.
- `transition_thread`: preserve `blocked_by` on `blocked -> paused` rather than nulling it at
  `:30`; reject `closure_statement` on a non-`done` target rather than silently dropping it.
- `open_thread`: constrain `slug` with the same pattern already enforced for decision slugs
  (`local-driver.mjs:206`), replacing the free-text `minLength: 1` at `open-thread.mjs:33`.
- **Scope validity (critical 7).** Validate `scope` against the thread's actual criterion ids, not
  only `WRITABLE_SCOPE_PATTERN`. Refuse an unknown scope with a `retryable:false` error listing
  the valid ids.
- `archive_thread`: make its description match its code, or its code match its description
  (`archive-thread.mjs:25` vs `:35`); reject a whitespace-only reason.

**Acceptance**
- Writing a risk scoped to `c99` on a three-criterion thread is refused, and the error lists
  `c1, c2, c3, thread`.
- `record_decision` on a `done` thread is refused.
- `bind_branch` on a `paused` thread leaves the pointer unset.
- `blocked -> paused` preserves `blocked_by` in the written record.
- Regression: a ledger containing a pre-existing out-of-range scope still **reads** (I3
  quarantine), and the briefing reports it as unresolvable rather than omitting it silently.

**Verify:** `npm test`; a migration dry-run against a copy of the `.windful-ocean` ledger
reporting how many stored records would now be refused on write.

**PR title:** `fix(guards): apply the terminal, pointer and scope guards uniformly`

---

### MSP-4 — Repair the lifecycle and reconcile the skills

**Attacks:** instruction drift. **Closes:** critical 8, the `paused -> paused` incident, and the
ten skill/server divergences.
**Depends:** MSP-1. **Version:** 0.4.0.

**Changes**
- `src/tools/transition-thread.mjs:17-18`: a transition to the **current** status is an idempotent
  success, not an error.
- Add an explicit resume. Either `get_resume_brief` gains `resume: true` performing
  `paused -> active` and setting the pointer, or a dedicated `resume_thread` tool does it. Pick one
  and record the choice.
- `skills/preflight/SKILL.md`: add the resume tool to `allowed-tools`; fix `:17` — the roster field
  is `id`, not `thread_id` (`src/index/rebuild-index.mjs:44`).
- `skills/debrief/SKILL.md`: fix `:27` — `active_goal`, `next_step`, `last_session`, `open_risks`,
  `out_of_scope` nest under `spine`, while `replace_scopes` and `completion_criteria` are
  siblings; fix `:32` — `replace_scopes` is an object keyed by `open_risks` and `key_decisions`,
  not a flat list; fix `:34` — the parameter is `to_status`.
- Delete the now-false `'active -> paused'` assertion in `test/unit/skills/`.

**Acceptance**
- After `preflight` selects a thread, `ledger-cli active-thread` returns that thread's id, so the
  Stop gate at `hooks/lib/stop.mjs:101-104` arms for the first time in the normal flow.
- `transition_thread(paused -> paused)` returns success.
- A test asserts every parameter name appearing in either SKILL.md exists in the corresponding
  `inputSchema`. This test is the durable guard against drift returning.

**Verify:** `npm test`; a manual end-to-end preflight-then-debrief against a temp ledger.

**PR title:** `fix(lifecycle): make the documented resume path executable in the server`

---

### MSP-5 — The missing read surface

**Attacks:** C3 (cause). **Closes:** the 8 identifier-invisibility defects.
**Depends:** MSP-1. **Version:** 0.5.0. Additive.

**Changes**
- New `list_threads` (`src/tools/list-threads.mjs`): no required arguments, optional
  `{status, slug, limit=20}`, declared `outputSchema`. Returns the roster
  `src/index/rebuild-index.mjs:45-54` already builds, and resolves a slug to a ULID from the
  by-slug map at `:64`. This makes `/preflight <slug>` resolvable in-protocol.
- New `get_thread` with `view: 'spine' | 'criteria' | 'full'`, default `spine`. This is how a model
  re-reads criterion ids without a write.
- `preflight` calls `list_threads` instead of inferring the roster from injected hook text.

**Acceptance**
- A session that has lost a `thread_id` can recover it from `list_threads` alone.
- `get_thread(view:'criteria')` returns under 1,000 bytes for a seven-criterion thread.
- `/preflight <slug>` resolves without the model guessing an id.

**Verify:** `npm test`.

**PR title:** `feat(read): add list_threads and get_thread so identifiers survive the session`

---

### MSP-6 — Effect reports and typed results

**Attacks:** C3. **Closes:** criticals 1 and 2, the 11 silent-success defects, and the
6,269-byte return cost.
**Depends:** MSP-5. **Version:** 0.6.0. Breaking: return shape.

**Changes**
- Declare `outputSchema` on all tools and return `structuredContent`, per the MCP spec
  (`modelcontextprotocol.io/specification/2026-07-28/server/tools`).
- Mutating tools return an **effect report**, not the record:
  `{thread_id, status, updated_at, changed: {<field>: {added, removed, carried, replaced_scopes}}, warnings[], durability{}}`.
  Removals are first-class visible entries.
- `out_of_scope` joins `SCOPED_SPINE_FIELDS` (`src/tools/spine-input.mjs:10`) and `replaceScopesInput`,
  so wholesale replacement requires explicit intent (critical 2).
- `get_resume_brief` stops consuming the drift snapshot: split `takeDriftSnapshot` into a peek and
  an explicit acknowledge, and only acknowledge on a call that declares it (critical 1).
- Declare tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Treat them as
  advisory hints only, never as a security control — the spec is explicit that they are not
  guarantees.

**Migration:** the returned shape changes. `skills/debrief` and `skills/preflight` are updated in
the same PR. No on-disk change.

**Acceptance**
- A call that removes two key decisions returns `removed: ['0007-x','0008-y']`.
- A second `get_resume_brief` on the same thread returns the same drift section as the first.
- `update_thread`'s return for a realistic large thread measures under 1,200 bytes, down from the
  measured 6,269.

**Verify:** `npm test`; a byte-size assertion test on the return payload.

**PR title:** `feat(results): return typed effect reports instead of the whole record`

---

### MSP-7 — One schema of record

**Attacks:** C1. **Closes:** the 37 validation-coherence defects.
**Depends:** MSP-3, MSP-6. **Version:** 0.7.0. Breaking: record schema.

**Changes**
- `src/schema/thread.schema.mjs` becomes the single normative definition. Move in: the ten
  `SPINE_CAPS` as `maxLength`/`maxItems`; the `RISK_SENTENCE` pattern from `spine-input.mjs:5`;
  `maxLength: 120` on `decisionItem.title`; the 200-char criterion cap; a thread slug `pattern`;
  trim-aware non-blank rules for `abandoned_reason` and `closure_statement`; `$` anchors on
  `ISO_TIMESTAMP_PATTERN`; one digit-width for `DECISION_REF_PATTERN`.
- Add conditional requirements as `if/then`: `status === 'done'` implies non-empty
  `closure_statement`; `status === 'blocked'` implies non-empty `blocked_by`.
- `caps.mjs` and `spine-input.mjs` stop **owning** constraints; per-tool `inputSchema` fragments
  derive from the same exported constants. A cap cannot exist in one layer and not another.
- **Read-path quarantine.** A record that fails validation on read is returned marked
  `quarantined` with the violation list, not thrown. A teammate's bad record degrades one thread,
  never the session.
- `listThreads` upcasts like `readThread` does (`local-driver.mjs:155-164` vs `:143-145`).
- Fix the upcast defects: v1 empty-string risks and out-of-scope entries; `RISK_SENTENCE`
  violations manufactured by the upcast.

**Migration (mandatory, in this PR):** `scripts/migrate-ledger.mjs` — dry-run by default, reports
every stored record that would newly fail, and normalizes what it can (whitespace, missing anchors)
without changing meaning. Proven against a **copy** of the `.windful-ocean` ledger. Never run
against a live ledger by an agent.

**Acceptance**
- A single test enumerates every constraint constant and asserts it is reachable from
  `thread.schema.mjs`. A cap that exists only in a handler fails this test.
- A deliberately corrupt thread file reads back `quarantined` and the session continues.
- The migration dry-run against a copy of the real ledger reports zero unresolvable records, or
  the SPEC's owner ratifies each exception.

**Verify:** `npm test`; migration dry-run output attached to the PR.

**PR title:** `refactor(schema): make the record schema the single definition of valid`

---

### MSP-8 — Transactions and reservation

**Attacks:** C2. **Closes:** critical 6 and the 14 transaction defects.
**Depends:** MSP-2, MSP-7. **Version:** 0.8.0. Breaking: driver contract.

**Changes**
- `src/drivers/storage-driver.mjs`: `async transaction(fn)` buffering every write as
  `{path, contents}` plus deletes, flushing nothing until `fn` resolves. `LocalDriver` implements
  it as: take the ledger lock, run `fn` against the buffer, re-verify every read-modify-written
  thread's `rev` against disk, flush all buffered atomic writes, commit. Any throw before flush
  leaves zero bytes changed.
- Every write ladder moves inside one transaction: `transition-thread.mjs:39-46`,
  `archive-thread.mjs:24-29`, `reopen.mjs:28-30`, `open-thread.mjs:18-20`,
  `record-decision.mjs:66-77`, `bind-branch.mjs:13-15`.
- The active-thread pointer joins the same unit of work: move `src/util/active-thread.mjs` behind
  the driver.
- **Reserve before use.** `nextDecisionNumber` claims its number by exclusive file create
  (`wx` flag), not read-max-then-increment. Same for thread slugs: uniqueness checked and claimed,
  not derived and hoped.
- Add a `rev` field to the thread record; a write whose `rev` no longer matches disk is refused
  with `retryable:true` and a re-read instruction.

**Acceptance**
- Two concurrent `record_decision` calls against one ledger produce two distinct numbers. Test
  drives real concurrency, not a mock.
- A write injected to fail at step three leaves the ledger byte-identical to before.
- A stale-`rev` write is refused rather than silently overwriting.

**Verify:** `npm test`, including a concurrency test.

**PR title:** `feat(driver): give every mutation a transaction and a reserved identifier`

---

### MSP-9 — Worktree custody

**Attacks:** storage custody. **Closes:** critical 4 and 9 related defects.
**Depends:** MSP-8. **Version:** 0.8.1. Non-breaking.

**Changes**
- Split `GitRefDriver#ensureWorktree` (`git-ref-driver.mjs:343-352`) into `#verifyWorktree()` —
  `resolveGitDir` succeeds **and** `git worktree list` names this path **and** HEAD resolves — and
  `#provisionWorktree()` (`:354-359`), the only destructive path, which runs **only** when
  verification fails. `init()` (`:309-319`) calls verify-then-repair, never unconditional `rm -rf`.
- New `src/drivers/state-store.mjs` backed by `<CLAUDE_PLUGIN_DATA>/<projectKey>/state/`. Route
  `readIndexFile`/`writeIndexFile`/`deleteIndexFile` (`local-driver.mjs:252-276`) there for both
  drivers. The derived index and the briefing pledge are per-machine and already gitignored; they
  must not live somewhere a `rm -rf` destroys them with nothing to rebuild from.
- Fix the lock: it currently wraps only the deletion and gives up silently after ten seconds.

**Acceptance**
- Starting a second server process while the first has uncommitted writes destroys nothing.
- The by-slug index survives a process restart on the git backend, so slug reattachment works.
- The verbatim-gate pledge survives a process restart.

**Verify:** `npm test`; a two-process test asserting the first process's writes survive.

**PR title:** `fix(storage): verify and repair the worktree instead of recreating it`

---

### MSP-10 — Trust boundary

**Attacks:** injection. **Closes:** criticals 9 and 10 and 7 further defects.
**Depends:** MSP-1. **Version:** 0.8.2. Non-breaking.

**Changes**
- One sanitizer at the render boundary. Add `field(value, max)` to `src/render/briefing.mjs`,
  replacing `truncate` (`:9-12`): collapse `\r\n`, `\n`, `\r`, tabs and non-breaking spaces to a
  single space; strip leading runs of `#`, `-`, `>`, `*` and backticks; then truncate.
- Apply it to **every** interpolated value with no exception: title (`:45`, today untruncated),
  criterion text (`:78`), risk text and refs (`:93`, `:98`), decision title (`:125`), out-of-scope
  entries (`:133`), child and predecessor slugs (`:142-143`), and the drift block (`:62-65`), which
  today interpolates `classification`, `branch`, `code` and `detail` with **no truncation at all**.
- Same treatment in `hooks/lib/roster.mjs:33` for slug, title and id.
- **Provenance fencing.** Wrap all ledger-sourced regions in an explicit delimiter that marks them
  as stored data, not server-authored instruction, and say so in the briefing preamble.
- `read_decision` (`src/tools/read-decision.mjs:10-13`) returns raw file content: fence it and mark
  its provenance the same way.
- Harden the Stop gate: `hooks/lib/stop.mjs:87` accepts substring containment, so a message that
  merely quotes the briefing satisfies it; and `:67-73` swallows every read error into an empty
  array, so an unreadable transcript passes silently. Both become explicit.

**Acceptance**
- A thread title containing `\n## SYSTEM` renders as one line with the marker stripped, and cannot
  forge a heading.
- The drift block truncates.
- A test asserts no interpolation site in `briefing.mjs` or `roster.mjs` bypasses `field()`.
- An unreadable transcript fails the Stop gate rather than passing it.

**Verify:** `npm test`, including an injection corpus of hostile field values.

**PR title:** `fix(render): sanitize and fence every ledger-sourced string`

---

### MSP-11 — Multi-user safety

**Attacks:** multi-user. **Closes:** critical 3 and 5 further defects.
**Depends:** MSP-8, MSP-9. **Version:** 0.9.0. Breaking: merge semantics.

**Changes**
- Replace `-X theirs` (`git-ref-driver.mjs:490`) with a record-aware merge driver registered
  through `.gitattributes` alongside the existing `sessions/**/*.md merge=union` (`:28`). It merges
  `threads/*.json` and `bindings/*.json` field by field: spine arrays unioned by ref or text,
  scalars resolved by `updated_at`. When it genuinely cannot decide, it writes both sides and marks
  the record conflicted, surfacing through MSP-7's quarantine channel. **Never silently drop a
  local hunk.**
- Surface the merge. `sync()` already returns `{merged: true}` (`:440`) and both call sites discard
  it — `hooks/lib/session-start.mjs:98` and `hooks/lib/stop.mjs:106`. Report it.
- Binding portability: stop storing absolute repository paths that exist only on the authoring
  machine.
- `reconcile`: stop rewriting other users' bindings from observations made against whatever
  repository sits at `binding.repo` on **this** machine (`src/drift/reconcile.mjs:53-63`); stop
  auto-creating bindings matched by branch **name** across arbitrary repos.

**Acceptance**
- A concurrent edit by two users to different fields of one thread merges without loss.
- A conflicting edit surfaces as conflicted, never as a silent overwrite.
- `reconcile` on a machine that does not host a bound repository leaves that binding untouched.

**Verify:** `npm test`, including a two-clone merge test.

**PR title:** `fix(sync): merge ledger records field-wise instead of taking theirs`

---

### MSP-12 — Cost and capacity

**Attacks:** cost. **Closes:** the 10 cost defects.
**Depends:** MSP-6. **Version:** 0.9.1. Non-breaking.

**Changes**
- Stop rebuilding the whole index on every write. Make it incremental, or debounce it to the
  operations that need it.
- Bound every return. Adopt MCP cursor pagination for `list_threads` and any listing that can grow.
  Claude Code warns above 10,000 tokens of tool output and hard-caps at 25,000.
- Bring every tool description under the 2KB Claude Code truncation limit, with the load-bearing
  constraint stated in the **first** sentence. `update_thread`'s description (`:130`) is the
  primary offender.
- Add a test asserting the combined size of all `tools/list` descriptions stays under budget.

**Acceptance**
- No description exceeds 2,000 characters; the test enforces it.
- A 500-thread synthetic ledger completes a `record_decision` in the same order of magnitude as a
  17-thread one. Measure and record both.

**Verify:** `npm test`; a recorded benchmark at 17, 100 and 500 threads.

**PR title:** `perf(server): bound every return and stop rebuilding the index per call`

---

### MSP-13 — Release 1.0.0

**Depends:** all. **Version:** 1.0.0.

**Changes**
- Bump both version files to `1.0.0`.
- `README.md`: document the tool surface, the error contract, the trust boundary, and the
  migration path from `0.2.x`.
- `docs/audits/2026-08-04-mcp-audit.md`: mark every defect closed, with the MSP that closed it.
  Any defect **not** closed is listed explicitly with the reason and a decision record.
- `CHANGELOG.md` covering 0.2.0 through 1.0.0.

**Acceptance**
- Every one of the 121 defects is either closed or explicitly deferred with a recorded decision.
  No defect is silently dropped.
- `node scripts/check-packaging.mjs` passes; both version files read `1.0.0`.

**Verify:** `npm test`; full-suite run, not diff-scoped.

**PR title:** `chore(release): logbook 1.0.0`

---

## 8. Stacked PR protocol

Review latency must never stall implementation. If MSP-N's PR is open and unmerged, MSP-N+1
proceeds on a branch based on MSP-N's branch. This is explicit direction: **do not idle waiting
for a merge.**

### Rules

1. **One PR per MSP.** Never bundle two MSPs into one PR, even when the second is small.
2. **Branch naming:** `msp-<NN>/<short-slug>`, e.g. `msp-01/legible-refusals`.
3. **Base selection.** Base MSP-N+1 on `main` if its dependencies are merged; otherwise base it on
   the branch of its nearest unmerged dependency. Record the base in the PR body's Links section as
   `stacked-on: <branch>`.
4. **Retarget on merge.** When a parent merges, rebase the child onto `main` and retarget the PR
   base to `main` in the same action. Do this promptly; a stack deeper than three is a smell.
5. **Depth cap.** Never stack more than **four** deep. At four, stop opening new PRs and report the
   blockage to the user rather than building a tower.
6. **Each PR stands alone against its own base.** `npm test` passes on the PR branch as it exists,
   not only after the parent merges. A PR that is green only in combination is not an MSP.
7. **Conflict ownership.** The child rebases onto the parent. Never force-push a parent branch to
   accommodate a child. Force-pushing a shared branch requires explicit user confirmation.
8. **Merge is human-gated.** Open PRs autonomously; never merge. `gh pr merge` and its GraphQL and
   MCP equivalents stay denied.

### PR body (mandatory fields)

Every PR carries:

- `--why` — the defect class and its cost, citing the audit id.
- `--what` — one behavioral change per flag.
- `--verified` / `--not-verified` — **checks actually run**. A check not run is
  `--not-verified "<thing> - not run"`. Never a placeholder, never `TBD`.
- `--origin machine --provenance "agent=<label> model=<model>"` when opened by an agent.
- `--link "stacked-on: <branch>"` when stacked; `--depends <msp ids>`.

### Title grammar

`<type>(<scope>): <lowercase imperative summary>` — Conventional Commits, max 72 characters, scope
max 16 characters, no trailing period. The PR title becomes the squash commit subject.

---

## 9. Sequencing

```
MSP-0 ─┬─> MSP-0B ──────────────────────────┐  (gates 7, 9, 11 only)
       │                                    │
       └─> MSP-1 ─┬─> MSP-2 ────────────────┤
                  ├─> MSP-3 ──┐             │
                  ├─> MSP-4   │             │
                  ├─> MSP-5 ──┼─> MSP-6 ────┼─> MSP-7 ──> MSP-8 ─┬─> MSP-9 ──> MSP-11
                  └─> MSP-10  │             │                    │
                              └─> MSP-12 ───┴────────────────────┴─> MSP-13
```

**Critical path:** 0 → 1 → 5 → 6 → 7 → 8 → 9 → 11 → 13.
**Parallelizable at any time after MSP-1:** MSP-3, MSP-4, MSP-10.
**MSP-0B runs concurrently with MSP-1 through MSP-6** and gates only MSP-7, MSP-9 and MSP-11.
It ships no production code, so it never blocks the branch.

MSP-1 comes first because it is non-breaking, closes the incident's root cause, and every later
MSP's error surface depends on its shape.

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| MSP-7's schema tightening rejects records in the live `.windful-ocean` ledger | Migration dry-run against a **copy** is a merge gate. An agent never touches the live ledger. |
| This repo is the installed plugin (I7) | Never verify by observing this session's ledger. Verify against temp ledgers in a scratchpad. |
| MSP-8's transaction refactor touches every handler | It depends on MSP-7's single schema so there is one validation choke point to call. Ship it alone; do not bundle. |
| A stacked tower grows past review capacity | Depth cap of four, then stop and report. |
| The audit artifact is in a temp directory and may vanish | MSP-0 commits it before anything else. |
| MSP-7, MSP-9 and MSP-11 are specified from partial knowledge of `drift`, `upcast` and `GitRefDriver` | MSP-0B audits exactly those three areas and gates those three MSPs. It ships no code, so MSP-1 through MSP-6 proceed in parallel. |
| Payload sizes were measured on `LocalDriver`, but the deployed backend is `GitRefDriver` | MSP-0B re-measures on both; MSP-6 and MSP-12 acceptance criteria must be met on the git backend. |
| An implementing agent restates a defect instead of reading it | The evidence law in section 2 is binding; a PR body without `file:line` citations is rejected in review. |

---

## 11. Out of scope

- Any change to the thread lifecycle model beyond making the documented resume path executable.
- A new storage backend, or migrating away from git-ref storage.
- `bin/ledger-cli.mjs` beyond what a server change forces.
- The hooks installer, prior-hooks-path healing, and packaging scripts, except MSP-13's version bump.
- The `.mitosis/` plan corpus.
Not out of scope, but explicitly deferred to MSP-0B rather than assumed clean: `src/drift/*`
internals, `src/schema/upcast.mjs` beyond the two defects named in MSP-7, and `GitRefDriver`
return-shape measurements. Every payload size stated elsewhere in this SPEC was measured against
`LocalDriver` only and is re-measured in MSP-0B.
