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
