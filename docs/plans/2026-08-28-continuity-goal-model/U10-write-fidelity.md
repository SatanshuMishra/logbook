# U10 — Write fidelity

## 0. Identity

| | |
|---|---|
| **Closes** | Defect `D12`: "`escapeStored` rewrites every line break to the literal text `U+000A` and no inverse exists anywhere in the codebase. Structure is destroyed at write time, irreversibly and unannounced" |
| **Carries** | Behavioural rule `B43`: "`unescapeStored` exists, and a round-trip census over the final escaped character set proves every transform reversible. A transform that cannot be inverted becomes a refusal instead" |
| **Discharges goal** | `LG5`: "What you write is what is stored, or the write is refused. Any transform applied on the way in is declared and reversible" |
| **Depends on** | Nothing in this ladder. This unit is cut from `main` after every earlier unit has merged. It reads no symbol any earlier unit adds |
| **Required by** | Nothing. This is the last unit in the ladder |
| **Wave** | 4 |
| **Branch name** | `fix/u10-write-fidelity` |
| **Version bump** | Baseline `2.5.0` -> `2.5.1` per orchestrator ruling OR1. Applied as a read-then-increment in step 6, never as a hard-coded pair |
| **Owns** | `src/render/escape.ts` |
| **Also edits** | `test/unit/escape.test.ts` (the tests for the owned file), `package.json` and `.claude-plugin/plugin.json` (the version bump) |
| **Creates no new module** | Every change lands in files that already exist |
| **Invariants assigned** | None. No `A#`, `O#` or `S#` invariant is assigned to this unit |

### Terms used in this document

Defined here because the implementer is not assumed to know them.

- **Escape.** Replacing a character with a piece of ordinary text that names it. This project replaces a newline with the six characters `U+000A`.
- **Inverse.** A second function that turns the escaped text back into the original text.
- **Round trip.** Escaping a value and then inverting it, and checking you got the original back.
- **Census.** A test that walks a complete list of things and gives every one of them a verdict. It stops the moment it meets something it cannot give a verdict to, rather than skipping it.
- **Code point.** The number that identifies a character. The newline character is code point 10, written in hexadecimal as `000A`.
- **Token.** In this document, the text `U+` followed by the hexadecimal code point, which is what the escape produces.

---

## 1. Acceptance criteria (the ceiling)

1. **`unescapeStored` exists and is exported from `src/render/escape.ts`.** It takes the escaped text and returns the original text. Discharges `B43`, first clause. Proven by `escape.line-break-structure-survives-the-round-trip`.
2. **A round-trip census derives its own population from the shipped module and proves every transform reversible.** The census reads the set of characters the module actually escapes at the moment it runs, escapes each one in five different positions, inverts the result, and requires the original back. Discharges `B43`, second clause, and the Green cell clause "A round-trip census over the final escaped character set proves every transform reversible". Proven by `escape.round-trip-census-over-the-emitted-escape-set`.
3. **The census halts rather than skipping.** A character in the derived population that the escape does not transform in any of the five positions is classified `unclassifiable`, which stops the census with an error. A character that the inverse fails to restore is classified `forbidden`, which stops the census with an error. No count is written into the test and no character is listed by hand. Discharges `B43`'s clause "a round-trip census over the final escaped character set", whose population must be the final set rather than a set frozen at authoring time. Also discharges plan invariant `P8`. Proven by `escape.round-trip-census-over-the-emitted-escape-set` together with the inertness mutation in section 7.
4. **The token alphabet is proven unambiguous.** No token the escape can produce is the leading part of another token it can produce. This is the precondition the inverse depends on to decide where a token ends. Discharges the Green cell clause "proves every transform reversible", because without it the inverse cannot be shown correct. Proven by `escape.emitted-token-alphabet-is-prefix-free`.
5. **The inverse touches only text the escape could have produced.** Text that looks like a token but names a character the escape never escapes is returned unchanged. Discharges `B43`'s clause "proves every transform reversible", which is false unless the inverse is confined to the transforms the escape actually applies. Also discharges goal `LG5`'s "what you write is what is stored" for every value outside the escape's own output alphabet. Proven by `escape.unescape-leaves-text-outside-the-emitted-token-alphabet-untouched`.
6. **Structure that `D12` names as destroyed is restored.** Line breaks, four-space indents and ordered-list markers survive escape-then-invert byte for byte. Closes `D12`. Proven by `escape.line-break-structure-survives-the-round-trip` and `escape.leading-space-and-ordered-list-markers-survive-the-round-trip`.
7. **The number of transforms that cannot be inverted is zero, and that number is produced by the census rather than asserted.** `B43`'s third clause — "A transform that cannot be inverted becomes a refusal instead" — therefore does not fire, and no refusal ships in this unit. The finding and its measurement are in section 3. Discharges `B43`, third clause.
8. **The one input class that cannot round-trip is asserted rather than left silent.** A raw value that already contains a token is pinned by a test, so the limitation cannot change without a test changing. Discharges `B43`'s clause "A transform that cannot be inverted becomes a refusal instead" by recording, with evidence, that the set of such transforms is empty and that the residue is an input class rather than a transform. Also discharges plan invariant `P2` in its "returns a success naming exactly what it did and did not do" form. Proven by `escape.round-trip-is-exact-only-outside-the-emitted-token-alphabet`.
9. **`package.json` and `.claude-plugin/plugin.json` carry the same new version in one commit, and `node scripts/check-packaging.mjs` exits 0.** Carries no `B#`, `A#`, `O#` or `S#`: it is the delivery obligation plan invariant `P4` places on every unit in this ladder, and it is listed here because it is part of this unit's definition of done.
10. **`npm test` and `npm run typecheck` both exit 0 on the merge commit.** Carries no `B#`, `A#`, `O#` or `S#`: it is the delivery obligation plan invariant `P1` places on every unit in this ladder, and it is listed here for the same reason.

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is not folded into this plan.

