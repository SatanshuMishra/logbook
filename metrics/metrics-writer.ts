import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FORMAT_VERSION = 1;
export const ROOT_VARIABLE = 'PLUGIN_METRICS_DIR';
export const PARENT_VARIABLE = 'PLUGIN_METRICS_PARENT';
export const SESSION_VARIABLE = 'CLAUDE_CODE_SESSION_ID';
export const DEFAULT_FOLDER = '.plugin-metrics';
export const ENVELOPE = Object.freeze(['v', 'ts', 'plugin', 'plugin_version', 'kind', 'event', 'run', 'parent', 'session', 'repo'] as const);
export const KINDS = Object.freeze(['event', 'summary'] as const);
export const SUMMARY_EVENT = 'run.summary';
export const TOKEN_KINDS = Object.freeze(['input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output'] as const);
export const KEEP_EVENT_RUNS = 100;
export const KEEP_SUMMARY_RUNS = 1000;
export const WARNING_PREFIX = 'metrics not written: ';
export const PLUGIN_PREFIX = 'plugin=';
export const KIND_PREFIX = 'kind=';
export const REPO_PREFIX = 'repo=';

const EVENT_SUFFIX = '.jsonl';
const SUMMARY_SUFFIX = '.json';
const CATALOGUE_FILE = 'catalogue.json';
const TEMPORARY_PREFIX = '.';
const TEMPORARY_SUFFIX = '.tmp';
const FILE_MODE = 0o600;
const FOLDER_MODE = 0o700;
const NAME_LIMIT = 120;
const EARLIEST_START = '';
const RUN_PATTERN = /^[a-z0-9][a-z0-9.-]*(\.[0-9]{8}T[0-9]{6}Z)?$/;
const PLUGIN_PATTERN = /^[a-z][a-z0-9-]*$/;
const FIELD_PATTERN = /^[a-z][a-z0-9_]*$/;
const INTEGER_KEY_PATTERN = /^-?(0|[1-9][0-9]*)$/;
const FORBIDDEN_REPO_CHARACTER = /[/=\x00-\x1f]/;
const SYSTEM_REASON = /^E[A-Z0-9]+: ([^,]*)/;
const REASON_BY_CODE: Readonly<Record<string, string>> = Object.freeze({ EEXIST: 'File exists', EISDIR: 'Is a directory' });

export type Environ = Readonly<Record<string, string | undefined>>;
export type Fields = Readonly<Record<string, unknown>>;

export type SummaryRequest = {
  plugin: string;
  pluginVersion: string | null;
  repo: string;
  run: string;
  fields: Fields;
  environ?: Environ;
  now?: Date;
};

export type EventRequest = SummaryRequest & { event: string };

export type CatalogueRequest = {
  plugin: string;
  catalogue: unknown;
  environ?: Environ;
};

type SystemError = Error & { code?: string; path?: string };

function environment(environ: Environ | undefined): Environ {
  return environ === undefined || environ === null ? process.env : environ;
}

function variable(environ: Environ, name: string): string {
  return Object.hasOwn(environ, name) ? environ[name] ?? '' : '';
}

function home(environ: Environ): string {
  return variable(environ, 'HOME') || os.homedir() || os.userInfo().homedir;
}

function joined(...parts: string[]): string {
  return parts.reduce((left, right) =>
    right.startsWith(path.sep) || left === '' ? right : left.endsWith(path.sep) ? left + right : left + path.sep + right,
  );
}

function containingFolder(file: string): string {
  return path.dirname(path.resolve(file));
}

export function storeRoot(environ: Environ): string {
  const chosen = variable(environ, ROOT_VARIABLE);
  return chosen ? chosen : joined(home(environ), DEFAULT_FOLDER);
}

function timestamp(now: Date | undefined): string {
  return (now ?? new Date()).toISOString().slice(0, 19) + 'Z';
}

export function runId(name: string, start: Date): string {
  return name + '.' + timestamp(start).replace(/[-:]/g, '');
}

function kindFolder(root: string, plugin: string, kind: string, repo: string): string {
  return joined(root, PLUGIN_PREFIX + plugin, KIND_PREFIX + kind, REPO_PREFIX + repo);
}

