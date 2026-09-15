# Conflicts merged by git and reviewed whole

Date: 2026-09-15
Status: specified, not implemented; open questions ruled 2026-09-15
Thread: 01M2K3JS8BF36E4E7MKWF443XN
Verified against: `main` at `27e75951`
Replaces: the field-by-field merge in `src/merge/field-merge.ts` and the per-field winners of `resolve_conflict`

---

## The principle

Ruled by the human on 2026-09-15. Decision `01M2KEAP6D430JRJ1BNMCPME7J`.

**Logbook stores and guides. It does not validate a person's work, and it does not own merging logic.**

- git merges the ledgers. Logbook does not compare records field by field.
- A conflict is reviewed with both versions understood, which can mean reading beyond the conflicting field. Taking one side whole is rarely right.
- When both versions are valid, for example two people each starting a different independent piece of work, the model brings the conflict to the user with recommended resolutions, or waits for the user's own.
- Logbook still keeps what it stores readable. A record that does not fit its stored shape is refused, because an unreadable record is a storage failure. Rules about what the content should be are dropped.
- If people use Logbook incorrectly, Logbook is not responsible for fixing their work.

---

## Scope

### In scope

- How `sync_ledger` merges when both clones moved.
- What a conflict records, and what `sync_ledger` tells the model about it.
- The input and the commit of `resolve_conflict`.
- Removing `src/merge/field-merge.ts`, the per-field handling in `resolve_conflict`, and their tests.
- The three defects reproduced on this thread, which this design removes rather than patches.

### Out of scope

- **Thread criterion-reopen** (`01M2K3JHTD9RYEWTV0QXHD2FR7`). It planned merge rules for a done criterion against a reopened one. Those rules have no home after this change; that thread revisits its own spec once this lands.
- **Retire flags on risks and artifacts.** They exist partly because the field merge brought deleted entries back. They stay as they are. See "Earlier reasoning this invalidates".
- **The second pass on caps** named in `docs/specs/2026-09-11-deferred-cap-items.md`.

### Not a concern: compatibility across versions

The human is currently Logbook's only user. This ships as one release with no migration. Changing `resolve_conflict`'s input is a break in the published contract, so the release is **11.0.0**, shipped in its own release pull request, under OR44 (`docs/plans/2026-08-28-continuity-goal-model/ORCHESTRATOR-RULINGS.md:1729`).

---

## Read this first

### Terms

- The **ledger** is a git history Logbook keeps under a hidden ref (`LEDGER_REF`) in the project repository. It holds one JSON file per record and is never checked out into the working tree.
- A **clone** is one person's copy of the repository. The **remote** is the shared copy on the server.
- A **record** is one file in the ledger: a thread under `threads/`, a decision under `decisions/`, a session entry under `sessions/<thread id>/`, a branch binding under `bindings/`.
- The **common ancestor** is the last ledger commit both clones share. git calls it the merge base.
- A **conflict** is a file both clones changed, in different ways, since the common ancestor.
- The **stored shape** is the fixed layout of fields a record must have for Logbook to read it back, checked by `ThreadRecord`, `DecisionRecord`, `SessionRecord` and `BindingRecord`.

### Why git reports more conflicts than Logbook did

git compares files line by line. Every record is written as one line of JSON (`src/store/write-path.ts:56`). So any two changes to the same record count as one conflict on the whole file, even when they touch different fields. Pretty-printing would not help, because every write changes `updated_at` on both sides.

That is accepted. Two people are not expected to work the same thread at the same time, and the review reads the whole record anyway.

---

## What changes for a person using Logbook

