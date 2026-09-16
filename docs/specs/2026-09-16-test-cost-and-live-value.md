# The suite costs what it proves

Date: 2026-09-16
Status: specified
Thread: `01M2MCZHA78N2MD45HHT9TSYSK`, test-cost-and-live-value
Verified against: `main` at `14270097`

---

## Read this first

- The **gate** is the set of CI jobs a pull request waits on before it can merge, `.github/workflows/rebuild.yml`.
- A **layer** is one of the six directories under `test/`: unit, store, contract, sync, spawn, hooks. The `npm test` script names all six, `package.json:12`.
- A **census** in this repository is a test that classifies every member of a population and halts on anything it cannot classify, `test/support/census.ts:12`. The discipline is sound. This spec separates two kinds of census that the discipline does not distinguish.
- A **lint census** classifies the repository's own authored text: source files, documents, manifests, workflow configuration. It states a property of the tree.
- A **behaviour census** classifies something the running product produces: a published schema, a refusal, a rendered surface. It states a property of the product.
- A **seam** is a place where two surfaces owned by different mechanisms must agree. A skill file and the tool it names is a seam. A hook and the state a tool wrote is a seam.
- The **frontier sweep** is `test/unit/briefing-frontier-sweep.test.ts`. It generates a grid of thread shapes, searches each for the point at which the briefing renderer begins clipping, and asserts five properties across every point it finds.
- A **mutant** is a one-token edit to shipped code applied on purpose, to check that some test turns red. The gate already applies exactly one, `.github/workflows/rebuild.yml:62`.

---

## The problem

A pull request waits 21 minutes 45 seconds and burns about 60 minutes of CI compute, and one test accounts for most of it.

Measured on run `35061454145`: typecheck 20s, inspector 11s, `test (24.x)` 9m30s, `test (26.x)` 11m53s, `seeded-mutation` 16m02s, `test (22.19.x)` 21m45s. The gate waits on the slowest, so 22 minutes is the number a human feels.

Locally the whole suite is 1,127 tests in 290.24s. Re-running it with one test skipped, `--test-skip-pattern='frontier-sweep-finds-no-record'`, gives 1,126 tests, all passing, in 93.17s. That one test is `briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach` at 231.1s. Its own layer runs in 4.85s without it, so it is 98 percent of the unit layer.

The gate pays it five times per pull request. Three matrix legs run the whole suite. `seeded-mutation` runs `node --test "test/unit/**/*.test.ts"` twice, once for a baseline and once with the mutant, and that glob contains the sweep. There is no fail-fast, so the mutant leg runs it to completion too.

The sweep does not guard what it is named for. Three one-token mutants were seeded into `src/render/briefing.ts`, one per defect class its assertions name, and the unit layer was run each time with the sweep skipped:

| Mutant | Site | Defect | Unit layer without the sweep |
|---|---|---|---|
| `&&` to `\|\|` | `src/render/briefing.ts:60` | an over-budget render reports itself as fitting | red |
| `Math.max` to `Math.min` | `src/render/briefing.ts:317` | risk text clips below its guaranteed floor | red |
| `risks.live` to `risks.live.slice(1)` | `src/render/briefing.ts:474` | the first live risk is never rendered | red |

All three are caught by tests that already exist.

Separately, 24 test files totalling 6,696 lines read this repository's own authored text and assert structural facts about it. `contract.source-is-greppable-text` is 123 lines asserting that files under `src/` are valid UTF-8 with no NUL bytes. None of these can turn red when the plugin breaks, and all of them turn red when a file is reworded. They are lint, and they sit in the layer the gate waits on.

### What is not the cause

**Process isolation is not the cost.** node runs each test file in its own process; the measured floor is 0.10s per file across 168 files. Consolidating files buys nothing.

**The transport is not the cost.** `test/spawn/handshake.test.ts` spawns the real server over stdio in 0.40s, while `test/unit/prompts.test.ts`, which uses an in-memory linked pair and no child process, takes 1.63s. Moving spawn tests to a cheaper transport would make some of them slower, and the MCP TypeScript SDK's own testing guide states that stdio coverage requires spawning the real process.

**The `.control.*` tests are not the cost.** All 130 of them total 8.5s. Whatever case exists against them is about maintenance weight, and this spec does not make it.

---

## The rule

A test earns its place on the gate by protecting behaviour a user of this plugin can observe, reached through the entry point that user's request travels through, at a cost proportionate to what it proves. Everything else runs, but not on the gate.

| Kind of check | Where it runs | What it may cost |
|---|---|---|
| Behaviour test, reaching the product through its real entry point | the gate | its size's budget |
| Seam test, crossing two surfaces in one flow | the gate | its size's budget |
| Lint census over the repository's own text | a lint stage, off the test runner | under 30 seconds for all of it |
| Generated or exhaustive input sweep | a scheduled job | unbounded |
| Mutation run | a scheduled job | unbounded |

---

## Scope

### In scope

