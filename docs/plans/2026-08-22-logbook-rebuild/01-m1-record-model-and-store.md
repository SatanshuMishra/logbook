# M1 — Record model and store

**Depends on:** nothing. This is the first unit.

**Ships:** one declaration per record type emitting type, validator, wire schema and refusal text; the plain-directory working copy; the plumbing write path; compare-and-swap ref moves; the durability sequence; ULID identities; the caller's git identity on every ledger commit; and the stdout guard rail.

**Read first:** SPEC §5 (all), §6.1, §6.2, §6.3, §6.6, §10.2, §10.3, §12.1, §12.3, §12.4, and `00-overview.md` §1 and §3.

---

## Premise checks — run before writing any code

Record each result in the pull request body. If any premise fails, re-plan this unit before writing code (§2.3).

- [ ] **P1. `rebuild/` does not exist.** `test ! -e rebuild && echo clear`
- [ ] **P2. Node runs TypeScript with no flag.** `printf 'const a: number = 1\nconsole.error(a)\n' > /tmp/p2.ts && node /tmp/p2.ts` prints `1` on stderr with no warning about an experimental flag. If it does not, the Node in use is below v22.18.0 and the floor in `00-overview.md` §1 must be re-derived.
- [ ] **P3. zod 4 emits JSON Schema natively.** `node -e "const {z}=require('zod');console.log(JSON.stringify(z.toJSONSchema(z.object({a:z.string().describe('x')}))))"` prints a schema whose `a` carries `description: "x"`. If `z.toJSONSchema` is absent, `00-overview.md` §1's single-schema-library claim fails and the unit is re-planned.
- [ ] **P4. The SDK's zod range still admits 4.x.** `node -e "console.log(require('@modelcontextprotocol/sdk/package.json').dependencies.zod)"` includes `^4.0`.
- [ ] **P5. Git supports the plumbing this unit needs.** `git hash-object --help`, `git write-tree --help`, `git commit-tree --help`, `git update-ref --help` all exit 0, and `git update-ref --help` documents an `<oldvalue>` positional argument.
- [ ] **P6. The old tree is untouched by this unit.** `git status --porcelain` is clean at the start.

---

## Acceptance — the ceiling for this unit (§2.4)

Declared before work starts. Nothing above this list is folded in; anything found above it is filed as a new item.

| # | Criterion | Proven by |
|---|---|---|
| A1 | A ledger write survives branch switching | `store.survives-branch-switch` passes |
| A2 | A ledger write does not disturb the project index | `store.leaves-index-alone` passes |
| A3 | A ledger write succeeds regardless of `HEAD` state | `store.never-reads-head` passes |
| A4 | A write that fails part-way leaves the store byte-identical | `write.atomic-on-failure` passes |
| A5 | One corrupt record does not hide the others | `read.quarantines-one-bad-record` passes |
| A6 | No worktree exists anywhere in the storage layer | `worktree.absent` passes |
| A7 | Every ledger commit carries the caller's git identity | `sync.identity` passes |
| A8 | Every collection element carries a stable id | `model.every-element-has-id` passes |
| A9 | A refusal is generated from the schema and names field, accepted shape, example and retryability | `schema.refusal-is-generated` passes |
| A10 | Nothing in `rebuild/src/` writes to stdout | `contract.no-stdout-in-src` passes |

**Red on the parent commit:** `store.leaves-index-alone`.

**Inertness mutation:** in `rebuild/src/store/git.ts`, delete the line that sets `GIT_INDEX_FILE` in the child environment. `store.leaves-index-alone` must turn red. If it stays green, the test is asserting something other than the mechanism and the unit is not done.

---

## Files

**Create**

```
rebuild/tsconfig.json
rebuild/src/runtime/runtime.ts          rebuild/src/runtime/logger.ts
rebuild/src/schema/declare.ts           rebuild/src/schema/refusal.ts
rebuild/src/schema/example.ts           rebuild/src/schema/caps.ts
rebuild/src/schema/ids.ts               rebuild/src/schema/thread.ts
rebuild/src/schema/decision.ts          rebuild/src/schema/session.ts
rebuild/src/store/project-key.ts        rebuild/src/store/layout.ts
rebuild/src/store/single-store.ts       rebuild/src/store/durable-write.ts
rebuild/src/store/git.ts                rebuild/src/store/ref.ts
rebuild/src/store/write-path.ts         rebuild/src/store/read-path.ts
rebuild/src/store/records.ts            rebuild/src/render/escape.ts
rebuild/test/support/runtime.ts         rebuild/test/support/git-fixture.ts
rebuild/test/support/census.ts
rebuild/test/unit/*.test.ts             rebuild/test/store/*.test.ts
rebuild/test/contract/no-stdout-in-src.test.ts
```

