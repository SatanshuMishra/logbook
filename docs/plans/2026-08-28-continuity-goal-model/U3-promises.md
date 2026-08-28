# U3 — Promises

## 0. Identity

- **Closes:** behavioural rule `B36` — `README.md` carries the seventeen public promises `LG1`–`LG17` in user language and the non-goals of the goal model's section 3.2, including the single-session limit; and it makes no performance claim.
- **Depends on:** the goal-model specification file `docs/specs/2026-08-28-continuity-goal-model.md` being present on the branch this unit is cut from. Section 11 carries the stop condition that checks it.
- **Required by:** nothing. No other unit reads `README.md` or the file this unit creates.
- **Wave:** 1. Cut from `main`; merges fourth in the ladder, after `U2`.
- **Branch name:** `docs/u3-promises`
- **Version bump:** Baseline `1.5.1` -> `1.5.2` per orchestrator ruling OR1. Applied as a read-then-increment, never as a hard-coded pair: step 3 reads the current version out of `package.json` and increments the PATCH position, because this unit's Conventional Commits type is `docs`.
- **Owns:** `README.md`.
- **Creates and wholly owns:** `test/contract/readme-promises-census.test.ts`. No other unit creates a file at that path.
- **Also edits (version bump only):** `package.json`, `.claude-plugin/plugin.json`.
- **SPEC anchors:** section 9 unit U3 (wave 1); section 8 rule `B36`; section 6 invariants — none are assigned to this unit by the specification's section 11.4, and that is correct rather than an omission: `B36` traces to promises whose invariants are enforced inside other units; section 7 defects — `B36` closes no numbered defect, so no `D#` is cited.
- **Binding decision:** `01M130DZJP1X0SMH3TGZNV2066` — Logbook is justified by continuity and auditability, never by improved model performance.

## 1. Acceptance criteria (the ceiling)

Seven criteria. Each names the behavioural rule or the `Green` clause it discharges.

1. `README.md` states each of the seventeen public promises in language addressed to a person using Logbook, with the promise's identifier (`LG1` through `LG17`) visible next to it. — `B36`; `Green` clause "README carries `LG1`–`LG17`".
2. `README.md` states the ten non-goals of the goal model's section 3.2, each with its ground, and states the single-session-per-project limit explicitly as a limit rather than leaving it to be discovered. — `B36`; `Green` clause "and the non-goals".
3. `README.md` makes no claim that Logbook improves the performance of any model. — `B36`; decision `01M130DZJP1X0SMH3TGZNV2066`.
4. A test derives the population of promise identifiers from the goal-model specification itself and asserts that every one of them appears in `README.md`. The population is derived, never pinned: the test contains no count of the promises and no hard-coded list of their identifiers. — `Green` clause "A test asserts every `LG` id appears".
5. That test halts loudly rather than passing when the goal model cannot be located, when its promise table changes shape, or when a row of that table cannot be classified. — `Green` clause "so the file cannot silently drift from this spec"; plan invariant `P8`.
6. `README.md` names no promise identifier that the goal model does not declare. — `Green` clause "so the file cannot silently drift from this spec"; the reverse direction of criterion 4, without which drift is only caught in one direction.
7. `npm test` and `npm run typecheck` pass, `package.json` and `.claude-plugin/plugin.json` carry the same bumped version in one commit, and `node scripts/check-packaging.mjs` passes. — plan invariants `P1` and `P4`.

Two of the plan invariants do not apply to this unit, and that is stated rather than left silent.
**P2, no new silent success**, does not apply: this unit adds no code path, no tool argument and no
refusal, so there is no path that could succeed without doing what was asked. **P3, no record
disappears**, does not apply: this unit changes no record schema and no stored field, so every
record in the live store parses exactly as it did before. Both are recorded here so that a reader
checking the invariant list against this plan finds an answer rather than an omission.

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new numbered item with its evidence. It is not folded into this plan and it does not reopen this unit.

## 2. Ground truth

### 2.1 `README.md`, lines 1–7 — the edit site

Read at branch tip `f6ad4a8`. `README.md` is byte-identical between `main` at `e5f0195` and that tip; `git diff --stat main HEAD -- README.md` printed nothing.

```
# Logbook

Logbook is a Claude Code plugin that keeps a durable "ledger" of what happened across coding sessions in a project — threads of work opened and closed, decisions made along the way, and a log of session events — so a later session, yours or someone else's, can pick up the right context instead of re-deriving it. Claude reads and writes that ledger through the Model Context Protocol (MCP), the standard way Claude Code talks to an external tool server; this plugin ships its own MCP server for that purpose.

The current version lives in `package.json:3` and `.claude-plugin/plugin.json:3`; a test checks that both match the version the running server reports at startup.

## Requirements
```

What is wrong with it: the file describes how the plugin is installed, what it ships, how the store is laid out and where the write guard's protection stops, and it says nothing at all about what Logbook promises a user or what it deliberately does not do. `B36` requires both. A reader today cannot learn from this file that Logbook is single-session-per-project, so that limit is discovered rather than stated.

### 2.2 `README.md`, the whole file — the absence of a performance claim

Read at branch tip `f6ad4a8`. The following command returned exit status 1, meaning no line matched:

```
grep -n -iE 'performance|faster|speed|improv|better|accura|productiv|efficien' README.md
```

What is wrong with it: nothing. `B36`'s no-performance-claim requirement is already satisfied by the current file. This unit therefore adds no such claim and deletes nothing. The one sentence this plan adds on the subject states the absence positively so that a later editor sees the constraint rather than inferring it.

### 2.3 `README.md`, lines 55 and 59 — the only existing mention of concurrency

Read at branch tip `f6ad4a8`. Line 59 verbatim:

