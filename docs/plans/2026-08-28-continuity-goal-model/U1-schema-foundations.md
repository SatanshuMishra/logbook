# U1 — Schema foundations

## 0. Identity

**Closes:** `D3` (partly — the attachment field already exists; see section 3), `D9` (partly),
`D19` (partly), `D20`, `D21`, `D22`, `D23`.

**Depends on:** `U0` (trunk verification gate) must be merged to `main` first. Nothing else.

**Required by:** `U2` is cut from a `main` that already contains this unit. `U4`, `U5`, `U6`, `U7`
are all cut from a `main` that already contains this unit.

**Wave:** 1.

**Branch name:** `feat/u1-schema-foundations`. This is the branch this plan authorises, and section
4 is one undivided change on it.

Section 10 measures the diff at 1,040 changed lines and **rules a split into three pull requests**.
That ruling needs the orchestrator to add three rows to `OR1` — three branch names, three version
steps — before it can be executed. Until that happens, the single branch above and the single
invocation in section 10 are what this plan authorises. The split is a recommendation with its
measured basis, not an instruction the implementer acts on alone.

**PR title scope:** `schema`.

**Version bump:** Baseline `1.4.2` -> `1.5.0` per orchestrator ruling OR1, applied as a
read-then-increment (section 4, step 1). This unit is a `feat`, so it increments MINOR and sets
PATCH to 0.

**Owns:** `src/schema/*` — `binding.ts`, `caps.ts`, `decision.ts`, `declare.ts`, `example.ts`,
`ids.ts`, `refusal.ts`, `session.ts`, `thread.ts`.

**Creates (new modules, wholly owned by this unit):**

- `src/schema/field-class.ts`
- `test/unit/field-class.test.ts`
- `test/unit/git-boundary.test.ts`
- `test/unit/caps-census.test.ts`
- `test/unit/goal-model-fields.test.ts`
- `test/contract/spawn-allowlist.test.ts`

**Also edits (to keep the tree green):**

- `src/merge/field-merge.ts` — `THREAD_RULES` is typed `Record<keyof Thread | 'spine.…', FieldRule>`
  (`src/merge/field-merge.ts:16`). Adding the `artifacts` field to `Thread` makes that object
  literal incomplete, and the tree does not typecheck without the new key. One line.
- `src/domain/spine.ts` — this is where the `open_risks` element cap is enforced at write time
  (`src/domain/spine.ts:28`). The census in section 3 removes that cap from the record schema; a
  cap left standing here alone would keep the exact working-style penalty the census removes, and
  the suite would fail. Two hunks.
- `src/server/tool-support.ts` — `invalidThreadRecordRefusal` hardcodes `field: 'thread'` and
  discards the field the validator named (`src/server/tool-support.ts:102-109`). The refusal must
  name the field that failed for the pointer-class refusal to be actionable. Two hunks.
- `test/unit/caps.test.ts`, `test/unit/records.test.ts`, `test/unit/field-merge.test.ts`,
  `test/unit/declare.test.ts` — four existing tests enumerate a population that this change
  legitimately grows. Each is answered by classifying the new member, never by narrowing the census.

`package.json` and `.claude-plugin/plugin.json` are also edited, by step 1. They are not listed above
because they are not census fallout: every unit in this ladder edits them by construction, under the
version rule, and no unit owns them exclusively.

**Not edited:** `src/store/records.ts`. Section 3.5 records the finding that made this unnecessary.
No file owned by another unit is touched.

**SPEC anchors:** section 9 unit `U1`; section 8 rules `B1`, `B2`, `B3`, `B4`, `B5`, `B6`, `B7`,
`B13`, `B42`; section 6 invariants `A1`, `A5`, `A7`, `S2` and the `U1` share of `A2`; section 7
defects `D3`, `D9`, `D19`, `D20`, `D21`, `D22`, `D23`.

---

## 1. Acceptance criteria (the ceiling)

1. **Every field of every record schema declares one of three classes.** A census over the JSON
   Schema of the thread, decision, session and binding records classifies every emitted node as
   `structural`, `pointer` or `content`; a node with no class is forbidden, and a node with a class
   outside those three halts the census. An array node and its element node declare the same class.
   *Discharges `B5`.*
2. **A value carrying content where a pointer is declared is refused.** For a field whose declared
   class is `pointer`, a write whose value contains a line break, a code fence or a diff hunk marker
   is refused, and the refusal names the field. *Discharges `A5`.*
3. **`Decision.commit` accepts only an object id or null.** The field carries a length cap and a
   pattern; a short sha is refused, a value carrying diff content is refused, and a forty- or
   sixty-four-character lowercase hex id is accepted, as is null. *Discharges `B13`.*
4. **The refusal for every capped record field names the field, the limit, the observed value and a
   remedy.** A census enumerates every field in the four record schemas carrying a length or element
   bound, drives a value one over that bound through the record's own parser, and asserts all four
   parts of the refusal. *Discharges `A1`.*
5. **Every cap constant declares the role it plays.** A closed census over the exported names of
   `src/schema/caps.ts` classifies each as `record-field`, `call-payload`, `record-bytes` or
   `refusal-display`, and halts on a name it cannot place. *Discharges `B6`.*
6. **Only an allowlisted module spawns a process, and none of them imports a record type.** A census
   over every file under `src`, `hooks`, `bin` and `scripts` asserts that the set of modules
   containing a process-creation token equals the allowlist exactly, and that no allowlisted module
   names a record-type module. *Discharges `B42` and `S2`.*
7. **A criterion can carry a check, a result and a result status, and every one of them is
   optional.** A record written before this change parses unchanged; a record carrying all three
   round-trips; a result status outside the two recorded states is refused. *Discharges `B2` and
   part of `D19`.*
8. **A thread can carry the artifacts it produced.** Each artifact is an id, a label and a pointer;
   the pointer is class `pointer` and is subject to criterion 2. *Discharges `B3` and `D23`.*
9. **Parsing a stored record adds no bytes to it.** The serialised size of a record written before
   this change is identical before and after parsing. *Discharges the SPEC section 9 `Green` clause
   "Every record in the live store parses unchanged", at byte granularity: a record already sitting
   at the write-time size bound stops parsing the moment parsing grows it. Guards `A1` from
   reporting a limit the caller did not breach.*
10. **`open_risks` accumulates past forty entries.** The element cap that penalised parallel working
    styles is gone from the record schema and from the write path; the element caps on
    `key_decisions` and `out_of_scope` still refuse. *Discharges `B6` and `D21`.*
11. **The write-time size bound is `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`, sized against a
    measured largest live thread record of 39,079 bytes.** The arithmetic is in section 3.4.
    *Discharges `A1` — `THREAD_RECORD_SERIALISED_MAX_BYTES` is one of the capped fields in the
    closed census over `src/schema/caps.ts` — and the sizing obligation orchestrator ruling OR12
    places on this unit.*
12. **`Criterion.kind` is retained, and a merge divergence in it conflicts.** Two copies of one
    criterion differing only in `kind` produce exactly one conflict rather than silently picking
    one. *Discharges `B7` and closes `D22` by census outcome.*
13. **`Risk.refs` is retained and is class `pointer`.** *Discharges `B4` and part of `D9`.*
14. **A decision whose spine link will not fit the thread record's cap is still written, and the
    response says why the link was skipped.** *Discharges `A7`.*
15. **Every record in the live store parses unchanged, and the full suite is green.** *Discharges
    the SPEC section 9 `Green` clauses "Every record in the live store parses unchanged" and "Full
    suite green" for this unit.*

Criteria 9, 11 and 15 name a `Green` clause or an orchestrator ruling rather than a `B#`. That is
deliberate and is the second and third of the three sources this list is built from: the unit's
`Carries` cell, the clauses of its `Green` cell, and the invariants assigned to it. Every other
criterion names a behavioural rule or an invariant.

Anything discovered above this list is appended to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is NOT
folded into this plan.

---

## 2. Ground truth

### 2.1 `src/schema/thread.ts:9-16` — the criterion type

```ts
export type Criterion = {
  id: Ulid
  ordinal: number
  text: string
  done: boolean
  kind: 'planned' | 'detour'
  struck_by: Ulid | null
}
```

A criterion carries no statement of how it would be decided, and no place to record what was
observed when it was marked done. SPEC defect `D19`.

### 2.2 `src/schema/thread.ts:48-63` — the criterion schema

```ts
const CriterionSchema = z.object({
  id: ulidField('the criterion identity, a stable ULID that the merge keys on'),
  ordinal: z
    .number()
    .int()
    .min(1)
    .describe('the rendered position of this criterion, recomputed on render, never merged'),
  text: z.string().max(caps.CRITERION_TEXT_MAX).describe('the criterion text'),
  done: z.boolean().describe('whether this criterion has been satisfied'),
  kind: z.enum(['planned', 'detour']).describe('whether this criterion was planned up front or added mid-thread'),
  struck_by: z
    .string()
    .regex(ULID_PATTERN)
    .nullable()
    .describe('the decision id that struck this criterion, or null when it has not been struck')
})
```

No field declares what kind of thing it is, so nothing can enforce the boundary between an address
and a body of text. SPEC defect `D20`.

### 2.3 `src/schema/thread.ts:65-74` — the risk schema

```ts
const RiskSchema = z.object({
  id: ulidField('the risk identity, a ULID'),
  scope: z.string().max(caps.RISK_SCOPE_MAX).describe('the criterion or area of the thread this risk concerns'),
  text: z.string().max(caps.RISK_TEXT_MAX).describe('the risk text'),
  refs: z
    .array(z.string().max(caps.RISK_REF_MAX))
    .max(caps.RISK_REFS_MAX_ELEMENTS)
    .describe('external pointers backing this risk'),
  criterion_id: optionalUlidField('the criterion this risk ranks against, absent when the risk is unanchored')
})
```

`refs` is declared as external pointers but is bounded only by length. Nothing stops a caller storing
a diff hunk in it. SPEC defect `D20`, and the slot named by `D9`.

### 2.4 `src/schema/thread.ts:93` — the open-risks element cap

```ts
  open_risks: z.array(RiskSchema).max(caps.OPEN_RISKS_MAX_ELEMENTS).describe('risks still open on this thread'),
```

The cap counts items. Parallel work produces more distinct-but-overlapping findings for the same
decided content, so the same work costs more entries. SPEC defect `D21`.

### 2.5 `src/schema/thread.ts:104-131` — the thread shape

The object has no field for the artifacts the thread produced, so a spec or plan path can only reach
a future session by being typed into prose. SPEC defect `D23`.

### 2.6 `src/schema/decision.ts:33-36` — the commit field

```ts
  commit: z
    .string()
    .nullable()
    .describe('the project HEAD sha at the time of recording, or null when it could not be read'),
```

No cap and no pattern. A caller can store anything here, including a diff. SPEC defect `D20`.

### 2.7 `src/schema/refusal.ts:80-81` — the refusal message

```ts
const renderMessage = (field: string, accepted: string, example: string, retryable: boolean): string =>
  `${field} was refused; it accepts ${accepted}; a valid example is ${example}; retryable=${retryable}.`
```

The message never states what was actually observed and never names a remedy, so a refusal from the
record schema cannot satisfy `A1`.

### 2.8 `src/schema/declare.ts:14-36` — the declared record

`refuse` receives only the issues, never the input that produced them, so no observed size is
reachable at the point the message is built.

### 2.9 `src/schema/example.ts:36-52` — the synthesised example

`synthesiseString` special-cases the ULID, slug and ISO patterns and otherwise returns a run of `x`.
A new pattern with no case here produces an example that does not satisfy its own field.

### 2.10 `src/schema/ids.ts:1-4` — the shared patterns

```ts
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)(?!.*\/$)(?!.*\.$)[A-Za-z0-9._/-]+$/
```

There is no pattern for a git object id.

### 2.11 `src/domain/spine.ts:27-31` — the write-path element caps

```ts
const COLLECTION_ELEMENTS_CAP: Record<CollectionField, number> = {
  open_risks: caps.OPEN_RISKS_MAX_ELEMENTS,
  key_decisions: caps.KEY_DECISIONS_MAX_ELEMENTS,
  out_of_scope: caps.OUT_OF_SCOPE_MAX_ELEMENTS
}
```

This is the second enforcement point for the cap named in 2.4.

### 2.12 `src/merge/field-merge.ts:16-32` — the merge rule table

`THREAD_RULES` is typed `Record<keyof Thread | 'spine.…', FieldRule>`. Every field of `Thread` must
have an entry or the file does not compile.

### 2.13 `src/merge/field-merge.ts:146-152` — the criterion content read

```ts
type CriterionContent = Pick<Criterion, 'text' | 'done' | 'kind' | 'struck_by'>

const criterionContent = (item: Criterion): CriterionContent => ({
  text: item.text,
  done: item.done,
  kind: item.kind,
  struck_by: item.struck_by
})
```

This is the reader the `B7` census was run to find. It is consumed at
`src/merge/field-merge.ts:168-170`, where a divergence raises a conflict.

### 2.14 `src/server/tool-support.ts:102-109` — the invalid-record refusal

```ts
const invalidThreadRecordRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a thread record that matches its stored shape',
  example: 'shorten or remove the entry that failed validation and retry',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})
```

The validator names the field that failed; this function throws that away and reports `thread`.

### 2.15 `src/store/records.ts:33-45` — the store write validator

```ts
const validateChange = (change: RecordChange): Refusal | null => {
  if (change.kind === 'raw') return null
  if (change.kind === 'thread') {
    const validated = ThreadRecord.parse(change.record)
    return validated.ok ? null : validated
  }
  if (change.kind === 'decision') {
    const validated = DecisionRecord.parse(change.record)
    return validated.ok ? null : validated
  }
  const validated = SessionRecord.parse(change.record)
  return validated.ok ? null : validated
}
```

There is no `binding` branch. Section 3 records what that does and does not mean.

---

## 3. Divergences from the SPEC

### 3.1 `B1` is already shipped

The SPEC's `D3` states that `KeyDecision` has **no attachment field at all**, citing
`src/schema/thread.ts:19`, and `B1` mandates adding `criterion_id?: Ulid`.

At `e5f0195` and at the current tip that field is already present, on both the type
(`src/schema/thread.ts:19`) and the schema (`src/schema/thread.ts:81`), and `Risk` carries the same
field at `:18` and `:73`. Three shipped tests already assert it, in
`test/unit/thread-schema-criterion-id.test.ts`.

**Ruling applied:** `B1` requires no schema change. The remaining half of `B1` — refusing a
`criterion_id` that names no criterion on the thread — is enforced in the tool layer at
`src/server/tools/update_thread.ts:208-215` for risks, and adding it for key decisions belongs to
the units that own those tools. This plan changes nothing for `B1` and files the key-decision gap.

**Consequence for `D3`:** the part of `D3` this unit can close is closed already. The remaining part
of `D3` — that `LANE_A_TITLES_MAX` is unreachable dead code — is a renderer defect and belongs to
`U5`.

### 3.2 `B7` — the census found a reader, so `Criterion.kind` is RETAINED

The SPEC leaves this open at section 12 item 1 and settles the rule in advance: *"If it has one, it
stays and D-1 tolerates it; if not, it is removed."*

**The census was run over the whole tree.** `Criterion.kind` **has a reader**:

- `src/merge/field-merge.ts:151` — `kind: item.kind`, inside `criterionContent`.
- Consumed at `src/merge/field-merge.ts:168-170` — a deep-equality comparison whose inequality
  raises a merge conflict.

That is a behaviour-changing read of the field's value, not a pass-through. **`Criterion.kind` is
retained and its reader is `src/merge/field-merge.ts:151`.**

Two further facts made the outcome unambiguous rather than marginal:

- Removing it would change the published `amend_criteria` tool input, which is a breaking change to
  an external contract and therefore a MAJOR version event. `OR1` pins this unit at MINOR and
  reserves MAJOR for `U4` alone.
- Removing it would require editing `src/server/tools/open_thread.ts` and
  `src/server/tools/amend_criteria.ts`, both of which SPEC section 9 assigns to `U4` in wave 2.

The reader was untested, so this plan ships a test that pins it (section 5.4). `D22`'s complaint —
that the field encodes process history — is answered by the census outcome, not by deletion, exactly
as the SPEC directs.

### 3.3 `B6` — the closed census over every `*_MAX_ELEMENTS`

The population is every exported name in `src/schema/caps.ts` ending `_MAX_ELEMENTS`. There are
eight. Each is justified below as style-neutral or replaced by a size bound.

| Constant | Value | What it bounds | Grows with working style? | Outcome |
|---|---|---|---|---|
| `CRITERIA_MAX_ELEMENTS` | 40 | one call's `criteria_done` payload | No — a per-call batch bound | **Style-neutral; stays** |
| `CRITERIA_RETENTION_MAX_ELEMENTS` | 200 | stored `completion_criteria`, struck retained | No — criteria are the goals themselves, not findings about them | **Style-neutral; stays** |
| `OPEN_RISKS_MAX_ELEMENTS` | 40 | **(a)** stored `spine.open_risks`; **(b)** one call's `risks_add` / `risks_retire` payload | **(a) Yes** — parallel work yields more distinct-but-overlapping findings for the same decided content; **(b) No** | **Split. Use (a) is REPLACED by a size bound. Use (b) is style-neutral and stays** |
| `RISK_REFS_MAX_ELEMENTS` | 10 | refs on one risk | No — per-item, and a risk has as many backing pointers either way | **Style-neutral; stays** |
| `KEY_DECISIONS_MAX_ELEMENTS` | 200 | stored `spine.key_decisions` | No — a decision is recorded once when it is locked, regardless of route | **Style-neutral; stays** |
| `OUT_OF_SCOPE_MAX_ELEMENTS` | 40 | stored `spine.out_of_scope` | No — exclusions are properties of the thread | **Style-neutral; stays** |
| `DECISION_OPTIONS_MAX_ELEMENTS` | 20 | options on one decision record | No — per-record | **Style-neutral; stays** |
| `DECISION_SUPERSEDES_MAX_ELEMENTS` | 20 | supersedes on one decision record | No — per-record | **Style-neutral; stays** |

**The size bound that replaces use (a) is the one that already exists:**
`THREAD_RECORD_SERIALISED_MAX_BYTES`, enforced over the whole serialised thread record at
`src/schema/thread.ts:133-146` and at `src/server/tool-support.ts:126`. `spine.open_risks` is inside
that bound's coverage, so removing the element cap leaves the array bounded by record size rather
than unbounded. No new constant is introduced, because a second bound over data an existing bound
already covers would be a layer that has not earned its place.

