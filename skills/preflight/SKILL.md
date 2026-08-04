---
name: preflight
description: Use when the user says "resume", "continue", "pick up where we left off", "/preflight", or a near-equivalent at the start of work. Refreshes the derived index, presents the resumable roster (never auto-selecting), reconciles drift across the ledger, prints the server-rendered briefing verbatim through the ledger MCP tools, then STOPS for the user's instruction.
allowed-tools: mcp__ledger__reconcile, mcp__plugin_logbook_ledger__reconcile, mcp__ledger__rebuild_index, mcp__plugin_logbook_ledger__rebuild_index, mcp__ledger__get_resume_brief, mcp__plugin_logbook_ledger__get_resume_brief, mcp__ledger__read_decision, mcp__plugin_logbook_ledger__read_decision
---

# Preflight

Teach this session the cumulative project state through the `ledger` MCP tools, print the briefing, then STOP. This skill only orchestrates the tools — the server owns the briefing's content, its wording and every rule. The write side is the `debrief` skill.

## Read protocol

Each ledger tool carries two names: `mcp__ledger__<name>` when the server is configured directly, and `mcp__plugin_logbook_ledger__<name>` when it is installed as a plugin. Both names reach the same server — call whichever one is present. The steps below use the short form.

1. Refresh the roster. Call `mcp__ledger__rebuild_index` so the resumable roster is current before you show anything.

2. Present the roster and wait. Show the resumable threads (the SessionStart context surfaces this roster; each entry carries its `thread_id`, its slug, and a one-line next step). Then:
   - if the user gave an explicit choice (`/preflight <slug>`, or named a thread), use that thread;
   - otherwise present the roster and WAIT for the user to choose.
   NEVER auto-select by recency, by last-modified time, or by branch. The human picks.

3. Fold drift. Call `mcp__ledger__reconcile`, which takes no arguments and runs across the whole ledger, before you brief on anything.

4. Print the briefing. Call `mcp__ledger__get_resume_brief` with the chosen `thread_id` and print the returned `briefing` field VERBATIM — it is a finished string. Author no headings, no separators, no ordering and no summary of your own, and add nothing before or after it.

5. Offer the drill-down. The briefing names decisions by number. If the user asks about one, call `mcp__ledger__read_decision` with that number.

6. STOP. Print the briefing and stop for the user's instruction. Do not begin the work, do not pick the next task, and do not edit anything. Present-then-STOP is the whole contract of this skill.
