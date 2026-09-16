# Test suite audit

Date: 2026-09-16
Criterion: c1 on thread `01M2MCZHA78N2MD45HHT9TSYSK`
Audited against: `main` at `c94f9692`
Population: 169 test files, 1,092 named tests

---

## What this document is for

Criterion c1 asks that every test kept in the suite names the observable behaviour it protects, and that every test naming none is deleted. Its check asks for a list of every test file with that behaviour and a keep or delete verdict, with no file absent.

The list below is that. It is written so a deletion can be judged before it happens, because green after a deletion proves nothing: a suite that has lost a guard passes exactly as a suite that never needed it.

---

## How a verdict was reached

Every file is `keep` unless one of four named rules fires. Keep is the default because the burden belongs on removal, not on retention.

| Rule | Fires when |
|---|---|
| `R1-tautological` | No one-token change to shipped code under `src/`, `hooks/` or `bin/` could redden it. Its expected value is derived from the implementation rather than from a requirement. |
| `R2-harness-only` | The subject under test is a classifier, parser or fixture builder defined inside the test file itself, so nothing shipped can break it. |
| `R3-subsumed` | Another named file asserts the same observable through the same door or a nearer one. |
| `R4-dead` | It tests a surface that no longer exists. |

The **door** column records how a test reaches the behaviour, because the entry point is part of the claim. A test that calls a handler directly asserts on an exception the caller never sees, where the protocol returns a failure as a value.

| Door | Meaning |
|---|---|
| `stdio` | Spawns the real server as a child process and speaks the protocol to it |
| `hook-subprocess` | Runs a lifecycle hook as a real child process with JSON on stdin |
| `linked-pair` | A real client and server joined in memory, no child process |
| `real-store` | A real git repository or a real store directory on disk |
| `in-process` | Imports the function and calls it |
| `repo-text` | Reads the repository's own source, documents or manifests as data |

---

## How much of this is proof, and how much is a floor

Four readers covered disjoint layers. Three read every file in full. The reader covering `test/contract` and `test/spawn` read files under about 16KB in full and surveyed thirteen larger ones by import block, full test-name listing and targeted excerpts of their non-control tests.

Rows marked `sampled` carry that reader's own caveat: a keep verdict on those thirteen is a floor rather than a proof. A subsumption or a tautology buried in an unsampled test body would not have surfaced. They are `no-path`, `forgery`, `decisions`, `resume`, `update-thread`, `caps-relaxed`, `lifecycle`, `skills`, `render-census`, `published-schema`, `resources`, `close` and `install-githooks-reachability`.

No file's verdict rests on running the suite or on mutating shipped code. Every verdict here is from reading. The four mutants that `scripts/seeded-mutants.mjs` kills on every trunk build are the only claim in this repository that rests on observed reddening, and they cover the briefing renderer alone.

---

## Section 1: every test file