The SPEC's stated expectation was that `OPEN_RISKS_MAX_ELEMENTS` converts, that
`DECISION_OPTIONS_MAX_ELEMENTS` is per-record and stays, and that `CRITERIA_MAX_ELEMENTS` is
style-neutral and stays. The census agrees with all three and settles the five the SPEC did not name.

**`ARTIFACTS` gets no element cap.** `Thread.artifacts` is introduced by `B3` and is bounded by the
same record-size bound, for the same reason.

**Rejected:** deleting the `OPEN_RISKS_MAX_ELEMENTS` constant outright. Use (b) —
`src/server/tools/update_thread.ts:71` and `:76` — is a legitimate per-call batch bound, and
`update_thread.ts` is owned by `U4` in wave 2. Deleting the constant would seize another unit's file
a whole wave early to no behavioural benefit. The constant's name is now wider than what it bounds;
that rename is filed for `U4`, which is already editing that file.

### 3.4 `OR12` — the write-time size bound, with its measurement and arithmetic

**Measured, at planning time, against a read-only copy of the live store.** The store root was
resolved by reading `src/store/layout.ts:77-82` and `src/store/project-key.ts:3-4`, copied to the
session scratchpad, and measured there. Nothing was written to the live store.

- Records measured: 5 threads, 95 decisions, 132 session entries.
- **Largest serialised thread record: 39,079 bytes** (`01M0VTE69T3HR4908RC9KX5XAT`, slug
  `thirteenth-unit`). Its composition: 39 open risks totalling 18,206 bytes, 67 key decisions
  totalling 16,604 bytes, 7 criteria totalling 1,899 bytes, 3 out-of-scope entries totalling 567
  bytes.
- Second largest: 16,359 bytes. Third: 13,964 bytes.

**Chosen bound: `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`, unchanged.**

The arithmetic connecting the measurement to the bound:

- Headroom today: `65536 - 39079 = 26457` bytes. The bound is `65536 / 39079 = 1.68x` the largest
  record that exists.
- Mean cost of one risk on that record: `18206 / 39 = 467` bytes. With the element cap removed, the
  headroom absorbs `26457 / 467 = 56` further risks before the write is refused — against the 1
  further risk the removed element cap allowed. That is the relaxation `D21` asks for, and it stays
  bounded.
- Worst case once `U4` starts writing the fields this unit adds: a check of 500 characters plus a
  result of 1000 characters plus a status adds about 1,564 bytes per criterion. On the largest live
  record, with 7 criteria: `39079 + 7 * 1564 = 50027` bytes, which is under 65,536. On the record
  with the most criteria (15, at 16,359 bytes): `16359 + 15 * 1564 = 39819` bytes, also under.

**Rejected: raising the bound.** The largest record sits at 60% of it; raising it would weaken the
bound with no measured need. **Rejected: lowering it.** Any value below about 49,000 would be
breached by the largest live record as soon as `U4` populates the new fields.

**A hazard this measurement exposed, and how it is closed.** The record-size bound is measured in
two places over two different values: `src/server/tool-support.ts:125` measures the record as the
caller supplied it, and `src/schema/thread.ts:133-146` measures it after parsing. Had the new fields
carried `.default(...)`, parsing would have added bytes and the two measurements would disagree, so
a record sitting exactly at the bound would become unwritable. This was observed: three shipped
tests that construct a record at the cap edge failed. The new fields therefore use `.optional()`
rather than `.default(...)`, parsing is byte-neutral, and acceptance criterion 9 pins that
permanently.

### 3.5 `OR15` obligation 6 — are `Binding` records written as `kind: 'raw'`?

**Yes.** `bind_branch` commits a binding as a raw blob:
`src/server/tools/bind_branch.ts:104` passes `{ kind: 'raw', relPath: … , content: … }`, and
`RecordChange` (`src/store/write-path.ts:13-17`) has no `binding` member at all. `validateChange`
returns `null` immediately for `raw` (`src/store/records.ts:34`), so a binding's fields are **not**
parsed on the store's write path.

**Is a `binding` branch needed for `A5` to hold over bindings? No.** `A5` is a Job-A invariant: SPEC
section 6.2 fixes its subject as a tool call and its enforcer as the tool. `bind_branch` already
parses every binding through `BindingRecord` before it commits, and refuses on failure
(`src/server/tools/bind_branch.ts:100-103`), writing only `validated.value`. Declaring
`Binding.branch` as class `pointer` therefore makes `A5` hold at exactly the point `A5` names. This
plan proves that with a test rather than asserting it (section 5.2).

**Ruling applied:** state the finding; do not add the branch. Adding it would require editing
`src/store/write-path.ts` (to extend `RecordChange`, `relativePathFor` and `contentFor`) and
`src/server/tools/bind_branch.ts` as well as `src/store/records.ts` — three files outside
`src/schema/`, none of which the tree needs in order to typecheck or for the suite to pass. `OR11`
permits reaching outside `src/schema/` only where the tree would not typecheck or the suite would
not pass otherwise, and this edit fails that test.

The residual gap — that a raw binding blob can reach the ref without passing `validateChange` — is
real, is above this unit's ceiling, and is filed. It overlaps the surface `B40` already opens in
`U2`.

### 3.6 `Decision.commit` carries one combined pattern, not a chained one

`OR15` obligation 3 originally directed that `Decision.commit` be built with `pointer(...)` and
additionally carry its sha pattern. This plan declares it with a single pattern and an explicit
`.meta({ class: 'pointer' })` instead. **That is now the ruled form**: orchestrator ruling `OR24`
amends `OR15` on exactly this point, on exactly the evidence below. It is recorded here as a
divergence from `OR15` as originally written, not as a departure from any live ruling.

**Measured reason.** Chaining a second `.regex()` onto `pointer(...)` makes zod emit neither pattern
at the top level; both land inside an `allOf`. Verified by probe, the emitted node becomes:

```
"commit": { "anyOf": [ { "type": "string", "maxLength": 64,
  "allOf": [ { "pattern": "<pointer pattern>" }, { "pattern": "<sha pattern>" } ] },
  { "type": "null" } ], "class": "pointer" }
```

Two consequences, both measured:

- The refusal loses its valid example. `synthesise` reads `node.pattern`
  (`src/schema/example.ts:37`), which is absent under `allOf`, so the example for a commit field
  becomes `"x"` — a value that does not satisfy the field. That breaks the four-part refusal, and
  weakens acceptance criterion 4.
- It introduces `allOf` into a record JSON Schema. `OR15` tells `U6` it may assume, without
  re-deriving, that `$defs` and `$ref` do not occur and that `anyOf` nodes still carry `class`;
  `allOf` is on the same list of unwalked subschema keys the existing census already halts on
  (`test/contract/described.test.ts:48-53`).

The single-pattern form preserves every property `OR15` exists to guarantee: the field still
declares `class: 'pointer'`, so `O4` and `U6` read it exactly as specified; and `A5` still holds
over it, strictly more strongly, because a forty- or sixty-four-character lowercase hex string
cannot contain a line break, a code fence or a diff hunk marker. Section 5.2 asserts that directly
rather than relying on the argument. `OR24` confirms that `OR15`'s assurance to `U6` is unchanged
and remains accurate.

### 3.7 `OR2` and `OR17`, restated

Wave 3 is sequential: `U8` merges before `U9`. Wave 1 is partially ordered: `U2` is cut from a
`main` that already contains this unit. Neither changes anything this plan does; both are restated
because the affected plans must agree.

### 3.8 No mitosis decomposition procedure was consulted

This ladder does not depend on one, and the file that described it is deleted from disk. This plan
was authored under `PLANNING-BRIEF.md` and `ORCHESTRATOR-RULINGS.md` alone.

### 3.9 The pattern for a git object id accepts two lengths

`SHA_PATTERN` accepts forty **or** sixty-four lowercase hex characters. All 95 decision records in
the live store carry a forty-character value and none is null, so forty alone would be sufficient
today. Sixty-four is accepted because git repositories using the SHA-256 object format produce
sixty-four-character ids, and `readProjectHead` (`src/store/git.ts:106-109`) returns whatever
`git rev-parse HEAD` prints. **Rejected:** forty only — it would refuse a legitimate HEAD on a
SHA-256 repository and there is no benefit to trade for that.

---

## 4. The change, step by step

Eighteen steps in application order, numbered 1 through 16 with steps 3 and 11 each split in two.
The tree does not typecheck between steps 11b and 12 — adding a field to `Thread` makes the merge
rule table incomplete until step 12 lands, so those two steps are applied together and share a
commit. Apply every step in order, then verify.

Section 12 assigns each step to one of the three pull requests this unit ships as. Read section 12
if you are executing one pull request rather than the whole unit; the steps themselves are here and
are not repeated there.

Section 9 groups these steps into commits. Section 10 records the measured diff size and the split
ruling.

### Step 1 — bump the version

File: `package.json` and `.claude-plugin/plugin.json`. REPLACE.

Read the current version first, then increment. Do not hard-code the pair.

Run:

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code: **0**. Expected output: one line carrying the same plain semver value twice,
for example `1.4.2 1.4.2`. Call that value `MAJOR.MINOR.PATCH`. This unit is a `feat`, so the new
value is `MAJOR.(MINOR+1).0`. Against the baseline the ladder expects, that is `1.4.2` -> `1.5.0`.

In `package.json`, FIND:

```
  "version": "1.4.2",
```

REPLACE with:

```
  "version": "1.5.0",
```

In `.claude-plugin/plugin.json`, FIND:

```
  "version": "1.4.2",
```

REPLACE with:

```
  "version": "1.5.0",
```

Both FIND strings above are the value the first command printed. Both REPLACE strings are the value
you computed from it. Substitute the values you read and computed, not the illustrative pair, into
all four strings. A value higher than `1.4.2` means the ladder moved ahead of this plan and is
handled by that substitution alone. The two manifests disagreeing with each other is a stop
condition — section 11.1.

Rationale: `P4` requires both manifests to move in one commit.

### Step 2 — add the object-id pattern

File: `src/schema/ids.ts`. REPLACE.

FIND:

```ts
export const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)(?!.*\/$)(?!.*\.$)[A-Za-z0-9._/-]+$/
```

REPLACE with:

```ts
export const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)(?!.*\/$)(?!.*\.$)[A-Za-z0-9._/-]+$/
export const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
```

Rationale: `B13` requires `Decision.commit` to carry a sha pattern.

### Step 3a — add the commit length cap

File: `src/schema/caps.ts`. FIND:

```ts
export const DECISION_SUPERSEDES_MAX_ELEMENTS = 20
```

REPLACE with:

```ts
export const DECISION_SUPERSEDES_MAX_ELEMENTS = 20
export const DECISION_COMMIT_MAX = 64
```

### Step 3b — add the caps for the new goal-model fields

File: `src/schema/caps.ts`. Two edits.

Edit 1 — FIND:

```ts
export const CRITERION_TEXT_MAX = 500
```

REPLACE with:

```ts
export const CRITERION_TEXT_MAX = 500
export const CRITERION_CHECK_MAX = 500
export const CRITERION_RESULT_MAX = 1000
```

Edit 2 — FIND:

```ts
export const OUT_OF_SCOPE_TEXT_MAX = 300
```

REPLACE with:

```ts
export const OUT_OF_SCOPE_TEXT_MAX = 300

export const ARTIFACT_LABEL_MAX = 200
export const ARTIFACT_POINTER_MAX = 500
```

`OPEN_RISKS_MAX_ELEMENTS` is left exactly where it is. Section 3.3 records why: its per-call use at
`src/server/tools/update_thread.ts:71` and `:76` is style-neutral and survives, and that file belongs
to another unit.

Rationale: `B2` needs caps for `check` and `result`; `B3` needs caps for an artifact's label and
pointer; `B13` needs a cap for the commit field.

### Step 4 — give the sha pattern a valid synthesised example

File: `src/schema/example.ts`. Two edits.

Edit 1 — FIND:

```ts
import { ULID_PATTERN, SLUG_PATTERN, ISO_PATTERN } from './ids.ts'
```

REPLACE with:

```ts
import { ULID_PATTERN, SLUG_PATTERN, ISO_PATTERN, SHA_PATTERN } from './ids.ts'
```

Edit 2 — FIND:

```ts
  if (pattern === ISO_PATTERN.source) {
    return '2024-01-01T00:00:00.000Z'
  }
```

REPLACE with:

```ts
  if (pattern === ISO_PATTERN.source) {
    return '2024-01-01T00:00:00.000Z'
  }
  if (pattern === SHA_PATTERN.source) {
    return '0'.repeat(40)
  }
```

Rationale: without this the refusal for an invalid commit offers `"x"` as a valid example, which is
not one. Acceptance criterion 4 requires the four parts of a refusal to be true, not merely present.

### Step 5 — create the field-class module

File: `src/schema/field-class.ts`. CREATE. Entire contents:

```ts
import { z } from 'zod'

export const POINTER_PATTERN = /^(?!\+\+\+ )(?!--- )(?!.*(?:```|@@ |U\+000A|U\+000D))[^\r\n]*$/

export const structural = <T extends z.ZodType>(schema: T): T => schema.meta({ class: 'structural' }) as T

export const content = <T extends z.ZodType>(schema: T): T => schema.meta({ class: 'content' }) as T

export const pointer = (max: number, description: string) =>
  z.string().max(max).regex(POINTER_PATTERN).describe(description).meta({ class: 'pointer' })
```

Rationale: `B5` requires every field to declare its class. `pointer` also carries the `A5`
validator, so declaring a class and enforcing it are one act.

### Step 6 — carry the parsed input into the refusal

File: `src/schema/declare.ts`. Two edits.

Edit 1 — FIND:

```ts
  refuse: (issues: z.core.$ZodIssue[]) => Refusal
}
```

REPLACE with:

```ts
  refuse: (issues: z.core.$ZodIssue[], input?: unknown) => Refusal
}
```

Edit 2 — FIND:

```ts
  const refuse = (issues: z.core.$ZodIssue[]): Refusal => buildRefusal(jsonSchema, issues)

  const parse = (input: unknown): Ok<T> | Refusal => {
    const result = schema.safeParse(input)
    if (result.success) {
      return { ok: true, value: result.data }
    }
    return refuse(result.error.issues)
  }
```

REPLACE with:

```ts
  const refuse = (issues: z.core.$ZodIssue[], input?: unknown): Refusal =>
    buildRefusal(jsonSchema, issues, input)

  const parse = (input: unknown): Ok<T> | Refusal => {
    const result = schema.safeParse(input)
    if (result.success) {
      return { ok: true, value: result.data }
    }
    return refuse(result.error.issues, input)
  }
```

Rationale: `A1` requires the refusal to name the observed value, which is reachable only from the
input. The new parameter is optional, so the four existing callers in
`test/contract/no-path.test.ts` compile unchanged.

### Step 7 — name the observed value and a remedy in the refusal

File: `src/schema/refusal.ts`. Three edits.

Edit 1 — FIND:

```ts
const renderMessage = (field: string, accepted: string, example: string, retryable: boolean): string =>
  `${field} was refused; it accepts ${accepted}; a valid example is ${example}; retryable=${retryable}.`
```

REPLACE with:

```ts
const valueAtPath = (input: unknown, path: (string | number | symbol)[]): unknown => {
  let cursor: unknown = input
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[String(segment)]
  }
  return cursor
}

const renderObserved = (input: unknown, issue: z.core.$ZodIssue): string | null => {
  const value = valueAtPath(input, issue.path)
  if (typeof value === 'string') return `${value.length} characters`
  if (Array.isArray(value)) return `${value.length} entries`
  return null
}

const renderRemedy = (issue: z.core.$ZodIssue): string => {
  if (issue.code === 'too_big' && issue.origin === 'array') {
    return `remove entries until at most ${String(issue.maximum)} remain and retry`
  }
  if (issue.code === 'too_big') {
    return `shorten the value to at most ${String(issue.maximum)} and retry`
  }
  if (issue.code === 'too_small') {
    return `lengthen the value to at least ${String(issue.minimum)} and retry`
  }
  return 'send a value matching what this field accepts and retry'
}

const renderMessage = (
  field: string,
  accepted: string,
  observed: string | null,
  example: string,
  remedy: string,
  retryable: boolean
): string => {
  const observedClause = observed === null ? '' : `observed ${observed}; `
  return `${field} was refused; it accepts ${accepted}; ${observedClause}a valid example is ${example}; remedy: ${remedy}; retryable=${retryable}.`
}
```

Edit 2 — FIND:

```ts
export const refuse = (jsonSchema: Record<string, unknown>, issues: z.core.$ZodIssue[]): Refusal => {
```

REPLACE with:

```ts
export const refuse = (
  jsonSchema: Record<string, unknown>,
  issues: z.core.$ZodIssue[],
  input?: unknown
): Refusal => {
```

Edit 3 — FIND:

```ts
  const retryable = !isNonRetryable(issue)
  const message = renderMessage(field, accepted, example, retryable)
```

REPLACE with:

```ts
  const retryable = !isNonRetryable(issue)
  const observed = renderObserved(input, issue)
  const message = renderMessage(field, accepted, observed, example, renderRemedy(issue), retryable)
```

Rationale: `A1` requires the refusal to name the field, the limit, the observed value and a remedy.
The field and the limit are already present; this adds the other two. The `a valid example is …;`
clause keeps its exact shape and trailing semicolon, so the anchored scrub at
`test/support/refusal-census.ts:87` still matches.

### Step 8 — replace the decision record schema

File: `src/schema/decision.ts`. REPLACE (whole file). Entire new contents:

```ts
import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, ISO_PATTERN, SHA_PATTERN } from './ids.ts'
import { content, structural } from './field-class.ts'
import * as caps from './caps.ts'
import type { Ulid, Iso8601 } from './thread.ts'

export type { Ulid, Iso8601 } from './thread.ts'

export type Decision = {
  id: Ulid
  thread_id: Ulid
  title: string
  context: string
  options: string[]
  outcome: string
  commit: string | null
  supersedes: Ulid[]
  created_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))

