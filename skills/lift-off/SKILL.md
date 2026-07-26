---
name: lift-off
description: Use when the user says "resume", "continue", "pick up where we left off", "/lift-off", or a near-equivalent at the start of work. Refreshes the derived index, presents the resumable roster (never auto-selecting), reconciles drift into the chosen thread, renders the spine-only resume brief through the ledger MCP tools, then STOPS for the user's instruction.
allowed-tools: mcp__ledger__reconcile, mcp__ledger__rebuild_index, mcp__ledger__get_resume_brief
---

# Lift Off

Teach this session the cumulative project state through the `ledger` MCP tools, present the resume brief, then STOP. This skill only orchestrates the tools — the server owns the brief's content and every rule. The write side is the `ledgerize` skill.

## Read protocol

1. Refresh the roster. Call `mcp__ledger__rebuild_index` so the resumable roster is current before you show anything.

2. Present the roster and wait. Show the resumable threads (the SessionStart context surfaces this roster; each entry carries its `thread_id`, its slug, and a one-line next step). Then:
   - if the user gave an explicit choice (`/lift-off <slug>`, or named a thread), use that thread;
   - otherwise present the roster and WAIT for the user to choose.
   NEVER auto-select by recency, by last-modified time, or by branch. The human picks.

3. Reconcile the chosen thread. Call `mcp__ledger__reconcile` to fold any drift and re-attach a moved or renamed branch into the chosen thread before you brief on it.

4. Render the brief. Call `mcp__ledger__get_resume_brief` with the chosen thread's `thread_id` and present the returned brief VERBATIM. The brief is spine-only by design — there is no session-reading tool here and none is needed.

5. STOP. Present the brief and stop for the user's instruction. Do not begin the work, do not pick the next task, and do not edit anything. Present-then-STOP is the whole contract of this skill.
