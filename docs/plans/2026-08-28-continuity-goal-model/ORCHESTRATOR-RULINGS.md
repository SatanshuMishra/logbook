# Orchestrator rulings — continuity goal model

Cross-unit facts and choices settled once, centrally, so that eleven plan documents agree.

Binding on every agent that produces a plan document under this directory, alongside
`PLANNING-BRIEF.md`. Precedence: the approved SPEC governs WHAT is built; `PLANNING-BRIEF.md`
governs HOW a plan is written; this file governs the cross-unit facts no single planner can
settle alone. Where this file names a divergence from the SPEC, this file wins for planning
purposes and the divergence is restated in the affected plan's
`## 3. Divergences from the SPEC`.

**Rulings here are numbered `OR#`, never `O#`.** The SPEC reserves `O#` for its Output
invariants (`O1`–`O5`). A ruling written `O2` would be unreadable against `O2` the invariant.

## OR0 — The SPEC is frozen and correct

Do not re-verify it. Do not re-derive its defects. Do not audit its rulings. Do not spend a tool
call proving a defect it already established. You read source for exactly one reason: to copy the
literal current text into FIND blocks and to author the literal REPLACE text. See
`PLANNING-BRIEF.md` section 3.

## OR1 — Ladder order, waves, branch names and version bumps

Eleven merges. `U0` is the gate-zero unit the SPEC's section 10 requires before `U1` is cut; it
is not one of the SPEC's ten units and carries no `B#`.

Wave membership is the SPEC's, with one divergence recorded at `OR2`.

| Order | Unit | Wave | Branch | PR title scope | Version from -> to |
| --- | --- | --- | --- | --- | --- |
| 1 | U0 Trunk verification gate | 0 | `ci/u0-trunk-verification-gate` | `workflows` | 1.4.1 -> 1.4.2 |
| 2 | U1 Schema foundations | 1 | `feat/u1-schema-foundations` | `schema` | 1.4.2 -> 1.5.0 |
| 3 | U2 Store cost and safety | 1 | `perf/u2-store-cost-and-safety` | `store` | 1.5.0 -> 1.5.1 |
| 4 | U3 Promises | 1 | `docs/u3-promises` | `readme` | 1.5.1 -> 1.5.2 |
| 5 | U4 Criterion contract | 2 | `feat/u4-criterion-contract` | `criteria` | 1.5.2 -> 2.0.0 |
| 6 | U5 The briefing hides nothing | 2 | `feat/u5-briefing-hides-nothing` | `briefing` | 2.0.0 -> 2.1.0 |
| 7 | U6 Discovery | 2 | `feat/u6-discovery` | `discovery` | 2.1.0 -> 2.2.0 |
| 8 | U7 Capture | 2 | `feat/u7-capture` | `hooks` | 2.2.0 -> 2.3.0 |
| 9 | U8 Derived last_session | 3 | `feat/u8-derived-last-session` | `briefing` | 2.3.0 -> 2.4.0 |
| 10 | U9 Declared focus | 3 | `feat/u9-declared-focus` | `focus` | 2.4.0 -> 2.5.0 |
| 11 | U10 Write fidelity | 4 | `fix/u10-write-fidelity` | `escape` | 2.5.0 -> 2.5.1 |

Units inside one wave are cut from the same `main` tip and may be authored and implemented in
parallel. They MERGE serially in the order above, and each one rebases onto `main` and re-runs
its full verification before its pull request is opened.

**U4 bumps MAJOR.** SPEC rule `B9` changes `update_thread.criteria_done` from `Ulid[]` to
`{ criterion_id, result, result_status }[]` and states in its own words that this is a breaking
input change. No in-repo caller exists, but the tool is published over MCP to agents outside this
repository, and semantic versioning answers to the published contract, not to the in-repo caller
count. Rejected: a minor bump on the ground that no shipped skill calls it. That hides a breaking
change from the only signal an external caller reads.

## OR2 — DIVERGENCE: wave 3 is ordered, not parallel

SPEC section 9 states "units within a wave are disjoint and parallel-safe" and "each file belongs
to exactly one unit per wave". Wave 3 breaks both: `U8` owns `src/render/briefing.ts` and
`src/server/tools/park_thread.ts`; `U9` owns `src/domain/pointer.ts`,
`src/server/tools/{resume_thread,update_thread,record_decision}.ts`, `src/render/briefing.ts` and
`skills/preflight/SKILL.md`. `src/render/briefing.ts` appears in both.

Ruled: **wave 3 is sequential. U8 merges first; U9 is cut from a `main` that already contains
U8.** `U9`'s plan carries a stop condition proving U8 landed before any edit to
`src/render/briefing.ts` begins.

Rejected: splitting `briefing.ts` between them by region. Two planners authoring FIND/REPLACE
against overlapping regions of one file cannot both be applied without a merge judgement, and
`PLANNING-BRIEF.md` section 2 forbids passing a judgement to the implementer.

Both plans restate this in their section 3 in one line.

## OR3 — The pull request tool path

    node ~/.claude/lib/git/pr.mjs pr-create

That is the operator's global tool; there is no `.claude/lib` inside this repository. Every
plan's section 10 uses that path. Ad-hoc `gh pr create`, `gh api` POSTs to the pulls endpoint and
the GitHub MCP create tool are denied at the gate; a plan that instructs any of them is a defect
in the plan. A pull request title and body are fixed at creation and are never rewritten
afterwards, so a plan never instructs `gh pr edit`.

**No planner opens a pull request.** If a skill or slash command offers to create one, refuse it.

## OR4 — Base branch, parent commit, and what "red on the parent" means

- Every unit branch is cut from `main` and every pull request targets `main`.
- `main` is at `e5f0195` at planning time. The spec branch `docs/continuity-goal-model-spec`
  carries `fd5b38b` and `4203de9`, both documentation-only: `git diff --stat main...HEAD` touches
  one file under `docs/`. `src/`, `test/`, `hooks/`, `bin/`, `skills/` and `scripts/` are
  therefore byte-identical between `e5f0195` and `4203de9`.
- "Red on the parent" in every plan means: red at the commit the unit branch was cut from. State
  it as "the tip of `main` at branch-cut time; `e5f0195` at authoring time for wave 0 and wave 1".
  A wave-2 unit's parent contains U1; a wave-3 unit's parent contains all of waves 1 and 2.
- Plan documents are handed to the implementer as files. Do not assume the implementer can
  `git show` them.
- After a merge that a later unit depends on, the content is asserted to have arrived rather than
  inferred from a MERGED status:
  `git merge-base --is-ancestor <merged-head> origin/main`.

## OR5 — Plan file names, one per unit

    docs/plans/2026-08-28-continuity-goal-model/U0-trunk-verification-gate.md
    docs/plans/2026-08-28-continuity-goal-model/U1-schema-foundations.md
    docs/plans/2026-08-28-continuity-goal-model/U2-store-cost-and-safety.md
    docs/plans/2026-08-28-continuity-goal-model/U3-promises.md
    docs/plans/2026-08-28-continuity-goal-model/U4-criterion-contract.md
    docs/plans/2026-08-28-continuity-goal-model/U5-briefing-hides-nothing.md
    docs/plans/2026-08-28-continuity-goal-model/U6-discovery.md
    docs/plans/2026-08-28-continuity-goal-model/U7-capture.md
    docs/plans/2026-08-28-continuity-goal-model/U8-derived-last-session.md
    docs/plans/2026-08-28-continuity-goal-model/U9-declared-focus.md
    docs/plans/2026-08-28-continuity-goal-model/U10-write-fidelity.md

## OR6 — The version bump is mechanical, and a shifted ladder must not break the plan

Write section 0's version line as: "Baseline `<from>` -> `<to>` per orchestrator ruling OR1."

Write the step itself as a read-then-increment, never as a hard-coded pair:

1. The implementer reads the current version from `package.json`.
2. It increments per the unit's Conventional Commits type: `fix`, `ci`, `docs` and `perf`
   increment PATCH; `feat` increments MINOR and sets PATCH to 0; U4 alone increments MAJOR and
   sets MINOR and PATCH to 0.
