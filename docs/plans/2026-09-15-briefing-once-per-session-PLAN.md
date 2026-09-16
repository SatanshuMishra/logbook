# Briefing once per session per thread: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `resume_thread` renders the full briefing the first time a session picks up a thread and a short head of it on every later resume of that same thread in that same session.

**Architecture:** A machine-local record in the state directory remembers which threads this session has already been briefed on. The server reads it and chooses the form; no input can ask for less, and one optional input asks for the full text back. Both forms travel in the existing `briefing` field, so the skill, the verbatim gate and the payload envelope are untouched.

**Tech Stack:** TypeScript on Node's native type stripping, `node:test`, Zod for tool schemas, MCP SDK.

**Spec:** `docs/specs/2026-09-15-briefing-once-per-session.md`

## Global Constraints

- No comments in any authored file, including tests.
- New objects, never mutation in place.
- Every stored string interpolated into rendered text passes `escapeStored`, `escapeStoredBlock`, `clip` or `clipFloor`; `src/render/briefing.ts` is censused for it by `test/contract/render-census.test.ts`.
- `test/contract/skills.test.ts` is not edited by any task in this plan.
- The `resume_thread` output keeps exactly three fields: `thread_id`, `briefing`, `previous_session`.
- Run suites one at a time, never two `npm test` runs in parallel.
- Never run `npm install` or `npm ci`; `node_modules` is vendored and tracked.
- Conventional Commits, one commit per task.

---

### Task 1: the briefed record

**Files:**
- Create: `src/domain/briefed.ts`
- Test: `test/unit/briefed-record.test.ts`

**Interfaces:**
- Consumes: `Runtime` from `src/runtime/runtime.ts`, `StoreLayout` from `src/store/layout.ts`, `durableWrite` from `src/store/durable-write.ts`, `ULID_PATTERN` from `src/schema/ids.ts`.
- Produces: `readBriefed(rt: Runtime, root: StoreLayout): readonly string[]`, `recordBriefed(rt: Runtime, root: StoreLayout, threadId: string): void`, `BRIEFED_THREADS_MAX: number`.

- [ ] **Step 1: Write the failing test**

