export const DRIFT_INDEX_NAME = 'drift';

function assertEntry(entry, label) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (typeof entry.thread_id !== 'string' || entry.thread_id.length === 0) {
    throw new TypeError(`${label} must carry a non-empty string thread_id`);
  }
}

function assertSnapshot(snapshot, label) {
  if (snapshot === null || snapshot === undefined) {
    return {};
  }
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError(`${label}: snapshot must be an object keyed by thread_id`);
  }
  for (const [threadId, entries] of Object.entries(snapshot)) {
    if (!Array.isArray(entries)) {
      throw new TypeError(`${label}: snapshot[${threadId}] must be an array of drift entries`);
    }
    entries.forEach((entry, index) => assertEntry(entry, `${label}: snapshot[${threadId}][${index}]`));
  }
  return snapshot;
}

function entryKey(entry) {
  return typeof entry.binding_id === 'string' && entry.binding_id.length > 0
    ? `binding ${entry.binding_id}`
    : `branch ${entry.repo} ${entry.branch}`;
}

function mergeThreadEntries(prior, incoming) {
  const replacements = new Map(incoming.map((entry) => [entryKey(entry), entry]));
  const priorKeys = new Set(prior.map(entryKey));
  return [
    ...prior.map((entry) => replacements.get(entryKey(entry)) ?? entry),
    ...incoming.filter((entry) => !priorKeys.has(entryKey(entry))),
  ];
}

export function groupDriftByThread(drift) {
  if (!Array.isArray(drift)) {
    throw new TypeError('groupDriftByThread: drift must be an array');
  }
  return drift.reduce((grouped, entry, index) => {
    assertEntry(entry, `groupDriftByThread: drift[${index}]`);
    const existing = grouped[entry.thread_id] ?? [];
    return { ...grouped, [entry.thread_id]: [...existing, entry] };
  }, {});
}

export function mergeDriftSnapshot(existing, drift) {
  const prior = assertSnapshot(existing, 'mergeDriftSnapshot');
  const incoming = groupDriftByThread(drift);
  const threadIds = [...new Set([...Object.keys(prior), ...Object.keys(incoming)])];
  return threadIds.reduce(
    (merged, threadId) => ({
      ...merged,
      [threadId]: mergeThreadEntries(prior[threadId] ?? [], incoming[threadId] ?? []),
    }),
    {},
  );
}

function assertIndexDriver(driver, label) {
  if (!driver || typeof driver.readIndexFile !== 'function' || typeof driver.writeIndexFile !== 'function') {
    throw new TypeError(`${label}: driver must implement readIndexFile and writeIndexFile`);
  }
}

export async function writeDriftSnapshot(driver, drift) {
  assertIndexDriver(driver, 'writeDriftSnapshot');
  const merged = mergeDriftSnapshot(await driver.readIndexFile(DRIFT_INDEX_NAME), drift);
  await driver.writeIndexFile(DRIFT_INDEX_NAME, merged);
  return merged;
}

export async function takeDriftSnapshot(driver, threadId) {
  assertIndexDriver(driver, 'takeDriftSnapshot');
  if (typeof threadId !== 'string' || threadId.length === 0) {
    throw new TypeError('takeDriftSnapshot: threadId must be a non-empty string');
  }
  const snapshot = assertSnapshot(await driver.readIndexFile(DRIFT_INDEX_NAME), 'takeDriftSnapshot');
  const taken = snapshot[threadId] ?? [];
  if (taken.length === 0) {
    return [];
  }
  const remaining = Object.fromEntries(Object.entries(snapshot).filter(([id]) => id !== threadId));
  await driver.writeIndexFile(DRIFT_INDEX_NAME, remaining);
  return taken;
}
