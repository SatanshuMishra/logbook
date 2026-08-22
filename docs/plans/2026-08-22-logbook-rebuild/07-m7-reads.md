# M7 — Reads

**Depends on:** M5 and M6.

**Ships:** `list_threads`, the `logbook://` resources including the static index, argument completions, pagination, and the two human-entry-point prompts.

**Read first:** SPEC §5.4, §7.2, §7.4, §7.5, §6.4 on blockage rendering.

---

## Premise checks

- [ ] **P1. M5 and M6 are both merged and green on `main`.**
- [ ] **P2. Reads make no subprocess.** `node --test rebuild/test/store/read-path.test.ts` passes `read.is-subprocess-free`. If it does not, the roster's cost claim fails before this unit starts.
- [ ] **P3. The briefing renderer already renders blockage with its reason.** Confirm `briefing.blocked-renders-its-reason` passes; the roster reuses the same rule.
- [ ] **P4. The SDK exposes resource templates and completions on the current line.** Confirm `server.registerResource` accepts a `ResourceTemplate` and that a `complete` callback is supported. If completions moved, re-plan Task 3 rather than dropping it — §7.2 builds it because it is what lets a caller pick a thread without guessing an id.
- [ ] **P5. The server identifier is still `ledger`.** Read `.mcp.json:4`. Tool and command names namespace as `mcp__plugin_logbook_ledger__*` (§7.4), and M8's matcher depends on this.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | Every address listed in `logbook://index` resolves | `resource.index-addresses-resolve` passes as a census |
| A2 | The roster renders a blocked thread's reason | `roster.renders-blockage-reason` passes |
| A3 | A resource read never mutates | `resource.read-is-pure` passes |
| A4 | The roster is a directory read: zero subprocesses per thread | `roster.is-subprocess-free` passes |
| A5 | Completions return real thread ids and slugs from the store | `completion.offers-real-threads` passes |
| A6 | A roster larger than one page paginates and every page is reachable | `roster.paginates` passes |
| A7 | `list_threads` has spawn and rejection tests | two tests |

**Red on the parent commit:** `resource.index-addresses-resolve`.

**Inertness mutation:** in `rebuild/src/server/resources.ts`, remove one address from the static index body while leaving its template registered. `resource.index-addresses-resolve` must turn red — the census runs in both directions, so an index that under-reports is as much a failure as one that over-reports.

---

## Files

**Create:** `rebuild/src/server/resources.ts`, `completions.ts`, `prompts.ts`; `rebuild/src/server/tools/list-threads.ts`; `rebuild/src/render/roster.ts`; `rebuild/test/spawn/resources.test.ts`, `roster.test.ts`, `completions.test.ts`.

---

## Task 1: The roster and `list_threads`

**Files:** `rebuild/src/render/roster.ts`, `rebuild/src/server/tools/list-threads.ts`, `rebuild/test/spawn/roster.test.ts`

`readOnlyHint: **true**`. When `readOnlyHint` is true, `destructiveHint` and `idempotentHint` carry no meaning, so they are omitted rather than set.

- [ ] **Step 1: Write the description**

> Lists the threads that can be picked up, newest activity first, each with its state, how far along it is, and the single next action the last session left. Takes no required arguments; pass `cursor` from a previous reply to read the next page, and `limit` to change the page size from its default of 25. A thread that is blocked shows what it is blocked on, because a blocked thread with no reason is worse than no thread at all. This is a plain directory read and costs nothing worth avoiding.

- [ ] **Step 2: Write the failing tests**

```
roster.renders-blockage-reason   a blocked thread's row contains its blocked_by text; a census over
                                 the roster renderer asserts no branch emits a blocked marker
                                 without the reason on the same row
roster.is-subprocess-free        instrument the git wrapper's call counter; list 50 threads; assert
                                 the counter is at most 1 for the whole call, not 1 per thread
roster.paginates                 60 threads, limit 25: three pages, every id appears exactly once
                                 across the pages, and the third page carries no cursor
roster.excludes-terminal         done and abandoned threads are absent from the default listing
roster.orders-by-activity        ordering is by updated_at descending, asserted across distinct
                                 milliseconds only; same-millisecond ordering is not guaranteed
```

`roster.is-subprocess-free` is the measured collapse made into an assertion. A session start currently costs 50 git subprocesses and 1.18 s because each of three command-line children re-runs an eleven-spawn provisioning prologue (§5.4). With a plain working copy there is nothing to provision.

- [ ] **Step 3: Implement, run to green, commit**

```bash
git add rebuild/src/render/roster.ts rebuild/src/server/tools/list-threads.ts rebuild/test/spawn/roster.test.ts
git commit -m "feat(rebuild): list resumable threads from a directory read"
```

