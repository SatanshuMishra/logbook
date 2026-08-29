# U6-A — Discovery: every content field reaches a rendered surface

## 0. Identity

- **Closes:** invariant `O4` — for every field declared `content` in the record schemas, that field
  appears on at least one rendered surface.
- **Depends on:** the schema change that gives every record field a declared class. Concretely, the
  file `src/schema/field-class.ts` must exist and export `POINTER_PATTERN`, and `src/schema/thread.ts`
  must export a `Thread` type carrying `artifacts`, and a `Criterion` type carrying `check`, `result`
  and `result_status`. Section 11 turns this into a checkable stop condition.
- **Required by:** `U6-B`, which extends the same census and the same renderer.
- **Wave:** 2. Cut from the tip of `main` at branch-cut time.
- **Branch name:** `feat/u6a-content-rendered`
- **Version bump:** Baseline `2.1.0` -> `2.2.0` per orchestrator ruling OR1. The step itself is a
  read-then-increment; see step 1.
- **Creates (new files, wholly owned by this unit):**
  `test/support/schema-nodes.ts`, `test/contract/content-rendered.test.ts`
- **Also edits:** `test/contract/described.test.ts`, to import the function this unit lifts out of it.
  That file is a test file owned by no unit's file list, and the edit is a pure move.
- **SPEC anchors:** section 9 unit `U6`; section 6 invariant `O4`; section 6.5 field classes;
  section 4.1 goal `LG6`.

## 1. Acceptance criteria (the ceiling)

1. `test/support/schema-nodes.ts` exists and exports `SchemaNode`, `isPlainObject` and
   `flattenSchemaNodes`, with bodies identical to the ones removed from
   `test/contract/described.test.ts`. `test/contract/described.test.ts` imports them and defines
   none of them itself. (Discharges the lift the orchestrator assigned to this unit.)
