# SPEC: Continuity Goal Model

| | |
|---|---|
| **Date** | 2026-08-28 |
| **Thread** | `01M130AYZYVWAGDKGHJX9AXPFG` — continuity-audit-remediation |
| **Discharges** | criterion 3 (`01M130AYZX2STFEFM2MM8Z6FZM`) |
| **Status** | Approved for planning. No code written against it yet. |
| **Relates to** | `docs/specs/2026-08-25-post-cutover-repair.md`. That document numbers its **design rulings** `R1`–`R10`. This document numbers **goals** `LG#`/`DG#` and never uses a bare `R#`. Any citation of the older document is written `post-cutover ruling R3`. |

---

## 1. Why this exists

Logbook records what happened across coding sessions so a later session can pick up context instead of re-deriving it. An audit of the shipped system, its evidence review, and the design work that followed established one finding that reorganised everything else:

> **Logbook infers what it should be told, hides what it has already curated, stores what nothing reads, and depends on an end-of-session step that does nothing.**

Each clause is a measured defect, not an impression.

**It infers.** Nothing records which goal is being worked. The renderer guesses it as the lowest-numbered unfinished one (`src/render/briefing.ts:102-105`), and `record_decision` stamps a decision's scope using the same guess (`src/server/tools/record_decision.ts:54-61`). Both guesses are silent, permanent, and wrong for any working style that is not strictly sequential.

**It hides.** A list named `key_decisions` has already been filtered by an agent judging each entry worth recording. Four display-time counters then apply a second filter that has read none of them (`src/render/briefing.ts:48-53`). A separate rule hides items attached to a finished goal at every budget, permanently.

**It stores what nothing reads.** `Risk.refs` is declared as *"external pointers backing this risk"*, is written, and is rendered by no surface. The binding record type is written by `bind_branch` and read by nothing. A `PostToolUse` hook writes commit notes into the store that no code path reads back.

**It depends on a wrap-up that does nothing.** The `debrief` skill calls `park_thread` with one argument, `outcome`. `next_step` and `last_session` are never passed, so a debrief run exactly as written returns an empty spine update. The system has been operating without a working wrap-up and nothing surfaced it.

Three things changed during design and are the reason this document is larger than the audit's recommendation:

1. **A completion criterion is a goal, not a task.** The shipped model treats criteria as a to-do list and depends on that in code. That assumption is false for any user who does not work strictly top-to-bottom, and the failure is silent.
2. **Attachment and focus are declared, never inferred.** `KeyDecision` has no attachment field at all, so every decision falls into one display lane forever and one cap is unreachable dead code.
3. **The goals split in two.** Some are promises to a user of Logbook. Others are constraints on how Logbook is developed. Mixing them produced a list that could not be published and could not be checked.

---

## 2. Evidence base

Claims in this document come from four sources. Where a claim is reasoned rather than measured, it says so at its point of use.

**The code.** Every behavioural claim carries a `path:line` citation confirmed against the working tree at `e5f0195`.

**Fifteen decision records on the thread.** Cited by ULID. Five bind this document directly:

| Decision | What it settles |
|---|---|
| `01M130BFPB032QCVEQ7P9MZWNM` | Keep the curated-summary plus id-addressed-detail shape. No index, no search layer. Scale-conditional: re-take if the store approaches ten million tokens |
| `01M130BSCN300BKD9SN0R44E31` | Remove the display caps that hide already-curated items; keep the whole-briefing budget |
| `01M130CMRPBFP1E0B0VJGS5SRW` | The git boundary gains a mechanism instead of remaining a convention |
| `01M130DZJP1X0SMH3TGZNV2066` | Justify Logbook by continuity and auditability, never by improved model performance |
| `01M13BDCQ0RAGYT82YZTZE7ABD` | Three capture mechanisms, each naming the class it guarantees. Completeness is not enforceable and may not be claimed |

**Two controlled experiments run on this population.** Both are at ceiling on small samples, which is stated here rather than discovered later.

- *Risk zero* (`01M131QD321M9SRA2ZZTVA0EJC`): eight fresh subagents, four per arm. Retrieval was 8 of 8 in both arms, and compliance with a decision that contradicted the surrounding code was 8 of 8. **Retrieval was universal precisely because a decision's address sat beside its title** — which is not today's condition, and is the condition this document creates.
- *Gates* (`01M135AQQ3HNG4P7E308VJFGHT`): eight fresh subagents, four per arm, one variable — whether the written acceptance check was ever consumed. Both arms produced a runnable acceptance check 4 of 4. **Enforcement never acted.** Conclusion adopted: gates buy timing; quality comes from demanding a specific checkable value.

**Recovered history.** The compaction nudge and the `PreCompact` hook were retired for their *mechanism*, never for compaction awareness as a category. The rebuild spec at commit `befbd3a` records the nudge as *"either removed or latched once per session"* and its predicate as transcript **file size** — monotone, so once true it was true forever. Predecessor ledger decision `0159` on `refs/heads/_ledger` ratifies the retirement. `PreCompact` was dropped because its checkpoints had no reader and its writer bypassed the store's own write guard.

**Retracted evidence, which must not be reused.** Decision `01M135P62TCY19GJPH2E7V7HBS` retracts two citations previously used to justify excluding automatic capture. The exclusion stands on three other grounds; the retracted grounds do not appear in this document and must not appear in any plan derived from it.

---

## 3. Scope