---

## Task 2: Resources and the static index

**Files:** `rebuild/src/server/resources.ts`, `rebuild/test/spawn/resources.test.ts`

| Address | Contents |
|---|---|
| `logbook://index` | a static resource listing every address shape below |
| `logbook://roster` | the resumable roster, same content as `list_threads` |
| `logbook://thread/{id}` | one thread record, rendered |
| `logbook://decision/{id}` | one decision record |
| `logbook://session/{thread_id}/{entry_id}` | one session-log entry |

- [ ] **Step 1: Write the failing census `resource.index-addresses-resolve`**

Parse the body of `logbook://index` into an address list. For each address shape, substitute a real id taken from a seeded store and `resources/read` it through a spawned client; assert a non-error result. Then run the census the other way: enumerate every registered template on the server and assert each appears in the index body. **Both directions**, because an index that under-reports is the failure mode this resource exists to prevent.

`logbook://index` exists because resource templates are readable but **not discoverable**: the client never requests the template list, confirmed client-wide by a control run against the same binary configured as a user server (§7.2). A templated address works only if the shape was published somewhere the model already reads, and this is that place.

- [ ] **Step 2: Write the purity test**

```
resource.read-is-pure   snapshot the store byte-for-byte; read every address twice; re-snapshot;
                        assert identical, including state/ and the ledger ref value
```

- [ ] **Step 3: Implement**

Resource URIs are not namespaced by the client, so the plugin owns its scheme and collision avoidance is this project's responsibility (§7.4). The scheme is `logbook://` and nothing else registers under it.

Rendering a decision or a session entry to Markdown happens here, from the JSON record. The store holds JSON (M1 Task 8); Markdown is a projection.

- [ ] **Step 4: Run to green and commit**

```bash
git add rebuild/src/server/resources.ts rebuild/test/spawn/resources.test.ts
git commit -m "feat(rebuild): publish ledger reads as logbook resources behind a static index"
```

---

## Task 3: Completions

**Files:** `rebuild/src/server/completions.ts`, `rebuild/test/spawn/completions.test.ts`

- [ ] **Step 1: Write the failing test**

```
completion.offers-real-threads   seed three threads; request a completion for resume_thread's
                                 thread id argument with an empty prefix; assert the three real
                                 ids are offered and no invented value is
completion.filters-by-prefix     a prefix matching one slug returns that thread and not the others
completion.is-bounded            300 threads seeded; the completion result is capped and reports
                                 that it was truncated rather than returning all of them
```

- [ ] **Step 2: Implement**

Completions drive the autocomplete that lets a caller pick a thread without guessing an id (§7.2). They are offered for the thread-id argument of `resume_thread`, `update_thread`, `close_thread`, `amend_criteria`, `record_decision`, `log_session_event` and `bind_branch`, and for `resolve_conflict`'s record argument.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/server/completions.ts rebuild/test/spawn/completions.test.ts
git commit -m "feat(rebuild): complete thread arguments from the real store"
```

---

## Task 4: Prompts

**Files:** `rebuild/src/server/prompts.ts`

Two, both human entry points only: `preflight` and `debrief` (§7.5).

- [ ] **Step 1: Implement them as thin wrappers**

`preflight` returns a message asking for the roster to be presented and a thread chosen. `debrief` returns a message asking for the session's outcome.

- [ ] **Step 2: Write the failing test**

```
prompt.nothing-depends-on-them   a census over rebuild/src/: no non-test module imports prompts.ts,
                                 and no tool handler references a prompt by name
```

A prompt cannot be invoked without a human keystroke, so no automatic behaviour may route through one (§7.5). The skills in M9 remain the model-invocable path, and this census is what keeps that true as later units are written.

- [ ] **Step 3: Run the inertness mutation and record it**

Remove one address from the static index body while leaving its template registered; confirm `resource.index-addresses-resolve` turns red; restore.

- [ ] **Step 4: Commit and open the pull request**

```bash
git add rebuild/src/server/prompts.ts
git commit -m "feat(rebuild): offer preflight and debrief as human entry points only"
```

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m7-reads --base main \
  --title "feat(reads): list threads and publish the ledger as readable addresses" \
  --what "A blocked thread now shows what it is blocked on wherever it appears, instead of only announcing that it is blocked." \
  --what "Session logs, decisions and threads are readable at stable addresses that a single index page lists." \
  --why "Listing threads cost fifty git subprocesses, and session logs were written but nothing could read them." \
  --verified "roster over fifty threads - at most one subprocess for the whole call" \
  --verified "index census in both directions - every address resolves and every template is listed" \
  --not-verified "whether the client requests the resource template list - it does not, which is why the index exists"
```