```
Concurrent writers are handled with compare-and-swap: `update-ref` is called with the previous commit it expects to be replacing. A write that loses the race re-reads both the ref and the record it is about to rewrite before retrying, and refuses rather than retrying when that record changed underneath it; it retries up to 5 times (`src/store/ref.ts:15-23`; `src/store/write-path.ts:29,175-221`).
```

What is wrong with it: nothing, and it is not the single-session limit. It describes how two concurrent *writing processes* are reconciled at the git ref. It is not a statement that Logbook supports, or does not support, two Claude Code *sessions* working one project at once. The current `README.md` therefore does not state the single-session limit anywhere, and this plan adds it rather than editing line 59.

### 2.4 `docs/specs/2026-08-28-continuity-goal-model.md`, lines 99–121 — the population the test derives

Read at branch tip `f6ad4a8`. Line 99 is the section heading, line 101 the column header, line 102 the separator, lines 103–119 the seventeen promise rows, line 121 the next section heading. The four boundary lines, byte-exact:

```
### 4.1 Logbook goals — public, and published in the README
| ID | Promise |
|---|---|
### 4.2 Development goals — private, and never published
```

The dash in the section-4.1 heading is an em dash, `U+2014`. The first and last promise rows, byte-exact:

```
| **LG1** | **Order-agnostic.** No behaviour depends on the order you work your goals in |
| **LG17** | **A goal is finished only when you record how you know** |
```

What is wrong with it: nothing. This is the source the new test reads, and its shape is recorded here so that a change to that shape is recognised as the reason the census halts rather than being mistaken for a defect in the test.

### 2.5 `package.json` line 3 and `.claude-plugin/plugin.json` line 3 — the version pair

Read at branch tip `f6ad4a8`. Both files carry the identical line:

```
  "version": "1.4.1",
```

What is wrong with it: nothing, and the value is expected to have moved by the time this unit is cut, because three units merge ahead of it. Step 3 therefore reads whatever is there and increments it, and section 11 stops the implementer only when the two files disagree with each other.

## 3. Divergences from the SPEC

Four, all recorded rather than resolved by improvisation.

1. **The goal-model specification is not on `main`.** The SPEC's section 9 gives this unit `README.md` and a test that must not drift "from this spec", but `git diff --stat main...HEAD` shows `docs/specs/2026-08-28-continuity-goal-model.md` as an addition on the branch `docs/continuity-goal-model-spec`; it does not exist at `main`'s tip `e5f0195`. The test this plan ships derives its population from that file, so a branch cut from a `main` that lacks it cannot run the test at all.
   **Ruling applied:** this unit is cut from a `main` that already contains the specification file. That is a precondition, not an improvisation, and section 11 stop condition 1 checks it with an exact command before any edit begins. The orchestrator is told in the return summary that the documentation branch must land on `main` before `docs/u3-promises` is cut.
   **Rejected in one line:** copying the seventeen identifiers into the test as a literal list, because that is the pinned list `P8` forbids and it would make the test pass while the two documents drifted.

2. **The branch tip is `f6ad4a8`, not `4203de9`.** `PLANNING-BRIEF.md` section 7 and ruling `OR4` both record the planning-time tip as `4203de9`. `git rev-parse HEAD` returned `f6ad4a8482b79db9bb8d071633a5da9a25ffbddd`; the additional commits carry the planning documents themselves.
   **Ruling applied:** none needed for this unit. `git diff --stat main...HEAD` shows the branch touching only four files, all under `docs/`, so `README.md`, `package.json`, `.claude-plugin/plugin.json` and everything under `test/` are byte-identical between `e5f0195` and `f6ad4a8`. Every line this plan quotes was read at `f6ad4a8` and holds unchanged at `e5f0195`.

3. **`PLANNING-BRIEF.md` records both manifests at `1.4.1`, and both are still at `1.4.1`.** Ruling `OR1` gives this unit the baseline `1.5.1`, which assumes `U0`, `U1` and `U2` have already merged and bumped.
   **Ruling applied:** the version step is written as a read-then-increment exactly as `OR6` requires, so it is correct at `1.4.1`, at `1.5.1`, or at any later value. A version higher than the `OR1` baseline is not a stop condition; only a disagreement between the two files is.

4. **The specification's section 11.4 assigns this unit no invariant.** Every other wave-1 unit receives at least one. `PLANNING-BRIEF.md` section 4 builds the acceptance ceiling from three sources, of which the third is empty here.
   **Ruling applied:** the ceiling in section 1 is built from the other two sources only, and the emptiness is stated in section 0 rather than left as a silent gap. `B36`'s goals `LG10`, `LG15` and `LG16` are enforced mechanically inside `U1`, `U2` and `U5`; publishing them in `README.md` is a statement of the promise, not a second enforcement of it.

## 4. The change, step by step

Three steps, in this order. After step 1 the tree is type-correct and the new test is red. After
step 2 the new test is green. After step 3 the packaging check passes.

### Step 1 — CREATE `test/contract/readme-promises-census.test.ts`

The entire file contents are given once, in section 5.1, first character to last. Create the file
with exactly those contents and nothing else. They are given once rather than twice so that the two
copies cannot disagree with each other.

Rationale: `B36` is a statement about a file that no check reads, and the specification's `Green`
cell for this unit requires "A test asserts every `LG` id appears, so the file cannot silently drift
from this spec". This file is that test.

### Step 2 — REPLACE in `README.md`

FIND (exact; this three-line block occurs once in the file — section 11 stop condition 4 proves it):

```
The current version lives in `package.json:3` and `.claude-plugin/plugin.json:3`; a test checks that both match the version the running server reports at startup.

## Requirements
```

REPLACE (exact, complete):

