# Spec: Preflight Briefing Redesign

Status: proposed
Date: 2026-08-02
Amended: 2026-08-02 (enforcement pass, decisions 0020-0022)
Thread: 01KZ23CNS84EN0BJEV22A2MW8B (preflight-briefing-redesign)
Decisions: 0005-0022
Baseline: 692 tests green at 39bc7ab

## 1. Problem

The preflight briefing is a raw field-for-field dump of the thread spine. `src/tools/get-resume-brief.mjs`
is 43 lines with zero selection logic, so a briefing's size is a function of the thread's AGE rather than
of where the reader is in it.

Measured on a real briefing from the mitosis project: 70 decision slugs (4,560 chars), 16 risks
(3,798 chars), 18 out-of-scope entries, approximately 12,600 chars total (~3,200 tokens). Most of it was
irrelevant to the step being worked, and every decision reference was an opaque slug no tool could resolve.

Four structural causes:

1. No axis links an item to the part of the work it belongs to, so nothing can be filtered.
2. `completion_criteria` appears on no read surface, so "how far along am I" is unanswerable.
3. The model renders the briefing from JSON, so the format differs every run.
4. No canonical output exists, so non-compliance is undetectable. `skills/preflight/SKILL.md:24` already
   says "present the returned brief VERBATIM"; there is no verbatim rendering of a JSON object as prose,
   so the instruction is unsatisfiable and its violation leaves no trace. Observed on 2026-08-02: a
   preflight run invented its own headings, separators and ordering while the skill forbade exactly that,
   and nothing in the system registered it.

Cause 4 is the one a server-side renderer alone does NOT fix. A renderer creates the canonical string;
it does not make the model emit it. Section 10.4 closes that separately.

## 2. Outcome

Briefing length becomes a function of the CURRENT STEP. A 3-session thread and a 30-session thread produce
the same size briefing. All judgment happens at write time, when context is fresh; read time is a pure
deterministic filter.

Second outcome: every rule this spec states is enforced by the layer that can refuse it, or is declared
unenforceable in section 9. No rule relies on the model electing to follow prose it could ignore.

Acceptance target: the mitosis thread's ENTIRE `get_resume_brief` response is under 3,000 characters,
measured. The 12,600-char baseline was measured on the whole tool payload, so the target must be too — a
filtered string shipped alongside an unfiltered object is not a reduction (decision 0022).

## 3. Scope

In scope: thread schema v2, the selection filter, a server-side renderer, `update_thread`,
`record_decision`, `get_resume_brief`, `reconcile`, `rebuild_index`, `open_thread`, two new tools
(`amend_criteria`, `read_decision`), the caps module, the roster line, both skills' prose, the Stop-hook
verbatim gate (`hooks/lib/stop.mjs` plus one CLI subcommand), and the `index/briefing.json` pledge.

Out of scope: renaming internals to aviation terms (0013); a separate machine-readable risks section
(0011); a numeric cap on visible risks (0010); a KEY FILES section (0012); model-side summarization at
read time (0005); nested detours (0008).

Also out of scope, and deliberately so:

- A PostToolUse lint over what `update_thread` just wrote. Once risk FORM is a schema rejection (7.1), the
  only residue such a lint could inspect is semantic — whether a risk is actionable or still true — which
  it cannot judge. A hook that emits warnings the model may ignore imitates enforcement without providing
  it, which is worse than an honest gap (decision 0021).
- Detecting machine payload in risk prose to force it into `refs`. Section 9.1 REQUIRES exact identifiers
  in the first clause, so any path/SHA heuristic would fight the mandated sentence shape and reject
  correct risks. Stated as prose in 9.1, enforced nowhere, and that is the honest position.

## 4. Data model (schema v2)

`schema_version` becomes `2`. Changes are listed against the v1 record in `src/schema/thread.schema.mjs`.

### 4.1 Scope values

A scope is one of:

- a criterion id matching `^c[1-9][0-9]*$`
- `"thread"` — applies across all steps (standing)
- `"legacy"` — set ONLY by the v1 upcast; the server REJECTS `"legacy"` on any write path