---

## 2. Ground truth

### 2.1 `src/render/escape.ts` lines 1-11 — the declarations the escape is built from

Read at the current tip of the branch this plan was authored on.

```ts
const FORMAT_CLASS = /\p{Cf}/u
const SEPARATOR_CLASS = /\p{Zs}/u
const CONTROL_CLASS = /\p{Cc}/u
const ORDINARY_SPACE = ' '
const LINE_SEPARATOR = '\u2028'
const PARAGRAPH_SEPARATOR = '\u2029'
const MARKDOWN_LEADING_CHARS = new Set(['#', '-', '*', '+', '>', '`', '~'])
const MARKDOWN_INDENT_THRESHOLD = 4
const ORDERED_LIST_DIGIT = /[0-9]/
const ORDERED_LIST_PUNCTUATION = new Set(['.', ')'])
const ORDERED_LIST_TERMINATOR = /\s/
```

What is wrong with it: these five declarations are jointly the complete answer to "which characters does this module escape", and every one of them is private to the file. A census cannot read them, so the round-trip census `B43` demands cannot be written at all. Closing `D12` requires making that set readable.

### 2.2 `src/render/escape.ts` lines 13-24 — the classifier and the token builder

```ts
const isBlank = (char: string): boolean => {
  if (char === LINE_SEPARATOR || char === PARAGRAPH_SEPARATOR) return true
  if (CONTROL_CLASS.test(char)) return true
  return SEPARATOR_CLASS.test(char) && char !== ORDINARY_SPACE
}

const isEscapable = (char: string): boolean => FORMAT_CLASS.test(char) || isBlank(char)

const toEscaped = (char: string): string => {
  const codePoint = char.codePointAt(0) ?? 0
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}
```

What is wrong with it: `toEscaped` is the only place that knows the shape of a token, and it is private. An inverse written without it would carry a second, drifting copy of that shape. `isEscapable` covers only one of the four groups of characters the module escapes, so it is not on its own the population a census needs.

### 2.3 `src/render/escape.ts` lines 39-82 — `escapeStored`

```ts
export const escapeStored = (text: string): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let atLineStart = true
  let spaceRun = 0
  let index = 0
  while (index < chars.length) {
    const char = chars[index] as string
    if (atLineStart && char === ORDINARY_SPACE) {
      if (spaceRun + 1 >= MARKDOWN_INDENT_THRESHOLD) {
        out.push(toEscaped(char))
        spaceRun = 0
      } else {
        out.push(char)
        spaceRun += 1
      }
      index += 1
      continue
    }
    if (atLineStart && MARKDOWN_LEADING_CHARS.has(char)) {
      out.push(toEscaped(char))
      atLineStart = false
      spaceRun = 0
      index += 1
      continue
    }
    if (atLineStart) {
      const markerEnd = orderedListMarkerEnd(chars, index)
      if (markerEnd !== null) {
        for (let cursor = index; cursor < markerEnd - 1; cursor += 1) out.push(escapeChar(chars[cursor] as string))
        out.push(toEscaped(chars[markerEnd - 1] as string))
        atLineStart = false
        spaceRun = 0
        index = markerEnd
        continue
      }
    }
    out.push(escapeChar(char))
    atLineStart = char === '\n' || char === '\r'
    spaceRun = 0
    index += 1
  }
  return out.join('')
}
```

What is wrong with it: this is the function `D12` names. It applies four separate transforms — the escapable character at any position, the markdown leading character at the start of a line, every fourth leading space, and the punctuation of an ordered-list marker — and all four write a token. Nothing anywhere in the repository turns a token back into the character it names, so a stored value cannot be read back as what was written. That is the whole of `D12`.

### 2.4 `src/render/escape.ts` lines 84-88 — `clipGraphemes`

```ts
export const clipGraphemes = (text: string, max: number): string => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const graphemes = Array.from(segmenter.segment(text), (entry) => entry.segment)
  return graphemes.slice(0, max).join('')
}
```

Nothing is wrong with it. It is quoted because step 3 inserts text immediately before it and needs it as an anchor.

### 2.5 `test/unit/escape.test.ts` lines 1-11 — the imports and the shared constants

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeStored, clipGraphemes } from '../../src/render/escape.ts'
import { census } from '../support/census.ts'

const MAX_CODE_POINT = 0x10ffff
const SURROGATE_LOW = 0xd800
const SURROGATE_HIGH = 0xdfff
const ORDINARY_SPACE = 0x20
const LINE_SEPARATOR = 0x2028
const PARAGRAPH_SEPARATOR = 0x2029
```

What is wrong with it: nothing. `MAX_CODE_POINT`, `SURROGATE_LOW` and `SURROGATE_HIGH` are reused unchanged by the new census, and the import line is the anchor step 4 rewrites.