`test/unit/briefed-record.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRIEFED_THREADS_MAX, readBriefed, recordBriefed } from '../../src/domain/briefed.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'

const THREAD_A = '01M0NDPM0ACCR9CD68PMHYWGGD'
const THREAD_B = '01M0NDPM0ACCR9CD68PMHYWGGE'

const withLayout = (fn: (layout: StoreLayout) => void): void => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-briefed-record-'))
  const state = join(home, 'state')
  mkdirSync(state)
  try {
    fn({ root: home, records: join(home, 'records'), state, projectRoot: home })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('briefed.a-recorded-thread-reads-back-for-the-same-session', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    recordBriefed(rt, layout, THREAD_A)
    assert.deepEqual([...readBriefed(rt, layout)], [THREAD_A])
  })
})

test('briefed.a-second-thread-joins-the-first-without-displacing-it', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    recordBriefed(rt, layout, THREAD_A)
    recordBriefed(rt, layout, THREAD_B)
    assert.deepEqual([...readBriefed(rt, layout)], [THREAD_A, THREAD_B])
  })
})

test('briefed.recording-the-same-thread-twice-stores-it-once', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    recordBriefed(rt, layout, THREAD_A)
    recordBriefed(rt, layout, THREAD_A)
    assert.deepEqual([...readBriefed(rt, layout)], [THREAD_A])
  })
})

test('briefed.a-different-session-reads-nothing-and-takes-the-record-over', () => {
  withLayout((layout) => {
    recordBriefed(testRuntime({ sessionId: 'session-one' }), layout, THREAD_A)
    const second = testRuntime({ sessionId: 'session-two' })
    assert.deepEqual([...readBriefed(second, layout)], [])
    recordBriefed(second, layout, THREAD_B)
    assert.deepEqual([...readBriefed(second, layout)], [THREAD_B])
  })
})

test('briefed.an-absent-record-reads-as-nothing-briefed', () => {
  withLayout((layout) => {
    assert.deepEqual([...readBriefed(testRuntime({ sessionId: 'session-one' }), layout)], [])
  })
})

test('briefed.an-unreadable-or-malformed-record-reads-as-nothing-briefed', () => {
  const malformed = [
    'not json at all',
    '[]',
    '{"session_id":"session-one"}',
    '{"session_id":"","thread_ids":[]}',
    '{"session_id":"session-one","thread_ids":"01M0NDPM0ACCR9CD68PMHYWGGD"}',
    '{"session_id":"session-one","thread_ids":["not-a-ulid"]}'
  ]
  for (const contents of malformed) {
    withLayout((layout) => {
      writeFileSync(join(layout.state, 'briefed.json'), contents)
      assert.deepEqual(
        [...readBriefed(testRuntime({ sessionId: 'session-one' }), layout)],
        [],
        `expected a record reading ${contents} to brief this session on nothing`
      )
    })
  }
})

test('briefed.the-cap-drops-the-oldest-thread-first', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    const ids = Array.from({ length: BRIEFED_THREADS_MAX + 1 }, (_value, index) =>
      `01M0NDPM0ACCR9CD68PMHY${String(index).padStart(4, '0')}`
    )
    for (const id of ids) recordBriefed(rt, layout, id)
    const stored = [...readBriefed(rt, layout)]
    assert.equal(stored.length, BRIEFED_THREADS_MAX)
    assert.equal(stored.includes(ids[0] as string), false)
    assert.equal(stored.includes(ids[ids.length - 1] as string), true)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx tsx --test test/unit/briefed-record.test.ts` if the repo's runner needs it, otherwise `npm test -- test/unit/briefed-record.test.ts`; read `package.json` scripts first and use the one the repo already uses.
Expected: FAIL, cannot resolve `src/domain/briefed.ts`.

- [ ] **Step 3: Write the module**

`src/domain/briefed.ts`:

```ts
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { ULID_PATTERN } from '../schema/ids.ts'

const BRIEFED_FILE_NAME = 'briefed.json'

export const BRIEFED_THREADS_MAX = 100

type StoredBriefedShape = { session_id: string; thread_ids: string[] }

const briefedPathFor = (root: StoreLayout): string => path.join(root.state, BRIEFED_FILE_NAME)

const isValidBriefedShape = (value: unknown): value is StoredBriefedShape => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return false
  if (!Array.isArray(candidate.thread_ids)) return false
  return candidate.thread_ids.every((entry) => typeof entry === 'string' && ULID_PATTERN.test(entry))
}

export const readBriefed = (rt: Runtime, root: StoreLayout): readonly string[] => {
  const target = briefedPathFor(root)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    rt.log({
      level: 'warn',
      event: 'briefed.unreadable',
      path: target,
      detail: error instanceof Error ? error.message : String(error)
    })
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    rt.log({ level: 'warn', event: 'briefed.unparseable', path: target, detail: (error as Error).message })
    return []
  }
  if (!isValidBriefedShape(parsed)) {
    rt.log({ level: 'warn', event: 'briefed.invalid-shape', path: target })
    return []
  }
  return parsed.session_id === rt.sessionId ? parsed.thread_ids : []
}

export const recordBriefed = (rt: Runtime, root: StoreLayout, threadId: string): void => {
  const known = readBriefed(rt, root)
  const next = known.includes(threadId) ? known : [...known, threadId]
  const capped = next.slice(Math.max(0, next.length - BRIEFED_THREADS_MAX))
  mkdirSync(root.state, { recursive: true })
  durableWrite(
    briefedPathFor(root),
    JSON.stringify({ session_id: rt.sessionId, thread_ids: capped }),
    { log: rt.log }
  )
}
```

- [ ] **Step 4: Run the test and watch it pass**

