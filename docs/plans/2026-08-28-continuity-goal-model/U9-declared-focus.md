# U9 — Declared focus

## 0. Identity

- Wave: 9 (this is unit U9 of the ladder; it depends on units 1 through 8, merged, and nothing in this wave depends on it).
- Branch: no single branch. This unit ships as six independently mergeable parts, each on its own branch, in the ship order A, B, C, D, E, F: `feat/u9a-declared-focus`, `feat/u9b-update-thread-focus`, `test/u9c-write-tools-ignore-the-pointer`, `feat/u9d-declared-scope`, `test/u9e-optional-arguments`, `perf/u9f-resolved-counter` (full table in section 1).
- Closes: `D2`, `D15`, and the completion of `D1`.
- Carries: `B11`, `B12`, `B15`, `B35`, `B39`; invariants `A6`, `S4`, and the `S3` share.
- Depends on: units 1 through 8 of this ladder, merged.
- Creates (new files, wholly owned by this unit): `test/unit/briefing-focus.test.ts` (Part A), `test/spawn/focus.test.ts` (Parts A and B), `test/contract/write-tools-ignore-the-pointer.test.ts` (Part C), `test/contract/optional-arguments-are-absent.test.ts` and `test/support/optional-argument-recipes.ts` (Part E), `test/store/probe-decisions.test.ts` (Part F). No new production module is created; every production edit lands in a file that already exists. `test/support/schema-nodes.ts` is NOT created here - it ships with an earlier unit and is a precondition proven by a stop condition in section 11.
- Also edits (to keep the tree green): `src/store/read-path.ts` and `src/store/records.ts`, because the decisions directory path and the record-file read primitive are both private to the store module, and duplicating either into a new module would create a second source of truth for where a decision record lives. Both files belong to the store unit, which merges seven units earlier, so there is no simultaneous writer. Also `test/support/published.ts` (step A-0), because it repairs U8-B's plan step B6, skipped by the reconstruction that produced `$BASE`: the claim census it carries halts on a registered claim whose phrase is absent from `park_thread`'s live, already-correct description, and that repair is a precondition for every other step in Parts A, B and C.
- Version: Baseline `1.4.1` -> `1.7.2` per orchestrator ruling OR1. Each part reads `package.json`'s `"version"` field, determines its own bump from its Conventional Commits type, writes the same new value into `package.json` and `.claude-plugin/plugin.json` in the same commit as its code change, and runs `node scripts/check-packaging.mjs` expecting exit `0`, both before and after the write. `feat` takes MINOR with PATCH reset to `0`; every other type this unit uses (`test`, `perf`) takes PATCH; no part in this unit takes MAJOR. The six-step form, applied identically by every part in section 12:
  1. Read `"version"` from `package.json` and confirm `.claude-plugin/plugin.json` carries the identical string.
  2. Read the part's Conventional Commits type from the table below.
  3. Compute the new version: MINOR-with-PATCH-reset-to-`0` for `feat`; PATCH for `test` and `perf`.
  4. Write the new version string into `package.json`.
  5. Write the identical new version string into `.claude-plugin/plugin.json`, in the same commit as step 4 and as the code change.
  6. Run `node scripts/check-packaging.mjs` and confirm exit `0`.

  The full ladder this unit produces, in ship order:

  | Part | Type | Before | Bump | After |
  |---|---|---|---|---|
  | A | `feat` | `1.4.1` | MINOR | `1.5.0` |
  | B | `feat` | `1.5.0` | MINOR | `1.6.0` |
  | C | `test` | `1.6.0` | PATCH | `1.6.1` |
  | D | `feat` | `1.6.1` | MINOR | `1.7.0` |
  | E | `test` | `1.7.0` | PATCH | `1.7.1` |
  | F | `perf` | `1.7.1` | PATCH | `1.7.2` |

  A version merely higher than the baseline a part reads means the ladder shifted underneath it and is not a stop condition; the two manifests disagreeing with each other before a part's own change is a stop condition (section 11).

---

## 1. Acceptance criteria (the ceiling)

Built from exactly three sources: every behavioural rule this unit carries, every clause of its green criteria, and every invariant assigned to it.

1. `resume_thread` and `update_thread` each accept an optional `focus` argument, an array of criterion ids, capped at the number of criteria a thread record can hold. — `B15`
2. A focus id naming no criterion on the thread is refused, and the refusal names the field that was wrong, what it accepts, a valid example, and whether a retry can succeed. — `B15`, `A2`
3. Focus is written to the session pointer and never to the thread record. A test reads the stored thread record back and asserts the word `focus` appears nowhere in it. — `B15`, green clause 1
4. `update_thread` writes focus only to a pointer this session holds for this thread. In every other pointer state the call still succeeds and names exactly what it did not do and why. — `B15`, `S4`
5. The briefing renders the declared focus, orders focused risks and key decisions first, and stops printing the focus-not-set sentence once a focus is set. — `B15`, completing `D1`
6. The `preflight` skill passes focus after the human chooses the thread, and the shipped skills census stays green over the edited file. — `B35`
7. Every write tool succeeds when no pointer exists and when a foreign session holds one, over a closed census that halts on a write tool it has no recipe for. — `S4`, green clause 2
8. `record_decision` accepts an optional `criterion_id`, validated against the thread's criteria and written onto the key-decision link. — `B11`, `A2`
9. `deriveScope` and `noOpenCriterionRefusal` are deleted. An omitted scope is stored absent and reported absent, and is never refused. — `B12`, green clause 3, closing `D2`
10. For every optional argument in a closed census over the tool input schemas, omitting it stores no value the caller did not supply and the response reports it absent. No code derives a substitute. — `A6`, green clause 4
11. The blocking assertion of the criterion-ordinal census covers `src/render/` and `src/server/tools/`, the population stays tree-wide, and the one remaining forbidden read is still printed under its own heading. — the `S3` share
12. The resolved counter no longer reads a decision record for a link whose file is absent, and the before-and-after numbers are recorded. — `B39`, green clause 5, closing `D15`

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is not folded into this plan.

The six parts this unit ships as, each an independently mergeable pull request, in ship order:

| Part | Branch | PR scope | Type | Version step | Carries |
|---|---|---|---|---|---|
| A | `feat/u9a-declared-focus` | `focus` | `feat` | MINOR, PATCH to 0 | `B15` write and render, `B35` |
| B | `feat/u9b-update-thread-focus` | `focus` | `feat` | MINOR, PATCH to 0 | `B15` update half |
| C | `test/u9c-write-tools-ignore-the-pointer` | `pointer` | `test` | PATCH | `S4` |
| D | `feat/u9d-declared-scope` | `decisions` | `feat` | MINOR, PATCH to 0 | `B11`, `B12`, the `S3` share |
| E | `test/u9e-optional-arguments` | `arguments` | `test` | PATCH | `A6` |
| F | `perf/u9f-resolved-counter` | `resume` | `perf` | PATCH | `B39` |

Every version step is written as a read-then-increment against whatever `package.json` actually holds, never as a hard-coded pair. No part takes a MAJOR bump: adding an optional argument is additive, and deleting a refusal is strictly more permissive — no call that used to succeed now fails.

---

## 2. Ground truth

All three items below are read from `$BASE`, the tree left by units 1 through 8 of this ladder (post-u8), before any of this unit's six parts land.

### 2.1 Parts A, B and C — declared focus, and write tools ignore the pointer

#### 2.1.1 `src/domain/pointer.ts:1-82` (whole file, at `$BASE`)

```ts
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { ULID_PATTERN, ISO_PATTERN } from '../schema/ids.ts'
import type { Ulid, Iso8601 } from '../schema/thread.ts'

export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string }

export type PointerRead = { kind: 'absent' } | { kind: 'pointer'; value: Pointer } | { kind: 'corrupt'; reason: string }

export type ReleaseOutcome = 'released' | 'not-owned' | 'already-clear'

const POINTER_FILE_NAME = 'active-thread.json'

const pointerPathFor = (root: StoreLayout): string => path.join(root.state, POINTER_FILE_NAME)

const isValidPointerShape = (value: unknown): value is Pointer => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.thread_id !== 'string' || !ULID_PATTERN.test(candidate.thread_id)) return false
  if (typeof candidate.written_at !== 'string' || !ISO_PATTERN.test(candidate.written_at)) return false
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return false
  return true
}

export const readPointer = (rt: Runtime, root: StoreLayout): PointerRead => {
  const target = pointerPathFor(root)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    throw new Error(`readPointer: failed to read ${target}: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    rt.log({ level: 'error', event: 'pointer.unparseable', path: target, detail: (error as Error).message })
    return { kind: 'corrupt', reason: 'the pointer file exists but does not parse as JSON' }
  }

  if (!isValidPointerShape(parsed)) {
    rt.log({ level: 'error', event: 'pointer.invalid-shape', path: target })
    return { kind: 'corrupt', reason: 'the pointer file exists but does not match the pointer shape' }
  }

  return {
    kind: 'pointer',
    value: { thread_id: parsed.thread_id, written_at: parsed.written_at, session_id: parsed.session_id }
  }
}

export const writePointer = (rt: Runtime, root: StoreLayout, p: Pointer): void => {
  mkdirSync(root.state, { recursive: true })
  const target = pointerPathFor(root)
  const contents = JSON.stringify({ thread_id: p.thread_id, written_at: p.written_at, session_id: p.session_id })
  durableWrite(target, contents, { log: rt.log })
}

export const releasePointer = (rt: Runtime, root: StoreLayout): void => {
  const target = pointerPathFor(root)
  try {
    unlinkSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`releasePointer: failed to remove ${target}: ${(error as Error).message}`)
    }
  }
}

export const releasePointerIfOwned = (rt: Runtime, root: StoreLayout, thread_id: Ulid): ReleaseOutcome => {
  const current = readPointer(rt, root)
  if (current.kind !== 'pointer') return 'already-clear'
  if (current.value.thread_id !== thread_id) return 'not-owned'
  releasePointer(rt, root)
  return 'released'
}
```

What is wrong with this: `Pointer` carries no field naming which completion criteria the session is working on, so no caller of `readPointer`/`writePointer` can persist or recover a session's declared focus; every one of this unit's parts that reads or writes a `Pointer` value depends on that field existing.

#### 2.1.2 `src/render/briefing.ts` — the sites edited (line ranges as read at `$BASE`, full file is 417 lines)

Lines 1-6 (imports), 14-31 (constants + `resumePayloadBytes` + `fitsBudget`), 144-164 (`renderPointerStatus`, `Lane`, `laneFor`, `Laned`, `laneSplit`), 260-262 (`assembleBriefing` signature start), 287-288 (`riskBlocks`/`keyDecisionLines`), 308-310 (`FOCUS_NOT_SET_LINE` usage), 362-406 (`renderBriefingWithPasses`). What is wrong with this: the renderer has no notion of a focused criterion at all — `Lane` is a closed two-value union (`'live' | 'settled'`), `laneSplit`/`laneFor` take no focus argument, `riskBlocks`/`keyDecisionLines` read only the `live` lane, the briefing's Focus line is the constant `FOCUS_NOT_SET_LINE` unconditionally, and neither `resumePayloadBytes` nor `fitsBudget` has a byte term for a focus field, so a rendered focus would silently blow the payload budget. Verbatim, quoted at the cited line numbers as read at `$BASE`:

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Pointer } from '../domain/pointer.ts'
import { previousSessionEntries } from '../domain/session-log.ts'
import { escapeStored } from './escape.ts'
import { CLIP_MARKER_GRAPHEMES, clipWithMarker } from './clip.ts'
```
```ts
export const BRIEFING_HEADING = '# Your Preflight Briefing'
export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 24000

const RESUME_PAYLOAD_RESERVE_BYTES = 200
const RESUME_PAYLOAD_TARGET_BYTES = RESUME_PAYLOAD_MAX_BYTES - RESUME_PAYLOAD_RESERVE_BYTES

const BRIEFING_COPIES_IN_RESUME_PAYLOAD = 2
const RESUME_PAYLOAD_SCAFFOLD_BYTES = 114
const PREVIOUS_SESSION_NULL_BYTES = 4
const PREVIOUS_SESSION_LARGEST_BYTES = 82
const PREVIOUS_SESSION_PRESENT_EXTRA_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES
const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
const PREVIOUS_SESSION_DEFAULT_PRESENT = true
const JSON_STRING_DELIMITER_BYTES = 2

const jsonEscapedByteLen = (text: string): number =>
  Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES
```
```ts
const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

type Lane = 'live' | 'settled'

const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  return criterion.struck_by !== null || criterion.done ? 'settled' : 'live'
}

type Laned<T> = { live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>
): Laned<T> => ({
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
})
```
```ts
const assembleBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
```
```ts
  const riskBlocks = risks.live.map((item) => renderRiskBlock(item, renderClip))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
```
```ts
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    FOCUS_NOT_SET_LINE,
```
```ts
export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
  sessionEntries: readonly SessionEntry[] = []
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)
  const previousEntries = previousSessionEntries(sessionEntries)

  const renderWith = (renderClip: RenderClip, textWasClipped: boolean): string =>
    assembleBriefing(
      thread,
      decisionIntegrity,
      pointer,
      predecessor,
      risks,
      keyDecisions,
      thread.spine.out_of_scope,
      thread.completion_criteria,
      previousEntries,
      renderClip,
      textWasClipped
    )

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
  })

  const unclipped = renderWith(UNCLIPPED, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (perItemClip) => renderWith(clipAt(perItemClip), true),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
    unclipped
  )
  return finish(search.briefing, search.passes + 1)
}
```

This is superseded in full by the diff in section 4, step A-3 below.

#### 2.1.3 `src/server/tools/resume_thread.ts:1-119` (whole file, at `$BASE`)

```ts
import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import { layoutFor } from '../../store/layout.ts'
import { readPointer, writePointer, type Pointer } from '../../domain/pointer.ts'
import { renderBriefingWithPasses, resumePayloadBytes, type DecisionIntegrity } from '../../render/briefing.ts'
import { openProjectStore, loadThread, resolvePredecessor } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const ResumeThreadInputSchema = z.strictObject({
  thread_id: ulidField(
    'the id of the thread to resume, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, from list_threads or the roster resource'
  )
})

const PreviousSessionSchema = z.object({
  thread_id: z.string().describe('the id of the thread a previous session left marked as being worked'),
  written_at: z.string().describe('when the previous session marked that thread as being worked')
})

const ResumeThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was resumed'),
  briefing: z.string().describe('the finished briefing text for this thread, ready to be shown as it stands'),
  previous_session: PreviousSessionSchema.nullable().describe(
    'the thread a previous session left marked as being worked, or null when this session already held the pointer or nothing was marked'
  )
})

type ResumeThreadInput = z.infer<typeof ResumeThreadInputSchema>
type ResumeThreadOutput = z.infer<typeof ResumeThreadOutputSchema>

export const resumeThreadTool: ToolSpec<ResumeThreadInput, ResumeThreadOutput> = {
  name: 'resume_thread',
  title: 'Resume thread',
  description:
    'Picks up one thread and returns its finished briefing in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left. Takes one thread id, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.',
  input: ResumeThreadInputSchema,
  output: ResumeThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const priorPointerRead = readPointer(rt, layout.value)
    const previousSession =
      priorPointerRead.kind === 'pointer' && priorPointerRead.value.session_id !== rt.sessionId
        ? { thread_id: priorPointerRead.value.thread_id, written_at: priorPointerRead.value.written_at }
        : null

    const writtenPointer: Pointer = { thread_id: thread.id, written_at: rt.now(), session_id: rt.sessionId }
    writePointer(rt, layout.value, writtenPointer)

    const decisionOutcomes = thread.spine.key_decisions.map((keyDecision) => ({
      decisionId: keyDecision.decision_id,
      slot: store.readDecision(keyDecision.decision_id)
    }))

    const dangling: string[] = []
    const quarantined: string[] = []
    for (const outcome of decisionOutcomes) {
      if (outcome.slot === null) {
        dangling.push(outcome.decisionId)
        rt.log({ level: 'error', event: 'briefing.decision-dangling', decision_id: outcome.decisionId })
      } else if (outcome.slot.quarantined) {
        quarantined.push(outcome.decisionId)
        rt.log({ level: 'error', event: 'briefing.decision-quarantined', decision_id: outcome.decisionId })
      }
    }

    const decisionIntegrity: DecisionIntegrity = {
      resolved: decisionOutcomes.length - dangling.length - quarantined.length,
      dangling,
      quarantined
    }

    const hasPreviousSession = previousSession !== null
    const sessionEntries = store
      .readSessionEntries(thread.id)
      .flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
    const render = renderBriefingWithPasses(
      thread,
      decisionIntegrity,
      writtenPointer,
      resolvePredecessor(rt, store, thread),
      hasPreviousSession,
      sessionEntries
    )
    const briefing = render.briefing

    if (!render.withinBudget) {
      rt.log({
        level: 'error',
        event: 'briefing.budget-exceeded',
        chars: briefing.length,
        bytes: resumePayloadBytes(briefing, thread.id, hasPreviousSession)
      })
    }

    return {
      ok: true,
      text: briefing,
      structured: {
        thread_id: thread.id,
        briefing,
        previous_session: previousSession
      }
    }
  }
}
```

What is wrong with this: `ResumeThreadInputSchema` accepts no `focus` argument, so a caller cannot declare which completion criteria this session is working on when it resumes a thread; `writtenPointer` is built from `thread.id`/`rt.now()`/`rt.sessionId` alone, with no field to carry a focus even if one were accepted; and there is no validation step rejecting a focus id that names no criterion on the thread, because no such input exists to validate.

#### 2.1.4 `src/server/tools/update_thread.ts` — at `$BASE`

403 lines, imports (1-9), schemas (11-115), refusals (120-208), handler (210-403). What is wrong with this: `UpdateThreadInputSchema` accepts no `focus` argument and `UpdateThreadOutputSchema` reports no `focus_written`/`focus_not_written_reason`, so a session cannot declare its focus through this tool at all; there is no refusal for a focus id naming no criterion on the thread, and no logic anywhere in the handler that reads or writes a pointer. The eight sites the diff in section 4, step B-1 below touches, verbatim as read at `$BASE`:

```ts
import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { KeyDecision, Risk, Spine, Thread } from '../../schema/thread.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { contributeToSpine, type SpineContribution } from '../../domain/spine.ts'
import { commitThread, loadThread, openProjectStore } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)
const optionalUlidField = (description: string) => z.string().regex(ULID_PATTERN).optional().describe(description)
```
```ts
    .array(z.string().min(1).max(caps.OUT_OF_SCOPE_TEXT_MAX).describe('one statement of what this thread explicitly excludes'))
    .max(caps.OUT_OF_SCOPE_MAX_ELEMENTS)
    .optional()
    .describe('out-of-scope statements to append; each one is minted a stable id')
})

const UpdateThreadOutputSchema = z.object({
```
```ts
  risks_retired: z.array(z.string()).describe('ids of risks this call removed from the spine'),
  key_decisions_added: z.array(z.string()).describe('ids minted for key decisions this call linked into the spine'),
  out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added'),
  blocked_by_set: z.boolean().describe('whether this call changed what the thread is blocked on, by either setting or clearing it')
})

type UpdateThreadInput = z.infer<typeof UpdateThreadInputSchema>
```
```ts
  message: `risks_add names criterion ids not present on this thread: ${ids.join(', ')}.`
})

export const updateThreadTool: ToolSpec<UpdateThreadInput, UpdateThreadOutput> = {
  name: 'update_thread',
  title: 'Update thread',
```
```ts
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const criteriaDone = input.criteria_done ?? []
    const criteriaDoneIds = criteriaDone.map((entry) => entry.criterion_id)
    const duplicatedIds = criteriaDoneIds.filter((id, index) => criteriaDoneIds.indexOf(id) !== index)
```
```ts
      spineFieldsUpdated.length === 0 &&
      !blockageChanged

    if (nothingChanged) {
      return {
        ok: true,
```
```ts
          risks_retired: [],
          key_decisions_added: [],
          out_of_scope_added: [],
          blocked_by_set: false
        }
      }
    }
```
```ts
        risks_retired: retiredIds,
        key_decisions_added: newKeyDecisions.map((kd) => kd.id),
        out_of_scope_added: newOutOfScope.map((o) => o.id),
        blocked_by_set: blockageChanged
      }
    }
  }
```

This is superseded in full by the diff in section 4, step B-1.

#### 2.1.5 `skills/preflight/SKILL.md:1-14` (whole file, at `$BASE`)

```md
---
name: preflight
description: Use at the start of work to pick up an existing thread.
---

## Sequence

1. Call `list_threads`.
2. Present the returned `list_threads.threads` as a roster.
3. Wait for the human to choose one thread from that roster.
4. Call `resume_thread` with `resume_thread.thread_id` set to the chosen thread id.
5. Print the returned `resume_thread.briefing` verbatim.
6. Stop.
```

#### 2.1.6 `test/support/published.ts:116-123` — the `park_thread` claim list, at `$BASE`

What is wrong with this: the registered claim's phrase, `refreshes the last_session and next_step fields`, is absent from `park_thread`'s live, already-correct description (`park_thread` no longer accepts `last_session`); the claim census this file drives halts on any registered claim whose phrase cannot be found, so `error.discloses-no-path` and the resume/park spawn contract tests fail before this unit's own changes are even applied. This is U8-B's plan step B6, skipped by the reconstruction that produced `$BASE` (section 0).

```ts
  park_thread: [
    {
      phrase: 'refreshes the last_session and next_step fields',
      providers: ['park_thread.last_session', 'park_thread.next_step']
    },
    { phrase: 'Send the outcome as text', providers: ['park_thread.outcome'] },
    { phrase: 'the thread id is optional', providers: ['park_thread.thread_id'] }
  ],
```

### 2.2 Parts D and E — scope is not fabricated, and every optional argument is absent when omitted

#### 2.2.0 Precondition: `test/support/schema-nodes.ts` does not exist at `$BASE`

`test/support/schema-nodes.ts`, which unit U6 creates and which Part E's census imports, is a precondition this unit depends on, not a change this unit owns, and this plan never creates it — U6 ships it three units earlier, so on a real branch base it is already present. It does not appear as a step in section 4. The reconstruction that produced `$BASE` applied units U1, U4, U5 and U8 only; it did not apply U2, U3, U6 or U7, so the file is absent on that reconstructed tree specifically, which is why the stop condition below matters: it proves the precondition is genuinely met, on whatever tree a part actually starts from, before either Part D or Part E begins any other work. Stop condition: `ls test/support/schema-nodes.ts` — exit `0`, prints `test/support/schema-nodes.ts` (section 11). If it does not: STOP and report; do not improvise, and do not create the file — an absent file here means U6 has not landed on this branch's base.

Full contents, quoted here for orientation only (this plan does not create this file):

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

The flattener answers "what nodes exist"; it does not answer "which of them are optional". Part D's census computes optionality separately, from each parent object node's `required` array, in its own test file — a different question, not a second walker of the same one.

#### 2.2.1 `src/server/tools/record_decision.ts` (before, at `$BASE`)

What is wrong with this: `scope` is optional in the input schema but the handler never leaves it absent — an omitted `scope` is silently replaced by `deriveScope`'s guess at the lowest open criterion, or by a refusal when none is open, so a caller can never record a decision with no particular scope, and `criterion_id` (the field `B11` adds) has nothing to validate against, because nothing in the handler between loading the thread and escaping the title checks an incoming `criterion_id` against it. Lines 14-49 (schema), 54-61 (`deriveScope`), 130-139 (`noOpenCriterionRefusal`), 152-156 (the `loadThread`/`escapedTitle` region step D-3 inserts the `criterion_id` validation into), 178-186 (handler scope logic), 205-211 (`keyDecision` construction), 242-256 (structured reply):

```ts
    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const escapedTitle = escapeStored(input.title)
```

```ts
const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const RecordDecisionInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread this decision belongs to; the thread must currently be open'),
  title: z.string().min(1).max(caps.DECISION_TITLE_MAX).describe('a one-line title for the decision'),
  context: z.string().max(caps.DECISION_CONTEXT_MAX).describe('the situation that forced this choice'),
  options: z
    .array(z.string().max(caps.DECISION_OPTION_MAX).describe('one option that was on the table'))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .describe('the options that were on the table, for example ["ship the fast path", "keep the safe default"]'),
  outcome: z.string().max(caps.DECISION_OUTCOME_MAX).describe('the outcome that was chosen and why'),
  scope: z
    .string()
    .min(1)
    .max(caps.KEY_DECISION_SCOPE_MAX)
    .optional()
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the lowest-numbered completion criterion that is neither done nor struck is used'
    ),
  supersedes: z
    .array(ulidField('the id of a decision this new one reverses or replaces'))
    .max(caps.DECISION_SUPERSEDES_MAX_ELEMENTS)
    .optional()
    .describe('decision ids this new decision supersedes; omit or send an empty array when this decision supersedes nothing')
})

const RecordDecisionOutputSchema = z.object({
  decision_id: z.string().describe('the id minted for the new decision record'),
  thread_id: z.string().describe('the id of the thread the decision was recorded against'),
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read'),
  linked: z.boolean().describe('whether this call also linked the decision into the thread running summary'),
  link_skipped_reason: z
    .string()
    .nullable()
    .describe('why the spine link was not written, or null when it was written')
})
```

```ts
const deriveScope = (thread: Thread): string | null => {
  const open = thread.completion_criteria.filter((criterion) => !criterion.done && criterion.struck_by === null)
  const lowest = open.reduce<Criterion | null>(
    (best, candidate) => (best === null || candidate.ordinal < best.ordinal ? candidate : best),
    null
  )
  return lowest === null ? null : `criterion ${lowest.ordinal}`
}
```

```ts
export const noOpenCriterionRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'scope',
  accepted: 'an explicit scope, when no completion criterion is left open to derive one from',
  example: 'the merge queue fast path',
  retryable: true,
  message: `every completion criterion on thread ${threadId} is done or struck, so scope cannot be derived; the decision was not recorded; remedy: send scope explicitly and retry.`
})
```

```ts
    const escapedScope = input.scope === undefined ? deriveScope(thread) : escapeStored(input.scope)
    if (escapedScope === null) {
      return { ok: false, refusal: noOpenCriterionRefusal(thread.id) }
    }
    if (escapedScope.length > caps.KEY_DECISION_SCOPE_MAX) {
      return { ok: false, refusal: scopeCapRefusal(escapedScope.length) }
    }
```

```ts
    const keyDecision: KeyDecision = {
      id: rt.ulid(),
      decision_id: validated.value.id,
      title: validated.value.title,
      scope: escapedScope
    }
```

```ts
      structured: {
        decision_id: validated.value.id,
        thread_id: thread.id,
        commit: validated.value.commit,
        linked: linkSkippedReason === null,
        link_skipped_reason: linkSkippedReason
      }
```

#### 2.2.2 `test/contract/no-path.test.ts` (before)

What is wrong with this: the import names a producer function (`noOpenCriterionRefusal`) that step D-7 deletes, and the one refusal it drives (line 463) calls that same deleted function directly rather than through the handler, so this file cannot compile or run once `record_decision.ts` stops exporting it. Verbatim, at the cited lines as read at `$BASE`:

Lines 28-32 (import):
```ts
import {
  recordDecisionTool,
  invalidDecisionRefusal,
  noOpenCriterionRefusal
} from '../../src/server/tools/record_decision.ts'
```
Line 127 (producer constant):
```ts
const RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER: ProducerId = 'server/tools/record_decision.ts#noOpenCriterionRefusal'
```
Line 463 (drive):
```ts
    refusals.push({ producer: RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER, refusal: noOpenCriterionRefusal(threadId) })
```

#### 2.2.3 `test/unit/briefing-hides-nothing.test.ts` (before)

What is wrong with this: the census only asserts ordinal-reading discipline under `src/render/`; once step D-3 reads `Criterion.id` (not `.ordinal`) under `src/server/tools/` to validate `criterion_id`, that is a new site the census population picks up, but the single-root filter below never routes it into the `census(...)` call, so the new site would go unchecked by this test unless the asserted roots widen (steps D-15/D-16). Verbatim, at the cited lines as read at `$BASE`:

Line 169:
```ts
const UNASSERTED_ORDINAL_ROOT = `src${path.sep}render${path.sep}`
```
Line 190 (its one use):
```ts
  const underRender = population.filter((site) => site.file.startsWith(UNASSERTED_ORDINAL_ROOT))
```

#### 2.2.4 `test/spawn/decisions.test.ts` (before)

What is wrong with this: all three tests assert behaviour steps D-6 and D-7 delete outright — a derived scope and a refusal when no criterion is open — so all three would fail to compile once `deriveScope` and `noOpenCriterionRefusal` are gone, and none of the three exercises `criterion_id` at all, which is new surface `B11` adds. Verbatim, lines 344-429 at `$BASE`:

```ts
test('decision.scope-derives-to-the-lowest-open-criterion', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-derivation-fixture', [
      'the first criterion',
      'the second criterion',
      'the third criterion'
    ])
    const first = fixture.criteria[0]
    assert.ok(first !== undefined, 'open_thread must mint the completion criteria it was given')
    assert.equal(first.ordinal, 1, 'the first minted criterion must carry ordinal 1')
    await markCriterionDone(fx, fixture.threadId, first.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with a derived scope',
        context: 'the first criterion is already done',
        options: ['derive the scope', 'demand an explicit one'],
        outcome: 'derive it from the lowest criterion still open'
      }
    })) as CallToolResult
    assertOkResult('record_decision (derived scope)', recorded)

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      'criterion 2',
      'scope must derive to the lowest-ordinal criterion that is neither done nor struck'
    )
  })
})

test('decision.scope-uses-an-explicit-value-in-place-of-the-derived-one', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision with an explicit scope',
        context: 'the caller knows the area better than the derivation does',
        options: ['use the derived scope', 'send an explicit one'],
        outcome: 'send an explicit one',
        scope: 'the merge queue fast path'
      }
    })) as CallToolResult
    assertOkResult('record_decision (explicit scope)', recorded)

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      'the merge queue fast path',
      'an explicit scope must be stored in place of the derived one'
    )
  })
})

test('decision.refuses-naming-scope-when-no-open-criterion-remains', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-refusal-fixture', ['the only criterion'])
    const only = fixture.criteria[0]
    assert.ok(only !== undefined, 'open_thread must mint the one criterion it was given')
    await markCriterionDone(fx, fixture.threadId, only.id)

    const refused = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with nothing to derive a scope from',
        context: 'every criterion is done',
        options: ['invent a scope', 'refuse and say so'],
        outcome: 'refuse and say so'
      }
    })) as CallToolResult

    assert.equal(refused.isError, true, 'record_decision must refuse when scope cannot be derived')
    const text = firstTextOf(refused)
    assert.equal(text.split('\n')[0], 'field: scope')
    assert.match(text, /is done or struck/)
    assert.match(text, /the decision was not recorded/)
  })
})
```

### 2.3 Part F — the resolved counter stops reading records

The line numbers below are as measured against `$BASE` (post-u8), before any part of this unit lands. Part F ships last, after Parts A through E. Parts A, B, D and E each touch a disjoint set of production files from the ones Part F touches (`src/store/read-path.ts`, `src/store/records.ts`, `src/server/tools/resume_thread.ts`'s decision-integrity region only), and no part before F touches the specific `resume_thread.ts` content quoted in 2.3.3 (confirmed by reading Part A's full diff in section 4, step A-2: its hunks span original lines 1-6, 11-25, 24-31, 47-66, 56-63 and 101-118, none overlapping 62-100). The FIND anchors in section 4's Part F steps match on content, not on line number, so they still apply correctly at Part F's actual parent (the tree left by Parts A through E), even though the absolute line numbers in that tree differ from the ones quoted here.

