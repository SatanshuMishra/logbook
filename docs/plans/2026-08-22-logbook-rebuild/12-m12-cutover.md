# M12 — Cutover

**Depends on:** every other unit merged, or retired by a recorded decision naming the reason.

**Ships:** the manifest flip, the deletion of the old tree, and 1.0.0 with both manifests in agreement.

**Read first:** SPEC §13.4, §2.8, §3.2, and `00-overview.md` §2 on why the tree moves.

This is the only unit that changes what the installed plugin loads. Everything before it was safe to merge precisely because the running plugin could not see `rebuild/` (§13.1). That protection ends here.

---

## Premise checks

These are the heaviest premise checks in the plan, because this unit is the only one that cannot be undone by a revert alone.

- [ ] **P1. Every unit is merged or retired.** For each of M1 through M11, either its pull request is merged into `main`, or a numbered decision on the thread names the reason it was retired. **A MERGED status is not evidence the content landed**: for each, run `git merge-base --is-ancestor <merged-head> origin/main` and confirm exit 0.
- [ ] **P2. The full gate is green on `main`.** Every job in `.github/workflows/rebuild.yml` passes on the current `main`, on a clean checkout.
- [ ] **P3. Every defect in the register is closed by a named unit or explicitly deferred with an owner.** Walk the register; none silently dropped (§13.4 item 2).
- [ ] **P4. Whether the skills and hooks directories can be relocated by manifest.** Read the plugin manifest schema and `hooks/hooks.json`, and determine whether `skills/` and `hooks/` may live anywhere other than the plugin root. **If they may**, this unit flips paths in the manifests and moves nothing, which is a far smaller and safer change. **If they may not**, the move in Task 2 is required. `00-overview.md` §2 assumes they may not; this check is what settles it before the diff is written.
- [ ] **P5. The old tree has no remaining reader.** `grep -rn 'src/\|hooks/lib\|bin/ledger' --include='*.json' --include='*.md' . | grep -v rebuild/ | grep -v docs/` enumerates every reference to the old tree outside documentation. Each one is either updated by this unit or is a documentation reference that stays.
- [ ] **P6. The existing ledger store is frozen, not migrated.** Confirm no code in `rebuild/` reads the old store's layout. 0064 makes the new store start empty; the old store is frozen in place and remains readable by the old plugin (§3.2). **Nothing in this unit deletes it.**

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | The packaging check passes | `node scripts/check-packaging.mjs` exits 0 against the new layout |
| A2 | A fresh install serves the new server | `install.serves-new-server` passes |
| A3 | The old tree is gone | `cutover.old-tree-absent` passes as a census |
| A4 | Both manifests agree on version 1.0.0 | `cutover.manifests-agree` passes |
| A5 | A refusal from any tool names its field, an accepted example, and whether retry can succeed | `contract.refusal-is-complete` passes over every tool |
| A6 | No call leaves partial durable state; concurrent calls never collide on an identifier | M1 and M6 tests still green on the cut-over layout |
| A7 | Stored text cannot forge server-authored instruction on any surface | M10 tests still green on the cut-over layout |
| A8 | Two people working offline and merging lose nothing | M2 and M6 sync tests still green on the cut-over layout |

A5 through A8 are §13.4's items 3 through 6, re-asserted here because a path move can break a census that was passing, and this is the only unit that moves paths.

**Red on the parent commit:** `cutover.old-tree-absent`.

**Inertness mutation:** restore one file of the old tree, for instance `src/drivers/git-ref-driver.mjs`. `cutover.old-tree-absent` must turn red and name it.

---

## Files

**Modify:** `.claude-plugin/plugin.json`, `.mcp.json`, `package.json`, `scripts/check-packaging.mjs`, `receipts.config.json`, `README.md`.

