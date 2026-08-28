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

