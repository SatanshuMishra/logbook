# U0 — Trunk verification gate

## 0. Identity

- **Closes:** the first clause of the SPEC's section 10 heading "Gate zero" — *"Before U1 is cut: trunk gets CI on push, and the red `test (24.x)` job is either fixed or explicitly downgraded on the honesty ladder with its reason recorded."* This unit lands the CI-on-push half and records the downgrade half.
- **Depends on:** nothing. This is the first merge of the ladder.
- **Required by:** every later unit. `U1` is not cut until this unit is merged.
- **Wave:** 0.
- **Branch name:** `ci/u0-trunk-verification-gate`, cut from `main`.
- **Base branch:** `main`. The pull request targets `main`.
- **Version bump:** Baseline `1.4.1` -> `1.4.2` per orchestrator ruling OR1. Applied as a read-then-increment in step 8, never as a hard-coded pair.
- **PR title scope:** `workflows`.
- **SPEC anchors:** section 10, heading "Gate zero". This unit is **not** one of the SPEC's ten units. It carries **no** behavioural rule (`B#`), **no** invariant (`A#`/`O#`/`S#`) and **no** defect (`D#`). Section 9 gives it no row, and section 11.4 assigns it nothing.
- **Files this unit edits:** `.github/workflows/rebuild.yml`, `test/contract/workflow-hardening-census.test.ts`, `package.json`, `.claude-plugin/plugin.json`. No other file is touched.
- **New modules created:** none.

### Two terms used throughout

- **Workflow trigger.** The `on:` block at the top of a GitHub Actions workflow file. It lists the repository events that start the workflow. `pull_request:` means "start when a pull request is opened or updated". `push:` means "start when a commit lands on a branch".
- **Census.** A test in this repository that walks a whole population of items, classifies every one of them, and fails loudly when any item is forbidden **or** cannot be classified at all. It never skips an item it does not recognise. The shared helper is `test/support/census.ts`.

---

## 1. Acceptance criteria (the ceiling)

The planning brief's section 4 builds a ceiling from a unit's `Carries` cell, its `Green` cell and its section 11.4 invariants. **U0 has none of those three**, because it is not one of the SPEC's ten units (see `## 3. Divergences from the SPEC`, divergence 2). Its ceiling is therefore built from the only source that scopes it: orchestrator ruling `OR18`, under the heading "`U0`'s complete scope, and nothing else".

1. `.github/workflows/rebuild.yml` declares a `push` trigger whose `branches` list contains `main`, alongside the existing `pull_request:` trigger. Discharges SPEC section 10 "Gate zero", clause *"trunk gets CI on push"*, and `OR18` scope item 1. No `B#` exists for it.
2. The `mutation` job in `.github/workflows/rebuild.yml` carries the job-level condition `if: github.event_name == 'pull_request'`. Discharges `OR18` scope item 2 and ruling 2. No `B#` exists for it.
3. `test/contract/workflow-hardening-census.test.ts` carries a fourth census, named exactly `workflow-hardening.trunk-verification`, over **every job of every workflow file** in `.github/workflows/`. It classifies a job as allowed only when the job either runs on a push to `main`, or is a job that reads pull-request-only data and is explicitly gated to the `pull_request` event. It halts on any job it cannot classify. This is the unit's receipt under `P11`: it is red at the parent commit and green on the change.
4. `.github/workflows/receipts.yml` is not edited, and every one of its two jobs is classified `allowed` by the criterion-3 census without any change to that file. Discharges `OR18` ruling 1.
5. `package.json` and `.claude-plugin/plugin.json` carry the same, incremented version, written in one commit, and `node scripts/check-packaging.mjs` prints `check-packaging: ok` and exits 0. Discharges `P4`.
6. `npm test` exits 0 and `npm run typecheck` exits 0 on the merge commit. Discharges `P1`.

Anything discovered above these six criteria is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is **not** folded into this plan.

**Criterion 3 is not a fourth item of scope.** `OR18`'s three-item scope list governs what changes in the workflow files. `OR13` and `P11` separately require every unit in this ladder to ship a receipt — an acceptance test that is red before the change and green after it. Criterion 3 is that receipt, and it exists only to assert criteria 1 and 2. A unit that changed the workflow with nothing asserting the change would fail `P11`. Criteria 5 and 6 are likewise not scope items; they are the standing plan invariants `P4` and `P1`, which bind every unit.

### What this unit does NOT do

Stated because `OR18` scope item 3 is "nothing else", and because a reader could otherwise assume more happened than did.

- It does **not** fix the store materialisation defect that makes `concurrent.distinct-ids` fail. Filed as `F0a`.
- It does **not** touch `receipts.config.json`.
- It does **not** add branch protection or required status checks. Filed as `F0b`.
- It does **not** raise the mutation score, and does not re-run mutation testing.
- It does **not** edit, skip, focus or delete any test in order to reach a green.

Two standing plan invariants hold vacuously here, and are recorded rather than left silent. `P2`, no new silent success, has nothing to bind: this unit changes no path under `src/`, so there is no code path that could report success without doing what was asked. `P3`, no record disappears, likewise: this unit adds no thread-record field and performs no store write.

### The check this unit adds blocks nothing

This is the most important sentence in the plan, and it is here so that no reader draws a stronger conclusion than the change supports.

`main` has no branch protection and no rulesets. `OR18`'s measured facts record, at `docs/plans/2026-08-28-continuity-goal-model/ORCHESTRATOR-RULINGS.md:468-470`, that `gh api repos/:owner/:repo/branches/main/protection` returns `404 Branch not protected`, and that both `.../rulesets` and `.../rules/branches/main` return `[]`. Those are positive answers from the API, not access failures. **Nothing is a required status check on `main`.**