#### 2.3.1 `src/store/read-path.ts` — insertion point

What is wrong with this: nothing here returns a bare absent/valid/quarantined classification for a single record file; the only existing primitive, `readRecordFile`, returns the parsed record itself (or `null`, or a quarantine detail), so a caller that only wants the classification, not the parsed value, still has to unpack a `Slot<T> | null`. Part F's `probeDecisionIds` (step F-4/F-5) wants exactly the narrower verdict, once per linked decision, without inventing a second parse path. Path: `$BASE/src/store/read-path.ts`. Insertion made between line 242 (end of `readRecordFile`) and line 244 (start of `readAllRecordFiles`). No existing line is altered.

```
221	export const readRecordFile = <T>(filePath: string, declared: Declared<T>): Slot<T> | null => {
222	  let raw: string
223	  try {
224	    raw = readFileSync(filePath, 'utf8')
225	  } catch (error) {
226	    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
227	    throw error
228	  }
229	
230	  let parsedJson: unknown
231	  try {
232	    parsedJson = JSON.parse(raw)
233	  } catch (error) {
234	    return { quarantined: true, path: filePath, reason: `invalid JSON: ${(error as Error).message}` }
235	  }
236	
237	  const result = declared.parse(parsedJson)
238	  if (!result.ok) {
239	    return { quarantined: true, path: filePath, reason: result.message }
240	  }
241	  return { quarantined: false, record: result.value }
242	}
243	
244	export const readAllRecordFiles = <T>(dir: string, declared: Declared<T>): Slot<T>[] => {
```

#### 2.3.2 `src/store/records.ts` — four edit sites

What is wrong with this: `Store` exposes no operation that classifies a batch of decision ids without reading and fully parsing every one of them through `readDecision`, so the resolved-count computation Part F's step F-6 wires in has no cheaper primitive to call than the per-link loop it replaces. Path: `$BASE/src/store/records.ts`.

Site A, line 11 (import):
```
11	import { markMaterialised, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
```

Site B, lines 24-31 (`Store` type):
```
24	export type Store = {
25	  readThread: (id: Ulid) => Slot<Thread> | null
26	  readThreads: () => Slot<Thread>[]
27	  readDecision: (id: Ulid) => Slot<Decision> | null
28	  readSessionEntry: (threadId: Ulid, entryId: Ulid) => Slot<SessionEntry> | null
29	  readSessionEntries: (threadId: Ulid) => Slot<SessionEntry>[]
30	  commit: (changes: RecordChange[], message: string) => CommitResult
31	}
```

Site C, lines 53-57 (path helpers):
```
53	const threadPath = (layout: StoreLayout, id: Ulid): string => path.join(layout.records, 'threads', `${id}.json`)
54	const decisionPath = (layout: StoreLayout, id: Ulid): string =>
55	  path.join(layout.records, 'decisions', `${id}.json`)
56	const sessionEntryPath = (layout: StoreLayout, threadId: Ulid, entryId: Ulid): string =>
57	  path.join(layout.records, 'sessions', threadId, `${entryId}.json`)
```

Site D, lines 154-161 (store object, insertion point before `commit`):
```
154	  const store: Store = {
155	    readThread: (id) => readRecordFile<Thread>(threadPath(storeLayout, id), ThreadRecord),
156	    readThreads: () => readAllRecordFiles<Thread>(path.join(storeLayout.records, 'threads'), ThreadRecord),
157	    readDecision: (id) => readRecordFile<Decision>(decisionPath(storeLayout, id), DecisionRecord),
158	    readSessionEntry: (threadId, entryId) =>
159	      readRecordFile<SessionEntry>(sessionEntryPath(storeLayout, threadId, entryId), SessionRecord),
160	    readSessionEntries: (threadId) =>
161	      readAllRecordFiles<SessionEntry>(path.join(storeLayout.records, 'sessions', threadId), SessionRecord),
```

#### 2.3.3 `src/server/tools/resume_thread.ts` — lines 62-83 (the constrained region)

What is wrong with this: `decisionOutcomes` calls `store.readDecision` for every linked decision, one full parse and schema validation per id, purely to sort each into resolved, dangling or quarantined — the same classification `readRecordVerdict` (step F-1) and `probeDecisions` (step F-5) now provide directly against the decisions directory, at a lower per-call cost, with identical output for every input. Path: `$BASE/src/server/tools/resume_thread.ts`. Exact region replaced: line 62 to line 83. No line from the input schema (1-15), the output schema (17-31), the pointer write (53-60), or the `structured` return block (108-118) is touched.

```
62	    const decisionOutcomes = thread.spine.key_decisions.map((keyDecision) => ({
63	      decisionId: keyDecision.decision_id,
64	      slot: store.readDecision(keyDecision.decision_id)
65	    }))
66	
67	    const dangling: string[] = []
68	    const quarantined: string[] = []
69	    for (const outcome of decisionOutcomes) {
70	      if (outcome.slot === null) {
71	        dangling.push(outcome.decisionId)
72	        rt.log({ level: 'error', event: 'briefing.decision-dangling', decision_id: outcome.decisionId })
73	      } else if (outcome.slot.quarantined) {
74	        quarantined.push(outcome.decisionId)
75	        rt.log({ level: 'error', event: 'briefing.decision-quarantined', decision_id: outcome.decisionId })
76	      }
77	    }
78	
79	    const decisionIntegrity: DecisionIntegrity = {
80	      resolved: decisionOutcomes.length - dangling.length - quarantined.length,
81	      dangling,
82	      quarantined
83	    }
```

---

## 3. Divergences from the SPEC

1. **Wave ordering.** Wave 3 is ordered rather than parallel; the derived-last-session unit merges first, and this plan's FIND strings are authored against the file as that unit leaves it.
2. **No external decomposition procedure.** This ladder depends on no external decomposition procedure. One planner blocked on a skill file that is deleted from disk; this plan proceeds without it and records the absence here.
3. **The attachment field the SPEC calls missing already exists.** The SPEC's defect `D3` says `KeyDecision` has "no attachment field at all", and the schema already carries `criterion_id?: Ulid | undefined`. It was added by commit `a059fcc`. So `B11` adds only the tool argument, not the field.
4. **`S4`'s wording is stronger than `park_thread` can satisfy under every argument set.** With an outcome supplied and a foreign session holding the pointer, `park_thread` refuses, and a shipped test pins that refusal. The census therefore drives `park_thread` with no arguments, which returns ok in both pointer states. Asserting the stronger reading would put two invariants on one event with different verdicts. Filed as an item above the ceiling.
5. **The store cost claim is smaller than the rule's framing suggests.** Give the measured numbers (section 12, Part F).
6. **`A6`'s census has a blind spot, stated plainly:** it compares an omitted run against a supplied run, so it cannot see whether supplying an argument did anything. A dedicated behavioural test covers that instead: `contract.optional-arguments-are-absent.the-response-reports-it-absent` (section 5.2, Part E).
7. **`B35` could not be given an inertness mutation until a test was added** that pins the skill's sequence naming the focus argument. That test is `skill.preflight-passes-the-declared-focus` in `test/contract/skills.test.ts` (section 5, Part A).
8. **A defect in the immediately preceding unit, since repaired there.** The immediately preceding unit's `U8-A` turned two shipped golden briefing tests red without updating them: `briefing.renders-exact-output-for-a-full-thread` and `briefing.omits-empty-list-sections-entirely` in `test/unit/briefing.test.ts`, from a `(legacy) no session log entry...` line the U8 reconstruction left uncalibrated against these two shipped fixtures. The governing ruling settled this: `U8-A` updates both, and it is inside its ceiling, not above it — `P1` requires `npm test` green on every merge commit, and `U8-A`'s own acceptance declares a green suite, so a plan that reddens a shipped test and does not update it has not met its own criterion. Nothing in this unit's diff touches session-log derivation. This is the matching stop condition in section 11: both tests are expected to pass at each part's own parent because `U8-A` repairs them there; if either fails, that repair did not land — STOP and report; do not improvise, and do not edit either test.

---

## 4. The change, step by step

### 4.1 Parts A, B and C

#### Step A-0 — repair (applied first, before anything else in Part A)

File: `test/support/published.ts`. REPLACE.

FIND:
```ts
  park_thread: [
    {
      phrase: 'refreshes the last_session and next_step fields',
      providers: ['park_thread.last_session', 'park_thread.next_step']
    },
    { phrase: 'Send the outcome as text', providers: ['park_thread.outcome'] },
    { phrase: 'the thread id is optional', providers: ['park_thread.thread_id'] }
  ],
```

REPLACE with:
```ts
  park_thread: [
    { phrase: 'refreshes the next_step field', providers: ['park_thread.next_step'] },
    {
      phrase: 'The last_session field is no longer accepted here; it is derived from the session log.',
      providers: []
    },
    { phrase: 'Send the outcome as text', providers: ['park_thread.outcome'] },
    { phrase: 'the thread id is optional', providers: ['park_thread.thread_id'] }
  ],
```

Rationale: this repairs U8-B's plan step B6, skipped by the reconstruction. `park_thread`'s live description (already correct at `$BASE`) no longer contains the sentence `refreshes the last_session and next_step fields`; the claim census in `test/support/published.ts` halts on any registered claim whose phrase is absent from the live description. Applying this repair is a precondition for every other step in Parts A, B and C; without it `test/contract/no-path.test.ts`'s `error.discloses-no-path` (which drives every published tool's description through `classifyDescription`/`PUBLISHED_CLAIMS`) and the resume/park spawn contract tests fail regardless of this unit's own changes.

#### Step A-1 — `src/domain/pointer.ts`

Three edits, applied in order.

**Edit A-1.1** — FIND:
```ts
export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string }

export type PointerRead = { kind: 'absent' } | { kind: 'pointer'; value: Pointer } | { kind: 'corrupt'; reason: string }

export type ReleaseOutcome = 'released' | 'not-owned' | 'already-clear'

const POINTER_FILE_NAME = 'active-thread.json'

const pointerPathFor = (root: StoreLayout): string => path.join(root.state, POINTER_FILE_NAME)

const isValidPointerShape = (value: unknown): value is Pointer => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.thread_id !== 'string' || !ULID_PATTERN.test(candidate.thread_id)) return false
  if (typeof candidate.written_at !== 'string' || !ISO_PATTERN.test(candidate.written_at)) return false
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return false
  return true
}
```
REPLACE with:
```ts
export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string; focus: Ulid[] }

export type PointerRead = { kind: 'absent' } | { kind: 'pointer'; value: Pointer } | { kind: 'corrupt'; reason: string }

export type ReleaseOutcome = 'released' | 'not-owned' | 'already-clear'

const POINTER_FILE_NAME = 'active-thread.json'

const pointerPathFor = (root: StoreLayout): string => path.join(root.state, POINTER_FILE_NAME)

const isUlidArray = (value: unknown): value is Ulid[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && ULID_PATTERN.test(entry))

type StoredPointerShape = { thread_id: string; written_at: string; session_id: string; focus?: unknown }

const isValidPointerShape = (value: unknown): value is StoredPointerShape => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.thread_id !== 'string' || !ULID_PATTERN.test(candidate.thread_id)) return false
  if (typeof candidate.written_at !== 'string' || !ISO_PATTERN.test(candidate.written_at)) return false
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return false
  if ('focus' in candidate && !isUlidArray(candidate.focus)) return false
  return true
}
```
Rationale: `focus` becomes a required field of `Pointer`, always `[]` or an array of ULIDs; `isValidPointerShape` reads forward (a pointer file with no `focus` key is still valid) and rejects a present-but-malformed `focus`.

**Edit A-1.2** — FIND:
```ts
  return {
    kind: 'pointer',
    value: { thread_id: parsed.thread_id, written_at: parsed.written_at, session_id: parsed.session_id }
  }
}

export const writePointer = (rt: Runtime, root: StoreLayout, p: Pointer): void => {
  mkdirSync(root.state, { recursive: true })
  const target = pointerPathFor(root)
  const contents = JSON.stringify({ thread_id: p.thread_id, written_at: p.written_at, session_id: p.session_id })
  durableWrite(target, contents, { log: rt.log })
}
```
REPLACE with:
```ts
  return {
    kind: 'pointer',
    value: {
      thread_id: parsed.thread_id,
      written_at: parsed.written_at,
      session_id: parsed.session_id,
      focus: isUlidArray(parsed.focus) ? parsed.focus : []
    }
  }
}

export const writePointer = (rt: Runtime, root: StoreLayout, p: Pointer): void => {
  mkdirSync(root.state, { recursive: true })
  const target = pointerPathFor(root)
  const contents = JSON.stringify({
    thread_id: p.thread_id,
    written_at: p.written_at,
    session_id: p.session_id,
    focus: p.focus
  })
  durableWrite(target, contents, { log: rt.log })
}
```
Rationale: `readPointer` always returns `focus` (defaulting `[]`); `writePointer` always serialises it, so the file always carries the key after this change.

#### Step A-2 — `src/server/tools/resume_thread.ts`

Full unified diff (both hunks applied together, in file order):

```diff
--- resume_thread.ts (BASE)
+++ resume_thread.ts (WORK)
@@ -1,6 +1,8 @@
 import { z } from 'zod'
 import type { ToolSpec } from '../register.ts'
+import type { Refusal } from '../../schema/declare.ts'
 import { ULID_PATTERN } from '../../schema/ids.ts'
+import * as caps from '../../schema/caps.ts'
 import { layoutFor } from '../../store/layout.ts'
 import { readPointer, writePointer, type Pointer } from '../../domain/pointer.ts'
 import { renderBriefingWithPasses, resumePayloadBytes, type DecisionIntegrity } from '../../render/briefing.ts'
@@ -11,9 +13,25 @@
 const ResumeThreadInputSchema = z.strictObject({
   thread_id: ulidField(
     'the id of the thread to resume, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, from list_threads or the roster resource'
-  )
+  ),
+  focus: z
+    .array(ulidField('a completion criterion this session is focused on; refused when it names no criterion on this thread'))
+    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
+    .optional()
+    .describe(
+      'which completion criteria this session is focused on, recorded on the session pointer this call writes and never on the thread record; omit for none'
+    )
 })
 
+export const unknownFocusRefusal = (ids: string[]): Refusal => ({
+  ok: false,
+  field: 'focus',
+  accepted: 'a criterion_id that names a completion criterion already present on this thread',
+  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
+  retryable: true,
+  message: `focus names ids not present on this thread: ${ids.join(', ')}.`
+})
+
 const PreviousSessionSchema = z.object({
   thread_id: z.string().describe('the id of the thread a previous session left marked as being worked'),
   written_at: z.string().describe('when the previous session marked that thread as being worked')
@@ -24,7 +42,8 @@
   briefing: z.string().describe('the finished briefing text for this thread, ready to be shown as it stands'),
   previous_session: PreviousSessionSchema.nullable().describe(
     'the thread a previous session left marked as being worked, or null when this session already held the pointer or nothing was marked'
-  )
+  ),
+  focus: z.array(z.string()).describe('the focus this call recorded on the session pointer, exactly as stored; empty when none was supplied')
 })
 
 type ResumeThreadInput = z.infer<typeof ResumeThreadInputSchema>
@@ -47,6 +66,12 @@
     if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
     const thread = loaded.value
 
+    const focusIds = input.focus ?? []
+    const unknownFocusIds = focusIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
+    if (unknownFocusIds.length > 0) {
+      return { ok: false, refusal: unknownFocusRefusal(unknownFocusIds) }
+    }
+
     const layout = layoutFor(rt, rt.cwd)
     if (!layout.ok) return { ok: false, refusal: layout }
 
@@ -56,7 +81,7 @@
         ? { thread_id: priorPointerRead.value.thread_id, written_at: priorPointerRead.value.written_at }
         : null
 
-    const writtenPointer: Pointer = { thread_id: thread.id, written_at: rt.now(), session_id: rt.sessionId }
+    const writtenPointer: Pointer = { thread_id: thread.id, written_at: rt.now(), session_id: rt.sessionId, focus: focusIds }
     writePointer(rt, layout.value, writtenPointer)
 
     const decisionOutcomes = thread.spine.key_decisions.map((keyDecision) => ({
@@ -101,7 +126,7 @@
         level: 'error',
         event: 'briefing.budget-exceeded',
         chars: briefing.length,
-        bytes: resumePayloadBytes(briefing, thread.id, hasPreviousSession)
+        bytes: resumePayloadBytes(briefing, thread.id, hasPreviousSession, focusIds.length)
       })
     }
 
@@ -111,7 +136,8 @@
       structured: {
         thread_id: thread.id,
         briefing,
-        previous_session: previousSession
+        previous_session: previousSession,
+        focus: focusIds
       }
     }
   }
```
Rationale: `resume_thread` writes the pointer itself, so `focus` always lands on it; an omitted `focus` writes `[]`, and the output schema reports `focus: string[]` naming exactly what was recorded. The refusal is a handler refusal (checkable only once the thread is loaded), modelled on `danglingRiskCriterionRefusal`, on field `focus`. The cap is reused from `caps.CRITERIA_RETENTION_MAX_ELEMENTS` (200, the same bound a thread record's own criteria are held to, so the cap can never refuse a legitimate focus) rather than a new constant, since `src/schema/caps.ts` belongs to another unit and is not edited. The `resumePayloadBytes` call is threaded with `focusIds.length` because the byte-budget prediction must know about the always-present `focus:[]` field once it lands (see section 12, Part A verification).

#### Step A-3 — `src/render/briefing.ts`

Full unified diff:

```diff
--- briefing.ts (BASE)
+++ briefing.ts (WORK)
@@ -26,23 +26,35 @@
 const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
 const PREVIOUS_SESSION_DEFAULT_PRESENT = true
 const JSON_STRING_DELIMITER_BYTES = 2
+const FOCUS_FIELD_DEFAULT_COUNT = 0
+const FOCUS_FIELD_PREFIX_BYTES = 9
+const FOCUS_ID_SERIALISED_BYTES = 28
+const FOCUS_ID_SEPARATOR_BYTES = 1
 
 const jsonEscapedByteLen = (text: string): number =>
   Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES
 
+const focusFieldBytes = (focusCount: number): number =>
+  FOCUS_FIELD_PREFIX_BYTES +
+  2 +
+  focusCount * FOCUS_ID_SERIALISED_BYTES +
+  Math.max(0, focusCount - 1) * FOCUS_ID_SEPARATOR_BYTES
+
 export const resumePayloadBytes = (
   briefing: string,
   threadId: string,
-  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
+  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
+  focusCount: number = FOCUS_FIELD_DEFAULT_COUNT
 ): number =>
   BRIEFING_COPIES_IN_RESUME_PAYLOAD * jsonEscapedByteLen(briefing) +
   jsonEscapedByteLen(threadId) +
   RESUME_PAYLOAD_SCAFFOLD_BYTES +
-  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES)
+  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES) +
+  focusFieldBytes(focusCount)
 
-const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean): boolean =>
+const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean, focusCount: number): boolean =>
   briefing.length <= BRIEFING_MAX_CHARS &&
-  resumePayloadBytes(briefing, threadId, hasPreviousSession) <= RESUME_PAYLOAD_TARGET_BYTES
+  resumePayloadBytes(briefing, threadId, hasPreviousSession, focusCount) <= RESUME_PAYLOAD_TARGET_BYTES
 
 const RELATED_TITLE_NATURAL_MAX = 100
 const RELATED_SLUG_NATURAL_MAX = 64
@@ -144,23 +156,41 @@
 const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
   pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'
 
-type Lane = 'live' | 'settled'
+const focusLabel = (id: string, criteriaById: ReadonlyMap<string, Criterion>): string => {
+  const criterion = criteriaById.get(id)
+  return criterion === undefined ? escapeStored(id) : `c${criterion.ordinal}`
+}
 
-const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
+const renderFocusLine = (focus: readonly string[], criteriaById: ReadonlyMap<string, Criterion>): string => {
+  if (focus.length === 0) return FOCUS_NOT_SET_LINE
+  const labels = focus.map((id) => focusLabel(id, criteriaById)).join(', ')
+  return `**Focus:** ${labels}. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.`
+}
+
+type Lane = 'focused' | 'live' | 'settled'
+
+const laneFor = (
+  criterionId: string | undefined,
+  criteriaById: ReadonlyMap<string, Criterion>,
+  focus: readonly string[]
+): Lane => {
   if (criterionId === undefined) return 'live'
   const criterion = criteriaById.get(criterionId)
   if (criterion === undefined) return 'live'
-  return criterion.struck_by !== null || criterion.done ? 'settled' : 'live'
+  if (criterion.struck_by !== null || criterion.done) return 'settled'
+  return focus.includes(criterionId) ? 'focused' : 'live'
 }
 
-type Laned<T> = { live: T[]; settled: T[] }
+type Laned<T> = { focused: T[]; live: T[]; settled: T[] }
 
 const laneSplit = <T extends { criterion_id?: string | undefined }>(
   items: readonly T[],
-  criteriaById: ReadonlyMap<string, Criterion>
+  criteriaById: ReadonlyMap<string, Criterion>,
+  focus: readonly string[]
 ): Laned<T> => ({
-  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
-  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
+  focused: items.filter((item) => laneFor(item.criterion_id, criteriaById, focus) === 'focused'),
+  live: items.filter((item) => laneFor(item.criterion_id, criteriaById, focus) === 'live'),
+  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById, focus) === 'settled')
 })
 
 type RenderClip = {
@@ -261,6 +291,8 @@
   thread: Thread,
   decisionIntegrity: DecisionIntegrity,
   pointer: Pointer | null,
+  focus: readonly string[],
+  criteriaById: ReadonlyMap<string, Criterion>,
   predecessor: Thread | null,
   risks: Laned<Risk>,
   keyDecisions: Laned<KeyDecision>,
@@ -284,8 +316,10 @@
   const relatedThreads = predecessor === null ? [] : [predecessor]
   const relatedLines = relatedThreads.map((item) => renderRelatedLine(item, renderClip))
   const artifactLines = artifacts.map((item) => renderArtifactLine(item, renderClip))
-  const riskBlocks = risks.live.map((item) => renderRiskBlock(item, renderClip))
-  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
+  const riskBlocks = [...risks.focused, ...risks.live].map((item) => renderRiskBlock(item, renderClip))
+  const keyDecisionLines = [...keyDecisions.focused, ...keyDecisions.live].map((item) =>
+    renderKeyDecisionLine(item, renderClip.keyDecision)
+  )
   const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
   const criterionBlocks = criteria.map((item) => renderCriterionBlock(item, renderClip))
   const settledLines = [
@@ -307,7 +341,7 @@
     `**Status:** ${escapeStored(thread.status)}`,
     renderBlockage(thread.blocked_by),
     renderPointerStatus(pointer, thread.id),
-    FOCUS_NOT_SET_LINE,
+    renderFocusLine(focus, criteriaById),
     ...artifactLines.slice(0, 1).map(() => ''),
     ...artifactLines.slice(0, 1).map(() => '**Artifacts:**'),
     ...artifactLines,
@@ -368,9 +402,10 @@
   sessionEntries: readonly SessionEntry[] = []
 ): BriefingRender => {
   const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))
+  const focus = pointer !== null && pointer.thread_id === thread.id ? pointer.focus : []
 
-  const risks = laneSplit(thread.spine.open_risks, criteriaById)
-  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)
+  const risks = laneSplit(thread.spine.open_risks, criteriaById, focus)
+  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById, focus)
   const previousEntries = previousSessionEntries(sessionEntries)
 
   const renderWith = (renderClip: RenderClip, textWasClipped: boolean): string =>
@@ -378,6 +413,8 @@
       thread,
       decisionIntegrity,
       pointer,
+      focus,
+      criteriaById,
       predecessor,
       risks,
       keyDecisions,
@@ -391,15 +428,15 @@
   const finish = (briefing: string, passes: number): BriefingRender => ({
     briefing,
     passes,
-    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
+    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession, focus.length)
   })
 
   const unclipped = renderWith(UNCLIPPED, false)
-  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)
+  if (fitsBudget(unclipped, thread.id, hasPreviousSession, focus.length)) return finish(unclipped, 1)
 
   const search = largestFittingClipRender(
     (perItemClip) => renderWith(clipAt(perItemClip), true),
-    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
+    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession, focus.length),
     unclipped
   )
   return finish(search.briefing, search.passes + 1)
```

Rationale: `renderBriefingWithPasses` gains no new parameter — it already receives `pointer`, so `focus` is derived inside it exactly as `const focus = pointer !== null && pointer.thread_id === thread.id ? pointer.focus : []`, and threaded internally to `laneSplit` and `assembleBriefing`. `type Lane`, `laneFor`, `type Laned<T>`, `laneSplit` match the stated order of tests exactly: `'live'` when `criterionId` is undefined; `'live'` when the criterion is unknown; `'settled'` when the criterion is done or struck; `'focused'` when `focus` includes the criterion id; `'live'` otherwise. The `[...risks.focused, ...risks.live]` / `[...keyDecisions.focused, ...keyDecisions.live]` spreads render focused items first, then live, under the existing heading, as ONE list, with no heading added and no item removed — `laneFor` orders, it never hides. `renderFocusLine`/`focusLabel` implement `FOCUS_NOT_SET_LINE` unchanged when `focus` is empty; when non-empty the line is instead `` `**Focus:** ${labels}. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.` `` where `labels` is the focus ids mapped in the order given and joined with `', '`, rendering as `escapeStored(id)` for an id that resolves to nothing on this thread (reachable: `resolve_conflict` can replace a thread record with a remote version that lacks a criterion) and as `c${criterion.ordinal}` for one that resolves. Every interpolated value passes through `escapeStored` because `test/contract/render-census.test.ts` censuses every render site in this file; reading `criterion.ordinal` inside that template literal is a display label, which the ordinal census at `test/unit/briefing-hides-nothing.test.ts` classifies as `allowed`.

`renderFocusLine(focus, criteriaById)` is called at the array-literal site inside `assembleBriefing` rather than passed in as a pre-rendered string, because the render census (`test/contract/render-census.test.ts`) resolves an array element census site through same-file `calleeBody` lookup on a call expression; a bare identifier parameter is not resolvable that way (proven in section 12, Part A verification, run 1).

`focusFieldBytes`/the `resumePayloadBytes`/`fitsBudget` fourth parameter is the fix for the one existing test the new `focus` output field put out of calibration (section 12, Part A verification).

#### Step A-4 — `skills/preflight/SKILL.md`

FIND:
```md
1. Call `list_threads`.
2. Present the returned `list_threads.threads` as a roster.
3. Wait for the human to choose one thread from that roster.
4. Call `resume_thread` with `resume_thread.thread_id` set to the chosen thread id.
5. Print the returned `resume_thread.briefing` verbatim.
6. Stop.
```
REPLACE with:
```md
1. Call `list_threads`.
2. Present the returned `list_threads.threads` as a roster.
3. Wait for the human to choose one thread from that roster.
4. Wait for the human to name the completion criteria being worked this session.
5. Call `resume_thread` with `resume_thread.thread_id` set to the chosen thread id and `resume_thread.focus` set to those criterion ids.
6. Print the returned `resume_thread.briefing` verbatim.
7. Stop.
```
Rationale: `resume_thread.focus` resolves against the live schema only because Step A-2 ships in the same pull request as this step, satisfying `test/contract/skills.test.ts`'s `contract.skill-references-exist` census.

#### Step B-1 — `src/server/tools/update_thread.ts`

Full unified diff:

```diff
--- update_thread.ts (BASE)
+++ update_thread.ts (WORK)
@@ -1,12 +1,15 @@
 import { z } from 'zod'
 import type { ToolSpec } from '../register.ts'
 import type { Refusal } from '../../schema/declare.ts'
+import type { Runtime } from '../../runtime/runtime.ts'
 import { ULID_PATTERN } from '../../schema/ids.ts'
-import type { KeyDecision, Risk, Spine, Thread } from '../../schema/thread.ts'
+import type { KeyDecision, Risk, Spine, Thread, Ulid } from '../../schema/thread.ts'
 import * as caps from '../../schema/caps.ts'
 import { escapeStored } from '../../render/escape.ts'
 import { contributeToSpine, type SpineContribution } from '../../domain/spine.ts'
-import { commitThread, loadThread, openProjectStore } from '../tool-support.ts'
+import { layoutFor } from '../../store/layout.ts'
+import { readPointer, writePointer } from '../../domain/pointer.ts'
+import { commitThread, loadThread, openProjectStore, type Attempt } from '../tool-support.ts'
 
 const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)
 const optionalUlidField = (description: string) => z.string().regex(ULID_PATTERN).optional().describe(description)
@@ -98,7 +101,14 @@
     .array(z.string().min(1).max(caps.OUT_OF_SCOPE_TEXT_MAX).describe('one statement of what this thread explicitly excludes'))
     .max(caps.OUT_OF_SCOPE_MAX_ELEMENTS)
     .optional()
-    .describe('out-of-scope statements to append; each one is minted a stable id')
+    .describe('out-of-scope statements to append; each one is minted a stable id'),
+  focus: z
+    .array(ulidField('a completion criterion this session is focused on; refused when it names no criterion on this thread'))
+    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
+    .optional()
+    .describe(
+      'which completion criteria this session is focused on, written to this session\'s pointer only, never to the thread record; omit to leave it unchanged'
+    )
 })
 
 const UpdateThreadOutputSchema = z.object({
@@ -111,7 +121,12 @@
   risks_retired: z.array(z.string()).describe('ids of risks this call removed from the spine'),
   key_decisions_added: z.array(z.string()).describe('ids minted for key decisions this call linked into the spine'),
   out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added'),
-  blocked_by_set: z.boolean().describe('whether this call changed what the thread is blocked on, by either setting or clearing it')
+  blocked_by_set: z.boolean().describe('whether this call changed what the thread is blocked on, by either setting or clearing it'),
+  focus_written: z.boolean().describe('whether this call wrote focus to this session\'s pointer'),
+  focus_not_written_reason: z
+    .string()
+    .nullable()
+    .describe('why focus was not written to this session\'s pointer, or null when it was written or focus was not supplied')
 })
 
 type UpdateThreadInput = z.infer<typeof UpdateThreadInputSchema>
@@ -207,6 +222,45 @@
   message: `risks_add names criterion ids not present on this thread: ${ids.join(', ')}.`
 })
 
+export const unknownFocusRefusal = (ids: string[]): Refusal => ({
+  ok: false,
+  field: 'focus',
+  accepted: 'a criterion_id that names a completion criterion already present on this thread',
+  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
+  retryable: true,
+  message: `focus names ids not present on this thread: ${ids.join(', ')}.`
+})
+
+type FocusOutcome = { written: boolean; reason: string | null }
+
+export const NO_WORKED_THREAD_FOCUS_REASON =
+  'no thread is marked as being worked on this machine, so there was no session focus to set'
+export const DIFFERENT_THREAD_FOCUS_REASON =
+  "the thread marked as being worked is a different thread, so this thread's focus was not set"
+export const OTHER_SESSION_FOCUS_REASON =
+  'another session holds the record of what is being worked, so this session did not overwrite its focus'
+
+const resolveFocusOutcome = (rt: Runtime, threadId: string, focusIds: Ulid[] | undefined): Attempt<FocusOutcome> => {
+  if (focusIds === undefined) return { ok: true, value: { written: false, reason: null } }
+
+  const layout = layoutFor(rt, rt.cwd)
+  if (!layout.ok) return { ok: false, refusal: layout }
+
+  const pointerRead = readPointer(rt, layout.value)
+  if (pointerRead.kind !== 'pointer') {
+    return { ok: true, value: { written: false, reason: NO_WORKED_THREAD_FOCUS_REASON } }
+  }
+  if (pointerRead.value.thread_id !== threadId) {
+    return { ok: true, value: { written: false, reason: DIFFERENT_THREAD_FOCUS_REASON } }
+  }
+  if (pointerRead.value.session_id !== rt.sessionId) {
+    return { ok: true, value: { written: false, reason: OTHER_SESSION_FOCUS_REASON } }
+  }
+
+  writePointer(rt, layout.value, { ...pointerRead.value, focus: focusIds })
+  return { ok: true, value: { written: true, reason: null } }
+}
+
 export const updateThreadTool: ToolSpec<UpdateThreadInput, UpdateThreadOutput> = {
   name: 'update_thread',
   title: 'Update thread',
@@ -224,6 +278,12 @@
     if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
     const thread = loaded.value
 
+    const focusIds = input.focus
+    const unknownFocusIds = (focusIds ?? []).filter((id) => !thread.completion_criteria.some((c) => c.id === id))
+    if (unknownFocusIds.length > 0) {
+      return { ok: false, refusal: unknownFocusRefusal(unknownFocusIds) }
+    }
+
     const criteriaDone = input.criteria_done ?? []
     const criteriaDoneIds = criteriaDone.map((entry) => entry.criterion_id)
     const duplicatedIds = criteriaDoneIds.filter((id, index) => criteriaDoneIds.indexOf(id) !== index)
@@ -351,6 +411,9 @@
       spineFieldsUpdated.length === 0 &&
       !blockageChanged
 
+    const focusOutcome = resolveFocusOutcome(rt, thread.id, focusIds)
+    if (!focusOutcome.ok) return { ok: false, refusal: focusOutcome.refusal }
+
     if (nothingChanged) {
       return {
         ok: true,
@@ -363,7 +426,9 @@
           risks_retired: [],
           key_decisions_added: [],
           out_of_scope_added: [],
-          blocked_by_set: false
+          blocked_by_set: false,
+          focus_written: focusOutcome.value.written,
+          focus_not_written_reason: focusOutcome.value.reason
         }
       }
     }
@@ -396,7 +461,9 @@
         risks_retired: retiredIds,
         key_decisions_added: newKeyDecisions.map((kd) => kd.id),
         out_of_scope_added: newOutOfScope.map((o) => o.id),
-        blocked_by_set: blockageChanged
+        blocked_by_set: blockageChanged,
+        focus_written: focusOutcome.value.written,
+        focus_not_written_reason: focusOutcome.value.reason
       }
     }
   }
```

Rationale: validation happens after `loadThread`, before any write, as a four-part handler refusal on field `focus`, because the ids in `focus` are only checkable against the loaded thread; the write happens only when a pointer exists AND `pointer.thread_id === thread.id` AND `pointer.session_id === rt.sessionId`, otherwise nothing is written and the reply says so via `focus_written`/`focus_not_written_reason` (always reported; `focus_not_written_reason` is `null` when written or when `focus` was not supplied, otherwise exactly one of the three sentences named in `NO_WORKED_THREAD_FOCUS_REASON`, `DIFFERENT_THREAD_FOCUS_REASON` and `OTHER_SESSION_FOCUS_REASON` above — this is a success that names exactly what it did and did not do, and is what keeps invariant S4 true: no pointer state can make `update_thread` refuse). The cap reuse matches `resume_thread` (`caps.CRITERIA_RETENTION_MAX_ELEMENTS`, no new constant). `resolveFocusOutcome` is invoked once, after every other validation and before the `nothingChanged` early return, so a call supplying only `focus` still writes it, and a call that would otherwise be refused (duplicate criterion, unknown decision, conflicting blockage, etc.) writes neither the thread record nor the pointer — matching the existing invariant that every other refusal in this handler precedes the first write.

`resolveFocusOutcome` treats `PointerRead.kind !== 'pointer'` (covering both `'absent'` and `'corrupt'`) as `NO_WORKED_THREAD_FOCUS_REASON`: a corrupt pointer cannot reliably be said to mark any thread as being worked, which is the closest of the three reasons named above. This is tested directly by `update_thread.reports-focus-not-written-when-the-pointer-file-is-corrupt` (section 5, Part B).

#### Steps for `test/contract/no-path.test.ts` (Parts A and B, one FIND/REPLACE pair per part)

**Part A's pair** — FIND/REPLACE 1:
```
- const RESUME_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/resume_thread.ts#resumeThreadTool.handler'
+ const RESUME_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/resume_thread.ts#resumeThreadTool.handler'
+ const RESUME_THREAD_UNKNOWN_FOCUS_PRODUCER: ProducerId = 'server/tools/resume_thread.ts#unknownFocusRefusal'
```
FIND/REPLACE 2 (inside `collectToolRefusals`, after the existing `resumeUnknownThread` drive and before `resumeForPark`):
```ts
    const resumeUnknownFocus = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      focus: [rt.ulid()]
    })
    if (resumeUnknownFocus.ok) throw new Error('expected resumeThreadTool to refuse a focus id naming no criterion on this thread')
    refusals.push({ producer: RESUME_THREAD_UNKNOWN_FOCUS_PRODUCER, refusal: resumeUnknownFocus.refusal })
```

**Part B's pair** — FIND/REPLACE 1:
```
- const UPDATE_THREAD_BLOCKED_BY_CAP_PRODUCER: ProducerId = 'server/tools/update_thread.ts#blockedByCapRefusal'
+ const UPDATE_THREAD_BLOCKED_BY_CAP_PRODUCER: ProducerId = 'server/tools/update_thread.ts#blockedByCapRefusal'
+ const UPDATE_THREAD_UNKNOWN_FOCUS_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownFocusRefusal'
```
FIND/REPLACE 2 (inside `collectToolRefusals`, after the existing `unknownCriterion` drive and before `unknownDecision`):
```ts
    const updateUnknownFocus = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      focus: [rt.ulid()]
    })
    if (updateUnknownFocus.ok) throw new Error('expected updateThreadTool to refuse a focus id naming no criterion on this thread')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_FOCUS_PRODUCER, refusal: updateUnknownFocus.refusal })
```

Rationale for both pairs: `scanRefusalProducers()` finds each new exported `Refusal`-typed function and the census halts on any producer with no driven refusal; these constants and drives are that coverage, required to keep `error.discloses-no-path` green, not new behaviour.

#### Part C — no production steps

Part C ships one new test file only (`test/contract/write-tools-ignore-the-pointer.test.ts`, section 5, Part C). No production file changes. `S4` pre-dates this unit; this part is new coverage of it.

### 4.2 Parts D and E

All steps below apply to `src/server/tools/record_decision.ts` unless stated otherwise. Steps D-1 through D-5 are `B11`; steps D-6 through D-11 are `B12`; steps D-12 through D-14 are `test/contract/no-path.test.ts`; steps D-15 through D-16 are the ordinal-widening edit in `test/unit/briefing-hides-nothing.test.ts`. Part E ships no production step.

#### Step D-1 — add `criterion_id` to the input schema

FIND:
```ts
  scope: z
    .string()
    .min(1)
    .max(caps.KEY_DECISION_SCOPE_MAX)
    .optional()
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the lowest-numbered completion criterion that is neither done nor struck is used'
    ),
  supersedes: z
```
REPLACE:
```ts
  scope: z
    .string()
    .min(1)
    .max(caps.KEY_DECISION_SCOPE_MAX)
    .optional()
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the lowest-numbered completion criterion that is neither done nor struck is used'
    ),
  criterion_id: z
    .string()
    .regex(ULID_PATTERN)
    .optional()
    .describe(
      'the completion criterion this decision ranks against, stored on the spine link; refused when it names no criterion on this thread; omit it when the decision is not anchored to one criterion'
    ),
  supersedes: z
```
Rationale: the schema is the closed source of truth `A6`'s census reads from; the field must exist there for the census population to include it. The `scope` field's own description text still promises derivation here; step D-9 corrects it separately once `deriveScope` is gone (step D-6).

#### Step D-2 — add `scope` to the output schema

FIND:
```ts
const RecordDecisionOutputSchema = z.object({
  decision_id: z.string().describe('the id minted for the new decision record'),
  thread_id: z.string().describe('the id of the thread the decision was recorded against'),
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read'),
  linked: z.boolean().describe('whether this call also linked the decision into the thread running summary'),
```
REPLACE:
```ts
const RecordDecisionOutputSchema = z.object({
  decision_id: z.string().describe('the id minted for the new decision record'),
  thread_id: z.string().describe('the id of the thread the decision was recorded against'),
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read'),
  scope: z
    .string()
    .nullable()
    .describe('the scope recorded on the spine link, or null when none was supplied'),
  linked: z.boolean().describe('whether this call also linked the decision into the thread running summary'),
```
(also required by step D-10 below). No `criterion_id` output field is added — `B11` does not require the tool to echo it back; the stored record is the surface of truth.

#### Step D-3 — validate `criterion_id` against the loaded thread

FIND:
```ts
    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const escapedTitle = escapeStored(input.title)
```
REPLACE with:
```ts
    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    if (input.criterion_id !== undefined && !thread.completion_criteria.some((c) => c.id === input.criterion_id)) {
      return { ok: false, refusal: unknownCriterionRefusal(input.criterion_id) }
    }

    const escapedTitle = escapeStored(input.title)
```
Rationale: matches the same rule already applied to `focus` in `update_thread.ts` — every id is validated against the loaded thread's `completion_criteria`, as a handler refusal (checkable only once the thread is loaded, never a schema refusal), before anything else is checked or written.

#### Step D-4 — replace the deleted refusal with `unknownCriterionRefusal`

FIND:
```ts
export const scopeCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'scope',
  accepted: `at most ${caps.KEY_DECISION_SCOPE_MAX} characters after escaping`,
  example: 'the merge queue fast path',
  retryable: true,
  message: `scope exceeds its cap of ${caps.KEY_DECISION_SCOPE_MAX} characters after escaping; observed ${observed}; remedy: shorten the scope and retry.`
})

export const noOpenCriterionRefusal = (threadId: string): Refusal => ({
```
REPLACE:
```ts
export const scopeCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'scope',
  accepted: `at most ${caps.KEY_DECISION_SCOPE_MAX} characters after escaping`,
  example: 'the merge queue fast path',
  retryable: true,
  message: `scope exceeds its cap of ${caps.KEY_DECISION_SCOPE_MAX} characters after escaping; observed ${observed}; remedy: shorten the scope and retry.`
})

export const unknownCriterionRefusal = (id: string): Refusal => ({
  ok: false,
  field: 'criterion_id',
  accepted: 'a criterion_id that names a completion criterion already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criterion_id names an id not present on this thread: ${id}.`
})

