import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext, ToolReply } from '../../src/server/register.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { Refusal } from '../../src/schema/declare.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { parkThreadTool } from '../../src/server/tools/park_thread.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'
import { listThreadsTool } from '../../src/server/tools/list_threads.ts'
import { openProjectStore } from '../../src/server/tool-support.ts'
import { testRuntime } from './runtime.ts'

export const STUB_TOOL_CTX = {} as unknown as ToolContext

export const isEmptyish = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0)

const FIXTURE_GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const DETERMINISTIC_COMMIT_ENV: NodeJS.ProcessEnv = {
  ...FIXTURE_GIT_ENV,
  GIT_AUTHOR_NAME: 'Logbook Optional Argument Fixture',
  GIT_AUTHOR_EMAIL: 'optional-argument-fixture@logbook.test',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Logbook Optional Argument Fixture',
  GIT_COMMITTER_EMAIL: 'optional-argument-fixture@logbook.test',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z'
}

const runGit = (repo: string, args: string[], env: NodeJS.ProcessEnv = FIXTURE_GIT_ENV): void => {
  const result = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`optional-argument-recipes: git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

const deterministicRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-optional-args-'))
  runGit(repo, ['init', '--initial-branch=main'])
  runGit(repo, ['config', 'user.name', 'Logbook Optional Argument Fixture'])
  runGit(repo, ['config', 'user.email', 'optional-argument-fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook optional-argument fixture repository\n')
  runGit(repo, ['add', 'README.md'])
  runGit(repo, ['commit', '-m', 'fixture: initial commit'], DETERMINISTIC_COMMIT_ENV)
  return repo
}

type FixtureSide<C> = { rt: Runtime; ctx: C }
type FixturePair<C> = { a: FixtureSide<C>; b: FixtureSide<C>; cleanup: () => void }

const makeFixtureSide = async <C>(
  build: (rt: Runtime) => Promise<C>
): Promise<{ rt: Runtime; ctx: C; repo: string; pluginDataRoot: string }> => {
  const repo = deterministicRepo()
  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-optional-args-plugin-data-'))
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo })
  const ctx = await build(rt)
  return { rt, ctx, repo, pluginDataRoot }
}

const withFixturePair = async <C>(build: (rt: Runtime) => Promise<C>): Promise<FixturePair<C>> => {
  const dirs: string[] = []
  const makeSide = async (): Promise<FixtureSide<C>> => {
    const side = await makeFixtureSide(build)
    dirs.push(side.repo, side.pluginDataRoot)
    return { rt: side.rt, ctx: side.ctx }
  }
  const a = await makeSide()
  const b = await makeSide()
  return { a, b, cleanup: () => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) } }
}

export const withSingleFixture = async <C>(
  build: (rt: Runtime) => Promise<C>
): Promise<{ rt: Runtime; ctx: C; cleanup: () => void }> => {
  const side = await makeFixtureSide(build)
  return {
    rt: side.rt,
    ctx: side.ctx,
    cleanup: () => {
      rmSync(side.repo, { recursive: true, force: true })
      rmSync(side.pluginDataRoot, { recursive: true, force: true })
    }
  }
}

export const readThreadRecord = (rt: Runtime, id: string): Thread | null => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('optional-argument-recipes: expected the store to open for a thread read')
  const slot = opened.value.readThread(id)
  if (slot === null) return null
  if (slot.quarantined) throw new Error(`optional-argument-recipes: thread ${id} is quarantined`)
  return slot.record
}

export const readDecisionRecord = (rt: Runtime, id: string): Decision | null => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('optional-argument-recipes: expected the store to open for a decision read')
  const slot = opened.value.readDecision(id)
  if (slot === null) return null
  if (slot.quarantined) throw new Error(`optional-argument-recipes: decision ${id} is quarantined`)
  return slot.record
}

export const readSessionEntryRecord = (rt: Runtime, threadId: string, id: string): { body: string } | null => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('optional-argument-recipes: expected the store to open for a session entry read')
  const slot = opened.value.readSessionEntry(threadId, id)
  if (slot === null) return null
  if (slot.quarantined) throw new Error(`optional-argument-recipes: session entry ${id} is quarantined`)
  return slot.record
}

export type LandingSite = { site: string; omitted: unknown }
export type RecipeRefusal = { field: string; message: string }
export type RecipeResult = { path: string; refused: boolean; sites: LandingSite[]; refusal: RecipeRefusal | null }

const siteIfDiffers = (site: string, omitted: unknown, sentinel: unknown): LandingSite | null =>
  JSON.stringify(omitted) === JSON.stringify(sentinel) ? null : { site, omitted }

const refusalOf = (refusal: Refusal): RecipeRefusal => ({ field: refusal.field, message: refusal.message })

export const mustGet = <T>(arr: readonly T[], index: number, what: string): T => {
  const value = arr[index]
  if (value === undefined) throw new Error(`optional-argument-recipes: expected ${what}`)
  return value
}

const mustBeString = (value: unknown, what: string): string => {
  if (typeof value !== 'string') throw new Error(`optional-argument-recipes: expected ${what} to be a string`)
  return value
}

const mustBeStringArray = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`optional-argument-recipes: expected ${what} to be an array`)
  return value.map((entry, index) => mustBeString(entry, `${what}[${index}]`))
}

type AnyTool = { handler: (rt: Runtime, ctx: ToolContext, input: any) => Promise<ToolReply<Record<string, unknown>>> }

const runOptionalArgRecipe = async <C>(
  path: string,
  tool: AnyTool,
  setup: (rt: Runtime) => Promise<C>,
  omittedArgs: (ctx: C) => Record<string, unknown>,
  sentinelArgs: (ctx: C) => Record<string, unknown>,
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: C) => Record<string, unknown>
): Promise<RecipeResult> => {
  const pair = await withFixturePair(setup)
  try {
    const omittedResult = await tool.handler(pair.a.rt, STUB_TOOL_CTX, omittedArgs(pair.a.ctx))
    if (!omittedResult.ok) {
      return { path, refused: true, sites: [], refusal: refusalOf(omittedResult.refusal) }
    }
    const sentinelResult = await tool.handler(pair.b.rt, STUB_TOOL_CTX, sentinelArgs(pair.b.ctx))
    if (!sentinelResult.ok) {
      throw new Error(`optional-argument-recipes: expected the sentinel call for "${path}" to succeed`)
    }
    const omittedMap = extract(omittedResult.structured, pair.a.rt, pair.a.ctx)
    const sentinelMap = extract(sentinelResult.structured, pair.b.rt, pair.b.ctx)
    const sites: LandingSite[] = []
    for (const key of Object.keys(omittedMap)) {
      const derived = siteIfDiffers(key, omittedMap[key], sentinelMap[key])
      if (derived !== null) sites.push(derived)
    }
    return { path, refused: false, sites, refusal: null }
  } finally {
    pair.cleanup()
  }
}

const NO_EXTRACT = (): Record<string, unknown> => ({})

type ThreadFixtureCtx = { threadId: string; criterionIds: string[] }

const openFixtureThread = async (rt: Runtime, label: string, criteriaCount = 1): Promise<ThreadFixtureCtx> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: `${label} fixture thread`,
    slug: `${label.replace(/[^a-z0-9]+/gi, '-')}-fixture-thread`,
    completion_criteria: Array.from({ length: criteriaCount }, (_, index) => ({
      text: `${label} criterion ${index + 1}`,
      check: `${label} check ${index + 1}`
    }))
  })
  if (!opened.ok) throw new Error(`optional-argument-recipes: expected the ${label} fixture thread to open`)
  return {
    threadId: opened.structured.thread_id as string,
    criterionIds: (opened.structured.completion_criteria as { id: string }[]).map((c) => c.id)
  }
}

const decisionArgs = (threadId: string, label: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  thread_id: threadId,
  title: `${label} title`,
  context: `${label} context`,
  options: [`${label} option`],
  outcome: `${label} outcome`,
  ...extra
})

const recordFixtureDecision = async (rt: Runtime, threadId: string, label: string): Promise<string> => {
  const decision = await recordDecisionTool.handler(
    rt,
    STUB_TOOL_CTX,
    decisionArgs(threadId, label) as Parameters<typeof recordDecisionTool.handler>[2]
  )
  if (!decision.ok) throw new Error(`optional-argument-recipes: expected the ${label} decision to be recorded`)
  return decision.structured.decision_id as string
}

const successorThreadArgs = (): Record<string, unknown> => ({
  title: 'successor fixture thread',
  slug: 'successor-fixture-thread',
  completion_criteria: [{ text: 'a successor criterion', check: 'a successor check' }]
})

const openThreadPredecessorIdRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'open_thread.predecessor_id',
    openThreadTool,
    async (rt) => (await openFixtureThread(rt, 'predecessor')).threadId,
    () => successorThreadArgs(),
    (predecessorId: string) => ({ ...successorThreadArgs(), predecessor_id: predecessorId }),
    (structured, rt) => ({
      predecessor_id: readThreadRecord(rt, mustBeString(structured.thread_id, 'the opened thread id'))?.predecessor_id ?? null
    })
  )

type UpdateThreadFixtureCtx = ThreadFixtureCtx & { riskId: string; decisionId: string }

const openUpdateThreadFixture = async (rt: Runtime): Promise<UpdateThreadFixtureCtx> => {
  const { threadId, criterionIds } = await openFixtureThread(rt, 'update-thread', 2)
  const withRisk = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
    thread_id: threadId,
    risks_add: [{ text: 'a pre-existing fixture risk', scope: 'a pre-existing fixture scope' }]
  })
  if (!withRisk.ok) throw new Error('optional-argument-recipes: expected the pre-existing risk to be added')
  const riskId = mustGet(withRisk.structured.risks_added as string[], 0, 'a minted risk id')
  const decisionId = await recordFixtureDecision(rt, threadId, 'a pre-existing fixture decision')
  return { threadId, criterionIds, riskId, decisionId }
}

const runUpdateThreadRecipe = (
  field: string,
  sentinelExtra: (ctx: UpdateThreadFixtureCtx) => Record<string, unknown>,
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: UpdateThreadFixtureCtx) => Record<string, unknown>
): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    `update_thread.${field}`,
    updateThreadTool,
    openUpdateThreadFixture,
    (ctx) => ({ thread_id: ctx.threadId }),
    (ctx) => ({ thread_id: ctx.threadId, ...sentinelExtra(ctx) }),
    extract
  )

type SimpleUpdateFieldSpec = {
  field: string
  sentinelExtra: (ctx: UpdateThreadFixtureCtx) => Record<string, unknown>
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: UpdateThreadFixtureCtx) => Record<string, unknown>
}

const SIMPLE_UPDATE_FIELDS: SimpleUpdateFieldSpec[] = [
  {
    field: 'criteria_done',
    sentinelExtra: (ctx) => ({
      criteria_done: [
        { criterion_id: mustGet(ctx.criterionIds, 0, 'the first fixture criterion id'), result: 'sentinel result text', result_status: 'verified' }
      ]
    }),
    extract: (structured, rt, ctx) => {
      const criterionId = mustGet(ctx.criterionIds, 0, 'the first fixture criterion id')
      const criterion = readThreadRecord(rt, ctx.threadId)?.completion_criteria.find((c) => c.id === criterionId)
      return {
        criteria_marked_done: structured.criteria_marked_done,
        done: criterion?.done ?? false,
        result: criterion?.result ?? null,
        result_status: criterion?.result_status ?? null
      }
    }
  },
  {
    field: 'active_goal',
    sentinelExtra: () => ({ active_goal: 'sentinel active goal text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      active_goal: readThreadRecord(rt, ctx.threadId)?.spine.active_goal ?? ''
    })
  },
  {
    field: 'next_step',
    sentinelExtra: () => ({ next_step: 'sentinel next step text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      next_step: readThreadRecord(rt, ctx.threadId)?.spine.next_step ?? ''
    })
  },
  {
    field: 'last_session',
    sentinelExtra: () => ({ last_session: 'sentinel last session text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      last_session: readThreadRecord(rt, ctx.threadId)?.spine.last_session ?? ''
    })
  },
  {
    field: 'blocked_by',
    sentinelExtra: () => ({ blocked_by: 'sentinel blocked by text' }),
    extract: (structured, rt, ctx) => ({
      blocked_by_set: structured.blocked_by_set,
      blocked_by: readThreadRecord(rt, ctx.threadId)?.blocked_by ?? null
    })
  },
  {
    field: 'blocked_by_clear',
    sentinelExtra: () => ({ blocked_by_clear: true }),
    extract: (structured, rt, ctx) => ({
      blocked_by_set: structured.blocked_by_set,
      blocked_by: readThreadRecord(rt, ctx.threadId)?.blocked_by ?? null
    })
  },
  {
    field: 'risks_add',
    sentinelExtra: () => ({ risks_add: [{ text: 'sentinel risks_add risk text', scope: 'sentinel risks_add risk scope' }] }),
    extract: (structured) => ({ risks_added: structured.risks_added })
  },
  {
    field: 'risks_retire',
    sentinelExtra: (ctx) => ({ risks_retire: [ctx.riskId] }),
    extract: (structured) => ({ risks_retired: structured.risks_retired })
  },
  {
    field: 'key_decisions_add',
    sentinelExtra: (ctx) => ({
      key_decisions_add: [{ decision_id: ctx.decisionId, title: 'sentinel key decision title', scope: 'sentinel key decision scope' }]
    }),
    extract: (structured) => ({ key_decisions_added: structured.key_decisions_added })
  },
  {
    field: 'out_of_scope_add',
    sentinelExtra: () => ({ out_of_scope_add: ['sentinel out of scope statement'] }),
    extract: (structured) => ({ out_of_scope_added: structured.out_of_scope_added })
  },
  {
    field: 'focus',
    sentinelExtra: (ctx) => ({ focus: [mustGet(ctx.criterionIds, 0, 'the first fixture criterion id')] }),
    extract: (structured) => ({ focus_written: structured.focus_written, focus_not_written_reason: structured.focus_not_written_reason })
  }
]

const simpleUpdateThreadRecipes: [string, () => Promise<RecipeResult>][] = SIMPLE_UPDATE_FIELDS.map((spec) => [
  `update_thread.${spec.field}`,
  () => runUpdateThreadRecipe(spec.field, spec.sentinelExtra, spec.extract)
])

const findAddedRisk = (rt: Runtime, threadId: string, structured: Record<string, unknown>) => {
  const newRiskId = mustGet(structured.risks_added as string[], 0, 'the minted risk id')
  return readThreadRecord(rt, threadId)?.spine.open_risks.find((r) => r.id === newRiskId)
}

const updateThreadRisksAddRefsRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'update_thread.risks_add[].refs',
    updateThreadTool,
    openUpdateThreadFixture,
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [{ text: 'refs probe risk text', scope: 'refs probe risk scope' }]
    }),
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [{ text: 'refs probe risk text', scope: 'refs probe risk scope', refs: ['sentinel-ref-pointer'] }]
    }),
    (structured, rt, ctx: UpdateThreadFixtureCtx) => ({ refs: findAddedRisk(rt, ctx.threadId, structured)?.refs ?? [] })
  )

const updateThreadRisksAddCriterionIdRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'update_thread.risks_add[].criterion_id',
    updateThreadTool,
    openUpdateThreadFixture,
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [{ text: 'criterion probe risk text', scope: 'criterion probe risk scope' }]
    }),
    (ctx: UpdateThreadFixtureCtx) => ({
      thread_id: ctx.threadId,
      risks_add: [
        {
          text: 'criterion probe risk text',
          scope: 'criterion probe risk scope',
          criterion_id: mustGet(ctx.criterionIds, 0, 'the first fixture criterion id')
        }
      ]
    }),
    (structured, rt, ctx: UpdateThreadFixtureCtx) => ({ criterion_id: findAddedRisk(rt, ctx.threadId, structured)?.criterion_id ?? null })
  )

type AmendCriteriaFixtureCtx = ThreadFixtureCtx & { decisionId: string }

const openAmendCriteriaFixture = async (rt: Runtime): Promise<AmendCriteriaFixtureCtx> => {
  const { threadId, criterionIds } = await openFixtureThread(rt, 'amend-criteria', 2)
  const decisionId = await recordFixtureDecision(rt, threadId, 'an amend fixture decision')
  return { threadId, criterionIds, decisionId }
}

const amendCriteriaCriterionIdRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'amend_criteria.criterion_id',
    amendCriteriaTool,
    openAmendCriteriaFixture,
    (ctx: AmendCriteriaFixtureCtx) => ({ thread_id: ctx.threadId, operation: 'rewrite', decision_id: ctx.decisionId, text: 'sentinel rewritten text' }),
    (ctx: AmendCriteriaFixtureCtx) => ({
      thread_id: ctx.threadId,
      operation: 'rewrite',
      decision_id: ctx.decisionId,
      text: 'sentinel rewritten text',
      criterion_id: mustGet(ctx.criterionIds, 0, 'the first amend fixture criterion id')
    }),
    NO_EXTRACT
  )

const amendInsertBaseArgs = (ctx: AmendCriteriaFixtureCtx): Record<string, unknown> => ({
  thread_id: ctx.threadId,
  operation: 'insert',
  decision_id: ctx.decisionId
})

const amendInsertRecipe = (
  path: string,
  omittedExtra: Record<string, unknown>,
  sentinelExtra: Record<string, unknown>
): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    path,
    amendCriteriaTool,
    openAmendCriteriaFixture,
    (ctx: AmendCriteriaFixtureCtx) => ({ ...amendInsertBaseArgs(ctx), ...omittedExtra }),
    (ctx: AmendCriteriaFixtureCtx) => ({ ...amendInsertBaseArgs(ctx), ...omittedExtra, ...sentinelExtra }),
    NO_EXTRACT
  )

const amendCriteriaTextRecipe = (): Promise<RecipeResult> =>
  amendInsertRecipe(
    'amend_criteria.text',
    { kind: 'planned', check: 'sentinel insert check' },
    { text: 'sentinel insert text' }
  )

const amendCriteriaKindRecipe = (): Promise<RecipeResult> =>
  amendInsertRecipe(
    'amend_criteria.kind',
    { text: 'sentinel insert text', check: 'sentinel insert check' },
    { kind: 'planned' }
  )

const amendCriteriaCheckRecipe = (): Promise<RecipeResult> =>
  amendInsertRecipe(
    'amend_criteria.check',
    { text: 'sentinel insert text', kind: 'planned' },
    { check: 'sentinel insert check' }
  )

type AmendCriteriaPositionFixtureCtx = { threadId: string; decisionId: string }

const openAmendCriteriaPositionFixture = async (rt: Runtime): Promise<AmendCriteriaPositionFixtureCtx> => {
  const { threadId } = await openFixtureThread(rt, 'amend-criteria-position', 2)
  const decisionId = await recordFixtureDecision(rt, threadId, 'a position fixture decision')
  return { threadId, decisionId }
}

const amendPositionBaseArgs = (ctx: AmendCriteriaPositionFixtureCtx): Record<string, unknown> => ({
  thread_id: ctx.threadId,
  operation: 'insert',
  decision_id: ctx.decisionId,
  text: 'sentinel position text',
  kind: 'planned',
  check: 'sentinel position check'
})

const amendCriteriaPositionRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'amend_criteria.position',
    amendCriteriaTool,
    openAmendCriteriaPositionFixture,
    (ctx: AmendCriteriaPositionFixtureCtx) => amendPositionBaseArgs(ctx),
    (ctx: AmendCriteriaPositionFixtureCtx) => ({ ...amendPositionBaseArgs(ctx), position: 0 }),
    (structured, rt, ctx: AmendCriteriaPositionFixtureCtx) => {
      const order = readThreadRecord(rt, ctx.threadId)?.completion_criteria.map((c) => c.id) ?? []
      return { inserted_at_front: order[0] === structured.criterion_id }
    }
  )

const resumeThreadFocusRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'resume_thread.focus',
    resumeThreadTool,
    (rt) => openFixtureThread(rt, 'resume-thread'),
    (ctx: ThreadFixtureCtx) => ({ thread_id: ctx.threadId }),
    (ctx: ThreadFixtureCtx) => ({ thread_id: ctx.threadId, focus: [mustGet(ctx.criterionIds, 0, 'the resume fixture criterion id')] }),
    (structured) => ({ focus: structured.focus })
  )

type ParkThreadFixtureCtx = { threadId: string }

const openParkThreadFixture = async (rt: Runtime): Promise<ParkThreadFixtureCtx> => {
  const { threadId } = await openFixtureThread(rt, 'park-thread')
  await openFixtureThread(rt, 'park-thread-other')
  const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
  if (!resumed.ok) throw new Error('optional-argument-recipes: expected the park_thread fixture pointer to be set')
  return { threadId }
}

const openParkThreadCrossSessionFixture = async (rt: Runtime): Promise<ParkThreadFixtureCtx> => {
  const { threadId } = await openFixtureThread(rt, 'park-thread-cross-session')
  const otherSessionRt = testRuntime({ env: rt.env, cwd: rt.cwd, sessionId: 'a-different-session' })
  const resumed = await resumeThreadTool.handler(otherSessionRt, STUB_TOOL_CTX, { thread_id: threadId })
  if (!resumed.ok) throw new Error('optional-argument-recipes: expected the park_thread cross-session fixture pointer to be set')
  return { threadId }
}

type ParkFieldSpec = {
  field: string
  setup: (rt: Runtime) => Promise<ParkThreadFixtureCtx>
  sentinelArgs: (ctx: ParkThreadFixtureCtx) => Record<string, unknown>
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: ParkThreadFixtureCtx) => Record<string, unknown>
}

const PARK_FIELDS: ParkFieldSpec[] = [
  {
    field: 'outcome',
    setup: openParkThreadFixture,
    sentinelArgs: () => ({ outcome: 'sentinel park outcome text' }),
    extract: (structured, rt, ctx) => {
      const entryId = (structured.session_entry_ids as string[])[0]
      const entry = entryId === undefined ? null : readSessionEntryRecord(rt, ctx.threadId, entryId)
      return { session_entry_ids: structured.session_entry_ids, session_entry_body: entry?.body ?? null }
    }
  },
  {
    field: 'thread_id',
    setup: openParkThreadCrossSessionFixture,
    sentinelArgs: (ctx) => ({ thread_id: ctx.threadId }),
    extract: (structured) => ({
      parked: structured.status === 'parked',
      parked_thread_ids: (structured.parked_thread_ids as string[]).join(',')
    })
  },
  {
    field: 'next_step',
    setup: openParkThreadFixture,
    sentinelArgs: () => ({ next_step: 'sentinel park next step text' }),
    extract: (structured, rt, ctx) => ({
      spine_fields_updated: structured.spine_fields_updated,
      next_step: readThreadRecord(rt, ctx.threadId)?.spine.next_step ?? ''
    })
  }
]

const parkThreadRecipes: [string, () => Promise<RecipeResult>][] = PARK_FIELDS.map((spec) => [
  `park_thread.${spec.field}`,
  () => runOptionalArgRecipe(`park_thread.${spec.field}`, parkThreadTool, spec.setup, () => ({}), spec.sentinelArgs, spec.extract)
])

type RecordDecisionFieldSpec = {
  field: string
  sentinelExtra: (ctx: ThreadFixtureCtx) => Record<string, unknown>
  extract: (structured: Record<string, unknown>, rt: Runtime, ctx: ThreadFixtureCtx) => Record<string, unknown>
}

const keyDecisionFor = (rt: Runtime, ctx: ThreadFixtureCtx, decisionId: string) =>
  readThreadRecord(rt, ctx.threadId)?.spine.key_decisions.find((kd) => kd.decision_id === decisionId)

const RECORD_DECISION_SIMPLE_FIELDS: RecordDecisionFieldSpec[] = [
  {
    field: 'scope',
    sentinelExtra: () => ({ scope: 'sentinel scope text' }),
    extract: (structured, rt, ctx) => ({
      structured_scope: structured.scope,
      key_decision_scope: keyDecisionFor(rt, ctx, mustBeString(structured.decision_id, 'the recorded decision id'))?.scope ?? ''
    })
  },
  {
    field: 'criterion_id',
    sentinelExtra: (ctx) => ({ criterion_id: mustGet(ctx.criterionIds, 0, 'the record_decision fixture criterion id') }),
    extract: (structured, rt, ctx) => ({
      criterion_id:
        keyDecisionFor(rt, ctx, mustBeString(structured.decision_id, 'the recorded decision id'))?.criterion_id ?? null
    })
  }
]

const recordDecisionSimpleRecipes: [string, () => Promise<RecipeResult>][] = RECORD_DECISION_SIMPLE_FIELDS.map((spec) => [
  `record_decision.${spec.field}`,
  () =>
    runOptionalArgRecipe(
      `record_decision.${spec.field}`,
      recordDecisionTool,
      (rt) => openFixtureThread(rt, 'record-decision'),
      (ctx: ThreadFixtureCtx) => decisionArgs(ctx.threadId, `a ${spec.field} probe decision`),
      (ctx: ThreadFixtureCtx) => decisionArgs(ctx.threadId, `a ${spec.field} probe decision`, spec.sentinelExtra(ctx)),
      spec.extract
    )
])

type RecordDecisionSupersedesFixtureCtx = ThreadFixtureCtx & { priorDecisionId: string }

const openRecordDecisionSupersedesFixture = async (rt: Runtime): Promise<RecordDecisionSupersedesFixtureCtx> => {
  const base = await openFixtureThread(rt, 'record-decision-supersedes')
  const priorDecisionId = await recordFixtureDecision(rt, base.threadId, 'a prior fixture decision')
  return { ...base, priorDecisionId }
}

const recordDecisionSupersedesRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'record_decision.supersedes',
    recordDecisionTool,
    openRecordDecisionSupersedesFixture,
    (ctx: RecordDecisionSupersedesFixtureCtx) => decisionArgs(ctx.threadId, 'a supersedes probe decision'),
    (ctx: RecordDecisionSupersedesFixtureCtx) =>
      decisionArgs(ctx.threadId, 'a supersedes probe decision', { supersedes: [ctx.priorDecisionId] }),
    (structured, rt) => ({
      supersedes: (
        readDecisionRecord(rt, mustBeString(structured.decision_id, 'the recorded decision id'))?.supersedes ?? []
      ).join(',')
    })
  )

type ListThreadsFixtureCtx = { knownCursor: string | null }

const openListThreadsFixture = async (rt: Runtime): Promise<ListThreadsFixtureCtx> => {
  await openFixtureThread(rt, 'list-threads-one')
  await openFixtureThread(rt, 'list-threads-two')
  const page = await listThreadsTool.handler(rt, STUB_TOOL_CTX, { limit: 1 })
  if (!page.ok) throw new Error('optional-argument-recipes: expected the list_threads probe page to succeed')
  return { knownCursor: page.structured.next_cursor as string | null }
}

const listThreadsCursorRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'list_threads.cursor',
    listThreadsTool,
    openListThreadsFixture,
    () => ({}),
    (ctx: ListThreadsFixtureCtx) => (ctx.knownCursor === null ? {} : { cursor: ctx.knownCursor }),
    (structured, rt, ctx: ListThreadsFixtureCtx) => ({
      cursor_row_excluded:
        ctx.knownCursor !== null &&
        !(structured.threads as { id: string }[]).some((row) => row.id === ctx.knownCursor)
    })
  )

const listThreadsLimitRecipe = (): Promise<RecipeResult> =>
  runOptionalArgRecipe(
    'list_threads.limit',
    listThreadsTool,
    openListThreadsFixture,
    () => ({}),
    () => ({ limit: 1 }),
    (structured) => ({ next_cursor: structured.next_cursor })
  )

export const RECIPES: ReadonlyMap<string, () => Promise<RecipeResult>> = new Map([
  ['open_thread.predecessor_id', openThreadPredecessorIdRecipe],
  ...simpleUpdateThreadRecipes,
  ['update_thread.risks_add[].refs', updateThreadRisksAddRefsRecipe],
  ['update_thread.risks_add[].criterion_id', updateThreadRisksAddCriterionIdRecipe],
  ['amend_criteria.criterion_id', amendCriteriaCriterionIdRecipe],
  ['amend_criteria.text', amendCriteriaTextRecipe],
  ['amend_criteria.kind', amendCriteriaKindRecipe],
  ['amend_criteria.check', amendCriteriaCheckRecipe],
  ['amend_criteria.position', amendCriteriaPositionRecipe],
  ['resume_thread.focus', resumeThreadFocusRecipe],
  ...parkThreadRecipes,
  ...recordDecisionSimpleRecipes,
  ['record_decision.supersedes', recordDecisionSupersedesRecipe],
  ['list_threads.cursor', listThreadsCursorRecipe],
  ['list_threads.limit', listThreadsLimitRecipe]
])

export type Test2Case = {
  tool: string
  handler: AnyTool
  setup: (rt: Runtime) => Promise<Record<string, unknown>>
  minimalArgs: (ctx: Record<string, unknown>) => Record<string, unknown>
  attributable: (structured: Record<string, unknown>) => Record<string, unknown>
}

export const TEST_2_CASES: Test2Case[] = [
  {
    tool: 'open_thread',
    handler: openThreadTool,
    setup: async () => ({}),
    minimalArgs: () => ({
      title: 'test-2 open_thread fixture thread',
      slug: 'test-2-open-thread-fixture-thread',
      completion_criteria: [{ text: 'a test-2 fixture criterion', check: 'a test-2 fixture check' }]
    }),
    attributable: () => ({})
  },
  {
    tool: 'update_thread',
    handler: updateThreadTool,
    setup: async (rt) => openFixtureThread(rt, 'test-2 update_thread'),
    minimalArgs: (ctx) => ({ thread_id: ctx.threadId }),
    attributable: (structured) => ({
      criteria_marked_done: structured.criteria_marked_done,
      spine_fields_updated: structured.spine_fields_updated,
      risks_added: structured.risks_added,
      risks_retired: structured.risks_retired,
      key_decisions_added: structured.key_decisions_added,
      out_of_scope_added: structured.out_of_scope_added,
      blocked_by_set: structured.blocked_by_set,
      focus_written: structured.focus_written,
      focus_not_written_reason: structured.focus_not_written_reason
    })
  },
  {
    tool: 'amend_criteria',
    handler: amendCriteriaTool,
    setup: openAmendCriteriaFixture,
    minimalArgs: (ctx) => ({
      thread_id: ctx.threadId,
      operation: 'strike',
      decision_id: ctx.decisionId,
      criterion_id: mustGet(
        mustBeStringArray(ctx.criterionIds, 'the test-2 amend_criteria fixture criterion ids'),
        0,
        'the first test-2 amend_criteria fixture criterion id'
      )
    }),
    attributable: () => ({})
  },
  {
    tool: 'resume_thread',
    handler: resumeThreadTool,
    setup: async (rt) => openFixtureThread(rt, 'test-2 resume_thread'),
    minimalArgs: (ctx) => ({ thread_id: ctx.threadId }),
    attributable: (structured) => ({ focus: structured.focus })
  },
  {
    tool: 'park_thread',
    handler: parkThreadTool,
    setup: async () => ({}),
    minimalArgs: () => ({}),
    attributable: (structured) => ({
      parked_thread_ids: structured.parked_thread_ids,
      session_entry_ids: structured.session_entry_ids,
      spine_fields_updated: structured.spine_fields_updated
    })
  },
  {
    tool: 'record_decision',
    handler: recordDecisionTool,
    setup: async (rt) => openFixtureThread(rt, 'test-2 record_decision'),
    minimalArgs: (ctx) => decisionArgs(ctx.threadId as string, 'a test-2 record_decision fixture'),
    attributable: (structured) => ({ scope: structured.scope })
  },
  {
    tool: 'list_threads',
    handler: listThreadsTool,
    setup: async () => ({}),
    minimalArgs: () => ({}),
    attributable: (structured) => ({ next_cursor: structured.next_cursor })
  }
]
