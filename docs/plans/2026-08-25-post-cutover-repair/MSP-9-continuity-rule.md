# MSP-9 — The documentation deliverables

## 0. Identity

- **Closes:** D7 (the machine's standing continuity rule describes the replaced plugin) and D8
  (predecessor decision citations resolve to nothing in the new store).
- **Depends on:** the whole ladder. This document describes the state the ladder ends in, so every
  earlier pull request must already be merged into `main` before this branch is cut. The concrete,
  checkable preconditions are stop conditions 1 through 6 in section 11. No step in this plan edits
  a file that any other pull request in this ladder edits, so the dependency is one of *content
  accuracy*, never of merge conflict.
- **Required by:** nothing. This is the last rung.
- **Branch name:** `docs/msp-9-continuity-rule`, cut from `main`, pull request targets `main`.
- **Version bump:** Baseline `1.1.0` -> `1.1.1` per orchestrator rulings O1 and O1a. The step in
  section 4 is written as a read-then-increment against whatever `package.json` actually holds, so
  a shifted ladder does not invalidate it.
- **SPEC anchors:** section 7 MSP-9; section 6 ruling R9; section 5 defects D7 and D8.

### What this MSP is for, in plain words

Two terms first, because everything below depends on them.

- A **standing rule** is a Markdown file the operator keeps in their own Claude configuration
  directory. Claude reads it at the start of every session, in every project, and treats it as
  binding instruction. It is not documentation *about* the software; it is an order *to the
  machine*.
- The **logbook plugin** is this repository. It records what happened across coding sessions —
  threads of work, decisions, session logs — so a later session can pick up context instead of
  re-deriving it.

The operator has a standing rule telling Claude how to use this plugin. That rule was written
against a **previous** implementation which has since been replaced. It is now wrong about how the
software behaves, and wrong in the most damaging way a standing rule can be wrong: **it instructs
every session on this machine to call four tools that do not exist.** A rule that directs an agent to
call an absent tool is not stale prose. It is a defect that produces a failed call in every session
that obeys it.

This MSP writes a replacement, correct against the code as this ladder leaves it, and commits it to
**this repository** — where it can be versioned, reviewed, and diffed against the code it describes.

It also records one convention that has nowhere else to live. The previous implementation numbered
decisions `0001` through `0180`. The current one mints a different kind of identifier entirely. Every
four-digit reference already written into this project's history therefore points at nothing inside
the store that now holds it. The replacement records where those old records actually live and the
exact command that reads one.

**What this MSP does NOT do.** It does not install the rule. Copying the file into the operator's
configuration directory is the operator's own act, on the operator's own timing. Until they do it the
corrected rule is **not in force**, and the pull request says so in plain words. No step in this plan
writes to, or modifies anything under, the operator's home directory.

---

## 1. Acceptance criteria (the ceiling)

1. Every one of the claims the reconstructed census classifies is either true of the shipped code or
   absent from the replacement. The closed list is the checklist, and the replacement is verified
   against it claim by claim.
2. No tool name appears in the replacement that is absent from `src/server/tools/index.ts`. A test
   asserts this against the live registry, so the document cannot rot silently the way its
   predecessor did.
3. The PR body states plainly that the rule is not in force until the human installs it.
4. `npm test` green.

That list is the complete definition of done for this MSP. Anything discovered above it is appended
to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence, and is
**not** folded into this plan.

> Criterion 1 above differs in one phrase from the frozen SPEC, which reads "Every one of the **81**
> claims audit A6 classified". The worksheet that produced the number 81 did not survive. The closed
> list was reconstructed from scratch for this plan, it contains **195** claims, and the
> reconstructed list governs. This is divergence 3 in section 3. The list itself is section 5.3.

---

## 2. Ground truth

Six subsections: one per artifact this plan reads or edits.

### 2.1 The document being replaced

**Path read:** `/Users/satanshumishra/Documents/DevLabs/.windful-ocean/.claude/rules/common/continuity-ledger.md`

That is the real file. `~/.claude/rules/common/continuity-ledger.md` is a symbolic link into that
checkout. Resolved and confirmed at authoring time:

```
$ python3 -c "import os;print(os.path.realpath(os.path.expanduser('~/.claude/rules/common/continuity-ledger.md')))"
/Users/satanshumishra/Documents/DevLabs/.windful-ocean/.claude/rules/common/continuity-ledger.md

$ shasum -a 256 /Users/satanshumishra/Documents/DevLabs/.windful-ocean/.claude/rules/common/continuity-ledger.md
28624b6021959d516cf87f7c50033d39b863c7ed5e27fd1b220526403089e608

$ wc -l /Users/satanshumishra/Documents/DevLabs/.windful-ocean/.claude/rules/common/continuity-ledger.md
      67
```

**This file is READ-ONLY for this plan. No step below writes to it, copies over it, or touches
anything else under the operator's home directory or that checkout.** It is evidence, classified as
data, and it is never consulted as a source of truth about how the software behaves.

Its 67 lines make **195 distinct factual claims** about how the system works. **75 are false** of the
shipped code, 104 are true, and 16 cannot be classified either way because they are normative duties
on the agent rather than assertions about code. The full classification is section 5.3.

The four most damaging, quoted verbatim with the line each sits on:

| Line | Verbatim fragment | Why it is a defect |
|---|---|---|
| 9 | `` `index/` is derived, gitignored, and rebuilt by `rebuild_index`. `` | No tool named `rebuild_index` exists |
| 10 | `` prefer `get_resume_brief` / `read_decision` over reading files. `` | Neither tool exists |
| 31 | `` The server evaluates this gate inside `transition_thread` `` | No tool named `transition_thread` exists |
| 59 | `` read on demand through `read_decision`. `` | The tool does not exist |

The complete registered set is twelve names, and none of those four is among them
(`src/server/tools/index.ts:15-28`, quoted in 2.2).

### 2.2 The live tool registry

**Path:** `src/server/tools/index.ts`
**Current line range:** 1-28, the whole file.

```ts
import type { ToolSpec } from '../register.ts'
import { openThreadTool } from './open_thread.ts'
import { updateThreadTool } from './update_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { amendCriteriaTool } from './amend_criteria.ts'
import { bindBranchTool } from './bind_branch.ts'
import { resumeThreadTool } from './resume_thread.ts'
import { parkThreadTool } from './park_thread.ts'
import { recordDecisionTool } from './record_decision.ts'
import { logSessionEventTool } from './log_session_event.ts'
import { syncLedgerTool } from './sync_ledger.ts'
import { resolveConflictTool } from './resolve_conflict.ts'
import { listThreadsTool } from './list_threads.ts'

export const TOOL_SPECS: ToolSpec<never, never>[] = [
  openThreadTool,
  updateThreadTool,
  closeThreadTool,
  amendCriteriaTool,
  bindBranchTool,
  resumeThreadTool,
  parkThreadTool,
  recordDecisionTool,
  logSessionEventTool,
  syncLedgerTool,
  resolveConflictTool,
  listThreadsTool
] as unknown as ToolSpec<never, never>[]
```

Nothing is wrong with this file, and this plan does not modify it. It is quoted because it is the
population the new test censuses against, and because the plan must say exactly where the twelve
names come from.

The barrel holds **symbols**, not name strings. Each name string lives on its own tool's spec. The
twelve, with the line each is declared on, read at authoring time:

| # | Name | Declared at |
|---|---|---|
| 1 | `open_thread` | `src/server/tools/open_thread.ts:77` |
| 2 | `update_thread` | `src/server/tools/update_thread.ts:119` |
| 3 | `close_thread` | `src/server/tools/close_thread.ts:66` |
| 4 | `amend_criteria` | `src/server/tools/amend_criteria.ts:56` |
| 5 | `bind_branch` | `src/server/tools/bind_branch.ts:59` |
| 6 | `resume_thread` | `src/server/tools/resume_thread.ts:35` |
| 7 | `park_thread` | `src/server/tools/park_thread.ts:237` |
| 8 | `record_decision` | `src/server/tools/record_decision.ts:98` |
| 9 | `log_session_event` | `src/server/tools/log_session_event.ts:68` |
| 10 | `sync_ledger` | `src/server/tools/sync_ledger.ts:61` |
| 11 | `resolve_conflict` | `src/server/tools/resolve_conflict.ts:506` |
| 12 | `list_threads` | `src/server/tools/list_threads.ts:66` |

`src/server/tools/resolve_conflict.ts` holds a NUL byte at byte offset 11234, on line 275, which puts
`grep` into binary mode and makes the whole file invisible to it. Read it with a tool that does not
assume text:

```bash
node -e "process.stdout.write(require('fs').readFileSync('src/server/tools/resolve_conflict.ts','latin1'))"
```

**Consequence for step 4, and it is load-bearing:** the new test must NOT derive the twelve names by
scanning `src/server/tools/*.ts` as text. A text scan silently yields eleven names, not twelve, and a
silently-short population is exactly the failure a census exists to prevent (invariant I8). The test
imports `TOOL_SPECS` instead, which is why step 4 is written the way it is.

### 2.3 The halting-census helper the new test uses

**Path:** `test/support/census.ts`
**Current line range:** 1-24, the whole file.

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

Nothing is wrong with this file and this plan does not modify it. It is quoted because the new test
imports it, and because its two distinct failure strings — `census halted on an unclassifiable item:`
and `census rejected a forbidden item:` — are asserted verbatim by the control tests in section 5.2.

### 2.4 The idiom the new test copies

**Path:** `test/contract/skills.test.ts`
**Current line ranges:** 46-58 and 120-139.

This repository already has a test doing what acceptance criterion 2 asks for, applied to a different
document: it reads the shipped skill files, pulls every backtick-delimited span out of them line by
line, and censuses each span against the live tool set. The new test copies its shape rather than
inventing a second way.

The span extractor, `test/contract/skills.test.ts:46-58`:

```ts
type CodeSpan = { file: string; line: number; text: string }

const CODE_SPAN_PATTERN = /`([^`]+)`/g

const extractCodeSpans = (file: SkillFile): CodeSpan[] => {
  const spans: CodeSpan[] = []
  file.content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CODE_SPAN_PATTERN)) {
      spans.push({ file: file.relPath, line: index + 1, text: match[1] as string })
    }
  })
  return spans
}
```

The classifier, `test/contract/skills.test.ts:120-139`:

```ts
const BARE_TOOL_PATTERN = /^[a-z_]+$/
const QUALIFIED_PATTERN = /^([a-z_]+)\.([a-z_]+)$/