Therefore, after this unit merges:

- CI **runs** on every push to `main`, and its result is visible on the commit and in the Actions tab.
- A red run **prevents nothing**. It does not block a merge, it does not block a push, and it does not revert anything.

The value delivered is **observation**: a green claim about `main` becomes checkable, where before it was unfalsifiable because `main` had never been tested at all. Converting observation into enforcement requires adding required status checks, which is a repository-administration act performed through GitHub's settings. No unit in this ladder performs it, and this plan does not instruct it. It is filed as `F0b`.

### The honesty-ladder status this unit ships under

The SPEC's gate-zero sentence offers two ways to discharge the red `test (24.x)` job: fix it, or downgrade it explicitly with its reason recorded. **This unit takes the downgrade, and records the reason here.**

- **Claim:** "trunk is verified green."
- **Status:** `unverified-reasoned`.
- **Reason:** a measured 5.0% per-`test`-job false red is live, caused by a store materialisation defect that is understood, reproduced and tracked, but deliberately not fixed in this ladder. `OR18` records the measurement as 3 failures in 60 pooled `test` job runs across the last 20 workflow runs, all three being the same test. Filed as `F0a`.
- **Second claim:** "the mutation score is acceptable."
- **Status:** `unverified-reasoned`.
- **Reason:** `OR18` ruling 3 records that no pre-change mutation baseline exists for the store modules in the queried window, so the score cannot be attributed, and establishing one means a roughly 152-minute run on the parent commit that was not performed.

Neither status is a pass, and neither is hidden. Both are stated again in the pull request body in section 10 as `--not-verified` lines.

---

## 2. Ground truth

One subsection per edit site. Line ranges are the ones read in the working tree at authoring time, on branch `docs/continuity-goal-model-spec` at `4203de9`. Per `OR4`, `.github/` and `test/` are byte-identical between that commit and `main` at `e5f0195`, so these ranges apply unchanged to a branch cut from `main`.

### 2.1 `.github/workflows/rebuild.yml:3-4` — the trigger block

```yaml
on:
  pull_request:
```

**What is wrong with it.** This workflow contains every verification job the repository has: `typecheck`, `test`, `coverage`, `inspector` and `seeded-mutation`. Because `pull_request:` is the only trigger, none of them has ever run against `main` itself. SPEC section 10 states the consequence: *"Ten units merging in sequence into a branch nothing verifies would make every green claim in section 9 unfalsifiable — the same defect this spec exists to remove, applied to its own delivery."*

### 2.2 `.github/workflows/rebuild.yml:73-75` — the `mutation` job header

```yaml
  mutation:
    runs-on: ubuntu-latest
    steps:
```

**What is wrong with it.** This job has no condition, so widening the workflow's trigger in 2.1 would start it on a push as well. It cannot run on a push. Its own step at lines 84-87 reads `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha` into the environment; on a push event both are empty strings, and the step's `git diff` between two empty shas fails, which the script turns into `exit 1` at line 99. `OR18` ruling 2 also records that this job took 151.9 minutes on the run in question, against under 3 minutes for every other job.

### 2.3 `test/contract/workflow-hardening-census.test.ts:29-31` — the module constants

```ts
const TEST_FILE_PATH = fileURLToPath(import.meta.url)
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml'])
const WORKFLOWS_SUBPATH = ['.github', 'workflows']
```

**What is wrong with it.** Nothing is wrong; this is where the new census's shared token constant is introduced so that `parseJob` can use it.

### 2.4 `test/contract/workflow-hardening-census.test.ts:17-27` — the parsed shapes

```ts
type ParsedJob = {
  id: string
  permissions: unknown
  steps: ParsedStep[]
}

type ParsedWorkflow = {
  file: string
  topPermissions: unknown
  jobs: ParsedJob[]
}
```

**What is wrong with it.** `ParsedWorkflow` discards the workflow's `on:` trigger block, and `ParsedJob` discards the job's `if:` condition. Both are exactly the facts criteria 1 and 2 are about, so no census over these shapes can see the change this unit makes.

### 2.5 `test/contract/workflow-hardening-census.test.ts:74-76` — the job parser's return

```ts
  const steps = stepsNode.map((stepValue, index) => parseStep(workflowLabel, jobId, index, stepValue))
  return { id: jobId, permissions: job.permissions, steps }
}
```

**What is wrong with it.** It builds a `ParsedJob` from three fields only, so it must be extended alongside 2.4.

### 2.6 `test/contract/workflow-hardening-census.test.ts:88` — the workflow parser's return

```ts
  return { file: label, topPermissions: (doc as Record<string, unknown>).permissions, jobs }
```

**What is wrong with it.** Same as 2.4: the parsed `on:` node is available in `doc` on the line above but is thrown away here.

### 2.7 `test/contract/workflow-hardening-census.test.ts:420-425` — the last census in the file

```ts
  const classify = classifyInstallItem(resolvableBinNames)
  assert.doesNotThrow(
    () => census(population, classify),
    describeViolations('install-ignore-scripts', population, classify)
  )
})
```

**What is wrong with it.** Nothing is wrong; this is the anchor the new census is appended after. The file is 425 lines long and this is its final line.

### 2.8 `package.json:3` and `.claude-plugin/plugin.json:3` — the version fields

```json
  "version": "1.4.1",
```

That exact line appears **exactly once** in each of the two files. **What is wrong with it.** Nothing; `P4` requires both to bump together in one commit.

---

## 3. Divergences from the SPEC