```
The current version lives in `package.json:3` and `.claude-plugin/plugin.json:3`; a test checks that both match the version the running server reports at startup.

## What Logbook promises

These are the promises Logbook publishes. Each carries the identifier the goal model gives it (`docs/specs/2026-08-28-continuity-goal-model.md`, section 4.1), and a test fails the build if any of those identifiers stops appearing here or if this file names one the goal model does not declare (`test/contract/readme-promises-census.test.ts`). The two documents cannot drift apart in silence.

The case for Logbook is **continuity and auditability** — that a later session picks up where an earlier one stopped, and that you can always see how a record came to be there. Logbook makes no claim about making any model perform better.

| ID | Promise |
|---|---|
| **LG1** | **You can work your goals in any order.** Nothing in Logbook behaves differently because you finished the third one first |
| **LG2** | **However you work, you can record.** Anything holding a thread's identifier can write to it. No kind of record is reachable only through one working style, and for the same recorded content no style reaches a limit sooner than another |
| **LG3** | **Logbook never invents a value you did not give it.** Anything you left out — including which goal an item belongs to — is stored as absent and reported back as absent, and no stored link points at something that does not resolve |
| **LG4** | **Your code is never stored.** No file contents, no diffs, no source. Git already holds those, and Logbook hands you back to git rather than copying it |
| **LG5** | **What you write is what is stored, or the write is refused.** Where a value must be transformed on the way in, the transform is declared and can be undone |
| **LG6** | **When you read a record you see all of it.** No piece of text is stored that no surface ever shows you |
| **LG7** | **You can find any record without guessing.** Every kind of record has an identifier you can list and then ask for directly |
| **LG8** | **No display rule drops an item in silence.** Where something is left out, the output says how many were left out and gives the address that fetches them |
| **LG9** | **Anything that shortens text says that it shortened it**, and shortens only as far as its budget forces |
| **LG10** | **Logbook never scores, ranks or prioritises your records.** What you recorded is what you get back |
| **LG11** | **A crash puts at most one step's work at risk.** Everything recorded before it has already landed as a commit |
| **LG12** | **You never have to remember to close the session.** Logbook does not depend on a tidy-up step you might forget |
| **LG13** | **Reading one record never gets slower as your history grows** |
| **LG14** | **What Logbook loads is bounded by the work still open, not by everything ever recorded** — and nothing is deleted to keep it that way |
| **LG15** | **Nothing recorded is ever rewritten or deleted.** Correcting a decision means recording a new one that names the old; the old one stays readable |
| **LG16** | **Logbook never runs anything it stores.** Records can arrive from a shared remote, and none of them can execute on your machine |
| **LG17** | **A goal counts as finished only when you record how you know.** Marking one done asks what was observed, and whether the check behind it was actually run |

## What Logbook does not do

These are non-goals — things deliberately not built, each with its reason. They are held by decision records and review, not by an automated check. The grounds are recorded in full in `docs/specs/2026-08-28-continuity-goal-model.md`, section 3.2.

| Not a goal | Why |
|---|---|
| **Two sessions on one project at the same time** | Deliberate. Logbook is single-session-per-project by design. That is a limit, stated here rather than left for you to discover |
| A search, vector or embedding layer | Less accurate than the plain record set at this scale, it fails the simplicity constraint, and it was measured to reduce how much an agent used material it had already been handed |
| A multi-level index over the records | Measured worse than the flat one it would replace |
| Event sourcing, or projections over the ledger | Hard in ways that are well documented, and it fails the simplicity constraint outright |
| Automatic capture of file edits, diffs, tool calls or test runs | Duplicates what git already holds; records actions rather than reasons, so it cannot supply the why; and it widens what leaves your machine |
| Summarising or consolidating stored records with a model | Measured to lose compliance with recorded constraints, and to corrupt records that had been correct |
| Pruning, archiving or deleting records to control growth | Growth is bounded by leaving settled work out of the surfaces that load it, never by destroying history |
| An importance scorer or ranking system | The forcing function is the existing refusal when a cap is reached; a coarse scorer propagates its own errors |
| A model that judges whether a goal is genuinely complete | An agent assessing its own work makes false completion claims, and a second model checking that claim scores at or near chance. Ground truth comes from state, never testimony — and this plugin's server has no model access at all |
| Enforcement machinery over the content of a gated record | Measured and withdrawn: an inert gate and an enforced gate produced a runnable check equally often |

## Requirements
```

Rationale: `B36` requires `README.md` to carry `LG1`–`LG17` in user language and the non-goals of
the goal model's section 3.2 including the single-session limit, and to make no performance claim.
The inserted text does all three. The sentence "Logbook makes no claim about making any model perform
better" states the constraint of decision `01M130DZJP1X0SMH3TGZNV2066` positively, so a later editor
reads the rule rather than having to infer it from an absence.

Three authoring choices were made here rather than passed on, each with the rejected option named:

- **The promises go above `## Requirements`, not at the end of the file.** A reader asking what
  Logbook guarantees reaches it before the Node version floor. Rejected: appending after
  `## Development`, which buries a public promise below developer-only material.
- **The non-goal grounds are stated in words and carry no measured figure.** `README.md` cites its
  evidence by `path:line` throughout, and the figures behind the rejected approaches live in decision
  records that a reader of this repository cannot open. Rejected: quoting the numbers, which would
  put uncited quantities into the one file that consistently cites everything.
- **Line 59's compare-and-swap paragraph is left untouched.** It is about two writing processes at
  one git ref, not about two sessions on one project. Rejected: extending that paragraph to carry the
  single-session limit, which would attach a product-level limit to a storage-mechanism sentence.

### Step 3 — REPLACE the version line in `package.json` and `.claude-plugin/plugin.json`

This is a read-then-increment, not a hard-coded pair. Run this command verbatim from the repository
root. It is written as one shell-single-quoted argument, so nothing inside it is expanded by the
shell.

