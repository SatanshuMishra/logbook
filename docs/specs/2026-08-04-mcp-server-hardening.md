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

Seventeen MSPs. Each is independently shippable: merging it leaves `main` green and the plugin
working. Later MSPs assume earlier ones only where the Depends column says so.

Three are corrective siblings added during execution rather than at approval. A letter suffix means
the parent shipped but its premise or its output did not hold, and the letter advances with each
successive correction of the same parent: MSP-0B closes an audit coverage gap (decision 0029),
MSP-1B repairs MSP-1's error contract after a review found it defective (decision 0034), and MSP-1C
repairs the one C4 defect MSP-1B's own review left open (decision 0035).

### Version policy

`0.x` semantics: minor bumps carry breaking changes, patch bumps do not.

| MSP | Version after | Breaking |
| --- | --- | --- |
| MSP-0 | 0.2.0 (unchanged) | no |
| MSP-0B | 0.2.0 (unchanged) | no |
| MSP-1 | 0.2.1 | no |
| MSP-1B | 0.2.2 | no |
| MSP-1C | 0.2.3 | no |
| MSP-2 | 0.2.4 | no |
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
- Write results to `docs/audits/2026-08-04-mcp-audit-supplement.json`, a NEW sibling artifact.
  **Amended during execution, on orchestrator direction.** This bullet originally said to append a
  `supplement` key into `docs/audits/2026-08-04-mcp-audit.json`. That file is byte-frozen: section 2
  records its sha256 `56deb0a7…` as proof the committed copy is byte-identical to the original
  workflow output, and re-serializing it to add a key destroys exactly that provenance. The sibling
  file mirrors the original's `.result` shape so both are queryable the same way, and every
  supplement id carries a `sup-` prefix so it can never collide with the 121 existing ids.
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

**Status: shipped, and corrected by MSP-1B.** PR #37, squash-merged to `main` as `dfbebf4` on
2026-08-04. A code review of the merged diff found the contract it introduced defective on five
counts; it does **not** close C4 as written. MSP-1B below carries the repair. Read that section
before building on anything in this one.

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

### MSP-1B — Repair the refusal contract

**Status: reviewed and open as PR #40 at `48fabab`; its value rendering is corrected by MSP-1C.**

**Attacks:** C4, which MSP-1 did not actually close. **Closes:** five review-confirmed defects in
MSP-1's own output, plus the missing error-code registry.
**Depends:** MSP-1. **Version:** 0.2.2. Non-breaking: error content and a bounded record.
**Gates:** MSP-2, MSP-3, MSP-4 and MSP-5, each of which declares `Depends: MSP-1 (for the error
shape)`. **MSP-10 is not gated** — it touches `src/render/briefing.mjs` and `hooks/lib/*`, neither
of which consumes the error contract.

**Why.** A code-reviewer pass on `dfbebf4` returned a BLOCK verdict. Three findings were
independently re-verified against the code before this section was written; two were reported and
are recorded as such rather than as established fact. The governing failure is that the suite
passed 879/879 with both the field and the retryability wrong: `test/unit/tools/refusals.test.mjs:162-171`
asserts `expected` and never `field`, and the corpus loop at `:231-241` asserts that `retryable` is
a boolean rather than that it is correct. A contract four later MSPs inherit cannot rest on
assertions that weak.

**Changes**
- **Verified.** `src/tools/shared.mjs:43-55` hardcodes ``field: `${tool}.to_status` ``, but
  `archive_thread` (`src/tools/archive-thread.mjs:13`, schema `{thread_id, reason}`) and `reopen`
  (`src/tools/reopen.mjs:25`, schema `{thread_id}`) have no such parameter. Take the field as an
  argument: `illegalTransition(tool, field, from, to)`.
- **Verified.** Same function, `:52` pins `retryable: false` even when `ALLOWED_TRANSITIONS` leaves
  outgoing targets, so a `blocked` thread is told no retry can succeed when one
  `transition_thread(blocked -> paused)` makes the identical payload work. Set
  `retryable: targets.length > 0` and give the concrete two-hop repair as the remedy. Its siblings
  `not_terminal` (`src/tools/create-successor.mjs:13-19`) and `dod_unmet`
  (`src/tools/transition-thread.mjs:47-54`) already classify this shape correctly.
- **Verified.** `src/errors.mjs:145-158` renders every non-`LedgerError` throw as `layer: server`,
  `retryable: false`, remedy "do not re-send the same call" — including caller-caused faults such as
  `src/model/thread.mjs:58`, where a title yielding no slug is answered by telling the agent to stop
  rather than to pass an explicit `slug`. Convert the reachable caller-caused throws in
  `src/model/thread.mjs` and `src/model/binding.mjs` into `ToolError`s; keep `toLedgerError` as the
  last resort and soften its blanket remedy.
