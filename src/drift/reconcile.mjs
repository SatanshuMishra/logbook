import { classifyObservation } from './classification.mjs';
import { disposeBinding } from './disposition.mjs';
import { reattach } from './reattach.mjs';

export function closedBinding(binding, status, reason, nowIso) {
  if (typeof nowIso !== 'string' || nowIso.trim().length === 0) {
    throw new TypeError('closedBinding: nowIso must be a non-empty ISO string');
  }
  return { ...binding, status, closed_at: nowIso, closed_reason: reason };
}

export async function runReconcile(ctx, opts = {}) {
  if (!ctx || !ctx.driver) {
    throw new TypeError('runReconcile: ctx.driver is required');
  }
  const { driver } = ctx;

  if (!driver.isGit()) {
    return { drift: [], dispositions: [] };
  }
  if (typeof driver.observeBranch !== 'function' || typeof driver.listRepoBranches !== 'function') {
    throw new Error('runReconcile: git driver is missing observeBranch/listRepoBranches');
  }

  const now = opts.now ?? (typeof ctx.now === 'function' ? ctx.now() : new Date().toISOString());

  const drift = [];
  const dispositions = [];
  const bindings = await driver.listBindings();

  for (const binding of bindings) {
    if (binding.status !== 'active') {
      continue;
    }
    const observation = await driver.observeBranch(binding);
    const entry = classifyObservation(binding, observation);
    if (entry === null) {
      continue;
    }
    drift.push(entry);
    const thread = await driver.readThread(binding.thread_id);
    const disposition = disposeBinding(entry, thread);
    if (disposition.binding_status !== null) {
      const closed = closedBinding(binding, disposition.binding_status, disposition.closed_reason, now);
      await driver.writeBinding(closed);
    }
    dispositions.push(disposition);
  }

  const boundKeys = new Set(bindings.map((b) => `${b.repo} ${b.branch}`));
  const repos = [...new Set(bindings.map((b) => b.repo))];

  for (const repo of repos) {
    const branches = await driver.listRepoBranches(repo);
    for (const branch of branches) {
      if (boundKeys.has(`${repo} ${branch}`)) {
        continue;
      }
      const result = await reattach(driver, { repo, branch }, { now });
      if (result.matched) {
        dispositions.push({ kind: 'reattach', thread_id: result.thread_id, branch, repo, method: result.method });
      }
    }
  }

  return { drift, dispositions };
}
