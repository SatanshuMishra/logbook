#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildContext } from '../src/tools/index.mjs';
import { readActiveThread } from '../src/util/active-thread.mjs';

const USAGE =
  'usage: ledger-cli <roster | reconcile | active-thread | record-sha <sha> | sync | restore <target> [--ref <ref>] [--force]>';

async function runActiveThread() {
  const ctx = await buildContext({});
  return { thread_id: await readActiveThread(ctx) };
}

export async function runCli(argv) {
  const [command] = argv;
  switch (command) {
    case 'active-thread':
      return runActiveThread();
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