### 2.6 `test/unit/escape.test.ts` line 92 — the anchor the new tests are inserted before

```ts
test('clip.is-grapheme-safe', () => {
```

Nothing is wrong with it. It is the insertion anchor for step 5.

### 2.7 `package.json` line 3 — the version field

```
  "version": "1.4.1",
```

What is wrong with it: nothing. It is quoted because step 6 edits this line, and because the value on disk at authoring time is **below** this unit's `2.5.0` baseline — nine units bump it before this one runs. That is why step 6 reads the value rather than matching a literal, and why stop condition 11.5 treats a differing value as normal.

### 2.8 `.claude-plugin/plugin.json` line 3 — the version field

```
  "version": "1.4.1",
```

What is wrong with it: nothing. It is quoted for the same reason as 2.7. These two lines must always hold the same value, which is the whole of the packaging check step 6e runs.

---

## 3. Divergences from the SPEC

### 3.1 The decomposition procedure this planner was told to read does not exist

`~/.claude/skills/mitosis/SKILL.md` is absent from disk. Orchestrator ruling `OR20` rules that this ladder depends on no external decomposition procedure and that a planner proceeds under the planning brief and the orchestrator rulings alone. This plan was authored under those two documents. Nothing about this unit's scope changed.

### 3.2 The line-break rewrite is invertible, contrary to the reading that `D12` invites

`D12` is worded "`escapeStored` rewrites every line break to the literal text `U+000A` and no inverse exists anywhere in the codebase". Both halves are true, but they are two different claims and only the second is a defect in the transform's design.

Measured against the shipped module on Node `v26.4.0` with Unicode 17.0: the module can emit a token for **263 distinct code points**, and each of those 263 transforms was round-tripped in five positions each — **1315 samples, 0 irreversible**. The line-break transform is among the reversible ones: `\n` becomes `U+000A` and `U+000A` becomes `\n` again.

The ruling this plan applies: `D12` is closed by **writing the missing inverse**, not by replacing a transform with a refusal. `B43`'s third clause — "A transform that cannot be inverted becomes a refusal instead" — has an empty subject and does not fire. **No refusal ships in this unit**, and acceptance criterion 7 records the measured zero rather than asserting it.

### 3.3 `escapeStored` is not injective, and that is filed rather than fixed here

Two different inputs can produce one stored value: `escapeStored('\n')` returns `U+000A`, and `escapeStored('U+000A')` also returns `U+000A`. So a value whose raw text already contains a token cannot be told apart from the character that token names, and cannot round-trip.

This is not fixable inside this unit. The repository ships a test named `escape.stored-is-idempotent-over-the-escapable-and-markdown-leading-population` at `test/unit/escape.test.ts:81`, which requires that escaping an already-escaped value changes nothing. A map that is idempotent and is not the identity cannot be injective — if `f(f(x))` equals `f(x)` and `f` never merges two inputs, then `f(x)` equals `x` everywhere, which `escapeStored` plainly is not. Making the escape injective therefore means deleting that shipped test. Ten modules outside this unit's ownership pass already-escaped text back through `escapeStored` and so rely on the property that test pins: `src/render/briefing.ts`, `src/render/roster.ts`, `src/server/resource-render.ts`, `src/server/resources.ts`, `src/server/prompts.ts`, `src/cli/session-start.ts`, `src/domain/lifecycle.ts`, `src/domain/spine.ts`, `src/schema/refusal.ts` and `src/server/tools/resolve_conflict.ts`.

Filed as `F10a` in `docs/plans/2026-08-28-continuity-goal-model/FILED.md`. Acceptance criterion 8 pins the limitation with a test so it cannot drift silently.

### 3.4 The deeper cause of `D12` is that escaping happens on the write path

`escapeStored` is applied to caller-supplied text before the value is committed, in ten modules, and the renderer escapes again when the value is read. Storing the raw value and escaping only at render time would discharge `LG5` completely and need no inverse at all. That change touches ten modules this unit does not own.

Filed as `F10b`. Not folded in.

### 3.5 What orchestrator ruling `OR15` does and does not narrow

`OR15` gives fields whose declared class is `pointer` a pattern that refuses a value containing a line break, a code fence, a diff hunk marker, or the literal text `U+000A` or `U+000D`. Two consequences for this unit, both stated because they are easy to overstate:

- A `pointer`-class field can never reach storage carrying an escaped line break, so for those fields the inverse is never exercised on `U+000A` or `U+000D`.
- That closes **2 of the 263** cases described in 3.3, and only on `pointer`-class fields. `content`-class fields — the thread title, the criterion text, a decision's context and outcome, a session body — carry every one of the 263 and are unaffected.

The inverse is therefore still needed in full. `OR15` narrows the exposure of the `F10a` limitation; it does not narrow the set of transforms that need an inverse.

### 3.6 The escaped set is version-dependent, so no number is pinned anywhere

The population is defined by Unicode character properties evaluated by whichever Node version runs the test. This project's CI runs three Node versions. `263` is what this planner measured on Node `v26.4.0` / Unicode 17.0; another version can legitimately give another number. **No test in this plan contains that number or any other count**, and none may be added — the census derives its population every time it runs.

---

## 4. The change, step by step

Steps 1 and 2 form commit A. Steps 3 to 5 form commit B. Step 6 forms commit C. The tree typechecks and the suite passes after step 2, after step 5, and after step 6.

### Step 1 — `src/render/escape.ts`, REPLACE