### test/unit

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| briefed-record.test.ts | a session isn't briefed twice on the same thread, and a corrupt record briefs it on nothing | real-store | keep | - |
| briefing-floors.test.ts | every item in a briefing keeps a minimum readable amount of its text under budget pressure | in-process | keep | - |
| briefing-frontier-sweep.test.ts | no storable thread shape makes a briefing drop an item or claim it fits when it doesn't | in-process | keep | - |
| briefing-handle.test.ts | a short thread handle carries the head of the briefing and says why it is short | in-process | keep | - |
| briefing-header-cap.test.ts | long header fields are shortened and disclosed, while the next step always shows in full | in-process | keep | - |
| briefing-hides-nothing.test.ts | a briefing that fits shows every goal, risk and result whole, with nothing silently dropped | in-process | keep | - |
| briefing-last-session.test.ts | last session lists the previous session's entries newest first and counts what it only headlines | in-process | keep | - |
| briefing-line-breaks.test.ts | a stored line break renders as two real lines without letting the text forge a heading | in-process | keep | - |
| briefing-session-log.test.ts | the newest session entry renders whole, older ones one line each, and is shortened last | in-process | keep | - |
| briefing-styling-cost.test.ts | briefing formatting markup doesn't multiply with the number of goals a thread holds | in-process | keep | - |
| briefing.test.ts | the briefing a resuming session reads renders exactly, hides no item, and reports when it overflows | in-process | keep | - |
| caps-census.test.ts | an over-long field is refused with its limit, what was observed, and a remedy | in-process | keep | - |
| caps.test.ts | recording too many key decisions at once is refused whole, leaving the thread unchanged | in-process | keep | - |
| clip.test.ts | shortened text stays inside its limit, ends with a visible marker, and never splits a character | in-process | keep | - |
| criteria.test.ts | goals can only be added, reworded or struck by naming a decision that actually exists | in-process | keep | - |
| decision-schema.test.ts | a long decision record still saves; the old size limit no longer rejects it | in-process | keep | - |
| declare.test.ts | every refusal a tool returns carries an example value that actually passes validation | in-process | keep | - |
| done-gate.test.ts | closing a thread is refused until every unstruck goal is done and closure is stated | in-process | keep | - |
| escape-indent-threshold.test.ts | indented stored text cannot open a code block or list the reader takes as real structure | in-process | keep | unsure: mostly drives a test-owned reimplementation of the shipped escaper; one equivalence test ties it to `src/render/escape.ts` |
| escape-record.test.ts | a record written to the store is escaped in exactly the fields the writing tools escape | in-process | keep | - |
| escape.test.ts | stored text cannot forge a heading, tag or link in what the reader sees, and unescapes back | in-process | keep | - |
| field-class.test.ts | pointer fields refuse prose and diffs, so an address field cannot smuggle content | in-process | keep | - |
| git-boundary.test.ts | a commit, branch or reference field refuses anything that isn't an address or object id | in-process | keep | - |
| goal-model-fields.test.ts | older threads still load, and a goal's check, result and verdict survive save and reload | in-process | keep | - |
| id-patterns-are-character-identical.test.ts | identifier patterns stay character-identical, so example values the server offers keep validating | in-process | keep | - |
| json-differences.test.ts | a sync conflict names the exact field that differs, addressing list entries by their id | in-process | keep | - |
| node-floor.test.ts | starting on an unsupported Node version says which version was found instead of failing oddly | in-process | keep | - |
| pointer.test.ts | which thread is being worked releases only to its owner and never travels into a clone | real-store | keep | - |
| project-key.test.ts | two different project paths never share one store, so one project's threads cannot surface in another | in-process | keep | - |
| prompts.test.ts | a quote inside a thread argument cannot turn the preflight prompt into its own instruction | linked-pair | keep | - |
| records.test.ts | every list element in a thread carries an id, so nothing becomes unaddressable | in-process | keep | - |
| refusal.test.ts | an unknown field name in a refusal is escaped, shortened and counted instead of flooding the reply | in-process | keep | - |
| resource-render.test.ts | the thread resource says "not recorded" rather than leaving blanks, and lists retired risks apart | in-process | keep | - |
| risk-identity.test.ts | two spellings of one risk count as one, so recording it again does not duplicate it | in-process | keep | - |
| roster.test.ts | the thread list shows a blockage in its own column that no title can fake or fracture | in-process | keep | - |
| session-log.test.ts | the previous session is the entries written after the last park, whatever order they arrive in | in-process | keep | - |
| session-start.test.ts | the startup banner lists open threads, marks its own truncation, and baselines a session once | real-store | keep | - |
| sync-ledger-refusal.test.ts | a sync conflict names each file, where to read both versions, and never picks a winner | in-process | keep | - |
| thread-schema-criterion-id.test.ts | a risk or decision can name the goal it bears on, and an untagged one still loads | in-process | keep | - |
| thread-schema.test.ts | a goal recorded before settledness existed still loads and reads as merely proposed | in-process | keep | - |

