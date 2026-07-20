import { validateReviewQueue } from './schemas.mjs'

export function rollupReviewQueue(queue) {
  validateReviewQueue(queue)
  const counts = { open: 0, resolved: 0, deferred: 0 }
  const byClass = { LOSSY: 0, MANUAL: 0, HALT: 0 }
  for (const e of queue.entries) {
    counts[e.resolution_status] += 1
    byClass[e.flag_class] += 1
  }
  return { counts, byClass, blocksDone: counts.open > 0 || byClass.HALT > 0 }
}

export function renderMigrationReport({ store, plan, verification, queue, snapshot = null }) {
  const roll = rollupReviewQueue(queue)
  const line = (k, v) => `- ${k}: ${v}`
  const vres = (v) => (v === null || v === undefined ? 'skipped' : v.ok)
  return [
    `# Migration report — ${store}`,
    '',
    '## Baseline counts',
    line('threads', plan.baseline_counts.threads),
    line('decisions', plan.baseline_counts.decisions),
    line('sessions', plan.baseline_counts.sessions),
    line('bindings', plan.baseline_counts.bindings),
    '',
    '## Verification',
    line('V1 counts', vres(verification.v1)),
    line('V2 bytes', vres(verification.v2)),
    line('V3 structural', vres(verification.v3)),
    line('V4 cold-read', vres(verification.v4)),
    line('V5 source re-hash', vres(verification.v5)),
    '',
    '## Artifacts',
    line('pre-apply snapshot', snapshot ?? '(dry-run; taken at --apply)'),
    '',
    '## Review queue',
    line('open', roll.counts.open),
    line('resolved', roll.counts.resolved),
    line('deferred', roll.counts.deferred),
    line('LOSSY', roll.byClass.LOSSY),
    line('MANUAL', roll.byClass.MANUAL),
    line('HALT', roll.byClass.HALT),
    '',
    `## Cutover: ${roll.blocksDone ? 'BLOCKED (resolve open/HALT items first)' : 'clear'}`,
    '',
  ].join('\n')
}
