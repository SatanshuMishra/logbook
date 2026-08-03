import { criteriaProgress } from '../model/selection.mjs';

const RESUMABLE_STATUSES = new Set(['active', 'paused', 'blocked']);

function byCreatedThenId(a, b) {
  const ac = a.created_at ?? '';
  const bc = b.created_at ?? '';
  if (ac < bc) return -1;
  if (ac > bc) return 1;
  const ai = a.id ?? '';
  const bi = b.id ?? '';
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

export async function rebuildIndex(driver) {
  if (
    !driver
    || typeof driver.listThreads !== 'function'
    || typeof driver.listBindings !== 'function'
    || typeof driver.writeIndexFile !== 'function'
  ) {
    throw new Error('rebuildIndex: driver must implement listThreads, listBindings, writeIndexFile');
  }

  const threads = [...(await driver.listThreads())].sort(byCreatedThenId);
  const bindings = [...(await driver.listBindings())].sort(byCreatedThenId);

  const bySlug = {};
  const children = {};
  const resumable = [];
  for (const thread of threads) {
    if (thread.slug && !(thread.slug in bySlug)) {
      bySlug[thread.slug] = thread.id;
    }
    if (thread.parent_id) {
      (children[thread.parent_id] ??= []).push(thread.id);
    }
    if (RESUMABLE_STATUSES.has(thread.status)) {
      const nextStep = thread.spine && typeof thread.spine.next_step === 'string'
        ? thread.spine.next_step
        : '';
      const progress = criteriaProgress(thread);
      resumable.push({
        id: thread.id,
        slug: thread.slug,
        title: thread.title,
        status: thread.status,
        next_step: nextStep,
        done: progress.done,
        total: progress.total,
        detours_open: progress.detoursOpen,
      });
    }
  }

  const byBranch = {};
  for (const binding of bindings) {
    const key = `${binding.repo} ${binding.branch}`;
    (byBranch[key] ??= []).push(binding.id);
  }

  await driver.writeIndexFile('by-slug', bySlug);
  await driver.writeIndexFile('by-branch', byBranch);
  await driver.writeIndexFile('children', children);
  await driver.writeIndexFile('resumable', resumable);

  return {
    threads: threads.length,
    bindings: bindings.length,
    by_slug: Object.keys(bySlug).length,
    by_branch: Object.keys(byBranch).length,
    children: Object.keys(children).length,
    resumable: resumable.length,
  };
}