### test/store

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| binding-write-validation.test.ts | a malformed branch binding is refused outright while a good one lands and reads back | real-store | keep | - |
| concurrency.test.ts | two sessions writing at the same moment never lose or overwrite each other's entries | real-store | keep | - |
| durable-write.test.ts | an interrupted save never leaves a truncated or half-written entry file on disk | in-process | keep | one of its tests is typecheck-only, see Section 3 |
| git-runner-stdin.test.ts | a failed save on a large payload reports git's real reason instead of a blank error | real-store | keep | - |
| invariants.test.ts | recording notes never disturbs the developer's staged files, branch, or mid-rebase state | real-store | keep | - |
| large-records.test.ts | a thread carrying hundreds of decisions still saves and reloads instead of hitting a size cap | real-store | keep | - |
| lineage.test.ts | a successor thread shows its predecessor in the briefing; a bogus predecessor is refused | real-store | keep | - |
| materialisation.test.ts | a half-built local copy of the history is reported, never silently served as complete | real-store | keep | - |
| materialise-cost.test.ts | opening a project with many entries costs no more git work than with few | real-store | keep | - |
| materialise-in-place-guards.test.ts | refreshing the local copy never eats a concurrent writer's file nor confuses two case-identical records | real-store | keep | - |
| materialise-preserves-blob-bytes.test.ts | entries keep their exact bytes under Windows line-ending settings instead of being silently rewritten | real-store | keep | - |
| materialise-refuses-dotgit-equivalents.test.ts | a crafted entry name cannot trick the plugin into writing inside the repository's .git directory | real-store | keep | - |
| materialise-refuses-escaping-entries.test.ts | a crafted entry path cannot make the plugin write files outside its own data directory | real-store | keep | - |
| materialise-refuses-non-regular-entries.test.ts | a symlink smuggled into the shared history is refused, never created on the user's disk | real-store | keep | - |
| materialise-stays-within-plugin-data.test.ts | opening the ledger never litters the developer's own project working tree with plugin files | real-store | keep | - |
| open-cost.test.ts | starting a session stays fast and does not exhaust file handles as history grows | real-store | keep | - |
| pointer.test.ts | which thread you are currently on stays local and is never pushed to teammates | real-store | keep | - |
| probe-decisions.test.ts | the briefing reports missing and unreadable decision links exactly as a one-by-one check would | real-store | keep | - |
| read-path.test.ts | one corrupt entry is quarantined instead of breaking every read of the project's history | real-store | keep | - |
| records.test.ts | threads written by an older version of the plugin can still be edited and saved | in-process | keep | - |
| resumable-cost.test.ts | the thread roster stays fast and correct as closed threads pile up, even without its cache | real-store | keep | - |
| roster.test.ts | listing threads shells out to git at most once, so the roster returns promptly | real-store | keep | unsure: `read-path.test.ts` asserts subprocess-freedom for the same reads through the same door; only the render step is extra |
| single-store.test.ts | two installs cannot both claim one project's history, and refusals never leak filesystem paths | real-store | keep | - |
| write-path.test.ts | a failed save leaves no orphan entry or scratch file, and a racing writer's entry survives | real-store | keep | one of its tests is half repo-text, see Section 3 |

### test/sync

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| cas-retry.test.ts | syncing while another process writes locally leaves every teammate's thread reachable on both sides | real-store | keep | - |
| conflict.test.ts | when two people edit one thread, sync refuses and shows both versions rather than clobbering | real-store | keep | - |
| quiescence.test.ts | repeated syncs after a merge stop making commits instead of growing the history forever | real-store | keep | - |
| receipt.test.ts | sync claims success only when the shared copy actually received and kept the push | real-store | keep | - |
| resolve.test.ts | a hand-composed merged version is stored as given and both clones end up holding it | stdio | keep | - |
| two-clones-spawn.test.ts | two people working in clones of one repository do not lose each other's entries | stdio | keep | - |
| two-clones.test.ts | two teammates working offline keep both decisions after syncing, even with a push racing in | real-store | keep | unsure: the offline-merge half duplicates `two-clones-spawn.test.ts` through a further door; the mid-push race is unique |