3. It writes the same value into `package.json` and `.claude-plugin/plugin.json` in one commit
   (`P4`).
4. It runs `node scripts/check-packaging.mjs` and expects exit 0.

Give the exact commands. Read `scripts/check-packaging.mjs` and any existing version script before
you author them, and match whatever the repository already does rather than inventing a second
way.

Stop condition for section 11: STOP if `package.json` and `.claude-plugin/plugin.json` disagree
with each other before the change. A version merely HIGHER than the baseline means the ladder
shifted and is NOT a stop condition.

## OR7 — Filed items are appended, never rewritten

Anything discovered above a unit's acceptance ceiling goes to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` (`P9`).

Because several planners run concurrently, append with a SINGLE shell append and never a
read-modify-write:

    cat >> docs/plans/2026-08-28-continuity-goal-model/FILED.md <<'FILED_EOF'

    ## F<n> — <one-line title>

    - **Surfaced by:** U<n> planning
    - **Evidence:** <path:line, plus the verbatim line or command output you personally read>
    - **Why it is above the ceiling:** <which acceptance criterion it exceeds>
    - **Not folded in.**
    FILED_EOF

Number your items `F<unit number><letter>` (`F1a`, `F1b`, `F5a`) so concurrent planners cannot
collide. Never edit an item another planner wrote.

## OR8 — The plan is self-contained

The implementer reads the plan and the repository. It does not read the SPEC, this file, the
planning brief, or any other unit's plan. Therefore:

- Never instruct "see SPEC section X" or "per rule B12". Quote the sentence you need, inline.
- Never instruct "as in U1's plan". State the literal precondition and make it a stop condition.
- Cross-unit coupling appears twice and only twice: as `Depends on:` in section 0, and as a
  concrete, checkable stop condition in section 11 ("run `<command>`; if the output is not
  `<exact text>`, STOP and report; do not improvise").

## OR9 — No plan edits another plan, the SPEC, or the brief

Write only your own plan file, and append-only to `FILED.md`. If your unit's correctness depends
on another unit's plan saying something specific, say so in your return summary and let the
orchestrator resolve it. Do not reach into another planner's file.

## OR10 — A unit may create a new module; creating is not a file conflict

File ownership in SPEC section 9 governs EXISTING files. A unit that needs a new module creates
it, wholly owns it, and names it in section 0. Two units must not create modules at the same
path; if your unit's natural new-module path is plausibly another unit's too, say so in your
return summary rather than assuming.

## OR11 — U1 may reach outside `src/schema/` only to keep the tree green, and must enumerate it

SPEC rule `B7` puts `Criterion.kind` to a census that may REMOVE it, and `B6` puts every
`*_MAX_ELEMENTS` to a census that may convert one to a size bound. Either outcome can break a
reader outside `src/schema/`.

Ruled: U1 may edit a file outside `src/schema/` only where the tree would not typecheck or the
suite would not pass otherwise. Every such file is enumerated in U1's section 0 under an explicit
`Also edits (to keep the tree green):` line, with the reason. No other wave-1 unit may touch an
enumerated file. If an enumerated file is owned by a LATER unit, U1 states that in its return
summary so the orchestrator can rule.

The census outcomes themselves are decided IN U1's plan, by running the census, and written down
as findings. `PLANNING-BRIEF.md` section 2 forbids passing either decision to the implementer:
the plan says "`Criterion.kind` is removed" or "`Criterion.kind` is retained and its reader is
`<path:line>`", never "remove it if no reader is found".

## OR12 — The write-time size bound is U1's, and U5 proves it landed before removing a display cap

Thread criterion `01M135QS1C1FRG2JV7DFCK2TKH` requires that the write-time limit replacing the
removed display caps be sized against the largest existing thread record BEFORE the display caps
are removed, and that the sizing be recorded.

Ruled: **U1 owns the sizing and the bound**, because `src/schema/caps.ts` is U1's file and U1
precedes U5 by a whole wave. U1's plan carries, as a numbered acceptance criterion, the measured
serialised byte size of the largest thread record in the live store at planning time, the chosen
bound, and the arithmetic connecting them. The measurement is taken against a COPY of the store,
read-only, never by writing to it.

`U5`'s section 11 carries a stop condition that proves the bound landed before any display cap is
deleted. Nothing is hidden at display time to achieve the bound — that is the defect U5 exists to
remove.

## OR13 — Every unit ships its receipt; a unit that cannot is downgraded, not quietly passed

`P11` is not satisfied by "the suite is green". Each unit's section 6 names the acceptance test
that is RED at the parent commit, with the exact expected failure text, and section 7 names the
inertness mutation that must turn it red again.

Where a receipt genuinely cannot be produced — the behaviour is not observable through any public
surface, or the red cannot be reached at the parent — the plan says so explicitly under the
criterion, names the honesty-ladder status it will ship under (`unverified-reasoned`), and states
the specific reason. It does NOT substitute a proxy assertion and call it a receipt, and it does
not weaken the criterion until a proxy fits.

## OR14 — Quality gate before you return

Before returning, dispatch `conformance-auditor` over the plan document you wrote. Give it a
closed obligation list built from: `PLANNING-BRIEF.md` section 2 (the bar), `PLANNING-BRIEF.md`
section 6 (the twelve mandatory headings, in order), plan invariants `P1`–`P11`, and rulings
`OR0`–`OR13` above. Require one evidence-backed verdict per obligation. Repair every failed
obligation yourself, then return. Do not return a plan with a known unmet obligation; if one
genuinely cannot be met, say so explicitly in your return summary and name it in the plan.

## OR15 — The field-class declaration mechanism

Settled centrally because SPEC section 6.5 mandates that every field declare a class but does not
specify the mechanism, and two units read those declarations: `U1` enforces `A5` at write time and
`U6` censuses `content` fields for `O4`. Two authors inventing it independently would diverge.

**Ruled:** a field declares its class as zod metadata via `.meta({ class })`, applied through three
named constructors in a new module `src/schema/field-class.ts`. The class travels into the record's
generated JSON Schema automatically, where both `A5` and `O4` read it.

Grounds, each personally verified by the deciding agent: `declare()` already computes and exposes a
JSON Schema per record (`src/schema/declare.ts:23`); zod 4.4.3 copies registry metadata verbatim into
that output (`node_modules/zod/v4/core/to-json-schema.js:80-82`, with `GlobalMeta` carrying
`[k: string]: unknown` at `node_modules/zod/v4/core/registries.d.cts:24-32`); and the repository
already runs a halting census over exactly that structure (`test/contract/described.test.ts:20-62`).
The declaration therefore needs no new registry, no sibling map and no new walker.

### How a field declares its class

`src/schema/field-class.ts` is new and owned by U1. It exports `structural`, `content` and `pointer`.
`pointer` also carries the `A5` validator, so declaring a class and enforcing it are one act:

```ts
export const POINTER_PATTERN = /^(?!\+\+\+ )(?!--- )(?!.*(?:```|@@ |U\+000A|U\+000D))[^\r\n]*$/

export const structural = <T extends z.ZodType>(schema: T) => schema.meta({ class: 'structural' })
export const content = <T extends z.ZodType>(schema: T) => schema.meta({ class: 'content' })
export const pointer = (max: number, description: string) =>
  z.string().max(max).regex(POINTER_PATTERN).describe(description).meta({ class: 'pointer' })
```

Applied to a real schema — `RiskSchema` at `src/schema/thread.ts:65-74` — `refs` becomes:

```ts
refs: z
  .array(pointer(caps.RISK_REF_MAX, 'one external pointer backing this risk'))
  .max(caps.RISK_REFS_MAX_ELEMENTS)
  .describe('external pointers backing this risk')
  .meta({ class: 'pointer' })