export const noOpenCriterionRefusal = (threadId: string): Refusal => ({
```
This inserts `unknownCriterionRefusal` immediately before `noOpenCriterionRefusal`, which step D-7 below deletes; `noOpenCriterionRefusal` is left untouched by this step. Modelled exactly on `danglingRiskCriterionRefusal` in `update_thread.ts` (same six-field shape, same message idiom), adapted to a single id instead of an array since `criterion_id` is scalar.

#### Step D-5 — store `criterion_id` on the key-decision link

FIND:
```ts
    const keyDecision: KeyDecision = {
      id: rt.ulid(),
      decision_id: validated.value.id,
      title: validated.value.title,
      scope: escapedScope
    }
```
REPLACE:
```ts
    const keyDecision: KeyDecision = {
      id: rt.ulid(),
      decision_id: validated.value.id,
      title: validated.value.title,
      scope: escapedScope,
      criterion_id: input.criterion_id
    }
```
`KeyDecision.criterion_id` already exists in `src/schema/thread.ts`; no schema file is touched.

#### Step D-6 — delete `deriveScope`

FIND:
```ts
type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>

const deriveScope = (thread: Thread): string | null => {
  const open = thread.completion_criteria.filter((criterion) => !criterion.done && criterion.struck_by === null)
  const lowest = open.reduce<Criterion | null>(
    (best, candidate) => (best === null || candidate.ordinal < best.ordinal ? candidate : best),
    null
  )
  return lowest === null ? null : `criterion ${lowest.ordinal}`
}

export const titleCapRefusal = (observed: number): Refusal => ({
```
REPLACE:
```ts
type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>

export const titleCapRefusal = (observed: number): Refusal => ({
```
Rationale: `KeyDecision.scope` is a required non-empty-allowed string in the record schema (`src/schema/thread.ts`, owned by another unit and not edited here), so an omitted scope is stored as the empty string — this codebase's existing spelling of an absent content scalar — and is never derived from thread state.

#### Step D-7 — delete `noOpenCriterionRefusal`

FIND:
```ts
export const noOpenCriterionRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'scope',
  accepted: 'an explicit scope, when no completion criterion is left open to derive one from',
  example: 'the merge queue fast path',
  retryable: true,
  message: `every completion criterion on thread ${threadId} is done or struck, so scope cannot be derived; the decision was not recorded; remedy: send scope explicitly and retry.`
})

export const recordDecisionTool: ToolSpec<RecordDecisionInput, RecordDecisionOutput> = {
```
REPLACE:
```ts
export const recordDecisionTool: ToolSpec<RecordDecisionInput, RecordDecisionOutput> = {
```
`noOpenCriterionRefusal` is deleted, not renamed onto `unknownCriterionRefusal` (step D-4, already present in the tree by this point), since its field and meaning both change.

#### Step D-8 — store an omitted scope as the empty string

FIND:
```ts
    const escapedScope = input.scope === undefined ? deriveScope(thread) : escapeStored(input.scope)
    if (escapedScope === null) {
      return { ok: false, refusal: noOpenCriterionRefusal(thread.id) }
    }
    if (escapedScope.length > caps.KEY_DECISION_SCOPE_MAX) {
```
REPLACE with:
```ts
    const escapedScope = input.scope === undefined ? '' : escapeStored(input.scope)
    if (escapedScope.length > caps.KEY_DECISION_SCOPE_MAX) {
```
Rationale: an omitted scope is stored as the empty string — the schema-legal, existing spelling of an absent content scalar — and is never refused; `RecordDecisionOutputSchema` separately gains `scope: z.string().nullable()`, reported as `null` when none was supplied, which is the surface `A6` reads for "reported absent".

#### Step D-9 — correct the schema description text

FIND:
```ts
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the lowest-numbered completion criterion that is neither done nor struck is used'
    ),
  criterion_id: z
```
REPLACE:
```ts
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the decision is recorded with no particular scope'
    ),
  criterion_id: z
```

#### Step D-10 — report the omitted scope as `null`

FIND:
```ts
      structured: {
        decision_id: validated.value.id,
        thread_id: thread.id,
        commit: validated.value.commit,
        linked: linkSkippedReason === null,
        link_skipped_reason: linkSkippedReason
      }
```
REPLACE:
```ts
      structured: {
        decision_id: validated.value.id,
        thread_id: thread.id,
        commit: validated.value.commit,
        scope: input.scope === undefined ? null : escapedScope,
        linked: linkSkippedReason === null,
        link_skipped_reason: linkSkippedReason
      }
```
This is the output surface `A6` (the closed optional-argument census) reads for "reported absent".

#### Step D-11 — drop the now-unused `Criterion` import

FIND:
```ts
import { ThreadRecord, type Criterion, type KeyDecision, type Thread } from '../../schema/thread.ts'
```
REPLACE:
```ts
import { ThreadRecord, type KeyDecision, type Thread } from '../../schema/thread.ts'
```

#### Step D-12 — `test/contract/no-path.test.ts`, import

FIND:
```ts
import {
  recordDecisionTool,
  invalidDecisionRefusal,
  noOpenCriterionRefusal
} from '../../src/server/tools/record_decision.ts'
```
REPLACE:
```ts
import { recordDecisionTool, invalidDecisionRefusal } from '../../src/server/tools/record_decision.ts'
```
Rationale: the function no longer exists.

#### Step D-13 — `test/contract/no-path.test.ts`, producer constant

FIND:
```ts
const RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER: ProducerId = 'server/tools/record_decision.ts#noOpenCriterionRefusal'
```
REPLACE:
```ts
const RECORD_DECISION_UNKNOWN_CRITERION_PRODUCER: ProducerId = 'server/tools/record_decision.ts#unknownCriterionRefusal'
```
Rationale: `scanRefusalProducers()` now finds `unknownCriterionRefusal` (new export) and the census halts on any producer with no driven refusal; this constant names it.

#### Step D-14 — `test/contract/no-path.test.ts`, drive the new refusal

FIND:
```ts
    refusals.push({ producer: RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER, refusal: noOpenCriterionRefusal(threadId) })
```
REPLACE:
```ts
    const unknownDecisionCriterion = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome',
      criterion_id: rt.ulid()
    })
    if (unknownDecisionCriterion.ok) {
      throw new Error('expected recordDecisionTool to refuse a criterion_id that names no criterion on this thread')
    }
    refusals.push({ producer: RECORD_DECISION_UNKNOWN_CRITERION_PRODUCER, refusal: unknownDecisionCriterion.refusal })
```
This is required coverage for the new producer — the refusal census still covers every producer `scanRefusalProducers()` finds.

#### Step D-15 — `test/unit/briefing-hides-nothing.test.ts`, widen the asserted roots

FIND:
```ts
const UNASSERTED_ORDINAL_ROOT = `src${path.sep}render${path.sep}`
```
REPLACE:
```ts
const ASSERTED_ORDINAL_ROOTS = [`src${path.sep}render${path.sep}`, `src${path.sep}server${path.sep}tools${path.sep}`]
```

#### Step D-16 — `test/unit/briefing-hides-nothing.test.ts`, filter over the widened roots

FIND:
```ts
  const underRender = population.filter((site) => site.file.startsWith(UNASSERTED_ORDINAL_ROOT))
  assert.ok(underRender.length > 0, 'the render modules must read criterion.ordinal, or this assertion is vacuous')
  assert.doesNotThrow(
    () => census(underRender, classifyOrdinalSite),
    `every read of criterion.ordinal under src/render must render a display label; any other read infers sequence from position:\n${underRender
      .filter((site) => classifyOrdinalSite(site) !== 'allowed')
      .map((site) => `${site.file}:${site.line} ${site.expression}`)
      .join('\n')}`
```
REPLACE:
```ts
  const underAssertedRoots = population.filter((site) => ASSERTED_ORDINAL_ROOTS.some((root) => site.file.startsWith(root)))
  assert.ok(underAssertedRoots.length > 0, 'the asserted roots must read criterion.ordinal, or this assertion is vacuous')
  assert.doesNotThrow(
    () => census(underAssertedRoots, classifyOrdinalSite),
    `every read of criterion.ordinal under src/render or src/server/tools must render a display label; any other read infers sequence from position:\n${underAssertedRoots
      .filter((site) => classifyOrdinalSite(site) !== 'allowed')
      .map((site) => `${site.file}:${site.line} ${site.expression}`)
      .join('\n')}`
```
The tree-wide population and the `unasserted here, owned elsewhere` diagnostic loop are untouched. This ships in Part D only because it is only true once `deriveScope` is deleted (step D-6).

#### Part E — no production steps

Part E ships two new test files only (`test/contract/optional-arguments-are-absent.test.ts`, `test/support/optional-argument-recipes.ts`; section 5, Part E). No production file changes.

### 4.3 Part F

#### Step F-1 — `src/store/read-path.ts`, create `readRecordVerdict`

FIND (unique anchor):
```
export const readAllRecordFiles = <T>(dir: string, declared: Declared<T>): Slot<T>[] => {
```
REPLACE:
```
export type RecordVerdict = 'absent' | 'valid' | 'quarantined'

export const readRecordVerdict = <T>(filePath: string, declared: Declared<T>): RecordVerdict => {
  const slot = readRecordFile<T>(filePath, declared)
  if (slot === null) return 'absent'
  return slot.quarantined ? 'quarantined' : 'valid'
}

export const readAllRecordFiles = <T>(dir: string, declared: Declared<T>): Slot<T>[] => {
```
Rationale: delegating to the already-correct `readRecordFile` makes the two functions agree on every input by construction, rather than by a second, divergence-prone parse path. A second variant that also dropped the declared-schema validation was measured at roughly 6-10 percent faster and was rejected for exactly this defect: it reports a decision record that is well-formed JSON but invalid against its schema as resolved, where the current code and this shipped variant both report it quarantined (proven by probe: before 5 resolved / 3 quarantined, this variant 5 / 3, the rejected variant 6 / 2) — a performance change that loses a correctness property is not a performance change.

#### Step F-2 — `src/store/records.ts`, import (site A)

FIND:
```
import { markMaterialised, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
```
REPLACE:
```
import { markMaterialised, readAllRecordFiles, readRecordFile, readRecordVerdict, syncWorkingCopy } from './read-path.ts'
```
Rationale: bring the new primitive into scope.

#### Step F-3 — `src/store/records.ts`, `Store` type (site B)

FIND:
```
export type Store = {
  readThread: (id: Ulid) => Slot<Thread> | null
  readThreads: () => Slot<Thread>[]
  readDecision: (id: Ulid) => Slot<Decision> | null
  readSessionEntry: (threadId: Ulid, entryId: Ulid) => Slot<SessionEntry> | null
  readSessionEntries: (threadId: Ulid) => Slot<SessionEntry>[]
  commit: (changes: RecordChange[], message: string) => CommitResult
}
```
REPLACE:
```
export type DecisionProbe = { resolved: number; dangling: Ulid[]; quarantined: Ulid[] }

export type Store = {
  readThread: (id: Ulid) => Slot<Thread> | null
  readThreads: () => Slot<Thread>[]
  readDecision: (id: Ulid) => Slot<Decision> | null
  readSessionEntry: (threadId: Ulid, entryId: Ulid) => Slot<SessionEntry> | null
  readSessionEntries: (threadId: Ulid) => Slot<SessionEntry>[]
  probeDecisions: (ids: readonly Ulid[]) => DecisionProbe
  commit: (changes: RecordChange[], message: string) => CommitResult
}
```
Rationale: publish the measured, shipped shape (`resolved`, `dangling`, `quarantined`) as a named, reusable type and add the method to the `Store` contract.

#### Step F-4 — `src/store/records.ts`, path helpers and probe helpers, with the correction (site C)

This step ships the corrected shape directly (a `readdirSync` failure other than `ENOENT` falls back to per-id reads rather than treating every id as dangling — see the rationale below for why the uncorrected shape is a regression).

FIND:
```
const threadPath = (layout: StoreLayout, id: Ulid): string => path.join(layout.records, 'threads', `${id}.json`)
const decisionPath = (layout: StoreLayout, id: Ulid): string =>
  path.join(layout.records, 'decisions', `${id}.json`)
const sessionEntryPath = (layout: StoreLayout, threadId: Ulid, entryId: Ulid): string =>
  path.join(layout.records, 'sessions', threadId, `${entryId}.json`)
```
REPLACE:
```
const threadPath = (layout: StoreLayout, id: Ulid): string => path.join(layout.records, 'threads', `${id}.json`)
const decisionsDir = (layout: StoreLayout): string => path.join(layout.records, 'decisions')
const decisionPath = (layout: StoreLayout, id: Ulid): string => path.join(decisionsDir(layout), `${id}.json`)
const sessionEntryPath = (layout: StoreLayout, threadId: Ulid, entryId: Ulid): string =>
  path.join(layout.records, 'sessions', threadId, `${entryId}.json`)

type PresentDecisionIds = { listed: true; ids: Set<string> } | { listed: false }

const presentDecisionIds = (layout: StoreLayout): PresentDecisionIds => {
  try {
    const names = readdirSync(decisionsDir(layout)).filter((name) => name.endsWith('.json'))
    return { listed: true, ids: new Set(names.map((name) => name.slice(0, -'.json'.length))) }
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { listed: true, ids: new Set() }
    return { listed: false }
  }
}

const probeDecisionIdsByVerdict = (layout: StoreLayout, ids: readonly Ulid[]): DecisionProbe => {
  const dangling: Ulid[] = []
  const quarantined: Ulid[] = []
  for (const id of ids) {
    const verdict = readRecordVerdict<Decision>(decisionPath(layout, id), DecisionRecord)
    if (verdict === 'quarantined') quarantined.push(id)
    else if (verdict === 'absent') dangling.push(id)
  }
  return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
}

const probeDecisionIds = (layout: StoreLayout, ids: readonly Ulid[]): DecisionProbe => {
  const present = presentDecisionIds(layout)
  if (!present.listed) return probeDecisionIdsByVerdict(layout, ids)

  const dangling: Ulid[] = []
  const quarantined: Ulid[] = []
  for (const id of ids) {
    if (!present.ids.has(id)) {
      dangling.push(id)
      continue
    }
    const verdict = readRecordVerdict<Decision>(decisionPath(layout, id), DecisionRecord)
    if (verdict === 'quarantined') quarantined.push(id)
    else if (verdict === 'absent') dangling.push(id)
  }
  return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
}
```
Rationale: one `readdirSync` of the decisions directory (`presentDecisionIds`) establishes which ids have a file at all — dangling ids are classified without ever attempting to open a file for them, when the directory can be listed. `readRecordVerdict` is called only for ids whose file is present, exactly as the shipped shape (`resolved`/`dangling`/`quarantined`, one `readdirSync` of the decisions directory then `readRecordVerdict` per present id) requires. `ENOENT` keeps its old meaning — an empty present-set, every id dangling, because a store with no decisions directory genuinely holds no decisions. A decisions directory that is traversable but not listable (mode `0o111`) is a different failure: opening a file by an exact path needs only execute permission on the containing directory, while listing that directory needs read permission, so a bare `readdirSync` failure there would wrongly report every id dangling — a regression against the old per-link `readDecision` loop, which resolves every link correctly under that same mode. `probeDecisionIdsByVerdict` is the fallback for exactly that case: it calls `readRecordVerdict` for every id, exactly as the old per-link loop did — same cost, same answer, no regression.

#### Step F-5 — `src/store/records.ts`, wire `probeDecisions` (site D)

FIND:
```
    readSessionEntries: (threadId) =>
      readAllRecordFiles<SessionEntry>(path.join(storeLayout.records, 'sessions', threadId), SessionRecord),
    commit: (changes, message) => {
```
REPLACE:
```
    readSessionEntries: (threadId) =>
      readAllRecordFiles<SessionEntry>(path.join(storeLayout.records, 'sessions', threadId), SessionRecord),
    probeDecisions: (ids) => probeDecisionIds(storeLayout, ids),
    commit: (changes, message) => {
```
Rationale: expose the new probe on the opened store instance.

#### Step F-6 — `src/server/tools/resume_thread.ts`, replace the decision-integrity region

FIND (the region quoted in full in section 2.3.3):
```
    const decisionOutcomes = thread.spine.key_decisions.map((keyDecision) => ({
      decisionId: keyDecision.decision_id,
      slot: store.readDecision(keyDecision.decision_id)
    }))

    const dangling: string[] = []
    const quarantined: string[] = []
    for (const outcome of decisionOutcomes) {
      if (outcome.slot === null) {
        dangling.push(outcome.decisionId)
        rt.log({ level: 'error', event: 'briefing.decision-dangling', decision_id: outcome.decisionId })
      } else if (outcome.slot.quarantined) {
        quarantined.push(outcome.decisionId)
        rt.log({ level: 'error', event: 'briefing.decision-quarantined', decision_id: outcome.decisionId })
      }
    }

    const decisionIntegrity: DecisionIntegrity = {
      resolved: decisionOutcomes.length - dangling.length - quarantined.length,
      dangling,
      quarantined
    }
```
REPLACE:
```
    const decisionIds = thread.spine.key_decisions.map((keyDecision) => keyDecision.decision_id)
    const probe = store.probeDecisions(decisionIds)

    for (const decisionId of probe.dangling) {
      rt.log({ level: 'error', event: 'briefing.decision-dangling', decision_id: decisionId })
    }
    for (const decisionId of probe.quarantined) {
      rt.log({ level: 'error', event: 'briefing.decision-quarantined', decision_id: decisionId })
    }

    const decisionIntegrity: DecisionIntegrity = {
      resolved: probe.resolved,
      dangling: probe.dangling,
      quarantined: probe.quarantined
    }
```
Rationale: stop reading a full decision record per spine link (`store.readDecision`) and call `probeDecisions` once instead; both `rt.log` calls survive unchanged in event name and `decision_id` field, one per dangling id and one per quarantined id. The only observable change is that all dangling logs are now emitted before all quarantined logs, instead of interleaved in spine order; no test in the tree asserts log ordering, confirmed by a tree-wide grep for the two event names before this change, which found only the two call sites this step edits.

This step's FIND anchor is content-based and matches the actual parent tree (post Parts A through E) exactly as it matched the original `$BASE`, per the note in section 2.3.

---

## 5. Tests

### 5.1 Parts A, B and C

#### `test/unit/pointer.test.ts` — extended (existing file, 4 FIND/REPLACE edits + 3 new tests appended)

FIND/REPLACE 1:
```
- const first = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a' }
+ const first = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a', focus: [] }
  writePointer(rt, layout, first)
  const afterFirst = readdirSync(layout.state)
  assert.deepEqual(afterFirst, [pointerFileName])

- const second = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a' }
+ const second = { thread_id: threadId, written_at: rt.now(), session_id: 'session-a', focus: [] }
```
FIND/REPLACE 2:
```
- writePointer(rt, layout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-b' })
+ writePointer(rt, layout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-b', focus: [] })
```
FIND/REPLACE 3:
```
- const original = { thread_id: owner, written_at: rt.now(), session_id: 'session-c' }
+ const original = { thread_id: owner, written_at: rt.now(), session_id: 'session-c', focus: [] }
```
FIND/REPLACE 4:
```
- writePointer(rt, sourceLayout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-d' })
+ writePointer(rt, sourceLayout, { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-d', focus: [] })
```
Reason for all four: `Pointer` gains a required `focus` field (step A-1.1); these four literals are constructed against that type or passed straight into `writePointer(rt, layout, p: Pointer)`, so they no longer compile without it. Behaviour is unchanged (`focus: []` is the pre-existing default in every one of these fixtures).

New tests appended, exact names in file order: `pointer.focus-round-trips`, `pointer.reads-forward-a-pointer-file-with-no-focus-key`, `pointer.malformed-focus-reports-corrupt`.

```ts
test('pointer.focus-round-trips', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const focus = [rt.ulid(), rt.ulid()]
      const written = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-focus', focus }
      writePointer(rt, layout, written)

      const result = readPointer(rt, layout)
      assert.deepEqual(result, { kind: 'pointer', value: written })
    })
  })
})

test('pointer.reads-forward-a-pointer-file-with-no-focus-key', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      const threadId = rt.ulid()
      const writtenAt = rt.now()
      writeFileSync(
        join(layout.state, pointerFileName),
        JSON.stringify({ thread_id: threadId, written_at: writtenAt, session_id: 'session-pre-focus' }),
        'utf8'
      )

      const result = readPointer(rt, layout)
      assert.deepEqual(result, {
        kind: 'pointer',
        value: { thread_id: threadId, written_at: writtenAt, session_id: 'session-pre-focus', focus: [] }
      })
    })
  })
})

test('pointer.malformed-focus-reports-corrupt', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      mkdirSync(layout.state, { recursive: true })
      writeFileSync(
        join(layout.state, pointerFileName),
        JSON.stringify({ thread_id: rt.ulid(), written_at: rt.now(), session_id: 'session-bad-focus', focus: ['not-a-ulid'] }),
        'utf8'
      )

      const result = readPointer(rt, layout)
      assert.equal(result.kind, 'corrupt')
      if (result.kind !== 'corrupt') return
      assert.ok(result.reason.length > 0)
      assert.doesNotMatch(result.reason, /[\\/]/, 'the corrupt reason must not leak a filesystem path')
    })
  })
})
```

#### `test/unit/briefing-focus.test.ts` — new, entire contents (172 lines)

Exact test names, in file order: `briefing.focus.focused-risks-and-key-decisions-render-first`, `briefing.focus.the-focus-line-names-display-labels-in-the-order-given`, `briefing.focus.an-unresolvable-focus-id-renders-as-its-escaped-id`, `briefing.focus.the-focus-not-set-line-is-unchanged-when-focus-is-empty`, `briefing.focus.is-derived-only-from-a-pointer-naming-this-thread`.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import type { Thread, Criterion, Risk, KeyDecision } from '../../src/schema/thread.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const criterion = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'a criterion',
  done: false,
  kind: 'planned',
  struck_by: null,
  ...overrides
})

const risk = (overrides: Partial<Risk> = {}): Risk => ({
  id: rt.ulid(),
  scope: 'x',
  text: 'a risk',
  refs: [],
  ...overrides
})

const keyDecision = (overrides: Partial<KeyDecision> = {}): KeyDecision => ({
  id: rt.ulid(),
  decision_id: rt.ulid(),
  title: 'a decision',
  scope: 'x',
  ...overrides
})

const baseThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'briefing-focus-fixture',
  title: 'Focus Fixture Thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the thing',
    next_step: 'write the tests',
    last_session: 'wrote the renderer',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

const pointerFor = (thread: Thread, focus: string[]): Pointer => ({
  thread_id: thread.id,
  written_at: rt.now(),
  session_id: 'session-focus-fixture',
  focus
})

test('briefing.focus.focused-risks-and-key-decisions-render-first', () => {
  const c1 = criterion({ ordinal: 1, text: 'the focused criterion' })
  const c2 = criterion({ ordinal: 2, text: 'a live criterion' })

  const riskOnC2 = risk({ text: 'a risk tied to the live criterion', criterion_id: c2.id })
  const riskOnC1 = risk({ text: 'a risk tied to the focused criterion', criterion_id: c1.id })

  const kdOnC2 = keyDecision({ title: 'a decision tied to the live criterion', scope: 's', criterion_id: c2.id })
  const kdOnC1 = keyDecision({ title: 'a decision tied to the focused criterion', scope: 's', criterion_id: c1.id })

  const thread = baseThread({
    completion_criteria: [c1, c2],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [riskOnC2, riskOnC1],
      key_decisions: [kdOnC2, kdOnC1],
      out_of_scope: []
    }
  })

  const pointer = pointerFor(thread, [c1.id])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)
  const lines = rendered.split('\n')

  const openRisksIndex = lines.indexOf('**Open risks:**')
  assert.deepEqual(
    [lines[openRisksIndex + 1], lines[openRisksIndex + 2]],
    [`- ${riskOnC1.id} a risk tied to the focused criterion`, `- ${riskOnC2.id} a risk tied to the live criterion`],
    'the risk tied to the focused criterion must render before the risk tied to the merely-live criterion'
  )

  const keyDecisionsIndex = lines.indexOf('**Key decisions:**')
  assert.deepEqual(
    [lines[keyDecisionsIndex + 1], lines[keyDecisionsIndex + 2]],
    [
      `- a decision tied to the focused criterion (decision ${kdOnC1.decision_id})`,
      `- a decision tied to the live criterion (decision ${kdOnC2.decision_id})`
    ],
    'the key decision tied to the focused criterion must render before the one tied to the merely-live criterion'
  )
})

test('briefing.focus.the-focus-line-names-display-labels-in-the-order-given', () => {
  const c1 = criterion({ ordinal: 1, text: 'first criterion' })
  const c2 = criterion({ ordinal: 2, text: 'second criterion' })
  const thread = baseThread({ completion_criteria: [c1, c2] })

  const pointer = pointerFor(thread, [c2.id, c1.id])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)

  assert.ok(
    rendered
      .split('\n')
      .includes(
        '**Focus:** c2, c1. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.'
      ),
    'the focus line must name each focused criterion by its display label, in the order supplied'
  )
})

test('briefing.focus.an-unresolvable-focus-id-renders-as-its-escaped-id', () => {
  const c1 = criterion({ ordinal: 1, text: 'the only criterion' })
  const thread = baseThread({ completion_criteria: [c1] })
  const unresolvableId = rt.ulid()

  const pointer = pointerFor(thread, [unresolvableId])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)

  assert.ok(
    rendered
      .split('\n')
      .includes(
        `**Focus:** ${unresolvableId}. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.`
      ),
    'a focus id that resolves to nothing on this thread must render as its own escaped id, not be dropped or crash the render'
  )
})

test('briefing.focus.the-focus-not-set-line-is-unchanged-when-focus-is-empty', () => {
  const c1 = criterion({ ordinal: 1, text: 'a criterion' })
  const thread = baseThread({ completion_criteria: [c1] })

  const pointerWithNoFocus = pointerFor(thread, [])
  const renderedWithPointer = renderBriefing(thread, EMPTY_INTEGRITY, pointerWithNoFocus, null)
  assert.ok(renderedWithPointer.split('\n').includes(FOCUS_NOT_SET_LINE))

  const renderedWithoutPointer = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(renderedWithoutPointer.split('\n').includes(FOCUS_NOT_SET_LINE))
})

test('briefing.focus.is-derived-only-from-a-pointer-naming-this-thread', () => {
  const c1 = criterion({ ordinal: 1, text: 'a criterion' })
  const thread = baseThread({ completion_criteria: [c1] })
  const otherThread = baseThread({ id: rt.ulid() })

  const pointerForOtherThread = pointerFor(otherThread, [c1.id])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointerForOtherThread, null)

  assert.ok(
    rendered.split('\n').includes(FOCUS_NOT_SET_LINE),
    'a pointer naming a different thread must never leak focus onto this thread\'s briefing'
  )
})
```

#### `test/spawn/focus.test.ts` — new, shipped in two parts (Part A then Part B); both given in full below

This file is split by test name, not by a later edit: Part A ships the `resume_thread` tests and the
fixture helpers those two tests need; Part B extends the same file with the `update_thread` tests, the
`update_thread`-only helpers, and the one cross-tool integration test. The split point is exact — Part
A's 127-line form is a strict textual prefix-and-suffix subset of Part B's 320-line form, reordered
nowhere; Part B only inserts.

Exact test names, in file order as finally shipped by Part B: `resume_thread.records-focus-and-the-briefing-shows-it`, `update_thread.writes-focus-to-this-sessions-pointer`, `update_thread.reports-focus-not-written-when-no-pointer-exists`, `update_thread.reports-focus-not-written-when-the-pointer-file-is-corrupt`, `update_thread.reports-focus-not-written-when-the-pointer-names-another-thread`, `update_thread.reports-focus-not-written-when-another-session-holds-the-pointer`, `resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread`, `update_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread`, `focus.never-reaches-the-thread-record`.

Two implementation notes: `update_thread.reports-focus-not-written-when-another-session-holds-the-pointer` spawns two independent `logbook-server` processes against the SAME repo and plugin-data directory, distinguished by `CLAUDE_CODE_SESSION_ID` in each process's env (`focus-session-a` / `focus-session-b`), because the production `Runtime.sessionId` is read from that env var and cannot otherwise be controlled from outside a spawned child process. `focus.never-reaches-the-thread-record` uses fixture title/slug/criterion text that avoids the literal substring `focus` (`never-reaches-the-record fixture thread` / …), because the default fixture text used everywhere else in the file (`focus fixture thread`) would make the raw-JSON substring check trivially true for the wrong reason.

`assertRefusalOnFocus` asserts the refusal message names the specific unknown focus id, not merely the four-part refusal shape: a `z.strictObject` schema refuses ANY unrecognised key with a generic four-part `field: <key>` refusal, which would satisfy a shape-only assertion by coincidence even before `focus` existed as a real property. The message-content assertion is what makes `resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread` and its `update_thread` twin genuinely red at each part's own parent (section 12).

##### Part A — entire contents (127 lines)

Only `resume_thread.records-focus-and-the-briefing-shows-it` and `resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread`, plus only the fixture helpers those two need (`runSetupStep`, `bootstrapRepo`, `Fixture`, `withFixture`, `assertOkResult`, `firstTextOf`, `assertRefusalOnFocus`, `createFixtureThread`). None of the `update_thread`-only helpers (`layoutInFixture`, `readPointerFocus`, `threadRecordRawText`, `writeCorruptPointer`) or reason-string constants (`NO_WORKED_THREAD_FOCUS_REASON`, `DIFFERENT_THREAD_FOCUS_REASON`, `OTHER_SESSION_FOCUS_REASON`) are needed by these two tests, so this part does not ship them; Part B adds them when it adds the tests that use them.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`focus fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-focus-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Focus Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'focus@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook focus fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const withFixture = async (fn: (fx: Fixture) => Promise<void>, env: Record<string, string> = {}): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-focus-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-focus-home-'))
  const spawned = await spawnServer({
    projectRoot: repo,
    entry: ENTRY,
    env: { CLAUDE_PLUGIN_DATA: pluginData, ...env }
  })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertRefusalOnFocus = (result: CallToolResult, unknownId: string): void => {
  assert.equal(result.isError, true, 'expected the call to be refused')
  const text = firstTextOf(result)
  const lines = text.split('\n')
  assert.equal(lines[0], 'field: focus', `expected the refusal to name field "focus", got "${lines[0]}"`)
  assert.match(text, /^accepted: /m)
  assert.match(text, /^example: /m)
  assert.match(text, /^retryable: (true|false)/m)
  assert.ok(
    text.includes(`focus names ids not present on this thread: ${unknownId}`),
    `expected the refusal message to name the focus id that names no criterion on this thread, got: ${text}`
  )
}

const createFixtureThread = async (
  spawned: SpawnedServer,
  overrides: Record<string, unknown> = {}
): Promise<{ threadId: string; criterionId: string }> => {
  const result = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'focus fixture thread',
      slug: 'focus-fixture-thread',
      completion_criteria: [{ text: 'a focus fixture criterion', check: 'a focus fixture check' }],
      ...overrides
    }
  })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'focus fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

test('resume_thread.records-focus-and-the-briefing-shows-it', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('resume_thread', resumed)
    const structured = resumed.structuredContent as { focus: string[]; briefing: string }
    assert.deepEqual(structured.focus, [criterionId])
    assert.ok(
      structured.briefing.includes('**Focus:** c1.'),
      'the returned briefing must name the focused criterion by its display label'
    )
  })
})

test('resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned)
    const unknownId = testRuntime().ulid()

    const result = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [unknownId] }
    })) as CallToolResult
    assertRefusalOnFocus(result, unknownId)
  })
})
```

##### Part B — entire contents (320 lines, final shipped form)

Extends Part A's file with the seven `update_thread`-facing tests, their helpers
(`layoutInFixture`, `readPointerFocus`, `threadRecordRawText`, `writeCorruptPointer`), the three
reason-string constants, and the two additional imports (`layoutFor`/`StoreLayout`, `readPointer`)
those helpers need. Nothing Part A shipped is removed or reordered.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readPointer } from '../../src/domain/pointer.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