**Move:** `rebuild/src` → `src`, `rebuild/bin` → `bin`, `rebuild/hooks` → `hooks`, `rebuild/skills` → `skills`, `rebuild/test` → `test`, `rebuild/tsconfig.json` → `tsconfig.json`, `rebuild/stryker.config.json` → `stryker.config.json`, `rebuild/inspector.config.json` → `inspector.config.json` — **only if P4 says the directories cannot be relocated by manifest.**

**Delete:** the old `src/`, `bin/`, `hooks/`, `skills/`, `test/` trees, and `scripts/audit/`.

---

## Task 1: The fresh-install test, written first

**Files:** `rebuild/test/spawn/install.test.ts`

Write this before touching a manifest. It is the only assertion that distinguishes "the repository is correct" from "an install of the repository is correct", and §11.9 item 5 names that gap as one CI cannot otherwise close.

- [ ] **Step 1: Write `install.serves-new-server`**

Pack the plugin the way an install does — `npm pack` into a temporary directory, unpack it, and from the unpacked directory alone spawn the server named by `.mcp.json`, complete the handshake, and list the tools. Assert the listing contains all twelve tool names.

Assert separately that the unpacked directory contains **no** file from the old tree, by name, and that the skills directory contains exactly the two `SKILL.md` files.

- [ ] **Step 2: Confirm it fails on the current layout**

Expected: FAIL — `.mcp.json` still names `bin/ledger-server.mjs`.

- [ ] **Step 3: Commit**

```bash
git add rebuild/test/spawn/install.test.ts
git commit -m "test(rebuild): prove a packed install serves the new server"
```

---

## Task 2: The move

Perform this only if P4 established that the directories cannot be relocated by manifest.

- [ ] **Step 1: Delete the old tree in its own commit**

```bash
git rm -r src bin hooks skills test scripts/audit
git commit -m "chore(cutover): delete the superseded javascript tree"
```

**Separate the deletion from the move.** A single commit that deletes 100 files and adds 100 files renders as a rewrite and is unreviewable; two commits render as a deletion and a rename, and git detects the renames in the second.

- [ ] **Step 2: Move the new tree into place in its own commit**

```bash
git mv rebuild/src src && git mv rebuild/bin bin && git mv rebuild/hooks hooks
git mv rebuild/skills skills && git mv rebuild/test test
git mv rebuild/tsconfig.json tsconfig.json
git mv rebuild/stryker.config.json stryker.config.json
git mv rebuild/inspector.config.json inspector.config.json
rmdir rebuild
git commit -m "chore(cutover): move the rebuilt tree to the plugin root"
```

- [ ] **Step 3: Fix every path that the move broke**

`tsconfig.json` `include`, the `package.json` scripts, `.github/workflows/rebuild.yml`, `stryker.config.json`'s `mutate` and `commandRunner.command`, `inspector.config.json`'s `args`, and every relative import the compiler flags. Run `npm run typecheck` until clean.

**Do not hand-edit imports the compiler has not flagged.** The type checker is the census here.

- [ ] **Step 4: Commit**

```bash
git commit -am "chore(cutover): repoint every path at the new tree root"
```

---

## Task 3: The manifests

- [ ] **Step 1: Flip `.mcp.json`**

The server command becomes the built entry point. The `LEDGER_BACKEND` and `LEDGER_BRANCH` environment substitutions are **removed**: 0067 makes git the only backend and the ref is `refs/logbook/ledger`, so a backend selector is a setting with one legal value.

- [ ] **Step 2: Flip `.claude-plugin/plugin.json`**

Version becomes `1.0.0`. The `userConfig` block loses `ledger_backend` and `ledger_branch` for the reason above. It keeps `disable_trailer` and `disable_bash_guard` only if M8 shipped the behaviours they gate; if M8 did not, they are removed rather than left as settings that do nothing.

- [ ] **Step 3: Flip `package.json`**

Version `1.0.0`. `scripts.test` becomes the rebuild suite and the `rebuild:` prefix is dropped from every script name. `receipts.config.json`'s `build.test_command`, `build.suite_command`, `verify.test_command` and `verify.suite_command` are updated to match — the legacy suite they pointed at no longer exists.