const classifySkillReference = (
  span: CodeSpan,
  liveTools: Map<string, LiveTool>
): Classified<CodeSpan>['verdict'] | 'unclassifiable' => {
  if (BARE_TOOL_PATTERN.test(span.text)) {
    return liveTools.has(span.text) ? 'allowed' : 'forbidden'
  }
  const qualifiedMatch = QUALIFIED_PATTERN.exec(span.text)
  if (qualifiedMatch !== null) {
    const toolName = qualifiedMatch[1] as string
    const fieldName = qualifiedMatch[2] as string
    const tool = liveTools.get(toolName)
    if (tool === undefined) return 'forbidden'
    return tool.inputProperties.has(fieldName) || tool.outputProperties.has(fieldName) ? 'allowed' : 'forbidden'
  }
  return 'unclassifiable'
}
```

Nothing is wrong with this file and this plan does not modify it. It is quoted so the implementer can
see the new test's structure is copied rather than invented, and so section 3 divergence 5 can state
precisely why the new classifier differs from this one.

Two further conventions this file establishes, both copied verbatim by the new test:

- Repository root resolution is `fileURLToPath(new URL('../..', import.meta.url))`
  (`test/contract/skills.test.ts:16`). Twenty-three files under `test/` use this exact expression.
- Test titles are dot-separated lowercase with hyphens inside a segment, and a synthetic control test
  appends `.control.<what-it-shows>` to the name of the test it guards.

### 2.5 The predecessor ledger, and a silent-wrong-answer trap in reading it

The previous implementation's records survive in this repository on a git ref. Confirmed at authoring
time:

```
$ git ls-tree --name-only refs/heads/_ledger
.gitattributes
.gitignore
decisions
sessions
threads

$ git ls-tree --name-only refs/heads/_ledger:decisions | wc -l
     180
```

The decisions are `0001` through `0180`, Markdown, named `<NNNN>-<slug>.md`. The current store mints
a 26-character ULID and writes JSON. The two identifier shapes cannot be confused for one another,
which is what makes a single citation convention sufficient.

**The trap.** The obvious way to read one — a wildcard, because the caller usually knows the number
but not the slug — does not fail. It silently prints something else entirely. Measured on
`git version 2.55.0`:

```
$ git show 'refs/heads/_ledger:decisions/0170-*' > /tmp/glob.out 2>/tmp/glob.err; echo "exit=$?"
exit=0
$ head -1 /tmp/glob.out
commit 9f66931e096bb12471075ce34bd57961299383b4
$ cat /tmp/glob.err
$
```

Exit code `0`. Empty standard error. The output is **the current `HEAD` commit**, not the decision
record. The same happens for a number that does not exist at all:

```
$ git show 'refs/heads/_ledger:decisions/9999-*' >/tmp/b2.out 2>/tmp/b2.err; echo "exit=$?"
exit=0
$ head -1 /tmp/b2.out
commit 9f66931e096bb12471075ce34bd57961299383b4
```

The exact-path form behaves correctly in both directions — it succeeds on a real path and fails
loudly on a wrong one:

```
$ git show 'refs/heads/_ledger:decisions/9999-nope.md' >/dev/null 2>/tmp/b1.err; echo "exit=$?"
exit=128
$ head -1 /tmp/b1.err
fatal: path 'decisions/9999-nope.md' does not exist in 'refs/heads/_ledger'
```

The convention the replacement records is therefore a **two-step** read — resolve the slug, then read
the exact path — and it names the wildcard form as forbidden, with the reason. A convention that
silently returns the wrong document is worse than no convention at all.

### 2.6 The README statements the ladder falsifies

**Path:** `README.md`

Five statements are made false by this ladder, or by this plan's own new directory. Each is quoted
verbatim with the line it sits on, read at authoring time.

**2.6.a — `README.md:5`, the version string**

```
Current version: 1.0.0 (`package.json:3`, `.claude-plugin/plugin.json:3`).
```

Wrong once the ladder lands; the shipped version becomes `1.1.1`. This is the only literal plugin
version string in any Markdown file in the repository outside `docs/specs/`, `docs/plans/` and
`docs/audits/`.

**2.6.b — `README.md:39`, the `docs/` row**

```
| `docs/` | Specs and audits written during development (`docs/specs/`, `docs/audits/`) |
```

True at authoring time. Step 1 of this plan adds `docs/rules/`, so the row becomes incomplete the
moment step 1 lands. It is repaired here because this plan is what makes it wrong.

**2.6.c — `README.md:59`, the compare-and-swap promise**

```
Concurrent writers are handled with compare-and-swap: `update-ref` is called with the previous commit it expects to be replacing, and a write that loses the race is retried against the new value, up to 5 times (`src/store/ref.ts:15-23`; `src/store/write-path.ts:29,175-221`).
```

The word "handled" overstates what the code does today: on a losing retry only the ref is re-read,
while the record content is computed once before the loop (`src/store/write-path.ts:154-158`) and
re-written unchanged (`src/store/write-path.ts:180`), discarding the winner's record. An earlier rung
of this ladder repairs the code, so the sentence is re-stated to describe the repaired behaviour.

**2.6.d — `README.md:67`, the guard table's auto-approve row**

```
| Tool name matches the ledger MCP pattern (`mcp__ledger__*` / `mcp__plugin_logbook_ledger__*`) | `allow` — auto-approved | `src/hooklib/guard.ts:14,90-92` |
```

Today the name pattern alone decides. An earlier rung adds a check against the real registry, so a
name matching the pattern but naming no registered tool is no longer auto-approved.

**2.6.e — `README.md:77`, gap 1 of the guard's stated limits**

```
1. **The plugin's own MCP tools are trusted completely.** A tool name matching the ledger pattern is `allow`ed with no inspection of its arguments (`src/hooklib/guard.ts:14,90-92`). This hook is not a second check on the plugin's own writes — only on everything else that might touch the store.
```

Two of its three clauses change. The registry check narrows the auto-approve surface; it does not
close it, because the event reaching the guard carries no server identity. That residual gap must be
stated rather than left implied by a heading that now reads as if the problem were solved.

**Everything else in the README is out of scope for this MSP.** Eight further statements in it are
already false today for reasons this ladder does not touch. They are filed, not fixed — see section
3, divergence 7.

---

## 3. Divergences from the SPEC

**Divergence 1 — the ladder lands on `1.1.1`, not `1.1.0`.**
SPEC section 7 states the ladder lands on `1.1.0`, that MSP-9 is last, and that only MSP-7 bumps the
minor. Those three cannot all hold. Orchestrator ruling O2 rules that MSP-9 merges last and the
ladder lands on `1.1.1`, because MSP-9's first acceptance criterion requires every claim to be true
of the **shipped** code, and a document merged before the last behaviour change is stale on arrival.
This plan's version step is a read-then-increment, so it is correct whatever the ladder holds.

**Divergence 2 — the pull request tool path.**
SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib` directory
in this repository. Orchestrator ruling O3 rules the tool is the operator's global one at
`node ~/.claude/lib/git/pr.mjs pr-create`. Section 10 uses that path.

**Divergence 3 — the claim census contains 195 claims, not 81.**
SPEC section 5, D7 states "Audit A6 enumerated the rule file's factual claims as a closed list of
**81** and classified every one: 27 true, 24 false, 7 half-false, 9 no-longer-applicable, 3
unverifiable." That worksheet did not survive; only the audit probes at
`docs/audits/2026-08-25-post-cutover-repair-probes/` did, and none of them is A6. Orchestrator ruling
O9 directs the planner to reconstruct the list itself and states the reconstructed list governs.

The list was reconstructed by censusing all 67 lines of the real file against the shipped source. It
contains **195 claims: 104 true, 75 false, 16 unverifiable.** The count exceeds 81 chiefly because
compound sentences were split to the level a single line of source can decide — the sentence naming
the six running-summary field names, for example, contributes six claims rather than one. This plan
uses a three-way classification (`true`, `false`, `unverifiable`) rather than A6's five-way one,
because "half-false" and "no-longer-applicable" are both varieties of false for the only purpose the
list serves: deciding whether a sentence may appear in the replacement.

**The reconstructed list in section 5.3 governs. The SPEC's number 81 does not.**

**Divergence 4 — MSP-9's acceptance criterion 1 is restated to match.**
Criterion 1 in section 1 reads "Every one of the claims the reconstructed census classifies" where
the SPEC reads "Every one of the 81 claims audit A6 classified". This is the direct consequence of
divergence 3 and changes nothing about the obligation.

**Divergence 5 — the new test's classifier keys on tool names only, never on field names.**
`test/contract/skills.test.ts:123-139` classifies a qualified span `tool.field` by checking that
`field` is a property of that tool's published schema, and returns `unclassifiable` for any span that
is neither shape — which halts the census. The new test deliberately does neither. It checks only the
part of a span before the first dot, and treats a span that is not identifier-shaped at all as
allowed.

Two independent reasons, both measured.

1. **A merge-ordering hazard.** Several fields the replacement must name — the lineage input on
   `open_thread`, the two sha fields on `sync_ledger`, the two link-report fields on
   `record_decision` — are added by earlier rungs of this same ladder. A classifier validating field
   names would be red on any tree where those rungs have not merged, making the test's colour a
   function of merge order rather than of the document's correctness.
2. **The skills classifier cannot express this document.** It was measured against four probe
   strings. `refs/logbook/ledger` returns `unclassifiable`, which halts the census. A standing rule
   that may not name a file path, a git ref, or a shell command in backticks would be a worse
   document, and the criterion does not ask for that.

Acceptance criterion 2 asks only about **tool names**. Validating field names is above the ceiling
and is not done.

