#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildContext, callTool } from '../src/tools/index.mjs';
import { rebuildIndex } from '../src/index/rebuild-index.mjs';
import { readActiveThread } from '../src/util/active-thread.mjs';

const USAGE =
  'usage: ledger-cli <roster | reconcile | active-thread | record-sha <sha> | sync | restore <target> [--ref <ref>] [--force]>';

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

export async function runCli(argv) {
  const [command] = argv;
  switch (command) {
    case 'roster':
      return runRoster();
    case 'reconcile':
      return runReconcile();
    case 'active-thread':
      return runActiveThread();
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
