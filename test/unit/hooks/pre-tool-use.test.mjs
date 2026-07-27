import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import {
  classifyPreToolUse,
  classifyBashCommand,
  handlePreToolUse,
} from '../../../hooks/lib/pre-tool-use.mjs';
import { resolveLedgerRoots } from '../../../hooks/lib/ledger-roots.mjs';
import { hookContext } from '../../../hooks/lib/hook-io.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';
import { DEFAULT_LEDGER_BRANCH } from '../../../src/drivers/git-ledger.mjs';
import { tempDir, cleanup, useEnv, initGitRepo } from './fixtures.mjs';

const PROJECT_DIR = '/proj';
const ROOTS = ['/data/-proj/ledger'];
const HOME_TAIL = join(sep, '.claude', 'session-continuity', projectKey(PROJECT_DIR));
const HOME_ROOTS = [join(homedir(), HOME_TAIL)];
const HOME_BRACED = '${HOME}';
const GIT_ROOTS = [join(PROJECT_DIR, '.git', 'ledger')];
const ROOT_READ = 'cat /data/-proj/ledger/f ';
const OUTSIDE_READ = 'cat /tmp/f ';

function padTo(head, length) {
  return head + 'x'.repeat(length - head.length);
}

test('classifyBashCommand asks about any command that names a resolved ledger root', () => {
  assert.equal(classifyBashCommand('rm -rf /data/-proj/ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('cat /data/-proj/ledger/threads/a.json', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('echo x > "/data/-proj/ledger/threads/a.json"', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about the ledger branch the git driver actually writes', () => {
  assert.equal(
    classifyBashCommand(`git branch -D ${DEFAULT_LEDGER_BRANCH}`, ROOTS, PROJECT_DIR),
    'ask',
  );
  assert.equal(
    classifyBashCommand(`git update-ref -d refs/heads/${DEFAULT_LEDGER_BRANCH}`, ROOTS, PROJECT_DIR),
    'ask',
  );
});

test('classifyBashCommand asks about the ledger ref-kill commands', () => {
  assert.equal(classifyBashCommand('git branch -D _ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git update-ref -d refs/heads/_ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git push origin :_ledger', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about every home-abbreviated spelling of a root', () => {
  assert.equal(classifyBashCommand(`rm -rf ${HOME_ROOTS[0]}`, HOME_ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(`rm -rf ~${HOME_TAIL}`, HOME_ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(`rm -rf $HOME${HOME_TAIL}`, HOME_ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(`rm -rf "${HOME_BRACED}${HOME_TAIL}"`, HOME_ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about the plugin data root variable by name', () => {
  assert.equal(classifyBashCommand('rm -rf "$CLAUDE_PLUGIN_DATA"', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('rm -rf ${CLAUDE_PLUGIN_DATA}/-proj', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('rm -rf $CLAUDE_PLUGIN_DATA/-proj', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about the custom-ref ledger namespace', () => {
  assert.equal(classifyBashCommand('git update-ref -d refs/ledger/notes', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git push origin :refs/ledger/notes', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about the project-relative spelling of an in-repo root', () => {
  assert.equal(classifyBashCommand('rm -rf .git/ledger', GIT_ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('rm -rf ./.git/ledger/threads', GIT_ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(`rm -rf ${GIT_ROOTS[0]}`, GIT_ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand leaves a command that names nothing ledger alone', () => {
  assert.equal(classifyBashCommand('npm test', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('ls -la', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git status --short', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('rm -rf /tmp/scratch', HOME_ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand leaves ordinary commands alone under the widened trigger set', () => {
  const roots = [...GIT_ROOTS, ...HOME_ROOTS];
  assert.equal(classifyBashCommand('git commit -m "wire the parser"', roots, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('cat .git/config', roots, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git push origin refs/heads/main', roots, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('rm -rf node_modules && npm ci', roots, PROJECT_DIR), null);
  assert.equal(classifyBashCommand(`echo $HOME${sep}notes.md`, roots, PROJECT_DIR), null);
});

test('classifyBashCommand asks when the command itself cannot be read', () => {
  assert.equal(classifyBashCommand(undefined, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(null, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(7, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(['rm', '-rf', ROOTS[0]], ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand({ command: 'npm test' }, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand stays silent when no ledger root resolved at all', () => {
  assert.equal(classifyBashCommand(undefined, [], PROJECT_DIR), null);
  assert.equal(classifyBashCommand('rm -rf /data/-proj/ledger', [], PROJECT_DIR), null);
});

test('classifyPreToolUse asks about a Bash call whose command is unreadable', () => {
  const missing = classifyPreToolUse({ tool_name: 'Bash', tool_input: {} }, ROOTS, PROJECT_DIR);
  assert.equal(missing.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(
    missing.hookSpecificOutput.permissionDecisionReason.includes('could not read'),
    true,
  );
  const noInput = classifyPreToolUse({ tool_name: 'Bash' }, ROOTS, PROJECT_DIR);
  assert.equal(noInput.hookSpecificOutput.permissionDecision, 'ask');
  const stringInput = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: 'rm -rf /data/-proj/ledger' },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(stringInput.hookSpecificOutput.permissionDecision, 'ask');
  const arrayInput = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: ['rm', '-rf'] } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(arrayInput.hookSpecificOutput.permissionDecision, 'ask');
});

test('handlePreToolUse asks about a real Bash call carrying no command string', async (t) => {
  const projectDir = await tempDir('hooks-nocmd-proj-');
  const dataRoot = await tempDir('hooks-nocmd-data-');
  cleanup(t, projectDir, dataRoot);
  const result = await handlePreToolUse({
    input: { tool_name: 'Bash', tool_input: {} },
    env: { CLAUDE_PLUGIN_DATA: dataRoot },
    projectDir,
  });
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'ask');
});

test('classifyBashCommand denies an oversized command that names a ledger root', () => {
  const under = padTo(ROOT_READ, 16383);
  const atCap = padTo(ROOT_READ, 16384);
  const over = padTo(ROOT_READ, 16385);
  assert.equal(under.length, 16383);
  assert.equal(atCap.length, 16384);
  assert.equal(over.length, 16385);
  assert.equal(classifyBashCommand(under, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(atCap, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(over, ROOTS, PROJECT_DIR), 'deny');
});

test('classifyBashCommand asks about an oversized command that never names a ledger root', () => {
  const under = padTo(OUTSIDE_READ, 16383);
  const atCap = padTo(OUTSIDE_READ, 16384);
  const over = padTo(OUTSIDE_READ, 16385);
  assert.equal(under.length, 16383);
  assert.equal(atCap.length, 16384);
  assert.equal(over.length, 16385);
  assert.equal(classifyBashCommand(under, ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand(atCap, ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand(over, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand denies an oversized command that names any ledger spelling', () => {
  assert.equal(classifyBashCommand(padTo(`cat ~${HOME_TAIL}/f `, 16385), HOME_ROOTS, PROJECT_DIR), 'deny');
  assert.equal(classifyBashCommand(padTo('git update-ref -d refs/heads/_ledger ', 16385), ROOTS, PROJECT_DIR), 'deny');
});

test('classifyPreToolUse reports the size reason for an oversized command that names a trigger', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: padTo('git branch -D _ledger ', 16385) } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
  const reason = d.hookSpecificOutput.permissionDecisionReason;
  assert.equal(reason.includes('larger than the session-continuity guard reads'), true);
});

test('classifyPreToolUse names the matched trigger and disclaims a security boundary', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'git update-ref -d refs/heads/_ledger' } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'ask');
  const reason = d.hookSpecificOutput.permissionDecisionReason;
  assert.equal(reason.includes('"_ledger"'), true);
  assert.equal(reason.includes('is not a security boundary'), true);
});

test('classifyPreToolUse names a matched root path as the trigger', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf /data/-proj/ledger' } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(d.hookSpecificOutput.permissionDecisionReason.includes('"/data/-proj/ledger"'), true);
});

test('classifyPreToolUse denies a Write under a ledger root', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Write', tool_input: { file_path: '/data/-proj/ledger/threads/a.json' } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
});

test('classifyPreToolUse allows a Write outside every ledger root', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Write', tool_input: { file_path: '/proj/src/app.js' } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(d, null);
});

test('handlePreToolUse auto-approves any mcp__ledger__* tool', async () => {
  const ctx = { input: { tool_name: 'mcp__ledger__open_thread' }, env: {}, projectDir: '/proj' };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'allow');
});

test('handlePreToolUse auto-approves the plugin-namespaced ledger tool', async () => {
  const ctx = {
    input: { tool_name: 'mcp__plugin_session-continuity_ledger__open_thread' },
    env: {},
    projectDir: '/proj',
  };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'allow');
});

test('resolveLedgerRoots keys the managed dir by project-key under CLAUDE_PLUGIN_DATA', async (t) => {
  const projectDir = await tempDir('hooks-roots-proj-');
  const dataRoot = await tempDir('hooks-roots-data-');
  cleanup(t, projectDir, dataRoot);
  useEnv(t, { CLAUDE_PLUGIN_DATA: dataRoot });
  const roots = await resolveLedgerRoots(projectDir, process.env);
  assert.equal(roots.includes(join(dataRoot, projectKey(projectDir))), true);
});

async function symlinkedStore(t) {
  const base = await tempDir('hooks-symlink-');
  cleanup(t, base);
  const store = join(base, 'store');
  await mkdir(join(store, 'ledger'), { recursive: true });
  await symlink(store, join(base, 'link'), 'dir');
  return { base, roots: [join(store, 'ledger')], aliased: join(base, 'link', 'ledger') };
}

const writeVerdict = (path, roots, baseDir) => classifyPreToolUse(
  { tool_name: 'Write', tool_input: { file_path: path } },
  roots,
  baseDir,
);

test('classifyPreToolUse denies a Write reached through a symlinked component', async (t) => {
  const { base, roots, aliased } = await symlinkedStore(t);
  const d = writeVerdict(join(aliased, 'threads', 'a.json'), roots, base);
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
});

test('classifyPreToolUse allows a Write that only shares the symlinked prefix', async (t) => {
  const { base, roots } = await symlinkedStore(t);
  assert.equal(writeVerdict(join(base, 'link', 'other.txt'), roots, base), null);
});

test('classifyBashCommand asks about the canonical spelling of an aliased root', async (t) => {
  const { aliased } = await symlinkedStore(t);
  const canonical = realpathSync(aliased);
  assert.notEqual(canonical, aliased);
  assert.equal(classifyBashCommand(`rm -rf ${canonical}`, [aliased], PROJECT_DIR), 'ask');
});

async function bashCtx(t, commandFor) {
  const projectDir = await tempDir('hooks-bash-proj-');
  const dataRoot = await tempDir('hooks-bash-data-');
  cleanup(t, projectDir, dataRoot);
  return {
    input: { tool_name: 'Bash', tool_input: { command: commandFor(join(dataRoot, projectKey(projectDir))) } },
    env: { CLAUDE_PLUGIN_DATA: dataRoot },
    projectDir,
  };
}

test('handlePreToolUse asks about a Bash command that names a real resolved root', async (t) => {
  const ctx = await bashCtx(t, (root) => `rm -rf ${root}`);
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'ask');
});

test('handlePreToolUse leaves an unrelated Bash command alone', async (t) => {
  const ctx = await bashCtx(t, () => 'npm test');
  assert.deepEqual(await handlePreToolUse(ctx), {});
});

test('handlePreToolUse asks about the project-relative spelling of a real in-repo root', async (t) => {
  const projectDir = await tempDir('hooks-relative-proj-');
  cleanup(t, projectDir);
  await initGitRepo(projectDir);
  const ctx = hookContext(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf .git/ledger' }, cwd: projectDir },
    { CLAUDE_PROJECT_DIR: projectDir },
  );
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(result.json.hookSpecificOutput.permissionDecisionReason.includes('".git/ledger"'), true);
});

test('handlePreToolUse resolves a relative write path against the session cwd', async (t) => {
  const projectDir = await tempDir('hooks-cwd-proj-');
  const dataRoot = await tempDir('hooks-cwd-data-');
  cleanup(t, projectDir, dataRoot);
  const ctx = hookContext(
    {
      tool_name: 'Write',
      tool_input: { file_path: join('threads', 'a.json') },
      cwd: join(dataRoot, projectKey(projectDir)),
    },
    { CLAUDE_PLUGIN_DATA: dataRoot, CLAUDE_PROJECT_DIR: projectDir },
  );
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('handlePreToolUse denies a real ledger-root write end to end', async (t) => {
  const projectDir = await tempDir('hooks-roots-proj-');
  const dataRoot = await tempDir('hooks-roots-data-');
  cleanup(t, projectDir, dataRoot);
  const target = join(dataRoot, projectKey(projectDir), 'ledger', 'threads', 'a.json');
  const ctx = {
    input: { tool_name: 'Write', tool_input: { file_path: target } },
    env: { CLAUDE_PLUGIN_DATA: dataRoot },
    projectDir,
  };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny');
});