**Divergence 6 — the replacement is silent about the thread field `blocked_by`.**
The predecessor rule makes several claims about a `blocked` thread state and a `blocked_by` field
(census items A48, A60, B26, B49, B50). `blocked` is not a thread state — the enum is
`open | done | abandoned` (`src/schema/thread.ts:109`) — and that is true under every ruling. The
`blocked_by` **field** exists and is readable but has no writer, and its fate is being settled by
MSP-8, whose plan did not exist at
`docs/plans/2026-08-25-post-cutover-repair/MSP-8-published-descriptions.md` at authoring time.

**Ruling applied: the replacement says nothing about `blocked_by` at all.** Acceptance criterion 1
is satisfied by a claim being either true or **absent**, and absence is correct under both possible
MSP-8 outcomes. Census items A60, B49 and B50 are therefore dispositioned `omitted` rather than
`corrected`. Rejected alternative: describe the field as it stands today, which would be a coin-flip
on being false by the time this merges.

**Divergence 7 — eight already-false README statements are filed, not fixed.**
SPEC section 7 MSP-9 scopes the README work to "any README correction the ladder has made necessary".
Eight statements in `README.md` are false today for reasons unrelated to this ladder. Repairing them
is above the ceiling; they are appended to `FILED.md` as `F9a`. The five statements in section 2.6
**are** made necessary by the ladder or by this plan's own new directory, and are repaired in step 3.

**Divergence 8 — no SPEC line-number citation for D7 or D8 was found to have moved.**
Every source line this plan quotes was read at authoring time and matched what the SPEC's surrounding
prose asserts.

---

## 4. The change, step by step

Four steps. Step 1 creates the replacement rule; step 2 repairs the README; step 3 adds the census
test; step 4 bumps the version. The tree is type-correct after each step: steps 1 and 2 touch only
Markdown, and step 3's test compiles against a file step 1 has already created.

### Step 1 — create the replacement standing rule

File: `docs/rules/continuity-ledger.md`. Operation: **CREATE**.

The directory `docs/rules/` does not exist and is created by this step. The path deliberately mirrors
the tail of the operator's own destination path, `rules/common/continuity-ledger.md`, so the install
the pull request asks for is a single unambiguous copy.

Rejected alternative, in one line: `docs/continuity-ledger-rule.md` at the top of `docs/` — rejected
because it does not mirror the destination, which turns the operator's copy step into a judgement
rather than a transcription.

Create the file with exactly these contents, first character to last:

```markdown
# Logbook continuity (standing rule)

Logbook is a Claude Code plugin that records what happened across coding sessions in a project, so a
later session can pick up context instead of re-deriving it. It stores that record in the project's
own git repository. This file states what the shipped software actually does. Where this file and the
code disagree, the code wins and this file is wrong.

The plugin exposes tools over the Model Context Protocol under the server key `ledger`. It also ships
two skills: `logbook:preflight`, which picks up an existing thread of work, and `logbook:debrief`,
which ends this session's work on one. Both skills do nothing but call the tools below.

## The twelve tools

These are all of them. There are no others.

`open_thread`, `update_thread`, `close_thread`, `amend_criteria`, `bind_branch`, `resume_thread`,
`park_thread`, `record_decision`, `log_session_event`, `sync_ledger`, `resolve_conflict`,
`list_threads`.

Over the wire each is named `mcp__ledger__<tool>`.

## Where the record lives

Everything sits under one per-project directory. The plugin resolves it from the environment value
`CLAUDE_PLUGIN_DATA` plus a key derived from the project's canonicalised absolute path. It is not in
the project's working tree, and it is never edited by hand.

Two directories sit under that root.

- `records/` is the readable copy: `threads/<ULID>.json`, `decisions/<ULID>.json`,
  `sessions/<thread ULID>/<entry ULID>.json`, and `bindings/<ULID>.json`. Every record is JSON and
  every identifier is a ULID, a 26-character sortable identifier such as
  `01M0NDPM0ACCR9CD68PMHYWGGD`.
- `state/` holds small bookkeeping files, including `origin.json`, which records the real project
  path, and `active-thread.json`, described under "Being worked now" below.

The durable copy is git-native. Every write also lands as a commit on a dedicated ref,
`refs/logbook/ledger`, inside the host project's own repository. That ref is **not a branch** and
never appears in a branch listing. Nothing is ever checked out for it; the readable copy in
`records/` is written out from the ref's tree by hand, which the code calls materialising. A stamp
file named `last-materialised` records the last successful materialisation, and is written only when
materialisation fully succeeded.

`sync_ledger` reconciles this machine's copy with the shared copy on the remote `origin`, and pushes.
Its result names `sync_ledger.local_sha`, the commit this machine holds, and
`sync_ledger.remote_sha`, the commit the shared copy holds, read back from the remote after the push.
Equality of the two is the receipt that the push arrived. Where that read-back cannot be performed
both fields are null and the result does not claim `pushed`.

Two consequences of the layout are worth knowing before relying on it.

- `state/` is per-install. If the plugin is installed from more than one source, the active-thread
  pointer and the stop-gate file do **not** follow you between them.
- When the record count on disk disagrees with the count in the ref's tree, opening the store reports
  a named anomaly rather than staying silent about it.

## Writes into the store are guarded, and the guard is not a security boundary

A hook runs before certain tool calls. `Write`, `Edit`, `MultiEdit` and `NotebookEdit` aimed inside
the store are denied. A `Bash` command whose text names the store, the ref, or the environment key
produces a confirmation prompt — `ask`, not `deny`. The guard says of itself that it prompts for
confirmation and is not a security boundary. Treat it as a guard rail, never as protection.

A tool name matching the ledger pattern is auto-approved when it names a tool the plugin actually
registers. That check narrows the auto-approve surface; it does not close it. The event the guard
receives carries no server identity, so a different server registered under the key `ledger` that
exposed a tool named `open_thread` would be auto-approved exactly as this plugin's own is.

## A thread has three states

`open`, `done`, `abandoned`. `open` is the only non-terminal one, and it is the state every new
thread starts in.

- A thread is created by `open_thread` and requires at least one entry in
  `open_thread.completion_criteria`; without one it could never be closed.
- `close_thread` moves an open thread to `done` or to `abandoned`, and nothing else writes the state.
  Closing as abandoned requires a reason, which is written to the session log rather than onto the
  thread.
- `done` and `abandoned` are terminal and cannot be undone through any tool. Reopening means creating
  a new thread that names the old one through `open_thread.predecessor_id`, and the briefing renders
  that link under `Related:`.

There is no `paused` state and no `blocked` state, and no state named `active`. Parking a thread does
not change its state.

## Being worked now is a pointer, not a state

What the previous implementation expressed as an `active` state is a file, `active-thread.json`,
under `state/`. It carries `pointer.thread_id`, `pointer.written_at` and `pointer.session_id`.

- `resume_thread` writes the pointer and returns `resume_thread.briefing`.
- `park_thread` releases it. The thread stays `open`; parking is not closing, and a parked thread
  appears in the next roster.
- At session start, a pointer left behind by a different session is reported as a crash report,
  because its `pointer.session_id` does not match this session's. That comparison is on session
  identity, never on elapsed time.

Nothing in the plugin measures a thread's age, and nothing ever closes a thread on its own. Any
staleness judgement is yours to make, from `list_threads`, which reports each thread's
`thread.updated_at`.

## Finishing a thread

Closing as `done` passes a structural gate, evaluated inside `close_thread`:

- at least one criterion that has not been struck, and
- every un-struck criterion marked done, and
- a non-empty closing statement.

When the gate fails the call is refused and the thread does not move. Criteria are set when the thread
is opened. The set of criteria afterwards changes only through `amend_criteria`, which requires
`amend_criteria.decision_id` naming a decision that actually resolves; it inserts, rewrites or
strikes. A struck criterion is retained forever, never deleted. Marking a criterion done is a
different operation and belongs to `update_thread`.

## Decisions

Call `record_decision` when a decision is locked, not at wrap-up.

- It mints a ULID and writes `decisions/<ULID>.json`. There is no four-digit number and no Markdown
  document.
- It writes the link into the thread's running summary itself, in the same commit as the decision.
  There is no second call.
- `record_decision.scope` is optional. Supplied, it is used verbatim. Omitted, it is derived as the
  lowest-numbered criterion that is neither done nor struck, rendered as `criterion N`.
- If the thread record would exceed its byte cap the decision is still written and only the link is
  skipped. The result reports `record_decision.linked` and `record_decision.link_skipped_reason`, and
  the call still succeeds.
- Reversing a decision means recording a new one that names the old in `record_decision.supersedes`.
  The old record stays readable.

Read a decision through the resource `logbook://decision/{id}`, or through the briefing, which
resolves the decisions linked on the thread. **There is no tool for reading a decision.**

One honest limit: `resolve_conflict` can replace a decision record's contents when the same
identifier exists on both sides of a sync with differing content. Decisions are append-only in
ordinary use, but that repair path is a real exception.

## Citing a decision from before the cutover

The previous implementation numbered decisions `0001` through `0180` and stored them as Markdown.
Those numbers resolve to nothing in the current store, which holds ULIDs only. The two shapes cannot
be confused: a four-digit number is a predecessor record, a 26-character ULID is a current one.

A predecessor decision is cited as `_ledger:decisions/<NNNN>-<slug>.md`.

Read one in two steps. First resolve the slug from the number:

    git ls-tree --name-only refs/heads/_ledger:decisions | grep '^0170'

Then read the exact path it printed:

    git show refs/heads/_ledger:decisions/0170-the-six-lost-items-from-0160-are-recovered-and-entered.md

Never put a wildcard in that path. `git show` with a wildcard does not fail: it exits zero, writes
nothing to standard error, and prints the current `HEAD` commit instead of the record. The exact-path
form fails loudly on a wrong path, which is why it is the only form to use.

That ref is frozen history. Read it with git; no tool reaches it.

## The running summary

Every thread carries a six-field running summary, and the schema requires all six:
`spine.active_goal`, `spine.next_step`, `spine.last_session`, `spine.open_risks`,
`spine.key_decisions` and `spine.out_of_scope`. The thread's state is a sibling field,
`thread.status`, not part of the summary.