**Modify**

- `package.json` — add `zod@4.4.3`, bump `@modelcontextprotocol/sdk` to `1.30.0`, remove `ajv`, add dev dependency `typescript@5.9.3`, add the `rebuild:*` scripts.

---

## Task 1: Scaffold, runtime and the stdout guard rail

**Files:** `rebuild/tsconfig.json`, `rebuild/src/runtime/runtime.ts`, `rebuild/src/runtime/logger.ts`, `rebuild/test/support/runtime.ts`, `rebuild/test/support/census.ts`, `rebuild/test/contract/no-stdout-in-src.test.ts`, `package.json`

**Produces:** `Runtime`, `productionRuntime`, `testRuntime`, `census`.

- [ ] **Step 1: Write `rebuild/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "outDir": "dist",
    "rootDir": ".",
    "noEmit": false
  },
  "include": ["src/**/*.ts", "bin/**/*.ts", "hooks/**/*.ts", "test/**/*.ts"]
}
```

`allowImportingTsExtensions` with `rewriteRelativeImportExtensions` is what lets the same source both run under type stripping (which needs the `.ts` specifier) and compile to runnable JavaScript.

- [ ] **Step 2: Update `package.json` dependencies and scripts**

```json
"scripts": {
  "test": "node --test",
  "rebuild:typecheck": "tsc -p rebuild/tsconfig.json --noEmit",
  "rebuild:test": "node --test rebuild/test/unit/ rebuild/test/store/ rebuild/test/contract/",
  "rebuild:build": "tsc -p rebuild/tsconfig.json && chmod +x rebuild/dist/bin/*.js"
},
"dependencies": {
  "@modelcontextprotocol/sdk": "1.30.0",
  "ulid": "3.0.2",
  "zod": "4.4.3"
},
"devDependencies": {
  "typescript": "5.9.3"
}
```

`rebuild:test` gains `rebuild/test/spawn/`, `rebuild/test/hooks/` and `rebuild/test/sync/` in the units that create them.

- [ ] **Step 3: Write the `Runtime`**

`rebuild/src/runtime/runtime.ts` exports the `Runtime` type from `00-overview.md` §3 and `productionRuntime()`, which wires `now` to `new Date().toISOString()`, `ulid` to the `ulid` package, `env` to a frozen copy of `process.env`, `cwd` to `process.cwd()`, and `log` to the stderr logger.

`rebuild/src/runtime/logger.ts` writes one JSON object per line to **stderr**, never stdout, with the level read from `rt.env.LOGBOOK_LOG_LEVEL` and defaulting to `warn` (§12.4).

`rebuild/test/support/runtime.ts` exports `testRuntime(opts)` returning a `Runtime` whose clock advances by a fixed step per call from a supplied start, whose `ulid` is a seeded monotonic factory, and whose `env` is exactly the object passed in — **empty by default**, so no test can read the developer's shell (§11.8).

- [ ] **Step 4: Write the census helper**

`rebuild/test/support/census.ts` exports:

```ts
export type Classified<T> = { item: T; verdict: 'allowed' | 'forbidden' }
export const census: <T>(items: T[], classify: (item: T) => Classified<T>['verdict'] | 'unclassifiable') => void
```

It throws on the first `unclassifiable` item, naming it. **A census halts on what it cannot classify** — that is what separates it from a sampled check (§11.5). It is used by three gates: this task's stdout census, M4's description census, and M10's escaping census.

- [ ] **Step 5: Write the failing stdout census test**

`rebuild/test/contract/no-stdout-in-src.test.ts` walks every `.ts` file under `rebuild/src/`, and for each occurrence of `process.stdout`, `console.log`, `console.info`, `console.dir`, `console.table` or `console.warn` classifies it: `allowed` only inside `rebuild/src/server/main.ts` where the SDK owns the transport, `forbidden` everywhere else. Anything matching `console.` that is not in either list is `unclassifiable` and halts the census.

