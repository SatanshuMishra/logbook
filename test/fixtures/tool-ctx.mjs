import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../src/tools/context.mjs';
import { gitExec } from '../../src/util/git-exec.mjs';
import { clearedGitLocationEnv, isolatedGitConfigEnv } from '../../src/util/git-env.mjs';

export const FIXED = '2026-07-15T10:00:00Z';
export const fixedClock = () => FIXED;

const REPO_IDENTITY = Object.freeze([
  ['user.email', 'logbook-fixture@example.invalid'],
  ['user.name', 'Logbook Fixture'],
]);

function restoreEnv(key, previous) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

async function isolatedProject(t, prefix) {
  const projectDir = await mkdtemp(join(tmpdir(), `${prefix}proj-`));
  const dataDir = await mkdtemp(join(tmpdir(), `${prefix}data-`));
  const prevData = process.env.CLAUDE_PLUGIN_DATA;
  const prevProj = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  delete process.env.CLAUDE_PROJECT_DIR;
  t.after(async () => {
    restoreEnv('CLAUDE_PLUGIN_DATA', prevData);
    restoreEnv('CLAUDE_PROJECT_DIR', prevProj);
    await rm(projectDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });
  return { projectDir, dataDir };
}

async function initProjectRepo(projectDir) {
  const env = { ...clearedGitLocationEnv(), ...isolatedGitConfigEnv() };
  await gitExec(projectDir, ['init', '-q', '-b', 'main'], { env });
  for (const [key, value] of REPO_IDENTITY) {
    await gitExec(projectDir, ['config', '--local', key, value], { env });
  }
}

export async function makeToolCtx(t, { now = fixedClock } = {}) {
  const { projectDir } = await isolatedProject(t, 'tool-');
  return buildContext({ projectDir, now });
}

export async function makeGitToolCtx(t, { now = fixedClock } = {}) {
  const { projectDir } = await isolatedProject(t, 'tool-git-');
  await initProjectRepo(projectDir);
  return buildContext({ projectDir, now });
}
