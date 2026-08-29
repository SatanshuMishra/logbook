# U7 — Capture

## 0. Identity

- **Closes:** `B29`, `B30`, `B31`, `B32`, `B33`, `B34`; defects `D10`, `D11`, `D17`; invariant `O3` (the half of it that belongs to the session-start banner).
- **Depends on:** the shared clip-marker helper module `src/render/clip.ts`, exporting `clipWithMarker` and `CLIP_MARKER`, must already exist on `main`. Section 11 makes that a stop condition. The process-spawn allowlist census `test/contract/spawn-allowlist.test.ts` must already exist on `main`. Section 11 makes that a stop condition too.
- **Required by:** nothing. No later unit reads any file this unit owns.
- **Wave:** 2.
- **Owns:** `hooks/post-tool-use.ts`, `hooks/stop.ts`, `src/hooklib/stop-gate.ts`, `src/hooklib/commit-note.ts` (deleted here), `src/cli/session-start.ts`, `skills/debrief/SKILL.md`.
- **Creates and wholly owns:** `src/hooklib/ledger-presence.ts`, `test/hooks/stop-gate-ledger-presence.test.ts`, `test/hooks/post-tool-use-writes-nothing.test.ts`, `test/contract/debrief-spine-update.test.ts`, `test/contract/subagent-recording-guidance.test.ts`.
- **Also edits, and the reason for each:**
  - `src/server/instructions.ts` — the published Model Context Protocol server instructions. `B31` is guidance that has to reach every agent holding a thread id, and this is the only surface that does. Section 3 records the divergence from the unit's file list. No other unit in this ladder edits this file.
  - `test/unit/session-start.test.ts` — the shipped unit test for the file this unit changes.
  - `test/spawn/forgery.test.ts` — one shipped assertion becomes false by mandate when the banner emits a clip marker. Section 3 records it; section 5 replaces it with a strictly stronger pair.
- **Branch names:** this unit splits into three pull requests, ruled in section 10 on a measured diff. `feat/u7a-capture-presence`, `feat/u7b-banner-clip-marker`, `feat/u7c-recording-guidance`.
- **Version bump:** the baseline for U7 in orchestrator rulings `OR1`, `OR23` and `OR25` is `2.2.0` rising to `2.3.0`, and `OR25` shifts every row after `U1-D` by one further patch, so the expected starting value is `2.2.1`. That value is written here for orientation only. **Read-then-increment per `OR6` is what governs**, each of the three pull requests performs its own increment, and a version merely higher than the number above means the ladder shifted and is not a stop condition.
- **SPEC anchors:** section 9 unit U7 (wave 2); section 8 rules `B29`, `B30`, `B31`, `B32`, `B33`, `B34`; section 6.3 invariant `O3`; section 7 defects `D10`, `D11`, `D17`.

## 1. Acceptance criteria (the ceiling)

1. The existing refusal on acts that redefine the work still ships in both its instances, and this plan names them. No code changes for it. — `B29`.
2. The Stop hook carries a second verdict that compares ledger ref state and blocks when nothing has reached `refs/logbook/ledger` since this session began. — `B30`; `Green` clause "The Stop hook's second verdict blocks when nothing has reached the ref since resume".
3. That verdict clears the moment anything reaches the ref, and it is evaluated afresh at every turn end rather than latched to fire once per session. — `B30`; `Green` clause "and clears the moment anything does".
4. The blocking message states that something reached the ledger and nothing more; it carries no claim, in any wording, that what was recorded is complete or sufficient. — `B30` ("It guarantees presence, never completeness, and no text anywhere may describe it otherwise").
5. None of the five retired compaction-nudge literals appears in any text this unit adds under `src`, `hooks`, `bin` or `skills`, and both inherited census tests pass with no edit to either file. — `Green` clause "The two inherited census tests pass unchanged".
6. Guidance that any agent holding a thread id may record, that recording at the subagent boundary is preferred, and that the split is by content — a subagent records what it established, a selection between live options is recorded by whoever selected — is published to every connected agent. — `B31`.
7. The session-start banner emits a marker when it clips, and reserves room for that marker inside its own limit. — `B32`; `O3`; defect `D11`.
8. The post-tool-use commit-note write is deleted, along with the module that performed it, and a commit-shaped Bash command no longer moves the ledger ref. — `B33`; `Green` clause "The commit-note write is gone"; defect `D17`.
9. The `PostToolUse` hook still exists, is still registered in `hooks/hooks.json`, and emits an empty object for a large transcript. — `Green` clause "`post-tool-use` emits an empty object for a large transcript"; packaging requires the file.
10. The `debrief` skill passes `next_step` to `park_thread` and does not pass `last_session`, and driving the sequence exactly as written returns a non-empty spine update. — `B34`; `Green` clause "`debrief` returns a non-empty spine update"; defect `D10`.

This list is built from exactly three sources and nothing else: the behavioural rules in the unit's `Carries` cell, every clause of the unit's `Green` cell, and the one invariant SPEC section 11.4 assigns to this unit. The plan invariants `P1` (suite and typecheck green on every merge commit) and `P4` (both version files bumped together, packaging passing) bind this unit as they bind every unit, and section 8 runs them; they are deliberately not numbered here, because a ceiling built from anything but those three sources is no longer the closed definition of done for this unit.

Anything discovered above this list goes to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is not folded into this plan.

## 2. Ground truth

Every line range below was read in the working tree at the tip of `main` while authoring this plan. `src/`, `test/`, `hooks/`, `bin/`, `skills/` and `scripts/` are byte-identical between `main` and the documentation branch, so these ranges are the ranges the implementer will see, subject to the stop conditions in section 11.

### 2.1 `src/hooklib/stop-gate.ts`, lines 50–69 — the whole verdict, and it has only one

```ts
export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const gate = readGate(layout.value.state)
  if (gate !== null && gate.session_id === event.session_id) return { kind: 'silent' }

  const pledge = findLastResumeBriefing(event.transcript_path)
  createStateDirectory(layout.value)
  writeGate(rt, layout.value.state, event.session_id)

  if (pledge === null) return { kind: 'silent' }
  if (event.stop_hook_active) return { kind: 'silent' }

  const texts = collectAssistantTexts(event.transcript_path)
  const echoed = texts.some((text) => text.includes(pledge))
  if (echoed) return { kind: 'silent' }

  return { kind: 'block', reason: verbatimReason(pledge) }
}
```

What is wrong with it: there is exactly one verdict, the verbatim-briefing echo check, and it self-disables for the rest of the session on its second line (`gate.session_id === event.session_id`). Nothing in the Stop hook observes whether this session ever recorded anything. `B30` mandates a second verdict that does, and it cannot live inside the once-per-session early return.

### 2.2 `src/hooklib/stop-gate.ts`, lines 1–6 — the current imports

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { collectAssistantTexts, findLastResumeBriefing } from './transcript.ts'
```

What is wrong with it: nothing, but the module has no way to read the ledger ref or the record of what is being worked, which the second verdict needs.

### 2.3 `src/cli/session-start.ts`, lines 1–6 and 55–62 — the banner and how it is composed

Imports, lines 1–6:

```ts
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import type { Thread } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'
```

The composition, lines 55–62:

```ts
export type SessionStartReply = { additionalContext: string }

export const runSessionStart = (rt: Runtime, event: SessionStartEvent): SessionStartReply => {
  const crashReport = renderCrashReport(rt, event.cwd, event.session_id)
  const listing = renderThreadListing(rt, event.cwd)
  const sections = crashReport === null ? [listing] : [crashReport, listing]
  return { additionalContext: sections.join('\n\n') }
}
```

What is wrong with it: this closes SPEC defect `D11`. The returned string is handed to `hooks/lib/io.ts`, whose `clipDeep` silently truncates every string field to 10,000 graphemes (`hooks/lib/io.ts:7` declares `MAX_FIELD_GRAPHEMES = 10000`; `:27` applies `clipGraphemes(value, MAX_FIELD_GRAPHEMES)`; `src/render/escape.ts:84-88` is the truncation itself). The reader is given no indication that anything was removed. It is also where the per-session ledger baseline has to be recorded, because session start is the only moment guaranteed to precede `resume_thread`.

### 2.4 `hooks/post-tool-use.ts`, lines 1–20 — the whole file

```ts
#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { isCommitShapedCommand, noteProjectCommit } from '../src/hooklib/commit-note.ts'

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

await runHook('post-tool-use', (event) => {
  if (typeof event !== 'object' || event === null) return { block: false, json: {} }
  const record = event as Record<string, unknown>
  const toolInput = typeof record.tool_input === 'object' && record.tool_input !== null ? record.tool_input : null
  const command = toolInput === null ? undefined : (toolInput as Record<string, unknown>).command

  if (!isCommitShapedCommand(record.tool_name, command)) return { block: false, json: {} }
  if (!isNonEmptyString(record.cwd) || !isNonEmptyString(record.session_id)) return { block: false, json: {} }

  const rt = productionRuntime()
  noteProjectCommit(rt, record.cwd, record.session_id)
  return { block: false, json: {} }
})
```

What is wrong with it: this is SPEC defect `D17`. The hook writes a session-log record into the store from a separate operating-system process, and nothing anywhere reads that record back.

### 2.5 `src/hooklib/commit-note.ts`, lines 1–50 — the write itself

```ts
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { readPointer } from '../domain/pointer.ts'
import { readProjectHead } from '../store/git.ts'
import { openStore } from '../store/records.ts'

const COMMIT_SHAPED_PATTERN = /\bgit\s+(commit|merge|rebase|cherry-pick|revert|pull|am)\b/
const COMMIT_NOTE_ACTOR = 'logbook-post-tool-use'

export const isCommitShapedCommand = (toolName: unknown, command: unknown): boolean =>
  toolName === 'Bash' && typeof command === 'string' && COMMIT_SHAPED_PATTERN.test(command)