### 3.1 In scope

The five approved changes, the defect criteria already pinned on the thread (11, 12, 14), and the goal-model material established during design. Every item appears in section 8 as a numbered behavioural rule and in section 9 as part of exactly one unit.

`LG5` (write fidelity) is **in scope** and owned here, in unit U10. Its file is shared with a live thread; section 10 records the ordering constraint and its reason.

### 3.2 Out of scope, and why

These are non-goals, stated once. They are enforced by decision records and review, never by a mechanical check — see section 6.4.

| Non-goal | Ground |
|---|---|
| Concurrent sessions on one project | Deliberate. Logbook is single-session-per-project by design. Stated in the README as a limit, not discovered |
| A search, vector or embedding layer | Loses on accuracy at this scale by 16.6 points; fails the simplicity constraint; and is the affordance measured to collapse an agent's use of data it was already handed |
| A hierarchical, multi-level index | Measured harmful against a flat index, 0.9126 → 0.6398 |
| Event sourcing or projections over the ledger | Documented-hard. Fails the simplicity constraint outright |
| Automatic capture of file edits, diffs, tool calls or test runs | Duplicates what git holds (`LG4`); captures actions rather than reasons, so it cannot supply the *why*; and is an exfiltration surface that scales with what is captured |
| LLM summarisation or consolidation of stored records | Compaction dropped constraint compliance from 100% to 70%; consolidation corrupted 54% of previously-solved problems |
| Pruning, archiving or deleting records to control growth | Growth is bounded by excluding settled work from the surfaces that load it, never by destroying history |
| An importance scorer or ranking system | The forcing function is the existing refuse-on-cap behaviour. Coarse evaluators propagate errors |
| An LLM that judges whether a criterion is genuinely complete | Self-assessing agents made false completion claims in **75.8%** of failures; a second model checking the claim scores **at or near chance**. Ground truth comes from state, never testimony. The Logbook server also has no model access — the only model at the point of the call is the one making the claim |
| Enforcement machinery on the content of a gated record | Measured and withdrawn: an inert gate and an enforced gate each produced a runnable acceptance check 4 of 4 |

### 3.3 Deliberately opened and not taken

Decision `01M135P62TCY19GJPH2E7V7HBS` opened automatic capture of **coordinates** rather than content — a session id, timestamp and commit sha stamped when a record is written. It satisfies `LG4` exactly, carries near-zero exfiltration surface and replays nothing. **It is not specified here.** It is recorded as available, unevaluated, and requiring its own decision.

---

## 4. Goals

Goals are normative. Every invariant in section 6 traces to exactly one goal or one non-goal, and every goal has at least one invariant. Both directions are checked in section 11.

### 4.1 Logbook goals — public, and published in the README

| ID | Promise |
|---|---|
| **LG1** | **Order-agnostic.** No behaviour depends on the order you work your goals in |
| **LG2** | **Manner-agnostic.** Any agent holding a thread id can record. No record type is reachable only through one working style, and no limit is reached sooner by one style than another for the same recorded content |
| **LG3** | **Never fabricates.** A value you did not supply — including which goal an item belongs to — is stored as absent and reported as absent. Logbook never stores a relationship that does not resolve |
| **LG4** | **Never stores your code.** No file content, no diff, no source |
| **LG5** | **What you write is what is stored, or the write is refused.** Any transform applied on the way in is declared and reversible |
| **LG6** | **When you read a record you see all of it.** No content field is stored that no surface displays |
| **LG7** | **You can find any record without guessing.** Every record type has a listable identifier a model can reach |
| **LG8** | **No display rule removes a whole item without saying so.** Anything not shown is counted and its address is given |
| **LG9** | **Any surface that shortens text says it shortened** — and shortens only as much as its budget requires |
| **LG10** | **Logbook never scores, ranks or prioritises your records.** What you recorded is what you get back |
| **LG11** | **Crash-resilient.** At most one act's work is at risk |
| **LG12** | **You never have to remember to close the session** |
| **LG13** | **Reading one record never gets slower as history grows** |
| **LG14** | **What Logbook loads is bounded by open work, not total history** — and nothing is deleted to achieve it |
| **LG15** | **Nothing recorded is ever rewritten or deleted** |
| **LG16** | **Logbook never executes anything it stores.** Records arrive from a shared remote; none of them can run on your machine |
| **LG17** | **A goal is finished only when you record how you know** |

### 4.2 Development goals — private, and never published

| ID | Constraint |
|---|---|
| **DG1** | No layer, subsystem or abstraction ships without visibly earning its place |
| **DG2** | *Governed by `~/.claude/rules/common/research-citations.md`. Pointer only; not restated here* |
| **DG3** | *Governed by `~/.claude/rules/common/research.md`. Pointer only; not restated here* |
| **DG4** | Where the design is already right, say so. Churn is a cost |
| **DG5** | No field ships without a stated reason to exist and a named reader |
| **DG6** | Store by hand only what cannot be derived from records already written |

### 4.3 Provenance

The audit established fourteen requirements, `R1`–`R14`, cited by number inside immutable decision records. Those numbers are frozen history and are never reused. The mapping is recorded once, here:

`R1→DG1` · `R2→DG2` · `R3→DG3, LG3` · `R4→LG5, LG9` · `R5→LG8` · `R6→LG10` · `R7→LG11` · `R8→LG12` · `R9→DG4, LG15` · `R10→LG4` · `R11→DG5, LG6` · `R12→LG7` · `R13→LG13` · `R14→LG14`

