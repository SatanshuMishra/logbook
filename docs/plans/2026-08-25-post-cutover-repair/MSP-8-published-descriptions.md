# MSP-8 — Every published description matches the code

## 0. Identity

| Field | Value |
| --- | --- |
| **Closes** | Defect D14 — four published descriptions state behaviour the code does not implement. Defect D15 — the SessionStart roster's status token is a constant. |
| **Depends on** | MSP-0, MSP-3, MSP-4-A, MSP-4-B, MSP-5. All five must already be merged into `main`. Section 11 gives one runnable check per dependency. |
| **Required by** | Nothing. |
| **Branch name** | `fix/msp-8-published-descriptions`, cut from `main`. The pull request targets `main`. |
| **Version bump** | Baseline `1.0.8` -> `1.0.9` per orchestrator ruling O1. Step 15 is written as a read-then-increment against whatever `package.json` actually holds, so a shifted ladder does not invalidate this plan. |
| **Diff size** | **624 changed lines, measured not estimated — over the 400-line ceiling.** Ruled **NOT split**, because no split preserves acceptance criterion 1. The measurement, the two split shapes considered, and the reason each fails are in section 3.8. |
| **SPEC anchors** | SPEC section 7, MSP-8 "Every published description matches the code"; SPEC section 6, ruling R10; SPEC section 5, defects D14, D15, D17; SPEC section 4, invariants I1 through I9. Provenance only — you do not need to open the SPEC. Everything from it that binds this work is quoted verbatim below. |

### What this MSP builds, in plain words

Read this before anything else. It assumes you know nothing about this repository.

- **MCP** is Model Context Protocol, a way for an editor to talk to a separate tool server. This
  repository is such a server. It publishes twelve **tools**.
- Each tool publishes three things a model reads: a **name**, a **description** (a paragraph of
  English prose), and an **input schema** (the machine-readable list of arguments the tool accepts).
- A **capability** is something the description says a caller can do. A capability is **reachable**
  when the input schema actually carries an argument through which a caller can do it.
- Three of the twelve descriptions currently name capabilities that are not reachable. A model reads
  the prose, believes it, and sends an argument that does not exist or expects an effect that cannot
  happen. Nothing in the test suite notices, because nothing compares the prose against the schema.
- A **census** is a test that enumerates a complete population, classifies every member as
  `allowed`, `forbidden` or `unclassifiable`, and fails on anything that is not `allowed`. It halts
  on a member it has no rule for, rather than skipping it. The helper is `test/support/census.ts`.

This MSP does four things:

1. Adds a census over every (tool, declared capability claim) pair, asserting each claim's
   capability is reachable through a published input schema.
2. Gives the thread field `blocked_by` a writer, so `list_threads`' promise about blocked threads
   becomes true instead of being deleted.
3. Corrects `park_thread`'s and `resume_thread`'s descriptions to describe the code that ships.
4. Removes the constant `[open]` token from the SessionStart roster line, which carries no
   information because the list it decorates is already filtered to open threads only.

---

## 1. Acceptance criteria (the ceiling)

Copied verbatim from SPEC section 7, MSP-8, numbered as there.

1. A census asserts that for each tool, every capability its description names is reachable through
   its published input schema. Red on the parent for at least `park_thread` and `list_threads`.
2. A test asserts the SessionStart roster line carries a status token that varies with the thread's
   status, or carries none.
3. Inertness: restoring any one false description turns criterion 1 red.
4. `npm test` green.

That list is the complete definition of done for this unit of work. Anything discovered above it is
appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence. It
is not folded into this plan, and it does not reopen this plan once these four are met.

---

## 2. Ground truth

Every block below was read from the file at commit `9f66931` and is reproduced character for
character. Line numbers are stated as orientation only. **Anchor every edit on the FIND text, never
on a line number** — MSP-3 grows `src/server/tools/park_thread.ts` from 275 lines to 376, so every
line citation into that file is stale by the time you apply this plan.

### 2.1 `src/server/tools/park_thread.ts:236-243` — the description that overstates by four fields

```ts
export const parkThreadTool: ToolSpec<ParkThreadInput, ParkThreadOutput> = {
  name: 'park_thread',
  title: 'Park thread',
  description:
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the six running-summary fields, and releases the record of what is being worked. Takes the outcome as text plus whichever summary fields changed; the thread id is optional because the machine already knows which thread is being worked. Parking a thread that is already parked is not an error. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
  input: ParkThreadInputSchema,
  output: ParkThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
```

What is wrong with it, from evidence I read myself:

- It says **"refreshes the six running-summary fields"**. `ParkThreadInputSchema`
  (`src/server/tools/park_thread.ts:20-39`, quoted at 2.2) publishes exactly four keys, of which
  only two touch the running summary: `last_session` and `next_step`. There is no key for
  `active_goal`, none for `open_risks`, none for `key_decisions`, none for `out_of_scope`. Four of
  the six named fields have no argument at all.
- The tool's own output schema agrees with the code and contradicts the prose:
  `spine_fields_updated: z.array(z.enum(['last_session', 'next_step']))`
  (`src/server/tools/park_thread.ts:57-59`) enumerates two members where the description promises
  six.
- It says **"Parking a thread that is already parked is not an error."** After MSP-3 merges that is
  false on six branches: supplying an `outcome` when no thread is marked as being worked, or when
  the marked thread is not the one named, now **refuses**. MSP-3 leaves this sentence untouched and
  files the gap as `F3a`; this plan owns it.
- The `annotations` line above is the **pre-MSP-3** text. MSP-3 already sets `idempotentHint` to
  `false`. This plan does not touch that line.

### 2.2 `src/server/tools/park_thread.ts:20-39` — the input schema, pre-MSP-3

```ts
const ParkThreadInputSchema = z.strictObject({
  outcome: z
    .string()
    .min(1)
    .max(caps.SESSION_BODY_MAX)
    .describe('what happened in this session, written to the session log as-is'),
  thread_id: ulidField(
    'the id of the thread being worked; omit it and the machine resolves it from what is currently marked as being worked'
  ).optional(),
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  next_step: z
    .string()
    .max(caps.SPINE_NEXT_STEP_MAX)
    .optional()
    .describe('replaces the spine next_step field when supplied; omit to leave it unchanged')
})
```

What is wrong with it: nothing, and **this plan does not edit it**. It is reproduced because the
claim table in step 9 names `park_thread.last_session` and `park_thread.next_step` as the providers
for the corrected description's summary-field clause, and both keys must exist for that claim to
classify `allowed`. MSP-3 makes `outcome` `.optional()` and rewrites its `.describe()` string; every
key above survives.

### 2.3 `src/server/tools/resume_thread.ts:34-41` — the description that claims a reconciliation that never happens

```ts
export const resumeThreadTool: ToolSpec<ResumeThreadInput, ResumeThreadOutput> = {
  name: 'resume_thread',
  title: 'Resume thread',
  description:
    'Picks up one thread and returns its finished briefing in a single call: it reconciles the store, marks the thread as the one being worked on this machine, and renders what the previous session left. Takes one thread id, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.',
  input: ResumeThreadInputSchema,
  output: ResumeThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
```

What is wrong with it: the clause **"it reconciles the store"** describes contact with a shared copy
that this handler never makes. The handler body (`src/server/tools/resume_thread.ts:42-94`, which I
read in full) calls `openProjectStore`, `loadThread`, `layoutFor`, `readPointer`, `writePointer`,
`store.readDecision` and `renderBriefing`. There is no fetch, no push and no remote contact of any
kind. "Reconcile" is what `sync_ledger` does; `resume_thread` reads what is already on this machine.

### 2.4 The 200-byte lead-sentence cap, and the exact headroom on `resume_thread`

`test/support/published.ts:42-58`, read verbatim:

```ts
export const BUDGET_BYTES = 2048
export const LEAD_SENTENCE_BYTES = 200

const SENTENCE_TERMINATOR_PATTERN = /[.!?](?:\s|$)/

const leadSentenceByteLength = (description: string): number | null => {
  const match = SENTENCE_TERMINATOR_PATTERN.exec(description)
  if (match === null) return null
  return Buffer.byteLength(description.slice(0, match.index + 1), 'utf8')
}

export const classifyDescription = (description: string): Verdict => {
  if (Buffer.byteLength(description, 'utf8') >= BUDGET_BYTES) return 'forbidden'
  const leadBytes = leadSentenceByteLength(description)
  if (leadBytes === null) return 'unclassifiable'
  return leadBytes > LEAD_SENTENCE_BYTES ? 'forbidden' : 'allowed'
}
```

The cap is measured in **bytes**, through `Buffer.byteLength(..., 'utf8')` — not characters. The
lead sentence is everything up to and including the first `.`, `!` or `?` that is followed by
whitespace or end of string. `test/contract/budget.test.ts:33` censuses every tool's description
through `classifyDescription`, so a lead sentence over 200 bytes turns `npm test` red.

**The measurement, which I ran myself** and which every planned description must satisfy:

| Description | Lead-sentence bytes | Headroom to 200 | Whole-string bytes | Headroom to 2048 |
| --- | --- | --- | --- | --- |
| `resume_thread`, as it ships today | **198** | **2** | 513 | 1535 |
| `resume_thread`, as step 2 leaves it | **175** | **25** | 490 | 1558 |
| `park_thread`, as it ships today | 189 | 11 | 496 | 1552 |
| `park_thread`, as step 1 leaves it | **196** | **4** | 539 | 1509 |
| `update_thread`, as it ships today | 135 | 65 | 481 | 1567 |
| `update_thread`, as step 3 leaves it | **179** | **21** | 525 | 1523 |
| `list_threads`, unchanged by this plan | 155 | 45 | 494 | 1554 |

`resume_thread`'s shipped lead sentence has **exactly 2 bytes** of headroom. Step 2 removes the
false clause and therefore shortens it to 175 bytes. **Nothing else in that sentence may grow**;
section 11 stop condition 11.7 makes this a runnable check rather than a matter of care.

Reproduce the measurement with this exact command, which uses the same pattern and the same byte
function as the shipped classifier:

```bash
node -e "const P=/[.!?](?:\s|\$)/;const lead=(d)=>{const m=P.exec(d);return m===null?null:Buffer.byteLength(d.slice(0,m.index+1),'utf8')};const d=process.argv[1];console.log('lead='+lead(d)+' whole='+Buffer.byteLength(d,'utf8'))" "<the description string>"
```

Expected exit code `0`, and exactly one line of stdout matching `lead=<number> whole=<number>`.

### 2.5 `src/server/tools/list_threads.ts:65-72` — the description that promises a field nothing can set

```ts
export const listThreadsTool: ToolSpec<ListThreadsInput, ListThreadsOutput> = {
  name: 'list_threads',
  title: 'List threads',
  description:
    'Lists the threads that can be picked up, newest activity first, each with its state, how far along it is, and the single next action the last session left. Takes no required arguments; pass `cursor` from a previous reply to read the next page, and `limit` to change the page size from its default of 25. A thread that is blocked shows what it is blocked on, because a blocked thread with no reason is worse than no thread at all. This is a plain directory read and costs nothing worth avoiding.',
  input: ListThreadsInputSchema,
  output: ListThreadsOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
```

What is wrong with it: the sentence **"A thread that is blocked shows what it is blocked on"**
promises a value in the field `blocked_by`, and no published tool can put a value there. **This plan
does not edit this description.** It makes the sentence true by giving `blocked_by` a writer. The
ruling and the rejected alternative are in section 3.1.

### 2.6 `src/schema/thread.ts:100-114` — `blocked_by` on the thread record

```ts
const ThreadShape = z.object({
  id: ulidField('the thread identity, a ULID'),
  slug: z
    .string()
    .min(1)
    .max(caps.THREAD_SLUG_MAX)
    .regex(SLUG_PATTERN)
    .describe('a short lowercase label for the thread'),
  title: z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the thread title'),
  status: z.enum(['open', 'done', 'abandoned']).describe('the thread lifecycle state'),
  blocked_by: z
    .string()
    .max(caps.THREAD_BLOCKED_BY_MAX)
    .nullable()
    .describe('the reason this thread is blocked, or null when it is not blocked'),
```