Pattern: `^(c[1-9][0-9]*|thread|legacy)$`.

### 4.2 completion_criteria

```
completion_criteria: [
  {
    id:        string, ^c[1-9][0-9]*$, unique within the thread
    text:      string, 1..200 chars
    done:      boolean
    kind:      "planned" | "detour"
    struck_by: string | null      # decision ref "NNNN-slug" when struck
  }
]
```

`minItems: 1` — a thread may no longer be opened without a definition of done (audit finding 4;
`open-thread.mjs:36` currently permits it, and the redesign cannot render PROGRESS without criteria).

Id allocation: at insert, `N = max(existing numeric suffixes) + 1`. Ids are never reused and never
positional. Struck criteria are RETAINED in the array, so the maximum is monotonic.

### 4.3 spine

```
spine: {
  active_goal:   string, 0..200 chars
  next_step:     string, 0..500 chars
  last_session:  string, 0..300 chars
  open_risks:    [ { text: string 1..300, scope: Scope, refs: [string 0..200] (0..8 items) } ]
  key_decisions: [ { ref: string ^[0-9]{4}-[a-z0-9-]+$, title: string 1..120, scope: Scope } ]
  out_of_scope:  [ string 1..300 ]
}
```

`spine.status` is REMOVED. It was written by `patchSpine` (`update-thread.mjs:6`), required by the schema
(`thread.schema.mjs:65`) and cap-checked (`caps.mjs:9`), and read by nothing — the briefing returns
`thread.status` (`get-resume-brief.mjs:18`). Decision 0019.

`out_of_scope` stays a flat string array and gains NO scope field (decision 0014).

The STORED shape above carries no form constraint on `open_risks[].text` beyond its length. The two-clause
pattern and the dedup rule are gates on `update_thread`'s input (7.1), not on the record, so a legacy
risk migrated by 8.2 can be stored and re-read without ever tripping them.

### 4.4 Caps (`src/model/caps.mjs`)

| Field | Cap |
|---|---|
| `active_goal` | 200 chars |
| `next_step` | 500 chars |
| `last_session` | 300 chars |
| `open_risks` | 20 items PER SCOPE GROUP |
| `out_of_scope` | 20 items (thread-wide) |
| `key_decisions` | count-exempt (unchanged) |
| `open_risks[].text` | 300 chars |
| `open_risks[].refs` | 8 items, 200 chars each |
| `key_decisions[].title` | 120 chars |
| `out_of_scope[]` | 300 chars |
| `completion_criteria[].text` | 200 chars |

The count cap on `open_risks` moves its denominator from per-thread to per-scope-group: each group
(each criterion id, plus `thread`) is capped at 20 independently. The numbers are unchanged; the
denominator change is what makes the cap unreachable in practice.

Cap violations continue to THROW `CapViolationError` (decision 0017). No demotion, no soft-warn. A
refusal costs no work because the debrief writes the session log before it refreshes the spine.

Caps are asserted on WRITE ONLY. The v1 upcast never throws — see 8.2.

## 5. Selection (pure, deterministic)

New module `src/model/selection.mjs`. No I/O, no model judgment.

```
selectCurrent(thread) -> { current, state, done, total, detoursOpen, visibleScopes }
```

1. `live` = criteria where `struck_by === null`, in array order.
2. `current` = first entry of `live` with `done === false`; `null` if none.
3. `state` = `"in-progress"` when `current !== null`, else `"ready-to-close"`.
4. `done` / `total` count `live` entries with `kind === "planned"` only. A detour NEVER moves the
   fraction: 3 of 6 must not become 3 of 7 because a bug appeared (decision 0008).
5. `detoursOpen` = count of `live` entries with `kind === "detour"` and `done === false`.
6. `visibleScopes` = `{ current.id, "thread" }` when `current !== null`; otherwise
   `{ last(live).id, "thread" }`. `"legacy"` is NEVER in `visibleScopes`.

An item is visible iff `visibleScopes.has(item.scope)`. Everything else is COUNTED, never printed.