**Divergence 1 — the mitosis decomposition procedure named by an agent definition does not exist on disk.**

`~/.claude/skills/mitosis/SKILL.md` is absent from disk, and per orchestrator ruling `OR20` this ladder depends on no external decomposition procedure, so nothing in this unit's scope changes and the implementer needs nothing from that file.

**Divergence 2 — `U0` is not a SPEC unit, so the brief's three ceiling sources are empty for it.**

`PLANNING-BRIEF.md` section 4 builds the acceptance ceiling from a unit's `Carries` cell, its `Green` cell and its section 11.4 invariants. SPEC section 9 has no row for `U0`, and section 11.4 assigns it no invariant. `OR1` states this directly: *"`U0` is the gate-zero unit the SPEC's section 10 requires before `U1` is cut; it is not one of the SPEC's ten units and carries no `B#`."* **Ruling applied:** the ceiling in section 1 is built from `OR18`'s heading "`U0`'s complete scope, and nothing else", and each criterion names that ruling instead of a `B#`.

**Divergence 3 — the SPEC offers "fixed or downgraded" for the red job; this unit downgrades, and the SPEC does not say which.**

SPEC section 10 reads *"the red `test (24.x)` job is either fixed or explicitly downgraded on the honesty ladder with its reason recorded."* **Ruling applied:** `OR18` ruling 4 settles it — `U0` does not fix the store defect, because the SPEC accepted two specific races as worded and this is a third, wider one on the ordinary success path, which is a new finding above the SPEC's ceiling. The downgrade and its reason are recorded in section 1 under "The honesty-ladder status this unit ships under", and the defect is filed as `F0a`.

**Divergence 4 — the SPEC's section 10 description of the current state is accurate, and this is recorded as a non-divergence.**

SPEC section 10 line 451 states *"Neither `.github/workflows/rebuild.yml` nor `receipts.yml` runs on push to `main`; both are `pull_request` only."* Read at authoring time, both files carry exactly `on:` followed by `pull_request:` and nothing else. The code and the SPEC agree.

No other divergence found.

---

## 4. The change, step by step

Apply in the order given. Steps 1 to 5 are the test; steps 6 and 7 are the workflow; step 8 is the version. The red-on-parent observation in section 6 is taken **between step 5 and step 6**, which is why the test lands first.

Every FIND string below was copied from the working tree and is unique in its file. A FIND string that is not found, or is found more than once, is stop condition 2 or 3 in section 11.

### Choices made here, and the option rejected for each

Every choice this unit faced is settled in this plan. None is passed to the implementer.

| Choice made | Option rejected, and why |
|---|---|
| The receipt lives in the existing `test/contract/workflow-hardening-census.test.ts`. | A new test file. Rejected: that file is already the only place workflow YAML is parsed in this repository, and a second parser would be a second source of truth that can drift from the first. |
| Whether a job reads pull-request-only data is derived by searching the job's own serialised text for `github.event.pull_request`. | A hand-written list of the job names known to need pull-request context. Rejected: `P8` forbids an allowlist, and a name list silently stops matching the moment a job is renamed. |
| The push trigger is scoped with `branches: [main]`. | A bare `push:` with no branch filter. Rejected: it would start the whole suite on every push to every branch, duplicating the pull-request run at roughly double the CI cost for no extra information. |
| The `mutation` job is excluded with a job-level `if:`. | Moving the mutation job into its own pull-request-only workflow file. Rejected: it duplicates the checkout and setup steps and widens the diff far beyond this unit's scope. |
| The workflow change and its census ship in one commit. | A test-first commit followed by a workflow commit. Rejected: the first commit would be red, breaking `P1`'s requirement that the suite pass on every merge commit. |
| The version bump is its own commit. | Folding the version bump into the workflow commit. Rejected: it mixes a metadata change with a behaviour change in one reviewable unit. |

### Step 1 — `test/contract/workflow-hardening-census.test.ts` — REPLACE

Introduces the token searched for when deciding whether a job reads pull-request-only data.

FIND:

```ts
const WORKFLOWS_SUBPATH = ['.github', 'workflows']
```

REPLACE:

```ts
const WORKFLOWS_SUBPATH = ['.github', 'workflows']
const PULL_REQUEST_CONTEXT_TOKEN = 'github.event.pull_request'
```

Rationale: criterion 2 turns on whether a job reads pull-request-only data, and that fact has to be derived from the file rather than from a hand-written list of job names.

### Step 2 — `test/contract/workflow-hardening-census.test.ts` — REPLACE

Carries the workflow's trigger block and the job's condition through the parsed shapes.

FIND:

```ts
type ParsedJob = {
  id: string
  permissions: unknown
  steps: ParsedStep[]
}

type ParsedWorkflow = {
  file: string
  topPermissions: unknown
  jobs: ParsedJob[]
}
```

REPLACE:

```ts
type ParsedJob = {
  id: string
  permissions: unknown
  steps: ParsedStep[]
  ifExpression: string | undefined
  referencesPullRequestContext: boolean
}

type ParsedWorkflow = {
  file: string
  topPermissions: unknown
  triggers: unknown
  jobs: ParsedJob[]
}
```

Rationale: criteria 1 and 2 are statements about the trigger block and a job condition, and section 2.4 records that both were discarded by the existing parser.

### Step 3 — `test/contract/workflow-hardening-census.test.ts` — REPLACE

Populates the two new `ParsedJob` fields.

FIND:

```ts
  const steps = stepsNode.map((stepValue, index) => parseStep(workflowLabel, jobId, index, stepValue))
  return { id: jobId, permissions: job.permissions, steps }
}
```

REPLACE:

```ts
  const steps = stepsNode.map((stepValue, index) => parseStep(workflowLabel, jobId, index, stepValue))
  return {
    id: jobId,
    permissions: job.permissions,
    steps,
    ifExpression: typeof job.if === 'string' ? job.if : undefined,
    referencesPullRequestContext: JSON.stringify(job).includes(PULL_REQUEST_CONTEXT_TOKEN)
  }
}
```

Rationale: serialising the whole job node finds the token wherever it appears — in `env:`, in `run:`, in `with:`, in `name:` or in `if:` — so no field of a job can hide a pull-request-only read from the census.

### Step 4 — `test/contract/workflow-hardening-census.test.ts` — REPLACE

Populates the new `ParsedWorkflow` field.

FIND:

```ts
  return { file: label, topPermissions: (doc as Record<string, unknown>).permissions, jobs }
```

REPLACE:

```ts
  return {
    file: label,
    topPermissions: (doc as Record<string, unknown>).permissions,
    triggers: (doc as Record<string, unknown>).on,
    jobs
  }
```

Rationale: criterion 1 is a statement about the `on:` node, which the line above already parsed and this line discarded.

### Step 5 — `test/contract/workflow-hardening-census.test.ts` — REPLACE

Appends the fourth census to the end of the file. The FIND string is the file's final six lines.

FIND:

```ts
  const classify = classifyInstallItem(resolvableBinNames)
  assert.doesNotThrow(
    () => census(population, classify),
    describeViolations('install-ignore-scripts', population, classify)
  )
})
```

REPLACE:

```ts
  const classify = classifyInstallItem(resolvableBinNames)
  assert.doesNotThrow(
    () => census(population, classify),
    describeViolations('install-ignore-scripts', population, classify)
  )
})

const PULL_REQUEST_EVENT_GUARD = "github.event_name == 'pull_request'"
const PUSH_TRIGGER_KEY = 'push'
const TRIGGER_BRANCHES_KEY = 'branches'
const TRUNK_BRANCH_NAME = 'main'

type TrunkVerificationItem = {
  workflow: string
  job: string
  triggers: unknown
  referencesPullRequestContext: boolean
  ifExpression: string | undefined
}

const trunkVerificationItemFor = (workflow: ParsedWorkflow, job: ParsedJob): TrunkVerificationItem => ({
  workflow: workflow.file,
  job: job.id,
  triggers: workflow.triggers,
  referencesPullRequestContext: job.referencesPullRequestContext,
  ifExpression: job.ifExpression
})

const classifyTrunkVerification = (
  item: TrunkVerificationItem
): Classified<TrunkVerificationItem>['verdict'] | 'unclassifiable' => {
  if (!isPlainObject(item.triggers)) return 'unclassifiable'
  const pushNode = item.triggers[PUSH_TRIGGER_KEY]
  if (pushNode !== undefined && !isPlainObject(pushNode)) return 'unclassifiable'
  const branchesNode = isPlainObject(pushNode) ? pushNode[TRIGGER_BRANCHES_KEY] : undefined
  if (pushNode !== undefined && !Array.isArray(branchesNode)) return 'unclassifiable'
  const runsOnPushToTrunk = Array.isArray(branchesNode) && branchesNode.includes(TRUNK_BRANCH_NAME)
  if (!item.referencesPullRequestContext) return runsOnPushToTrunk ? 'allowed' : 'forbidden'
  if (!runsOnPushToTrunk) return item.ifExpression === undefined ? 'allowed' : 'unclassifiable'
  return item.ifExpression === PULL_REQUEST_EVENT_GUARD ? 'allowed' : 'forbidden'
}

test('workflow-hardening.trunk-verification', () => {
  const workflows = loadWorkflows()
  const population = workflows.flatMap((workflow) =>
    workflow.jobs.map((job) => trunkVerificationItemFor(workflow, job))
  )

  assert.ok(
    population.length > 0,
    'workflow-hardening.trunk-verification: zero jobs found across all workflows; a census over an empty population proves nothing'
  )

  assert.doesNotThrow(
    () => census(population, classifyTrunkVerification),
    describeViolations('trunk-verification', population, classifyTrunkVerification)
  )
})
```

Rationale: this is the unit's receipt under `P11`, and section 5 explains its classification rule clause by clause.

### Step 6 — `.github/workflows/rebuild.yml` — REPLACE

Adds the push trigger.

FIND:

```yaml
on:
  pull_request:
```

REPLACE:

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

Rationale: acceptance criterion 1, which discharges the SPEC section 10 clause *"trunk gets CI on push"*.

### Step 7 — `.github/workflows/rebuild.yml` — REPLACE

Gates the `mutation` job to pull requests.

FIND:

```yaml
  mutation:
    runs-on: ubuntu-latest
    steps:
```

REPLACE:

```yaml
  mutation:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
```

Rationale: acceptance criterion 2. Section 2.2 records that this job reads `github.event.pull_request.base.sha` and `.head.sha`, and hard-fails when both are empty, which is what a push event supplies.

### Step 8 — `package.json` and `.claude-plugin/plugin.json` — read-then-increment

Run this exact command from the repository root. It reads the current version, refuses if the two files disagree or if the version line is not unique in either file, increments PATCH because this unit's Conventional Commits type is `ci`, and writes both files. The type driving this increment is the unit's own type, `ci`, which is also the pull request title's type in section 10 and therefore the squash commit's subject type. Commit 2 in section 9 is typed `chore` because that single commit carries only metadata; that local type does not change the increment.