What is wrong with it: nothing, and **this plan does not edit this file.** Three facts I read here
decide section 3.1's ruling:

1. `blocked_by` is `.nullable()` and **required** — no `.optional()`, no `.default()`. Every stored
   record carries the key.
2. `caps.THREAD_BLOCKED_BY_MAX` is `500` (`src/schema/caps.ts:3`), so a cap already exists and step 4
   reuses it rather than inventing one.
3. The `status` enum is `'open' | 'done' | 'abandoned'`. **There is no `blocked` status.** The only
   transition function in the repository, `transition` at `src/domain/lifecycle.ts:55`, takes
   `to: 'done' | 'abandoned'` and has no third arm. `blocked_by` is therefore not a lifecycle state;
   it is a reason annotation on an open thread, which is exactly how `renderBlockage` treats it.

### 2.7 `src/server/tools/update_thread.ts:32-53` — the input schema that gains the writer

```ts
const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(ulidField('the id of a completion criterion already present on this thread'))
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criterion ids to mark done; an id not present on the thread is refused'),
  active_goal: z
    .string()
    .max(caps.SPINE_ACTIVE_GOAL_MAX)
    .optional()
    .describe('replaces the spine active_goal field when supplied; omit to leave it unchanged'),
  next_step: z
    .string()
    .max(caps.SPINE_NEXT_STEP_MAX)
    .optional()
    .describe('replaces the spine next_step field when supplied; omit to leave it unchanged'),
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
```

What is wrong with it: it is the tool whose whole purpose is "records mid-session progress on one
thread", and it is the only tool that already edits a stored thread's scalar fields in place, yet it
publishes no argument for `blocked_by`. Every scalar it does publish follows one shape — optional,
capped from `src/schema/caps.ts`, with a `.describe()` string ending in a statement of what omitting
it does. Step 4 copies that shape exactly.

### 2.8 `src/server/tools/update_thread.ts:196-231` — the handler's change accounting

```ts
    const nothingChanged =
      markedDone.length === 0 &&
      retiredIds.length === 0 &&
      newRisks.length === 0 &&
      newKeyDecisions.length === 0 &&
      newOutOfScope.length === 0 &&
      spineFieldsUpdated.length === 0

    if (nothingChanged) {
      return {
        ok: true,
        text: `no fields were supplied; thread ${thread.slug} is unchanged.`,
        structured: {
          thread_id: thread.id,
          criteria_marked_done: [],
          spine_fields_updated: [],
          risks_added: [],
          risks_retired: [],
          key_decisions_added: [],
          out_of_scope_added: []
        }
      }
    }

    const spineForContribution: Spine = { ...thread.spine, open_risks: survivingRisks }
    const contributed = contributeToSpine(spineForContribution, spineContribution)
    if (!contributed.ok) {
      return { ok: false, refusal: contributed }
    }

    const nextThread: Thread = {
      ...thread,
      completion_criteria: nextCriteria,
      spine: contributed.value,
      updated_at: rt.now()
    }
```

What is wrong with it: nothing today. It matters because a new argument that is not added to
`nothingChanged` would make a call carrying only `blocked_by` report "no fields were supplied" and
write nothing — a silent success, which invariant I2 forbids. Steps 6 and 7 close that hole.

### 2.9 `src/cli/session-start.ts:21-40` — the roster line whose status token is a constant

```ts
const NO_RESUMABLE_THREADS = 'Logbook: no resumable threads.'

const renderThreadLine = (thread: Thread): string =>
  `- [${escapeStored(thread.status)}] ${escapeStored(thread.slug)}: ${escapeStored(thread.title)} -- next: ` +
  `${escapeStored(thread.spine.next_step)} (id ${escapeStored(thread.id)})`

export const renderThreadListing = (rt: Runtime, projectRoot: string): string => {
  const opened = openStore(rt, projectRoot)
  if (!opened.ok) {
    return ['Logbook: the thread store could not be opened (', escapeStored(opened.message), ').'].join('')
  }
  const threads = opened.value
    .readThreads()
    .filter((slot): slot is { quarantined: false; record: Thread } => !slot.quarantined)
    .map((slot) => slot.record)
    .filter((thread) => thread.status === 'open')
  if (threads.length === 0) return NO_RESUMABLE_THREADS
  const threadLines = threads.map(renderThreadLine)
  return [`Logbook resumable threads (${threads.length}):`, ...threadLines].join('\n')
}
```

What is wrong with it: `renderThreadLine` renders `[${escapeStored(thread.status)}]`, but the only
caller filters to `thread.status === 'open'` two lines below. Every bracket in every session on every
machine therefore reads `[open]`. It occupies six characters of a budget-clipped context block and
carries zero information.

### 2.10 `test/support/census.ts` — the census helper, in full

```ts
export type Classified<T> = { item: T; verdict: 'allowed' | 'forbidden' }

const describeItem = (item: unknown): string => {
  try {
    return JSON.stringify(item)
  } catch {
    return String(item)
  }
}

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

What is wrong with it: nothing, and this plan does not edit it. Both failure messages are quoted
verbatim in sections 6 and 7 as the expected red output, so read them here rather than guessing.

### 2.11 `test/support/published.ts:60-70` and `:73-107` — the census machinery, as MSP-5 leaves it

MSP-5 adds a fourth axis, `guardApproved`. The block below is the **post-MSP-5** state that steps 9
to 12 edit. `toolFileBasenames` and `BARREL_BASENAME` are reproduced unchanged from the tree at
`9f66931`; MSP-5 does not touch them.

```ts
const TOOLS_DIR = fileURLToPath(new URL('../../src/server/tools', import.meta.url))

const BARREL_BASENAME = 'index'

const toolFileBasenames = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name.slice(0, -3))
    .filter((basename) => basename !== BARREL_BASENAME)
}
```

The three sites steps 10, 11 and 12 edit sit below that block, at `:73-107` in the post-MSP-5 file.
They are reproduced here so this subsection is complete ground truth for the file rather than a
partial quotation.

```ts
export type RegistryCensus = {
  files: readonly string[]
  registered: readonly string[]
  published: readonly string[]
  guardApproved: readonly string[]
}
```

```ts
export const readRegistryCensus = async (s: SpawnedServer): Promise<RegistryCensus> => {
  await importToolBarrel()
  const listed = await s.client.listTools()
  return {
    files: toolFileBasenames(TOOLS_DIR),
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: listed.tools.map((tool) => tool.name),
    guardApproved: [...LEDGER_TOOL_NAMES]
  }
}
```

```ts
export const classifyRegistryName = (name: string, c: RegistryCensus): Verdict => {
  const inFiles = c.files.includes(name)
  const inRegistered = c.registered.includes(name)
  const inPublished = c.published.includes(name)
  const inGuardApproved = c.guardApproved.includes(name)
  return inFiles && inRegistered && inPublished && inGuardApproved ? 'allowed' : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published, ...c.guardApproved])]
```

What is wrong with them: nothing. Each is the four-axis shape MSP-5 authored, and steps 10, 11 and 12
extend it with a fifth axis rather than rewriting it. `readRegistryCensus` discards the descriptions
and input schemas it already holds, which is what step 11 changes so the claim classifier can consume
them.

**`toolFileBasenames` excludes exactly one basename, `index`.** Every other `.ts` file in
`src/server/tools/` enters the census's `files` axis as a tool name, is on no other axis, and halts
the census. MSP-5 measured this, not guessed it. **Therefore no module this plan adds may be placed
in `src/server/tools/`.** Everything this plan adds is test material and lives in
`test/support/published.ts`, which no census walks.

### 2.12 `test/contract/published-schema.test.ts:348-372` — the two synthetic census literals today

```ts
test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-missing-from-one-side', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population].sort(), ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-all-three-sides', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['real_tool'])
  assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, syntheticCensus)))
})
```

What is wrong with them: nothing. MSP-5 replaces this whole block with **four** tests carrying
**four** `RegistryCensus` object literals, renames the second test from `...-on-all-three-sides` to
`...-on-every-axis`, and gives every literal a `guardApproved` key. `RegistryCensus` is an exact
object type, so **every one of those four literals must gain this plan's new field or the file stops
compiling.** Step 13 edits all four.

### 2.13 The live registry — twelve tools

`src/server/tools/index.ts:15-28` builds `TOOL_SPECS`, re-exported as `ALL_TOOLS` from
`src/server/register.ts:32`. The twelve names, in registration order:

`open_thread`, `update_thread`, `close_thread`, `amend_criteria`, `bind_branch`, `resume_thread`,
`park_thread`, `record_decision`, `log_session_event`, `sync_ledger`, `resolve_conflict`,
`list_threads`.

The claim table in step 9 carries an entry for **every one of these twelve**. A tool with no entry
halts the census; that is the closed-population property invariant I8 requires, and it is what makes
a thirteenth tool impossible to add without classifying its claims.

### 2.14 `src/server/tools/resolve_conflict.ts` — the file `grep` cannot see

This file contains a literal NUL byte (`0x00`) at byte offset 11234, inside the template literal on
line 275. `file` reports the whole file as `data`, and plain `grep` silently returns zero matches
against it — no error, no warning. MSP-0 removes that byte. Its description, read directly rather
than by grep, is:

```
'Settles a sync that was refused because two people changed the same field to different values, by naming which side wins for each disagreement. Takes a list of {record, field, winner} where winner is either local or remote, and every disagreement the last sync reported must appear exactly once; a partial list is refused and names what is missing. The losing value is discarded, which is why the server never does this on its own.'
```

Its input schema publishes exactly one key, `resolutions`
(`src/server/tools/resolve_conflict.ts:45-51`). Step 9's claim table carries this tool, and the
entry was authored from a direct read, not from a search. If you need to inspect this file before
MSP-0 merges, use:

```bash
node -e "process.stdout.write(require('fs').readFileSync('src/server/tools/resolve_conflict.ts','latin1'))"
```

Expected exit code `0`, and stdout containing `Settles a sync that was refused because two people`.
**This command is optional inspection, not a gate.** Nothing in this plan edits that file, so you may
skip it entirely; it is given so that reading the file is possible at all, since plain `grep` returns
nothing for it without error or warning.

### 2.15 `test/contract/no-path.test.ts:83-84, 313-318` — the refusal-producer census

```ts
const UPDATE_THREAD_UNKNOWN_CRITERION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownCriterionRefusal'
const UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownDecisionRefusal'
```

```ts
    const unknownDecision = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      key_decisions_add: [{ decision_id: rt.ulid(), title: 'a census decision', scope: 'a census scope' }]
    })
    if (unknownDecision.ok) throw new Error('expected updateThreadTool to refuse an unresolved decision id')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER, refusal: unknownDecision.refusal })
