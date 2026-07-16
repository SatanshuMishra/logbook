import { mkdir, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { StorageDriver } from './storage-driver.mjs';
import { serializeRecord } from './layout.mjs';
import { atomicWrite } from '../util/atomic-write.mjs';
import { assertValidThread, assertValidBinding } from '../schema/validators.mjs';

const SUBDIRS = ['threads', 'bindings', 'decisions', 'sessions', 'index'];
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DECISION_FILE = /^([0-9]+)-(.+)\.md$/;

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
    return this.ledgerRoot;
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

  async commit(message) {
    return { committed: false };
  }

  async sync() {
    return { synced: false };
  }
}