Assert that the census passes over the current tree, and — in the same file — assert that a synthetic file list containing `rebuild/src/store/git.ts` with a `console.log` hit is rejected. The second assertion is what keeps the census from being inert when `rebuild/src/` happens to be clean.

- [ ] **Step 6: Run it and watch it pass on an empty tree, fail on the synthetic case first**

Run: `node --test rebuild/test/contract/no-stdout-in-src.test.ts`
Expected: the synthetic-rejection assertion FAILS before the classifier is written, then PASSES.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run rebuild:typecheck` — expected exit 0.

```bash
git add rebuild/tsconfig.json rebuild/src/runtime rebuild/test/support rebuild/test/contract package.json
git commit -m "chore(rebuild): scaffold the typescript tree, runtime and stdout census"
```

---

## Task 2: One declaration, four consumers

**Files:** `rebuild/src/schema/declare.ts`, `refusal.ts`, `example.ts`, `rebuild/test/unit/declare.test.ts`

**Consumes:** nothing. **Produces:** `declare`, `Declared<T>`, `Ok<T>`, `Refusal` (signatures in `00-overview.md` §3).

- [ ] **Step 1: Write the failing test for refusal generation**

`rebuild/test/unit/declare.test.ts`, test name `schema.refusal-is-generated`:

```ts
const Person = declare('person', z.object({
  name: z.string().min(1).max(8).describe('the person short name'),
  age: z.number().int().min(0).describe('whole years')
}))

test('schema.refusal-is-generated', () => {
  const r = Person.parse({ name: 'far too long a name', age: 3 })
  assert.equal(r.ok, false)
  assert.equal(r.field, 'name')
  assert.match(r.accepted, /8/)
  assert.notEqual(r.example, null)
  assert.notEqual(r.example, '')
  assert.equal(Person.parse({ name: r.example, age: 3 }).ok, true)
  assert.equal(r.retryable, true)
})
```

The last-but-one assertion is the load-bearing one: **the example a refusal offers must itself validate.** The current build's refusal carries a null example (§6.1, §10.2), and an example that does not validate is the same defect wearing a value.

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test rebuild/test/unit/declare.test.ts`
Expected: FAIL, `declare is not a function`.

- [ ] **Step 3: Implement `declare`, `refusal` and `example`**

`declare(name, schema)` returns `{ name, schema, jsonSchema: z.toJSONSchema(schema), parse, refuse }`.

`parse` runs `schema.safeParse` and, on failure, hands `result.error.issues` to `refuse`.

`refuse(issues)` takes the **first** issue and derives all four fields from it and from the schema at that path:
- `field` is the issue path joined with `.`, or `'(root)'` when empty;
- `accepted` is rendered from the JSON Schema node at that path — its `type`, plus whichever of `minLength`, `maxLength`, `minimum`, `maximum`, `pattern`, `enum`, `minItems`, `maxItems` are present, plus the node's `description`;
- `example` is `synthesise(node)` from `example.ts`;
- `retryable` is `false` only for issues whose code indicates the value can never be supplied by a caller — currently just `custom` issues the domain layer raises for immutability — and `true` otherwise;
- `message` is one sentence composed from the four, in that order.

`synthesise(node)` walks the JSON Schema node: a string honours `minLength`, `maxLength` and `pattern` when the pattern is one of the anchored patterns from `ids.ts`, an integer honours `minimum`, an enum takes its first member, an object recurses over `required`, an array emits `minItems` elements. It never returns `null` for a schema that has any valid instance.

- [ ] **Step 4: Run the test to green**

Run: `node --test rebuild/test/unit/declare.test.ts` — expected PASS.

- [ ] **Step 5: Add the property test**

In the same file, for each of the three record declarations added in Task 3 (import them once Task 3 lands, or add this step at the end of Task 3): generate 200 invalid mutations of a valid record by dropping one required field or over-length-ing one string, and assert for every one that the refusal's `example` re-validates against the same declaration. This is the property behind A9, and it cannot be satisfied by a hand-written string.

- [ ] **Step 6: Commit**