The six changes in Sections 1 to 6, and the tests in Section 7 that prove each of them.

### Out of scope, on purpose

- **The 130 `.control.*` tests.** They cost 8.5 seconds. Removing them is a judgement about maintenance weight, not about cost or fidelity, and it is not settled by anything measured here.
- **The concentration of 10,000 test lines on the 680-line briefing renderer.** Section 1 removes the largest single piece of it. Whether the remainder is redundant needs a per-file read, which is the audit document, not this spec.
- **Re-tiering the six layers by resource size.** The sizes are a useful classification and the `writing-tests` skill now carries the rule, but renaming and re-homing 168 files is a separate pass.
- **Anything the deferred-cap-items spec at `docs/plans/2026-09-14-deferred-cap-items.md` already owns.**

---

## Section 1: the frontier sweep becomes pinned boundary cases

`test/unit/briefing-frontier-sweep.test.ts:546` runs a grid of 3 fills by 2 anchorings by 8 criteria counts by 4 key-decision counts. Each cell runs a `largestSatisfying` search for a saturating bulk count, then for each bulk count another `largestSatisfying` search over criterion text length, then a frontier search, then a render per located length. Every probe builds a fixture, serialises it and calls `renderBriefingWithPasses`.

The five properties it asserts stay. What goes is the search.

Compute once, by hand, from the current caps: per fill, the largest criterion text the record byte cap admits, the clip frontier and its two immediate neighbours, the midpoint beyond it, and the saturating bulk count. Commit those as named constants in `test/support/briefing-sweep-fixture.ts`. The pre-merge test then renders exactly those shapes and asserts the same five properties over them.

The constants can drift when a cap moves. That is what the scheduled job in Section 6 guards: it re-runs the full generated grid and fails if any pinned constant no longer sits where the search puts it.

The sweep's other test, `briefing.frontier-sweep-one-risk-with-several-references-counts-as-one-item`, is already a fixed case and is untouched.

**Done when:** the unit layer runs in under 10 seconds, the five properties still have assertions, and each of the three mutants in the table above still turns the unit layer red.

---

## Section 2: the lint census leaves the test runner

These 24 files, 6,696 lines, move out of the six globs in `package.json:12` and into a lint stage that the gate runs as its own job:

`test/contract/` — `source-is-greppable-text`, `no-sleeps`, `no-literal-identifiers`, `no-literal-limits-in-descriptions`, `no-stdout-in-src`, `temp-dirs-are-atomic`, `environment-is-injected`, `shipped-imports-census`, `spawn-allowlist`, `limits-register-census`, `readme-promises-census`, `spec-errata-census`, `assertions-are-not-invariants`, `continuity-rule-census`, `workflow-hardening-census`, `mandatory-tests`, `plugin-size`, `resume-path-has-no-settledness-aggregate`, `pre-commit-typecheck-installed`, `cutover-old-tree-absent`, `cutover-manifests-agree`.

`test/unit/` — `markdown-construct-census`, `limits-register`, `disposal-census`.

Nothing is deleted and no assertion is weakened. They keep the closed-census discipline. They move to `test/lint/`, get their own npm script, and get their own CI job alongside `typecheck` and `inspector`. The gate still fails when one of them fails.

`contract.mandatory-tests` spawns the live server to read its tool list before parsing the test tree. It stays in this set: its subject is the test tree, and the spawn is how it derives the population rather than what it proves.

**Done when:** `npm test` still names its six globs, with the unit and contract directories 24 files lighter, a lint script names `test/lint/**`, both are wired into the workflow, and the lint job finishes in under 30 seconds.

---

## Section 3: seed counts derive from the cap they prove

`completion.is-bounded` at `test/spawn/completions.test.ts:212` seeds 300 threads through the live server to prove the completion list is capped. It costs 69.2 seconds, and every seeded thread is several `spawnSync('git', ...)` calls, `src/store/git.ts:89`.

The cap is not this repository's. It is the MCP TypeScript SDK's: `values: suggestions.slice(0, 100)` and `hasMore: suggestions.length > 100`, `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:905`. The protocol schema caps the array at the same number, `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:1905`.

Declare that cap as a named constant in the test file, with its provenance in the constant's name rather than in a comment, and seed `cap + 1`. All three assertions survive: `values.length` equals the cap, `hasMore` is true because the population exceeds it, and `total` equals the seeded count.

`roster.paginates` seeds 60 at `test/spawn/roster.test.ts:189` against a default page size of 25, `src/server/tools/list_threads.ts:8`. Three pages needs 51. The saving is not worth the churn and this spec leaves it alone.

**Done when:** no literal seed count above a cap appears in `test/spawn/completions.test.ts`, and `completion.is-bounded` runs in under 30 seconds.

---

## Section 4: the skill and the hook are proved to agree

Step 11 of `skills/preflight/SKILL.md` is `Stop.`, so the skill's correct execution ends a turn having written nothing to the ledger. `ledgerPresenceVerdict` at `src/hooklib/stop-gate.ts:171` then fires, because the pointer names this session, a resume baseline exists for it, and the ledger head has not moved.