Makes the complete escaped set readable so a census can derive it. This is the extraction acceptance criterion 2 depends on; without it criterion 2 cannot be written.

FIND (exact, appears once):

```ts
const isEscapable = (char: string): boolean => FORMAT_CLASS.test(char) || isBlank(char)
```

REPLACE:

```ts
const isEscapable = (char: string): boolean => FORMAT_CLASS.test(char) || isBlank(char)

export const isEmittedEscape = (char: string): boolean =>
  isEscapable(char) ||
  MARKDOWN_LEADING_CHARS.has(char) ||
  ORDERED_LIST_PUNCTUATION.has(char) ||
  char === ORDINARY_SPACE
```

Rationale: `isEmittedEscape` is true for exactly those characters `escapeStored` can write a token for, gathering the four groups that were spread across four private declarations into one readable declaration. It changes no behaviour of `escapeStored`.

### Step 2 — `src/render/escape.ts`, REPLACE

Publishes the one place that knows a token's shape.

FIND (exact, appears once):

```ts
const toEscaped = (char: string): string => {
```

REPLACE:

```ts
export const toEscaped = (char: string): string => {
```

Rationale: the inverse and the census both need the canonical token for a code point, and a second copy of that arithmetic would drift from this one. Adding the keyword `export` changes no behaviour.

### Step 3 — `src/render/escape.ts`, REPLACE

Adds the inverse. This is the whole of acceptance criterion 1.

FIND (exact, appears once) — the new text goes immediately **before** this line, and this line is reproduced unchanged at the end of the REPLACE block:

```ts
export const clipGraphemes = (text: string, max: number): string => {
```

REPLACE:

```ts
const ESCAPE_PREFIX = 'U+'
const ESCAPE_DIGITS = /^[0-9A-F]+$/
const ESCAPE_WIDTHS = [4, 5, 6] as const
const MAX_CODE_POINT = 0x10ffff
const SURROGATE_LOW = 0xd800
const SURROGATE_HIGH = 0xdfff

const decodedEscapeAt = (chars: readonly string[], index: number): { char: string; width: number } | null => {
  for (const width of ESCAPE_WIDTHS) {
    const start = index + ESCAPE_PREFIX.length
    const digits = chars.slice(start, start + width).join('')
    if (digits.length !== width) continue
    if (!ESCAPE_DIGITS.test(digits)) continue
    const codePoint = Number.parseInt(digits, 16)
    if (codePoint > MAX_CODE_POINT) continue
    if (codePoint >= SURROGATE_LOW && codePoint <= SURROGATE_HIGH) continue
    const char = String.fromCodePoint(codePoint)
    if (toEscaped(char) !== `${ESCAPE_PREFIX}${digits}`) continue
    if (!isEmittedEscape(char)) continue
    return { char, width }
  }
  return null
}

export const unescapeStored = (text: string): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let index = 0
  while (index < chars.length) {
    const decoded = chars[index] === 'U' && chars[index + 1] === '+' ? decodedEscapeAt(chars, index) : null
    if (decoded !== null) {
      out.push(decoded.char)
      index += ESCAPE_PREFIX.length + decoded.width
      continue
    }
    out.push(chars[index] as string)
    index += 1
  }
  return out.join('')
}

export const clipGraphemes = (text: string, max: number): string => {
```

Rationale for each of the five rejections inside `decodedEscapeAt`, stated so the implementer guesses at none of them:

- `digits.length !== width` — the text ran out before a token of this width could be read.
- `!ESCAPE_DIGITS.test(digits)` — a token's digits are uppercase hexadecimal only, because `toEscaped` calls `toUpperCase`. Lowercase text is not a token this module wrote.
- `codePoint > MAX_CODE_POINT`, and the surrogate range — no character carries these numbers, so `String.fromCodePoint` would throw.
- `toEscaped(char) !== ...` — the escape pads to a minimum of four digits and never adds more, so `U+0000A` is not a form it can produce. Rejecting a non-canonical spelling stops the inverse decoding text the escape did not write.
- `!isEmittedEscape(char)` — the escape only ever writes tokens for characters in that set, so `U+0041` naming the letter `A` was typed by a person rather than written by the escape, and is left alone. This is acceptance criterion 5.

Rationale for trying widths 4, then 5, then 6 in that order: shortest first is correct only because no token is the leading part of another token, which acceptance criterion 4 turns into a test. Six is included because `toEscaped` produces six digits for any code point at or above `0x100000`, whether or not one is in the set today.

### Step 4 — `test/unit/escape.test.ts`, REPLACE

FIND (exact, appears once):

```ts
import { escapeStored, clipGraphemes } from '../../src/render/escape.ts'
```

REPLACE:

```ts
import { escapeStored, clipGraphemes, unescapeStored, isEmittedEscape, toEscaped } from '../../src/render/escape.ts'
```

Rationale: the new tests need the inverse, the population predicate and the token builder.

### Step 5 — `test/unit/escape.test.ts`, REPLACE

FIND (exact, appears once) — the new text goes immediately **before** this line:

```ts
test('clip.is-grapheme-safe', () => {
```

REPLACE: the entire fenced block of section 5.1 below, followed by that same `test('clip.is-grapheme-safe', () => {` line, unchanged.

Rationale: these are the tests that prove the inverse, and `B43` is discharged by the round-trip census among them. They are placed before the existing final test so the escape tests stay together in the file.