Three further goals were established during design: `R15→LG3` (attachment declared), `R16→DG6` (derive rather than store), `R17→LG1, LG2` (workflow-agnostic).

`R3` was originally scored against the audit's own reasoning and passed. **Applied to the system it fails today**, twice: `deriveScope` and `currentCriterionId`. Sections 7 and 8 close both.

---

## 5. Definitions

### D-1 — A completion criterion is a goal

A checkable statement of what must be true for the thread to be finished, pinned before the work starts, and independent of the route taken to satisfy it.

It is never a task and never an artifact. *"Write the spec"* is a task. *"A spec exists"* is an artifact. Neither is a goal. **The route is a plan; the plan is a file; Logbook stores a pointer to it.**

Two consequences follow and are load-bearing elsewhere in this document:

- Goals have no intrinsic order, so no code may read a criterion's position to infer sequence (`S3`).
- **A met goal is a live invariant, not dead history.** The decisions that made it true are the constraints that keep it true, so they may not be hidden once it is met (`B19`).

### D-2 — A criterion carries its own check

Every criterion is created with a `check`: the specific thing that decides whether the goal is true. **A check must be re-runnable by a party other than the claimant.** A goal that cannot state one is not yet a goal and is reworded until it is — the same discipline as a census that halts on the unclassifiable rather than adding an "other" bucket.

There is exactly one kind of check. There is no weaker tier, because the cheaper path becomes the default path.

Marking a criterion done requires two values:

- `result` — what was observed. Never empty.
- `result_status` — `verified` when the check was run and this is what it returned; `unverified-reasoned` when it could not be run and `result` states specifically why.

`result_status` describes **this run**, never the quality of the check. Logbook stores both values verbatim, inspects neither, executes nothing, and judges nothing.

`close_thread` reports the split and refuses on neither. Blocking an honest downgrade makes the honest path more expensive than the dishonest one, which only incentivises claiming `verified` instead. What prevents `unverified-reasoned` becoming the default is aggregation, not refusal: the count is rendered, and a reason that recurs surfaces as a named capability gap in the surrounding tooling.

### D-3 — Identifier scheme

| Prefix | Meaning |
|---|---|
| `LG#` | A public promise (section 4.1) |
| `DG#` | A private development constraint (section 4.2) |
| `D#` | A defect in the shipped system (section 7) |
| `B#` | A behavioural rule this spec mandates (section 8) |
| `A#` `O#` `S#` | An invariant — **A**ccept, **O**utput, **S**ource (section 6) |
| `U#` | A shippable unit (section 9) |
| `R#` | **Frozen.** The audit's original requirements. Never used for a new statement |

Invariants are lettered by job rather than numbered in one sequence so that no invariant id can be confused with a behavioural rule id.

---

## 6. Invariants

An invariant is **the executable form of a promise**. It has five mandatory parts: a subject, a quantifier, a decidable predicate, a named enforcer, and a consequence on violation. A statement missing any one of them is not an invariant and does not belong in this section.

Each invariant does exactly one of three jobs, and the job fixes its enforcer and its falsifier:

| Job | Subject | Enforcer | Falsified by |
|---|---|---|---|
| **A** — refuse bad input | a tool call | the tool | making the call and asserting the refusal |
| **O** — the output tells the truth about itself | rendered text | the renderer | rendering and asserting the marker or count |
| **S** — the codebase has not lost a property | the source tree, or observable state | a test or census | running it; a red build |

### 6.1 Rules governing the set

These exist because an invariant set with the wrong shape produces an unterminating review loop: a reviewer fixes a subset, breaks another, and each fresh pass finds work. All six rules were derived from defects found in this document's own first draft.

1. **Falsifiable by one bounded mechanical procedure, named in the invariant itself.** If deciding it requires judgement, it is not an invariant.
2. **No two invariants may govern the same event with different verdicts.** Two verdicts on one event means no state satisfies both.
3. **True of the system as it will be when its unit lands** — never aspirationally. A knowingly-false invariant is a permanent red, and a permanent red eventually gets "fixed" by damaging correct code.
4. **The census population is closed and enumerable at the moment the check runs.** A census that halts on *legitimate* code has the wrong mechanism, not the wrong code.
5. **An invariant that duplicates a shipped test is deleted.** The test enforces it either way; restating it creates two names for one failure.
6. **Invariants guard drift, never a deliberate design act.** Nobody adds a search layer by accident. A decision record and review guard choices; a mechanical check pointed at a choice is either trivially passed or permanently arguable.

### 6.2 Job A — the tool refuses

*Enforced by the tool. Falsified by making the call.*

| ID | Invariant | Traces to |
|---|---|---|
| **A1** | For every capped field in the closed census over `src/schema/caps.ts`, a write whose value exceeds the cap is refused, and the refusal names the field, the limit, the observed value and a remedy. No value is ever shortened to fit | LG5 |
| **A2** | For every id-valued argument — `criterion_id`, `focus`, `decision_id` — an id naming nothing on the thread it is given against is refused | LG3 |
| **A3** | For every criterion marked done, an empty `result` or an absent `result_status` is refused | LG17 |
| **A4** | For every criterion created or inserted, an absent `check` is refused | LG17 |
| **A5** | For every field whose declared class is `pointer`, a value containing a line break, a code fence or a diff hunk marker is refused | LG4 |
| **A6** | For every optional argument in the closed census over the tool input schemas, a call omitting it stores null and the response reports it absent. No code derives a substitute | LG3 |
| **A7** | For every decision whose spine link will not fit the thread record's cap, the decision record is still written and the response names why the link was skipped | LG8 |