Expected: every test in `test/unit/briefed-record.test.ts` passes.

- [ ] **Step 5: Commit**

```bash
git add src/domain/briefed.ts test/unit/briefed-record.test.ts
git commit -m "feat(resume): record which threads a session has been briefed on"
```

---

### Task 2: the handle render

**Files:**
- Modify: `src/render/briefing.ts`
- Test: `test/unit/briefing-handle.test.ts`

**Interfaces:**
- Consumes: `Thread`, `DecisionIntegrity`, `Pointer`, and the private helpers already in `src/render/briefing.ts`: `BRIEFING_HEADING`, `clip`, `escapeStored`, `escapeStoredBlock`, `renderBlockage`, `renderPointerStatus`, `renderUnreadableSessionEntriesLine`, `HEADER_FIELD_ESCAPED_GRAPHEME_MAX`; `toRosterRow` from `src/render/roster.ts`.
- Produces: `renderHandle(thread: Thread, decisionIntegrity: DecisionIntegrity, pointer: Pointer | null, unreadableSessionEntryCount: number): string`, `fitsResumePayload(briefing: string, threadId: string, hasPreviousSession: boolean): boolean`, `BRIEFED_ALREADY_LINE: string`.

- [ ] **Step 1: Write the failing test**

`test/unit/briefing-handle.test.ts`. Build the thread fixture the way `test/unit/briefing.test.ts` already does; read that file first and reuse its fixture helper rather than inventing a second one. The assertions:

```ts
test('handle.carries-the-head-of-the-briefing-and-says-why-it-is-short', () => {
  const handle = renderHandle(threadFixture(), CLEAN_INTEGRITY, POINTER, 0)
  assert.ok(handle.startsWith('# Your Preflight Briefing'))
  assert.ok(handle.includes('**Thread:** '))
  assert.ok(handle.includes('**Status:** '))
  assert.ok(handle.includes('**Blockage:** none'))
  assert.ok(handle.includes('**Currently being worked:** yes'))
  assert.ok(handle.includes('**Criteria:** 1 of 3 done'))
  assert.ok(handle.includes('**Next step:**'))
  assert.ok(handle.includes(BRIEFED_ALREADY_LINE))
  assert.ok(handle.includes('See logbook://thread/'))
})

test('handle.omits-every-section-the-full-briefing-carries-below-the-head', () => {
  const thread = threadFixture()
  const handle = renderHandle(thread, CLEAN_INTEGRITY, POINTER, 0)
  for (const heading of [
    '**Artifacts:**',
    '**Active goal:**',
    '**Last session:**',
    '**Landed:**',
    '**Related:**',
    '**Open risks:**',
    '**Key decisions:**',
    '**Out of scope:**',
    '**Completion criteria:**',
    '**Decisions:**'
  ]) {
    assert.equal(handle.includes(heading), false, `expected the handle to omit ${heading}`)
  }
})

test('handle.is-a-fraction-of-the-full-briefing-on-the-same-thread', () => {
  const thread = threadFixture()
  const full = renderBriefing(thread, CLEAN_INTEGRITY, POINTER, null)
  const handle = renderHandle(thread, CLEAN_INTEGRITY, POINTER, 0)
  assert.ok(handle.length * 2 < full.length, `expected the handle to be less than half the full briefing: ${handle.length} against ${full.length}`)
})

test('handle.reports-the-records-it-could-not-read', () => {
  const handle = renderHandle(threadFixture(), { resolved: 1, dangling: ['01M0NDPM0ACCR9CD68PMHYWGGD'], quarantined: [] }, POINTER, 2)
  assert.ok(handle.includes('1 linked decision record could not be read'))
  assert.ok(handle.includes('2 session log entries on this thread could not be read'))
})

test('handle.escapes-a-stored-value-bearing-markdown', () => {
  const thread = { ...threadFixture(), title: '# not a heading' }
  assert.equal(renderHandle(thread, CLEAN_INTEGRITY, POINTER, 0).includes('\n# not a heading'), false)
})
```