The `ready-to-close` branch is live today: thread `01KZ0PCWGPN8X3J7B139WGFQKB` (logbook-rename) is 6 of 6
done and still `paused`.

Array order is the sole ordering authority. A detour is inserted immediately before the criterion it
interrupts, so order alone makes it current — no special case in the selector.

## 6. Render contract

New module `src/render/briefing.mjs`, pure: `renderBriefing(brief) -> string`. Snapshot-tested. The
server owns every heading and separator; the skill prints the result verbatim (decision 0007).

Fixed section order. Sections marked CONDITIONAL are omitted entirely — never rendered as an empty
heading — when their source is empty.

```
# PREFLIGHT BRIEFING — <title>
<status> · <done> of <total> done · <detoursOpen> detour(s) open · last worked <updated_at date>

## WHY
<active_goal>

## SINCE YOU LEFT                                    [CONDITIONAL: drift non-empty]
- <CLASSIFICATION> <branch> — <signal code>: <detail>

## PROGRESS
- [x] c1 — <text>
- [>] c2 — <text>                                    [current marker]
- [!] c3 — <text> (detour)                           [open detour]
- [ ] c4 — <text>
- [~] c5 — <text> (struck — decision 0021)           [struck, retained]

## LAST SESSION                                      [CONDITIONAL: last_session non-empty]
<last_session>

## NEXT STEP
<next_step, inline file references rendered as links>

## WATCH OUT FOR                                     [CONDITIONAL: any visible risk]
- <risk.text>
  refs: <refs, comma-joined>                         [CONDITIONAL: refs non-empty]

Standing:
- <thread-scoped risk.text>                          [CONDITIONAL: any thread-scoped risk]

## DECIDED ON THIS STEP                              [CONDITIONAL: any visible decision]
- 0018 — <title>

## NOT IN SCOPE                                      [CONDITIONAL: out_of_scope non-empty]
- <entry>

## RELATED                                           [CONDITIONAL: children or predecessor present]
- child: <slug> (<status>)
- succeeds: <predecessor slug>

## NOT SHOWN
<r> risk(s) and <d> decision(s) from other steps; <l> legacy decision(s).
Ask for any decision by number: read_decision.
```

`RELATED` exists because `children` and `predecessor_id` are on today's response
(`get-resume-brief.mjs:11-13, 25`) and 7.5 removes the structured object that carried them. Without this
section the redesign would silently drop child-thread and successor visibility.

The rendered string is the ONLY briefing payload (7.5). Any field absent from this contract is invisible
to the reader, so a field worth showing belongs in a section here, never in a sidecar object.

Marker glyphs: `[x]` done, `[ ]` pending, `[>]` current, `[!]` open detour, `[~]` struck. A criterion
that is both current and a detour renders `[>]` with the `(detour)` suffix.

`ready-to-close` replaces the header fraction with `<total> of <total> done — ready to close`.

Legacy over-cap scalars (see 8.2) render truncated at their cap with a trailing ellipsis.

`NOT SHOWN` renders even when all three counts are zero, stating so, because its absence would be
indistinguishable from an omitted section.

## 7. Tool contracts

### 7.1 `update_thread` (BREAKING)

- `completion_criteria` items become `{ id, done }`. Text matching is REMOVED outright, not dual-pathed
  (`update-thread.mjs:11-22`); the only consumers are the two skills in this repo. An unknown id is a
  `ToolError` naming the id.
- `spine.open_risks` items become risk objects. `scope` is OPTIONAL on input: when omitted the server
  assigns the current criterion id from `selectCurrent`. `"thread"` must be passed explicitly.
- `spine.key_decisions` items become decision objects; `ref` must match an existing decision file.
- `spine.last_session` is a new patchable scalar.
- `spine.status` is rejected as an unknown property.
- Writing `scope: "legacy"` is refused on every path.

Two structural gates enforce the FORM the section 9 write-time rules depend on (decision 0021). Both live
on `update_thread`'s INPUT schema and handler, never on the stored thread schema — a stored record may
hold legacy-shaped text, and 8.2 guarantees the upcast never throws. Gating the submission rather than
the record keeps both promises without a dual path.