### 6.3 Job O — the output tells the truth about itself

*Enforced by the renderer. Falsified by rendering.*

| ID | Invariant | Traces to |
|---|---|---|
| **O1** | For every briefing whose full render fits its budget, it renders in full with nothing clipped | LG9 |
| **O2** | For every item omitted by any display rule — cap, lane or relevance — the output carries a count of what was omitted and an address that resolves to it | LG8 |
| **O3** | For every surface that shortens text, the output carries a marker saying so, and every surface reserves room for its marker within its own limit before clipping | LG9 |
| **O4** | For every field declared `content` in the schema, that field appears on at least one rendered surface | LG6 |
| **O5** | For every discovery surface, the number of records it reads does not grow as terminal records accumulate | LG14 |

### 6.4 Job S — the codebase has not lost a property

*Enforced by a test or census. Falsified by a red build.*

| ID | Invariant | Traces to |
|---|---|---|
| **S1** | For every write that has returned, no caller can observe records on disk that differ from the tree in the ref | LG15 |
| **S2** | The set of modules permitted to spawn a process is a closed allowlist, and no record type is imported into any module on that list | LG16 |
| **S3** | `Criterion.ordinal` is read only to render a display label and to stable-sort for display. Every other read is forbidden | LG1 |
| **S4** | Every write tool succeeds when no pointer exists and when a foreign session holds one | LG2 |

### 6.5 Field classes

`A5` and `O4` share one mechanism. Every field in every record schema declares exactly one class:

| Class | Meaning | Governed by |
|---|---|---|
| `structural` | Serves the machine — ids, timestamps, foreign keys, enum discriminants. Renders nowhere by design | neither |
| `pointer` | An address into something else — a path, a URL, a sha, a ULID reference | `A5` |
| `content` | Text a human or agent wrote and will read back | `O4` |

Without this declaration `O4` would demand that every internal id render somewhere, which is both absurd and undecidable — the exact shape that produces an unterminating review loop.

### 6.6 Deliberately absent

Three candidate invariants were considered and rejected. They are recorded so they are not re-proposed:

- **"No ranking, scoring, recency or pinning function exists."** Already false — the roster sorts by recency, correctly — and undecidable, since `Array.sort` qualifies. Its useful content is covered by `S3` and `LG10`.
- **"The compaction tokens stay absent."** Enforced by two shipped tests (`test/hooks/compaction-nudge-absent.test.ts`, `test/hooks/precompact-absent.test.ts`) whether or not this spec restates it. It appears instead as a constraint on unit U7 (section 9).
- **"No dependency is a search or embedding library."** Rule 6: it guards a deliberate act, using an open-ended classifier over a vendored dependency tree.

---

## 7. Defect inventory

What is wrong in the shipped system, with citations. Every defect is closed by at least one behavioural rule in section 8; the mapping is in section 11.

| ID | Defect | Evidence |
|---|---|---|
| **D1** | The criterion being worked is guessed as the lowest-numbered unfinished one. Nothing records it | `src/render/briefing.ts:102-105` |
| **D2** | A decision's `scope`, when omitted, is fabricated from the lowest open ordinal. Decisions are append-only, so a wrong stamp is permanent | `src/server/tools/record_decision.ts:54-61` |
| **D3** | `KeyDecision` has **no attachment field at all**. Every key decision therefore falls into lane B on every thread forever, and `LANE_A_TITLES_MAX = 10` is unreachable dead code | `src/schema/thread.ts:19`, `src/render/briefing.ts:52,107-117` |
| **D4** | Four display-time counters hide items from a list an agent already curated | `src/render/briefing.ts:48-53` |
| **D5** | Items attached to a finished or struck criterion are never rendered at any budget, and are not distinguished in the hidden count | `src/render/briefing.ts:115,128-132` |
| **D6** | Key decisions render as bare titles though the decision ULID is present in the same object. The thread resource renders both | `src/render/briefing.ts:84` vs `src/server/resource-render.ts:50-51` |
| **D7** | Session-entry ids are enumerable only through the MCP `completion/complete` channel, which exists to autocomplete a value for a human typing in a picker. No tool or resource returns a list | `src/server/completions.ts:91-112` |
| **D8** | The binding record type is written and read by nothing | `src/server/tools/bind_branch.ts:80,81,105` |
| **D9** | `Risk.refs` is declared *"external pointers backing this risk"*, is written, and is rendered by no surface | `src/schema/thread.ts:69-72`, `src/server/tools/update_thread.ts:205` |
| **D10** | `debrief` passes only `outcome`, so `next_step` and `last_session` are never refreshed and the call returns an empty spine update | `skills/debrief/SKILL.md`, `src/server/tools/park_thread.ts:252-259` |
| **D11** | The session-start banner is clipped at 10,000 graphemes with no marker of any kind | `hooks/lib/io.ts:7`, `src/render/escape.ts:84-88` |
| **D12** | `escapeStored` rewrites every line break to the literal text `U+000A` and no inverse exists anywhere in the codebase. Structure is destroyed at write time, irreversibly and unannounced | `src/render/escape.ts:39-82` |
| **D13** | Opening the store recursively walks every record file to count them | `src/store/records.ts:81-96,121` |
| **D14** | Materialisation spawns one `git cat-file -p` subprocess per record | `src/store/read-path.ts:165-168` |
| **D15** | The `resolved:` counter reads, parses and validates one full decision record per spine link to print a single number, discarding each | `src/server/tools/resume_thread.ts:64,79-83` |
| **D16** | The duplicate-store guard compares only siblings inside one root, so a second store for the same project under a different root is missed. **Live on this machine now** | `src/store/single-store.ts:38-83` |
| **D17** | A `PostToolUse` hook writes commit notes into the store that nothing reads back, and does so from a separate process — making it a second concurrent writer inside an ordinary single session | decision `01M13BCM4W2NHGSWVW84R2JGPN` |
| **D18** | Marking a criterion done is a bare array of ids. Nothing asks what was observed | `src/server/tools/update_thread.ts:39-43` |
| **D19** | A criterion carries no statement of how it would be decided | `src/schema/thread.ts:9-16` |
| **D20** | The git boundary has no mechanism: caps limit length and never content class, `Decision.commit` has no cap and no pattern, and one sync path re-commits unvalidated remote bytes | `src/schema/decision.ts`, decision `01M130CMRPBFP1E0B0VJGS5SRW` |
| **D21** | Element-count caps penalise parallel working styles: `OPEN_RISKS_MAX_ELEMENTS = 40` counts items, and parallel work produces more distinct-but-overlapping findings for the same decided content | `src/schema/caps.ts:12,16` |
| **D22** | `Criterion.kind: 'planned' \| 'detour'` encodes whether a goal was foreseen — process history, not a property of what must be true | `src/schema/thread.ts:14` |
| **D23** | A thread has no field for the artifacts it produced, so a spec or plan path can only reach a future session by being typed into prose | `src/schema/thread.ts` |