const NO_WORKED_THREAD_FOCUS_REASON =
  'no thread is marked as being worked on this machine, so there was no session focus to set'
const DIFFERENT_THREAD_FOCUS_REASON =
  "the thread marked as being worked is a different thread, so this thread's focus was not set"
const OTHER_SESSION_FOCUS_REASON =
  'another session holds the record of what is being worked, so this session did not overwrite its focus'

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`focus fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-focus-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Focus Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'focus@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook focus fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const withFixture = async (fn: (fx: Fixture) => Promise<void>, env: Record<string, string> = {}): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-focus-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-focus-home-'))
  const spawned = await spawnServer({
    projectRoot: repo,
    entry: ENTRY,
    env: { CLAUDE_PLUGIN_DATA: pluginData, ...env }
  })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertRefusalOnFocus = (result: CallToolResult, unknownId: string): void => {
  assert.equal(result.isError, true, 'expected the call to be refused')
  const text = firstTextOf(result)
  const lines = text.split('\n')
  assert.equal(lines[0], 'field: focus', `expected the refusal to name field "focus", got "${lines[0]}"`)
  assert.match(text, /^accepted: /m)
  assert.match(text, /^example: /m)
  assert.match(text, /^retryable: (true|false)/m)
  assert.ok(
    text.includes(`focus names ids not present on this thread: ${unknownId}`),
    `expected the refusal message to name the focus id that names no criterion on this thread, got: ${text}`
  )
}

const createFixtureThread = async (
  spawned: SpawnedServer,
  overrides: Record<string, unknown> = {}
): Promise<{ threadId: string; criterionId: string }> => {
  const result = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'focus fixture thread',
      slug: 'focus-fixture-thread',
      completion_criteria: [{ text: 'a focus fixture criterion', check: 'a focus fixture check' }],
      ...overrides
    }
  })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'focus fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

const layoutInFixture = (fx: Fixture): StoreLayout => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const layout = layoutFor(rt, fx.repo)
  if (!layout.ok) throw new Error(`focus fixture: could not resolve the store layout: ${layout.message}`)
  return layout.value
}

const readPointerFocus = (fx: Fixture): string[] | null => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const layout = layoutInFixture(fx)
  const read = readPointer(rt, layout)
  if (read.kind !== 'pointer') return null
  return read.value.focus
}

const threadRecordRawText = (fx: Fixture, threadId: string): string => {
  const layout = layoutInFixture(fx)
  return readFileSync(join(layout.records, 'threads', `${threadId}.json`), 'utf8')
}

const writeCorruptPointer = (fx: Fixture): void => {
  const layout = layoutInFixture(fx)
  mkdirSync(layout.state, { recursive: true })
  writeFileSync(join(layout.state, 'active-thread.json'), 'not-json{{{', 'utf8')
}

test('resume_thread.records-focus-and-the-briefing-shows-it', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('resume_thread', resumed)
    const structured = resumed.structuredContent as { focus: string[]; briefing: string }
    assert.deepEqual(structured.focus, [criterionId])
    assert.ok(
      structured.briefing.includes('**Focus:** c1.'),
      'the returned briefing must name the focused criterion by its display label'
    )
  })
})

test('update_thread.writes-focus-to-this-sessions-pointer', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (arrange)', resumed)
    assert.deepEqual(readPointerFocus(fx), [])

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, true)
    assert.equal(structured.focus_not_written_reason, null)

    assert.deepEqual(readPointerFocus(fx), [criterionId])
  })
})

test('update_thread.reports-focus-not-written-when-no-pointer-exists', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, false)
    assert.equal(structured.focus_not_written_reason, NO_WORKED_THREAD_FOCUS_REASON)
  })
})

test('update_thread.reports-focus-not-written-when-the-pointer-file-is-corrupt', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)
    writeCorruptPointer(fx)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, false)
    assert.equal(structured.focus_not_written_reason, NO_WORKED_THREAD_FOCUS_REASON)
  })
})

test('update_thread.reports-focus-not-written-when-the-pointer-names-another-thread', async () => {
  await withFixture(async (fx) => {
    const a = await createFixtureThread(fx.spawned, { slug: 'focus-thread-a' })
    const b = await createFixtureThread(fx.spawned, { slug: 'focus-thread-b' })

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: a.threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (arrange)', resumed)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: b.threadId, focus: [b.criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, false)
    assert.equal(structured.focus_not_written_reason, DIFFERENT_THREAD_FOCUS_REASON)
  })
})

test('update_thread.reports-focus-not-written-when-another-session-holds-the-pointer', async () => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-focus-two-session-plugin-data-'))
  try {
    const sessionA = await spawnServer({
      projectRoot: repo,
      entry: ENTRY,
      env: { CLAUDE_PLUGIN_DATA: pluginData, CLAUDE_CODE_SESSION_ID: 'focus-session-a' }
    })
    try {
      const { threadId, criterionId } = await createFixtureThread(sessionA)
      const resumed = (await sessionA.client.callTool({
        name: 'resume_thread',
        arguments: { thread_id: threadId }
      })) as CallToolResult
      assertOkResult('resume_thread (session a)', resumed)

      const sessionB = await spawnServer({
        projectRoot: repo,
        entry: ENTRY,
        env: { CLAUDE_PLUGIN_DATA: pluginData, CLAUDE_CODE_SESSION_ID: 'focus-session-b' }
      })
      try {
        const updated = (await sessionB.client.callTool({
          name: 'update_thread',
          arguments: { thread_id: threadId, focus: [criterionId] }
        })) as CallToolResult
        assertOkResult('update_thread (session b)', updated)
        const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
        assert.equal(structured.focus_written, false)
        assert.equal(structured.focus_not_written_reason, OTHER_SESSION_FOCUS_REASON)
      } finally {
        await sessionB.close()
      }
    } finally {
      await sessionA.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test('resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned)
    const unknownId = testRuntime().ulid()

    const result = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [unknownId] }
    })) as CallToolResult
    assertRefusalOnFocus(result, unknownId)
  })
})

test('update_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned)
    const unknownId = testRuntime().ulid()

    const result = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [unknownId] }
    })) as CallToolResult
    assertRefusalOnFocus(result, unknownId)
  })
})

test('focus.never-reaches-the-thread-record', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned, {
      title: 'never-reaches-the-record fixture thread',
      slug: 'never-reaches-the-record-fixture-thread',
      completion_criteria: [{ text: 'a never-reaches-the-record fixture criterion', check: 'a never-reaches-the-record fixture check' }]
    })

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('resume_thread', resumed)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)

    const raw = threadRecordRawText(fx, threadId)
    assert.equal(raw.includes('focus'), false, 'the stored thread record must never carry the string "focus"')
  })
})
```

#### `test/contract/write-tools-ignore-the-pointer.test.ts` — new, entire contents (299 lines)

Exact test names: `write-tools.ignore-the-pointer`, `write-tools.ignore-the-pointer.control.halts-on-a-write-tool-with-no-registered-recipe`.

Structure: population is `ALL_TOOLS.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name)`, derived from `src/server/register.ts`, never hardcoded. `RECIPES: Readonly<Record<string, Recipe>>` has one entry per one of the eleven write tools (`open_thread`, `update_thread`, `close_thread`, `amend_criteria`, `bind_branch`, `resume_thread`, `park_thread`, `record_decision`, `log_session_event`, `sync_ledger`, `resolve_conflict`), each a fixture preparer plus argument builder, never a verdict table — every recipe's only assertion is `result.isError !== true`. `park_thread`'s recipe is exactly `{}` and is never driven with `outcome`. `sync_ledger`'s recipe adds a bare `git init --bare` remote as `origin` before spawning. `resolve_conflict`'s recipe builds a real two-sided conflict with two spawned "teammates" cloned from a shared bare remote, confirms `sync_ledger` actually refuses with a conflict before calling `resolve_conflict`, and writes the foreign pointer (for the `foreign` scenario) onto the same repo/plugin-data the calling teammate (`ana`) already holds. `driveRecipesFor` throws `no recipe registered for write tool "<name>"` when `RECIPES[toolName]` is `undefined` — the mechanism the control test exercises.

Entire contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { writePointer } from '../../src/domain/pointer.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type PointerScenario = 'absent' | 'foreign'
const POINTER_SCENARIOS: readonly PointerScenario[] = ['absent', 'foreign']

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (prefix: string): string => {
  const repo = mkdtempSync(join(tmpdir(), `${prefix}-`))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook S4 Fixture'])
  runSetupStep(repo, ['config', 'user.email', 's4@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook s4 fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const writeForeignPointer = (repo: string, pluginData: string): void => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error(`write-tools.ignore-the-pointer: could not resolve layout to write a foreign pointer: ${layout.message}`)
  writePointer(rt, layout.value, {
    thread_id: rt.ulid(),
    written_at: rt.now(),
    session_id: 'a-foreign-session-untouched-by-this-call',
    focus: []
  })
}

const callTool = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

const assertOk = (name: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${name} expected ok, got a refusal: ${JSON.stringify(result.content)}`)
}

const OPEN_THREAD_ARGS = {
  title: 's4 fixture thread',
  slug: 's4-fixture-thread',
  completion_criteria: [{ text: 's4 fixture criterion', check: 's4 fixture check' }]
}

type Recipe = (scenario: PointerScenario) => Promise<CallToolResult>

const withFreshFixture = async (
  scenario: PointerScenario,
  run: (spawned: SpawnedServer) => Promise<CallToolResult>
): Promise<CallToolResult> => {
  const repo = bootstrapRepo('logbook-s4-repo')
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-s4-plugin-data-'))
  if (scenario === 'foreign') writeForeignPointer(repo, pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    return await run(spawned)
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const openFixtureThread = async (spawned: SpawnedServer): Promise<string> => {
  const opened = await callTool(spawned, 'open_thread', OPEN_THREAD_ARGS)
  assertOk('open_thread (prep)', opened)
  return (opened.structuredContent as { thread_id: string }).thread_id
}

const recipeOpenThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => callTool(spawned, 'open_thread', OPEN_THREAD_ARGS))

const recipeUpdateThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'update_thread', { thread_id: threadId, active_goal: 's4 active goal' })
  })

const recipeCloseThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'close_thread', { thread_id: threadId, outcome: 'abandoned', detail: 's4 abandon reason' })
  })

const recipeAmendCriteria: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    const decided = await callTool(spawned, 'record_decision', {
      thread_id: threadId,
      title: 's4 decision title',
      context: 's4 decision context',
      options: ['option a', 'option b'],
      outcome: 's4 decision outcome',
      scope: 's4 scope'
    })
    assertOk('record_decision (prep)', decided)
    const decisionId = (decided.structuredContent as { decision_id: string }).decision_id
    return callTool(spawned, 'amend_criteria', {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 's4 inserted criterion',
      kind: 'detour',
      check: 's4 inserted check'
    })
  })

const recipeBindBranch: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'bind_branch', { thread_id: threadId, branch: 's4-fixture-branch' })
  })

const recipeResumeThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'resume_thread', { thread_id: threadId })
  })

const recipeParkThread: Recipe = (scenario) => withFreshFixture(scenario, async (spawned) => callTool(spawned, 'park_thread', {}))

const recipeRecordDecision: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'record_decision', {
      thread_id: threadId,
      title: 's4 decision title',
      context: 's4 decision context',
      options: ['option a', 'option b'],
      outcome: 's4 decision outcome',
      scope: 's4 scope'
    })
  })

const recipeLogSessionEvent: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'log_session_event', { thread_id: threadId, actor: 'claude', body: 's4 session body' })
  })

const recipeSyncLedger: Recipe = async (scenario) => {
  const bare = mkdtempSync(join(tmpdir(), 'logbook-s4-sync-remote-'))
  const initResult = rawGit(bare, ['init', '--bare', '--initial-branch=main'])
  if (initResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not init the bare remote: ${initResult.stderr}`)
  }
  const repo = bootstrapRepo('logbook-s4-sync-repo')
  const addResult = rawGit(repo, ['remote', 'add', 'origin', bare])
  if (addResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not add the origin remote: ${addResult.stderr}`)
  }
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-s4-sync-plugin-data-'))
  if (scenario === 'foreign') writeForeignPointer(repo, pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    return await callTool(spawned, 'sync_ledger', {})
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
  }
}

type Teammate = { repo: string; pluginData: string; spawned: SpawnedServer }

const provisionTeammate = async (remote: string, name: string): Promise<Teammate> => {
  const repo = mkdtempSync(join(tmpdir(), `logbook-s4-resolve-${name}-repo-`))
  const cloneResult = rawGit(repo, ['clone', remote, '.'])
  if (cloneResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not clone the remote for ${name}: ${cloneResult.stderr}`)
  }
  const nameResult = rawGit(repo, ['config', 'user.name', name])
  if (nameResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not set user.name for ${name}: ${nameResult.stderr}`)
  }
  const emailResult = rawGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  if (emailResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not set user.email for ${name}: ${emailResult.stderr}`)
  }
  const pluginData = mkdtempSync(join(tmpdir(), `logbook-s4-resolve-${name}-plugin-data-`))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  return { repo, pluginData, spawned }
}