```bash
node -e '
const fs = require("fs")
const files = ["package.json", ".claude-plugin/plugin.json"]
const raw = files.map((f) => fs.readFileSync(f, "utf8"))
const versions = raw.map((t) => JSON.parse(t).version)
if (versions[0] !== versions[1]) { console.error("STOP version mismatch " + versions.join(" ")); process.exit(1) }
const line = "\"version\": \"" + versions[0] + "\""
raw.forEach((t, i) => { const n = t.split(line).length - 1; if (n !== 1) { console.error("STOP " + files[i] + " has " + n + " occurrences of " + line); process.exit(1) } })
const parts = versions[0].split(".")
const next = [parts[0], parts[1], String(Number(parts[2]) + 1)].join(".")
files.forEach((f, i) => fs.writeFileSync(f, raw[i].replace(line, "\"version\": \"" + next + "\"")))
console.log("version bumped " + versions[0] + " -> " + next)
'
```

Expected exit code: `0`. Expected stdout, when the ladder has not shifted: `version bumped 1.4.1 -> 1.4.2`. A higher pair of numbers on the same line means the ladder shifted and is **not** a stop condition; a `STOP` line on stderr is stop condition 1.

Then run:

```bash
node scripts/check-packaging.mjs
```

Expected exit code: `0`. Expected stdout substring: `check-packaging: ok`.

Rationale: `P4` and `OR6`. This command was authored and run against a throwaway copy of both files during planning, and produced `version bumped 1.4.1 -> 1.4.2` with exit 0.

---

## 5. Tests

One subsection per test file. This unit modifies one test file and creates none.

### 5.1 `test/contract/workflow-hardening-census.test.ts` — modified

The exact FIND/REPLACE blocks are steps 1 to 5 in section 4. The new test's exact name string is:

```
workflow-hardening.trunk-verification
```

It joins three censuses that already live in this file — `workflow-hardening.permissions`, `workflow-hardening.checkout-credentials` and `workflow-hardening.install-ignore-scripts` — and copies their idiom exactly: the same `loadWorkflows()` population source, the same `assert.ok(population.length > 0, ...)` non-empty guard, the same `assert.doesNotThrow(() => census(...), describeViolations(...))` shape, and the same `workflow-hardening.<property>` title grammar.

`P7`, the dogfood hazard, does not apply to this test. It reads only files committed in the repository working tree and drives no ledger store, so there is no fixture store to build and nothing about this session's own ledger is observed.

#### What the classifier decides, clause by clause

The population is one item per job, across every workflow file. Read in the order the code checks them:

| Condition on the item | Verdict | Why |
|---|---|---|
| the workflow's `on:` node is not a mapping | `unclassifiable` | the trigger block cannot be read at all; the census halts rather than guessing |
| `on.push` is present but is not a mapping | `unclassifiable` | a `push` trigger in a shape this census does not model |
| `on.push` is present but `on.push.branches` is not an array | `unclassifiable` | a branch filter in a shape this census does not model |
| the job does not read pull-request-only data, and the workflow runs on push to `main` | `allowed` | it verifies the trunk, which is the point of the unit |
| the job does not read pull-request-only data, and the workflow does not run on push to `main` | `forbidden` | it could verify the trunk and does not |
| the job reads pull-request-only data, the workflow does not run on push to `main`, and the job has no `if:` | `allowed` | the whole workflow is already confined to pull requests, so no gate is needed |
| the job reads pull-request-only data, the workflow does not run on push to `main`, and the job has some other `if:` | `unclassifiable` | a condition this census does not model; it halts |
| the job reads pull-request-only data, the workflow runs on push to `main`, and the job's `if:` is exactly `github.event_name == 'pull_request'` | `allowed` | it is correctly excluded from the push trigger |
| the job reads pull-request-only data, the workflow runs on push to `main`, and the job's `if:` is anything else or absent | `forbidden` | it would start on a push and hard-fail |

#### The census is not narrowed — `P8`

`P8` forbids answering a halting census by excluding an item, pinning a count, or adding an allowlist. This census does none of those:

- **Nothing is excluded.** The population is every job of every file in `.github/workflows/`, taken from the same `loadWorkflows()` the other three censuses use. `receipts.yml` is in the population, not skipped.
- **No count is pinned.** The only assertion about size is `population.length > 0`, which is the non-empty guard the three sibling censuses already carry, copied verbatim in form.
- **There is no allowlist.** Whether a job reads pull-request-only data is derived from the job's own text by searching its serialised node for `github.event.pull_request`. No job name, no workflow name and no file name appears anywhere in the classifier.
- **It halts on the unknown.** Four distinct `unclassifiable` returns exist, and `test/support/census.ts:17-19` throws on any of them.

**Does adding a conditional job halt the existing three censuses?** No, and this was checked rather than assumed. Adding `if:` to the `mutation` job and `push:` to the `on:` block was applied to a throwaway copy of both workflow files during planning, and the three existing censuses passed unchanged before and after. The reason is structural: `classifyPermissions` reads only `job.permissions` and the workflow's top-level `permissions`, `classifyCredentials` reads only the `with:` of `actions/checkout` steps, and `classifyInstallItem` reads only the `run:` scripts. None of the three reads `on:` or `if:`, so neither addition is visible to them.

#### Criterion-to-test mapping

| Acceptance criterion | Test that discharges it |
|---|---|
| 1 — `rebuild.yml` declares `push` on `main` | `workflow-hardening.trunk-verification` |
| 2 — the `mutation` job is gated to `pull_request` | `workflow-hardening.trunk-verification` |
| 3 — the census exists, is closed, and is the receipt | `workflow-hardening.trunk-verification` itself, proved red-on-parent in section 6 and inert-mutation-red in section 7 |
| 4 — `receipts.yml` is unedited and its jobs classify allowed | `workflow-hardening.trunk-verification`, whose population includes both `receipts.yml` jobs |
| 5 — versions bump together | `node scripts/check-packaging.mjs`, section 4 step 8 |
| 6 — suite and typecheck green | `npm test` and `npm run typecheck`, section 8 |