export function eventPath(root: string, plugin: string, repo: string, run: string): string {
  return joined(kindFolder(root, plugin, 'event', repo), run + EVENT_SUFFIX);
}

export function summaryPath(root: string, plugin: string, repo: string, run: string): string {
  return joined(kindFolder(root, plugin, 'summary', repo), run + SUMMARY_SUFFIX);
}

export function cataloguePath(root: string, plugin: string): string {
  return joined(root, PLUGIN_PREFIX + plugin, CATALOGUE_FILE);
}

function isMapping(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function typeName(value: unknown): string {
  return value !== null && typeof value === 'object' ? value.constructor?.name ?? 'object' : typeof value;
}

function valueText(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(valueText).join(',') + ']';
  }
  if (isMapping(value)) {
    return '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ':' + valueText(item)).join(',') + '}';
  }
  throw new TypeError('a value of type ' + typeName(value) + ' has no JSON form');
}

export function encodedLine(record: unknown): Buffer {
  return Buffer.from(valueText(record) + '\n', 'utf8');
}

function refused(subject: string, rule: string): string {
  return WARNING_PREFIX + subject + ': ' + rule;
}

function runRefusal(run: unknown): string | null {
  if (typeof run !== 'string' || run === '') {
    return refused('run', 'must not be empty');
  }
  if (run.length > NAME_LIMIT) {
    return refused('run', 'must be at most 120 characters');
  }
  if (!RUN_PATTERN.test(run)) {
    return refused('run', 'must be lowercase letters, digits, dots and hyphens starting with a letter or digit, optionally ending in a .YYYYMMDDTHHMMSSZ start');
  }
  return null;
}

function pluginRefusal(plugin: unknown): string | null {
  if (typeof plugin !== 'string' || !PLUGIN_PATTERN.test(plugin)) {
    return refused('plugin', 'must be lowercase letters, digits and hyphens starting with a letter');
  }
  return null;
}

function repoRefusal(repo: unknown): string | null {
  if (typeof repo !== 'string' || repo === '') {
    return refused('repo', 'must not be empty');
  }
  if (repo.length > NAME_LIMIT) {
    return refused('repo', 'must be at most 120 characters');
  }
  if (repo.startsWith('.')) {
    return refused('repo', 'must not start with a dot');
  }
  if (FORBIDDEN_REPO_CHARACTER.test(repo)) {
    return refused('repo', 'must not hold a slash, an equals sign or a control character');
  }
  return null;
}

function fieldRefusal(name: string): string | null {
  if (!FIELD_PATTERN.test(name)) {
    return refused('field ' + name, 'must be lowercase letters, digits and underscores starting with a letter');
  }
  if ((ENVELOPE as readonly string[]).includes(name)) {
    return refused('field ' + name, 'must not be an envelope key');
  }
  return null;
}

function firstRefusal(refusals: Iterable<string | null>): string | null {
  for (const refusal of refusals) {
    if (refusal !== null) {
      return refusal;
    }
  }
  return null;
}

function keyRefusal(value: unknown): string | null {
  if (isMapping(value)) {
    const integerKey = Object.keys(value).find((key) => INTEGER_KEY_PATTERN.test(key));
    if (integerKey !== undefined) {
      return refused('key ' + integerKey, 'must not be an integer string');
    }
    return firstRefusal(Object.values(value).map(keyRefusal));
  }
  if (Array.isArray(value)) {
    return firstRefusal(value.map(keyRefusal));
  }
  return null;
}

function lineRefusal(plugin: string, repo: string, run: string, fields: Fields): string | null {
  return firstRefusal([
    runRefusal(run),
    pluginRefusal(plugin),
    repoRefusal(repo),
    firstRefusal(Object.keys(fields).map(fieldRefusal)),
    keyRefusal(fields),
  ]);
}