const DecisionShape = z.object({
  id: ulidField('the decision identity, a ULID'),
  thread_id: ulidField('the thread this decision belongs to'),
  title: content(z.string().min(1).max(caps.DECISION_TITLE_MAX).describe('the decision title')),
  context: content(z.string().max(caps.DECISION_CONTEXT_MAX).describe('the context the decision was made in')),
  options: z
    .array(content(z.string().max(caps.DECISION_OPTION_MAX).describe('one option that was considered')))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .describe('the options considered')
    .meta({ class: 'content' }),
  outcome: content(z.string().max(caps.DECISION_OUTCOME_MAX).describe('the chosen outcome and its rationale')),
  commit: z
    .string()
    .max(caps.DECISION_COMMIT_MAX)
    .regex(SHA_PATTERN)
    .nullable()
    .describe('the project HEAD sha at the time of recording, or null when it could not be read')
    .meta({ class: 'pointer' }),
  supersedes: z
    .array(structural(z.string().regex(ULID_PATTERN).describe('one decision id this decision supersedes')))
    .max(caps.DECISION_SUPERSEDES_MAX_ELEMENTS)
    .describe('decision ids this decision supersedes')
    .meta({ class: 'structural' }),
  created_at: structural(z.string().regex(ISO_PATTERN).describe('when this decision was recorded'))
})

export const DecisionRecord = declare<Decision>('decision', DecisionShape)
```

Rationale: `B5` — every field declares its class; `B13` — `commit` gains its cap and its sha
pattern.

### Step 9 — replace the session record schema

File: `src/schema/session.ts`. REPLACE (whole file). Entire new contents:

```ts
import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, ISO_PATTERN } from './ids.ts'
import { content, structural } from './field-class.ts'
import * as caps from './caps.ts'
import type { Ulid, Iso8601 } from './thread.ts'

export type { Ulid, Iso8601 } from './thread.ts'

export type SessionEntry = {
  id: Ulid
  thread_id: Ulid
  actor: string
  body: string
  created_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))

const SessionShape = z.object({
  id: ulidField('the session entry identity, a ULID'),
  thread_id: ulidField('the thread this session entry belongs to'),
  actor: content(z.string().min(1).max(caps.SESSION_ACTOR_MAX).describe('who or what wrote this session entry')),
  body: content(z.string().max(caps.SESSION_BODY_MAX).describe('the session entry text')),
  created_at: structural(z.string().regex(ISO_PATTERN).describe('when this session entry was written'))
})

export const SessionRecord = declare<SessionEntry>('session', SessionShape)
```

Rationale: `B5`.

### Step 10 — replace the binding record schema

File: `src/schema/binding.ts`. REPLACE (whole file). Entire new contents:

```ts
import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, ISO_PATTERN } from './ids.ts'
import { pointer, structural } from './field-class.ts'
import * as caps from './caps.ts'
import type { Ulid, Iso8601 } from './thread.ts'

export type { Ulid, Iso8601 } from './thread.ts'

export type Binding = {
  id: Ulid
  thread_id: Ulid
  branch: string
  created_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))

const BindingShape = z.object({
  id: ulidField('the binding identity, a ULID'),
  thread_id: ulidField('the thread this branch is bound to'),
  branch: pointer(caps.BINDING_BRANCH_MAX, 'the git branch name bound to this thread'),
  created_at: structural(z.string().regex(ISO_PATTERN).describe('when this binding was recorded'))
})

export const BindingRecord = declare<Binding>('binding', BindingShape)
```

Rationale: `B5`, and `branch` becomes class `pointer`, which is what makes `A5` hold over bindings
through `bind_branch`'s own parse (section 3.5).

### Step 11a — replace the thread record schema with its class-declaring form

File: `src/schema/thread.ts`. REPLACE (whole file). Entire new contents:

```ts
import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, SLUG_PATTERN, ISO_PATTERN } from './ids.ts'
import { content, pointer, structural } from './field-class.ts'
import * as caps from './caps.ts'

export type Ulid = string
export type Iso8601 = string

export type Criterion = {
  id: Ulid
  ordinal: number
  text: string
  done: boolean
  kind: 'planned' | 'detour'
  struck_by: Ulid | null
}

export type Risk = { id: Ulid; scope: string; text: string; refs: string[]; criterion_id?: Ulid | undefined }
export type KeyDecision = { id: Ulid; decision_id: Ulid; title: string; scope: string; criterion_id?: Ulid | undefined }
export type OutOfScope = { id: Ulid; text: string }

export type Spine = {
  active_goal: string
  next_step: string
  last_session: string
  open_risks: Risk[]
  key_decisions: KeyDecision[]
  out_of_scope: OutOfScope[]
}

export type Thread = {
  id: Ulid
  slug: string
  title: string
  status: 'open' | 'done' | 'abandoned'
  blocked_by: string | null
  predecessor_id?: Ulid | undefined
  completion_criteria: Criterion[]
  spine: Spine
  created_at: Iso8601
  updated_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))
const optionalUlidField = (description: string) =>
  structural(z.string().regex(ULID_PATTERN).optional().describe(description))
const isoField = (description: string) => structural(z.string().regex(ISO_PATTERN).describe(description))

const CriterionSchema = structural(
  z.object({
    id: ulidField('the criterion identity, a stable ULID that the merge keys on'),
    ordinal: structural(
      z.number().int().min(1).describe('the rendered position of this criterion, recomputed on render, never merged')
    ),
    text: content(z.string().max(caps.CRITERION_TEXT_MAX).describe('the criterion text')),
    done: structural(z.boolean().describe('whether this criterion has been satisfied')),
    kind: structural(
      z.enum(['planned', 'detour']).describe('whether this criterion was planned up front or added mid-thread')
    ),
    struck_by: structural(
      z
        .string()
        .regex(ULID_PATTERN)
        .nullable()
        .describe('the decision id that struck this criterion, or null when it has not been struck')
    )
  })
)

const RiskSchema = structural(
  z.object({
    id: ulidField('the risk identity, a ULID'),
    scope: content(
      z.string().max(caps.RISK_SCOPE_MAX).describe('the criterion or area of the thread this risk concerns')
    ),
    text: content(z.string().max(caps.RISK_TEXT_MAX).describe('the risk text')),
    refs: z
      .array(pointer(caps.RISK_REF_MAX, 'one external pointer backing this risk'))
      .max(caps.RISK_REFS_MAX_ELEMENTS)
      .describe('external pointers backing this risk')
      .meta({ class: 'pointer' }),
    criterion_id: optionalUlidField('the criterion this risk ranks against, absent when the risk is unanchored')
  })
)

const KeyDecisionSchema = structural(
  z.object({
    id: ulidField('the key-decision link identity, a ULID'),
    decision_id: ulidField('the decision record this key decision links to'),
    title: content(
      z.string().max(caps.KEY_DECISION_TITLE_MAX).describe('the decision title as it should render on the spine')
    ),
    scope: content(
      z.string().max(caps.KEY_DECISION_SCOPE_MAX).describe('the criterion or area of the thread this decision resolved')
    ),
    criterion_id: optionalUlidField('the criterion this decision ranks against, absent when the decision is unanchored')
  })
)

const OutOfScopeSchema = structural(
  z.object({
    id: ulidField('the out-of-scope entry identity, a ULID'),
    text: content(z.string().max(caps.OUT_OF_SCOPE_TEXT_MAX).describe('the out-of-scope statement'))
  })
)

const SpineSchema = z.object({
  active_goal: content(z.string().max(caps.SPINE_ACTIVE_GOAL_MAX).describe('the thread goal currently being worked')),
  next_step: content(z.string().max(caps.SPINE_NEXT_STEP_MAX).describe('the next concrete step in this thread')),
  last_session: content(z.string().max(caps.SPINE_LAST_SESSION_MAX).describe('a summary of the most recent session')),
  open_risks: z
    .array(RiskSchema)
    .max(caps.OPEN_RISKS_MAX_ELEMENTS)
    .describe('risks still open on this thread')
    .meta({ class: 'structural' }),
  key_decisions: z
    .array(KeyDecisionSchema)
    .max(caps.KEY_DECISIONS_MAX_ELEMENTS)
    .describe('decisions linked into the spine')
    .meta({ class: 'structural' }),
  out_of_scope: z
    .array(OutOfScopeSchema)
    .max(caps.OUT_OF_SCOPE_MAX_ELEMENTS)
    .describe('statements of what this thread explicitly excludes')
    .meta({ class: 'structural' })
})

const ThreadShape = z.object({
  id: ulidField('the thread identity, a ULID'),
  slug: content(
    z.string().min(1).max(caps.THREAD_SLUG_MAX).regex(SLUG_PATTERN).describe('a short lowercase label for the thread')
  ),
  title: content(z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the thread title')),
  status: structural(z.enum(['open', 'done', 'abandoned']).describe('the thread lifecycle state')),
  blocked_by: content(
    z
      .string()
      .max(caps.THREAD_BLOCKED_BY_MAX)
      .nullable()
      .describe('the reason this thread is blocked, or null when it is not blocked')
  ),
  predecessor_id: optionalUlidField(
    'the id of the thread this one succeeds, absent when this thread succeeds no earlier thread'
  ),
  completion_criteria: z
    .array(CriterionSchema)
    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
    .describe('the criteria that define this thread as done, struck criteria retained')
    .meta({ class: 'structural' }),
  spine: SpineSchema.describe('the progressive summary of this thread').meta({ class: 'structural' }),
  created_at: isoField('when this thread was created'),
  updated_at: isoField('when this thread was last updated')
})

const ThreadShapeWithByteCap = ThreadShape.superRefine((value, ctx) => {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'string',
      maximum: caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      inclusive: true,
      path: [],
      message: `serialised thread record exceeds ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes`,
      input: value
    })
  }
})

export const ThreadRecord = declare<Thread>('thread', ThreadShapeWithByteCap)
```

Rationale: `B5` — every field declares its class, including both an array node and its element node;
`B4` — `Risk.refs` is retained and becomes class `pointer`; `B7` — `kind` is retained. This step adds
no field and removes no cap, so the record's shape is unchanged and every stored record parses
exactly as before.

### Step 11b — add the goal-model fields and drop the open-risks element cap

File: `src/schema/thread.ts`. Six edits, applied to the file as step 11a left it.

Edit 1 — FIND:

```ts
export type Ulid = string
export type Iso8601 = string
```

REPLACE with:

```ts
export type Ulid = string
export type Iso8601 = string

export type ResultStatus = 'verified' | 'unverified-reasoned'
```

Edit 2 — FIND:

```ts
  kind: 'planned' | 'detour'
  struck_by: Ulid | null
}
```

REPLACE with:

```ts
  kind: 'planned' | 'detour'
  check?: string | null | undefined
  result?: string | null | undefined
  result_status?: ResultStatus | null | undefined
  struck_by: Ulid | null
}
```

Edit 3 — FIND:

```ts
export type OutOfScope = { id: Ulid; text: string }
```

REPLACE with:

```ts
export type OutOfScope = { id: Ulid; text: string }
export type Artifact = { id: Ulid; label: string; pointer: string }
```

Edit 4 — FIND:

```ts
  completion_criteria: Criterion[]
  spine: Spine
```

REPLACE with:

```ts
  completion_criteria: Criterion[]
  artifacts?: Artifact[] | undefined
  spine: Spine
```

Edit 5 — FIND:

```ts
    struck_by: structural(
```

REPLACE with:

```ts
    check: content(
      z
        .string()
        .max(caps.CRITERION_CHECK_MAX)
        .nullable()
        .optional()
        .describe('the re-runnable check that decides whether this criterion is true, absent when none is recorded')
    ),
    result: content(
      z
        .string()
        .max(caps.CRITERION_RESULT_MAX)
        .nullable()
        .optional()
        .describe('what the check returned when this criterion was marked done, absent when none is recorded')
    ),
    result_status: structural(
      z
        .enum(['verified', 'unverified-reasoned'])
        .nullable()
        .optional()
        .describe('whether the recorded result came from running the check, absent when none is recorded')
    ),
    struck_by: structural(
```

Edit 6 — FIND:

```ts
const SpineSchema = z.object({
```

REPLACE with:

```ts
const ArtifactSchema = structural(
  z.object({
    id: ulidField('the artifact entry identity, a ULID'),
    label: content(z.string().min(1).max(caps.ARTIFACT_LABEL_MAX).describe('what this artifact is, in a few words')),
    pointer: pointer(caps.ARTIFACT_POINTER_MAX, 'a path or url naming where this artifact lives')
  })
)

const SpineSchema = z.object({
```

Edit 7 — FIND:

```ts
  open_risks: z
    .array(RiskSchema)
    .max(caps.OPEN_RISKS_MAX_ELEMENTS)
    .describe('risks still open on this thread')
    .meta({ class: 'structural' }),
```

REPLACE with:

```ts
  open_risks: z.array(RiskSchema).describe('risks still open on this thread').meta({ class: 'structural' }),
```

Edit 8 — FIND:

```ts
    .describe('the criteria that define this thread as done, struck criteria retained')
    .meta({ class: 'structural' }),
  spine: SpineSchema
```

REPLACE with:

```ts
    .describe('the criteria that define this thread as done, struck criteria retained')
    .meta({ class: 'structural' }),
  artifacts: z
    .array(ArtifactSchema)
    .optional()
    .describe('the artifacts this thread produced, each a label and a pointer')
    .meta({ class: 'structural' }),
  spine: SpineSchema
```

Rationale: `B2` — `check`, `result` and `result_status` land optional; `B3` — `Artifact` and
`Thread.artifacts` land, with `pointer` class `pointer`; `B6` — `open_risks` loses its element cap
and is bounded by the whole-record byte cap.

The three new criterion fields and `artifacts` use `.optional()` and never `.default(...)`. Section
3.4 records the measured reason: a default makes parsing add bytes, which splits the two places the
record-size bound is measured and makes a record sitting at the bound unwritable.

### Step 12 — give the merge rule table an entry for artifacts

File: `src/merge/field-merge.ts`. REPLACE.

FIND:

```ts
  completion_criteria: 'union-by-id',
```

REPLACE with:

```ts
  completion_criteria: 'union-by-id',
  artifacts: 'union-by-id',
```

Rationale: `THREAD_RULES` is typed over `keyof Thread`, so the tree does not typecheck without this
key. `union-by-id` is the rule every other id-bearing collection on the thread already uses, and an
artifact carries a ULID id.

### Step 13 — stop capping open risks by element count on the write path

File: `src/domain/spine.ts`. Two edits.

Edit 1 — FIND:

```ts
const COLLECTION_ELEMENTS_CAP: Record<CollectionField, number> = {
  open_risks: caps.OPEN_RISKS_MAX_ELEMENTS,
```

REPLACE with:

```ts
const COLLECTION_ELEMENTS_CAP: Record<CollectionField, number | null> = {
  open_risks: null,
```

Edit 2 — FIND:

```ts
  const limit = COLLECTION_ELEMENTS_CAP[field]
  const observed = storedCount + contributedCount
```

REPLACE with:

```ts
  const limit = COLLECTION_ELEMENTS_CAP[field]
  if (limit === null) {
    return null
  }
  const observed = storedCount + contributedCount
```

Rationale: `B6` and `D21`. This is the second of the two places the element cap was enforced; the
first was the record schema, removed in step 11. `key_decisions` and `out_of_scope` keep theirs.

### Step 14 — classify the new members of four existing censuses

Four shipped tests enumerate a population this change legitimately grows. Each is answered by
classifying the new member. None is narrowed, and no count is pinned.

Edit 1 — file `test/unit/records.test.ts`. FIND:

```ts
const EXPECTED_COLLECTION_PATHS = ['completion_criteria', 'spine.key_decisions', 'spine.open_risks', 'spine.out_of_scope']
```

REPLACE with:

```ts
const EXPECTED_COLLECTION_PATHS = ['artifacts', 'completion_criteria', 'spine.key_decisions', 'spine.open_risks', 'spine.out_of_scope']
```

Edit 2 — file `test/unit/records.test.ts`. FIND:

```ts
  assert.deepStrictEqual(discoveredPaths, ['completion_criteria', 'spine.open_risks', 'spine.out_of_scope'])
```

REPLACE with:

```ts
  assert.deepStrictEqual(discoveredPaths, ['artifacts', 'completion_criteria', 'spine.open_risks', 'spine.out_of_scope'])
```

Edit 3 — file `test/unit/field-merge.test.ts`. FIND:

```ts
    [
      'blocked_by',
      'completion_criteria',
```

REPLACE with:

```ts
    [
      'artifacts',
      'blocked_by',
      'completion_criteria',
```

Edit 4 — file `test/unit/declare.test.ts`. This exact block occurs **twice**; apply the same
replacement to **both** occurrences. FIND:

```ts
    completion_criteria: [
      { id: '0'.repeat(26), ordinal: 1, text: 'a', done: false, kind: 'planned', struck_by: null }
    ],
    spine: {
```

REPLACE with:

```ts
    completion_criteria: [
      { id: '0'.repeat(26), ordinal: 1, text: 'a', done: false, kind: 'planned', struck_by: null }
    ],
    artifacts: [{ id: '0'.repeat(26), label: 'a', pointer: 'a' }],
    spine: {
```

Rationale: `deriveCandidates` throws when it reaches an array-of-object field whose sample array is
empty, by design, so the fixture must carry one artifact for the new field to be reachable.

### Step 15 — retire the open-risks accumulation assertions

File: `test/unit/caps.test.ts`. Two edits.

Edit 1 — FIND:

```ts
test('caps.assert-contribution', () => {
  const rt = testRuntime()
  const makeRisk = (label: string): Risk => ({ id: rt.ulid(), scope: 'test', text: `risk ${label}`, refs: [] })

  const risks39 = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS - 1 }, (_, i) => makeRisk(String(i)))
  const stored39: Spine = { ...baseSpine(), open_risks: risks39 }

  const acceptResult = contributeToSpine(stored39, { open_risks: [makeRisk('new')] })
  assert.equal(acceptResult.ok, true)
  if (!acceptResult.ok) {
    throw new Error('expected the 40th risk to be accepted')
  }
  assert.equal(acceptResult.value.open_risks.length, caps.OPEN_RISKS_MAX_ELEMENTS)

  const risks40 = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS }, (_, i) => makeRisk(String(i)))
  const stored40: Spine = { ...baseSpine(), open_risks: risks40 }

  const refuseResult = contributeToSpine(stored40, { open_risks: [makeRisk('overflow')] })
  assert.equal(refuseResult.ok, false)
  if (refuseResult.ok) {
    throw new Error('expected the 41st risk to be refused')
  }
  assert.equal(refuseResult.field, 'risks_add')
})
```

REPLACE with:

```ts
test('caps.open-risks-accumulate-past-the-old-element-cap', () => {
  const rt = testRuntime()
  const makeRisk = (label: string): Risk => ({ id: rt.ulid(), scope: 'test', text: `risk ${label}`, refs: [] })

  const risks40 = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS }, (_, i) => makeRisk(String(i)))
  const stored40: Spine = { ...baseSpine(), open_risks: risks40 }

  const acceptResult = contributeToSpine(stored40, { open_risks: [makeRisk('forty-first')] })
  assert.equal(acceptResult.ok, true)
  if (!acceptResult.ok) {
    throw new Error('expected the 41st risk to be accepted; open_risks is bounded by record size, not element count')
  }
  assert.equal(acceptResult.value.open_risks.length, caps.OPEN_RISKS_MAX_ELEMENTS + 1)
})

test('caps.key-decisions-still-refuse-on-their-element-cap', () => {
  const rt = testRuntime()
  const makeDecision = (label: string): KeyDecision => ({
    id: rt.ulid(),
    decision_id: rt.ulid(),
    title: `decision ${label}`,
    scope: 'test'
  })
  const stored: Spine = {
    ...baseSpine(),
    key_decisions: Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS }, (_, i) => makeDecision(String(i)))
  }

  const refuseResult = contributeToSpine(stored, { key_decisions: [makeDecision('overflow')] })
  assert.equal(refuseResult.ok, false)
  if (refuseResult.ok) {
    throw new Error('expected the 201st key decision to be refused')
  }
  assert.equal(refuseResult.field, 'key_decisions_add')
})
```

Edit 2 — FIND:

```ts
  const overCapRisks = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS + 5 }, (_, i) => makeRisk(String(i)))
```

REPLACE with:

```ts
  const overCapRisks = Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS + 5 }, (_, i) => makeRisk(String(i)))
