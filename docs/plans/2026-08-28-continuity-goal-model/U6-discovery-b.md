# U6-B — Discovery: a published address for every record type

## 0. Identity

- **Closes:** SPEC section 8 rules `B25`, `B26`, `B27` and `B28`; SPEC section 7 defects `D7` and
  `D8`.
- **Depends on:** `U6-A`, which must already be merged into this branch's base. `U6-A` created
  `test/contract/content-rendered.test.ts` and `test/support/schema-nodes.ts`, and added the slug,
  artifact, check and result lines to `src/server/resource-render.ts`. This unit edits the same file
  and the same test. Section 11 turns that into a checkable stop condition.
- **Required by:** nothing later in the ladder.
- **Wave:** 2. Cut from a `main` that already contains `U6-A`.
- **Branch name:** `feat/u6b-discovery-addresses`
- **Version bump:** Baseline `2.2.0` -> `2.3.0` per orchestrator ruling OR1, adjusted for the split
  of `U6` into two pull requests. The step itself is a read-then-increment; see step 1.
- **Creates:** no new files.
- **SPEC anchors:** section 9 unit `U6`; section 8 rules `B25`, `B26`, `B27`, `B28`; section 7
  defects `D7`, `D8`; section 4.1 goals `LG6`, `LG7`, `LG14`.

## 1. Acceptance criteria (the ceiling)

1. A new resource `logbook://sessions/{thread_id}` returns, for one thread, every session-log entry
   id it holds together with the first line of each, newest first. Reading it for a thread id that
   names no thread record is refused, not answered with an empty listing. (Discharges `B25` and
   defect `D7`.)
2. `logbook://index` lists `logbook://sessions/{thread_id}` alongside the five addresses it already
   lists. (Discharges `B26`.)
3. The thread resource renders every binding bound to that thread, each with its binding id and its
   branch name. (Discharges `B27` and defect `D8`.)
4. The thread resource template gains a `list` callback, so `resources/list` returns more than the
   two entries it returns today. The decision template and the single-session-entry template do NOT
   gain one, and neither does the new sessions template. (Discharges `B28`.)
5. `resources/list` names only non-terminal threads: a thread closed as done or abandoned disappears
   from it. (Discharges `B28`'s `LG14` clause — what is enumerated is bounded by open work, not by
   total history.)