- [ ] **Step 2: Run the test and watch it fail**

Expected: FAIL, `renderHandle` is not exported from `src/render/briefing.ts`.

- [ ] **Step 3: Implement**

In `src/render/briefing.ts`, add the import of the roster row builder beside the existing imports:

```ts
import { toRosterRow } from './roster.ts'
```

Add these beside the other module constants:

```ts
export const BRIEFED_ALREADY_LINE =
  '- this session was already briefed on this thread, so only the head of the briefing is shown'

const renderUnreadableDecisionsHandleLine = (count: number): string =>
  `- ${count} linked decision record${count === 1 ? '' : 's'} could not be read`
```

Export the budget predicate that already exists, renaming nothing else:

```ts
export const fitsResumePayload = (briefing: string, threadId: string, hasPreviousSession: boolean): boolean =>
  fitsBudget(briefing, threadId, hasPreviousSession)
```

Add the renderer after `assembleBriefing`:

```ts
export const renderHandle = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  unreadableSessionEntryCount: number
): string => {
  const row = toRosterRow(thread)
  const unreadableDecisionCount = decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]
  const notShownBulletLines = [
    BRIEFED_ALREADY_LINE,
    ...[unreadableDecisionCount].filter((count) => count > 0).map(renderUnreadableDecisionsHandleLine),
    ...[unreadableSessionEntryCount]
      .filter((count) => count > 0)
      .map((count) => renderUnreadableSessionEntriesLine(count, thread.id))
  ]
  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${clip(thread.title, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    `**Criteria:** ${row.criteria_done} of ${row.criteria_total} done`,
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStoredBlock(value)),
    '',
    '**Not shown:**',
    ...notShownBulletLines,
    `See logbook://thread/${escapeStored(thread.id)} for the complete record.`
  ].join('\n')
}
```

- [ ] **Step 4: Run the unit test, then the render census**

Run the new file, then `test/contract/render-census.test.ts`. The census is the one that fails if any stored value reaches the output unescaped. If it halts as unclassifiable on `row.criteria_done`, replace the roster row with two local filters over `thread.completion_criteria` that reproduce `toRosterRow` exactly: unstruck criteria are those whose `struck_by` is null, done are those among them whose `done` is true.
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/briefing.ts test/unit/briefing-handle.test.ts
git commit -m "feat(render): render the head of a briefing for a session already briefed"
```

---

### Task 3: `resume_thread` chooses the form

**Files:**
- Modify: `src/server/tools/resume_thread.ts`
- Test: `test/contract/resume-briefs-once-per-session.test.ts`

**Interfaces:**
- Consumes: `readBriefed`, `recordBriefed` from Task 1; `renderHandle`, `fitsResumePayload` from Task 2.
- Produces: `resume_thread` accepting `{ thread_id: string; full_briefing?: boolean }`.

- [ ] **Step 1: Write the failing test**

`test/contract/resume-briefs-once-per-session.test.ts`. Copy the harness from `test/contract/resume-payload-single-copy.test.ts:28-75` verbatim (repo fixture, plugin data dir, `runtimeFor(sessionId)`, `openOrdinaryThread`) and rename its constants for this file. The assertions:

```ts
test('resume_thread.briefs-a-session-once-per-thread-and-hands-back-the-head-after-that', async () => {
  await withHarness(async (harness) => {
    const rt = harness.runtimeFor('once-per-session-a')
    const threadId = await openOrdinaryThread(rt, 'resume-briefs-once')
    const otherId = await openOrdinaryThread(rt, 'resume-briefs-once-other')

    const first = await resume(rt, { thread_id: threadId })
    const second = await resume(rt, { thread_id: threadId })
    const other = await resume(rt, { thread_id: otherId })
    const third = await resume(rt, { thread_id: threadId })

    assert.ok(first.briefing.includes('**Completion criteria:**'), 'the first resume of a thread in a session must render the full briefing')
    assert.ok(second.briefing.includes(BRIEFED_ALREADY_LINE), 'the second resume of the same thread in the same session must render the head')
    assert.ok(second.briefing.length < first.briefing.length)
    assert.ok(other.briefing.includes('**Completion criteria:**'), 'a different thread in the same session must render the full briefing')
    assert.ok(third.briefing.includes(BRIEFED_ALREADY_LINE), 'every later resume of a briefed thread must render the head')
  })
})

test('resume_thread.a-new-session-is-briefed-again-on-a-thread-an-earlier-session-read', async () => {
  await withHarness(async (harness) => {
    const first = harness.runtimeFor('once-per-session-a')
    const threadId = await openOrdinaryThread(first, 'resume-briefs-once-new-session')
    await resume(first, { thread_id: threadId })
    const second = await resume(harness.runtimeFor('once-per-session-b'), { thread_id: threadId })
    assert.ok(second.briefing.includes('**Completion criteria:**'))
  })
})

test('resume_thread.full-briefing-asks-for-the-whole-text-back-on-a-thread-already-briefed', async () => {
  await withHarness(async (harness) => {
    const rt = harness.runtimeFor('once-per-session-a')
    const threadId = await openOrdinaryThread(rt, 'resume-briefs-once-override')
    await resume(rt, { thread_id: threadId })
    const forced = await resume(rt, { thread_id: threadId, full_briefing: true })
    assert.ok(forced.briefing.includes('**Completion criteria:**'))
    assert.equal(forced.briefing.includes(BRIEFED_ALREADY_LINE), false)
  })
})

test('resume_thread.refuses-an-input-that-asks-for-less-than-the-rule-gives', () => {
  const parsed = resumeThreadTool.input.safeParse({ thread_id: '01M0NDPM0ACCR9CD68PMHYWGGD', briefing: 'none' })
  assert.equal(parsed.success, false, 'the input is strict, so no key can be introduced that suppresses a briefing')
})
```

- [ ] **Step 2: Run the test and watch it fail**

Expected: FAIL on the second resume still carrying `**Completion criteria:**`, and on `full_briefing` being rejected by the strict input schema.

- [ ] **Step 3: Implement**

In `src/server/tools/resume_thread.ts`, extend the input schema:

```ts
const ResumeThreadInputSchema = z.strictObject({
  thread_id: ulidField(
    `the id of the thread to resume, a ${ULID_LENGTH}-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, from list_threads or the roster resource`
  ),
  full_briefing: z
    .boolean()
    .optional()
    .describe(
      'render the whole briefing even when this session has already been briefed on this thread; the first resume of a thread in a session returns the whole briefing and later ones return its head, and this asks for the whole text back, for a session whose context no longer holds it'
    )
})
```

Widen the tool description's last sentence to say which form comes back:

```ts
    `Picks up one thread and returns its finished briefing in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left. Takes one thread id, a ${ULID_LENGTH}-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The first resume of a thread in a session returns the whole briefing and every later resume of it returns the head of that briefing, which names what it leaves out; pass full_briefing to ask for the whole text back. Either way the text it returns is finished and meant to be shown as it stands.`
```

Replace the render block, keeping the session-entry read that both forms need:

```ts
    const rendersFull = input.full_briefing === true || !readBriefed(rt, layout.value).includes(thread.id)

    const briefing = rendersFull
      ? renderBriefingWithPasses(
          thread,
          decisionIntegrity,
          writtenPointer,
          resolvePredecessor(rt, store, thread),
          hasPreviousSession,
          sessionEntries,
          unreadableSessionEntryCount
        )
      : { briefing: renderHandle(thread, decisionIntegrity, writtenPointer, unreadableSessionEntryCount), withinBudget: true }

    const text = briefing.briefing
    const withinBudget = rendersFull
      ? briefing.withinBudget
      : fitsResumePayload(text, thread.id, hasPreviousSession)

    if (!withinBudget) {
      rt.log({
        level: 'error',
        event: 'briefing.budget-exceeded',
        chars: text.length,
        bytes: resumePayloadBytes(text, thread.id, hasPreviousSession)
      })
    }

    if (rendersFull) recordBriefed(rt, layout.value, thread.id)
```