- **Reported, not re-verified here.** Failed `anyOf`/`oneOf` sibling branches survive
  `WRAPPER_KEYWORDS` (`src/schema/error-projection.mjs:14`, `:164`), so `record_decision` with
  `options: [1, 2]` is told to re-send its legal array as a string. Filter on ajv's `schemaPath`.
- **Reported, not re-verified here.** The `content[1]` record is unbounded:
  `MESSAGE_MAX_CHARS` bounds only `message`, while `toDetail()` (`src/errors.mjs:125-138`) emits one
  entry per ajv error. Reported as 277,981 bytes on a 1,200-error payload against 82,140 pre-MSP-1.
  Cap `problems` and carry the counts. **Amended during execution:** this originally said to carry
  `truncated` and to drop the duplicate serialization of `problems[0]`. The shipped shape instead
  carries `shown` and `total` and always emits `problems`, so a single-problem refusal does
  serialize `problems[0]` twice. `truncated: true` was ambiguous — it meant both "4 of 1200 shown"
  and "0 of 1200 shown", separable only by key presence — and an explicit `shown` count says which.
  Uniform shape beat de-duplication because MSP-6's typed results must model one record shape, not
  three. The contract MSP-6 inherits is `{problems, shown, total}` on every refusal.
- Export a frozen `LEDGER_ERROR_CODES` beside `LEDGER_ERROR_LAYERS` (`src/errors.mjs:1-7`), validate
  `code` in `normalizeProblem`, and assert membership. Roughly 28 code literals exist across 11
  files with no enum; without this, MSP-2, 3, 4, 5 and 10 each mint codes independently.

**Acceptance**
- `archive_thread` and `reopen` refused on a `blocked` thread name `thread_id`, not `to_status`.
- That same refusal carries `retryable: true` and a remedy naming the intermediate transition.
- `record_decision` with `options: [1, 2]` emits no problem claiming `options` expects a string.
- The rendered refusal record is bounded by a named constant on a 1,200-error payload.
- A title that yields no slug is not reported as `layer: server`.
- Every `code` a refusal can carry is a member of `LEDGER_ERROR_CODES`.
- Each of the six lands with an assertion that is **red against `dfbebf4`** and green after. This
  is the acceptance criterion that matters: the defects shipped green once already.

**Verify:** `npm test`, reporting real counts against the 879/879 baseline on `8228c94`.

**PR title:** `fix(errors): repair the refusal contract before the ladder builds on it`

---

### MSP-1C — Make the refusal name the key that was actually sent

**Attacks:** C4, which MSP-1B narrowed but did not close. **Closes:** the invisible-character echo
defect its own final review found, plus the same defect class at ten further echo sites.
**Depends:** MSP-1B. **Version:** 0.2.3. Non-breaking: refusal text only.
**Gates:** nothing. MSP-2, MSP-3, MSP-4 and MSP-5 depend on MSP-1B for the error *shape*, which
this does not touch.

**Why.** `collapse` (`src/errors.mjs:59`) rewrites every run of
`[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\s]` to a single space, and it runs inside both `clip` and
`requireText`, so every caller value quoted into a refusal lost its invisible characters before the
agent read it. U+200B, U+0085, U+202E, U+00AD, U+2028, U+2029, U+00A0 and U+FEFF all rendered as
the identical field `open_thread." "` with remedy `remove " " and re-send`. U+0000 was the sole
member that worked, and only incidentally: `JSON.stringify` escapes it to an ASCII sequence
`collapse` cannot touch. Worse than indistinguishable, a mixed name `op<U+202E>en_x` rendered as
`remove "op en_x" and re-send` — a plausible but wrong key, so an agent removes `op en_x`, re-sends
the identical failing call, and loops. That is the three-attempt failure this SPEC exists to end,
reproduced by the very contract written to end it.

**Changes**
- Export `echo(value, max)` from `src/errors.mjs`: `JSON.stringify` first, then escape each UTF-16
  code unit of a maximal `[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]` run to `\uXXXX` unless the run is
  exactly one U+0020, then bound the result over an atom stream so a cut never splits a `\uXXXX`
  token, a `\"` pair or a surrogate pair. Stringify-then-escape is the required order: escaping
  first would double the backslash and echo a literal `\\u200b`.
- Route every site that quotes caller data through it — `error-projection.mjs:57` and `:83`,
  `shared.mjs` (`unknownThread`, `unknownCriterion`), `read-decision.mjs`, `registry.mjs`,
  `spine-input.mjs` (scope, unknown `replace_scopes` keys, risk text, decision ref, restated entry
  and title) and `amend-criteria.mjs`. `clipEntry` is subsumed and deleted.