### Step 6 — the version, as a read-then-increment

**No literal version string appears as a FIND in this step.** Nine units bump the version before this one runs, so the value on disk at execution time is not knowable at authoring time. Every command below derives the value it writes from the value it read.

6a. Read the two current values:

```
node -p "require('./package.json').version"
node -p "require('./.claude-plugin/plugin.json').version"
```

Each exits 0 and prints one plain semantic version such as `2.5.0`. Both must print the same value; stop condition 11.5 governs the case where they do not.

6b. This unit's Conventional Commits type is `fix`, which increments the third number and leaves the first two alone. The `2.5.0` baseline recorded in section 0 makes the expected result `2.5.1`; the commands below produce the correct result whatever the two files actually hold.

6c. Write the incremented value into both files, derived from what is on disk:

```
node -e 'const fs=require("fs");const cur=JSON.parse(fs.readFileSync("package.json","utf8")).version;const p=JSON.parse(fs.readFileSync(".claude-plugin/plugin.json","utf8")).version;if(cur!==p){console.error("version mismatch: "+cur+" vs "+p);process.exit(1)}const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(cur);if(!m){console.error("not a plain semver: "+cur);process.exit(1)}const next=m[1]+"."+m[2]+"."+(Number(m[3])+1);for(const f of ["package.json",".claude-plugin/plugin.json"]){const t=fs.readFileSync(f,"utf8");const from="\"version\": \""+cur+"\"";const to="\"version\": \""+next+"\"";if(t.split(from).length-1!==1){console.error("expected exactly one version line in "+f);process.exit(1)}fs.writeFileSync(f,t.replace(from,to))}console.log("version "+cur+" -> "+next)'
```

Expect exit code 0 and one line of output of the form `version 2.5.0 -> 2.5.1`, naming the value 6a printed and that value with its third number incremented by one. A non-zero exit means the two files disagreed, the value was not a plain semantic version, or a file did not carry exactly one version line; all three are stop condition 11.5.

6d. Confirm both files now hold the same new value:

```
node -p "require('./package.json').version"
node -p "require('./.claude-plugin/plugin.json').version"
```

Each exits 0, and the two printed values are identical to each other and to the value after the arrow in 6c's output.

6e. Run:

```
node scripts/check-packaging.mjs
```

Expect exit code 0 and the output `check-packaging: ok`.

Rationale: plan invariant `P4` requires the two files to hold one value and to move in one commit, and orchestrator ruling OR6 requires the step to read the current value rather than match a hard-coded one.

---

## 5. Tests

One test file is touched: `test/unit/escape.test.ts`. It is a modified file. Section 5.1 is the exact block step 5 inserts.

### 5.1 `test/unit/escape.test.ts` — the inserted block, in full

```ts
const collectEmittedPopulation = (): number[] => {
  const collected: number[] = []
  for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint += 1) {
    if (codePoint >= SURROGATE_LOW && codePoint <= SURROGATE_HIGH) continue
    if (isEmittedEscape(String.fromCodePoint(codePoint))) collected.push(codePoint)
  }
  return collected
}

const roundTripContexts = (codePoint: number): string[] => {
  const char = String.fromCodePoint(codePoint)
  return [char, `x${char}y`, `1${char} z`, `   ${char}`, `a\n${char}b`]
}

test('escape.round-trip-census-over-the-emitted-escape-set', () => {
  const population = collectEmittedPopulation()
  assert.ok(population.length > 0)
  census(population, (codePoint) => {
    const contexts = roundTripContexts(codePoint)
    if (contexts.every((context) => escapeStored(context) === context)) return 'unclassifiable'
    const reversible = contexts.every((context) => unescapeStored(escapeStored(context)) === context)
    return reversible ? 'allowed' : 'forbidden'
  })
})

test('escape.emitted-token-alphabet-is-prefix-free', () => {
  const tokens = [...new Set(collectEmittedPopulation().map((codePoint) => toEscaped(String.fromCodePoint(codePoint))))]
  assert.ok(tokens.length > 0)
  census(tokens, (token) =>
    tokens.some((candidate) => candidate !== token && candidate.startsWith(token)) ? 'forbidden' : 'allowed'
  )
})

test('escape.unescape-leaves-text-outside-the-emitted-token-alphabet-untouched', () => {
  assert.equal(unescapeStored('U+0041'), 'U+0041')
  assert.equal(unescapeStored('U+00AB'), 'U+00AB')
  assert.equal(unescapeStored('U+ffff'), 'U+ffff')
  assert.equal(unescapeStored('U+002'), 'U+002')
  assert.equal(unescapeStored('plain pointer docs/spec.md#L12'), 'plain pointer docs/spec.md#L12')
})

test('escape.line-break-structure-survives-the-round-trip', () => {
  const heading = '# Injected\n## Also'
  assert.equal(escapeStored(heading), 'U+0023 InjectedU+000AU+0023# Also')
  assert.equal(unescapeStored(escapeStored(heading)), heading)
  const paragraphs = 'first\n\nsecond\r\nthird'
  assert.equal(unescapeStored(escapeStored(paragraphs)), paragraphs)
})

test('escape.leading-space-and-ordered-list-markers-survive-the-round-trip', () => {
  assert.equal(escapeStored('        x'), '   U+0020   U+0020x')
  assert.equal(unescapeStored('   U+0020   U+0020x'), '        x')
  assert.equal(escapeStored('1. x'), '1U+002E x')
  assert.equal(unescapeStored('1U+002E x'), '1. x')
  assert.equal(escapeStored('12) y'), '12U+0029 y')
  assert.equal(unescapeStored('12U+0029 y'), '12) y')
})

test('escape.a-hex-digit-following-a-token-is-not-absorbed-into-it', () => {
  assert.equal(escapeStored('\nB'), 'U+000AB')
  assert.equal(unescapeStored('U+000AB'), '\nB')
  assert.equal(escapeStored('\u200BF'), 'U+200BF')
  assert.equal(unescapeStored('U+200BF'), '\u200BF')
  assert.equal(unescapeStored(escapeStored('\u{E0001}')), '\u{E0001}')
})

test('escape.round-trip-is-exact-only-outside-the-emitted-token-alphabet', () => {
  assert.equal(escapeStored('U+000A'), 'U+000A')
  assert.equal(unescapeStored(escapeStored('U+000A')), '\n')
  assert.notEqual(unescapeStored(escapeStored('U+000A')), 'U+000A')
  assert.equal(unescapeStored(escapeStored('U+0041')), 'U+0041')
})

```

