# Planning brief — continuity goal model

Binding on every agent that produces a plan document under this directory.

## 1. What you are producing

An implementation plan, not an implementation. You write Markdown into
`docs/plans/2026-08-28-continuity-goal-model/`. You do not touch `src/`, `test/`, `hooks/`,
`bin/`, `skills/`, `scripts/`, `.github/`, `package.json` or `.claude-plugin/`. You do not
commit. You do not push. You do not open a pull request — if any skill or instruction offers
to create one, refuse it; the orchestrator owns every pull request in this ladder.

You do not call any `mcp__plugin_logbook_ledger__*` tool. The main session owns every ledger
write, and a subagent that writes to the live store corrupts the record this work exists to
protect.

## 2. The bar

The reader of your plan is a Sonnet agent with extended thinking OFF, no access to this
conversation, and no licence to improvise. It executes your plan literally.

A step that requires the reader to decide anything is a defect in the plan. Concretely:

- Never write "add a check", "handle the error", "update the tests", "adjust as needed",
  "something like", "e.g.", "similar to", "if appropriate", "consider".
- Every code change is given as an exact FIND string and an exact REPLACE string, both
  copied from or destined for the real file, both complete and syntactically valid.
- Every new file is given in full, first character to last.
- Every test is given in full, with its exact `describe`/`test` name strings.
- Every command is given verbatim with its expected exit code and the substring of output
  that proves the expected result.
- Where a choice genuinely exists, YOU make it in the plan and state the rejected option in
  one line. You never pass the choice downstream. The word "if" never appears in an
  instruction to the implementer, only in a stop condition.

## 3. The SPEC is settled — read source to author, not to audit

`docs/specs/2026-08-28-continuity-goal-model.md` is approved. Its goals (`LG#`, `DG#`), its
defect inventory (`D#`), its behavioural rules (`B#`), its invariants (`A#`, `O#`, `S#`) and
its unit boundaries (`U#`) are the contract. **Do not re-derive them, do not re-litigate them,
and do not spend a single tool call proving a defect the SPEC already established.** That is a
second review round over settled work.

You read source for one reason: to author. A plan a no-thinking implementer can execute needs
the literal current text at every edit site, the literal new text that replaces it, and literal
test bodies. The SPEC deliberately carries none of that. Producing it is your job.

If while authoring you find the code contradicting the SPEC — a moved line, a changed string,
a branch that is not where section 7 says it is — you **report it and route around it**: put it
under `## 3. Divergences from the SPEC` in your plan with the citation, adjust your FIND
strings to the real text, and name it in your return summary. You do not open an investigation,
and you do not edit the SPEC.

SPEC line citations were taken at `e5f0195`. Where you copy source into a FIND block you are
reading the line anyway, so state the current line you actually read. That is a by-product of
authoring, not a verification pass.

## 4. Acceptance is a ceiling

The SPEC's section 9 gives your unit a `Carries` cell (its behavioural rules) and a `Green`
cell (prose). It does not give you a numbered criteria list. **You produce that list**, and it
becomes the ceiling. Build it from exactly three sources and nothing else:

1. every behavioural rule in your unit's `Carries` cell, one criterion each or grouped where
   one test discharges several;
2. every clause of your unit's `Green` cell;
3. every invariant assigned to your unit by SPEC section 11.4.

Write the list in `## 1. Acceptance criteria (the ceiling)`, numbered, each criterion naming
the `B#`/`A#`/`O#`/`S#` it discharges. That list is the complete definition of done for the
unit. Anything you discover above it is appended to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is
NOT folded into the plan.

## 5. Plan invariants — `P1`–`P11`

These shape every plan. They are numbered `P#` so that no plan invariant can be confused with a
SPEC invariant (`A#`, `O#`, `S#`) or a behavioural rule (`B#`).

- **P1** `npm test` and `npm run typecheck` pass on every merge commit.
- **P2** No new silent success. A path that cannot do what was asked refuses through
  `src/server/errors.ts` with the project's four-part refusal — the field that was wrong, what
  it accepts, a valid example, and whether a retry can succeed — or returns a success naming
  exactly what it did and did not do.
