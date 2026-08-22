# M11 — Dev loop and CI

**Depends on:** M3 only. Can run alongside almost anything (§13.3).

**Ships:** the Inspector configuration and scripts, the CI pipeline, mutation testing with an explicit threshold, and coverage reporting.

**Read first:** SPEC §11.8, §12.1, §12.2, §12.3, and `00-overview.md` §6.

---

## Premise checks

- [ ] **P1. M3 is merged and green on `main`.**
- [ ] **P2. The Inspector's version 2 command line exits non-zero on failure.** `npx -y @modelcontextprotocol/inspector@2.3.0 --cli node /nonexistent --method tools/list; echo $?` prints a non-zero code. §12.2 records that "the CLI exits 0 on failure" is v1 guidance and wrong now; if it is right again, the CI step must assert on output instead of on the exit code.
- [ ] **P3. The plugin's own server configuration does not resolve outside the client.** `npx -y @modelcontextprotocol/inspector@2.3.0 --cli --config .mcp.json --server ledger --method tools/list` fails to resolve a module. This is why two configuration files are required (§12.2); confirm it rather than assuming it.
- [ ] **P4. Stryker's command runner drives an arbitrary test command.** `npx -y @stryker-mutator/core@10.0.0 --help` documents `testRunner: "command"`. If it does not, evaluate the TAP runner against `node --test` output before writing the config, and record which was chosen and why.
- [ ] **P5. Node's test runner reports coverage.** `node --test --experimental-test-coverage rebuild/test/unit/` emits a coverage table. If the flag has changed name, re-derive the coverage command.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | The full gate runs on a clean checkout | the CI job passes on a fresh clone with no cached state |
| A2 | A seeded mutation is caught | `mutation.seeded-is-caught` — a deliberate mutant survives nothing |
| A3 | The Inspector smoke step exits 0 | the CI step passes |
| A4 | The suite's result does not depend on who runs it | `contract.environment-is-injected` passes as a census |
| A5 | Coverage is reported and never gated | the CI log carries a coverage table and no job fails on a coverage number |
| A6 | Mutation testing is diff-scoped with an explicit break threshold | `rebuild/stryker.config.json` sets `break: 70` |
| A7 | `tsc --noEmit` runs before every commit | the pre-commit hook is installed and fails on a type error |

**Red on the parent commit:** `contract.environment-is-injected`.

**Inertness mutation:** in any one `rebuild/src/` module, replace an `rt.env` read with `process.env`. `contract.environment-is-injected` must turn red and name the module.

---

## Files

**Create:** `rebuild/inspector.config.json`; `rebuild/stryker.config.json`; `.github/workflows/rebuild.yml`; `rebuild/test/contract/environment.test.ts`; `scripts/pre-commit-typecheck.sh`.

**Modify:** `package.json` scripts; `receipts.config.json`.

---

## Task 1: The environment census

**Files:** `rebuild/test/contract/environment.test.ts`

- [ ] **Step 1: Write the failing census `contract.environment-is-injected`**

Walk every `.ts` file under `rebuild/src/`, `rebuild/bin/` and `rebuild/hooks/`. Classify every occurrence of `process.env`, `process.cwd`, `Date.now`, `new Date`, `Math.random` and `crypto.randomUUID`:

- **allowed** — inside `rebuild/src/runtime/runtime.ts`, which is the one place production wires the real ones;
- **forbidden** — anywhere else;
- **unclassifiable** — halts the census.

**Environment is an injected argument, never defaulted to the ambient process** (§11.8). The current suite reads the developer's shell: with one variable set it fails 31 tests, and scrubbed it passes all 1,059. A suite whose result depends on who runs it is not a suite.

- [ ] **Step 2: Add the determinism assertions**

```
contract.no-literal-identifiers   a census over rebuild/test/: no test asserts a literal ULID or a
                                  literal ISO timestamp. Assertions are on properties -- correct
                                  length, correct alphabet, unique, and the embedded time decodes
                                  to the injected clock
contract.no-sleeps                no test calls setTimeout with a delay above zero, and no test
                                  makes a network call to a host that is not the local filesystem
contract.temp-dirs-are-atomic     temporary directories are created with mkdtemp, never composed
                                  from a timestamp
```

`contract.no-literal-identifiers` permits an ordering assertion only across distinct milliseconds; same-millisecond ordering is not guaranteed (§11.8).

- [ ] **Step 3: Fix what the censuses find, run to green, commit**

```bash
git add rebuild/test/contract/environment.test.ts rebuild/src
git commit -m "test(rebuild): census that nothing reads the ambient process"
```

---

## Task 2: The Inspector

**Files:** `rebuild/inspector.config.json`

- [ ] **Step 1: Write the second configuration file**

```json
{
  "mcpServers": {
    "logbook": {
      "command": "node",
      "args": ["rebuild/dist/bin/logbook-server.js"],
      "env": { "CLAUDE_PLUGIN_DATA": "${PWD}/.inspector-data" }
    }
  }
}
```

**Two files, deliberately** (§12.2). The plugin's own `.mcp.json` contains `${CLAUDE_PLUGIN_ROOT}` and `${user_config.*}` substitutions that only the client expands; pointed at the Inspector it fails to resolve a module.

- [ ] **Step 2: Add the scripts**

```json
"rebuild:inspect": "mcp-inspector --config rebuild/inspector.config.json --server logbook",
"rebuild:inspect:cli": "mcp-inspector --config rebuild/inspector.config.json --server logbook --cli --method tools/list"
```

**Pin the version exactly** in `devDependencies` at `2.3.0`. Version 2 was a full rewrite and nearly all published guidance describes version 1: the proxy port, the old token variable, and the exit-code behaviour are all wrong now (§12.2).

