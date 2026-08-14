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
import { TOOLS } from '../../../src/tools/registry.mjs';
import { tempDir, cleanup, useEnv, initGitRepo } from './fixtures.mjs';

const PROJECT_DIR = '/proj';
const ROOTS = ['/data/-proj/ledger'];
const HOME_TAIL = join(sep, '.claude', 'logbook', projectKey(PROJECT_DIR));
const HOME_ROOTS = [join(homedir(), HOME_TAIL)];
const HOME_BRACED = '${HOME}';
const GIT_ROOTS = [join(PROJECT_DIR, '.git', 'ledger')];
const ROOT_READ = 'cat /data/-proj/ledger/f ';
const OUTSIDE_READ = 'cat /tmp/f ';
const LARGE_BYTES = 20 * 1024;

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

test('classifyBashCommand asks about the expanded literal plugin data root', () => {
  const env = { CLAUDE_PLUGIN_DATA: '/data' };
  assert.equal(classifyBashCommand('rm -rf /data', ROOTS, PROJECT_DIR, env), 'ask');
  assert.equal(classifyBashCommand('rm -rf /data/', ROOTS, PROJECT_DIR, env), 'ask');
  assert.equal(classifyBashCommand('rm -rf "/data"', ROOTS, PROJECT_DIR, env), 'ask');
});

test('classifyBashCommand asks about home-abbreviated spellings of the plugin data root', () => {
  const tail = join(sep, '.claude', 'logbook');
  const env = { CLAUDE_PLUGIN_DATA: join(homedir(), '.claude', 'logbook') };
  assert.equal(classifyBashCommand(`rm -rf ~${tail}`, ROOTS, PROJECT_DIR, env), 'ask');
  assert.equal(classifyBashCommand(`rm -rf $HOME${tail}`, ROOTS, PROJECT_DIR, env), 'ask');
  assert.equal(classifyBashCommand(`rm -rf "${HOME_BRACED}${tail}"`, ROOTS, PROJECT_DIR, env), 'ask');
});

test('classifyBashCommand tolerates an absent or degenerate plugin data root', () => {
  assert.equal(classifyBashCommand('npm test', ROOTS, PROJECT_DIR, {}), null);
  assert.equal(classifyBashCommand('npm test', ROOTS, PROJECT_DIR, { CLAUDE_PLUGIN_DATA: '' }), null);
  assert.equal(classifyBashCommand('npm test', ROOTS, PROJECT_DIR, { CLAUDE_PLUGIN_DATA: 7 }), null);
  assert.equal(classifyBashCommand('npm test', ROOTS, PROJECT_DIR, null), null);
  assert.equal(classifyBashCommand('ls /etc', ROOTS, PROJECT_DIR, { CLAUDE_PLUGIN_DATA: sep }), null);
  assert.equal(classifyBashCommand('ls /etc', ROOTS, PROJECT_DIR, { CLAUDE_PLUGIN_DATA: 'data' }), null);
});

const ROOT_SPELLINGS = [sep, sep.repeat(2), sep.repeat(3), `${sep}.`, `${sep}..`, `${sep}.${sep}`];

test('classifyBashCommand stays silent for every spelling of the filesystem root', () => {
  for (const spelling of ROOT_SPELLINGS) {
    const env = { CLAUDE_PLUGIN_DATA: spelling };
    assert.equal(classifyBashCommand('ls /etc', ROOTS, PROJECT_DIR, env), null, spelling);
    assert.equal(classifyBashCommand('cat /tmp/x', ROOTS, PROJECT_DIR, env), null, spelling);
  }
});

test('classifyBashCommand stays silent on a filesystem-root plugin data root at any size', () => {
  const large = padTo(OUTSIDE_READ, LARGE_BYTES);
  for (const spelling of ROOT_SPELLINGS) {
    const env = { CLAUDE_PLUGIN_DATA: spelling };
    assert.equal(classifyBashCommand(large, ROOTS, PROJECT_DIR, env), null, spelling);
  }
});