| Situation between two syncs | Today | After |
|---|---|---|
| Two clones change different threads | Merged | Merged |
| One clone adds a decision or a session entry | Merged | Merged |
| Two clones change different fields of one thread | Merged field by field | Conflict, reviewed |
| Two clones each record a decision on, update, amend, park or close the same thread | Merged | Conflict, reviewed: all five tools, and `open_thread`, write the thread file. `log_session_event`, `bind_branch` and `resume_thread` do not |
| Two clones change the same field of one thread | Conflict on that field | Conflict, reviewed |
| Two clones each add a risk or criterion to one thread | Merged by id | Conflict, reviewed |
| Two clones change one binding file | Local copy kept, remote dropped silently (`src/merge/sync.ts:317-320`) | Conflict, reviewed |
| The remote holds a new decision while a thread conflicts | Resolve and sync refuse each other forever (defect 2) | Conflict on the thread only; the decision merges |
| The two ledgers share no history | Resolve refuses as "could not be checked" forever (defect 3) | Conflict, reviewed |
| A conflict is settled | A winner per field, applied to the local copy; the remote's other changes to that record are lost (defect 1) | The reviewed record is stored whole |

---

## The defects this removes

Each is reproduced by a failing test on branch `test/resolve-conflict-repro`, in `test/sync/resolve.test.ts`.

| Defect | Root cause | Why it cannot happen after this change |
|---|---|---|
| 1. The remote's undisputed changes to a conflicted record are lost | `resolve_conflict` rebuilds the record from the local copy (`src/server/tools/resolve_conflict.ts:698`), then commits with the remote as a parent (`:771-773`), so the next sync believes the remote's changes are already included | No record is rebuilt. The stored record is the one the reviewer composed, from both versions in front of them |
| 2. Resolve and sync refuse each other while the remote carries a new decision or session entry | Sync returns on a conflict before writing anything (`src/merge/sync.ts:486-499`); resolve refuses any remote change outside the conflicted records (`resolve_conflict.ts:762-769`) | The resolution commit starts from git's merged tree, which already holds every file that merged cleanly |
| 3. Ledgers with no shared history cannot be settled | git's "no merge base" exits 1 with empty stderr, which the check at `resolve_conflict.ts:605` does not recognise | `resolve_conflict` no longer computes a merge base; git merges unrelated histories when told to |

---

## 1. Merging in `sync_ledger`

### Today

`performMerge` (`src/merge/sync.ts:395-567`) writes the local, remote and ancestor ledgers into three scratch directories, parses every record, and runs `computeMerge` (`:255-311`), which applies the rules in `THREAD_RULES` (`src/merge/field-merge.ts:17-37`).

### After

1. Run `git merge-tree --write-tree --allow-unrelated-histories -z --no-messages <local> <remote>`, with both commits already resolved by `rev-parse --verify`. Every flag exists from git 2.38.0 (see "Git version floor").
2. **Read the result by its output, not its exit code alone.** Exit 1 means conflicts only when the output starts with a tree id. A bad argument also exits 1, but prints nothing to stdout and a message to stderr.
   - Exit 0: a tree id, then nothing.
   - Exit 1 with a tree id: the tree id, then one entry per conflicted file and stage, `<mode> <blob> <stage>` then a TAB then the path, each entry ended by NUL.
   - Anything else: a local rejection carrying git's stderr.
3. **Every record in the merged tree must be one side's file, whole (Q8).** For each record path whose merged blob differs from the local blob, the merged blob must equal the remote blob. A record that equals neither side was produced by a merge driver or setting in the project's own git configuration, not by git's default merge, and is treated as a conflict for review. Its stages come from `ls-tree` on the ancestor, local and remote commits. See "Project settings can merge a conflict silently".
4. **Clean merge.** Commit the tree, with the local and remote commits as parents, through the same compare-and-swap on `LEDGER_REF` that `writeRecords` uses. Then materialise the working copy and push with the lease, exactly as `sync.ts:531-560` does today.
5. **Conflicts.** Save the conflict state (section 2) and return the conflict reply (section 3). Write nothing to the ledger and push nothing, as today.

The paths that do not merge stay as they are: nothing to do, push, and fast-forward (`sync.ts:599-620`).

### `writeRecords` needs one new option