```bash
git add rebuild/src/schema rebuild/test/unit/declare.test.ts
git commit -m "feat(rebuild): derive type, validator, wire schema and refusal from one declaration"
```

---

## Task 3: Identities, caps and the three record declarations

**Files:** `rebuild/src/schema/ids.ts`, `caps.ts`, `thread.ts`, `decision.ts`, `session.ts`, `rebuild/test/unit/records.test.ts`

**Produces:** `ThreadRecord`, `DecisionRecord`, `SessionRecord` as `Declared<...>` values, plus every type in `00-overview.md` §3.

- [ ] **Step 1: Write `ids.ts`**

```ts
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
```

All three are **anchored**. An unanchored identifier pattern is how a stored value smuggles a newline into a rendered surface (§10.4).

- [ ] **Step 2: Write `caps.ts` with these exact values**

§6.6 permits caps to be chosen freely against the new model, since there is no legacy data (0064). These are that choice. Every one is a **count or a character count enforced after escaping**, and every violation refuses the whole call.

| Field | Cap |
|---|---|
| `thread.title` | 200 characters |
| `thread.slug` | 64 characters, `SLUG_PATTERN` |
| `thread.blocked_by` | 500 characters |
| `spine.active_goal`, `spine.next_step`, `spine.last_session` | 500 characters each |
| `completion_criteria` | 40 elements; `text` 500 characters |
| `spine.open_risks` | 40 elements; `text` 500 characters; `refs` 10 elements of 200 characters |
| `spine.key_decisions` | 200 elements; `title` 200 characters |
| `spine.out_of_scope` | 40 elements; `text` 300 characters |
| `decision.title` | 200 characters |
| `decision.context`, `decision.outcome` | 4000 characters each |
| `decision.options` | 20 elements of 500 characters |
| `decision.supersedes` | 20 elements |
| `session.actor` | 100 characters |
| `session.body` | 8000 characters |
| whole thread record, serialised | 65536 bytes |

**Both count caps and size caps are present on every collection.** The current build caps element sizes and not counts, which is how 5,000 entries and 825 KB passed unremarked (§6.6).

- [ ] **Step 3: Write the three declarations**

Each field carries a `.describe()`. This is not decoration: it is the property description that reaches the client's schema, and its absence is the mechanical cause of the reported bug (§7.3). M4's `contract.every-property-described` census will fail the build over any field that lacks one.

Every collection element type carries `id: z.string().regex(ULID_PATTERN)`. `Criterion` additionally carries `ordinal: z.number().int().min(1)`, which is the rendered `c1` form; see `00-overview.md` §5.1 for why the id is not the ordinal.

`Decision.commit` is `z.string().nullable()` — see Task 6 Step 4 for why it can be null.

- [ ] **Step 4: Write the failing element-id test**

`rebuild/test/unit/records.test.ts`, test name `model.every-element-has-id`: a census over the JSON Schema of `ThreadRecord`. For every property whose schema node has `type: 'array'` and an `items` node of `type: 'object'`, assert that `items.required` contains `id` and `items.properties.id.pattern` is the ULID pattern. Any array of objects the walker cannot classify halts the census.

- [ ] **Step 5: Run, implement to green, typecheck**

Run: `node --test rebuild/test/unit/records.test.ts` then `npm run rebuild:typecheck`.

- [ ] **Step 6: Commit**

```bash
git add rebuild/src/schema rebuild/test/unit/records.test.ts
git commit -m "feat(rebuild): declare thread, decision and session records with capped fields"
```

---

## Task 4: Store location — injective key, layout, single store

**Files:** `rebuild/src/store/project-key.ts`, `layout.ts`, `single-store.ts`, `rebuild/test/unit/project-key.test.ts`, `rebuild/test/store/single-store.test.ts`

**Produces:**

```ts
export const projectKey: (canonicalAbsolutePath: string) => string
export type StoreLayout = { root: string; records: string; state: string; projectRoot: string }
export const layoutFor: (rt: Runtime, projectRoot: string) => Ok<StoreLayout> | Refusal
```

- [ ] **Step 1: Write the failing injectivity test**