6. A model holding nothing but this server's published surfaces can obtain an id for a thread, a
   decision, a session entry and a binding without guessing: the thread id from `resources/list`, the
   decision id from the `Key decisions:` block of the thread resource, the session entry id from the
   new sessions resource, and the binding id from the `Bindings:` block of the thread resource.
   (Discharges the unit's `Green` clause.)
7. The content-to-surface census `content.every-content-field-reaches-a-rendered-surface` stays
   green after this change. (Preserves `O4`, which `U6-A` closed.)
8. `npm run typecheck` exits 0 and `node scripts/check-packaging.mjs` exits 0, with `package.json`
   and `.claude-plugin/plugin.json` carrying the same version. (Discharges `P1` and `P4`.)

Anything discovered above this list is appended to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item and is NOT folded into this plan.

## 2. Ground truth

### 2.1 `src/server/resources.ts` lines 22-34 — the published address list

Current source, read at the tip of `main`:

```ts
const ADDRESSES: readonly Address[] = [
  { shape: 'logbook://index', description: 'lists every address this server publishes, one per line, this line included' },
  { shape: 'logbook://roster', description: 'the resumable roster, the same content list_threads returns' },
  {
    shape: 'logbook://thread/{id}',
    description: 'one thread record in full, every risk and criterion id shown, resolved by its id or its slug'
  },
  { shape: 'logbook://decision/{id}', description: 'one decision record, resolved by its id' },
  {
    shape: 'logbook://session/{thread_id}/{entry_id}',
    description: 'one session-log entry, resolved by its thread id and its own id'
  }
]
```

What is wrong with it: there is no address that lists a thread's session entries. SPEC defect `D7`
records the consequence — session entry ids are reachable only through the MCP `completion/complete`
channel, which exists to autocomplete a value for a human typing in a picker, so a model that is not
a picker cannot reach them at all.

### 2.2 `src/server/resources.ts` lines 184-200 — the thread template registration

Current source, read at the tip of `main`:

```ts
  server.registerResource(
    'thread',
    new ResourceTemplate('logbook://thread/{id}', {
      list: undefined,
      complete: { id: (value, context) => completeThreadIdentifiers(rt, context, value) }
    }),
    {
      title: 'Thread',
      description: 'One thread record in full, every risk and criterion id shown, resolved by its ULID id or its slug.',
      mimeType: 'text/markdown'
    },
    (uri, variables) => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: readThreadResourceBody(rt, variableAsString(variables, 'id')) }
      ]
    })
  )
```

What is wrong with it: `list: undefined` means `resources/list` returns only the two fixed
addresses, so a client that has never seen a thread id has no way to obtain one from the resource
protocol at all.

### 2.3 `src/server/resources.ts` lines 105-110 — the thread resource body

Current source, read at the tip of `main`, as `U6-A` leaves it:

```ts
  const layout = layoutFor(rt, rt.cwd)
  const pointerRead = layout.ok ? readPointer(rt, layout.value) : { kind: 'absent' as const }
  const pointer = pointerRead.kind === 'pointer' ? pointerRead.value : null

  return renderThreadDetail(thread, decisionIntegrity, pointer, resolvePredecessor(rt, store, thread))
}
```

What is wrong with it: it never reads bindings. SPEC defect `D8` records the state this produces —
"the binding record type is written and read by nothing".

### 2.4 `src/server/tools/bind_branch.ts` lines 78-80 — how a binding is found today

Current source, read at the tip of `main`:

```ts
    const bindingsDir = path.join(layout.value.records, 'bindings')
    const existingSlots = readAllRecordFiles<Binding>(bindingsDir, BindingRecord)
```

Nothing is wrong with it. It is quoted because this unit reads bindings the same way, from the same
directory, with the same function, rather than adding a reader to the `Store` type — which belongs
to another unit's file.

### 2.5 `src/server/tools/log_session_event.ts` line 89 — how an entry body is stored

Current source, read at the tip of `main`:

```ts
    const escapedBody = escapeStored(input.body)
```

What this means for the new sessions listing: `escapeStored` in `src/render/escape.ts` rewrites
every line break to the literal six-character text `U+000A`, so a stored body contains no raw line
break at all. Splitting a stored body on `\n` therefore returns the whole body. The listing splits
on the literal `U+000A` instead, because that is what a line break looks like once stored.

### 2.6 `test/spawn/resources.test.ts` lines 211-214 — the registered-against-index census

Current source, read at the tip of `main`:

```ts
    const indexShapeSet = new Set(shapes)
    const classifyRegisteredAgainstIndex = (registered: string): 'allowed' | 'unclassifiable' =>
      indexShapeSet.has(registered) ? 'allowed' : 'unclassifiable'
```

What is wrong with it once this unit lands: `resources/list` will now also carry concrete instance
URIs such as `logbook://thread/01ARZ3NDEKTSV4RRFFQ69G5FAV`, produced by the new `list` callback.
Those are not literal index shapes, so this classifier halts on every one of them. Widening it to
also accept a URI that MATCHES one of the index's templates is the correct classification, not a
narrowing: an address that matches no shape and no template still halts.

## 3. Divergences from the SPEC

### 3.1 The mitosis decomposition skill is absent from disk

`~/.claude/skills/mitosis/SKILL.md` does not exist. This plan does not depend on it; it was written
against the planning brief and the orchestrator rulings alone, which are jointly self-contained.
The absence is recorded here because the orchestrator asked for it to be recorded, and it changes
nothing in this plan.

### 3.2 `U6` is split, and this is the second half

SPEC section 9 names one unit `U6`. The change measured 596 changed lines against its parent, which
is above the 400-line ceiling, and splitting it destroys no receipt: both halves are red at their own
parent and green after their own change. It is therefore split into two pull requests. `U6-A` ships
the content-to-surface census and the renderer lines that make it green; this document ships the four
discovery rules. `U6-A` merges first, and section 11 proves it landed before any edit begins.

### 3.3 The new sessions template gets no `list` callback, and that is a decision, not an omission

SPEC rule `B28` mandates a `list` callback on the **thread** template and forbids one on the decision
and single-session-entry templates. The `logbook://sessions/{thread_id}` address is new and `B28`
does not mention it. It is given `list: undefined`.

Why: `B28`'s stated reason for withholding a `list` callback is that enumerating an unbounded set
into every client breaches the promise that what Logbook loads is bounded by open work. One sessions
entry per open thread is bounded, so that reason does not apply — but adding a second `list` callback
is a design act `B28` does not authorise, and the thread ids that address it already arrive through
the thread list. Rejected: giving it a `list` callback, which would duplicate the thread list under a
second name for no reader that lacks the first.

### 3.4 Quarantined bindings are counted, not named

A binding record that fails to parse cannot be attributed to a thread, because the field naming its
thread is exactly the field that did not parse. Naming its id under one thread's `Bindings:` block
would assert a relationship that does not resolve, which SPEC goal `LG3` forbids. The thread resource
therefore prints `unreadable binding records: N` when N is above zero and prints nothing when it is
zero. Rejected: listing the record ids under the thread, which fabricates the attribution; and
rejected: dropping them silently, which hides an omission.

### 3.5 This unit's own line citations

SPEC line citations were taken at `e5f0195`. Every line range quoted in section 2 was read from the
working tree while authoring. `src/server/resources.ts` is 244 lines, `src/server/resource-render.ts`
is 108 lines before `U6-A` and `test/spawn/resources.test.ts` is 319 lines.

### 3.6 `src/server/tools/resolve_conflict.ts` contains a byte that is not valid UTF-8

That file may be invisible to `grep`. No census in this unit reads any file under `src/` as text, so
the file is neither missed nor mis-read by anything this unit adds.

## 4. The change, step by step

### Step 1 — bump the version

File: `package.json`, and `.claude-plugin/plugin.json`.

1. Read the current version:

   ```
   node -p "require('./package.json').version"
   ```

2. This unit's Conventional Commits type is `feat`, so increment MINOR and set PATCH to 0. If the
   command above printed `2.2.0`, the new version is `2.3.0`.

3. REPLACE in `package.json`. FIND (the third line of the file):

   ```json
     "version": "2.2.0",
   ```

   REPLACE with:

   ```json
     "version": "2.3.0",
   ```

4. REPLACE in `.claude-plugin/plugin.json`. FIND (the third line of the file, indented by two
   spaces):

   ```json
     "version": "2.2.0",
   ```

   REPLACE with:

   ```json
     "version": "2.3.0",
   ```

5. Run `node scripts/check-packaging.mjs` and expect exit code 0 with no output.

Rationale: plan invariant `P4`.

### Step 2 — add the sessions renderer and the binding line to the resource renderer

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
import { escapeStored } from '../render/escape.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Artifact, Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'

const NOT_RECORDED = 'not recorded'
```

REPLACE with:

```ts
import { clipGraphemes, escapeStored } from '../render/escape.ts'
import type { Binding } from '../schema/binding.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Artifact, Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'

export type BindingIntegrity = { bound: Binding[]; unreadable: number }

export type SessionsListing = { threadId: string; entries: SessionEntry[]; quarantined: string[] }

const NOT_RECORDED = 'not recorded'
const STORED_LINE_BREAK = 'U+000A'
const SESSION_FIRST_LINE_MAX = 200
const SESSION_FIRST_LINE_CLIPPED_NOTE =
  'some entry first lines were shortened to fit this listing; read the entry in full for the rest'
```

Rationale: `B25` needs a listing type and a first-line budget; `B27` needs a binding-integrity type.

### Step 3 — add the sessions listing renderer

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
const detailCriterionStatus = (criterion: Criterion): string => {
```

REPLACE with:

```ts
const firstStoredLine = (body: string): string => body.split(STORED_LINE_BREAK)[0] ?? ''

const renderSessionsEntryLine = (entry: SessionEntry): string =>
  `- ${escapeStored(entry.id)} [${escapeStored(entry.created_at)}] ${clipGraphemes(escapeStored(firstStoredLine(entry.body)), SESSION_FIRST_LINE_MAX)}`

const firstLineWasClipped = (entry: SessionEntry): boolean =>
  escapeStored(firstStoredLine(entry.body)).length > SESSION_FIRST_LINE_MAX

const renderDetailQuarantinedLine = (id: string): string => `quarantined: ${escapeStored(id)}`

export const renderSessionsResource = (listing: SessionsListing): string => {
  const count = listing.entries.length
  return [
    `Sessions: ${count} entr${count === 1 ? 'y' : 'ies'} for thread ${escapeStored(listing.threadId)}`,
    ...listing.entries.map(renderSessionsEntryLine),
    ...listing.quarantined.map(renderDetailQuarantinedLine),
    ...listing.entries.filter(firstLineWasClipped).slice(0, 1).map(() => SESSION_FIRST_LINE_CLIPPED_NOTE),
    `Read one in full at logbook://session/${escapeStored(listing.threadId)}/{entry_id}`
  ].join('\n')
}