No SPEC invariant is assigned to this unit by section 11.4, so there is no invariant-to-test row.

---

## 6. Red on the parent

**Parent commit:** the tip of `main` at branch-cut time. At authoring time that is `e5f0195`, in full `e5f0195cf621f3adaaff3d32aad2f49a27c51f0d`.

The new test cannot be run at the parent commit unmodified, because it does not exist there. The substitute procedure is the standard one and it produces a genuine red: **apply the test steps only, and run before the workflow steps.**

### The procedure

1. From the branch `ci/u0-trunk-verification-gate`, cut from `main`, apply **steps 1 to 5 of section 4 only**. Do not apply steps 6, 7 or 8.
2. Confirm the workflow file is still untouched:

```bash
git diff --name-only
```

Expected exit code: `0`. Expected stdout: exactly one line, `test/contract/workflow-hardening-census.test.ts`. If `.github/workflows/rebuild.yml` appears in that output, stop condition 5 applies.

3. Run the census file alone:

```bash
node --test "test/contract/workflow-hardening-census.test.ts"
```

Expected exit code: **non-zero**. Expected output: `pass 3`, `fail 1`, and the failing test named `workflow-hardening.trunk-verification`.

### The exact failure to expect

This is the text measured during planning, running the step 1-5 test file against the unmodified workflow files:

```
✖ workflow-hardening.trunk-verification
  AssertionError [ERR_ASSERTION]: Got unwanted exception: workflow-hardening.trunk-verification: 5 of 8 items violate or cannot be classified
  {"workflow":".github/workflows/rebuild.yml","job":"typecheck","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"test","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"coverage","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"inspector","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"seeded-mutation","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  Actual message: "census rejected a forbidden item: {"workflow":".github/workflows/rebuild.yml","job":"typecheck","triggers":{"pull_request":null},"referencesPullRequestContext":false}"
```

The number to check is **`5 of 8 items`**. Eight is every job in the repository: six in `rebuild.yml` and two in `receipts.yml`. Five is every job of `rebuild.yml` except `mutation`, which is already allowed at the parent because it reads pull-request-only data in a workflow that does not run on push. Both `receipts.yml` jobs are already allowed at the parent, which is criterion 4 holding without any edit to that file.

If the count is anything other than `5 of 8`, stop condition 6 applies.

### Then observe the green

4. Apply **steps 6 and 7 of section 4**.
5. Run the same command again:

```bash
node --test "test/contract/workflow-hardening-census.test.ts"
```

Expected exit code: `0`. Expected output: `pass 4`, `fail 0`, with `✔ workflow-hardening.trunk-verification` among the four.

This red-then-green pair, measured on a throwaway copy of the tree during planning, is the unit's receipt under `P11`. It is decided by a single run of each, and no re-run is part of it.

---

## 7. Inertness mutation

`P11` requires that reverting what the change added turns the assertion red again. This unit has two acceptance criteria carrying a behavioural change, so there are two mutations. Both were run during planning and both reddened the census, with different signatures.

### 7.1 Mutation for acceptance criterion 1 — remove the push trigger

**The exact edit to revert.** In `.github/workflows/rebuild.yml`, replace:

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

with:

```yaml
on:
  pull_request:
```

**The exact test that must turn red:** `workflow-hardening.trunk-verification`.

**Command:**

```bash
node --test "test/contract/workflow-hardening-census.test.ts"
```

**Expected exit code:** non-zero. **Expected failure text:**

```
  AssertionError [ERR_ASSERTION]: Got unwanted exception: workflow-hardening.trunk-verification: 6 of 8 items violate or cannot be classified
  {"workflow":".github/workflows/rebuild.yml","job":"typecheck","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"test","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"coverage","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"mutation","triggers":{"pull_request":null},"referencesPullRequestContext":true,"ifExpression":"github.event_name == 'pull_request'"}
  {"workflow":".github/workflows/rebuild.yml","job":"inspector","triggers":{"pull_request":null},"referencesPullRequestContext":false}
  {"workflow":".github/workflows/rebuild.yml","job":"seeded-mutation","triggers":{"pull_request":null},"referencesPullRequestContext":false}
```

The count is **`6 of 8`**, not the parent's `5 of 8`, because the `mutation` job now carries a gate in a workflow that does not run on push — a combination the census does not model, so it halts on it as `unclassifiable`. That is the census reporting an incoherent state rather than quietly passing it.

**The exact restore.** Re-apply section 4 step 6. Then run the command above again — a fresh observation against a restored file, not a repeat of a failed run — and expect exit code `0` and `pass 4`, `fail 0`.

### 7.2 Mutation for acceptance criterion 2 — remove the `mutation` job's gate

**The exact edit to revert.** In `.github/workflows/rebuild.yml`, replace:

```yaml
  mutation:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
```

with:

```yaml
  mutation:
    runs-on: ubuntu-latest
    steps:
```

**The exact test that must turn red:** `workflow-hardening.trunk-verification`.

**Command:**

```bash
node --test "test/contract/workflow-hardening-census.test.ts"
```

**Expected exit code:** non-zero. **Expected failure text:**

```
  AssertionError [ERR_ASSERTION]: Got unwanted exception: workflow-hardening.trunk-verification: 1 of 8 items violate or cannot be classified
  {"workflow":".github/workflows/rebuild.yml","job":"mutation","triggers":{"pull_request":null,"push":{"branches":["main"]}},"referencesPullRequestContext":true}
```

