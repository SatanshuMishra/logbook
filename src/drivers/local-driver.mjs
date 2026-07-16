import { mkdir, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { StorageDriver } from './storage-driver.mjs';
import { serializeRecord } from './layout.mjs';
import { atomicWrite } from '../util/atomic-write.mjs';
import { assertValidThread, assertValidBinding } from '../schema/validators.mjs';

const SUBDIRS = ['threads', 'bindings', 'decisions', 'sessions', 'index'];

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

  async commit(message) {
    return { committed: false };
  }

  async sync() {
    return { synced: false };
  }
}