function record(request: SummaryRequest, kind: string, event: string, environ: Environ): Record<string, unknown> {
  const envelope = [
    FORMAT_VERSION,
    timestamp(request.now),
    request.plugin,
    request.pluginVersion,
    kind,
    event,
    request.run,
    variable(environ, PARENT_VARIABLE) || null,
    variable(environ, SESSION_VARIABLE) || null,
    request.repo,
  ];
  return Object.fromEntries([
    ...ENVELOPE.map((key, index) => [key, envelope[index]]),
    ...Object.entries(request.fields),
  ]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reason(error: unknown): string {
  const known = REASON_BY_CODE[errorCode(error) ?? ''];
  if (known !== undefined) {
    return known;
  }
  const described = SYSTEM_REASON.exec(message(error))?.[1];
  if (described === undefined || described === '') {
    return message(error);
  }
  return described.charAt(0).toUpperCase() + described.slice(1);
}

function failed(file: string, error: unknown): string {
  return WARNING_PREFIX + file + ': ' + reason(error);
}

function errorCode(error: unknown): string | undefined {
  return (error as SystemError | null)?.code;
}

function isFolder(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function ensureFolder(folder: string): void {
  if (isFolder(folder)) {
    return;
  }
  ensureFolder(path.dirname(folder));
  try {
    fs.mkdirSync(folder, FOLDER_MODE);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST' || !isFolder(folder)) {
      throw error;
    }
  }
}

function append(file: string, line: Buffer): void {
  ensureFolder(containingFolder(file));
  const descriptor = fs.openSync(file, 'a', FILE_MODE);
  try {
    const before = fs.fstatSync(descriptor).size;
    const written = fs.writeSync(descriptor, line);
    if (written !== line.length) {
      if (fs.fstatSync(descriptor).size === before + written) {
        fs.ftruncateSync(descriptor, before);
      }
      throw new Error('wrote ' + written + ' of ' + line.length + ' bytes');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function temporaryName(folder: string): string {
  return joined(folder, TEMPORARY_PREFIX + process.pid.toString(36) + Date.now().toString(36) + Math.random().toString(36).slice(2) + TEMPORARY_SUFFIX);
}

function replace(file: string, content: Buffer): void {
  const folder = containingFolder(file);
  ensureFolder(folder);
  const temporary = temporaryName(folder);
  const descriptor = fs.openSync(temporary, 'wx', FILE_MODE);
  try {
    try {
      fs.writeFileSync(descriptor, content);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

type Encoding = { line: Buffer; refusal: null } | { line: null; refusal: string };

function encodedOrRefusal(line: Record<string, unknown>): Encoding {
  try {
    return { line: encodedLine(line), refusal: null };
  } catch (error) {
    return { line: null, refusal: refused('fields', message(error)) };
  }
}

export function appendEvent(request: EventRequest): string | null {
  try {
    const refusal = lineRefusal(request.plugin, request.repo, request.run, request.fields);
    if (refusal !== null) {
      return refusal;
    }
    const chosen = environment(request.environ);
    const encoding = encodedOrRefusal(record(request, 'event', request.event, chosen));
    if (encoding.refusal !== null) {
      return encoding.refusal;
    }
    const file = eventPath(storeRoot(chosen), request.plugin, request.repo, request.run);
    try {
      append(file, encoding.line);
    } catch (error) {
      return failed(file, error);
    }
    return null;
  } catch (error) {
    return refused('fields', message(error));
  }
}

export function writeSummary(request: SummaryRequest): string | null {
  try {
    const refusal = lineRefusal(request.plugin, request.repo, request.run, request.fields);
    if (refusal !== null) {
      return refusal;
    }
    const chosen = environment(request.environ);
    const encoding = encodedOrRefusal(record(request, 'summary', SUMMARY_EVENT, chosen));
    if (encoding.refusal !== null) {
      return encoding.refusal;
    }
    const root = storeRoot(chosen);
    const file = summaryPath(root, request.plugin, request.repo, request.run);
    try {
      replace(file, encoding.line);
    } catch (error) {
      return failed(file, error);
    }
    const pruning = pruned(root, request.plugin, request.repo, KEEP_EVENT_RUNS, KEEP_SUMMARY_RUNS);
    if (pruning.failure !== null) {
      return failed((pruning.failure as SystemError).path || path.dirname(file), pruning.failure);
    }
    return null;
  } catch (error) {
    return refused('fields', message(error));
  }
}

function catalogueText(catalogue: unknown): Buffer {
  const text = JSON.stringify(catalogue, null, 2);
  if (text === undefined) {
    throw new TypeError('a value of type ' + typeName(catalogue) + ' has no JSON form');
  }
  return Buffer.from(text + '\n', 'utf8');
}

function currentContent(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function writeCatalogue(request: CatalogueRequest): string | null {
  try {
    const refusal = firstRefusal([pluginRefusal(request.plugin), keyRefusal(request.catalogue)]);
    if (refusal !== null) {
      return refusal;
    }
    const content = catalogueText(request.catalogue);
    const file = cataloguePath(storeRoot(environment(request.environ)), request.plugin);
    try {
      const current = currentContent(file);
      if (current === null || !current.equals(content)) {
        replace(file, content);
      }
    } catch (error) {
      return failed(file, error);
    }
    return null;
  } catch (error) {
    return refused('catalogue', message(error));
  }
}

function runNames(folder: string, suffix: string): ReadonlySet<string> {
  try {
    return new Set(
      fs.readdirSync(folder)
        .filter((name) => name.endsWith(suffix))
        .map((name) => name.slice(0, -suffix.length))
        .filter((run) => RUN_PATTERN.test(run) && run.length <= NAME_LIMIT),
    );
  } catch {
    return new Set();
  }
}

function firstLine(content: Buffer): Buffer {
  const end = content.indexOf(0x0a);
  return end === -1 ? content : content.subarray(0, end + 1);
}

function firstTs(file: string): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(firstLine(fs.readFileSync(file)));
    const parsed: unknown = JSON.parse(text);
    const ts = isMapping(parsed) ? parsed.ts : null;
    return typeof ts === 'string' ? ts : null;
  } catch {
    return null;
  }
}

function modified(file: string): string | null {
  try {
    return timestamp(fs.statSync(file).mtime);
  } catch {
    return null;
  }
}

function start(root: string, plugin: string, repo: string, run: string): string {
  const files = [eventPath(root, plugin, repo, run), summaryPath(root, plugin, repo, run)];
  return files.map(firstTs).find((ts) => ts !== null) ?? files.map(modified).find((moment) => moment !== null) ?? EARLIEST_START;
}

function newerFirst(left: readonly [string, string], right: readonly [string, string]): number {
  const [leftStart, leftRun] = left;
  const [rightStart, rightRun] = right;
  if (leftStart !== rightStart) {
    return leftStart < rightStart ? 1 : -1;
  }
  return leftRun === rightRun ? 0 : leftRun < rightRun ? 1 : -1;
}

type Pruning = { removed: readonly string[]; failure: unknown };

function removing(doomed: readonly string[], removed: readonly string[]): Pruning {
  const [file, ...rest] = doomed;
  if (file === undefined) {
    return { removed, failure: null };
  }
  try {
    fs.unlinkSync(file);
    return removing(rest, [...removed, file]);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return removing(rest, removed);
    }
    return { removed, failure: error };
  }
}

function pruned(root: string, plugin: string, repo: string, keepEvents: number, keepSummaries: number): Pruning {
  const withEvents = runNames(kindFolder(root, plugin, 'event', repo), EVENT_SUFFIX);
  const withSummaries = runNames(kindFolder(root, plugin, 'summary', repo), SUMMARY_SUFFIX);
  const newestFirst = [...new Set([...withEvents, ...withSummaries])]
    .map((run) => [start(root, plugin, repo, run), run] as const)
    .sort(newerFirst)
    .map(([, run]) => run);
  const doomed = newestFirst.flatMap((run, index) =>
    [
      [eventPath(root, plugin, repo, run), withEvents.has(run), keepEvents] as const,
      [summaryPath(root, plugin, repo, run), withSummaries.has(run), keepSummaries] as const,
    ]
      .filter(([, present, keep]) => present && index >= keep)
      .map(([file]) => file),
  );
  return removing(doomed, []);
}

export function prune(root: string, plugin: string, repo: string, keepEvents: number = KEEP_EVENT_RUNS, keepSummaries: number = KEEP_SUMMARY_RUNS): readonly string[] {
  try {
    return pruned(root, plugin, repo, keepEvents, keepSummaries).removed;
  } catch {
    return [];
  }
}