### test/contract

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| budget.test.ts | the server's startup instructions and tool blurbs stay small enough not to flood a session | stdio | keep | - |
| content-rendered.test.ts | every piece of stored user text eventually shows up on some readable surface | in-process | keep | - |
| criteria-writers.test.ts | no tool other than the sanctioned one can rewrite a thread's completion criteria | stdio | keep | - |
| criterion-contract.test.ts | criteria keep their check, settledness and recorded result, and closure reports the verified split | real-store | keep | - |
| cutover-manifest-commands.test.ts | every command the plugin's manifests declare actually exists and starts cleanly | hook-subprocess | keep | also stdio |
| debrief-spine-update.test.ts | following the debrief skill's own steps really does refresh the thread's running summary | stdio | keep | also reads authored text |
| described.test.ts | every argument a caller can pass carries a description explaining what it takes | stdio | keep | - |
| done-gate-ignores-settledness.test.ts | a thread closes on whether criteria are done, never on how settled they are | in-process | keep | sampled |
| install-githooks-reachability.test.ts | the git-hook installer refuses aloud rather than silently disabling a user's existing hooks | real-store | keep | sampled; also script-subprocess |
| matcher.test.ts | the pre-tool-use hook fires on every ledger tool and not on lookalike names | stdio | keep | also reads authored text |
| no-path.test.ts | a refusal never leaks a filesystem path back to the caller | in-process | keep | sampled |
| optional-arguments-are-absent.test.ts | omitting an optional argument leaves the field empty instead of inventing a substitute | real-store | keep | - |
| packaging.test.ts | the shipped manifests, version and lockfile agree, so a fresh install is not broken | in-process | keep | - |
| published-schema.test.ts | what a tool's description promises matches the arguments and fields it actually has | stdio | keep | sampled |
| record-decision-link-skipped.test.ts | a decision is still saved, and the skipped link explained, when the thread cannot hold it | real-store | keep | - |
| render-census.test.ts | no rendered surface can emit stored user text without escaping it first | repo-text | keep | sampled; misfiled, see Section 3 |
| resume-briefs-once-per-session.test.ts | resuming the same thread twice in a session returns a short head, not the whole briefing | real-store | keep | - |
| resume-payload-envelope.test.ts | an oversized briefing is reported in the log while an ordinary one passes silently | real-store | keep | - |
| resume-payload-single-copy.test.ts | the size guard for a resume reply matches the reply the caller actually receives | real-store | keep | - |
| resume-settled-lane-clip-budget.test.ts | a crowded briefing shortens text fairly and tells the reader it was shortened | real-store | keep | - |
| settledness-has-a-reader.test.ts | each criterion's settledness reads differently on the briefing and the thread view | in-process | keep | - |
| skills.test.ts | the shipped skills name only tools and fields that exist, and their steps run end to end | stdio | keep | sampled; also reads authored text |
| subagent-recording-guidance.test.ts | the startup instructions still tell agents that a subagent records against the thread itself | stdio | keep | - |
| write-tools-ignore-the-pointer.test.ts | a stale or another session's working pointer never blocks an ordinary write | stdio | keep | - |