- [ ] **Step 4: Write `cutover.manifests-agree` and `cutover.old-tree-absent`**

```
cutover.manifests-agree   package.json version, .claude-plugin/plugin.json version and the version
                          the server reports over the wire are all equal, asserted against a
                          spawned server rather than against a literal
cutover.old-tree-absent   a census: no file in the repository outside docs/ matches the old tree's
                          module names. Halts on a path it cannot classify as new tree,
                          documentation or repository infrastructure
```

`cutover.manifests-agree` reads the version from a spawned server because §13.4 item 7 requires both manifests to agree and a literal in a test agrees with nothing.

- [ ] **Step 5: Update the packaging check and the README**

`scripts/check-packaging.mjs` gains the new layout. The README's installation and architecture sections are rewritten against what now exists — not amended, because an amended document describing a replaced system is exactly the drift §2.7 is about.

- [ ] **Step 6: Run everything**

```
npm run typecheck
npm test
node scripts/check-packaging.mjs
node --test test/spawn/install.test.ts
```

- [ ] **Step 7: Run the inertness mutation and record it**

Restore `src/drivers/git-ref-driver.mjs` from the parent commit; confirm `cutover.old-tree-absent` turns red and names it; remove it again.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(cutover): ship logbook 1.0.0 from the rebuilt tree"
```

---

## Task 4: Close the rebuild

- [ ] **Step 1: Verify §13.4 item by item**

| # | Item | Evidence |
|---|---|---|
| 1 | Every unit merged or retired by a recorded decision naming the reason | P1's ancestry checks, plus the decision numbers |
| 2 | Every defect in the register closed by a named unit or explicitly deferred with an owner | the register, walked |
| 3 | A refusal from any tool names its field, an accepted example, and whether retry can succeed | `contract.refusal-is-complete` |
| 4 | No call leaves partial durable state; concurrent calls never collide on an identifier | `write.atomic-on-failure`, `write.no-orphan-record`, `concurrent.distinct-ids` |
| 5 | Stored text cannot forge server-authored instruction on any surface | `render.no-unescaped-site` and the three forgery tests |
| 6 | Two people working offline and merging lose nothing | `sync.two-clones-offline.store` and `.spawn` |
| 7 | Ships 1.0.0 with both manifests in agreement | `cutover.manifests-agree` |

Items 3, 4, 5 and 7 are the four criteria the previous attempt left open. Item 6 is new and is what 0061 made first-class.

- [ ] **Step 2: Restate the honest claim green makes**

In the pull request body, in these words: *every deterministic surface of this plugin behaves correctly through its real interfaces.* Not more. §11.9's five items remain open, and items 1 and 2 are tracked as named risks with a re-check cadence rather than closed.

- [ ] **Step 3: Verify the install by hand, once**

Reinstall the plugin and restart the client. **This repository is the plugin, and working-tree edits do not reach the running plugin until reinstall and restart** (§2.8). Every unit until now verified against a spawned build under test; this is the one place where verifying the installed article is both possible and required, and it is the only step in the entire plan that a human performs rather than a test.

- [ ] **Step 4: Open the pull request**

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m12-cutover --base main \
  --title "feat(release): ship logbook 1.0.0 from the rebuilt tree" \
  --what "The plugin now runs entirely on the rebuilt server, and the superseded tree is gone." \
  --what "Existing ledgers are left untouched and readable by the previous version; the new store starts empty." \
  --why "Two implementations of the same plugin cannot both be installed, and the old one carried the defects this rebuild exists to remove." \
  --verified "packed install spawned from the unpacked directory - twelve tools listed" \
  --verified "manifest versions against a spawned server - all three agree on 1.0.0" \
  --verified "full suite on a clean checkout - passing" \
  --not-verified "that the model chooses to invoke the skills - unmeasurable until the evaluation harness opens" \
  --risk "This is the first change the installed plugin can see; a defect here is visible immediately rather than after a later merge."
```