- [ ] **Step 3: Record what the Inspector is and is not for**

It answers: what tools exist and what is their schema; does this tool return the right thing; why did the server fail to start, from its stderr in the console panel; what actually went over the wire, from the protocol panel. It does **not** validate arguments — that is a test, not the Inspector.

**In CI it is one smoke step, not a contract test.** Its value is that it is an *independent* client implementation, so it catches "my server only works against my own harness". It has no assertions.

- [ ] **Step 4: Commit**

```bash
git add rebuild/inspector.config.json package.json
git commit -m "chore(rebuild): pin the inspector and give it its own configuration"
```

---

## Task 3: Mutation testing

**Files:** `rebuild/stryker.config.json`

- [ ] **Step 1: Write the config**

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "command",
  "commandRunner": { "command": "node --test rebuild/test/unit/ rebuild/test/store/" },
  "mutate": ["rebuild/src/**/*.ts"],
  "thresholds": { "high": 85, "low": 75, "break": 70 },
  "coverageAnalysis": "off",
  "timeoutMS": 60000
}
```

`break: 70` is the explicit threshold §11.4 requires. **Never 100**, because equivalent mutants are undecidable and a 100 threshold makes the gate unsatisfiable, which is the same failure shape as an acceptance list treated as a floor (§2.4).

The command runner drives the unit and store layers only. The spawn, hook and sync layers are excluded because each spawns real processes and a mutation run over them is measured in hours, not minutes — **this exclusion is logged in the CI output**, not left silent. A workflow that bounds coverage and does not say so reads as having covered everything.

- [ ] **Step 2: Scope it to the diff**

The CI step computes the changed `rebuild/src/**/*.ts` files against the pull request base and passes them to `--mutate`. A full-tree mutation run happens on the integration branch only.

- [ ] **Step 3: Write the seeded-mutation check**

`mutation.seeded-is-caught`: a CI step that introduces one known mutation — flip the comparison in `evaluateDoneGate`'s all-criteria-done check — runs the unit layer, and asserts it fails. **A mutation gate that has never caught anything proves nothing**, and this is the mutation gate's own red test.

- [ ] **Step 4: Commit**

```bash
git add rebuild/stryker.config.json
git commit -m "ci(rebuild): gate the diff on mutation score with an explicit threshold"
```

---

## Task 4: The pipeline

**Files:** `.github/workflows/rebuild.yml`, `receipts.config.json`, `scripts/pre-commit-typecheck.sh`

- [ ] **Step 1: Write the workflow**

Jobs, in this order, each blocking:

| Job | Command | Node |
|---|---|---|
| typecheck | `npm run rebuild:typecheck` | 24 |
| build | `npm run rebuild:build` | 24 |
| test | `npm run rebuild:test` | matrix 22.18, 24, 26 |
| coverage | `node --test --experimental-test-coverage rebuild/test/unit/` | 24, **reported, never gated** |
| mutation | diff-scoped Stryker | 24 |
| inspector | `npm run rebuild:inspect:cli` | 24, asserts exit 0 |

The matrix exists because the published `engines.node` floor is `>= 20` for the compiled artifact while development needs `>= 22.18.0` for type stripping; the three versions are the floor of the dev range, the LTS line and Current.

**Retry-until-green is forbidden.** No job carries a retry, and a flaky test is quarantined off the critical path with a filed owner rather than re-run (§11.8).

**Coverage is reported and never gated.** It is read for what is *not* covered (§11.8). A high number does not imply quality, which is why the mutation score is the gate instead (§11.3).

- [ ] **Step 2: Update `receipts.config.json`**

`verify.test_command` becomes `node --test {test}` and `verify.scopedCheckCmd` becomes `node --test`, so a diff-scoped receipt runs a single rebuild test file rather than the whole legacy suite. `build.test_command` and `verify.suite_command` become `npm run rebuild:test` at M12, not here — the legacy suite is still the one guarding the running plugin until cutover.

Set `verify.on_load_error_red` so an import or collection error is not counted as a genuine red; an import error is not evidence a fix failed, and counting it as one invalidates the receipt.

- [ ] **Step 3: Install the pre-commit type check**

`scripts/pre-commit-typecheck.sh` runs `npm run rebuild:typecheck` and exits non-zero on failure. Type stripping performs **no type checking**, so a bad import is a runtime crash that reaches the client as a dead pipe (§12.1). This is the cheapest place to catch it.

- [ ] **Step 4: Run the whole gate on a clean checkout**

Clone the repository into a fresh directory, `npm ci`, and run every job's command. A gate that only passes in a warm working tree is not a gate.

- [ ] **Step 5: Run the inertness mutation and record it**

Replace one `rt.env` read with `process.env`; confirm `contract.environment-is-injected` turns red and names the module; restore.

- [ ] **Step 6: Commit and open the pull request**

```bash
git add .github/workflows/rebuild.yml receipts.config.json scripts/pre-commit-typecheck.sh
git commit -m "ci(rebuild): run typecheck, tests, mutation and an inspector smoke on every change"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m11-dev-loop-and-ci --base main \
  --title "ci(rebuild): gate the rebuild on types, mutation score and an independent client" \
  --what "Every change to the rebuild is checked for type errors, run on three Node versions, and driven once by a client this project did not write." \
  --what "Test results no longer depend on which variables happen to be set in the shell that runs them." \
  --why "The suite passed or failed depending on the developer's environment, nothing type-checked before commit, and no coverage command existed at all." \
  --verified "clean-checkout run of every gate - passing" \
  --verified "seeded mutation in the done gate - caught" \
  --not-verified "wire-level protocol conformance - the official runner drives HTTP servers only and cannot drive stdio"
```