`project-key.test.ts`, name `key.is-injective`: assert `projectKey('/a/b-c') !== projectKey('/a/b/c')`. The current derivation maps both to the same key (§5.1). Then a property test: 2,000 generated path pairs that differ in any byte produce different keys.

- [ ] **Step 2: Implement**

`projectKey` hashes the canonical absolute path with `crypto.createHash('sha256')` and returns the first 32 hex characters. It does **not** substitute separators. The path is canonicalised with `fs.realpathSync.native` before hashing; a canonicalisation failure is a `Refusal`, never a fall-through to the raw path (§10.3).

- [ ] **Step 3: Implement `layoutFor` and the store root**

The store root is `<plugin-data>/<projectKey>/`, containing `records/` and `state/`. `<plugin-data>` is read from `rt.env.CLAUDE_PLUGIN_DATA`; **an unset value is a `Refusal` naming the variable**, never an empty roster (§10.3).

`layoutFor` writes `state/origin.json` containing `{ project_root: <canonical path> }` when it creates a store.

- [ ] **Step 4: Write the failing second-store test**

`single-store.test.ts`, name `store.refuses-a-second-store`: create two sibling directories under a temporary plugin-data root whose `state/origin.json` both name the same project path. Assert `openStore` returns a `Refusal` whose message contains **both** absolute-path-free identifiers of the two stores and whose `retryable` is `false`.

The current build has two stores for this project right now, eight decisions apart (§5.1). This is the test that makes that state impossible.

- [ ] **Step 5: Implement, run to green, commit**

```bash
git add rebuild/src/store rebuild/test/unit/project-key.test.ts rebuild/test/store/single-store.test.ts
git commit -m "feat(rebuild): resolve one store per project from an injective path key"
```

---

## Task 5: The durability sequence

**Files:** `rebuild/src/store/durable-write.ts`, `rebuild/test/store/durable-write.test.ts`

**Produces:** `export const durableWrite: (target: string, contents: string) => void`

- [ ] **Step 1: Write the failing test `write.atomic-on-failure`**

Take a byte-level snapshot of the store directory — every path, size and content hash. Perform a `durableWrite` whose **third** step is injected to throw, by passing an injected `rename` that throws. Re-snapshot. Assert the two snapshots are identical, and assert separately that no file matching the temporary-file prefix remains.

The injection point is an optional second parameter carrying `{ open, fsync, rename, close }`, defaulted to the `node:fs` implementations at the single production call site. This is the only way to prove step ordering without a filesystem fault injector.

- [ ] **Step 2: Run it and confirm it fails**

Expected: FAIL, `durableWrite is not a function`.

- [ ] **Step 3: Implement the four steps, in this order**

1. write the temporary file **in the same directory as the target**, named with a random suffix, never a timestamp (§11.8);
2. `fsync` the temporary file's handle;
3. `rename` it over the target;
4. open the containing **directory** and `fsync` that handle.

Step 4 is the one everyone omits and the one that makes the rename survive (§5.5). Node does not document a directory-flush API; opening the directory and flushing the handle is the implementation. If `fsync` on a directory handle throws `EISDIR`, `EINVAL` or `EPERM` on a supported platform, **record the shortfall through `rt.log` at warn level and file it against §14 item 3** — do not silently skip it and do not swallow the error.

- [ ] **Step 4: Add the ordering assertion**

A second test, `write.fsyncs-directory-last`: pass an injected set that records the call order, perform a successful write, and assert the recorded order is exactly `open(tmp), fsync(tmp), rename, open(dir), fsync(dir)`.

- [ ] **Step 5: Run to green and commit**

```bash
git add rebuild/src/store/durable-write.ts rebuild/test/store/durable-write.test.ts
git commit -m "feat(rebuild): flush the directory so a rename survives a crash"
```

---

## Task 6: The git boundary — invariants I-1 through I-7

**Files:** `rebuild/src/store/git.ts`, `rebuild/src/store/ref.ts`, `rebuild/test/support/git-fixture.ts`, `rebuild/test/store/invariants.test.ts`

**Produces:**