### test/spawn

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| amend-criteria.test.ts | amending criteria enforces the check and confirmation-quote rules for each settledness | stdio | keep | - |
| artifacts.test.ts | retiring an artifact or a risk marks it rather than deleting the history | real-store | keep | - |
| blocked-by-writer.test.ts | a thread's blockage can be set and cleared, and shows up escaped in the roster | stdio | keep | - |
| caps-relaxed.test.ts | long text a user writes is stored verbatim instead of refused at the old limits | stdio | keep | sampled |
| close.test.ts | closing a thread releases the working pointer it owns and reports the criteria split | stdio | keep | sampled |
| completions.test.ts | id autocompletion offers only real threads, filters by prefix, and stays bounded | stdio | keep | - |
| criterion-reopen.test.ts | reopening a done criterion keeps its id and earlier result and demands a decision | stdio | keep | - |
| decisions.test.ts | a recorded decision is immutable, uniquely identified, and never leaves an orphan record | stdio | keep | sampled |
| errors.test.ts | a bad call comes back as a readable four-part refusal, not a transport crash | stdio | keep | - |
| forgery.test.ts | text a user stores cannot forge headings or instructions inside a rendered briefing | stdio | keep | sampled |
| handoff.test.ts | parking stores what landed beside the next step, and omitting it preserves the old value | real-store | keep | - |
| handshake.test.ts | the server starts, lists its tools, and runs in a deliberately narrow environment | stdio | keep | - |
| install.test.ts | a freshly checked-out copy serves every tool with no build step or build output | stdio | keep | - |
| lifecycle.test.ts | each thread tool accepts a valid call, rejects invalid input, and honours struck criteria | stdio | keep | sampled |
| open-thread.test.ts | opening a thread demands a goal and next step and reports back every criterion stored | stdio | keep | - |
| park-without-outcome-clears-bound.test.ts | a bare park clears the guard that would otherwise refuse further session entries | real-store | keep | - |
| resource-address-refusals.test.ts | a hostile id inside a read address is refused rather than resolved | stdio | keep | - |
| resources.test.ts | every published read address resolves, lists real ids, and changes nothing by being read | stdio | keep | sampled |
| resume.test.ts | resume and park are one call each and recover from stale, crashed or stolen pointers | stdio | keep | sampled |
| roster.test.ts | the thread roster paginates and reaches the caller as a readable table | stdio | keep | - |
| session-entry-bound.test.ts | the 26th unparked entry is refused with a refusal naming park_thread as the way out | real-store | keep | - |
| session-entry-line-breaks.test.ts | a session entry's paragraphs read as real lines and cannot forge a heading | stdio | keep | - |
| stdout.test.ts | a single stray byte printed to stdout breaks the connection, so nothing may print there | stdio | keep | - |
| update-thread.test.ts | settling, risks and next-step anchoring follow their rules and refuse contradictory calls | stdio | keep | sampled |