- Extend `sliceWholeCharacters` so the downstream `FIELD_MAX_CHARS`, `REMEDY_MAX_CHARS` and `fit`
  cuts cannot leave a half-written `\u20` behind.

**Acceptance**
- Two governing invariants: `collapse(echo(v)) === echo(v)` for every `v` — the echo is a fixed
  point of the function that destroyed it — and distinct values never collide.
- Each of U+200B, U+0085, U+202E, U+00AD, U+2028, U+2029, U+00A0, U+FEFF and U+0000 names a
  distinct, identifiable field.
- `op<U+202E>en_x` echoes a value that JSON-parses back to the exact key sent, and is not
  `remove "op en_x" and re-send`.
- An ordinary spaced value is **not** escaped: `"ship the thing"`, never `"ship the thing"`.
  Over-escaping is a legibility regression on the common path and fails this MSP as surely as
  under-escaping.
- A 26-character ULID still echoes in full.
- `test/unit/tools/refusals.test.mjs` no longer asserts `open_thread." "` as correct. That
  assertion pinned the defect and would have certified a broken fix.
- Each defect assertion is red against `48fabab` and green after. The three regression guards — no
  over-escaping, no truncation of a legitimate value, the fixed point — are green on the parent by
  construction and are labelled guards, not detectors.

**Verify:** `npm test`, reporting real counts against the 923/0 baseline on `48fabab`.

**PR title:** `fix(errors): make a refusal name the key that was actually sent`

---

### MSP-2 — Validate before you write

**Attacks:** C2 (ordering half). **Closes:** criticals 5 and 11's write-ordering component, plus
the partial-write ghost-thread defects.
**Depends:** MSP-1B (for the error shape). **Version:** 0.2.4. Non-breaking.

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
**Depends:** MSP-1B. **Version:** 0.3.0 — tightens accepted input, so minor per policy.

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
- **Added during execution (MSP-1B final review, 2026-08-04). Read this before adding any union.**
  `disagrees` in `src/schema/error-projection.mjs:204` demotes a branch on **any** `const`/`enum`
  error anywhere in its subtree, not only on a discriminator. It is inert today because the one
  shipped `anyOf` (`record_decision.options`) has `array`/`string` branches with no enum, and
  `amend_criteria` uses `if`/`then`, which forms no branch container. The first union with an
  enum-bearing branch trips it silently: a caller sending the *correct* branch with a bad enum value
  has that branch demoted and is guided into the wrong one, with the real problem suppressed. Gate
  it on the const/enum error's `instancePath` matching the branch container's own instance depth.
- **Scope validity (critical 7).** Validate `scope` against the thread's actual criterion ids, not
  only `WRITABLE_SCOPE_PATTERN`. Refuse an unknown scope with a `retryable:false` error listing
  the valid ids.
- `archive_thread`: make its description match its code, or its code match its description
  (`archive-thread.mjs:25` vs `:35`); reject a whitespace-only reason.
- **Added during execution (probe run against MSP-1B, 2026-08-04).** `minLength: 1` counts raw
  string length, so a value made entirely of invisible characters is accepted while rendering as
  nothing. Verified: `open_thread` with a criterion whose text is only U+202E succeeds, storing a
  criterion that displays as empty. Every `minLength: 1` field must be validated on its *collapsed*
  length, using the same widened class MSP-1B gave `collapse`
  (`/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\s]+/gu`). This is the storage-side half of MSP-10's bidi
  concern: MSP-10 stops a hostile value from rendering deceptively, this stops it being stored.

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
**Depends:** MSP-1B. **Version:** 0.4.0.

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
**Depends:** MSP-1B. **Version:** 0.5.0. Additive.

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
  MSP-0B narrowed the reason: for a well-formed v1 record the roster entry `rebuild-index.mjs:45-54`
  builds is **byte-identical** either way, because `criteriaProgress` is accidentally v1-tolerant
  (`selection.mjs:9` collapses an absent `struck_by` through `??`, and `:27` counts an absent `kind`
  as planned). The divergence is real only for a v1 `completion_criteria` holding a bare string —
  where `listThreads` lists the thread as resumable while `upcastThread` **throws**
  (`upcast.mjs:14-16`) in all eleven `readThread` call sites — and for hybrid records carrying
  `struck_by` or `kind`, which the upcast discards.
