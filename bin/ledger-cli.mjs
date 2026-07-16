#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { buildContext, callTool, commitAndReindex } from '../src/tools/index.mjs';
import { rebuildIndex } from '../src/index/rebuild-index.mjs';
import { readActiveThread } from '../src/util/active-thread.mjs';
import { gitExec } from '../src/util/git-exec.mjs';
import { atomicWrite } from '../src/util/atomic-write.mjs';
import { LocalDriver } from '../src/drivers/local-driver.mjs';
import { DEFAULT_LEDGER_BRANCH } from '../src/drivers/git-ledger.mjs';

const USAGE =
  'usage: ledger-cli <roster | reconcile | active-thread | record-sha <sha> | sync | restore <target> [--ref <ref>] [--force]>';

const SHA_PATTERN = /^[0-9a-fA-F]{4,64}$/;

const BLOB_FILE_MODES = new Set(['100644', '100755']);

async function runRoster() {
  const ctx = await buildContext({});
  await rebuildIndex(ctx.driver);
  return ctx.driver.readIndexFile('resumable');
}

async function runActiveThread() {
  const ctx = await buildContext({});
  return { thread_id: await readActiveThread(ctx) };
}

async function runReconcile() {
  const ctx = await buildContext({});
  return callTool('reconcile', {}, ctx);
}

async function runSync() {
  const ctx = await buildContext({});
  return ctx.driver.sync();
}

async function runRecordSha(rest) {
  const sha = rest[0];
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) {
    throw new Error(`record-sha: <sha> must be a git object name, received ${sha ?? '(none)'}`);
  }
  const ctx = await buildContext({});
  const threadId = await readActiveThread(ctx);
  if (!threadId) {
    return {};
  }
  const bindings = await ctx.driver.listBindings();
  const targets = bindings.filter(
    (binding) => binding.thread_id === threadId
      && binding.status === 'active'
      && binding.first_commit == null,
  );
  if (targets.length === 0) {
    return {};
  }
  for (const binding of targets) {
    await ctx.driver.writeBinding({ ...binding, first_commit: sha });
  }
  await commitAndReindex(ctx.driver, 'chore(ledger): record first-commit sha');
  return {};
}

function parseRestoreArgs(rest) {
  let target = null;
  let ref = `refs/heads/${DEFAULT_LEDGER_BRANCH}`;
  let force = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--force') {
      force = true;
    } else if (arg === '--ref') {
      ref = rest[i + 1];
      i += 1;
      if (typeof ref !== 'string' || ref.length === 0) {
        throw new Error('restore: --ref requires a value');
      }
    } else if (target === null) {
      target = arg;
    } else {
      throw new Error(`restore: unexpected argument ${arg}`);
    }
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error('restore: <target> is required');
  }
  return { target: resolve(process.cwd(), target), ref, force };
}

async function isNonEmptyDir(dir) {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function parseTreeEntries(stdout) {
  const entries = [];
  for (const record of stdout.split('\0')) {
    if (record.length === 0) {
      continue;
    }
    const tab = record.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const mode = record.slice(0, tab).split(' ')[0];
    const path = record.slice(tab + 1);
    entries.push({ mode, path });
  }
  return entries;
}

function resolveWithinTarget(target, entryPath) {
  if (isAbsolute(entryPath)) {
    throw new Error(`restore: refusing absolute path in ledger tree: ${entryPath}`);
  }
  if (entryPath.split('/').some((segment) => segment === '..')) {
    throw new Error(`restore: refusing parent-directory segment in ledger tree: ${entryPath}`);
  }
  const dest = resolve(target, entryPath);
  if (dest !== target && !dest.startsWith(target + sep)) {
    throw new Error(`restore: ledger tree entry escapes target: ${entryPath}`);
  }
  return dest;
}

async function runRestore(rest) {
  const { target, ref, force } = parseRestoreArgs(rest);
  if (!force && (await isNonEmptyDir(target))) {
    throw new Error(`restore: target ${target} is not empty (pass --force to overwrite)`);
  }
  const repoDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const verify = await gitExec(
    repoDir,
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    { check: false },
  );
  if (verify.code !== 0) {
    throw new Error(`restore: ledger ref ${ref} not found in ${repoDir}`);
  }
  const listing = await gitExec(repoDir, ['ls-tree', '-r', '-z', '--end-of-options', ref]);
  const entries = parseTreeEntries(listing.stdout);
  await mkdir(target, { recursive: true });
  let restored = 0;
  for (const entry of entries) {
    if (!BLOB_FILE_MODES.has(entry.mode)) {
      continue;
    }
    const dest = resolveWithinTarget(target, entry.path);
    const show = await gitExec(repoDir, ['show', '--end-of-options', `${ref}:${entry.path}`]);
    await atomicWrite(dest, show.stdout);
    restored += 1;
  }
  const counts = await rebuildIndex(new LocalDriver(target));
  return { target, ref, restored, counts };
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'restore':
      return runRestore(rest);
    case 'roster':
      return runRoster();
    case 'reconcile':
      return runReconcile();
    case 'active-thread':
      return runActiveThread();
    case 'record-sha':
      return runRecordSha(rest);
    case 'sync':
      return runSync();
    default:
      throw new Error(`${USAGE}\nunknown command: ${command ?? '(none)'}`);
  }
}

async function main() {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
