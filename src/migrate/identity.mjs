import { monotonicFactory } from 'ulid'
import { validateThreadMap, validateDecisionMap } from './schemas.mjs'

export function makeMinter() {
  const factory = monotonicFactory()
  return (createdAtMs) => factory(createdAtMs)
}

export function sanitizeSlug(slug) {
  const cleaned = String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return cleaned.length > 0 ? cleaned : 'decision'
}

export function mintThreadMap(store, threads, existing = null) {
  const priorBySlug = new Map((existing?.entries ?? []).map((e) => [e.slug, e]))
  const mint = makeMinter()
  const ordered = [...threads].sort((a, b) => {
    const ma = Date.parse(a.created_at)
    const mb = Date.parse(b.created_at)
    return ma === mb ? a.slug.localeCompare(b.slug) : ma - mb
  })
  const entries = ordered.map((t) => {
    const prior = priorBySlug.get(t.slug)
    const id = prior ? prior.id : mint(Date.parse(t.created_at))
    return {
      slug: t.slug,
      id,
      created_at: t.created_at,
      created_at_rung: t.created_at_rung,
      title: t.title,
    }
  })
  return validateThreadMap({ schema_version: 1, store, entries })
}

export function mintDecisionMap(store, decisions, existing = null) {
  const priorByFile = new Map((existing?.entries ?? []).map((e) => [e.old_filename, e]))
  const ordered = [...decisions].sort((a, b) => (
    a.date === b.date ? a.old_filename.localeCompare(b.old_filename) : String(a.date).localeCompare(String(b.date))
  ))
  let max = 0
  for (const e of priorByFile.values()) {
    max = Math.max(max, Number(e.nnnn))
  }
  const entries = ordered.map((d) => {
    const prior = priorByFile.get(d.old_filename)
    if (prior) {
      return prior
    }
    max += 1
    return {
      old_filename: d.old_filename,
      nnnn: String(max).padStart(4, '0'),
      slug: sanitizeSlug(d.slug),
      thread_id: d.thread_id ?? null,
    }
  })
  return validateDecisionMap({ schema_version: 1, store, entries })
}