```

What is wrong with it: nothing today, and it passes on the parent. It matters because
`scanRefusalProducers()` walks `src/` for every **exported** function returning a `Refusal` and the
census requires each scanned producer to have a collected sample, so that its message can be checked
for a leaked filesystem path. Edit 4b adds one such export, `conflictingBlockageRefusal`, which makes
the census halt until section 5.4 gives it a collector. `struckCriterionRefusal`
(`src/server/tools/update_thread.ts:100`) is the counter-example that proves the rule: it is
module-local and unexported, so the scan never sees it.

---

## 3. Divergences from the SPEC

### 3.1 RULING — `blocked_by` is given a writer, not removed

SPEC section 7, MSP-8, states the choice verbatim:

> `blocked_by` is decided here rather than left: it is either given a writer, or removed from the
> schema, the roster, the briefing and the merge rules, and its promise removed from
> `list_threads`' description. **Carrying a field that no tool can set while three surfaces render it
> is not a third option.** Removing it is a thread-record schema change and inherits invariant I3.

**Ruled: `blocked_by` is given a writer.** `update_thread` gains two optional arguments —
`blocked_by`, a non-empty string that says what the thread is blocked on, and `blocked_by_clear`, a
boolean that clears it. No schema file is touched, no render surface is deleted, and
`list_threads`' description becomes true rather than being cut. Steps 3 to 8 implement it.

**Ruled separately, on the encoding: a paired set-field and clear-flag, never a nullable input.**

**Rejected in one line:** a single `.nullable()` `blocked_by` argument carrying `null` to mean clear
— it halts an existing census, for the reason below.

This is not a style preference, it is a hard constraint of this repository's published surface.
`test/contract/described.test.ts:48` declares
`UNWALKED_SUBSCHEMA_KEYS = ['anyOf', 'oneOf', 'allOf', '$defs', '$ref']`, and
`carriesUnwalkedSubschema` (`:50-53`) returns true when any of those keys is present on a node.
`classifyDescribedNode` (`:55-62`) then returns `'unclassifiable'` **before it ever reads the node's
description**, so a `.describe()` string does not rescue it. That classifier is censused over
`spec.input` — the tool **input** schema — at `:70-73`, under
`assert.doesNotThrow(() => census(localItems, classifyDescribedNode))`, so an unclassifiable node
throws and the test fails.

Under the pinned Zod, `.optional()` publishes `{"type": "string", ...}` and classifies `allowed`,
while `.nullable()` publishes `{"anyOf": [...]}` with **no top-level `type`** and classifies
`unclassifiable`. Every one of the seven `.nullable()` calls in `src/` today is in an **output**
schema or a stored-record schema — `list_threads.ts:28` and `:39`, `record_decision.ts:33`,
`resume_thread.ts:26`, `schema/decision.ts:35`, `schema/thread.ts:59` and `:113`. **Not one tool
input uses it**, which is why the hazard has never fired.

Invariant I8 forecloses every easy exit: a halting census may not be answered by excluding the item,
pinning a count, adding an allowlist, or teaching the classifier to walk `anyOf`. The census is
right; a nullable input would be wrong. So the clear operation gets its own field, following the
`risks_add` / `risks_retire` pairing this same tool already uses rather than overloading one field
with a sentinel. Both new fields publish a top-level `type` (`string` and `boolean`), so both
classify `allowed`.

**Rejected in one line:** removing `blocked_by` from the schema, the roster, the briefing and the
merge rules — it invalidates five of MSP-7's FIND blocks, costs roughly 200 further changed lines
across 25 files, and deletes the only surface on which an adversarial string is proved to be
neutralised.

The four facts behind the ruling, each read directly:

1. **There is no `blocked` state to write.** `src/schema/thread.ts:109` declares
   `status: z.enum(['open', 'done', 'abandoned'])`, and `src/domain/lifecycle.ts:55` declares
   `transition = (rt, thread, to: 'done' | 'abandoned', detail)`. `blocked_by` is a reason
   annotation on an open thread, not a lifecycle state, so giving it a writer adds no state machine
   and invents no new concept. Removing it, by contrast, would be removing a field the merge layer,
   both renderers and the `list_threads` output schema all already handle correctly.
2. **Removal collides with MSP-7, which merges after this MSP.** MSP-7's plan is authored against
   the tree as it stands. Five of its FIND blocks contain the literal token `blocked_by` and would
   stop matching: its step 1 against `src/schema/thread.ts` (anchored on `blocked_by: string | null`),
   its step 3 and step 4 against `src/merge/field-merge.ts` (anchored on
   `blocked_by: 'conflict-on-divergence',` and on the `{ path: 'blocked_by', ... }` descriptor), the
   second edit of its step 5 against the same file (anchored on
   `blocked_by: byPath.get('blocked_by') as Thread['blocked_by'],`), and its step 10 edit 5 against
   `src/server/tools/open_thread.ts` (anchored on `blocked_by: null,`). A sixth, its step 7 edit 1
   against `src/render/briefing.ts`, is anchored on `const renderBlockage = (blockedBy: string | null): string =>`
   and would break if removal deleted that function. **This plan disturbs none of that text.**
3. **Removal would delete a security assertion.** `test/spawn/forgery.test.ts:356-398`
   (`render.blockage-reason-cannot-forge`) drives a hostile string carrying a bidirectional-override
   character and an embedded instruction through `blocked_by` and asserts, at line 383, that the
   override "reached the client unescaped" is false, and at line 391 that an embedded newline "was
   not neutralised into a visible escape" is false. `blocked_by` is one of the surfaces on which
   stored-text neutralisation is proved. Deleting the field deletes that proof.
4. **Removal is silent, not loud.** `ThreadShape` is built with plain `z.object({...})`
   (`src/schema/thread.ts:100`), never `.strict()` and never `.passthrough()`. Under the pinned
   `zod` 4.4.3 a stored record carrying a key the schema no longer declares is **silently stripped**,
   not refused. A record whose `blocked_by` held a real reason would lose it on the next read-write
   cycle with nothing surfaced anywhere. That is the exact shape invariant I3 exists to prevent.

**This does not change what MSP-7 must do, and MSP-7 needs no re-authoring on account of this plan.**
The orchestrator should nonetheless be told that the collision was considered and avoided
deliberately.

### 3.2 RULING — the SessionStart roster line carries no status token

Acceptance criterion 2 allows either a token that varies or no token. **Ruled: no token.** Step 14
deletes `[${escapeStored(thread.status)}] ` from `renderThreadLine`.

**Rejected in one line:** widening `renderThreadListing`'s filter so that the token varies — the
block is headed `Logbook resumable threads (${threads.length}):` and `done` and `abandoned` threads
are terminal and cannot be resumed, so that trades a meaningless token for a wrong list.

### 3.3 RULING — the reachability census is a new per-claim census AND a fifth axis on `RegistryCensus`

**Ruled: both.** Step 9 adds a per-claim census — its own item type, its own classifier, its own
population builder — which is what discharges acceptance criterion 1 literally ("for each tool,
every capability its description names"). Steps 10 to 12 add `descriptionClaimsReachable` as a fifth
axis on the existing `RegistryCensus`, extending the conjunction in `classifyRegistryName` and the
union in `registryPopulation` exactly as MSP-5 extended them for its fourth axis, so the existing
production registry census is the single gate.

**Rejected in one line:** the fifth axis alone — `classifyRegistryName` can only return `allowed` or
`unclassifiable`, so a false published claim would fail with `census halted on an unclassifiable
item: "park_thread"` and never name the broken claim, which is a receipt nobody can act on.

The four-way shape MSP-5 authored is **extended, never rewritten**.

### 3.4 DIVERGENCE — `park_thread`'s SPEC line citations are stale

SPEC section 7 names `src/server/tools/park_thread.ts:240`. MSP-3 merges before this MSP and grows
that file from 275 lines to 376, moving the description to roughly `:322-323`, the annotations line
to roughly `:326`, the `outcome` input to roughly `:22-29` and the output status enum to roughly
`:44-52`. **Every FIND block in this plan is anchored on literal text and none on a line number**, so
the shift is harmless. The description's text is unchanged by MSP-3, which is what makes step 1's
FIND still match.

### 3.5 DIVERGENCE — `list_threads` names a second unreachable capability, and it is filed, not fixed

While authoring the claim table I found that `list_threads`' description also says the roster shows
each thread **"with its state"**. No `state` or `status` key exists anywhere in `RosterRowSchema`
(`src/server/tools/list_threads.ts:24-33`) or in the `RosterRow` type (`src/render/roster.ts:4-13`);
the row carries `id`, `slug`, `title`, `blocked_by`, `criteria_done`, `criteria_total`, `next_step`
and `updated_at`.

This is a claim about the **output** schema. Acceptance criterion 1 scopes the census to
"reachable through its published **input** schema", so it is a different population and above this
MSP's ceiling. **Filed as `F8a`. Not folded in.** Scoping the census to the criterion's declared
population and filing the finding is not narrowing a census to obtain a green — nothing is excluded
from the population the criterion declares, and nothing is allowlisted.

### 3.6 DIVERGENCE — the ladder lands on `1.1.1`, not `1.1.0`

SPEC section 7 states the ladder lands on `1.1.0`. It lands on `1.1.1`: MSP-9 merges last so that the
documentation describes the shipped tree, and MSP-4's split consumes one extra patch. This MSP's own
baseline is `1.0.8 -> 1.0.9`, and step 14 reads the current version rather than hard-coding either.

### 3.7 DIVERGENCE — the pull request tool path

SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib` directory
in this repository. The tool is the operator's global one, `node ~/.claude/lib/git/pr.mjs pr-create`,
and section 10 uses that path. Ad-hoc `gh pr create` is denied at the gate.

### 3.8 RULING — the authored diff is 624 lines and this MSP is still NOT split

Measured with `diff -u <original> <applied> | grep -cE '^[+-][^+-]'` per file, counting removed and
added lines alike, and `wc -l` for each new file. `test/support/published.ts` is measured against its
post-MSP-5 state, because MSP-5's own lines are not this MSP's diff.

| File | Changed lines |
| --- | --- |
| `src/server/tools/park_thread.ts` | 2 |
| `src/server/tools/resume_thread.ts` | 2 |
| `src/server/tools/update_thread.ts` | 39 |
| `src/cli/session-start.ts` | 2 |
| `test/support/published.ts` (against post-MSP-5) | 154 |
| `test/contract/published-schema.test.ts` | 145 |
| `test/contract/no-path.test.ts` | 14 |
| `test/spawn/blocked-by-writer.test.ts` (new) | 175 |
| `test/unit/session-start.test.ts` (new) | 89 |
| `package.json` and `.claude-plugin/plugin.json` | 2 |
| **Total** | **624** |

**624 is over the 400-line ceiling, and it is disclosed rather than rounded away.** The ceiling
exists because defect-finding per line declines as review size grows, so a reviewer is owed the
number.

**Ruled: NOT split.** Two split shapes were considered; both fail.

**Rejected split 1 — A the writer, B the census.** Acceptance criterion 1 requires the census to be
**red on the parent for at least `park_thread` and `list_threads`**. `list_threads`' red exists only
while `blocked_by` has no writer. Ship the writer first and B's parent already carries it, so
`list_threads` classifies `allowed` and criterion 1 becomes unsatisfiable in either half.

**Rejected split 2 — A the roster status token, B everything else.** The roster token (criterion 2)
is the only genuinely independent piece, at 91 lines. Removing it leaves B at **533**, still over the
ceiling, bought with a second branch, version bump, merge and green-branch obligation.

The census, the writer and `park_thread`'s corrected description are therefore one indivisible unit:
the census is what makes the false claims observable, and the writer is what turns one of them green.
Splitting them would not make the change smaller, only the receipt weaker.

**The shape of the 624, which is what a reviewer should weigh.** Only **45 lines are production
code** — `update_thread.ts` 39, plus 2 each in `park_thread.ts`, `resume_thread.ts` and
`session-start.ts`. **2 more are the two version manifests.** The remaining **577 are test and
test-support code**: 264 in the two new test files, 299 in the census machinery and its controls
(`test/support/published.ts` 154 and `test/contract/published-schema.test.ts` 145), and 14 giving the
new refusal a collector in the no-path census. 45 + 2 + 577 = 624. The production surface under
review is small; the evidence shipped with it is not.

---

## 4. The change, step by step

Apply the steps in the order given. Every FIND block was copied from the file and checked to occur
exactly once. If a FIND does not match, or matches more than once, section 11 applies.

### Step 1 — `src/server/tools/park_thread.ts` — REPLACE — the description tells the truth about the code MSP-3 leaves

FIND:

```ts
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the six running-summary fields, and releases the record of what is being worked. Takes the outcome as text plus whichever summary fields changed; the thread id is optional because the machine already knows which thread is being worked. Parking a thread that is already parked is not an error. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
```

REPLACE:

```ts
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the last_session and next_step fields, and releases the record of what is being worked. Send the outcome as text plus either of those two fields; the thread id is optional because the machine already knows which thread is being worked. Omit the outcome to release the record of what is being worked without writing a session log entry. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
```

Rationale: SPEC defect D14 records that this description "states behaviour the code does not
implement" — it names six running-summary fields where the input schema publishes two. The
replacement names the two that exist, and replaces the sentence "Parking a thread that is already
parked is not an error" — which MSP-3 makes false on six branches — with the omit-the-outcome
behaviour MSP-3 actually ships. Lead sentence 196 bytes, whole string 539 bytes; both under their
caps, measured in section 2.4.

### Step 2 — `src/server/tools/resume_thread.ts` — REPLACE — the description drops the reconciliation it never performs

FIND:

```ts
    'Picks up one thread and returns its finished briefing in a single call: it reconciles the store, marks the thread as the one being worked on this machine, and renders what the previous session left. Takes one thread id, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.',
```

