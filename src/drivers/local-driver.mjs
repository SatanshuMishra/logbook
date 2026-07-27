import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { StorageDriver } from './storage-driver.mjs';
import { serializeRecord } from './layout.mjs';
import { DEFAULT_LEDGER_BRANCH, ledgerCommitEnv } from './git-ledger.mjs';
import { atomicWrite } from '../util/atomic-write.mjs';
import { gitExec } from '../util/git-exec.mjs';
import { clearedGitLocationEnv, isolatedGitArgs, isolatedGitConfigEnv } from '../util/git-env.mjs';
import { isUlid } from '../util/ulid.mjs';
import { assertValidThread, assertValidBinding } from '../schema/validators.mjs';

const SUBDIRS = ['threads', 'bindings', 'decisions', 'sessions', 'index'];
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DECISION_FILE = /^([0-9]+)-(.+)\.md$/;
const RECOVERY_DIR = '.git';
const RECOVERY_HOOKS_DIR = 'hooks-disabled';
const RECOVERY_GITIGNORE = 'index/\n';
const EMPTY_TEMPLATE = '--template=';

function recoveryEnv(ledgerRoot, extra = {}) {
  return {
    ...clearedGitLocationEnv(),
    ...isolatedGitConfigEnv(),
    GIT_DIR: join(ledgerRoot, RECOVERY_DIR),
    GIT_WORK_TREE: ledgerRoot,
    ...extra,
  };
}

function recoveryArgs(ledgerRoot, args) {
  return [...isolatedGitArgs(join(ledgerRoot, RECOVERY_DIR, RECOVERY_HOOKS_DIR)), ...args];
}

function degradedCommit() {
  return { committed: false, sha: null, empty: false, degraded: true };
}

async function readJsonOrNull(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(raw);
}

