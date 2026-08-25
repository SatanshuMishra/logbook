# Planning brief — post-cutover repair ladder

Binding on every agent that produces a plan document under this directory.

## 1. What you are producing

An implementation plan, not an implementation. You write Markdown into
`docs/plans/2026-08-25-post-cutover-repair/`. You do not touch `src/`, `test/`, `hooks/`,
`skills/`, `scripts/`, `package.json` or `.claude-plugin/`. You do not commit. You do not
open a pull request.

## 2. The bar

The reader of your plan is a Sonnet agent with extended thinking OFF, no access to this
conversation, and no licence to improvise. It executes your plan literally.

A step that requires the reader to decide anything is a defect in the plan. Concretely:

- Never write "add a check", "handle the error", "update the tests", "adjust as needed",
  "something like", "e.g.", "similar to".
- Every code change is given as an exact FIND string and an exact REPLACE string, both
  copied from or destined for the real file, both complete and syntactically valid.
- Every new file is given in full, first character to last.
- Every test is given in full, with its exact `describe`/`test` name strings.
- Every command is given verbatim with its expected exit code and the substring of output
  that proves the expected result.
- Where a choice genuinely exists, YOU make it in the plan and state the rejected option in
  one line. You never pass the choice downstream.

## 3. The SPEC is settled — read source to author, not to audit

The SPEC is the frozen output of seven audits run against this exact tree on 2026-08-25. No
file under `src/`, `test/`, `hooks/` or `skills/` has changed since commit `4f379e7`. Its
defect findings, its rulings and its acceptance criteria are the contract. **Do not re-derive
them, do not re-litigate them, and do not spend a single tool call proving a defect the SPEC
already established.** That is a second review round over settled work.

You read source for one reason: to author. A plan that a no-thinking implementer can execute
needs the literal current text at every edit site, the literal new text that replaces it, and
literal test bodies. The SPEC deliberately carries none of that. Producing it is your job.

If while authoring you find the code contradicting the SPEC — a moved line, a changed string,
a branch that is not where section 5 says it is — you **report it and route around it**: put
it under `## 3. Divergences from the SPEC` in your plan with the citation, adjust your
FIND strings to the real text, and name it in your return summary. You do not open an
investigation, and you do not edit the SPEC.

Line numbers in the SPEC were taken at `4f379e7`. Where you copy source into a FIND block you
are reading the line anyway, so state the current line you actually read. That is a
by-product of authoring, not a verification pass.

## 4. Acceptance is a ceiling (invariant I9)

