---
name: debrief
description: Use when the user says "session handoff", "wrap up", "hand off", "handoff summary", or confirms wrapping up a session. Writes the project ledger through the ledger MCP tools — the session log, straggler decision records, the mandatory thread-spine refresh, and the state transition — so a fresh session resumes from the ledger alone, then prints the hand-off summary.
allowed-tools: mcp__ledger__append_session_event, mcp__plugin_logbook_ledger__append_session_event, mcp__ledger__record_decision, mcp__plugin_logbook_ledger__record_decision, mcp__ledger__amend_criteria, mcp__plugin_logbook_ledger__amend_criteria, mcp__ledger__update_thread, mcp__plugin_logbook_ledger__update_thread, mcp__ledger__transition_thread, mcp__plugin_logbook_ledger__transition_thread, mcp__ledger__rebuild_index, mcp__plugin_logbook_ledger__rebuild_index
---

# Debrief

Write the ledger through the `ledger` MCP tools. The ledger is canonical; the chat summary is a courtesy for a future session that starts with zero context. This skill only orchestrates the tools — the server owns every rule (lifecycle, gates, caps, validation) and refuses anything illegal. The read side is the `preflight` skill.

Operate on the thread you have been working in this session. Its `thread_id` is the active thread the SessionStart context surfaced (the same id returned when the work was opened). Pass that `thread_id` to every write below.

## Wrap-up protocol

Each ledger tool carries two names: `mcp__ledger__<name>` when the server is configured directly, and `mcp__plugin_logbook_ledger__<name>` when it is installed as a plugin. Both names reach the same server — call whichever one is present. The steps below use the short form.

1. Wind down. Collect results from running subagents and background tasks, or stop them cleanly; never abandon a write mid-flight. Anything that must keep running belongs in the session-log body with its shell id and kill command.

2. Append the session log. Call `mcp__ledger__append_session_event` with the `thread_id`, an `actor` naming who is writing, and a `body` recording what shipped AND what failed and why. This is the append-only narrative of the session.

3. Promote straggler decisions. For each decision locked this session that has no record yet, call `mcp__ledger__record_decision` with the `thread_id`, a kebab-case `slug`, a `title`, the `context`, the `options` you weighed (a plain list of strings), and the `outcome`. Decision-time capture is the norm; this is the safety net. Skip any decision already recorded.

4. Amend the plan, when the work departed from it. Call `mcp__ledger__amend_criteria` with the `thread_id` and the `operations` the session earned:
   - unplanned work that you closed, or will close, in this session: `insert` a criterion with `kind` `detour`. Work that needs its own criteria, or that will outlive this session, is a child thread instead, not a detour.
   - the plan itself was wrong: `rewrite` or `strike` the criterion, and pass the `decision_ref` of the record that explains it. Record that decision in step 3 first — a criterion is never rewritten or struck without one.

5. Refresh the spine — MANDATORY, and BEFORE any transition. Call `mcp__ledger__update_thread` with the `thread_id` to set the spine's forward-looking fields and to flip each satisfied completion criterion to done (match a criterion by its id and supply its done flag). This step is the linchpin: it is what populates the roster's next step and the resume brief. Skip it and the brief comes back blank. Do it even when nothing else changed. Write:
   - `active_goal` and `next_step`: where the work is going, and the single next action.
   - `last_session`: one line on what this session actually did.
   - `open_risks`: only what passes all four of ACTIONABLE (it changes what the next session does), SPECIFIC TO THIS WORK (not agent hygiene), STILL TRUE (retire it once it is resolved or moot), and LEGIBLE (plain words, jargon expanded). Shape each one as `<specific constraint or action> — <why, in plain words>`, and put paths, SHAs and commands in `refs` rather than in the prose.
   - `out_of_scope`: the same four-part gate, minus anything whose rationale already lives in a decision record. The record is its single home; do not restate it here.
   - `replace_scopes`: name every scope whose risks or decisions you are restating in full, including one whose last item you are retiring. A risk or decision you leave out of a scope you do not name is carried forward, not retired.

6. Transition the thread. Call `mcp__ledger__transition_thread` with the `thread_id` and the target status:
   - the normal hand-off parks the thread at `paused`;
   - to mark it `blocked`, also pass `blocked_by` naming the blocker;
   - to close it `done`, also pass a one-sentence `closure_statement`.
   The server decides which moves are legal and gates a close on its Definition-of-Done — do not pre-judge those rules here; surface the server's refusal to the user. Parking the worked thread clears the active-thread pointer server-side.

7. Rebuild the index. Call `mcp__ledger__rebuild_index` so the derived roster reflects this hand-off.

8. Print the hand-off summary. In chat, state the thread worked, its new status, the next step you recorded, and any decisions added. The ledger is the source of truth; this summary is the courtesy copy.