export const noteProjectCommit = (rt: Runtime, cwd: string, sessionId: string): void => {
  const layout = layoutFor(rt, cwd)
  if (!layout.ok) return

  const pointerRead = readPointer(rt, layout.value)
  if (pointerRead.kind !== 'pointer' || pointerRead.value.session_id !== sessionId) return

  const sha = readProjectHead(rt, cwd)
  if (sha === null) {
    rt.log({ level: 'warn', event: 'post-tool-use.head-sha-unavailable', cwd })
    return
  }

  const opened = openStore(rt, cwd)
  if (!opened.ok) {
    rt.log({ level: 'warn', event: 'post-tool-use.store-unavailable', message: opened.message })
    return
  }

  const result = opened.value.commit(
    [
      {
        kind: 'session',
        record: {
          id: rt.ulid(),
          thread_id: pointerRead.value.thread_id,
          actor: COMMIT_NOTE_ACTOR,
          body: `Recorded commit ${sha}.`,
          created_at: rt.now()
        }
      }
    ],
    `logbook: note commit ${sha}`
  )
  if (!result.ok) {
    rt.log({ level: 'warn', event: 'post-tool-use.commit-note-failed', reason: result.reason, detail: result.detail })
  }
}
```

What is wrong with it: same defect `D17`. This module exists only to perform that unread write, so deleting the write deletes the module. Its one import from elsewhere, `readProjectHead` at `src/store/git.ts:106-109`, has a second live caller at `src/server/tools/record_decision.ts:186`, so removing this file leaves no dead code behind it.

### 2.6 `skills/debrief/SKILL.md`, lines 1–13 — the whole file

```markdown
---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Call `park_thread` with `park_thread.outcome` set to that summary.
3. Print the returned `park_thread.status`.
4. Print the refusal text `park_thread` returns in place of a status.
5. Print the summary from step 1 alongside that refusal text, so the record of this session survives a refused call.
6. Stop.
```

What is wrong with it: this is SPEC defect `D10`. `park_thread` builds its spine contribution only from `last_session` and `next_step` (`src/server/tools/park_thread.ts:250-259`), and this sequence passes neither, so a debrief run exactly as written returns `spine_fields_updated: []`.

### 2.7 `src/server/instructions.ts`, lines 1–20 — the published server instructions

```ts
export const INSTRUCTIONS = `Logbook remembers a project across sessions. It records what was being worked on, what was
decided and why, and what the next step is, and it stores that history in the project's own
git repository so a whole team shares one record.

Resuming is one call and parking is one call. resume_thread reconciles, marks the thread as
being worked, and returns the finished briefing. park_thread writes the session log, refreshes
the running summary, and releases the thread. Neither needs a preparatory call. park_thread
refuses instead of parking when the thread it would write to is gone, terminal, quarantined, or
held by another session; the refusal says the outcome text was not stored and has to be re-sent.
Omit outcome and park_thread only releases the record of what is being worked.

Identifiers are ULIDs: 26 characters, Crockford base32, for example
01M0NDPM0ACCR9CD68PMHYWGGD. Do not compose one. Take a thread id from list_threads or from the
logbook://roster resource, and a decision id from the tool result that created it.

Reads are also available without a tool call. logbook://index lists every readable address.

A refusal from this server is structured and worth reading. It names the field that was wrong,
what that field accepts, a valid example, and whether a retry can succeed. Read it and correct
the argument rather than retrying the same call.`
```

What is wrong with it: nothing is wrong; it is incomplete for `B31`. It never says who may record, so a subagent that established a finding has no published statement that it may write that finding down itself. The template literal measures 1,364 bytes; the shipped budget test `contract.instructions-within-budget` (`test/contract/budget.test.ts:25-36`) rejects 2,048 bytes or more, so there are 683 bytes of headroom.

### 2.8 `test/spawn/forgery.test.ts`, lines 16 and 795–798 — the assertion that a clip marker makes false

Line 16:

```ts
import { escapeStored } from '../../src/render/escape.ts'
```

Lines 795–798:

```ts
    assert.ok(
      unclipped.startsWith(emitted),
      'the emitted session-start context is not a prefix of the listing it was clipped from'
    )
```

What is wrong with it: nothing is wrong with it today. It becomes false by mandate once `B32` appends a marker to a clipped banner, because a string ending in a marker is not a prefix of the text it was clipped from. Section 5.5 replaces it with a strictly stronger pair of assertions, not a weaker one.

### 2.9 `test/hooks/compaction-nudge-absent.test.ts`, lines 8–19 — the five banned literals, read verbatim

```ts
const NUDGE_PHRASE = ['approaching the ', 'compaction threshold'].join('')

const FORBIDDEN_TOKENS = [
  'NUDGE_TEXT',
  'computeNudgeThreshold',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES',
  NUDGE_PHRASE
]

const SCAN_ROOTS = ['src', 'hooks', 'bin', 'skills']
const SCAN_EXTENSIONS = new Set(['.ts', '.md'])
```

What is wrong with it: nothing. It is quoted here because every string this unit adds under `src`, `hooks`, `bin` or `skills` is checked against this exact list, and because this file is never edited by this unit.

### 2.10 `src/domain/criteria.ts`, lines 28–44, and `src/server/tools/close_thread.ts`, lines 18–23 — `B29`, verified and unchanged

`B29` says the refusal on acts that redefine the work "already ships in two instances and is true by construction". Both instances were read and both exist. Neither is changed by this unit.

Instance one — an amendment to the goals must resolve to a recorded decision (`src/domain/criteria.ts:28-44`):

```ts
const missingDecisionRefusal = (field: string): Refusal => ({
  ok: false,
  field,
  accepted: 'a decision id referencing a decision record recorded on this project',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} is required; amending a completion criterion must resolve to a recorded decision.`
})

const unresolvedDecisionRefusal = (field: string, decisionId: string): Refusal => ({
  ok: false,
  field,
  accepted: 'a decision id that resolves to a stored decision record',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} does not resolve to a stored decision record; received ${decisionId}.`
})
```

Reached through `requireDecision` (`src/domain/criteria.ts:101-108`) from the insert, rewrite and strike paths (`:120`, `:177`), driven by the resolver `amend_criteria` supplies (`src/server/tools/amend_criteria.ts:72-75`).

Instance two — declaring the work finished must carry a statement (`src/server/tools/close_thread.ts:18-23`):

```ts
  outcome: z.enum(['done', 'abandoned']).describe('close the thread as finished (done) or as no longer being pursued (abandoned)'),
  detail: z
    .string()
    .min(1)
    .max(caps.THREAD_CLOSURE_DETAIL_MAX)
    .describe('the closure statement when outcome is done, or the abandon reason when outcome is abandoned; required either way')