---

## 8. Behavioural rules

Each rule states the mandated behaviour, what it refuses, and the goal it discharges. Grouped by the surface it changes; the surface is a heading, not an identifier.

### Schema — `src/schema/`

| ID | Behaviour | Refuses | Goal |
|---|---|---|---|
| **B1** | `KeyDecision` gains `criterion_id?: Ulid`. Absent means unattached — a fact about every existing record, not a gap, so no migration is required | a `criterion_id` naming no criterion on the thread, using the refusal shape risks already use (`src/server/tools/update_thread.ts:209-215`) | LG3 |
| **B2** | `Criterion` gains `check`, `result` and `result_status`, all nullable in the stored record so existing records stay readable. Null renders as *not recorded*, never as blank | — (the tools refuse; see B8, B9) | LG17 |
| **B3** | `Thread` gains `artifacts: Artifact[]`, where `Artifact = { id: Ulid; label: string; pointer: string }`. `pointer` is class `pointer` | a `pointer` that fails content-class validation | LG6 |
| **B4** | `Risk.refs` is retained and gains a renderer (B22). It is already declared, written and capped, and is exactly the slot for what backs a risk | — | LG6, DG4 |
| **B5** | Every field in every record schema declares its class — `structural`, `pointer` or `content` (section 6.5). A content-class validator is applied to every `pointer` field: no line break, no code fence, no diff hunk marker | any write whose value carries content where a pointer is declared | LG4 |
| **B6** | Closed census of every `*_MAX_ELEMENTS`. Each is justified in writing as style-neutral or replaced by a size bound. Expected outcome, decided by the census and not by this sentence: `OPEN_RISKS_MAX_ELEMENTS` converts; `DECISION_OPTIONS_MAX_ELEMENTS` is per-record and stays; `CRITERIA_MAX_ELEMENTS` is style-neutral under D-1 and stays | — | LG2, LG14 |
| **B13** | `Decision.commit` gains a cap and a sha pattern. Declared in `src/schema/decision.ts`, so it is a schema constraint rather than a tool one | a commit value that is not a sha | LG4 |
| **B7** | `Criterion.kind` is put to the census. Under D-1, whether a goal was foreseen is process history. It gains a named reader or it is removed | — | LG1, DG5 |
| **B42** | No module outside a closed allowlist may spawn a process, and no record type is imported into any module on that list | — | LG16 |

### Tool contracts — `src/server/tools/`

| ID | Behaviour | Refuses | Goal |
|---|---|---|---|
| **B8** | `open_thread` requires a `check` on every criterion it creates | a criterion with no check | LG17 |
| **B9** | `update_thread.criteria_done` changes from `Ulid[]` to `{ criterion_id, result, result_status }[]`. **This is a breaking input change and is stated as one.** No shipped skill calls this tool — `preflight` calls `list_threads` and `resume_thread`, `debrief` calls `park_thread` — so the change has no in-repo caller beyond tests | a bare id array; an empty `result`; an absent `result_status` | LG17 |
| **B10** | `amend_criteria` insert requires `check`, matching B8 | as B8 | LG17 |
| **B11** | `record_decision` accepts optional `criterion_id`, validated as B1 | as B1 | LG3 |
| **B12** | **`deriveScope` is deleted.** An omitted `scope` is stored absent and reported absent — not derived, and not refused, because a thread-wide decision is legitimate. `noOpenCriterionRefusal` is deleted with it; it exists only to serve the derivation | nothing new | LG3, LG1 |
| **B14** | `park_thread` stops accepting `last_session`; it is derived (B23) | — | DG6, LG11 |
| **B15** | `resume_thread` and `update_thread` accept optional `focus: Ulid[]`, validated against the thread's criteria and written **to the session pointer only, never to the record**. Focus is per-session context, not durable state | a focus id naming no criterion on the thread | LG1, LG2 |
| **B41** | `close_thread` reports the verified / unverified-reasoned split and refuses on neither | — | LG17, LG12 |