REPLACE:

```ts
    'Picks up one thread and returns its finished briefing in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left. Takes one thread id, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.',
```

Rationale: SPEC defect D14 records that `resume_thread` "reconciles the store" is false — the handler
makes no remote contact. Removing the clause shortens the lead sentence from 198 bytes to 175,
buying 23 bytes of headroom against the 200-byte cap rather than spending the 2 that were left.

### Step 3 — `src/server/tools/update_thread.ts` — REPLACE — the description names the new capability

FIND:

```ts
    'Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just criteria_done: ["<criterion ulid>"] changes nothing else. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The reply reports what changed, not what the record now holds.',
```

REPLACE:

```ts
    'Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, set or clear what the thread is blocked on, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just criteria_done: ["<criterion ulid>"] changes nothing else. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The reply reports what changed, not what the record now holds.',
```

Rationale: section 3.1's ruling gives `blocked_by` a writer here, and a capability a tool has but
does not publish is the same defect as one it publishes but does not have. Lead sentence 179 bytes,
whole string 525 bytes; both under their caps.

### Step 4 — `src/server/tools/update_thread.ts` — REPLACE — the input schema gains the blockage pair

**Edit 4a.** FIND:

```ts
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  risks_add: z
```

REPLACE:

```ts
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  blocked_by: z
    .string()
    .min(1)
    .max(caps.THREAD_BLOCKED_BY_MAX)
    .optional()
    .describe('what this thread is blocked on; omit to leave it unchanged, and send blocked_by_clear to clear it'),
  blocked_by_clear: z
    .boolean()
    .optional()
    .describe('send true to clear what this thread is blocked on; omit to leave it unchanged'),
  risks_add: z
```

Rationale: section 3.1's encoding ruling. The shape copies the four scalar arguments already in this
schema — optional, capped from `src/schema/caps.ts`, with a `.describe()` string that states what
omitting it does. `caps.THREAD_BLOCKED_BY_MAX` is the cap the thread record already enforces at
`src/schema/thread.ts:112`, so the argument cannot accept a value the record would then refuse.
`.min(1)` keeps an empty string out, so clearing is expressed only by `blocked_by_clear` and never
by a blank that would render as `Blocked: ` with nothing after it. **Neither field is `.nullable()`**
— a nullable input publishes `anyOf` with no top-level `type` and halts
`contract.every-property-described`, per section 3.1.

**Edit 4b.** FIND:

```ts
export const unknownDecisionRefusal = (ids: string[]): Refusal => ({
```

REPLACE:

```ts
export const conflictingBlockageRefusal = (): Refusal => ({
  ok: false,
  field: 'blocked_by',
  accepted: 'either blocked_by to say what the thread is blocked on, or blocked_by_clear to clear it, never both in one call',
  example: 'waiting on the infra approval',
  retryable: true,
  message: 'blocked_by and blocked_by_clear were both supplied; send one or the other, not both.'
})

export const unknownDecisionRefusal = (ids: string[]): Refusal => ({
```

Rationale: invariant I2 — a call that names both a new blockage and a clear cannot do both, so it
refuses through the same `Refusal` shape this file already uses for its three other refusals rather
than silently picking one. The refusal names the field, what it accepts, an example, and that a retry
can succeed, which is the structure `src/server/errors.ts` delivers in the text block a model
actually reads.

### Step 5 — `src/server/tools/update_thread.ts` — REPLACE — the output schema reports what it did

FIND:

```ts
  key_decisions_added: z.array(z.string()).describe('ids minted for key decisions this call linked into the spine'),
  out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added')
})
```

REPLACE:

```ts
  key_decisions_added: z.array(z.string()).describe('ids minted for key decisions this call linked into the spine'),
  out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added'),
  blocked_by_set: z.boolean().describe('whether this call changed what the thread is blocked on, by either setting or clearing it')
})
```

Rationale: SPEC ruling R10 states that on a success result "anything the model must act on lives in
the **structured** result", because the transport replaces the text blocks with `structuredContent`
when it is present. A caller that sent `blocked_by` must be able to read back whether it landed, and
the structured field is the only carrier the model actually receives.

### Step 6 — `src/server/tools/update_thread.ts` — REPLACE — a lone `blocked_by` is a change

FIND:

```ts
    const nothingChanged =
      markedDone.length === 0 &&
      retiredIds.length === 0 &&
      newRisks.length === 0 &&
      newKeyDecisions.length === 0 &&
      newOutOfScope.length === 0 &&
      spineFieldsUpdated.length === 0

    if (nothingChanged) {
      return {
        ok: true,
        text: `no fields were supplied; thread ${thread.slug} is unchanged.`,
        structured: {
          thread_id: thread.id,
          criteria_marked_done: [],
          spine_fields_updated: [],
          risks_added: [],
          risks_retired: [],
          key_decisions_added: [],
          out_of_scope_added: []
        }
      }
    }
```

REPLACE:

```ts
    const blockedBySupplied = input.blocked_by !== undefined
    const blockedByCleared = input.blocked_by_clear === true
    if (blockedBySupplied && blockedByCleared) {
      return { ok: false, refusal: conflictingBlockageRefusal() }
    }
    const blockageChanged = blockedBySupplied || blockedByCleared

    const nothingChanged =
      markedDone.length === 0 &&
      retiredIds.length === 0 &&
      newRisks.length === 0 &&
      newKeyDecisions.length === 0 &&
      newOutOfScope.length === 0 &&
      spineFieldsUpdated.length === 0 &&
      !blockageChanged

    if (nothingChanged) {
      return {
        ok: true,
        text: `no fields were supplied; thread ${thread.slug} is unchanged.`,
        structured: {
          thread_id: thread.id,
          criteria_marked_done: [],
          spine_fields_updated: [],
          risks_added: [],
          risks_retired: [],
          key_decisions_added: [],
          out_of_scope_added: [],
          blocked_by_set: false
        }
      }
    }
```

Rationale: invariant I2 — "No change may introduce a code path that returns `ok: true` while
performing less than the tool's description promises." Without `!blockageChanged` in the
conjunction, a call carrying only `blocked_by` or only `blocked_by_clear` would take the early
return, report "no fields were supplied", and write nothing. That is the exact silent success the
invariant forbids. The refusal above it closes the second silent-success path: a call naming both a
new blockage and a clear cannot honour both, so it refuses instead of quietly choosing one.

### Step 7 — `src/server/tools/update_thread.ts` — REPLACE — the value is written and reported

FIND:

```ts
    const nextThread: Thread = {
      ...thread,
      completion_criteria: nextCriteria,
      spine: contributed.value,
      updated_at: rt.now()
    }
```

REPLACE:

```ts
    const nextThread: Thread = {
      ...thread,
      blocked_by: blockedByCleared ? null : (input.blocked_by ?? thread.blocked_by),
      completion_criteria: nextCriteria,
      spine: contributed.value,
      updated_at: rt.now()
    }
```

Rationale: this is the write, and it reads as the three cases it has: `blocked_by_clear` wins and
writes `null`; otherwise a supplied `blocked_by` string is written; otherwise `?? thread.blocked_by`
leaves whatever the record already held, so an omitted argument changes nothing. The both-supplied
case cannot reach here, having refused in step 6. A new object is constructed and the loaded record is
never mutated, per the project's immutability standard. No escaping is applied here, matching this
handler's existing treatment of `active_goal`, `next_step` and `last_session`: stored free text is
neutralised at render time, by `renderBlockage` at `src/render/roster.ts:62-63` and
`src/render/briefing.ts:23-24`, both of which already call `escapeStored`.

### Step 8 — `src/server/tools/update_thread.ts` — REPLACE — the success reply carries the flag

FIND:

```ts
        key_decisions_added: newKeyDecisions.map((kd) => kd.id),
        out_of_scope_added: newOutOfScope.map((o) => o.id)
      }
    }
  }
}
```

REPLACE:

```ts
        key_decisions_added: newKeyDecisions.map((kd) => kd.id),
        out_of_scope_added: newOutOfScope.map((o) => o.id),
        blocked_by_set: blockageChanged
      }
    }
  }
}
```

Rationale: step 5 declared the output field; a declared output field that no return site populates
fails the tool's own output validation. This is the second of the two return sites.

### Step 9 — `test/support/published.ts` — REPLACE — the claim table and the reachability classifier

This is the census machinery. It is inserted immediately before the existing `TOOLS_DIR` constant so
that `claimsReachable` is declared before step 10 uses it.

FIND:

```ts
const TOOLS_DIR = fileURLToPath(new URL('../../src/server/tools', import.meta.url))
```

REPLACE:

```ts
export type PublishedClaim = { phrase: string; providers: readonly string[] }

export const PUBLISHED_CLAIMS: Readonly<Record<string, readonly PublishedClaim[]>> = {
  open_thread: [
    {
      phrase:
        'A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion',
      providers: ['open_thread.title', 'open_thread.slug', 'open_thread.completion_criteria']
    }
  ],
  update_thread: [
    { phrase: 'mark criteria done', providers: ['update_thread.criteria_done'] },
    {
      phrase: 'refresh any of the six running-summary fields',
      providers: [
        'update_thread.active_goal',
        'update_thread.next_step',
        'update_thread.last_session',
        'update_thread.risks_add',
        'update_thread.key_decisions_add',
        'update_thread.out_of_scope_add'
      ]
    },
    {
      phrase: 'set or clear what the thread is blocked on',
      providers: ['update_thread.blocked_by', 'update_thread.blocked_by_clear']
    },
    { phrase: 'add or retire risks', providers: ['update_thread.risks_add', 'update_thread.risks_retire'] }
  ],
  close_thread: [
    {
      phrase: 'Closes one thread as either done or abandoned',
      providers: ['close_thread.thread_id', 'close_thread.outcome']
    },
    { phrase: 'a closure statement must be supplied', providers: ['close_thread.detail'] }
  ],
  amend_criteria: [
    {
      phrase: 'inserting a new one, rewriting the text of an existing one, or striking it',
      providers: ['amend_criteria.operation', 'amend_criteria.text', 'amend_criteria.criterion_id']
    },
    { phrase: 'Every amendment carries a decision_id', providers: ['amend_criteria.decision_id'] },
    { phrase: 'Insert also takes an optional zero-based position', providers: ['amend_criteria.position'] }
  ],
  bind_branch: [
    { phrase: 'Takes a thread id and a branch name', providers: ['bind_branch.thread_id', 'bind_branch.branch'] }
  ],
  resume_thread: [
    {
      phrase:
        'in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left.',
      providers: []
    },
    { phrase: 'Takes one thread id', providers: ['resume_thread.thread_id'] }
  ],
  park_thread: [
    {
      phrase: 'refreshes the last_session and next_step fields',
      providers: ['park_thread.last_session', 'park_thread.next_step']
    },
    { phrase: 'Send the outcome as text', providers: ['park_thread.outcome'] },
    { phrase: 'the thread id is optional', providers: ['park_thread.thread_id'] }
  ],
  record_decision: [
    {
      phrase:
        'Takes the thread it belongs to, a one-line title, the situation that forced the choice, the options that were on the table as a list of strings, and the outcome that was chosen',
      providers: [
        'record_decision.thread_id',
        'record_decision.title',
        'record_decision.context',
        'record_decision.options',
        'record_decision.outcome'
      ]
    },
    { phrase: 'names the old one in supersedes', providers: ['record_decision.supersedes'] }
  ],
  log_session_event: [
    {
      phrase: 'Takes the thread id, who is speaking as a short string',
      providers: ['log_session_event.thread_id', 'log_session_event.actor']
    },
    { phrase: 'the entry body as Markdown text up to 8000 characters', providers: ['log_session_event.body'] }
  ],
  sync_ledger: [{ phrase: 'Takes no arguments', providers: [] }],
  resolve_conflict: [
    { phrase: 'Takes a list of {record, field, winner}', providers: ['resolve_conflict.resolutions'] }
  ],
  list_threads: [
    { phrase: 'pass `cursor` from a previous reply to read the next page', providers: ['list_threads.cursor'] },
    { phrase: '`limit` to change the page size from its default of 25', providers: ['list_threads.limit'] },
    { phrase: 'A thread that is blocked shows what it is blocked on', providers: ['update_thread.blocked_by'] }
  ]
}

type ProviderResolution = 'reachable' | 'unreachable' | 'unresolvable'

const resolveProvider = (address: string, published: readonly PublishedTool[]): ProviderResolution => {
  const separator = address.indexOf('.')
  if (separator <= 0 || separator === address.length - 1) return 'unresolvable'
  const toolName = address.slice(0, separator)
  const key = address.slice(separator + 1)
  const tool = published.find((candidate) => candidate.name === toolName)
  if (tool === undefined) return 'unresolvable'
  const properties = tool.inputSchema.properties
  if (!isPlainObject(properties)) return 'unresolvable'
  return Object.prototype.hasOwnProperty.call(properties, key) ? 'reachable' : 'unreachable'
}

export type ClaimCensusItem = {
  tool: string
  description: string
  phrase: string
  providers: readonly string[] | null
}

export const claimPopulation = (published: readonly PublishedTool[]): ClaimCensusItem[] =>
  published.flatMap((tool): ClaimCensusItem[] => {
    const claims = PUBLISHED_CLAIMS[tool.name]
    if (claims === undefined || claims.length === 0) {
      return [{ tool: tool.name, description: tool.description, phrase: '', providers: null }]
    }
    return claims.map((claim) => ({
      tool: tool.name,
      description: tool.description,
      phrase: claim.phrase,
      providers: claim.providers
    }))
  })

export const classifyPublishedClaim = (item: ClaimCensusItem, published: readonly PublishedTool[]): Verdict => {
  if (item.providers === null) return 'unclassifiable'
  if (!item.description.includes(item.phrase)) return 'unclassifiable'
  if (item.providers.length === 0) return 'allowed'
  const resolutions = item.providers.map((provider) => resolveProvider(provider, published))
  if (resolutions.some((resolution) => resolution === 'unresolvable')) return 'unclassifiable'
  return resolutions.every((resolution) => resolution === 'reachable') ? 'allowed' : 'forbidden'
}

export const claimsReachable = (published: readonly PublishedTool[]): string[] =>
  published
    .filter((tool) => claimPopulation([tool]).every((item) => classifyPublishedClaim(item, published) === 'allowed'))
    .map((tool) => tool.name)

const TOOLS_DIR = fileURLToPath(new URL('../../src/server/tools', import.meta.url))
```