- Fix the upcast defects. **Amended by MSP-0B: this MSP assumed two. There are at least seven, and
  this MSP's own schema consolidation manufactures seven more.** See
  `docs/audits/2026-08-04-mcp-audit-supplement.json`, ids `sup-upcast-*`. The full list:
  - `upcastDecision` copies the v1 string verbatim into `ref` (`upcast.mjs:55`) while the regex at
    `:6` gates only the *title*, so any v1 `key_decisions` entry that is free text, uppercase, or
    not `NNNN-lower-kebab` upcasts into a record `DECISION_REF_PATTERN` refuses
    (`thread.schema.mjs:28`). The thread still reads; it can never be written again.
  - `unkebab('')` returns `''` (`upcast.mjs:34-35`), so an empty-string v1 decision also violates
    `decisionItem.title minLength: 1` (`thread.schema.mjs:29`).
  - `upcastSpine` spreads `...rest` (`upcast.mjs:69`), carrying every unknown v1 spine key past
    `additionalProperties: false` (`thread.schema.mjs:98`); and it defaults only `last_session`,
    `open_risks`, `key_decisions`, `out_of_scope` (`:70-73`), never the equally required
    `active_goal` and `next_step` (`thread.schema.mjs:99`).
  - `upcastThread` spreads `...record` at `:84` against the root's own
    `additionalProperties: false` (`thread.schema.mjs:37`).
  - `upcastCriterion` copies `item.text` with no guard (`upcast.mjs:20`), and `upcastCriteria`
    returns `[]` for a non-array (`:28`), silently and permanently discarding every criterion.
  - `upcastThread` returns the record raw and unvalidated whenever `schema_version !== 1`
    (`:82`) — absent, `0`, `3` and the string `"1"` all pass straight through `readThread`
    (`local-driver.mjs:143-145`) to every tool.
  - The upcast hardcodes `id` positionally, `kind: 'planned'` and `struck_by: null`
    (`upcast.mjs:19,22,23`), so one read-modify-write silently renumbers criterion ids that
    `risk.scope` and `decision.scope` point at (`patterns.mjs:22`) and un-strikes struck criteria.
- **Cap consolidation manufactures new upcast violations.** Moving `SPINE_CAPS` into the schema
  newly invalidates values the upcast produces today: decision titles from long v1 slugs
  (`upcast.mjs:56`) exceed `decisionTitleMaxChars: 120` (`caps.mjs:9`); passthrough `active_goal`,
  `next_step` and `last_session` exceed their caps; criterion text exceeds
  `CRITERION_TEXT_MAX_CHARS` (`patterns.mjs:16`); and because `upcastRisk` forces every v1 risk to
  `scope: 'thread'` (`upcast.mjs:44`) a v1 thread with more than 20 risks breaks
  `openRisksMaxPerScope` (`caps.mjs:5`). Two existing tests assert the current permissive behavior
  and must change in this PR: `test/unit/schema/upcast.test.mjs:124-129` and `:131-137`.
- **`assertSpineCaps` is checked against the patch, not the merged spine** (`update-thread.mjs:77`
  passes `submitted`), so an over-cap value the upcast produced survives every write today. The
  single choke point this MSP builds must validate the merged record.
- **`scope: 'legacy'` is unremovable.** `upcastDecision` sets it (`upcast.mjs:57`) and
  `assertWritableScope` refuses it on every write path (`spine-input.mjs:12-19`), while
  `replaceScopedItems` carries every unnamed scope forward (`update-thread.mjs:64-68`). Upcast
  decisions are immortal and permanently constrain `out_of_scope` through
  `assertNoRestatedDecision` (`update-thread.mjs:70-76`). The migration must provide the exit.

**Migration (mandatory, in this PR):** `scripts/migrate-ledger.mjs` — dry-run by default, reports
every stored record that would newly fail, and normalizes what it can (whitespace, missing anchors)
without changing meaning. Proven against a **copy** of the `.windful-ocean` ledger. Never run
against a live ledger by an agent.

**Acceptance**
- A single test enumerates every constraint constant and asserts it is reachable from
  `thread.schema.mjs`. A cap that exists only in a handler fails this test.
- **Round-trip (added by MSP-0B).** For every v1 shape in the corpus, `writeThread(upcastThread(r))`
  succeeds. A record that reads but cannot be written back is the defect class this MSP closes, and
  it is the one the first audit did not measure.
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
  **Priority note from MSP-0B:** of the six index files, four — `by-slug`, `by-branch`, `children`,
  `resumable` — are recomputable by `rebuildIndex` (`rebuild-index.mjs:64-67`), which every mutating
  tool already calls. Only the **drift snapshot** and the **briefing pledge** have no rebuild path
  and are lost outright. If this MSP has to be cut down, those two are the whole point.
- Fix the lock. **Amended by MSP-0B: it is worse than "wraps only the deletion".** It gates
  *nothing*. `#ensureWorktree` calls `#provisionWorktree()` inside the `try` unconditionally
  (`git-ref-driver.mjs:346-351`); `locked` is consulted only at `:350` to decide whether to
  release. A failed or timed-out acquisition (`:62`, `:64`) still runs the `rm -rf`. Worse, the
  acquisition deadline and the staleness threshold are the same constant (`:34`, used at `:40` and
  `:56`), so a waiter force-removes a lock its holder is still using (`:66`) and then proceeds
  concurrently. The fix must make provisioning conditional on holding the lock, and must separate
  the two timeouts.