```

Rationale: the first assertion tested the cap this change removes, so it is replaced by its
opposite — accumulation past forty now succeeds — and by a new assertion that the two element caps
which survive still refuse. The second edit only needs a number larger than the stored collection;
`OPEN_RISKS_MAX_ELEMENTS` is no longer the right one to borrow.

### Step 16 — name the field that failed

File: `src/server/tool-support.ts`. Two edits.

Edit 1 — FIND:

```ts
const invalidThreadRecordRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
```

REPLACE with:

```ts
const invalidThreadRecordRefusal = (field: string, issue: string): Refusal => ({
  ok: false,
  field,
```

Edit 2 — FIND:

```ts
    return { ok: false, refusal: invalidThreadRecordRefusal(validated.message) }
```

REPLACE with:

```ts
    return { ok: false, refusal: invalidThreadRecordRefusal(validated.field, validated.message) }
```

Rationale: `OR15` obligation 4. `A5` requires the refusal to name the field; this function was
discarding the field the validator named and reporting `thread`.

---

## 5. Tests

Five new files and the four existing-file edits already given as steps 14 and 15. Every new file is
given in full.

### 5.1 `test/unit/field-class.test.ts` — CREATE

Discharges acceptance criteria 1 and 13, and SPEC rule `B5`.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { census, type Classified } from '../support/census.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import { POINTER_PATTERN } from '../../src/schema/field-class.ts'

type SchemaNode = { path: string; value: unknown }

const FIELD_CLASSES = ['structural', 'pointer', 'content'] as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const flattenSchemaNodes = (value: unknown, path: string): SchemaNode[] => {
  if (!isPlainObject(value)) return []
  const collected: SchemaNode[] = []
  const properties = value.properties
  if (properties !== undefined) {
    if (!isPlainObject(properties)) {
      collected.push({ path: `${path}.properties`, value: properties })
    } else {
      for (const [key, child] of Object.entries(properties)) {
        const childPath = `${path}.${key}`
        collected.push({ path: childPath, value: child })
        collected.push(...flattenSchemaNodes(child, childPath))
      }
    }
  }
  const items = value.items
  if (items !== undefined) {
    const itemsPath = `${path}[]`
    collected.push({ path: itemsPath, value: items })
    collected.push(...flattenSchemaNodes(items, itemsPath))
  }
  return collected
}

export const classifyFieldClassNode = (entry: SchemaNode): Classified<SchemaNode>['verdict'] | 'unclassifiable' => {
  if (!isPlainObject(entry.value)) return 'unclassifiable'
  if ('$ref' in entry.value) return 'unclassifiable'
  const declared = entry.value.class
  if (declared === undefined) return 'forbidden'
  if (typeof declared !== 'string') return 'unclassifiable'
  return (FIELD_CLASSES as readonly string[]).includes(declared) ? 'allowed' : 'unclassifiable'
}

const RECORDS = [ThreadRecord, DecisionRecord, SessionRecord, BindingRecord]

const allNodes = (): SchemaNode[] => RECORDS.flatMap((record) => flattenSchemaNodes(record.jsonSchema, record.name))

test('field-class.every-record-field-declares-a-class', () => {
  const nodes = allNodes()
  assert.ok(
    nodes.length > 0,
    'field-class: the four record schemas flattened to no nodes; a census over an empty list proves nothing'
  )
  assert.doesNotThrow(() => census(nodes, classifyFieldClassNode))
})

test('field-class.an-array-and-its-element-declare-the-same-class', () => {
  const byPath = new Map(allNodes().map((node) => [node.path, node.value] as const))
  const elementPaths = [...byPath.keys()].filter((path) => path.endsWith('[]'))
  assert.ok(elementPaths.length > 0, 'field-class: no array element nodes were emitted; the pairing assertion proves nothing')
  for (const elementPath of elementPaths) {
    const arrayPath = elementPath.slice(0, -2)
    const arrayNode = byPath.get(arrayPath)
    const elementNode = byPath.get(elementPath)
    assert.ok(isPlainObject(arrayNode), `field-class: ${arrayPath} is not a plain object`)
    assert.ok(isPlainObject(elementNode), `field-class: ${elementPath} is not a plain object`)
    assert.equal(
      elementNode.class,
      arrayNode.class,
      `field-class: ${arrayPath} declares ${String(arrayNode.class)} but ${elementPath} declares ${String(elementNode.class)}`
    )
  }
})

test('field-class.every-declared-pointer-carries-the-pointer-pattern', () => {
  const pointers = allNodes().filter((node) => isPlainObject(node.value) && node.value.class === 'pointer')
  assert.ok(pointers.length > 0, 'field-class: no pointer-class node was emitted; the pattern assertion proves nothing')
  for (const node of pointers) {
    const value = node.value as Record<string, unknown>
    if (value.type !== 'string') continue
    assert.ok(
      typeof value.pattern === 'string' && value.pattern.length > 0,
      `field-class: ${node.path} declares class pointer but carries no pattern`
    )
  }
})

test('field-class.control.an-undeclared-node-is-forbidden-and-a-foreign-class-halts', () => {
  assert.equal(classifyFieldClassNode({ path: 'probe.undeclared', value: { type: 'string' } }), 'forbidden')
  assert.equal(classifyFieldClassNode({ path: 'probe.foreign', value: { type: 'string', class: 'metadata' } }), 'unclassifiable')
  assert.equal(classifyFieldClassNode({ path: 'probe.ref', value: { $ref: '#/$defs/probe' } }), 'unclassifiable')
  assert.equal(classifyFieldClassNode({ path: 'probe.notObject', value: 'string' }), 'unclassifiable')
  assert.equal(classifyFieldClassNode({ path: 'probe.ok', value: { type: 'string', class: 'content' } }), 'allowed')
})

test('field-class.pointer-pattern-refuses-content-and-accepts-an-address', () => {
  for (const forbidden of [
    'docs/spec.md\nsecond line',
    'see ```ts for the shape',
    '@@ -1,2 +1,2 @@',
    '+++ b/file.ts',
    '--- a/file.ts',
    'left U+000A behind'
  ]) {
    assert.equal(POINTER_PATTERN.test(forbidden), false, `POINTER_PATTERN must refuse ${JSON.stringify(forbidden)}`)
  }
  for (const accepted of [
    'docs/specs/2026-08-28-continuity-goal-model.md#L120',
    'src/schema/thread.ts:44',
    'https://example.invalid/a/b',
    '0'.repeat(40)
  ]) {
    assert.equal(POINTER_PATTERN.test(accepted), true, `POINTER_PATTERN must accept ${JSON.stringify(accepted)}`)
  }
})
```

Note on the flattener: `OR15` assigns `U6` the job of lifting this flattener into
`test/support/schema-nodes.ts` so both tests import one copy. Until `U6` lands, this unit keeps its
own copy and does not create that shared module.

### 5.2 `test/unit/git-boundary.test.ts` — CREATE

Discharges acceptance criteria 2, 3 and 8, and SPEC invariant `A5` and rule `B13`. The first three
tests are the `A5` assertion `OR15` obligation 5 requires, asserting
`field === 'spine.open_risks.0.refs.0'` for a line break, a code fence and a `@@ ` diff hunk marker.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { BindingRecord, type Binding } from '../../src/schema/binding.ts'
import * as caps from '../../src/schema/caps.ts'

const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ'
const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const RISK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const DECISION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY'
const ARTIFACT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const A_REAL_SHA = '0123456789abcdef0123456789abcdef01234567'

const CONTENT_NOT_POINTER = [
  ['a-line-break', 'docs/spec.md\nsecond line'],
  ['a-code-fence', 'see ```ts for the shape'],
  ['a-diff-hunk-marker', '@@ -1,2 +1,2 @@']
] as const

const baseThread = (): Thread => ({
  id: THREAD_ID,
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [{ id: CRITERION_ID, ordinal: 1, text: 'ship it', done: false, kind: 'planned', struck_by: null }],
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    last_session: 'read the spec',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z'
})

const threadWithRiskRef = (ref: string): Thread => {
  const thread = baseThread()
  return {
    ...thread,
    spine: { ...thread.spine, open_risks: [{ id: RISK_ID, scope: 'ship it', text: 'a risk', refs: [ref] }] }
  }
}

const baseDecision = (): Decision => ({
  id: DECISION_ID,
  thread_id: THREAD_ID,
  title: 'a decision',
  context: 'the context',
  options: ['one', 'two'],
  outcome: 'the outcome',
  commit: A_REAL_SHA,
  supersedes: [],
  created_at: '2026-08-28T00:00:00.000Z'
})

const baseBinding = (branch: string): Binding => ({
  id: ARTIFACT_ID,
  thread_id: THREAD_ID,
  branch,
  created_at: '2026-08-28T00:00:00.000Z'
})

for (const [label, value] of CONTENT_NOT_POINTER) {
  test(`git-boundary.a-risk-ref-carrying-${label}-is-refused`, () => {
    const result = ThreadRecord.parse(threadWithRiskRef(value))
    assert.equal(result.ok, false, `a risk ref carrying ${label} must be refused`)
    if (result.ok) return
    assert.equal(result.field, 'spine.open_risks.0.refs.0')
    assert.equal(result.retryable, true)
    assert.match(result.message, /remedy: /)
  })
}

test('git-boundary.a-risk-ref-that-is-an-address-is-accepted', () => {
  const result = ThreadRecord.parse(threadWithRiskRef('docs/specs/2026-08-28-continuity-goal-model.md#L120'))
  assert.equal(result.ok, true, 'an ordinary path-and-anchor pointer must be accepted')
  if (!result.ok) return
  assert.equal(result.value.spine.open_risks[0]?.refs[0], 'docs/specs/2026-08-28-continuity-goal-model.md#L120')
})

test('git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused', () => {
  const result = ThreadRecord.parse({
    ...baseThread(),
    artifacts: [{ id: ARTIFACT_ID, label: 'the plan', pointer: 'see ```ts' }]
  })
  assert.equal(result.ok, false, 'an artifact pointer carrying a code fence must be refused')
  if (result.ok) return
  assert.equal(result.field, 'artifacts.0.pointer')
})

test('git-boundary.a-decision-commit-that-is-not-a-sha-is-refused', () => {
  const result = DecisionRecord.parse({ ...baseDecision(), commit: 'e5f0195' })
  assert.equal(result.ok, false, 'a short sha must be refused; the stored field is a full object id')
  if (result.ok) return
  assert.equal(result.field, 'commit')
  assert.equal(result.retryable, true)
  assert.match(result.example, /^[0-9a-f]{40}$/)
})

test('git-boundary.a-decision-commit-carrying-a-diff-hunk-marker-is-refused', () => {
  const result = DecisionRecord.parse({ ...baseDecision(), commit: '@@ -1,2 +1,2 @@' })
  assert.equal(result.ok, false, 'a commit field carrying diff content must be refused')
  if (result.ok) return
  assert.equal(result.field, 'commit')
})

test('git-boundary.a-decision-commit-that-is-a-sha-or-null-is-accepted', () => {
  assert.equal(DecisionRecord.parse(baseDecision()).ok, true, 'a forty-character object id must be accepted')
  assert.equal(
    DecisionRecord.parse({ ...baseDecision(), commit: null }).ok,
    true,
    'a null commit must stay acceptable; it is what an unreadable HEAD stores'
  )
  assert.equal(
    DecisionRecord.parse({ ...baseDecision(), commit: 'a'.repeat(64) }).ok,
    true,
    'a sixty-four-character object id must be accepted'
  )
  assert.equal(caps.DECISION_COMMIT_MAX, 64)
})

test('git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema', () => {
  const result = BindingRecord.parse(baseBinding('feat/x\nrm -rf /'))
  assert.equal(result.ok, false, 'a binding branch carrying a line break must be refused')
  if (result.ok) return
  assert.equal(result.field, 'branch')
})

test('git-boundary.a-binding-branch-that-is-an-ordinary-branch-name-is-accepted', () => {
  assert.equal(BindingRecord.parse(baseBinding('feat/u1-schema-foundations')).ok, true)
})
```

### 5.3 `test/unit/caps-census.test.ts` — CREATE

Discharges acceptance criteria 4 and 5, and SPEC invariant `A1` and rule `B6`.

Two censuses. The first classifies every exported name of `src/schema/caps.ts` into a closed set of
four roles and halts on a name it cannot place, so adding a cap without classifying it turns the
suite red. The second enumerates every field in the four record schemas carrying a length or element
bound, drives a value one over that bound through the record's own parser, and asserts the refusal
names the field, the limit, the observed value and a remedy.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { census, type Classified } from '../support/census.ts'
import { synthesise, type JsonSchemaNode } from '../../src/schema/example.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import * as caps from '../../src/schema/caps.ts'

type CapRole = 'record-field' | 'call-payload' | 'record-bytes' | 'refusal-display'

const CAP_ROLES: Record<string, CapRole> = {
  THREAD_TITLE_MAX: 'record-field',
  THREAD_SLUG_MAX: 'record-field',
  THREAD_BLOCKED_BY_MAX: 'record-field',
  THREAD_CLOSURE_DETAIL_MAX: 'call-payload',
  BINDING_BRANCH_MAX: 'record-field',
  SPINE_ACTIVE_GOAL_MAX: 'record-field',
  SPINE_NEXT_STEP_MAX: 'record-field',
  SPINE_LAST_SESSION_MAX: 'record-field',
  CRITERIA_MAX_ELEMENTS: 'call-payload',
  OPEN_RISKS_MAX_ELEMENTS: 'call-payload',
  CRITERIA_RETENTION_MAX_ELEMENTS: 'record-field',
  CRITERION_TEXT_MAX: 'record-field',
  CRITERION_CHECK_MAX: 'record-field',
  CRITERION_RESULT_MAX: 'record-field',
  RISK_TEXT_MAX: 'record-field',
  RISK_SCOPE_MAX: 'record-field',
  RISK_REFS_MAX_ELEMENTS: 'record-field',
  RISK_REF_MAX: 'record-field',
  KEY_DECISIONS_MAX_ELEMENTS: 'record-field',
  KEY_DECISION_TITLE_MAX: 'record-field',
  KEY_DECISION_SCOPE_MAX: 'record-field',
  OUT_OF_SCOPE_MAX_ELEMENTS: 'record-field',
  OUT_OF_SCOPE_TEXT_MAX: 'record-field',
  ARTIFACT_LABEL_MAX: 'record-field',
  ARTIFACT_POINTER_MAX: 'record-field',
  DECISION_TITLE_MAX: 'record-field',
  DECISION_CONTEXT_MAX: 'record-field',
  DECISION_OUTCOME_MAX: 'record-field',
  DECISION_OPTIONS_MAX_ELEMENTS: 'record-field',
  DECISION_OPTION_MAX: 'record-field',
  DECISION_SUPERSEDES_MAX_ELEMENTS: 'record-field',
  DECISION_COMMIT_MAX: 'record-field',
  SESSION_ACTOR_MAX: 'record-field',
  SESSION_BODY_MAX: 'record-field',
  THREAD_RECORD_SERIALISED_MAX_BYTES: 'record-bytes',
  UNRECOGNIZED_KEYS_SHOWN_MAX: 'refusal-display',
  UNRECOGNIZED_KEY_NAME_MAX: 'refusal-display'
}

export const classifyCapConstant = (name: string): Classified<string>['verdict'] | 'unclassifiable' =>
  CAP_ROLES[name] === undefined ? 'unclassifiable' : 'allowed'

test('caps-census.every-cap-constant-declares-the-role-it-plays', () => {
  const names = Object.keys(caps)
  assert.ok(
    names.length > 0,
    'caps-census: src/schema/caps.ts exported nothing; a census over an empty list proves nothing'
  )
  assert.doesNotThrow(() => census(names, classifyCapConstant))
  for (const declaredName of Object.keys(CAP_ROLES)) {
    assert.ok(
      names.includes(declaredName),
      `caps-census: CAP_ROLES names ${declaredName}, which src/schema/caps.ts no longer exports`
    )
  }
})

test('caps-census.control.an-unclassified-cap-halts-the-census', () => {
  assert.equal(classifyCapConstant('A_BRAND_NEW_MAX'), 'unclassifiable')
  assert.equal(classifyCapConstant('THREAD_TITLE_MAX'), 'allowed')
})

type CappedNode = {
  record: Declared<unknown>
  path: (string | number)[]
  label: string
  limit: number
  kind: 'string' | 'array'
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const collectCappedNodes = (record: Declared<unknown>): CappedNode[] => {
  const found: CappedNode[] = []
  const visit = (raw: unknown, path: (string | number)[]): void => {
    if (!isPlainObject(raw)) return
    const members = Array.isArray(raw.anyOf) ? raw.anyOf : [raw]
    for (const member of members) {
      if (!isPlainObject(member)) continue
      const merged = { ...raw, ...member }
      const label = `${record.name}.${path.join('.')}`
      if (typeof merged.maxLength === 'number') {
        found.push({ record, path, label, limit: merged.maxLength, kind: 'string' })
      }
      if (typeof merged.maxItems === 'number') {
        found.push({ record, path, label, limit: merged.maxItems, kind: 'array' })
      }
      if (isPlainObject(merged.properties)) {
        for (const [key, child] of Object.entries(merged.properties)) visit(child, [...path, key])
      }
      if (merged.items !== undefined) visit(merged.items, [...path, 0])
    }
  }
  visit(record.jsonSchema, [])
  return found
}

const nodeAt = (root: JsonSchemaNode, path: (string | number)[]): JsonSchemaNode => {
  let cursor: JsonSchemaNode = root
  for (const segment of path) {
    const members = Array.isArray(cursor.anyOf) ? (cursor.anyOf as unknown[]) : [cursor]
    const merged = members.filter(isPlainObject).reduce<Record<string, unknown>>((acc, m) => ({ ...acc, ...m }), {})
    const next =
      typeof segment === 'number'
        ? merged.items
        : isPlainObject(merged.properties)
          ? (merged.properties as Record<string, unknown>)[segment]
          : undefined
    if (!isPlainObject(next)) return cursor
    cursor = next
  }
  return cursor
}

const setAtPath = (
  root: JsonSchemaNode,
  base: unknown,
  path: (string | number)[],
  walked: (string | number)[],
  value: unknown
): unknown => {
  if (path.length === 0) return value
  const [head, ...rest] = path as [string | number, ...(string | number)[]]
  const here = [...walked, head]
  if (typeof head === 'number') {
    const list = Array.isArray(base) ? [...base] : []
    const seeded = list[head] ?? synthesise(root, nodeAt(root, here))
    list[head] = setAtPath(root, seeded, rest, here, value)
    return list
  }
  const object = isPlainObject(base) ? { ...base } : {}
  const seeded = object[head] ?? synthesise(root, nodeAt(root, here))
  object[head] = setAtPath(root, seeded, rest, here, value)
  return object
}

const overCapValue = (root: JsonSchemaNode, node: CappedNode): unknown => {
  if (node.kind === 'string') return 'x'.repeat(node.limit + 1)
  return Array.from({ length: node.limit + 1 }, () => synthesise(root, nodeAt(root, [...node.path, 0])))
}

const RECORDS: Declared<unknown>[] = [
  ThreadRecord as unknown as Declared<unknown>,
  DecisionRecord as unknown as Declared<unknown>,
  SessionRecord as unknown as Declared<unknown>,
  BindingRecord as unknown as Declared<unknown>
]

test('caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy', () => {
  const nodes = RECORDS.flatMap(collectCappedNodes)
  assert.ok(
    nodes.length > 0,
    'caps-census: no capped record field was discovered; a census over an empty list proves nothing'
  )

  for (const node of nodes) {
    const root = node.record.jsonSchema as JsonSchemaNode
    const candidate = setAtPath(root, synthesise(root, root), node.path, [], overCapValue(root, node))
    const parsed = node.record.parse(candidate)

    assert.equal(parsed.ok, false, `caps-census: ${node.label} accepted a value one over its cap of ${node.limit}`)
    if (parsed.ok) continue
    assert.equal(parsed.field, node.path.join('.'), `caps-census: ${node.label} refused but named field ${parsed.field}`)
    assert.match(parsed.message, new RegExp(String(node.limit)), `caps-census: ${node.label} refusal omits its limit`)
    assert.match(
      parsed.message,
      /observed \d+ (characters|entries)/,
      `caps-census: ${node.label} refusal omits the observed value`
    )
    assert.match(parsed.message, /remedy: /, `caps-census: ${node.label} refusal omits a remedy`)
    assert.equal(parsed.retryable, true, `caps-census: ${node.label} refusal must be retryable`)
  }
})
```