Rationale: acceptance criterion 1 — "A census asserts that for each tool, every capability its
description names is reachable through its published input schema." The four verdicts are closed and
exhaustive:

| Situation | Verdict | Why |
| --- | --- | --- |
| the tool has no entry in `PUBLISHED_CLAIMS`, or an empty one | `unclassifiable` | a new tool halts the census until its claims are declared — invariant I8's "answered by classifying the new item" |
| the declared phrase is not a substring of the live description | `unclassifiable` | the table and the shipped prose have drifted apart; halting forces them back into agreement |
| the claim declares providers and every one names a key present in that tool's published `properties` | `allowed` | the capability is reachable |
| a provider names a tool that is not published, or a schema with no `properties` object | `unclassifiable` | the address cannot be resolved, so no honest verdict is available |
| any provider names a key absent from the published schema | `forbidden` | the description names a capability a caller cannot reach |
| the claim declares no providers | `allowed` | the claim needs no caller-supplied argument and is reachable by construction |

`providers: []` is the one verdict that could be abused to silence a real finding, so section 5.1
pins both halves of it with control tests: an empty provider list is `allowed`, and a non-empty one
naming a missing key is `forbidden`.

Note the closed population is **(tool, declared claim)** pairs, and the two `providers: []` entries
(`resume_thread`'s call summary and `sync_ledger`'s "Takes no arguments") are the reason every tool
contributes at least one item even when it takes no arguments.

### Step 10 — `test/support/published.ts` — REPLACE — the fifth census axis

FIND:

```ts
export type RegistryCensus = {
  files: readonly string[]
  registered: readonly string[]
  published: readonly string[]
  guardApproved: readonly string[]
}
```

REPLACE:

```ts
export type RegistryCensus = {
  files: readonly string[]
  registered: readonly string[]
  published: readonly string[]
  guardApproved: readonly string[]
  descriptionClaimsReachable: readonly string[]
}
```

Rationale: the existing production registry census is the single gate over the tool registry. A tool
whose published description names an unreachable capability now falls off one of its axes and halts
that census, instead of the reachability finding living only in a test nobody else reads.

### Step 11 — `test/support/published.ts` — REPLACE — the census reader populates the fifth axis

FIND:

```ts
export const readRegistryCensus = async (s: SpawnedServer): Promise<RegistryCensus> => {
  await importToolBarrel()
  const listed = await s.client.listTools()
  return {
    files: toolFileBasenames(TOOLS_DIR),
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: listed.tools.map((tool) => tool.name),
    guardApproved: [...LEDGER_TOOL_NAMES]
  }
}
```

REPLACE:

```ts
export const readRegistryCensus = async (s: SpawnedServer): Promise<RegistryCensus> => {
  await importToolBarrel()
  const listed = await s.client.listTools()
  const published: PublishedTool[] = listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>
  }))
  return {
    files: toolFileBasenames(TOOLS_DIR),
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: published.map((tool) => tool.name),
    guardApproved: [...LEDGER_TOOL_NAMES],
    descriptionClaimsReachable: claimsReachable(published)
  }
}
```

Rationale: the reader already holds the listed tools; it now shapes them into the `PublishedTool`
form the classifier consumes rather than throwing away the descriptions and the input schemas.

### Step 12 — `test/support/published.ts` — REPLACE — the conjunction and the union take the fifth axis

FIND:

```ts
  const inPublished = c.published.includes(name)
  const inGuardApproved = c.guardApproved.includes(name)
  return inFiles && inRegistered && inPublished && inGuardApproved ? 'allowed' : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published, ...c.guardApproved])]
```

REPLACE:

```ts
  const inPublished = c.published.includes(name)
  const inGuardApproved = c.guardApproved.includes(name)
  const inClaimsReachable = c.descriptionClaimsReachable.includes(name)
  return inFiles && inRegistered && inPublished && inGuardApproved && inClaimsReachable
    ? 'allowed'
    : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published, ...c.guardApproved, ...c.descriptionClaimsReachable])]
```

Rationale: this is the same extension MSP-5 made for its fourth axis — the conjunction gains one
term, the union gains one spread. The four-way shape is extended, never rewritten.

### Step 13 — `test/contract/published-schema.test.ts` — REPLACE — the four synthetic literals gain the field

`RegistryCensus` is an exact object type, so every literal must carry the new key or the file stops
compiling. There are four, all inside the block MSP-5 authored. Apply all four edits.

**Edit 13a.** FIND:

```ts
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: [],
    guardApproved: ['ghost_tool']
  }
```

REPLACE:

```ts
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: [],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: ['ghost_tool']
  }
```

**Edit 13b.** FIND:

```ts
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool'],
    guardApproved: ['real_tool']
  }
```

REPLACE:

```ts
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool'],
    guardApproved: ['real_tool'],
    descriptionClaimsReachable: ['real_tool']
  }
```

**Edit 13c.** FIND:

```ts
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: ['ghost_tool'],
    guardApproved: []
  }
```

REPLACE:

```ts
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: ['ghost_tool'],
    guardApproved: [],
    descriptionClaimsReachable: ['ghost_tool']
  }
```

**Edit 13d.** FIND:

```ts
    files: [],
    registered: [],
    published: [],
    guardApproved: ['ghost_tool']
  }
```

REPLACE:

```ts
    files: [],
    registered: [],
    published: [],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: []
  }
```

Rationale: each literal keeps failing for exactly the axis its own test name states. Edit 13c's test
is named `...halts-on-a-name-registered-but-not-guard-approved`, so `descriptionClaimsReachable`
carries the name and `guardApproved` stays the sole cause. Edit 13d's test is named
`...halts-on-a-name-guard-approved-but-not-registered`, so the new axis is empty alongside the three
that already are. Do not rename any of these four tests; MSP-5 already renamed one of them and a
second rename would break nothing but would obscure that history.

### Step 14 — `src/cli/session-start.ts` — REPLACE — the roster line drops its constant token

FIND:

```ts
const renderThreadLine = (thread: Thread): string =>
  `- [${escapeStored(thread.status)}] ${escapeStored(thread.slug)}: ${escapeStored(thread.title)} -- next: ` +
  `${escapeStored(thread.spine.next_step)} (id ${escapeStored(thread.id)})`
```

REPLACE:

```ts
const renderThreadLine = (thread: Thread): string =>
  `- ${escapeStored(thread.slug)}: ${escapeStored(thread.title)} -- next: ` +
  `${escapeStored(thread.spine.next_step)} (id ${escapeStored(thread.id)})`
```

Rationale: SPEC defect D15 — "`src/cli/session-start.ts:36` filters to `status === 'open'` and `:24`
then renders `[${status}]`. The bracket always reads `[open]` and carries no information." Section
3.2 rules that the token is removed rather than made to vary. This removes one interpolation site
from a file the render census walks (`test/contract/render-census.test.ts:21` lists
`src/cli/session-start.ts` in `CENSUSED_FILES`); the remaining four sites keep that population
non-empty, and every one still passes through `escapeStored`.

### Step 15 — `package.json` and `.claude-plugin/plugin.json` — the version bump

Run this exact command from the repository root. It reads the current version, increments the patch,
and writes the same value into both manifests. It never hard-codes a version pair, so a ladder that
has shifted does not invalidate it.

```bash
node -e '
const fs = require("node:fs")
const pkgPath = "package.json"
const pluginPath = ".claude-plugin/plugin.json"
const pkgText = fs.readFileSync(pkgPath, "utf8")
const pluginText = fs.readFileSync(pluginPath, "utf8")
const current = JSON.parse(pkgText).version
const pluginCurrent = JSON.parse(pluginText).version
if (current !== pluginCurrent) {
  console.error("STOP: package.json and .claude-plugin/plugin.json disagree before the bump: " + current + " vs " + pluginCurrent)
  process.exit(1)
}
const parts = current.split(".")
if (parts.length !== 3 || parts.some((p) => !/^[0-9]+$/.test(p))) {
  console.error("STOP: version is not three numeric parts: " + current)
  process.exit(1)
}
const next = parts[0] + "." + parts[1] + "." + String(Number(parts[2]) + 1)
const needle = "\"version\": \"" + current + "\""
const replacement = "\"version\": \"" + next + "\""
for (const [path, text] of [[pkgPath, pkgText], [pluginPath, pluginText]]) {
  if (text.split(needle).length !== 2) {
    console.error("STOP: " + path + " does not contain exactly one " + needle)
    process.exit(1)
  }
  fs.writeFileSync(path, text.replace(needle, replacement))
}
console.log("bumped " + current + " -> " + next)
'
```

Expected exit code `0` and stdout `bumped 1.0.8 -> 1.0.9` under the baseline. A different pair of
numbers means the ladder shifted and is **not** an error; a line beginning `STOP:` is, and section 11
applies.

Then run, expecting exit code `0`:

```bash
node scripts/check-packaging.mjs
```

Expected exit code `0`, and stdout `check-packaging: ok`.

The expected `git diff` under the baseline is exactly two lines changed, one per file:

```diff
 {
   "name": "logbook",
-  "version": "1.0.8",
+  "version": "1.0.9",
   "private": true,
```

```diff
 {
   "name": "logbook",
-  "version": "1.0.8",
+  "version": "1.0.9",
   "displayName": "Logbook",
```

Rationale: invariant I4 — "`package.json` and `.claude-plugin/plugin.json` bump in the same commit;
`node scripts/check-packaging.mjs` passes."

---

## 5. Tests

Every test below drives a store in a temporary directory and never touches this repository's own
ledger, per invariant I7: "This repository *is* the installed plugin... Never verify a change by
observing this session's own ledger behaviour. Every acceptance test drives a fixture store in a
temp directory."

Which test discharges which acceptance criterion:

| Criterion | Discharged by |
| --- | --- |
| 1 — a census asserts every named capability is reachable | `contract.published-schema-matches-enforced.claims.every-published-claim-is-reachable`, plus `...claims.park-thread-summary-fields-are-reachable` and `...claims.list-threads-blockage-promise-has-a-writer` for the two tools the criterion names by name |
| 2 — the SessionStart roster line's status token | `session-start.roster-line-carries-no-status-token` |
| 3 — inertness | section 7, four mutations, each naming the test that must turn red |
| 4 — `npm test` green | section 8, command 6. Section 5.4 is load-bearing for it: without that collector `error.discloses-no-path` regresses from green to red |

### 5.1 `test/contract/published-schema.test.ts` — MODIFIED

**Edit 5.1a — REPLACE — the import list gains three names.**

FIND:

```ts
import {
  classifyPublishedInput,
  classifyRegistryName,
  listPublishedTools,
  readRegistryCensus,
  registryPopulation,
  type PublishedTool,
  type RegistryCensus
} from '../support/published.ts'
```

REPLACE:

```ts
import {
  claimPopulation,
  classifyPublishedClaim,
  classifyPublishedInput,
  classifyRegistryName,
  listPublishedTools,
  readRegistryCensus,
  registryPopulation,
  type ClaimCensusItem,
  type PublishedTool,
  type RegistryCensus
} from '../support/published.ts'
```

**Edit 5.1b — REPLACE — eight new tests are appended after the last existing test.**

**Apply step 13 before this edit.** The FIND below is the final test in the file **as step 13d
leaves it**, so it carries the `descriptionClaimsReachable: []` line step 13d adds. Against a file
where step 13 has not yet run it matches **zero** times, which is stop condition 11.8's "zero
matches" case for the wrong reason. If it matches zero times, re-check that step 13d was applied
before assuming the file has drifted.

FIND:

```ts
test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered', () => {
  const syntheticCensus: RegistryCensus = {
    files: [],
    registered: [],
    published: [],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})
```

REPLACE:

```ts
test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered', () => {
  const syntheticCensus: RegistryCensus = {
    files: [],
    registered: [],
    published: [],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-whose-claims-are-unreachable', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: ['ghost_tool'],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

const CLAIM_PROBE_TOOLS: PublishedTool[] = [
  {
    name: 'probe_claim_writer',
    description: 'A probe tool that publishes one argument named value.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
  }
]

const claimProbeItem = (phrase: string, providers: readonly string[] | null): ClaimCensusItem => ({
  tool: 'probe_claim_writer',
  description: 'A probe tool that publishes one argument named value.',
  phrase,
  providers
})

test('contract.published-schema-matches-enforced.claims.every-published-claim-is-reachable', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = claimPopulation(published)
    assert.ok(items.length > 0, 'expected the published tools to contribute at least one claim to census')
    assert.doesNotThrow(() => census(items, (item) => classifyPublishedClaim(item, published)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.claims.park-thread-summary-fields-are-reachable', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = claimPopulation(published).filter((item) => item.tool === 'park_thread')
    assert.ok(items.length > 0, 'expected park_thread to contribute at least one claim to census')
    assert.doesNotThrow(() => census(items, (item) => classifyPublishedClaim(item, published)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.claims.list-threads-blockage-promise-has-a-writer', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = claimPopulation(published).filter((item) => item.tool === 'list_threads')
    assert.ok(items.length > 0, 'expected list_threads to contribute at least one claim to census')
    assert.doesNotThrow(() => census(items, (item) => classifyPublishedClaim(item, published)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.claims.control.an-undeclared-tool-halts-the-census', () => {
  const items = claimPopulation(CLAIM_PROBE_TOOLS)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.providers, null)
  assert.throws(
    () => census(items, (item) => classifyPublishedClaim(item, CLAIM_PROBE_TOOLS)),
    (error: unknown) => error instanceof Error && error.message.includes('probe_claim_writer')
  )
})

test('contract.published-schema-matches-enforced.claims.control.a-claim-with-no-providers-is-allowed', () => {
  const item = claimProbeItem('publishes one argument named value', [])
  assert.equal(classifyPublishedClaim(item, CLAIM_PROBE_TOOLS), 'allowed')
  assert.doesNotThrow(() => census([item], (candidate) => classifyPublishedClaim(candidate, CLAIM_PROBE_TOOLS)))
})

test('contract.published-schema-matches-enforced.claims.control.a-claim-naming-a-missing-key-is-forbidden', () => {
  const reachable = claimProbeItem('publishes one argument named value', ['probe_claim_writer.value'])
  assert.equal(classifyPublishedClaim(reachable, CLAIM_PROBE_TOOLS), 'allowed')
  const missing = claimProbeItem('publishes one argument named value', ['probe_claim_writer.absent'])
  assert.equal(classifyPublishedClaim(missing, CLAIM_PROBE_TOOLS), 'forbidden')
  assert.throws(
    () => census([missing], (candidate) => classifyPublishedClaim(candidate, CLAIM_PROBE_TOOLS)),
    (error: unknown) => error instanceof Error && error.message.includes('probe_claim_writer.absent')
  )
})

test('contract.published-schema-matches-enforced.claims.control.a-phrase-absent-from-the-description-halts-the-census', () => {
  const drifted = claimProbeItem('a clause this description does not carry', ['probe_claim_writer.value'])
  assert.equal(classifyPublishedClaim(drifted, CLAIM_PROBE_TOOLS), 'unclassifiable')
  assert.throws(
    () => census([drifted], (candidate) => classifyPublishedClaim(candidate, CLAIM_PROBE_TOOLS)),
    (error: unknown) => error instanceof Error && error.message.includes('a clause this description does not carry')
  )
})

test('contract.published-schema-matches-enforced.claims.control.an-unresolvable-provider-address-halts-the-census', () => {
  const noSeparator = claimProbeItem('publishes one argument named value', ['probe_claim_writer'])
  assert.equal(classifyPublishedClaim(noSeparator, CLAIM_PROBE_TOOLS), 'unclassifiable')
  const unknownTool = claimProbeItem('publishes one argument named value', ['probe_absent_tool.value'])
  assert.equal(classifyPublishedClaim(unknownTool, CLAIM_PROBE_TOOLS), 'unclassifiable')
})
```

### 5.2 `test/spawn/blocked-by-writer.test.ts` — NEW FILE

Create this file with exactly these contents, first character to last.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const BLOCKAGE_REASON = 'waiting on the infra approval'

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`blocked-by fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-blocked-by-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Blocked By Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'blocked-by@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook blocked-by fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-blocked-by-plugin-data-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo, pluginData })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const structuredOf = (label: string, result: CallToolResult): Record<string, unknown> => {
  assert.notEqual(result.isError, true, `${label} refused: ${JSON.stringify(result.content)}`)
  const structured = result.structuredContent
  if (!isRecord(structured)) throw new Error(`${label} returned no structured content`)
  return structured
}

const openThread = async (fx: Fixture, slug: string): Promise<string> => {
  const opened = (await fx.spawned.client.callTool({
    name: 'open_thread',
    arguments: { title: 'a thread that can be blocked', slug, completion_criteria: ['the blockage renders'] }
  })) as CallToolResult
  const threadId = structuredOf('open_thread', opened).thread_id
  assert.equal(typeof threadId, 'string', 'open_thread must return a thread_id string')
  return threadId as string
}

const setBlockedBy = async (fx: Fixture, threadId: string, blockedBy: string): Promise<Record<string, unknown>> => {
  const updated = (await fx.spawned.client.callTool({
    name: 'update_thread',
    arguments: { thread_id: threadId, blocked_by: blockedBy }
  })) as CallToolResult
  return structuredOf('update_thread', updated)
}

const clearBlockedBy = async (fx: Fixture, threadId: string): Promise<Record<string, unknown>> => {
  const updated = (await fx.spawned.client.callTool({
    name: 'update_thread',
    arguments: { thread_id: threadId, blocked_by_clear: true }
  })) as CallToolResult
  return structuredOf('update_thread', updated)
}

const rosterRowFor = async (fx: Fixture, threadId: string): Promise<Record<string, unknown>> => {
  const listed = (await fx.spawned.client.callTool({ name: 'list_threads', arguments: {} })) as CallToolResult
  const structured = structuredOf('list_threads', listed)
  const threads = structured.threads
  assert.ok(Array.isArray(threads), 'list_threads must return a threads array')
  const row = (threads as unknown[]).find((candidate) => isRecord(candidate) && candidate.id === threadId)
  if (!isRecord(row)) throw new Error(`list_threads returned no row for thread ${threadId}`)
  return row
}

test('blocked-by.update-thread-sets-what-a-thread-is-blocked-on', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-set')
    const before = await rosterRowFor(fx, threadId)
    assert.equal(before.blocked_by, null, 'a new thread must start with no blockage')

    const result = await setBlockedBy(fx, threadId, BLOCKAGE_REASON)
    assert.equal(result.blocked_by_set, true, 'update_thread must report that it changed the blockage')

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, BLOCKAGE_REASON, 'the roster row must carry the reason that was written')
  })
})

test('blocked-by.update-thread-clears-a-blockage-with-the-clear-flag', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-cleared')
    await setBlockedBy(fx, threadId, BLOCKAGE_REASON)

    const cleared = await clearBlockedBy(fx, threadId)
    assert.equal(cleared.blocked_by_set, true, 'clearing a blockage is a change and must be reported as one')

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, null, 'the roster row must show the blockage was cleared')
  })
})

test('blocked-by.setting-and-clearing-in-one-call-is-refused', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-conflict')
    const result = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, blocked_by: BLOCKAGE_REASON, blocked_by_clear: true }
    })) as CallToolResult
    assert.equal(result.isError, true, 'naming both a blockage and a clear in one call must refuse')
    const text = JSON.stringify(result.content)
    assert.ok(text.includes('blocked_by_clear'), `the refusal must name the field: ${text}`)

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, null, 'a refused call must not have written anything')
  })
})

test('blocked-by.the-published-input-schema-carries-a-top-level-type-for-both-fields', async () => {
  await withFixture(async (fx) => {
    const listed = await fx.spawned.client.listTools()
    const tool = listed.tools.find((candidate) => candidate.name === 'update_thread')
    if (tool === undefined) throw new Error('update_thread was not published')
    const schema = tool.inputSchema as unknown as Record<string, unknown>
    const properties = schema.properties
    if (!isRecord(properties)) throw new Error('update_thread published no properties object')
    for (const key of ['blocked_by', 'blocked_by_clear']) {
      const node: unknown = properties[key]
      if (!isRecord(node)) throw new Error(`update_thread published no schema for ${key}`)
      assert.equal(
        'anyOf' in node || 'oneOf' in node || 'allOf' in node,
        false,
        `${key} published a union keyword, which halts the every-property-described census`
      )
      assert.ok(typeof node.type === 'string', `${key} published no top-level type: ${JSON.stringify(node)}`)
      assert.ok(typeof node.description === 'string' && node.description.trim().length >= 10, `${key} needs a description`)
    }
  })
})

test('blocked-by.a-call-carrying-only-blocked-by-is-not-reported-as-no-change', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-not-silent')
    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, blocked_by: BLOCKAGE_REASON }
    })) as CallToolResult
    const structured = structuredOf('update_thread', updated)
    assert.equal(structured.blocked_by_set, true)
    const text = JSON.stringify(updated.content)
    assert.equal(
      text.includes('no fields were supplied'),
      false,
      'a call carrying only blocked_by must not report that nothing was supplied'
    )
  })
})
```

### 5.3 `test/unit/session-start.test.ts` — NEW FILE

Create this file with exactly these contents, first character to last.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { renderThreadListing } from '../../src/cli/session-start.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-session-start-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: 'a session start thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'write the next test',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const seededListing = (slug: string, fn: (listing: string) => void): void => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const committed = opened.value.commit([makeThread(rt, slug)], `seed one open thread for ${slug}`)
      assert.equal(committed.ok, true)
      fn(renderThreadListing(rt, repo))
    })
  })
}

test('session-start.roster-line-carries-no-status-token', () => {
  seededListing('session-start-no-token', (listing) => {
    const threadLines = listing.split('\n').filter((line) => line.startsWith('- '))
    assert.equal(threadLines.length, 1, `expected exactly one thread line, got: ${listing}`)
    const threadLine = threadLines[0] as string
    assert.equal(
      threadLine.includes('[open]'),
      false,
      `the roster line still carries the constant status token: ${threadLine}`
    )
    assert.doesNotMatch(
      threadLine,
      /^- \[[^\]]*\]/,
      `the roster line still opens with a bracketed status token: ${threadLine}`
    )
  })
})

