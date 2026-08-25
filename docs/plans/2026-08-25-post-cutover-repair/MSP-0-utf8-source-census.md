# MSP-0 — Make the tree greppable

## 0. Identity

| Field | Value |
| --- | --- |
| **Closes** | Defect D16 — a source file is invisible to `grep`. |
| **Depends on** | Nothing. This is the first rung of the ladder. |
| **Required by** | MSP-5 and MSP-8. Both add a census axis that scans source, and a census added over a tree containing an ungreppable file reports a false green. |
| **Branch name** | `fix/msp-0-utf8-source-census`, cut from `main`. The pull request targets `main`. |
| **Version bump** | Baseline `1.0.0` -> `1.0.1` per orchestrator ruling O1. The step in section 4 is written as a read-then-increment, so a shifted ladder does not invalidate it. This pull request also permanently removes the version literal from `test/contract/cutover-manifests-agree.test.ts`, so no later change has to touch that file to bump a version. |
| **SPEC anchors** | Section 7 MSP-0; section 5 defect D16; section 4 invariants I1, I4, I5, I7, I8, I9. Provenance only — you do not need to open the SPEC. Everything from it that binds this work is quoted verbatim below. |

**Definitions, because this plan assumes no prior knowledge.**

- **Census.** A test that enumerates a complete population, classifies every member, and fails
  if any member is either *forbidden* or *unclassifiable*. It is not a spot check and it is not
  a sample. The repository already has one helper for this, `test/support/census.ts`.
- **Unclassifiable.** A population member the classifier has no rule for. A census halts on it
  rather than ignoring it, so that a new kind of thing forces a decision instead of slipping
  through.
- **NUL byte.** The single byte `0x00`. It is legal UTF-8 (it encodes the character U+0000),
  but `grep`, `file`, `git diff` and most editors treat any file containing one as *binary*
  and refuse to print its contents.
- **Red on the parent.** The new test must FAIL on the commit the branch was cut from, and pass
  after the fix. A test that has never failed proves nothing.

---

## 1. Acceptance criteria (the ceiling)

Verbatim from SPEC section 7, MSP-0:

> **Acceptance:**
> 1. A committed test enumerates every file under `src/`, `hooks/` and `bin/` and asserts each
>    decodes as UTF-8. It is a census: it halts on the unclassifiable, with no pinned count and no
>    allowlist.
> 2. That test is **red on the parent commit** and green on the fix.
> 3. `npm test` green.

These three criteria are the complete definition of done for this pull request. Anything you
discover above them goes to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item
with its evidence, and is **not** folded into this change.

Which step discharges which criterion:

| Criterion | Discharged by |
| --- | --- |
| 1 | Step 2 of section 4 — the new file `test/contract/source-is-greppable-text.test.ts`, test `contract.source-is-greppable-text`, plus its five control tests. |
| 2 | Section 6 (red on the parent) and section 7 (inertness mutation). |
| 3 | Section 8, command V5. Step 3 of section 4 is part of reaching it: without the de-pin, the version bump in step 4 turns `npm test` red and criterion 3 is unreachable. |

---

## 2. Ground truth

### 2.1 `src/server/tools/resolve_conflict.ts`, line 275 — the defect

The file is 26781 bytes and 654 lines. It contains exactly **one** byte `0x00`, at **0-based
byte offset 11234**, on **line 275**, at **column 68 counting bytes from the start of that
line**. It is a lone byte, not part of a multi-byte sequence.

Raw evidence, `xxd -s 11186 -l 96 src/server/tools/resolve_conflict.ts`:

```
00002bb2: 7264 3a20 7374 7269 6e67 2c20 6669 656c  rd: string, fiel
00002bc2: 643a 2073 7472 696e 6729 3a20 7374 7269  d: string): stri
00002bd2: 6e67 203d 3e20 6024 7b72 6563 6f72 647d  ng => `${record}
00002be2: 0024 7b66 6965 6c64 7d60 0a0a 636f 6e73  .${field}`..cons
00002bf2: 7420 6279 4964 4173 6365 6e64 696e 6720  t byIdAscending 
00002c02: 3d20 2861 3a20 7b20 6964 3a20 7374 7269  = (a: { id: stri
```

`11234` is `0x2BE2`. The `00` opening that fourth row is the byte; `xxd` renders it as `.` in
the right-hand column. The bytes either side are `0x7D` (`}`) at column 67 and `0x24` (`$`) at
column 69.

Line 275 with the offending byte written as an escape at its exact position:

```
const keyOf = (record: string, field: string): string => `${record}\x00${field}`
```

Lines 272 to 278, decoded byte-for-byte, with only that one byte escaped:

```
272 |   }
273 | }
274 |
275 | const keyOf = (record: string, field: string): string => `${record}\x00${field}`
276 |
277 | const byIdAscending = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
278 |
```

Observed consequences, each command run and its literal output recorded:

```
$ file src/server/tools/resolve_conflict.ts
src/server/tools/resolve_conflict.ts: data

$ /usr/bin/grep -n 'export' src/server/tools/resolve_conflict.ts
Binary file src/server/tools/resolve_conflict.ts matches
```

**What is wrong with it.** The byte is a deliberate composite-key separator written as a raw
control character instead of as a two-character escape. `keyOf` builds a `Map` key from a record
id and a field name; the separator is never rendered to a user. The raw byte is legal
ECMAScript inside a template literal, so the code compiles and runs — but it makes the whole
654-line file binary to `grep`, to `file`, and to `git diff`, which is the defect. The repair is
**substitution**, not deletion: replace the one byte `0x00` with the two bytes `0x5C 0x30`, the
escape `\0`, which produces a byte-identical key string at runtime.

Runtime equivalence, observed:

```
$ node -e "const a = 'r' + String.fromCharCode(0) + 'f'; const b = \`r\0f\`; console.log(a === b)"
true
```

The rest of the file is pure ASCII: zero bytes `>= 0x80`, zero TAB, zero CR, and no other C0
control byte. A strict UTF-8 decode of the file **passes** — see section 3, divergence 3.1.

### 2.2 `test/support/census.ts` — the halting helper to reuse

Current file, all 24 lines, complete and verbatim:

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

Nothing in this file changes. The new test imports `census` and the `Classified` type from it,
exactly as twenty-six existing test files already do.

### 2.3 `test/support/source-census.ts` — why it is NOT the machinery for this census