### 5.2 Why the five positions in `roundTripContexts` are those five

Each position exists to make one of the four transforms fire, and the census halts on any character none of them reaches.

| Position | Transform it makes fire |
|---|---|
| `char` | The character sits at the start of a line, the only place a markdown leading character is escaped |
| `x${char}y` | The character sits mid-line, where an escapable character is escaped |
| `1${char} z` | The character sits where an ordered-list marker's punctuation would be |
| `   ${char}` | The character sits as the fourth character of a leading run of spaces |
| `a\n${char}b` | The character sits at the start of a line that is not the first line |

### 5.3 Which test discharges which acceptance criterion

| Criterion | Test |
|---|---|
| 1 — the inverse exists | `escape.line-break-structure-survives-the-round-trip` |
| 2 — the census derives its population and proves reversibility | `escape.round-trip-census-over-the-emitted-escape-set` |
| 3 — the census halts rather than skipping | `escape.round-trip-census-over-the-emitted-escape-set`, with section 7's mutation as the proof it can go red |
| 4 — the token alphabet is unambiguous | `escape.emitted-token-alphabet-is-prefix-free` |
| 5 — the inverse touches only its own output alphabet | `escape.unescape-leaves-text-outside-the-emitted-token-alphabet-untouched` |
| 6 — the structure `D12` names is restored | `escape.line-break-structure-survives-the-round-trip`, `escape.leading-space-and-ordered-list-markers-survive-the-round-trip`, `escape.a-hex-digit-following-a-token-is-not-absorbed-into-it` |
| 7 — zero transforms are uninvertible | `escape.round-trip-census-over-the-emitted-escape-set` passing over the whole derived population is the measurement |
| 8 — the limitation is asserted, not silent | `escape.round-trip-is-exact-only-outside-the-emitted-token-alphabet` |
| 9 — the two versions agree | `node scripts/check-packaging.mjs` |
| 10 — the suite and the typecheck are green | `npm test` and `npm run typecheck` |

**No `A#`, `O#` or `S#` invariant is assigned to this unit**, so there is no invariant row to add to this table.

### 5.4 Tests that already exist and are not duplicated

`test/unit/escape.test.ts` already holds six tests covering what the escape produces. None of them calls the inverse, and none is changed, deleted, skipped, focused or weakened by this plan. The new tests cover the opposite direction, which no existing test covers.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time. No sha can be written here: this unit is cut after nine other units have merged, so the value does not exist at authoring time.

Record it once, immediately after cutting the branch, and use the value it prints wherever this section says "the parent":

```
git rev-parse HEAD
```

Expect exit code 0 and one 40-character hexadecimal sha.

### 6.1 The honest statement first

**These tests cannot be run red on the parent as an assertion failure, because they do not load there.** `unescapeStored`, `isEmittedEscape` and `toEscaped` are not exported from `src/render/escape.ts` at the parent, so the test file fails to link before any assertion runs. This is stated rather than worked around. Section 6.3 gives the substitute procedure that produces a genuine assertion failure.

### 6.2 The link failure, exactly

Apply step 4 and step 5 only — the two test edits — to a checkout of the parent, leaving `src/render/escape.ts` untouched. Then run:

```
node --test test/unit/escape.test.ts
```

Expect exit code 1. The run reports `fail 1` and prints:

```
SyntaxError: The requested module '../../src/render/escape.ts' does not provide an export named 'isEmittedEscape'
```

And run:

```
npm run typecheck
```

Expect a non-zero exit and these three errors:

```
test/unit/escape.test.ts(3,39): error TS2724: '"../../src/render/escape.ts"' has no exported member named 'unescapeStored'. Did you mean 'escapeStored'?
test/unit/escape.test.ts(3,55): error TS2305: Module '"../../src/render/escape.ts"' has no exported member 'isEmittedEscape'.
test/unit/escape.test.ts(3,72): error TS2459: Module '"../../src/render/escape.ts"' declares 'toEscaped' locally, but it is not exported.
```

Then restore the test file before continuing:

```
git checkout -- test/unit/escape.test.ts
```

Expect exit code 0 and no output. Confirm with `git status --short test/unit/escape.test.ts`, which exits 0 and prints nothing.