test('classifyBashCommand ignores a data root that canonicalizes to the filesystem root', async (t) => {
  const base = await tempDir('hooks-rootlink-');
  cleanup(t, base);
  const link = join(base, 'link');
  await symlink(sep, link, 'dir');
  const env = { CLAUDE_PLUGIN_DATA: link };
  assert.equal(classifyBashCommand('ls /etc', ROOTS, PROJECT_DIR, env), null);
  assert.equal(classifyBashCommand(padTo(OUTSIDE_READ, LARGE_BYTES), ROOTS, PROJECT_DIR, env), null);
  assert.equal(classifyBashCommand(`rm -rf ${link}`, ROOTS, PROJECT_DIR, env), 'ask');
});

test('handlePreToolUse asks about removing the literal plugin data root', async (t) => {
  const projectDir = await tempDir('hooks-dataroot-proj-');
  const dataRoot = await tempDir('hooks-dataroot-data-');
  cleanup(t, projectDir, dataRoot);
  const result = await handlePreToolUse({
    input: { tool_name: 'Bash', tool_input: { command: `rm -rf ${dataRoot}` } },
    env: { CLAUDE_PLUGIN_DATA: dataRoot },
    projectDir,
  });
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(result.json.hookSpecificOutput.permissionDecisionReason.includes(dataRoot), true);
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

test('classifyBashCommand keeps the read-only noise corpus silent with the data root set', () => {
  const dataRoot = join(homedir(), '.claude', 'plugins', 'data', 'logbook');
  const env = { CLAUDE_PLUGIN_DATA: dataRoot };
  const roots = [...GIT_ROOTS, ...HOME_ROOTS, join(dataRoot, projectKey(PROJECT_DIR))];
  const quiet = [
    'npm test',
    'ls -la',
    'git status --short',
    'git log --oneline -5',
    'cat .git/config',
    'git commit -m "wire the parser"',
    'git push origin refs/heads/main',
    'rm -rf node_modules && npm ci',
    `echo $HOME${sep}notes.md`,
    `cat ~${sep}.claude${sep}settings.json`,
    `ls ~${sep}.claude${sep}plugins`,
    'rm -rf /tmp/scratch',
    'node --test test/unit',
  ];
  for (const command of quiet) {
    assert.equal(classifyBashCommand(command, roots, PROJECT_DIR, env), null, command);
  }
});

test('classifyBashCommand stays silent on a large command that names nothing ledger', () => {
  const large = padTo(OUTSIDE_READ, LARGE_BYTES);
  assert.equal(Buffer.byteLength(large, 'utf8'), LARGE_BYTES);
  assert.equal(classifyBashCommand(large, ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand stays silent on a large read-only git command naming the ledger ref', () => {
  const large = padTo('git show _ledger:threads/a.md ', LARGE_BYTES);
  assert.equal(Buffer.byteLength(large, 'utf8'), LARGE_BYTES);
  assert.equal(classifyBashCommand(large, ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand asks about a large write that names the ledger ref', () => {
  const large = padTo('git push origin :_ledger ', LARGE_BYTES);
  assert.equal(Buffer.byteLength(large, 'utf8'), LARGE_BYTES);
  assert.equal(classifyBashCommand(large, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about a large command that names any ledger spelling', () => {
  assert.equal(classifyBashCommand(padTo(`cat ~${HOME_TAIL}/f `, LARGE_BYTES), HOME_ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(padTo('git update-ref -d refs/heads/_ledger ', LARGE_BYTES), ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(padTo(ROOT_READ, LARGE_BYTES), ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand judges a multibyte command by its triggers, never its byte length', () => {
  const wide = 'é'.repeat(9000);
  const quiet = `${OUTSIDE_READ}${wide}`;
  const named = `${ROOT_READ}${wide}`;
  assert.equal(Buffer.byteLength(quiet, 'utf8') > quiet.length, true);
  assert.equal(classifyBashCommand(quiet, ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand(named, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyPreToolUse names the trigger on a large command instead of reporting a size', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: padTo('git branch -D _ledger ', LARGE_BYTES) } },
    ROOTS,
    PROJECT_DIR,
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'ask');
  const reason = d.hookSpecificOutput.permissionDecisionReason;
  assert.equal(reason.includes('"_ledger"'), true);
  assert.equal(reason.includes('larger than the Logbook guard reads'), false);
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
    input: { tool_name: 'mcp__plugin_logbook_ledger__open_thread' },
    env: {},
    projectDir: '/proj',
  };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'allow');
});

test('handlePreToolUse auto-approves every tool this server actually registers', async () => {
  for (const tool of TOOLS) {
    for (const prefix of ['mcp__ledger__', 'mcp__plugin_logbook_ledger__']) {
      const ctx = { input: { tool_name: `${prefix}${tool.name}` }, env: {}, projectDir: PROJECT_DIR };
      const result = await handlePreToolUse(ctx);
      assert.equal(
        result.json.hookSpecificOutput.permissionDecision,
        'allow',
        `${prefix}${tool.name}`,
      );
    }
  }
});

test('handlePreToolUse does not auto-approve a foreign tool on a ledger-named server', async () => {
  const foreign = [
    'mcp__ledger__drop_database',
    'mcp__ledger__exec',
    'mcp__plugin_logbook_ledger__exec',
    'mcp__ledger__',
    'mcp__ledger__open_thread_extra',
  ];
  for (const toolName of foreign) {
    const ctx = { input: { tool_name: toolName }, env: {}, projectDir: PROJECT_DIR };
    assert.deepEqual(await handlePreToolUse(ctx), {}, toolName);
  }
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

test('classifyBashCommand stays silent for read-only git commands that name the ledger ref', () => {
  assert.equal(
    classifyBashCommand('git show _ledger:decisions/0074-stage-new-tests.md', ROOTS, PROJECT_DIR),
    null,
  );
  assert.equal(
    classifyBashCommand('git log --oneline _ledger -- decisions/ | grep -oE "007[0-9]" | sort -u', ROOTS, PROJECT_DIR),
    null,
  );
  assert.equal(
    classifyBashCommand('git show _ledger --stat 2>/dev/null | head -1', ROOTS, PROJECT_DIR),
    null,
  );
  assert.equal(
    classifyBashCommand('git ls-tree -r _ledger --name-only -- decisions/ | sort', ROOTS, PROJECT_DIR),
    null,
  );
  assert.equal(classifyBashCommand('git -C /repo show _ledger:threads/a.md', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git rev-parse _ledger', ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand still asks about writes that name the ledger ref', () => {
  assert.equal(classifyBashCommand('git push origin :_ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git branch -D _ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git update-ref -d refs/heads/_ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git checkout _ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git worktree add /tmp/w _ledger', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks when any segment of a ledger read is not a read', () => {
  assert.equal(
    classifyBashCommand('git show _ledger:a && git push origin :_ledger', ROOTS, PROJECT_DIR),
    'ask',
  );
  assert.equal(
    classifyBashCommand('git show _ledger:a | tee /tmp/x; git branch -D _ledger', ROOTS, PROJECT_DIR),
    'ask',
  );
});

test('classifyBashCommand asks when a git read also names the ledger store path', () => {
  assert.equal(
    classifyBashCommand('git show _ledger:a > /data/-proj/ledger/leak', ROOTS, PROJECT_DIR),
    'ask',
  );
  assert.equal(classifyBashCommand('git show refs/ledger/notes', ROOTS, PROJECT_DIR), null);
});

const GIT_READ_BYPASSES = Object.freeze({
  envAssignment: 'GIT_PAGER=/tmp/evil.sh git log _ledger -1',
  externalDiffEnv: 'GIT_EXTERNAL_DIFF=/tmp/evil.sh git log _ledger --ext-diff -p -1',
  outputOption: 'git diff _ledger main --output=.git/hooks/post-checkout',
  outputBlame: 'git blame --output=/tmp/important _ledger',
  configPager: 'git -c core.pager=/tmp/evil.sh -p log _ledger -1',
  configEnvDiff: 'git --config-env=diff.external=EV diff _ledger',
  configEnvFsmonitor: 'git --config-env=core.fsmonitor=EV status --short _ledger',
  optionAbbreviation: 'git grep --op=/tmp/evil.sh _ledger',
  longerAbbreviation: 'git grep --open=/tmp/evil.sh _ledger',
  backgroundSegment: 'git log -1 --oneline _ledger & git tag ledger_proof _ledger',
  backgroundRefKill: 'git log _ledger & git update-ref -d refs/heads/_ledger',
  refRedirect: 'git rev-parse main > .git/refs/heads/_ledger',
  commandSubstitution: 'git log -1 _ledger `git branch -D _ledger`',
  dollarSubstitution: 'git log -1 --format=$(git push origin _ledger) _ledger',
});

test('classifyBashCommand asks about a ledger read carrying a leading environment assignment', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.envAssignment, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('LC_ALL=C git log _ledger -1', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about a ledger read that writes a file through an output option', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.outputOption, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.outputBlame, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about a ledger read that injects git config before the subcommand', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.configPager, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about config injection through the --config-env spelling', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.configEnvDiff, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.configEnvFsmonitor, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git --config-env diff.external=EV diff _ledger', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks about an abbreviated spelling of a rejected option', () => {
  const rejected = [
    'git grep --op=/tmp/evil.sh _ledger',
    'git grep --open=/tmp/evil.sh _ledger',
    'git grep --open-files-in-pager=/tmp/evil.sh _ledger',
    'git diff _ledger main --outp=/tmp/x',
    'git diff _ledger main --output=/tmp/x',
    'git log _ledger --textc -p',
    'git log _ledger --ext -p',
  ];
  for (const command of rejected) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR), 'ask', command);
  }
});

test('classifyBashCommand stays silent for read-only options that merely extend a rejected name', () => {
  const quiet = [
    'git diff _ledger main --output-indicator-new=x',
    'git diff _ledger main --output-indicator-old=Z',
    'git diff _ledger main --output-indicator-frag=F',
  ];
  for (const command of quiet) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR), null, command);
  }
});

test('classifyBashCommand asks when a background segment follows a ledger read', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.backgroundSegment, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.backgroundRefKill, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks when a ledger read carries a command substitution', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.commandSubstitution, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.dollarSubstitution, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git log -1 _ledger --format=${IFS}', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand asks when a ledger read redirects into a real file', () => {
  assert.equal(classifyBashCommand(GIT_READ_BYPASSES.refRedirect, ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git log -1 _ledger > /tmp/anything', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git log -1 _ledger >> /tmp/anything', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git rev-parse main >.git/refs/heads/_ledger', ROOTS, PROJECT_DIR), 'ask');
});

test('classifyBashCommand keeps a discarded or duplicated stream a silent ledger read', () => {
  assert.equal(classifyBashCommand('git show _ledger --stat 2>/dev/null | head -1', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git log _ledger >/dev/null', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git log _ledger > /dev/null', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git log _ledger 2>&1 | head -1', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git show _ledger 2>/dev/null >/dev/null', ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand asks about every spelling of a write-capable pre-subcommand option', () => {
  const rejected = [
    'git -c core.pager=/tmp/evil.sh log _ledger',
    'git --git-dir=/x log _ledger',
    'git --git-dir /x log _ledger',
    'git --work-tree=/x status _ledger',
    'git --work-tree /x status _ledger',
    'git --namespace=x show-ref _ledger',
    'git --namespace x show-ref _ledger',
    'git --exec-path=/tmp/evil log _ledger',
    'git --exec-path /tmp/evil log _ledger',
  ];
  for (const command of rejected) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR), 'ask', command);
  }
});

test('classifyBashCommand asks about every spelling of a write-capable or executing option', () => {
  const rejected = [
    'git diff _ledger main --output=/tmp/x',
    'git diff _ledger main --output /tmp/x',
    'git blame --output=/tmp/x _ledger',
    'git blame --output /tmp/x _ledger',
    'git log _ledger --ext-diff -p',
    'git log _ledger --textconv -p',
    'git diff _ledger main -O/tmp/orderfile',
    'git diff _ledger main -O /tmp/orderfile',
    'git grep --open-files-in-pager pattern _ledger',
  ];
  for (const command of rejected) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR), 'ask', command);
  }
});

test('classifyBashCommand keeps a post-subcommand -c a legitimate read flag', () => {
  assert.equal(classifyBashCommand('git log -c _ledger -1', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git show -c _ledger', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git diff -c _ledger main', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('git -C /repo log -c _ledger -1', ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand stays silent for the verified read-only git verbs naming the ledger ref', () => {
  const quiet = [
    'git merge-base _ledger main',
    'git name-rev _ledger',
    'git show-branch _ledger',
    'git verify-commit _ledger',
    'git cherry main _ledger',
    'git grep pattern _ledger',
    'git patch-id _ledger',
    'git check-ignore --no-index _ledger',
    'git count-objects -v _ledger',
    'git column _ledger',
  ];
  for (const command of quiet) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR), null, command);
  }
});

test('classifyBashCommand stays silent on every ledger read bypass when the guard is disabled', () => {
  const env = { LEDGER_DISABLE_BASH_GUARD: 'true' };
  for (const [name, command] of Object.entries(GIT_READ_BYPASSES)) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR, env), null, name);
  }
});

test('classifyBashCommand asks about every ledger read bypass while the guard is enabled', () => {
  for (const [name, command] of Object.entries(GIT_READ_BYPASSES)) {
    assert.equal(classifyBashCommand(command, ROOTS, PROJECT_DIR, {}), 'ask', name);
  }
});

test('classifyBashCommand ignores identifiers that merely contain a bare trigger', () => {
  assert.equal(classifyBashCommand('cat docs/my_ledger.md', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('cat docs/_ledgering.md', ROOTS, PROJECT_DIR), null);
  assert.equal(classifyBashCommand('rm -rf build/CLAUDE_PLUGIN_DATA_CACHE', ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand keeps matching every real spelling of a bare trigger', () => {
  assert.equal(classifyBashCommand('rm -rf "$CLAUDE_PLUGIN_DATA"', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git push origin :_ledger', ROOTS, PROJECT_DIR), 'ask');
  assert.equal(classifyBashCommand('git update-ref -d refs/heads/_ledger', ROOTS, PROJECT_DIR), 'ask');
});

const DISABLE_KEYS = ['LEDGER_DISABLE_BASH_GUARD', 'CLAUDE_PLUGIN_OPTION_DISABLE_BASH_GUARD'];
const LEDGER_WRITE = 'git push origin :_ledger';

test('classifyBashCommand stays silent on ledger writes when either disable key is exactly true', () => {
  for (const key of DISABLE_KEYS) {
    const env = { [key]: 'true' };
    assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR, env), null, key);
    assert.equal(classifyBashCommand('rm -rf /data/-proj/ledger', ROOTS, PROJECT_DIR, env), null, key);
    assert.equal(classifyBashCommand(padTo(LEDGER_WRITE, LARGE_BYTES), ROOTS, PROJECT_DIR, env), null, key);
  }
});

test('classifyBashCommand stops asking about an unreadable command when the guard is disabled', () => {
  for (const key of DISABLE_KEYS) {
    assert.equal(classifyBashCommand(undefined, ROOTS, PROJECT_DIR, { [key]: 'true' }), null, key);
    assert.equal(classifyBashCommand(7, ROOTS, PROJECT_DIR, { [key]: 'true' }), null, key);
  }
});

test('classifyBashCommand ignores a disable flag reached only through the prototype chain', () => {
  for (const key of DISABLE_KEYS) {
    const inherited = Object.create({ [key]: 'true' });
    assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR, inherited), 'ask', key);
  }
});

test('classifyBashCommand reads the disable flag from process.env when no env is passed', (t) => {
  useEnv(t, { LEDGER_DISABLE_BASH_GUARD: 'true' });
  assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR), null);
});

test('classifyBashCommand reads the plugin-option key from process.env when no env is passed', (t) => {
  useEnv(t, { CLAUDE_PLUGIN_OPTION_DISABLE_BASH_GUARD: 'true' });
  assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR), null);
});

const NOT_DISABLED = [
  '',
  'false',
  'TRUE',
  'True',
  'off',
  '1',
  'yes',
  ' true',
  'true ',
  '${user_config.disable_bash_guard}',
  true,
  1,
  null,
  undefined,
];

test('classifyBashCommand keeps the guard enabled for every resolution that is not exactly true', () => {
  for (const key of DISABLE_KEYS) {
    for (const value of NOT_DISABLED) {
      const label = `${key}=${String(value)}`;
      assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR, { [key]: value }), 'ask', label);
    }
    assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR, {}), 'ask', `${key} absent`);
  }
  assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR, null), 'ask');
  assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR, 'true'), 'ask');
});