```

`detail` is required and `.min(1)`, so a closure with no statement is refused before the handler runs.

## 3. Divergences from the SPEC

1. **The decomposition procedure named in the planning materials is absent from disk.** `~/.claude/skills/mitosis/SKILL.md` does not exist. Orchestrator ruling `OR20` rules that this ladder does not depend on it and that a planner proceeds under `PLANNING-BRIEF.md` and `ORCHESTRATOR-RULINGS.md` alone. That is what was done, and the absence is recorded here as that ruling requires.

2. **This unit edits `src/server/instructions.ts`, which SPEC section 9's `Owns` cell for U7 does not list.** `B31` is guidance, and the SPEC does not say where guidance lands. The three candidate surfaces were skill text, a tool description, and the README. Skill text cannot carry it: the shipped census `contract.skills-hold-no-rules` (`test/contract/skills.test.ts:214-227`) halts on any prose line in a `SKILL.md`, and rejects any line matching `must|never|only|unless|cannot|always|should|may|require|requires|if|when|at most|at least` (`:146-147`), so a `SKILL.md` can hold nothing but imperative steps. A tool description would attach the guidance to one tool, which contradicts `B31`'s own subject — any agent holding a thread id. The README is read by humans installing the plugin, not by the subagent that has to act on it. `src/server/instructions.ts` is the text the Model Context Protocol server publishes to every connected client, so it reaches exactly the audience `B31` names. **Ruling applied: the guidance lands there.** No other unit in this ladder lists that file, so nothing conflicts.

3. **This unit changes one assertion in a shipped test, `test/spawn/forgery.test.ts`.** The assertion is that the session-start banner emitted to the model is a prefix of the unclipped listing (`:795-798`). `B32` mandates a marker on a clipped banner, and a marked string is not a prefix. **Ruling applied: the assertion is replaced by two assertions that together are strictly stronger** — the emitted banner ends with the shared clip marker, AND the emitted banner with that marker removed is still a prefix of the unclipped listing. Nothing is deleted, skipped or weakened; the prefix property survives intact and a new property is added beside it. Section 6 shows the replacement failing at the parent commit and section 7 shows it failing again under the inertness mutation.

4. **`B30` says "excluding commits authored by the post-tool-use hook", and this plan authors no such exclusion.** The exclusion is dead on arrival, and the reason is `B33`, which is in this same unit. After `B33` the post-tool-use hook writes nothing at all, so it can author no commit at any time after this unit merges. Historical commits it authored before the merge are all older than the per-session baseline this plan compares against, and a comparison against a baseline sha excludes everything at or before that sha by construction — there is no filtering to do. Authoring an author-name filter anyway would ship machinery whose predicate is unreachable, which SPEC goal `DG1` forbids ("No layer, subsystem or abstraction ships without visibly earning its place"). **Ruling applied: no exclusion is authored, and the baseline comparison is the mechanism that makes it unnecessary.**

5. **The retired compaction nudge is precedent, not a template, and the two mechanisms differ in kind.** SPEC section 2 records that the nudge was retired for its mechanism: its predicate was the transcript file's size, which only ever grows, so once the predicate was true it stayed true forever and the nudge had to be latched to fire once per session. `B30`'s predicate is whether the ledger ref has moved since a recorded baseline. That predicate is satisfied by writing, and a write is the very act the verdict asks for, so the verdict is evaluated afresh at every turn end and no latch is needed. The two inherited census tests exist to stop the retired mechanism returning; nothing in this plan reintroduces a size-derived predicate, a latch file keyed to firing once, or any of the five banned literals.

6. **`B34` lands one wave before its partner `B23`, and the interval is stated rather than left to be discovered.** `B14` and `B23` — `park_thread` ceasing to accept `last_session`, and `last_session` being derived from the previous session's log entries — belong to `U8`, which merges after this unit. In the interval between this unit and `U8`, the running summary shows: `next_step` refreshed by every debrief, and `last_session` holding whatever value it last held. **This is not a regression.** The shipped `debrief` sequence never passed `last_session` either (section 2.6), so the field is exactly as stale after this unit as before it, and `park_thread` still accepts the field for any caller that wants to set it. What changes is that `next_step`, which was also never refreshed, now is. The interval strictly improves the summary and degrades nothing.

7. **`B42` and `S2` are satisfied without adding any module to the allowlist, and no record type reaches it.** The allowlist census classifies a module as a spawner by searching its text for `child_process`, `execFileSync`, `execFile`, `execSync`, `spawnSync`, `spawn(`, `fork(` or `worker_threads`. The new module `src/hooklib/ledger-presence.ts` calls `git(...)` from `src/store/git.ts`, which is already the sole allowlisted module under `src`; it contains none of those tokens itself and therefore does not join the allowlist. `src/hooklib/stop-gate.ts` and `hooks/stop.ts` are unchanged in that respect and are not on the allowlist. The second half of `S2` — no record type imported into an allowlisted module — is untouched: this unit adds no import to `src/store/git.ts`, and reads the ref as a forty-character string through `git rev-parse`, never by parsing a record. Section 11 carries a stop condition that re-checks the allowlist membership set before any edit begins.

8. **This unit adds no field to any record type, so `P3` has nothing to govern here.** The one new file it writes is `state/session-baseline.json`, a small bookkeeping file beside the existing `state/stop-gate.json`. It is not a record, it is never committed to `refs/logbook/ledger`, and no schema under `src/schema/` is touched. Every record in the live store parses after this unit exactly as it did before it.

9. **No other divergence was found.** Every line quoted in section 2 was read in the working tree while authoring, and every `path:line` the SPEC cites for this unit's defects resolved to the code the SPEC describes.

## 4. The change, step by step

Apply the steps in the order given. Steps 1–4 are pull request A, steps 5–6 are pull request B, steps 7–12 are pull request C. Section 12 gives each pull request its own complete execution block; this section is the single source for the edits themselves.

---

### Step 1 — CREATE `src/hooklib/ledger-presence.ts`

Create the file with exactly these contents, first character to last:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, type StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { git } from '../store/git.ts'
import { LEDGER_REF } from '../store/ref.ts'

const BASELINE_FILE_NAME = 'session-baseline.json'

export type SessionBaseline = { session_id: string; ledger_head: string | null }

const baselinePathFor = (stateDir: string): string => path.join(stateDir, BASELINE_FILE_NAME)

const REF_ABSENT_EXIT_CODE = 1

export const readLedgerHead = (rt: Runtime, projectRoot: string): string | null => {
  const result = git(rt, projectRoot, ['rev-parse', '--verify', '--quiet', LEDGER_REF])
  if (!result.ok) {
    if (result.code !== REF_ABSENT_EXIT_CODE) {
      rt.log({ level: 'warn', event: 'stop-gate.ledger-ref-unreadable', code: result.code, detail: result.stderr.trim() })
    }
    return null
  }
  const trimmed = result.stdout.trim()
  return trimmed.length === 0 ? null : trimmed
}

export const readSessionBaseline = (layout: StoreLayout): SessionBaseline | null => {
  const target = baselinePathFor(layout.state)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`readSessionBaseline: failed to read ${target}: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  const sessionId = candidate.session_id
  const ledgerHead = candidate.ledger_head
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  if (ledgerHead !== null && typeof ledgerHead !== 'string') return null
  return { session_id: sessionId, ledger_head: ledgerHead }
}

export const recordSessionBaseline = (rt: Runtime, layout: StoreLayout, sessionId: string): SessionBaseline => {
  const existing = readSessionBaseline(layout)
  if (existing !== null && existing.session_id === sessionId) return existing
  const baseline: SessionBaseline = { session_id: sessionId, ledger_head: readLedgerHead(rt, layout.projectRoot) }
  createStateDirectory(layout)
  durableWrite(baselinePathFor(layout.state), JSON.stringify(baseline), { log: rt.log })
  return baseline
}
```

Rationale: `B30` needs a value to compare the ledger ref against, and a window that starts at or before `resume_thread`. This module reads the ref through the one allowlisted process-spawning module, records a per-session baseline once, and reads it back. Nothing here parses a record, so `S2` is untouched. It distinguishes the two ways reading the ref can fail, because they mean different things: `git rev-parse --verify --quiet` exits 1 when the ref simply does not exist yet, which is an ordinary answer, and exits 128 when git could not run at all, which is not. Measured on this machine: exit 1 for a missing ref in both an empty repository and one with commits, exit 128 outside a repository. The second case is logged as a warning and only the first is silent, so a broken git is distinguishable in the log from a project that has never had a ledger. On the rest of its error handling, it copies the idiom of `readGate` in the module that will read it (`src/hooklib/stop-gate.ts:14-30`): a missing file is the absent answer, a read failure that is not a missing file is rethrown with the path and the underlying message, and an unparseable or wrongly-shaped file is the absent answer — a stop-gate state file is a cache of a fact that can be recomputed next session, never a record, so a corrupt one is discarded rather than escalated. The baseline file is not a record and is not written into the ledger ref: it lives beside `stop-gate.json` under `state/`, so `P3` does not apply and no record schema changes anywhere in this unit.

---

### Step 2 — REPLACE in `src/cli/session-start.ts`

FIND (lines 55–62, the end of the file):

```ts
export type SessionStartReply = { additionalContext: string }

export const runSessionStart = (rt: Runtime, event: SessionStartEvent): SessionStartReply => {
  const crashReport = renderCrashReport(rt, event.cwd, event.session_id)
  const listing = renderThreadListing(rt, event.cwd)
  const sections = crashReport === null ? [listing] : [crashReport, listing]
  return { additionalContext: sections.join('\n\n') }
}
```

REPLACE with:

```ts
const recordBaseline = (rt: Runtime, projectRoot: string, sessionId: string): void => {
  const layout = layoutFor(rt, projectRoot)
  if (!layout.ok) return
  recordSessionBaseline(rt, layout.value, sessionId)
}

export type SessionStartReply = { additionalContext: string }

export const runSessionStart = (rt: Runtime, event: SessionStartEvent): SessionStartReply => {
  const crashReport = renderCrashReport(rt, event.cwd, event.session_id)
  const listing = renderThreadListing(rt, event.cwd)
  const sections = crashReport === null ? [listing] : [crashReport, listing]
  recordBaseline(rt, event.cwd, event.session_id)
  return { additionalContext: sections.join('\n\n') }
}
```

Rationale: `B30`'s window has to begin at or before `resume_thread`, and session start is the only moment guaranteed to do so. `resume_thread` writes the record of what is being worked but never commits to the ledger ref (`src/server/tools/resume_thread.ts:60` is `writePointer`, and the module contains no `commit(` call), so a baseline taken at session start and a baseline taken at resume differ only by acts performed before the thread was resumed — and any such act is itself a write, which the comparison reports as presence.

---

### Step 3 — REPLACE in `src/cli/session-start.ts`

FIND (lines 1–6, the imports):

```ts
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import type { Thread } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'
```

REPLACE with:

```ts
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import type { Thread } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { recordSessionBaseline } from '../hooklib/ledger-presence.ts'
import { escapeStored } from '../render/escape.ts'
```

Rationale: step 2 calls `recordSessionBaseline`.

---

### Step 4 — REPLACE `src/hooklib/stop-gate.ts`

FIND (lines 1–6, the imports):

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { collectAssistantTexts, findLastResumeBriefing } from './transcript.ts'
```

REPLACE with:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor, type StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { readPointer } from '../domain/pointer.ts'
import { readLedgerHead, readSessionBaseline } from './ledger-presence.ts'
import { collectAssistantTexts, findLastResumeBriefing } from './transcript.ts'
```

Then FIND (lines 45–69, from `verbatimReason` to the end of the file):

```ts
const verbatimReason = (owedText: string): string =>
  `Logbook: the preflight briefing owed to this turn was not printed verbatim. The server owns every heading, ` +
  `separator and ordering. Print the text below exactly as it stands, with nothing added, removed, reordered or ` +
  `reworded.\n\n${owedText}`

export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const gate = readGate(layout.value.state)
  if (gate !== null && gate.session_id === event.session_id) return { kind: 'silent' }

  const pledge = findLastResumeBriefing(event.transcript_path)
  createStateDirectory(layout.value)
  writeGate(rt, layout.value.state, event.session_id)

  if (pledge === null) return { kind: 'silent' }
  if (event.stop_hook_active) return { kind: 'silent' }

  const texts = collectAssistantTexts(event.transcript_path)
  const echoed = texts.some((text) => text.includes(pledge))
  if (echoed) return { kind: 'silent' }

  return { kind: 'block', reason: verbatimReason(pledge) }
}
```

REPLACE with:

```ts
const verbatimReason = (owedText: string): string =>
  `Logbook: the preflight briefing owed to this turn was not printed verbatim. The server owns every heading, ` +
  `separator and ordering. Print the text below exactly as it stands, with nothing added, removed, reordered or ` +
  `reworded.\n\n${owedText}`

export const LEDGER_PRESENCE_REASON =
  `Logbook: nothing has reached this project's ledger since the thread was resumed. Record what was established ` +
  `with record_decision, note progress with update_thread, or end this session's work on the thread with ` +
  `park_thread. This verdict reports only that something reached the ledger; it makes no claim that what is ` +
  `recorded is complete.`

const verbatimEchoVerdict = (rt: Runtime, event: StopEvent, layout: StoreLayout): StopVerdict => {
  const gate = readGate(layout.state)
  if (gate !== null && gate.session_id === event.session_id) return { kind: 'silent' }

  const pledge = findLastResumeBriefing(event.transcript_path)
  createStateDirectory(layout)
  writeGate(rt, layout.state, event.session_id)

  if (pledge === null) return { kind: 'silent' }
  if (event.stop_hook_active) return { kind: 'silent' }

  const texts = collectAssistantTexts(event.transcript_path)
  const echoed = texts.some((text) => text.includes(pledge))
  if (echoed) return { kind: 'silent' }

  return { kind: 'block', reason: verbatimReason(pledge) }
}

const ledgerPresenceVerdict = (rt: Runtime, event: StopEvent, layout: StoreLayout): StopVerdict => {
  if (event.stop_hook_active) return { kind: 'silent' }

  const pointerRead = readPointer(rt, layout)
  if (pointerRead.kind !== 'pointer') return { kind: 'silent' }
  if (pointerRead.value.session_id !== event.session_id) return { kind: 'silent' }

  const baseline = readSessionBaseline(layout)
  if (baseline === null) return { kind: 'silent' }
  if (baseline.session_id !== event.session_id) return { kind: 'silent' }
  if (baseline.ledger_head === null) return { kind: 'silent' }

  const head = readLedgerHead(rt, layout.projectRoot)
  if (head !== baseline.ledger_head) return { kind: 'silent' }

  return { kind: 'block', reason: LEDGER_PRESENCE_REASON }
}

export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const verbatim = verbatimEchoVerdict(rt, event, layout.value)
  if (verbatim.kind === 'block') return verbatim

  return ledgerPresenceVerdict(rt, event, layout.value)
}
```

Rationale: `B30`. The existing verdict is moved verbatim into `verbatimEchoVerdict` with its early returns and its side effects in the same order, so its behaviour is unchanged; the second verdict runs after it and only when it is silent. Five guards keep the second verdict quiet where it has nothing to say: the Stop hook is already active (blocking there would not terminate); no thread is being worked; the thread being worked belongs to another session; this session recorded no baseline; and the project had no ledger ref when this session began, which leaves no window to compare against. `hooks/stop.ts` needs no edit — it already forwards `stop_hook_active` and returns `{ block: true, reason }` for any blocking verdict.

---

### Step 5 — REPLACE in `src/cli/session-start.ts`

FIND (the imports, as they stand after step 3):

```ts
import { readPointer } from '../domain/pointer.ts'
import { recordSessionBaseline } from '../hooklib/ledger-presence.ts'
import { escapeStored } from '../render/escape.ts'