- Sentence shape (9.1): `spine.open_risks[].text` must match `^[^\n]+ — [^\n]+$` — two non-empty clauses
  joined by a spaced em dash, on one line. This does not verify a risk is actionable; it makes the
  one-clause dump, which is how the shape actually degrades, a rejection rather than a habit. The
  `ToolError` quotes the offending text and states the shape.
- out_of_scope dedup (9.2): reject an `out_of_scope` entry when its normalized form and a normalized
  `spine.key_decisions[].title` contain one another. Normalize by lowercasing, stripping punctuation and
  collapsing whitespace. The test applies ONLY when the shorter normalized string is at least 24
  characters, so short titles cannot swallow unrelated entries. Handler-level, since it reads two fields.

Neither gate judges content. They refuse shapes that are unambiguously wrong, and leave every judgment
call to section 9, which names it as a judgment call.

### 7.2 `amend_criteria` (NEW)

```
amend_criteria(thread_id, operations: [
  { op: "insert",  text, kind, before?: criterionId }
  { op: "rewrite", id, text, decision_ref }
  { op: "strike",  id, decision_ref }
])
```

Operations apply in array order, atomically: any failure rolls the whole call back.

- `insert` allocates the next id. When `kind === "detour"` and `before` is omitted, it inserts
  immediately before the current criterion.
- `insert` with `kind === "detour"` is REFUSED when an open detour already exists — nesting is forbidden
  (0008). The refusal message directs the caller to open a child thread.
- `rewrite` and `strike` REQUIRE `decision_ref`, and the server verifies the decision file exists
  (decision 0009). A moving denominator is always explained.
- `strike` sets `struck_by` and retains the entry; it never deletes.
- Terminal threads are refused, consistent with `update_thread`.

### 7.3 `record_decision`

Gains optional `scope` (default: current criterion id). Appends `{ ref, title, scope }` to
`spine.key_decisions` — the title is already an argument, so denormalizing costs nothing and removes any
need to parse frontmatter at read time (decision 0019).

### 7.4 `read_decision` (NEW)

`read_decision(nnnn) -> { nnnn, slug, markdown }`. Wraps `driver.readDecision`, which has existed
unregistered at `local-driver.mjs:213` and is absent from `registry.mjs:17-30`. This is what makes the
`NOT SHOWN` drill-down real rather than a promise.

### 7.5 `get_resume_brief` (BREAKING)

Returns `{ thread_id, briefing }` and NOTHING ELSE (decision 0022). `briefing` is the rendered markdown
from section 6. The structured `brief` object is REMOVED, not slimmed.

Shipping a filtered string beside an unfiltered object would defeat decision 0005 outright: the model
would still receive every risk and decision it was supposed to be spared, and could surface them. The
filter is only real when the filtered-out content is absent from the response. It also resolves the
measurement contradiction in section 2 — with one payload, the acceptance target and the baseline
measure the same quantity.

Everything the removed object carried is either rendered (progress, criteria, drift, not-shown counts,
children, predecessor) or was never read. The hardcoded `drift: []` at `get-resume-brief.mjs:26` is
deleted; drift is taken from the index snapshot — read and cleared in the same call (7.6).

Consumers are five in-repo tests (`test/unit/tools/get-resume-brief.test.mjs`,
`test/e2e/{non-git-parity,branch-reattach,resume-substrate,handoff-chain}.test.mjs`) plus the preflight
skill, which only prints. All five are rewritten to assert on the rendered string, which is the public
surface a reader actually receives.

### 7.6 `reconcile`

Additionally persists a drift snapshot to the derived index: `index/drift.json`, shape
`{ [thread_id]: DriftEntry[] }`. Each run UNIONS its entries into the existing snapshot, keyed by
`binding_id`: a re-observed binding replaces its prior entry in place, a newly drifting one is appended,
and an entry no longer re-observed survives untouched. `get_resume_brief` is the single clear point — it
takes the briefed thread's entries and writes the snapshot back without them, leaving every other
thread's drift intact.