Exactly one item, and it is the `mutation` job. This is the census catching the precise failure `OR18` ruling 2 exists to prevent: a job that reads pull-request-only data starting on a push.

**The exact restore.** Re-apply section 4 step 7. Then run the command above again — a fresh observation against a restored file, not a repeat of a failed run — and expect exit code `0` and `pass 4`, `fail 0`.

---

## 8. Full verification

Run in this order, from the repository root, after every step of section 4 has been applied and after both mutations of section 7 have been restored. Run the whole of section 8 **before** making either commit in section 9: 8.1 reads the uncommitted working tree, and after a commit it would print nothing.

**Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository and an install rewrites tracked files (`P10`).

### 8.1 Confirm the working tree holds exactly the four intended files

```bash
git diff --name-only
```

Expected exit code: `0`. Expected stdout, in any order, exactly these four lines and no others:

```
.claude-plugin/plugin.json
.github/workflows/rebuild.yml
package.json
test/contract/workflow-hardening-census.test.ts
```

### 8.2 Typecheck

```bash
npm run typecheck
```

Expected exit code: `0`. Expected stdout and stderr: empty. `tsc --noEmit` prints a diagnostic line only on failure, so a successful run has no proving substring and the exit code is the whole result. This was run during planning against the modified test file under the project's own `tsconfig.json` settings — including `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` and `verbatimModuleSyntax` — and exited 0.

### 8.3 The census file alone

```bash
node --test "test/contract/workflow-hardening-census.test.ts"
```

Expected exit code: `0`. Expected output substrings: `pass 4` and `fail 0`, with `✔ workflow-hardening.trunk-verification` present.

### 8.4 Packaging

```bash
node scripts/check-packaging.mjs
```

Expected exit code: `0`. Expected stdout substring: `check-packaging: ok`.

### 8.5 The full suite

```bash
npm test
```

Expected exit code: `0`. Expected output substring: `fail 0`.

The suite was measured at 436 tests, 0 fail, exit 0 on this checkout before this change; this unit adds one test. **One known failure is governed by stop condition 4 in section 11.** That stop condition is the only place a re-run is permitted, it applies only to this full-suite gate, and it is disclosed in the pull request body every time it is used. No re-run is part of any acceptance criterion, of the receipt in section 6, or of the mutations in section 7.

---

## 9. Commits

Two commits. Neither mixes a refactor with a behaviour change.

### Commit 1

**Subject line, exactly:**

```
ci: run the rebuild workflow on push to main
```

**Files:**

```
.github/workflows/rebuild.yml
test/contract/workflow-hardening-census.test.ts
```

**Plan steps contained:** section 4 steps 1, 2, 3, 4, 5, 6 and 7.

Both files belong in one commit because the test in steps 1-5 is the receipt for the workflow change in steps 6-7. Separating them would leave the first commit red, breaking `P1`'s requirement that `npm test` pass on every merge commit.

### Commit 2

**Subject line, exactly:**

```
chore: bump the plugin version for the trunk verification gate
```

**Files:**

```
package.json
.claude-plugin/plugin.json
```

**Plan steps contained:** section 4 step 8.

Both files are in this one commit because `P4` requires them to bump together.

---

## 10. Pull request

Do not open the pull request by any path other than the command below. Ad-hoc `gh pr create`, `gh api` POSTs to the pulls endpoint and the GitHub MCP create tool are denied at the gate. A pull request's title and body are fixed at creation and are never rewritten afterwards, so never run `gh pr edit`.

### Measured diff size

Measured by applying every step of section 4 to a throwaway copy of the tree during planning and diffing against the working tree, not estimated:

| File | Lines added | Lines removed |
|---|---|---|
| `.github/workflows/rebuild.yml` | 3 | 0 |
| `test/contract/workflow-hardening-census.test.ts` | 69 | 2 |
| `package.json` | 1 | 1 |
| `.claude-plugin/plugin.json` | 1 | 1 |
| **Total** | **74** | **4** |

**78 changed lines: 7 production and metadata, 71 test.** The target is roughly 200 changed lines per reviewable pull request with 400 as the ceiling, so **this unit is not split.** Rejected: splitting the workflow change from the census that proves it, which would destroy the red-on-parent receipt by shipping the workflow change with nothing asserting it.

### The invocation

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head ci/u0-trunk-verification-gate \
  --base main \
  --title "ci(workflows): run the rebuild workflow on push to main" \
  --what "The typecheck, test, coverage, inspector and seeded-mutation jobs now run on every commit that lands on the trunk branch, not only on pull requests." \
  --what "The long-running mutation job now runs only for pull requests, because it reads data that exists only there." \
  --why "The trunk branch had no automated verification of any kind, so a claim that it was passing could not be checked by anyone." \
  --why "Widening the trigger on its own would have started a job that reads pull-request-only data and fails immediately without it." \
  --risk "The new runs are observational. The trunk branch has no required status checks, so a red run blocks no merge and reverts nothing." \
  --verified "node --test on the workflow census file - 4 pass, 0 fail, exit 0" \
  --verified "the new census before the workflow change - 1 fail, 5 of 8 items forbidden" \
  --verified "removing the push trigger - the census turns red, 6 of 8 items" \
  --verified "removing the mutation job condition - the census turns red, 1 of 8 items" \
  --verified "npm run typecheck - no diagnostics, exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok, exit 0" \
  --verified "npm test - 0 failures, exit 0" \
  --not-verified "trunk is verified green - unverified-reasoned, a tracked store defect gives a 5 percent per-run false red" \
  --not-verified "the mutation score - unverified-reasoned, no baseline exists for the store modules and none was measured"