async function listDir(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

export class LocalDriver extends StorageDriver {
  constructor(ledgerRoot) {
    super();
    if (typeof ledgerRoot !== 'string' || ledgerRoot.length === 0) {
      throw new Error('LocalDriver: ledgerRoot must be a non-empty string');
    }
    if (!isAbsolute(ledgerRoot)) {
      throw new Error(`LocalDriver: ledgerRoot must be an absolute path, received ${ledgerRoot}`);
    }
    this.ledgerRoot = ledgerRoot;
  }

  isGit() {
    return false;
  }

  async init() {
    await mkdir(this.ledgerRoot, { recursive: true });
    for (const sub of SUBDIRS) {
      await mkdir(join(this.ledgerRoot, sub), { recursive: true });
    }
    await this.#ensureRecoveryRepo();
    return this.ledgerRoot;
  }

  async #recoveryEntry() {
    try {
      return await lstat(join(this.ledgerRoot, RECOVERY_DIR));
    } catch {
      return null;
    }
  }

  async #hasRecoveryRepo() {
    const entry = await this.#recoveryEntry();
    return entry !== null && entry.isDirectory();
  }

  async #ensureRecoveryRepo() {
    if (this.isGit()) return false;
    const entry = await this.#recoveryEntry();
    if (entry !== null && !entry.isDirectory()) return false;
    const existing = entry !== null;
    const env = recoveryEnv(this.ledgerRoot);
    const args = (rest) => recoveryArgs(this.ledgerRoot, rest);
    try {
      if (!existing) {
        await gitExec(this.ledgerRoot, args(['init', '-q', EMPTY_TEMPLATE, '-b', DEFAULT_LEDGER_BRANCH]), { env });
      }
      await gitExec(this.ledgerRoot, args(['config', '--local', 'commit.gpgsign', 'false']), { env });
      await gitExec(this.ledgerRoot, args(['config', '--local', 'tag.gpgsign', 'false']), { env });
      await atomicWrite(join(this.ledgerRoot, '.gitignore'), RECOVERY_GITIGNORE);
      return true;
    } catch {
      return false;
    }
  }

  async root() {
    return this.ledgerRoot;
  }

  async readThread(id) {
    return readJsonOrNull(join(this.ledgerRoot, 'threads', `${id}.json`));
  }

  async writeThread(thread) {
    assertValidThread(thread);
    return atomicWrite(
      join(this.ledgerRoot, 'threads', `${thread.id}.json`),
      serializeRecord(thread),
    );
  }

  async listThreads() {
    const names = await listDir(join(this.ledgerRoot, 'threads'));
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const record = await readJsonOrNull(join(this.ledgerRoot, 'threads', name));
      if (record) out.push(record);
    }
    return out;
  }

  async readBinding(id) {
    return readJsonOrNull(join(this.ledgerRoot, 'bindings', `${id}.json`));
  }

  async writeBinding(binding) {
    assertValidBinding(binding);
    return atomicWrite(
      join(this.ledgerRoot, 'bindings', `${binding.id}.json`),
      serializeRecord(binding),
    );
  }

  async listBindings() {
    const names = await listDir(join(this.ledgerRoot, 'bindings'));
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const record = await readJsonOrNull(join(this.ledgerRoot, 'bindings', name));
      if (record) out.push(record);
    }
    return out;
  }

  async nextDecisionNumber() {
    const names = await listDir(join(this.ledgerRoot, 'decisions'));
    let max = 0;
    for (const name of names) {
      const match = DECISION_FILE.exec(name);
      if (match) {
        const n = Number(match[1]);
        if (n > max) max = n;
      }
    }
    return String(max + 1).padStart(4, '0');
  }

  async writeDecision(nnnn, slug, markdown) {
    if (typeof nnnn !== 'string' || !/^[0-9]+$/.test(nnnn)) {
      throw new Error(`writeDecision: invalid decision number ${JSON.stringify(nnnn)}`);
    }
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
      throw new Error(`writeDecision: invalid slug ${JSON.stringify(slug)}`);
    }
    if (typeof markdown !== 'string') {
      throw new TypeError('writeDecision: markdown must be a string');
    }
    return atomicWrite(join(this.ledgerRoot, 'decisions', `${nnnn}-${slug}.md`), markdown);
  }

  async readDecision(nnnn) {
    const prefix = `${nnnn}-`;
    const names = await listDir(join(this.ledgerRoot, 'decisions'));
    for (const name of names) {
      if (name.startsWith(prefix) && name.endsWith('.md')) {
        return readFile(join(this.ledgerRoot, 'decisions', name), 'utf8');
      }
    }
    return null;
  }

  async listDecisions() {
    const names = await listDir(join(this.ledgerRoot, 'decisions'));
    const out = [];
    for (const name of names) {
      const match = DECISION_FILE.exec(name);
      if (match) out.push({ nnnn: match[1], slug: match[2] });
    }
    out.sort((a, b) => (a.nnnn < b.nnnn ? -1 : a.nnnn > b.nnnn ? 1 : 0));
    return out;
  }

  async appendSessionEvent(threadId, isoTs, actor, markdown) {
    if (!isUlid(threadId)) {
      throw new Error(`appendSessionEvent: threadId must be a ULID, received ${threadId}`);
    }
    if (typeof markdown !== 'string') {
      throw new TypeError('appendSessionEvent: markdown must be a string');
    }
    const safeIso = String(isoTs).replace(/[:.]/g, '-');
    const safeActor = String(actor).replace(/[^a-zA-Z0-9._-]/g, '-');
    return atomicWrite(
      join(this.ledgerRoot, 'sessions', threadId, `${safeIso}--${safeActor}.md`),
      markdown,
    );
  }

  async readIndexFile(name) {
    const value = await readJsonOrNull(join(this.ledgerRoot, 'index', `${name}.json`));
    if (value !== null) return value;
    return name === 'resumable' ? [] : {};
  }

  async writeIndexFile(name, obj) {
    return atomicWrite(
      join(this.ledgerRoot, 'index', `${name}.json`),
      serializeRecord(obj),
    );
  }

  async commit(message) {
    if (typeof message !== 'string' || message.length === 0) {
      throw new Error('LocalDriver.commit: message must be a non-empty string');
    }
    if (this.isGit() || !(await this.#hasRecoveryRepo())) {
      return degradedCommit();
    }
    const env = recoveryEnv(this.ledgerRoot);
    const args = (rest) => recoveryArgs(this.ledgerRoot, rest);
    try {
      await gitExec(this.ledgerRoot, args(['add', '-A']), { env });
      const staged = await gitExec(this.ledgerRoot, args(['diff', '--cached', '--quiet']), { env, check: false });
      if (staged.code === 0) {
        return { committed: false, sha: null, empty: true, degraded: false };
      }
      await gitExec(
        this.ledgerRoot,
        args(['commit', '--no-verify', '-m', message]),
        { env: recoveryEnv(this.ledgerRoot, ledgerCommitEnv()) },
      );
      const { stdout } = await gitExec(this.ledgerRoot, args(['rev-parse', 'HEAD']), { env });
      return { committed: true, sha: stdout.trim(), empty: false, degraded: false };
    } catch {
      return degradedCommit();
    }
  }

  async sync() {
    return { synced: false };
  }
}