```
node -e '
const fs = require("node:fs")
const PATTERN = /^  "version": "(\d+)\.(\d+)\.(\d+)",$/m
const pkgText = fs.readFileSync("package.json", "utf8")
const pluginText = fs.readFileSync(".claude-plugin/plugin.json", "utf8")
const pkgMatch = PATTERN.exec(pkgText)
const pluginMatch = PATTERN.exec(pluginText)
if (pkgMatch === null) throw new Error("package.json: no version line of the form   \"version\": \"1.2.3\",")
if (pluginMatch === null) throw new Error(".claude-plugin/plugin.json: no version line of the form   \"version\": \"1.2.3\",")
if (pkgMatch[0] !== pluginMatch[0]) throw new Error("STOP: package.json has " + pkgMatch[0].trim() + " and .claude-plugin/plugin.json has " + pluginMatch[0].trim())
const next = "  \"version\": \"" + pkgMatch[1] + "." + pkgMatch[2] + "." + (Number(pkgMatch[3]) + 1) + "\","
fs.writeFileSync("package.json", pkgText.replace(pkgMatch[0], next))
fs.writeFileSync(".claude-plugin/plugin.json", pluginText.replace(pluginMatch[0], next))
process.stdout.write("version bumped: " + pkgMatch[0].trim() + " -> " + next.trim() + "\n")
'
```

Expected exit code: `0`. Expected stdout, with the two version values being whatever was actually on
the branch — this is the line the planner observed when running the command against a copy of the
tree at `1.4.2`:

```
version bumped: "version": "1.4.2", -> "version": "1.4.3",
```

The PATCH position is the one that increments because this unit's Conventional Commits type is
`docs`. The command throws instead of writing when the two files disagree, which is section 11 stop
condition 3 enforced by the command itself rather than only by a preceding check.

Rationale: plan invariant `P4` — both manifests bump in the same commit and
`node scripts/check-packaging.mjs` passes. Rejected: parsing both files with `JSON.parse` and writing
them back with `JSON.stringify`, which reformats `.claude-plugin/plugin.json`'s one-line `author`
object and one-line `keywords` array and would turn a two-line diff into a whole-file rewrite.

## 5. Tests

One new test file. No existing test file is modified, and no existing test is deleted, skipped or
weakened.

### 5.1 `test/contract/readme-promises-census.test.ts` (new, given in full)

It joins `test/contract/`, which `npm test` runs. Its idiom is copied from
`test/contract/continuity-rule-census.test.ts`: the same `node:test` and `node:assert/strict`
imports, the same `PROJECT_ROOT` derivation, the same shared `census` helper from
`test/support/census.ts`, the same `contract.<name>` and `contract.<name>.control.<name>` title
grammar, and the same practice of asserting the population is non-empty before censusing it so that
a census over nothing cannot masquerade as a pass. Plan invariant `P7` is satisfied trivially: this
test reads two files and drives no store at all, so it cannot observe this session's own ledger.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SPEC_REL_PATH = join('docs', 'specs', '2026-08-28-continuity-goal-model.md')
const README_REL_PATH = 'README.md'
const SPEC_PATH = join(PROJECT_ROOT, SPEC_REL_PATH)
const README_PATH = join(PROJECT_ROOT, README_REL_PATH)

const PROMISE_SECTION_HEADING = '### 4.1 Logbook goals — public, and published in the README'
const SECTION_BOUNDARY_PREFIX = '### '
const SINGLE_SESSION_LIMIT_PHRASE = 'single-session-per-project'

export type PromiseRow = { line: number; text: string }
export type PromiseMention = { line: number; token: string; suffix: string }

const SEPARATOR_ROW_PATTERN = /^\|(?:\s*:?-+:?\s*\|)+$/
const HEADER_ROW_PATTERN = /^\|\s*ID\s*\|\s*Promise\s*\|$/
const PROMISE_ROW_PATTERN = /^\|\s*\*\*(LG\d+)\*\*\s*\|\s*\S.*\|$/
const PROMISE_TOKEN_PATTERN = /(?<![A-Za-z0-9])LG([A-Za-z0-9]*)/g
const PROMISE_ID_PATTERN = /^\d+$/

export const promiseTableRows = (spec: string): PromiseRow[] => {
  const lines = spec.split('\n')
  const start = lines.indexOf(PROMISE_SECTION_HEADING)
  if (start === -1) {
    throw new Error(
      `readme.promises: ${SPEC_REL_PATH} carries no line exactly equal to "${PROMISE_SECTION_HEADING}"; the published-promise population cannot be derived`
    )
  }
  const rows: PromiseRow[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = lines[index] as string
    if (text.startsWith(SECTION_BOUNDARY_PREFIX)) break
    if (text.startsWith('|')) rows.push({ line: index + 1, text })
  }
  return rows
}

export const promiseIdOf = (row: PromiseRow): string | null => {
  const match = PROMISE_ROW_PATTERN.exec(row.text)
  return match === null ? null : (match[1] as string)
}

export const declaredPromiseIds = (rows: readonly PromiseRow[]): string[] =>
  rows.map(promiseIdOf).filter((id): id is string => id !== null)

