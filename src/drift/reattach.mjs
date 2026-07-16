import { isUlid } from '../util/ulid.mjs';
import { isTerminal, newBinding } from '../model/index.mjs';
import { branchSlug } from './slug.mjs';

function requireArg(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`reattach: ${name} must be a non-empty string`);
  }
}

async function resolveThread(driver, threadId) {
  if (!isUlid(threadId)) {
    return null;
  }
  const thread = await driver.readThread(threadId);
  return thread ?? null;
}

async function tryTrailer(driver, observation) {
  const id = observation.thread_id_trailer;
  const thread = await resolveThread(driver, id);
  return thread ? { thread_id: id, thread, method: 'trailer' } : null;
}

async function tryFirstCommit(driver, observation) {
  const target = observation.first_commit;
  if (typeof target !== 'string' || target.length === 0) {
    return null;
  }
  const bindings = await driver.listBindings();
  for (const b of bindings) {
    if (b.first_commit === target) {
      const thread = await resolveThread(driver, b.thread_id);
      if (thread) {
        return { thread_id: b.thread_id, thread, method: 'first-commit' };
      }
    }
  }
  return null;
}

async function trySlug(driver, branch) {
  const bySlug = await driver.readIndexFile('by-slug');
  const candidate = bySlug ? bySlug[branchSlug(branch)] : undefined;
  const thread = await resolveThread(driver, candidate);
  return thread ? { thread_id: candidate, thread, method: 'slug' } : null;
}

export async function reattach(driver, { repo, branch } = {}, opts = {}) {
  if (!driver || typeof driver.isGit !== 'function') {
    throw new TypeError('reattach: a driver exposing isGit() is required');
  }
  if (!driver.isGit()) {
    return { matched: false, method: 'unsupported' };
  }
  requireArg(repo, 'repo');
  requireArg(branch, 'branch');
  if (typeof driver.observeNewBranch !== 'function') {
    throw new Error('reattach: git driver is missing observeNewBranch');
  }

  const observation = await driver.observeNewBranch(repo, branch);
  const resolved =
    (await tryTrailer(driver, observation)) ||
    (await tryFirstCommit(driver, observation)) ||
    (await trySlug(driver, branch));

  if (!resolved) {
    return { matched: false, method: 'manual' };
  }

  const { thread_id, thread, method } = resolved;

  if (isTerminal(thread.status)) {
    return {
      matched: true,
      method,
      thread_id,
      binding: null,
      recommendation: { action: 'offer-successor', predecessor_id: thread.id, thread_to: null },
    };
  }

  const binding = newBinding(
    {
      thread_id,
      repo,
      branch,
      first_commit: observation.first_commit ?? null,
      trailer_present: method === 'trailer',
    },
    { now: opts.now },
  );
  await driver.writeBinding(binding);

  return {
    matched: true,
    method,
    thread_id,
    binding,
    recommendation: { action: 'resume', thread_to: 'active', predecessor_id: null },
  };
}