Copy your MSP's acceptance criteria into the plan verbatim from SPEC section 7. That list
is the complete definition of done. Anything you discover above it is appended to
`docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence, and
is NOT folded into the plan.

## 5. Invariants that shape every plan (SPEC section 4)

- **I1** `npm test` passes on every merge commit.
- **I2** No new silent success. A path that cannot do what was asked refuses through
  `src/server/errors.ts`, or returns a success naming exactly what it did and did not do.
- **I3** No record disappears. A new thread-record field is `.optional()` or has a
  `.default()`, never required.
- **I4** `package.json` and `.claude-plugin/plugin.json` bump in the same commit;
  `node scripts/check-packaging.mjs` passes.
- **I5** **No comments.** Zero explanatory comments, docstrings, JSDoc or section-header
  comments in any code you specify, in any language. Shebangs and tooling pragmas only.
  This applies to the code inside your plan's fenced blocks — a plan whose code carries
  comments instructs the implementer to violate the project standard.
- **I6** Evidence, not inference, in every `Verified:` line.
- **I7** **Dogfood hazard.** This repository IS the installed plugin. Working-tree edits do
  not affect the running plugin until reinstall and restart. Never verify a change by
  observing this session's own ledger. Every acceptance test drives a fixture store in a
  temp directory.
- **I8** A census is never narrowed to obtain a green. A halting census is answered by
  classifying the new item — never by excluding it, pinning a count, or adding an allowlist.
- **I9** Acceptance is a ceiling (section 4 above).

## 6. Mandatory plan document structure

Use these exact headings, in this order.

    # MSP-N — <title from SPEC section 7>

    ## 0. Identity
    Closes / Depends on / Required by / Branch name / Version bump (exact old -> new, both
    files) / SPEC anchors (section 7 MSP-N, section 6 ruling RX, section 5 defect DN).

    ## 1. Acceptance criteria (the ceiling)
    Verbatim from SPEC section 7, numbered as there. Followed by the sentence naming
    FILED.md as the destination for anything above it.

    ## 2. Ground truth
    One subsection per edit site. Each carries: the path, the CURRENT line range, the
    current source verbatim in a fenced block, and one sentence on what is wrong with it
    citing the evidence you personally read.

    ## 3. Divergences from the SPEC
    Every place the code disagrees with SPEC section 5 or section 7, with the citation and
    the ruling you apply. Write "None found." if there are none — never omit the heading.

    ## 4. The change, step by step
    Numbered steps in application order. Each step carries:
    - File, and one of: CREATE / REPLACE / INSERT-AFTER / DELETE
    - FIND (exact, unique, copy-pasteable) and REPLACE (exact, complete)
    - For CREATE, the entire file contents
    - One line of rationale citing the ruling
    Steps must be independently applicable in the order given, leaving the tree
    type-correct after the last step of each commit group.

    ## 5. Tests
    One subsection per test file. New files given in full. Modified files given as exact
    FIND/REPLACE. Every test's exact name string. For each acceptance criterion, name the
    test that discharges it.

    ## 6. Red on the parent
    The exact command sequence that proves each new test fails before the fix, the exact
    parent commit sha, and the exact failure message or assertion to expect. If a test
    cannot be run red on the parent because it does not compile there, say so and give the
    substitute procedure.

    ## 7. Inertness mutation
    The exact edit to revert, the exact test that must turn red, the expected failure text,
    and the exact restore. One per acceptance criterion that names inertness.

    ## 8. Full verification
    Exact commands with expected exit codes and the output substring that proves each.

    ## 9. Commits
    One block per commit: exact Conventional Commits subject line, exact file list, and
    which plan steps it contains. Refactor and behaviour change never share a commit.

    ## 10. Pull request
    The exact `node ~/.claude/lib/git/pr.mjs pr-create` invocation with every flag value
    filled in. `--verified` lines only for checks the implementer will actually have run;
    everything else `--not-verified "<thing> - not run"`. Include the mutation-scope
    sentence SPEC section 8.2 requires.

    ## 11. Stop conditions
    The specific divergences that invalidate this plan. For each: what the implementer sees,
    and the instruction "STOP and report; do not improvise."

## 7. Repository facts (established 2026-08-25; use them, do not re-derive them)

- Branch: `docs/post-cutover-repair-spec`. Working tree clean. `package.json` version `1.0.0`.
- Scripts: `npm test`, `npm run typecheck`, `npm run mutate`, `npm run coverage`,
  `npm run inspect`, `npm run inspect:cli`.
- `npm test` runs `node --test` over `test/unit`, `test/store`, `test/contract`, `test/sync`,
  `test/spawn`, `test/hooks` — in that order, glob `**/*.test.ts`.
- Packaging check: `node scripts/check-packaging.mjs`.
- Pull requests: `node ~/.claude/lib/git/pr.mjs pr-create` (the global centralized tool;
  there is no `.claude/lib` inside this repository). Ad-hoc `gh pr create` is denied.
- Shared test helpers live in `test/support/`: `census.ts`, `clone-fixture.ts`,
  `counting-client.ts`, `git-fixture.ts`, `object-descent-domain.ts`, `probe-server.ts`,
  `published.ts`, `refusal-census.ts`, `runtime.ts`, `schema-arbitrary.ts`,
  `source-census.ts`, `spawn-client.ts`.
- The audit reproductions SURVIVED and are committed at
  `docs/audits/2026-08-25-post-cutover-repair-probes/`. `repro-f1.ts` (D1), `repro-f7.ts`
  and `repro-c7.ts` (D2, D10), `repro-f6.ts` and `repro-f3.ts` (D6, D13), plus
  `probe-lostupdate.ts`, `probe-concurrent.ts`, `probe-concurrent2.ts`, `probe-caps.ts`,
  `probe-boundary.ts`. Read the one your MSP inherits and re-author it as a committed test.
  A probe referenced but not committed is treated as absent.

## 8. Working rules for you, the planner

- Read only what your MSP touches. There is no shared-context document; establish the
  conventions of your own surface from the files you are editing and their neighbouring tests.
- Prefer reading one real test file next to the code you change over re-deriving the harness
  from first principles. Copy its idiom exactly — imports, runner API, assertion style, title
  grammar, fixture construction — so your plan's tests look like the suite they join.
- Invariant I7 means every test you specify drives a fixture store in a temp directory. Find
  how the neighbouring tests do that (`test/support/` holds `git-fixture.ts`,
  `clone-fixture.ts`, `runtime.ts`, `probe-server.ts`, `spawn-client.ts`,
  `counting-client.ts`, `census.ts`, `published.ts`, `source-census.ts`,
  `refusal-census.ts`, `schema-arbitrary.ts`, `object-descent-domain.ts`) and reuse it rather
  than inventing a second way.
- You may write and run throwaway probes in the session scratchpad. Never in the repository
  working tree.
- You may run `npm test`, `npm run typecheck`, `git show`, `git log`, `grep`. You may not
  commit, push, or modify tracked files outside
  `docs/plans/2026-08-25-post-cutover-repair/`.
- `src/server/tools/resolve_conflict.ts` contains a non-UTF-8 byte and is invisible to
  `grep`. If your MSP touches or censuses it, read it with a tool that does not assume UTF-8.
- Return a short structured summary to the orchestrator: the file you wrote, the divergences
  you found, the items you filed, and anything you could not pin down.