`buildTree` starts from the tree of the current ledger commit (`src/store/write-path.ts:94-99`). Both the clean merge and `resolve_conflict` need to start from git's merged tree instead. Add a starting-tree option to `writeRecords`, keeping the compare-and-swap against the current ledger commit. The clean merge passes zero changes.

The option is `startFrom: { tree, parent }`: the starting tree together with the ledger commit it was computed from. Three consequences follow from how `writeRecords` behaves:

- **A ref that has left the parent is refused before writing.** Sync reads the local commit, then asks git to merge it; `writeRecords` reads the ledger ref again. A write landing between those reads would otherwise become the merge commit's parent while the tree lacks it.
- **A moved ref is refused, not retried.** Without the option, a moved ref is retried by rebuilding onto the new commit. A starting tree was computed against the old commit, so rebuilding would drop whatever the new commit added. With the option, a moved ref returns `ref-moved` and the caller recomputes: sync already retries its attempt on `ref-moved` (`sync.ts:527`), and `resolve_conflict` refuses as retryable.
- **The disk copy must be materialised afterwards.** After the commit, `writeRecords` writes only the given records to disk, but the tree also carries the other side's files. Every caller therefore runs `syncWorkingCopy`, which rewrites the working copy whenever its stamp does not match the ledger ref. None may advance the stamp alone.

### Removed from `sync.ts`

`readOursRecordSet`, `readScratchRecordSet`, `walkCarriedFiles`, `carriedChanges`, `computeMerge`, the scratch materialisation of three ledgers, and the checks that depended on parsing them. Two of those checks raise open questions Q1 and Q2.

---

## 2. The saved conflict

`conflicts.json` stays in `layout.state`. Its contents change from one entry per disputed field to one entry per conflicted file, plus the commits the merge used:

```json
{
  "local_commit": "<sha>",
  "remote_commit": "<sha>",
  "paths": [
    { "path": "threads/<id>.json", "base_blob": "<sha or null>", "local_blob": "<sha or null>", "remote_blob": "<sha or null>" }
  ]
}
```

The three blob ids come from the conflicted-file entries `git merge-tree` prints. Stage 1 is the ancestor, stage 2 is the first commit given (local) and stage 3 is the second (remote). A missing stage is `null`. Unrelated histories list only stages 2 and 3. A file deleted on one side lists stage 1 and the side that kept it.

The tree git prints for a conflicted run still holds every file that merged cleanly, including the remote's new decisions and session entries. At a conflicted path it holds the file with conflict markers written into it. That content is never stored: section 4 replaces every conflicted path before committing.

---

## 3. The conflict reply from `sync_ledger`

The reply stays a refusal (`conflictRefusal`, `src/server/tools/sync_ledger.ts:167-178`), so the model cannot mistake it for a finished sync. Its message carries:

1. **Each conflicted file**, by path.
2. **Where to read each version.** A new resource, `logbook://conflict/{blob_id}`, returns one version's content. It serves only blob ids named in the current `conflicts.json`, and refuses others. Giving addresses rather than inline copies keeps the reply small when a thread is large or several conflict (open question Q4).
3. **What to do with them**, in plain words:
   - Read the ancestor, local and remote versions whole. Read the thread's decisions and session entries on both sides where they explain a change.
   - Compose the record as it should now read, keeping every change from both sides that still belongs.
   - When both versions are valid alternatives rather than one being out of date, present them to the user with a recommended resolution and wait for their choice or their own.
   - Do not take one side whole without having reviewed the other.
   - Settle every conflicted file with one `resolve_conflict` call, then run `sync_ledger`.

The sentence "merges record by record when both moved" in `sync_ledger`'s description (`sync_ledger.ts:184`) is rewritten to describe this.

---

## 4. `resolve_conflict`

### Input

```json
{ "resolutions": [ { "path": "threads/<id>.json", "record": { } } ] }
```