```ts
export type GitResult = { ok: true; stdout: string } | { ok: false; code: number; stderr: string }
export const git: (rt: Runtime, repo: string, args: string[], opts?: GitOpts) => GitResult
export type GitOpts = { stdin?: string; indexFile?: string; identity?: Identity }
export type Identity = { name: string; email: string }
export const readIdentity: (rt: Runtime, repo: string) => Ok<Identity> | Refusal
export const casUpdateRef: (rt: Runtime, repo: string, ref: string, next: string, expected: string | null) => Ok<void> | Refusal
export const LEDGER_REF = 'refs/logbook/ledger'
```

- [ ] **Step 1: Write the real-git fixture**

`rebuild/test/support/git-fixture.ts` exports `withRepo(fn)`, which creates a temporary directory, runs `git init`, sets a local `user.name` and `user.email`, writes and commits one file so `HEAD` exists, and passes the path to `fn`.

**It is a real git repository, always.** The current suite's tool fixture creates a non-git temporary directory, which is why no tool test has ever exercised the git-backed path (§11.2). With the rebuild git-only, that fixture defect would be fatal, so the fixture has no non-git mode to fall into.

- [ ] **Step 2: Write the four invariant tests, all failing**

`rebuild/test/store/invariants.test.ts`:

```
store.leaves-index-alone      stage a file; ledger write; assert `git diff --cached --name-status`
                              is byte-identical before and after
store.survives-branch-switch  write records; `git switch -c b1`; `git switch -c b2`; assert every
                              record reads identically, and `git status --porcelain` is unchanged
                              before and after a ledger write
store.never-reads-head        a ledger write succeeds with HEAD detached, mid-rebase
                              (`git rebase -i` replaced by `git rebase --onto` stopped at a conflict),
                              and on an unborn branch (`git switch --orphan`)
sync.identity                 every commit on LEDGER_REF has author and committer equal to the
                              repository's configured user.name and user.email — asserted with
                              `git log --format=%an|%ae|%cn|%ce LEDGER_REF`, not against a literal
```

- [ ] **Step 3: Implement `git`**

Every invocation is `spawnSync('git', ['-C', repo, ...args], { env })` where `env` is built from **`rt.env`, not `process.env`**, plus:

| Variable | Value | Invariant |
|---|---|---|
| `GIT_INDEX_FILE` | a temporary file path, unique per call | I-2 |
| `GIT_CONFIG_NOSYSTEM` | `1` | determinism |
| `GIT_TERMINAL_PROMPT` | `0` | never block on credentials |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | from `readIdentity` | I-6 |
| `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` | from `readIdentity` | I-6 |
| `HOME` | preserved from `rt.env` so the caller's global git config resolves | I-6 |

Commits pass `--no-verify` where the subcommand accepts it, and `commit-tree` does not run hooks at all (I-7).

**A non-zero exit is a `GitResult` with `ok: false` carrying the exit code and stderr.** It is never mapped to `null` and never swallowed (§10.3, root cause E4). There are 22 unchecked git calls in the current build; there are zero permitted here.

`readIdentity` runs `git config --get user.name` and `--get user.email`. **Either being unset is a `Refusal`** naming the two config keys and the command to set them, not a fall-through to a synthetic identity. All 160 existing ledger commits carry a synthetic unroutable identity (I-6), and that happened because a fall-through existed.

- [ ] **Step 4: Implement `readProjectHead`**

```ts
export const readProjectHead: (rt: Runtime, repo: string) => string | null
```

Runs `git rev-parse HEAD` and returns `null` on any non-zero exit, which is the unborn-branch case.

**On the tension with I-1.** §5.3 states I-1 as "no ledger operation reads or writes `HEAD`", and §6.3 requires `Decision.commit` to be the project `HEAD` sha at the time of recording. The reconciliation the plan adopts: **I-1's binding content is that no ledger operation's correctness depends on `HEAD` and no ledger operation writes it.** `readProjectHead` is a best-effort read of project metadata for a decision record; it never gates a write, and its failure yields `null` rather than a refusal. `store.never-reads-head` asserts exactly that — writes succeed in every `HEAD` state — which is what §11.5 already specifies for it. This resolution is decision 0081.

- [ ] **Step 5: Implement `casUpdateRef`**

```
git update-ref <ref> <next> <expected>
```

with `expected` passed as the third positional argument, and the empty-string form used when `expected` is `null` to mean "the ref must not exist". A non-zero exit maps to a `Refusal` with a distinguishable `ref-moved` cause, which the write path retries (I-4). The current build passes no old value at four call sites.