test('session-start.roster-line-still-carries-slug-title-next-step-and-id', () => {
  seededListing('session-start-fields', (listing) => {
    const threadLines = listing.split('\n').filter((line) => line.startsWith('- '))
    assert.equal(threadLines.length, 1, `expected exactly one thread line, got: ${listing}`)
    const threadLine = threadLines[0] as string
    assert.ok(threadLine.startsWith('- session-start-fields: '), threadLine)
    assert.ok(threadLine.includes('a session start thread'), threadLine)
    assert.ok(threadLine.includes('-- next: write the next test'), threadLine)
    assert.match(threadLine, /\(id [0-9A-HJKMNP-TV-Z]{26}\)$/, threadLine)
  })
})
```


### 5.4 `test/contract/no-path.test.ts` — MODIFIED

`test/contract/no-path.test.ts` runs `error.discloses-no-path`, a census that scans `src/` for every
**exported** function returning a `Refusal`, then requires each one to be exercised so its message can
be checked for a leaked filesystem path. Edit 4b exports a new refusal producer,
`conflictingBlockageRefusal`, so the scan finds it, no collector yields a sample, and the census
halts. That is the census working correctly: it refuses to classify a refusal nobody exercised.

**This is not a finding above the ceiling. It is this change breaking a test that passes today**, so
acceptance criterion 4 (`npm test` green) is unmet until it is fixed, and invariant I1 forbids
merging it. Invariant I8 forbids answering it by un-exporting the function, excluding it from the
scan, adding an allowlist, or pinning a count. It is answered by **classifying the new item** — a
collector that exercises it.

**Edit 5.4a — REPLACE — declare the producer id.**

FIND:

```ts
const UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownDecisionRefusal'
```

REPLACE:

```ts
const UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownDecisionRefusal'
const UPDATE_THREAD_CONFLICTING_BLOCKAGE_PRODUCER: ProducerId =
  'server/tools/update_thread.ts#conflictingBlockageRefusal'
```

Rationale: the producer id is the scanner's own address form — the path relative to `src/`, a `#`,
and the exported name — matching the two `update_thread` producers already declared beside it.

**Edit 5.4b — REPLACE — collect a real sample by driving the handler.**

FIND:

```ts
    if (unknownDecision.ok) throw new Error('expected updateThreadTool to refuse an unresolved decision id')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER, refusal: unknownDecision.refusal })
```

REPLACE:

```ts
    if (unknownDecision.ok) throw new Error('expected updateThreadTool to refuse an unresolved decision id')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER, refusal: unknownDecision.refusal })

    const conflictingBlockage = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      blocked_by: 'waiting on the infra approval',
      blocked_by_clear: true
    })
    if (conflictingBlockage.ok) {
      throw new Error('expected updateThreadTool to refuse a blockage that is both set and cleared in one call')
    }
    refusals.push({
      producer: UPDATE_THREAD_CONFLICTING_BLOCKAGE_PRODUCER,
      refusal: conflictingBlockage.refusal
    })
```

Rationale: this drives the **real handler** rather than calling the refusal constructor directly,
which is the idiom the two collectors immediately above it already use — so the sample proves the
shipped refusal path is reachable, not merely that a constructor returns a well-formed object. It
needs no new import: `updateThreadTool`, `rt`, `STUB_TOOL_CTX` and `threadId` are all already in
scope at this point in the collector.

---

## 6. Red on the parent

**The parent** is the commit this branch was cut from: the tip of `main` at branch-cut time, which
was `0ade582` at authoring time.

**The new tests cannot be run on the parent as written, because they do not compile there.**
`claimPopulation`, `classifyPublishedClaim`, `ClaimCensusItem` and the
`descriptionClaimsReachable` field do not exist on the parent, so
`test/contract/published-schema.test.ts` fails to load rather than failing an assertion. Say so
rather than claiming a red you did not see.

### The substitute procedure

Apply **only** the test-side steps — 9, 10, 11, 12, 13, and both edits of section 5.1, plus the two
new files in 5.2 and 5.3 — and apply **none** of the source-side steps 1 through 8 or step 14. The
tree then carries this plan's census against the parent's unrepaired source. Run:

```bash
node --test test/contract/published-schema.test.ts
node --test test/unit/session-start.test.ts
```

Expected exit code `1` from each. **Six** named failures, with the exact assertion text to expect:

| Test | Expected failure text |
| --- | --- |
| `contract.published-schema-matches-enforced.claims.park-thread-summary-fields-are-reachable` | `AssertionError [ERR_ASSERTION]: Got unwanted exception.` with an actual message containing `census halted on an unclassifiable item:` and `"tool":"park_thread"` and `"phrase":"refreshes the last_session and next_step fields"` |
| `contract.published-schema-matches-enforced.claims.list-threads-blockage-promise-has-a-writer` | `AssertionError [ERR_ASSERTION]: Got unwanted exception.` with an actual message containing `census rejected a forbidden item:` and `"tool":"list_threads"` and `"providers":["update_thread.blocked_by"]` |
| `contract.published-schema-matches-enforced.claims.every-published-claim-is-reachable` | `AssertionError [ERR_ASSERTION]: Got unwanted exception.` with an actual message containing `census halted on an unclassifiable item:` and `"tool":"update_thread"` — `update_thread` is censused before `park_thread` because the census walks the tools in registration order and halts on the first item it cannot classify |
| `contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent` | `AssertionError [ERR_ASSERTION]: Got unwanted exception.` with an actual message containing `census halted on an unclassifiable item: "list_threads"` — the fifth axis excludes every tool whose claims do not all classify `allowed`, and this census walks `registryPopulation`, whose first axis is `toolFileBasenames` in **directory-read order**, which is alphabetical. `list_threads` sorts before `park_thread`, `resume_thread` and `update_thread`, so it is the first excluded name reached. That is a different order from the claim census above, which walks the tools in **registration** order |
| `session-start.roster-line-carries-no-status-token` | `AssertionError [ERR_ASSERTION]: the roster line still carries the constant status token: - [open] session-start-no-token: a session start thread -- next: write the next test (id ...)` |
| `session-start.roster-line-still-carries-slug-title-next-step-and-id` | `AssertionError [ERR_ASSERTION]: - [open] session-start-fields: a session start thread -- next: write the next test (id ...)` — it asserts the line starts `- session-start-fields: `, which is false while the `[open] ` token still occupies that position |

Two of those six name `park_thread` and `list_threads` specifically, which is what acceptance
criterion 1 requires: "Red on the parent for at least `park_thread` and `list_threads`."

Then apply steps 1 through 8 and step 14 and re-run the same two commands. Expected exit code `0`
from each, and the substring `fail 0` in each run's summary.

**Do not write `# fail 0` as the proving substring anywhere.** Node 26 prints `ℹ fail 0`, not
`# fail 0`; the bare `fail 0` is what holds across the Node 22.19 / 24 / 26 matrix this repository
tests on.

---

## 7. Inertness mutation

One mutation per behaviour this plan adds. In each case: apply the mutation, run the named command,
confirm the named test turns red with the named text, then restore exactly.

### 7.1 Restore `park_thread`'s false description

**The edit to revert:** in `src/server/tools/park_thread.ts`, replace

```
refreshes the last_session and next_step fields
```

with

```
refreshes the six running-summary fields
```

**Run:** `node --test test/contract/published-schema.test.ts`

**The test that must turn red:**
`contract.published-schema-matches-enforced.claims.park-thread-summary-fields-are-reachable`

**Expected failure text:** `Got unwanted exception.` with an actual message containing
`census halted on an unclassifiable item:` and `"phrase":"refreshes the last_session and next_step fields"`.

**The exact restore:** replace `refreshes the six running-summary fields` back with
`refreshes the last_session and next_step fields`.

### 7.2 Restore `resume_thread`'s false description

**The edit to revert:** in `src/server/tools/resume_thread.ts`, replace

```
in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left.
```

with

```
in a single call: it reconciles the store, marks the thread as the one being worked on this machine, and renders what the previous session left.
```

**Run:** `node --test test/contract/published-schema.test.ts`

**The test that must turn red:**
`contract.published-schema-matches-enforced.claims.every-published-claim-is-reachable`

**Expected failure text:** `Got unwanted exception.` with an actual message containing
`census halted on an unclassifiable item:` and `"tool":"resume_thread"`.

**The exact restore:** replace the reconciling clause back with the shorter one above. Then re-run
the byte check in section 11.7 and confirm it prints `lead=175`.

### 7.3 Remove the `blocked_by` writer

**The edit to revert:** in `src/server/tools/update_thread.ts`, delete the ten lines edit 4a added:

```ts
  blocked_by: z
    .string()
    .min(1)
    .max(caps.THREAD_BLOCKED_BY_MAX)
    .optional()
    .describe('what this thread is blocked on; omit to leave it unchanged, and send blocked_by_clear to clear it'),
  blocked_by_clear: z
    .boolean()
    .optional()
    .describe('send true to clear what this thread is blocked on; omit to leave it unchanged'),
```

**Run:** `node --test test/contract/published-schema.test.ts`

**The test that must turn red:**
`contract.published-schema-matches-enforced.claims.list-threads-blockage-promise-has-a-writer`

**Expected failure text:** `Got unwanted exception.` with an actual message containing
`census rejected a forbidden item:` and `"providers":["update_thread.blocked_by"]`.

**The exact restore:** re-apply edit 4a's REPLACE block.

### 7.4 Restore the roster line's constant status token

**The edit to revert:** in `src/cli/session-start.ts`, replace

```
  `- ${escapeStored(thread.slug)}: ${escapeStored(thread.title)} -- next: ` +
```

with

```
  `- [${escapeStored(thread.status)}] ${escapeStored(thread.slug)}: ${escapeStored(thread.title)} -- next: ` +
```

**Run:** `node --test test/unit/session-start.test.ts`

**The test that must turn red:** `session-start.roster-line-carries-no-status-token`

**Expected failure text:** `AssertionError [ERR_ASSERTION]: the roster line still carries the
constant status token: - [open] session-start-no-token: ...`

**The exact restore:** re-apply step 14's REPLACE block.

If any of these four mutations leaves its named test green, that test is not testing the change.
Section 11 stop condition 11.12 applies.

---

## 8. Full verification

Run all seven, from the repository root, in this order.

| # | Command | Expected exit | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | no output; the command prints nothing on success |
| 2 | `node --test test/contract/published-schema.test.ts` | 0 | `fail 0` |
| 3 | `node --test test/unit/session-start.test.ts` | 0 | `fail 0` |
| 4 | `node --test test/spawn/blocked-by-writer.test.ts` | 0 | `fail 0` |
| 5 | `node --test "test/contract/**/*.test.ts"` | 0 | `fail 0` |
| 6 | `npm test` | 0 | `fail 0` |
| 7 | `node scripts/check-packaging.mjs` | 0 | `check-packaging: ok` |

Command 5 is called out separately because four further contract censuses read the descriptions
this plan edits, and all three would fail on a careless edit:

- `contract.tool-descriptions-within-budget` (`test/contract/budget.test.ts:33`) censuses every
  description through `classifyDescription`, which forbids a lead sentence over 200 bytes and a
  whole string of 2048 bytes or more. Section 2.4 gives the measured figures for all three edited
  descriptions.
- `contract.every-property-described` (`test/contract/described.test.ts:64`) censuses the tool
  **input** schemas. It requires each new argument's `.describe()` string to be at least 10
  characters after trimming — edit 4a's are 91 and 76 — **and** it returns `'unclassifiable'` for any
  node carrying `anyOf`, `oneOf`, `allOf`, `$defs` or `$ref`, before it reads the description at all.
  That is why neither new argument is `.nullable()`: a nullable input publishes `anyOf` with no
  top-level `type` and would halt this census. Section 5.2's
  `blocked-by.the-published-input-schema-carries-a-top-level-type-for-both-fields` asserts the
  published shape directly, so the constraint is enforced rather than remembered.
