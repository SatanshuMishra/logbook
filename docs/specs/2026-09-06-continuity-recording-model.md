# SPEC: Continuity Recording Model

| | |
|---|---|
| **Date** | 2026-09-06 |
| **Thread** | none; authored before a thread was opened |
| **Status** | Approved for planning. No code written against it yet. |
| **Relates to** | `docs/specs/2026-08-28-continuity-goal-model.md`. That document numbers **definitions** `D-1`–`D-4`, **invariants** `A1`–`A7` / `O1`–`O5` / `S1`–`S4`, and **behavioural rules** `B1`–`B43`. This document numbers its own definitions `C-1`–`C-13`, its own **assertions** `R-1`–`R-10`, and continues the invariant and behavioural-rule numbering: `A8`+, `O6`+, `S5`+, `B44`+. A citation of the older document is written `goal model D-2`. |
| **Amends** | `goal model D-2` (see `C-4`) and the `minItems: 1` ruling shipped in `ce2ef720` (see `C-1`). |
| **Supersedes** | `docs/specs/2026-09-06-criterion-settledness.md`, deleted. Its whole content is folded in as `C-2` through `C-7`. |

---

## 1. Why this exists

Logbook records what happened across coding sessions so a later session can pick up context instead of re-deriving it. Two ways that fails, and both are live today:

> **A record a session cannot act on is worthless. A record a session can read instantly but that does not say enough to start is equally worthless.**

The audit that produced this document found one finding that reorganises everything else:

> **Logbook demands a definition of done at the one moment it is least likely to exist, does not ask what the work actually is, and captures nothing until a hand-off step that may never run.**

Each clause is a measured property of the shipped code.

**It demands done first.** `open_thread` refuses a thread with no criterion and refuses any criterion with no check (`src/server/tools/open_thread.ts:38-42`). A thread opened at the start of a feature has nothing to state, so something gets stated anyway.

**It does not ask what the work is.** The same call initialises the entire running summary to empty strings — `active_goal: ''`, `next_step: ''` (`src/server/tools/open_thread.ts:179-186`). The two fields a fresh session reads first are blank by construction until the first `park_thread`.

**It captures nothing until hand-off.** The Stop gate is a presence check over a git diff, and its own text says so: *"This verdict reports only that something reached the ledger; it makes no claim that what is recorded is complete"* (`src/hooklib/stop-gate.ts:52-56`). One write of any kind satisfies it for the whole session. `SubagentStop` is not bound at all, and is forbidden by two closed censuses (`scripts/check-packaging.mjs:47`, `test/contract/cutover-manifest-commands.test.ts:15,18`).

Three consequences follow, and they are why this document is larger than a patch.

1. **The open-time contract is inverted.** What must be true at the end is mandatory; what is true right now is not collected at all. A thread that crashes before its first park holds a title, a slug, and criteria that may be invented.
2. **A criterion carries two unknowns and the schema models one.** Whether the work is finished is tracked. Whether the goal is the right goal is not tracked at all, so a criterion the human dictated and one the model guessed read identically forever.
3. **The agent with the material is not the agent that records.** A subagent reads forty files and returns a paragraph. Everything the paragraph drops is unrecoverable, and nothing prompts the subagent to record before it is gone.

---

## 2. Evidence base

Claims come from three sources. Where a claim is reasoned rather than measured, it says so at its point of use.

**The shipped code**, read directly. Every `path:line` citation was confirmed against the working tree at commit `fcc15258`.

**External research**, cited inline with a resolving URL at the point of the claim.

**The `receipts` plugin** (`shaheershoaib/receipts`, local install 0.5.2), read as a working precedent for guidance that does not enforce. Its mechanisms are cited where they inform a decision.