```

Order is free. Metadata survives both `.meta().max()` and `.max().meta()` and does not clobber
`.describe()` in either direction.

### How `A5` reads it at write time

It reads nothing. The class constructor IS the validator. `POINTER_PATTERN` is a schema-level
`regex`, so it fires inside the shipped write path at `src/store/records.ts:36` and at the single
thread choke point `src/server/tool-support.ts:129`, producing a `pattern` / `invalid_format` issue —
never `custom`, so `retryable` stays `true` (`src/schema/refusal.ts:78`). `refuse()` renders the
four-part shape naming the field as `refs.0` (`src/schema/refusal.ts:83-98`).

**One defect U1 must fix as part of this:** `invalidThreadRecordRefusal` hardcodes `field: 'thread'`
(`src/server/tool-support.ts:102-109`) and discards `validated.field`. `A5` requires the refusal to
name the field, so `commitThread` must forward `validated.field` instead. This is inside U1's
ceiling, not above it: without it `A5` is unsatisfiable.

### How `O4`'s census reads it, and how it halts

U6 reuses `census` (`test/support/census.ts:11-24`) and the flattener at
`test/contract/described.test.ts:20-46`. **U6 owns lifting that flattener verbatim into
`test/support/schema-nodes.ts`** so both tests import one copy. The classifier:

- node is not a plain object -> `unclassifiable` (halt)
- node carries `$ref` -> `unclassifiable` (halt)
- `class` absent -> `forbidden` (halt)
- `class` not one of the three literals -> `unclassifiable` (halt)
- `class === 'content'` and the field appears on no rendered surface -> `forbidden`

It must NOT reuse `carriesUnwalkedSubschema` (`described.test.ts:50-53`): `.nullable()` fields emit
`anyOf`, metadata lands on the outer node, and `class` is present regardless. Verified: no record
schema emits `$defs` or `$ref`; `thread` and `decision` emit `anyOf`.

### Arrays and nested objects

The flattener already descends `properties` and `items` (`described.test.ts:25-44`), so an array
field yields two nodes — `risk.refs` and `risk.refs[]` — and each declares its own class.

**The rule: every node the flattener emits declares a class, and an array and its element type
declare the SAME class.** A field whose class differs per element position is forbidden outright —
JSON Schema `items` is a single node here, there is no positional form in use, and a heterogeneous
array would make `A5` undecidable. Such a field is split into named object fields instead, exactly as
`B3`'s `Artifact = { id: structural, label: content, pointer: pointer }` already is.

### Proof

Run in the session scratchpad, `node --experimental-strip-types probe.ts`:

    risk.id -> structural
    risk.text -> content
    risk.refs -> pointer
    risk.refs[] -> pointer
    risk.criterion_id -> structural
    risk.struck_by -> structural
    census PASSED over 6 nodes
    census halted as required: census rejected a forbidden item:
      {"path":"undeclared.oops","value":{"type":"string","maxLength":100,...}}
    "docs/spec.md\nsecond line" => {"ok":false,"field":"refs.0",...,"retryable":true}
    "see ```ts\nx```"           => {"ok":false,"field":"refs.0",...}
    "@@ -1,2 +1,2 @@"           => {"ok":false,"field":"refs.0",...}
    accepted: "docs/specs/2026-08-28-continuity-goal-model.md#L120"

`escapeStored` (`src/render/escape.ts:39-82`) turns a line break into the literal text `U+000A`,
which `POINTER_PATTERN` also refuses, while `docs/specs/x.md#L120` and `a/b-c_1.ts:44` pass both raw
and escaped. `node --test test/contract/described.test.ts` -> 2 pass, 0 fail against the change.

### Rejected

- **`.describe()` string tags** — one string cannot carry both prose and a class without a parser, and
  it breaks the existing description census at `described.test.ts:61`.
- **A private `z.registry()`** — same read path as `.meta()`, but the class stops at the zod object and
  never reaches `Declared.jsonSchema`, forcing `O4` to walk `._zod.def` internals instead of the
  public shape the repository already walks.
- **A sibling exported class map per module keyed by field path** — a second source of truth that
  drifts from the schema silently, and it makes `A5` a separate tree-walking validator instead of a
  `regex` on the field.
- **Branded wrapper types enforcing the class at typecheck** — needs a bespoke `z.object` replacement
  to constrain the shape type; `DG1` rejects the layer when the census already halts loudly.

### What this obliges each planner to do

**U1 owns the mechanism.** Its plan must contain, and these are acceptance criteria, not suggestions:

1. `src/schema/field-class.ts` exporting `POINTER_PATTERN`, `structural`, `content` and `pointer`
   exactly as above, with no comments.
2. A class applied to EVERY field of `thread.ts`, `decision.ts`, `session.ts` and `binding.ts`,
   including the new `B1`/`B2`/`B3` fields, and including both an array node and its element node.
3. `Artifact.pointer`, `Risk.refs[]` and `Decision.commit` (`B13`) built with `pointer(...)`;
   `Decision.commit` additionally carries its sha pattern.
4. `validated.field` forwarded through `invalidThreadRecordRefusal`
   (`src/server/tool-support.ts:102-109`).
5. An `A5` test asserting `field === 'spine.open_risks.0.refs.0'` for a line break, a code fence and
   a `@@ ` diff hunk marker.
6. A written statement of whether `Binding` records are written as `kind: 'raw'`. `validateChange`
   (`src/store/records.ts:33-45`) has no `binding` branch, so a binding's pointer fields are not
   parsed on that path. U1 states the finding; if a branch is needed for `A5` to hold over bindings,
   U1 adds it and enumerates `src/store/records.ts` under `OR11`'s `Also edits` line. U1 does not
   leave this open.

**U6 may assume, without re-deriving:** every node emitted by the shared flattener carries a string
`class` of exactly `structural`, `pointer` or `content`; `$defs` and `$ref` do not occur; `anyOf`
nodes still carry `class` at the top level. U6 owns the lift to `test/support/schema-nodes.ts`, the
classifier, and the content-to-surface mapping — nothing else from this ruling.

## OR16 — A split is decided in the plan, never left to the implementer

Target ~200 changed lines per reviewable pull request; treat 400 as the ceiling. Defect-finding per
line declines continuously with review size.

**Measure the diff you actually authored — never estimate it.** Two leads on the predecessor ladder
stated a line count as fact and had to correct it (424 to 382, and 341 to 610). State a count only
after measuring the applied diff, which you may do by applying your own steps to a throwaway copy of
the tree in the session scratchpad. Never in the working tree.

Then rule, in the plan, one of:

- **No split.** State the measured line count and the production/test split.
- **Split.** Produce TWO complete plan documents, `U<n>-<slug>-a.md` and `U<n>-<slug>-b.md`, each with
  the full mandatory structure, each with its own branch (`...-a`, `...-b`), its own acceptance
  subset, its own version step, and B carrying a stop condition that A must be merged first. PR A
  always lands first. Name the split in your return summary so the orchestrator can adjust `OR1`.

**One exception, and it must be shown rather than asserted:** where splitting would destroy a
red-on-parent receipt — the red exists only while some other part of the unit is unshipped — the
receipt wins and the ceiling yields. The plan then states the measured number, the production/test
split, and the specific acceptance criterion a split would make unsatisfiable. The pull request body
says the diff is large and names the reason it is not divisible; a reviewer must learn the size from
the pull request, never from the Files Changed tab.

## OR17 — DIVERGENCE: wave 1 is partially ordered — U2 follows U1

SPEC section 9 places `U1` and `U2` in the same wave and calls the wave "fully parallel". They are
not disjoint under `OR15`: `OR15` obligation 6 may require `U1` to add a `binding` branch to
`validateChange` in `src/store/records.ts`, and SPEC section 9 assigns `src/store/records.ts` to
`U2`.

Ruled: **`U2` is cut from a `main` that already contains `U1`.** This costs nothing — `OR1` already
merges `U1` before `U2` — and it removes the entire class of conflict rather than making the
conflict conditional on a census outcome nobody has run yet. `U3` remains fully parallel with both.

`U2`'s section 11 carries a stop condition proving `U1` landed before any edit to
`src/store/records.ts` begins.

Rejected: giving `U1` a carve-out region inside `src/store/records.ts` while `U2` edits the rest. Two
planners authoring FIND/REPLACE against one file cannot both be applied without a merge judgement,
which `PLANNING-BRIEF.md` section 2 forbids passing to the implementer.

Rejected: deferring the `binding` branch to `U2`. `A5` is `U1`'s invariant; a unit that ships an
invariant it cannot hold over one record type has not shipped it.

## OR18 — Gate zero: what it requires, and what it explicitly does not