- `path` is a conflicted path exactly as the reply named it.
- `record` is the whole record as it should now read.
- Every reported path appears exactly once. The existing refusals for a missing, repeated or unreported entry stay, rewritten from fields to paths (`resolve_conflict.ts:131-156`).
- Files outside the four record directories raise open question Q5.

Found while implementing (step 5):

- **A path is a record when it matches a record address**, `threads/<ulid>.json`, `decisions/<ulid>.json`, `bindings/<ulid>.json` or `sessions/<ulid>/<ulid>.json`. Every other path, including a file inside a record directory that no tool writes, is settled with `content`. Decision `01M2KK8AEJXRDY0XTXV6Z3CMY3`.
- **The published path pattern is loose**: no leading slash, no NUL, no line break. A tighter pattern would leave a conflict on an unusual file name impossible to settle.
- `record` is published as an object of any keys and values. The per-directory stored shape is checked in the handler, because a published union of four record schemas cannot say which one applies to which path.

### What it checks

**The stored shape only.** The record is parsed with the schema for its directory. The id inside it must equal the id in its path, because the path is the record's address, not a judgment on its content. A failure is refused, naming the failing field, and nothing is written.

**No content rules.** Nothing checks whether a next step matches its criterion, whether a risk is a duplicate, or which side's value was chosen. The PR #258 rule that a next step and its criterion take one winner is removed.

**Escaping, as on every write.** Free-text fields are escaped with `escapeStored`, the same as the tools that write each kind. Versions read from the ledger are already escaped, so the escape must leave escaped text unchanged. It does: `escape.stored-is-idempotent-over-the-escapable-and-markdown-leading-population` (`test/unit/escape.test.ts:225`) proves escaping twice equals escaping once for every escapable and line-leading character. Every emitted token starts with `U`, which is neither, and no raw line break survives, so escaped text has no second line start for a longer input to exploit.

Which fields are free text is read from the record schema, not listed by hand: `escapeStoredRecord` (`src/schema/escape-record.ts`) escapes every string whose field class is `content` or `pointer`. On a record that fits its shape this is exactly the set the writing tools escape, because the two such fields no tool escapes, `slug` and a decision's `commit`, have patterns that admit no character the escape changes. `test/unit/escape-record.test.ts` states the tools' set per kind literally. Decision `01M2KJVBVT46EH83XYZCZNKMZB`.

The record is checked twice: as given, so a refusal names the field the caller sent, and again after escaping, because escaping lengthens text and a length cap applies to what is stored.

### What counts as stale

The local ledger may move between the sync and the resolve. For example, the model may log a session entry while reviewing. That must not force a second review.

`resolve_conflict` runs `git merge-tree` again, between the current `LEDGER_REF` and the saved `remote_commit`, reading it exactly as section 1 steps 2 and 3 do:

- **Same conflicted paths, same local blob for each:** proceed. Local changes to other files merge cleanly and are kept.
- **Anything else:** refuse, saying a conflicted record changed locally since the sync, and to run `sync_ledger` again.

This replaces the per-field stale checks (`resolve_conflict.ts:702-705`, `:721-726`) and the remote divergence check (`:593-630`, `:762-769`).

### What it writes

1. Start from the tree that `git merge-tree` just printed.
2. Replace each conflicted path with its resolved record.
3. Commit through `writeRecords` with `startFrom: { tree, parent: <the local commit that merge-tree was given> }` and the saved remote commit as the extra parent.
4. Materialise the working copy with `syncWorkingCopy`, and delete `conflicts.json`. The stamp is not advanced alone as `resolve_conflict.ts:778-788` does today, because the disk would then be marked current while missing the remote's files.
5. Reply with the paths resolved and the new commit, and say to run `sync_ledger` to push.

It does not push, as today.

### Removed from `resolve_conflict.ts`

The `winner` input, `FIELD_HANDLING_TABLE` and its helpers (`:357-552`), `splitNextStepPairRefusal`, `staleRecordedValueRefusal`, `unclassifiableFieldRefusal`, `findUncarriedRemoteDivergence`, `unsafeRemoteDivergenceRefusal`, `divergenceUnverifiableRefusal`, and `EMPTY_TREE_SHA`. `noRemotePositionRefusal` stays, reworded for a saved remote commit that no longer exists locally.