- `error.discloses-no-path` (`test/contract/no-path.test.ts:1145`) censuses every **exported**
  refusal producer under `src/` and requires each to be exercised. Edit 4b adds one, and section
  5.4 supplies its collector. Without section 5.4 this test regresses from green to red, which is
  acceptance criterion 4 unmet — not a finding above the ceiling.
- `criteria.no-other-tool-writes-criteria` (`test/contract/criteria-writers.test.ts:68`) censuses
  every property of every tool **input** schema except `amend_criteria`'s.
  `classifyCriteriaTextProperty` (`:47-63`) returns `'unclassifiable'` for any node carrying
  `oneOf`, `anyOf` or `allOf`, and for any node with no `type` keyword — the same `anyOf` hazard as
  above, in a second census. Edit 4a's `blocked_by` publishes `type: 'string'` under a
  `topLevelName` of `blocked_by`, which does not match that test's `/criteri/i` domain pattern and
  so classifies `allowed`; `blocked_by_clear` publishes `type: 'boolean'` and returns `allowed` at
  the `type !== 'string'` branch before the pattern is consulted.
- `render.no-unescaped-site` (`test/contract/render-census.test.ts:487`) censuses every
  interpolation site in `src/cli/session-start.ts` among six other files. Step 14 removes one site
  and leaves every remaining one wrapped in `escapeStored`.

Command 6 is invariant I1 and acceptance criterion 4.

Both command 6's and command 7's expectations are written as ordinary gates expecting exit 0. If
`npm test` is red for the pre-existing dependency reason, stop condition 11.3 applies; do not weaken
the gate to accommodate it.

---

## 9. Commits

### Commit 1

```
feat(update-thread): accept what a thread is blocked on
```

Files:

- `src/server/tools/update_thread.ts`

Plan steps: 3, 4, 5, 6, 7, 8.

### Commit 2

```
fix(descriptions): stop naming capabilities these tools do not have
```

Files:

- `src/server/tools/park_thread.ts`
- `src/server/tools/resume_thread.ts`

Plan steps: 1, 2.

### Commit 3

```
fix(session-start): drop the roster line's constant status token
```

Files:

- `src/cli/session-start.ts`

Plan steps: 14.

### Commit 4

```
test(published): census every published claim against the input schemas
```

Files:

- `test/support/published.ts`
- `test/contract/published-schema.test.ts`
- `test/contract/no-path.test.ts`
- `test/spawn/blocked-by-writer.test.ts`
- `test/unit/session-start.test.ts`

Plan steps: 9, 10, 11, 12, 13, both edits of section 5.1, both edits of section 5.4, and the two new
files in sections 5.2 and 5.3.

### Commit 5

```
chore(release): bump the patch version for the published-description repair
```

Files:

- `package.json`
- `.claude-plugin/plugin.json`

Plan steps: 15.

Commit 2 changes only prose. Commits 1 and 3 carry behaviour changes, and commit 4 carries their
evidence. No commit mixes a refactor with a behaviour change.

---

## 10. Pull request

Open it with exactly this. Fill `--verified` only for checks you actually ran and whose output you
actually read; anything else stays `--not-verified`.

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/msp-8-published-descriptions \
  --base main \
  --title "fix(descriptions): match every published description to the code" \
  --what "A caller can now say what a thread is blocked on, and clear it again, through the tool that already records mid-session progress." \
  --what "The parking and resume tools now describe only what they do, and the start-of-session thread list drops a bracketed state that read the same word on every line." \
  --what "A check now fails the build when a tool published description names something a caller has no argument to reach." \
  --why "Three published descriptions named things a caller could not do, so a reader would send an argument that did not exist or wait for an effect that could not happen." \
  --why "One field was rendered in three places and promised in a description while no published tool could put a value in it." \
  --why "Nothing compared a tool published prose against its published arguments, so a description could drift from the code with no check noticing." \
  --risk "624 lines change, 45 of them production code and the rest the new check and its tests. It is one change because the check must go red before the fix that turns it green exists." \
  --verified "npm test - 0 failures" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/contract/published-schema.test.ts - 0 failures" \
  --verified "node --test test/unit/session-start.test.ts - 0 failures" \
  --verified "node --test test/spawn/blocked-by-writer.test.ts - 0 failures" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "red on the parent - 6 named tests failed before the fix" \
  --verified "inertness - all 4 mutations turned their named test red" \
  --not-verified "mutation (Stryker) - not run against this diff" \
  --not-verified "coverage - not run"
```

Expected exit code `0`, and stdout containing `https://github.com/SatanshuMishra/logbook/pull/`,
which is the URL of the pull request that was opened. A non-zero exit means the invocation was
rejected before any pull request was created — read the message, which names the offending field, and
do not retry through `gh pr create`, which is denied at the gate.

**The field caps this invocation is built to, and why it looks the way it does.** The tool accepts
1 to 3 `--what`, 1 to 3 `--why`, at most one `--risk`, and at most 8 each of `--verified` and
`--not-verified`. Every free-text value is capped at 200 characters and the title at 72. This
invocation uses 3, 3, 1, 8 and 2, and its longest value is the `--risk` line at 176 characters. Do
not add a ninth `--verified` line: if you ran a further check, fold its result into one of the eight
rather than exceeding the cap, and never drop a check you ran in order to fit.

**`--risk` carries the diff size, because a reviewer must learn the size from the pull request body
rather than by opening the Files Changed tab and being surprised.** The body carries the number, the
production-to-test split, and the one-sentence reason the change is not divisible — all of it inside
the 200-character field cap. The fuller treatment stays in section 3.8 of this plan: the per-file
measurement, and the two split shapes that were considered and why each would make acceptance
criterion 1 unsatisfiable. The body carries the fact; the plan carries the working.

The mutation-scope sentence SPEC section 8.2 requires, carried above as a `--not-verified` line: the
Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`,
`src/merge/conflict.ts` and `src/render/**`. This change lives in `src/server/tools/`, `src/cli/`
and `test/`, which fall outside that scope entirely, so the mutation job will report success having
mutated nothing in this diff. **No `Verified: mutation` line may be written for this pull request.**

---

## 11. Stop conditions

Each of these means the tree is not what this plan was written against. For every one:
**STOP and report; do not improvise.**

### 11.1 The two manifests already disagree before you change anything

Run:

```bash
node -e "const fs=require('node:fs');const a=JSON.parse(fs.readFileSync('package.json','utf8')).version;const b=JSON.parse(fs.readFileSync('.claude-plugin/plugin.json','utf8')).version;console.log(a===b?'agree '+a:'DISAGREE '+a+' vs '+b)"
```

Expected exit code `0`; the check is the stdout, not the status. If the output starts with `DISAGREE`, STOP and report; do not improvise. A version merely *higher*
than the `1.0.8` baseline is **not** a stop condition — the ladder shifted, and step 15 increments
whatever it reads.

### 11.2 MSP-0 has not merged, so the manifest-agreement test is still pinned

    Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
    If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
    STOP and report; do not improvise, and do not edit this file.

### 11.3 The local verification baseline is red for a missing development dependency

    If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
    described by the orchestrator is not yet closed in this checkout. STOP and report.
    Do not edit, skip or delete that test, and do not install anything yourself.

This is pre-existing and unrelated to this change: `yaml` is declared as a development dependency but
was never committed into the tracked `node_modules`, and continuous integration installs it, so it is
green there and red only on a local checkout that has not run an install. Closing it is the
operator's act.

### 11.4 MSP-3 has not merged

Run:

```bash
node -e "const s=require('fs').readFileSync('src/server/tools/park_thread.ts','utf8');console.log(s.includes('noWorkedThreadRefusal')?'msp-3 present':'MSP-3 ABSENT')"
```

Expected exit code `0` and output `msp-3 present`. If it prints `MSP-3 ABSENT`, step 1's replacement description
describes behaviour the tree does not have. STOP and report; do not improvise.

### 11.5 MSP-4-A or MSP-4-B has not merged

Run:

```bash
node -e "const s=require('fs').readFileSync('src/server/tools/record_decision.ts','utf8');console.log(s.includes('link_skipped_reason')?'msp-4 present':'MSP-4 ABSENT')"
```

Expected exit code `0` and output `msp-4 present`. If it prints `MSP-4 ABSENT`, STOP and report; do not improvise.

### 11.6 MSP-5 has not merged

Run:

```bash
node -e "const fs=require('fs');const a=fs.existsSync('src/server/tool-names.ts');const b=fs.readFileSync('test/support/published.ts','utf8').includes('guardApproved');console.log(a&&b?'msp-5 present':'MSP-5 ABSENT')"
```

Expected exit code `0` and output `msp-5 present`. If it prints `MSP-5 ABSENT`, steps 10, 11, 12 and 13 have nothing
to match: their FIND blocks are written against the four-axis `RegistryCensus` MSP-5 authored, and
against the four synthetic literals it added. STOP and report; do not improvise, and do not author
the fourth axis yourself.

### 11.7 A description exceeds its byte cap

After steps 1, 2 and 3, run this once per edited description, substituting the exact string you
wrote:

```bash
node -e "const P=/[.!?](?:\s|\$)/;const lead=(d)=>{const m=P.exec(d);return m===null?null:Buffer.byteLength(d.slice(0,m.index+1),'utf8')};const d=process.argv[1];console.log('lead='+lead(d)+' whole='+Buffer.byteLength(d,'utf8'))" "<the description string>"
```

Expected exit code `0` from each run, with stdout exactly as tabulated:

| Tool | Expected output |
| --- | --- |
| `park_thread` | `lead=196 whole=539` |
| `resume_thread` | `lead=175 whole=490` |
| `update_thread` | `lead=179 whole=525` |

Any `lead=` above 200, or any `whole=` at or above 2048, means the string you wrote is not the string
this plan specifies. STOP and report; do not improvise a shorter one.

### 11.8 A FIND block does not match exactly once

Every FIND block in sections 4 and 5 was copied from the file and checked to occur exactly once. If
your editor reports zero matches, or more than one, for any FIND block, the file has changed since
this plan was authored. STOP and report the file and the FIND block; do not improvise a replacement,
and do not widen the FIND to make it unique.

### 11.9 The change is already applied

Run:

```bash
node -e "const s=require('fs').readFileSync('src/server/tools/update_thread.ts','utf8');console.log(String(s.includes('blocked_by_set')))"
```

Expected exit code `0` and output `false`. If it prints `true`, this change is already in the tree. STOP and report;
do not improvise.

### 11.10 A test outside this plan's list turns red

Sections 5, 6 and 8 name every test this change is expected to touch:
`test/contract/published-schema.test.ts`, `test/unit/session-start.test.ts`,
`test/spawn/blocked-by-writer.test.ts`, `test/contract/budget.test.ts`,
`test/contract/described.test.ts`, `test/contract/criteria-writers.test.ts`,
`test/contract/no-path.test.ts` and `test/contract/render-census.test.ts`. If `npm test` reports a
failure in any other test — other than `workflow-hardening-census`, which stop condition 11.3 covers
— STOP and report which one; do not improvise a fix and do not edit that test.

### 11.11 A census halts on something this plan did not change

If any command in section 8 fails with a message containing `census halted on an unclassifiable item`
or `census rejected a forbidden item` naming a tool or a claim this plan does not touch, STOP and
report.

**Do not** resolve it by removing the item from the population, by adding it to an allowlist, by
pinning a count, or by deleting its entry from `PUBLISHED_CLAIMS`. All four are forbidden: invariant
I8 states that "a census that halts is answered by classifying the new item, never by excluding it
from the population, pinning a count, or adding it to an allowlist." The correct shape is a new
`PUBLISHED_CLAIMS` entry that states the tool's claims and their providers truthfully — and
authoring that entry is a change above this plan's ceiling, which is why it is a stop condition
rather than a step.

### 11.12 An inertness mutation does not turn its named test red

If any of section 7's four mutations leaves its named test green, that test is not testing the
change. STOP and report which mutation and which test; do not improvise a stronger assertion.

### 11.13 The parent is not red

If the substitute procedure in section 6 produces exit code `0` from either command, the defects this
change repairs are not present at the parent and the receipt is worthless. STOP and report; do not
improvise.