const detailCriterionStatus = (criterion: Criterion): string => {
```

Rationale: `B25`. `renderDetailQuarantinedLine` moves up here because it is now used by two
renderers; step 5 deletes its old definition, so the file still holds exactly one.

The clipped note is emitted through `.filter(...).slice(0, 1).map(...)` rather than a conditional,
because `test/contract/render-census.test.ts` resolves a mapped array's elements and cannot resolve a
conditional that yields an array. `src/render/briefing.ts:250` already uses the same shape for the
same reason. Rejected: a ternary yielding `[]` or `[note]` — measured to halt that census.

### Step 4 — add the binding line

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
const renderDetailRiskLine = (risk: Risk): string =>
```

REPLACE with:

```ts
const renderDetailBindingLine = (binding: Binding): string =>
  `- ${escapeStored(binding.id)} ${escapeStored(binding.branch)}`

const renderDetailRiskLine = (risk: Risk): string =>
```

Rationale: `B27`.

### Step 5 — remove the old quarantined-line definition

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
const renderDetailDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`

const renderDetailQuarantinedLine = (decisionId: string): string => `quarantined: ${escapeStored(decisionId)}`

const renderDetailRelatedLine = (predecessor: Thread): string =>
```

REPLACE with:

```ts
const renderDetailDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`

const renderDetailRelatedLine = (predecessor: Thread): string =>
```

Rationale: step 3 moved this function above its first use; leaving both copies would not compile.

### Step 6 — take bindings on the thread resource renderer

File: `src/server/resource-render.ts`. REPLACE.

FIND (exact, unique):

```ts
  predecessor: Thread | null
): string => {
  const criteriaLines = thread.completion_criteria.map(renderDetailCriterionLine)
```

REPLACE with:

```ts
  predecessor: Thread | null,
  bindings: BindingIntegrity
): string => {
  const criteriaLines = thread.completion_criteria.map(renderDetailCriterionLine)
```

Then, in the same file, REPLACE.

FIND (exact, unique):

```ts
  const quarantinedLines = decisionIntegrity.quarantined.map(renderDetailQuarantinedLine)
  const relatedThreads = predecessor === null ? [] : [predecessor]
```

REPLACE with:

```ts
  const quarantinedLines = decisionIntegrity.quarantined.map(renderDetailQuarantinedLine)
  const bindingLines = bindings.bound.map(renderDetailBindingLine)
  const bindingUnreadableLines = [bindings.unreadable]
    .filter((count) => count > 0)
    .map((count) => `unreadable binding records: ${count}`)
  const relatedThreads = predecessor === null ? [] : [predecessor]
```

Then, in the same file, REPLACE.

FIND (exact, unique):

```ts
    'Out of scope:',
    ...outOfScopeLines,
    'Decisions:',
```

REPLACE with:

```ts
    'Out of scope:',
    ...outOfScopeLines,
    'Bindings:',
    ...bindingLines,
    ...bindingUnreadableLines,
    'Decisions:',
```

Rationale: `B27`, and divergence 3.4 for the unreadable count.

### Step 7 — import what the resource layer needs

File: `src/server/resources.ts`. REPLACE.

FIND (exact, unique):

```ts
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import type { Runtime } from '../runtime/runtime.ts'
import type { Slot, Store, Thread } from '../store/records.ts'
import { layoutFor } from '../store/layout.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'
import { paginateRoster, renderRoster, selectRosterThreads, toRosterRow } from '../render/roster.ts'
import { openProjectStore, resolvePredecessor } from './tool-support.ts'
import { renderDecisionResource, renderSessionEntryResource, renderThreadDetail } from './resource-render.ts'
```

REPLACE with:

```ts
import path from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ListResourcesResult } from '@modelcontextprotocol/sdk/types.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import type { Runtime } from '../runtime/runtime.ts'
import type { Slot, Store, Thread } from '../store/records.ts'
import { layoutFor } from '../store/layout.ts'
import { readAllRecordFiles } from '../store/read-path.ts'
import { BindingRecord, type Binding } from '../schema/binding.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'
import { paginateRoster, renderRoster, selectRosterThreads, toRosterRow } from '../render/roster.ts'
import { openProjectStore, resolvePredecessor } from './tool-support.ts'
import {
  renderDecisionResource,
  renderSessionEntryResource,
  renderSessionsResource,
  renderThreadDetail,
  type BindingIntegrity
} from './resource-render.ts'
```

Rationale: `B25` and `B27` need the new renderer and the binding record; `B28` needs the SDK's
list-result type.

### Step 8 — publish the sessions address in the index

File: `src/server/resources.ts`. REPLACE.

FIND (exact, unique):

```ts
  { shape: 'logbook://decision/{id}', description: 'one decision record, resolved by its id' },
  {
    shape: 'logbook://session/{thread_id}/{entry_id}',
```

REPLACE with:

```ts
  { shape: 'logbook://decision/{id}', description: 'one decision record, resolved by its id' },
  {
    shape: 'logbook://sessions/{thread_id}',
    description: 'every session-log entry id for one thread with the first line of each, newest first'
  },
  {
    shape: 'logbook://session/{thread_id}/{entry_id}',
```

Rationale: `B26`.

### Step 9 — read a thread's bindings

File: `src/server/resources.ts`. REPLACE.

FIND (exact, unique):

```ts
const readThreadResourceBody = (rt: Runtime, id: string): string => {
```

REPLACE with:

```ts
const readBindingsForThread = (rt: Runtime, threadId: string): BindingIntegrity => {
  const layout = layoutFor(rt, rt.cwd)
  if (!layout.ok) {
    rt.log({ level: 'error', event: 'resource.thread-bindings-unreadable', detail: layout.message })
    return { bound: [], unreadable: 0 }
  }
  const slots = readAllRecordFiles<Binding>(path.join(layout.value.records, 'bindings'), BindingRecord)
  const bound: Binding[] = []
  let unreadable = 0
  for (const slot of slots) {
    if (slot.quarantined) {
      unreadable += 1
      rt.log({ level: 'error', event: 'resource.thread-binding-quarantined', detail: slot.reason })
      continue
    }
    if (slot.record.thread_id === threadId) bound.push(slot.record)
  }
  return { bound, unreadable }
}

const readThreadResourceBody = (rt: Runtime, id: string): string => {
```

Rationale: `B27`. Reading through `readAllRecordFiles` rather than through the `Store` type keeps
this unit inside its own files; `src/server/tools/bind_branch.ts:80` already reads bindings the same
way.

### Step 10 — pass the bindings, and add the sessions body and the thread list

File: `src/server/resources.ts`. REPLACE.

FIND (exact, unique):

```ts
  return renderThreadDetail(thread, decisionIntegrity, pointer, resolvePredecessor(rt, store, thread))
}
```

REPLACE with:

```ts
  return renderThreadDetail(
    thread,
    decisionIntegrity,
    pointer,
    resolvePredecessor(rt, store, thread),
    readBindingsForThread(rt, thread.id)
  )
}

const readSessionsResourceBody = (rt: Runtime, threadId: string): string => {
  const store = openStoreForRead(rt, 'logbook://sessions')
  const slot = store.readThread(threadId)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://sessions: no thread record matches id '${escapeStored(threadId)}'`
    )
  }
  const entries = store.readSessionEntries(threadId)
  const loaded = entries.flatMap((entry) => (entry.quarantined ? [] : [entry.record]))
  const quarantined = entries.flatMap((entry) =>
    entry.quarantined ? [path.basename(entry.path, '.json')] : []
  )
  return renderSessionsResource({
    threadId,
    entries: [...loaded].reverse(),
    quarantined
  })
}