`update_thread` records mid-session progress. `park_thread` ends this session's work: it writes the
session log entry, refreshes the summary fields from the values you supply, and releases the pointer.
It does not read the session log to compose the summary — the text you pass is the text that is
stored.

`park_thread.outcome` is optional. Supplied, it writes the session log and refreshes the summary, and
a branch that cannot write it refuses rather than releasing the pointer anyway. Omitted, the call is a
pure pointer release and existing statuses are unchanged; that is also how a pointer naming a
quarantined record is released, reported as `quarantined-pointer-released`.

The summary is what fills the roster's next step and the resumption briefing. Decisions themselves are
never compressed into it; they live in their own records and are read on demand.

## Caps refuse, they do not truncate

Every size cap is enforced by refusing the whole call. Nothing is shortened and nothing is written.
The refusal names the field, its limit, and a remedy. Shorten the value and send it again, or move the
detail into a session log entry through `log_session_event` and keep a pointer to it.

One exception, because it will confuse you otherwise: the cap on the whole serialised thread record is
reported without naming which field overflowed and without naming the number. If a write is refused
and the refusal names no field, that is the cap you have hit.

## Resuming

Never auto-select a thread — not by recency, not by file modification time, not by branch. Present the
roster from `list_threads`, let the human choose, then call `resume_thread`.

`resume_thread.thread_id` accepts a ULID and nothing else. A slug is refused. Take the identifier from
`list_threads` or from `logbook://roster`; never compose one.

Print `resume_thread.briefing` exactly as it is returned. A hook checks that the briefing was echoed
verbatim and blocks otherwise. That hook enforces the verbatim echo only — it does not enforce
stopping, so stopping after the briefing is your duty.

`logbook://index` lists every readable address, and reads are available without a tool call.

## Working rules

- Ledger claims are hints. Verify against the code and against git before acting on one. On conflict
  the code wins, and then the ledger gets fixed.
- Store pointers, not payloads. Records carry paths and identifiers, not the contents of files.
- A refusal from this server names the field that was wrong, what that field accepts, a valid example,
  and whether a retry can succeed. Read it and correct the argument rather than retrying the same
  call.
```

Rationale: ruling R9 states *"This SPEC authors the corrected text and commits it to this repository,
where it is versioned, reviewable and diffable against the code it describes. Installing it into the
operator's global rules directory is the human's act, on the human's timing."* This step is the
authoring half. No step in this plan performs the installing half.

Every sentence in the file above is discharged against the census in section 5.3.

### Step 2 — repair the five README statements the ladder made false

File: `README.md`. Operation: **REPLACE**, five edits. Apply them in the order given.

**Edit 2a.** FIND (exact, and the only occurrence in the file):

```
Current version: 1.0.0 (`package.json:3`, `.claude-plugin/plugin.json:3`).
```

REPLACE (exact):

```
Current version: 1.1.1 (`package.json:3`, `.claude-plugin/plugin.json:3`).
```

Rationale: the ladder lands on `1.1.1`, and this is the only literal plugin version string in any
Markdown file in the repository outside `docs/specs/`, `docs/plans/` and `docs/audits/`.

**Edit 2b.** FIND (exact, and the only occurrence in the file):

```
| `docs/` | Specs and audits written during development (`docs/specs/`, `docs/audits/`) |
```

REPLACE (exact):

```
| `docs/` | Development documentation. Includes `docs/specs/`, `docs/audits/`, and `docs/rules/` — the last of these holding the standing continuity rule this repository authors for an operator to install |
```

Rationale: step 1 adds `docs/rules/`, which makes the previous row incomplete. The replacement says
"Includes" rather than listing exhaustively, so a later directory does not falsify it again.

**Edit 2c.** FIND (exact, and the only occurrence in the file):

```
Concurrent writers are handled with compare-and-swap: `update-ref` is called with the previous commit it expects to be replacing, and a write that loses the race is retried against the new value, up to 5 times (`src/store/ref.ts:15-23`; `src/store/write-path.ts:29,175-221`).
```

REPLACE (exact):

```
Concurrent writers are handled with compare-and-swap: `update-ref` is called with the previous commit it expects to be replacing. A write that loses the race re-reads both the ref and the record it is about to rewrite before retrying, and refuses rather than retrying when that re-read cannot be performed; it retries up to 5 times (`src/store/ref.ts:15-23`; `src/store/write-path.ts:29,175-221`).
```

Rationale: the earlier rung of this ladder that repaired the losing-retry path makes the previous
sentence's promise true for the first time. Before it, the retry re-read only the ref and re-wrote
content computed before the loop.

**Edit 2d.** FIND (exact, and the only occurrence in the file):

```
| Tool name matches the ledger MCP pattern (`mcp__ledger__*` / `mcp__plugin_logbook_ledger__*`) | `allow` — auto-approved | `src/hooklib/guard.ts:14,90-92` |
```

REPLACE (exact):

```
| Tool name matches the ledger MCP pattern (`mcp__ledger__*` / `mcp__plugin_logbook_ledger__*`) **and** names a tool this plugin registers | `allow` — auto-approved | `src/hooklib/guard.ts:14,90-92`; `src/server/tool-names.ts` |
| Tool name matches the ledger MCP pattern but names no registered tool | no auto-approval; it falls through to the rules below | `src/hooklib/guard.ts:90-92`; `src/server/tool-names.ts` |
```

Rationale: an earlier rung of this ladder makes the guard check the tool name against the real
registry, so the pattern alone no longer decides. Two rows are needed because the two outcomes are now
different.

**Edit 2e.** FIND (exact, and the only occurrence in the file):

```
1. **The plugin's own MCP tools are trusted completely.** A tool name matching the ledger pattern is `allow`ed with no inspection of its arguments (`src/hooklib/guard.ts:14,90-92`). This hook is not a second check on the plugin's own writes — only on everything else that might touch the store.
```

REPLACE (exact):

```
1. **A registered ledger tool name is trusted completely, and the name is all the guard can check.** A tool name matching the ledger pattern *and* naming a tool this plugin registers is `allow`ed with no inspection of its arguments (`src/hooklib/guard.ts:14,90-92`; `src/server/tool-names.ts`). The registry check narrows the auto-approve surface; it does not close it. The `PreToolUse` event carries no server identity, so a third-party MCP server registered under the key `ledger` that exposes a tool named, say, `open_thread` is auto-approved exactly as this plugin's own is. This hook is not a second check on the plugin's own writes — only on everything else that might touch the store.
```

Rationale: after the registry check lands, the heading "trusted completely" reads as if the gap were
closed. It is not, and the residual gap has a precise cause worth stating.

### Step 3 — add the document census test

File: `test/contract/continuity-rule-census.test.ts`. Operation: **CREATE**.

Given in full in section 5.1. It is placed in `test/contract/` because `npm test` runs the glob
`"test/contract/**/*.test.ts"` (`package.json:12`), and because every existing test that reads a
repository artifact and censuses it already lives there.

### Step 4 — `package.json` and `.claude-plugin/plugin.json` — REPLACE the version line in both

Rationale: invariant I4 — both manifests move in the same commit.

Run this exact command from the repository root. It reads the current version, increments the patch,
and writes the same value into both files by replacing only the version line, so no other formatting
changes:

```bash
node -e "
const fs = require('node:fs')
const readVersion = (file) => {
  const raw = fs.readFileSync(file, 'utf8')
  const match = raw.match(/^  \"version\": \"(\d+)\.(\d+)\.(\d+)\",?\$/m)
  if (match === null) throw new Error('no version line in ' + file)
  return { raw, match }
}
const pkg = readVersion('package.json')
const plugin = readVersion('.claude-plugin/plugin.json')
if (pkg.match[0].replace(/,\$/, '') !== plugin.match[0].replace(/,\$/, '')) {
  throw new Error('package.json and .claude-plugin/plugin.json disagree before the bump')
}
const next = pkg.match[1] + '.' + pkg.match[2] + '.' + String(Number(pkg.match[3]) + 1)
for (const file of ['package.json', '.claude-plugin/plugin.json']) {
  const raw = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, raw.replace(/^  \"version\": \"\d+\.\d+\.\d+\"/m, '  \"version\": \"' + next + '\"'))
}
process.stdout.write('version ' + next + '\n')
"
```

Expected exit code `0`. Expected stdout under the baseline: `version 1.1.1`.

Expected `git diff` under the baseline, exactly:

```diff
diff --git a/.claude-plugin/plugin.json b/.claude-plugin/plugin.json
--- a/.claude-plugin/plugin.json
+++ b/.claude-plugin/plugin.json
@@
   "name": "logbook",
-  "version": "1.1.0",
+  "version": "1.1.1",
   "displayName": "Logbook",
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@
   "name": "logbook",
-  "version": "1.1.0",
+  "version": "1.1.1",
   "private": true,
```

Then confirm the result:

```bash
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout contains `check-packaging: ok`.

Then run this command, which re-derives the README version line from `package.json` so the three
files agree whatever the ladder actually holds. Edit 2a wrote the declared baseline `1.1.1`; this
command replaces it with the value the bump above produced. Run it unconditionally — under the
declared baseline it is a no-op that rewrites the same string.

```bash
node -e "
const fs = require('node:fs')
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const raw = fs.readFileSync('README.md', 'utf8')
const pattern = /^Current version: \d+\.\d+\.\d+ \(\`package\.json:3\`, \`\.claude-plugin\/plugin\.json:3\`\)\.\$/m
if (!pattern.test(raw)) throw new Error('README version line not found in the expected form')
fs.writeFileSync('README.md', raw.replace(pattern, 'Current version: ' + version + ' (\`package.json:3\`, \`.claude-plugin/plugin.json:3\`).'))
process.stdout.write('readme version ' + version + '\n')
"
```

Expected exit code `0`. Expected stdout under the baseline: `readme version 1.1.1`.

This is why a shifted ladder needs no judgement from you: step 4 increments whatever it finds and
then makes the README agree with it. There is nothing to decide.

---

## 5. Tests

One new test file. No existing test file is modified.

### 5.1 `test/contract/continuity-rule-census.test.ts` — NEW

This file does not exist. Create it with exactly these contents, first character to last:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { TOOL_SPECS } from '../../src/server/tools/index.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const RULE_REL_PATH = join('docs', 'rules', 'continuity-ledger.md')
const RULE_PATH = join(PROJECT_ROOT, RULE_REL_PATH)

type DocumentSpan = { file: string; line: number; text: string }

const CODE_SPAN_PATTERN = /`([^`]+)`/g

const extractSpans = (relPath: string, content: string): DocumentSpan[] => {
  const spans: DocumentSpan[] = []
  content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CODE_SPAN_PATTERN)) {
      spans.push({ file: relPath, line: index + 1, text: match[1] as string })
    }
  })
  return spans
}

const IDENTIFIER_CHARACTERS_PATTERN = /^[a-z0-9_.]+$/
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/

const headOf = (text: string): string => {
  const dot = text.indexOf('.')
  return dot === -1 ? text : text.slice(0, dot)
}

const isToolShaped = (text: string): boolean =>
  IDENTIFIER_CHARACTERS_PATTERN.test(text) && headOf(text).includes('_')

const classifyDocumentSpan = (
  span: DocumentSpan,
  toolNames: ReadonlySet<string>
): Classified<DocumentSpan>['verdict'] | 'unclassifiable' => {
  if (!IDENTIFIER_CHARACTERS_PATTERN.test(span.text)) return 'allowed'
  const head = headOf(span.text)
  if (!head.includes('_')) return 'allowed'
  if (!SNAKE_CASE_PATTERN.test(head)) return 'unclassifiable'
  return toolNames.has(head) ? 'allowed' : 'forbidden'
}

const registeredToolNames = (): Set<string> => new Set(TOOL_SPECS.map((spec) => spec.name))

const isHaltedOnUnclassifiable = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census halted on an unclassifiable item')

const isRejectedAsForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census rejected a forbidden item')

const syntheticSpan = (text: string): DocumentSpan => ({ file: 'synthetic', line: 1, text })

test('contract.continuity-rule-names-no-tool-absent-from-the-registry', () => {
  const toolNames = registeredToolNames()
  assert.ok(
    toolNames.size > 0,
    'contract.continuity-rule: TOOL_SPECS published no tool names; a census against an empty population proves nothing'
  )

  const spans = extractSpans(RULE_REL_PATH, readFileSync(RULE_PATH, 'utf8'))
  assert.ok(
    spans.length > 0,
    `contract.continuity-rule: ${RULE_REL_PATH} holds no backtick code span; a census over an empty population proves nothing`
  )

  const toolShaped = spans.filter((span) => isToolShaped(span.text))
  assert.ok(
    toolShaped.length > 0,
    `contract.continuity-rule: ${RULE_REL_PATH} names no underscored identifier at all, so this census would pass without ever consulting the registry`
  )
  assert.ok(
    toolShaped.some((span) => toolNames.has(headOf(span.text))),
    `contract.continuity-rule: no span in ${RULE_REL_PATH} resolves to a registered tool, so the registry lookup is never exercised`
  )

  assert.doesNotThrow(() => census(spans, (span) => classifyDocumentSpan(span, toolNames)))
})

test('contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unregistered-tool-name-is-forbidden-and-named', () => {
  const toolNames = registeredToolNames()
  const synthetic = [syntheticSpan('transition_thread')]
  assert.equal(classifyDocumentSpan(synthetic[0] as DocumentSpan, toolNames), 'forbidden')
  assert.throws(
    () => census(synthetic, (span) => classifyDocumentSpan(span, toolNames)),
    (error: unknown) => isRejectedAsForbidden(error) && (error as Error).message.includes('transition_thread')
  )
})

test('contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unrecognised-underscored-identifier-halts-the-census', () => {
  const toolNames = registeredToolNames()
  const synthetic = [syntheticSpan('mcp__ledger__open_thread')]
  assert.equal(classifyDocumentSpan(synthetic[0] as DocumentSpan, toolNames), 'unclassifiable')
  assert.throws(() => census(synthetic, (span) => classifyDocumentSpan(span, toolNames)), isHaltedOnUnclassifiable)
})

test('contract.continuity-rule-names-no-tool-absent-from-the-registry.control.registered-qualified-and-non-identifier-spans-are-allowed', () => {
  const toolNames = registeredToolNames()
  const synthetic = [
    syntheticSpan('open_thread'),
    syntheticSpan('park_thread.outcome'),
    syntheticSpan('refs/logbook/ledger'),
    syntheticSpan('spine.next_step')
  ]
  assert.deepEqual(
    synthetic.map((span) => classifyDocumentSpan(span, toolNames)),
    ['allowed', 'allowed', 'allowed', 'allowed']
  )
  assert.doesNotThrow(() => census(synthetic, (span) => classifyDocumentSpan(span, toolNames)))
})
```