### test/hooks

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| compaction-nudge-absent.test.ts | an oversized transcript no longer triggers an unsolicited approaching-compaction nudge | hook-subprocess | keep | - |
| crash-is-visible.test.ts | a hook that crashes says so on stderr and exits non-zero, never silently | hook-subprocess | keep | - |
| fixtures-typecheck.test.ts | the recorded hook payloads still match the published Claude Code hook event types | repo-text | keep | unsure: R1 fires on the letter; guards the fixture corpus three subprocess tests consume |
| guard-disable-option.test.ts | turning the bash guard off stops prompts but still cannot write into the store | in-process | keep | - |
| guard-in-process.test.ts | the tool guard decides without shelling out, so every tool call stays fast | in-process | keep | - |
| guard-path-token.test.ts | an unresolvable path neither prompts spuriously nor lets a store write slip through | in-process | keep | - |
| guard-permission-mode.test.ts | only the bypass mode silences the prompt; no mode ever permits a store write | in-process | keep | - |
| guard-read-classifier.test.ts | reading the store from bash never prompts, while anything that could write still does | in-process | keep | - |
| guard-registry.test.ts | every real ledger tool is auto-approved and an invented ledger tool name is not | in-process | keep | - |
| guard-symlink.test.ts | a write into the store through a symlink is denied; unrelated writes pass silently | in-process | keep | - |
| handoff.test.ts | the thread-left-open notice fires once at session end, never on every turn | hook-subprocess | keep | - |
| no-hang.test.ts | every hook returns well inside its declared timeout instead of stalling the session | hook-subprocess | keep | - |
| post-tool-use-writes-nothing.test.ts | committing during a session no longer makes the plugin write a note into the ledger | hook-subprocess | keep | - |
| precompact-absent.test.ts | the plugin registers no PreCompact hook, so compaction runs untouched | repo-text | keep | - |
| stdout-pure.test.ts | each hook prints one clean JSON object, so the client never sees garbled output | hook-subprocess | keep | - |
| stop-gate-block-reason-length.test.ts | the blocking message carries the whole briefing rather than a fragment clipped before its end | hook-subprocess | keep | the suite's only positive assertion on exit code 2 |
| stop-gate-fresh-data-dir.test.ts | a first run in a fresh project exits cleanly and records no verdict it never made | hook-subprocess | keep | - |
| stop-gate-latch-order.test.ts | a session that never echoed its briefing is caught later, not exempted forever | in-process | keep | - |
| stop-gate-ledger-presence.test.ts | ending a turn with nothing recorded against the held thread is blocked and explained | real-store | keep | - |
| stop-gate-owes-the-handle.test.ts | echoing the short briefing handle pays the debt exactly as the full briefing does | in-process | keep | - |
| stop-gate-quote-marker-echo.test.ts | re-quoting the briefing without its blockquote markers counts as echoed; dropping a line does not | in-process | keep | - |
| stop-gate-recording-assertions.test.ts | the end-of-turn prompt lists what to record, names empty categories, then stands down | real-store | keep | - |
| stop-gate-store-shape.test.ts | a stop that examined nothing leaves no half-built store behind in the project | in-process | keep | - |
| subagent-stop-gate.test.ts | each subagent is asked once for its findings; a malformed payload never blocks | hook-subprocess | keep | mixed: 8 in-process tests, 1 subprocess |
| unreadable-cwd.test.ts | a deleted working directory warns but crashes no hook and emits no bad JSON | hook-subprocess | keep | spawns the entry itself after removing the cwd |

### test/lint

| File | Repository property it holds | Door | Verdict | Rule |
|---|---|---|---|---|
| assertions-are-not-invariants.test.ts | the recording-model spec's assertion rows and invariant rows state different things | repo-text | keep | - |
| continuity-rule-census.test.ts | the continuity rule document names no tool absent from the server registry | repo-text | keep | - |
| cutover-manifests-agree.test.ts | package.json, plugin.json and the server's wire version all report one version | stdio | keep | runs the plugin despite sitting in the lint tier |
| cutover-old-tree-absent.test.ts | every tracked path sits in the new tree; no legacy module survives | repo-text | keep | - |
| disposal-census.test.ts | every plan heading has one disposal entry carrying the evidence its class requires | repo-text | keep | - |
| environment-is-injected.test.ts | shipped code takes clock, ulid, env and cwd from the injected Runtime | repo-text | keep | - |
| limits-register-census.test.ts | every numeric constant in shipped source matches its row in the size-limits register | repo-text | keep | - |
| limits-register.test.ts | the size-limits register loads and its parser refuses every malformed row shape | repo-text | keep | unsure: 11 of 13 tests exercise only `test/support/limits-register.ts`; one duplicates `limits-register-census.test.ts:423` |
| mandatory-tests.test.ts | every tool the live server publishes has a spawn-contract and rejects-invalid test | stdio | keep | runs the plugin to derive its population |
| markdown-construct-census.test.ts | every CommonMark construct is escaped, so stored text cannot forge markup | in-process | keep | calls `escapeStored`, so it does run shipped code |
| no-literal-identifiers.test.ts | tests bind identifiers and timestamps to referenced names instead of hardcoding literals | repo-text | keep | - |
| no-literal-limits-in-descriptions.test.ts | no tool description restates a number recorded in the size-limits register | repo-text | keep | - |
| no-sleeps.test.ts | no test pauses on a timer, an interval, a blocking wait or a spawned delay binary | repo-text | keep | - |
| no-stdout-in-src.test.ts | nothing under src or bin writes to stdout, which would corrupt the protocol | repo-text | keep | - |
| plugin-size.test.ts | the hooks tree stays under its non-blank-line budget | repo-text | keep | - |
| pre-commit-typecheck-installed.test.ts | the committed git hook scripts really block a commit carrying a type error | repo-text | keep | runs real git and tsc children over a copied fixture repo |
| readme-promises-census.test.ts | the README publishes exactly the spec's promises and states the single-session limit | repo-text | keep | - |
| resume-path-has-no-settledness-aggregate.test.ts | nothing on the briefing render path reduces over criterion settledness | repo-text | keep | - |
| shipped-imports-census.test.ts | shipped code imports only declared runtime dependencies and files inside the shipped tree | repo-text | keep | - |
| source-is-greppable-text.test.ts | every file under src, hooks and bin is valid UTF-8 with no NUL byte | repo-text | keep | - |
| spawn-allowlist.test.ts | only the allowlisted modules spawn a process, and none imports a record type | repo-text | keep | - |
| spec-errata-census.test.ts | every erratum has a unique id and an anchor occurring exactly once | repo-text | keep | - |
| temp-dirs-are-atomic.test.ts | test temp directories come from mkdtemp, never from a clock-derived path | repo-text | keep | - |
| workflow-hardening-census.test.ts | CI workflows pin action shas, scope permissions, and install with ignore-scripts | repo-text | keep | - |