const recipeResolveConflict: Recipe = async (scenario) => {
  const remote = mkdtempSync(join(tmpdir(), 'logbook-s4-resolve-remote-'))
  const initResult = rawGit(remote, ['init', '--bare', '--initial-branch=main'])
  if (initResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not init the bare remote: ${initResult.stderr}`)
  }

  const ana = await provisionTeammate(remote, `ana-${scenario}`)
  const ben = await provisionTeammate(remote, `ben-${scenario}`)
  try {
    const opened = await callTool(ana.spawned, 'open_thread', {
      title: 's4 resolve conflict fixture thread',
      slug: `s4-resolve-conflict-${scenario}`,
      completion_criteria: [{ text: 's4 resolve fixture criterion', check: 's4 resolve fixture check' }]
    })
    assertOk('open_thread (resolve prep)', opened)
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    assertOk('sync_ledger (ana initial push)', await callTool(ana.spawned, 'sync_ledger', {}))
    assertOk('sync_ledger (ben initial fast-forward)', await callTool(ben.spawned, 'sync_ledger', {}))

    const benUpdate = await callTool(ben.spawned, 'update_thread', { thread_id: threadId, active_goal: 'ben active goal' })
    assertOk('update_thread (ben)', benUpdate)
    const benPush = await callTool(ben.spawned, 'sync_ledger', {})
    assertOk('sync_ledger (ben pushes)', benPush)

    const anaUpdate = await callTool(ana.spawned, 'update_thread', { thread_id: threadId, active_goal: 'ana active goal' })
    assertOk('update_thread (ana)', anaUpdate)

    const anaConflictSync = await callTool(ana.spawned, 'sync_ledger', {})
    assert.equal(
      anaConflictSync.isError,
      true,
      'write-tools.ignore-the-pointer: expected a real two-sided conflict to have been built for the resolve_conflict recipe'
    )

    if (scenario === 'foreign') writeForeignPointer(ana.repo, ana.pluginData)

    return await callTool(ana.spawned, 'resolve_conflict', {
      resolutions: [{ record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' }]
    })
  } finally {
    await ana.spawned.close()
    await ben.spawned.close()
    rmSync(ana.repo, { recursive: true, force: true })
    rmSync(ana.pluginData, { recursive: true, force: true })
    rmSync(ben.repo, { recursive: true, force: true })
    rmSync(ben.pluginData, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
}

const RECIPES: Readonly<Record<string, Recipe>> = {
  open_thread: recipeOpenThread,
  update_thread: recipeUpdateThread,
  close_thread: recipeCloseThread,
  amend_criteria: recipeAmendCriteria,
  bind_branch: recipeBindBranch,
  resume_thread: recipeResumeThread,
  park_thread: recipeParkThread,
  record_decision: recipeRecordDecision,
  log_session_event: recipeLogSessionEvent,
  sync_ledger: recipeSyncLedger,
  resolve_conflict: recipeResolveConflict
}

const driveRecipesFor = async (toolNames: readonly string[]): Promise<void> => {
  for (const toolName of toolNames) {
    const recipe = RECIPES[toolName]
    if (recipe === undefined) {
      throw new Error(`write-tools.ignore-the-pointer: no recipe registered for write tool "${toolName}"`)
    }
    for (const scenario of POINTER_SCENARIOS) {
      const result = await recipe(scenario)
      assert.notEqual(
        result.isError,
        true,
        `write-tools.ignore-the-pointer: ${toolName} (pointer ${scenario}) expected ok, got a refusal: ${JSON.stringify(result.content)}`
      )
    }
  }
}

test('write-tools.ignore-the-pointer', async () => {
  const writeToolNames = ALL_TOOLS.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name)
  assert.ok(writeToolNames.length > 0, 'expected at least one write tool in the published register, or this census proves nothing')
  await driveRecipesFor(writeToolNames)
})

test('write-tools.ignore-the-pointer.control.halts-on-a-write-tool-with-no-registered-recipe', async () => {
  await assert.rejects(
    () => driveRecipesFor(['not_a_real_write_tool']),
    /no recipe registered for write tool "not_a_real_write_tool"/
  )
})
```

#### `test/hooks/handoff.test.ts`, `test/store/pointer.test.ts` — one-line FIND/REPLACE each, same reason as `test/unit/pointer.test.ts`

```
- writePointer(rt, layout.value, { thread_id: threadId, written_at: rt.now(), session_id: sessionId })
+ writePointer(rt, layout.value, { thread_id: threadId, written_at: rt.now(), session_id: sessionId, focus: [] })
```
```
- writePointer(rt, layout, { thread_id: threadId, written_at: rt.now(), session_id: 'store-session' })
+ writePointer(rt, layout, { thread_id: threadId, written_at: rt.now(), session_id: 'store-session', focus: [] })
```

#### `test/unit/briefing.test.ts` — two-line FIND/REPLACE, same reason

```
- const pointer: Pointer = { thread_id: threadId, written_at: rt.now(), session_id: 'session-x' }
+ const pointer: Pointer = { thread_id: threadId, written_at: rt.now(), session_id: 'session-x', focus: [] }
```
```
- const pointer: Pointer = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'someone-else' }
+ const pointer: Pointer = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'someone-else', focus: [] }
```

#### `test/contract/skills.test.ts` — extended (existing shipped test)

FIND (immediately after `skill.preflight-presents-and-stops`, before `skill.cannot-strand`):
```ts
test('skill.cannot-strand', async () => {
```
REPLACE with:
```ts
test('skill.preflight-passes-the-declared-focus', () => {
  const preflight = parseSkill(readSkillFile(PREFLIGHT_SKILL_PATH))
  const steps = preflight.steps

  const resumeCallIndex = steps.findIndex((step) => stepContainsSpan(step, 'resume_thread'))
  assert.notEqual(resumeCallIndex, -1, 'expected a step calling `resume_thread` in the preflight sequence')

  const resumeCallStep = steps[resumeCallIndex]
  assert.ok(resumeCallStep !== undefined)
  assert.ok(
    stepContainsSpan(resumeCallStep, 'resume_thread.focus'),
    'expected the step calling `resume_thread` to also pass `resume_thread.focus`'
  )
})

test('skill.cannot-strand', async () => {
```
Modelled exactly on `skill.preflight-presents-and-stops`'s idiom, reusing its `parseSkill`/`readSkillFile`/`stepContainsSpan` helpers unchanged. Asserts the step that calls `resume_thread` also carries the code span `` `resume_thread.focus` ``. This is `B35`'s inertness receipt (divergence 7, section 3).

### 5.2 Parts D and E

#### `test/contract/no-path.test.ts` — modified

FIND/REPLACE sites given in steps D-12 through D-14 (section 4.2). Test name unchanged: `error.discloses-no-path` (the new refusal is folded into its existing `collectToolRefusals` helper, same as every other producer).

#### `test/unit/briefing-hides-nothing.test.ts` — modified

FIND/REPLACE sites given in steps D-15 through D-16 (section 4.2). Test name unchanged: `briefing.criterion-ordinal-is-read-only-to-render-a-display-label`.

#### `test/spawn/decisions.test.ts` — modified

Three tests asserting the deleted derivation/refusal behaviour (section 2.2.4) are replaced with five tests asserting the new behaviour (net +2 tests, a genuine behaviour change, not padding). Each is given below as an exact FIND and an exact REPLACE.

No new spawn-level test drives `unknownCriterionRefusal`'s refusal shape — that is already exhaustively covered by the closed refusal census in `no-path.test.ts` (step D-14); adding a second near-identical assertion at the spawn layer would duplicate one behaviour across two layers, which the project's testing standard forbids.

FIND/REPLACE 1 — `decision.scope-derives-to-the-lowest-open-criterion` → `decision.omitted-scope-is-stored-empty` (asserts `structured.scope === null` and `key_decisions[0].scope === ''`, never derived):

FIND:
```ts
test('decision.scope-derives-to-the-lowest-open-criterion', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-derivation-fixture', [
      'the first criterion',
      'the second criterion',
      'the third criterion'
    ])
    const first = fixture.criteria[0]
    assert.ok(first !== undefined, 'open_thread must mint the completion criteria it was given')
    assert.equal(first.ordinal, 1, 'the first minted criterion must carry ordinal 1')
    await markCriterionDone(fx, fixture.threadId, first.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with a derived scope',
        context: 'the first criterion is already done',
        options: ['derive the scope', 'demand an explicit one'],
        outcome: 'derive it from the lowest criterion still open'
      }
    })) as CallToolResult
    assertOkResult('record_decision (derived scope)', recorded)

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      'criterion 2',
      'scope must derive to the lowest-ordinal criterion that is neither done nor struck'
    )
  })
})
```
REPLACE:
```ts
test('decision.omitted-scope-is-stored-empty', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-omission-fixture', [
      'the first criterion',
      'the second criterion',
      'the third criterion'
    ])
    const first = fixture.criteria[0]
    assert.ok(first !== undefined, 'open_thread must mint the completion criteria it was given')
    assert.equal(first.ordinal, 1, 'the first minted criterion must carry ordinal 1')
    await markCriterionDone(fx, fixture.threadId, first.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with no scope supplied',
        context: 'the first criterion is already done',
        options: ['store an empty scope', 'invent one from open criteria'],
        outcome: 'store an empty scope; nothing is derived'
      }
    })) as CallToolResult
    assertOkResult('record_decision (omitted scope)', recorded)
    const recordedStructured = recorded.structuredContent as { scope: string | null }
    assert.equal(recordedStructured.scope, null, 'the reply must report an omitted scope as null')

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      '',
      'an omitted scope must be stored as the empty string, never derived from open criteria'
    )
  })
})
```

FIND/REPLACE 2 — `decision.scope-uses-an-explicit-value-in-place-of-the-derived-one` → `decision.an-explicit-scope-is-stored-verbatim` (same assertions; the old name promised a derivation that no longer exists):

FIND:
```ts
test('decision.scope-uses-an-explicit-value-in-place-of-the-derived-one', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision with an explicit scope',
        context: 'the caller knows the area better than the derivation does',
        options: ['use the derived scope', 'send an explicit one'],
        outcome: 'send an explicit one',
        scope: 'the merge queue fast path'
      }
    })) as CallToolResult
    assertOkResult('record_decision (explicit scope)', recorded)

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      'the merge queue fast path',
      'an explicit scope must be stored in place of the derived one'
    )
  })
})
```
REPLACE:
```ts
test('decision.an-explicit-scope-is-stored-verbatim', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision with an explicit scope',
        context: 'the caller knows the area the decision resolved',
        options: ['send an explicit scope', 'leave it out'],
        outcome: 'send an explicit one',
        scope: 'the merge queue fast path'
      }
    })) as CallToolResult
    assertOkResult('record_decision (explicit scope)', recorded)
    const recordedStructured = recorded.structuredContent as { scope: string | null }
    assert.equal(recordedStructured.scope, 'the merge queue fast path', 'the reply must echo the supplied scope')

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(stored.spine.key_decisions[0]?.scope, 'the merge queue fast path', 'an explicit scope must be stored verbatim')
  })
})
```

FIND/REPLACE 3 — `decision.refuses-naming-scope-when-no-open-criterion-remains` → `decision.omitting-scope-succeeds-even-when-no-criterion-is-open` (asserts success, not refusal — an omitted scope is never derived and never refused, because a thread-wide decision is legitimate), with the two added tests (`decision.criterion_id-is-stored-on-the-key-decision-when-supplied`, `B11` positive path; `decision.criterion_id-is-absent-from-the-key-decision-when-omitted`, `B11` negative path; complements, does not duplicate, the census-level refusal test in `no-path.test.ts`, which asserts refusal on an *unknown* id, not silence on *omission*) appended immediately after it:

FIND:
```ts
test('decision.refuses-naming-scope-when-no-open-criterion-remains', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-refusal-fixture', ['the only criterion'])
    const only = fixture.criteria[0]
    assert.ok(only !== undefined, 'open_thread must mint the one criterion it was given')
    await markCriterionDone(fx, fixture.threadId, only.id)

    const refused = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with nothing to derive a scope from',
        context: 'every criterion is done',
        options: ['invent a scope', 'refuse and say so'],
        outcome: 'refuse and say so'
      }
    })) as CallToolResult

    assert.equal(refused.isError, true, 'record_decision must refuse when scope cannot be derived')
    const text = firstTextOf(refused)
    assert.equal(text.split('\n')[0], 'field: scope')
    assert.match(text, /is done or struck/)
    assert.match(text, /the decision was not recorded/)
  })
})
```
REPLACE:
```ts
test('decision.omitting-scope-succeeds-even-when-no-criterion-is-open', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-no-open-criterion-fixture', ['the only criterion'])
    const only = fixture.criteria[0]
    assert.ok(only !== undefined, 'open_thread must mint the one criterion it was given')
    await markCriterionDone(fx, fixture.threadId, only.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision recorded once every criterion is done',
        context: 'every criterion is done, and that is legitimate',
        options: ['refuse for lack of an open criterion', 'succeed with an empty scope'],
        outcome: 'succeed with an empty scope; a thread-wide decision is legitimate'
      }
    })) as CallToolResult

    assertOkResult('record_decision (no open criterion, scope omitted)', recorded)
    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      '',
      'omitting scope must never be refused for lack of an open criterion'
    )
  })
})

test('decision.criterion_id-is-stored-on-the-key-decision-when-supplied', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'criterion-id-anchor-fixture', ['the anchor criterion'])
    const anchor = fixture.criteria[0]
    assert.ok(anchor !== undefined, 'open_thread must mint the one criterion it was given')

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision anchored to one criterion',
        context: 'this decision ranks against a single criterion',
        options: ['anchor it to the criterion', 'leave it unanchored'],
        outcome: 'anchor it to the criterion',
        criterion_id: anchor.id
      }
    })) as CallToolResult
    assertOkResult('record_decision (criterion_id supplied)', recorded)

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.criterion_id,
      anchor.id,
      'a supplied criterion_id must be stored on the key-decision link'
    )
  })
})

test('decision.criterion_id-is-absent-from-the-key-decision-when-omitted', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision anchored to nothing in particular',
        context: 'this decision is not anchored to one criterion',
        options: ['anchor it', 'leave it unanchored'],
        outcome: 'leave it unanchored'
      }
    })) as CallToolResult
    assertOkResult('record_decision (criterion_id omitted)', recorded)

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.criterion_id,
      undefined,
      'an omitted criterion_id must never be invented onto the key-decision link'
    )
  })
})
```

#### `test/contract/optional-arguments-are-absent.test.ts` — new, entire contents (145 lines)

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { declare } from '../../src/schema/declare.ts'
import { census } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject } from '../support/schema-nodes.ts'
import { RECIPES, TEST_2_CASES, isEmptyish, withSingleFixture } from '../support/optional-argument-recipes.ts'

type Verdict = 'allowed' | 'forbidden' | 'unclassifiable'

type LandingSiteEntry = { path: string; site: string; omitted: unknown; refused: boolean }

const parentPathOf = (path: string): string | null => {
  if (path.endsWith('[]')) return path.slice(0, -2)
  const dot = path.lastIndexOf('.')
  return dot === -1 ? null : path.slice(0, dot)
}

const keyOf = (path: string): string | null => {
  if (path.endsWith('[]')) return null
  const dot = path.lastIndexOf('.')
  return dot === -1 ? null : path.slice(dot + 1)
}

const collectOptionalArguments = (toolName: string, rootSchema: Record<string, unknown>): string[] => {
  const nodes = flattenSchemaNodes(rootSchema, toolName)
  const nodesByPath = new Map<string, unknown>([[toolName, rootSchema]])
  for (const node of nodes) nodesByPath.set(node.path, node.value)

  const optional: string[] = []
  for (const node of nodes) {
    const key = keyOf(node.path)
    if (key === null) continue
    const parentPath = parentPathOf(node.path)
    if (parentPath === null) continue
    const parent = nodesByPath.get(parentPath)
    if (!isPlainObject(parent)) continue
    const required = Array.isArray(parent.required) ? parent.required : []
    if (!required.includes(key)) optional.push(node.path)
  }
  return [...new Set(optional)]
}

const derivePopulation = (): string[] =>
  ALL_TOOLS.flatMap((spec) =>
    collectOptionalArguments(spec.name, declare(spec.name, spec.input as unknown as z.ZodType).jsonSchema)
  )

const classifyLandingSite = (entry: LandingSiteEntry): Verdict => {
  if (entry.refused) return 'allowed'
  if (isEmptyish(entry.omitted)) return 'allowed'
  const value = entry.omitted
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
    return 'forbidden'
  }
  return 'unclassifiable'
}

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute', async (t) => {
  const population = derivePopulation()
  assert.ok(
    population.length > 0,
    'contract.optional-arguments-are-absent: the population of optional tool-input arguments is empty'
  )

  const entries: LandingSiteEntry[] = []
  for (const path of population) {
    const recipe = RECIPES.get(path)
    if (recipe === undefined) {
      throw new Error(
        `contract.optional-arguments-are-absent: no registered sentinel builder for optional argument "${path}"`
      )
    }
    const result = await recipe()
    if (result.refused) {
      entries.push({ path, site: 'refused', omitted: undefined, refused: true })
      t.diagnostic(`${path}: the omitted run was refused`)
      continue
    }
    if (result.sites.length === 0) {
      t.diagnostic(`${path}: no landing site differed between the omitted and sentinel runs`)
      continue
    }
    for (const site of result.sites) {
      entries.push({ path, site: site.site, omitted: site.omitted, refused: false })
      t.diagnostic(`${path}#${site.site}: omitted run carries ${JSON.stringify(site.omitted)}`)
    }
  }

  assert.doesNotThrow(
    () => census(entries, classifyLandingSite),
    `every derived landing site of an omitted optional argument must be empty, unchanged or refused:\n${entries
      .filter((entry) => classifyLandingSite(entry) !== 'allowed')
      .map((entry) => `${entry.path}#${entry.site}: ${JSON.stringify(entry.omitted)}`)
      .join('\n')}`
  )
})

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.a-derived-non-empty-value-is-forbidden', () => {
  const forbidden: LandingSiteEntry = {
    path: 'synthetic.probe',
    site: 'synthetic',
    omitted: 'criterion 1',
    refused: false
  }
  assert.throws(() => census([forbidden], classifyLandingSite))
})

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.an-unclassifiable-value-halts', () => {
  const weird: LandingSiteEntry = {
    path: 'synthetic.probe',
    site: 'synthetic',
    omitted: { nested: true },
    refused: false
  }
  assert.throws(() => census([weird], classifyLandingSite))
})

test('contract.optional-arguments-are-absent.the-response-reports-it-absent', async () => {
  const population = derivePopulation()
  const toolsWithOptionalArguments = new Set(population.map((path) => path.split('.')[0]))
  const cases = TEST_2_CASES.filter((testCase) => toolsWithOptionalArguments.has(testCase.tool))
  assert.ok(
    cases.length > 0,
    'contract.optional-arguments-are-absent: no tool in the population carries a registered test-2 case'
  )

  for (const testCase of cases) {
    const fixture = await withSingleFixture(testCase.setup)
    try {
      const result = await testCase.handler.handler(fixture.rt, {} as never, testCase.minimalArgs(fixture.ctx))
      if (!result.ok) continue
      const attributable = testCase.attributable(result.structured)
      for (const [field, value] of Object.entries(attributable)) {
        assert.ok(
          isEmptyish(value),
          `contract.optional-arguments-are-absent: ${testCase.tool}.${field} carries a non-empty value (${JSON.stringify(value)}) though every optional argument was omitted`
        )
      }
    } finally {
      fixture.cleanup()
    }
  }
})
```

Both controls (`...control.a-derived-non-empty-value-is-forbidden`, `...control.an-unclassifiable-value-halts`) discharge `A6`'s requirement for one synthetic item that is forbidden and one that halts, in the idiom the suite already uses.

#### `test/support/optional-argument-recipes.ts` — new. CREATE. Entire contents:

```ts
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext, ToolReply } from '../../src/server/register.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { parkThreadTool } from '../../src/server/tools/park_thread.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'
import { listThreadsTool } from '../../src/server/tools/list_threads.ts'
import { openProjectStore } from '../../src/server/tool-support.ts'
import { testRuntime } from './runtime.ts'

export const STUB_TOOL_CTX = {} as unknown as ToolContext

export const isEmptyish = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0)

const FIXTURE_GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const DETERMINISTIC_COMMIT_ENV: NodeJS.ProcessEnv = {
  ...FIXTURE_GIT_ENV,
  GIT_AUTHOR_NAME: 'Logbook Optional Argument Fixture',
  GIT_AUTHOR_EMAIL: 'optional-argument-fixture@logbook.test',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Logbook Optional Argument Fixture',
  GIT_COMMITTER_EMAIL: 'optional-argument-fixture@logbook.test',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z'
}

const runGit = (repo: string, args: string[], env: NodeJS.ProcessEnv = FIXTURE_GIT_ENV): void => {
  const result = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`optional-argument-recipes: git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

const deterministicRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-optional-args-'))
  runGit(repo, ['init', '--initial-branch=main'])
  runGit(repo, ['config', 'user.name', 'Logbook Optional Argument Fixture'])
  runGit(repo, ['config', 'user.email', 'optional-argument-fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook optional-argument fixture repository\n')
  runGit(repo, ['add', 'README.md'])
  runGit(repo, ['commit', '-m', 'fixture: initial commit'], DETERMINISTIC_COMMIT_ENV)
  return repo
}

type FixtureSide<C> = { rt: Runtime; ctx: C }
type FixturePair<C> = { a: FixtureSide<C>; b: FixtureSide<C>; cleanup: () => void }

const makeFixtureSide = async <C>(
  build: (rt: Runtime) => Promise<C>
): Promise<{ rt: Runtime; ctx: C; repo: string; pluginDataRoot: string }> => {
  const repo = deterministicRepo()
  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-optional-args-plugin-data-'))
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo })
  const ctx = await build(rt)
  return { rt, ctx, repo, pluginDataRoot }
}

const withFixturePair = async <C>(build: (rt: Runtime) => Promise<C>): Promise<FixturePair<C>> => {
  const dirs: string[] = []
  const makeSide = async (): Promise<FixtureSide<C>> => {
    const side = await makeFixtureSide(build)
    dirs.push(side.repo, side.pluginDataRoot)
    return { rt: side.rt, ctx: side.ctx }
  }
  const a = await makeSide()
  const b = await makeSide()
  return { a, b, cleanup: () => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) } }
}

export const withSingleFixture = async <C>(
  build: (rt: Runtime) => Promise<C>
): Promise<{ rt: Runtime; ctx: C; cleanup: () => void }> => {
  const side = await makeFixtureSide(build)
  return {
    rt: side.rt,
    ctx: side.ctx,
    cleanup: () => {
      rmSync(side.repo, { recursive: true, force: true })
      rmSync(side.pluginDataRoot, { recursive: true, force: true })
    }
  }
}

export const readThreadRecord = (rt: Runtime, id: string): Thread | null => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('optional-argument-recipes: expected the store to open for a thread read')
  const slot = opened.value.readThread(id)
  if (slot === null) return null
  if (slot.quarantined) throw new Error(`optional-argument-recipes: thread ${id} is quarantined`)
  return slot.record
}

export const readDecisionRecord = (rt: Runtime, id: string): Decision | null => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('optional-argument-recipes: expected the store to open for a decision read')
  const slot = opened.value.readDecision(id)
  if (slot === null) return null
  if (slot.quarantined) throw new Error(`optional-argument-recipes: decision ${id} is quarantined`)
  return slot.record
}

export const readSessionEntryRecord = (rt: Runtime, threadId: string, id: string): { body: string } | null => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('optional-argument-recipes: expected the store to open for a session entry read')
  const slot = opened.value.readSessionEntry(threadId, id)
  if (slot === null) return null
  if (slot.quarantined) throw new Error(`optional-argument-recipes: session entry ${id} is quarantined`)
  return slot.record
}

export type LandingSite = { site: string; omitted: unknown }
export type RecipeResult = { path: string; refused: boolean; sites: LandingSite[] }

const siteIfDiffers = (site: string, omitted: unknown, sentinel: unknown): LandingSite | null =>
  JSON.stringify(omitted) === JSON.stringify(sentinel) ? null : { site, omitted }

export const mustGet = <T>(arr: readonly T[], index: number, what: string): T => {
  const value = arr[index]
  if (value === undefined) throw new Error(`optional-argument-recipes: expected ${what}`)
  return value
}

const mustBeString = (value: unknown, what: string): string => {
  if (typeof value !== 'string') throw new Error(`optional-argument-recipes: expected ${what} to be a string`)
  return value
}

type AnyTool = { handler: (rt: Runtime, ctx: ToolContext, input: any) => Promise<ToolReply<Record<string, unknown>>> }

const runOptionalArgRecipe = async <C>(
  path: string,
  tool: AnyTool,
  setup: (rt: Runtime) => Promise<C>,
  omittedArgs: (ctx: C) => Record<string, unknown>,
  sentinelArgs: (ctx: C) => Record<string, unknown>,
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: C) => Record<string, unknown>
): Promise<RecipeResult> => {
  const pair = await withFixturePair(setup)
  try {
    const omittedResult = await tool.handler(pair.a.rt, STUB_TOOL_CTX, omittedArgs(pair.a.ctx))
    if (!omittedResult.ok) return { path, refused: true, sites: [] }
    const sentinelResult = await tool.handler(pair.b.rt, STUB_TOOL_CTX, sentinelArgs(pair.b.ctx))
    if (!sentinelResult.ok) {
      throw new Error(`optional-argument-recipes: expected the sentinel call for "${path}" to succeed`)
    }
    const omittedMap = extract(omittedResult.structured, pair.a.rt, pair.a.ctx)
    const sentinelMap = extract(sentinelResult.structured, pair.b.rt, pair.b.ctx)
    const sites: LandingSite[] = []
    for (const key of Object.keys(omittedMap)) {
      const derived = siteIfDiffers(key, omittedMap[key], sentinelMap[key])
      if (derived !== null) sites.push(derived)
    }
    return { path, refused: false, sites }
  } finally {
    pair.cleanup()
  }
}

const NO_EXTRACT = (): Record<string, unknown> => ({})

type ThreadFixtureCtx = { threadId: string; criterionIds: string[] }

const openFixtureThread = async (rt: Runtime, label: string, criteriaCount = 1): Promise<ThreadFixtureCtx> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: `${label} fixture thread`,
    slug: `${label.replace(/[^a-z0-9]+/gi, '-')}-fixture-thread`,
    completion_criteria: Array.from({ length: criteriaCount }, (_, index) => ({
      text: `${label} criterion ${index + 1}`,
      check: `${label} check ${index + 1}`
    }))
  })
  if (!opened.ok) throw new Error(`optional-argument-recipes: expected the ${label} fixture thread to open`)
  return {
    threadId: opened.structured.thread_id as string,
    criterionIds: (opened.structured.completion_criteria as { id: string }[]).map((c) => c.id)
  }
}

const decisionArgs = (threadId: string, label: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  thread_id: threadId,
  title: `${label} title`,
  context: `${label} context`,
  options: [`${label} option`],
  outcome: `${label} outcome`,
  ...extra
})

const recordFixtureDecision = async (rt: Runtime, threadId: string, label: string): Promise<string> => {
  const decision = await recordDecisionTool.handler(
    rt,
    STUB_TOOL_CTX,
    decisionArgs(threadId, label) as Parameters<typeof recordDecisionTool.handler>[2]
  )
  if (!decision.ok) throw new Error(`optional-argument-recipes: expected the ${label} decision to be recorded`)
  return decision.structured.decision_id as string
}

const successorThreadArgs = (): Record<string, unknown> => ({
  title: 'successor fixture thread',
  slug: 'successor-fixture-thread',
  completion_criteria: [{ text: 'a successor criterion', check: 'a successor check' }]
})

const openThreadPredecessorIdRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'open_thread.predecessor_id',
    openThreadTool,
    async (rt) => (await openFixtureThread(rt, 'predecessor')).threadId,
    () => successorThreadArgs(),
    (predecessorId: string) => ({ ...successorThreadArgs(), predecessor_id: predecessorId }),
    (structured, rt) => ({
      predecessor_id: readThreadRecord(rt, mustBeString(structured.thread_id, 'the opened thread id'))?.predecessor_id ?? null
    })
  )

type UpdateThreadFixtureCtx = ThreadFixtureCtx & { riskId: string; decisionId: string }

const openUpdateThreadFixture = async (rt: Runtime): Promise<UpdateThreadFixtureCtx> => {
  const { threadId, criterionIds } = await openFixtureThread(rt, 'update-thread', 2)
  const withRisk = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
    thread_id: threadId,
    risks_add: [{ text: 'a pre-existing fixture risk', scope: 'a pre-existing fixture scope' }]
  })
  if (!withRisk.ok) throw new Error('optional-argument-recipes: expected the pre-existing risk to be added')
  const riskId = mustGet(withRisk.structured.risks_added as string[], 0, 'a minted risk id')
  const decisionId = await recordFixtureDecision(rt, threadId, 'a pre-existing fixture decision')
  return { threadId, criterionIds, riskId, decisionId }
}

const runUpdateThreadRecipe = (
  field: string,
  sentinelExtra: (ctx: UpdateThreadFixtureCtx) => Record<string, unknown>,
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: UpdateThreadFixtureCtx) => Record<string, unknown>
): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    `update_thread.${field}`,
    updateThreadTool,
    openUpdateThreadFixture,
    (ctx) => ({ thread_id: ctx.threadId }),
    (ctx) => ({ thread_id: ctx.threadId, ...sentinelExtra(ctx) }),
    extract
  )

type SimpleUpdateFieldSpec = {
  field: string
  sentinelExtra: (ctx: UpdateThreadFixtureCtx) => Record<string, unknown>
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: UpdateThreadFixtureCtx) => Record<string, unknown>
}

const SIMPLE_UPDATE_FIELDS: SimpleUpdateFieldSpec[] = [
  {
    field: 'criteria_done',
    sentinelExtra: (ctx) => ({
      criteria_done: [
        { criterion_id: mustGet(ctx.criterionIds, 0, 'the first fixture criterion id'), result: 'sentinel result text', result_status: 'verified' }
      ]
    }),
    extract: (structured, rt, ctx) => {
      const criterionId = mustGet(ctx.criterionIds, 0, 'the first fixture criterion id')
      const criterion = readThreadRecord(rt, ctx.threadId)?.completion_criteria.find((c) => c.id === criterionId)
      return {
        criteria_marked_done: structured.criteria_marked_done,
        done: criterion?.done ?? false,
        result: criterion?.result ?? null,
        result_status: criterion?.result_status ?? null
      }
    }
  },
  {
    field: 'active_goal',
    sentinelExtra: () => ({ active_goal: 'sentinel active goal text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      active_goal: readThreadRecord(rt, ctx.threadId)?.spine.active_goal ?? ''
    })
  },
  {
    field: 'next_step',
    sentinelExtra: () => ({ next_step: 'sentinel next step text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      next_step: readThreadRecord(rt, ctx.threadId)?.spine.next_step ?? ''
    })
  },
  {
    field: 'last_session',
    sentinelExtra: () => ({ last_session: 'sentinel last session text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      last_session: readThreadRecord(rt, ctx.threadId)?.spine.last_session ?? ''
    })
  },
  {
    field: 'blocked_by',
    sentinelExtra: () => ({ blocked_by: 'sentinel blocked by text' }),
    extract: (structured, rt, ctx) => ({
      blocked_by_set: structured.blocked_by_set,
      blocked_by: readThreadRecord(rt, ctx.threadId)?.blocked_by ?? null
    })
  },
  {
    field: 'blocked_by_clear',
    sentinelExtra: () => ({ blocked_by_clear: true }),
    extract: (structured, rt, ctx) => ({
      blocked_by_set: structured.blocked_by_set,
      blocked_by: readThreadRecord(rt, ctx.threadId)?.blocked_by ?? null
    })
  },
  {
    field: 'risks_add',
    sentinelExtra: () => ({ risks_add: [{ text: 'sentinel risks_add risk text', scope: 'sentinel risks_add risk scope' }] }),
    extract: (structured) => ({ risks_added: structured.risks_added })
  },
  {
    field: 'risks_retire',
    sentinelExtra: (ctx) => ({ risks_retire: [ctx.riskId] }),
    extract: (structured) => ({ risks_retired: structured.risks_retired })
  },
  {
    field: 'key_decisions_add',
    sentinelExtra: (ctx) => ({
      key_decisions_add: [{ decision_id: ctx.decisionId, title: 'sentinel key decision title', scope: 'sentinel key decision scope' }]
    }),
    extract: (structured) => ({ key_decisions_added: structured.key_decisions_added })
  },
  {
    field: 'out_of_scope_add',
    sentinelExtra: () => ({ out_of_scope_add: ['sentinel out of scope statement'] }),
    extract: (structured) => ({ out_of_scope_added: structured.out_of_scope_added })
  },
  {
    field: 'focus',
    sentinelExtra: (ctx) => ({ focus: [mustGet(ctx.criterionIds, 0, 'the first fixture criterion id')] }),
    extract: (structured) => ({ focus_written: structured.focus_written, focus_not_written_reason: structured.focus_not_written_reason })
  }
]

const simpleUpdateThreadRecipes: [string, () => Promise<RecipeResult>][] = SIMPLE_UPDATE_FIELDS.map((spec) => [
  `update_thread.${spec.field}`,
  () => runUpdateThreadRecipe(spec.field, spec.sentinelExtra, spec.extract)
])

const findAddedRisk = (rt: Runtime, threadId: string, structured: Record<string, unknown>) => {
  const newRiskId = mustGet(structured.risks_added as string[], 0, 'the minted risk id')
  return readThreadRecord(rt, threadId)?.spine.open_risks.find((r) => r.id === newRiskId)
}

const updateThreadRisksAddRefsRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'update_thread.risks_add[].refs',
    updateThreadTool,
    openUpdateThreadFixture,
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [{ text: 'refs probe risk text', scope: 'refs probe risk scope' }]
    }),
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [{ text: 'refs probe risk text', scope: 'refs probe risk scope', refs: ['sentinel-ref-pointer'] }]
    }),
    (structured, rt, ctx: UpdateThreadFixtureCtx) => ({ refs: findAddedRisk(rt, ctx.threadId, structured)?.refs ?? [] })
  )

const updateThreadRisksAddCriterionIdRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'update_thread.risks_add[].criterion_id',
    updateThreadTool,
    openUpdateThreadFixture,
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [{ text: 'criterion probe risk text', scope: 'criterion probe risk scope' }]
    }),
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [
        {
          text: 'criterion probe risk text',
          scope: 'criterion probe risk scope',
          criterion_id: mustGet(ctx.criterionIds, 0, 'the first fixture criterion id')
        }
      ]
    }),
    (structured, rt, ctx: UpdateThreadFixtureCtx) => ({ criterion_id: findAddedRisk(rt, ctx.threadId, structured)?.criterion_id ?? null })
  )

type AmendCriteriaFixtureCtx = ThreadFixtureCtx & { decisionId: string }

const openAmendCriteriaFixture = async (rt: Runtime): Promise<AmendCriteriaFixtureCtx> => {
  const { threadId, criterionIds } = await openFixtureThread(rt, 'amend-criteria', 2)
  const decisionId = await recordFixtureDecision(rt, threadId, 'an amend fixture decision')
  return { threadId, criterionIds, decisionId }
}

const amendCriteriaCriterionIdRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'amend_criteria.criterion_id',
    amendCriteriaTool,
    openAmendCriteriaFixture,
    (ctx: AmendCriteriaFixtureCtx) => ({ thread_id: ctx.threadId, operation: 'rewrite', decision_id: ctx.decisionId, text: 'sentinel rewritten text' }),
    (ctx: AmendCriteriaFixtureCtx) => ({
      thread_id: ctx.threadId,
      operation: 'rewrite',
      decision_id: ctx.decisionId,
      text: 'sentinel rewritten text',
      criterion_id: mustGet(ctx.criterionIds, 0, 'the first amend fixture criterion id')
    }),
    NO_EXTRACT
  )

const amendInsertBaseArgs = (ctx: AmendCriteriaFixtureCtx): Record<string, unknown> => ({
  thread_id: ctx.threadId,
  operation: 'insert',
  decision_id: ctx.decisionId
})

const amendInsertRecipe = (
  path: string,
  omittedExtra: Record<string, unknown>,
  sentinelExtra: Record<string, unknown>
): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    path,
    amendCriteriaTool,
    openAmendCriteriaFixture,
    (ctx: AmendCriteriaFixtureCtx) => ({ ...amendInsertBaseArgs(ctx), ...omittedExtra }),
    (ctx: AmendCriteriaFixtureCtx) => ({ ...amendInsertBaseArgs(ctx), ...omittedExtra, ...sentinelExtra }),
    NO_EXTRACT
  )

const amendCriteriaTextRecipe = (): Promise<RecipeResult> =>
  amendInsertRecipe(
    'amend_criteria.text',
    { kind: 'planned', check: 'sentinel insert check' },
    { text: 'sentinel insert text' }
  )

const amendCriteriaKindRecipe = (): Promise<RecipeResult> =>
  amendInsertRecipe(
    'amend_criteria.kind',
    { text: 'sentinel insert text', check: 'sentinel insert check' },
    { kind: 'planned' }
  )

const amendCriteriaCheckRecipe = (): Promise<RecipeResult> =>
  amendInsertRecipe(
    'amend_criteria.check',
    { text: 'sentinel insert text', kind: 'planned' },
    { check: 'sentinel insert check' }
  )

type AmendCriteriaPositionFixtureCtx = { threadId: string; existingLength: number; decisionId: string }

const openAmendCriteriaPositionFixture = async (rt: Runtime): Promise<AmendCriteriaPositionFixtureCtx> => {
  const { threadId, criterionIds } = await openFixtureThread(rt, 'amend-criteria-position')
  const decisionId = await recordFixtureDecision(rt, threadId, 'a position fixture decision')
  return { threadId, existingLength: criterionIds.length, decisionId }
}

const amendPositionBaseArgs = (ctx: AmendCriteriaPositionFixtureCtx): Record<string, unknown> => ({
  thread_id: ctx.threadId,
  operation: 'insert',
  decision_id: ctx.decisionId,
  text: 'sentinel position text',
  kind: 'planned',
  check: 'sentinel position check'
})

const amendCriteriaPositionRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'amend_criteria.position',
    amendCriteriaTool,
    openAmendCriteriaPositionFixture,
    (ctx: AmendCriteriaPositionFixtureCtx) => amendPositionBaseArgs(ctx),
    (ctx: AmendCriteriaPositionFixtureCtx) => ({ ...amendPositionBaseArgs(ctx), position: ctx.existingLength }),
    (structured, rt, ctx: AmendCriteriaPositionFixtureCtx) => ({
      criterion_id: structured.criterion_id,
      order: readThreadRecord(rt, ctx.threadId)?.completion_criteria.map((c) => c.id).join(',') ?? ''
    })
  )

const resumeThreadFocusRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'resume_thread.focus',
    resumeThreadTool,
    (rt) => openFixtureThread(rt, 'resume-thread'),
    (ctx: ThreadFixtureCtx) => ({ thread_id: ctx.threadId }),
    (ctx: ThreadFixtureCtx) => ({ thread_id: ctx.threadId, focus: [mustGet(ctx.criterionIds, 0, 'the resume fixture criterion id')] }),
    (structured) => ({ focus: structured.focus })
  )