test('classifyBashCommand keeps the guard enabled when the flag is absent from process.env', (t) => {
  useEnv(t, {
    LEDGER_DISABLE_BASH_GUARD: undefined,
    CLAUDE_PLUGIN_OPTION_DISABLE_BASH_GUARD: undefined,
  });
  assert.equal(classifyBashCommand(LEDGER_WRITE, ROOTS, PROJECT_DIR), 'ask');
});

test('classifyPreToolUse still denies a ledger-root write when the Bash guard is disabled', () => {
  for (const key of DISABLE_KEYS) {
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      const d = classifyPreToolUse(
        { tool_name: tool, tool_input: { file_path: '/data/-proj/ledger/threads/a.json' } },
        ROOTS,
        PROJECT_DIR,
        PROJECT_DIR,
        { [key]: 'true' },
      );
      assert.equal(d.hookSpecificOutput.permissionDecision, 'deny', `${key} ${tool}`);
    }
  }
});

test('handlePreToolUse still auto-approves a ledger MCP tool when the Bash guard is disabled', async () => {
  for (const key of DISABLE_KEYS) {
    const result = await handlePreToolUse({
      input: { tool_name: 'mcp__plugin_logbook_ledger__update_thread' },
      env: { [key]: 'true' },
      projectDir: PROJECT_DIR,
    });
    assert.equal(result.json.hookSpecificOutput.permissionDecision, 'allow', key);
  }
});