### 6.3 The substitute procedure — a genuine red with a real assertion

Apply steps 1, 2, 4 and 5, and apply step 3 with `unescapeStored` replaced by the do-nothing version below. Everything then links, and the census runs against an inverse that inverts nothing.

Use this in place of step 3's `unescapeStored`, keeping `decodedEscapeAt` and the six constants exactly as step 3 gives them:

```ts
export const unescapeStored = (text: string): string => text
```

Run:

```
node --test test/unit/escape.test.ts
```

Expect exit code 1, `pass 9`, `fail 5`, and these five tests failing:

```
escape.round-trip-census-over-the-emitted-escape-set
escape.line-break-structure-survives-the-round-trip
escape.leading-space-and-ordered-list-markers-survive-the-round-trip
escape.a-hex-digit-following-a-token-is-not-absorbed-into-it
escape.round-trip-is-exact-only-outside-the-emitted-token-alphabet
```

The census fails with exactly this message:

```
Error: census rejected a forbidden item: 0
```

Then put step 3's real `unescapeStored` in place and re-run the same command. Expect exit code 0 and `pass 14`, `fail 0`.

---

## 7. Inertness mutation

One mutation, covering acceptance criteria 1, 2, 3 and 6, which are the criteria carrying a behavioural change. Criteria 4, 5 and 8 are addressed in 7.2.

### 7.1 The mutation

**Edit to make.** In `src/render/escape.ts`, replace the whole body of `unescapeStored` with the do-nothing version. FIND (exact, appears once):

```ts
export const unescapeStored = (text: string): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let index = 0
  while (index < chars.length) {
    const decoded = chars[index] === 'U' && chars[index + 1] === '+' ? decodedEscapeAt(chars, index) : null
    if (decoded !== null) {
      out.push(decoded.char)
      index += ESCAPE_PREFIX.length + decoded.width
      continue
    }
    out.push(chars[index] as string)
    index += 1
  }
  return out.join('')
}
```

REPLACE:

```ts
export const unescapeStored = (text: string): string => text
```

**Command to run.**

```
node --test test/unit/escape.test.ts
```

**Expected result.** Exit code 1, `pass 9`, `fail 5`. The census test fails with exactly:

```
Error: census rejected a forbidden item: 0
```

**Exact restore.** Reverse the FIND and REPLACE above — put the full body back exactly as step 3 gives it — then re-run the same command and expect exit code 0 with `pass 14`, `fail 0`.

### 7.2 The three tests that survive this mutation, and why that is correct

Stated rather than left for the implementer to notice.

- `escape.emitted-token-alphabet-is-prefix-free` never calls `unescapeStored`. It asserts a property of what the escape produces, which is the precondition the inverse relies on. It is not a receipt for the inverse and is not claimed as one.
- `escape.unescape-leaves-text-outside-the-emitted-token-alphabet-untouched` passes under the do-nothing version, because leaving text alone is exactly what the do-nothing version does. It is a receipt for the inverse being narrow, not for it working, and section 5.3 lists it against criterion 5 only.
- `clip.is-grapheme-safe` is a pre-existing test of an unrelated function.

The census in 7.1 is the receipt for the inverse working. It goes red under the mutation, which is the proof.

---

## 8. Full verification

Run in this order, from the repository root.

| # | Command | Expected exit | Output substring that proves it |
|---|---|---|---|
| 1 | `npm run typecheck` | 0 | no output at all |
| 2 | `node --test test/unit/escape.test.ts` | 0 | `pass 14` and `fail 0` |
| 3 | `node scripts/check-packaging.mjs` | 0 | `check-packaging: ok` |
| 4 | `npm test` | 0 | `fail 0` |

**Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository and an install rewrites tracked files.

On command 4, the whole-suite test count rises by exactly 7 over the parent, because this plan adds seven tests and changes none.

Command 4 is governed by the stop condition in section 11.1, which permits exactly one re-run and only under the condition stated there. No re-run is permitted for command 2, for section 6, or for section 7.

---

## 9. Commits

Three commits. The refactor and the behaviour change are in separate commits.

### Commit A — refactor

```
refactor(escape): make the escaped character set readable outside the module
```

Files: `src/render/escape.ts`
Plan steps: 1, 2

Behaviour is unchanged. `isEmittedEscape` is added and `toEscaped` gains the `export` keyword. `escapeStored` is not touched. The tree typechecks and the whole suite passes at this commit, with the test count unchanged from the parent.

### Commit B — behaviour

```
fix(escape): add the proven inverse of the stored-text escape
```

Files: `src/render/escape.ts`, `test/unit/escape.test.ts`
Plan steps: 3, 4, 5

### Commit C — version

```
chore(escape): bump the plugin version for the write-fidelity fix
```

Files: `package.json`, `.claude-plugin/plugin.json`
Plan step: 6

---

## 10. Pull request

### Measured diff size, and the split ruling

Measured by applying every step of this plan to a throwaway copy of the tree outside the working tree and reading `git diff --numstat`. Not estimated.

| Part | Added | Removed | Changed |
|---|---|---|---|
| `src/render/escape.ts` | 48 | 1 | 49 |
| `test/unit/escape.test.ts` | 74 | 1 | 75 |
| `package.json` | 1 | 1 | 2 |
| `.claude-plugin/plugin.json` | 1 | 1 | 2 |
| **Total** | **124** | **4** | **128** |