- [ ] **Step 6: Run the four tests to green, then run the inertness mutation**

Run: `node --test rebuild/test/store/invariants.test.ts` — expected 4 PASS.

Then delete the `GIT_INDEX_FILE` line and re-run. Expected: `store.leaves-index-alone` FAILS. Restore the line.

- [ ] **Step 7: Commit**

```bash
git add rebuild/src/store/git.ts rebuild/src/store/ref.ts rebuild/test/support/git-fixture.ts rebuild/test/store/invariants.test.ts
git commit -m "feat(rebuild): confine ledger git calls to a temporary index and the caller identity"
```

---

## Task 7: The write path

**Files:** `rebuild/src/store/write-path.ts`, `rebuild/test/store/write-path.test.ts`

**Produces:** the `commit` member of `Store` (signature in `00-overview.md` §3).

- [ ] **Step 1: Write the failing tests**

```
write.builds-tree-from-previous   two sequential commits; the second tree contains the first's
                                  unchanged entries and the second's changed entry
write.retries-on-moved-ref        a ref moved by a second process between read and write causes
                                  a re-read and one retry, and both records survive
write.no-orphan-record            a commit injected to fail after the blob is written leaves zero
                                  files in the working copy and consumes no identifier
worktree.absent                   the string "worktree" appears in no file under rebuild/src/store/,
                                  and after a full write cycle no new directory exists inside the
                                  project working tree
```

`write.retries-on-moved-ref` uses a real second process, not a mock: spawn `node -e` that performs its own `casUpdateRef` between the parent's ref read and its write, coordinated by a file the parent polls.

- [ ] **Step 2: Implement the five steps of §5.3, in order**

1. `durableWrite` each changed record into `records/`;
2. `git hash-object -w --stdin` per changed record, taking the blob id from stdout;
3. build the tree with a temporary index: `GIT_INDEX_FILE=<tmp> git read-tree <oldTree>` when a previous commit exists, then `git update-index --add --cacheinfo 100644,<blob>,<path>` per change, then `git write-tree`;
4. `git commit-tree <tree> -p <oldRef>` with the caller's identity, reading the message from stdin, omitting `-p` when the ref does not yet exist;
5. `casUpdateRef(LEDGER_REF, newCommit, oldRef)`.

On a `ref-moved` refusal from step 5: re-read the ref, re-read the affected records from the ref's tree, re-apply the change, and retry. **Bounded at five attempts**, after which the call returns `{ ok: false, reason: 'ref-moved' }` and the caller surfaces it as a retryable refusal. An unbounded retry is a hang, and a hook that hangs fails open (§8.3).

- [ ] **Step 3: Run to green**

Run: `node --test rebuild/test/store/write-path.test.ts`

- [ ] **Step 4: Commit**

```bash
git add rebuild/src/store/write-path.ts rebuild/test/store/write-path.test.ts
git commit -m "feat(rebuild): write records through git plumbing with a compare-and-swap ref move"
```

---

## Task 8: The read path and per-record quarantine

**Files:** `rebuild/src/store/read-path.ts`, `rebuild/src/store/records.ts`, `rebuild/test/store/read-path.test.ts`

**Produces:** `openStore`, `Store`, `Slot<T>`, `Loaded<T>`, `Quarantined`.

- [ ] **Step 1: Write the failing tests**

```
read.quarantines-one-bad-record   write three threads; overwrite one with "{" ; assert readThreads
                                  returns three slots, exactly one quarantined carrying its path
                                  and a parse error, and the other two fully readable
read.is-subprocess-free           instrument the git wrapper with a call counter; perform every read
                                  in Store; assert the counter is 0
read.refreshes-only-on-ref-move   read twice with no intervening write; assert the working copy
                                  was not re-materialised, by asserting the counter is still 0
read.absent-is-null-not-error     readThread on an unknown id returns null; a store whose records
                                  directory is unreadable returns a Refusal from openStore
```

`read.is-subprocess-free` is the test behind the measured collapse: a session start currently costs 50 git subprocesses and 1.18 s (§5.4).

- [ ] **Step 2: Implement**

Reads are ordinary `fs.readFileSync` calls over `records/`. Each file is parsed and validated through its `Declared.parse`; a failure yields `Quarantined` **in place** rather than throwing, and every other record still returns.