export type SessionStartEvent = { session_id: string; source: string; cwd: string }

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0
```

REPLACE with:

```ts
import { readPointer } from '../domain/pointer.ts'
import { recordSessionBaseline } from '../hooklib/ledger-presence.ts'
import { escapeStored } from '../render/escape.ts'
import { clipWithMarker } from '../render/clip.ts'

export type SessionStartEvent = { session_id: string; source: string; cwd: string }

export const BANNER_MAX_GRAPHEMES = 10000

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0
```

Rationale: `B32`. `BANNER_MAX_GRAPHEMES` is declared here at the same number the hook transport uses (`hooks/lib/io.ts:7`), rather than imported from it, because `src/` must not depend on `hooks/`; declaring it here makes the banner clip itself first, so the transport's own truncation is a no-op and never removes the marker.

---

### Step 6 — REPLACE in `src/cli/session-start.ts`

FIND (the last line of `runSessionStart`, as it stands after step 2):

```ts
  return { additionalContext: sections.join('\n\n') }
```

REPLACE with:

```ts
  return { additionalContext: clipWithMarker(sections.join('\n\n'), BANNER_MAX_GRAPHEMES) }
```

Rationale: `B32` and invariant `O3`. `clipWithMarker` returns the text unchanged when it fits, and otherwise returns at most `BANNER_MAX_GRAPHEMES` graphemes ending in the shared marker — the marker's room is reserved inside the limit, not added on top of it.

---

### Step 7 — REPLACE `hooks/post-tool-use.ts`

FIND (lines 1–20, the whole file):

```ts
#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { isCommitShapedCommand, noteProjectCommit } from '../src/hooklib/commit-note.ts'

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

await runHook('post-tool-use', (event) => {
  if (typeof event !== 'object' || event === null) return { block: false, json: {} }
  const record = event as Record<string, unknown>
  const toolInput = typeof record.tool_input === 'object' && record.tool_input !== null ? record.tool_input : null
  const command = toolInput === null ? undefined : (toolInput as Record<string, unknown>).command

  if (!isCommitShapedCommand(record.tool_name, command)) return { block: false, json: {} }
  if (!isNonEmptyString(record.cwd) || !isNonEmptyString(record.session_id)) return { block: false, json: {} }

  const rt = productionRuntime()
  noteProjectCommit(rt, record.cwd, record.session_id)
  return { block: false, json: {} }
})
```

REPLACE with:

```ts
#!/usr/bin/env node
import { runHook } from './lib/io.ts'

await runHook('post-tool-use', () => ({ block: false, json: {} }))
```

Rationale: `B33`. The file stays, and stays registered, because `scripts/check-packaging.mjs:11` lists `hooks/post-tool-use.ts` among the required files and `:47` requires a `PostToolUse` event binding, and because the inherited census `hook.compaction-nudge-absent.post-tool-use-emits-no-additional-context` runs this hook as a process and asserts it emits `{}`. Only the write is deleted.

---

### Step 8 — DELETE `src/hooklib/commit-note.ts`

Delete the file. Its full current contents are in section 2.5.

Rationale: `B33`, and SPEC goal `DG5` ("No field ships without a stated reason to exist and a named reader"). After step 7 the module has no caller anywhere in `src`, `hooks`, `bin`, `scripts` or `test`.

---

### Step 9 — REPLACE `src/server/instructions.ts`

FIND:

```ts
Omit outcome and park_thread only releases the record of what is being worked.

Identifiers are ULIDs: 26 characters, Crockford base32, for example
```

REPLACE with:

```ts
Omit outcome and park_thread only releases the record of what is being worked.

Any agent holding a thread id records against it, a subagent included, and recording at the
subagent boundary is preferred to carrying the material back. The split is by content: a
subagent records what it established, and a selection between live options is recorded by
whoever selected.

Identifiers are ULIDs: 26 characters, Crockford base32, for example
```

Rationale: `B31`, and SPEC goal `LG2` ("Any agent holding a thread id can record"). The paragraph takes the published instructions from 1,364 bytes to 1,654, against the 2,048-byte ceiling the shipped budget test enforces.

---

### Step 10 — REPLACE `skills/debrief/SKILL.md`

FIND (lines 6–13, the sequence):

```markdown
## Sequence

1. Gather what happened in this session as one plain summary.
2. Call `park_thread` with `park_thread.outcome` set to that summary.
3. Print the returned `park_thread.status`.
4. Print the refusal text `park_thread` returns in place of a status.
5. Print the summary from step 1 alongside that refusal text, so the record of this session survives a refused call.
6. Stop.
```

REPLACE with:

```markdown
## Sequence

1. Gather what happened in this session as one plain summary.
2. Gather the next step a later session picks up, as one plain sentence.
3. Call `park_thread` with `park_thread.outcome` set to that summary and `park_thread.next_step` set to that sentence.
4. Print the returned `park_thread.status` and the returned `park_thread.spine_fields_updated`.
5. Print the refusal text `park_thread` returns in place of a status.
6. Print the summary from step 1 and the sentence from step 2 alongside that refusal text, so the record of this session survives a refused call.
7. Stop.
```

Rationale: `B34` and defect `D10`. Every added line starts with one of the six verbs the shipped skills census admits (`Gather`, `Call`, `Print`, and `Stop` at the end) and carries none of the rule-marker words that census forbids. `park_thread.next_step` and `park_thread.spine_fields_updated` are both real published properties of that tool (`src/server/tools/park_thread.ts:38-42` and `:62-64`), which the shipped census `contract.skill-references-exist` checks against the live server. `last_session` is deliberately not passed: `B34` says the sequence stops passing it.

---

### Step 11 — Version bump, read-then-increment

1. Read the current version:

```
node -p "require('./package.json').version"
```

Expect exit 0 and one line of the form `X.Y.Z`.

2. This pull request's Conventional Commits type is `feat`, so increment the MINOR component and set PATCH to 0. For a value of `X.Y.Z`, the next value is `X.(Y+1).0`.

3. Write the same value into both files, substituting `<current>` and `<next>` with the two values from steps 1 and 2:

```
node -e "const fs=require('fs');for(const p of ['package.json','.claude-plugin/plugin.json'])fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('\"version\": \"<current>\"','\"version\": \"<next>\"'))"
```

Expect exit 0 and no output. Then re-run the command from point 1 and expect it to print `<next>`.

4. Confirm both files agree and the packaging contract holds:

```
node scripts/check-packaging.mjs
```

Expect exit 0 and the output line `check-packaging: ok`.

Rationale: `P4` and orchestrator ruling `OR6`. `scripts/check-packaging.mjs:139-149` reads both versions, requires each to be a plain semver, and reports a mismatch between them.

---

### Step 12 — Version bump for the second and third pull requests

Identical to step 11, run once per pull request, each on its own branch after rebasing onto `main`. Section 12 states the type for each.

## 5. Tests

### 5.1 `test/hooks/stop-gate-ledger-presence.test.ts` — CREATE

Discharges acceptance criteria 2, 3, 4 and 5. Create the file with exactly these contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { openStore } from '../../src/store/records.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { runSessionStart } from '../../src/cli/session-start.ts'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SESSION_ID = 'stop-gate-ledger-presence-session'
const OTHER_SESSION_ID = 'stop-gate-ledger-presence-other-session'

const BANNED_LITERALS = [
  'NUDGE_TEXT',
  'computeNudgeThreshold',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES',
  ['approaching the ', 'compaction threshold'].join('')
]

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-presence-plugin-data-'))
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
    title: 'a stop gate presence thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

type Fixture = { rt: Runtime; repo: string; layout: StoreLayout }

const withFixture = (fn: (fixture: Fixture) => void): void => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      fn({ rt, repo, layout: layout.value })
    })
  })
}

const commitOneThread = (rt: Runtime, repo: string, slug: string): string => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeThread(rt, slug)
  const committed = opened.value.commit([change], `seed ${slug}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
  return change.record.id
}

const startSession = (rt: Runtime, repo: string, sessionId: string): void => {
  runSessionStart(rt, { session_id: sessionId, source: 'startup', cwd: repo })
}

const stopEventFor = (repo: string, sessionId: string, stopHookActive: boolean) => ({
  session_id: sessionId,
  cwd: repo,
  transcript_path: join(repo, 'no-such-transcript.jsonl'),
  stop_hook_active: stopHookActive
})

test('hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'block', 'the stop gate must block when the ledger ref has not moved since resume')
  })
})