### 5.4 `test/unit/goal-model-fields.test.ts` — CREATE

Discharges acceptance criteria 7, 8, 9 and 12, and SPEC rules `B2`, `B3` and `B7`.

The last test is the one that pins the `Criterion.kind` reader the `B7` census found. It is the
receipt for retaining the field: delete `kind: item.kind` from `criterionContent`
(`src/merge/field-merge.ts:151`) and this test goes red.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { mergeThread } from '../../src/merge/field-merge.ts'

const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ'
const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const ARTIFACT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0'

const legacyThreadShape = (): Record<string, unknown> => ({
  id: THREAD_ID,
  slug: 'a-legacy-thread',
  title: 'a thread written before this change',
  status: 'open',
  blocked_by: null,
  completion_criteria: [{ id: CRITERION_ID, ordinal: 1, text: 'ship it', done: false, kind: 'planned', struck_by: null }],
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    last_session: 'read the spec',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z'
})

test('goal-model.parsing-adds-no-bytes-to-a-record-written-before-this-change', () => {
  const shape = legacyThreadShape()
  const before = Buffer.byteLength(JSON.stringify(shape), 'utf8')
  const result = ThreadRecord.parse(shape)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(
    Buffer.byteLength(JSON.stringify(result.value), 'utf8'),
    before,
    'parsing must not grow a stored record; a record at the byte cap would otherwise become unwritable'
  )
})

test('goal-model.a-record-written-before-this-change-still-parses', () => {
  const result = ThreadRecord.parse(legacyThreadShape())
  assert.equal(result.ok, true, 'a stored record carrying none of the new fields must still parse')
  if (!result.ok) return
  assert.equal(result.value.artifacts, undefined)
  assert.equal(result.value.completion_criteria[0]?.check, undefined)
  assert.equal(result.value.completion_criteria[0]?.result, undefined)
  assert.equal(result.value.completion_criteria[0]?.result_status, undefined)
})

test('goal-model.a-criterion-carrying-check-result-and-status-round-trips', () => {
  const shape = legacyThreadShape()
  const criteria = shape.completion_criteria as Record<string, unknown>[]
  criteria[0] = {
    ...criteria[0],
    check: 'npm test exits 0',
    result: '436 tests, 0 fail, exit 0',
    result_status: 'verified'
  }
  const result = ThreadRecord.parse(shape)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.completion_criteria[0]?.check, 'npm test exits 0')
  assert.equal(result.value.completion_criteria[0]?.result, '436 tests, 0 fail, exit 0')
  assert.equal(result.value.completion_criteria[0]?.result_status, 'verified')
})

test('goal-model.result-status-accepts-only-the-two-recorded-states', () => {
  const shape = legacyThreadShape()
  const criteria = shape.completion_criteria as Record<string, unknown>[]
  criteria[0] = { ...criteria[0], result_status: 'probably-fine' }
  const result = ThreadRecord.parse(shape)
  assert.equal(result.ok, false, 'a result_status outside the two recorded states must be refused')
  if (result.ok) return
  assert.equal(result.field, 'completion_criteria.0.result_status')
})