A wholesale overwrite each run would destroy the highest-value entries before any reader saw them.
Reconcile runs twice in the normal resume flow (`hooks/lib/session-start.mjs:99` at SessionStart, then
step 3 of the preflight skill), and the first run closes the merged and orphaned bindings
(`reconcile.mjs:43-46`, `disposition.mjs:31-52`) that `runReconcile` then skips as non-active
(`reconcile.mjs:32-34`) — so the second run observes nothing and would wipe the terminal signals the
first captured.

That same closing is why recomputing drift inside `get_resume_brief` is NOT viable: by then the
observation is gone. Clearing on read, not on write, is what makes the snapshot mean "since you left".

`index/` is gitignored in both drivers (`local-driver.mjs:17`, `git-ref-driver.mjs:27`). This is correct:
drift is observer-local and must not be shared through the ledger ref.

### 7.7 `rebuild_index`

`index/resumable` entries gain `done`, `total`, `detours_open`. `rebuild_index` MUST NOT delete
`index/drift.json` or `index/briefing.json`.

### 7.8 `open_thread`

`completion_criteria` becomes required with `minItems: 1`; input items accept `{ text, kind? }` with
`kind` defaulting to `"planned"`; ids are assigned server-side as `c1..cN`.

### 7.9 The briefing pledge (`index/briefing.json`)

`get_resume_brief` writes `{ thread_id, rendered, rendered_at }` to `index/briefing.json`, overwritten
wholesale. It records that a briefing was produced and what its exact text was, so the Stop-hook gate
(10.4) has ground truth to compare against without parsing tool results out of a transcript.

`index/` is gitignored in both drivers (`local-driver.mjs:17`, `git-ref-driver.mjs:27`), which is correct
here for the same reason it is correct for drift: a pledge is observer-local and must never travel
through the shared ledger ref.

One CLI subcommand exposes it to the hook, mirroring `active-thread`:

- `ledger-cli briefing-pledge` prints the pledge as JSON, or `null` when none is outstanding.
- `ledger-cli briefing-pledge --clear` deletes it.

The hook goes through the CLI rather than reading the file directly so that driver selection (git ref vs
local) stays in one place, exactly as `hooks/lib/stop.mjs:6` already does for the active thread.

## 8. Migration

### 8.1 Mechanism

A read-time upcast in a shared module `src/schema/upcast.mjs`, called by `readThread` in both drivers.
A v1 record is upcast in memory and persisted as v2 on the next write. No one-shot script: the ledger
lives in a shared git ref, so a script would have to be run on every machine holding a copy
(decision 0016).

The validator accepts v1 or v2 on READ, and v2 only on WRITE.

### 8.2 v1 to v2 mapping

| v1 | v2 |
|---|---|
| `completion_criteria[i]` | gains `id: "c<i+1>"`, `kind: "planned"`, `struck_by: null` |
| `spine.status` | dropped |
| `spine.open_risks[]` (string) | `{ text, scope: "thread", refs: [] }` — VISIBLE |
| `spine.key_decisions[]` (string) | `{ ref, title: un-kebabbed slug, scope: "legacy" }` — HIDDEN, counted |
| `spine.out_of_scope[]` | unchanged |
| `spine.last_session` | `""` (section omitted until the next debrief) |
| `schema_version: 1` | `2` |

The split is deliberate (decision 0016): a stale risk shown is safer than a live risk hidden, and the
next debrief prunes it under the admission gate; whereas 70 legacy decision slugs are the disease itself
and remain permanently retrievable through `read_decision`.

The upcast NEVER throws on caps. Legacy `active_goal` may exceed the new 200-char cap — this thread's own
is 281 chars — and renders truncated until the next debrief rewrites it.

### 8.3 Records to migrate

Three live threads in this repo (`01KYNA1GES4E1R0ZX4M1GV7BGN`, `01KZ0PCWGPN8X3J7B139WGFQKB`,
`01KZ23CNS84EN0BJEV22A2MW8B`) and the long mitosis thread. No migration commit is required; each is
upcast on first read and persisted on first write.

## 9. Write-time gates