test('handlePreToolUse leaves a ledger-naming Bash command alone when the guard is disabled', async (t) => {
  const projectDir = await tempDir('hooks-disabled-proj-');
  const dataRoot = await tempDir('hooks-disabled-data-');
  cleanup(t, projectDir, dataRoot);
  const root = join(dataRoot, projectKey(projectDir));
  for (const key of DISABLE_KEYS) {
    const result = await handlePreToolUse({
      input: { tool_name: 'Bash', tool_input: { command: `rm -rf ${root}` } },
      env: { CLAUDE_PLUGIN_DATA: dataRoot, [key]: 'true' },
      projectDir,
    });
    assert.deepEqual(result, {}, key);
  }
});

test('handlePreToolUse still denies a ledger-root Write when the Bash guard is disabled', async (t) => {
  const projectDir = await tempDir('hooks-disabled-write-proj-');
  const dataRoot = await tempDir('hooks-disabled-write-data-');
  cleanup(t, projectDir, dataRoot);
  const target = join(dataRoot, projectKey(projectDir), 'ledger', 'threads', 'a.json');
  const result = await handlePreToolUse({
    input: { tool_name: 'Write', tool_input: { file_path: target } },
    env: { CLAUDE_PLUGIN_DATA: dataRoot, LEDGER_DISABLE_BASH_GUARD: 'true' },
    projectDir,
  });
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny');
});
