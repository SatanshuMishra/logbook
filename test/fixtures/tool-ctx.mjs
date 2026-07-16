import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../src/tools/context.mjs';

export const FIXED = '2026-07-15T10:00:00Z';
export const fixedClock = () => FIXED;

export async function makeToolCtx(t, { now = fixedClock } = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'tool-proj-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'tool-data-'));
  const prevData = process.env.CLAUDE_PLUGIN_DATA;
  const prevProj = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  delete process.env.CLAUDE_PROJECT_DIR;
  t.after(async () => {
    if (prevData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prevData;
    if (prevProj === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prevProj;
    await rm(projectDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });
  return buildContext({ projectDir, now });
}