Production 53 changed lines, tests 75 changed lines.

**Ruling: no split.** 128 changed lines sits below the ~200-line target and well below the 400-line ceiling, and the unit carries a single behavioural rule whose receipt is one census.

### The invocation

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head fix/u10-write-fidelity --base main \
  --title "fix(escape): add the proven inverse of the stored-text escape" \
  --what "Text stored by the ledger can now be turned back into what the caller wrote, because the reverse of the escape step exists for the first time." \
  --what "A test walks every character the escape can rewrite, reads that list from the shipped code rather than from a list in the test, and fails when any one of them cannot be turned back." \
  --why "The escape step rewrote line breaks, indents and list markers into placeholder text on the way into storage, and nothing anywhere could turn them back, so structure was lost silently." \
  --risk "A value whose raw text already contains a placeholder is turned back into the character that placeholder names. That case is asserted by a test and recorded as a known limit, not fixed here." \
  --verified "node --test test/unit/escape.test.ts - 14 pass, 0 fail, exit 0" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok, exit 0" \
  --verified "npm test - 0 fail, exit 0" \
  --verified "round-trip check over every rewritable character - 0 not reversible" \
  --verified "emptying the reverse step to a do-nothing version - 5 tests turn red, restored to 0 fail" \
  --not-verified "npm run mutate - not run"
```

Two rules bind the `--verified` lines above, restated because a fabricated verification is worse than an absent one:

- Every one of those lines is written only after the implementer has run that command and read that result. A command that was not run becomes `--not-verified "<thing> - not run"`.
- Where the section 11.1 stop condition's single re-run is used, add `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` to the invocation. It is disclosed every time it is used.

A pull request title and body are fixed at creation and are never rewritten afterwards. Do not run `gh pr create`, `gh api` against the pulls endpoint, `gh pr edit`, or the GitHub tool that creates pull requests; all of them are denied at the gate.

---

## 11. Stop conditions

### 11.1 The one known tracked failure in the suite

Applies only to `npm test` in section 8. It does not apply to section 6, to section 7, or to any acceptance criterion.

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

### 11.2 The external gate — another line of work shares this file

A separate thread of work has open items in `src/render/escape.ts` that change **which** characters are escaped. This plan is written to absorb that change without editing: the census reads the character set from the shipped module every time it runs, so a widened set is covered automatically, and no count appears in any test.

**This planner could not author an honest code-side test for whether that work has landed**, because the characters it adds are not knowable from the repository and this planner had no permitted way to look them up. What is authored instead is a check that the five edit sites this plan targets are still exactly as this plan found them.

Run, from the repository root:

```
grep -Fxc "const isEscapable = (char: string): boolean => FORMAT_CLASS.test(char) || isBlank(char)" src/render/escape.ts
grep -Fxc "const toEscaped = (char: string): string => {" src/render/escape.ts
grep -Fxc "export const clipGraphemes = (text: string, max: number): string => {" src/render/escape.ts
grep -Fxc "import { escapeStored, clipGraphemes } from '../../src/render/escape.ts'" test/unit/escape.test.ts
grep -Fxc "test('clip.is-grapheme-safe', () => {" test/unit/escape.test.ts
```

Every one of the five must exit 0 and print exactly `1`. Note that `grep -Fxc` exits 1 when its count is `0`, which is the failure path this stop condition exists for.

If any prints `0`, or a number above `1`, the file has moved under this plan and the FIND strings in section 4 no longer apply. **STOP and report; do not improvise.** Say which of the five commands printed what. Do not adjust a FIND string to make it match.

Additionally, and separately from those five: **before starting, confirm with the operator that the other thread's escape-coverage work has landed.** This plan's census runs over the final character set only when that work is already in the file. That confirmation cannot be obtained from the repository, so it is asked for rather than guessed at.

### 11.3 The census cannot classify a member, or rejects one

Run:

```
node --test test/unit/escape.test.ts
```

A failure reading:

```
Error: census halted on an unclassifiable item: <number>
```

means the module treats a character as escapable that none of the five positions in `roundTripContexts` causes it to escape. That is a new transform shape this plan did not anticipate. **STOP and report; do not improvise.** Give the number the message printed. Do not remove that character from the population, do not add a sixth position, and do not change the classifier to return `allowed`.

A failure reading:

```
Error: census rejected a forbidden item: <number>
```

on the finished change — not during section 6 or section 7, where it is expected — means a transform in the escaped set cannot be inverted. **STOP and report; do not improvise.** Give the number the message printed.

### 11.4 The token alphabet has become ambiguous

A failure of `escape.emitted-token-alphabet-is-prefix-free` reading:

```
Error: census rejected a forbidden item: "U+..."
```

means one token the escape can produce is now the leading part of another, which breaks the rule the inverse uses to decide where a token ends. **STOP and report; do not improvise.** Give the token the message printed. Do not change the order of `ESCAPE_WIDTHS`, and do not remove a width from it.

### 11.5 The two version files disagree before the change

Run:

```
node -p "require('./package.json').version"
node -p "require('./.claude-plugin/plugin.json').version"
```

Each exits 0 and prints one plain semantic version. If the two values differ from each other, **STOP and report; do not improvise.**

A value merely higher than the `2.5.0` baseline is **not** a stop condition — it means the ladder shifted. Take the value the two files agree on, increment its third number by one, and use that.