export const mentionsPromise = (document: string, id: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9])${id}(?![0-9])`).test(document)

export const classifyPromiseRow = (
  row: PromiseRow,
  readme: string
): Classified<PromiseRow>['verdict'] | 'unclassifiable' => {
  if (SEPARATOR_ROW_PATTERN.test(row.text)) return 'allowed'
  if (HEADER_ROW_PATTERN.test(row.text)) return 'allowed'
  const id = promiseIdOf(row)
  if (id === null) return 'unclassifiable'
  return mentionsPromise(readme, id) ? 'allowed' : 'forbidden'
}

export const promiseMentions = (readme: string): PromiseMention[] => {
  const found: PromiseMention[] = []
  readme.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(PROMISE_TOKEN_PATTERN)) {
      found.push({ line: index + 1, token: match[0] as string, suffix: match[1] as string })
    }
  })
  return found
}

export const classifyPromiseMention = (
  mention: PromiseMention,
  declared: ReadonlySet<string>
): Classified<PromiseMention>['verdict'] | 'unclassifiable' => {
  if (!PROMISE_ID_PATTERN.test(mention.suffix)) return 'unclassifiable'
  return declared.has(mention.token) ? 'allowed' : 'forbidden'
}

const readSpec = (): string => readFileSync(SPEC_PATH, 'utf8')
const readReadme = (): string => readFileSync(README_PATH, 'utf8')

const isHaltedOnUnclassifiable = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census halted on an unclassifiable item')

const isRejectedAsForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census rejected a forbidden item')

test('contract.readme-publishes-every-published-promise', () => {
  const rows = promiseTableRows(readSpec())
  assert.ok(
    rows.length > 0,
    `readme.promises: ${SPEC_REL_PATH} section 4.1 holds no table row; a census over an empty population proves nothing`
  )

  const ids = declaredPromiseIds(rows)
  assert.ok(
    ids.length > 0,
    `readme.promises: ${SPEC_REL_PATH} section 4.1 declares no promise identifier; a census over an empty population proves nothing`
  )
  assert.equal(
    new Set(ids).size,
    ids.length,
    `readme.promises: ${SPEC_REL_PATH} section 4.1 declares a duplicate identifier, which would shrink the population silently: ${ids.join(', ')}`
  )

  const readme = readReadme()
  assert.ok(readme.length > 0, `readme.promises: ${README_REL_PATH} is empty`)

  assert.doesNotThrow(() => census(rows, (row) => classifyPromiseRow(row, readme)))
})

test('contract.readme-publishes-every-published-promise.control.a-promise-absent-from-the-readme-is-forbidden-and-named', () => {
  const synthetic: PromiseRow[] = [{ line: 1, text: '| **LG99** | **A promise nobody published** |' }]
  assert.equal(classifyPromiseRow(synthetic[0] as PromiseRow, '# a readme naming no promise\n'), 'forbidden')
  assert.throws(
    () => census(synthetic, (row) => classifyPromiseRow(row, '# a readme naming no promise\n')),
    (error: unknown) => isRejectedAsForbidden(error) && (error as Error).message.includes('LG99')
  )
})

test('contract.readme-publishes-every-published-promise.control.an-unparsable-promise-row-halts-the-census', () => {
  const synthetic: PromiseRow[] = [{ line: 1, text: '| LG4 | a row that lost its bold identifier |' }]
  assert.equal(classifyPromiseRow(synthetic[0] as PromiseRow, '**LG4**'), 'unclassifiable')
  assert.throws(() => census(synthetic, (row) => classifyPromiseRow(row, '**LG4**')), isHaltedOnUnclassifiable)
})

test('contract.readme-publishes-every-published-promise.control.a-longer-identifier-does-not-satisfy-a-shorter-one', () => {
  assert.equal(mentionsPromise('**LG17** and **LG10**', 'LG1'), false)
  assert.equal(mentionsPromise('**LG1** and **LG17**', 'LG1'), true)
  assert.equal(mentionsPromise('XLG1X', 'LG1'), false)
})

test('contract.readme-publishes-every-published-promise.control.a-header-row-and-a-separator-row-are-allowed', () => {
  const synthetic: PromiseRow[] = [
    { line: 1, text: '| ID | Promise |' },
    { line: 2, text: '|---|---|' }
  ]
  assert.deepEqual(
    synthetic.map((row) => classifyPromiseRow(row, '')),
    ['allowed', 'allowed']
  )
})

test('contract.readme-names-no-promise-the-spec-does-not-declare', () => {
  const declared = new Set(declaredPromiseIds(promiseTableRows(readSpec())))
  assert.ok(
    declared.size > 0,
    `readme.promises: ${SPEC_REL_PATH} declared no promise identifier, so this census would never consult the specification`
  )

  const mentions = promiseMentions(readReadme())
  assert.ok(
    mentions.length > 0,
    `readme.promises: ${README_REL_PATH} names no promise identifier at all; a census over an empty population proves nothing`
  )

  assert.doesNotThrow(() => census(mentions, (mention) => classifyPromiseMention(mention, declared)))
})

test('contract.readme-names-no-promise-the-spec-does-not-declare.control.an-undeclared-identifier-is-forbidden-and-a-malformed-one-halts', () => {
  const declared = new Set(['LG1'])
  const undeclared = promiseMentions('this readme promises **LG42** to everyone\n')
  assert.equal(undeclared.length, 1)
  assert.equal(classifyPromiseMention(undeclared[0] as PromiseMention, declared), 'forbidden')
  assert.throws(
    () => census(undeclared, (mention) => classifyPromiseMention(mention, declared)),
    (error: unknown) => isRejectedAsForbidden(error) && (error as Error).message.includes('LG42')
  )

  const malformed = promiseMentions('this readme promises **LGx** to everyone\n')
  assert.equal(malformed.length, 1)
  assert.equal(classifyPromiseMention(malformed[0] as PromiseMention, declared), 'unclassifiable')
  assert.throws(
    () => census(malformed, (mention) => classifyPromiseMention(mention, declared)),
    isHaltedOnUnclassifiable
  )
})

test('contract.readme-states-the-single-session-limit', () => {
  assert.ok(
    readReadme().includes(SINGLE_SESSION_LIMIT_PHRASE),
    `readme.promises: ${README_REL_PATH} does not carry the phrase "${SINGLE_SESSION_LIMIT_PHRASE}"; the single-session limit must be stated as a limit rather than discovered`
  )
})
```

#### How the population is derived, and why this way

The population is the table rows of the goal model's section 4.1. `promiseTableRows` finds the line
that is exactly equal to the section-4.1 heading, then takes every subsequent line beginning with
`|` until the next line beginning with `### `. Nothing is counted, nothing is listed, and no
identifier is written into the test. Adding an eighteenth promise to that table puts it into the
population automatically and turns the census red until `README.md` carries it.

