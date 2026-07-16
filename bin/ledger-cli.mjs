#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildContext, callTool, commitAndReindex } from '../src/tools/index.mjs';
import { rebuildIndex } from '../src/index/rebuild-index.mjs';
import { readActiveThread } from '../src/util/active-thread.mjs';

const USAGE =
  'usage: ledger-cli <roster | reconcile | active-thread | record-sha <sha> | sync | restore <target> [--ref <ref>] [--force]>';

const SHA_PATTERN = /^[0-9a-fA-F]{4,64}$/;

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

export async function runCli(argv) {
  const [command, ...rest] = argv;
  switch (command) {
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