- **Added by MSP-0B: raise this MSP's priority.** The measured blast radius is larger than
  "critical 4 plus 9 related defects". Reproduced against temp ledgers
  (`docs/audits/2026-08-04-mcp-audit-supplement.json`, ids `sup-gitref-*`):
  - A second process's `init()` destroys the first's uncommitted writes outright. Process A wrote a
    thread and read it back; after B's `buildContext`, A could no longer read its own thread and
    `listThreads()` returned 0.
  - **The entire `src/drift` feature is non-functional end to end on the deployed backend.**
    `hooks/lib/session-start.mjs:98-100` runs `sync`, `reconcile` and `roster` as three separate
    processes (`hooks/lib/cli.mjs:17`), each calling `init()`. The `roster` process deletes the
    drift snapshot the `reconcile` process just wrote. Verified with the real binary: after
    `ledger-cli roster`, the index directory held only the four files `rebuildIndex` had written;
    `drift.json` was gone. So `get_resume_brief`'s `takeDriftSnapshot` can never see hook-produced
    drift, and MSP-6's fix to critical 1 is invisible until this MSP lands. **Reordering the hook
    does not fix it:** `bin/ledger-server.mjs:34-45` builds its context lazily on the first tool
    call, so the server's own `init()` runs after the hook and would delete the snapshot anyway. The
    state has to move out of the worktree.
  - **The verbatim gate can never fire.** `get_resume_brief` writes the pledge as an index file
    (`get-resume-brief.mjs:30`, `index-files.mjs:1`); `hooks/lib/stop.mjs:61` reads it through a
    separate CLI process whose own `init()` has already deleted it. Verified: `ledger-cli
    briefing-pledge` printed `null` immediately after a pledge was written. A null pledge silently
    passes the gate (`stop.mjs:80-81`). This is additive to critical 8, not the same defect — the
    active-thread pointer itself *does* survive, because `activeThreadPath` resolves to
    `<git-common-dir>/ledger/active-thread` (`util/active-thread.mjs:19-23`), outside the worktree.
  - Read paths cannot repair. Only `#writeInWorktree` (`:282-287`) can trigger provisioning; no read
    method is overridden, so `readJsonOrNull` returns null on ENOENT (`local-driver.mjs:60`) and
    `listDir` returns `[]` (`:69`). A destroyed ledger is indistinguishable from an empty one.
- **Added by MSP-0B: fixing custody exposes a masked defect.** `mergeDriftSnapshot`
  (`drift/snapshot.mjs:34-41`) never prunes: a resolved drift is carried forward forever because a
  clean branch produces no entry to replace it (`classification.mjs:90-92`). Today the `rm -rf`
  deletes the snapshot before it can go stale. Once the state store makes it durable, stale drift
  becomes permanently visible. Ship the pruning in this MSP, not after it.

**Acceptance**
- Starting a second server process while the first has uncommitted writes destroys nothing.
  **Falsifiable form (MSP-0B):** process A writes a thread without committing; process B runs
  `buildContext`; A's `readThread` still returns the thread and B's `listThreads()` returns 1.
- The by-slug index survives a process restart on the git backend, so slug reattachment works.
- The verbatim-gate pledge survives a process restart. **Falsifiable form (MSP-0B):** after
  `get_resume_brief`, `ledger-cli briefing-pledge` run as a separate process returns the pledge, not
  `null`.
- **Added by MSP-0B:** after the SessionStart sequence `sync; reconcile; roster` run as three
  separate processes, the drift snapshot written by `reconcile` is still readable.
- **Added by MSP-0B:** a drift entry whose branch no longer drifts is absent from the next snapshot.

**Verify:** `npm test`; a two-process test asserting the first process's writes survive; a
three-process test replaying the SessionStart `sync; reconcile; roster` sequence and asserting the
drift snapshot survives it.

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
- **Added during execution (review of MSP-1, 2026-08-04; corrected by the security review of
  MSP-1B).** The error surface is a second unfenced path to the model, distinct from the render
  boundary above. `toLedgerError` interpolates an arbitrary internal message into `expected`, so git
  stderr and absolute filesystem paths reach the model. MSP-1B bounds that text to 180 characters
  but deliberately does **not** stop the leak. Classify at the throw site instead of passing
  `error.message` through; at minimum replace `expected` with a constant and route the raw cause to
  stderr logging only. The widest source is **`src/util/git-exec.mjs:29-31`**, which builds
  ``git ${args.join(' ')} failed (exit ${code}): ${stderr}`` on every `check:true` call, carrying
  `-c safe.directory=<absolute repo dir>` (`src/util/git-scope.mjs:32`, `:86`) and
  `-c core.hooksPath=<absolute path>` (`src/util/git-env.mjs:66`). Also confirmed:
  `src/drivers/git-ref-driver.mjs:460`, `:471` (a hostile remote's `remote:` lines reach the model
  verbatim), `src/util/git-scope.mjs:55`, `:60`, `src/drivers/local-driver.mjs:82`. The 180-character
  bound does **not** protect a secret — a 39-character token survives intact. Modern git redacts URL
  userinfo itself, but the server borrows that property rather than owning it.