### test/scheduled

| File | Observable it protects | Door | Verdict | Rule |
|---|---|---|---|---|
| briefing-generated-sweep.test.ts | a resume briefing never silently drops an item nor claims to fit when overflowing | in-process | keep | off the gate; guards the pinned boundaries in `test/unit/briefing-frontier-sweep.test.ts` |

---

## Section 2: seams with no crossing test

A seam is where two surfaces owned by different mechanisms must agree. Surfaces tested only in isolation pass individually and contradict each other in production, and no amount of testing within either side closes that. This section exists because a subtraction-only audit would never find one.

| Seam | Crossed by | Status |
|---|---|---|
| skill to tool, the names and fields a skill references against the live server | `contract/skills.test.ts` spawns the server at line 108; `contract/debrief-spine-update.test.ts` parses the debrief sequence and drives it | crossed |
| hooks.json matcher to registered tool names | `contract/matcher.test.ts` | crossed |
| published tool schema to enforced schema | `contract/published-schema.test.ts` | crossed |
| tool to store | `test/spawn` with `test/store` | crossed |
| hook to store | the `test/hooks` stop-gate files | crossed |
| plugin manifests to the commands they declare | `contract/cutover-manifest-commands.test.ts` | crossed |
| README and docs to published promises | `lint/readme-promises-census.test.ts` | crossed, as lint |
| **skill to hook**, a skill's terminal step against a hook's verdict on the state it leaves | **nothing** | **not crossed** |
| **skill to agent behaviour**, whether an agent following a skill produces the right outcome | `evals/preflight-leaves-nothing-to-record/` | **written, never run** |

### The uncrossed seam, concretely

Step 11 of `skills/preflight/SKILL.md` is `Stop.`, so the skill's correct execution ends a turn having written nothing. `ledgerPresenceVerdict` in `src/hooklib/stop-gate.ts` fires on exactly that state. Both behaviours are demanded by passing tests — `hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume` and `skill.preflight-presents-and-stops` — which contradict each other about one user flow.

`contract/skills.test.ts` cannot close it. It parses SKILL.md into numbered steps and asserts word order, so it reddens when the file is reworded and stays green when an agent following that file produces a bad outcome.

---

## Section 3: what the audit found

Four findings, each verified against the repository rather than taken on a reader's word.