test('hook.stop-gate-clears-the-moment-something-reaches-the-ledger', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')

    commitOneThread(rt, repo, 'stop-gate-presence-recorded')

    const cleared = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(cleared.kind, 'silent', 'the stop gate must clear once something has reached the ledger ref')
  })
})

test('hook.stop-gate-re-evaluates-rather-than-latching', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')
    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'block',
      'the verdict is evaluated at every turn end, never latched to fire once per session'
    )

    commitOneThread(rt, repo, 'stop-gate-presence-recorded')
    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'silent')
  })
})

test('hook.stop-gate-is-silent-when-the-stop-hook-is-already-active', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, true))
    assert.equal(verdict.kind, 'silent', 'blocking while the stop hook is already active would not terminate')
  })
})

test('hook.stop-gate-is-silent-when-no-thread-is-being-worked-by-this-session', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'silent',
      'no thread is being worked, so there is nothing to record against'
    )

    writePointer(rt, layout, {
      thread_id: threadId,
      written_at: '2024-01-01T00:00:00.000Z',
      session_id: OTHER_SESSION_ID
    })
    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'silent',
      'a pointer held by another session is not this session work'
    )
  })
})

test('hook.stop-gate-is-silent-when-this-session-recorded-no-baseline', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, OTHER_SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'silent', 'without a baseline for this session there is no window to compare against')
  })
})

test('hook.stop-gate-is-silent-when-the-project-had-no-ledger-ref-at-session-start', () => {
  withFixture(({ rt, repo, layout }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'silent', 'a session that began before the ledger ref existed has no window to compare against')
  })
})

test('hook.stop-gate-ledger-message-claims-presence-and-never-completeness', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'block')
    if (verdict.kind !== 'block') return

    assert.ok(
      verdict.reason.includes('makes no claim that what is recorded is complete'),
      `the blocking message must disclaim completeness, got: ${verdict.reason}`
    )
    for (const literal of BANNED_LITERALS) {
      assert.equal(
        verdict.reason.includes(literal),
        false,
        `the blocking message carries the retired compaction-nudge literal ${JSON.stringify(literal)}`
      )
    }
  })
})
```

### 5.2 `test/unit/session-start.test.ts` — MODIFY

Discharges acceptance criterion 7 in its "reserves room" half.

FIND (line 9):

```ts
import { renderThreadListing } from '../../src/cli/session-start.ts'
```

REPLACE with:

```ts
import * as caps from '../../src/schema/caps.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { BANNER_MAX_GRAPHEMES, renderThreadListing, runSessionStart } from '../../src/cli/session-start.ts'
```

Then append the following to the end of the file, after the closing `})` of `session-start.roster-line-still-carries-slug-title-next-step-and-id`:

```ts

const LONG_THREAD_COUNT = 16
const LONG_TITLE = 'a'.repeat(caps.THREAD_TITLE_MAX)
const LONG_NEXT_STEP = 'b'.repeat(caps.SPINE_NEXT_STEP_MAX)

const makeLongThread = (rt: Runtime, index: number): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug: `session-start-long-${index}`,
    title: LONG_TITLE,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: LONG_NEXT_STEP,
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const graphemeCount = (text: string): number => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text)).length
}

test('session-start.banner-marks-its-clip-and-reserves-room-for-the-marker', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const changes = Array.from({ length: LONG_THREAD_COUNT }, (_value, index) => makeLongThread(rt, index))
      const committed = opened.value.commit(changes, 'seed threads whose listing overflows the banner limit')
      assert.equal(committed.ok, true)

      const listing = renderThreadListing(rt, repo)
      assert.ok(
        graphemeCount(listing) > BANNER_MAX_GRAPHEMES,
        `the fixture must overflow the banner limit; listing was ${graphemeCount(listing)} graphemes`
      )

      const reply = runSessionStart(rt, { session_id: 'session-start-clip-session', source: 'startup', cwd: repo })
      assert.ok(
        reply.additionalContext.endsWith(CLIP_MARKER),
        'a clipped banner must carry the shared clip marker at its end'
      )
      assert.equal(
        graphemeCount(reply.additionalContext) <= BANNER_MAX_GRAPHEMES,
        true,
        `the marker must fit inside the banner limit; got ${graphemeCount(reply.additionalContext)} graphemes`
      )
    })
  })
})

test('session-start.leaves-the-banner-unmarked-when-it-fits', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const reply = runSessionStart(rt, { session_id: 'session-start-fits-session', source: 'startup', cwd: repo })
      assert.equal(
        reply.additionalContext.includes(CLIP_MARKER),
        false,
        'a banner that fits its limit must carry no clip marker'
      )
    })
  })
})
```

### 5.3 `test/hooks/post-tool-use-writes-nothing.test.ts` — CREATE

Discharges acceptance criteria 8 and 9. Create the file with exactly these contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { openStore } from '../../src/store/records.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { TREE_ROOT, controlledEnv, readFixture, runHookProcess } from './hook-process.ts'

const SESSION_ID = 'post-tool-use-writes-nothing-session'
const COMMIT_SHAPED_COMMAND = 'git commit -m "a project commit made during this session"'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-post-tool-use-plugin-data-'))
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
    title: 'a post tool use thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('hook.post-tool-use-writes-nothing-for-a-commit-shaped-command', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const env = { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }
      const rt = testRuntime({ env, cwd: repo })

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const seeded = makeThread(rt, 'post-tool-use-writes-nothing')
      const committed = opened.value.commit([seeded], 'seed one open thread')
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      writePointer(rt, layout.value, {
        thread_id: seeded.record.id,
        written_at: '2024-01-01T00:00:00.000Z',
        session_id: SESSION_ID
      })

      const ledgerHead = (): string => rawGit(repo, ['rev-parse', 'refs/logbook/ledger']).stdout.trim()
      const before = ledgerHead()
      assert.notEqual(before, '', 'the fixture must leave the ledger ref pointing at a commit')

      const fixture = readFixture('post-tool-use.json') as object
      const event = {
        ...fixture,
        session_id: SESSION_ID,
        cwd: repo,
        tool_name: 'Bash',
        tool_input: { command: COMMIT_SHAPED_COMMAND }
      }
      const result = runHookProcess('post-tool-use', JSON.stringify(event), {
        env: controlledEnv({ HOME: process.env.HOME ?? '', CLAUDE_PLUGIN_DATA: pluginData })
      })

      assert.equal(result.status, 0, `post-tool-use exited nonzero: ${result.stderr}`)
      assert.deepEqual(JSON.parse(result.stdout), {}, 'the PostToolUse hook must emit an empty object')
      assert.equal(
        ledgerHead(),
        before,
        'the PostToolUse hook must no longer write a commit note into the ledger'
      )
    })
  })
})

test('hook.post-tool-use-carries-no-commit-note-module', () => {
  assert.equal(
    existsSync(join(TREE_ROOT, 'src', 'hooklib', 'commit-note.ts')),
    false,
    'the commit-note module must be deleted with the write it existed to perform'
  )
})
```

### 5.4 `test/contract/debrief-spine-update.test.ts` — CREATE

Discharges acceptance criterion 10. The documented field list is derived from the skill file itself, never pinned, so the test cannot drift from the sequence it certifies. Create the file with exactly these contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const DEBRIEF_SKILL_PATH = join(PROJECT_ROOT, 'skills', 'debrief', 'SKILL.md')

const PARK_TOOL_NAME = 'park_thread'
const SEQUENCE_HEADING_PATTERN = /## Sequence\r?\n\r?\n([\s\S]*)$/
const STEP_LINE_PATTERN = /^\d+\.\s+(.+)$/
const CODE_SPAN_PATTERN = /`([^`]+)`/g
const QUALIFIED_PATTERN = /^([a-z_]+)\.([a-z_]+)$/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const debriefSteps = (): string[] => {
  const content = readFileSync(DEBRIEF_SKILL_PATH, 'utf8')
  const sequenceMatch = SEQUENCE_HEADING_PATTERN.exec(content)
  if (sequenceMatch === null) {
    throw new Error(`debrief-spine-update: ${DEBRIEF_SKILL_PATH} has no parseable "## Sequence" block`)
  }
  return (sequenceMatch[1] as string)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const stepMatch = STEP_LINE_PATTERN.exec(line)
      if (stepMatch === null) {
        throw new Error(`debrief-spine-update: sequence line "${line}" is not a numbered step`)
      }
      return stepMatch[1] as string
    })
}

const spansIn = (step: string): string[] => Array.from(step.matchAll(CODE_SPAN_PATTERN)).map((match) => match[1] as string)

const documentedParkFields = (): string[] => {
  const parkSteps = debriefSteps().filter(
    (step) => step.startsWith('Call ') && spansIn(step).includes(PARK_TOOL_NAME)
  )
  assert.ok(parkSteps.length > 0, `debrief-spine-update: the debrief sequence has no Call step naming \`${PARK_TOOL_NAME}\``)
  const fields = parkSteps.flatMap((step) =>
    spansIn(step).flatMap((span) => {
      const qualified = QUALIFIED_PATTERN.exec(span)
      if (qualified === null) return []
      return (qualified[1] as string) === PARK_TOOL_NAME ? [qualified[2] as string] : []
    })
  )
  return Array.from(new Set(fields)).sort()
}