SPEC section 10 requires, before `U1` is cut: "trunk gets CI on push, and the red `test (24.x)` job
is either fixed or explicitly downgraded on the honesty ladder with its reason recorded."

The evidence below was measured during planning, not inferred. It is worse than the thread's
next-step line recorded, and the ruling is written against the measurements rather than against the
summary.

### Measured facts

- **`main` has never been tested at all.** Every run of workflow `ci` in the queried window carries
  `"event":"pull_request"`; no run exists whose head is `e5f0195`. The red under discussion is on
  `b01bf87`, the branch head that was merged.
- **`concurrent.distinct-ids` is a genuine defect, not a flake in the test.** Reproduced by probe:
  46 of 60 iterations at 24 concurrent children ended with a record present in
  `git ls-tree refs/logbook/ledger` and absent from `records/` on disk, with
  `state/last-materialised` equal to the ledger ref in every one of the 46 — the unrecoverable
  state. All children reported success, so the lost record's own writer completed and returned
  `ok`, and the lost record was not the one the tip commit introduced.
- **The mechanism spans three sites.** `writeTargetsToDisk` writes only its own call's record files
  (`src/store/write-path.ts:149-160`, called at `:192`); `markMaterialised(storeLayout, result.after)`
  then stamps the store as materialised at the WHOLE new ref (`src/store/records.ts:171`), a claim
  wider than the write; and `syncWorkingCopy` short-circuits forever once stamp equals ref
  (`src/store/read-path.ts:204`), so the hole is permanent. `swapRecordsTreeIntoPlace`
  (`src/store/read-path.ts:110-151`) is what erases a record another process just wrote.