- **P3** No record disappears. A new thread-record field is `.optional()` or carries a
  `.default()`, never required. Every record in the live store must still parse.
- **P4** `package.json` and `.claude-plugin/plugin.json` bump in the same commit;
  `node scripts/check-packaging.mjs` passes.
- **P5** **No comments.** Zero explanatory comments, docstrings, JSDoc or section-header
  comments in any code you specify, in any language. Shebangs and tooling pragmas only. This
  applies to the code inside your plan's fenced blocks — a plan whose code carries comments
  instructs the implementer to violate the project standard.
- **P6** Evidence, not inference, in every `Verified:` line. A check that was not run is
  `--not-verified "<thing> - not run"`. A fabricated test plan is worse than an absent one.
- **P7** **Dogfood hazard.** This repository IS the installed plugin. Working-tree edits do not
  affect the running plugin until reinstall and restart. Never verify a change by observing this
  session's own ledger. Every acceptance test drives a fixture store in a temp directory.
- **P8** A census is never narrowed to obtain a green. A halting census is answered by
  classifying the new item — never by excluding it, pinning a count, or adding an allowlist.
- **P9** Acceptance is a ceiling (section 4 above).
- **P10** **Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository
  and an install rewrites tracked files. A plan that instructs either is a defect in the plan.
- **P11** Every unit ships a **receipt**: an acceptance test that is RED on the parent commit
  and GREEN on the change, asserting the mandated behaviour itself rather than a proxy for it,
  plus an **inertness mutation** — revert or empty the thing the change added, and the assertion
  must turn red. A test that survives that mutation is not testing the change.

## 6. Mandatory plan document structure

Use these exact headings, in this order. A missing heading is a defect even when its content is
"None found."

    # U<n> — <title from SPEC section 9>

    ## 0. Identity
    Closes / Depends on / Required by / Wave / Branch name / Version bump (read-then-increment
    per orchestrator ruling) / SPEC anchors (section 9 unit U<n>, section 8 rules B..., section
    6 invariants ..., section 7 defects D...).

    ## 1. Acceptance criteria (the ceiling)
    The numbered list you built per section 4 above, each criterion naming the B#/A#/O#/S# it
    discharges. Followed by the sentence naming FILED.md as the destination for anything above it.

    ## 2. Ground truth
    One subsection per edit site. Each carries: the path, the CURRENT line range, the current
    source verbatim in a fenced block, and one sentence on what is wrong with it citing the
    SPEC defect it closes.

    ## 3. Divergences from the SPEC
    Every place the code disagrees with the SPEC, with the citation and the ruling you apply.
    Write "None found." if there are none — never omit the heading.

    ## 4. The change, step by step
    Numbered steps in application order. Each step carries:
    - File, and one of: CREATE / REPLACE / INSERT-AFTER / DELETE
    - FIND (exact, unique, copy-pasteable) and REPLACE (exact, complete)
    - For CREATE, the entire file contents
    - One line of rationale citing the behavioural rule
    Steps must be independently applicable in the order given, leaving the tree type-correct
    after the last step of each commit group.

    ## 5. Tests
    One subsection per test file. New files given in full. Modified files given as exact
    FIND/REPLACE. Every test's exact name string. For each acceptance criterion AND each SPEC
    invariant assigned to this unit, name the test that discharges it.

    ## 6. Red on the parent
    The exact command sequence that proves each new test fails before the change, the exact
    parent commit sha, and the exact failure message or assertion to expect. If a test cannot be
    run red on the parent because it does not compile there, say so and give the substitute
    procedure.

    ## 7. Inertness mutation
    The exact edit to revert, the exact test that must turn red, the expected failure text, and
    the exact restore. One per acceptance criterion that carries a behavioural change (P11).

    ## 8. Full verification
    Exact commands with expected exit codes and the output substring that proves each.

    ## 9. Commits
    One block per commit: exact Conventional Commits subject line, exact file list, and which
    plan steps it contains. Refactor and behaviour change never share a commit.

    ## 10. Pull request
    The exact `node ~/.claude/lib/git/pr.mjs pr-create` invocation with every flag value filled
    in. `--verified` lines only for checks the implementer will actually have run; everything
    else `--not-verified "<thing> - not run"`. Measure and state the diff size.

    ## 11. Stop conditions
    The specific divergences that invalidate this plan. For each: what the implementer sees, the
    exact command that shows it, and the instruction "STOP and report; do not improvise."