Each rule below is split into the part a machine can refuse and the part only judgment can settle
(decision 0021). The earlier draft classed all of section 9 as prose; that conceded too much, because
"unenforceable in full" is not "unenforceable at all", and the enforceable half is where these rules
actually decay.

| Rule | Machine-enforced part | Judgment part (prose only) |
|---|---|---|
| 9.1 sentence shape | two-clause pattern on `open_risks[].text` (7.1) | whether the why is the real why |
| 9.1 four-part gate | nothing | ACTIONABLE, SPECIFIC, STILL TRUE, LEGIBLE |
| 9.1 payload in `refs` | nothing — see section 3 | keeping identifiers out of the second clause |
| 9.2 dedup | normalized containment against decision titles (7.1) | rationale that overlaps without restating |
| 9.3 routing | `amend_criteria` nesting refusal and `decision_ref` existence (7.2) | detour vs child thread |

The judgment column is a genuine, named gap. A reader who wants it closed should know it cannot be, not
be reassured by a check that only appears to close it. The gates are stated in the debrief because that is
where context is freshest, and nowhere else claims to enforce them.

### 9.1 Risk admission (decision 0010)

A risk is admitted only if ALL four hold:

1. ACTIONABLE — it changes what the model does on this step. Being merely true is not the bar.
2. SPECIFIC TO THIS WORK — not agent hygiene ("remember to run tests").
3. STILL TRUE — not resolved, superseded, or moot. Failing this after admission means RETIRE.
4. LEGIBLE TO BOTH — plain language, jargon expanded.

Sentence shape: `<specific constraint or action> — <why, in plain words>` (decision 0011). The first
clause carries exact identifiers and is what the model executes on; the second carries the causal reason,
which lets the model reason about whether the constraint still applies. Machine-precise payload (file
lists, SHAs, commands) goes in `refs`, never in the prose.

### 9.2 out_of_scope admission (decision 0014)

The same four-part gate, PLUS a dedup rule: any entry whose rationale already lives in a decision record
is deleted — the decision record is its single home. Applied to this thread, the rule cuts seven entries
to one.

### 9.3 Detour vs amendment vs new thread (decisions 0008, 0009)

| Situation | Handling |
|---|---|
| Unplanned work found mid-step, closes this session | `amend_criteria` insert, `kind: "detour"` |
| Unplanned work that will not close this session, or needs its own criteria | promote to a child thread |
| The plan itself was wrong | `amend_criteria` rewrite or strike, with a mandatory decision record |
| Unrelated work | a separate thread; the WIP rule applies |

## 10. Skills and hooks

### 10.1 `skills/preflight/SKILL.md`

- Step 4 becomes: print the returned `briefing` field verbatim. The model stops authoring headings at all
  (decision 0013). The instruction is now satisfiable, because `briefing` is a string; 10.4 is what makes
  it enforced rather than requested.
- Step 3 is corrected: it currently says to reconcile "the chosen thread", but `reconcile` takes no
  arguments (`reconcile.mjs:14` is `emptyInput`) and is global. The prose describes an API that does not
  exist. The invariant tests cannot catch this class of drift — they assert that a tool name is MENTIONED
  (`preflight.test.mjs:49-54`), never that the described call matches its schema.
- `allowed-tools` gains `read_decision` under both spellings.
- `test/unit/skills/preflight.test.mjs:38` asserts EXACTLY three tools; it is updated to four
  deliberately, as part of this change, not incidentally.
- The thinness invariant (`FORBIDDEN_SUBSTRINGS`, `skill-invariants.mjs:8-14`) is satisfied by
  construction: every selection and format rule lives in the server, and no new prose uses a blocked
  substring.

### 10.2 `skills/debrief/SKILL.md`

- Step 4 matches criteria by ID, not exact text.
- Step 4 requires a `last_session` one-liner.
- Step 4 states the risk admission gate and the sentence shape, and the out_of_scope dedup rule.
- A new step covers `amend_criteria` for detours and plan amendments, including the mandatory decision
  record for a rewrite or a strike.
- `allowed-tools` gains `amend_criteria` under both spellings; the debrief allowed-tools assertion is
  updated to match.