As implemented, also removed: `corruptConflictsRefusal` (an unreadable and a malformed `conflicts.json` share `conflictsUnreadableRefusal`, since `readConflictState` does not tell them apart and the remedy for both is to sync again), `threadUnavailableRefusal`, `unclassifiableRecordRefusal`, `invalidThreadAfterResolutionRefusal` and `invalidDecisionAfterResolutionRefusal`. Added: `payloadMismatchRefusal` (a record path sent `content`, or another path sent `record`), `invalidRecordRefusal` (the record schema's own refusal, its field prefixed `resolutions.<i>.record.`), `recordAddressMismatchRefusal` (an id that differs from the path) and `staleConflictRefusal`. A failure of the re-run `git merge-tree` is reported through `commitFailureRefusal`, because nothing was written and a retry recomputes it.

---

## 5. What is deleted

| File or part | Size today | Replaced by |
|---|---|---|
| `src/merge/field-merge.ts` | 373 lines | git |
| `nextStepPairNoteFor` and `NEXT_STEP_PAIR_NOTE` in `src/merge/conflict.ts` | 7 lines | nothing; `Conflict` is reshaped to section 2 |
| Per-field handling and the divergence check in `src/server/tools/resolve_conflict.ts` (`:357-630`) | about 270 lines | section 4 |
| `test/unit/field-merge.test.ts` | 33 tests | criterion "git merges the ledgers" tests |
| `test/unit/resolve-conflict-fields.test.ts` | 6 tests | criterion "stored shape only" tests |
| The `mergeThread` case in `test/unit/goal-model-fields.test.ts` (`:116`) | 1 case | nothing |
| Three `unit/field-merge.test.ts` entries in `test/contract/no-literal-identifiers.test.ts` (`:165`, `:179`, `:193`) | 3 entries | nothing |
| In `test/sync/resolve.test.ts`: the three next-step pair and stale tests, `resolve.spine-landed-conflict-resolves`, `resolve.artifacts-conflict-resolves`, `conflict.resolve-names-the-winner` | 6 tests | the c1 to c3 tests |

`conflict.partial-list-refused`, `resolve_conflict.spawn.contract` and `resolve_conflict.rejects-invalid` are rewritten for the new input.

`sync.two-clones-offline.spawn` (`test/sync/two-clones-spawn.test.ts`) had both clones record a decision on one thread and expected a clean merge. Under git that is a conflict, so the scenario is rewritten: each clone records a decision on a different thread and logs a session entry on the other's, and it must still merge. The store-level `sync.two-clones-offline.store` writes only decision files and keeps its scenario.

---

## Earlier reasoning this invalidates

The earlier specifications are left as written. These statements in them stop being true when this lands:

- `docs/specs/2026-09-11-deferred-cap-items.md:190` rejects hard-deleting a risk because the next sync would undo it, citing `field-merge.ts:143-145`. After this change a one-sided deletion merges like any other change. Retire flags stay; nothing needs changing now.
- `docs/specs/2026-09-11-deferred-cap-items.md:528` defers the same risk added on two machines surviving a sync twice. After this change, two clones adding risks to one thread is a conflict, and the reviewer sees both.
- `docs/specs/2026-08-26-briefing-scoping-repair.md:112`: the merge sorting criteria by id and renumbering them. That merge is gone.
- `docs/specs/2026-09-06-continuity-recording-model.md:506`: which settledness wins on a merge. Now it is whatever the reviewer composes.

---

## Git version floor

Researched on 2026-09-15 from git's source and release notes. The output format, exit codes and stage numbering were then confirmed on git 2.55.0 in a throwaway repository.

### The floor is git 2.38.0

| Flag | First release | Used here |
|---|---|---|
| `--write-tree` | 2.38.0 | yes |
| `--allow-unrelated-histories` | 2.38.0 | yes |
| `-z` | 2.38.0 | yes |
| `--messages` / `--no-messages` | 2.38.0 | yes |
| `--name-only` | 2.38.0 | no |
| `--stdin` | 2.39.0 | no |
| `--merge-base` | 2.40.0 | no |
| `-X` | 2.43.0 | no |

### Against default installs

| System | Default git | Meets 2.38.0 |
|---|---|---|
| macOS 26 Command Line Tools | 2.50.1 | yes |
| Ubuntu 24.04 | 2.43.0 | yes |
| Debian 12 | 2.39.5 | yes |
| Ubuntu 22.04 | 2.34.1 | **no**, there is no `--write-tree` |

The macOS version comes from user reports and this machine, not from Apple, which does not publish it. The distribution versions exclude later security updates, which the package pages did not show.

### What the documentation gets wrong

The design follows git's behaviour, not these statements in its manual:

- **Exit codes.** The manual says an error exits with something other than 0 or 1. A bad ref, a missing object or a tree passed as a commit exits 1 with empty stdout (`help.c:905` in git's source). Confirmed: a missing ref exits 1 and prints only to stderr. Section 1 reads the output for that reason.
- **Separator.** Conflicted-file entries put a TAB before the path, not a space (`builtin/merge-tree.c:515`). Confirmed.
- **Messages under `-z`.** Each message ends in a newline before its NUL. The design passes `--no-messages`, so this is never parsed.

Unrelated histories without `--allow-unrelated-histories` exit 128. Confirmed.

### Project settings can merge a conflict silently

Confirmed on 2.55.0 with a one-line record changed differently on both sides. With default settings git reports a conflict. Each setting below instead makes it exit 0 with no conflict, writing both lines into the record, which then does not parse:

| Setting | Silently merges | Blocked by `--attr-source=<empty tree>` | Blocked by `-c merge.default=text` |
|---|---|---|---|
| `*.json merge=union` in the project's `.gitattributes` | yes | yes | not tried |
| `*.json merge=union` in `.git/info/attributes` | yes | **no** | not tried |
| `merge.default=union` in git config | yes | not tried | yes |

A custom merge driver configured the same way could write a record that does parse. No flag blocks every source, and `--attr-source` is a later global option whose first release was not researched. Step 3 of section 1 is the defence, and it depends on no git version or setting: a merged record must be one side's file whole, which is always true of git's default merge on a one-line file.

---

## Open questions

Each was put to the human with a recommendation. The rulings follow the table.

| # | Question | Recommendation | Why |
|---|---|---|---|
| Q1 | The remote holds a record this version cannot parse, usually one written by a newer plugin. Today sync refuses (`unparseableRecordsRefusal`, `sync_ledger.ts:148-165`). | Stop refusing. git merges the bytes, and the reader quarantines what it cannot parse, one record at a time (item 8 of the deferred cap items). | The refusal existed because the field merge had to parse every record. git does not. |
| Q2 | This clone holds a record it cannot read. Today sync refuses when the merge would decide it (`sync.ts:460-484`). | Stop refusing. | The refusal protected local work from a merge that decided records without reading them. git merges the file's bytes and loses neither side. |
| Q3 | Should the reply also list which parts of each record differ, as a reading aid? | Yes: a plain list of the JSON paths that differ between each side and the ancestor, computed generically, never used to decide anything. | Three whole copies of a large thread are easy to misread, and the aid makes review more accurate without making a choice. It is display code, not merge logic. |
| Q4 | Versions inline in the reply, or behind `logbook://conflict/{blob_id}`? | Behind the resource. | Three copies of several large records can pass the tool-output limit (risk recorded on the thread). |
| Q5 | A conflicted file outside `threads/`, `decisions/`, `sessions/` and `bindings/`. | Accept `content` as a string for those paths and store it as given. | Logbook never checked their shape; today they are carried with local winning silently (`sync.ts:313-324`). |
| Q6 | The installed git is older than 2.38.0, as on a default Ubuntu 22.04. | Refuse only the merge path, naming the version found and 2.38.0. Fast-forward, push and nothing-to-do keep working, since they need no `merge-tree`. | A clear refusal beats a git usage error mid-merge, and one person on an old git can still push and pull whenever the other has not moved. |
| Q7 | Should the review guidance also live in a plugin skill? | No, the reply only. | The reply reaches the model at the moment of the conflict without a skill having to load. |
| Q8 | A project's own git attributes or config make git merge a conflicted record silently. | Treat any merged record that is not one side's file whole as a conflict for review (section 1, step 3). Do not also pass `--attr-source` or `-c merge.default=text`. | The check covers every source, including `.git/info/attributes` and custom drivers, on every git version. The flags cover only some sources, and one of them may raise the floor. |

### Rulings

The human ruled every question as recommended on 2026-09-15.

| # | Decision |
|---|---|
| Q1 | `01M2KFAVKJCWW5M2HDGNYX34GH` |
| Q2 | `01M2KFB0G2DFYNJPJG1GCTC30R` |
| Q3 | `01M2KFB57P1EZKBQVZKN9ZMK1H` |
| Q4 | `01M2KFBAC293A14R89YP780234` |
| Q5 | `01M2KFBEZFZ4DMQE37V9M9ZNTH` |
| Q6 | `01M2KFBMHVRP1ZXZXEA94KBVVT` |
| Q7 | `01M2KFBRX5K6AXCE8FSJRDKFXB` |
| Q8 | `01M2KFBYCAMZ9HSHGX3FY9ZZV7` |

---

## Completion criteria on the thread

| Criterion | Section | Test |
|---|---|---|
| git merges the ledgers; different fields of one thread conflict; different threads, new decisions and new session entries merge | 1 | two two-clone tests in `test/sync/` |
| The conflict reply gives the three versions and directs a review | 2, 3 | two-clone test on the reply |
| c1: `resolve_conflict` stores the composed record, and both clones hold it | 4 | `resolve.keeps-the-remote-non-conflicting-changes-to-the-conflicted-record`, rewritten |
| c2: settled while the remote carries a new decision or session entry | 1, 4 | the two `resolve.settles-a-conflict-while-the-remote-carries-*` tests, rewritten |
| c3: ledgers with no shared history | 1, 4 | the two `resolve.settles-a-conflict-between-ledgers-that-share-no-history-*` tests, rewritten |
| Stored shape is the only refusal | 4 | a shape-failure test and a mismatched-criterion test |

---

## Suggested order

One implementation pull request, then the release pull request OR44 requires. Splitting `sync_ledger` from `resolve_conflict` leaves `main` reporting conflicts that no tool can settle.

1. Rewrite the five reproduction tests to the new input and add the tests for the three new criteria. Each must fail on today's code. Where a test goes through the new conflict reply or the new `resolve_conflict` input, today's code fails it at that contract, before its symptom assertion is reached. That is expected: the symptoms were already proven red against today's code by the original reproduction tests (thread session entry `01M2KDH7NWQS9FD6E40503MQHT`), and each symptom assertion is proven to carry its fix in step 7. The rewritten clean-merge scenario in `sync.two-clones-offline.spawn` passes today and stays green as a guard.
2. Prove escaping leaves escaped text unchanged. Done before this step was reached: the existing census at `test/unit/escape.test.ts:225` already proves it, so no test was added.
3. Add the starting-tree option to `writeRecords`.
4. Merge through `git merge-tree` in `sync.ts`, save the new conflict state, and return the new reply and resource.
5. Rewrite `resolve_conflict`.
6. Delete what section 5 lists, and rewrite the two tool descriptions.
7. For each criterion, revert its part of the change and confirm its own test turns red.
8. Review by an agent that did not write the diff.
9. After it merges, a release pull request that writes only the two manifests, at 11.0.0. Then reinstall the plugin and restart.