**One lint census is still filed as a behaviour test.** `test/contract/render-census.test.ts`, 762 lines, builds a TypeScript program over the production files through `loadSourceProgram` and asserts every render site escapes its input. It never renders anything. It belongs in `test/lint` and the move in PR 268 missed it. It is the only non-lint importer of `test/support/source-census.ts`.

**The lint tier is not pure in the other direction either.** `test/lint/cutover-manifests-agree.test.ts` and `test/lint/mandatory-tests.test.ts` both spawn the real server, and `test/lint/markdown-construct-census.test.ts` calls `escapeStored` from `src/render/escape.ts`. For mandatory-tests that was argued when it moved, because the spawn only derives the population. For the other two it was not considered. The tier's stated property, that these files never run the plugin, is false for three of its twenty-four files.

**One test cannot fail under the runner that owns it.** `test/store/durable-write.test.ts`, test `write.log-is-required-by-type`: its only runtime assertion is `assert.equal(typeof callWithoutLog, 'function')`, true of any function declaration. The real check is the `@ts-expect-error` above the call, which fires under `tsc` and not under `node --test`. The check is real; it is filed in the wrong stage.

**One test is half behaviour and half lint.** `test/store/write-path.test.ts`, test `worktree.absent`: the first half reads every `src/store/*.ts` and asserts `doesNotMatch(contents, /worktree/i)`, which reddens on a comment as readily as on a regression. The second half writes a record and checks no directory appeared in the repository, which is a real observable.

### The hook contract is mostly asserted away from its own door

A Claude Code hook's contract is JSON on stdin, JSON on stdout, an exit code, and stderr. Exit code 2 is the block signal, and Anthropic's reference states it is the one outcome that JSON cannot override.

Across 25 files in `test/hooks`, exit code 2 is asserted positively in exactly one place: `test/hooks/stop-gate-block-reason-length.test.ts:61`, in a test named for the length of the block reason rather than for blocking. `test/hooks/handoff.test.ts:87` asserts the negative, that codes are never 2. Everything else about blocking is asserted on the in-process `StopVerdict` object.

Ten files reach a hook as a real child process; fourteen import `src/hooklib` and call it directly. No test imports a `hooks/*.ts` entry module in process, so the entry modules are only ever exercised through the real door — which is right, and makes the thinness of the exit-code coverage the more surprising.

---

## Section 4: verdicts

Every one of the 169 files is `keep`. No file fired `R1-tautological`, `R2-harness-only`, `R3-subsumed` or `R4-dead`.

That result deserves suspicion rather than satisfaction, so here is what it does and does not mean. It means no whole file in this suite was found to protect nothing. It does not mean the suite is minimal: five files carry an `unsure`, thirteen carry `sampled`, four tests inside otherwise-sound files are named in Section 3 as misfiled or unfalsifiable, and cross-directory subsumption was assessed only within each reader's own layers.

The honest summary is that the deletions this criterion anticipated are not there at file granularity. What is there is misfiling — checks sitting in a stage that cannot run them for what they are — and one uncrossed seam that no amount of deletion would have revealed.

### Carried forward, not acted on here

- Move `contract/render-census.test.ts` to `test/lint`, and decide whether `contract/packaging.test.ts` follows it.
- Re-site or re-file the four tests named in Section 3.
- Settle the two judgements the readers deferred: whether `hooks/fixtures-typecheck.test.ts` is a harness guard belonging in lint, and whether `lint/limits-register.test.ts` keeps eleven tests that exercise only a support helper, one of which duplicates `lint/limits-register-census.test.ts:423`.
- Assess subsumption across directories rather than within them.
- Read the thirteen sampled files in full and confirm or overturn their keep verdicts.
- The seed counts recorded during this audit: `probe-decisions` 102 decisions, `resumable-cost` 200 threads, `roster` 50, `materialise-cost` 40, `open-cost` 40 twice, `large-records` 200 key decisions in one record.