### 10.3 Roster (`hooks/lib/roster.mjs`)

The line gains progress and truncates the next step, which it currently prints in full at
`roster.mjs:11` (up to 500 chars per thread):

```
- [paused] <slug> (3 of 5): <title> -- next: <next_step truncated to 120 chars> (id <ULID>)
```

### 10.4 `hooks/lib/stop.mjs` — the verbatim gate (decision 0020)

A renderer creates a canonical string; it does not make the model emit one. Nothing today compares what
the model wrote to what the server produced, so decision 0007 would ship as a request. This closes it.

The model cannot be prevented from writing extra text — no hook intercepts assistant output. What CAN be
done is refuse to let the turn end until the owed text has actually appeared. Detection plus forced
correction is enforcement: the user never sees a turn end in the non-compliant state.

Handler order in `handleStop`, before the existing active-thread block:

1. Read the pledge (`ledger-cli briefing-pledge`). No pledge, or unreadable: return unchanged. This is
   the common path — most turns owe nothing.
2. Read `ctx.input.transcript_path`. Parse the JSONL, collect the text of assistant messages. If the file
   is missing, unparseable, or yields no assistant text, clear the pledge and return unchanged.
3. If some assistant message CONTAINS `pledge.rendered` as an exact substring, clear the pledge and
   continue to the existing checks. Exact containment is the whole test: an unmodified echo passes
   trivially, including inside a code fence, and any omitted or reworded section fails.
4. Otherwise, if `stop_hook_active` is false, block: `exitCode: 2`, with stderr carrying the instruction
   and the exact owed text. The model prints it and the turn ends.
5. Otherwise (`stop_hook_active` true), clear the pledge and return unchanged.

Step 5 is what bounds the gate to a single correction, consistent with the re-entry stand-down already in
`stop.mjs:8-11` (commit 23b2557). One nag, then the gate yields; by then the correct text is on screen.

Every failure mode is fail-open: an unreadable pledge, an unreadable transcript, or a parse error all
return unchanged rather than blocking. `runEntry` already swallows throws and exits 0
(`hook-io.mjs:79-88`), so the gate inherits that posture. A guard that blocks a session on its own bug is
worse than the drift it prevents.

Placing this on Stop rather than PostToolUse is deliberate: at PostToolUse the model has not written its
message yet, so there is nothing to compare.

## 11. Verification

Regression floor: 692 tests green (`npm test`, 24.5s, measured at 39bc7ab). Anything below that is a
regression, not a rewrite.

New coverage, at the lowest layer that expresses the behavior:

- `selection.mjs` unit: current selection, all-done, struck skipping, detour not counted in the fraction,
  visible-scope computation, `legacy` never visible.
- `briefing.mjs` snapshots: normal, ready-to-close, open detour, struck criterion, drift present, every
  conditional section empty, legacy-upcast thread with a truncated `active_goal`, and RELATED with a
  child, with a predecessor, and with both.
- `update_thread` structural gates: a one-clause risk text refused, a hyphen-instead-of-em-dash refused,
  a multi-line text refused, a well-formed text accepted; an `out_of_scope` entry restating a decision
  title refused, a 23-character normalized overlap ACCEPTED (the length guard), an unrelated entry
  accepted. Plus the migration guarantee: a stored legacy risk text does not block an unrelated write.
- Verbatim gate unit (`stop.mjs`): no pledge returns unchanged; exact echo clears the pledge and falls
  through to the active-thread check; a reworded echo blocks with exit 2 and the owed text on stderr; a
  reworded echo with `stop_hook_active` clears and returns unchanged; a missing transcript, an
  unparseable transcript, and an unreadable pledge each return unchanged. The fail-open cases are the
  load-bearing ones — a guard that can block on its own failure is not shippable.
- `upcast.mjs` unit: every row of table 8.2, plus over-cap legacy scalars not throwing.
- `amend_criteria` unit: id allocation after a strike, nesting refusal, missing `decision_ref` refusal,
  atomic rollback on a mid-array failure.