### Renderer — `src/render/`

| ID | Behaviour | Goal |
|---|---|---|
| **B16** | **Every display-time item cap is deleted** — the four lane caps, `OUT_OF_SCOPE_SHOWN_MAX`, `CRITERIA_SHOWN_MAX`, `DECISION_ID_SHOWN_MAX`. The whole-briefing budget and its clip search are untouched | LG8 |
| **B17** | `laneFor` is retained as an **ordering** function only. It never removes an item | LG8 |
| **B18** | **`currentCriterionId` is deleted.** Lane A membership comes from the declared focus. With no focus set there is no lane A: lanes A and B merge into one ordered group and the briefing states that focus is not set | LG1, LG3 |
| **B19** | Lane C — items attached to a met or struck goal — renders **last, compact (id and title only), under its own heading naming it settled**. It is never hidden. Under D-1 a met goal is a live invariant, and the decisions that made it true are what keep it true | LG8 |
| **B20** | The `Not shown` block reduces to its remaining members: the text-clip marker, and dangling or quarantined ids. The address line stays, on the same condition | LG8 |
| **B21** | Key decisions render **with their decision id** | LG7 |
| **B22** | Risks render their `refs`. The thread renders its `artifacts` near the top, before the spine | LG6 |
| **B23** | `last_session` is **derived** from the previous session's log entries, rendered newest-first **with their entry ids**. Where no entries exist for the previous session the stored legacy text renders instead, marked as legacy. Nothing is deleted | LG11, LG7, DG6 |
| **B24** | Criteria render `check` always, and `result` with `result_status` when done. The clip-marker helper is extracted so every surface shares one implementation and each reserves room for its marker within its own limit | LG17, LG9 |

### Discovery — `src/server/`

| ID | Behaviour | Goal |
|---|---|---|
| **B25** | New resource `logbook://sessions/{thread_id}` listing that thread's entry ids and the first line of each. Session entries acquire the discovery path they have never had | LG7 |
| **B26** | `logbook://index` lists it | LG7 |
| **B27** | Bindings render on the thread resource. Rendering is the minimum that discharges `LG6` and is cheaper than deleting a published tool | LG6, DG4 |
| **B28** | The **thread** resource template gains a `list` callback so `resources/list` returns more than two entries. The **decision** and **session** templates deliberately do not: those sets are unbounded and enumerating them into every client would breach `LG14`. Their ids reach the model through B21 and B25 | LG7, LG14 |

### Hooks — `hooks/`, `src/hooklib/`, `src/cli/`

| ID | Behaviour | Goal |
|---|---|---|
| **B29** | Capture mechanism 1, unchanged: the existing refusal on acts that redefine the work. It already ships in two instances and is true by construction | LG12 |
| **B30** | Capture mechanism 2, new: a **second verdict in the existing Stop hook**. It compares ledger ref state — evaluated at every turn end, never permanently latched — and blocks when nothing has reached the ref since `resume_thread`, excluding commits authored by the post-tool-use hook. The predicate is satisfiable by writing, which the retired nudge's monotone file-size predicate was not. **It guarantees presence, never completeness, and no text anywhere may describe it otherwise** | LG12, LG11 |
| **B31** | Capture mechanism 3: subagent-boundary recording is permitted and preferred, split by content — a subagent records what it established; a selection between live options stays with whoever selected | LG2, LG12 |
| **B32** | The session-start banner emits a marker when it clips, reserving room for that marker inside its own limit | LG9 |
| **B33** | The post-tool-use commit-note write is **deleted**. Nothing reads it back, which `DG5` forbids and `LG6` fails. Removing it also removes the plugin's own second writer | LG6, DG5 |
| **B40** | The duplicate-store guard widens to detect a second store for the same project across roots. The `sync_ledger` passthrough that re-commits unvalidated remote bytes is closed | LG4 |

### Skills and README

| ID | Behaviour | Goal |
|---|---|---|
| **B34** | `debrief` passes `next_step`. It stops passing `last_session`, now derived | LG12 |
| **B35** | `preflight` may pass `focus` after the human chooses the thread | LG1 |
| **B36** | `README.md` carries `LG1`–`LG17` in user language and the non-goals of section 3.2, including the single-session limit. It makes no performance claim, bound by decision `01M130DZJP1X0SMH3TGZNV2066` | LG10, LG15, LG16 |

### Cost — `src/store/`, `src/merge/`, `src/server/tools/resume_thread.ts`

| ID | Behaviour | Goal |
|---|---|---|
| **B37** | Opening the store stops walking every record. The recursive count leaves the open path; the stamp-versus-ref comparison stands in, and a full count runs only where that comparison is inconclusive | LG13, LG14 |
| **B38** | Materialisation stops spawning one subprocess per record; the per-blob read becomes one batched read | LG13 |
| **B39** | The `resolved:` counter stops reading a full decision record per spine link. Before-and-after numbers are recorded | LG13 |