type ParkThreadFixtureCtx = { threadId: string }

const openParkThreadFixture = async (rt: Runtime): Promise<ParkThreadFixtureCtx> => {
  const { threadId } = await openFixtureThread(rt, 'park-thread')
  const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
  if (!resumed.ok) throw new Error('optional-argument-recipes: expected the park_thread fixture pointer to be set')
  return { threadId }
}

type ParkFieldSpec = {
  field: string
  sentinelArgs: (ctx: ParkThreadFixtureCtx) => Record<string, unknown>
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: ParkThreadFixtureCtx) => Record<string, unknown>
}

const PARK_FIELDS: ParkFieldSpec[] = [
  {
    field: 'outcome',
    sentinelArgs: () => ({ outcome: 'sentinel park outcome text' }),
    extract: (structured, rt, ctx) => {
      const entryId = (structured.session_entry_ids as string[])[0]
      const entry = entryId === undefined ? null : readSessionEntryRecord(rt, ctx.threadId, entryId)
      return { session_entry_ids: structured.session_entry_ids, session_entry_body: entry?.body ?? null }
    }
  },
  {
    field: 'thread_id',
    sentinelArgs: (ctx) => ({ thread_id: ctx.threadId }),
    extract: (structured) => ({ status: structured.status, parked_thread_ids: (structured.parked_thread_ids as string[]).join(',') })
  },
  {
    field: 'next_step',
    sentinelArgs: () => ({ next_step: 'sentinel park next step text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      next_step: readThreadRecord(rt, ctx.threadId)?.spine.next_step ?? ''
    })
  }
]

const parkThreadRecipes: [string, () => Promise<RecipeResult>][] = PARK_FIELDS.map((spec) => [
  `park_thread.${spec.field}`,
  () => runOptionalArgRecipe(`park_thread.${spec.field}`, parkThreadTool, openParkThreadFixture, () => ({}), spec.sentinelArgs, spec.extract)
])

type RecordDecisionFieldSpec = {
  field: string
  sentinelExtra: (ctx: ThreadFixtureCtx) => Record<string, unknown>
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: ThreadFixtureCtx) => Record<string, unknown>
}

const keyDecisionFor = (rt: Runtime, ctx: ThreadFixtureCtx, decisionId: string) =>
  readThreadRecord(rt, ctx.threadId)?.spine.key_decisions.find((kd) => kd.decision_id === decisionId)

const RECORD_DECISION_SIMPLE_FIELDS: RecordDecisionFieldSpec[] = [
  {
    field: 'scope',
    sentinelExtra: () => ({ scope: 'sentinel scope text' }),
    extract: (structured, rt, ctx) => ({
      structured_scope: structured.scope,
      key_decision_scope: keyDecisionFor(rt, ctx, mustBeString(structured.decision_id, 'the recorded decision id'))?.scope ?? ''
    })
  },
  {
    field: 'criterion_id',
    sentinelExtra: (ctx) => ({ criterion_id: mustGet(ctx.criterionIds, 0, 'the record_decision fixture criterion id') }),
    extract: (structured, rt, ctx) => ({
      criterion_id:
        keyDecisionFor(rt, ctx, mustBeString(structured.decision_id, 'the recorded decision id'))?.criterion_id ?? null
    })
  }
]

const recordDecisionSimpleRecipes: [string, () => Promise<RecipeResult>][] = RECORD_DECISION_SIMPLE_FIELDS.map((spec) => [
  `record_decision.${spec.field}`,
  () =>
    runOptionalArgRecipe(
      `record_decision.${spec.field}`,
      recordDecisionTool,
      (rt) => openFixtureThread(rt, 'record-decision'),
      (ctx: ThreadFixtureCtx) => decisionArgs(ctx.threadId, `a ${spec.field} probe decision`),
      (ctx: ThreadFixtureCtx) => decisionArgs(ctx.threadId, `a ${spec.field} probe decision`, spec.sentinelExtra(ctx)),
      spec.extract
    )
])

type RecordDecisionSupersedesFixtureCtx = ThreadFixtureCtx & { priorDecisionId: string }

const openRecordDecisionSupersedesFixture = async (rt: Runtime): Promise<RecordDecisionSupersedesFixtureCtx> => {
  const base = await openFixtureThread(rt, 'record-decision-supersedes')
  const priorDecisionId = await recordFixtureDecision(rt, base.threadId, 'a prior fixture decision')
  return { ...base, priorDecisionId }
}

const recordDecisionSupersedesRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'record_decision.supersedes',
    recordDecisionTool,
    openRecordDecisionSupersedesFixture,
    (ctx: RecordDecisionSupersedesFixtureCtx) => decisionArgs(ctx.threadId, 'a supersedes probe decision'),
    (ctx: RecordDecisionSupersedesFixtureCtx) =>
      decisionArgs(ctx.threadId, 'a supersedes probe decision', { supersedes: [ctx.priorDecisionId] }),
    (structured, rt) => ({
      supersedes: (
        readDecisionRecord(rt, mustBeString(structured.decision_id, 'the recorded decision id'))?.supersedes ?? []
      ).join(',')
    })
  )

type ListThreadsFixtureCtx = { knownCursor: string | null }

const openListThreadsFixture = async (rt: Runtime): Promise<ListThreadsFixtureCtx> => {
  await openFixtureThread(rt, 'list-threads-one')
  await openFixtureThread(rt, 'list-threads-two')
  const page = await listThreadsTool.handler(rt, STUB_TOOL_CTX, { limit: 1 })
  if (!page.ok) throw new Error('optional-argument-recipes: expected the list_threads probe page to succeed')
  return { knownCursor: page.structured.next_cursor as string | null }
}

const listThreadsCursorRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'list_threads.cursor',
    listThreadsTool,
    openListThreadsFixture,
    () => ({}),
    (ctx: ListThreadsFixtureCtx) => (ctx.knownCursor === null ? {} : { cursor: ctx.knownCursor }),
    (structured) => ({ next_cursor: structured.next_cursor })
  )

const listThreadsLimitRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'list_threads.limit',
    listThreadsTool,
    openListThreadsFixture,
    () => ({}),
    () => ({ limit: 1 }),
    (structured) => ({ next_cursor: structured.next_cursor })
  )

export const RECIPES: ReadonlyMap<string, () => Promise<RecipeResult>> = new Map([
  ['open_thread.predecessor_id', openThreadPredecessorIdRecipe],
  ...simpleUpdateThreadRecipes,
  ['update_thread.risks_add[].refs', updateThreadRisksAddRefsRecipe],
  ['update_thread.risks_add[].criterion_id', updateThreadRisksAddCriterionIdRecipe],
  ['amend_criteria.criterion_id', amendCriteriaCriterionIdRecipe],
  ['amend_criteria.text', amendCriteriaTextRecipe],
  ['amend_criteria.kind', amendCriteriaKindRecipe],
  ['amend_criteria.check', amendCriteriaCheckRecipe],
  ['amend_criteria.position', amendCriteriaPositionRecipe],
  ['resume_thread.focus', resumeThreadFocusRecipe],
  ...parkThreadRecipes,
  ...recordDecisionSimpleRecipes,
  ['record_decision.supersedes', recordDecisionSupersedesRecipe],
  ['list_threads.cursor', listThreadsCursorRecipe],
  ['list_threads.limit', listThreadsLimitRecipe]
])

export type Test2Case = {
  tool: string
  handler: AnyTool
  setup: (rt: Runtime) => Promise<Record<string, unknown>>
  minimalArgs: (ctx: Record<string, unknown>) => Record<string, unknown>
  attributable: (structured: Record<string, unknown>) => Record<string, unknown>
}

export const TEST_2_CASES: Test2Case[] = [
  {
    tool: 'open_thread',
    handler: openThreadTool,
    setup: async () => ({}),
    minimalArgs: () => ({
      title: 'test-2 open_thread fixture thread',
      slug: 'test-2-open-thread-fixture-thread',
      completion_criteria: [{ text: 'a test-2 fixture criterion', check: 'a test-2 fixture check' }]
    }),
    attributable: () => ({})
  },
  {
    tool: 'update_thread',
    handler: updateThreadTool,
    setup: async (rt) => openFixtureThread(rt, 'test-2 update_thread'),
    minimalArgs: (ctx) => ({ thread_id: ctx.threadId }),
    attributable: (structured) => ({
      criteria_marked_done: structured.criteria_marked_done,
      spine_fields_updated: structured.spine_fields_updated,
      risks_added: structured.risks_added,
      risks_retired: structured.risks_retired,
      key_decisions_added: structured.key_decisions_added,
      out_of_scope_added: structured.out_of_scope_added,
      blocked_by_set: structured.blocked_by_set,
      focus_written: structured.focus_written,
      focus_not_written_reason: structured.focus_not_written_reason
    })
  },
  {
    tool: 'amend_criteria',
    handler: amendCriteriaTool,
    setup: openAmendCriteriaFixture,
    minimalArgs: (ctx) => ({ thread_id: ctx.threadId, operation: 'strike', decision_id: ctx.decisionId }),
    attributable: () => ({})
  },
  {
    tool: 'resume_thread',
    handler: resumeThreadTool,
    setup: async (rt) => openFixtureThread(rt, 'test-2 resume_thread'),
    minimalArgs: (ctx) => ({ thread_id: ctx.threadId }),
    attributable: (structured) => ({ focus: structured.focus })
  },
  {
    tool: 'park_thread',
    handler: parkThreadTool,
    setup: async () => ({}),
    minimalArgs: () => ({}),
    attributable: (structured) => ({
      parked_thread_ids: structured.parked_thread_ids,
      session_entry_ids: structured.session_entry_ids,
      spine_fields_updated: structured.spine_fields_updated
    })
  },
  {
    tool: 'record_decision',
    handler: recordDecisionTool,
    setup: async (rt) => openFixtureThread(rt, 'test-2 record_decision'),
    minimalArgs: (ctx) => decisionArgs(ctx.threadId as string, 'a test-2 record_decision fixture'),
    attributable: (structured) => ({ scope: structured.scope })
  },
  {
    tool: 'list_threads',
    handler: listThreadsTool,
    setup: async () => ({}),
    minimalArgs: () => ({}),
    attributable: (structured) => ({ next_cursor: structured.next_cursor })
  }
]
```

### 5.3 Part F

#### `test/store/read-path.test.ts` — MODIFIED (import + new test)

FIND:
```
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import {
  getMaterialiseCallCounter,
  getSubprocessCallCounter,
  resetMaterialiseCallCounter,
  resetSubprocessCallCounter
} from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
```
REPLACE:
```
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import {
  getMaterialiseCallCounter,
  getSubprocessCallCounter,
  readRecordFile,
  readRecordVerdict,
  resetMaterialiseCallCounter,
  resetSubprocessCallCounter
} from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
```

FIND (append point, end of file):
```
      chmodSync(layout.value.records, 0o000)
      try {
        const second = openStore(rt, repo)
        assert.equal(second.ok, false)
      } finally {
        chmodSync(layout.value.records, 0o755)
      }
    })
  })
})
```
REPLACE:
```
      chmodSync(layout.value.records, 0o000)
      try {
        const second = openStore(rt, repo)
        assert.equal(second.ok, false)
      } finally {
        chmodSync(layout.value.records, 0o755)
      }
    })
  })
})

test('read.verdict-agrees-with-read-record-file', () => {
  withPluginData((pluginData) => {
    const dir = pluginData
    const absentPath = join(dir, 'absent-decision.json')
    const unparseablePath = join(dir, 'unparseable-decision.json')
    const invalidSchemaPath = join(dir, 'invalid-schema-decision.json')

    writeFileSync(unparseablePath, '{not-json', 'utf8')
    writeFileSync(invalidSchemaPath, JSON.stringify({ id: 'not-a-ulid', title: 'x' }), 'utf8')

    const cases: { name: string; path: string }[] = [
      { name: 'absent file', path: absentPath },
      { name: 'unparseable JSON', path: unparseablePath },
      { name: 'well-formed JSON that fails the declared schema', path: invalidSchemaPath }
    ]

    for (const testCase of cases) {
      const slot = readRecordFile<Decision>(testCase.path, DecisionRecord)
      const expectedVerdict = slot === null ? 'absent' : slot.quarantined ? 'quarantined' : 'valid'
      const verdict = readRecordVerdict<Decision>(testCase.path, DecisionRecord)
      assert.equal(verdict, expectedVerdict, `readRecordVerdict must agree with readRecordFile for ${testCase.name}`)
    }

    assert.equal(
      readRecordVerdict<Decision>(invalidSchemaPath, DecisionRecord),
      'quarantined',
      'a decision file that is well-formed JSON but invalid against DecisionRecord must verdict as quarantined, matching readRecordFile, and never as resolved'
    )
  })
})
```
Test name: `read.verdict-agrees-with-read-record-file`.

#### `test/store/probe-decisions.test.ts` — NEW, entire contents

```ts
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Decision } from '../../src/schema/decision.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { openStore, type Slot } from '../../src/store/records.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-probe-decisions-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeDecision = (rt: Runtime, threadId: string, title: string): Decision => ({
  id: rt.ulid(),
  thread_id: threadId,
  title,
  context: 'probe-decisions fixture context',
  options: ['an option'],
  outcome: 'the chosen outcome',
  commit: null,
  supersedes: [],
  created_at: rt.now()
})

const oldPerLinkLoop = (
  readDecision: (id: string) => Slot<Decision> | null,
  ids: readonly string[]
): { resolved: number; dangling: string[]; quarantined: string[] } => {
  const dangling: string[] = []
  const quarantined: string[] = []
  for (const id of ids) {
    const slot = readDecision(id)
    if (slot === null) dangling.push(id)
    else if (slot.quarantined) quarantined.push(id)
  }
  return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
}

test('probe.matches-the-old-per-link-loop', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadId = rt.ulid()
      const resolvedOne = makeDecision(rt, threadId, 'resolved one')
      const resolvedTwo = makeDecision(rt, threadId, 'resolved two')
      const committed = store.commit(
        [
          { kind: 'decision', record: resolvedOne },
          { kind: 'decision', record: resolvedTwo }
        ],
        'seed resolving decisions'
      )
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const quarantinedId = rt.ulid()
      writeFileSync(join(layout.value.records, 'decisions', `${quarantinedId}.json`), '{not-json', 'utf8')

      const danglingOne = rt.ulid()
      const danglingTwo = rt.ulid()

      const ids = [resolvedOne.id, danglingOne, resolvedTwo.id, quarantinedId, danglingTwo]

      const expected = oldPerLinkLoop(store.readDecision, ids)
      const actual = store.probeDecisions(ids)

      assert.deepEqual(actual, expected)
      assert.equal(actual.resolved, 2)
      assert.deepEqual(actual.dangling, [danglingOne, danglingTwo])
      assert.deepEqual(actual.quarantined, [quarantinedId])
    })
  })
})

test('probe.falls-back-to-per-id-reads-when-the-decisions-directory-cannot-be-listed', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadId = rt.ulid()
      const resolvedOne = makeDecision(rt, threadId, 'resolved one')
      const resolvedTwo = makeDecision(rt, threadId, 'resolved two')
      const committed = store.commit(
        [
          { kind: 'decision', record: resolvedOne },
          { kind: 'decision', record: resolvedTwo }
        ],
        'seed resolving decisions'
      )
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const quarantinedId = rt.ulid()
      writeFileSync(join(layout.value.records, 'decisions', `${quarantinedId}.json`), '{not-json', 'utf8')

      const danglingOne = rt.ulid()
      const danglingTwo = rt.ulid()

      const ids = [resolvedOne.id, danglingOne, resolvedTwo.id, quarantinedId, danglingTwo]
      const decisionsDir = join(layout.value.records, 'decisions')

      chmodSync(decisionsDir, 0o111)
      try {
        const expected = oldPerLinkLoop(store.readDecision, ids)
        const actual = store.probeDecisions(ids)

        assert.deepEqual(actual, expected)
        assert.equal(actual.resolved, 2)
        assert.deepEqual(actual.dangling, [danglingOne, danglingTwo])
        assert.deepEqual(actual.quarantined, [quarantinedId])
      } finally {
        chmodSync(decisionsDir, 0o755)
      }
    })
  })
})

test('probe.missing-decisions-directory-yields-every-id-dangling', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      rmSync(join(layout.value.records, 'decisions'), { recursive: true, force: true })

      const ids = [rt.ulid(), rt.ulid()]
      const probe = store.probeDecisions(ids)
      assert.deepEqual(probe, { resolved: 0, dangling: ids, quarantined: [] })
    })
  })
})
```
Test names: `probe.matches-the-old-per-link-loop`, `probe.falls-back-to-per-id-reads-when-the-decisions-directory-cannot-be-listed`, `probe.missing-decisions-directory-yields-every-id-dangling`.

The `0o111` test reuses the `chmodSync` idiom already present at `test/contract/no-path.test.ts:1130` and `test/store/read-path.test.ts:165` (chmod a directory to an unreadable/unlistable mode, assert inside a `try`, restore inside `finally`). No guard against running this test as root was added: a search of the whole test tree for a root-check idiom (`getuid`, `geteuid`, or similar) found none, and this test does not invent one. Running it as root would defeat it (root ignores the `0o111` mode and can list the directory regardless), but that limitation is pre-existing in this suite, not introduced here.

#### `test/spawn/resume.test.ts` — MODIFIED

A tree-wide grep for `resolved`, `dangling`, `quarantined` and for `briefing.decision-dangling` / `briefing.decision-quarantined` inside `test/spawn/` found none before this change; `test/unit/briefing.test.ts` covers the *rendering* of `DecisionIntegrity` at the unit level but nothing exercises the *tool-level wiring* that turns spine links into that value through `resume_thread`. A new end-to-end test is added; nothing existing beyond a path helper is touched.

FIND (path helper, unique anchor):
```
const threadRecordPath = (layout: StoreLayout, threadId: string): string =>
  join(layout.records, 'threads', `${threadId}.json`)
```
REPLACE:
```
const threadRecordPath = (layout: StoreLayout, threadId: string): string =>
  join(layout.records, 'threads', `${threadId}.json`)

const decisionRecordPath = (layout: StoreLayout, decisionId: string): string =>
  join(layout.records, 'decisions', `${decisionId}.json`)
```

FIND (insertion point, before `resume_thread.rejects-invalid`):
```
test('resume_thread.rejects-invalid', async () => {
```
REPLACE:
```
test('resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a resolvable decision for the resume integrity probe',
        context: 'the probe needs one decision that resolves cleanly through resume_thread',
        options: ['record it plainly'],
        outcome: 'record it plainly'
      }
    })) as CallToolResult
    assertOkResult('record_decision (resume integrity probe, resolved)', recorded)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
    const danglingDecisionId = rt.ulid()
    const quarantinedDecisionId = rt.ulid()
    mkdirSync(join(layout.records, 'decisions'), { recursive: true })
    writeFileSync(decisionRecordPath(layout, quarantinedDecisionId), '{not-json', 'utf8')

    const opened = openStore(rt, fx.repo)
    assert.equal(opened.ok, true, 'resume integrity probe fixture must be able to open the store')
    if (!opened.ok) return

    const thread = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    const withExtraLinks = {
      ...thread,
      spine: {
        ...thread.spine,
        key_decisions: [
          ...thread.spine.key_decisions,
          { id: rt.ulid(), decision_id: danglingDecisionId, title: 'a dangling link', scope: 'resume-integrity-probe' },
          { id: rt.ulid(), decision_id: quarantinedDecisionId, title: 'a quarantined link', scope: 'resume-integrity-probe' }
        ]
      }
    }
    const seeded = opened.value.commit(
      [{ kind: 'thread', record: withExtraLinks }],
      'seed a dangling and a quarantined key-decision link for the resume integrity probe'
    )
    assert.equal(seeded.ok, true, 'resume integrity probe fixture must be able to seed the extra links')

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (decision integrity, end to end)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')
    const decisionsAt = lines.indexOf('**Decisions:**')
    assert.notEqual(decisionsAt, -1, 'the briefing must carry a Decisions section')
    assert.equal(lines[decisionsAt + 1], '- resolved: 1')
    assert.equal(lines[decisionsAt + 2], `- dangling: ${danglingDecisionId}`)
    assert.equal(lines[decisionsAt + 3], `- quarantined: ${quarantinedDecisionId}`)
  })
})

