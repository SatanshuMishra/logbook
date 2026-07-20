import { createHash } from 'node:crypto'
import { assertValidThread, assertValidBinding } from '../schema/index.mjs'

const SPINE_SCALAR_CAP = 500
const SPINE_ARRAY_CAP = 20
const SPINE_ITEM_CAP = 300
const LEGAL_STATES = new Set(['active', 'paused', 'blocked', 'done', 'abandoned'])
const COUNT_CAPPED_ARRAYS = new Set(['open_risks', 'out_of_scope'])
const PROVENANCE_ACTOR = 'migration-v1'
const DEMOTION_ACTOR = 'migrated'

function renderDecision({ nnnn, title, context, options, outcome, threadId, date }) {
  const optionLines = options.map((o) => `- ${o}`).join('\n')
  return [
    '---',
    'Status: accepted',
    `Date: ${date}`,
    `Thread-Id: ${threadId}`,
    '---',
    '',
    `# ${nnnn}. ${title}`,
    '',
    '## Context',
    '',
    context,
    '',
    '## Options',
    '',
    optionLines,
    '',
    '## Outcome',
    '',
    outcome,
    '',
  ].join('\n')
}

function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(String(text ?? ''), 'utf8')).digest('hex')
}

function capScalar(value) {
  const s = String(value ?? '')
  return s.length > SPINE_SCALAR_CAP
    ? { kept: s.slice(0, SPINE_SCALAR_CAP), overflow: s.slice(SPINE_SCALAR_CAP) }
    : { kept: s, overflow: '' }
}

function capArray(items, countCapped) {
  const trimmed = (items ?? []).map((it) => {
    const s = String(it)
    return s.length > SPINE_ITEM_CAP ? s.slice(0, SPINE_ITEM_CAP) : s
  })
  if (!countCapped || trimmed.length <= SPINE_ARRAY_CAP) {
    return { kept: trimmed, overflow: [] }
  }
  return { kept: trimmed.slice(0, SPINE_ARRAY_CAP), overflow: trimmed.slice(SPINE_ARRAY_CAP) }
}

export function demoteSpine(spine) {
  const status = capScalar(spine.status)
  const goal = capScalar(spine.active_goal)
  const next = capScalar(spine.next_step)
  const risks = capArray(spine.open_risks, COUNT_CAPPED_ARRAYS.has('open_risks'))
  const decisions = capArray(spine.key_decisions, COUNT_CAPPED_ARRAYS.has('key_decisions'))
  const scope = capArray(spine.out_of_scope, COUNT_CAPPED_ARRAYS.has('out_of_scope'))
  const overflow = []
  for (const [label, part] of [['status', status], ['active_goal', goal], ['next_step', next]]) {
    if (part.overflow) {
      overflow.push(`${label}: ${part.overflow}`)
    }
  }
  for (const [label, part] of [['open_risks', risks], ['out_of_scope', scope]]) {
    for (const item of part.overflow) {
      overflow.push(`${label}: ${item}`)
    }
  }
  return {
    spine: {
      status: status.kept,
      active_goal: goal.kept,
      next_step: next.kept,
      open_risks: risks.kept,
      key_decisions: decisions.kept,
      out_of_scope: scope.kept,
    },
    overflow,
  }
}

export function resolveMigratedStatus(rawStatus) {
  const s = String(rawStatus ?? '').toLowerCase()
  if (s === 'active') {
    return { status: 'paused', demoted: true }
  }
  if (LEGAL_STATES.has(s)) {
    return { status: s, demoted: false }
  }
  return { status: 'paused', demoted: true }
}

export function emitThread({ id, slug, title, status, createdAt, updatedAt }, parsed, refs = {}) {
  const { spine } = demoteSpine(parsed.spine)
  const thread = {
    schema_version: 1,
    id,
    slug,
    title,
    status,
    parent_id: refs.parent_id ?? null,
    predecessor_id: refs.predecessor_id ?? null,
    completion_criteria: parsed.completion_criteria ?? [],
    vcs_ref: refs.vcs_ref ?? null,
    external_refs: parsed.external_refs ?? [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: { ...spine, status },
    created_at: createdAt,
    updated_at: updatedAt ?? createdAt,
  }
  return assertValidThread(thread)
}

export function emitDecision({ nnnn, slug }, parsed, threadId) {
  if (!threadId) {
    throw new Error(`emitDecision: decision ${nnnn}-${slug} has no resolved Thread-Id; route to ReviewQueue`)
  }
  const markdown = renderDecision({
    nnnn,
    title: parsed.title,
    context: parsed.context ?? '',
    options: parsed.options ?? [],
    outcome: parsed.outcome ?? '',
    threadId,
    date: parsed.date ?? '',
  })
  return { nnnn, slug, markdown }
}

export function emitSession({ new_path }, sourceBytes) {
  return { path: new_path, bytes: Buffer.from(sourceBytes) }
}

export function emitBinding({ id, threadId, repo, branch, createdAt, firstCommit = null, trailerPresent = false }) {
  const binding = {
    id,
    thread_id: threadId,
    repo,
    branch,
    status: 'active',
    created_at: createdAt,
    closed_at: null,
    closed_reason: null,
    first_commit: firstCommit,
    trailer_present: trailerPresent,
  }
  return assertValidBinding(binding)
}

export function emitDemotionSession(threadId, isoTs, demotedItems = []) {
  const markdown = [
    `# Migration demotion — ${isoTs}`,
    '',
    `Actor: ${DEMOTION_ACTOR}`,
    '',
    '## Demoted (over-cap or status)',
    ...demotedItems.map((d) => `- ${d}`),
    '',
  ].join('\n')
  return { threadId, isoTs, actor: DEMOTION_ACTOR, markdown }
}

export function emitProvenanceSnapshot(threadId, isoTs, { sourceMarkdown, orphanFields = [], spineOverflow = [] }) {
  const markdown = [
    `# Migration provenance snapshot — ${isoTs}`,
    '',
    `Actor: ${PROVENANCE_ACTOR}`,
    `Source-SHA256: ${sha256Hex(sourceMarkdown)}`,
    '',
    '## Orphan fields',
    ...orphanFields.map((f) => `- ${f}`),
    '',
    '## Demoted spine detail',
    ...spineOverflow.map((f) => `- ${f}`),
    '',
    '## Verbatim v1 source',
    '',
    String(sourceMarkdown ?? ''),
    '',
  ].join('\n')
  return { threadId, isoTs, actor: PROVENANCE_ACTOR, markdown }
}

export function emitProjectMdFold(anchorThreadId, isoTs, projectMdMarkdown) {
  if (!anchorThreadId) {
    throw new Error('emitProjectMdFold: anchorThreadId is required to fold PROJECT.md')
  }
  const markdown = [
    `# Migration PROJECT.md fold — ${isoTs}`,
    '',
    `Actor: ${PROVENANCE_ACTOR}`,
    `Source-SHA256: ${sha256Hex(projectMdMarkdown)}`,
    '',
    '## Verbatim PROJECT.md',
    '',
    String(projectMdMarkdown ?? ''),
    '',
  ].join('\n')
  return { threadId: anchorThreadId, isoTs, actor: PROVENANCE_ACTOR, markdown }
}

export function selectAnchorThread(threadMapEntries) {
  const entries = threadMapEntries ?? []
  if (entries.length === 0) {
    throw new Error('selectAnchorThread: cannot fold PROJECT.md — no threads to anchor onto')
  }
  const sorted = [...entries].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? -1 : 1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted[0].id
}