`test/support/source-census.ts:43-70` exports `loadSourceProgram`, which builds a TypeScript
`Program` from `tsconfig.json` and partitions its root file names into production and test
files. Verbatim, lines 17-35:

```ts
const loadProgram = (): ts.Program => {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(
      `loadSourceProgram: failed to read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
    )
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(TSCONFIG_PATH))
  if (parsed.errors.length > 0) {
    const rendered = parsed.errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')
    throw new Error(`loadSourceProgram: failed to parse ${TSCONFIG_PATH}: ${rendered}`)
  }
  if (parsed.fileNames.length === 0) {
    throw new Error(`loadSourceProgram: ${TSCONFIG_PATH} resolved zero source files`)
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}
```

**What is wrong with it for this job.** Its population is the tsconfig include set, which is
`["src/**/*.ts", "bin/**/*.ts", "hooks/**/*.ts", "test/**/*.ts"]` — TypeScript files only. It
would silently omit `hooks/hooks.json`, and it hands back parsed syntax trees rather than raw
bytes, so it cannot answer "what bytes are in this file". Criterion 1 says *every file* under
the three roots, not every TypeScript file. This census therefore walks the filesystem itself.

### 2.4 The two version manifests

`package.json`, line 3:

```json
  "version": "1.0.0",
```

`.claude-plugin/plugin.json`, line 3:

```json
  "version": "1.0.0",
```

**What is wrong with them.** Nothing, today. They are listed because invariant I4 requires them
to move together in one commit, and because the test in 2.5 reads them.

### 2.5 `test/contract/cutover-manifests-agree.test.ts` — the pinned version constant

Line 8:

```ts
const EXPECTED_VERSION = '1.0.0'
```

and the three places the test compares against it, lines 52-67 and 77:

```ts
  const packageJsonVersion = readManifestVersion(packageJsonPath)
  assert.strictEqual(typeof packageJsonVersion, 'string')
  assert.strictEqual(
    packageJsonVersion,
    EXPECTED_VERSION,
    `${packageJsonPath} version is ${packageJsonVersion}, expected ${EXPECTED_VERSION}`
  )

  const pluginJsonPath = path.join(repoRoot, '.claude-plugin', 'plugin.json')
  const pluginJsonVersion = readManifestVersion(pluginJsonPath)
  assert.strictEqual(typeof pluginJsonVersion, 'string')
  assert.strictEqual(
    pluginJsonVersion,
    EXPECTED_VERSION,
    `${pluginJsonPath} version is ${pluginJsonVersion}, expected ${EXPECTED_VERSION}`
  )
```

```ts
    assert.strictEqual(info.version, EXPECTED_VERSION)
```

**What is wrong with it.** Line 8 is a hard-pinned copy of the version string. `npm test`
compares both manifests and the running server's wire version against it, so bumping the two
manifests turns `npm test` red — which makes acceptance criterion 3 unreachable. Observed, after
bumping both manifests to `1.0.1` and leaving line 8 alone:

```
✖ cutover.manifests-agree
  AssertionError [ERR_ASSERTION]: .../package.json version is 1.0.1, expected 1.0.0
ℹ pass 0
ℹ fail 1
```

`node scripts/check-packaging.mjs` still printed `check-packaging: ok` in that state, so the
packaging check does **not** catch this.

It is not only this pull request's problem: every rung of the repair ladder bumps the version, so
this same constant fails all of them. This pull request removes it permanently rather than
re-typing a new literal into it ten times. Step 3 of section 4 does that, and it is in scope
under acceptance criterion 3 — a test that makes `npm test` unreachably red is exactly what
criterion 3 forbids — not an addition above the ceiling.

The rest of the file is sound and is not touched. In particular `PACKAGE_JSON_LEG_IS_NEAR_TAUTOLOGICAL`
at lines 12-13 stays, because the assertion that uses it at lines 79-83 stays.

---

## 3. Divergences from the SPEC

### 3.1 The byte is a NUL, and a NUL is valid UTF-8

SPEC section 5, D16 states: *"`src/server/tools/resolve_conflict.ts` contains a non-UTF-8 byte."*
That characterisation is wrong. The byte is `0x00`, which is a **valid** UTF-8 encoding of
U+0000. A strict decode succeeds. Observed:

```
$ node -e "const b=require('node:fs').readFileSync('src/server/tools/resolve_conflict.ts'); try { new TextDecoder('utf-8',{fatal:true}).decode(b); console.log('STRICT UTF-8 DECODE: PASS') } catch (e) { console.error('FAIL ' + e.message) }"
STRICT UTF-8 DECODE: PASS
```

A sweep of every file under `src/`, `hooks/` and `bin/` found **zero** strict-UTF-8 decode
failures and exactly one file containing a NUL — this one.

**Ruling applied.** D16's observable claim — `file` reports the file as `data` and `grep`
returns nothing for it — is correct and is reproduced verbatim in section 2.1. Only its
explanation of the cause is wrong. The fix and the census are authored against the observed
cause.

### 3.2 A UTF-8-only census cannot be red on the parent, so the census carries a NUL axis too

This follows directly from 3.1. Acceptance criterion 1 asks for a census asserting each file
"decodes as UTF-8". Criterion 2 requires that census to be **red on the parent commit**. On the
parent, every file under the three roots decodes as UTF-8, so a UTF-8-only census is green
there and criterion 2 becomes unsatisfiable.

**Ruling applied.** The census classifies a file as *allowed* only when it both decodes as
strict UTF-8 **and** contains no NUL byte. The UTF-8 assertion is kept because criterion 1 asks
for it in those words; the NUL assertion is added because it is the only rule that is red on the
parent and because it is the rule that actually encodes what D16 describes — that the file is
not text to `grep`. This is required *by* the criteria, not added above them.

Rejected alternative: assert only "no NUL byte" and drop the UTF-8 decode. Rejected in one
line — criterion 1 names the UTF-8 decode explicitly, and dropping it would leave a genuinely
mis-encoded file undetected by the later census work this one is a prerequisite for.

### 3.3 The ladder lands on 1.1.1, not 1.1.0

SPEC section 7 states the ladder lands on `1.1.0`. The documentation change of this repair
ladder merges last, so the ladder in fact lands on `1.1.1`. This changes nothing in this plan; it is
restated so no reader reconciles the two numbers themselves.

### 3.4 The pull request tool path

SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib`
directory in this repository. The tool is the operator's global one at
`node ~/.claude/lib/git/pr.mjs pr-create`, and section 10 uses that path.