**How the test locates the goal model: one path constant,
`docs/specs/2026-08-28-continuity-goal-model.md`.** A missing or renamed file makes `readFileSync`
throw `ENOENT`, which fails the test loudly. Rejected: a glob over `docs/specs/`, because that
directory holds other specifications whose tables would enter the population, and because a glob
that matches nothing returns an empty list and passes in silence, which is a test that reports
success while checking nothing. Rejected: copying the identifier list into the test, because that is a pinned list, it is a
change-detector wearing a census costume, and it can never detect the drift it exists to detect.

#### The four ways it halts rather than passing

1. **The goal model is missing or renamed** — `readFileSync` throws `ENOENT` naming the path.
2. **The section-4.1 heading is not found verbatim** — `promiseTableRows` throws
   `readme.promises: docs/specs/2026-08-28-continuity-goal-model.md carries no line exactly equal to "### 4.1 Logbook goals — public, and published in the README"; the published-promise population cannot be derived`.
3. **A row of that table cannot be classified** — a row that is neither the separator, nor the
   `| ID | Promise |` header, nor a well-formed `| **LG<n>** | <text> |` row returns
   `unclassifiable`, and `census` throws `census halted on an unclassifiable item: ...` naming the
   row. The header and separator are recognised by their structure, so renaming a column halts the
   census rather than being absorbed.
4. **`README.md` carries a token shaped like a promise identifier that is not one** — the reverse
   census extracts every `LG` followed by alphanumerics and halts on any whose suffix is not all
   digits.

No arm of either classifier excludes an item, pins a count, or consults an allowlist. Plan invariant
`P8` holds.

#### Which test discharges which acceptance criterion

| Criterion | Test that discharges it |
|---|---|
| 1 — every promise stated in user language with its identifier visible | `contract.readme-publishes-every-published-promise` asserts the identifier is present; the user language of each row is carried by step 2's REPLACE block and read in the diff |
| 2 — the non-goals, including the single-session limit | `contract.readme-states-the-single-session-limit` asserts the limit; the other nine non-goals are carried by step 2's REPLACE block and read in the diff |
| 3 — no performance claim | No test. See "What carries no test, and why" below |
| 4 — a derived, unpinned population asserted present | `contract.readme-publishes-every-published-promise`, plus its `.control.a-promise-absent-from-the-readme-is-forbidden-and-named` and `.control.a-longer-identifier-does-not-satisfy-a-shorter-one` controls |
| 5 — it halts rather than passing | `contract.readme-publishes-every-published-promise.control.an-unparsable-promise-row-halts-the-census`, `...control.a-header-row-and-a-separator-row-are-allowed`, and `contract.readme-names-no-promise-the-spec-does-not-declare.control.an-undeclared-identifier-is-forbidden-and-a-malformed-one-halts` |
| 6 — no identifier the goal model does not declare | `contract.readme-names-no-promise-the-spec-does-not-declare` |
| 7 — suite, typecheck and packaging | The commands in section 8 |

No invariant is assigned to this unit by the specification's section 11.4, so no row of this table
names an `A#`, `O#` or `S#`.

#### What carries no test, and why

- **Acceptance criterion 3, the absence of a performance claim.** There is no closed, enumerable
  population of sentences that would constitute such a claim, so any check would be an open-ended
  classifier over English prose — permanently arguable, and forbidden by the rule that a census
  population must be closed and enumerable at the moment the check runs. It is discharged by the
  diff: section 2.2 records that no such claim exists today, and step 2 adds none. Honesty-ladder
  status: `unverified-reasoned`, reason "no closed population exists over which to census natural
  language".
- **Nine of the ten non-goals.** The goal model gives its non-goals no identifiers, so there is no
  population to derive and no key to census on. Matching their prose into `README.md` prose would be
  a judgement, not a mechanical procedure. The one exception is the single-session limit, which the
  goal model singles out as a thing to be stated rather than discovered, and which therefore gets a
  direct assertion on the distinctive phrase `single-session-per-project` that step 2 writes. That
  assertion is not a change-detector: the phrase is the promise, and deleting the promise is exactly
  what must turn it red. Honesty-ladder status for the other nine: `unverified-reasoned`, reason
  "the goal model assigns the non-goals no identifiers, so no closed population exists".

## 6. Red on the parent

Parent commit: the tip of `main` at branch-cut time; `e5f0195` at authoring time for wave 0 and
wave 1.

The receipt is decided by one run: the red below is observed once, and the green below is observed
once, each against a different tree state. Neither is ever repeated against the same tree state in
the hope of a different answer, which is the only kind of re-run this plan forbids.

Every expected-output string quoted in this section and in section 7 is copied verbatim from a real
run. The `ℹ` and `✖` characters in them are the Node test runner own output prefixes, reproduced
so the substring match is exact; they are not decoration.

Apply **step 1 only**. Do not apply step 2 and do not apply step 3. Then run, from the repository
root:

```
node --test test/contract/readme-promises-census.test.ts
```

Expected exit code: non-zero. Expected output: `ℹ pass 5` and `ℹ fail 3`, with these three tests
failing and these five passing.

Failing:

- `contract.readme-publishes-every-published-promise`, with this exact assertion text:

```
Actual message: "census rejected a forbidden item: {"line":103,"text":"| **LG1** | **Order-agnostic.** No behaviour depends on the order you work your goals in |"}"
```

- `contract.readme-names-no-promise-the-spec-does-not-declare`, with this exact assertion text:

```
readme.promises: README.md names no promise identifier at all; a census over an empty population proves nothing
```

- `contract.readme-states-the-single-session-limit`, with this exact assertion text:

```
readme.promises: README.md does not carry the phrase "single-session-per-project"; the single-session limit must be stated as a limit rather than discovered
```

Passing, because they run against synthetic inputs and do not depend on the state of `README.md`:
the four `contract.readme-publishes-every-published-promise.control.*` tests and
`contract.readme-names-no-promise-the-spec-does-not-declare.control.an-undeclared-identifier-is-forbidden-and-a-malformed-one-halts`.

The planner ran exactly this sequence against a copy of the tree in a scratch directory and observed
exactly this output, including the three assertion texts quoted above verbatim.

Then apply step 2 and re-run the same command. Expected exit code: `0`. Expected output:
`ℹ pass 8` and `ℹ fail 0`.

The test compiles at the parent commit, so no substitute procedure is needed.

## 7. Inertness mutation

One acceptance criterion carries the behavioural change this unit ships — criterion 4, that a
derived population of promise identifiers is asserted present in `README.md`. Criteria 1, 2 and 6
are carried by the same edit and the same file, so one mutation exercises the pair.

**The exact edit to revert.** With all three steps applied, delete this one line from `README.md`,
including its trailing newline:

```
| **LG9** | **Anything that shortens text says that it shortened it**, and shortens only as far as its budget forces |
```

**The exact test that must turn red.**

```
node --test test/contract/readme-promises-census.test.ts
```

Expected exit code with the mutation applied: non-zero.

**The expected failure text**, observed by the planner when running this mutation against a copy of
the tree:

```
✖ contract.readme-publishes-every-published-promise
  Actual message: "census rejected a forbidden item: {"line":111,"text":"| **LG9** | **Any surface that shortens text says it shortened** — and shortens only as much as its budget requires |"}"
```

Expected totals with the mutation applied: `ℹ pass 7`, `ℹ fail 1`. The single failure is the census
itself; every control still passes, which is what shows the census and not a control is what caught
the deletion.

**The exact restore.** Put the deleted line back at the same position, between the `LG8` row and the
`LG10` row of the `## What Logbook promises` table. Then re-run the same command and expect exit
code `0` with `ℹ pass 8`, `ℹ fail 0`.

## 8. Full verification

Three units merge ahead of this one and each adds tests, so the suite total at branch-cut time is
not knowable when this plan is written. The gate is therefore expressed as a **difference measured
on this branch**, never as a pinned absolute number.

**Command 0, run BEFORE step 1 is applied**, from the repository root:

```
npm test 2>&1 | grep '^ℹ tests '
```

Expected output: one line of the form `ℹ tests <N>`. Write that `<N>` down; it is the parent
baseline, and it is the only place a number enters this section. At authoring time `<N>` was `436`,
which is a measured repository fact rather than an estimate; a different `<N>` on this branch is
expected and is not a stop condition.

The exit code of that pipeline is `grep`'s, never `npm test`'s, so it reports `0` whenever the line
was found even when the suite was red. It is a measurement, not a gate. Whether the parent is green
is decided only by stop condition 6, which runs `npm test` with no pipe and reads its own exit code.

Then apply all three steps and run all four commands below from the repository root, in this order.

| # | Command | Expected exit code | Output substring that proves it |
|---|---|---|---|
| 1 | `node --test test/contract/readme-promises-census.test.ts` | `0` | `ℹ pass 8` and `ℹ fail 0` |
| 2 | `npm run typecheck` | `0` | no output at all |
| 3 | `node scripts/check-packaging.mjs` | `0` | `check-packaging: ok` |
| 4 | `npm test` | `0` | `ℹ fail 0`, and `ℹ tests ` followed by the baseline `<N>` plus `8` |

This unit adds exactly eight tests, so command 4's total is `<N> + 8` and nothing else. A total that
is neither `<N>` nor `<N> + 8` is stop condition 7.

The `yaml` devDependency gap that affected earlier work is closed in this checkout; write no
workaround for it, and do not run `npm ci` or `npm install` for any reason — `node_modules` is
tracked here and an install rewrites tracked files.

**Before the pull request is opened**, rebase this branch onto `main` and run command 0 and commands
1 through 4 again, in the same order, expecting the same results against a freshly measured `<N>`:

```
git fetch origin main
git rebase origin/main
```

Expected exit code for each: `0`. A rebase that reports a conflict is stop condition 8.

Command 4 is the full-suite gate, and it is the only place in this plan governed by section 11's
first stop condition. That stop condition permits exactly one re-run, and only for one named test.
Nothing in section 1, section 6 or section 7 is re-run under any circumstances.

## 9. Commits

Two commits. No refactor is present, so no commit mixes one with a behaviour change.

### Commit 1

Subject line, exact:

```
docs: publish the goal model as promises and non-goals in the readme
```

Files:

```
README.md
test/contract/readme-promises-census.test.ts
```

Plan steps contained: step 1 and step 2.

These two files are one commit rather than two because they are the receipt pair. The test is red
without the `README.md` edit, so committing it alone would put a knowingly-red commit on the branch.

### Commit 2

Subject line, exact:

```
chore: bump the plugin version for the promises change
```

Files:

```
package.json
.claude-plugin/plugin.json
```

Plan steps contained: step 3. Both manifests move in this one commit, which is what plan invariant
`P4` requires.

## 10. Pull request

Measured diff size: **237 changed lines.** Measured, not estimated: the planner applied all three
steps to a copy of the tree in a scratch directory and ran `git diff --no-index --numstat` against
the originals, which reported `43` added and `0` removed for `README.md`, `1` added and `1` removed
for `package.json`, and `1` added and `1` removed for `.claude-plugin/plugin.json`; the new test file
is `190` lines, counted with `wc -l`.

Production / test split: **47 production lines** (`README.md` 43, the two manifests 2 each) and
**190 test lines**.