The working copy is refreshed from the ref only when `git rev-parse LEDGER_REF` differs from the value cached in `state/last-synced` — and that comparison is the only subprocess a read may make, performed once per `openStore`, not per record.

Record paths: `records/threads/<ulid>.json`, `records/decisions/<ulid>.json`, `records/sessions/<thread-ulid>/<entry-ulid>.json`. **Every record is JSON.** §5.1 describes the working copy as plain JSON and Markdown files; the plan chooses JSON uniformly because §5.6's field-level merge needs structured fields on every record type, and front-matter would mean a second parser for no gain (§2.1). Markdown is a rendering, produced by M7's resources and M10's briefing.

- [ ] **Step 3: Run to green, typecheck, run the whole unit suite**

Run: `npm run rebuild:test` — expected all PASS.
Run: `npm run rebuild:typecheck` — expected exit 0.

- [ ] **Step 4: Commit**

```bash
git add rebuild/src/store/read-path.ts rebuild/src/store/records.ts rebuild/test/store/read-path.test.ts
git commit -m "feat(rebuild): read records from the working copy and quarantine a bad one in place"
```

---

## Task 9: The escaping helpers

**Files:** `rebuild/src/render/escape.ts`, `rebuild/test/unit/escape.test.ts`

**Produces:** `escapeStored`, `clipGraphemes`. M10 adds the census that proves every interpolation site uses them.

- [ ] **Step 1: Write the failing tests**

```
escape.covers-both-classes    a string containing U+200B, U+200E, U+2028, U+2029, \r, \n, \t and
                              U+0000 renders with every one of them inert, asserted character by
                              character over the union of the two classes, not over a sample
escape.title-cannot-forge-heading   "# Injected\n## Also" renders as one line whose "#" is inert
clip.is-grapheme-safe         a string of family emoji clipped to 3 emits no lone surrogate,
                              asserted by round-tripping through Buffer utf8 and comparing
```

- [ ] **Step 2: Implement**

`escapeStored` escapes the **union** of two sets, which are not the same set (§10.4): the Unicode format class (`\p{Cf}`, which covers the bidi and zero-width controls) and the blank class (`\p{Zs}` beyond ordinary space, plus `\p{Cc}`, plus U+2028 and U+2029). It additionally neutralises Markdown structural characters at line start. Every escaped character becomes its `U+XXXX` form so the value is still legible.

`clipGraphemes` uses `new Intl.Segmenter(undefined, { granularity: 'grapheme' })`. Slicing by code unit emits lone surrogates that non-JavaScript clients refuse to decode (§10.4).

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/render/escape.ts rebuild/test/unit/escape.test.ts
git commit -m "feat(rebuild): escape stored text over the format and blank classes"
```

---

## Task 10: Close the unit

- [ ] **Step 1: Run the full gate**

```
npm run rebuild:typecheck
npm run rebuild:test
```

Both must exit 0, and the ten acceptance criteria above must each map to a named passing test.

- [ ] **Step 2: Run the inertness mutation and record the result**

Delete the `GIT_INDEX_FILE` line in `rebuild/src/store/git.ts`, run `node --test rebuild/test/store/invariants.test.ts`, and record that `store.leaves-index-alone` turned red. Restore the line and re-run to green.

- [ ] **Step 3: File what this unit inherited but did not fix**

At minimum: the old `src/` tree still holds the worktree driver, the synthetic identity and the unchecked git calls. Those are M12's to delete, not this unit's to repair (§2.5).

- [ ] **Step 4: Open the pull request**

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m1-record-model-and-store --base main \
  --title "feat(store): rebuild the record model and the git-backed store" \
  --what "Records are declared once and yield their own type, validator, wire schema and refusal text." \
  --what "Ledger writes reach a dedicated git ref through plumbing without a worktree, an index or HEAD." \
  --why "The storage layer used a developer checkout as a database, which destroyed live directories and lost writes." \
  --verified "rebuild unit and store suites - <N> passing" \
  --verified "inertness mutation on GIT_INDEX_FILE - store.leaves-index-alone red" \
  --not-verified "behaviour of the installed plugin - unchanged by design, the new tree is not loaded"
```