### 3.5 This pull request also de-pins the manifest-agreement test

SPEC section 7 MSP-0 describes this change as removing one byte and adding one census. It says
nothing about `test/contract/cutover-manifests-agree.test.ts`.

The evidence in section 2.5 shows that acceptance criterion 3, `npm test` green, is unreachable
while line 8 of that file pins the version to a literal and this pull request bumps the version.
The repair is therefore what reaching the declared criterion requires, not an addition above it.

**Ruling applied.** Step 3 of section 4 de-pins the test permanently: it derives the expected
version by reading `package.json` and asserts that `.claude-plugin/plugin.json` agrees with it,
which is what the test's own name — `cutover.manifests-agree` — already claims it does. The
two-manifest agreement is the invariant worth testing; the literal string `1.0.0` is not.

Rejected alternative: re-pin the constant to `1.0.1`. Rejected in one line — it makes the next
version bump fail in exactly the same way, and a test whose only content is a copy of the value
it checks is a change-detector test the project standard forbids outright.

---

## 4. The change, step by step

Apply these in order. After each step the tree is type-correct.

Every command in this plan is run from the repository root,
`/Users/satanshumishra/Documents/DevLabs/logbook`.

### Step 0 — cut the branch

File: none — this step creates no file and edits none. Operation: **NONE**; it is a branch cut,
and it is numbered so the steps below can be applied in order without ambiguity about where.

Command:

```
git switch -c fix/msp-0-utf8-source-census main
```

Expected: exit code `0`, and stdout or stderr contains `Switched to a new branch 'fix/msp-0-utf8-source-census'`.

Rationale: every change in this plan lands on its own branch cut from `main`, and the pull
request in section 10 targets `main`; committing to `main` directly is not permitted.

### Step 1 — remove the NUL byte from `src/server/tools/resolve_conflict.ts`

File: `src/server/tools/resolve_conflict.ts`. Operation: **REPLACE**, one byte.

**Do not attempt this with a text editor or with a FIND/REPLACE string.** The byte being
replaced is `0x00`, which cannot be typed into a search string and which most tooling will
silently drop or transform. Run this command exactly as written:

```
node -e "const fs=require('node:fs');const p='src/server/tools/resolve_conflict.ts';const before=fs.readFileSync(p);const o=[];for(let i=0;i<before.length;i+=1)if(before[i]===0)o.push(i);if(o.length!==1){console.error('STOP: expected exactly one NUL byte, found '+o.length+' at ['+o.join(',')+']');process.exit(1)}const at=o[0];const after=Buffer.concat([before.subarray(0,at),Buffer.from([0x5c,0x30]),before.subarray(at+1)]);fs.writeFileSync(p,after);console.log('replaced NUL at byte offset '+at+'; '+before.length+' -> '+after.length+' bytes')"
```

Expected exit code: `0`. Expected stdout, exactly:

```
replaced NUL at byte offset 11234; 26781 -> 26782 bytes
```

The command refuses and exits `1` without writing if the file does not carry exactly one NUL
byte. If it exits `1`, stop and follow section 11.

`Buffer.from([0x5c, 0x30])` is the two bytes `\` and `0` — the escape sequence `\0` — written
as byte values so that no shell or editor escaping can corrupt it.

**Verify the result of this step** before continuing:

```
sed -n '275p' src/server/tools/resolve_conflict.ts
```

Expected exit code `0` and this exact single line of output:

```
const keyOf = (record: string, field: string): string => `${record}\0${field}`
```

Rationale: SPEC section 7 MSP-0 says *"Remove the non-UTF-8 byte from
`src/server/tools/resolve_conflict.ts` so the file is text to `grep` and to every census that
scans source."* Substitution rather than deletion preserves the key string byte-for-byte at
runtime, as shown in section 2.1.

### Step 2 — create the census test

File: `test/contract/source-is-greppable-text.test.ts`. Operation: **CREATE**.

This file does not exist. Create it with exactly these contents, first character to last:

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { census, type Classified } from '../support/census.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SCANNED_ROOTS = ['src', 'hooks', 'bin'] as const

const NUL_BYTE = 0

export type SourceByteEntry = { path: string; entryKind: 'regular-file' | 'other' }

const walkRoot = (absoluteDir: string, relativeDir: string): SourceByteEntry[] =>
  readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(absoluteDir, entry.name)
    const relative = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) return walkRoot(absolute, relative)
    if (entry.isFile()) return [{ path: relative, entryKind: 'regular-file' as const }]
    return [{ path: relative, entryKind: 'other' as const }]
  })

export const scanSourceRoots = (projectRoot: string): SourceByteEntry[] =>
  SCANNED_ROOTS.flatMap((root) => walkRoot(path.join(projectRoot, root), root))

const readBytes = (absolutePath: string): Buffer | null => {
  try {
    return readFileSync(absolutePath)
  } catch {
    return null
  }
}

export const classifySourceBytes = (
  projectRoot: string,
  entry: SourceByteEntry
): Classified<SourceByteEntry>['verdict'] | 'unclassifiable' => {
  if (entry.entryKind !== 'regular-file') return 'unclassifiable'
  const bytes = readBytes(path.join(projectRoot, entry.path))
  if (bytes === null) return 'unclassifiable'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'forbidden'
  }
  return bytes.includes(NUL_BYTE) ? 'forbidden' : 'allowed'
}

const describePopulation = (projectRoot: string, population: readonly SourceByteEntry[]): string => {
  const violations = population.filter((entry) => classifySourceBytes(projectRoot, entry) !== 'allowed')
  return [
    `contract.source-is-greppable-text: ${violations.length} of ${population.length} scanned entries are not greppable text`,
    ...violations.map((entry) => `${entry.path} [${classifySourceBytes(projectRoot, entry)}]`)
  ].join('\n')
}

test('contract.source-is-greppable-text', () => {
  const population = scanSourceRoots(PROJECT_ROOT)
  for (const root of SCANNED_ROOTS) {
    assert.ok(
      population.some((entry) => entry.path.startsWith(`${root}/`)),
      `contract.source-is-greppable-text: the walk found no entry under ${root}/; a census over a missing root proves nothing`
    )
  }
  assert.doesNotThrow(
    () => census(population, (entry) => classifySourceBytes(PROJECT_ROOT, entry)),
    describePopulation(PROJECT_ROOT, population)
  )
})

test('contract.source-is-greppable-text.control.a-nul-byte-is-forbidden-and-named', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-nul-'))
  writeFileSync(path.join(fixtureRoot, 'carries-a-nul.ts'), Buffer.from([0x61, 0x00, 0x62]))
  const entry: SourceByteEntry = { path: 'carries-a-nul.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'forbidden')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('carries-a-nul.ts')
  )
})

test('contract.source-is-greppable-text.control.an-invalid-utf8-byte-is-forbidden-and-named', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-utf8-'))
  writeFileSync(path.join(fixtureRoot, 'carries-a-lone-continuation.ts'), Buffer.from([0x61, 0xff, 0x62]))
  const entry: SourceByteEntry = { path: 'carries-a-lone-continuation.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'forbidden')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('carries-a-lone-continuation.ts')
  )
})

test('contract.source-is-greppable-text.control.plain-utf8-text-is-allowed', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-plain-'))
  writeFileSync(path.join(fixtureRoot, 'plain.ts'), 'export const value = 1\n', 'utf8')
  const entry: SourceByteEntry = { path: 'plain.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'allowed')
  assert.doesNotThrow(() => census([entry], (item) => classifySourceBytes(fixtureRoot, item)))
})

test('contract.source-is-greppable-text.control.an-entry-that-is-not-a-regular-file-halts-the-census', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-other-'))
  const entry: SourceByteEntry = { path: 'a-named-pipe', entryKind: 'other' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'unclassifiable')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('a-named-pipe')
  )
})

test('contract.source-is-greppable-text.control.an-unreadable-file-halts-the-census', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-missing-'))
  const entry: SourceByteEntry = { path: 'never-written.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'unclassifiable')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('never-written.ts')
  )
})
```