### Write fidelity — `src/render/escape.ts`

| ID | Behaviour | Goal |
|---|---|---|
| **B43** | `unescapeStored` exists, and a round-trip census over the final escaped character set proves every transform reversible. A transform that cannot be inverted becomes a refusal instead | LG5 |

---

## 9. Units

Ten units. **File-disjointness is achievable across a wave, not across the whole plan** — `src/render/briefing.ts` and `src/server/tools/resume_thread.ts` are central. Units sharing a file are ordered; units within a wave are disjoint and parallel-safe. File ownership below is normative: each file belongs to exactly one unit per wave.

### Wave 1 — no dependencies, fully parallel

| Unit | Owns | Carries | Green |
|---|---|---|---|
| **U1 Schema foundations** | `src/schema/*` | B1, B2, B3, B4, B5, B6, B7, B13, B42 | New fields land nullable. Nothing reads them yet. Every record in the live store parses unchanged. Field classes declared for every field. Full suite green |
| **U2 Store cost and safety** | `src/store/records.ts`, `read-path.ts`, `single-store.ts`, `src/merge/sync.ts` | B37, B38, B40 | Store-open and materialisation timings recorded before and after. `S1` asserted by the existing concurrency receipt. The guard detects the second live store on this machine |
| **U3 Promises** | `README.md` | B36 | README carries `LG1`–`LG17` and the non-goals. A test asserts every `LG` id appears, so the file cannot silently drift from this spec |

### Wave 2 — after U1, mutually disjoint

| Unit | Owns | Carries | Green |
|---|---|---|---|
| **U4 Criterion contract** | `src/server/tools/{open_thread,update_thread,amend_criteria,close_thread}.ts` | B8, B9, B10, B41 | `criteria_done` accepts only the pair shape; the bare id array is refused with a named refusal. `A3`, `A4` asserted. `close_thread` prints the split |
| **U5 The briefing hides nothing** | `src/render/briefing.ts`, `roster.ts` | B16, B17, B18, B19, B20, B21, B22, B24 | Every display-time item cap deleted; the budget untouched. `O1`, `O2`, `O3` asserted. Lane C renders last and compact. `currentCriterionId` deleted — with no focus yet, lanes A and B merge, which is B18's specified fallback and correct standalone |
| **U6 Discovery** | `src/server/{resources.ts,resource-render.ts,completions.ts}` | B25, B26, B27, B28 | A model obtains an id for thread, decision, session entry and binding from a published surface without guessing. `O4` asserted over content-class fields |
| **U7 Capture** | `hooks/{stop.ts,post-tool-use.ts}`, `src/hooklib/stop-gate.ts`, `src/cli/session-start.ts`, `skills/debrief/SKILL.md` | B29, B30, B31, B32, B33, B34 | The Stop hook's second verdict blocks when nothing has reached the ref since resume, and clears the moment anything does. **The two inherited census tests pass unchanged**: none of the five banned literals appears under `src`, `hooks`, `bin` or `skills`; no `PreCompact` key; no `hooks/pre-compact.ts`; `post-tool-use` emits an empty object for a large transcript. The commit-note write is gone. `debrief` returns a non-empty spine update |

### Wave 3 — shares files with wave 2, therefore ordered

| Unit | Owns | After | Carries | Green |
|---|---|---|---|---|
| **U8 Derived `last_session`** | `src/render/briefing.ts`, `src/server/tools/park_thread.ts` | U5 | B14, B23 | `last_session` renders from the previous session's entries with their ids; falls back to the stored legacy text, marked as legacy, where none exist. `park_thread` stops accepting the field. Nothing is deleted |
| **U9 Declared focus** | `src/domain/pointer.ts`, `src/server/tools/{resume_thread,update_thread,record_decision}.ts`, `src/render/briefing.ts`, `skills/preflight/SKILL.md` | U4, U5, U2 | B11, B12, B15, B35, B39 | Focus is validated and written to the pointer only. `S4` asserted behaviourally: every write tool succeeds with no pointer and with a foreign pointer. `deriveScope` and `noOpenCriterionRefusal` deleted. `A6` asserted. The `resolved:` counter no longer reads full records |

### Wave 4 — externally gated

| Unit | Owns | Carries | Green |
|---|---|---|---|
| **U10 Write fidelity** | `src/render/escape.ts` | B43 | `unescapeStored` exists. A round-trip census over the final escaped character set proves every transform reversible. Any transform that cannot be inverted becomes a refusal |

---

## 10. Ordering constraints, recorded as risks

Per `LG1`, sequence is not a property of the ledger. Where one unit must precede another, the reason is recorded as a **risk attached to the goal**, so it states *why* rather than merely *that*.

| Risk | Condition | Attached to |
|---|---|---|
| **Cap removal outruns its replacement** | Removing display-time item caps before the write-time size limit is sized against the largest existing thread record leaves record growth unbounded. Criterion 14 (`01M135QS1C1FRG2JV7DFCK2TKH`) already carries this | U5 |
| **A spine field is dropped before its replacement exists** | If `park_thread` stops accepting `last_session` before the derivation renders, the field goes stale with nothing standing in | U8 |
| **Two threads in one file** | U10 edits `src/render/escape.ts`. Thread `01M130YJYH0X1HBKPWM17FAPNQ` has three open criteria in that file, settling *which* characters are escaped. A reversibility census must run over the **final** set, so U10 inherits that set rather than racing it. **U10 is scheduled after that thread's criteria 1–3 close.** The two changes are complementary — that thread widens coverage, this one adds the inverse | U10 |

