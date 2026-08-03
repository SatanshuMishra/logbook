export const DRIFT_INDEX_NAME = 'drift';

function assertEntry(entry, index) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`groupDriftByThread: drift[${index}] must be an object`);
  }
  if (typeof entry.thread_id !== 'string' || entry.thread_id.length === 0) {
    throw new TypeError(`groupDriftByThread: drift[${index}] must carry a non-empty string thread_id`);
  }
}

export function groupDriftByThread(drift) {
  if (!Array.isArray(drift)) {
    throw new TypeError('groupDriftByThread: drift must be an array');
  }
  return drift.reduce((grouped, entry, index) => {
    assertEntry(entry, index);
    const existing = grouped[entry.thread_id] ?? [];
    return { ...grouped, [entry.thread_id]: [...existing, entry] };
  }, {});
}

export async function writeDriftSnapshot(driver, drift) {
  if (!driver || typeof driver.writeIndexFile !== 'function') {
    throw new TypeError('writeDriftSnapshot: driver must implement writeIndexFile');
  }
  const grouped = groupDriftByThread(drift);
  await driver.writeIndexFile(DRIFT_INDEX_NAME, grouped);
  return grouped;
}