const listThreadResources = (rt: Runtime): ListResourcesResult => {
  const opened = openProjectStore(rt)
  if (!opened.ok) {
    rt.log({ level: 'error', event: 'resource.thread-list-unavailable', detail: opened.refusal.message })
    return { resources: [] }
  }
  const threads = opened.value.readThreads().flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
  return {
    resources: selectRosterThreads(threads).map((thread) => ({
      uri: `logbook://thread/${escapeStored(thread.id)}`,
      name: escapeStored(thread.slug),
      title: escapeStored(thread.title),
      description: `one thread record in full: ${escapeStored(thread.title)}`,
      mimeType: 'text/markdown'
    }))
  }
}
```

Rationale: `B27`, `B25` and `B28`.

`readSessionsResourceBody` refuses when the id names no thread record rather than returning an empty
listing, because an empty listing for a typo'd id is a silent success, which plan invariant `P2`
forbids. `readSessionEntries` returns oldest first, so the list is reversed to render newest first.
A quarantined entry is named by the id in its file name, never by its path — the path would disclose
the store's location on disk.

`listThreadResources` returns `{ resources: [] }` and logs when the store cannot be opened, because
the protocol gives a list callback no refusal channel; `src/server/completions.ts:28` already handles
an unopenable store the same way. It selects through `selectRosterThreads`, which drops threads whose
status is `done` or `abandoned`, so what is enumerated is bounded by open work.

### Step 11 — give the thread template its list callback

File: `src/server/resources.ts`. REPLACE.

FIND (exact, unique):

```ts
    new ResourceTemplate('logbook://thread/{id}', {
      list: undefined,
```

REPLACE with:

```ts
    new ResourceTemplate('logbook://thread/{id}', {
      list: () => listThreadResources(rt),
```

Rationale: `B28`.

**Do not make this edit to the other templates.** `logbook://decision/{id}` and
`logbook://session/{thread_id}/{entry_id}` keep `list: undefined`, and so does the new
`logbook://sessions/{thread_id}` registered in step 12. The reason is not style: a decision set and a
session-entry set grow with every decision and every entry ever recorded, including those on threads
that closed years ago. Enumerating either one into every client makes what the client loads grow with
total history instead of with open work, which is exactly the promise `LG14` makes. A change that
adds a `list` callback to all three has broken that promise and has broken invariant `O5` with it.
The ids of those records reach a model by other routes: a decision id from the `Key decisions:` block
of the thread resource, and a session entry id from the sessions resource this unit adds.

### Step 12 — register the sessions resource

File: `src/server/resources.ts`. REPLACE.

FIND (exact, unique):

```ts
  server.registerResource(
    'session',
    new ResourceTemplate('logbook://session/{thread_id}/{entry_id}', {
```

REPLACE with:

```ts
  server.registerResource(
    'sessions',
    new ResourceTemplate('logbook://sessions/{thread_id}', {
      list: undefined,
      complete: { thread_id: (value, context) => completeSessionThreadIds(rt, context, value) }
    }),
    {
      title: 'Session log',
      description:
        'Every session-log entry id for one thread with the first line of each, newest first. Read one in full at logbook://session/{thread_id}/{entry_id}.',
      mimeType: 'text/markdown'
    },
    (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: readSessionsResourceBody(rt, variableAsString(variables, 'thread_id'))
        }
      ]
    })
  )

  server.registerResource(
    'session',
    new ResourceTemplate('logbook://session/{thread_id}/{entry_id}', {
```

Rationale: `B25`. It is registered before the single-entry template so the index and the registration
order agree; the SDK matches templates by URI pattern, not by registration order, and the two patterns
share no match.

### Step 13 — keep the content census compiling against the new signature

File: `test/contract/content-rendered.test.ts`. REPLACE.

FIND (exact, unique):

```ts
    renderThreadDetail(thread, { resolved: 0, dangling: [], quarantined: [] }, null, null),
```

REPLACE with:

```ts
    renderThreadDetail(thread, { resolved: 0, dangling: [], quarantined: [] }, null, null, {
      bound: [],
      unreadable: 0
    }),
```

Rationale: acceptance criterion 7 — step 6 added a fifth parameter to `renderThreadDetail`, and the
census calls it.

### Step 14 — widen the registered-against-index classifier

File: `test/spawn/resources.test.ts`. Two edits.

Edit 1 — REPLACE. FIND (exact, unique):

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
```

REPLACE with:

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import { rawGit } from '../support/git-fixture.ts'
```

Edit 2 — REPLACE. FIND (exact, unique):

```ts
    const indexShapeSet = new Set(shapes)
    const classifyRegisteredAgainstIndex = (registered: string): 'allowed' | 'unclassifiable' =>
      indexShapeSet.has(registered) ? 'allowed' : 'unclassifiable'
```

REPLACE with:

```ts
    const indexShapeSet = new Set(shapes)
    const indexTemplates = shapes.map((shape) => new UriTemplate(shape))
    const classifyRegisteredAgainstIndex = (registered: string): 'allowed' | 'unclassifiable' => {
      if (indexShapeSet.has(registered)) return 'allowed'
      return indexTemplates.some((template) => template.match(registered) !== null) ? 'allowed' : 'unclassifiable'
    }
```

Rationale: ground truth 2.6. The census still halts on an address that matches neither a shape nor a
template, which is the property it exists for.

### Step 15 — resolve the new index shape to a readable URI

File: `test/spawn/resources.test.ts`. REPLACE.

FIND (exact, unique):

```ts
  if (shape === 'logbook://decision/{id}') return `logbook://decision/${ids.decisionId}`
```

REPLACE with:

```ts
  if (shape === 'logbook://decision/{id}') return `logbook://decision/${ids.decisionId}`
  if (shape === 'logbook://sessions/{thread_id}') return `logbook://sessions/${ids.sessionThreadId}`
```

Rationale: `resource.index-addresses-resolve` reads every shape the index publishes and halts on one
it cannot turn into a URI. Without this line the new address halts it.

### Step 16 — add the four acceptance tests

File: `test/spawn/resources.test.ts`. The block to APPEND at the end of the file is given in section
5.1.

Rationale: acceptance criteria 1, 2, 3, 4, 5 and 6.

## 5. Tests

### 5.1 `test/spawn/resources.test.ts` — APPEND

Append this block, exactly, after the final `})` of the existing
`test('resource.thread-detail-shows-every-risk-and-criterion-id', ...)` at the end of the file:

```ts

const readResourceText = async (spawned: SpawnedServer, uri: string): Promise<string> => {
  const read = await spawned.client.readResource({ uri })
  const [content] = read.contents
  assert.ok(
    content !== undefined && 'text' in content && typeof content.text === 'string',
    `expected ${uri} to return text content`
  )
  return (content as { text: string }).text
}

const logEntry = async (spawned: SpawnedServer, threadId: string, body: string): Promise<string> => {
  const result = (await spawned.client.callTool({
    name: 'log_session_event',
    arguments: { thread_id: threadId, actor: 'claude', body }
  })) as CallToolResult
  assertOkResult('log_session_event (sessions fixture arrange)', result)
  return (result.structuredContent as { session_entry_id: string }).session_entry_id
}

test('resource.sessions-lists-every-entry-id-with-its-first-line', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const olderId = await logEntry(fx.spawned, ids.threadId, 'the older first line\nthe older second line')
    const newerId = await logEntry(fx.spawned, ids.threadId, 'the newer first line\nthe newer second line')

    const listing = await readResourceText(fx.spawned, `logbook://sessions/${ids.threadId}`)

    assert.ok(listing.includes(olderId), `expected the sessions resource to name entry ${olderId}`)
    assert.ok(listing.includes(newerId), `expected the sessions resource to name entry ${newerId}`)
    assert.ok(listing.includes('the older first line'), 'expected the sessions resource to show the older first line')
    assert.ok(listing.includes('the newer first line'), 'expected the sessions resource to show the newer first line')
    assert.ok(
      !listing.includes('the older second line'),
      'expected the sessions resource to show the first line only'
    )
    assert.ok(
      listing.indexOf(newerId) < listing.indexOf(olderId),
      'expected the sessions resource to render newest first'
    )
  })
})

