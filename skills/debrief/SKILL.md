---
name: debrief
description: Use at session hand-off to bring the thread's state document up to date and park the thread.
---

## Sequence

1. Gather the next action a later session takes first, specific enough to begin without working anything out again, naming the file and the place in it when it involves one.
2. Bring the thread up to date with one Bash command, `logbook update_thread --args -` with a quoted heredoc carrying `next_step` set to that action, `edits` for Where things stand and any other section that changed, each decision taken as an edit under Decisions in force with its reason, and `note` lines, one "Removed: <id> because <reason>" for each id you removed. Each edit's `old_text` is exact text of the stored document found exactly once:

   ```sh
   logbook update_thread --args - <<'EOF'
   {"thread_id":"<slug>","next_step":"<the next action>","edits":[{"old_text":"<exact text now in the document>","new_text":"<its replacement>"}],"note":["<what changed>"]}
   EOF
   ```

   Make the update under these update rules:
   - Describe the present only.
   - Where things stand says only where the work is now: a finished step leaves it, and its proof goes on the criterion it ticks as evidence.
   - As the document grows, finished-step detail in Where things stand gives way first, then decisions and risks that no longer constrain future work.
   - Where the details live names each file or document once with what it holds, never the steps or commits that changed it.
   - State each fact in one place only, in as few words as hold it.
   - No timeline and no clock times.
   - Tick a criterion only with "evidence: <what proves it>".
   - Strike a criterion only with [~] and "struck: <reason>".
   - Never delete a criterion.
   - Reword a criterion only citing the new decision that changed it.
   - Keep a decision or a risk only while it still constrains future work; otherwise remove it, or move it to Settled, do not reopen under a new id.
   - Remove every line that belongs to an option the owner did not take.
   - New ids start at the Next ids numbers and no number is reused.
   - End with a last section "## This update" holding one line that says what changed and one line "Removed: <id> because <reason>" for each id you removed.
3. Never print the document or any part of it.
4. Park the thread with a second Bash command, `logbook park_thread --args -` with a quoted heredoc carrying `{"thread_id":"<slug>","next_step":"<the next action>"}`.
5. When either command refuses, correct the field the refusal names and run that command again.
6. Tell the user in one sentence that the thread is parked and what its next step is.