### Gate zero

Not an ordering constraint between units; a precondition for the plan existing at all.

Neither `.github/workflows/rebuild.yml` nor `receipts.yml` runs on push to `main`; both are `pull_request` only. Trunk has no CI, and a red `test (24.x)` job sits on `e5f0195`. Ten units merging in sequence into a branch nothing verifies would make every green claim in section 9 unfalsifiable — the same defect this spec exists to remove, applied to its own delivery.

**Before U1 is cut: trunk gets CI on push, and the red `test (24.x)` job is either fixed or explicitly downgraded on the honesty ladder with its reason recorded.** Both items already sit on this thread's next step as the live pre-spec work.

### Accepted risks, with their true exposure

Two store races are accepted rather than fixed, by decision. Their exposure is recorded accurately rather than under a heading that would understate it:

- `01M13F4HW3YQWJSF7T4GM47GP8` — a writer's post-CAS `mkdirSync` can recreate `records/` mid-swap, producing `ENOTEMPTY` on both the swap and its restore.
- `01M13F4HW3552M57R3SZ4B5V5P` — `src/store/write-path.ts:228` adopts the winner's ref on retry and stamps a tree it never materialised.

**These are not solely a concurrent-session phenomenon.** The `PostToolUse` commit-note hook is a separate writing process inside an ordinary single session, so both races are reachable with exactly one Claude Code session running. B33 deletes that hook, which reduces the exposure to the sync path without being concurrency work.

---

## 11. Coverage

### 11.1 Every goal has at least one behavioural rule

`LG1` → B7, B12, B15, B18, B35 · `LG2` → B6, B15, B31 · `LG3` → B1, B2, B11, B12, B18 · `LG4` → B5, B13, B40 · `LG5` → B43 · `LG6` → B3, B4, B22, B27, B33 · `LG7` → B21, B23, B25, B26, B28 · `LG8` → B16, B17, B19, B20 · `LG9` → B24, B32 · `LG10` → B36 · `LG11` → B23, B30 · `LG12` → B29, B30, B31, B34, B41 · `LG13` → B37, B38, B39 · `LG14` → B6, B28, B37 · `LG15` → B36 · `LG16` → B42 · `LG17` → B2, B8, B9, B10, B41

### 11.2 Every goal has at least one invariant, and every invariant has a goal

`LG1` → S3 · `LG2` → S4 · `LG3` → A2, A6 · `LG4` → A5 · `LG5` → A1 · `LG6` → O4 · `LG7` → *see note* · `LG8` → A7, O2 · `LG9` → O1, O3 · `LG10` → *see note* · `LG11` → *see note* · `LG12` → *see note* · `LG13` → *see note* · `LG14` → O5 · `LG15` → S1 · `LG16` → S2 · `LG17` → A3, A4

**Note — five goals carry no invariant, deliberately.** `LG7`, `LG10`, `LG11`, `LG12` and `LG13` are discharged by behavioural rules and asserted by unit green criteria, not by a continuously-enforced check. Rule 6 of section 6.1 applies: an invariant guards drift, and these describe properties that cannot be lost by drift — only by a deliberate change that would arrive through a decision record. Adding a mechanical check for each would produce checks that are trivially passed or permanently arguable.

### 11.3 Every defect is closed

`D1` → B18 · `D2` → B12 · `D3` → B1, B11 · `D4` → B16 · `D5` → B19 · `D6` → B21 · `D7` → B25, B26 · `D8` → B27 · `D9` → B4, B22 · `D10` → B34 · `D11` → B32 · `D12` → B43 · `D13` → B37 · `D14` → B38 · `D15` → B39 · `D16` → B40 · `D17` → B33 · `D18` → B9 · `D19` → B2, B8, B10 · `D20` → B5, B13, B40 · `D21` → B6 · `D22` → B7 · `D23` → B3

### 11.4 Every invariant belongs to a unit

`A1` → U1 · `A2` → U1, U4, U9 · `A3` → U4 · `A4` → U4 · `A5` → U1 · `A6` → U9 · `A7` → U1 · `O1` → U5 · `O2` → U5 · `O3` → U5, U7 · `O4` → U6 · `O5` → U2 · `S1` → U2 · `S2` → U1 · `S3` → U5 · `S4` → U9

---

## 12. What this spec does not settle

Stated plainly, because filling these in would be the failure `DG3` exists to prevent.

1. **Whether `Criterion.kind` has a reader.** B7 puts it to a census. If it has one, it stays and D-1 tolerates it; if not, it is removed. The census decides, not this document.
2. **Which element-count caps convert to size bounds.** B6 names an expectation and defers to the census.
3. **What "one act" means precisely in `LG11`.** The promise is that at most one act's work is at risk. The unit of an act is the gated call, but the boundary has not been measured against a real interrupted session.
4. **Whether `bind_branch` should exist.** B27 gives bindings a reader, which discharges `LG6` at minimum cost under `DG4`. Whether the tool earns its place is a separate question this spec does not open.
5. **Automatic capture of coordinates.** Opened by decision `01M135P62TCY19GJPH2E7V7HBS`, never evaluated, not specified here.
6. **Concurrent-session support.** A non-goal by decision. The cross-process locking protocol that would change that is an architect decision, not an implementation task.