test('resource.index-lists-the-sessions-address', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const indexBody = await readIndexBody(fx.spawned)
    assert.ok(
      parseIndexShapes(indexBody).includes('logbook://sessions/{thread_id}'),
      'expected logbook://index to list logbook://sessions/{thread_id}'
    )
  })
})

test('resource.thread-detail-shows-every-binding', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const bound = (await fx.spawned.client.callTool({
      name: 'bind_branch',
      arguments: { thread_id: ids.threadId, branch: 'feat/resources-fixture-branch' }
    })) as CallToolResult
    assertOkResult('bind_branch (bindings fixture arrange)', bound)
    const bindingId = (bound.structuredContent as { binding_id: string }).binding_id

    const detailText = await readThreadResourceText(fx.spawned, ids.threadId)

    assert.ok(detailText.includes(bindingId), `expected the thread resource to name binding ${bindingId}`)
    assert.ok(
      detailText.includes('feat/resources-fixture-branch'),
      'expected the thread resource to name the bound branch'
    )
  })
})

test('resource.list-enumerates-open-threads-and-not-decisions-or-session-entries', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    const listed = await fx.spawned.client.listResources()
    const uris = listed.resources.map((resource) => resource.uri)

    assert.ok(uris.length > 2, `expected resources/list to return more than two entries, got ${uris.length}`)
    assert.ok(uris.includes(`logbook://thread/${ids.threadId}`), 'expected resources/list to name the open thread')
    assert.ok(
      !uris.includes(`logbook://decision/${ids.decisionId}`),
      'expected resources/list to leave decision records unenumerated'
    )
    assert.ok(
      !uris.includes(`logbook://session/${ids.sessionThreadId}/${ids.sessionEntryId}`),
      'expected resources/list to leave session entries unenumerated'
    )

    const closed = (await fx.spawned.client.callTool({
      name: 'close_thread',
      arguments: { thread_id: ids.threadId, outcome: 'abandoned', detail: 'the fixture thread is no longer pursued' }
    })) as CallToolResult
    assertOkResult('close_thread (list fixture arrange)', closed)

    const afterClose = await fx.spawned.client.listResources()
    assert.ok(
      !afterClose.resources.map((resource) => resource.uri).includes(`logbook://thread/${ids.threadId}`),
      'expected resources/list to drop a terminal thread'
    )
  })
})
```

Every helper this block uses — `withFixture`, `seedStore`, `assertOkResult`, `readIndexBody`,
`parseIndexShapes`, `readThreadResourceText`, `SpawnedServer`, `CallToolResult` — is already defined
or imported earlier in the same file. Nothing new is imported except `UriTemplate`, added by step 14.

### 5.2 Which test discharges which criterion

| Criterion | Test that discharges it |
|---|---|
| 1 — the sessions resource | `resource.sessions-lists-every-entry-id-with-its-first-line` |
| 2 — the index lists it | `resource.index-lists-the-sessions-address`, plus `resource.index-addresses-resolve` |
| 3 — bindings render | `resource.thread-detail-shows-every-binding` |
| 4 — the thread template lists, the others do not | `resource.list-enumerates-open-threads-and-not-decisions-or-session-entries` |
| 5 — terminal threads drop out | the final two assertions of that same test |
| 6 — four ids reachable without guessing | thread id and binding id: the two tests above; decision id: `resource.thread-detail-shows-every-risk-and-criterion-id` together with the shipped `Key decisions:` line at `src/server/resource-render.ts`; session entry id: the sessions test |
| 7 — the content census stays green | `content.every-content-field-reaches-a-rendered-surface` |
| 8 — typecheck and packaging | `npm run typecheck`, `node scripts/check-packaging.mjs` |

### 5.3 No test is deleted, skipped or weakened

`resource.index-addresses-resolve` is widened by step 14 to classify a concrete instance URI against
the index's templates. It still halts on an address that matches nothing. Its two other assertions
are untouched, and its name does not change.

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time — the commit
`feat/u6b-discovery-addresses` was cut from, which already contains `U6-A`. Print it and write it
down:

```
git rev-parse HEAD
```

Apply steps 14, 15 and 16 only — the three test edits. Do not apply any of steps 1 through 13. Then
run:

```
node --experimental-strip-types --test test/spawn/resources.test.ts
```

Expect exit code 1, with `pass 3` and `fail 4`, and all four of these texts in the output:

```
MCP error -32602: Resource logbook://sessions/
```

```
expected logbook://index to list logbook://sessions/{thread_id}
```

```
expected the thread resource to name binding
```

```
expected resources/list to return more than two entries, got 2
```

The three pre-existing tests in that file — `resource.index-addresses-resolve`,
`resource.read-is-pure` and `resource.thread-detail-shows-every-risk-and-criterion-id` — pass at the
parent and must still pass. Step 14 widens the first of them, and a widened classifier does not
change its verdict on the addresses that already existed.

Then apply steps 1 through 13 and re-run the same command. Expect exit code 0 with `pass 7` and
`fail 0`.

## 7. Inertness mutation

One per acceptance criterion that carries a behavioural change. Each mutation is applied to the
finished tree, the named test is run, the named text is expected, and the mutation is then reverted
exactly.

### 7.1 The sessions first line (criterion 1)

Revert: in `src/server/resource-render.ts`, inside `renderSessionsResource`, replace the line

```ts
    ...listing.entries.map(renderSessionsEntryLine),