It is picked up by `npm test`, whose glob includes `"test/contract/**/*.test.ts"` (`package.json:12`).

Exact test name strings, in file order:

1. `contract.continuity-rule-names-no-tool-absent-from-the-registry`
2. `contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unregistered-tool-name-is-forbidden-and-named`
3. `contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unrecognised-underscored-identifier-halts-the-census`
4. `contract.continuity-rule-names-no-tool-absent-from-the-registry.control.registered-qualified-and-non-identifier-spans-are-allowed`

There are no `describe` blocks. The repository uses flat top-level `test(...)` calls throughout, and
this file matches that.

**How the classifier decides, in plain words.** Every backtick span in the document is looked at. A
span containing any character outside lowercase letters, digits, underscore and dot is not an
identifier at all — a file path, a git ref, a shell command, a hyphenated word — and is allowed. For
the rest, only the part before the first dot matters. If that part has no underscore it is an
ordinary word and is allowed. If it has an underscore and is clean snake case, it must be a name the
registry actually holds, or the census rejects it. If it has an underscore but is not clean snake
case, the classifier cannot judge it and the census halts, naming it.

The function is total: every string falls into exactly one of those four branches, so no span can be
silently skipped. That is invariant I8 — the census is never narrowed to obtain a green, and there is
no allowlist anywhere in it.

**Why the population is `TOOL_SPECS` and not a text scan.** Section 2.2 records that
`src/server/tools/resolve_conflict.ts` carries a NUL byte that makes it invisible to text tooling. A
census whose population came from scanning that directory as text would silently hold eleven names
instead of twelve, and `resolve_conflict` would then be rejected as an unregistered tool. Importing
the array removes the possibility.

### 5.2 Which test discharges which acceptance criterion

| Criterion | Discharged by |
|---|---|
| 1. Every censused claim is true of the shipped code or absent from the replacement | The numbered checklist in section 5.3, discharged item by item by the implementer. Not a test — the criterion itself states the closed list is the checklist. |
| 2. No tool name in the replacement is absent from `src/server/tools/index.ts` | `contract.continuity-rule-names-no-tool-absent-from-the-registry`, with its three controls |
| 3. The PR body states the rule is not in force until installed | Section 10's `--what` value, which is a literal argument to the pull request tool |
| 4. `npm test` green | Section 8, gate 1 |

### 5.3 The reconstructed claim census (the checklist for criterion 1)

**195 claims. 104 true, 75 false, 16 unverifiable.** Reconstructed by censusing all 67 lines of the
file named in section 2.1 against the shipped source, because the audit worksheet that produced the
SPEC's figure of 81 did not survive (divergence 3).

`unverifiable` means the sentence is a normative duty on the agent — an instruction, a slogan, or a
design rationale — rather than an assertion about code that could be true or false. Such an item is
recorded, never dropped (invariant I8).

**Disposition** is what the implementer verifies, one row at a time, against
`docs/rules/continuity-ledger.md` as step 1 creates it:

- **carried** — the claim is true, and the replacement states it.
- **corrected** — the claim is false, and the replacement states the true fact in its place.
- **omitted** — the claim appears in the replacement in no form at all. Acceptance criterion 1 is
  satisfied by absence just as well as by truth.

To discharge criterion 1: read each row, find the corresponding sentence in the replacement (or
confirm its absence for an `omitted` row), and confirm the disposition holds. A row that cannot be
discharged is a stop condition, not a judgement call — see section 11, stop condition 9.

#### 5.3.a Lines 1-27 — title, opening, store location, thread lifecycle (claims 1-67)