Rationale and the choices made, each with the option rejected in one line:

- **A new file, not an extension of an existing one.** No existing test file censuses raw file
  *bytes*: `test/support/source-census.ts` is a TypeScript-program helper whose population is
  the tsconfig include set (section 2.3), and `test/contract/cutover-old-tree-absent.test.ts`
  censuses git-tracked *path strings* for legacy modules, a different population answering a
  different question. Rejected: adding these tests to `cutover-old-tree-absent.test.ts`, which
  would put two unrelated populations behind one file name.
- **The halting helper is reused, not reinvented.** The file imports `census` and `Classified`
  from `test/support/census.ts`, matching the idiom of the twenty-six test files that already
  do. Rejected: a local loop with its own throw, which would give a different failure message
  from every other census in the suite.
- **The population is a filesystem walk, so it includes non-TypeScript files.** `hooks/hooks.json`
  is in the population. Rejected: `loadSourceProgram()`, which omits it.
- **Non-empty population is asserted per root, not as a total count.** Invariant I8 forbids a
  pinned count; asserting each of the three roots contributed at least one entry proves the
  walk reached all three without pinning a number. Rejected: `assert.equal(population.length, 73)`,
  which is a pinned count and would fail on the next file added.
- **Anything that is not a regular file is unclassifiable, not skipped.** A symbolic link, a
  socket or a named pipe under these roots halts the census and forces a decision. Rejected:
  filtering non-regular entries out of the walk, which is exactly the "leave it out of the
  population" move invariant I8 forbids.
- **Every fixture is a temp directory.** Invariant I7 — this repository *is* the installed
  plugin, and no test may observe the running plugin's own state. All five controls call
  `mkdtempSync` under the OS temp directory.
- **No comments anywhere.** Invariant I5. The file above contains none; do not add any.

### Step 3 — de-pin the manifest-agreement test

File: `test/contract/cutover-manifests-agree.test.ts`. Operation: **REPLACE**, three edits.

**Edit 3a.** FIND (exact, and the only occurrence in the file):

```ts
const EXPECTED_VERSION = '1.0.0'
const REPO_ROOT_MARKER = path.join('.claude-plugin', 'plugin.json')
```

REPLACE (exact):

```ts
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
const REPO_ROOT_MARKER = path.join('.claude-plugin', 'plugin.json')
```

**Edit 3b.** FIND (exact, and the only occurrence in the file):

```ts
  const packageJsonVersion = readManifestVersion(packageJsonPath)
  assert.strictEqual(typeof packageJsonVersion, 'string')
  assert.strictEqual(
    packageJsonVersion,
    EXPECTED_VERSION,
    `${packageJsonPath} version is ${packageJsonVersion}, expected ${EXPECTED_VERSION}`
  )

  const pluginJsonPath = path.join(repoRoot, '.claude-plugin', 'plugin.json')
  const pluginJsonVersion = readManifestVersion(pluginJsonPath)
  assert.strictEqual(typeof pluginJsonVersion, 'string')
  assert.strictEqual(
    pluginJsonVersion,
    EXPECTED_VERSION,
    `${pluginJsonPath} version is ${pluginJsonVersion}, expected ${EXPECTED_VERSION}`
  )
```

REPLACE (exact):

```ts
  const packageJsonVersion = readManifestVersion(packageJsonPath)
  assert.match(
    packageJsonVersion,
    SEMVER_PATTERN,
    `${packageJsonPath} version is ${packageJsonVersion}, which is not a plain three-part semver; every other version assertion in this test is derived from it`
  )

  const pluginJsonPath = path.join(repoRoot, '.claude-plugin', 'plugin.json')
  const pluginJsonVersion = readManifestVersion(pluginJsonPath)
  assert.strictEqual(
    pluginJsonVersion,
    packageJsonVersion,
    `${pluginJsonPath} version is ${pluginJsonVersion}, but ${packageJsonPath} version is ${packageJsonVersion}`
  )
```

**Edit 3c.** FIND (exact, and the only occurrence in the file):

```ts
    assert.strictEqual(info.name, 'logbook')
    assert.strictEqual(info.version, EXPECTED_VERSION)
```

REPLACE (exact):

```ts
    assert.strictEqual(info.name, 'logbook')
```

After these three edits the file is 89 lines and the identifier `EXPECTED_VERSION` appears
nowhere in it. Confirm both:

```
wc -l test/contract/cutover-manifests-agree.test.ts
grep -c EXPECTED_VERSION test/contract/cutover-manifests-agree.test.ts
```

Expected: the first prints `89`; the second prints `0` and exits `1`, which is what `grep -c`
does when it finds nothing.

Rationale, and why the surviving assertions are not vacuous — this is the one thing to get right
here. Removing the pinned literal deletes three assertions and two redundant `typeof` guards, and
leaves **seven**, at these lines of the resulting 89-line file:

| Line | Surviving assertion | Why it still has content |
| --- | --- | --- |
| 50 | `existsSync(packageJsonPath) === true` | Fails if the upward repo-root walk lands somewhere with no `package.json`. |
| 53-57 | `packageJsonVersion` matches `SEMVER_PATTERN` | The whole test now derives from this value, so it is shape-checked before anything is derived from it. A `version` of `"latest"` fails here instead of silently becoming the expectation. |
| 61-65 | `pluginJsonVersion === packageJsonVersion` | The two-manifest agreement invariant. Nothing reads `.claude-plugin/plugin.json` at run time, so it can genuinely drift, and this is the only check that catches it. |
| 72 | `assert.fail` when the handshake returns no `serverInfo` | Fails if the server starts but reports no identity at all. |
| 74 | `info.name === 'logbook'` | Compared against a literal; the server identifies itself correctly over the wire. |
| 76-80 | `packageJsonVersion === info.version` | Near-tautological by the file's own account, and deliberately kept: the two sides come from different processes, so it fails if the upward `package.json` search resolved a vendored copy under `node_modules`, or if the server never started. |
| 81-85 | `pluginJsonVersion === info.version` | **Redundant, and stated as such.** It is implied by the two assertions above it, so it cannot be the sole cause of a red. It is kept because deleting it is an unrelated change; it is not counted as evidence that the test discriminates. |

The three assertions that are deleted are the three that compared a value against the literal.
Only the first of them — `packageJsonVersion === EXPECTED_VERSION` — would have become a
tautology if it had been rewritten in place, which is why it is deleted rather than rewritten.
The other two are deleted because they are now exactly duplicated by the surviving
`pluginJsonVersion === packageJsonVersion` and `packageJsonVersion === info.version`. The two
`typeof ... === 'string'` guards are deleted because `readManifestVersion` already throws on a
non-string (`test/contract/cutover-manifests-agree.test.ts:41-43`), and the semver match at
line 53 is strictly stronger.

Six of the seven are genuinely failable; the seventh is named as redundant above rather than
counted. The two that this pull request can drive red without spawning a server are the ones
sections 7.2 and 7.3 mutate.

Measured, on the de-pinned file: changing `.claude-plugin/plugin.json` to a version
`package.json` does not carry turns the test red with
`AssertionError [ERR_ASSERTION]: <repo>/.claude-plugin/plugin.json version is 9.9.9, but <repo>/package.json version is 1.0.2`;
and setting `package.json`'s version to `latest` turns it red with
`AssertionError [ERR_ASSERTION]: <repo>/package.json version is latest, which is not a plain three-part semver; every other version assertion in this test is derived from it`.
Both are reproduced as mutations in section 7.

### Step 4 — bump the version in both manifests

Files: `package.json`, `.claude-plugin/plugin.json`. Operation: **REPLACE**, one line in each.

Read the current version, increment the patch component, and write the same value into both.
Run this command exactly as written:

```
node -e "const fs=require('node:fs');const cur=JSON.parse(fs.readFileSync('package.json','utf8')).version;const p=cur.split('.').map(Number);if(p.length!==3||p.some(Number.isNaN)){console.error('STOP: package.json version is not a three-part semver: '+cur);process.exit(1)}const next=[p[0],p[1],p[2]+1].join('.');for(const f of ['package.json','.claude-plugin/plugin.json']){const raw=fs.readFileSync(f,'utf8');const needle='\"version\": \"'+cur+'\"';if(!raw.includes(needle)){console.error('STOP: '+f+' does not carry '+needle);process.exit(1)}fs.writeFileSync(f,raw.replace(needle,'\"version\": \"'+next+'\"'))}console.log(cur+' -> '+next)"
```

Expected exit code `0`. Expected stdout under the baseline ladder, exactly:

```
1.0.0 -> 1.0.1
```

If the printed starting version is higher than `1.0.0`, the ladder shifted and that is **not**
an error — the command increments whatever it read. If the command exits `1`, stop and follow
section 11.

Expected `git diff` for the two files under the baseline, exactly:

```
diff --git a/.claude-plugin/plugin.json b/.claude-plugin/plugin.json
--- a/.claude-plugin/plugin.json
+++ b/.claude-plugin/plugin.json
@@
-  "version": "1.0.0",
+  "version": "1.0.1",
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@
-  "version": "1.0.0",
+  "version": "1.0.1",
```

This step touches no test file. Step 3 already removed the only place a version literal was
written into one, and nothing re-introduces it.

Rationale: invariant I4 requires both manifests to move in the same commit. A targeted
string replacement is used rather than a JSON parse-and-rewrite because
`JSON.stringify(value, null, 2)` reflows `.claude-plugin/plugin.json`'s inline `author` object
and `keywords` array onto separate lines, producing a fourteen-line diff for a one-character
change. Rejected: the JSON round-trip, for exactly that reason.

---

## 5. Tests

### 5.1 `test/contract/source-is-greppable-text.test.ts` — NEW

Given in full in section 4, step 2. It is picked up by `npm test`, whose glob includes
`"test/contract/**/*.test.ts"` (`package.json:12`).

Exact test name strings, in file order:

1. `contract.source-is-greppable-text`
2. `contract.source-is-greppable-text.control.a-nul-byte-is-forbidden-and-named`
3. `contract.source-is-greppable-text.control.an-invalid-utf8-byte-is-forbidden-and-named`
4. `contract.source-is-greppable-text.control.plain-utf8-text-is-allowed`
5. `contract.source-is-greppable-text.control.an-entry-that-is-not-a-regular-file-halts-the-census`
6. `contract.source-is-greppable-text.control.an-unreadable-file-halts-the-census`

There are no `describe` blocks in this suite; the repository uses flat top-level `test(...)`
calls throughout, and this file matches that.

What each test is for:

| Test | Purpose |
| --- | --- |
| 1 | The census itself. Enumerates every entry under `src/`, `hooks/` and `bin/` and halts on anything not greppable text. Discharges acceptance criterion 1. |
| 2 | Control. Proves the classifier actually discriminates a NUL byte rather than passing everything. Without it, a classifier that always returns `allowed` would pass test 1. |
| 3 | Control. Proves the classifier discriminates a genuinely invalid UTF-8 byte (`0xFF` standing alone). |
| 4 | Control. Proves the classifier does not reject ordinary text — a classifier that always returns `forbidden` would fail here. |
| 5 | Control. Proves the census *halts* on an entry that is not a regular file rather than silently allowing it. |
| 6 | Control. Proves the census halts on a file it cannot read rather than treating the read failure as a pass. |

### 5.2 Modified test files

`test/contract/cutover-manifests-agree.test.ts` — de-pinned by the three edits in section 4
step 3, which are given there as exact FIND/REPLACE pairs.

Its test name string, `cutover.manifests-agree`, does not change, and no test is added to or
removed from the file. What changes is what the single test asserts:

| Before | After |
| --- | --- |
| `packageJsonVersion === '1.0.0'` | deleted — it would become a tautology once the expectation is derived from that same value |
| `pluginJsonVersion === '1.0.0'` | `pluginJsonVersion === packageJsonVersion` |
| `info.version === '1.0.0'` | deleted — duplicated by the surviving `packageJsonVersion === info.version` |
| `typeof packageJsonVersion === 'string'` | `packageJsonVersion` matches `/^\d+\.\d+\.\d+$/` |
| `typeof pluginJsonVersion === 'string'` | deleted — subsumed by the equality against `packageJsonVersion`, and `readManifestVersion` already throws on a non-string |

The two mutations in section 7 prove the result is not vacuous. No other test file is modified.

### 5.3 Which test discharges which acceptance criterion

| Acceptance criterion | Discharged by |
| --- | --- |
| 1. A committed test enumerates every file under `src/`, `hooks/` and `bin/` and asserts each decodes as UTF-8, halting on the unclassifiable, with no pinned count and no allowlist. | `contract.source-is-greppable-text` in `test/contract/source-is-greppable-text.test.ts`. Its five sibling controls are what prove the classifier discriminates rather than always answering `allowed`: `...control.a-nul-byte-is-forbidden-and-named`, `...control.an-invalid-utf8-byte-is-forbidden-and-named`, `...control.plain-utf8-text-is-allowed`, `...control.an-entry-that-is-not-a-regular-file-halts-the-census`, `...control.an-unreadable-file-halts-the-census`. |
| 2. That test is red on the parent commit and green on the fix. | The same test, `contract.source-is-greppable-text`. Section 6 runs it red at the parent; section 7.1 runs it red again by re-inserting the byte on the branch; section 8 command V5 runs it green. |
| 3. `npm test` green. | Every test in the suite, run by section 8 command V5. Two tests in it are load-bearing for this pull request specifically: `contract.source-is-greppable-text`, which is new, and `cutover.manifests-agree`, which step 3 de-pins so that the version bump in step 4 does not turn it red. Sections 7.2 and 7.3 prove the de-pinned `cutover.manifests-agree` still fails when it should. |

---

## 6. Red on the parent

The parent is the tip of `main` at branch-cut time — `0ade582` at authoring time.

`test/contract/source-is-greppable-text.test.ts` does not exist at the parent, but it compiles
and runs there unchanged: its only repository import is `test/support/census.ts`, which exists
at the parent. So it can be run red directly, with no substitute procedure.

Run this sequence exactly, from the repository root, after all three commits in section 9 exist:

```
git switch --detach main
git restore --source=fix/msp-0-utf8-source-census -- test/contract/source-is-greppable-text.test.ts
node --test "test/contract/source-is-greppable-text.test.ts"
```

Expected exit code of the third command: **`1`**.

Expected output, containing all of these substrings:

```
✖ contract.source-is-greppable-text
```

```
ℹ pass 5
```

```
ℹ fail 1
```

```
AssertionError [ERR_ASSERTION]: Got unwanted exception: contract.source-is-greppable-text: 1 of 73 scanned entries are not greppable text
```

```
src/server/tools/resolve_conflict.ts [forbidden]
```

```
Actual message: "census rejected a forbidden item: {"path":"src/server/tools/resolve_conflict.ts","entryKind":"regular-file"}"
```

The number `73` in that message is the size of the population at the parent commit and is
printed, never asserted. If it differs, the message still names
`src/server/tools/resolve_conflict.ts [forbidden]`, and that is the substring that proves the
result.

The five control tests pass at the parent — they are self-contained and do not read the
repository. Only the census itself is red.

Clean up and return to the branch:

```
rm -f test/contract/source-is-greppable-text.test.ts
git switch fix/msp-0-utf8-source-census
git status --porcelain
```

Expected: `git status --porcelain` prints nothing at all, and exits `0`.

**Nothing else in this pull request owes a red-on-parent run.** Step 3 adds no test — it changes
what one existing test asserts, and that test is green both before and after the change while the
version stands still. What proves step 3 did not simply make that test unfailable is the pair of
mutations in sections 7.2 and 7.3, which turn it red on the branch.

---

## 7. Inertness mutation

Three mutations. The first is for acceptance criterion 2. The second and third prove the
de-pinned test of step 3 still discriminates, which is what keeps acceptance criterion 3 an
honest green rather than a test that cannot fail.

### 7.1 The census must turn red when the byte comes back

For acceptance criterion 2. Revert what the fix added and the census must turn
red again; a census that survives this is not testing the fix.

**The exact edit to revert.** Put the NUL byte back, on the branch, with the census test
present:

```
node -e "const fs=require('node:fs');const p='src/server/tools/resolve_conflict.ts';const before=fs.readFileSync(p);const needle=Buffer.from([0x5c,0x30]);const at=before.indexOf(needle,11230);if(at!==11234){console.error('STOP: the escape is not at byte offset 11234, found at '+at);process.exit(1)}const after=Buffer.concat([before.subarray(0,at),Buffer.from([0x00]),before.subarray(at+2)]);fs.writeFileSync(p,after);console.log('reinserted NUL at byte offset '+at+'; '+before.length+' -> '+after.length+' bytes')"
```

Expected exit code `0` and stdout exactly:

```
reinserted NUL at byte offset 11234; 26782 -> 26781 bytes
```