test('resume_thread.rejects-invalid', async () => {
```
Test name: `resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end`.

---

## 6. Red on the parent

This unit ships as six independent pull requests, A through F, never as one. There is no single "parent" all six share: each part's actual parent is `$BASE` (the tree left by units 1 through 8) plus every part that ships before it, per the ship order in section 1's table. A red state measured against `$BASE` alone would misrepresent a later part, whose real parent already carries the earlier parts' production changes. The exact command, its exit code, and the full failing-test text is given per part in section 12; summarised here so this section is not empty:

- **Part A** (test files only, no production change, against `$BASE`): `npx tsc -p tsconfig.json --noEmit` — exit `2`, 8 diagnostics. `node --test --experimental-strip-types test/spawn/focus.test.ts` — `2 tests, 0 pass, 2 fail` (exit `1`). `node --test --experimental-strip-types test/contract/skills.test.ts` — `11 tests, 10 pass, 1 fail` (exit `1`).
- **Part B** (test files only, against Part A's tree): `npx tsc -p tsconfig.json --noEmit` — exit `2`, one diagnostic. `node --test --experimental-strip-types test/spawn/focus.test.ts` — `9 tests, 2 pass, 7 fail` (exit `1`). `node --test --experimental-strip-types test/contract/no-path.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`).
- **Part C** (its one new file, against Part B's tree, no production change): `node --test --experimental-strip-types test/contract/write-tools-ignore-the-pointer.test.ts` — `2 tests, 2 pass, 0 fail` (exit `0`). Both pass; this is not a defect — `S4` pre-dates this unit and was not disturbed by Parts A or B, so the part is a green-on-parent-too coverage addition, stated rather than concealed (section 12, Part C).
- **Part D** (test files only, against `$BASE`): `node --test --experimental-strip-types test/contract/no-path.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`). `node --test --experimental-strip-types test/spawn/decisions.test.ts` — `17 tests, 13 pass, 4 fail` (exit `1`). `node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`). Six failures total, all and only the ones this part's production change fixes.
- **Part E: no red on its own parent, and this is not an omission.** Part E's actual parent already carries `B12` (Part D has already deleted `deriveScope`), so the one row the census would predict as red can only occur against a tree that still has `deriveScope`. `node --test --experimental-strip-types test/contract/optional-arguments-are-absent.test.ts` on Part D's tree plus this part's two files — `4 tests, 4 pass, 0 fail` (exit `0`), green on first application.
- **Part F** (its three test files only, against `$BASE`): `test/store/probe-decisions.test.ts` — genuine runtime red, all three tests fail identically with `TypeError: store.probeDecisions is not a function`. `test/store/read-path.test.ts` — a load error, not a targeted assertion failure: `tsc` reports `error TS2305: ... has no exported member 'readRecordVerdict'`, and `node --test` fails at ESM module instantiation before any test in the file runs. `test/spawn/resume.test.ts` — no red at the parent, by design: `probeDecisions` is behaviourally identical to the old per-link loop for every input, so no end-to-end assertion on briefing text can be red at the parent; this test guards the wiring against a future regression, not this part's own change.

## 7. Inertness mutation

Each part's inertness mutation is applied and reverted in a disposable copy of that part's own tree, never in the shared working tree; full diffs and exact failure text are given per part in section 12, summarised here so this section is not empty:

- **Part A:** (1) revert `writePointer`'s serialisation to omit `focus` — `node --test --experimental-strip-types test/unit/pointer.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`) (`pointer.focus-round-trips` red). (2) revert `skills/preflight/SKILL.md` alone, leaving the shipped `test/contract/skills.test.ts` — `node --test --experimental-strip-types test/contract/skills.test.ts` — `11 tests, 10 pass, 1 fail` (exit `1`). Both restored; both re-run green.
- **Part B:** revert `resolveFocusOutcome`'s session-ownership check in `src/server/tools/update_thread.ts` — `node --test --experimental-strip-types test/spawn/focus.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`) (`update_thread.reports-focus-not-written-when-another-session-holds-the-pointer` red, because a foreign session's pointer is now wrongly overwritten). Restored; re-run `9 tests, 9 pass, 0 fail` (exit `0`).
- **Part C:** revert `park_thread.ts`'s absent-pointer branch to always refuse instead of returning `nothing-to-park` — `node --test --experimental-strip-types test/contract/write-tools-ignore-the-pointer.test.ts` — `2 tests, 1 pass, 1 fail` (exit `1`). Restored; re-run `2 tests, 2 pass, 0 fail` (exit `0`).
- **Part D:** three mutations, one per rule. `B11` — drop `criterion_id: input.criterion_id` from the `keyDecision` literal: `decision.criterion_id-is-stored-on-the-key-decision-when-supplied` turns red. `B12` — restore `deriveScope`, `noOpenCriterionRefusal`, and the derive-or-refuse `escapedScope` line: `decision.omitted-scope-is-stored-empty` and `decision.omitting-scope-succeeds-even-when-no-criterion-is-open` turn red. Ordinal widening — on top of the `B12` mutation, narrow `ASSERTED_ORDINAL_ROOTS` back to `[src/render/]` only: the previously-red `briefing.criterion-ordinal-is-read-only-to-render-a-display-label` turns green, proving the narrow root silently misses the forbidden read. All three restored.
- **Part E:** restore `deriveScope`, `noOpenCriterionRefusal`, and the derive-or-refuse `escapedScope` line underneath this part's unchanged census — `node --test --experimental-strip-types test/contract/optional-arguments-are-absent.test.ts` — `4 tests, 3 pass, 1 fail` (exit `1`), `contract.optional-arguments-are-absent.no-code-derives-a-substitute` red with exactly the fabricated value the derived-substitute check forbids. Restored.
- **Part F:** three mutations. Mutation 1 (a cost-reduction-only revert, since this part's observable behaviour is identical by construction, per the divergence in section 3) — revert `probeDecisionIds` to a per-link `readRecordFile`-shaped loop: all 34 tests still pass, the honest expected finding for a pure cost reduction. Mutation 2 — make `readRecordVerdict` skip the declared-schema check: `read.verdict-agrees-with-read-record-file` turns red immediately. Mutation 3 — delete the correction-1 fallback branch in `probeDecisionIds`: `probe.falls-back-to-per-id-reads-when-the-decisions-directory-cannot-be-listed` turns red immediately. All three discarded or reverted; Mutation 3 is the one performed directly in the working tree (the newest, smallest correction) and is restored with both affected files re-run green.

## 8. Full verification

Two facts are shared by every part and stated once here rather than six times.

- **The expectation on a real checkout is a green `npm test`, apart from the one tracked flake.** Every part's own base is a real git clone with units 1 through 8 actually merged onto it, not a reconstruction. On that real base, `npm test` is expected to pass in full except for `concurrent.distinct-ids` in `test/spawn/decisions.test.ts` (the tracked flake below), which section 11's stop condition already governs. Any other failure on a real checkout is not accounted for by anything in this plan and is a stop condition: STOP and report; do not improvise, and do not edit, skip, focus or delete any test.
- **A different, larger failure set was observed during planning, and is retained here as evidence, not as the expectation.** This unit's planning verification (section 12's `npm test` totals for every part) was run against `$BASE`, a partial reconstruction that applied only units 1, 4, 5 and 8, not the full 1-through-8 history a real checkout carries (section 2.2.0). On that reconstructed tree, five names failed identically across Parts A through E's own standalone runs: `cutover.old-tree-absent`, `install.serves-new-server`, `install.no-build-output-was-materialised`, `briefing.renders-exact-output-for-a-full-thread`, `briefing.omits-empty-list-sections-entirely`. Part F's own standalone reconstructed tree carried eight, not five (section 2.3, section 12 Part F's precondition note): the same five, plus three `contract.published-schema-matches-enforced.*` tests. None of the eight are introduced by this unit, and none of them recur on a real checkout, for three distinct, named reasons:
  1. `briefing.renders-exact-output-for-a-full-thread` and `briefing.omits-empty-list-sections-entirely` were a defect in the immediately preceding unit, `U8-A`, and are repaired there (divergence 8, section 3); a real checkout carries that repair.
  2. The three `contract.published-schema-matches-enforced.*` tests failed only because the reconstruction that produced `$BASE` skipped a step of the preceding unit; that step ships as part of the preceding unit on a real checkout, so those three tests never fail there.
  3. `cutover.old-tree-absent`, `install.serves-new-server` and `install.no-build-output-was-materialised` fail only because a scratch copy assembled for planning is not a git checkout; they pass in a real clone.
  Every part's own `npm test` verification line in section 12 states this reconstructed-tree count and cites this paragraph; it is not a live claim about what a real checkout will show, which is stated in the bullet above instead.
- **The tracked flake `concurrent.distinct-ids`** in `test/spawn/decisions.test.ts` is not among the reconstructed-tree names above and was not encountered as a failure in any part's own planning verification run recorded in section 12. Section 11 carries the standing procedure for it regardless.

`npx tsc -p tsconfig.json --noEmit` and its npm-scripted equivalent `npm run typecheck` (identical command, per `package.json`'s `"typecheck"` script) exit `0` on a clean tree, printing nothing to stdout or stderr, and exit `2` on a real diagnostic, printing at least one line of the form `<file>(<line>,<col>): error TS<code>: <message>` (measured directly, quoted in section 12 wherever a part is shown red for a typecheck reason). This plan's governing invariant requires both a green `npm test` and a green `npm run typecheck` on every merge commit; section 12's own verification blocks run the raw `tsc` invocation directly (identical exit-code behaviour), and each of the twelve `pr-create` invocations (section 10 and section 12) separately records `npm run typecheck - exit 0` as its own verified line, so the invariant is checked under both names. Every other command, its exit code, and the output substring proving the result is given in that part's own block in section 12.

## 9. Commits

Each part lands on its own branch (section 1's table) as one or more atomic WIP commits on the working branch, then squash-merges into exactly one Conventional Commits commit whose subject is that part's pull-request title (section 10). The version bump (section 0's six-step form) lands in that same squashed commit as the part's code and test change — never a separate "bump version" commit — because `check-packaging.mjs` must be able to verify the manifests and the code they describe agree at every commit, not just at the tip. No part mixes a refactor with a behaviour change in its squashed commit: every part below is either pure behaviour change (Parts A, B, D — `feat`), pure test addition with no production diff (Parts C, E — `test`), or a pure cost reduction with unchanged observable behaviour (Part F — `perf`); none contains a same-commit refactor. Nothing in this unit commits, pushes, or opens a pull request other than through `node ~/.claude/lib/git/pr.mjs pr-create` (section 10).

One block per squashed commit, six total, one per part:

- **Commit A** — subject `feat(focus): record and render a session's declared focus`. Files: the 13 listed in section 12, Part A's "Files touched" line. Steps: section 4.1 steps A-0, A-1, A-2, A-3, A-4, and the Part A half of the `test/contract/no-path.test.ts` FIND/REPLACE pair; tests from section 5.1 (`test/unit/pointer.test.ts`, `test/unit/briefing-focus.test.ts`, `test/spawn/focus.test.ts` restricted to its two `resume_thread` tests, `test/contract/skills.test.ts`'s `skill.preflight-passes-the-declared-focus`).
- **Commit B** — subject `feat(focus): write focus to the session pointer in update_thread`. Files: the 3 listed in section 12, Part B's "Files touched" line, added to Commit A's 13. Steps: section 4.1 step B-1 and the Part B half of the `no-path.test.ts` pair; tests from section 5.1, `test/spawn/focus.test.ts`'s remaining seven tests plus their helpers.
- **Commit C** — subject `test(pointer): assert every write tool tolerates the pointer`. Files: the 1 listed in section 12, Part C's "Files touched" line, added to Commit B's total. Steps: none (no production step); tests from section 5.1, `test/contract/write-tools-ignore-the-pointer.test.ts` entire file.
- **Commit D** — subject `feat(decisions): stop deriving scope, store it as given`. Files: the 4 listed in section 12, Part D's "Measured diff" table. Steps: section 4.2 steps D-1 through D-16 in full; tests from section 5.2, `error.discloses-no-path`, `briefing.criterion-ordinal-is-read-only-to-render-a-display-label`, and the five named `test/spawn/decisions.test.ts` tests.
- **Commit E** — subject `test(arguments): assert every optional argument stays absent`. Files: the 2 listed in section 12, Part E's "Consumes" line (`test/contract/optional-arguments-are-absent.test.ts`, `test/support/optional-argument-recipes.ts`), both new. Steps: none (no production step); tests from section 5.2, all four named in Part E's "Consumes" line.
- **Commit F** — subject `perf(resume): stop reading every decision record to resolve links`. Files: the 6 listed in section 12, Part F's "Measured diff" table. Steps: section 4.3 steps F-1 through F-6 in full; tests from section 5.3, `read.verdict-agrees-with-read-record-file`, the three named `test/store/probe-decisions.test.ts` tests, and `resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end`.

## 10. Pull request

One `node ~/.claude/lib/git/pr.mjs pr-create` invocation per part, in ship order. Every flag value is filled in from what section 12 actually verifies; a `--not-verified` line is used for anything not run, never a `--verified` line for a guess.

### Part A

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u9a-declared-focus --base main \
  --title "feat(focus): record and render a session's declared focus" \
  --what "resume_thread accepts an optional focus argument, an array of criterion ids, and writes it to the session pointer, never to the thread record" \
  --what "the returned briefing renders the declared focus and orders focused risks and key decisions first, before the rest" \
  --what "the preflight skill now asks which completion criteria are being worked this session and passes them as focus" \
  --why "the briefing had no way to show what a session was currently focused on, so risks and decisions from unrelated goals always crowded out the ones actually in progress" \
  --why "resume_thread had no way to record per-session intent, so nothing distinguished this session's goal from every other open one on the thread" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/unit/pointer.test.ts test/unit/briefing-focus.test.ts test/spawn/focus.test.ts - 16 pass, 0 fail" \
  --verified "npm test (standalone Part A tree) - 519 tests, 514 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
  --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
  --risk "the always-present focus field grows every resume_thread reply by a small, fixed byte count, bounded by the retention cap; this PR is 549 lines (142 production, 407 test)"
```

### Part B

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u9b-update-thread-focus --base main \
  --title "feat(focus): write focus to the session pointer in update_thread" \
  --what "update_thread accepts the same optional focus argument resume_thread accepts, and writes it to this session's pointer" \
  --what "update_thread writes focus only when a pointer exists, names this thread, and names this session; every other pointer state still succeeds and reports exactly why focus was not written" \
  --why "only resume_thread could set a session's declared focus, so a session could never change what it was focused on without resuming the thread again" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/spawn/focus.test.ts - 9 pass, 0 fail" \
  --verified "node --test test/contract/no-path.test.ts - 9 pass, 0 fail" \
  --verified "npm test (standalone Part B tree) - 526 tests, 521 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
  --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
  --risk "this pull request is 280 lines (79 production, 201 test), within the 400-line review ceiling"
```

### Part C

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head test/u9c-write-tools-ignore-the-pointer --base main \
  --title "test(pointer): assert every write tool tolerates the pointer" \
  --what "a closed census now drives every write tool once with no session pointer and once with a foreign session's pointer, asserting both calls still succeed" \
  --why "the rule that a write tool must never fail purely because of the session pointer's state was true but had no coverage, so a future change could silently break it" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/contract/write-tools-ignore-the-pointer.test.ts - 2 pass, 0 fail" \
  --verified "npm test (standalone Part C tree) - 528 tests, 523 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
  --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
  --risk "this pull request is 299 lines (0 production, 299 test), within the 400-line review ceiling"
```

### Part D

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u9d-declared-scope --base main \
  --title "feat(decisions): stop deriving scope, store it as given" \
  --what "record_decision no longer derives a decision's scope from the thread's open criteria; an omitted scope is stored as the empty string and reported as null, and is never refused" \
  --what "record_decision accepts an optional criterion_id, validated against the thread's criteria and stored on the key-decision link" \
  --what "the criterion-ordinal census now also covers src/server/tools, not only src/render, closing the gap that let a forbidden ordinal read hide there" \
  --why "deriving scope from whichever criterion happened to be lowest-numbered and open meant a decision's recorded scope depended on unrelated thread state at the moment it was recorded, and a thread with every criterion done or struck could not record a decision at all" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/contract/no-path.test.ts test/unit/briefing-hides-nothing.test.ts test/spawn/decisions.test.ts - 35 pass, 0 fail" \
  --verified "npm test (standalone Part D tree) - 530 tests, 525 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
  --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
  --risk "this pull request is 183 lines (45 production, 138 test), within the 400-line review ceiling"
```

### Part E

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head test/u9e-optional-arguments --base main \
  --title "test(arguments): assert every optional argument stays absent" \
  --what "a closed census over every tool's input schema now drives every optional argument twice, once omitted and once with a distinctive sentinel, and asserts an omitted argument never lands a non-empty value the caller did not supply" \
  --what "a second test asserts that a call omitting every optional argument reports each of them absent in the structured reply" \
  --why "record_decision's deleted scope-derivation (Part D) was the one place this codebase had ever invented a non-empty value for an omitted argument, and nothing before this checked that no other tool does the same" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/contract/optional-arguments-are-absent.test.ts - 4 pass, 0 fail" \
  --verified "npm test (standalone Part E tree) - 534 tests, 529 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
  --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
  --risk "this pull request is 887 lines (0 production, 887 test), over the 400-line review ceiling; the body states the reason it is not divisible further without narrowing the closed population"
```

### Part F

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head perf/u9f-resolved-counter --base main \
  --title "perf(resume): stop reading every decision record to resolve links" \
  --what "resume_thread's resolved/dangling/quarantined count no longer opens and parses a full decision record for a key-decision link whose file is absent; it now lists the decisions directory once and only opens files that are present" \
  --why "resume_thread opened, parsed and schema-validated one decision record per key-decision link even when the link's target file did not exist, which is unnecessary work that scales with the number of links on a thread" \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/store/read-path.test.ts test/store/probe-decisions.test.ts test/spawn/resume.test.ts - 34 pass, 0 fail" \
  --verified "npm test (standalone Part F tree) - 513 tests, 505 pass, 8 fail, observed during planning on Part F's own reconstructed tree measured directly against $BASE (section 2.3); expected green apart from the tracked flake on a real checkout (section 8)" \
  --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
  --risk "the timing claim is not proven by any test, only the measured us table in section 12 Part F with its noise caveat; this PR is 322 lines (78 production, 244 test)"
```

---

## 11. Stop conditions

Run: npm test
If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
If it passes on the re-run, proceed, and record in the pull request body a
`--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
and do not edit, skip, focus or delete any test.

Plus these stop conditions, each with what the implementer sees, the exact command that shows it, and the instruction "STOP and report; do not improvise":

- **Each of the seven predecessor merges this unit depends on** (units 1, 2, 4, 5, 6, 7, 8 — unit 3 is not among them; the "units 1 through 8" dependency in section 0 names the outer range, and this is the exact enumeration within it). What the implementer sees: the merge commit for each predecessor unit present in `git log --oneline main`. Exact command: `git log --oneline main | grep -E "U1|U2|U4|U5|U6|U7|U8"`, expected exit `0`, its output quoted exactly by the implementer at the time it is run — this plan cannot pre-quote a future git log. If any of the seven is absent from that output: STOP and report; do not improvise.
- **`test/support/schema-nodes.ts` absent when this part's own precondition step expects it present.** What the implementer sees: `ls test/support/schema-nodes.ts` prints nothing and exits non-zero. Exact command: `ls test/support/schema-nodes.ts` — expected exit `0`, prints `test/support/schema-nodes.ts`, before Part D's or Part E's own work begins (section 2.2.0). If it does not: STOP and report; do not improvise.
- **`src/render/clip.ts` absent.** What the implementer sees: `ls src/render/clip.ts` prints nothing and exits non-zero. Exact command: `ls src/render/clip.ts` — expected exit `0`, prints `src/render/clip.ts`. If it does not: STOP and report; do not improvise.
- **A stop condition for a defect the immediately preceding unit now repairs.** What the implementer sees: `briefing.renders-exact-output-for-a-full-thread` and/or `briefing.omits-empty-list-sections-entirely` failing at a part's own parent, before that part's own change lands. Exact command: `node --test --experimental-strip-types test/unit/briefing.test.ts`, expected exit `0`, `ℹ fail 0`. These are expected to pass at each part's own parent, because the preceding unit's `U8-A` repairs both (divergence 8, section 3). If either fails: that repair did not land — STOP and report; do not improvise, and do not edit either test.
- **The two version manifests disagreeing with each other before a part's own change.** What the implementer sees: `package.json`'s `"version"` and `.claude-plugin/plugin.json`'s `"version"` reading two different strings. Exact command: `node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"`, expected exit `0`, two identical strings. A version merely HIGHER than the baseline that part reads is NOT a stop condition (section 0); only a disagreement between the two files is. If the two strings disagree: STOP and report; do not improvise.
- **A FIND string that does not match.** What the implementer sees: the literal FIND text from section 4 or section 5 absent from the target file at the byte level. Exact command: `grep -F "<the FIND text>" <the target file>`, expected at least one match. If it prints nothing: STOP and report; do not improvise.
- **A test outside this plan's list being touched.** What the implementer sees: a file under `test/` in the working tree's diff that is not named in this part's own "Consumes" or "Files touched" line in section 12. Exact command: `git diff --name-only -- 'test/'`, expected exit `0`, its output compared line-by-line against that part's own file list. If any name in the diff is not in that list: STOP and report; do not improvise.

---

## 12. Per-pull-request execution

Each block below is fully self-contained: its own branch and version step, the exact step and test numbers/names it consumes from sections 2, 4 and 5, its own red-on-parent with exact failure text, its own inertness mutation, its own full verification, and its own measured diff. No block references another block; "parent" for a block means `$BASE` plus every part that ships before it, per the ship order A, B, C, D, E, F.

### Part A — Declared focus

- **Branch:** `feat/u9a-declared-focus`. **PR scope:** `focus`. **Type:** `feat`. **PR:** section 10, Part A.
- **Version step:** read `"version"` in `package.json` and `.claude-plugin/plugin.json` — `1.4.1` at `$BASE`. This part is additive only (an optional argument, no removal), so it takes MINOR: write `1.5.0` to both files. `node scripts/check-packaging.mjs` — expect `check-packaging: ok`, exit `0`, both before and after.
- **Consumes:** section 4.1 steps A-0 (repair), A-1 (`src/domain/pointer.ts`), A-2 (`src/server/tools/resume_thread.ts`), A-3 (`src/render/briefing.ts`), A-4 (`skills/preflight/SKILL.md`), and the Part A half of the `test/contract/no-path.test.ts` pair. Section 5.1 tests: `test/unit/pointer.test.ts` (all four FIND/REPLACE edits and all three new tests), `test/unit/briefing-focus.test.ts` (entire file, five tests), `test/spawn/focus.test.ts` restricted to `resume_thread.records-focus-and-the-briefing-shows-it` and `resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread` plus only the fixture helpers those two need (`runSetupStep`, `bootstrapRepo`, `Fixture`, `withFixture`, `assertOkResult`, `firstTextOf`, `assertRefusalOnFocus`, `createFixtureThread` — none of the `update_thread`-only helpers or reason-string constants), `test/hooks/handoff.test.ts`, `test/store/pointer.test.ts`, `test/unit/briefing.test.ts`, `test/contract/skills.test.ts`'s `skill.preflight-passes-the-declared-focus`.
- **Files touched (13):** `src/domain/pointer.ts`, `src/render/briefing.ts`, `src/server/tools/resume_thread.ts`, `skills/preflight/SKILL.md`; `test/support/published.ts`, `test/contract/no-path.test.ts`, `test/contract/skills.test.ts`, `test/hooks/handoff.test.ts`, `test/store/pointer.test.ts`, `test/unit/briefing.test.ts`, `test/unit/pointer.test.ts`, `test/unit/briefing-focus.test.ts` (new), `test/spawn/focus.test.ts` (new, restricted to the two `resume_thread` tests and their helpers). Measured: `diff -rq post-u8 verify-partA --exclude node_modules`, expected exit `1`, prints exactly 13 lines, one per file above.
- **Red on the parent** (a copy of `$BASE` with only this part's test files applied, no production change): `npx tsc -p tsconfig.json --noEmit` — exit `2`, 8 diagnostics across the 6 test files this part's test slice touches (`test/contract/no-path.test.ts`, `test/hooks/handoff.test.ts`, `test/store/pointer.test.ts`, `test/unit/briefing-focus.test.ts`, `test/unit/briefing.test.ts` twice, `test/unit/pointer.test.ts` twice — 6 files, 8 diagnostics, the two doubled files each carrying two `Pointer`-literal sites). Seven of the eight read `error TS2353: Object literal may only specify known properties, and 'focus' does not exist in type 'Pointer'`; the eighth, `test/contract/no-path.test.ts(306,7)`, reads `error TS2353: Object literal may only specify known properties, and 'focus' does not exist in type '{ thread_id: string; }'` — the `resume_thread` input-type equivalent, since that call site constructs a bare `{ thread_id }` argument rather than a `Pointer` literal. `node --test --experimental-strip-types test/spawn/focus.test.ts` on that same tree: `2 tests, 0 pass, 2 fail` (exit `1`). Exact failure text, `resume_thread.records-focus-and-the-briefing-shows-it`:
  ```
  AssertionError [ERR_ASSERTION]: resume_thread expected a successful call, got a refusal: [{"type":"text","text":"field: focus\naccepted: object\nexample: {\"thread_id\":\"00000000000000000000000000\"}\nretryable: true\nfocus was refused; it accepts object; a valid example is {\"thread_id\":\"00000000000000000000000000\"}; remedy: send a value matching what this field accepts and retry; retryable=true."}]
  ```
  `resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread` fails because the parent's generic unknown-key refusal message never names the specific unknown id `assertRefusalOnFocus` checks for. `node --test --experimental-strip-types test/contract/skills.test.ts` on the parent (this part's `test/contract/skills.test.ts` copied in, `skills/preflight/SKILL.md` left at `$BASE` text): `11 tests, 10 pass, 1 fail` (exit `1`). Exact failure text:
  ```
  AssertionError [ERR_ASSERTION]: expected the step calling `resume_thread` to also pass `resume_thread.focus`
  ```
- **Inertness mutations**, each performed in a disposable full-tree copy, never in the working tree:
  - Revert `writePointer`'s serialisation in `src/domain/pointer.ts` to omit `focus`:
    ```diff
    -  const contents = JSON.stringify({
    -    thread_id: p.thread_id,
    -    written_at: p.written_at,
    -    session_id: p.session_id,
    -    focus: p.focus
    -  })
    +  const contents = JSON.stringify({
    +    thread_id: p.thread_id,
    +    written_at: p.written_at,
    +    session_id: p.session_id
    +  })
    ```
    `node --test --experimental-strip-types test/unit/pointer.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`), `pointer.focus-round-trips` red:
    ```
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    + actual - expected
      {
        kind: 'pointer',
        value: {
    +     focus: [],
    -     focus: [ '01ARZ3NDEK0000000000000000', '01ARZ3NDEK0000000000000001' ],
          session_id: 'session-focus', ...
        }
      }
    ```
    Restore the reverted lines; re-run: `9 tests, 9 pass, 0 fail` (exit `0`).
  - Revert `skills/preflight/SKILL.md` alone (section 2.1.5's text) while leaving `test/contract/skills.test.ts` at its shipped content, including the `skill.preflight-passes-the-declared-focus` test this part adds (section 5.1's skills census extension): `node --test --experimental-strip-types test/contract/skills.test.ts` — `11 tests, 10 pass, 1 fail` (exit `1`). Exact failure text: `AssertionError [ERR_ASSERTION]: expected the step calling \`resume_thread\` to also pass \`resume_thread.focus\``. Restore `SKILL.md`; re-run: `11 tests, 11 pass, 0 fail` (exit `0`).
- **Full verification** (standalone tree = `$BASE` plus only this part's files):
  - `npx tsc -p tsconfig.json --noEmit` — exit `0`, no output.
  - `npm test` — `519 tests, 514 pass, 5 fail` (exit `1`), observed during planning on a reconstructed tree. The 5 failures are byte-for-byte `cutover.old-tree-absent`, `install.serves-new-server`, `install.no-build-output-was-materialised`, `briefing.renders-exact-output-for-a-full-thread`, `briefing.omits-empty-list-sections-entirely` (section 8) — none new; expected green apart from the tracked flake on a real checkout.
- **Measured diff** (standalone):

  | File | Lines |
  |---|---|
  | `src/domain/pointer.ts` | 24 |
  | `src/render/briefing.ts` | 75 |
  | `src/server/tools/resume_thread.ts` | 36 |
  | `skills/preflight/SKILL.md` | 7 |
  | **Production total** | **142** |
  | `test/support/published.ts` | 5 |
  | `test/contract/no-path.test.ts` | 8 |
  | `test/contract/skills.test.ts` | 15 |
  | `test/hooks/handoff.test.ts` | 2 |
  | `test/store/pointer.test.ts` | 2 |
  | `test/unit/briefing.test.ts` | 4 |
  | `test/unit/pointer.test.ts` | 72 |
  | `test/unit/briefing-focus.test.ts` (new) | 172 |
  | `test/spawn/focus.test.ts` (new, resume_thread-only) | 127 |
  | **Test total** | **407** |
  | **Part A total** | **549** |

- **Why this part is not split further (review-ceiling exception).** 549 lines is 1.37x the 400-line ceiling. Splitting the pointer and `resume_thread` from the briefing renderer was checked directly, not argued: with the renderer withheld, `resume_thread` returned `structured.focus: ["01M15W2VX79Z5V4PM2EEX099BP"]` while the same call's briefing printed `**Focus:** not set.` — a shipped surface contradicting the reply that carried it, on a surface (`resume_thread.briefing`) the preflight skill tells the caller to print verbatim. Splitting the skill file out was checked the same way: reverting only the `focus` argument while keeping the new skill text turns `contract.skill-references-exist` red with `census rejected a forbidden item: {"file":"skills/preflight/SKILL.md","line":12,"text":"resume_thread.focus"}`. Both checks confirm the coupling; this part ships `pointer.ts` + `briefing.ts` + `resume_thread.ts` + `SKILL.md` together, in the step order section 4.1 already gives them.
- **Stop conditions for this part:** the seven predecessor merges (units 1, 2, 4, 5, 6, 7, 8) this unit depends on, proven by a command whose output the implementer quotes exactly at the time it is run. `ls src/render/clip.ts` — exit `0`, prints `src/render/clip.ts` — before Step A-3 begins. `briefing.renders-exact-output-for-a-full-thread` and `briefing.omits-empty-list-sections-entirely` must pass at `$BASE`, unmodified, before this part's own change lands (`U8-A`'s repair, divergence 8). The two version manifests must not disagree with each other, before this part's version step. A version higher than the table's baseline means the ladder shifted upstream and is NOT a stop condition; only the two manifests disagreeing with each other is. Any FIND string above that does not match its target file, or any test outside this part's own list being touched, are both immediate stops. On all of these: STOP and report; do not improvise.
- **Pull request:**
  ```
  node ~/.claude/lib/git/pr.mjs pr-create \
    --repo SatanshuMishra/logbook --head feat/u9a-declared-focus --base main \
    --title "feat(focus): record and render a session's declared focus" \
    --what "resume_thread accepts an optional focus argument, an array of criterion ids, and writes it to the session pointer, never to the thread record" \
    --what "the returned briefing renders the declared focus and orders focused risks and key decisions first, before the rest" \
    --what "the preflight skill now asks which completion criteria are being worked this session and passes them as focus" \
    --why "the briefing had no way to show what a session was currently focused on, so risks and decisions from unrelated goals always crowded out the ones actually in progress" \
    --why "resume_thread had no way to record per-session intent, so nothing distinguished this session's goal from every other open one on the thread" \
    --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
    --verified "npm run typecheck - exit 0" \
    --verified "node --test test/unit/pointer.test.ts test/unit/briefing-focus.test.ts test/spawn/focus.test.ts - 16 pass, 0 fail" \
    --verified "npm test (standalone Part A tree) - 519 tests, 514 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
    --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
    --risk "the always-present focus field grows every resume_thread reply by a small, fixed byte count, bounded by the retention cap; this PR is 549 lines (142 production, 407 test)"
  ```

### Part B — `update_thread` accepts focus

- **Branch:** `feat/u9b-update-thread-focus`. **PR scope:** `focus`. **Type:** `feat`. **PR:** section 10, Part B.
- **Precondition (stop condition):** this part starts from a tree carrying Part A's merged output. Run `grep -c 'focus: Ulid\[\]' src/domain/pointer.ts`; it must print `1`. Run `npx tsc -p tsconfig.json --noEmit`; it must exit `0`. If either check fails, Part A has not landed on this branch's base — STOP and report; do not improvise.
- **Version step:** read `"version"` in `package.json` and `.claude-plugin/plugin.json`; both must read `1.5.0` (the value Part A's merge leaves — if either reads anything else, STOP and report; do not improvise). Additive only, MINOR: write `1.6.0` to both files. `node scripts/check-packaging.mjs` — `check-packaging: ok`, exit `0`, before and after.
- **Consumes:** section 4.1 step B-1 (`src/server/tools/update_thread.ts`) and the Part B half of the `test/contract/no-path.test.ts` pair. Section 5.1 tests: `test/spawn/focus.test.ts`'s remaining seven tests (`update_thread.writes-focus-to-this-sessions-pointer`, `update_thread.reports-focus-not-written-when-no-pointer-exists`, `update_thread.reports-focus-not-written-when-the-pointer-file-is-corrupt`, `update_thread.reports-focus-not-written-when-the-pointer-names-another-thread`, `update_thread.reports-focus-not-written-when-another-session-holds-the-pointer`, `update_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread`, `focus.never-reaches-the-thread-record`) plus the helpers those need (`layoutInFixture`, `readPointerFocus`, `threadRecordRawText`, `writeCorruptPointer`, the three reason-string constants).
- **Files touched (3, added to the 13 Part A already shipped, confirmed present by the precondition above):** `src/server/tools/update_thread.ts`; `test/spawn/focus.test.ts` (extended to its full 9-test, 320-line form) and `test/contract/no-path.test.ts` (extended with the `update_thread` half).
- **Red on the parent** (Part A's own tree with Part B's test files copied in, no production change): `npx tsc -p tsconfig.json --noEmit` — exit `2`, one diagnostic:
  ```
  test/contract/no-path.test.ts(338,7): error TS2353: Object literal may only specify known properties, and 'focus' does not exist in type '{ thread_id: string; criteria_done?: ...; }'.
  ```
  `node --test --experimental-strip-types test/spawn/focus.test.ts` — `9 tests, 2 pass, 7 fail` (exit `1`) (the 2 that pass are the two `resume_thread` tests Part A already shipped). Exact failure text, `update_thread.reports-focus-not-written-when-no-pointer-exists`:
  ```
  AssertionError [ERR_ASSERTION]: update_thread expected a successful call, got a refusal: [{"type":"text","text":"field: focus\naccepted: object\nexample: {\"thread_id\":\"00000000000000000000000000\"}\nretryable: true\nfocus was refused; it accepts object; a valid example is {\"thread_id\":\"00000000000000000000000000\"}; remedy: send a value matching what this field accepts and retry; retryable=true."}]
  ```
  `node --test --experimental-strip-types test/contract/no-path.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`). Exact failure text:
  ```
  Error: expected updateThreadTool to refuse a focus id naming no criterion on this thread
      at collectToolRefusals (.../no-path.test.ts:340:38)
  ```
- **Inertness mutation** (disposable full-tree copy of this part's own tree): revert `resolveFocusOutcome`'s session-ownership check in `src/server/tools/update_thread.ts`:
  ```diff
  -  if (pointerRead.value.session_id !== rt.sessionId) {
  -    return { ok: true, value: { written: false, reason: OTHER_SESSION_FOCUS_REASON } }
  -  }
  -
     writePointer(rt, layout.value, { ...pointerRead.value, focus: focusIds })
  ```
  `npx tsc -p tsconfig.json --noEmit` — exit `0`. `node --test --experimental-strip-types test/spawn/focus.test.ts` — `9 tests, 8 pass, 1 fail` (exit `1`). Exact failure text:
  ```
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  true !== false
      at TestContext.<anonymous> (.../test/spawn/focus.test.ts:257:16)
  ```
  Restore the reverted lines; re-run: `9 tests, 9 pass, 0 fail` (exit `0`).
- **Full verification** (standalone = Part A's tree plus this part's two files):
  - `npx tsc -p tsconfig.json --noEmit` — exit `0`, no output.
  - `npm test` — `526 tests, 521 pass, 5 fail` (exit `1`). Same 5 names observed during planning on a reconstructed tree, none new; expected green apart from the tracked flake on a real checkout (section 8).
- **Measured diff** (standalone, against Part A's tree):

  | File | Lines |
  |---|---|
  | `src/server/tools/update_thread.ts` | 79 |
  | **Production total** | **79** |
  | `test/contract/no-path.test.ts` | 8 |
  | `test/spawn/focus.test.ts` | 193 |
  | **Test total** | **201** |
  | **Part B total** | **280** |

- **Stop conditions for this part:** the precondition above (Part A's merge landed) must hold before any other check runs. The two version manifests must not disagree with each other, before this part's version step. A version higher than the table's baseline means the ladder shifted upstream and is NOT a stop condition; only the two manifests disagreeing with each other is. `briefing.renders-exact-output-for-a-full-thread` and `briefing.omits-empty-list-sections-entirely` must still pass, unmodified, on this part's parent (`U8-A`'s repair, divergence 8). Any FIND string above that does not match its target file, or any test outside this part's own list being touched, are both immediate stops. On all of these: STOP and report; do not improvise.
- **Pull request:**
  ```
  node ~/.claude/lib/git/pr.mjs pr-create \
    --repo SatanshuMishra/logbook --head feat/u9b-update-thread-focus --base main \
    --title "feat(focus): write focus to the session pointer in update_thread" \
    --what "update_thread accepts the same optional focus argument resume_thread accepts, and writes it to this session's pointer" \
    --what "update_thread writes focus only when a pointer exists, names this thread, and names this session; every other pointer state still succeeds and reports exactly why focus was not written" \
    --why "only resume_thread could set a session's declared focus, so a session could never change what it was focused on without resuming the thread again" \
    --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
    --verified "npm run typecheck - exit 0" \
    --verified "node --test test/spawn/focus.test.ts - 9 pass, 0 fail" \
    --verified "node --test test/contract/no-path.test.ts - 9 pass, 0 fail" \
    --verified "npm test (standalone Part B tree) - 526 tests, 521 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
    --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
    --risk "this pull request is 280 lines (79 production, 201 test), within the 400-line review ceiling"
  ```

### Part C — Write tools ignore the pointer

- **Branch:** `test/u9c-write-tools-ignore-the-pointer`. **PR scope:** `pointer`. **Type:** `test`. **PR:** section 10, Part C.
- **Precondition (stop condition):** this part starts from a tree carrying Part A's and Part B's merged output. Run `node --test --experimental-strip-types test/spawn/focus.test.ts`; it must exit `0` and print `ℹ tests 9` / `ℹ pass 9` / `ℹ fail 0`. If it does not, Part B has not landed on this branch's base — STOP and report; do not improvise.
- **Version step:** read `"version"` in `package.json` and `.claude-plugin/plugin.json`; both must read `1.6.0` (the value Part B's merge leaves — if either reads anything else, STOP and report; do not improvise). This part is `test`-type and ships no production diff; per section 0's ladder every `test` part still takes PATCH — write `1.6.1` to both files (this corrects an earlier draft of this plan, which said a test-only part writes its version back unchanged; that was wrong — every merge is a release, and `test` takes PATCH exactly as `fix`, `ci`, `docs` and `perf` do). `node scripts/check-packaging.mjs` — `check-packaging: ok`, exit `0`, before and after.
- **Consumes:** section 5.1, `test/contract/write-tools-ignore-the-pointer.test.ts` entire file — the census over every entry of `ALL_TOOLS` (`src/server/register.ts`) whose `annotations.readOnlyHint` is `false` (eleven tools today; the census halts on a write tool with no registered recipe, so a twelfth cannot be added silently), each driven twice against equivalent fresh fixtures (pointer file absent; pointer file present, naming a different thread and a different `session_id`), both required to return `ok` — plus the two-teammate real-conflict fixture for `resolve_conflict`. No production step.
- **Files touched (1, added to the files Part A and Part B already shipped, confirmed present by the precondition above):** `test/contract/write-tools-ignore-the-pointer.test.ts` only.
- **Red on the parent:** this part's own new file, run against Part B's tree (its actual parent) with no other change: `node --test --experimental-strip-types test/contract/write-tools-ignore-the-pointer.test.ts` — `2 tests, 2 pass, 0 fail` (exit `0`). BOTH pass. This is not a defect: `S4` ("every write tool succeeds when no pointer exists and when a foreign session holds one") pre-dates this unit and was not disturbed by Part A's or Part B's production changes (`focus` is optional on both `resume_thread` and `update_thread`, and none of this file's recipes send `focus`). This part's census is new coverage of a property that already held. There is no red-then-green receipt for this part; the honest record is a green-on-parent-too coverage addition, stated rather than concealed. Ladder status: `unverified-reasoned` — a conventional fixed/red-then-green receipt cannot be produced because there was never a red to fix, and the reasoning above is the substitute evidence.
- **Inertness mutation** (disposable full-tree copy of this part's own tree): revert `park_thread.ts`'s absent-pointer branch to always refuse:
  ```diff
       if (pointerRead.kind === 'absent') {
  -      if (input.outcome !== undefined) {
  -        return { ok: false, refusal: noWorkedThreadRefusal() }
  -      }
  -      return emptyStatusReply('nothing-to-park')
  +      return { ok: false, refusal: noWorkedThreadRefusal() }
       }
  ```
  `npx tsc -p tsconfig.json --noEmit` — exit `0`. `node --test --experimental-strip-types test/contract/write-tools-ignore-the-pointer.test.ts` — `2 tests, 1 pass, 1 fail` (exit `1`). Exact failure text:
  ```
  AssertionError [ERR_ASSERTION]: write-tools.ignore-the-pointer: park_thread (pointer absent) expected ok, got a refusal: [{"type":"text","text":"field: outcome\naccepted: an outcome supplied while some thread is marked as being worked\nexample: call resume_thread first, then send this same outcome to park_thread\nretryable: true\nno thread is currently marked as being worked, so this outcome has nowhere to be written; the supplied text was NOT stored and must be re-sent; remedy: call resume_thread on the thread this session worked and then call park_thread again with the same outcome, or call park_thread with outcome omitted to confirm there is nothing to park."}]
  ```
  Restore the reverted lines; re-run: `2 tests, 2 pass, 0 fail` (exit `0`).
- **Full verification** (standalone = Part B's tree plus this part's one file):
  - `npx tsc -p tsconfig.json --noEmit` — exit `0`, no output.
  - `npm test` — `528 tests, 523 pass, 5 fail` (exit `1`). Same 5 names observed during planning on a reconstructed tree, none new; expected green apart from the tracked flake on a real checkout (section 8).
- **Measured diff** (standalone, against Part B's tree):

  | File | Lines |
  |---|---|
  | (no production file differs) | 0 |
  | **Production total** | **0** |
  | `test/contract/write-tools-ignore-the-pointer.test.ts` (new) | 299 |
  | **Test total** | **299** |
  | **Part C total** | **299** |

- **Stop conditions for this part:** the precondition above (the census result on Part B's tree) must hold before any other check runs. The two version manifests must not disagree with each other, before this part's version step. A version higher than the table's baseline means the ladder shifted upstream and is NOT a stop condition; only the two manifests disagreeing with each other is. Any FIND string above that does not match its target file, or any test outside this part's own list being touched, are both immediate stops. On all of these: STOP and report; do not improvise.
- **Pull request:**
  ```
  node ~/.claude/lib/git/pr.mjs pr-create \
    --repo SatanshuMishra/logbook --head test/u9c-write-tools-ignore-the-pointer --base main \
    --title "test(pointer): assert every write tool tolerates the pointer" \
    --what "a closed census now drives every write tool once with no session pointer and once with a foreign session's pointer, asserting both calls still succeed" \
    --why "the rule that a write tool must never fail purely because of the session pointer's state was true but had no coverage, so a future change could silently break it" \
    --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
    --verified "npm run typecheck - exit 0" \
    --verified "node --test test/contract/write-tools-ignore-the-pointer.test.ts - 2 pass, 0 fail" \
    --verified "npm test (standalone Part C tree) - 528 tests, 523 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
    --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
    --risk "this pull request is 299 lines (0 production, 299 test), within the 400-line review ceiling"
  ```

### Part D — Scope is not fabricated

- **Branch:** `feat/u9d-declared-scope`. **PR scope:** `decisions`. **Type:** `feat`. **PR:** section 10, Part D.
- **Version step:** read `"version"` — `1.6.1`, as left by Part C's merge. Additive plus strictly-more-permissive (an optional argument added, a refusal deleted — no call that used to succeed now fails), so it takes MINOR: write `1.7.0` to both files. `node scripts/check-packaging.mjs` — `check-packaging: ok`, exit `0`, before and after.
- **Precondition:** `test/support/schema-nodes.ts` must already be present on this part's own base (U6's precondition, section 2.2.0); this plan does not create it. Stop condition, run before any other work in this part: `ls test/support/schema-nodes.ts` — exit `0`, prints `test/support/schema-nodes.ts` (section 11). If it does not, STOP and report; do not improvise.
- **Consumes:** section 4.2 steps D-1 through D-16 in full (`B11` is D-1 through D-5; `B12` is D-6 through D-11; the `no-path.test.ts` edit is D-12 through D-14; the ordinal-widening edit is D-15 through D-16). Section 5.2 tests: `error.discloses-no-path` (unchanged name, now also drives `unknownCriterionRefusal`); `briefing.criterion-ordinal-is-read-only-to-render-a-display-label`; and in `test/spawn/decisions.test.ts`: `decision.omitted-scope-is-stored-empty`, `decision.an-explicit-scope-is-stored-verbatim`, `decision.omitting-scope-succeeds-even-when-no-criterion-is-open`, `decision.criterion_id-is-stored-on-the-key-decision-when-supplied`, `decision.criterion_id-is-absent-from-the-key-decision-when-omitted`. This part carries none of `A6` and touches no file under `test/support/` beyond the precondition.
- **Red on the parent** (a copy of `$BASE` plus this part's three test files, no production file): 
  ```
  $ node --test --experimental-strip-types test/contract/no-path.test.ts
  ✖ error.discloses-no-path
  ℹ tests 9
  ℹ pass 8
  ℹ fail 1
  $ echo $?
  1

  $ node --test --experimental-strip-types test/spawn/decisions.test.ts
  ✖ decision.omitted-scope-is-stored-empty
  ✖ decision.an-explicit-scope-is-stored-verbatim
  ✖ decision.omitting-scope-succeeds-even-when-no-criterion-is-open
  ✖ decision.criterion_id-is-stored-on-the-key-decision-when-supplied
  ℹ tests 17
  ℹ pass 13
  ℹ fail 4
  $ echo $?
  1

  $ node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts
  ✖ briefing.criterion-ordinal-is-read-only-to-render-a-display-label
  ℹ tests 9
  ℹ pass 8
  ℹ fail 1
  $ echo $?
  1
  ```
  Six failures total, all and only the ones this part's production change fixes. (`decision.criterion_id-is-absent-from-the-key-decision-when-omitted` correctly stays green at the parent too — omitting a field that doesn't exist yet is trivially the same as omitting it after `B11` ships.)
- **Inertness mutations**, each in an isolated copy of this part's own standalone tree:
  - **B11** — drop the `criterion_id: input.criterion_id` line from the `keyDecision` object literal (keep the validation refusal). `tsc` still exits `0`. `decision.criterion_id-is-stored-on-the-key-decision-when-supplied` turns red:
    ```
    AssertionError: a supplied criterion_id must be stored on the key-decision link; + actual: undefined - expected: '01M15TZNJ1MG9S2GDZR9CW5X9F'
    ```
    Restore.
  - **B12** — restore `deriveScope`, restore `noOpenCriterionRefusal`, revert the handler's `escapedScope` line to derive-or-refuse (and restore the `Criterion` type import `deriveScope` needs). `tsc` still exits `0`. Two tests turn red:
    ```
    ✖ decision.omitted-scope-is-stored-empty
    ✖ decision.omitting-scope-succeeds-even-when-no-criterion-is-open
    ```
    and, on the full assembled tree where Part E's census is also present, a third signal independently confirms the same reverted logic:
    ```
    contract.optional-arguments-are-absent.no-code-derives-a-substitute
      census rejected a forbidden item:
      {"path":"record_decision.scope","site":"key_decision_scope","omitted":"criterion 1","refused":false}
    ```
    Restore.
  - **Ordinal widening** — on top of the B12 mutation above (so `record_decision.ts` genuinely carries a forbidden `candidate.ordinal`/`best.ordinal` read again), narrow `ASSERTED_ORDINAL_ROOTS` back down to `[src/render/]` only. The previously-red `briefing.criterion-ordinal-is-read-only-to-render-a-display-label` turns **green**:
    ```
    ✔ briefing.criterion-ordinal-is-read-only-to-render-a-display-label
    ℹ tests 9
    ℹ pass 9
    ℹ fail 0
    $ echo $?
    0
    ```
    proving the narrow root silently misses the forbidden read the census exists to catch. Restore both mutated files.
- **Full verification** (standalone tree = `$BASE` plus only this part's four files):
  ```
  $ npx tsc -p tsconfig.json --noEmit
  (no output)
  $ echo $?
  0

  $ node --test --experimental-strip-types test/contract/no-path.test.ts
  ℹ tests 9
  ℹ pass 9
  ℹ fail 0
  $ echo $?
  0

  $ node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts
  ℹ tests 9
  ℹ pass 9
  ℹ fail 0
  $ echo $?
  0

  $ node --test --experimental-strip-types test/spawn/decisions.test.ts
  ℹ tests 17
  ℹ pass 17
  ℹ fail 0
  $ echo $?
  0

  $ npm test
  ℹ tests 530
  ℹ pass 525
  ℹ fail 5
  $ echo $?
  1
  ```
  The 5 failures are the same 5 names observed during planning on a reconstructed tree (section 8), none new; expected green apart from the tracked flake on a real checkout. `check-packaging.mjs` exits `0` after the version bump.
- **Measured diff** (standalone, this part's four files against `$BASE`):

  | File | Removed | Added | Kind |
  |---|---|---|---|
  | `src/server/tools/record_decision.ts` | 20 | 25 | production |
  | `test/contract/no-path.test.ts` | 7 | 14 | test |
  | `test/unit/briefing-hides-nothing.test.ts` | 5 | 5 | test |
  | `test/spawn/decisions.test.ts` | 28 | 79 | test |

  Production: **45 lines.** Test: **138 lines.** Total: **183 lines** — under the 200-line commit target and comfortably under the 400-line ceiling.

- **Stop conditions for this part:** `ls test/support/schema-nodes.ts` — exit `0`, prints `test/support/schema-nodes.ts` — before this part's own work begins (the precondition above, section 2.2.0). The two version manifests must not disagree with each other, before this part's version step. A version higher than the table's baseline means the ladder shifted upstream and is NOT a stop condition; only the two manifests disagreeing with each other is. Any FIND string above that does not match its target file, or any test outside this part's own list being touched, are both immediate stops. On all of these: STOP and report; do not improvise.
- **Pull request:**
  ```
  node ~/.claude/lib/git/pr.mjs pr-create \
    --repo SatanshuMishra/logbook --head feat/u9d-declared-scope --base main \
    --title "feat(decisions): stop deriving scope, store it as given" \
    --what "record_decision no longer derives a decision's scope from the thread's open criteria; an omitted scope is stored as the empty string and reported as null, and is never refused" \
    --what "record_decision accepts an optional criterion_id, validated against the thread's criteria and stored on the key-decision link" \
    --what "the criterion-ordinal census now also covers src/server/tools, not only src/render, closing the gap that let a forbidden ordinal read hide there" \
    --why "deriving scope from whichever criterion happened to be lowest-numbered and open meant a decision's recorded scope depended on unrelated thread state at the moment it was recorded, and a thread with every criterion done or struck could not record a decision at all" \
    --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
    --verified "npm run typecheck - exit 0" \
    --verified "node --test test/contract/no-path.test.ts test/unit/briefing-hides-nothing.test.ts test/spawn/decisions.test.ts - 35 pass, 0 fail" \
    --verified "npm test (standalone Part D tree) - 530 tests, 525 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
    --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
    --risk "this pull request is 183 lines (45 production, 138 test), within the 400-line review ceiling"
  ```

### Part E — Every optional argument is absent when omitted

- **Branch:** `test/u9e-optional-arguments`. **PR scope:** `arguments`. **Type:** `test`. **PR:** section 10, Part E.
- **Precondition:** `test/support/schema-nodes.ts` must already be present on this part's own base — U6's precondition (section 2.2.0), and by ship order this part's actual parent already carries Part D's own copy of it. This plan does not create it. Stop condition, run before any other work in this part: `ls test/support/schema-nodes.ts` — exit `0`, prints `test/support/schema-nodes.ts`. If it does not, STOP and report; do not improvise.
- **Version step:** this part is ordered after Part D, so `package.json` reads `1.7.0` (Part D's post-bump value) when this part's version step runs. A `test`-type change takes PATCH: write `1.7.1` to both files. `node scripts/check-packaging.mjs` — `check-packaging: ok`, exit `0`, before and after.
- **Consumes:** the census in full (two tests in one new file, together discharging `A6`) — section 5.2's two new files, both given in full there (`test/contract/optional-arguments-are-absent.test.ts`; `test/support/optional-argument-recipes.ts`) — and these tests, all in `test/contract/optional-arguments-are-absent.test.ts`: `contract.optional-arguments-are-absent.no-code-derives-a-substitute`, `contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.a-derived-non-empty-value-is-forbidden`, `contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.an-unclassifiable-value-halts`, `contract.optional-arguments-are-absent.the-response-reports-it-absent`. This part touches no production file and carries none of `B11`, `B12` or the ordinal widening.
- **Red on its own parent: none, and this is not an omission.** This part's actual parent, sequenced after Part D, already carries `B12` — `deriveScope` is already deleted and `record_decision.criterion_id` already exists. The one row the census predicts as red at the parent commit (`record_decision.scope` classifying `absent-is-substituted`, because the omitted run stores `criterion 1` on the new key-decision link) can only occur against a tree that still has `deriveScope`, and this part's parent does not. Applying this part's two files to a copy of Part D's own verified tree:
  ```
  $ node --test --experimental-strip-types test/contract/optional-arguments-are-absent.test.ts
  ℹ tests 4
  ℹ pass 4
  ℹ fail 0
  $ echo $?
  0
  ```
  Green on first application — the expected, correct state given the ordering, not a manufactured red. Ladder status: `unverified-reasoned` — a conventional fixed/red-then-green receipt cannot be produced because this part's actual parent already carries the fix the census would otherwise catch, and the reasoning above is the substitute evidence.
- **Precondition (stop condition):** this part starts from a tree carrying Part D's merged output. Run `node --test --experimental-strip-types test/spawn/decisions.test.ts`; it must exit `0` and print `ℹ tests 17` / `ℹ pass 17` / `ℹ fail 0`. If it does not, Part D has not landed on this branch's base — STOP and report; do not improvise.
- **Inertness mutation** (isolated copy of this part's own tree, this part's precondition tree plus this part's two files): restore `deriveScope`, restore `noOpenCriterionRefusal`, revert the handler's `escapedScope` line back to derive-or-refuse — reverting `record_decision.ts` to the shape section 2.2.1 quotes, underneath this part's unchanged census. The census turns red with exactly the fabricated value the derived-substitute check forbids:
  ```
  $ node --test --experimental-strip-types test/contract/optional-arguments-are-absent.test.ts
  ℹ record_decision.scope#key_decision_scope: omitted run carries "criterion 1"
  ✖ contract.optional-arguments-are-absent.no-code-derives-a-substitute
    Actual message: "census rejected a forbidden item: {"path":"record_decision.scope","site":"key_decision_scope","omitted":"criterion 1","refused":false}"
  ℹ tests 4
  ℹ pass 3
  ℹ fail 1
  $ echo $?
  1
  ```
  Restore.
- **Full verification** (Part D's verified tree with only this part's two files added, plus the `schema-nodes.ts` precondition):
  ```
  $ npx tsc -p tsconfig.json --noEmit
  (no output)
  $ echo $?
  0

  $ node --test --experimental-strip-types test/contract/optional-arguments-are-absent.test.ts
  ℹ tests 4
  ℹ pass 4
  ℹ fail 0
  $ echo $?
  0

  $ npm test
  ℹ tests 534
  ℹ pass 529
  ℹ fail 5
  $ echo $?
  1
  ```
  Same 5 names observed during planning on a reconstructed tree, none new; expected green apart from the tracked flake on a real checkout (section 8). A failing typecheck was also observed and measured directly during this file's own shrink pass (an intermediate edit that passed an untyped `Record<string, unknown>` where `recordDecisionTool.handler`'s strict input type was required):
  ```
  $ npx tsc -p tsconfig.json --noEmit
  test/support/optional-argument-recipes.ts(204,72): error TS2345: Argument of type 'Record<string, unknown>' is not assignable to parameter of type '{ thread_id: string; ... }'.
  $ echo $?
  2
  ```
  confirming `tsc -p tsconfig.json --noEmit` never exits `0` on a real diagnostic; it exits `2`. That edit was fixed (a narrow `as any` at the one call site, consistent with this file's existing style of casting through `AnyTool`) before this part's tree was considered green.
- **Measured diff** (standalone, this part's two files against Part D's tree, both wholly new files):

  | File | Removed | Added | Kind |
  |---|---|---|---|
  | `test/contract/optional-arguments-are-absent.test.ts` | 0 | 145 | test |
  | `test/support/optional-argument-recipes.ts` | 0 | 742 | test |

  Production: **0 lines.** Test: **887 lines.** Total: **887 lines.**
- **Why this part is not split further (review-ceiling exception).** 887 lines is 2.2x the 400-line ceiling. The census population is closed and every optional argument must be driven; splitting by tool would narrow the population, which the standards forbid outright. A reduction pass took the support file from 980 to 724 lines and stopped there rather than reaching a target by dropping an argument or hard-coding a landing site, followed by a typing cleanup that added 18 more lines (724 -> 742) to remove an unsound `Record<string, unknown>` cast; the enumerated population is byte-identical at 28 entries before and after both passes. What remains is 28 recipes against 7 distinct tools, each needing its own fixture shape, its own sentinel value and its own extraction of where that value landed; merging any two would either collapse two population entries into one recipe (the census computes landing sites; it does not pin a verdict table, so a merged recipe would narrow the population) or degrade the remaining literals into unreadable single-line objects for a marginal further saving, trading Quality for Speed against this environment's own stated pillar order.
- **Stop conditions for this part:** the precondition above (`test/support/schema-nodes.ts` present, if not already from Part D's tree) must hold before any other check runs. The two version manifests must not disagree with each other, before this part's version step. A version higher than the table's baseline means the ladder shifted upstream and is NOT a stop condition; only the two manifests disagreeing with each other is. Any FIND string above that does not match its target file, or any test outside this part's own list being touched, are both immediate stops. On all of these: STOP and report; do not improvise.
- **Pull request:**
  ```
  node ~/.claude/lib/git/pr.mjs pr-create \
    --repo SatanshuMishra/logbook --head test/u9e-optional-arguments --base main \
    --title "test(arguments): assert every optional argument stays absent" \
    --what "a closed census over every tool's input schema now drives every optional argument twice, once omitted and once with a distinctive sentinel, and asserts an omitted argument never lands a non-empty value the caller did not supply" \
    --what "a second test asserts that a call omitting every optional argument reports each of them absent in the structured reply" \
    --why "record_decision's deleted scope-derivation (Part D) was the one place this codebase had ever invented a non-empty value for an omitted argument, and nothing before this checked that no other tool does the same" \
    --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
    --verified "npm run typecheck - exit 0" \
    --verified "node --test test/contract/optional-arguments-are-absent.test.ts - 4 pass, 0 fail" \
    --verified "npm test (standalone Part E tree) - 534 tests, 529 pass, 5 fail, observed during planning on a reconstructed tree; expected green apart from the tracked flake on a real checkout (section 8)" \
    --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
    --risk "this pull request is 887 lines (0 production, 887 test), over the 400-line review ceiling; the body states the reason it is not divisible further without narrowing the closed population"
  ```

### Part F — The resolved counter stops reading records

- **Branch:** `perf/u9f-resolved-counter`. **PR scope:** `resume`. **Type:** `perf`. **PR:** section 10, Part F.
- **Precondition:** in branch order (section 10), this part's real base is the tree left after Parts A through E have merged. This section's own "Red on the parent" and "Full verification" below are instead measured directly against a standalone tree built from `$BASE` plus only this part's own files — the substitution disclosed in section 2.3 and restated at section 10's Part F verification line. Two numbers follow directly from that substitution and are not contradictions: `npm test`'s failure count here (8) differs from Parts A through E's own post-merge count (5, section 8), because three of the eight are the `contract.published-schema-matches-enforced.*` family, present at `$BASE` but already fixed by the time Parts A through E's own trees exist; and `npm test`'s total count here (513) is BELOW Part E's own post-merge total (534), because this standalone tree carries only `$BASE` plus this part's own five new or extended tests (section 12's own "Consumes" line: `read.verdict-agrees-with-read-record-file`, the three new `probe-decisions.test.ts` tests, `resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end`), none of Parts A through E's own test additions. Stop condition: before starting work on the real branch, run `npx tsc -p tsconfig.json --noEmit`; it must exit `0`. If it does not, an earlier part has not landed on this branch's base — STOP and report; do not improvise.
- **Version step:** this part is ordered after Part E, so `package.json` reads `1.7.1` (Part E's post-bump value) when this part's version step runs. A `perf`-type change takes PATCH: write `1.7.2` to both files. `node scripts/check-packaging.mjs` — `check-packaging: ok`, exit `0`, before and after.
- **Consumes:** section 4.3 steps F-1 through F-6 in full. Section 5.3 tests: `read.verdict-agrees-with-read-record-file` (`test/store/read-path.test.ts`); `probe.matches-the-old-per-link-loop`, `probe.falls-back-to-per-id-reads-when-the-decisions-directory-cannot-be-listed`, `probe.missing-decisions-directory-yields-every-id-dangling` (`test/store/probe-decisions.test.ts`, new); `resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end` (`test/spawn/resume.test.ts`). This part carries none of `B11`, `B12`, `B15`, `B35` or `A6`, and touches no test under `test/contract/` or `test/spawn/focus.test.ts`.
- **Red on the parent** (per the precondition note above: a copy of `$BASE` with only this part's three test files applied, no production change):
  - `test/store/probe-decisions.test.ts` — genuine runtime red, all three tests fail identically:
    ```
    TypeError: store.probeDecisions is not a function
    ```
  - `test/store/read-path.test.ts` — the whole file fails to load, not a single-assertion red. `tsc` reports:
    ```
    test/store/read-path.test.ts(12,3): error TS2305: Module '"../../src/store/read-path.ts"' has no exported member 'readRecordVerdict'.
    ```
    and `node --test` fails at ESM module instantiation before any test in the file runs:
    ```
    SyntaxError: The requested module '../../src/store/read-path.ts' does not provide an export named 'readRecordVerdict'
    ```
    The failure is real and is caused exactly by the absence of the shipped symbol, but it is a load error, not a targeted assertion failure.
  - `test/spawn/resume.test.ts` — no red at the parent, by design. The new end-to-end test **passes** against the unmodified parent:
    ```
    ✔ resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end
    ```
    This is expected: `probeDecisions` is behaviourally identical to the old per-link loop for every input (proven by `probe.matches-the-old-per-link-loop`), so the observable briefing text `resume_thread` returns is unchanged by this part; no end-to-end assertion on that text can be red at the parent. This test's job is to guard the tool-level wiring against a future regression, not to prove the change — the change is proved by the equivalence tests plus the measurement below.
- **Inertness mutations**, each performed in a disposable copy of this part's own tree, never in the working tree:
  - **Mutation 1 — revert `probeDecisions` to a per-link `readDecision`-shaped loop** (drop the `readdirSync` presence check and `readRecordVerdict` entirely):
    ```
    const probeDecisionIds = (layout: StoreLayout, ids: readonly Ulid[]): DecisionProbe => {
      const dangling: Ulid[] = []
      const quarantined: Ulid[] = []
      for (const id of ids) {
        const slot = readRecordFile<Decision>(decisionPath(layout, id), DecisionRecord)
        if (slot === null) dangling.push(id)
        else if (slot.quarantined) quarantined.push(id)
      }
      return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
    }
    ```
    Command: `node --test --experimental-strip-types test/store/probe-decisions.test.ts test/store/read-path.test.ts test/spawn/resume.test.ts`, expected exit `0`. Result: **all 34 tests still pass.** This is an honest, expected finding, not a gap: the mutation removes only the performance optimisation (skipping a file-open for dangling ids), and every test in scope asserts classification correctness, which the mutation does not change. The performance claim is provable only by the timing measurement below. Discard the mutated copy; `$WORK` was never touched.
  - **Mutation 2 — make `readRecordVerdict` skip the declared-schema check**:
    ```
    export const readRecordVerdict = <T>(filePath: string, _declared: Declared<T>): RecordVerdict => {
      let raw: string
      try {
        raw = readFileSync(filePath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
        throw error
      }
      try {
        JSON.parse(raw)
      } catch {
        return 'quarantined'
      }
      return 'valid'
    }
    ```
    Command: `node --test --experimental-strip-types test/store/read-path.test.ts`, expected exit `1`. Result: caught immediately, exactly by the decisive case:
    ```
    ✖ read.verdict-agrees-with-read-record-file
    AssertionError [ERR_ASSERTION]: readRecordVerdict must agree with readRecordFile for well-formed JSON that fails the declared schema
    actual: 'valid'
    expected: 'quarantined'
    ```
    Discard the mutated copy.
  - **Mutation 3 — delete the correction-1 fallback branch** (performed and reverted directly in the working tree, since it is the newest, smallest correction):
    ```
    const probeDecisionIds = (layout: StoreLayout, ids: readonly Ulid[]): DecisionProbe => {
      const present = presentDecisionIds(layout)
      if (!present.listed) return { resolved: 0, dangling: [...ids], quarantined: [] }

      const dangling: Ulid[] = []
      const quarantined: Ulid[] = []
      for (const id of ids) {
        if (!present.ids.has(id)) {
          dangling.push(id)
          continue
        }
        const verdict = readRecordVerdict<Decision>(decisionPath(layout, id), DecisionRecord)
        if (verdict === 'quarantined') quarantined.push(id)
        else if (verdict === 'absent') dangling.push(id)
      }
      return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
    }
    ```
    (replacing `if (!present.listed) return probeDecisionIdsByVerdict(layout, ids)` — reverting to treating an unlistable decisions directory as empty rather than falling back to per-id reads.) Command: `node --test --experimental-strip-types test/store/probe-decisions.test.ts`, expected exit `1`. Result: caught immediately, by the `0o111` test:
    ```
    ✖ probe.falls-back-to-per-id-reads-when-the-decisions-directory-cannot-be-listed
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    + actual - expected

      {
        dangling: [
    +     '01ARZ3NDEK0000000000000001',
          '01ARZ3NDEK0000000000000004',
    +     '01ARZ3NDEK0000000000000002',
    +     '01ARZ3NDEK0000000000000003',
          '01ARZ3NDEK0000000000000005'
        ],
    +   quarantined: [],
    +   resolved: 0
    -   quarantined: [
    -     '01ARZ3NDEK0000000000000003'
    -   ],
    -   resolved: 2
      }
    ```
    `tests 3, pass 2, fail 1` — the other two tests in the file still pass, confirming only the targeted test turns red. Revert the one line in `src/store/records.ts` immediately afterward; re-run both `test/store/probe-decisions.test.ts` (3/3) and `test/store/read-path.test.ts` (5/5) green.
- **Full verification** (standalone tree, per the precondition note above: `$BASE` plus only this part's own three files):

  | Command | Exit code | Proving output substring |
  |---|---|---|
  | `npx tsc -p tsconfig.json --noEmit` | 0 | (no output) |
  | `node --test --experimental-strip-types test/store/read-path.test.ts` | 0 | `ℹ pass 5` / `ℹ fail 0` |
  | `node --test --experimental-strip-types test/store/probe-decisions.test.ts` | 0 | `ℹ pass 3` / `ℹ fail 0` |
  | `node --test --experimental-strip-types test/spawn/resume.test.ts` | 0 | `ℹ pass 26` / `ℹ fail 0` |
  | `npm test` | non-zero, observed on the reconstructed planning tree (section 8) | `ℹ tests 513` / `ℹ pass 505` / `ℹ fail 8` |

  `npm test` fails on exactly 8 names observed during planning, confirmed byte-for-byte identical to a from-scratch run of this part's own reconstructed parent tree before this part's files are applied: `cutover.old-tree-absent`, three `contract.published-schema-matches-enforced.*` tests, `install.serves-new-server`, `install.no-build-output-was-materialised`, `briefing.renders-exact-output-for-a-full-thread`, `briefing.omits-empty-list-sections-entirely`. None of these are new, and `concurrent.distinct-ids` is not among them — no re-run was needed per section 11's tracked-flake procedure. On a real checkout (section 8), none of the eight recur and `npm test` is expected to pass in full apart from the tracked flake; any other failure there is a stop condition.
- **The measurement.** Re-measured with a purpose-built, discarded-after-use script, same methodology as the underlying decision: 50 warm-up + 250 timed repetitions per implementation per size, a fixture built with `test/support/git-fixture.ts` + `openStore`, a 70/15/15 resolved/dangling/quarantined split (rounded: 10 links -> 6/2/2, 40 -> 28/6/6, 200 -> 140/30/30). "before" is a per-link `store.readDecision` loop (the code this part replaces); "after" is `store.probeDecisions(ids)`, the shipped method.

  | links | impl | median us | min us | decision files opened per call |
  |---|---|---|---|---|
  | 10 | before | 131.2-134.3 (3 runs) | 115.0-117.3 | 10 |
  | 10 | after | 128.4-129.9 (3 runs) | 115.0-117.3 | 8 |
  | 40 | before | 483.8-496.9 (3 runs) | 433.8-444.5 | 40 |
  | 40 | after | 476.3-487.2 (3 runs) | 433.8-440.2 | 34 |
  | 200 | before | 2459.3-2486.0 (3 runs) | 2179.6-2265.1 | 200 |
  | 200 | after | 2325.6-2458.2 (3 runs) | 2136.0-2179.6 | 170 |

  The "decision files opened per call" column is the load-bearing structural claim (skip the file open for every dangling id): it reproduces exactly, at every size, because it follows deterministically from the fixture's dangling count, not from timing noise. What is and is not saved: the saving is skipped file reads for ABSENT ids only. For every id whose decision file is present — resolved or quarantined — `probeDecisions` still calls `readRecordVerdict`, which reads, parses and schema-validates the file exactly as the old per-link loop did; no parse step or schema-validation step is removed anywhere in this shipped diff.

  Timing: at 10 and 40 links, "after" is faster than "before" by a few percent in every run, but this is smaller than run-to-run variation of the baseline itself and supports no claim in either direction on its own. At 200 links, one run showed almost no difference (~1 us) while two others showed "after" faster by 73.7-82.5 us (2-3.5%); the ordering was stable across runs only at 200 links. **This timing claim is not a functional inertness receipt** (section 3, divergence 5): reverting the cost-reducing logic leaves every functional test passing (Mutation 1 above), because the change is a cost reduction whose observable behaviour is identical by construction. Its evidence is the file-open counts and this measured table, not a pass/fail test. Ladder status: `unverified-reasoned` — a conventional pass/fail receipt cannot be produced for a cost reduction whose observable behaviour is identical by construction, and the file-open counts plus the measured table above are the substitute evidence, per the honesty ladder rather than a false `fixed` claim (section 11 of the receipts standard).
- **Measured diff** (standalone, this part's six touched files against its own actual parent):

  | File | Removed | Added | Kind |
  |---|---|---|---|
  | `src/store/read-path.ts` | 0 | 6 | production |
  | `src/store/records.ts` | 3 | 42 | production |
  | `src/server/tools/resume_thread.ts` | 17 | 10 | production |
  | `test/store/read-path.test.ts` | 0 | 29 | test |
  | `test/spawn/resume.test.ts` | 0 | 53 | test |
  | `test/store/probe-decisions.test.ts` (new) | 0 | 162 | test |

  Production: **58 added, 20 removed, 78 changed lines.** Test: **244 added, 0 removed, 244 changed lines.** Total: **322 changed lines.**

- **Stop conditions for this part:** the precondition above (`npx tsc -p tsconfig.json --noEmit` exits `0` on the real branch base) must hold before any other check runs. The two version manifests must not disagree with each other, before this part's version step. A version higher than the table's baseline means the ladder shifted upstream and is NOT a stop condition; only the two manifests disagreeing with each other is. Any FIND string above that does not match its target file, or any test outside this part's own list being touched, are both immediate stops. On all of these: STOP and report; do not improvise.
- **Pull request:**
  ```
  node ~/.claude/lib/git/pr.mjs pr-create \
    --repo SatanshuMishra/logbook --head perf/u9f-resolved-counter --base main \
    --title "perf(resume): stop reading every decision record to resolve links" \
    --what "resume_thread's resolved/dangling/quarantined count no longer opens and parses a full decision record for a key-decision link whose file is absent; it now lists the decisions directory once and only opens files that are present" \
    --why "resume_thread opened, parsed and schema-validated one decision record per key-decision link even when the link's target file did not exist, which is unnecessary work that scales with the number of links on a thread" \
    --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
    --verified "npm run typecheck - exit 0" \
    --verified "node --test test/store/read-path.test.ts test/store/probe-decisions.test.ts test/spawn/resume.test.ts - 34 pass, 0 fail" \
    --verified "npm test (standalone Part F tree) - 513 tests, 505 pass, 8 fail, observed during planning on Part F's own reconstructed tree measured directly against $BASE (section 2.3); expected green apart from the tracked flake on a real checkout (section 8)" \
    --not-verified "the full six-part ladder end-to-end in one sitting - not run, each part verified standalone against its own actual parent" \
    --risk "the timing claim is not proven by any test, only the measured us table in section 12 Part F with its noise caveat; this PR is 322 lines (78 production, 244 test)"
  ```