| # | Claim | Verdict | Disposition |
|---|---|---|---|
| 1 | The subsystem is named "Continuity Ledger" | false | corrected — the product is Logbook; `ledger` survives only as the server key |
| 2 | State is partitioned per project | true | carried |
| 3 | Each session teaches the next the cumulative project state | unverifiable | carried as purpose, first paragraph |
| 4 | A plugin named `logbook` is the implementation | true | carried |
| 5 | A skill `logbook:debrief` exists and is the write side | true | carried |
| 6 | A skill `logbook:preflight` exists and is the read side | true | carried |
| 7 | Both skills only orchestrate the plugin's tools | true | carried |
| 8 | The MCP server key is `ledger` | true | carried |
| 9 | Lifecycle rules are enforced server-side | true | carried |
| 10 | A Definition-of-Done gate is enforced server-side | true | carried |
| 11 | Size caps are enforced server-side | true | carried |
| 12 | Record validation is server-side | true | carried |
| 13 | An illegal write is refused, not silently accepted | true | carried |
| 14 | Only the server writes the ledger | true | carried |
| 15 | The store sits in a per-project directory under the plugin data root | true | carried |
| 16 | `CLAUDE_PLUGIN_DATA` supplies the data root | true | carried |
| 17 | The per-project subdirectory name derives from the project path | true | carried |
| 18 | No part of the store sits in the project's working tree | true | carried |
| 19 | `Write`/`Edit`/`MultiEdit`/`NotebookEdit` into the store are denied | true | carried |
| 20 | The store is a worktree checkout at `ledger-worktree/` | false | corrected — nothing is ever checked out; the copy is materialised |
| 21 | The store is held on a git ref reserved for it | true | carried |
| 22 | A configurable backend defaults to `orphan-branch` | false | omitted — no backend selector exists |
| 23 | The store's default branch is `_ledger` | false | corrected — the ref is `refs/logbook/ledger` and is not a branch |
| 24 | Backend and branch are overridable via user config | false | omitted |
| 25 | The ledger is pushed to a remote named `origin` | true | carried |
| 26 | A non-git mode stores records in a `ledger/` directory | false | omitted — no non-git mode exists |
| 27 | Thread records live at `threads/<ULID>.json` | true | carried |
| 28 | The running summary is embedded in the thread record | true | carried |
| 29 | Decisions are `decisions/<NNNN>-<slug>.md` | false | corrected — `decisions/<ULID>.json` |
| 30 | Session entries are `sessions/<ULID>/<timestamp>--<label>.md` | false | corrected — `sessions/<thread ULID>/<entry ULID>.json` |
| 31 | Branch bindings live at `bindings/<ULID>.json` | true | carried |
| 32 | An `index/` directory exists in the store | false | omitted |
| 33 | `index/` is gitignored | false | omitted |
| 34 | A tool `rebuild_index` exists | false | corrected — the replacement names all twelve tools and this is not among them |
| 35 | The data root carries one directory per install source | unverifiable | carried as the per-install consequence of `state/` |
| 36 | A stale sibling store can answer with a plausible near-complete ledger | unverifiable | corrected — a count mismatch is reported as a named anomaly |
| 37 | Resolve the store from the running server | unverifiable | omitted |
| 38 | A tool `get_resume_brief` exists | false | corrected — the briefing comes from `resume_thread` |
| 39 | A tool `read_decision` exists | false | corrected — stated explicitly as "There is no tool for reading a decision" |
| 40 | A thread has five lifecycle states | false | corrected — three |
| 41 | A thread is in exactly one state | true | carried |
| 42 | `active` is a state meaning "being worked this session" | false | corrected — it is a pointer file, not a state |
| 43 | Hand-off transitions the thread `active` to `paused` | false | corrected — parking releases the pointer and changes no state |
| 44 | An `active` thread at session start signals a crashed session | false | corrected — the crash report keys on the pointer's session identity |
| 45 | This makes zombie detection trivial | unverifiable | omitted |
| 46 | `active` is a thread state | false | corrected |
| 47 | `paused` is a thread state | false | corrected — stated explicitly as absent |
| 48 | `blocked` is a thread state | false | corrected — stated explicitly as absent |
| 49 | `done` is a thread state | true | carried |
| 50 | `abandoned` is a thread state | true | carried |
| 51 | Those five are the complete state set | false | corrected — the set is `open`, `done`, `abandoned` |
| 52 | `done` and `abandoned` are terminal | true | carried |
| 53 | Reopening creates a new thread that references the old | false today, true after the lineage rung | carried |
| 54 | The nine listed transitions are the complete set | false | corrected — two transitions exist |
| 55 | A new thread enters state `active` | false | corrected — a new thread is `open` |
| 56 | Thread creation requires non-empty completion criteria | true | carried |
| 57 | Transition `active` to `paused` exists | false | corrected |
| 58 | That transition fires automatically at session end | false | corrected |
| 59 | Transition `active` to `blocked` exists | false | corrected |
| 60 | `blocked_by` is filled on that transition | false | omitted — divergence 6 |
| 61 | Transition `active` to `done` is gated by the done gate | false | corrected — the gate is real, the source state is `open` |
| 62 | Transition `active` to `abandoned` exists | false | corrected — source state is `open` |
| 63 | A field `abandoned_reason` is filled | false | corrected — the reason goes to the session log |
| 64 | Transition `paused` to `active` via the brief | false | corrected |
| 65 | Transition `paused` to `done` or `abandoned` | false | corrected |
| 66 | Transition `blocked` to `active` via the brief | false | corrected |
| 67 | Transition `blocked` to `paused` on timeout | false | corrected — nothing measures elapsed time |

Slice totals: 27 true, 35 false, 5 unverifiable.

#### 5.3.b Lines 29-47 — done gate, work-in-progress, staleness, resume (claims 68-131)

| # | Claim | Verdict | Disposition |
|---|---|---|---|
| 68 | The done gate is structural | true | carried |
| 69 | `done` is a real status value | true | carried |
| 70 | `done` needs at least one un-struck criterion | true | carried |
| 71 | A field `completion_criteria` exists | true | carried |
| 72 | A criterion can be struck | true | carried |
| 73 | Every un-struck criterion must be marked done | true | carried |
| 74 | The refusal names each outstanding criterion | true | omitted — true but not restated |
| 75 | `done` needs a non-empty closure statement | true | carried |
| 76 | Criteria are set at thread creation | true | carried |
| 77 | A tool `open_thread` exists | true | carried |
| 78 | `open_thread` requires at least one criterion | true | carried |
| 79 | Criteria change afterwards only through `amend_criteria` | false | corrected — the criteria SET does; marking done belongs to `update_thread` |
| 80 | A tool `amend_criteria` exists | true | carried |
| 81 | `amend_criteria` needs a decision reference | true | carried |
| 82 | That reference must actually resolve | true | carried |
| 83 | The three amendment kinds are insert, rewrite, strike | true | carried |
| 84 | A struck criterion is retained, never deleted | true | carried |
| 85 | The gate is evaluated inside `transition_thread` | false | corrected — inside `close_thread` |
| 86 | The server refuses the move when the gate fails | true | carried |
| 87 | The thread never leaves its state on refusal | true | carried |
| 88 | The refusal is surfaced to the user | true | carried |
| 89 | The refusal is not worked around | unverifiable | omitted |
| 90 | Threads partition into terminal and non-terminal | true | carried |
| 91 | `active` is a non-terminal state | false | corrected |
| 92 | `paused` is a non-terminal state | false | corrected |
| 93 | `blocked` is a non-terminal state | false | corrected |
| 94 | `open` is the sole non-terminal state | true | carried |
| 95 | Resuming is an available disposal | true | carried |
| 96 | "Pause" is an available disposal | false | corrected — the operation is `park_thread` and changes no state |
| 97 | Closing as done is available | true | carried |
| 98 | Abandoning is available | true | carried |
| 99 | Opening a new thread while one is non-terminal prompts | unverifiable | omitted — nothing in the plugin enforces or prompts it |
| 100 | "Stop starting; start finishing" | unverifiable | omitted |
| 101 | Nothing in the plugin measures thread age | true | carried |
| 102 | A SessionStart roster exists | true | carried |
| 103 | The roster carries the thread status | true | carried |
| 104 | The roster carries the slug | true | omitted — true but not restated |
| 105 | The roster carries a progress figure | false | omitted |
| 106 | The roster carries the title | true | omitted — true but not restated |
| 107 | The roster carries the next step | true | carried |
| 108 | The roster carries the id | true | omitted — true but not restated |
| 109 | No scan flags a stale thread | true | carried |
| 110 | The staleness thresholds are a duty on the agent | true | carried |
| 111 | The agent can read thread ages from that roster | false | corrected — ages come from `list_threads` |
| 112 | Nothing ever auto-closes | true | carried |
| 113 | An `active` thread of any age is an anomaly | false | corrected — the anomaly is a foreign-session pointer |
| 114 | A seven-day hard-prompt threshold exists | false | omitted |
| 115 | A thirty-day threshold for `paused` exists | false | omitted |
| 116 | A ninety-day threshold for `blocked` exists | false | omitted |
| 117 | A thread carries a blocker that can hold or be cleared | false | omitted — divergence 6 |
| 118 | The clock only raises the question; the human decides | true | carried |
| 119 | No auto-select by recency | true | carried |
| 120 | No auto-select by last-modified time | true | carried |
| 121 | No auto-select by branch | true | carried |
| 122 | A menu of resumable threads is presented | true | carried |
| 123 | The resumable set is the `active`, `paused` and `blocked` ones | false | corrected — the resumable set is the `open` ones |
| 124 | `logbook:preflight` exists as an entry point | true | carried |
| 125 | It accepts a slug argument | false | omitted |
| 126 | A slug supplied would resume that thread | false | corrected — a slug is refused; only a ULID is accepted |
| 127 | Only the chosen thread is loaded | true | carried |
| 128 | A resumption briefing is presented | true | carried |
| 129 | The briefing is presented verbatim | true | carried |
| 130 | The agent stops after presenting it | unverifiable | corrected — the hook enforces the echo, not the stopping |
| 131 | The brief is the synthesis-by-receiver step | unverifiable | omitted |

Slice totals: 43 true, 16 false, 5 unverifiable.

#### 5.3.c Lines 49-67 — decisions, the running summary, discipline (claims 132-195)