- **c6 scope correction.** c6 names the briefing, the SessionStart roster and `read_decision`. The
  **refusal path is a fourth channel** and is in scope: `src/tools/spine-input.mjs:153` interpolates
  a stored decision title, which in a git-synced ledger another user wrote; same shape at
  `src/tools/amend-criteria.mjs:38` and `src/tools/update-thread.mjs:104`. Structural forgery is
  already blocked — `collapse` strips `\s+`, so stored text cannot open a new `key: value` line —
  but inline semantic forgery within one line remains.
- **Harden `collapse` (`src/errors.mjs:56-58`).** It is now the sole containment for injection and
  the basis of `fit`'s byte accounting, but JS `\s` omits U+0085 NEL (a Unicode mandatory line
  break), U+001B ESC, U+0007, U+0000, U+200B, U+00AD, and the bidi controls U+202E and U+2066 —
  each verified to survive. Widen it to
  `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\s]+/gu`.
- **Quote every echoed value at the interpolation site.** `src/tools/spine-input.mjs` wraps echoes
  in `JSON.stringify`; `src/tools/registry.mjs:77`, `src/tools/shared.mjs:24`, `:71` and
  `src/tools/read-decision.mjs:15` do not, so an echoed value can imitate the server's own
  `key: value` grammar inline.

**Acceptance**
- A thread title containing `\n## SYSTEM` renders as one line with the marker stripped, and cannot
  forge a heading.
- The drift block truncates.
- A test asserts no interpolation site in `briefing.mjs` or `roster.mjs` bypasses `field()`.
- An unreadable transcript fails the Stop gate rather than passing it.
- A refusal carrying an internal failure does not expose an absolute filesystem path.

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
- **Amended by MSP-0B: the merge strategy is the whole defect; the push is not.** Critical 3 reads
  "merges `-X theirs` then force-pushes". The push at `:466` is
  `--force-with-lease=<ref>:<expectedRemoteSha>` against the exact sha the merge was computed from,
  and a remote that moved is rejected and retried (`:439`, `:470`), not overwritten. Replacing the
  push is unnecessary work; replacing `:490` is sufficient. Scope this MSP accordingly.
- **Amended by MSP-0B: the merge driver's surface is narrower than stated.** This MSP assumes the
  driver "must handle records `src/drift/*` produces". Only *bindings* qualify. Verified by
  `git ls-tree -r --name-only refs/heads/_ledger` on a temp ledger: `threads/`, `bindings/` and
  `decisions/` are tracked; `index/` is not, because `GITIGNORE = 'index/\n'`
  (`git-ref-driver.mjs:29`). Drift snapshots, the briefing pledge and the derived index never
  participate in a merge at all. Build the driver for `threads/*.json` and `bindings/*.json` only.
- Surface the merge. `sync()` already returns `{merged: true}` (`:440`) and both call sites discard
  it — `hooks/lib/session-start.mjs:98` and `hooks/lib/stop.mjs:106`. Report it.
- Binding portability: stop storing absolute repository paths that exist only on the authoring
  machine. **MSP-0B confirmed these paths really are shared**, not machine-local state:
  `newBinding` stores `repo` verbatim (`model/binding.mjs:19`) and `bindings/` is tracked in the
  ledger ref, so one machine's absolute paths are pushed to every collaborator.
- `reconcile`: stop rewriting other users' bindings from observations made against whatever
  repository sits at `binding.repo` on **this** machine (`src/drift/reconcile.mjs:53-63`); stop
  auto-creating bindings matched by branch **name** across arbitrary repos.
- **Added by MSP-0B: reconcile does not survive an absent bound repository at all.** A single
  binding whose `repo` path is missing on this machine aborts the whole operation — `observeBranch`
  (`reconcile.mjs:35`) and `listRepoBranches` (`:54`) have no error handling and
  `scopedExec` runs without `check: false` (`git-ref-driver.mjs:574`). Reproduced: two bindings, one
  naming an absent path, produced `Error: spawn git ENOENT`, an empty drift snapshot, and the
  offending binding still `active`. All drift computed before the throw is discarded, because
  `writeDriftSnapshot` runs only after the loop returns (`tools/reconcile.mjs:6-7`). The failure is
  then invisible: `invokeCli` never rejects (`hooks/lib/cli.mjs:16-26`) and
  `hooks/lib/session-start.mjs:99` discards the exit code and stderr. Note `:51` derives the repo
  list from bindings of *any* status, so a long-closed binding still drives a git invocation. The
  error text is itself misattributing — it reads as "git is not installed".