const parkInputPropertyNames = async (spawned: SpawnedServer): Promise<Set<string>> => {
  const listed = await spawned.client.listTools()
  const park = listed.tools.find((tool) => tool.name === PARK_TOOL_NAME)
  assert.notEqual(park, undefined, `debrief-spine-update: the live server publishes no ${PARK_TOOL_NAME} tool`)
  const schema = park?.inputSchema as unknown
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
    throw new Error(`debrief-spine-update: ${PARK_TOOL_NAME} publishes no input properties`)
  }
  return new Set(Object.keys(schema.properties))
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`debrief-spine-update fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-debrief-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Debrief Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'debrief@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook debrief fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const callOk = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
  const result = (await spawned.client.callTool({ name, arguments: args })) as CallToolResult
  assert.notEqual(result.isError, true, `debrief-spine-update: calling "${name}" failed: ${JSON.stringify(result.content)}`)
  return result
}

test('debrief.documents-next-step-and-not-last-session', () => {
  const fields = documentedParkFields()
  assert.ok(
    fields.includes('next_step'),
    `the debrief sequence must pass next_step to ${PARK_TOOL_NAME}; documented fields were [${fields.join(', ')}]`
  )
  assert.equal(
    fields.includes('last_session'),
    false,
    `the debrief sequence must stop passing last_session to ${PARK_TOOL_NAME}; documented fields were [${fields.join(', ')}]`
  )
})

test('debrief.returns-a-non-empty-spine-update', async () => {
  let repo = ''
  let pluginData = ''
  let spawned: SpawnedServer | undefined
  try {
    repo = bootstrapRepo()
    pluginData = mkdtempSync(join(tmpdir(), 'logbook-debrief-plugin-data-'))
    spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })

    const inputNames = await parkInputPropertyNames(spawned)
    const documented = documentedParkFields().filter((field) => inputNames.has(field))
    assert.ok(documented.length > 0, 'the debrief sequence documents no park_thread input field at all')

    const opened = await callOk(spawned, 'open_thread', {
      title: 'debrief spine update fixture thread',
      slug: 'debrief-spine-update-fixture',
      completion_criteria: ['prove the documented debrief sequence refreshes the running summary']
    })
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    await callOk(spawned, 'resume_thread', { thread_id: threadId })

    const parked = await callOk(
      spawned,
      PARK_TOOL_NAME,
      Object.fromEntries(documented.map((field) => [field, `debrief fixture value for ${field}`]))
    )
    const spineFieldsUpdated = (parked.structuredContent as { spine_fields_updated: string[] }).spine_fields_updated
    assert.ok(
      spineFieldsUpdated.length > 0,
      `driving the documented debrief sequence returned an empty spine update; fields sent were [${documented.join(', ')}]`
    )
  } finally {
    if (spawned !== undefined) await spawned.close()
    if (repo !== '') rmSync(repo, { recursive: true, force: true })
    if (pluginData !== '') rmSync(pluginData, { recursive: true, force: true })
  }
})
```

### 5.5 `test/contract/subagent-recording-guidance.test.ts` — CREATE

Discharges acceptance criterion 6. Create the file with exactly these contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawnServer } from '../support/spawn-client.ts'
import { BUDGET_BYTES } from '../support/published.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const REQUIRED_PHRASES = [
  'Any agent holding a thread id records against it, a subagent included',
  'subagent boundary is preferred to carrying the material back',
  'subagent records what it established, and a selection between live options is recorded by',
  'whoever selected.'
]

test('contract.published-instructions-carry-the-subagent-recording-guidance', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const instructions = spawned.instructions()
    assert.notEqual(instructions, undefined, 'the server published no instructions at all')
    const text = instructions as string
    for (const phrase of REQUIRED_PHRASES) {
      assert.ok(
        text.includes(phrase),
        `the published server instructions do not carry the phrase ${JSON.stringify(phrase)}`
      )
    }
    assert.ok(
      Buffer.byteLength(text, 'utf8') < BUDGET_BYTES,
      `the published instructions must stay under ${BUDGET_BYTES} bytes, got ${Buffer.byteLength(text, 'utf8')}`
    )
  } finally {
    await spawned.close()
  }
})
```

### 5.6 `test/spawn/forgery.test.ts` — MODIFY

Discharges acceptance criterion 7 in its "emits a marker" half, and is the red-on-parent receipt for `B32`.

FIND (line 16):

```ts
import { escapeStored } from '../../src/render/escape.ts'
```

REPLACE with:

```ts
import { escapeStored } from '../../src/render/escape.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
```

Then FIND (lines 795–798):

```ts
    assert.ok(
      unclipped.startsWith(emitted),
      'the emitted session-start context is not a prefix of the listing it was clipped from'
    )
```

REPLACE with:

```ts
    assert.ok(
      emitted.endsWith(CLIP_MARKER),
      'the emitted session-start context was clipped and carries no clip marker'
    )
    assert.ok(
      unclipped.startsWith(emitted.slice(0, -CLIP_MARKER.length)),
      'the emitted session-start context, with its clip marker removed, is not a prefix of the listing it was clipped from'
    )
```

This is a strengthening, not a weakening: the original prefix property is retained in full on the retained text, and a second property is added beside it. No test is deleted, skipped or focused anywhere in this unit.

### 5.7 Which test discharges which criterion and which invariant

| Acceptance criterion | Test |
|---|---|
| 1 — `B29` verified, unchanged | none; discharged by section 2.10, which names both shipped instances. The shipped tests `close_thread.rejects-invalid` (`test/spawn/lifecycle.test.ts:321`) and `amend_criteria.rejects-invalid` (`test/spawn/lifecycle.test.ts:367`) already cover them, and SPEC section 6.1 rule 5 deletes an invariant that duplicates a shipped test |
| 2 — the second verdict blocks | `hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume` |
| 3 — it clears, and it is not latched | `hook.stop-gate-clears-the-moment-something-reaches-the-ledger`, `hook.stop-gate-re-evaluates-rather-than-latching` |
| 4 — presence, never completeness | `hook.stop-gate-ledger-message-claims-presence-and-never-completeness` |
| 5 — no banned literal; both censuses pass unedited | `hook.stop-gate-ledger-message-claims-presence-and-never-completeness`, plus the two inherited tests `hook.compaction-nudge-absent` and `hook.precompact-absent` run unmodified |
| 6 — the recording guidance is published | `contract.published-instructions-carry-the-subagent-recording-guidance` |
| 7 — the banner marks its clip and reserves room | `render.clip-is-grapheme-safe` (modified), `session-start.banner-marks-its-clip-and-reserves-room-for-the-marker`, `session-start.leaves-the-banner-unmarked-when-it-fits` |
| 8 — the commit-note write is gone | `hook.post-tool-use-writes-nothing-for-a-commit-shaped-command`, `hook.post-tool-use-carries-no-commit-note-module` |
| 9 — the hook still exists and emits `{}` | `hook.compaction-nudge-absent.post-tool-use-emits-no-additional-context` (inherited, unmodified), `hook.post-tool-use-writes-nothing-for-a-commit-shaped-command` |
| 10 — `debrief` passes `next_step`, returns a non-empty spine update | `debrief.documents-next-step-and-not-last-session`, `debrief.returns-a-non-empty-spine-update` |

| SPEC invariant assigned to this unit | Test |
|---|---|
| `O3` — every surface that shortens text carries a marker, and reserves room for it within its own limit | `render.clip-is-grapheme-safe` (the marker), `session-start.banner-marks-its-clip-and-reserves-room-for-the-marker` (the reserved room), `session-start.leaves-the-banner-unmarked-when-it-fits` (no marker when nothing was shortened). The other half of `O3` — the briefing surfaces — belongs to `U5` |

## 6. Red on the parent

"The parent" means the tip of `main` at the moment the unit branch is cut. At authoring time `main` carried none of this ladder; a wave-2 unit's parent contains `U0`, all parts of `U1`, `U2`, `U3`, `U4`, `U5` and `U6`.

Every command below is run from the repository root on the parent commit, with the test files of section 5 applied and no production change applied.

### 6.1 The `B30` receipt

```
node --test --experimental-strip-types test/hooks/stop-gate-ledger-presence.test.ts
```

Expect a non-zero exit and these four failures, measured by running exactly this against a pristine copy of `main` in the session scratchpad:

```
✖ hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume
  AssertionError [ERR_ASSERTION]: the stop gate must block when the ledger ref has not moved since resume
✖ hook.stop-gate-clears-the-moment-something-reaches-the-ledger
✖ hook.stop-gate-re-evaluates-rather-than-latching
✖ hook.stop-gate-ledger-message-claims-presence-and-never-completeness
```

The other four tests in that file pass at the parent. They are guards on states in which the verdict must stay quiet, not receipts, and a guard that already holds is expected to be green.

### 6.2 The `B32` receipt

```
node --test --experimental-strip-types test/spawn/forgery.test.ts
```

Expect a non-zero exit and:

```
✖ render.clip-is-grapheme-safe
  AssertionError [ERR_ASSERTION]: the emitted session-start context was clipped and carries no clip marker
```

`test/unit/session-start.test.ts` cannot be run red at the parent, because its new tests import `BANNER_MAX_GRAPHEMES`, which the parent does not export. Running `node --test --experimental-strip-types test/unit/session-start.test.ts` at the parent produces a load failure, measured verbatim:

```
SyntaxError: The requested module '../../src/cli/session-start.ts' does not provide an export named 'BANNER_MAX_GRAPHEMES'
```

That is an import error, not an assertion failure, so it is not a genuine red and is not counted as one. **The substitute is `render.clip-is-grapheme-safe` above**, which asserts the same mandated behaviour through the published hook surface, imports nothing this unit adds, and is genuinely red at the parent. The load failure is not counted as a red.

### 6.3 The `B33` receipt

```
node --test --experimental-strip-types test/hooks/post-tool-use-writes-nothing.test.ts
```

Expect a non-zero exit and:

```
✖ hook.post-tool-use-writes-nothing-for-a-commit-shaped-command
  AssertionError [ERR_ASSERTION]: the PostToolUse hook must no longer write a commit note into the ledger
✖ hook.post-tool-use-carries-no-commit-note-module
  AssertionError [ERR_ASSERTION]: the commit-note module must be deleted with the write it existed to perform
```

### 6.4 The `B34` receipt

```
node --test --experimental-strip-types test/contract/debrief-spine-update.test.ts
```

Expect a non-zero exit and:

```
✖ debrief.documents-next-step-and-not-last-session
  AssertionError [ERR_ASSERTION]: the debrief sequence must pass next_step to park_thread; documented fields were [outcome]
✖ debrief.returns-a-non-empty-spine-update
  AssertionError [ERR_ASSERTION]: driving the documented debrief sequence returned an empty spine update; fields sent were [outcome]
```

### 6.5 The `B31` receipt

```
node --test --experimental-strip-types test/contract/subagent-recording-guidance.test.ts
```

Expect a non-zero exit and:

```
✖ contract.published-instructions-carry-the-subagent-recording-guidance
  AssertionError [ERR_ASSERTION]: the published server instructions do not carry the phrase "Any agent holding a thread id records against it, a subagent included"