```

with

```ts
    ...listing.entries.map((entry) => `- ${escapeStored(entry.id)}`),
```

Run `node --experimental-strip-types --test test/spawn/resources.test.ts`. Expect exit code 1, one
failing test, and this text:

```
expected the sessions resource to show the older first line
```

Restore: put the original line back.

### 7.2 The index entry (criterion 2)

Revert: in `src/server/resources.ts`, delete these four lines from `ADDRESSES`:

```ts
  {
    shape: 'logbook://sessions/{thread_id}',
    description: 'every session-log entry id for one thread with the first line of each, newest first'
  },
```

Run the same command. Expect exit code 1, TWO failing tests, and both of these texts:

```
expected logbook://index to list logbook://sessions/{thread_id}
```

```
census halted on an unclassifiable item: "logbook://sessions/{thread_id}"
```

Restore: put all four lines back, immediately after the `logbook://decision/{id}` entry.

### 7.3 The binding read (criterion 3)

Revert: in `src/server/resources.ts`, inside `readThreadResourceBody`, replace the argument

```ts
    readBindingsForThread(rt, thread.id)
```

with

```ts
    { bound: [], unreadable: 0 }
```

Run the same command. Expect exit code 1, one failing test, and this text:

```
expected the thread resource to name binding
```

Restore: put `readBindingsForThread(rt, thread.id)` back.