- **Added by MSP-0B, and the most serious thing this audit found in the reattach path: branch
  identity collapses to the repository root commit.** `resolveIntegrationBase` returns `null` when
  `LEDGER_BASE_REF` is unset and no `refs/remotes/origin/*` resolves (`git-ref-driver.mjs:198`);
  `firstCommitOf` then skips the range at `:146` and falls through to
  `rev-list --max-parents=0` at `:153-156`. So in any repository without an `origin` remote **every
  branch reports the same `first_commit`** — and `tryFirstCommit` (`reattach.mjs:31-37`) matches on
  that value alone, with no repo filter, no status filter, and first-match-wins over an unsorted
  `listBindings` (`local-driver.mjs:178-187`). Reproduced through `runReconcile`: one binding whose
  `first_commit` was the root captured three separate unbound branches, `main` among them, each
  reported as `method: 'first-commit'`. A binding already closed as `merged` matched too, and
  reversing the binding order flipped which branch was misattached. The trailer does not save this
  case: the trailer is read off the root commit (`:568`), which carries none — measured
  `thread_id_trailer: null`. Reattachment needs a real identity (repo + branch + a first commit that
  is actually unique), not a sha that every branch shares.
- **Added by MSP-0B: a closed binding blocks reattachment permanently.** `boundKeys`
  (`reconcile.mjs:50`) is built from all bindings regardless of status, while the drift loop skips
  non-active ones (`:32`). A branch that is deleted, orphaned, then recreated is skipped by both
  loops forever. Reproduced across three reconciles: present → no drift; deleted → `mark-orphaned`;
  recreated → zero drift, zero dispositions, binding still `orphaned`.
- **Added by MSP-0B: three of the eight drift signal codes are dead.** `#observeLive` and
  `#observeDeleted` hardcode `force_push_detected: false`, `key_files_deleted: []` and
  `key_files_modified: []` (`git-ref-driver.mjs:529-532`, `:551-554`), and `observeBranch` is
  implemented only there. So `force-push` (CRITICAL), `key-file-deleted` (CRITICAL) and
  `key-file-modified` (`classification.mjs:63-77`) can never fire. Do not design merge or reporting
  behavior around signals the system does not produce; either implement the observations or delete
  the branches.
- **Added by MSP-0B: two smaller multi-user gaps in the same files.** `disposeBinding` treats a
  thread that does not exist as non-terminal and recommends `complete` for it
  (`disposition.mjs:21`, `:33`). And a `Thread-Id` commit trailer is an unauthenticated attach
  primitive: `reattach` checks only that the named thread exists (`reattach.mjs:20-22`), then writes
  a binding during a hook with no user action (`:94`), so a teammate's commit can attach their
  branch to a thread they do not own.

**Acceptance**
- A concurrent edit by two users to different fields of one thread merges without loss.
- A conflicting edit surfaces as conflicted, never as a silent overwrite.
- `reconcile` on a machine that does not host a bound repository leaves that binding untouched.
  **Falsifiable form (MSP-0B):** with one healthy binding and one naming an absent path, `reconcile`
  returns successfully, writes drift for the healthy binding, and reports the unreachable one rather
  than throwing.
- **Added by MSP-0B:** a branch that was orphaned and later recreated is re-attached.
- **Added by MSP-0B:** in a repository with no `origin` remote, two unrelated unbound branches do
  not both re-attach to the same thread.
- **Added by MSP-0B:** a reconcile failure is reported to the user rather than swallowed by
  `hooks/lib/session-start.mjs:99`.

**Verify:** `npm test`, including a two-clone merge test; a reconcile test with a binding naming a
path absent from the test machine.

**PR title:** `fix(sync): merge ledger records field-wise instead of taking theirs`

---

### MSP-12 — Cost and capacity

**Attacks:** cost. **Closes:** the 10 cost defects.
**Depends:** MSP-6. **Version:** 0.9.1. Non-breaking.