**Ruling: no split.** `237` is below the `400` ceiling. A split would also destroy this unit's
red-on-parent receipt: the only two files in the unit are the test and the file it censuses, so a
first pull request carrying the test alone would be permanently red until the second landed, and a
first pull request carrying `README.md` alone would ship the promises with no check at all — which
is the entire content of acceptance criterion 4.

The exact invocation. Every value is filled in; substitute nothing except `OWNER/REPO`, whose exact
value is printed by this command:

```
gh repo view --json nameWithOwner -q .nameWithOwner
```

Expected exit code: `0`. Expected output: one line of the form `owner/repo`. Paste that line in
place of `OWNER/REPO` unchanged. This is a read-only query; it opens nothing.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo OWNER/REPO --head docs/u3-promises --base main \
  --title "docs(readme): publish the goal model as promises and non-goals" \
  --what "The readme now states the seventeen promises Logbook makes to the person using it, each with the identifier the goal model gives it." \
  --what "The readme now states what Logbook deliberately does not do, including that it supports one session per project at a time." \
  --what "A test now fails the build when the readme stops naming a promise the goal model declares, or names one it does not." \
  --why "The readme described how the plugin is installed and how its store is laid out, and said nothing about what it guarantees or refuses to do." \
  --why "The single-session limit was something a user could only find out by hitting it." \
  --why "Nothing tied the readme to the goal model, so the two could drift apart without anything noticing." \
  --verified "node --test test/contract/readme-promises-census.test.ts - 8 pass, 0 fail" \
  --verified "npm test - 0 fail" \
  --verified "npm run typecheck - exit 0, no output" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --not-verified "the readme carries no claim about model performance - no automated check exists, read in the diff" \
  --not-verified "nine of the ten non-goals appear in the readme - the goal model gives them no identifiers, read in the diff"
```

One additional flag is added to that invocation, and only in the case section 11's first stop
condition describes — a first `npm test` run whose only failure was `concurrent.distinct-ids`,
followed by a passing re-run. In that case, and only then, append this flag:

```
  --not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"
```

Every `--verified` line above names a check the implementer will have run under section 8 and read
the result of. No line is written for a check that was not run.

## 11. Stop conditions

Eight. For each: what the implementer sees, the exact command that shows it, and what to do.

### 1 — The known tracked red in the full suite

This is the section 8 command-4 gate, and it is the only re-run permitted anywhere in this plan.

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

### 2 — The goal-model specification is not on the branch

What the implementer sees: the new test throws `ENOENT` instead of failing an assertion, or the
command below prints nothing.

```
ls docs/specs/2026-08-28-continuity-goal-model.md
```

Expected output: `docs/specs/2026-08-28-continuity-goal-model.md`, exit code `0`. Any other result
means this branch was cut from a commit that does not carry the goal model, and the test in this
plan has no population to derive. STOP and report; do not improvise.

### 3 — The goal model's section 4.1 heading is not what this plan read

What the implementer sees: the new test fails with `carries no line exactly equal to`, or the command
below prints anything other than `1`.

```
grep -c '^### 4.1 Logbook goals — public, and published in the README$' docs/specs/2026-08-28-continuity-goal-model.md
```

Expected exit code: `0`. Expected output: `1`. The dash in that heading is an em dash, `U+2014`. Any other count means the
heading moved or was reworded and the constant in the new test no longer matches it. STOP and report;
do not improvise.

### 4 — The `README.md` anchor is missing or not unique

What the implementer sees: step 2's FIND string cannot be located, or matches more than once.

```
grep -c '^## Requirements$' README.md
```

Expected exit code: `0`. Expected output: `1`. Any other count means `README.md` has moved on from what this plan read and
step 2's FIND string is no longer a safe anchor. STOP and report; do not improvise.

### 5 — The two version manifests disagree before the change

What the implementer sees: step 3's command throws with a message beginning `STOP:`, or the command
below prints two different values.

```
grep -h '^  "version": ' package.json .claude-plugin/plugin.json
```

Expected exit code: `0`. Expected output: the same line twice. A version merely HIGHER than this plan's `1.5.1` baseline is
NOT a stop condition — it means the ladder shifted, and step 3 reads whatever is there. Two different
values IS a stop condition. STOP and report; do not improvise.

### 6 — The suite is not green before any edit is made

What the implementer sees: `npm test` failing at the parent commit, before step 1 is applied.

```
npm test
```

Expected exit code: `0`. Expected output: `ℹ fail 0`. The accompanying `ℹ tests <N>` line is the
baseline recorded by section 8's command 0; any value of `<N>` is expected here, because three units
merge ahead of this one. A single failure of `concurrent.distinct-ids` is handled by stop condition 1
above and is not this condition. Any other failure means the branch was cut from a commit that is
not green, and nothing in this plan can be measured against it. STOP and report; do not improvise.

### 7 — The suite total after the change is not the baseline plus eight

What the implementer sees: section 8's command 4 reporting `ℹ fail 0` with a total that is neither
the baseline `<N>` recorded by command 0 nor `<N>` plus `8`.

```
npm test 2>&1 | grep '^ℹ tests '
```

Expected output: `ℹ tests ` followed by `<N>` plus `8`. As with command 0, this pipeline's exit code
is `grep`'s and proves nothing about the suite; the suite's verdict is section 8's command 4, which
is run unpiped. This unit creates one test file containing exactly eight tests and modifies no other
test file, so any other total means tests were added or lost by something other than this plan.
STOP and report; do not improvise, and do not edit, skip, focus or delete any test.

### 8 — The rebase onto `main` reports a conflict

What the implementer sees: `git rebase origin/main` exiting non-zero, or the command below printing
any path.

```
git diff --name-only --diff-filter=U
```

Expected exit code: `0`. Expected output: nothing at all. This unit owns `README.md` and one new test
file; a conflict means another unit edited a file this plan assumed it owned alone. STOP and report;
do not improvise.