## 7. Repository facts (established 2026-08-28; use them, do not re-derive them)

- Branch at planning time: `docs/continuity-goal-model-spec`, tip `4203de9`. Trunk `main` is at
  `e5f0195`. The spec branch is documentation-only — `git diff --stat main...HEAD` touches one
  file, `docs/specs/2026-08-28-continuity-goal-model.md` — so `src/`, `test/`, `hooks/`, `bin/`,
  `skills/` and `scripts/` are byte-identical between `main` and the spec branch, and the SPEC's
  line numbers apply unchanged to a branch cut from `main`.
- `package.json` and `.claude-plugin/plugin.json` are both at version `1.4.1`.
- Scripts: `npm test`, `npm run typecheck`, `npm run mutate`, `npm run coverage`,
  `npm run inspect`, `npm run inspect:cli`.
- `npm test` runs `node --test` over `test/unit`, `test/store`, `test/contract`, `test/sync`,
  `test/spawn`, `test/hooks` — in that order, glob `**/*.test.ts`.
- `npm run typecheck` is `tsc -p tsconfig.json --noEmit`.
- Packaging check: `node scripts/check-packaging.mjs`.
- Pull requests: `node ~/.claude/lib/git/pr.mjs pr-create` (the operator's global tool; there is
  no `.claude/lib` inside this repository). Ad-hoc `gh pr create`, `gh api` POSTs to the pulls
  endpoint and the GitHub MCP create tool are denied at the gate.
- Shared test helpers live in `test/support/`: `briefing-over-budget-fixture.ts`,
  `briefing-sweep-fixture.ts`, `census.ts`, `clone-fixture.ts`, `counting-client.ts`,
  `git-fixture.ts`, `object-descent-domain.ts`, `probe-server.ts`, `published.ts`,
  `refusal-census.ts`, `runtime.ts`, `schema-arbitrary.ts`, `source-census.ts`,
  `spawn-client.ts`.
- Source layout: `src/schema/` (`binding`, `caps`, `decision`, `declare`, `example`, `ids`,
  `refusal`, `session`, `thread`), `src/domain/`, `src/render/`, `src/server/` and
  `src/server/tools/`, `src/store/`, `src/merge/`, `src/hooklib/`, `src/cli/`, `src/runtime/`.
  Hooks at `hooks/` with `hooks/hooks.json` and `hooks/lib/io.ts`. Skills at
  `skills/preflight/SKILL.md` and `skills/debrief/SKILL.md`.
- `src/server/tools/resolve_conflict.ts` contains a non-UTF-8 byte and may be invisible to
  `grep`. If your unit touches or censuses it, read it with a tool that does not assume UTF-8:
  `node -e "process.stdout.write(require('fs').readFileSync('src/server/tools/resolve_conflict.ts','latin1'))"`

## 8. Working rules for you, the planner

- Read only what your unit touches. Establish the conventions of your own surface from the files
  you are editing and their neighbouring tests.
- Prefer reading one real test file next to the code you change over re-deriving the harness from
  first principles. Copy its idiom exactly — imports, runner API, assertion style, title grammar,
  fixture construction — so your plan's tests look like the suite they join.
- P7 means every test you specify drives a fixture store in a temp directory. Find how the
  neighbouring tests do that and reuse it rather than inventing a second way.
- You may write and run throwaway probes in the session scratchpad. Never in the repository
  working tree.
- You may run `npm test`, `npm run typecheck`, `git show`, `git log`, `git diff`, `grep`. You may
  not commit, push, install, or modify tracked files outside
  `docs/plans/2026-08-28-continuity-goal-model/`.
- Return a short structured summary to the orchestrator: the file you wrote, the divergences you
  found, the items you filed, and anything you could not pin down.