One correction to a figure this project has cited before. The claim that self-assessing agents made false completion claims in 75.8% of failures traces to [Advani, ICML 2026 FAGEN workshop](https://arxiv.org/abs/2606.09863). The figure is real but narrow: 1,425 of 1,879 runs, one benchmark, two self-assessing architectures. The same paper reports 3% on a different task family. Cite it as *"up to 75.8% of failing runs in one self-assessing architecture on one benchmark"*, never as a general rate.

One capability fact, confirmed against the Claude Code documentation. `SubagentStop` is the subagent equivalent of `Stop`: subagent hooks run only while that subagent is running, and a `Stop` hook declared for a subagent is converted to `SubagentStop`. Its payload carries `agent_id` (unique per subagent instance) and `agent_type`. It carries **no** `stop_hook_active` equivalent, which `S10` accounts for by keying the gate to `agent_id` instead.

---

## 3. Scope

### 3.1 In scope

- The open-time contract: what a thread must state before it can record.
- A settledness axis on every criterion, independent of doneness.
- A relay that puts newly written criteria in front of the human at the moment they are written.
- Continuous recording gates at `Stop` and `SubagentStop`, and the assertions they present.
- A narrow ledger tool grant to specialist subagents.
- A `file` skill that opens a thread and arms the gates.

### 3.2 Out of scope, and why

| Excluded | Why |
|---|---|
| Per-criterion timestamps, and any "nothing has moved in N sessions" observation | A separate concern with its own merge consequences. Criteria carry no `done_at` and no session linkage; adding one is not worked out here. |
| Any change to `amend_criteria`'s `decision_id` requirement | The cost of amending a criterion is deliberate and is not lowered. |
| Any judgement by Logbook of whether recorded content is good | Logbook stores values verbatim, inspects none, executes nothing. `goal model D-2` settles this and it is not reopened. |
| Generation, inference, suggestion or defaulting of any recorded value | No code in the shipped tree does this. None is added. |
| Granting subagents `update_thread` or any lifecycle tool | See `C-9`. The server cannot distinguish a subagent from the main thread on an MCP call, so a wide grant cannot be narrowed server-side. |
| Enforcing that the human answers anything | Every gate covers the asking. The answer is the human's to withhold. |
| Promoting a subagent's observation to a thread-level risk automatically | That is a selection, and `C-9` assigns selections to whoever selected. The unpromoted-observation hole is an accepted risk, recorded in `10`. |

### 3.3 Deliberately opened and not taken

**Refusing to close a thread whose criteria were never confirmed.** Rejected. Making the honest path more expensive than the dishonest one produces dishonesty. `receipts GATES.md:662-665`: *"blocking converts an honest downgrade into an incentive to claim 'fixed' instead, which is the exact failure the ladder exists to prevent."* `goal model D-2` reached the same conclusion for `unverified-reasoned`.

**A holistic second-model check on a turn's recording.** Rejected on measured grounds. Judges shown a trajectory and asked whether it succeeded discriminate at AUROC 0.54–0.65 because they *"rely on surface completion proxies... rather than verified state changes"* ([Advani](https://arxiv.org/html/2606.09863)). Decomposed, grounded, per-item questions score far higher, which is the shape `5` adopts.

**A questionnaire the model answers to itself to improve criteria.** Rejected. Every measured result showing structured clarification improves outcomes supplies an oracle who answers ([ClarifyGPT, FSE 2024](https://arxiv.org/abs/2310.10996); [TiCoder, IEEE TSE 2024](https://arxiv.org/abs/2404.10100)). No study measures an agent interrogating itself into better criteria with nobody answering. The relay in `C-7` routes questions to the human, not inward.

**A rigid output format on the model's reasoning.** Rejected. Format restriction measurably degrades reasoning ([Tam et al., EMNLP 2024](https://aclanthology.org/2024.emnlp-industry.91/)). Structure is imposed on what is stored, never on how the model reaches it.

**A new record type for dead ends.** Rejected as unnecessary complexity. A rejected approach is a decision: `record_decision` already carries `context`, `options` and `outcome`. `R-2` names it so it gets used.

---

## 4. Definitions

### C-1 — A thread records before it can be completed

`open_thread` requires `active_goal` and `next_step`. `completion_criteria` becomes optional.

**The intent.** The open-time contract collects what is knowable at that moment and defers what is not. What the work is, and what happens next, are always knowable — the human just said them. What finishing looks like frequently is not.

**Nothing can close undefined.** `evaluateDoneGate` already returns `no-criteria` when no un-struck criterion remains (`src/domain/done-gate.ts:8`), and the stored schema already permits an empty array (`src/schema/thread.ts:190-194`). The constraint is not removed; it moves from a moment that cannot satisfy it honestly to the one that can.

This reverses the `minItems: 1` ruling shipped in `ce2ef720`, whose stated reason was that *"a thread can no longer be opened without a definition of done."* That reason is met instead by `R-8` and by the close gate, both of which fire when a definition is actually possible.

### C-2 — Settledness is a separate axis from doneness

Every criterion carries two independent questions:

| Question | Fields | State |
|---|---|---|
| Has the work happened? | `done`, `result`, `result_status` | modelled today |
| Do we know this is the right thing to want? | `settledness`, `settled_by` | not modelled |

Independent in both directions. A criterion can be `done` and never confirmed by anyone. A criterion can be `confirmed` and untouched.

**The intent, stated so it cannot be misread:** settledness is never a measure of quality, difficulty, or confidence. It records **who stands behind the statement**. A criterion the human dictated is `confirmed` even if badly worded. A criterion derived from a frozen, reviewed spec is `proposed`, because nobody confirmed *this wording* as the definition of done for *this thread*.

### C-3 — The three settledness values

| Value | Means | Written when |
|---|---|---|
| `confirmed` | the human stated this, or was shown it and agreed | the model holds the human's words |
| `proposed` | the model derived it — from a spec, a plan, the code, the request | anything else that is a real criterion |
| `unsettled` | done is genuinely not known for this part yet | see `C-4` |

`proposed` is the ordinary value and carries no stigma. There is no fourth value and no free-text alternative; a census that halts on the unclassifiable is the house discipline (`goal model 6.1` rule 4).

### C-4 — An unsettled criterion is a recorded question

This amends `goal model D-2`, which requires a check on every criterion and forbids a weaker tier because *"the cheaper path becomes the default path."*

**An `unsettled` criterion may carry no check.** That is not a weaker check. It is the absence of a claim for a check to decide.

- A `confirmed` or `proposed` criterion asserts what must be true. Something must decide it. `goal model A4` holds unchanged for these two values.
- An `unsettled` criterion asserts nothing. Its text names **what is not yet decided**.

Correct: *"what counts as an acceptable search latency is not decided."* Incorrect: *"search is fast enough"* — that is a proposition wanting a check, and a badly worded `proposed` criterion.

**Its role changed with `C-1`.** Under the previous design it was the escape from a mandatory field. With criteria optional, it is a positive record: a thread with three criteria and one named open question is more useful than one with three criteria and silence.

**Why it does not become the lazy path.** It is structurally the most expensive value, not the cheapest:

1. It cannot be marked done — there is no claim to be true (`A13`).
2. The close gate already requires every un-struck criterion to be done, so it blocks closing with no special case (`S7`).
3. Clearing it costs an `amend_criteria` rewrite, or a strike, and a strike costs a recorded decision.

**Why the value exists.** An agent with no sanctioned way to say it cannot state a criterion will manufacture one. Where success is impossible and appearing successful is the only way forward, models bend the rules at roughly half of attempts; a legitimate way to flag the task cut one model's rate from 54% to 9% ([Zhong, Raghunathan & Carlini](https://arxiv.org/html/2510.20270v1)). ISO/IEC/IEEE 29148 licenses the same shape: *complete* is a property of the requirement **set**, not the individual requirement.

### C-5 — Settledness is declared at creation, never inferred

The model writes the value in the same call that writes the criterion text.

**The intent.** Unlike `receipts`, Logbook needs no interview to *determine* this value. `receipts` asks at init because the fact it wants is unknowable to the agent — its schema says *"Detection cannot find any of this, so `receipts init` always asks a human."* Whether the human confirmed a criterion is not that kind of fact. The model was present for the conversation.

No code derives, defaults, guesses or upgrades a settledness value. An absent value is a refusal, never a substitution — the discipline of `goal model A6`.

### C-6 — Confirmation carries the human's own words

A criterion written or updated to `confirmed` carries `settled_by`: a short verbatim quote.

**It is never validated.** Nothing checks the quote is real, resembles the criterion, or appeared in the transcript. Logbook cannot check that and does not try.

**Its purpose is an effort asymmetry.** A model holding the human's words types them. A model without them must invent a sentence and attribute it in quotation marks. That second step is materially harder than ticking a box and leaves something a human can later spot as false. `receipts` states the same principle for its `RECEIPTS_ACK` escape: *"greppable on purpose — an honest note, never a silent skip."*

### C-7 — The criteria relay: ask at creation, answer on `update_thread`

Two halves. Both must exist or the axis is decorative.

**The ask.** `open_thread` returns, in its success payload, the criteria exactly as stored and server-authored text instructing the model to put them to the human. Not a count.

**Why creation and not resumption.** The `resume_thread` briefing was considered and rejected on three independently sufficient grounds:

1. **Wrong moment.** It renders at the start of a later session. A thread opened and worked in one sitting never renders one, so the ask would never fire.
2. **It reports, it does not ask.** A line reading *"1 confirmed, 2 proposed"* prompts no action. A human unfamiliar with Logbook's internals reads it and correctly does nothing.
3. **It misdirects.** Resumption exists to pick up and continue. A settledness summary there invites an audit instead of the next step. This is the reason for `S5`.

**Where the answer lands.** `update_thread` gains `criteria_settled`, shaped like the existing `criteria_done`: `[{ criterion_id, settledness, settled_by? }]`.

`update_thread` is the host rather than a new tool because it already marks criteria through an identically shaped argument; a thirteenth tool costs five contract axes plus two named tests; and the criteria-writers census already classifies a field recording *an observation about* a criterion as `allowed`, distinct from one carrying the criterion's own statement (`test/contract/criteria-writers.test.ts:83-102`).

`amend_criteria` is **not** the host. It writes criterion text and requires a resolving `decision_id`. Confirming what a criterion already says changes no text and warrants no decision.

### C-8 — Recording is continuous, not deferred to hand-off

Every actor records what it established at the moment it stops, not at the end of the session.

**The intent.** `park_thread` at debrief is a catch-all, not the primary store. If every actor recorded correctly as it stopped, a debrief would add nothing but what the human said in the final exchange. A debrief that is the only recording moment is a single point of loss: a crash, a context exhaustion, or a forgotten step loses the whole session.

The gates in `6` exist to make that true. They fire when the ledger has not moved, and they present the assertions in `5`.

### C-9 — The split is by knowledge, never by tool grant

**Who records what is decided by who holds the material, not by who holds the tools.**

A subagent has the narrower tool grant and by far the wider information: it read the files, ran the checks, found the cause. The main thread receives a summary. Recording at the main thread means recording *from that summary*, so everything the summary dropped is unrecoverable.

This restates the rule already shipped in the server instructions: *"recording at the subagent boundary is preferred to carrying the material back. The split is by content: a subagent records what it established, and a selection between live options is recorded by whoever selected."*

| Actor | Records |
|---|---|
| Subagent | what it established, tried, observed, produced, and could not determine |
| Main thread | the selection between options no subagent saw, what that means for the thread, and a sweep for anything a subagent could not record |

**Why an observation is not a risk.** A subagent finding *"this function swallows its errors"* is an observation, recorded in full through `log_session_event` or `record_decision`. Whether it rises to a thread-level risk is a **selection** about this work, made by whoever holds the thread. The same holds for files: a subagent records that it wrote one; whether it is an artifact later sessions must read is a thread-level judgement.

This is why the tool grant in `C-10` stays narrow rather than expanding to `update_thread`.

### C-10 — Specialist subagents record, they do not steer

Thirteen specialist agents gain `record_decision` and `log_session_event`. Nothing else.

Thread lifecycle — `open_thread`, `close_thread`, `park_thread`, `resume_thread`, `amend_criteria`, `bind_branch`, `update_thread`, `sync_ledger`, `resolve_conflict` — stays with the main thread, where the pointer and the human are.

**Why not `update_thread`.** It carries `next_step`, `active_goal`, criteria completion and risk retirement alongside the fields a subagent would want. An MCP call carries no caller identity, so the server cannot admit some of its arguments to a subagent and refuse others. A wide grant cannot be narrowed server-side, and prose in a dispatch brief is a weaker guard than the promotion step in `C-9`.

**Two consequences named rather than hidden.** A dispatch brief must carry the thread id or a subagent has nothing to record against. Two subagents recording concurrently commit to the same git ref; see `10`.

### C-11 — An assertion is model-checked; the gate presenting it is machine-checked

Two objects, and conflating them breaks `goal model 6.1`.

| Object | Class |
|---|---|
| The gate condition — when a hook fires, what clears it | **An invariant.** Subject, quantifier, decidable predicate, named enforcer, consequence. Lives in `6`. |
| The text a gate presents | **An assertion.** Its subject is what the model knows. Logbook has no model and cannot decide it. Lives in `5`. |

`goal model 6.1` rule 1 is explicit: *"If deciding it requires judgement, it is not an invariant."* No statement in `5` may appear in an `A`/`O`/`S` table (`S11`).

**Assertions are written as states, never as questions.** A question invites an answer; an asserted state invites a check. This is `goal model D-1` applied one level up — *"'Write the spec' is a task. 'A spec exists' is an artifact"* — and it is why `5` reads as claims about the record rather than a checklist.

**Two shapes are forbidden in an assertion**, each for a measured reason:

- **Self-evaluation.** *"Is the next step still true?"* asks the model to grade its own earlier text, and it will agree with itself. Assertions ask for the thing to be produced, so comparison happens against what is stored. This is the independence step that makes self-generated verification work at all ([CoVe, Findings of ACL 2024](https://aclanthology.org/2024.findings-acl.212/)).
- **Speculation.** *"What could go wrong?"* invites invented risks. Model-authored rubrics fail characteristically toward *"rules that are overly strict without being necessary"* ([RubricBench](https://arxiv.org/html/2603.01562v2)). Assertions name what was **observed**, never what could be imagined.

### C-12 — A discovery criterion is settled, and needs no new machinery

A criterion about producing understanding is an ordinary criterion. It has a proposition and a check, and it is `confirmed` or `proposed`. It is **not** `unsettled`.

```
text:  "the requirements for the login flow are captured in a spec the user has agreed to"
check: "docs/specs/login-flow.md exists and its open-questions section is empty"
```

That is decidable by a party other than the claimant, which is `goal model D-2`'s bar. It is legal in the shipped implementation today.

**The distinction:** `unsettled` says *we do not know what done means here.* A discovery criterion says *we know exactly what done means — understanding exists, written down, agreed.* The first is an absence, the second a goal.

A planning thread commonly carries both.

### C-13 — A phase change is succession, not amendment

When design concludes and implementation begins, the shape is a **new thread naming the old** through `predecessor_id`, not a criteria set churned in place.

**Why.** A set half struck and half replaced forces a later session to reconstruct what done currently means from a trail of edits. That reconstruction is lossy: given the same final obligations, 35 of 100 tasks that succeed on a directly-stated specification fail when the identical requirements arrive as a revision history ([SpecPath](https://arxiv.org/html/2608.09799)).

**The test is shippability, not phase.** Does closing the first part leave something that stands on its own?

| Signal | Shape |
|---|---|
| the spec or plan is a deliverable someone could act on, argue with, or never implement | two threads, linked |
| the criteria are the same goal at lower resolution and nobody would stop there | one thread, criteria amended |

**Guidance, not a rule.** Both shapes stay legal and nothing enforces this. It is recorded because the briefing renders `Related:` from `predecessor_id` and a reader needs to know what that link means.

---

## 5. The recording assertions

Statements a gate presents. Each names one thing a zero-context session would need and asserts that the record holds it. **They are checked by the model, never by Logbook** (`C-11`), and none may appear in an `A`/`O`/`S` table (`S11`).

They are ordered as a fresh session reads, not as work happens.

### 5.1 Presented at `SubagentStop`

*Before this agent's work leaves the only context that holds it:*

| ID | Assertion |
|---|---|
| **R-1** | Every cause, measurement or approach this agent established is on the record. |
| **R-2** | Every approach tried and abandoned is recorded, with what made it fail. |
| **R-3** | Every fault this agent **observed** in what it read is recorded, and nothing it merely imagines is. |
| **R-4** | Every file this agent produced or changed is named. |
| **R-5** | Where the work stopped is recorded, when it stopped short of its brief. |
| **R-6** | Everything this agent could not determine is recorded, with what blocked it. |

`R-2` is the highest-value statement in this document. A dead end exists only in the work; a closing summary structurally cannot carry it, and without it the next session repeats it.

`R-3` carries the anti-speculation rule from `C-11` in its own text, because that is where it binds.

### 5.2 Presented at `Stop`

*Most of `5.1` is already on the ledger by the time this runs.*

| ID | Assertion |
|---|---|
| **R-7** | Every selection between options is recorded by whoever selected. No subagent saw the alternatives. |
| **R-8** | The thread's definition of done reflects what is now known. |
| **R-9** | The recorded next action is one someone could begin without re-deriving anything, naming the file and the place in it for an action that involves one. |
| **R-10** | Everything a subagent returned but could not record itself is on the record. |

`R-8` is what replaces the `minItems: 1` constraint removed in `C-1`. It fires at every stop, which is when a definition of done becomes possible, rather than once at open, which is when it is least likely to exist.

`R-9` is stated as a property of the recorded action rather than a question about it, per `C-11`.

`R-10` is the sweep. It is the main thread's only origination duty; everything else it records is selection.

### 5.3 Rules governing the set

1. **Every assertion names a category a briefing renders.** An assertion whose answer reaches no rendered surface produces a record nothing reads.
2. **Every assertion is honestly answerable with "already true".** An assertion that cannot be satisfied by an empty turn manufactures content.
3. **No assertion asks the model to grade its own earlier output** (`C-11`).
4. **No assertion invites what could happen** rather than what was observed (`C-11`).
5. **The set is closed and short.** Ten total, six and four. A checklist long enough to skim is a checklist that gets skimmed.

---

## 6. Invariants

An invariant is the executable form of a promise, with the five parts `goal model 6` requires. Job classes and enforcers are unchanged.

### 6.1 Job A — the tool refuses

*Enforced by the tool. Falsified by making the call.*

| ID | Invariant | Traces to |
|---|---|---|
| **A8** | For every `open_thread` call, an absent or whitespace-only `active_goal` is refused | `C-1` |
| **A9** | For every `open_thread` call, an absent or whitespace-only `next_step` is refused | `C-1` |
| **A10** | For every `open_thread` call, a `completion_criteria` that is absent, or present and empty, is accepted and the thread is created. The two are equivalent and neither is a refusal | `C-1` |
| **A11** | For every criterion created or inserted, an absent `settledness` is refused. No value is derived, defaulted or inferred | `C-5` |
| **A12** | For every criterion created or inserted whose settledness is `confirmed` or `proposed`, an absent `check` is refused. `goal model A4` is unchanged for these two values | `C-4` |
| **A13** | For every criterion whose settledness is `unsettled`, a call marking it done is refused, and the refusal states that an unsettled criterion asserts nothing for a result to report | `C-4` |
| **A14** | For every criterion written or updated to `confirmed`, an absent or empty `settled_by` is refused; for `proposed` or `unsettled`, a supplied `settled_by` is refused | `C-6` |
| **A15** | For every `criteria_settled` entry, a `criterion_id` naming no criterion on the thread is refused, a repeated id within one call is refused, and an id naming a struck criterion is refused | `C-7` |
| **A16** | No call is ever refused because of the settledness value itself. All three values are accepted at creation, at insert, and at update | `C-3`, `3.3` |

`A16` is the load-bearing negative invariant. It is falsified by any refusal path whose condition reads the settledness value in isolation rather than in combination with a missing companion field.

### 6.2 Job O — the output tells the truth about itself

*Enforced by the renderer. Falsified by rendering.*

| ID | Invariant | Traces to |
|---|---|---|
| **O6** | For every criterion rendered on any surface, its settledness appears on that criterion's own line | `C-2` |
| **O7** | For every criterion rendered as `confirmed`, its `settled_by` quote appears on that criterion's rendering, or the rendering states that it was shortened | `C-6` |
| **O8** | For every `open_thread` success, the reply carries the criteria as stored and the instruction to put them to the human | `C-7` |
| **O9** | For every `close_thread` success, the reply reports how the closed criteria divide by settledness, and no count is ever a reason to refuse | `C-3`, `3.3` |
| **O10** | For every `Stop` gate block, the block text names which of `R-7` through `R-10` the thread record is observably silent on — zero linked decisions, zero artifacts, zero un-struck criteria — and presents the remainder in full | `C-8` |
| **O11** | For every `SubagentStop` gate block, the block text presents `R-1` through `R-6` in full, naming none as satisfied. A subagent's assertions concern work the store cannot observe | `C-8`, `C-9` |
| **O12** | For every gate block of either kind, the text states that the gate reports only that the record is silent, and makes no claim about what the answer should be | `C-11` |

`O9` is the aggregation guard `goal model D-2` relies on in place of refusal. It fires at close, when the work is over and a summary prompts nothing. It deliberately does not fire at resume.

### 6.3 Job S — the codebase has not lost a property

*Enforced by a test or census. Falsified by a red build.*

| ID | Invariant | Traces to |
|---|---|---|
| **S5** | No render function reachable from `resume_thread` computes any aggregate over the settledness field. Per-criterion rendering under `O6` is the only settledness output on that path | `C-7` |
| **S6** | The `settledness` and `settled_by` fields each have at least one named reader outside the writer that stores them | `goal model` LG6 |
| **S7** | The done gate contains no branch that reads the settledness field. An unsettled criterion blocks closing through `A13` and the existing doneness requirement, never through a settledness-specific condition | `C-4` |
| **S8** | For every gate fire, the gate is cleared by the ledger head moving from the value recorded at that fire. No write is inspected for content, and no write is attributed to an actor | `C-8` |
| **S9** | The `Stop` gate stands down silently for the remainder of the session once both conditions hold: it has fired at least twice for this thread, and a fresh human turn has entered the transcript since the last fire. Neither condition alone stands it down | `C-8` |
| **S10** | The `SubagentStop` gate fires at most once per `agent_id`, and a second `SubagentStop` for an `agent_id` already fired emits nothing | `C-8` |
| **S11** | No statement in section `5` appears in any `A`, `O` or `S` invariant | `C-11` |
| **S12** | `SubagentStop` is bound in the hook manifest and admitted by both closed event censuses | `C-8` |

`S5` is the invariant most likely to be violated by a well-meaning implementer, because a summary count looks helpful. It is a census over `src/render/briefing.ts` and its callees, halting on any reduction over the settledness field.

`S9` is not optional polish. A gate that fires every turn is cleared reflexively with the cheapest possible write, which reproduces today's presence check with added friction. `receipts stop-gates.mjs:479-482` records the measured version of this failure and the damping that fixed it.

---

## 7. Behavioural rules

### Schema — `src/schema/`

- **B44** `Criterion` gains `settledness`, an enum of exactly `confirmed`, `proposed`, `unsettled`. Not nullable. Field class `structural`.
- **B45** `Criterion` gains `settled_by`, a nullable string capped by a new constant `CRITERION_SETTLED_BY_MAX`. Field class `content`, therefore it must reach a rendered surface under `goal model O4`.
- **B46** `CRITERION_SETTLED_BY_MAX` is added to the caps census with a stated role.
- **B47** `Criterion.check` is accepted as absent on the create and insert paths when and only when `settledness` is `unsettled`. The stored schema already permits a null check and is unchanged.
- **B48** Records written before this change parse unchanged. A stored criterion with no settledness field reads as `proposed`, and that read-time substitution exists **only** for records predating the field. No write path may produce one.
- **B49** The stored thread schema is unchanged with respect to `completion_criteria` cardinality. It already permits zero and must continue to.

`B48` and `B49` follow the legacy-record repair that `minItems: 1` originally needed: the constraint lives where a value is submitted, never on the stored record.

### Tool contracts — `src/server/tools/`

- **B50** `open_thread` takes `active_goal` and `next_step` as required strings, capped by the existing spine caps, and writes them into the spine at creation in place of the empty strings.
- **B51** `open_thread`'s `completion_criteria` becomes optional and accepts an empty array.
- **B52** `open_thread`'s criterion input takes `settledness` as required, `check` as required unless `settledness` is `unsettled`, and `settled_by` as required if and only if `settledness` is `confirmed`.
- **B53** `amend_criteria` insert takes the same three fields under the same conditions.
- **B54** `amend_criteria` rewrite is unchanged. It writes `text` and nothing else. Settledness is not a text edit.
- **B55** `update_thread` gains `criteria_settled`, an optional array of `{ criterion_id, settledness, settled_by? }`, capped at the same element count as `criteria_done`.
- **B56** A settledness transition may move a criterion between any two values, including `confirmed` back to `proposed`. The record keeps only the current value.
- **B57** `open_thread`'s reply text carries the stored criteria and the relay instruction, naming the action rather than a count. A thread opened with no criteria carries instead the statement that none were recorded and that a definition of done is still owed.
- **B58** `close_thread`'s output schema gains a settledness split beside `result_status_split`, with a description stating that no count is a reason to refuse.
- **B59** Every new input property carries a description of at least ten characters, and every new input argument is either named by a `PUBLISHED_CLAIMS` phrase or given a distinct `ARGUMENT_GAPS` reason.
- **B60** The breaking input changes to `open_thread` and `update_thread` ship with a version bump, on the pattern of `8386c370` and `836860f4`.

### Renderer — `src/render/`

- **B61** The criterion line gains its settledness marker beside the existing `[open]` / `[done]` / `[struck]` status. Both render.
- **B62** A `confirmed` criterion renders its `settled_by` quote as a sub-line, using the existing `not recorded` substitution when absent on a legacy record.
- **B63** No settledness aggregate renders on any surface reachable from `resume_thread`. The roster gains no settledness column.
- **B64** A thread with zero un-struck criteria renders a line saying so, in place of a suppressed empty section, so a fresh session learns the definition of done is still owed rather than inferring it from silence.
- **B65** Both briefing golden fixtures are updated. New interpolation sites pass the render escaping census.

`B64` is the render half of `C-1`. Without it, a thread with no criteria and a thread whose criteria section was clipped are indistinguishable.

### Hooks — `hooks/`, `src/hooklib/`

- **B66** `SubagentStop` is bound in the hook manifest, and both closed event censuses are updated to admit it.
- **B67** The `Stop` gate presents `R-7` through `R-10` when the ledger head has not moved since the baseline, naming which of them the thread currently holds nothing for.
- **B68** The `SubagentStop` gate presents `R-1` through `R-6`, once per `agent_id`.
- **B69** Both gates record the ledger head at the moment they fire, and clear when that head has moved. No write is inspected for content, and no write is attributed to an actor.
- **B70** The `Stop` gate stands down silently for the rest of the session once it has fired at least twice for this thread **and** a fresh human turn has entered the transcript since the last fire. Neither condition alone stands it down. The `SubagentStop` gate needs no separate damping: `B68` keys it to `agent_id`, which is unique per subagent instance, so it is one-shot by construction and needs no `stop_hook_active` equivalent.
- **B71** Both block texts state that the gate reports only that the record is silent, and make no claim about what the answer should be.
- **B72** Gate state — the head at last fire, the fire count, and the set of fired `agent_id` values — lives under `state/`. It is session-scoped, per-install, and never synced.
- **B73** Both gates fail open. Any parse or IO problem emits nothing, on the principle that a missed prompt beats a spurious block that jams the agent.

`B73` follows `receipts pre-gates.mjs:17-18` verbatim in intent: *"It fails SAFE on any parse/IO problem (a missed tripwire beats a spurious deny that jams the agent)."*

### Skills — `skills/`

- **B74** A new `file` skill opens a thread. Its ordered steps gather the goal, the next action, what finishing looks like where known, and what has already happened this session; call `open_thread`; present the stored criteria; wait for the human; call `update_thread` with `criteria_settled`; call `log_session_event` with the prior context; call `resume_thread`; print the briefing verbatim; stop.
- **B75** `debrief` and `preflight` are unchanged. Neither gains a settledness or recording step.
- **B76** Every line of `file` passes the skills contract: no banned rule marker, every step opening with one of the six sequence verbs, every backtick span naming a live tool or a real field.

`B75` is a decision, not an omission. The skills contract bans conditional and rule language, and every behaviour in `5` and `6` is conditional. That guidance lives in tool descriptions, reply text and gate text, all of which may state conditions.

### Agent roster — outside this repository

- **B77** Thirteen specialist agent definitions gain `record_decision` and `log_session_event`, and nothing else.
- **B78** Dispatch briefs for those agents carry the thread id, or the grant is inert.

`B77` and `B78` land in the user's global configuration, not in this repository. They are recorded here because `C-9` and `R-1` through `R-6` are inert without them, and a spec that omits its own external dependency is incomplete.

---

## 8. Units

### Wave 1 — no dependencies

- **U1** Schema: `B44`–`B49`. Fields, cap, legacy read, cardinality.

### Wave 2 — after U1, mutually disjoint

- **U2** Formation: `B50`, `B51`. Invariants `A8`, `A9`, `A10`.
- **U3** Create and insert: `B52`, `B53`, `B54`. Invariants `A11`, `A12`, `A14`.
- **U4** Update path: `B55`, `B56`. Invariants `A13`, `A15`, `A16`.
- **U5** Renderer: `B61`–`B65`. Invariants `O6`, `O7`, `S5`.

### Wave 3 — after U2 through U4

- **U6** Relay and close reporting: `B57`, `B58`, `B59`, `B60`. Invariants `O8`, `O9`.
- **U7** Recording gates: `B66`–`B73`. Invariants `O10`, `O11`, `O12`, `S8`, `S9`, `S10`, `S12`.

### Wave 4 — after U6 and U7

- **U8** The `file` skill: `B74`, `B75`, `B76`.
- **U9** Census and contract repair: `S6`, `S7`, `S11`, plus the described / claims / gaps census updates the earlier units make necessary.

### Externally gated

- **U10** Agent roster: `B77`, `B78`. Applied by the user outside this repository. `U7` ships without it and the `SubagentStop` gate is a no-op until it lands.

---

## 9. Coverage

**Every definition has at least one invariant or assertion.** `C-1` → `A8`, `A9`, `A10`, `R-8`, `B64`. `C-2` → `O6`. `C-3` → `A16`, `O9`. `C-4` → `A12`, `A13`, `S7`. `C-5` → `A11`. `C-6` → `A14`, `O7`. `C-7` → `A15`, `O8`, `S5`. `C-8` → `O10`, `O11`, `O12`, `S8`, `S9`, `S10`, `S12`. `C-9` → `R-1`–`R-10`. `C-10` → `B77`, `B78`. `C-11` → `O12`, `S11`, and the two forbidden shapes are enforced by `5.3` rules 3 and 4 at authoring time rather than at runtime. `C-12` and `C-13` are guidance and carry no invariant by design, stated so their absence is not read as oversight.

**Every invariant belongs to a unit.** `A8`–`A10` → U2. `A11`, `A12`, `A14` → U3. `A13`, `A15`, `A16` → U4. `O6`, `O7`, `S5` → U5. `O8`, `O9` → U6. `O10`, `O11`, `O12`, `S8`, `S9`, `S10`, `S12` → U7. `S6`, `S7`, `S11` → U9.

**Every behavioural rule belongs to a unit.** `B44`–`B49` → U1. `B50`, `B51` → U2. `B52`–`B54` → U3. `B55`, `B56` → U4. `B61`–`B65` → U5. `B57`–`B60` → U6. `B66`–`B73` → U7. `B74`–`B76` → U8. `B77`, `B78` → U10.

**Every assertion reaches a rendered surface**, per `5.3` rule 1. `R-1`, `R-2`, `R-7` → decision records, resolved in the briefing. `R-3`, `R-5`, `R-6` → session log, rendered in the briefing's previous-session section. `R-4` → artifacts, or the session log where not yet promoted. `R-8` → completion criteria. `R-9` → `spine.next_step`. `R-10` → whichever of the above the material belongs in.

---

## 10. Accepted risks

**An unpromoted observation stays invisible in the briefing's risk section.** `C-9` assigns promotion to the main thread, and `R-10` prompts it, but nothing enforces it. A subagent's observation logged and never promoted remains findable at `logbook://sessions/{thread_id}` and never surfaces as a thread risk. Accepted because the alternative — granting subagents `update_thread` — hands them `next_step`, `active_goal` and risk retirement, and the server cannot narrow it.

**Concurrent subagent commits contend for one git ref.** Two subagents recording at the same moment both commit to `refs/logbook/ledger`. The store's behaviour under that contention is not characterised by this document. It predates it — the grant in `C-10` widens the exposure rather than creating it. This needs measurement before `U10` lands.

**The `SubagentStop` gate is a no-op until the roster changes.** `U7` ships a gate that fires for agents with no tool to satisfy it. The block text must therefore name the return message as an acceptable destination, so an ungranted agent is prompted rather than trapped.

**A gate cleared by a junk write is not distinguishable from one cleared honestly.** `S8` deliberately inspects no content. The mitigation is the assertion text naming what to record, and the acceptance that a greppable skip beats a silent one. Preventing it would require judging content, which `3.2` forbids.

---

## 11. What this spec does not settle

**Whether `proposed` needs a reason field.** A criterion could record *why* it was never confirmed — the human was absent, the question was raised and deferred, nobody thought to ask. Those three are different and the record cannot distinguish them. Not taken because the value is speculative and the field is cheap to add later.

**How a later session should weigh a `proposed` criterion.** The record now says who stands behind a criterion. It says nothing about what to do with that. Left to the model deliberately; prescribing it would be a workflow assumption.

**Whether the `Stop` gate should fire again months later.** As specified it fires at most twice per session per thread. A thread whose criteria are amended much later gets no fresh ask. Whether that is right needs the per-criterion timestamps `3.2` excludes.

**What wins on a merge when two clones disagree about settledness.** The union-by-id merge compares four criterion fields and settledness is not among them. Adding it is mechanical; the case where one clone confirmed a criterion and another struck it needs a stated winner, and this document does not state one.

**Whether `active_goal` and `next_step` should be capped differently at open than at update.** They reuse the existing spine caps. Whether an opening statement wants a shorter limit than a mid-thread refresh is unexamined.
