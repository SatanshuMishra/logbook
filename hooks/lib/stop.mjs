function blockReason(threadId) {
  return `Session-continuity: thread ${threadId} is still active. Run the ledgerize skill to hand it off (which pauses the thread and clears the active-thread pointer) before ending the session.\n`;
}

export async function handleStop(ctx) {
  const active = await ctx.invokeCliJson(['active-thread']);
  const threadId = active && typeof active.thread_id === 'string' ? active.thread_id : null;
  const stopHookActive = Boolean(ctx.input && ctx.input.stop_hook_active);
  if (threadId && !stopHookActive) {
    return { stderr: blockReason(threadId), exitCode: 2 };
  }
  await ctx.invokeCli(['sync']);
  return {};
}
