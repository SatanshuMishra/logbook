# U1 — Schema foundations

## 0. Identity

**Closes:** `D3` (partly — the attachment field already exists; see section 3), `D9` (partly),
`D19` (partly), `D20`, `D21`, `D22`, `D23`.

**Depends on:** `U0` (trunk verification gate) must be merged to `main` first. Nothing else.

**Required by:** `U2` is cut from a `main` that already contains this unit. `U4`, `U5`, `U6`, `U7`
are all cut from a `main` that already contains this unit.

**Wave:** 1.

**Branch names:** this unit ships as **two pull requests** (section 10 gives the measured reason):

- Stage A — `feat/u1a-schema-field-classes`
- Stage B — `feat/u1b-goal-model-fields`

**PR title scope:** `schema` for both stages.

**Version bump:** Baseline `1.4.2` -> `1.5.0` per orchestrator ruling OR1, applied as a
read-then-increment (section 4, steps A0 and B0). Stage A takes `1.4.2` -> `1.5.0`; stage B takes
`1.5.0` -> `1.6.0`. Both are `feat`, so both increment MINOR and set PATCH to 0.

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

**Not edited:** `src/store/records.ts`. Section 3 records the finding that made this unnecessary.
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
   this change is identical before and after parsing. *Guards the write-time size bound in criterion
   11 against being silently consumed by the new fields.*
10. **`open_risks` accumulates past forty entries.** The element cap that penalised parallel working
    styles is gone from the record schema and from the write path; the element caps on
    `key_decisions` and `out_of_scope` still refuse. *Discharges `B6` and `D21`.*
11. **The write-time size bound is `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`, sized against a
    measured largest live thread record of 39,079 bytes.** The arithmetic is in section 3.
    *Discharges the orchestrator ruling OR12 obligation.*
12. **`Criterion.kind` is retained, and a merge divergence in it conflicts.** Two copies of one
    criterion differing only in `kind` produce exactly one conflict rather than silently picking
    one. *Discharges `B7` and closes `D22` by census outcome.*
13. **`Risk.refs` is retained and is class `pointer`.** *Discharges `B4` and part of `D9`.*
14. **A decision whose spine link will not fit the thread record's cap is still written, and the
    response says why the link was skipped.** *Discharges `A7`.*
15. **Every record in the live store parses unchanged, and the full suite is green.** *Discharges
    the SPEC section 9 `Green` cell for this unit.*

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

### 3.6 `OR15` obligation 3 — `Decision.commit` is not built with the `pointer(...)` constructor

`OR15` obligation 3 directs that `Decision.commit` be built with `pointer(...)` and additionally
carry its sha pattern. **This plan declares it with the sha pattern and an explicit
`.meta({ class: 'pointer' })` instead**, and this is the one place the plan departs from `OR15`.

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
rather than relying on the argument.

### 3.7 `OR2` and `OR17`, restated

Wave 3 is sequential: `U8` merges before `U9`. Wave 1 is partially ordered: `U2` is cut from a
`main` that already contains this unit. Neither changes anything this plan does; both are restated
because the affected plans must agree.

### 3.8 The pattern for a git object id accepts two lengths

`SHA_PATTERN` accepts forty **or** sixty-four lowercase hex characters. All 95 decision records in
the live store carry a forty-character value and none is null, so forty alone would be sufficient
today. Sixty-four is accepted because git repositories using the SHA-256 object format produce
sixty-four-character ids, and `readProjectHead` (`src/store/git.ts:106-109`) returns whatever
`git rev-parse HEAD` prints. **Rejected:** forty only — it would refuse a legitimate HEAD on a
SHA-256 repository and there is no benefit to trade for that.