test('goal-model.a-thread-carrying-artifacts-round-trips', () => {
  const result = ThreadRecord.parse({
    ...legacyThreadShape(),
    artifacts: [{ id: ARTIFACT_ID, label: 'the implementation plan', pointer: 'docs/plans/a-plan.md' }]
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.artifacts?.[0]?.label, 'the implementation plan')
  assert.equal(result.value.artifacts?.[0]?.pointer, 'docs/plans/a-plan.md')
})

const parsedThread = (): Thread => {
  const result = ThreadRecord.parse(legacyThreadShape())
  if (!result.ok) throw new Error(`goal-model fixture: the base thread failed to parse: ${result.message}`)
  return result.value
}

test('goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts', () => {
  const ours = parsedThread()
  const theirs: Thread = {
    ...ours,
    completion_criteria: ours.completion_criteria.map((criterion) => ({ ...criterion, kind: 'detour' }))
  }
  assert.equal(ours.completion_criteria[0]?.kind, 'planned')
  assert.equal(theirs.completion_criteria[0]?.kind, 'detour')
  assert.equal(
    isDeepStrictEqual(ours.completion_criteria, theirs.completion_criteria),
    false,
    'the fixture must differ in kind alone'
  )

  const merged = mergeThread(null, ours, theirs)
  assert.equal(merged.ok, false, 'two copies of one criterion differing only in kind must conflict, never silently pick one')
  if (merged.ok) return
  assert.equal(merged.conflicts.length, 1)
  assert.equal(merged.conflicts[0]?.field, `completion_criteria[${CRITERION_ID}]`)
})
```

### 5.5 `test/contract/spawn-allowlist.test.ts` — CREATE

Discharges acceptance criterion 6, and SPEC rule `B42` and invariant `S2`.

The population is every file under `src`, `hooks`, `bin` and `scripts`, walked with no extension
filter. A file whose extension is not in either the module list or the non-module list halts the
census, so a new file type must be classified deliberately rather than silently skipped. A file on
the allowlist that no longer spawns also halts, so a stale allowlist entry cannot sit there
unnoticed.

The allowlist has three members, established by census over the real tree: `src/store/git.ts`,
`scripts/install-githooks.mjs` and `scripts/d6-check.cjs`. Files are read as `latin1` so that
`src/server/tools/resolve_conflict.ts`, which contains a non-UTF-8 byte, is read rather than skipped.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CENSUSED_ROOTS = ['src', 'hooks', 'bin', 'scripts'] as const

const MODULE_EXTENSIONS = ['.ts', '.mjs', '.cjs', '.js'] as const
const NON_MODULE_EXTENSIONS = ['.json', '.sh', '.md', '.yml', '.yaml', ''] as const

const SPAWN_TOKENS = [
  'child_process',
  'execFileSync',
  'execFile',
  'execSync',
  'spawnSync',
  'spawn(',
  'fork(',
  'worker_threads'
] as const

const SPAWN_ALLOWLIST = ['src/store/git.ts', 'scripts/install-githooks.mjs', 'scripts/d6-check.cjs'] as const

const RECORD_TYPE_MODULES = ['schema/thread', 'schema/decision', 'schema/session', 'schema/binding'] as const

type SourceFile = { relPath: string; extension: string; text: string }

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!entry.isFile()) return []
    return [full]
  })

const collectSourceFiles = (): SourceFile[] =>
  CENSUSED_ROOTS.flatMap((root) =>
    walk(path.join(PROJECT_ROOT, root)).map((full) => {
      const relPath = path.relative(PROJECT_ROOT, full).split(path.sep).join('/')
      return { relPath, extension: path.extname(relPath), text: readFileSync(full, 'latin1') }
    })
  )

const spawns = (file: SourceFile): boolean => SPAWN_TOKENS.some((token) => file.text.includes(token))

const importsARecordType = (file: SourceFile): boolean =>
  RECORD_TYPE_MODULES.some((module) => file.text.includes(module))

export const classifySpawnSite = (file: SourceFile): Classified<SourceFile>['verdict'] | 'unclassifiable' => {
  const allowlisted = (SPAWN_ALLOWLIST as readonly string[]).includes(file.relPath)
  if ((NON_MODULE_EXTENSIONS as readonly string[]).includes(file.extension)) {
    return allowlisted ? 'unclassifiable' : 'allowed'
  }
  if (!(MODULE_EXTENSIONS as readonly string[]).includes(file.extension)) return 'unclassifiable'
  if (!spawns(file)) return allowlisted ? 'unclassifiable' : 'allowed'
  if (!allowlisted) return 'forbidden'
  return importsARecordType(file) ? 'forbidden' : 'allowed'
}

test('spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type', () => {
  const files = collectSourceFiles()
  assert.ok(files.length > 0, 'spawn-allowlist: the censused roots yielded no files; a census over an empty list proves nothing')

  const spawners = files.filter((file) => spawns(file)).map((file) => file.relPath).sort()
  assert.deepEqual(
    spawners,
    [...SPAWN_ALLOWLIST].sort(),
    'spawn-allowlist: the set of modules that spawn a process must equal the allowlist exactly'
  )

  assert.doesNotThrow(() => census(files, classifySpawnSite))
})

test('spawn-allowlist.control.an-unlisted-spawner-and-a-tainted-allowlisted-module-are-forbidden', () => {
  assert.equal(
    classifySpawnSite({
      relPath: 'src/probe/unlisted.ts',
      extension: '.ts',
      text: "import { execFileSync } from 'node:child_process'\n"
    }),
    'forbidden'
  )
  assert.equal(
    classifySpawnSite({
      relPath: 'src/store/git.ts',
      extension: '.ts',
      text: "import { execFileSync } from 'node:child_process'\nimport type { Thread } from '../schema/thread.ts'\n"
    }),
    'forbidden'
  )
  assert.equal(
    classifySpawnSite({
      relPath: 'src/store/git.ts',
      extension: '.ts',
      text: "import { execFileSync } from 'node:child_process'\n"
    }),
    'allowed'
  )
  assert.equal(
    classifySpawnSite({ relPath: 'scripts/d6-check.cjs', extension: '.cjs', text: 'const x = 1\n' }),
    'unclassifiable'
  )
  assert.equal(
    classifySpawnSite({ relPath: 'src/probe/thing.py', extension: '.py', text: 'import os\n' }),
    'unclassifiable'
  )
  assert.equal(
    classifySpawnSite({ relPath: 'src/schema/caps.ts', extension: '.ts', text: 'export const A = 1\n' }),
    'allowed'
  )
})
```

### 5.6 Which test discharges which criterion and invariant

| Acceptance criterion | Test that discharges it |
|---|---|
| 1 — every field declares a class | `field-class.every-record-field-declares-a-class`, `field-class.an-array-and-its-element-declare-the-same-class` |
| 2 — a pointer field refuses content | `git-boundary.a-risk-ref-carrying-a-line-break-is-refused`, `…-a-code-fence-is-refused`, `…-a-diff-hunk-marker-is-refused`, `git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused` |
| 3 — `Decision.commit` | `git-boundary.a-decision-commit-that-is-not-a-sha-is-refused`, `…-carrying-a-diff-hunk-marker-is-refused`, `…-that-is-a-sha-or-null-is-accepted` |
| 4 — capped-field refusals are complete | `caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy` |
| 5 — every cap declares its role | `caps-census.every-cap-constant-declares-the-role-it-plays` |
| 6 — the spawn allowlist | `spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type` |
| 7 — criterion check, result, status | `goal-model.a-record-written-before-this-change-still-parses`, `goal-model.a-criterion-carrying-check-result-and-status-round-trips`, `goal-model.result-status-accepts-only-the-two-recorded-states` |
| 8 — thread artifacts | `goal-model.a-thread-carrying-artifacts-round-trips`, `git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused` |
| 9 — parsing adds no bytes | `goal-model.parsing-adds-no-bytes-to-a-record-written-before-this-change` |
| 10 — open risks accumulate | `caps.open-risks-accumulate-past-the-old-element-cap`, `caps.key-decisions-still-refuse-on-their-element-cap` |
| 11 — the write-time size bound | `whole-record-cap.refusal-names-the-largest-field-and-the-observed-bytes` (already shipped, `test/store/whole-record-cap.test.ts:68`); the sizing itself is recorded in section 3.4 |
| 12 — `Criterion.kind` is read | `goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts` |
| 13 — `Risk.refs` retained, class pointer | `field-class.every-declared-pointer-carries-the-pointer-pattern`, plus the three `git-boundary` ref tests |
| 14 — a skipped spine link is reported | `decision.records-the-decision-and-reports-the-skipped-link-at-the-byte-cap` (already shipped, `test/spawn/decisions.test.ts:454`) |
| 15 — live store parses, suite green | section 8 |

| SPEC invariant | Test that discharges it |
|---|---|
| `A1` | `caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy` |
| `A5` | the three `git-boundary` risk-ref tests, plus `git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused` and `git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema` |
| `A7` | already shipped as `decision.records-the-decision-and-reports-the-skipped-link-at-the-byte-cap` (`test/spawn/decisions.test.ts:454`, asserting at `:516-517`); SPEC section 6.1 rule 5 says an invariant that duplicates a shipped test is not restated, so this unit adds no second test for it |
| `S2` | `spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type` |
| `A2` (`U1` share) | no test is added. `A2` governs id-valued tool arguments, which live in the tool layer; the schema share of it is `criterion_id` being declared as a ULID-patterned field, already asserted by the three shipped tests in `test/unit/thread-schema-criterion-id.test.ts`. Section 3.1 records why. |

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time. At authoring time that was `e5f0195`;
by the time this unit is cut it will also contain `U0` and the documentation merge, neither of which
touches `src/`, `test/`, `hooks/`, `bin/` or `scripts/`. Confirm the parent before starting:

```
git rev-parse --short HEAD
```

Expected exit code: **0**. Expected output: one short sha. It must equal the tip of `main` that this
branch was cut from — confirm with `git rev-parse --short main`, which must print the same value. A
different value means the branch carries work this plan did not measure against.

Every result below was measured by copying the new test files onto an unmodified parent tree and
running them there. Three of the five new files reach a genuine red; one cannot be run at the parent
at all; one is green at the parent and is disclosed as such.

### 6.1 `test/unit/caps-census.test.ts` — RED at the parent

```
node --test --experimental-strip-types test/unit/caps-census.test.ts
```

Exit code 1. Two of three tests fail, with these exact messages:

```
✖ caps-census.every-cap-constant-declares-the-role-it-plays
  AssertionError [ERR_ASSERTION]: caps-census: CAP_ROLES names CRITERION_CHECK_MAX, which src/schema/caps.ts no longer exports
✖ caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy
  AssertionError [ERR_ASSERTION]: caps-census: thread.slug refusal omits the observed value
```

`caps-census.control.an-unclassified-cap-halts-the-census` passes at the parent, as a control must.

This is the receipt for acceptance criteria 4 and 5, and for SPEC invariant `A1`.

### 6.2 `test/unit/git-boundary.test.ts` — RED at the parent

```
node --test --experimental-strip-types test/unit/git-boundary.test.ts
```

Exit code 1. Eight of ten tests fail:

```
✖ git-boundary.a-risk-ref-carrying-a-line-break-is-refused
✖ git-boundary.a-risk-ref-carrying-a-code-fence-is-refused
✖ git-boundary.a-risk-ref-carrying-a-diff-hunk-marker-is-refused
✖ git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused
✖ git-boundary.a-decision-commit-that-is-not-a-sha-is-refused
✖ git-boundary.a-decision-commit-carrying-a-diff-hunk-marker-is-refused
✖ git-boundary.a-decision-commit-that-is-a-sha-or-null-is-accepted
✖ git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema
```

The first six fail because the record schemas accept the value that must be refused; the seventh
fails because `caps.DECISION_COMMIT_MAX` is `undefined` at the parent. Two tests pass at the parent,
correctly: `a-risk-ref-that-is-an-address-is-accepted` and
`a-binding-branch-that-is-an-ordinary-branch-name-is-accepted` are the positive controls, and a
positive control that was red before the change would be testing the wrong thing.

This is the receipt for acceptance criteria 2, 3 and 8, and for SPEC invariant `A5`.

### 6.3 `test/unit/goal-model-fields.test.ts` — RED at the parent

```
node --test --experimental-strip-types test/unit/goal-model-fields.test.ts
```

Exit code 1. Three of six tests fail:

```
✖ goal-model.a-criterion-carrying-check-result-and-status-round-trips
✖ goal-model.result-status-accepts-only-the-two-recorded-states
✖ goal-model.a-thread-carrying-artifacts-round-trips
```

Three pass at the parent, and each is passing for a stated reason rather than by accident:

- `goal-model.parsing-adds-no-bytes-to-a-record-written-before-this-change` — true at the parent
  because there is nothing yet that could add bytes. It is a guard against a regression this change
  could introduce, not a receipt for the change. **No red-on-parent receipt exists for acceptance
  criterion 9, and none is manufactured.** Honesty-ladder status for the red-on-parent obligation on
  criterion 9: **`unverified-reasoned`** — the specific reason is that the property already holds at
  the parent and reaching a red would mean adding a `.default(...)` to the parent, which is the
  defect the criterion exists to prevent. Its proof is the inertness mutation in section 7.6.
- `goal-model.a-record-written-before-this-change-still-parses` — the `P3` guard. It must be green on
  both sides; that is its whole point.
- `goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts` — the `B7` census
  outcome is **retain**, so there is no behaviour change and no red to reach. **No red-on-parent
  receipt exists for acceptance criterion 12, and none is manufactured.** Honesty-ladder status for
  the red-on-parent obligation on criterion 12: **`unverified-reasoned`** — the specific reason is
  that the census outcome was to keep the field and its reader exactly as they are, so this unit
  changes no behaviour here and only pins what already holds. Its proof is the inertness mutation in
  section 7.3, which was run and does turn it red.

This is the receipt for acceptance criterion 7.

### 6.4 `test/unit/field-class.test.ts` — CANNOT be run at the parent

It imports `src/schema/field-class.ts`, which does not exist at the parent. Running it there gives:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>/src/schema/field-class.ts'
  imported from '<repo>/test/unit/field-class.test.ts'
```

**Substitute procedure.** Apply step 5 alone — create `src/schema/field-class.ts` and nothing else —
then run:

```
node --test --experimental-strip-types test/unit/field-class.test.ts
```

Exit code 1. `field-class.every-record-field-declares-a-class` fails, because no record schema
declares a class yet, with a message of this shape:

```
AssertionError [ERR_ASSERTION]: Missing expected exception.
  actual: Error: census rejected a forbidden item: {"path":"thread.id","value":{"type":"string","pattern":"^[0-9A-HJKMNP-TV-Z]{26}$","description":"the thread identity, a ULID"}}
```

The exact `path` named first depends on property order; the assertion that must hold is that the
census throws `census rejected a forbidden item` naming a node with no `class` key. Then revert step
5 and apply the full change in order.

This is the receipt for acceptance criteria 1 and 13.

### 6.5 `test/unit/caps.test.ts` — RED at the parent, after step 15 edit 1 alone

This file already exists at the parent, so its red is reached by applying **step 15 edit 1 and
nothing else** — replacing `caps.assert-contribution` with
`caps.open-risks-accumulate-past-the-old-element-cap` — and then running:

```
node --test --experimental-strip-types test/unit/caps.test.ts
```

Exit code 1. One of eight tests fails:

```
✖ caps.open-risks-accumulate-past-the-old-element-cap
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
```

The assertion that fails is `assert.equal(acceptResult.ok, true)`, because at the parent
`contributeToSpine` still refuses the 41st risk. The other seven tests in the file pass at the
parent, and must.

Then apply the rest of the change in order. This is the receipt for acceptance criterion 10.

### 6.6 `test/contract/spawn-allowlist.test.ts` — GREEN at the parent; disclosed, not hidden

```
node --test --experimental-strip-types test/contract/spawn-allowlist.test.ts
```

Exit code 0. Both tests pass at the parent.

**No red-on-parent receipt exists for acceptance criterion 6, and none is manufactured.** `S2` is a
drift guard: the property it asserts — that only three modules spawn a process and none of them
imports a record type — is already true of the tree. Reaching a red would mean introducing a
violation into the parent commit, which is not a receipt, it is vandalism.

Honesty-ladder status for the red-on-parent obligation on criterion 6: **`unverified-reasoned`**.
The specific reason is that the invariant holds at the parent, so the change is the addition of the
check itself rather than a change in behaviour. The check is proved live by the inertness mutation
in section 7.4, which was run and does turn it red. That mutation, not a red at the parent, is what
shows the census is not inert.

---

## 7. Inertness mutation

One per acceptance criterion that carries a behavioural change. Each mutation below was applied to a
working tree carrying the full change, run, and reverted. The results are what was observed, not
what was expected.

### 7.1 Criteria 2, 8, 13 and `A5` — remove the pointer pattern

Edit `src/schema/field-class.ts`. FIND:

```ts
  z.string().max(max).regex(POINTER_PATTERN).describe(description).meta({ class: 'pointer' })
```

REPLACE with:

```ts
  z.string().max(max).describe(description).meta({ class: 'pointer' })
```

Run:

```
node --test --experimental-strip-types test/unit/git-boundary.test.ts test/unit/field-class.test.ts
```

Observed: exit code 1, six tests red —
`field-class.every-declared-pointer-carries-the-pointer-pattern`,
`git-boundary.a-risk-ref-carrying-a-line-break-is-refused`,
`git-boundary.a-risk-ref-carrying-a-code-fence-is-refused`,
`git-boundary.a-risk-ref-carrying-a-diff-hunk-marker-is-refused`,
`git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused`,
`git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema`.

The two positive controls stay green under this mutation — `a-risk-ref-that-is-an-address-is-accepted`
and `a-binding-branch-that-is-an-ordinary-branch-name-is-accepted` — and so do the three
`a-decision-commit-*` tests, because the commit field carries its own sha pattern and does not depend
on the pointer pattern. That is what makes this mutation targeted rather than a blast.

Restore: put the `.regex(POINTER_PATTERN)` call back. Re-running the same command gives 15 passing,
0 failing.

### 7.2 Criterion 3 — remove the sha pattern from the commit field

Edit `src/schema/decision.ts`. FIND:

```ts
    .max(caps.DECISION_COMMIT_MAX)
    .regex(SHA_PATTERN)
```

REPLACE with:

```ts
    .max(caps.DECISION_COMMIT_MAX)
```

Run:

```
node --test --experimental-strip-types test/unit/git-boundary.test.ts
```

Expect exit code 1 with `git-boundary.a-decision-commit-that-is-not-a-sha-is-refused` red, because
`e5f0195` is then accepted. Restore by putting the `.regex(SHA_PATTERN)` call back.

### 7.3 Criterion 12 and `B7` — remove the `kind` read from the merge

Edit `src/merge/field-merge.ts`. Two FIND/REPLACE pairs.

FIND:

```ts
type CriterionContent = Pick<Criterion, 'text' | 'done' | 'kind' | 'struck_by'>
```

REPLACE with:

```ts
type CriterionContent = Pick<Criterion, 'text' | 'done' | 'struck_by'>
```

FIND:

```ts
  done: item.done,
  kind: item.kind,
```

REPLACE with:

```ts
  done: item.done,
```

Run:

```
node --test --experimental-strip-types test/unit/goal-model-fields.test.ts
```

Observed: exit code 1, exactly one test red —
`goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts`. The other five stay
green, which is what makes this a targeted receipt rather than a blast.

Restore: put both lines back. Re-running gives 6 passing, 0 failing.

This is the mutation that makes the `B7` census outcome durable. Without it, the one reader that
justified retaining `Criterion.kind` could be deleted tomorrow and nothing would notice.

### 7.4 Criterion 6, `B42` and `S2` — plant an unlisted spawner

Create `src/probe/unlisted-spawner.ts` with exactly:

```ts
import { execFileSync } from 'node:child_process'
export const run = () => execFileSync('git', ['status'])
```

Run:

```
node --test --experimental-strip-types test/contract/spawn-allowlist.test.ts
```

Observed: exit code 1, with

```
✖ spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type
  AssertionError [ERR_ASSERTION]: spawn-allowlist: the set of modules that spawn a process must equal the allowlist exactly
```

Restore: `rm -rf src/probe`. Re-running gives 2 passing, 0 failing.

### 7.5 Criteria 4 and 5 and `A1` — remove the observed value from the refusal

Edit `src/schema/refusal.ts`. FIND:

```ts
  const observedClause = observed === null ? '' : `observed ${observed}; `
```

REPLACE with:

```ts
  const observedClause = ''
```

Run:

```
node --test --experimental-strip-types test/unit/caps-census.test.ts
```

Expect exit code 1 with
`caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy` red on
`caps-census: thread.slug refusal omits the observed value` — the same message the parent produces
in section 6.1. Restore the line.

### 7.6 Criteria 7 and 9 — make a new field required

Edit `src/schema/thread.ts`. FIND:

```ts
        .nullable()
        .optional()
        .describe('the re-runnable check that decides whether this criterion is true, absent when none is recorded')
```

REPLACE with:

```ts
        .nullable()
        .describe('the re-runnable check that decides whether this criterion is true, absent when none is recorded')
```

Run:

```
node --test --experimental-strip-types test/unit/goal-model-fields.test.ts
```

Expect exit code 1 with `goal-model.a-record-written-before-this-change-still-parses` red, because a
stored record carrying no `check` key no longer parses. Restore the `.optional()` call.

### 7.7 Criterion 10 — put the open-risks element cap back

Edit `src/domain/spine.ts`. FIND:

```ts
  open_risks: null,
```

REPLACE with:

```ts
  open_risks: caps.OPEN_RISKS_MAX_ELEMENTS,
```

Run:

```
node --test --experimental-strip-types test/unit/caps.test.ts
```

Expect exit code 1 with `caps.open-risks-accumulate-past-the-old-element-cap` red. Restore `null`.

### 7.8 Criterion 1 — drop a class declaration

Edit `src/schema/session.ts`. FIND:

```ts
  body: content(z.string().max(caps.SESSION_BODY_MAX).describe('the session entry text')),
```

REPLACE with:

```ts
  body: z.string().max(caps.SESSION_BODY_MAX).describe('the session entry text'),
```

Run:

```
node --test --experimental-strip-types test/unit/field-class.test.ts
```

Expect exit code 1 with `field-class.every-record-field-declares-a-class` red on
`census rejected a forbidden item` naming `session.body`. Restore the `content(...)` wrapper.

Three criteria carry no mutation of their own, each for a stated reason.

**Criterion 11.** The bound it names is unchanged at 65536; what this unit contributes is the
measurement and the arithmetic in section 3.4, plus criterion 9's guard that parsing cannot silently
consume the headroom. Criterion 9's mutation is 7.6.

**Criterion 14.** `A7` is discharged by a shipped test this unit does not modify, so there is nothing
this change added that could be reverted.

**Criterion 15.** It asserts that the change breaks nothing that already exists — every live record
still parses and the suite is green. A criterion of that shape has no thing-that-was-added to empty
out. Its guard is mutation 7.6: making one new field required turns
`goal-model.a-record-written-before-this-change-still-parses` red, which is the same property
criterion 15 asserts, checked against a synthetic legacy record rather than against the store. The
store-wide check itself is section 8.5.

---

## 8. Full verification

Run these in order, from the repository root, on the unit branch with every step of section 4
applied.

**Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository; an install
rewrites tracked files and leaves the suite red. There is nothing to install.

### 8.1 Typecheck

```
npm run typecheck
```

Expected exit code: **0**. Expected output: nothing on stdout. Any diagnostic line at all is a
failure; `tsc -p tsconfig.json --noEmit` prints only errors.

### 8.2 Packaging

```
node scripts/check-packaging.mjs
```

Expected exit code: **0**. Expected output: no line containing `version mismatch` and no line
containing `must be a plain semver`. This is what proves step 1 moved both manifests to the same
value.

### 8.3 The new tests alone

```
node --test --experimental-strip-types test/unit/field-class.test.ts test/unit/git-boundary.test.ts test/unit/caps-census.test.ts test/unit/goal-model-fields.test.ts test/contract/spawn-allowlist.test.ts
```

Expected exit code: **0**. **The pass condition is `ℹ fail 0`.** At authoring time this run reported
`ℹ pass 26` — 5 tests from `field-class`, 10 from `git-boundary`, 3 from `caps-census`, 6 from
`goal-model` and 2 from `spawn-allowlist` — but that count is recorded for orientation and is not a
pass condition. A test added to any of those files raises it legitimately.

### 8.4 The four censuses this change grows

```
node --test --experimental-strip-types test/unit/records.test.ts test/unit/field-merge.test.ts test/unit/declare.test.ts test/unit/caps.test.ts
```

Expected exit code: **0**, and `ℹ fail 0`. These are the tests step 14 and step 15 edit. A red here
means the population was narrowed rather than classified, which is the stop condition in section
11.5.

### 8.5 Every record in the live store still parses

This proves the SPEC `Green` clause "Every record in the live store parses unchanged". It is run
against a **read-only copy** of the store. Never write to the live store, and never call a logbook
ledger tool to do this.

Resolve the store root and copy it:

```
node -e "const c=require('node:crypto');const p=require('node:fs').realpathSync.native(process.cwd());console.log(c.createHash('sha256').update(p,'utf8').digest('hex').slice(0,32))"
```

Expected exit code: **0**. Expected output: exactly one line of 32 lowercase hex characters. Call
that value the store key.

Find the directory named by the store key under the plugin data root, and copy it to a scratch
directory outside the repository:

```
find "$HOME/.claude/plugins/data" -maxdepth 3 -type d -name '<the store key>'
```

Expected exit code: **0**. Expected output: at least one absolute path ending in the store key. More
than one path is normal on this machine and is not a problem here — take the first. Then copy it:

```
cp -R '<the path find printed>' /tmp/logbook-store-copy
```

Expected exit code: **0**. Expected output: none. This is a copy; the original is never written to.

Then write `/tmp/parse-live.ts` with exactly this content and run it:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ThreadRecord } from './src/schema/thread.ts'
import { DecisionRecord } from './src/schema/decision.ts'
import { SessionRecord } from './src/schema/session.ts'
import { BindingRecord } from './src/schema/binding.ts'

const records = path.join(process.argv[2] as string, 'records')
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() && entry.name.endsWith('.json') ? [full] : []
  })

const declaredFor = (rel: string) =>
  rel.startsWith('threads/') ? ThreadRecord
    : rel.startsWith('decisions/') ? DecisionRecord
    : rel.startsWith('sessions/') ? SessionRecord
    : rel.startsWith('bindings/') ? BindingRecord
    : null

const failures: string[] = []
const counts: Record<string, number> = {}
for (const file of walk(records)) {
  const rel = path.relative(records, file).split(path.sep).join('/')
  const declared = declaredFor(rel)
  if (declared === null) {
    failures.push(`UNCLASSIFIED ${rel}`)
    continue
  }
  const parsed = declared.parse(JSON.parse(readFileSync(file, 'utf8')))
  counts[declared.name] = (counts[declared.name] ?? 0) + 1
  if (!parsed.ok) failures.push(`${rel} -> ${parsed.field}: ${parsed.message}`)
}
console.log('parsed by type:', JSON.stringify(counts))
console.log('failures:', failures.length)
for (const failure of failures) console.log('  ', failure)
```

Copy it into the repository root as `parse-live.ts`, run it, then delete it:

```
node --experimental-strip-types parse-live.ts /tmp/logbook-store-copy
rm -f parse-live.ts && rm -rf /tmp/logbook-store-copy
```

Expected exit code: **0**. Expected output contains `failures: 0`. At planning time the same procedure reported
`parsed by type: {"decision":95,"session":132,"thread":5}` and `failures: 0`. The counts will have
grown; **only `failures: 0` is the pass condition**, never the counts.

A file reported `UNCLASSIFIED` means a record directory exists that this script does not know about.
Do not add a bucket for it; that is the stop condition in section 11.5.

### 8.6 The full suite

```
npm test
```

Expected exit code: **0**. Expected output contains `ℹ fail 0`.

At planning time this change was measured on a copy of the tree at **463 tests, 460 passing**. The
three that did not pass — `cutover.old-tree-absent`, `install.serves-new-server` and
`install.no-build-output-was-materialised` — fail identically on an **unmodified** copy of the same
tree, because they need the repository's real git history and a real plugin installation. In the
repository itself they pass. They are named here so that a green run is recognised as green and an
environment failure is not mistaken for a regression.

The tracked known failure is handled by the stop condition in section 11, which governs this command
and this command only. **Do not write a re-run into any acceptance criterion, into any receipt, or
into section 6.**

---

## 9. Commits

Seven commits. Refactor and behaviour change never share one.

### Commit 1

```
chore(schema): add the caps and pattern the git boundary needs
```

Files: `src/schema/ids.ts`, `src/schema/caps.ts`, `src/schema/example.ts`.
Plan steps: 2, 3a, 3b, 4.

Additive constants and one example case. No behaviour changes yet, because nothing reads them.

### Commit 2

```
feat(schema): declare a class on every record field
```

Files: `src/schema/field-class.ts` (new), `src/schema/decision.ts`, `src/schema/session.ts`,
`src/schema/binding.ts`, `src/schema/thread.ts`, `src/merge/field-merge.ts`.
Plan steps: 5, 8, 9, 10, 11a, 11b, 12.

This is the atomic one. Steps 11 and 12 cannot be separated: adding `artifacts` to `Thread` makes the
merge rule table incomplete, so the tree does not typecheck until both land.

### Commit 3

```
feat(schema): name the observed value and a remedy in every refusal
```

Files: `src/schema/declare.ts`, `src/schema/refusal.ts`, `src/server/tool-support.ts`.
Plan steps: 6, 7, 16.

### Commit 4

```
feat(schema): bound open risks by record size rather than element count
```

Files: `src/domain/spine.ts`.
Plan step: 13.

### Commit 5

```
test(schema): classify the new members of four existing censuses
```

Files: `test/unit/records.test.ts`, `test/unit/field-merge.test.ts`, `test/unit/declare.test.ts`,
`test/unit/caps.test.ts`.
Plan steps: 14, 15.

### Commit 6

```
test(schema): census field classes, caps and the process-spawn allowlist
```

Files: `test/unit/field-class.test.ts`, `test/unit/git-boundary.test.ts`,
`test/unit/caps-census.test.ts`, `test/unit/goal-model-fields.test.ts`,
`test/contract/spawn-allowlist.test.ts` (all new).
Plan section: 5.

### Commit 7

```
chore(schema): bump to the version this unit ships
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Plan step: 1.

The version bump is applied first (step 1) but committed last, so that a rebase onto a moved ladder
touches one small commit rather than the schema work.

---

## 10. Pull request

Open it with the operator's global tool. There is no `.claude/lib` inside this repository. Ad-hoc
`gh pr create`, `gh api` POSTs to the pulls endpoint and the GitHub MCP create tool are denied at the
gate. A title and body are fixed at creation and are never rewritten, so never run `gh pr edit`.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head feat/u1-schema-foundations \
  --base main \
  --title "feat(schema): declare field classes and land the goal-model fields" \
  --what "Every field of every stored record now declares whether it is machine plumbing, an address, or text a person reads." \
  --what "A field declared as an address refuses a value containing a line break, a code fence, or a diff hunk, so the record store cannot become a second copy of the code." \
  --what "A goal can now carry the check that decides it, what that check returned, and whether it was actually run; a thread can carry the documents it produced." \
  --why "Nothing in the code inspected what kind of thing a stored string was, so the boundary between this tool and git held only because callers happened to respect it." \
  --why "A goal had nowhere to record how anyone would know it was finished, so completion was an assertion rather than something a later reader could re-check." \
  --why "A limit that counted risk entries charged more to anyone working several goals at once than to someone working them one at a time, for the same amount of decided work." \
  --risk "Records already written are unaffected and every one of them was re-parsed, but a caller that was storing something other than an address in an address field will now be refused." \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "new tests alone - 26 passing, 0 failing" \
  --verified "every record in a read-only copy of the live store re-parsed - 0 failures over 232 records" \
  --verified "acceptance tests at the parent commit - 12 failing across three files" \
  --verified "inertness mutation, pointer pattern removed - 5 tests turn red" \
  --verified "inertness mutation, criterion kind read removed - 1 test turns red" \
  --verified "inertness mutation, unlisted process spawner planted - 1 test turns red" \
  --not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run" \
  --not-verified "mutation score for the changed modules - not run"
```

Two lines above are placeholders the implementer replaces with what it actually observed.

| Line | What to do with it |
|---|---|
| `--verified "npm test - …"` | add it, filled in from the run performed, naming the test count and the exit code |
| `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` | keep it exactly as written when section 11.8's re-run was used; delete it when section 11.8 never fired |

A `Verified:` line for a check that was not run is forbidden. A check whose result was not read is
`--not-verified "<thing> - result not read"`.

### Diff size, measured

The diff was measured by applying every step of section 4 to a throwaway copy of the tree in the
session scratchpad and diffing it against an untouched copy. It was not estimated.

| Partition | Changed lines |
|---|---|
| Production (`src/`) | 324 |
| Tests (`test/`) | 716 |
| **Total** | **1,040** |

Production breaks down as 314 lines modified across twelve files plus a 10-line new module. Tests
break down as 42 lines modified across four files plus 674 lines of new test files:
`caps-census.test.ts` 188, `git-boundary.test.ts` 135, `field-class.test.ts` 121,
`goal-model-fields.test.ts` 116, `spawn-allowlist.test.ts` 114.

### Split ruling: **SPLIT**

1,040 changed lines is 2.6 times the 400-line ceiling, so this unit does not ship as one pull
request. The recommended cut is three, in this order, and each has its own red at its own parent:

| PR | Carries | Plan steps | Measured lines | Red at its parent |
|---|---|---|---|---|
| **U1-A** — refusal completeness | `A1` | 6, 7 | **243** | `caps-census: thread.slug refusal omits the observed value` |
| **U1-B** — field classes and the git boundary | `B5`, `B13`, `B42`, `A5`, `S2` | 2, 3a, 4, 5, 8, 9, 10, 11a, 16 | **590** | 7 of 9 `git-boundary` tests |
| **U1-C** — goal-model fields and the cap census | `B2`, `B3`, `B4`, `B6`, `B7`, `A7` | 3b, 11b, 12, 13, 14, 15 | **244** | 3 of 6 `goal-model` tests |

Each figure was measured by building that part's tree from its own parent and diffing, not by
apportioning the undivided total. They sum to 1,077 rather than 1,040 because `src/schema/thread.ts`
is edited by both `U1-B` and `U1-C`, so its change is counted once in each.

**`U1-B` exceeds the ceiling at a measured 590 lines, and the exception is shown rather than
asserted.**
Cutting it further means separating the class declarations from the census that proves them. The
census IS the receipt for `B5`: a pull request carrying the declarations without it ships a
convention that no check protects, and has nothing red at its parent — the declarations are inert
until something reads them. A pull request carrying the census without the declarations is a
permanent red. Neither half has a receipt, so the ceiling yields and the receipt wins.

`U1-B`'s pull request body says the diff is large and names that reason, so a reviewer learns the
size from the pull request rather than from the Files Changed tab.

**The split is ruled and its ladder rows exist.** Section 12 carries one executable block per pull
request — branch, version step, step list, red-on-parent, inertness mutation, verification, the
`pr-create` invocation and stop conditions. The single invocation above is retained only as the
undivided form; **section 12 is what an implementer follows.**

---

## 11. Stop conditions

Each of these invalidates the plan. For each: what you see, the command that shows it, and then
**STOP and report; do not improvise.**

### 11.1 The two version manifests already disagree

What you see: step 1's read-back prints two different values.

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code: **0**, and expected output one line carrying the same value twice. If the two
values are not identical, **STOP and report; do not improvise.** A version merely *higher*
than `1.4.2` is NOT a stop condition — the ladder shifted; increment from what you read.

### 11.2 A FIND string does not appear exactly once

What you see: a search returns zero matches, or more than the stated number.

```
grep -c '<the FIND string>' <the file>
```

Expected exit code: **0** (`grep` exits 1 when it matches nothing, which is itself the failure).
Every FIND string in section 4 is expected to print exactly `1`, except step 14 edit 4, which is
expected to print exactly `2`. Any other count means the file moved under this plan. **STOP and report; do not
improvise.**

### 11.3 `Criterion.kind` no longer has its reader

What you see: the census outcome this plan rests on has changed.

```
grep -n 'kind: item.kind' src/merge/field-merge.ts
```

Expected exit code: **0**, and expected output exactly one line. If there is no match, the reader that justified retaining
`Criterion.kind` is gone, section 3.2's ruling no longer holds, and the field's fate must be
re-decided. **STOP and report; do not improvise.**

### 11.4 The process-spawn population is not the three modules this plan censused

What you see: a module spawns that the allowlist does not name, or an allowlisted module no longer
spawns.

```
grep -rlE "child_process|execFileSync|execSync|spawnSync|worker_threads" src hooks bin scripts
```

Expected exit code: **0**, and expected output exactly these three lines, in any order: `src/store/git.ts`,
`scripts/install-githooks.mjs`, `scripts/d6-check.cjs`. Any other set means the allowlist in
`test/contract/spawn-allowlist.test.ts` is wrong as written. Do **not** edit the allowlist to make
the census pass. **STOP and report; do not improvise.**

### 11.5 A census halts on something this plan did not classify

What you see: a test fails with `census halted on an unclassifiable item` or
`census rejected a forbidden item` naming something section 4 does not touch, or `parse-live.ts`
reports a record `UNCLASSIFIED`.

A halting census is answered by classifying the new item — never by excluding it, never by pinning a
count, never by widening an allowlist to swallow it. If the item is not one this plan already
classifies, it is outside this unit's ceiling. **STOP and report; do not improvise.**

### 11.6 A record in the live store fails to parse

What you see: section 8.5 prints a non-zero `failures:` count.

The whole point of the optional-not-required shape in step 11 is that this cannot happen. If it
does, the change breaks records that already exist, which no acceptance criterion permits. **STOP and
report; do not improvise.**

### 11.7 `U0` has not landed

What you see: this unit depends on `U0` having given trunk CI a push trigger, and it has not.

```
grep -c 'push:' .github/workflows/rebuild.yml
```

Expected exit code: **0**, and expected output the single line `1`. Exit code 1 with output `0`
means `.github/workflows/rebuild.yml` still runs on pull requests only, `U0` is not on `main`, and
this branch was cut too early. **STOP and report; do not improvise.** Do not add the trigger
yourself; it is another unit's whole scope.

### 11.8 The known tracked suite failure

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

---

## 12. Per-pull-request execution

This unit ships as three pull requests, merged in the order below. Each block is executable start to
finish by someone reading that block plus the shared sections of this document — sections 2 to 5 for
ground truth, edits and test bodies, section 8.5 for the live-store parse procedure, and section 3.2
for the census outcome `C.8.3` guards. **No block requires reading another block.** Sections 4 and 5 remain
the single source for every edit and every test body; each block names the exact step numbers and
test names it consumes and repeats none of them.

**Every step of section 4 is assigned to exactly one block, except step 1.** Step 1 is the version
bump, and it is superseded: each part bumps once, from its own baseline, in its own A.1, B.1 or C.1.
Do not apply section 4 step 1 when executing a block; apply that block's version step instead.

### 12.A — `U1-A` Refusal completeness

**Branch:** `fix/u1a-refusal-completeness`. Cut from `main`.
**Carries:** invariant `A1`. **Measured size:** 243 changed lines (60 production, 183 test).

#### A.1 Version step

Read, then increment. This part is a `fix`, so it increments PATCH and leaves MAJOR and MINOR alone.

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code: **0**. Expected output: one line carrying the same plain semver value twice; at
ladder position 2 that is `1.4.2 1.4.2`. Write `MAJOR.MINOR.(PATCH+1)` into the `"version"` line of
both `package.json` and `.claude-plugin/plugin.json`, using the value you read, then run:

```
node scripts/check-packaging.mjs
```

Expected exit code: **0**. Expected output: no line containing `version mismatch`.

#### A.2 Steps consumed, in order

From section 4: **step 6** (`src/schema/declare.ts`) and **step 7** (`src/schema/refusal.ts`). No
other step.

#### A.3 Tests

Adds `test/unit/caps-census.test.ts`, given in full in section 5.3, with **one modification**: the
`CAP_ROLES` table omits the five constants that do not exist yet — `CRITERION_CHECK_MAX`,
`CRITERION_RESULT_MAX`, `ARTIFACT_LABEL_MAX`, `ARTIFACT_POINTER_MAX` and `DECISION_COMMIT_MAX`.
Delete those five lines from the table; change nothing else in the file. `U1-B` and `U1-C` add them
back as they add the constants.

Test names shipped: `caps-census.every-cap-constant-declares-the-role-it-plays`,
`caps-census.control.an-unclassified-cap-halts-the-census`,
`caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy`.

Modifies no existing test.

#### A.4 Red on the parent

Parent: the tip of `main` this branch was cut from. Copy the test file onto the unmodified parent
and run:

```
node --test --experimental-strip-types test/unit/caps-census.test.ts
```

Exit code 1. Measured result: 2 pass, 1 fail.

```
✖ caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy
  AssertionError [ERR_ASSERTION]: caps-census: thread.slug refusal omits the observed value
```

The other two pass at the parent and must: the constant census is satisfied because this part's
`CAP_ROLES` names only constants that already exist, and the control is a control.

#### A.5 Inertness mutation

Edit `src/schema/refusal.ts`. FIND:

```ts
  const observedClause = observed === null ? '' : `observed ${observed}; `
```

REPLACE with:

```ts
  const observedClause = ''
```

Run `node --test --experimental-strip-types test/unit/caps-census.test.ts`. Expect exit code 1 with
`caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy` red on
`caps-census: thread.slug refusal omits the observed value` — the same message the parent produces.
Restore the line and re-run; expect exit code 0.

#### A.6 Full verification

Never run `npm ci` or `npm install`; `node_modules` is tracked and an install rewrites tracked files.

```
npm run typecheck
```
Expected exit code **0**, no output.

```
node scripts/check-packaging.mjs
```
Expected exit code **0**, no line containing `version mismatch`.

```
node --test --experimental-strip-types test/unit/caps-census.test.ts
```
Expected exit code **0**, output contains `ℹ fail 0`.

```
npm test
```
Expected exit code **0**, output contains `ℹ fail 0`, subject to stop condition A.8.4.

#### A.7 Pull request

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/u1a-refusal-completeness \
  --base main \
  --title "fix(schema): name the observed value and a remedy in every refusal" \
  --what "A refusal for a value that is too long or too large now states how long or how large the value actually was." \
  --what "Every refusal now ends with a plain remedy telling the caller what to change before retrying." \
  --why "A refusal said what a field accepts but never what it received, so a caller could not tell how far over the limit it was without counting by hand." \
  --why "A refusal offered a valid example but never named an action, leaving the caller to infer what to do." \
  --risk "Refusal message text changes shape, so anything matching on the exact old sentence will need updating; no refusal changes which values it accepts." \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "acceptance test at the parent commit - 1 failing of 3, on the observed-value assertion" \
  --verified "inertness mutation, observed clause emptied - the same 1 test turns red" \
  --not-verified "mutation score for the changed modules - not run"
```

Expected exit code: **0**. Expected output: the URL of the opened pull request. A non-zero exit is a
usage rejection naming the flag it refused; correct that flag and re-run. Never substitute
`gh pr create`, a `gh api` POST, or the GitHub MCP create tool — all three are denied at the gate.

Add a `--verified "npm test - <count> passing, exit 0"` line filled in from the run performed.

#### A.8 Stop conditions

**A.8.1 — the two version manifests already disagree.** Run the command in A.1. If the two values
are not identical, **STOP and report; do not improvise.** A value higher than `1.4.2` is not a stop
condition; increment from what you read.

**A.8.2 — `U0` has not landed.**

```
grep -c 'push:' .github/workflows/rebuild.yml
```

Expected exit code **0** and output `1`. Exit code 1 with output `0` means trunk CI still runs on
pull requests only and this branch was cut too early. **STOP and report; do not improvise.**

**A.8.3 — a FIND string does not appear exactly once.** Every FIND string in steps 6 and 7 is
expected exactly once. Check with `grep -c '<the FIND string>' <the file>`; expected exit code **0**
and output `1`. Any other count means the file moved under this plan. **STOP and report; do not
improvise.**

**A.8.4 — the known tracked suite failure.**

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

---

### 12.B — `U1-B` Field classes and the git boundary

**Branch:** `feat/u1b-field-classes`. Cut from a `main` that already contains `U1-A`.
**Carries:** `B5`, `B13`, `B42`, and invariants `A5` and `S2`.
**Measured size:** 590 changed lines (228 production, 362 test). This exceeds the 400-line ceiling
and the exception is granted: cutting it further separates the class declarations from the census
that proves them, and the census is the receipt for `B5`. Declarations without the census ship a
convention no check protects and have nothing red at their parent, because declarations are inert
until something reads them; the census without the declarations is a permanent red. The pull request
body states the size and names that reason.

#### B.1 Version step

Read, then increment. This part is a `feat`, so it increments MINOR and sets PATCH to 0.

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code: **0**. Expected output: one line carrying the same plain semver value twice; at
ladder position 3 that is `1.4.3 1.4.3`. Write `MAJOR.(MINOR+1).0` into the `"version"` line of both
`package.json` and `.claude-plugin/plugin.json`, using the value you read, then run
`node scripts/check-packaging.mjs`; expected exit code **0**, no line containing `version mismatch`.

#### B.2 Steps consumed, in order

From section 4, in this order: **step 2**, **step 3a**, **step 4**, **step 5**, **step 8**,
**step 9**, **step 10**, **step 11a**, **step 16**. No other step. In particular, do **not** apply
step 11b — that belongs to `U1-C`, and step 11a leaves `src/schema/thread.ts` in a form that adds no
field and removes no cap.

#### B.3 Tests

Adds three files, each given in full in section 5:

- `test/unit/field-class.test.ts` — section 5.1, unmodified. Test names:
  `field-class.every-record-field-declares-a-class`,
  `field-class.an-array-and-its-element-declare-the-same-class`,
  `field-class.every-declared-pointer-carries-the-pointer-pattern`,
  `field-class.control.an-undeclared-node-is-forbidden-and-a-foreign-class-halts`,
  `field-class.pointer-pattern-refuses-content-and-accepts-an-address`.
- `test/unit/git-boundary.test.ts` — section 5.2, with **one modification**: omit the test
  `git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused`, because `Thread.artifacts`
  does not exist until `U1-C`. Ship the other nine tests exactly as section 5.2 gives them.
- `test/contract/spawn-allowlist.test.ts` — section 5.5, unmodified. Test names:
  `spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type`,
  `spawn-allowlist.control.an-unlisted-spawner-and-a-tainted-allowlisted-module-are-forbidden`.

Modifies one file: `test/unit/caps-census.test.ts`, adding the single line
`  DECISION_COMMIT_MAX: 'record-field',` to the `CAP_ROLES` table immediately after the
`DECISION_SUPERSEDES_MAX_ELEMENTS` entry, because step 3a introduces that constant and the census
halts on a constant it cannot place.

#### B.4 Red on the parent

Parent: the tip of `main` containing `U1-A`. Two of the three new files reach a genuine red there;
one cannot run there at all.

`test/unit/git-boundary.test.ts` — copy it onto the unmodified parent and run:

```
node --test --experimental-strip-types test/unit/git-boundary.test.ts
```

Exit code 1. Measured result: 2 pass, 7 fail.

```
✖ git-boundary.a-risk-ref-carrying-a-line-break-is-refused
✖ git-boundary.a-risk-ref-carrying-a-code-fence-is-refused
✖ git-boundary.a-risk-ref-carrying-a-diff-hunk-marker-is-refused
✖ git-boundary.a-decision-commit-that-is-not-a-sha-is-refused
✖ git-boundary.a-decision-commit-carrying-a-diff-hunk-marker-is-refused
✖ git-boundary.a-decision-commit-that-is-a-sha-or-null-is-accepted
✖ git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema
```

The two positive controls pass at the parent and must:
`git-boundary.a-risk-ref-that-is-an-address-is-accepted` and
`git-boundary.a-binding-branch-that-is-an-ordinary-branch-name-is-accepted`.

`test/unit/field-class.test.ts` — **cannot be run at the parent.** It imports
`src/schema/field-class.ts`, which does not exist there, so the run ends in
`Error [ERR_MODULE_NOT_FOUND]`. **Substitute procedure:** apply step 5 alone, then run

```
node --test --experimental-strip-types test/unit/field-class.test.ts
```

Exit code 1, with `field-class.every-record-field-declares-a-class` failing on
`census rejected a forbidden item` naming a node that carries no `class` key. Then revert step 5 and
apply steps 2, 3a, 4, 5, 8, 9, 10, 11a and 16 in order.

`test/contract/spawn-allowlist.test.ts` — **green at the parent, and disclosed rather than hidden.**
Both its tests pass there. `S2` is a drift guard: only three modules spawn a process and none
imports a record type, and that is already true. Reaching a red would mean introducing a violation
into the parent commit, which is vandalism rather than a receipt. Honesty-ladder status for the
red-on-parent obligation on `B42` and `S2`: **`unverified-reasoned`**, for that specific reason. Its
proof is the inertness mutation in B.5.

#### B.5 Inertness mutation

Two mutations, both measured.

**Mutation 1 — remove the pointer pattern.** Edit `src/schema/field-class.ts`. FIND:

```ts
  z.string().max(max).regex(POINTER_PATTERN).describe(description).meta({ class: 'pointer' })
```

REPLACE with:

```ts
  z.string().max(max).describe(description).meta({ class: 'pointer' })
```

Run `node --test --experimental-strip-types test/unit/git-boundary.test.ts test/unit/field-class.test.ts`.
Expect exit code 1 with five tests red: `field-class.every-declared-pointer-carries-the-pointer-pattern`,
the three `git-boundary.a-risk-ref-carrying-*` tests, and
`git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema`. Restore the
`.regex(POINTER_PATTERN)` call and re-run; expect exit code 0.

**Mutation 2 — plant an unlisted spawner.** Create `src/probe/unlisted-spawner.ts` with exactly:

```ts
import { execFileSync } from 'node:child_process'
export const run = () => execFileSync('git', ['status'])
```

Run `node --test --experimental-strip-types test/contract/spawn-allowlist.test.ts`. Observed: exit
code 1 with

```
✖ spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type
  AssertionError [ERR_ASSERTION]: spawn-allowlist: the set of modules that spawn a process must equal the allowlist exactly
```

Restore with `rm -rf src/probe` and re-run; expect exit code 0 and 2 passing.

#### B.6 Full verification

Never run `npm ci` or `npm install`.

```
npm run typecheck
```
Expected exit code **0**, no output.

```
node scripts/check-packaging.mjs
```
Expected exit code **0**, no line containing `version mismatch`.

```
node --test --experimental-strip-types test/unit/field-class.test.ts test/unit/git-boundary.test.ts test/unit/caps-census.test.ts test/contract/spawn-allowlist.test.ts
```
Expected exit code **0**. The pass condition is `ℹ fail 0`. Measured at authoring time: `ℹ pass 19`.

Then run the live-store parse check, whose script and copy procedure section 8.5 gives in full,
against a read-only copy of the store:

```
node --experimental-strip-types parse-live.ts /tmp/logbook-store-copy
```

Expected exit code: **0**. Expected output contains `failures: 0`. Never write to the live store.

```
npm test
```
Expected exit code **0**, output contains `ℹ fail 0`, subject to stop condition B.8.5. Measured at
authoring time on a copy of this tree: 455 tests, 452 passing, with the only three failures being
`cutover.old-tree-absent`, `install.serves-new-server` and `install.no-build-output-was-materialised`,
which fail identically on an unmodified copy because they need the repository's real git history and
a real plugin installation. In the repository itself they pass.

#### B.7 Pull request

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head feat/u1b-field-classes \
  --base main \
  --title "feat(schema): declare a class on every record field" \
  --what "Every field of every stored record now declares whether it is machine plumbing, an address, or text a person reads." \
  --what "A field declared as an address refuses a value containing a line break, a code fence, or a diff hunk, so the record store cannot become a second copy of the code." \
  --what "The field that records which commit a decision was made at now accepts only a real object id, or nothing at all." \
  --why "Nothing in the code inspected what kind of thing a stored string was, so the boundary between this tool and git held only because callers happened to respect it." \
  --why "The commit field had no limit and no shape, so a caller could store an entire diff in it and nothing would object." \
  --why "There was no way to ask which stored fields are meant to be read by a person, which a later change needs in order to prove nothing is stored that no surface shows." \
  --risk "At 590 lines this is larger than usual and not divisible: split the declarations from the census proving them and neither half carries a receipt. A non-address in an address field is now refused." \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "new tests alone - 19 passing, 0 failing" \
  --verified "acceptance tests at the parent commit - 7 failing of 9 in the boundary suite" \
  --verified "every record in a read-only copy of the live store re-parsed - 0 failures" \
  --verified "inertness mutation, pointer pattern removed - 5 tests turn red" \
  --verified "inertness mutation, unlisted process spawner planted - 1 test turns red" \
  --not-verified "process-spawn allowlist red at the parent - not reachable; the invariant already holds, proved by mutation instead" \
  --not-verified "mutation score for the changed modules - not run"
```

Expected exit code: **0**. Expected output: the URL of the opened pull request. A non-zero exit is a
usage rejection naming the flag it refused; correct that flag and re-run. Never substitute
`gh pr create`, a `gh api` POST, or the GitHub MCP create tool — all three are denied at the gate.

Add a `--verified "npm test - <count> passing, exit 0"` line filled in from the run performed.

#### B.8 Stop conditions

**B.8.1 — `U1-A` has not merged.**

```
grep -c 'observedClause' src/schema/refusal.ts
```

Expected exit code **0** and output `2`. Exit code 1 with output `0` means `U1-A` is not on `main`
and this branch was cut too early. **STOP and report; do not improvise.**

**B.8.2 — the two version manifests already disagree.**

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code **0**, and expected output one line carrying the same value twice; at ladder
position 3 that is `1.4.3 1.4.3`. If the two values are not identical, **STOP and report; do not
improvise.** A value higher than `1.4.3` is not a stop condition; increment from what you read.

**B.8.3 — the process-spawn population is not the three modules this plan censused.**

```
grep -rlE "child_process|execFileSync|execSync|spawnSync|worker_threads" src hooks bin scripts
```

Expected exit code **0** and exactly these three lines in any order: `src/store/git.ts`,
`scripts/install-githooks.mjs`, `scripts/d6-check.cjs`. Any other set means the allowlist in
`test/contract/spawn-allowlist.test.ts` is wrong as written. Do **not** edit the allowlist to make
the census pass. **STOP and report; do not improvise.**

**B.8.4 — a census halts on something this plan did not classify.** A test failing with
`census halted on an unclassifiable item` or `census rejected a forbidden item` naming something
steps 2 through 16 do not touch is outside this part's ceiling. Answer a halting census by
classifying the item, never by excluding it, pinning a count, or widening an allowlist. **STOP and
report; do not improvise.**

**B.8.5 — the known tracked suite failure.**

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

---

### 12.C — `U1-C` Goal-model fields and the cap census

**Branch:** `feat/u1c-goal-model-fields`. Cut from a `main` that already contains `U1-B`.
**Carries:** `B2`, `B3`, `B4`, `B6`, `B7`, and invariant `A7`.
**Measured size:** 244 changed lines (66 production, 178 test).

#### C.1 Version step

Read, then increment. This part is a `feat`, so it increments MINOR and sets PATCH to 0.

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code: **0**. Expected output: one line carrying the same plain semver value twice; at
ladder position 4 that is `1.5.0 1.5.0`. Write `MAJOR.(MINOR+1).0` into the `"version"` line of both
`package.json` and `.claude-plugin/plugin.json`, using the value you read, then run
`node scripts/check-packaging.mjs`; expected exit code **0**, no line containing `version mismatch`.

#### C.2 Steps consumed, in order

From section 4, in this order: **step 3b**, **step 11b**, **step 12**, **step 13**, **step 14**,
**step 15**. No other step. Steps 11b and 12 must be applied together and share a commit: adding
`artifacts` to `Thread` makes the merge rule table incomplete until step 12 lands, so the tree does
not typecheck between them.

#### C.3 Tests

Adds one file: `test/unit/goal-model-fields.test.ts`, given in full in section 5.4, unmodified. Test
names: `goal-model.parsing-adds-no-bytes-to-a-record-written-before-this-change`,
`goal-model.a-record-written-before-this-change-still-parses`,
`goal-model.a-criterion-carrying-check-result-and-status-round-trips`,
`goal-model.result-status-accepts-only-the-two-recorded-states`,
`goal-model.a-thread-carrying-artifacts-round-trips`,
`goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts`.

Modifies five files:

- `test/unit/caps-census.test.ts` — add four lines to the `CAP_ROLES` table:
  `CRITERION_CHECK_MAX`, `CRITERION_RESULT_MAX`, `ARTIFACT_LABEL_MAX` and `ARTIFACT_POINTER_MAX`,
  each `'record-field'`, because step 3b introduces them and the census halts on a constant it
  cannot place.
- `test/unit/git-boundary.test.ts` — add back the one test `U1-B` omitted,
  `git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused`, exactly as section 5.2 gives
  it, now that `Thread.artifacts` exists.
- `test/unit/records.test.ts`, `test/unit/field-merge.test.ts`, `test/unit/declare.test.ts` — step
  14 in section 4 gives the four exact edits.
- `test/unit/caps.test.ts` — step 15 in section 4 gives the two exact edits, replacing
  `caps.assert-contribution` with `caps.open-risks-accumulate-past-the-old-element-cap` and
  `caps.key-decisions-still-refuse-on-their-element-cap`.

#### C.4 Red on the parent

Parent: the tip of `main` containing `U1-B`. Copy `test/unit/goal-model-fields.test.ts` onto the
unmodified parent and run:

```
node --test --experimental-strip-types test/unit/goal-model-fields.test.ts
```

Exit code 1. Measured result: 3 pass, 3 fail.

```
✖ goal-model.a-criterion-carrying-check-result-and-status-round-trips
✖ goal-model.result-status-accepts-only-the-two-recorded-states
✖ goal-model.a-thread-carrying-artifacts-round-trips
```

Three pass at the parent, each for a stated reason.
`goal-model.a-record-written-before-this-change-still-parses` is the guard that must be green on
both sides. For the other two, **no red-on-parent receipt exists and none is manufactured**:

- `goal-model.parsing-adds-no-bytes-to-a-record-written-before-this-change` — honesty-ladder status
  **`unverified-reasoned`**, because the property already holds at the parent and reaching a red
  would mean adding a `.default(...)` to the parent, which is the defect the check exists to
  prevent. Its proof is mutation 2 in C.5.
- `goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts` — honesty-ladder status
  **`unverified-reasoned`**, because the `B7` census outcome was to keep the field and its reader
  exactly as they are, so this part changes no behaviour there and only pins what already holds. Its
  proof is mutation 3 in C.5.

A second red is reachable in an existing file. Apply **step 15 edit 1 alone** — replacing
`caps.assert-contribution` — and run:

```
node --test --experimental-strip-types test/unit/caps.test.ts
```

Exit code 1. Measured result: 7 pass, 1 fail.

```
✖ caps.open-risks-accumulate-past-the-old-element-cap
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
```

The assertion that fails is `assert.equal(acceptResult.ok, true)`, because at the parent
`contributeToSpine` still refuses the 41st risk. Then apply the rest of C.2 in order.

#### C.5 Inertness mutation

Four mutations.

**Mutation 1 — put the open-risks element cap back.** Edit `src/domain/spine.ts`. FIND
`  open_risks: null,` and REPLACE with `  open_risks: caps.OPEN_RISKS_MAX_ELEMENTS,`. Run
`node --test --experimental-strip-types test/unit/caps.test.ts`; expect exit code 1 with
`caps.open-risks-accumulate-past-the-old-element-cap` red. Restore `null`.

**Mutation 2 — make a new field required.** Edit `src/schema/thread.ts`. FIND:

```ts
        .nullable()
        .optional()
        .describe('the re-runnable check that decides whether this criterion is true, absent when none is recorded')
```

REPLACE with the same three lines minus `.optional()`. Run
`node --test --experimental-strip-types test/unit/goal-model-fields.test.ts`; expect exit code 1
with `goal-model.a-record-written-before-this-change-still-parses` red, because a stored record
carrying no `check` key no longer parses. Restore the `.optional()` call.

**Mutation 3 — remove the `kind` read from the merge.** Edit `src/merge/field-merge.ts`. FIND
`type CriterionContent = Pick<Criterion, 'text' | 'done' | 'kind' | 'struck_by'>` and REPLACE with
`type CriterionContent = Pick<Criterion, 'text' | 'done' | 'struck_by'>`; then FIND
`  done: item.done,\n  kind: item.kind,` and REPLACE with `  done: item.done,`. Run
`node --test --experimental-strip-types test/unit/goal-model-fields.test.ts`. Observed: exit code 1,
exactly one test red — `goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts` —
with the other five green. Restore both lines and re-run; expect 6 passing, 0 failing.

**Mutation 4 — drop the artifact pointer's class constructor.** Edit `src/schema/thread.ts`. FIND
`    pointer: pointer(caps.ARTIFACT_POINTER_MAX, 'a path or url naming where this artifact lives')`
and REPLACE with
`    pointer: content(z.string().max(caps.ARTIFACT_POINTER_MAX).describe('a path or url naming where this artifact lives'))`.
Run `node --test --experimental-strip-types test/unit/git-boundary.test.ts`; expect exit code 1 with
`git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused` red. Restore the `pointer(...)`
call.

#### C.6 Full verification

Never run `npm ci` or `npm install`.

```
npm run typecheck
```
Expected exit code **0**, no output.

```
node scripts/check-packaging.mjs
```
Expected exit code **0**, no line containing `version mismatch`.

```
node --test --experimental-strip-types test/unit/goal-model-fields.test.ts test/unit/caps.test.ts test/unit/caps-census.test.ts test/unit/git-boundary.test.ts
```
Expected exit code **0**. The pass condition is `ℹ fail 0`.

```
node --test --experimental-strip-types test/unit/records.test.ts test/unit/field-merge.test.ts test/unit/declare.test.ts
```
Expected exit code **0** and `ℹ fail 0`. These are the three censuses step 14 edits. A red here means
the population was narrowed rather than classified, which is stop condition C.8.4.

Then run the live-store parse check, whose script and copy procedure section 8.5 gives in full,
against a read-only copy of the store:

```
node --experimental-strip-types parse-live.ts /tmp/logbook-store-copy
```

Expected exit code: **0**. Expected output contains `failures: 0`. Never write to the live store. This is the check that proves the new fields did not
break a record that already exists.

```
npm test
```
Expected exit code **0**, output contains `ℹ fail 0`, subject to stop condition C.8.5. Measured at
authoring time on a copy of this tree: 463 tests, 460 passing, with the only three failures being
`cutover.old-tree-absent`, `install.serves-new-server` and `install.no-build-output-was-materialised`,
which fail identically on an unmodified copy because they need the repository's real git history and
a real plugin installation. In the repository itself they pass.

#### C.7 Pull request

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head feat/u1c-goal-model-fields \
  --base main \
  --title "feat(schema): carry a goal's check and a thread's artifacts" \
  --what "A goal can now record the check that decides whether it is true, what that check returned, and whether the check was actually run or only reasoned about." \
  --what "A thread can now record the documents it produced, each as a label and an address, so a plan or spec reaches a later session without being typed into prose." \
  --what "The number of open risks a thread may hold is no longer capped by count; it is bounded by the size of the record, which is measured against the largest one that exists." \
  --why "A goal had nowhere to say how anyone would know it was finished, so completion was an assertion a later reader could not re-check." \
  --why "A thread had no field for the things it produced, so the only way to pass on a document was to mention it in a sentence and hope someone found it." \
  --why "Counting risk entries charged more to anyone working several goals at once than to someone working them one at a time, for the same amount of decided work." \
  --risk "Records already written are unaffected and every one of them was re-parsed; the new fields are optional, so nothing that exists stops parsing and nothing grows when it is read." \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "acceptance test at the parent commit - 3 failing of 6" \
  --verified "acceptance test at the parent commit, existing caps suite - 1 failing of 8" \
  --verified "every record in a read-only copy of the live store re-parsed - 0 failures" \
  --verified "inertness mutation, open-risks element cap restored - 1 test turns red" \
  --verified "inertness mutation, criterion kind read removed - 1 test turns red" \
  --not-verified "parsing-adds-no-bytes red at the parent - not reachable; the property already holds, proved by mutation instead" \
  --not-verified "mutation score for the changed modules - not run"
```

Expected exit code: **0**. Expected output: the URL of the opened pull request. A non-zero exit is a
usage rejection naming the flag it refused; correct that flag and re-run. Never substitute
`gh pr create`, a `gh api` POST, or the GitHub MCP create tool — all three are denied at the gate.

Add a `--verified "npm test - <count> passing, exit 0"` line filled in from the run performed.

#### C.8 Stop conditions

**C.8.1 — `U1-B` has not merged.**

```
grep -c 'POINTER_PATTERN' src/schema/field-class.ts
```

Expected exit code **0** and output `2`. Exit code 2 with `No such file or directory` means
`U1-B` is not on `main` and this branch was cut too early. **STOP and report; do not improvise.**

**C.8.2 — the two version manifests already disagree.**

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

Expected exit code **0**, and expected output one line carrying the same value twice; at ladder
position 4 that is `1.5.0 1.5.0`. If the two values are not identical, **STOP and report; do not
improvise.** A value higher than `1.5.0` is not a stop condition; increment from what you read.

**C.8.3 — `Criterion.kind` no longer has its reader.**

```
grep -n 'kind: item.kind' src/merge/field-merge.ts
```

Expected exit code **0** and exactly one line. No match means the reader that justified retaining
`Criterion.kind` is gone, the census outcome in section 3.2 no longer holds, and the field's fate
must be re-decided. **STOP and report; do not improvise.**

**C.8.4 — a census halts on something this plan did not classify**, or the live-store parse reports
a record `UNCLASSIFIED`, or it reports a non-zero `failures:` count. The new fields are optional
precisely so that a record which already exists cannot stop parsing. Answer a halting census by
classifying the item, never by excluding it, pinning a count, or widening an allowlist. **STOP and
report; do not improvise.**

**C.8.5 — the known tracked suite failure.**

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.