| # | Claim | Verdict | Disposition |
|---|---|---|---|
| 132 | A tool `record_decision` exists | true | carried |
| 133 | Record at the moment of decision, not at wrap-up | unverifiable | carried as a duty |
| 134 | The server allocates the next four-digit number | false | corrected — it mints a ULID |
| 135 | Decisions are written under a `decisions/` directory | true | carried |
| 136 | The decision file basename is `<NNNN>-<slug>` | false | corrected |
| 137 | The decision file extension is `.md` | false | corrected — `.json` |
| 138 | The stored artifact is a MADR record | false | corrected |
| 139 | The record carries `Status: accepted` | false | omitted |
| 140 | The record carries the owning thread's id | true | omitted — true but not restated |
| 141 | That id is carried as a `Thread-Id` header | false | omitted |
| 142 | `record_decision` links the decision into the running summary | false today, true after the linking rung | carried |
| 143 | The link's scope defaults to the current criterion | false today, true after the linking rung | carried |
| 144 | Never reconstruct decisions at wrap-up | unverifiable | carried as a duty |
| 145 | Decision records are write-once | false | corrected — stated as the `resolve_conflict` exception |
| 146 | Write-once is structural | false | corrected — same sentence |
| 147 | No tool amends a recorded decision | false | corrected — same sentence |
| 148 | Direct edits into the store are denied | true | carried |
| 149 | "Denied" is unqualified | false | corrected — a `Bash` command that touches the store is `ask`, not `deny` |
| 150 | A reversal is a new record that supersedes the old | true | carried |
| 151 | The superseded record's file remains | true | carried |
| 152 | The superseded record's number remains | false | corrected — it keeps its ULID |
| 153 | The number sequence is project-wide, not per-thread | false | omitted — no sequence exists |
| 154 | Gaps in what one thread references are normal | false | omitted |
| 155 | Cite records by bare number | false | corrected — bare numbers address only the predecessor ledger |
| 156 | Every thread record carries a running summary | true | carried |
| 157 | The summary is fixed-field | true | carried |
| 158 | The schema requires all six | true | carried |
| 159 | Field `active_goal` exists | true | carried |
| 160 | Field `next_step` exists | true | carried |
| 161 | Field `last_session` exists | true | carried |
| 162 | Field `open_risks` exists | true | carried |
| 163 | Field `key_decisions` exists | true | carried |
| 164 | Field `out_of_scope` exists | true | carried |
| 165 | `key_decisions` holds links only | false | omitted — an entry also carries a copied title and scope |
| 166 | `status` is a sibling field on the thread | true | carried |
| 167 | `status` is not part of the summary | true | carried |
| 168 | At session close the summary is merged from the session log | false | corrected — the text you pass is the text stored |
| 169 | The session-close refresh goes through `update_thread` | false | corrected — session close is `park_thread` |
| 170 | A tool `update_thread` exists | true | carried |
| 171 | This keeps the resume budget viable across 2 to 20 sessions | unverifiable | omitted |
| 172 | The summary populates the roster's next step | true | carried |
| 173 | The summary populates the resumption briefing | true | carried |
| 174 | Decisions are never compressed | true | carried |
| 175 | Decisions live in sidecar files | true | carried |
| 176 | The decisions directory is append-only | false | corrected — qualified as "in ordinary use", with the exception named |
| 177 | Decisions are referenced by their four-digit number | false | corrected |
| 178 | Decisions are read on demand through `read_decision` | false | corrected — the resource and the briefing |
| 179 | A session-3 decision is never summarised away by session 20 | true | carried |
| 180 | Hierarchy is not implemented | true | omitted — true but not restated |
| 181 | Hierarchy is deferred until roughly 15 threads | unverifiable | omitted |
| 182 | Pointers not payloads is enforced | false | corrected — carried as a duty, not as a guarantee |
| 183 | Pointers not payloads as a duty on the writer | unverifiable | carried as a duty |
| 184 | Ledger claims are hints; verify against code and git | unverifiable | carried as a duty |
| 185 | Caps are enforced by refusal, not truncation | true | carried |
| 186 | Enforcement happens at every write | true | carried |
| 187 | The server rejects the whole call | true | carried |
| 188 | The refusal names the offending field | true | carried |
| 189 | The refusal names the limit | true | carried |
| 190 | The refusal names a remedy | true | carried |
| 191 | The whole-record byte-cap refusal names field, limit and remedy | false | corrected — stated as the named exception |
| 192 | Nothing is written when a cap refuses | true | carried |
| 193 | Shorten and re-send is available | true | carried |
| 194 | Moving detail into the session log is available | true | carried |
| 195 | Nothing is silently dropped | true | carried |

Slice totals: 34 true, 24 false, 6 unverifiable.

#### 5.3.d Totals

| | true | false | unverifiable | total |
|---|---|---|---|---|
| Lines 1-27 | 27 | 35 | 5 | 67 |
| Lines 29-47 | 43 | 16 | 5 | 64 |
| Lines 49-67 | 34 | 24 | 6 | 64 |
| **All** | **104** | **75** | **16** | **195** |

Three of the 75 false claims — items 53, 142 and 143 — are false of the tree today and **true** of the
tree this ladder produces. They are carried into the replacement as true statements, which is correct
only because MSP-9 merges last. That is the whole reason for ruling O2, restated as divergence 1.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time; `0ade582` at authoring time.

The new test cannot be run red on the parent in the ordinary way, because the document it censuses
does not exist there. Run it anyway — the failure is real and its message is specific — and then run
the substitute procedure below, which is the one that actually proves the census works.

**Procedure A — the test on the bare parent.** From the repository root, with only
`test/contract/continuity-rule-census.test.ts` created and step 1 NOT applied:

```bash
node --test "test/contract/continuity-rule-census.test.ts"
```

Expected exit code: non-zero. Expected output contains:

```
ENOENT
```

and the failing test name
`contract.continuity-rule-names-no-tool-absent-from-the-registry`. The three control tests pass on
the parent, because they drive synthetic spans and never read the document.

This red proves only that the test reads the file it claims to read. It does not prove the census
discriminates. Procedure B does.

Procedure A's expected result is **reasoned, not measured**: on the parent the document is absent, so
the `readFileSync` call throws before any classification happens. Procedure B **was** measured, and
its exact output is recorded in section 8.1.

**Procedure B — the substitute, and the one that matters.** Apply step 1, then edit the created
document so that one span names a tool that does not exist. In
`docs/rules/continuity-ledger.md`, find this line:

```
Over the wire each is named `mcp__ledger__<tool>`.
```

and replace it with:

```
Over the wire each is named `mcp__ledger__<tool>`. The lifecycle gate lives in `transition_thread`.
```

Then run:

```bash
node --test "test/contract/continuity-rule-census.test.ts"
```

Expected exit code: non-zero. Expected output contains this exact substring:

```
census rejected a forbidden item
```

and the substring `transition_thread`, and names the failing test
`contract.continuity-rule-names-no-tool-absent-from-the-registry`. The exact line measured when this
plan was written was:

```
Actual message: "census rejected a forbidden item: {"file":"docs/rules/continuity-ledger.md","line":20,"text":"transition_thread"}"
```

**Restore.** Put the line back exactly as step 1 wrote it:

```
Over the wire each is named `mcp__ledger__<tool>`.
```

Re-run the command above and expect exit code `0`.

`transition_thread` is the correct name to use for this, and not an arbitrary one: it is one of the
four tool names the document being replaced actually instructs the agent to call, and none of the
four exists. The substitute procedure therefore reproduces the reported symptom rather than a proxy
for it.

---

## 7. Inertness mutation

Acceptance criterion 2 is the only criterion with a test behind it, so it is the only one with an
inertness mutation. One mutation, on the single line that makes the census consult the registry.

**The edit to revert.** In `test/contract/continuity-rule-census.test.ts`, find this line:

```ts
  return toolNames.has(head) ? 'allowed' : 'forbidden'
```

Replace it with:

```ts
  return 'allowed'
```

**What must turn red.** Run:

```bash
node --test "test/contract/continuity-rule-census.test.ts"
```

Expected exit code: non-zero. Expected output names this test as failing:

```
contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unregistered-tool-name-is-forbidden-and-named
```

with an assertion failure on the line `assert.equal(classifyDocumentSpan(...), 'forbidden')`, reported
as:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'allowed'
- 'forbidden'
```

That text is measured, not predicted; section 8.1 records the run.

**The exact restore.** Put the line back, character for character:

```ts
  return toolNames.has(head) ? 'allowed' : 'forbidden'
```

Re-run the command above and expect exit code `0`.

A census whose registry lookup can be deleted without any test noticing is not testing the registry.
This mutation is what proves it is.

---

## 8. Full verification

Run every command from the repository root, in this order, after every step in section 4 is applied.

| # | Command | Expected exit code | Output substring that proves it |
|---|---|---|---|
| 1 | `npm test` | `0` | `fail 0` |
| 2 | `npm run typecheck` | `0` | (no output; the exit code is the proof) |
| 3 | `node scripts/check-packaging.mjs` | `0` | `check-packaging: ok` |
| 4 | `node --test "test/contract/continuity-rule-census.test.ts"` | `0` | `pass 4` |

Do not write `# fail 0` as the proving substring for gate 1. Node 26 prints `ℹ fail 0` where Node 22
prints a different prefix; the bare `fail 0` matches on every version in the CI matrix and a
`#`-prefixed form matches on none of them.

**Gate 4 in detail.** The four test names that must appear, each preceded by a pass marker:

```
contract.continuity-rule-names-no-tool-absent-from-the-registry
contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unregistered-tool-name-is-forbidden-and-named
contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unrecognised-underscored-identifier-halts-the-census
contract.continuity-rule-names-no-tool-absent-from-the-registry.control.registered-qualified-and-non-identifier-spans-are-allowed
```

**Criterion 1 is discharged by hand, and it is not optional.** Walk section 5.3 row by row against
`docs/rules/continuity-ledger.md` as step 1 created it. There are 195 rows. For a row marked
`carried` or `corrected`, find the sentence in the replacement. For a row marked `omitted`, confirm
the claim appears in no form. Record the walk as done. A row you cannot discharge is stop condition 9.

### 8.1 Measured evidence: this plan was mechanically applied before it was handed over

Both new files in section 4 step 1 and section 5.1 were created exactly as written, the commands
below were run, the mutations were applied and reverted, and both files were then deleted so the
working tree returned to its starting state. This is recorded so no line in section 6, 7 or 8 rests
on prediction.

| # | What was run | Exit code read | Decisive output |
|---|---|---|---|
| 1 | `node --test "test/contract/continuity-rule-census.test.ts"`, both files present | `0` | `tests 4`, `pass 4`, `fail 0` |
| 2 | The same, with `transition_thread` inserted into the document per section 6 procedure B | `1` | `census rejected a forbidden item: {"file":"docs/rules/continuity-ledger.md","line":20,"text":"transition_thread"}` |
| 3 | The same, document restored | `0` | `tests 4`, `pass 4`, `fail 0` |
| 4 | The same, with the section 7 inertness mutation applied | `1` | `contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unregistered-tool-name-is-forbidden-and-named` fails: `+ 'allowed'` / `- 'forbidden'` |
| 5 | The same, test restored | `0` | `tests 4`, `pass 4`, `fail 0` |
| 6 | `npm run typecheck`, both files present | `2` | one diagnostic only, `Cannot find module 'yaml'` in `workflow-hardening-census.test.ts`; **no diagnostic naming either new file** |
| 7 | `npm test`, both files present | `1` | `tests 345`, `pass 344`, `fail 1`; the single failure is `workflow-hardening-census` |
| 8 | `git status --porcelain` after deleting both files | `0` | `?? docs/plans/`, the exact starting state |
| 9 | Section 4 step 4's version-bump command, against a scratchpad copy of the two manifests | `0` | `version 1.0.1`, and both manifests rewritten to `"version": "1.0.1",` |
| 10 | Section 4 step 4's README sync command, run twice against a scratchpad copy | `0` both times | `readme version 1.0.1`; the line is rewritten once and the second run is a no-op, file length unchanged |

