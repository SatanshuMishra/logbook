import fs from 'node:fs';
import path from 'node:path';
import { appendEvent, prune, runId, writeCatalogue, writeSummary } from './metrics-writer.ts';

const PREFIX = 'metrics not written: ';

type Call = { fn: string; args: Record<string, unknown>; now: string };
type Case = { name: string; environ: Record<string, string>; calls: Call[] };

function moment(text: string): Date {
  return new Date(text);
}

function substituted(value: unknown, root: string, home: string): unknown {
  return value === '<root>' ? root : value === '<home>' ? home : value;
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function relative(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function reported(result: unknown, root: string): unknown {
  if (Array.isArray(result)) {
    return result.map((file: string) => relative(file, root));
  }
  if (typeof result === 'string' && result.startsWith(PREFIX)) {
    const rest = result.slice(PREFIX.length);
    return PREFIX + rest.slice(0, rest.indexOf(': ') + 2);
  }
  return result ?? null;
}

function callResult(call: Call, environ: Record<string, string>, root: string, home: string): unknown {
  const args: Record<string, any> = Object.fromEntries(
    Object.entries(call.args).map(([name, value]) => [camel(name), substituted(value, root, home)]),
  );
  if (call.fn === 'append_event') {
    return appendEvent({ ...args, environ, now: moment(call.now) } as any);
  }
  if (call.fn === 'write_summary') {
    return writeSummary({ ...args, environ, now: moment(call.now) } as any);
  }
  if (call.fn === 'write_catalogue') {
    return writeCatalogue({ ...args, environ } as any);
  }
  if (call.fn === 'prune') {
    return prune(args.root, args.plugin, args.repo, args.keepEvents, args.keepSummaries);
  }
  return runId(args.name, moment(args.start));
}

function writtenFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    (fs.readdirSync(root, { recursive: true }) as string[])
      .map((name) => path.join(root, name))
      .filter((file) => !fs.statSync(file).isDirectory())
      .map((file) => [relative(file, root), fs.readFileSync(file).toString('utf8')]),
  );
}

function runCase(conformanceCase: Case, folder: string): { files: Record<string, string>; returns: unknown[] } {
  const root = path.join(folder, 'root');
  const home = path.join(folder, 'home');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const environ = Object.fromEntries(
    Object.entries(conformanceCase.environ).map(([name, value]) => [name, substituted(value, root, home) as string]),
  );
  const returns = conformanceCase.calls.map((call) => reported(callResult(call, environ, root, home), root));
  return { files: writtenFiles(root), returns };
}

const [casesFile, outputFolder] = process.argv.slice(2);
if (casesFile === undefined || outputFolder === undefined) {
  process.stderr.write('usage: node metrics/conform.ts CASES_FILE OUTPUT_FOLDER\n');
  process.exit(2);
}
const cases: Case[] = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const outcome = Object.fromEntries(
  cases.map((conformanceCase) => [conformanceCase.name, runCase(conformanceCase, path.join(outputFolder, conformanceCase.name))]),
);
process.stdout.write(JSON.stringify(outcome) + '\n');