and return `briefing: text`. Name the locals however reads cleanest; what matters is that the clip search runs only on the full path and that `recordBriefed` runs only after a full render.

- [ ] **Step 4: Run the new contract test, then the whole suite**

Run the new file, then the full suite once, serially. Expect `test/contract/skills.test.ts`, `test/contract/resume-payload-envelope.test.ts` and `test/contract/resume-payload-single-copy.test.ts` to pass unedited. If any existing test resumes one thread twice under one session id and asserts on the full text, that test is the contract this change breaks: record which, because it decides the release version.

- [ ] **Step 5: Commit**

```bash
git add src/server/tools/resume_thread.ts test/contract/resume-briefs-once-per-session.test.ts
git commit -m "feat(resume): brief a session once per thread and hand back the head after that"
```

---

### Task 4: the rule, the prediction and the gate

**Files:**
- Modify: `docs/rules/continuity-ledger.md:209-220`
- Modify: `test/contract/resume-payload-single-copy.test.ts`
- Modify: `test/hooks/stop-gate-latch-order.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 3.
- Produces: no code interface.

- [ ] **Step 1: Extend the payload prediction test to the handle**

In `test/contract/resume-payload-single-copy.test.ts`, add a third measured reply: resume the same thread twice under one session id so the second is a handle, and run the existing two assertions over it. The prediction must bound the handle reply as tightly as it bounds a full one.

- [ ] **Step 2: Run it and watch it pass or fail honestly**

Expected: PASS. A failure here means `resumePayloadBytes` mispredicts the shorter reply; fix the prediction, not the assertion.

- [ ] **Step 3: Prove the gate owes the handle**

In `test/hooks/stop-gate-latch-order.test.ts`, add one test: a transcript whose `resume_thread` result carries a handle and no assistant echo blocks, and the same transcript with the handle echoed is silent. Reuse the file's existing `writeTranscriptWithUnpaidResumeDebt` and `writeTranscriptWithPaidResumeDebt` helpers with the handle text as the briefing, under fresh session ids.

- [ ] **Step 4: Write the rule**

In `docs/rules/continuity-ledger.md`, in the Resuming section, after the sentence ordering the verbatim print, add:

```markdown
The first resume of a thread in a session returns the whole briefing. Every later resume of that same
thread in that same session returns its head: the thread, its status, its blockage, its criteria count,
the next step, and a line naming what it leaves out. A resume of a different thread, or the same thread
under a new session, returns the whole briefing again. No input asks for less than that; `full_briefing`
asks for the whole text back when a session no longer holds the briefing it was given.
```

- [ ] **Step 5: Run the full suite once, then commit**

```bash
git add docs/rules/continuity-ledger.md test/contract/resume-payload-single-copy.test.ts test/hooks/stop-gate-latch-order.test.ts
git commit -m "docs(rules): state that a session is briefed once per thread"
```

---

### Task 5: ship it

**Files:**
- Modify: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Open the feature pull request**

Push the branch and open the PR through the centralized tool, never `gh pr create`:

```bash
node ~/.claude/lib/git/pr.mjs pr-create
```

- [ ] **Step 2: Decide the version from what the suite showed**

Minor, `11.2.0`, if no existing pinned contract had to be rewritten in Task 3. Major, `12.0.0`, if one did, per OR44. Task 4 does not count: extending a test to cover a new path is not rewriting a contract.

- [ ] **Step 3: Bump the version on its own branch**

Edit the three files by hand to the chosen version; do not run `npm install` or `npm version`, because `node_modules` is vendored and an install rewrites tracked files.

```bash
git commit -am "chore(release): bump the version to <version>"
```

- [ ] **Step 4: Open the release pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create
```