Two things that run establishes, and one it does not.

**It establishes that the census discriminates.** Run 2 turned red on a tool name that does not
exist, and named it and its line. Run 4 turned red when the registry lookup was replaced by a
constant, so the lookup is load-bearing rather than decorative.

**It establishes that the document as authored passes its own census.** Run 1 is green with all 195
census rows' worth of vocabulary in the document, which means every backtick span in section 4 step 1
classifies as allowed. Run 7 shows the delta against the pristine baseline of `tests 341`, `pass 340`,
`fail 1` is exactly `+4 tests, +4 pass`, with the failure count unchanged — no existing test changed
status.

Runs 9 and 10 were made against a throwaway copy in the session scratchpad, never against the
repository's own manifests, so no tracked file was altered. They matter because both commands embed a
regular expression inside a double-quoted shell argument, where the shell consumes one layer of
escaping before Node sees it. That is the kind of construction that looks correct and is not, so it
was run rather than reasoned about. Run 10 was executed twice to confirm it is idempotent — the
implementer runs it unconditionally, including when the version is already correct.

**It does not establish that gates 1 and 2 will be green.** They were measured on a tree where the
rest of the ladder had not yet merged, and where the `yaml` devDependency gap is still open. On such
a tree `npm test` exits `1` and `npm run typecheck` exits `2`, both for that one unrelated cause.
Section 8 states them as ordinary exit-`0` gates regardless, and stop condition 10 is what you follow
if you meet that cause. Do not restate either gate as a comparison against a known-broken baseline.

---

---

## 9. Commits

The authored change measures approximately 315 changed lines: about 185 for the new rule document,
about 115 for the new test, 11 across the five README edits, and 4 across the two manifests. That is
under the 400-line ceiling, so **this MSP does not split.** No conditional is passed to the
implementer.

Three commits. No commit mixes a refactor with a behaviour change, and there is no refactor here at
all — every change is additive or is a correction of prose.

**Commit 1**

```
docs(rules): add the corrected standing continuity rule
```

Files: `docs/rules/continuity-ledger.md`.
Contains: section 4 step 1.

**Commit 2**

```
test(contract): census the continuity rule against the registry
```

Files: `test/contract/continuity-rule-census.test.ts`.
Contains: section 4 step 3.

**Commit 3**

```
docs(readme): correct the statements this ladder made false
```

Files: `README.md`, `package.json`, `.claude-plugin/plugin.json`.
Contains: section 4 steps 2 and 4.

Commit 1 precedes commit 2 because the test reads the document commit 1 creates; committing them in
the other order leaves one commit in the history where `npm test` is red, which breaks invariant I1
at that commit.

---

## 10. Pull request

Run exactly this, from the repository root, after the branch is pushed:

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head docs/msp-9-continuity-rule --base main \
  --title "docs(rules): rewrite the continuity rule against the shipped code" \
  --what "This repository now carries a corrected standing continuity rule written against the shipped code, plus the convention for citing a decision recorded before the cutover." \
  --what "The corrected rule is NOT in force until a human copies it into their own Claude rules directory. Nothing in this change writes to or modifies anything under a home directory." \
  --what "A test censuses that document against the live tool registry, so it cannot name a tool that does not exist without turning the suite red." \
  --why "The standing rule on this machine described the replaced plugin: it directed every session to call four tools that do not exist, and it was wrong about ten further mechanics." \
  --why "Decisions numbered before the cutover resolved to nothing in the store that now holds them, and no written convention said where to find them or how to read one." \
  --risk "The corrected rule takes effect only when a human copies it, so the machine keeps following the old rule until they do." \
  --verified "npm test - exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "inertness mutation replacing the registry lookup with a constant - the unregistered-tool-name control turns red" \
  --verified "reconstructed claim census walked row by row - 195 of 195 rows discharged" \
  --not-verified "mutation (Stryker) - not run against this diff"
```

Expected exit code `0`. Expected stdout contains `https://github.com/SatanshuMishra/logbook/pull/`.

The second `--what` value is what discharges acceptance criterion 3. Do not reword it, and do not
drop it: it is the only place the pull request states that the rule is not in force until a human
installs it.

The mutation-scope sentence SPEC section 8.2 requires: the Stryker mutate scope is `src/store/**`,
`src/schema/**`, `src/merge/field-merge.ts`, `src/merge/conflict.ts`, `src/render/**`. This MSP's
changes are two Markdown files, one test file and two JSON manifests, all of which fall **outside**
that scope entirely. The mutation job will report success having mutated nothing in this diff, which
is why the flag above is `--not-verified "mutation (Stryker) - not run against this diff"`. Do not
upgrade that to a `--verified` line on the strength of a green mutation job; a job that mutated none
of your files proves nothing about them.

Every `--verified` line above describes a check section 6, 7 or 8 tells you to run. If you did not run
one, change that line to `--not-verified "<thing> - not run"` rather than leaving it. A fabricated
verification line is worse than an absent one.

---

## 11. Stop conditions

For each: what you see, and then the instruction. **STOP and report; do not improvise.**

**1. The record-decision linking has not merged.**
Run: `grep -c "link_skipped_reason" src/server/tools/record_decision.ts`
If the output is `0`, the rung that makes `record_decision` write its own spine link has not merged,
and the replacement's Decisions section would describe behaviour that does not exist.
STOP and report; do not improvise.

**2. The park-thread repair has not merged.**
Run: `grep -c "quarantined-pointer-released" src/server/tools/park_thread.ts`
If the output is `0`, the rung that makes `park_thread` refuse rather than destroy has not merged,
and the replacement's running-summary section would describe behaviour that does not exist.
STOP and report; do not improvise.

**3. The materialisation rename has not merged.**
Run: `grep -rc "last-materialised" src/store/read-path.ts`
If the output is `0`, the rung that renames the stamp file has not merged, and the replacement names
a file that does not exist. STOP and report; do not improvise.

**4. The lineage field has not merged.**
Run: `grep -c "predecessor_id" src/server/tools/open_thread.ts`
If the output is `0`, the rung that adds thread lineage has not merged, and the replacement's
statement about reopening a thread is false. STOP and report; do not improvise.

**5. The guard registry check has not merged.**
Run: `test -f src/server/tool-names.ts && echo present || echo absent`
If the output is `absent`, the rung that makes the write guard check the registry has not merged, and
README edits 2d and 2e cite a file that does not exist. STOP and report; do not improvise.

**6. The sync receipt has not merged.**
Run: `grep -c "remote_sha" src/server/tools/sync_ledger.ts`
If the output is `0`, the rung that adds both shas to the sync receipt has not merged, and the
replacement's sync paragraph is false. STOP and report; do not improvise.

**7. The manifest-agreement test is still pinned.**
Run: `grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts`
If the output contains a quoted version literal such as `'1.0.0'`, MSP-0 has not merged.
STOP and report; do not improvise, and do not edit this file.

**8. The version files disagree before the change.**
Run:
```bash
node -e "const f=(p)=>JSON.parse(require('fs').readFileSync(p,'utf8')).version; process.stdout.write(f('package.json')+' '+f('.claude-plugin/plugin.json')+'\n')"
```
Expected exit code `0` and two identical values. If the two values printed are not identical, STOP and
report; do not improvise. A version merely higher than `1.1.0` is **not** a stop condition — it means
the ladder shifted, step 4 increments whatever it finds, and step 4's second command makes the README
agree with it. Nothing about a shifted ladder needs a decision from you.

**9. A census row cannot be discharged.**
While walking section 5.3 against the created document, you find a row whose disposition does not
hold — a `carried` row whose sentence is not there, an `omitted` row whose claim is present, or a
`corrected` row whose replacement text you cannot locate. STOP and report the row number; do not
improvise, and do not edit the document to make the row true.

**10. `npm test` reports a failure in `workflow-hardening-census`.**
If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap described by the
orchestrator is not yet closed in this checkout. STOP and report. Do not edit, skip or delete that
test, and do not install anything yourself.

The same gap shows up in gate 2 as `npm run typecheck` exiting `2` with the single diagnostic
`test/contract/workflow-hardening-census.test.ts(6,36): error TS2307: Cannot find module 'yaml' or
its corresponding type declarations.` That is the same one cause, and it takes the same instruction:
STOP and report, install nothing. Both gates stay written as ordinary exit-`0` gates in section 8;
they are not weakened to accommodate a known-broken baseline.

**11. The document being replaced is not where this plan says it is.**
Run:
```bash
shasum -a 256 "$(python3 -c "import os;print(os.path.realpath(os.path.expanduser('~/.claude/rules/common/continuity-ledger.md')))")"
```
If the digest is not `28624b6021959d516cf87f7c50033d39b863c7ed5e27fd1b220526403089e608`, the operator's
rule has changed since this plan was written and the census in section 5.3 may no longer cover it.
STOP and report; do not improvise. **Under no circumstance edit, move, or overwrite that file — this
plan never writes to it, and neither do you.**

**12. The census test halts instead of failing.**
`npm test` reports `census halted on an unclassifiable item` naming a span from
`docs/rules/continuity-ledger.md`. This means the document contains an underscored identifier the
classifier cannot judge — most likely a wire-form tool name written bare, such as
`mcp__ledger__open_thread`. STOP and report the span; do not improvise, and in particular do not add
it to any exclusion list. Invariant I8 forbids answering a halting census with an allowlist.
