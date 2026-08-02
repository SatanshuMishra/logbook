# Proposal: a `/flightplan` command

**Status:** proposed, deferred — recorded 2026-08-02 during the `logbook` rename, not scheduled.

**Vocabulary:** this document uses the post-rename names (`flight` for thread, `/preflight` and `/debrief` for the two skills). Before the rename lands, read `flight` as `thread`.

## The gap

The plugin ships two commands, and both operate on a flight that already exists: `/preflight` reads one, `/debrief` writes one and parks it. Nothing opens one.

Flight creation is therefore reachable only as a raw `open_thread` MCP call, with no skill owning its preconditions. That is not a cosmetic omission — it leaves two of the system's structural guarantees unenforced.

## Why it matters: the unclosable flight

Three facts, each verified in the current source:

1. `open_thread` requires only `title`. `completion_criteria` is optional — `src/tools/open-thread.mjs:30`.
2. `update_thread` can only toggle a criterion that already exists; `toggleCriteria` throws on any text not already present on the record — `src/tools/update-thread.mjs:14-16`. Criteria cannot be added after creation, by design.
3. `checkDefinitionOfDone` refuses `done` when `completion_criteria` is empty — `src/model/dod.mjs:5-7`.

Together: **a flight opened without completion criteria can never be landed.** Its only terminal exit is `archive_thread`, which records it as abandoned — a permanent misfiling of work that actually finished.

This is correct behavior from each component in isolation. Point 2 is the deliberate defense against retroactively inventing a definition of done to fit whatever shipped, and it should not change. The failure is that nothing sits in front of point 1 to make criteria a conscious act at the only moment they can be set.

The live ledger shows the current mitigation is discipline, not structure: `plugin-audit-explainer` carries three well-formed criteria, supplied by hand at creation with nothing requiring them.

The second unenforced guarantee is the WIP rule — dispose of a non-terminal flight before opening another. It is stated in the global rules and in the plugin's own design, and no code path checks it, because the code path that would check it does not exist.

## Proposed contract

`/flightplan [title]` — the write-side entry point, mirroring `/preflight`'s discipline of doing one thing and stopping.

1. **Refresh and check WIP.** Call `rebuild_index`, read the resumable roster. If any non-terminal flight exists (`airborne`, `holding`, `grounded`), present it and require a disposition — resume, hold, land, or scrub — before continuing. Stop starting; start finishing.
2. **Require completion criteria.** Elicit them in conversation and refuse to open the flight without at least one. This is the whole point of the command: it is the only moment the Definition-of-Done gate can be armed, and the command exists to make that moment deliberate. Criteria should be observable outcomes, not steps.
3. **Open the flight.** Call `open_flight` with the title, slug, and criteria.
4. **Bind the branch.** Call `bind_branch` to attach the flight to the current repo and branch and set the active pointer.
5. **Confirm and STOP.** State the flight opened, its slug, and its criteria back to the user, then stop for their first instruction. Symmetric with `/preflight`: the command establishes state and hands control back; it does not begin the work.

Steps 1 and 2 are the reason to build it. Steps 3 and 4 are already reachable today.

## Open questions

- **Does the WIP check belong here or in a hook?** A `UserPromptSubmit` or `SessionStart` hook would catch work started without ever typing `/flightplan`, which is the likelier path. The command is the honest surface; a hook is the load-bearing one. The plugin's stated split — guarantees in hooks, judgment in skills — argues for both, with the hook prompting and the command eliciting.
- **Should `open_flight` require `completion_criteria` at the schema level?** That would close the trap for every caller rather than only the well-behaved one, and it is a smaller change than this command. It is also a breaking schema change, and it forecloses legitimate exploratory flights whose criteria genuinely are not knowable at creation. If those exist, the trap is a feature and only the command should enforce; if they do not, the schema is the better fix and this command becomes convenience rather than structure. Settle this before building either.
- **Naming.** `/flightplan` reads as the filed intent, which matches. `/clearance` and `/depart` were considered; both imply permission to begin work, which contradicts the stop-at-the-end contract.

## Why deferred

The rename is a mechanical transformation with a bounded blast radius. This is a new user-facing contract with an unresolved design question about where enforcement lives. Bundling them would make the rename's diff unreviewable and would lock in an enforcement decision that deserves its own discussion.
