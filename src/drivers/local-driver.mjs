import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { StorageDriver } from './storage-driver.mjs';

const SUBDIRS = ['threads', 'bindings', 'decisions', 'sessions', 'index'];

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

  async commit(message) {
    return { committed: false };
  }

  async sync() {
    return { synced: false };
  }
}