### 7.4 The thread list callback (criteria 4 and 5)

Revert: in `src/server/resources.ts`, in the `logbook://thread/{id}` template, replace

```ts
      list: () => listThreadResources(rt),
```

with

```ts
      list: undefined,
```

Run the same command. Expect exit code 1, one failing test, and this text:

```
expected resources/list to return more than two entries, got 2
```

Restore: put `list: () => listThreadResources(rt),` back.

### 7.5 The content census still binds (criterion 7)

Revert: in `src/server/resource-render.ts`, delete the line

```ts
    `Slug: ${escapeStored(thread.slug)}`,
```

Run `node --experimental-strip-types --test test/contract/content-rendered.test.ts`. Expect exit code
1 and this text:

```
content-rendered: 1 of 67 record schema nodes are not allowed
thread.slug
```

Restore: put that exact line back, immediately after the `` `Id: ${escapeStored(thread.id)}`, `` line.

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
   node --experimental-strip-types --test test/spawn/resources.test.ts test/spawn/forgery.test.ts test/spawn/completions.test.ts
   ```
   Expect exit code 0 and `# fail 0`.

4. ```
   node --experimental-strip-types --test test/contract/content-rendered.test.ts test/contract/render-census.test.ts test/contract/described.test.ts test/unit/resource-render.test.ts
   ```
   Expect exit code 0 and `# fail 0`.