```

### 6.6 `B29` has no red on the parent, and this is stated rather than manufactured

`B29` mandates no change. Its two instances already ship and are already covered by shipped tests (section 5.7). There is nothing to make red, and no proxy assertion is substituted for one. Honesty-ladder status for `B29`: **`fixed`** — the mandated state is present and was read at `src/domain/criteria.ts:28-44` and `src/server/tools/close_thread.ts:18-23`.

## 7. Inertness mutation

Each mutation below was applied to a throwaway copy of the tree in the session scratchpad and the stated failure was observed.

### 7.1 `B30` — remove the second verdict from the composed verdict

Edit `src/hooklib/stop-gate.ts`. Change:

```ts
  return ledgerPresenceVerdict(rt, event, layout.value)
```

to:

```ts
  return { kind: 'silent' }
```

Run:

```
node --test --experimental-strip-types test/hooks/stop-gate-ledger-presence.test.ts
```

Expect a non-zero exit and, first among the failures:

```
✖ hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume
  AssertionError [ERR_ASSERTION]: the stop gate must block when the ledger ref has not moved since resume
```

Restore by changing that line back to `return ledgerPresenceVerdict(rt, event, layout.value)` and re-running the command; expect exit 0 and eight passing tests.

### 7.2 `B32` — clip without the marker

Edit `src/cli/session-start.ts`. Change the import line:

```ts
import { escapeStored } from '../render/escape.ts'
```

to:

```ts
import { clipGraphemes, escapeStored } from '../render/escape.ts'
```

and change:

```ts
  return { additionalContext: clipWithMarker(sections.join('\n\n'), BANNER_MAX_GRAPHEMES) }
```

to:

```ts
  return { additionalContext: clipGraphemes(sections.join('\n\n'), BANNER_MAX_GRAPHEMES) }
```

This keeps the clipping and removes only the marker, so it isolates exactly what `B32` adds. Run:

```
node --test --experimental-strip-types test/unit/session-start.test.ts test/spawn/forgery.test.ts
```

Expect a non-zero exit and:

```
✖ render.clip-is-grapheme-safe
  AssertionError [ERR_ASSERTION]: the emitted session-start context was clipped and carries no clip marker
✖ session-start.banner-marks-its-clip-and-reserves-room-for-the-marker
  AssertionError [ERR_ASSERTION]: a clipped banner must carry the shared clip marker at its end
```

Restore by reverting both edits and re-running; expect exit 0.

### 7.3 `B33` — restore the commit-note write

Restore `src/hooklib/commit-note.ts` with the contents given in section 2.5, and restore `hooks/post-tool-use.ts` with the contents given in section 2.4. Run:

```
node --test --experimental-strip-types test/hooks/post-tool-use-writes-nothing.test.ts
```

Expect a non-zero exit and:

```
✖ hook.post-tool-use-writes-nothing-for-a-commit-shaped-command
  AssertionError [ERR_ASSERTION]: the PostToolUse hook must no longer write a commit note into the ledger
✖ hook.post-tool-use-carries-no-commit-note-module
  AssertionError [ERR_ASSERTION]: the commit-note module must be deleted with the write it existed to perform
```

Restore by re-applying steps 7 and 8 and re-running; expect exit 0.

### 7.4 `B34` — drop `next_step` from the documented call

Edit `skills/debrief/SKILL.md`. Change step 3 to:

```markdown
3. Call `park_thread` with `park_thread.outcome` set to that summary.
```

Run:

```
node --test --experimental-strip-types test/contract/debrief-spine-update.test.ts
```

Expect a non-zero exit and:

```
✖ debrief.documents-next-step-and-not-last-session
  AssertionError [ERR_ASSERTION]: the debrief sequence must pass next_step to park_thread; documented fields were [outcome]
✖ debrief.returns-a-non-empty-spine-update
  AssertionError [ERR_ASSERTION]: driving the documented debrief sequence returned an empty spine update; fields sent were [outcome]
```

Restore by re-applying step 10 and re-running; expect exit 0.

### 7.5 `B31` — remove the published paragraph

Edit `src/server/instructions.ts` and delete the four-line paragraph beginning `Any agent holding a thread id records against it` together with the blank line after it. Run:

```
node --test --experimental-strip-types test/contract/subagent-recording-guidance.test.ts
```

Expect a non-zero exit and:

```
✖ contract.published-instructions-carry-the-subagent-recording-guidance
  AssertionError [ERR_ASSERTION]: the published server instructions do not carry the phrase "Any agent holding a thread id records against it, a subagent included"
```

Restore by re-applying step 9 and re-running; expect exit 0.

### 7.6 `B29` — no mutation

`B29` carries no behavioural change in this unit, so `P11` requires no mutation for it. Its state is asserted by the shipped tests named in section 5.7.

## 8. Full verification

Run all four, from the repository root, on each of the three branches before its pull request is opened.

1. Typecheck:

```
npm run typecheck
```

Expect exit 0 and no output.

2. Packaging:

```
node scripts/check-packaging.mjs
```

Expect exit 0 and the output line `check-packaging: ok`.

3. The two inherited census tests, run with no edit to either file:

```
node --test --experimental-strip-types test/hooks/compaction-nudge-absent.test.ts test/hooks/precompact-absent.test.ts
```

Expect exit 0 and the lines `✔ hook.compaction-nudge-absent`, `✔ hook.compaction-nudge-absent.post-tool-use-emits-no-additional-context` and `✔ hook.precompact-absent`.

4. The full suite:

```
npm test
```

Expect exit 0 and the summary lines `ℹ fail 0` and `ℹ pass` reporting the whole suite. Then apply the standing rule below.

> Run: npm test
> If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
> that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
> If it passes on the re-run, proceed, and record in the pull request body a
> `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
> If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
> and do not edit, skip, focus or delete any test.

## 9. Commits

Refactor and behaviour change never share a commit. There are no refactor-only commits in this unit: the move of the existing verdict body into `verbatimEchoVerdict` (step 4) is inside the same edit that adds the second verdict, because splitting the two would leave a commit whose only content is a rename with no observable effect and no test that could fail on it. The behaviour of the moved code is unchanged and is pinned by the shipped tests `hook.stop-gate-leaves-no-half-built-store`, `hook.stop-survives-a-fresh-data-directory` and `handoff.fires-once`, all of which run against it before and after.

### Pull request A — commit A1

```
feat(hooks): block a turn end that recorded nothing to the ledger
```

Files: `src/hooklib/ledger-presence.ts`, `src/hooklib/stop-gate.ts`, `src/cli/session-start.ts`, `test/hooks/stop-gate-ledger-presence.test.ts`.
Contains plan steps 1, 2, 3, 4 and test 5.1.

### Pull request A — commit A2

```
chore(hooks): bump the plugin version for the capture-presence change
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Contains plan step 11.

### Pull request B — commit B1

```
feat(hooks): mark the session-start banner when it is clipped
```

Files: `src/cli/session-start.ts`, `test/unit/session-start.test.ts`, `test/spawn/forgery.test.ts`.
Contains plan steps 5, 6 and tests 5.2 and 5.6.

### Pull request B — commit B2

```
chore(hooks): bump the plugin version for the banner clip marker
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Contains plan step 12 for pull request B.

### Pull request C — commit C1

```
feat(hooks): delete the post-tool-use commit note nothing read back
```

Files: `hooks/post-tool-use.ts`, `src/hooklib/commit-note.ts` (deleted), `test/hooks/post-tool-use-writes-nothing.test.ts`.
Contains plan steps 7, 8 and test 5.3.

### Pull request C — commit C2

```
feat(hooks): publish who records at a subagent boundary
```

Files: `src/server/instructions.ts`, `test/contract/subagent-recording-guidance.test.ts`.
Contains plan step 9 and test 5.5.

### Pull request C — commit C3

```
feat(hooks): pass the next step through the debrief sequence
```

Files: `skills/debrief/SKILL.md`, `test/contract/debrief-spine-update.test.ts`.
Contains plan step 10 and test 5.4.

### Pull request C — commit C4

```
chore(hooks): bump the plugin version for the recording-guidance change
```

Files: `package.json`, `.claude-plugin/plugin.json`.
Contains plan step 12 for pull request C.

## 10. Pull request

### The split, ruled on a measured diff

The whole unit as a single pull request measures **798 changed lines**, produced by applying every block of this plan to a throwaway copy of `main` in the session scratchpad and taking `git diff --numstat` against a pristine copy of the same tree. That is 2.0 times the 400-line ceiling that orchestrator ruling `OR16` sets. The overage exception `OR16` grants requires a showing that splitting would destroy a red-on-parent receipt. **No such showing exists here.** Each of `B30`, `B32`, and the group `B31`/`B33`/`B34` has its own receipt, each receipt is red at the parent on its own, and none of them depends on any other part of this unit being shipped. So the ceiling wins and the unit splits.

**Ruled: three pull requests.** Each was measured the same way, by applying only its own steps to a throwaway tree and diffing against that pull request's own parent:

| Pull request | Carries | Production lines | Test lines | Total |
|---|---|---|---|---|
| **A** — capture presence | `B29` (verified), `B30` | 119 | 217 | **336** |
| **B** — the banner marks its clip | `B32` | 9 | 89 | **98** |
| **C** — recording guidance, the dead write, the wrap-up | `B31`, `B33`, `B34` | 88 | 284 | **372** |

Each is under the ceiling. The grouping is by reason-to-change: A is one new mechanism in the Stop hook; B is one new mechanism in the session-start banner; C is three changes to what the system says about recording and what it stops writing. A must merge before B, because both edit `src/cli/session-start.ts` and B's edit sits on top of A's. C is independent of both and may merge in any position.

Rejected: two pull requests. The best two-way boundary measures 430 and 372, and 430 exceeds the ceiling with no receipt-based exception to cover it.

Rejected: shipping it whole with a stated reason. `OR16`'s exception must be shown, not asserted, and the showing is not available: every receipt in this unit survives the split intact, which is precisely what the exception requires to be false.