2. A census named `content.every-content-field-reaches-a-rendered-surface` runs over every node of
   the four record schemas — thread, decision, session, binding — and halts on any node that is not
   a plain object, that carries `$ref`, whose `class` key is absent, or whose `class` is not one of
   the three strings `structural`, `pointer`, `content`. (Discharges `O4`'s safe-read precondition.)
3. That same census decides, for every node whose declared class is `content`, whether the field
   reaches a rendered surface, and it decides it by rendering rather than by consulting a written
   list. (Discharges `O4`.)
4. The census is green. Concretely, `thread.slug`, `thread.completion_criteria[].check`,
   `thread.completion_criteria[].result` and `thread.artifacts[].label` — the four content fields
   that reach no rendered surface before this change — reach one after it. (Discharges `O4`.)
5. Two control tests prove the census halts rather than passing silently: one over a synthetic node
   whose sentinel appears nowhere, and one over a synthetic node the record builder cannot construct
   a value for. (Discharges plan invariant `P8`.)
6. `npm run typecheck` exits 0 and `node scripts/check-packaging.mjs` exits 0, with `package.json`
   and `.claude-plugin/plugin.json` carrying the same version. (Discharges `P1` and `P4`.)

Anything discovered above this list is appended to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item and is NOT folded into this plan.

## 2. Ground truth

### 2.1 `test/contract/described.test.ts` lines 15-46 — the flattener that must be shared

Current source, read at the tip of `main`:

```ts
type SchemaNode = { path: string; value: unknown }

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
```

What is wrong with it: it is private to one test file, and this unit's census needs the identical
walk over the same JSON Schema structure. Two copies of one walk drift silently, and a census whose
population is produced by a drifted walk is a census over the wrong population.

### 2.2 `src/server/resource-render.ts` line 44-45 — the criterion line

Current source, read at the tip of `main`:

```ts
const renderDetailCriterionLine = (criterion: Criterion): string =>
  `c${criterion.ordinal} [${detailCriterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${escapeStored(criterion.text)}`
```

What is wrong with it: the thread resource is the surface that shows one thread record in full, and
this line shows a criterion's text but neither its `check` nor its `result`. Both are declared class
`content`, so `O4` requires each to appear on some rendered surface, and neither does. This is the
same shape as SPEC defect `D19` — "a criterion carries no statement of how it would be decided" —
carried through to the surface that reads one back.

### 2.3 `src/server/resource-render.ts` lines 84-107 — the thread detail body

Current source, read at the tip of `main`:

```ts
  return [
    `Thread: ${escapeStored(thread.title)}`,
    `Id: ${escapeStored(thread.id)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderDetailBlockage(thread.blocked_by),
    renderDetailPointerStatus(pointer, thread.id),
    `Active goal: ${escapeStored(thread.spine.active_goal)}`,
    `Next step: ${escapeStored(thread.spine.next_step)}`,
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Related:',
    ...relatedLines,
    'Completion criteria:',
    ...criteriaLines,
    'Open risks:',
    ...riskLines,
    'Key decisions:',
    ...keyDecisionLines,
    'Out of scope:',
    ...outOfScopeLines,
    'Decisions:',
    `resolved: ${decisionIntegrity.resolved}`,
    ...danglingLines,
    ...quarantinedLines
  ].join('\n')
```

What is wrong with it: two content fields of the thread record never appear. `thread.slug` appears
only as a **predecessor's** slug, on the `Related:` line built by `renderDetailRelatedLine` at line
60-61, never as the subject thread's own. And `thread.artifacts` — the field SPEC defect `D23`
exists to add, "a thread has no field for the artifacts it produced" — has no block at all, so its
`label`, declared class `content`, reaches nothing.

### 2.4 `src/server/resource-render.ts` lines 1-6 — the imports

Current source, read at the tip of `main`:

```ts
import { escapeStored } from '../render/escape.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'
```

What is wrong with it: it does not import the `Artifact` type, which the new artifact line needs.

### 2.5 `test/support/census.ts` lines 11-24 — the census this unit uses

Current source, read at the tip of `main`:

```ts
export const census = <T>(
  items: T[],
  classify: (item: T) => Classified<T>['verdict'] | 'unclassifiable'
): void => {
  for (const item of items) {
    const verdict = classify(item)
    if (verdict === 'unclassifiable') {
      throw new Error(`census halted on an unclassifiable item: ${describeItem(item)}`)
    }
    if (verdict === 'forbidden') {
      throw new Error(`census rejected a forbidden item: ${describeItem(item)}`)
    }
  }
}
```

Nothing is wrong with it. It is quoted because this unit's new test depends on its exact two halt
messages, which section 6 and section 7 name verbatim.

## 3. Divergences from the SPEC

### 3.1 The mitosis decomposition skill is absent from disk

`~/.claude/skills/mitosis/SKILL.md` does not exist. This plan does not depend on it; it was written
against the planning brief and the orchestrator rulings alone, which are jointly self-contained.
The absence is recorded here because the orchestrator asked for it to be recorded, and it changes
nothing in this plan.

### 3.2 `O4` is proven over a subset of the rendered surfaces, and that is stricter, not weaker

SPEC invariant `O4` reads "for every field declared `content` in the schema, that field appears on
**at least one** rendered surface". This unit's census reads exactly three surfaces, all three in one
file this unit owns: `renderThreadDetail`, `renderDecisionResource` and `renderSessionEntryResource`
in `src/server/resource-render.ts`. It deliberately does not read the briefing at
`src/render/briefing.ts` or the roster at `src/render/roster.ts`.

That makes the census **harder to pass than `O4` requires**, never easier. A field that appears on
one of the three surfaces satisfies `O4` outright, because those three are rendered surfaces. A
field that appears only on the briefing would be marked unrendered here and would turn the census
red — a false red, never a false pass. Plan invariant `P8` forbids narrowing a census to obtain a
green; this narrows it in the opposite direction, and the reason is stated rather than assumed: it
removes every dependency on a renderer another unit owns and is editing in the same wave.

### 3.3 SPEC section 8 places artifact rendering on the briefing; this unit also renders it on the resource

SPEC rule `B22` reads "the thread renders its `artifacts` near the top, before the spine", under the
heading `Renderer — src/render/`. That is the briefing, and it belongs to another unit. This unit
renders artifacts on the **thread resource** instead, in `src/server/resource-render.ts`. The two do
not conflict: they are different files and different surfaces, and `O4` asks for at least one.
Rendering it here is what makes this unit's declared green — "`O4` asserted over content-class
fields" — true without waiting on another unit's file.

### 3.4 This unit's own line citations

SPEC line citations were taken at `e5f0195`. Every line range quoted in section 2 was read from the
working tree while authoring, and every one matched. `src/server/resource-render.ts` is 108 lines and
`test/contract/described.test.ts` is 113 lines.

### 3.5 `src/server/tools/resolve_conflict.ts` contains a byte that is not valid UTF-8

That file may be invisible to `grep`. No census in this unit reads any file under `src/` as text:
the census population is the four generated JSON Schemas, and the surfaces are called as functions,
not scanned. The file is therefore neither missed nor mis-read by anything this unit adds.

## 4. The change, step by step

### Step 1 — bump the version

File: `package.json`, and `.claude-plugin/plugin.json`.

1. Read the current version:

   ```
   node -p "require('./package.json').version"
   ```

2. This unit's Conventional Commits type is `feat`, so increment MINOR and set PATCH to 0. If the
   command above printed `2.1.0`, the new version is `2.2.0`.

3. REPLACE in `package.json`. FIND (the third line of the file):

   ```json
     "version": "2.1.0",
   ```

   REPLACE with:

   ```json
     "version": "2.2.0",
   ```

4. REPLACE in `.claude-plugin/plugin.json`. FIND (the third line of the file, indented by two
   spaces):

   ```json
     "version": "2.1.0",
   ```

   REPLACE with:

   ```json
     "version": "2.2.0",
   ```

   Both files carry the same key and the same old value; edit the `"version"` line in each and
   nothing else.

5. Run `node scripts/check-packaging.mjs` and expect exit code 0 with no output.

Rationale: plan invariant `P4` — the two manifests bump in the same commit.

### Step 2 — create the shared schema-node walker

File: `test/support/schema-nodes.ts`. CREATE. Entire contents, first character to last:

```ts
export type SchemaNode = { path: string; value: unknown }

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const flattenSchemaNodes = (value: unknown, path: string): SchemaNode[] => {
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
```

Rationale: acceptance criterion 1 — one walk, two readers.

### Step 3 — make the description census import the shared walker

File: `test/contract/described.test.ts`. REPLACE.

FIND (exact, unique):

```ts
import { census } from '../support/census.ts'
import { listPublishedTools, type Verdict } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const MINIMUM_DESCRIPTION_LENGTH = 10

type SchemaNode = { path: string; value: unknown }

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

const UNWALKED_SUBSCHEMA_KEYS = ['anyOf', 'oneOf', 'allOf', '$defs', '$ref'] as const
```

REPLACE with:

```ts
import { census } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject, type SchemaNode } from '../support/schema-nodes.ts'
import { listPublishedTools, type Verdict } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const MINIMUM_DESCRIPTION_LENGTH = 10

const UNWALKED_SUBSCHEMA_KEYS = ['anyOf', 'oneOf', 'allOf', '$defs', '$ref'] as const
```

Rationale: acceptance criterion 1. This is a pure move: nothing else in the file changes, and the
two tests it contains keep their names and their behaviour.

### Step 4 — import the artifact type into the resource renderer

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
import type { Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'

const renderCommitLine = (commit: string | null): string =>
```

REPLACE with:

```ts
import type { Artifact, Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'

const NOT_RECORDED = 'not recorded'

const renderCommitLine = (commit: string | null): string =>
```

Rationale: the artifact line needs the type, and every new line that can be absent renders the same
words for absent, which SPEC rule `B2` requires: "Null renders as *not recorded*, never as blank."

### Step 5 — render a criterion's check and result, and add the artifact line

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
const renderDetailCriterionLine = (criterion: Criterion): string =>
  `c${criterion.ordinal} [${detailCriterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${escapeStored(criterion.text)}`

const renderDetailRiskLine = (risk: Risk): string =>
```

REPLACE with:

```ts
const renderDetailCriterionCheckLine = (criterion: Criterion): string =>
  `  check: ${typeof criterion.check === 'string' ? escapeStored(criterion.check) : NOT_RECORDED}`

const renderDetailCriterionResultLine = (criterion: Criterion): string => {
  if (typeof criterion.result !== 'string') return `  result: ${NOT_RECORDED}`
  const status = typeof criterion.result_status === 'string' ? escapeStored(criterion.result_status) : NOT_RECORDED
  return `  result: ${escapeStored(criterion.result)} (${status})`
}

const renderDetailCriterionLine = (criterion: Criterion): string =>
  [
    `c${criterion.ordinal} [${detailCriterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${escapeStored(criterion.text)}`,
    renderDetailCriterionCheckLine(criterion),
    renderDetailCriterionResultLine(criterion)
  ].join('\n')

const renderDetailArtifactLine = (artifact: Artifact): string =>
  `- ${escapeStored(artifact.id)} ${escapeStored(artifact.label)} -> ${escapeStored(artifact.pointer)}`

const renderDetailRiskLine = (risk: Risk): string =>
```

Rationale: acceptance criterion 4, for `thread.completion_criteria[].check`,
`thread.completion_criteria[].result` and `thread.artifacts[].label`. `result` renders with its
status because a result whose status is not shown cannot be told apart from a result that was
verified, and SPEC definition D-2 makes that distinction the whole point of the pair.

The three lines are joined into one string rather than returned as an array of three, because
`test/contract/render-census.test.ts` resolves a `.join()` call's elements and cannot resolve a bare
array literal returned from a `flatMap` callback. Rejected: returning `string[]` and using
`flatMap` — measured to halt that census as `unclassifiable` at this exact expression.

### Step 6 — render the slug and the artifacts block on the thread resource

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
  const criteriaLines = thread.completion_criteria.map(renderDetailCriterionLine)
  const riskLines = thread.spine.open_risks.map(renderDetailRiskLine)
```

REPLACE with:

```ts
  const criteriaLines = thread.completion_criteria.map(renderDetailCriterionLine)
  const artifactLines = (thread.artifacts ?? []).map(renderDetailArtifactLine)
  const riskLines = thread.spine.open_risks.map(renderDetailRiskLine)
```

Then, in the same file, REPLACE.

FIND (exact, unique):

```ts
    `Id: ${escapeStored(thread.id)}`,
    `Status: ${escapeStored(thread.status)}`,
```

REPLACE with:

```ts
    `Id: ${escapeStored(thread.id)}`,
    `Slug: ${escapeStored(thread.slug)}`,
    `Status: ${escapeStored(thread.status)}`,
```

Then, in the same file, REPLACE.

FIND (exact, unique):

```ts
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Related:',
```

REPLACE with:

```ts
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Artifacts:',
    ...artifactLines,
    'Related:',
```

Rationale: acceptance criterion 4, for `thread.slug` and `thread.artifacts[].label`. `artifacts` is
optional in the stored record, so `?? []` renders an empty block rather than throwing; the heading
still prints, which is how every other block on this surface behaves.

### Step 7 — create the content-to-surface census

File: `test/contract/content-rendered.test.ts`. CREATE. The entire file is given in section 5.1.

Rationale: acceptance criteria 2, 3, 4 and 5.

## 5. Tests

### 5.1 `test/contract/content-rendered.test.ts` — CREATE

Entire contents, first character to last:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { census, type Classified } from '../support/census.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { flattenSchemaNodes, isPlainObject, type SchemaNode } from '../support/schema-nodes.ts'
import { ISO_PATTERN, SHA_PATTERN, SLUG_PATTERN, ULID_PATTERN } from '../../src/schema/ids.ts'
import { POINTER_PATTERN } from '../../src/schema/field-class.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import {
  renderDecisionResource,
  renderSessionEntryResource,
  renderThreadDetail
} from '../../src/server/resource-render.ts'

const FIELD_CLASSES: readonly string[] = ['structural', 'pointer', 'content']

const sentinelFor = (index: number): string => `zq-${String(index).padStart(3, '0')}-sentinel`

const halt = (path: string, detail: string): never => {
  throw new Error(`content-rendered: ${path} ${detail}`)
}

const nonNullBranch = (node: Record<string, unknown>, path: string): Record<string, unknown> => {
  const anyOf = node.anyOf
  if (anyOf === undefined) return node
  if (!Array.isArray(anyOf)) return halt(path, 'carries an anyOf that is not an array')
  const members = anyOf.filter(isPlainObject).filter((member) => member.type !== 'null')
  const only = members[0]
  if (members.length !== 1 || only === undefined) {
    return halt(path, `carries an anyOf with ${members.length} non-null members; the sweep resolves exactly one`)
  }
  return only
}

const placeholderFor = (node: Record<string, unknown>, path: string): string => {
  const pattern = node.pattern
  if (pattern === undefined) {
    const minLength = typeof node.minLength === 'number' ? node.minLength : 1
    return 'x'.repeat(Math.max(minLength, 1))
  }
  if (pattern === ULID_PATTERN.source) return '0'.repeat(26)
  if (pattern === SLUG_PATTERN.source) return 'a'
  if (pattern === ISO_PATTERN.source) return '2024-01-01T00:00:00.000Z'
  if (pattern === SHA_PATTERN.source) return '0'.repeat(40)
  if (pattern === POINTER_PATTERN.source) return 'docs/example.md'
  return halt(path, `carries pattern ${String(pattern)}, which the sweep cannot synthesise a value for`)
}

const sentinelValueFor = (node: Record<string, unknown>, path: string, sentinel: string): string => {
  const maxLength = node.maxLength
  if (typeof maxLength === 'number' && maxLength < sentinel.length) {
    return halt(path, `caps at ${maxLength} characters, shorter than the ${sentinel.length}-character sentinel`)
  }
  const pattern = node.pattern
  if (pattern === undefined) return sentinel
  if (pattern === SLUG_PATTERN.source) return sentinel
  if (pattern === POINTER_PATTERN.source) return sentinel
  return halt(path, `is class content and carries pattern ${String(pattern)}, which the sentinel does not satisfy`)
}

const buildValue = (node: unknown, path: string, sentinels: ReadonlyMap<string, string>): unknown => {
  if (!isPlainObject(node)) return halt(path, 'is not a plain-object schema node')
  if ('$ref' in node) return halt(path, 'carries a $ref the sweep does not follow')
  const resolved = nonNullBranch(node, path)
  const enumValues = resolved.enum
  if (Array.isArray(enumValues)) {
    const first = enumValues[0]
    if (first === undefined) return halt(path, 'declares an empty enum')
    return first
  }
  const type = resolved.type
  if (type === 'string') {
    const sentinel = sentinels.get(path)
    return sentinel === undefined ? placeholderFor(resolved, path) : sentinelValueFor(resolved, path, sentinel)
  }
  if (type === 'integer' || type === 'number') {
    return typeof resolved.minimum === 'number' ? resolved.minimum : 1
  }
  if (type === 'boolean') return true
  if (type === 'array') return [buildValue(resolved.items, `${path}[]`, sentinels)]
  if (type === 'object') {
    const properties = resolved.properties
    if (!isPlainObject(properties)) return halt(path, 'is an object node with no properties map')
    const built: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(properties)) {
      built[key] = buildValue(child, `${path}.${key}`, sentinels)
    }
    return built
  }
  return halt(path, `has type ${String(type)}, which the sweep cannot synthesise`)
}

const classOf = (node: SchemaNode): string | undefined => {
  if (!isPlainObject(node.value)) return undefined
  const declared = node.value.class
  return typeof declared === 'string' ? declared : undefined
}

const isStringNode = (node: SchemaNode): boolean => {
  if (!isPlainObject(node.value)) return false
  if ('$ref' in node.value) return false
  const resolved = nonNullBranch(node.value, node.path)
  return resolved.type === 'string' && !Array.isArray(resolved.enum)
}

const RECORDS = [ThreadRecord, DecisionRecord, SessionRecord, BindingRecord] as const

const allNodes = (): SchemaNode[] =>
  RECORDS.flatMap((record) => flattenSchemaNodes(record.jsonSchema, record.name))

const sentinelMap = (nodes: readonly SchemaNode[]): Map<string, string> => {
  const map = new Map<string, string>()
  let index = 0
  for (const node of nodes) {
    if (classOf(node) !== 'content') continue
    if (!isStringNode(node)) continue
    map.set(node.path, sentinelFor(index))
    index += 1
  }
  return map
}

const parsedOr = <T>(declared: Declared<T>, built: unknown): T => {
  const parsed = declared.parse(built)
  assert.ok(
    parsed.ok,
    `content-rendered: the synthesised ${declared.name} record did not parse: ${parsed.ok ? '' : parsed.message}`
  )
  return parsed.value
}

const renderedSurfaces = (sentinels: ReadonlyMap<string, string>): string => {
  const thread = parsedOr<Thread>(ThreadRecord, buildValue(ThreadRecord.jsonSchema, 'thread', sentinels))
  const decision = parsedOr<Decision>(DecisionRecord, buildValue(DecisionRecord.jsonSchema, 'decision', sentinels))
  const entry = parsedOr<SessionEntry>(SessionRecord, buildValue(SessionRecord.jsonSchema, 'session', sentinels))
  parsedOr(BindingRecord, buildValue(BindingRecord.jsonSchema, 'binding', sentinels))

  return [
    renderThreadDetail(thread, { resolved: 0, dangling: [], quarantined: [] }, null, null),
    renderDecisionResource(decision),
    renderSessionEntryResource(entry)
  ].join('\n')
}

const classify = (
  node: SchemaNode,
  sentinels: ReadonlyMap<string, string>,
  rendered: string
): Classified<SchemaNode>['verdict'] | 'unclassifiable' => {
  if (!isPlainObject(node.value)) return 'unclassifiable'
  if ('$ref' in node.value) return 'unclassifiable'
  const declared = node.value.class
  if (declared === undefined) return 'forbidden'
  if (typeof declared !== 'string') return 'unclassifiable'
  if (!FIELD_CLASSES.includes(declared)) return 'unclassifiable'
  if (declared !== 'content') return 'allowed'
  const own = sentinels.get(node.path)
  if (own !== undefined) return rendered.includes(own) ? 'allowed' : 'forbidden'
  const element = sentinels.get(`${node.path}[]`)
  if (element === undefined) return 'unclassifiable'
  return rendered.includes(element) ? 'allowed' : 'forbidden'
}

const report = (nodes: readonly SchemaNode[], sentinels: ReadonlyMap<string, string>, rendered: string): string => {
  const unrendered = nodes.filter((node) => classify(node, sentinels, rendered) !== 'allowed').map((node) => node.path)
  return [`content-rendered: ${unrendered.length} of ${nodes.length} record schema nodes are not allowed`, ...unrendered].join('\n')
}

test('content.every-content-field-reaches-a-rendered-surface', () => {
  const nodes = allNodes()
  assert.ok(nodes.length > 0, 'content-rendered: the four record schemas flattened to no nodes')
  const sentinels = sentinelMap(nodes)
  assert.ok(sentinels.size > 0, 'content-rendered: no content-class string field was found')
  const rendered = renderedSurfaces(sentinels)
  assert.doesNotThrow(
    () => census(nodes, (node) => classify(node, sentinels, rendered)),
    report(nodes, sentinels, rendered)
  )
})

test('content.every-content-field-reaches-a-rendered-surface.control.halts-on-an-unrendered-or-undeclared-field', () => {
  const probeSentinel = sentinelFor(999)
  const sentinels = new Map([['probe.unrendered', probeSentinel]])
  const emptySurface = 'a surface that renders nothing'
  const unrendered: SchemaNode = { path: 'probe.unrendered', value: { type: 'string', class: 'content' } }

  assert.equal(classify(unrendered, sentinels, emptySurface), 'forbidden')
  assert.throws(() => census([unrendered], (node) => classify(node, sentinels, emptySurface)))
  assert.equal(classify(unrendered, sentinels, `it says ${probeSentinel} here`), 'allowed')

  assert.equal(
    classify({ path: 'probe.undeclared', value: { type: 'string' } }, sentinels, emptySurface),
    'forbidden'
  )
  assert.equal(
    classify({ path: 'probe.wrong-class', value: { type: 'string', class: 'wire' } }, sentinels, emptySurface),
    'unclassifiable'
  )
  assert.equal(
    classify({ path: 'probe.referenced', value: { $ref: '#/$defs/probe' } }, sentinels, emptySurface),
    'unclassifiable'
  )
  assert.equal(classify({ path: 'probe.scalar', value: 'string' }, sentinels, emptySurface), 'unclassifiable')
})

test('content.every-content-field-reaches-a-rendered-surface.control.the-builder-halts-on-what-it-cannot-synthesise', () => {
  assert.throws(
    () => buildValue({ type: 'string', pattern: '^probe$' }, 'probe.exotic', new Map()),
    /content-rendered: probe\.exotic carries pattern \^probe\$/
  )
  assert.throws(
    () => buildValue({ type: 'tuple' }, 'probe.exotic-type', new Map()),
    /content-rendered: probe\.exotic-type has type tuple/
  )
  assert.throws(
    () => buildValue({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 'probe.two-branches', new Map()),
    /content-rendered: probe\.two-branches carries an anyOf with 2 non-null members/
  )
})
```

### 5.2 How the census decides "appears on at least one rendered surface"

Read this before changing anything in section 5.1.

The census never consults a written list of which field goes on which surface. Such a list would be
a second source of truth, and it would go stale the moment a field is added. Instead it does this,
in four steps:

1. It flattens each record's generated JSON Schema into nodes, using the walker from step 2. Every
   node has a path such as `thread.spine.open_risks[].text`.
2. It gives every node whose declared class is `content` and whose resolved type is `string` a unique
   sentinel string, `zq-000-sentinel`, `zq-001-sentinel`, and so on. The sentinel is lowercase
   letters, digits and hyphens only, so it survives `escapeStored` unchanged and it satisfies the
   only pattern any content field carries, the thread slug's.
3. It builds one whole record of each type from the schema itself — every property present, one
   element in every array, the non-null branch of every nullable — planting each field's own
   sentinel in it. The built record is then parsed by the record's own schema, so a record that
   could not legally exist cannot be swept.
4. It renders all four records through the three surfaces and asks, for each content node, whether
   that node's sentinel occurs anywhere in the rendered text.

A `content` node that is an **array** rather than a string carries no sentinel of its own; it is
decided by its element node, whose path is the array's path plus `[]`. If that element node does not
exist, the census halts as `unclassifiable` rather than guessing.

Three limits are real, and all three fail in the same safe direction — they can produce a false
**red**, never a false green, because "rendered" is defined as "this exact text came out of the
renderer", and no gap in the sweep can make text appear that a renderer did not emit:

- **The surface set is written down.** Three functions are named in `renderedSurfaces`. A future
  fourth surface would not be swept, so a field rendered only there would be reported unrendered.
- **One record shape is swept, not every shape.** Booleans are built `true` and enums take their
  first value. A field that a renderer shows only when some other field holds a particular value
  would be reported unrendered. On this surface that is the correct verdict anyway: the thread
  resource is the read-one-record-in-full surface, and hiding a field there conditionally is what
  `LG6` forbids.
- **A renderer that transforms text would lose the sentinel.** The sentinel is fifteen characters
  and passes `escapeStored` byte for byte, so no shipped transform touches it; a future one that
  clipped below fifteen characters would report a false red.

What the sweep cannot do is pass a field that no renderer emits. That is the property `O4` needs.

### 5.3 Which test discharges which criterion

| Criterion | Test that discharges it |
|---|---|
| 1 — the shared walker | `contract.every-property-described` (it imports the walker and still passes) plus `npm run typecheck` |
| 2 — the census halts on an undeclared or unrecognised class | `content.every-content-field-reaches-a-rendered-surface.control.halts-on-an-unrendered-or-undeclared-field` |
| 3 — the decision is made by rendering | `content.every-content-field-reaches-a-rendered-surface` |
| 4 — the census is green | `content.every-content-field-reaches-a-rendered-surface` |
| 5 — the controls | both `.control.` tests named in 5.1 |
| 6 — typecheck and packaging | `npm run typecheck`, `node scripts/check-packaging.mjs` |
| SPEC invariant `O4` | `content.every-content-field-reaches-a-rendered-surface` |

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time — the commit `feat/u6a-content-rendered`
was cut from. Print it and write it down:

```
git rev-parse HEAD
```

Apply step 2 and step 7 only — create `test/support/schema-nodes.ts` and
`test/contract/content-rendered.test.ts`. Do not apply steps 4, 5 or 6. Then run:

```
node --experimental-strip-types --test test/contract/content-rendered.test.ts
```

Expect exit code 1, with `pass 2` and `fail 1`, and this text in the output:

```
content-rendered: 4 of 67 record schema nodes are not allowed
thread.slug
thread.completion_criteria[].check
thread.completion_criteria[].result
thread.artifacts[].label
```

and this text:

```
census rejected a forbidden item: {"path":"thread.slug",
```

The two `.control.` tests pass at the parent, which is correct: they assert the census halts, and it
halts either way.

`contract.every-property-described` is a pure move (step 3) and has no red on the parent; it passes
before the move and after it. That is stated here rather than left as a gap: plan invariant `P11`
asks for a receipt on a behavioural change, and moving a function between files is not one.

Then apply steps 1, 4, 5 and 6 and re-run the same command. Expect exit code 0 with `pass 3` and
`fail 0`.

## 7. Inertness mutation

One per acceptance criterion that carries a behavioural change. Each mutation is applied to the
finished tree, the named test is run, the named text is expected, and the mutation is then reverted
exactly.

### 7.1 The slug line (criterion 4, `thread.slug`)

Revert: in `src/server/resource-render.ts`, delete the line

```ts
    `Slug: ${escapeStored(thread.slug)}`,
```

Run `node --experimental-strip-types --test test/contract/content-rendered.test.ts`. Expect exit
code 1 and this text:

```
content-rendered: 1 of 67 record schema nodes are not allowed
thread.slug
```

Restore: put that exact line back, immediately after the `` `Id: ${escapeStored(thread.id)}`, `` line.

### 7.2 The criterion check line (criterion 4, `thread.completion_criteria[].check`)

Revert: in `src/server/resource-render.ts`, delete the line

```ts
    renderDetailCriterionCheckLine(criterion),
```

from the array inside `renderDetailCriterionLine`. Run the same command. Expect exit code 1 and:

```
content-rendered: 1 of 67 record schema nodes are not allowed
thread.completion_criteria[].check
```

Restore: put that exact line back, between the `c${criterion.ordinal}` template and
`renderDetailCriterionResultLine(criterion)`.

### 7.3 The artifacts block (criterion 4, `thread.artifacts[].label`)

Revert: in `src/server/resource-render.ts`, delete these two lines from the returned array of
`renderThreadDetail`:

```ts
    'Artifacts:',
    ...artifactLines,
```

Run the same command. Expect exit code 1 and:

```
content-rendered: 1 of 67 record schema nodes are not allowed
thread.artifacts[].label
```

Restore: put both lines back, immediately after the `` `Last session: ...`, `` line and before
`'Related:',`.

### 7.4 The shared walker (criterion 1)

Revert: in `test/support/schema-nodes.ts`, change the body of `flattenSchemaNodes` to
`return []` and delete every line between `export const flattenSchemaNodes = (value: unknown, path: string): SchemaNode[] => {`
and the closing brace. Run:

```
node --experimental-strip-types --test test/contract/content-rendered.test.ts
```

Expect exit code 1 and this text:

```
content-rendered: the four record schemas flattened to no nodes
```

Restore: put the whole body from step 2 back.

## 8. Full verification

Run each command from the repository root, in this order.

1. ```
   npm run typecheck
   ```
   Expect exit code 0 and no output.

2. ```
   node scripts/check-packaging.mjs
   ```
   Expect exit code 0 and no output.

3. ```
   node --experimental-strip-types --test test/contract/content-rendered.test.ts test/contract/described.test.ts test/contract/render-census.test.ts test/unit/resource-render.test.ts
   ```
   Expect exit code 0 and this text in the output:
   ```
   # fail 0
   ```

4. ```
   npm test
   ```
   Expect exit code 0 and `# fail 0`.

   If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
   that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
   If it passes on the re-run, proceed, and record in the pull request body a
   `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
   If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
   and do not edit, skip, focus or delete any test.

Never run `npm ci` or `npm install`. `node_modules` is tracked in this repository and an install
rewrites tracked files.

## 9. Commits

### Commit 1 — the move

```
refactor(discovery): share one schema-node walker between the two censuses
```

Files: `test/support/schema-nodes.ts`, `test/contract/described.test.ts`.
Plan steps: 2, 3.

### Commit 2 — the behaviour change

```
feat(discovery): render every content field on the thread resource
```

Files: `src/server/resource-render.ts`.
Plan steps: 4, 5, 6.

### Commit 3 — the census

```
test(discovery): census every content-class field against a rendered surface
```

Files: `test/contract/content-rendered.test.ts`.
Plan step: 7.

### Commit 4 — the version

```
chore(release): bump the minor version for the content-render change
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Plan step: 1.

Commit 1 is a refactor and carries no behaviour change. Commit 2 is the behaviour change. They are
separate commits and never share one.

## 10. Pull request

Measured diff size: **318 changed lines** — 281 insertions and 37 deletions across 6 files, measured
by applying every step of this plan to a throwaway copy of the tree and running
`git diff --cached --shortstat`. Of those, 30 lines are production code and manifests
(`src/server/resource-render.ts` 26, the two version lines 4) and 288 are tests
(`test/contract/content-rendered.test.ts` 222, `test/contract/described.test.ts` 34,
`test/support/schema-nodes.ts` 32). That is below the 400-line ceiling; no further split.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u6a-content-rendered --base main \
  --title "feat(discovery): render every content field on the thread resource" \
  --what "Reading one thread now shows its short label, the artifacts it produced, and for each goal both the check that decides it and the result that was observed." \
  --what "A new check walks every field of every stored record type and proves, by rendering, that each field a human wrote reaches a surface a reader can see." \
  --why "Four fields a human writes were stored and shown nowhere, so a reader of a record could not see all of it." \
  --why "Whether a stored field was displayed anywhere was decided by reading the code, which no check enforced and which drifts the moment a field is added." \
  --risk "The new check reads three display surfaces by name, so a display surface added later is not covered until it is added to the list." \
  --verified "node --experimental-strip-types --test test/contract/content-rendered.test.ts - 3 pass, 0 fail" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "npm test - fail 0" \
  --not-verified "npm run mutate - not run" \
  --not-verified "npm run coverage - not run"
```

Replace each `--verified` line with `--not-verified "<thing> - not run"` for any check that was not
actually run. Never write a `Verified:` line for a check that was not run.

## 11. Stop conditions

Each condition below is checked before the step it guards. When one triggers: STOP and report; do
not improvise.

### 11.1 The field-class module has not landed

Run:

```
node -e "import('./src/schema/field-class.ts').then((m) => console.log(typeof m.POINTER_PATTERN))"
```

If the output is not `object`, the schema change this unit depends on is not on this branch's base.
STOP and report; do not improvise.

### 11.2 The goal-model fields have not landed

Run:

```
node -e "import('./src/schema/thread.ts').then((m) => console.log(Object.keys(m.ThreadRecord.jsonSchema.properties).join(',')))"
```

If the output does not contain `artifacts`, the thread schema this unit renders is not on this
branch's base. STOP and report; do not improvise.

### 11.3 The census population is not 67 nodes

Run, after applying step 2 and step 7 only:

```
node --experimental-strip-types --test test/contract/content-rendered.test.ts
```

If the failure message names a total other than `of 67 record schema nodes`, the record schemas
differ from the ones this plan was written against. STOP and report; do not improvise. Do not adjust
the number in this document, and do not narrow the census to reach it.

### 11.4 The two manifests disagree before the change

Run:

```
node -p "[require('./package.json').version, require('./.claude-plugin/plugin.json').version].join(' ')"
```

If the two values are not equal, STOP and report; do not improvise. A version merely HIGHER than the
`2.1.0` baseline means the ladder shifted and is NOT a stop condition — increment from what you read.

### 11.5 A FIND string does not appear exactly once

For every FIND block in section 4, the text must occur exactly once in the named file. If it occurs
zero times or more than once, STOP and report; do not improvise, and do not guess at a nearby match.

### 11.6 The suite

```
Run: npm test
If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
If it passes on the re-run, proceed, and record in the pull request body a
`--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
and do not edit, skip, focus or delete any test.
```