- **It is NOT covered by either accepted race as worded.** SPEC section 10 accepts
  `01M13F4HW3YQWJSF7T4GM47GP8` (post-CAS `mkdirSync` producing `ENOTEMPTY`) and
  `01M13F4HW3552M57R3SZ4B5V5P` (`write-path.ts:228` adopting the winner's ref ON RETRY). The
  reproduction shows the sealing stamp on the ORDINARY SUCCESS path, requiring no retry by any
  process. Treating the current red as already accepted would accept something wider than either
  decision's text describes.
- **CI rate: 3 failures in 60 pooled `test` job runs across the last 20 workflow runs — 5.0%.** All
  three are this same test. `test (24.x)` 2/20, `test (22.19.x)` 1/20, `test (26.x)` 0/20. No other
  test has failed in that window. Two of the three are an older assertion (a child exiting non-zero
  on `thread_id`); the read-back assertion is first observed on `b01bf87`. Whether the store fix
  shifted the mode distribution is UNKNOWN on one post-fix observation, and is recorded as unknown.
- **Locally the test passes 25 of 25** in isolation on Node `v26.4.0` with 14 cores, against the
  test's hardcoded `CHILD_COUNT = 8` (`test/spawn/decisions.test.ts:819`). That null result does not
  bound the CI rate and is not evidence the defect is absent.
- **The full local suite is GREEN: 436 tests, 0 fail, exit 0.** The `yaml` devDependency gap that
  affected the predecessor ladder is closed in this checkout. No planner needs to work around it,
  and no plan may weaken a pass condition for it.
- **`main` has no branch protection and no rulesets.** `gh api repos/:owner/:repo/branches/main/protection`
  returns `404 Branch not protected`; `.../rulesets` and `.../rules/branches/main` both return `[]`.
  These are positive answers, not access failures. Nothing is a required status check.

### Ruled

**1. Trunk CI on push lands in `U0`, on `rebuild.yml` only.** `receipts.yml` stays `pull_request`-only:
its enforcer step self-skips on a non-pull_request event by construction, and its other two units —
the D6 check (`scripts/d6-check.cjs:251-253` requires `--base` and `--head`) and `pr-title-lint`
(reads `github.event.pull_request.title`) — hard-fail without pull-request context. A push trigger
there buys nothing and costs a permanent red.

**2. The `mutation` job is excluded from the push trigger.** It reads
`github.event.pull_request.base.sha` and `.head.sha` (`.github/workflows/rebuild.yml:86-87`) and
hard-fails when both are empty. It also took 151.9 minutes on the run in question, against under
3 minutes for every other job. It is diff-scoped, which is a pull-request concept; on a merge into
`main` it would re-run what already ran, or need new logic, which is not a trigger change.

**3. The `mutation` red is NOT a gate-zero blocker, and this is a recorded downgrade, not a pass.**
A sub-threshold score is not unique to the store fix — an unrelated run scored `42.35` two days
earlier. Of 196 surviving mutants, **87 sit on lines the fix added and 109 on lines that predate
it**, so attributing the whole red to the fix would overstate it; killing only the 87 would put the
score at `(270+1+87)/467 = 76.66%`, which is arithmetic on measured counts and not a measured run.
No pre-fix mutation baseline exists for `read-path.ts` or `write-path.ts` in the queried window.
Status on the honesty ladder: **`unverified-reasoned`** — the mutation surface of the store modules
has never been measured before this change, so the score cannot be attributed, and measuring it
means a ~152-minute run on the parent commit that was not performed.

**4. `U0` does NOT fix the store defect, and does not hide it either.** It is a NEW finding above the
SPEC's ceiling: the SPEC accepted two specific races as worded, and this is a third, wider one on the
ordinary success path. Acceptance is a ceiling, so it is filed as a new item and carried as a NEW
thread criterion with its own decision record — never folded into `U0`, never folded into `U2`.
`U0` neither fixes it, nor skips it, nor deletes it, nor quarantines it. Deleting, skipping or
focusing the test is the canonical reward-hack the receipts standard blocks at `G11` and is
forbidden outright.

Status on the honesty ladder for "trunk is verified green": **`unverified-reasoned`**, because a
5% per-run false red is live on a defect that is understood, reproduced and tracked but not fixed
in this ladder.

**5. CI on push is observational until `main` has required status checks.** Adding branch protection
is a repository-administration act, not a plan step, and no unit performs it. It is filed as a new
item. `U0`'s plan states plainly, in its own body, that the check it adds blocks nothing — a plan
that implies otherwise is a defect in the plan.

### `U0`'s complete scope, and nothing else

1. `.github/workflows/rebuild.yml` gains `push: branches: [main]` alongside the existing
   `pull_request:`.
2. The `mutation` job gains `if: github.event_name == 'pull_request'`.
3. Nothing else. Not the store defect, not `receipts.config.json`, not branch protection, not the
   mutation score.

## OR19 — The one known red, and how a plan may respond to it without hiding it

`concurrent.distinct-ids` (`test/spawn/decisions.test.ts:797`) fails at a measured 5% per `test` job
run for a tracked, reproduced, unfixed defect (`OR18`). Every unit in this ladder declares a green
suite. Without a rule, each planner invents its own response, and the likely invention is to weaken
the pass condition — which is the exact defect this SPEC exists to remove, applied to its own
delivery.

Ruled. Every plan's section 11 carries this stop condition **verbatim**, except `U2`:

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

**`U2` is carved out and gets the opposite instruction.** `U2` owns `src/store/read-path.ts` and
`src/store/records.ts` — the modules the defect lives in, and `B38` changes materialisation itself.
For `U2` a `concurrent.distinct-ids` failure is signal, not noise. `U2`'s section 11 carries instead:

    Run: npm test
    Any failure of `concurrent.distinct-ids` in `test/spawn/decisions.test.ts` is IN SCOPE for
    this unit's surface and must be reported, never re-run away. STOP and report; do not
    improvise, and do not edit, skip, focus or delete any test.

No plan may write a re-run into an acceptance criterion, into a receipt, or into `## 6. Red on the
parent`. A receipt is decided by one run. The re-run above governs only the full-suite gate in
`## 8. Full verification`, and it is disclosed in the pull request body every time it is used.

## OR20 — This ladder depends on no external decomposition procedure

A plan author blocked on `~/.claude/skills/mitosis/SKILL.md`, which does not exist on disk. It is
staged for deletion in the operator's configuration repository (branch `chore/remove-mitosis`), and
`~/.claude/skills` is a symlink into that working tree, so the removal is live the moment the
checkout moves. The file still exists at that repository's `HEAD`; only the working tree has it
removed.

Ruled: **this ladder does not depend on it, and no planner blocks on it.** `PLANNING-BRIEF.md` and
this file are jointly self-contained by construction — the twelve mandatory headings, the plan
invariants `P1`-`P11`, the wave order, the branch names, the version rule, the receipt obligation
and the stop conditions are all stated here in full. A planner that cannot read that skill proceeds
under these two documents alone and records the absence as one line in
`## 3. Divergences from the SPEC`.

The planner that blocked was RIGHT to stop rather than work from a remembered version of a procedure
it could not see, and right to refuse to restore a file in the operator's global configuration. That
restoration is the operator's act, not a planner's, and it is not required here.

Two knock-on facts, recorded so they are not rediscovered: the same deletion removes
`mitosis/templates/receipts.yml`, which the receipts standard names as the CI template for target
repositories — this repository already has its own `.github/workflows/receipts.yml`, so nothing in
this ladder needs the template. And any agent whose definition instructs it to read that skill first
will block identically; the instruction above is the standing answer.

## OR21 — The documentation lands on `main` before `U0` is cut

Surfaced by U3 planning and verified at the orchestrator: **the spec does not exist on `main`.**

    $ git ls-tree --name-only main docs/specs/
    docs/specs/2026-08-02-preflight-briefing-redesign.md
    docs/specs/2026-08-04-mcp-server-hardening.md
    docs/specs/2026-08-25-post-cutover-repair.md
    docs/specs/2026-08-26-briefing-scoping-repair.md

`docs/specs/2026-08-28-continuity-goal-model.md` is absent, and so is
`docs/plans/2026-08-28-continuity-goal-model/`. Both live only on the branch
`docs/continuity-goal-model-spec`.

That breaks two things. `U3`'s census reads the spec file at test time to derive the `LG` population,
so on a branch cut from `main` it halts on `ENOENT` — correctly, but the unit could never go green.
And every implementer is handed a plan file that is not in the repository it is working in.

Ruled: **the spec and every planning document under
`docs/plans/2026-08-28-continuity-goal-model/` merge to `main` as ONE documentation pull request
before `U0` is cut.** It is a ladder prerequisite, not a unit: it carries no `B#`, no acceptance
criteria beyond the files being present, and **no version bump** — documentation describing work that
has not shipped does not change the plugin, and `P4` governs changes to the plugin.

Ordering, complete: documentation pull request, then `U0`, then `U1`, then the rest of `OR1`.

Two consequences that are already absorbed by existing rulings, stated so nobody chases them:

- `OR4` fixes `main` at `e5f0195` "at planning time" and defines red-on-parent as "the tip of `main`
  at branch-cut time". After this documentation merge that tip is a new commit. Nothing needs
  re-authoring: every unit's parent is defined relationally, and `OR6` already makes every version
  step a read-then-increment.
- The planning branch tip advances as planning documents are committed — it was `4203de9` when
  `PLANNING-BRIEF.md` section 7 was written and has moved since. **The load-bearing half of that fact
  is unchanged and re-verified:** `git diff --name-only main...HEAD` returns paths under `docs/`
  only, so `src/`, `test/`, `hooks/`, `bin/`, `skills/` and `scripts/` remain byte-identical between
  `main` and this branch, and every SPEC line citation still applies. A planner whose plan states the
  older tip has stated a cosmetic fact, not a defect, and its plan is not re-authored for it.

## OR22 — `LG5` is published with its measured exception, not as an unqualified promise

Surfaced by U10 planning as `F10a`, and it collides with `U3`, which publishes `LG1`-`LG17` to users
in the README three waves earlier.

`LG5` promises: "What you write is what is stored, or the write is refused. Any transform applied on
the way in is declared and reversible."

`escapeStored` is idempotent by shipped test (`test/unit/escape.test.ts:81`), and an idempotent map
that is not the identity cannot be injective — `f(f(x)) = f(x)` with injectivity forces `f(x) = x`.
Measured: `escapeStored('\n')` and `escapeStored('U+000A')` both return `'U+000A'`, so two distinct
inputs share one stored form, and this holds for all 263 code points the encoder can emit a token
for. A value whose raw text already contains `U+` followed by the canonical hex of one of those code
points does not survive escape-then-unescape.

`OR15`'s `POINTER_PATTERN` refuses the literal text `U+000A` and `U+000D`, which closes 2 of the 263
cases, and only on `pointer`-class fields.

Ruled: **`U3` publishes `LG5` together with its exception, in the same breath, in user language.**
Publishing an unqualified promise that is measurably false is a defect in the deliverable, not an
addition above `U3`'s ceiling — `B36` requires the README to carry the promises, and a false promise
does not carry one. `U3`'s plan is amended rather than re-authored.

Rejected: publishing `LG5` unqualified and correcting it after `U10`. That ships a false public
promise for the whole length of the ladder, and `LG3` — "never fabricates" — is the one property this
system may least afford to break in its own README.

Rejected: holding `U3` until the encoding is made injective. That is `F10b`-scale work across ten
modules this ladder does not own, it is not `B43`, and it would block a wave-1 unit behind
undesigned work.

Rejected: weakening `LG5`'s wording in the SPEC. The SPEC is approved and frozen (`OR0`); the goal is
right and the implementation is short of it. Recording the shortfall is the honest form, and it is
what the tracked criterion exists for.

**The full discharge of `LG5` — moving escaping off the write path so the stored bytes equal the
supplied bytes — is `F10b`, is new material this SPEC does not cover, and becomes a NEW thread
criterion.** It is never folded into `U10`, `U4`, `U8` or `U9`.

## OR23 — `U1` splits into three, and the ladder gains three rows

`U1` measured at **1,040 changed lines** (324 production, 716 test), applied to a throwaway tree and
diffed. That is 2.6 times the ceiling, so `OR16` requires a split, and the plan ruled one without
acting on it — correctly, since branch names and version steps are `OR1`'s to give. Those rows are
below.

| Order | Unit | Carries | Branch | Type | Version from -> to |
| --- | --- | --- | --- | --- | --- |
| — | Documentation (`OR21`) | spec + all planning docs | `docs/continuity-goal-model-spec` | docs | none |
| 1 | U0 Trunk verification gate | — | `ci/u0-trunk-verification-gate` | ci | 1.4.1 -> 1.4.2 |
| 2 | **U1-A Refusal completeness** | `A1` | `fix/u1a-refusal-completeness` | fix | 1.4.2 -> 1.4.3 |
| 3 | **U1-B Field classes and the git boundary** | `B5`, `B13`, `B42`, `A5`, `S2` | `feat/u1b-field-classes` | feat | 1.4.3 -> 1.5.0 |
| 4 | **U1-C Goal-model fields and the cap census** | `B2`, `B3`, `B4`, `B6`, `B7`, `A7` | `feat/u1c-goal-model-fields` | feat | 1.5.0 -> 1.6.0 |
| 5 | U2 Store cost and safety | `B37`, `B38`, `B40` | `perf/u2-store-cost-and-safety` | perf | 1.6.0 -> 1.6.1 |
| 6 | U3 Promises | `B36` | `docs/u3-promises` | docs | 1.6.1 -> 1.6.2 |
| 7 | U4 Criterion contract | `B8`, `B9`, `B10`, `B41` | `feat/u4-criterion-contract` | feat | 1.6.2 -> 2.0.0 |
| 8 | U5 The briefing hides nothing | `B16`-`B22`, `B24` | `feat/u5-briefing-hides-nothing` | feat | 2.0.0 -> 2.1.0 |
| 9 | U6 Discovery | `B25`-`B28` | `feat/u6-discovery` | feat | 2.1.0 -> 2.2.0 |
| 10 | U7 Capture | `B29`-`B34` | `feat/u7-capture` | feat | 2.2.0 -> 2.3.0 |
| 11 | U8 Derived last_session | `B14`, `B23` | `feat/u8-derived-last-session` | feat | 2.3.0 -> 2.4.0 |
| 12 | U9 Declared focus | `B11`, `B12`, `B15`, `B35`, `B39` | `feat/u9-declared-focus` | feat | 2.4.0 -> 2.5.0 |
| 13 | U10 Write fidelity | `B43` | `fix/u10-write-fidelity` | fix | 2.5.0 -> 2.5.1 |

`U4` still takes the MAJOR bump for `B9`'s breaking input change, per `OR1`. `OR6`'s read-then-increment
governs every step, so a further split anywhere shifts the table without invalidating any plan.

**`U1-B`'s roughly 480 lines exceed the ceiling, and the exception is granted under `OR16`'s
shown-not-asserted clause.** The showing, from the plan: cutting it further separates the class
declarations from the census that proves them, and the census IS the receipt for `B5`. Declarations
without the census ship a convention no check protects and have nothing red at their parent, because
declarations are inert until something reads them. The census without the declarations is a permanent
red. Neither half has a receipt, so the ceiling yields and the receipt wins. `U1-B`'s pull request
body states the size and names that reason.

### How the three are executed from one plan document

`OR16` normally requires one complete document per pull request. It is waived here, once, for a
specific reason: `U1`'s three parts share one ground-truth section covering nine schema modules, and
triplicating three thousand lines to avoid one appendix trades a real risk of the three copies
drifting for a formatting convention. All three are executed by one implementer in sequence on one
unit's surface, not by three implementers who each see only their own file.

Instead, `U1`'s plan gains a **per-pull-request execution appendix** — one block per pull request,
each carrying its branch, its version step, its ordered step list, its own red-on-parent with the
exact expected failure text, its own inertness mutation, its own full verification, its own
`pr-create` invocation, and its own stop conditions. Nothing in that appendix may say "see section
N for the other one": each block is executable start to finish. The shared sections 2, 3, 4 and 5
remain the single source for ground truth, edits and tests, and each appendix block names the exact
step and test numbers it consumes.

## OR24 — amendment to `OR15`: `Decision.commit` uses one combined pattern, not a chained one

`U1` planning found that building `Decision.commit` as `pointer(...)` and then chaining `.regex()`
for the sha makes zod emit `allOf` in the generated JSON Schema. That breaks two things `OR15`
promised: the refusal's valid example, and the assurance given to `U6` that the flattener's nodes
carry `class` at the top level with no `allOf` to descend.

Ruled: **`Decision.commit` declares a single combined pattern that carries both the pointer
constraint and the sha constraint, and is given `class: 'pointer'` directly.** No chaining, no
`allOf`.

`OR15`'s assurance to `U6` is unchanged and remains accurate: every node the shared flattener emits
carries a string `class` of exactly `structural`, `pointer` or `content`; `$defs` and `$ref` do not
occur; `anyOf` nodes still carry `class` at the top level. `U6` may rely on it as written.

## OR25 — amendment to `OR23`: the spawn allowlist splits out as `U1-D`

`U1`'s per-pull-request appendix remeasured the three parts by applying their own blocks to a
throwaway tree: **`U1-A` 243 lines (60 production / 183 test), `U1-B` 590 (228/362), `U1-C` 244
(66/178).** The sum, 1,077, exceeds the unit's 1,040 because `src/schema/thread.ts` is edited by both
`B` and `C`.

`U1-B` at 590 is not the ~480 `OR23` granted an exception for, and the plan reported that pulling
`test/contract/spawn-allowlist.test.ts` out brings it to **476**.

Ruled: **it is pulled out, as a fourth pull request `U1-D`.**

`OR16` licenses an overage only "where a split is shown to break a red-on-parent receipt, and the
showing is written down". That showing exists for the field-class census — declarations without it
have nothing red at their parent, the census without them is a permanent red — and it is granted.
**No such showing exists for `B42`/`S2`.** The plan itself demonstrated the opposite by naming the
number a split would produce. A licence granted for one showing does not extend to material the
showing never covered, and stretching it that way is how a bounded exception becomes a general one.

The cohesion argument points the same way: `B42`/`S2` governs which modules may spawn a process and
forbids record types reaching them. That is a different reason-to-change from field classes and the
git boundary, and bundling them makes a reviewer context-switch between two unrelated invariants
inside one diff.

`U1-B` remains over the ceiling at 476 and keeps its `OR16` exception on the original showing. Its
composition is 228 production lines against 362 test — disclosed in its pull request body, not
averaged away, since the per-line review burden of the two is not comparable.

### Revised rows, replacing the `U1` block of `OR23`

| Order | Part | Carries | Branch | Type | Version from -> to |
| --- | --- | --- | --- | --- | --- |
| 2 | U1-A Refusal completeness | `A1` | `fix/u1a-refusal-completeness` | fix | 1.4.2 -> 1.4.3 |
| 3 | U1-B Field classes and the git boundary | `B5`, `B13`, `A5` | `feat/u1b-field-classes` | feat | 1.4.3 -> 1.5.0 |
| 4 | U1-C Goal-model fields and the cap census | `B2`, `B3`, `B4`, `B6`, `B7`, `A7` | `feat/u1c-goal-model-fields` | feat | 1.5.0 -> 1.6.0 |
| 5 | **U1-D Spawn allowlist** | `B42`, `S2` | `test/u1d-spawn-allowlist` | test | 1.6.0 -> 1.6.1 |

`test` increments PATCH under `OR6`. Every later row in `OR23` shifts by one patch; `OR6`'s
read-then-increment absorbs the shift, so no plan is re-authored for it. `U4` still takes the MAJOR
bump.

**`U1-D` lands last within `U1` and its receipt is honest about what it is.** A census over code that
already complies is GREEN at its parent, so it has no red-on-parent in the ordinary sense. Its plan
block states that plainly and gives the substitute `PLANNING-BRIEF.md` section 6 already provides:
the census cannot run at the parent because the allowlist it reads does not exist there. Its
inertness mutation is the real proof — add a spawning module without classifying it, and the census
must halt.

**Consequence for `U7`:** `B42`/`S2` is asserted from `U1-D`, not `U1-B`. `U7`'s stop condition for
the allowlist names `U1-D`.

## OR26 — two corrections to `OR25`, both raised against it by the plan

`U1`'s plan disputed two statements in `OR25` and was right on both. Recorded here rather than by
editing `OR25`, so the disagreement stays legible.

**1. `U1-B`'s composition.** `OR25` gives it as "228 production lines against 362 test". Those sum to
590, which is the PRE-split figure — `OR25` carried the old composition under the new total. The
measured post-split figures are **`U1-B` 476 = 228 production / 248 test**. The full set, each
measured by applying the plan's own blocks to a throwaway tree:

| Part | Lines | Production | Test |
|---|---|---|---|
| U1-A | 243 | 60 | 183 |
| U1-B | 476 | 228 | 248 |
| U1-C | 244 | 66 | 178 |
| U1-D | 114 | 0 | 114 |

The sum, 1,077, exceeds the unit's measured 1,040 because `src/schema/thread.ts` is edited by both
`B` and `C`. `U1-B` keeps its `OR16` exception, and its pull request body discloses 228 production
against 248 test.

**2. `U1-D`'s substitute receipt, as `OR25` worded it, is false.** `OR25` said the census "cannot run
at the parent because the allowlist it reads does not exist there". It can. The allowlist is declared
inside the test file itself, so at the parent the census runs, compiles and **passes** — the code
already complies. The plan refuses that substitute in its own block `12.D` and says why, and the
conformance auditor confirmed it independently.

The honest statement, which the plan carries instead: `U1-D` has **no red at its parent**, because a
census over already-compliant code is green there and manufacturing a red would mean breaking the
code to prove the check. Its receipt is the **inertness mutation** — add a spawning module without
classifying it and the census must halt:

    AssertionError [ERR_ASSERTION]: Got unwanted exception.
    Actual message: "census halted on an unclassifiable item:
    {"relPath":"src/probe/helper.py","extension":".py","text":"import os\n"}"

That is `OR13` working as intended: a unit that cannot produce a red-on-parent says so and names what
proves it instead, rather than substituting a proxy and calling it a receipt. `U1-D` ships under an
`unverified-reasoned` status for the red-on-parent obligation specifically, with that reason.

## OR27 — the one-document waiver is generalised, and `U5` splits into three

`OR23` waived `OR16`'s one-document-per-pull-request rule "once", for `U1`. `U5` now needs the same
thing, and a waiver granted case by case is a waiver with no rule behind it.

Ruled, generally: **`OR16`'s one-document rule is satisfied by a per-pull-request execution appendix
whenever a unit's parts share one ground-truth section and are executed by one implementer in
sequence on one surface.** It is NOT satisfied that way when the parts would go to different
implementers, or when their ground truth genuinely differs.

The appendix carries, per part: branch, version step, the ordered step list by number, the tests by
file and exact name, its own red-on-parent with expected failure text, its own inertness mutation,
its own full verification, its own `pr-create` invocation, and its own stop conditions. **No block may
reference another block.** The shared sections stay the single source for ground truth, edits and
tests, and each block names the exact step and test numbers it consumes.

The reason this is safe: triplicating a ground-truth section is not free. Three copies of the same
edit-site inventory drift, and a drifted copy is worse than a cross-reference because nothing detects
it. One implementer reading one document has no cross-plan isolation to protect.

### `U5`'s rows

Measured by applying each part's own steps to throwaway trees; unsplit 1,195.

| Part | Carries | Branch | Lines (prod/test) |
| --- | --- | --- | --- |
| U5-A The caps go | `B16`, `B17`, `B18`, `B19`, `B20` | `feat/u5a-briefing-caps-go` | 683 (177/506) |
| U5-B The shared clip marker | `B24` (helper), `O3` | `feat/u5b-clip-marker` | 310 (95/215) |
| U5-C Item detail | `B21`, `B22`, `B24` (criteria render) | `feat/u5c-item-detail` | 202 (91/111) |

`U5-A` exceeds the ceiling at 683 and takes the `OR16` exception on a shown ground: every smaller cut
leaves the item-completeness receipt permanently red. Its composition is 177 production against 506
test, disclosed in its pull request body.

**`U5-B` ships `src/render/clip.ts`, exporting `CLIP_MARKER`, `CLIP_MARKER_GRAPHEMES` and
`clipWithMarker`. `U7` imports that exact path and writes no second implementation.**

## OR28 — DIVERGENCE: `S3`'s census is tree-wide, and the backfill module is classified, not scoped out

`U5` scoped its `S3` census to `src/render` (its divergence 3.5) and filed `F5b`: `src/domain/criterion-backfill.ts`
infers a criterion's attachment from its ordinal, has no caller and no owner, and therefore **`S3`
ships partly undischarged**.

`S3` reads: "`Criterion.ordinal` is read only to render a display label and to stable-sort for
display. Every other read is forbidden." Its subject is every read of that field, not every read
inside one directory. **Scoping the census to `src/render` is narrowing it, which `P8` forbids
outright** — a census is never narrowed to obtain a green, and a halting census is answered by
classifying the item, never by excluding it.

Ruled:

1. **`S3`'s census population is every read of `Criterion.ordinal` across the whole tree** — `src/`,
   `hooks/`, `bin/`, `scripts/` and `test/` — and it halts on any read it cannot classify as a
   display label or a display stable-sort.
2. **`src/domain/criterion-backfill.ts` is classified, not excluded.** `U5` establishes by census
   whether anything reaches it, including `scripts/backfill-criterion-id.mjs`, which is a plausible
   caller its `src/`-only sweep would not have seen.
3. **If it has no caller, `U5` deletes it**, and the deletion is INSIDE `U5`'s ceiling rather than
   above it. SPEC section 11.4 assigns `S3` to `U5`; a unit that ships an invariant it knows to be
   violated has not shipped that invariant, and `OR13` does not offer a downgrade for a violation the
   unit can simply remove. `U5` enumerates the file under an `Also edits (to keep the tree green):`
   line per `OR11`. No other unit owns it.
4. **If it does have a caller**, deleting it is out of scope, the caller's read is classified on its
   merits, and whatever remains undischarged is filed and registered as new material with the
   specific reason — never left as a silently narrowed census.

`U5` decides which of 3 or 4 applies by running the census. `PLANNING-BRIEF.md` section 2 forbids
passing that to the implementer: the plan says which, and why.

## OR29 — `S3`'s outcome: population tree-wide, assertion scoped, residue named and owned

`OR28` sent `S3`'s census tree-wide and required `src/domain/criterion-backfill.ts` to be classified
rather than excluded. The result is **outcome 4**, and it vindicates the widening: the module DOES
have a caller — `scripts/backfill-criterion-id.mjs:5,22` imports and calls `backfillCriterionIds`.
`U5`'s original `F5b` claim of "no production caller" came from an `src/`-and-`test/`-only sweep that
could not see a `.mjs` file the program does not compile. Corrected as `F5d`. **The module is not
deleted.**

The census as authored: population is every read of `Criterion.ordinal` across `src/`, `hooks/`,
`bin/`, `scripts/` and `test/` — every file in the compiled program, plus a text sweep of the five
`.mjs`/`.cjs` files it does not compile. Ten reads, each classified by rule and all printed: a
template literal is a display label; a copy into a field named `ordinal` is a field copy; a read
inside a test is an observation; a comparison against another ordinal or a parsed number is
**forbidden**; anything else halts. Two controls prove both halt paths.

**Three forbidden reads, in two files, neither owned by `U5`:**

- `src/server/tools/record_decision.ts:57` — two reads, inside `deriveScope`, which **`B12` deletes in
  `U9`**.
- `src/domain/criterion-backfill.ts:11` — no owning unit, and it has a caller.

Ruled: **the population stays tree-wide and every forbidden read is PRINTED, but the blocking
assertion covers `src/render` only.** The three are reported under `unasserted here, owned elsewhere`,
so nothing is silent.

This is not the narrowing `OR28` refused. The distinction is exact and worth stating, because the two
look alike: `P8` forbids narrowing a census **population** to obtain a green, which is what hides a
violation. A tree-wide *blocking* assertion at `U5`'s commit would be a knowingly-false invariant and
a permanent red, which SPEC section 6.1 rule 3 forbids outright — "a permanent red eventually gets
'fixed' by damaging correct code". Reporting every member while asserting only what this unit can
make true satisfies both.

`U5`'s criterion for `S3` ships **`unverified-reasoned`** with both reasons named.

**Obligation this creates on `U9`, and it is not optional:** `B12` deletes `deriveScope` and with it
two of the three forbidden reads. `U9`'s plan therefore **widens the blocking assertion to include
`src/server/tools/`** and proves the two reads are gone. A unit that removes the reason for a scoped
assertion and leaves the scope in place has left a permanent excuse behind.

**Residue after the whole ladder: one read, `criterion-backfill.ts:11`.** It has an owner problem,
not a technical one — no unit owns the file and its caller is a maintenance script. Registered as
`N8`.

`U5-A` remeasured at **762 lines** (177 production / 585 test), up from 683, and keeps its `OR16`
exception on the unchanged shown ground. `U5-B` 310 and `U5-C` 202 are unmoved.

## OR30 — `U4` splits into two, both MAJOR, and takes `src/domain/criteria.ts`

`U4` measured at **771 changed lines** end-to-end, 1.9x the ceiling, and split at the seam between
creating a criterion and completing one.

| Part | Carries | Branch | Type | Lines (prod/test) |
| --- | --- | --- | --- | --- |
| U4-A Creating a criterion | `B8`, `B10`, `A4` | `feat/u4-criterion-contract-a` | feat (breaking) | 392 (112/280) |
| U4-B Completing a criterion | `B9`, `B41`, `A3`, the `A2` share | `feat/u4-criterion-contract-b` | feat (breaking) | 383 (142/241) |

Both are under the ceiling. Neither needs an exception.

**Both halves take a MAJOR bump.** `A` changes `open_thread.completion_criteria` from string to
object; `B` changes `update_thread.criteria_done` from id to object. Two breaking changes to a
published MCP contract are two major versions, and `OR1` already settled the principle: semantic
versioning answers to the published contract, not to the in-repo caller count. The ladder therefore
lands in `3.x`, and `OR6`'s read-then-increment absorbs the cascade without re-authoring any plan.

Rejected: one MAJOR across both, on the ground that they are one unit. A version is per merge, each
merge is a release, and the second release breaks callers the first did not. Bundling the signal into
the first would leave the second break unannounced — which is the whole failure mode the major bump
exists to prevent.

**`B8` is a breaking input change the SPEC does not name as one** (it names only `B9`). The SPEC is
not wrong about `B8`'s behaviour, only silent about its blast radius; recorded here rather than as a
defect in the SPEC.

**No `!` in any pull request title.** The centralized `pr-create` tool accepts the type set
`feat fix refactor docs test chore perf ci` and nothing else, so `feat!` is not available. The break
is disclosed in the body: `--risk` names it, and `--what` states the shape callers must send now.

**Ownership: `U4` takes `src/domain/criteria.ts`**, enumerated under an `Also edits (to keep the tree
green):` line per `OR11`. `amend_criteria` delegates criterion construction there, so `B10` is
unauthorable without it. No unit in the ladder owns that file — `U9` owns `src/domain/pointer.ts`,
which is a different module — and no wave-2 unit touches it.

**The refusal is a schema refusal, not a handler one, and that is correct.** `U4`'s divergence 3 is
right: a handler refusal for the bare id array is unreachable without publishing an input schema that
claims to accept a string it will always reject. A published schema that lies is worse than a
narrower one. The refusal still carries all four parts — the field `criteria_done.0`, what is
accepted, a valid example, and `retryable: true` — which is what `P2` actually requires.

## OR31 — `U7` splits into three, takes `src/server/instructions.ts`, and its clip contract is reconciled

`U7` measured at **798 changed lines** by applying its blocks to a throwaway tree. The best two-way
cut is 430/372, still over the ceiling, so it splits three ways. Each part verified green standalone.

| Part | Carries | Branch | Lines (prod/test) |
| --- | --- | --- | --- |
| U7-A The ledger-presence verdict | `B30` | `feat/u7a-ledger-presence` | 336 (119/217) |
| U7-B The banner marker | `B32`, `O3` share | `feat/u7b-banner-marker` | 98 (9/89) |
| U7-C Capture guidance and the second writer | `B31`, `B33`, `B34` | `feat/u7c-capture-guidance` | 372 (88/284) |

All three under the ceiling. No exception needed. `B29` is carried across the unit as verification
that both shipped instances still exist; it authors no change.

### The clip contract is reconciled, and it matches

`U7` reported it could not see `U5`'s plan and asked for reconciliation. Checked at the orchestrator,
which is the only place a cross-plan contract can be checked:

- `U5-B` creates `src/render/clip.ts` exporting `CLIP_MARKER = '...[shortened]'`,
  `CLIP_MARKER_GRAPHEMES` and `clipWithMarker(text, max)`.
- `U7` imports `clipWithMarker` and `CLIP_MARKER` from exactly that path, and calls it as
  `clipWithMarker(sections.join('\n\n'), BANNER_MAX_GRAPHEMES)`.

Path, names and arity agree. So does the semantics, which is the part that actually matters for `O3`:
`U5`'s implementation computes `budget = max - CLIP_MARKER_GRAPHEMES`, and `U7`'s rationale
independently states "the marker's room is reserved inside the limit, not added on top of it". Two
authors who could not read each other landed on the same rule because `O3` states it. **No change to
either plan.** `U7`'s stop condition on the module's existence stays — it is the right instrument.

### Ownership: `U7` takes `src/server/instructions.ts`

`B31` is guidance, and `U7` established that skill text cannot hold it: the shipped skills census
halts on any prose line and rejects `may`, `must` and `when`. It lands in the published MCP server
instructions instead, growing them 1,364 -> 1,654 bytes against a 2,048-byte ceiling. That file is
owned by no unit — `U6` owns `resources.ts`, `resource-render.ts` and `completions.ts`, not
`instructions.ts` — so `U7` takes it under `OR11`, enumerated in its section 0.

### Two rulings `U7` made that stand

**The post-tool-use exclusion is not authored.** `B30` says the verdict excludes commits authored by
the post-tool-use hook, but `B33` deletes that hook's write in the same unit. After `B33` it can
author no future commit, and historical ones sit at or before the per-session baseline sha and are
excluded by construction. Authoring the filter would ship an unreachable predicate, which `DG1`
forbids. Correct, and the SPEC's clause is satisfied by construction rather than by code.

**No module joins the spawn allowlist, and `S2` holds.** The new `src/hooklib/ledger-presence.ts`
calls `git()` from the already-allowlisted `src/store/git.ts` and contains no spawn token itself. No
record type reaches `src/store/git.ts` — the ref is read as a sha string and never parsed. `U7`'s
stop condition correctly names `U1-D` per `OR25`.

### The `U7` -> `U8` window is not a regression

`B34` stops `debrief` passing `last_session` before `U8` derives it. `U7` established that the
shipped skill never passed it in the first place — that is `D10` — and `park_thread` still accepts
it. So `next_step` is refreshed every debrief where previously nothing was, and `last_session` is
exactly as stale as it already was. The interval strictly improves. The SPEC's risk "a spine field is
dropped before its replacement exists" is real in principle and empty in fact here; `U8` still closes
it.

## OR32 — `U8` splits into two, `B14` is breaking, and `U8` takes four lines of `U9`'s file

`U8` measured **421 lines** unsplit, over the ceiling, and split with no exception claimed.

| Part | Carries | Branch | Scope | Type | Lines (prod/test) |
| --- | --- | --- | --- | --- | --- |
| U8-A The derivation | `B23` | `feat/u8-derived-last-session-a` | `briefing` | feat, MINOR | 356 (64/288) |
| U8-B The field stops being accepted | `B14` | `feat/u8-derived-last-session-b` | `park-thread` | feat, **MAJOR** | 69 (18/47) |

**`A` lands first.** `B` first would widen the stale window rather than close it, which is the exact
risk SPEC section 10 attaches to this unit.

**`B14` is a breaking change, established by probe rather than by argument.** `park_thread`'s input is
a `z.strictObject`, so removing the key turns a call that succeeds today into a refusal:
`{"ok":false,"field":"last_session","accepted":"object","example":"{}","retryable":true}`. That is a
published MCP contract change, and `OR1` and `OR30` already settled that the published contract
governs. `U8-B` takes MAJOR. The ladder's version table shifts again; `OR6`'s read-then-increment
absorbs it and no plan is re-authored.

**`U8-B`'s pull request title scope is `park-thread`, not `briefing`.** `OR1` assigned `briefing` to
the whole unit before the split existed; part B does not touch the briefing. The scope names the
surface a reviewer will actually see, and `park-thread` is 11 characters, inside the 16-character
class.

**`U8` takes four lines of `src/server/tools/resume_thread.ts`, which `U9` owns.** It is the
renderer's only production caller, so `B23` is unauthorable without it. `OR2` already orders wave 3
with `U8` first, so there is no simultaneous-writer problem — but `U9`'s FIND strings must be authored
against the file as `U8` leaves it. `U9`'s dispatch carries that.

### Two findings that stand

**The rule identifying "the previous session" is derived, not stored, and that is the interesting
part.** A session entry carries no session id (`src/schema/session.ts:9-15`), and the only record that
does — the pointer — is released by `park_thread`. So the rule is: sort a thread's entries ascending
by entry id, and take the run beginning immediately after the newest entry whose `actor` is
`logbook:park_thread`, **excluding that newest entry itself**, through the end, rendered reversed.
Excluding it is what makes the parked case and the crashed-without-parking case correct under ONE
rule rather than two. Verified by probe over five cases.

**The `U7` -> `U8` window loses nothing.** Before `U8-A`, the briefing rendered `spine.last_session`
verbatim — the last string anyone typed, describing some earlier session, with nothing saying which.
An empty field meant no section at all. `U8-A` closes that before `U8-B` removes the write.

### Legacy text is not clipped, and the reason is a receipt

`U8` found that clipping the legacy fallback made the shipped over-budget fixture fit, turning
`resume_thread.logs-a-budget-breach-only-for-a-render-that-does-not-fit` red. Leaving it unshortened
is correct: the legacy path renders stored text exactly as stored, and a shipped assertion about
budget-breach honesty is a better guide than a tidier render.