### Pull request A

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u7a-capture-presence --base main \
  --title "feat(hooks): block a turn end that recorded nothing" \
  --what "At the end of a turn, when a thread is being worked and nothing has been written to the project's record since the session began, the assistant is told so and asked to record something before stopping." \
  --what "The check is repeated at every turn end and is satisfied by writing anything at all, so it stops on its own the moment a record is made." \
  --why "The plugin depended on the assistant remembering to write down what happened, with nothing anywhere to notice that a whole session had produced no record." \
  --risk "A session that deliberately records nothing now sees one message per turn end until it records something or the thread is released." \
  --verified "node --test test/hooks/stop-gate-ledger-presence.test.ts - 8 passed, 0 failed" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "npm test - full suite, 0 failed" \
  --not-verified "behaviour inside a real Claude Code session - not run, every test drives a throwaway store in a temporary directory"
```

### Pull request B

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u7b-banner-clip-marker --base main \
  --title "feat(hooks): mark the session-start banner when it is clipped" \
  --what "When the list of resumable threads is too long to be shown in full at session start, the shortened text now ends with a marker saying it was shortened." \
  --what "The marker's own length is taken out of the limit rather than added to it, so nothing downstream removes it." \
  --why "The banner was silently cut at a fixed length with no indication of any kind, so a reader could not tell whether they were seeing the whole list." \
  --verified "node --test test/unit/session-start.test.ts - 4 passed, 0 failed" \
  --verified "node --test test/spawn/forgery.test.ts - 0 failed" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "npm test - full suite, 0 failed" \
  --not-verified "the appearance of the marker in a real session banner - not run"
```

### Pull request C

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u7c-recording-guidance --base main \
  --title "feat(hooks): stop writing a note nothing reads and fix the wrap-up" \
  --what "Running a commit no longer writes an entry into the project's record, and the code that wrote it is gone." \
  --what "The wrap-up sequence now supplies the next step as well as the summary, so ending a session actually refreshes the running summary instead of returning an empty result." \
  --what "Every connected assistant is now told that anything holding a thread identifier may write to it, and that a helper agent records what it established itself." \
  --why "One entry was written into the record by a separate process on every commit and no code path ever read it back, which also made the plugin a second writer inside a single session." \
  --why "The documented wrap-up passed only the summary, so the running summary was never refreshed and the call reported that it had changed nothing." \
  --verified "node --test test/hooks/post-tool-use-writes-nothing.test.ts - 2 passed, 0 failed" \
  --verified "node --test test/contract/debrief-spine-update.test.ts - 2 passed, 0 failed" \
  --verified "node --test test/contract/subagent-recording-guidance.test.ts - 1 passed, 0 failed" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "npm test - full suite, 0 failed" \
  --not-verified "behaviour of a real helper agent following the published guidance - not run"
```

## 11. Stop conditions

For every condition below: run the command, compare the output to the stated expectation, and where they differ **STOP and report; do not improvise.**

### 11.1 The shared clip-marker helper must already exist

Run:

```
node -e "import('./src/render/clip.ts').then(m=>console.log(typeof m.clipWithMarker, typeof m.CLIP_MARKER))"
```

Expect exactly `function string`. Anything else — a module-not-found error, `undefined` for either name — means the unit that owns the shared clip-marker helper has not landed. STOP and report; do not improvise, and do not write a second implementation of that helper.

Applies to pull request B only.

### 11.2 The process-spawn allowlist census must already exist, and its membership must be the set this plan reasoned against

Run:

```
node --test --experimental-strip-types test/contract/spawn-allowlist.test.ts
```

Expect exit 0. A module-not-found error means the unit that owns the allowlist census — `U1-D` — has not landed. STOP and report; do not improvise.

Then run:

```
grep -n "SPAWN_ALLOWLIST" test/contract/spawn-allowlist.test.ts
```

Expect a line declaring the allowlist as exactly `['src/store/git.ts', 'scripts/install-githooks.mjs', 'scripts/d6-check.cjs']`. A different set means this plan's reasoning in section 3 item 7 was against a different allowlist. STOP and report; do not improvise, do not edit the allowlist, do not add a module to it, and do not widen any pattern in it.

Applies to pull request A only.

### 11.3 Every FIND string must match exactly once

Before replacing any FIND block, count its occurrences in the named file. Write the FIND text to a scratch file outside the repository and run:

```
node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const f=fs.readFileSync(process.argv[2],'utf8');console.log(s.split(f).length-1)" <target-file> <scratch-file-holding-the-FIND-text>
```

Expect the output `1` for every FIND block in section 4 and section 5. Any other number means the file changed since this plan was authored. STOP and report; do not improvise, and do not adapt the FIND string.

### 11.4 The two inherited census tests must be green before any edit begins, and must never be edited

Run:

```
node --test --experimental-strip-types test/hooks/compaction-nudge-absent.test.ts test/hooks/precompact-absent.test.ts
```

Expect exit 0. If either fails before any edit is applied, STOP and report; do not improvise. If either fails after an edit, the text just added carries one of the five banned literals: remove that text and STOP and report; do not improvise, do not edit either census file, do not narrow its scan roots, and do not add anything to its token list.

### 11.5 The version files must agree before the change

Run:

```
node -e "const a=require('./package.json').version,b=require('./.claude-plugin/plugin.json').version;console.log(a,b,a===b)"
```

Expect the third value to be `true`. If the two versions disagree, STOP and report; do not improvise. A version merely higher than the baseline named in section 0 means the ladder shifted and is **not** a stop condition.

### 11.6 The known tracked failure, and the only response permitted to it

```
Run: npm test
If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
If it passes on the re-run, proceed, and record in the pull request body a
`--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
and do not edit, skip, focus or delete any test.
```

### 11.7 Pull request B must be cut from a `main` that already contains pull request A

Run, substituting the merge commit reported for pull request A:

```
git merge-base --is-ancestor <pull-request-A-merge-commit> origin/main
```

Expect exit 0. A non-zero exit means A's content did not reach the trunk regardless of what its merge status reports. STOP and report; do not improvise, and do not begin any edit to `src/cli/session-start.ts` for pull request B.

### 11.8 No pull request is opened by this plan's reader through any other path

This one is a standing policy rather than an observable check, and it is stated here because that is where the reader looks for the things that halt work. There is no command that shows it; it is triggered by an attempt, not by an observation.

Pull requests are opened only through `node ~/.claude/lib/git/pr.mjs pr-create` with the exact invocation in section 10. If any skill or slash command offers to create a pull request by another route, refuse it. If `gh pr create`, a `gh api` POST to the pulls endpoint, or a GitHub tool call is attempted and denied at the gate, STOP and report; do not improvise, and do not seek another route.

## 12. Per-pull-request execution appendix

`OR16` normally requires one complete plan document per pull request. That is waived here for the same reason it was waived for `U1`, and for one further reason specific to this unit: the dispatch that produced this plan names exactly one output file. The three parts share one ground-truth section covering six files, and copying it three times trades a real risk of three copies drifting against a formatting convention. Each block below is executable start to finish and names the exact step and test numbers it consumes; nothing in a block defers to another block.

### Block A — `feat/u7a-capture-presence`

1. **Preconditions.** Run stop conditions 11.2, 11.3, 11.4 and 11.5.
2. **Branch.** Run `git switch -c feat/u7a-capture-presence` from the current tip of `main`; expect exit 0 and the output `Switched to a new branch 'feat/u7a-capture-presence'`. Run `git rev-parse HEAD` and record what it prints; that is this pull request's parent.
3. **Red on the parent.** Apply test 5.1 only. Run section 6.1's command and confirm the four stated failures. Then delete the file. Run `git status --porcelain` and expect no output, so the branch is clean before the real work begins.
4. **Apply.** Plan steps 1, 2, 3, 4, then test 5.1, then plan step 11 with the Conventional Commits type `feat` (increment MINOR, set PATCH to 0).
5. **Inertness.** Run section 7.1 exactly, including the restore.
6. **Verify.** Run all four commands of section 8, applying stop condition 11.6 to the fourth.
7. **Commit.** Commits A1 and A2 of section 9.
8. **Pull request.** The pull request A invocation in section 10.

### Block B — `feat/u7b-banner-clip-marker`

1. **Preconditions.** Run stop conditions 11.1, 11.3, 11.5 and 11.7.
2. **Branch.** Run `git switch -c feat/u7b-banner-clip-marker` from the current tip of `main`, which by 11.7 already contains pull request A; expect exit 0 and the output `Switched to a new branch 'feat/u7b-banner-clip-marker'`. Run `git rev-parse HEAD` and record what it prints; that is this pull request's parent.
3. **Red on the parent.** Apply test 5.6 only. Run section 6.2's command and confirm the stated failure. Then run `git restore test/spawn/forgery.test.ts`, followed by `git status --porcelain`; expect no output. Note section 6.2's statement that `test/unit/session-start.test.ts` cannot be run red at the parent and that `render.clip-is-grapheme-safe` is its substitute.
4. **Apply.** Plan steps 5 and 6, then tests 5.2 and 5.6, then plan step 12 with the Conventional Commits type `feat` (increment MINOR, set PATCH to 0).
5. **Inertness.** Run section 7.2 exactly, including the restore.
6. **Verify.** Run all four commands of section 8, applying stop condition 11.6 to the fourth.
7. **Commit.** Commits B1 and B2 of section 9.
8. **Pull request.** The pull request B invocation in section 10.

### Block C — `feat/u7c-recording-guidance`

1. **Preconditions.** Run stop conditions 11.3, 11.4 and 11.5.
2. **Branch.** Run `git switch -c feat/u7c-recording-guidance` from the current tip of `main`; expect exit 0 and the output `Switched to a new branch 'feat/u7c-recording-guidance'`. Run `git rev-parse HEAD` and record what it prints; that is this pull request's parent.
3. **Red on the parent.** Apply tests 5.3, 5.4 and 5.5 only. Run the commands of sections 6.3, 6.4 and 6.5 and confirm the five stated failures. Then delete those three files, run `git status --porcelain`, and expect no output.
4. **Apply.** Plan steps 7, 8, 9, 10, then tests 5.3, 5.4 and 5.5, then plan step 12 with the Conventional Commits type `feat` (increment MINOR, set PATCH to 0).
5. **Inertness.** Run sections 7.3, 7.4 and 7.5 exactly, each including its restore.
6. **Verify.** Run all four commands of section 8, applying stop condition 11.6 to the fourth.
7. **Commit.** Commits C1, C2, C3 and C4 of section 9.
8. **Pull request.** The pull request C invocation in section 10.