5. ```
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

### Commit 1 — the renderers

```
feat(discovery): render a thread's session log listing and its bindings
```

Files: `src/server/resource-render.ts`.
Plan steps: 2, 3, 4, 5, 6.

### Commit 2 — the resource layer

```
feat(discovery): publish a sessions address and list open threads
```

Files: `src/server/resources.ts`.
Plan steps: 7, 8, 9, 10, 11, 12.

### Commit 3 — the tests

```
test(discovery): assert the four published ids reach a model without guessing
```

Files: `test/contract/content-rendered.test.ts`, `test/spawn/resources.test.ts`.
Plan steps: 13, 14, 15, 16.

### Commit 4 — the version

```
chore(release): bump the minor version for the discovery addresses
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Plan step: 1.

Commit 1 and commit 2 are both behaviour changes on two different surfaces. No commit mixes a
refactor with a behaviour change: the only move in this unit, `renderDetailQuarantinedLine` shifting
up the file, lands in commit 1 alongside the new renderer that forced it, and it changes no
behaviour because the function body is identical.

## 10. Pull request

Measured diff size: **278 changed lines** — 266 insertions and 12 deletions across 6 files, measured
by applying every step of this plan to a throwaway copy of a tree that already contained `U6-A`, and
running `git diff --cached --shortstat`. Of those, 159 lines are production code and manifests
(`src/server/resources.ts` 108, `src/server/resource-render.ts` 47, the two version lines 4) and 119
are tests (`test/spawn/resources.test.ts` 114, `test/contract/content-rendered.test.ts` 5). That is
below the 400-line ceiling; no further split.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u6b-discovery-addresses --base main \
  --title "feat(discovery): publish an address for a thread's session log" \
  --what "A new readable address returns every session-log entry a thread holds, with the first line of each, newest first." \
  --what "Reading one thread now shows which git branches are bound to it, each with the id of the record that bound it." \
  --what "Asking the server what it can show now returns one entry per thread still being worked, so a reader can obtain a thread id without being told one." \
  --why "Ids for a thread's session entries were reachable only through the autocomplete channel a human uses when typing into a picker, so nothing that is not a picker could find them." \
  --why "Branch bindings were written and read back by nothing, so a value a user supplied was stored and never shown." \
  --risk "The list of what the server can show grows with the number of threads still open, so a project with many open threads returns a longer list." \
  --verified "node --experimental-strip-types --test test/spawn/resources.test.ts - 7 pass, 0 fail" \
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

### 11.1 `U6-A` has not landed on this branch's base

Run:

```
node -e "import('./src/server/resource-render.ts').then((m) => console.log(m.renderThreadDetail.length))"
```

If the output is not `4`, `U6-A` is either absent or already superseded, and every FIND string in
section 4 was written against a file this base does not carry. STOP and report; do not improvise.

Then run:

```
ls test/support/schema-nodes.ts test/contract/content-rendered.test.ts
```

If either path is reported missing, `U6-A` has not landed. STOP and report; do not improvise.

### 11.2 The field-class module has not landed

Run:

```
node -e "import('./src/schema/field-class.ts').then((m) => console.log(typeof m.POINTER_PATTERN))"
```

If the output is not `object`, the schema change the content census depends on is not on this
branch's base. STOP and report; do not improvise.

### 11.3 The two manifests disagree before the change

Run:

```
node -p "[require('./package.json').version, require('./.claude-plugin/plugin.json').version].join(' ')"
```

If the two values are not equal, STOP and report; do not improvise. A version merely HIGHER than the
`2.2.0` baseline means the ladder shifted and is NOT a stop condition — increment from what you read.

### 11.4 A FIND string does not appear exactly once

For every FIND block in section 4, the text must occur exactly once in the named file. If it occurs
zero times or more than once, STOP and report; do not improvise, and do not guess at a nearby match.

### 11.5 More than one template gains a list callback

After step 11, run:

```
grep -c "list: undefined" src/server/resources.ts
```

Expect exactly `3` — the decision template, the single-session-entry template, and the new sessions
template. If the count is lower, a template gained a `list` callback that must not have one. STOP and
report; do not improvise.

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