```

Expected exit code: `0`. Expected stdout substring: the new pull request's URL, beginning `https://github.com/SatanshuMishra/logbook/pull/`.

Every `--verified` line above names a check section 6, 7 or 8 instructs the implementer to run and read. A `--verified` line for a check that was not run is forbidden by `P6`; such a check is written `--not-verified "<the same thing> - not run"`.

### When the full-suite re-run of stop condition 4 was used

Stop condition 4 permits exactly one re-run of `npm test`, and requires it to be disclosed. Read the recorded exit code of the first `npm test` run in section 8.5:

- **First run exited 0.** Use the invocation exactly as printed above.
- **First run failed only on `concurrent.distinct-ids` and the single re-run exited 0.** Use the invocation above with this one additional flag appended:

```
  --not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"
```

No other case reaches this section; every other case is a STOP under stop condition 4.

---

## 11. Stop conditions

For each: what the implementer sees, the exact command that shows it, and what to do.

### Stop condition 1 — the two version files already disagree

**What you see:** section 4 step 8 prints a line beginning `STOP version mismatch` on stderr and exits 1.

**Command that shows it:**

```bash
node -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync("package.json","utf8")).version, JSON.parse(fs.readFileSync(".claude-plugin/plugin.json","utf8")).version)'
```

Expected exit code: `0`. Expected stdout: one line carrying two version strings. If the two printed values are not identical, **STOP and report; do not improvise.**

A version merely **higher** than `1.4.1` is not a stop condition. It means the ladder shifted, and the read-then-increment in step 8 handles it correctly.

### Stop condition 2 — a workflow FIND string is not found, or is not unique

**What you see:** the text in section 4 step 6 or step 7 does not appear exactly once in `.github/workflows/rebuild.yml`.

**Command that shows it:**

```bash
grep -c '^  pull_request:$' .github/workflows/rebuild.yml
grep -c '^  mutation:$' .github/workflows/rebuild.yml
```

Expected exit code: `0` for each. Both must print exactly `1`. If either prints anything else, **STOP and report; do not improvise.**

### Stop condition 3 — a test-file FIND string is not found, or is not unique

**What you see:** one of the FIND blocks in section 4 steps 1 to 5 does not appear exactly once in `test/contract/workflow-hardening-census.test.ts`.

**Command that shows it:**

```bash
grep -c "^const WORKFLOWS_SUBPATH = \['.github', 'workflows'\]$" test/contract/workflow-hardening-census.test.ts
grep -c '^  return { id: jobId, permissions: job.permissions, steps }$' test/contract/workflow-hardening-census.test.ts
grep -c '^  return { file: label, topPermissions: (doc as Record<string, unknown>).permissions, jobs }$' test/contract/workflow-hardening-census.test.ts
grep -c "^    describeViolations('install-ignore-scripts', population, classify)$" test/contract/workflow-hardening-census.test.ts
```

Expected exit code: `0` for each. All four must print exactly `1`. If any prints anything else, **STOP and report; do not improvise.**

### Stop condition 4 — the known tracked full-suite failure

This block is reproduced verbatim from orchestrator ruling `OR19`. It governs the full-suite gate in section 8.5 and nothing else.

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

### Stop condition 5 — the workflow file was modified before the red observation

**What you see:** at section 6 procedure point 2, `git diff --name-only` lists `.github/workflows/rebuild.yml`.

**Command that shows it:**

```bash
git diff --name-only
```

Expected exit code: `0`. Expected stdout: exactly one line, `test/contract/workflow-hardening-census.test.ts`. Anything else means steps 6 or 7 were applied too early and the red observation is invalid. Revert the workflow file with `git checkout -- .github/workflows/rebuild.yml`, then repeat section 6 from point 2. When the extra line is not the workflow file, **STOP and report; do not improvise.**

### Stop condition 6 — the red on the parent is not `5 of 8 items`

**What you see:** at section 6 procedure point 3, the failure text names a total other than `8` items, or a violating count other than `5`.

**Command that shows it:**

```bash
node --test "test/contract/workflow-hardening-census.test.ts" 2>&1 | grep 'items violate'
```

Expected exit code: `0`, `grep` having found a match. Expected stdout substring: `5 of 8 items violate or cannot be classified`. Any other pair of numbers means the set of workflow files or jobs changed after this plan was written, so the plan's measured receipt no longer describes the tree. **STOP and report; do not improvise.**

### Stop condition 7 — a third workflow file exists

**What you see:** `.github/workflows/` contains a file other than `rebuild.yml` and `receipts.yml`.

**Command that shows it:**

```bash
ls .github/workflows/
```

Expected exit code: `0`. Expected stdout: exactly `rebuild.yml` and `receipts.yml`, one per line. A third file changes the census population and may classify as forbidden for reasons outside this unit's ceiling. **STOP and report; do not improvise.**

### Stop condition 8 — the census halts as `unclassifiable` after the change

**What you see:** after every step of section 4, section 8.3 fails and the failure text contains `census halted on an unclassifiable item`.

**Command that shows it:**

```bash
node --test "test/contract/workflow-hardening-census.test.ts" 2>&1 | grep 'census halted'
```

Expected exit code: `1`, `grep` having found nothing — a non-zero exit is the PASSING case for this command. Expected stdout: empty. When the phrase appears and `grep` exits `0` instead, a job exists in a shape this census does not model. **STOP and report; do not improvise.** Do not add an allowlist, do not exclude the item, and do not pin a count — `P8` forbids all three.