Both halves are asserted by passing tests. `hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume` requires the gate to fire on that state. `skill.preflight-presents-and-stops` requires the skill to stop after printing. They encode contradictory expectations of one flow and nothing composes them.

`test/contract/skills.test.ts` cannot close this. It parses SKILL.md into numbered steps and asserts word order, so it turns red when the file is reworded and stays green when the agent following the file produces a bad outcome.

Add a `claude plugin eval` suite at `evals/`. The first case is the seam: a prompt of `/logbook:preflight <id>`, a `tool_used` grader on `resume_thread`, and a grader asserting the turn ends without a block. The suite runs in a scheduled job, never on the gate, because every case and every judge grader is a billed model call.

Whether the contradiction is resolved by changing the skill, the gate, or both is a decision for whoever implements this. This spec requires only that the disagreement becomes visible to a test.

**Done when:** `evals/` holds at least the preflight case, a scheduled workflow runs `claude plugin eval` against it, and that case fails against `main` at `14270097`.

---

## Section 5: the dead entry point goes

`bin/logbook-cli.ts` is invoked by nothing. `hooks/hooks.json` names `hooks/*.ts` directly, no test names the file, and its only other reference is a directory-listing row at `README.md:76`.

`docs/registers/size-limits.json` nonetheless carries two rows for it, `STDOUT_FD` at `bin/logbook-cli.ts:7` and `STDERR_FD` at `bin/logbook-cli.ts:8`, both pinned to exact line numbers and policed by `contract.limits-register-census`. The governance layer is keeping dead code alive and taxing every edit that shifts a line in it.

Delete the file, the two register rows, and the `README.md:76` mention of it. The README row is a directory listing, not an `LG<n>` promise row, so `readme-promises-census` is unaffected.

**Done when:** `bin/` holds only `logbook-server.ts`, the register holds 86 rows, and the lint stage from Section 2 is green.

---

## Section 6: the mutation gate becomes a real gate, off the gate

`seeded-mutation` at `.github/workflows/rebuild.yml:62` applies one mutant to one file and asserts the unit layer reddens. The idea is right. At one mutant it proves one line is guarded, and it costs 16 minutes because it runs the unit layer twice, sweep included.

Replace it with two things.

A **scheduled mutation job** that runs a real mutant set against the behaviour layers. If StrykerJS is adopted, set `break` explicitly: it defaults to `null`, so a run without it produces a report and no gate. Use the covered-code score, detected over covered, because that is the number that exposes tests which execute code without checking it. Scope with `--mutate` and `incremental` rather than mutating everything.

A **scheduled sweep job** that runs the generated grid Section 1 removed from the gate, and fails if any pinned constant no longer sits where the search puts it.

The current single-mutant job may stay on the gate only if it stops running the sweep. It runs the unit glob, so Section 1 fixes that as a side effect.

**Done when:** no CI job on the pull-request path exceeds five minutes, and a scheduled workflow runs both the mutation set and the generated sweep.

---

## Section 7: tests

Each section is proved by something already measurable, not by a new assertion about the suite's shape.

| Section | What proves it |
|---|---|
| 1 | The three mutants in the problem table each redden the unit layer, applied one at a time and restored between. The unit layer runs under 10s. |
| 2 | `npm test` and the lint script together name every file that was in the six globs before the move, with none dropped and none duplicated. |
| 3 | `completion.is-bounded` passes with `cap + 1` seeds and fails with `cap` seeds, because `hasMore` is then false. |
| 4 | The preflight eval case scores below threshold against `main` at `14270097`. A case that passes before the change proves nothing. |
| 5 | The lint stage is green with the file and its register rows gone, which is `limits-register-census` confirming no orphan row and no unregistered site. |
| 6 | `gh run view` on a pull request reports every job under five minutes. |

No new census is added by this spec. Section 2 moves existing ones and Section 1 replaces a search with constants; neither needs a test that asserts a property of the test suite.

---

## Release

This changes no published tool, no stored shape, no refusal and no rendered surface. `bin/logbook-cli.ts` is removed, and it is unreachable from the plugin manifest, so no caller loses an entry point.

Minor, unless the implementation of Section 4 resolves the skill and gate disagreement by changing what the Stop hook does or what the preflight skill prints. Either of those changes behaviour a user observes, and OR44 then makes it a major.

---

## Deferred

Recorded here so they are not rediscovered, and not in scope above.

- The `.control.*` population, 130 tests, 8.5 seconds.
- The 10,000 test lines aimed at `src/render/briefing.ts`, after Section 1 removes the largest piece.
- Re-homing the six layers by resource size.
- `roster.paginates` seeding 60 against a minimum of 51.
- The audit document that criterion c1 asks for, which this spec does not need and which should enumerate only the files a named rule marks for deletion, plus the seams that have no crossing test.