**Changes**
- Stop rebuilding the whole index on every write. Make it incremental, or debounce it to the
  operations that need it. **Measured by MSP-0B, and it does not support this premise.** At 17
  threads `rebuildIndex` takes 1.8 ms (LocalDriver) / 2.0 ms (GitRefDriver), while the
  `commitAndReindex` every mutating tool actually pays (`tools/shared.mjs:19-23`) takes 30.1 / 27.3
  ms. The rebuild is roughly 7% of it; the git commit is the rest, on **both** backends, because
  `LocalDriver` also drives a git recovery repo (`local-driver.mjs:278-301`). Cost is per-commit,
  not per-thread, at this scale: 1 thread costs 26.9 / 27.6 ms. Re-target this bullet at the commit
  or re-justify it with a measurement at 500 threads before spending the work.
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
MSP-0 ─┬─> MSP-0B ──────────────────────────────────┐  (gates 7, 9, 11 only)
       │                                            │
       └─> MSP-1 ─┬─> MSP-10                        │
                  │                                 │
                  └─> MSP-1B ─┬─> MSP-1C            │
                              ├─> MSP-2 ────────────┤
                              ├─> MSP-3 ──┐         │
                              ├─> MSP-4   │         │
                              └─> MSP-5 ──┼─> MSP-6 ┼─> MSP-7 ──> MSP-8 ─┬─> MSP-9 ──> MSP-11
                                          │         │                    │
                                          └─> MSP-12┴────────────────────┴─> MSP-13
```

**Critical path:** 0 → 1 → 1B → 5 → 6 → 7 → 8 → 9 → 11 → 13.
**Parallelizable at any time after MSP-1B:** MSP-3, MSP-4.
**MSP-1C gates nothing** and is off the critical path, but it ships before MSP-2 because it is what
actually closes C4: MSP-1B fixed the error *shape*, and left the rendered *value* still unreadable.
**MSP-10 depends only on MSP-1** and is the one unit review cleared to build on the uncorrected
contract, since it touches the render and hook surfaces rather than the error path.
**MSP-0B runs concurrently with MSP-1 through MSP-6** and gates only MSP-7, MSP-9 and MSP-11.
It ships no production code, so it never blocks the branch.

MSP-1 comes first because it is non-breaking, closes the incident's root cause, and every later
MSP's error surface depends on its shape. That dependency is exactly why MSP-1B interposes: review
found MSP-1's shape defective after it merged, and four MSPs would otherwise have inherited it.

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| MSP-7's schema tightening rejects records in the live `.windful-ocean` ledger | Migration dry-run against a **copy** is a merge gate. An agent never touches the live ledger. |
| This repo is the installed plugin (I7) | Never verify by observing this session's ledger. Verify against temp ledgers in a scratchpad. |
| MSP-8's transaction refactor touches every handler | It depends on MSP-7's single schema so there is one validation choke point to call. Ship it alone; do not bundle. |
| A stacked tower grows past review capacity | Depth cap of four, then stop and report. |
| The audit artifact is in a temp directory and may vanish | MSP-0 commits it before anything else. |
| MSP-7, MSP-9 and MSP-11 are specified from partial knowledge of `drift`, `upcast` and `GitRefDriver` | **Realized, and larger than assumed.** MSP-0B read all three areas in full and returned 29 findings — 5 critical, 9 high. MSP-7 assumed two upcast defects; there are at least seven, plus seven more its own cap consolidation manufactures. MSP-9's blast radius includes the whole `src/drift` feature and the verbatim gate, both non-functional today on the deployed backend. MSP-11's merge-driver surface is narrower than stated (bindings, not drift entries) while its reconcile surface is wider (reconcile does not survive an absent bound repo). All three sections are amended above. |
| ~~Payload sizes were measured on `LocalDriver`, but the deployed backend is `GitRefDriver`~~ **Retired by MSP-0B: measured on both, and the sizes are identical.** Every mutating tool returns the record itself (`update-thread.mjs:125`) and `bin/ledger-server.mjs:52` stringifies it, so the figure is driver-independent by construction. The SPEC's 6,269 B is verified in magnitude (6,514 B on a reconstructed thread, on both backends; 6,963 B once wrapped in the MCP content envelope, which is the number MSP-6's 1,200 B target must beat). | The real divergence is durability, not size: 3 of 3 index files survive a further process start on `LocalDriver`, 0 of 3 on `GitRefDriver`. That risk is now carried by MSP-9. |
| An implementing agent restates a defect instead of reading it | The evidence law in section 2 is binding; a PR body without `file:line` citations is rejected in review. |
| A merged MSP is assumed correct because its suite is green | **Realized on MSP-1.** It merged at 879/879 with both the refusal's `field` and its `retryable` wrong, because the tests asserted that those keys were present rather than that they were right. Acceptance for every remaining MSP requires at least one assertion proven red against the parent commit before it goes green. |
| A merged MSP ships unreviewed | **Realized on MSP-0, MSP-0B, MSP-1 and the SPEC commit** — four PRs merged with no review pass, and the first review run found a BLOCK. Every remaining MSP gets a `code-reviewer` pass before merge, not after. |

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