**The test that must turn red:**

```
node --test "test/contract/source-is-greppable-text.test.ts"
```

Expected exit code **`1`**, with the same failure substrings listed in section 6, in particular:

```
src/server/tools/resolve_conflict.ts [forbidden]
```

**The exact restore** — re-run the step 1 command from section 4:

```
node -e "const fs=require('node:fs');const p='src/server/tools/resolve_conflict.ts';const before=fs.readFileSync(p);const o=[];for(let i=0;i<before.length;i+=1)if(before[i]===0)o.push(i);if(o.length!==1){console.error('STOP: expected exactly one NUL byte, found '+o.length+' at ['+o.join(',')+']');process.exit(1)}const at=o[0];const after=Buffer.concat([before.subarray(0,at),Buffer.from([0x5c,0x30]),before.subarray(at+1)]);fs.writeFileSync(p,after);console.log('replaced NUL at byte offset '+at+'; '+before.length+' -> '+after.length+' bytes')"
```

Expected stdout exactly:

```
replaced NUL at byte offset 11234; 26781 -> 26782 bytes
```

Then confirm the working tree is back to the committed state:

```
git status --porcelain
```

Expected: no output, exit `0`.

### 7.2 The de-pinned test must turn red when the two manifests disagree

**The exact edit to revert.** On the branch, after step 4, set `.claude-plugin/plugin.json` to a
version `package.json` does not carry:

```
node -e "const fs=require('node:fs');const p='.claude-plugin/plugin.json';const raw=fs.readFileSync(p,'utf8');const cur=JSON.parse(raw).version;fs.writeFileSync(p,raw.replace('\"version\": \"'+cur+'\"','\"version\": \"9.9.9\"'));console.log(cur+' -> 9.9.9')"
```

**The test that must turn red:**

```
node --test "test/contract/cutover-manifests-agree.test.ts"
```

Expected exit code **`1`**, with output containing:

```
✖ cutover.manifests-agree
```

```
AssertionError [ERR_ASSERTION]:
```

```
/.claude-plugin/plugin.json version is 9.9.9, but
```

```
/package.json version is
```

The version this last fragment is followed by is whatever step 4 wrote — `1.0.1` under the
baseline ladder. Do not assert the number; the two fragments above are what prove the result.

**The exact restore:**

```
node -e "const fs=require('node:fs');const p='.claude-plugin/plugin.json';const want=JSON.parse(fs.readFileSync('package.json','utf8')).version;const raw=fs.readFileSync(p,'utf8');fs.writeFileSync(p,raw.replace('\"version\": \"9.9.9\"','\"version\": \"'+want+'\"'));console.log('restored to '+want)"
```

Then `git status --porcelain` must print nothing.

### 7.3 The de-pinned test must turn red when the derived version is not a semver

**The exact edit to revert.** On the branch, after step 4, set `package.json`'s version to a
non-semver string:

```
node -e "const fs=require('node:fs');const p='package.json';const raw=fs.readFileSync(p,'utf8');const cur=JSON.parse(raw).version;fs.writeFileSync(p,raw.replace('\"version\": \"'+cur+'\"','\"version\": \"latest\"'));console.log(cur+' -> latest')"
```

**The test that must turn red:**

```
node --test "test/contract/cutover-manifests-agree.test.ts"
```

Expected exit code **`1`**, with output containing:

```
/package.json version is latest, which is not a plain three-part semver; every other version assertion in this test is derived from it
```

**The exact restore:**

```
node -e "const fs=require('node:fs');const p='package.json';const want=JSON.parse(fs.readFileSync('.claude-plugin/plugin.json','utf8')).version;const raw=fs.readFileSync(p,'utf8');fs.writeFileSync(p,raw.replace('\"version\": \"latest\"','\"version\": \"'+want+'\"'));console.log('restored to '+want)"
```

Then `git status --porcelain` must print nothing.

This mutation is the one that proves the de-pin did not simply make the test unfailable. Without
the shape check the test would derive its expectation from whatever `package.json` happens to
say, and would pass for any value at all.

---

## 8. Full verification

Run all six, from the repository root, on the branch with all three commits applied.

**V1 — the NUL byte is gone.**

```
node -e "const b=require('node:fs').readFileSync('src/server/tools/resolve_conflict.ts');const o=[];for(let i=0;i<b.length;i+=1)if(b[i]===0)o.push(i);if(o.length===0){console.log('no NUL byte present');process.exit(0)}console.error('NUL byte present at offset(s): '+o.join(','));process.exit(1)"
```

Expected exit code `0`. Expected stdout, exactly: `no NUL byte present`.

**V2 — the file is text to `grep` and to `file`.**

```
file src/server/tools/resolve_conflict.ts
```

Expected exit code `0`. Expected stdout to contain the substring: `ASCII text`.
It must **not** contain the substring `: data`.

```
/usr/bin/grep -c 'export const' src/server/tools/resolve_conflict.ts
```

Expected exit code `0`. Expected stdout to be a number greater than zero, and it must **not**
contain the substring `Binary file`.

Use `/usr/bin/grep` by absolute path. A shell alias or function wrapping `grep` with a
skip-binary flag prints nothing and exits `1` for a binary file, with no notice at all, which
would make this check look like a different failure.

**V3 — the type checker is clean.**

```
npm run typecheck
```

Expected exit code `0`. Expected output to contain `tsc -p tsconfig.json --noEmit` and no line
containing `error TS`.

**V4 — the de-pinned manifest test is green and carries no version literal.**

```
node --test "test/contract/cutover-manifests-agree.test.ts"
```

Expected exit code `0`. Expected output to contain:

```
✔ cutover.manifests-agree
```

```
ℹ fail 0
```

Then:

```
grep -n EXPECTED_VERSION test/contract/cutover-manifests-agree.test.ts
```

Expected exit code `1` and no output at all. That is what `grep` does when it finds nothing, and
it is the check that the pin is gone rather than merely re-typed.

**V5 — the whole suite is green.** This is acceptance criterion 3. It is unreachable unless
step 3 landed: without the de-pin, the version bump in step 4 turns `cutover.manifests-agree`
red.

```
npm test
```

Expected exit code `0`. Expected output to contain the substring:

```
ℹ fail 0
```

and to contain all six new test names listed in section 5.1, each prefixed with `✔`.

