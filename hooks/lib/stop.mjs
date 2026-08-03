import { readFile, stat } from 'node:fs/promises';

const PLEDGE_ARGS = ['briefing-pledge'];
const CLEAR_PLEDGE_ARGS = ['briefing-pledge', '--clear'];
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

function blockReason(threadId) {
  return `Logbook: thread ${threadId} is still active. Run the debrief skill to hand it off (which pauses the thread and clears the active-thread pointer) before ending the session.\n`;
}

function verbatimReason(rendered) {
  return `Logbook: the preflight briefing owed to this turn was not printed verbatim. The server owns every heading, separator and ordering. Print the text below exactly as it stands, with nothing added, removed, reordered or reworded.\n\n${rendered}\n`;
}

function asPledge(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.rendered !== 'string' || value.rendered.length === 0) return null;
  return { rendered: value.rendered };
}

function collectAssistantText(entry, out) {
  if (!entry || typeof entry !== 'object') return;
  const message = entry.message;
  if (!message || typeof message !== 'object') return;
  if (entry.type !== 'assistant' && message.role !== 'assistant') return;
  const { content } = message;
  if (typeof content === 'string') {
    out.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string') {
      out.push(part.text);
    }
  }
}

async function parseTranscript(path) {
  if (typeof path !== 'string' || path.length === 0) return [];
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_TRANSCRIPT_BYTES) return [];
  const raw = await readFile(path, 'utf8');
  const texts = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    collectAssistantText(entry, texts);
  }
  return texts;
}

async function readPledge(ctx) {
  try {
    return asPledge(await ctx.invokeCliJson(PLEDGE_ARGS));
  } catch {
    return null;
  }
}

async function readAssistantTexts(ctx) {
  try {
    return await parseTranscript(ctx.input && ctx.input.transcript_path);
  } catch {
    return [];
  }
}

async function clearPledge(ctx) {
  try {
    await ctx.invokeCli(CLEAR_PLEDGE_ARGS);
  } catch {
    void 0;
  }
}

async function verbatimGate(ctx, stopHookActive) {
  const pledge = await readPledge(ctx);
  if (pledge === null) return null;
  const texts = await readAssistantTexts(ctx);
  const echoed = texts.some((text) => text.includes(pledge.rendered));
  if (texts.length > 0 && !echoed && !stopHookActive) {
    return { stderr: verbatimReason(pledge.rendered), exitCode: 2 };
  }
  await clearPledge(ctx);
  return null;
}

export async function handleStop(ctx) {
  const stopHookActive = Boolean(ctx.input && ctx.input.stop_hook_active);
  const owed = await verbatimGate(ctx, stopHookActive);
  if (owed !== null) {
    return owed;
  }
  const active = await ctx.invokeCliJson(['active-thread']);
  const threadId = active && typeof active.thread_id === 'string' ? active.thread_id : null;
  if (threadId && !stopHookActive) {
    return { stderr: blockReason(threadId), exitCode: 2 };
  }
  await ctx.invokeCli(['sync']);
  return {};
}