- Caps unit: per-scope-group counting.
- E2E: a thread through open, debrief, preflight, detour, amendment, close.

Acceptance test: the mitosis thread's ENTIRE `get_resume_brief` response serializes under 3,000
characters against a measured 12,600 baseline. Measuring the rendered string alone would compare
different quantities and could pass while total context grew (section 2). A redesign that does not
visibly shrink that specific thread has not worked.

## 12. Implementation sequence

Five units, each leaving the branch green (the green-branch invariant makes the split mandatory, not
stylistic). Decision 0018 fixes the ordering: criterion identity is the prerequisite for everything.

| # | Unit | Contents |
|---|---|---|
| 1 | Criterion identity | ids, `kind`, `struck_by`, schema v2, upcast, `update_thread` id-matching, `open_thread` requires criteria. Briefing output unchanged. |
| 2 | Scoped items | risk and decision objects, scope defaults, per-scope caps, `record_decision` scope, `spine.status` removal, and the two structural gates on `update_thread` (7.1). |
| 3 | Server-rendered briefing | `selection.mjs`, `briefing.mjs` including RELATED, `get_resume_brief` returns `{ thread_id, briefing }` only, the five consumer tests rewritten, `index/briefing.json` plus the `briefing-pledge` CLI subcommand, the Stop-hook verbatim gate (10.4), `read_decision` registered, preflight prose and its test. |
| 4 | Amendments | `amend_criteria`, detour rules, struck rendering, debrief prose and its test. |
| 5 | Drift and progress surfaces | drift snapshot in `reconcile`, SINCE YOU LEFT, `rebuild_index` counts, roster line. |

Units 1 and 2 are schema work and must land in order. Units 3, 4 and 5 depend on 1 and 2 but are
independent of each other.

Unit 3 grew with this amendment and is now the largest. Its parts are not separable without breaking the
green-branch invariant: removing the structured `brief` breaks five tests, so the rewrites land in the
same unit; and the verbatim gate has nothing to compare against until `briefing` exists, so it cannot
land earlier. Splitting unit 3 further would leave the branch red between the halves.

## 13. Decision traceability

| Decision | Where it lands |
|---|---|
| 0005 criterion-scoped content | 4.1, 5 |
| 0006 criteria exempt from filtering | 5.4, 6 PROGRESS |
| 0007 server renders, skill prints | 6, 7.5, 10.1 |
| 0008 detours | 4.2, 5.4, 7.2, 9.3 |
| 0009 amendments need a tool and a record | 7.2, 9.3 |
| 0010 four-part risk gate | 4.4, 9.1 |
| 0011 one risks section | 6, 9.1 |
| 0012 no KEY FILES | 6 NEXT STEP |
| 0013 outward naming | 6, 10.1 |
| 0014 out_of_scope thread-wide | 4.3, 9.2 |
| 0015 active_goal survives | 4.3, 6 WHY |
| 0016 migration split | 8 |
| 0017 caps keep hard failure | 4.4 |
| 0018 criterion ids first | 4.2, 7.1, 12 |
| 0019 inputs resolve at write time | 4.3, 7.3, 7.4, 7.6, 7.7, 10.3 |
| 0020 the verbatim gate | 1, 7.9, 10.1, 10.4, 11 |
| 0021 enforce form, name the judgment gap | 3, 7.1, 9, 11 |
| 0022 the briefing is the only payload | 2, 6 RELATED, 7.5, 11 |

Enforcement summary, since the question this amendment answers is "which of these could be bypassed":

| Tier | Mechanism | Decisions |
|---|---|---|
| Refused by schema or handler | Ajv `additionalProperties: false`, `ToolError`, `CapViolationError` | 0008, 0009, 0012, 0014, 0017, 0018, 0019, 0021 (form), 0022 |
| Refused by a hook | Stop `exitCode: 2`, skill `allowed-tools` | 0007 via 0020 |
| Prose only, and declared so | debrief judgment gates | 0010, 0011, 0021 (judgment) |

No decision sits outside this table. A decision that cannot be placed in tier 1 or 2 belongs in tier 3
explicitly, never in tier 1 by assertion.