**V6 — packaging agrees.**

```
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout, exactly: `check-packaging: ok`.

---

## 9. Commits

Three commits, applied in this order. The behaviour change, the test repair and the release bump
do not share one. The branch is green at every one of the three.

### Commit 1

Subject line, exactly:

```
fix(source): remove the zero byte that makes a source file binary
```

Files:

- `src/server/tools/resolve_conflict.ts`
- `test/contract/source-is-greppable-text.test.ts`

Plan steps contained: section 4 steps 1 and 2.

### Commit 2

Subject line, exactly:

```
test(cutover): derive the expected version instead of pinning it
```

Files:

- `test/contract/cutover-manifests-agree.test.ts`

Plan steps contained: section 4 step 3.

This commit must land **before** commit 3. At commit 2 the version is still whatever it was, so
the test passes both before and after the de-pin; at commit 3 the version moves, and only the
de-pinned test survives it.

### Commit 3

Subject line, exactly:

```
chore(release): bump the patch version across both manifests
```

Files:

- `package.json`
- `.claude-plugin/plugin.json`

Plan steps contained: section 4 step 4.

---

## 10. Pull request

Push the branch, then run this exactly. Do not use `gh pr create`, `gh api` against the pulls
endpoint, or the GitHub MCP create tool — all three are denied at the gate.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/msp-0-utf8-source-census \
  --base main \
  --title "fix(source): remove the zero byte that makes a source file binary" \
  --what "One source file no longer contains a raw zero byte, so ordinary text tools can read it." \
  --what "The test suite now enumerates every file under the three source directories and fails if any of them is not readable text." \
  --what "The check that the two published version files agree now reads one of them for the expected value instead of carrying a copy of the version in its own source." \
  --why "A single zero byte inside one source file made that whole file look like binary data to search tools, which returned nothing for it with no error and no warning." \
  --why "Later work adds checks that read source text, and a check added over a file that search tools skip would report success while never having looked at it." \
  --why "The check on the two version files carried the version as a literal in its own source, so raising the version broke it, and every future raise would have broken it again." \
  --risk "The zero byte was a separator inside a lookup key; it is replaced by the two-character escape for the same character, so the key built at run time is unchanged." \
  --verified "node --test test/contract/source-is-greppable-text.test.ts on the branch - 6 passed, 0 failed" \
  --verified "node --test test/contract/source-is-greppable-text.test.ts on the parent commit - 5 passed, 1 failed, naming the offending file" \
  --verified "the two-manifest agreement check after the version moved - 1 passed, 0 failed" \
  --verified "npm test - 0 failed" \
  --verified "npm run typecheck - exit 0, no error output" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "file on the changed source file - reports ASCII text, no longer data" \
  --not-verified "the project mutation job - not run" \
  --not-verified "the coverage job - not run"
```

**The mutation-scope sentence this pull request owes.** SPEC section 8.2 states that the
project's mutation job has a scope of `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`,
`src/merge/conflict.ts` and `src/render/**`, and that MSP-0's change falls outside it entirely:
the job will report success having mutated nothing in this diff. That is why the mutation line
above is `--not-verified` and not `--verified`. The same section states plainly: *"No PR in this
ladder may write a `Verified: mutation` line unless the job actually mutated a file in that PR's
diff."*

Every `--verified` line above describes a check section 8 tells you to run and read. If you did
not run one, change that line to `--not-verified "<thing> - not run"`. Never write a `Verified:`
line for a check you did not run, for any reason including that an exit code was zero.

---

## 11. Stop conditions

Each of these means the tree is not what this plan was written against. For every one:
**STOP and report; do not improvise.**

1. **The byte-fix command in section 4 step 1 exits `1`.** You will see
   `STOP: expected exactly one NUL byte, found N at [...]`. The file no longer carries exactly
   one zero byte at one place. STOP and report; do not improvise.

2. **The offset in that command's success message is not `11234`.** You will see
   `replaced NUL at byte offset <other>`. The file changed since this plan was written and the
   surrounding context in section 2.1 no longer applies. STOP and report; do not improvise.

3. **Line 275 after the fix is not exactly**
   ```
   const keyOf = (record: string, field: string): string => `${record}\0${field}`
   ```
   STOP and report; do not improvise.

4. **`test/contract/source-is-greppable-text.test.ts` already exists before step 2.** A file of
   that name is not supposed to be in the tree. STOP and report; do not improvise.

5. **`test/support/census.ts` does not export `census` and `Classified`.** Run
   `grep -n 'export' test/support/census.ts`; if the output does not contain both
   `export type Classified` and `export const census`, the helper this test builds on has
   changed. STOP and report; do not improvise.

6. **`package.json` and `.claude-plugin/plugin.json` disagree with each other before step 4.**
   Run:
   ```
   node -e "const fs=require('node:fs');const a=JSON.parse(fs.readFileSync('package.json','utf8')).version;const b=JSON.parse(fs.readFileSync('.claude-plugin/plugin.json','utf8')).version;console.log(a===b?'agree '+a:'DISAGREE '+a+' vs '+b)"
   ```
   If the output starts with `DISAGREE`, STOP and report; do not improvise.
   A version that is merely *higher* than `1.0.0` is **not** a stop condition — the ladder
   shifted, and step 4 increments whatever it reads.

7. **A FIND block in step 3 does not match, or matches more than once.** All three were copied
   from `test/contract/cutover-manifests-agree.test.ts` as it stands and checked for
   uniqueness. A miss means the file changed since this plan was written. STOP and report; do
   not improvise.

8. **`grep -c EXPECTED_VERSION test/contract/cutover-manifests-agree.test.ts` prints anything
   other than `0` after step 3**, or `wc -l` on that file prints anything other than `89`. The
   de-pin did not land as written. STOP and report; do not improvise.

9. **The version-bump command in step 4 exits `1`.** You will see a line beginning `STOP:`
   naming the file and the string it could not find. STOP and report; do not improvise.

10. **The census test is green at the parent commit** in section 6. Expected exit code `1`; if
    you get `0`, the defect this pull request fixes is not present at the parent and the receipt
    is worthless. STOP and report; do not improvise.

11. **`npm test` fails on the branch** at section 8 V5, on any test other than the six new ones
    and `cutover.manifests-agree`. Read the failing test's name and the assertion text. STOP and
    report; do not improvise.
