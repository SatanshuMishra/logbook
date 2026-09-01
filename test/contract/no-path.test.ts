import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Refusal } from '../../src/schema/declare.ts'
import type { Criterion, Thread } from '../../src/schema/thread.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import * as caps from '../../src/schema/caps.ts'
import { toolRefusal } from '../../src/server/errors.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { closeThreadTool } from '../../src/server/tools/close_thread.ts'
import { bindBranchTool } from '../../src/server/tools/bind_branch.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { parkThreadTool } from '../../src/server/tools/park_thread.ts'
import { listThreadsTool } from '../../src/server/tools/list_threads.ts'
import {
  recordDecisionTool,
  invalidDecisionRefusal,
  noOpenCriterionRefusal
} from '../../src/server/tools/record_decision.ts'
import { logSessionEventTool, invalidSessionEntryRefusal } from '../../src/server/tools/log_session_event.ts'
import { syncLedgerTool } from '../../src/server/tools/sync_ledger.ts'
import { writeRecords } from '../../src/store/write-path.ts'
import {
  resolveConflictTool,
  unclassifiableRecordRefusal,
  divergenceUnverifiableRefusal
} from '../../src/server/tools/resolve_conflict.ts'
import { commitThread, loadThread, loadThreadForReference, openProjectStore } from '../../src/server/tool-support.ts'
import { git, readIdentity, type Identity } from '../../src/store/git.ts'
import { createStoreDirectories, layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { LEDGER_REF, casUpdateRef } from '../../src/store/ref.ts'
import { ensureSingleStore } from '../../src/store/single-store.ts'
import { withDetail } from '../../src/store/detail.ts'
import { insertCriterion, rewriteCriterion, strikeCriterion } from '../../src/domain/criteria.ts'
import { contributeToSpine } from '../../src/domain/spine.ts'
import { transition } from '../../src/domain/lifecycle.ts'
import { rawGit, withRepo, withRepoNoIdentity } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import {
  deriveExpectedRecordMethodsFiles,
  deriveExpectedToolHandlerFiles,
  deriveObjectDescentCandidates,
  producerSourceFile
} from '../support/object-descent-domain.ts'
import type { ObjectDescentCandidate, ObjectDescentFamily } from '../support/object-descent-domain.ts'
import {
  SENTINEL_POSIX,
  SENTINEL_TOKEN,
  SENTINEL_WIN32,
  classifyEmittedPath,
  emittedStrings,
  refusalTemplate,
  scanRefusalProducers,
  taintRefusal
} from '../support/refusal-census.ts'
import type { EmittedString, ProducerId } from '../support/refusal-census.ts'

type TaggedRefusal = { producer: ProducerId; refusal: Refusal }

const REFUSE_PRODUCER: ProducerId = 'schema/refusal.ts#refuse'
const LAYOUT_FOR_PRODUCER: ProducerId = 'store/layout.ts#layoutFor'
const CAS_UPDATE_REF_PRODUCER: ProducerId = 'store/ref.ts#casUpdateRef'
const READ_IDENTITY_PRODUCER: ProducerId = 'store/git.ts#readIdentity'
const ENSURE_SINGLE_STORE_PRODUCER: ProducerId = 'store/single-store.ts#ensureSingleStore'
const OPEN_STORE_PRODUCER: ProducerId = 'store/records.ts#openStore'
const WITH_DETAIL_PRODUCER: ProducerId = 'store/detail.ts#withDetail'
const INSERT_CRITERION_PRODUCER: ProducerId = 'domain/criteria.ts#insertCriterion'
const REWRITE_CRITERION_PRODUCER: ProducerId = 'domain/criteria.ts#rewriteCriterion'
const STRIKE_CRITERION_PRODUCER: ProducerId = 'domain/criteria.ts#strikeCriterion'
const CONTRIBUTE_TO_SPINE_PRODUCER: ProducerId = 'domain/spine.ts#contributeToSpine'
const TRANSITION_PRODUCER: ProducerId = 'domain/lifecycle.ts#transition'
const OPEN_THREAD_DUPLICATE_SLUG_PRODUCER: ProducerId = 'server/tools/open_thread.ts#duplicateSlugRefusal'
const UPDATE_THREAD_UNKNOWN_CRITERION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownCriterionRefusal'
const UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownDecisionRefusal'
const UPDATE_THREAD_CONFLICTING_BLOCKAGE_PRODUCER: ProducerId =
  'server/tools/update_thread.ts#conflictingBlockageRefusal'
const UPDATE_THREAD_BLOCKED_BY_CAP_PRODUCER: ProducerId = 'server/tools/update_thread.ts#blockedByCapRefusal'
const UPDATE_THREAD_UNKNOWN_FOCUS_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownFocusRefusal'
const CLOSE_THREAD_WHOLE_RECORD_CAP_PRODUCER: ProducerId = 'server/tools/close_thread.ts#wholeRecordCapRefusal'
const CLOSE_THREAD_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/close_thread.ts#commitFailureRefusal'
const BIND_BRANCH_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/bind_branch.ts#commitFailureRefusal'
const BIND_BRANCH_INVALID_BINDING_PRODUCER: ProducerId = 'server/tools/bind_branch.ts#invalidBindingRefusal'
const AMEND_CRITERIA_MISSING_FIELD_PRODUCER: ProducerId = 'server/tools/amend_criteria.ts#missingFieldRefusal'
const OPEN_PROJECT_STORE_PRODUCER: ProducerId = 'server/tool-support.ts#openProjectStore'
const LOAD_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#loadThread'
const LOAD_THREAD_FOR_REFERENCE_PRODUCER: ProducerId = 'server/tool-support.ts#loadThreadForReference'
const COMMIT_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#commitThread'
const BINDING_RECORD_PARSE_PRODUCER: ProducerId = 'schema/binding.ts#BindingRecord.parse'
const BINDING_RECORD_REFUSE_PRODUCER: ProducerId = 'schema/binding.ts#BindingRecord.refuse'
const DECISION_RECORD_PARSE_PRODUCER: ProducerId = 'schema/decision.ts#DecisionRecord.parse'
const DECISION_RECORD_REFUSE_PRODUCER: ProducerId = 'schema/decision.ts#DecisionRecord.refuse'
const SESSION_RECORD_PARSE_PRODUCER: ProducerId = 'schema/session.ts#SessionRecord.parse'
const SESSION_RECORD_REFUSE_PRODUCER: ProducerId = 'schema/session.ts#SessionRecord.refuse'
const THREAD_RECORD_PARSE_PRODUCER: ProducerId = 'schema/thread.ts#ThreadRecord.parse'
const THREAD_RECORD_REFUSE_PRODUCER: ProducerId = 'schema/thread.ts#ThreadRecord.refuse'
const AMEND_CRITERIA_HANDLER_PRODUCER: ProducerId = 'server/tools/amend_criteria.ts#amendCriteriaTool.handler'
const BIND_BRANCH_HANDLER_PRODUCER: ProducerId = 'server/tools/bind_branch.ts#bindBranchTool.handler'
const CLOSE_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/close_thread.ts#closeThreadTool.handler'
const LIST_THREADS_HANDLER_PRODUCER: ProducerId = 'server/tools/list_threads.ts#listThreadsTool.handler'
const OPEN_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/open_thread.ts#openThreadTool.handler'
const PARK_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/park_thread.ts#parkThreadTool.handler'
const RESUME_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/resume_thread.ts#resumeThreadTool.handler'
const RESUME_THREAD_UNKNOWN_FOCUS_PRODUCER: ProducerId = 'server/tools/resume_thread.ts#unknownFocusRefusal'
const UPDATE_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/update_thread.ts#updateThreadTool.handler'

const RECORD_DECISION_TITLE_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#titleCapRefusal'
const RECORD_DECISION_CONTEXT_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#contextCapRefusal'
const RECORD_DECISION_OUTCOME_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#outcomeCapRefusal'
const RECORD_DECISION_OPTION_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#optionCapRefusal'
const RECORD_DECISION_INVALID_PRODUCER: ProducerId = 'server/tools/record_decision.ts#invalidDecisionRefusal'
const RECORD_DECISION_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/record_decision.ts#commitFailureRefusal'
const RECORD_DECISION_SCOPE_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#scopeCapRefusal'
const RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER: ProducerId = 'server/tools/record_decision.ts#noOpenCriterionRefusal'
const RECORD_DECISION_HANDLER_PRODUCER: ProducerId = 'server/tools/record_decision.ts#recordDecisionTool.handler'

const LOG_SESSION_EVENT_ACTOR_CAP_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#actorCapRefusal'
const LOG_SESSION_EVENT_RESERVED_ACTOR_PREFIX_PRODUCER: ProducerId =
  'server/tools/log_session_event.ts#reservedActorPrefixRefusal'
const LOG_SESSION_EVENT_BODY_CAP_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#bodyCapRefusal'
const LOG_SESSION_EVENT_INVALID_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#invalidSessionEntryRefusal'
const LOG_SESSION_EVENT_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#commitFailureRefusal'
const LOG_SESSION_EVENT_HANDLER_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#logSessionEventTool.handler'

const SYNC_LEDGER_OFFLINE_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#offlineRefusal'
const SYNC_LEDGER_REJECTED_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#rejectedRefusal'
const SYNC_LEDGER_CONFLICT_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#conflictRefusal'
const SYNC_LEDGER_UNPARSEABLE_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#unparseableRecordsRefusal'
const SYNC_LEDGER_HANDLER_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#syncLedgerTool.handler'

const RESOLVE_CONFLICT_NO_CONFLICTS_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#noConflictsRefusal'
const RESOLVE_CONFLICT_UNREADABLE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#conflictsUnreadableRefusal'
const RESOLVE_CONFLICT_CORRUPT_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#corruptConflictsRefusal'
const RESOLVE_CONFLICT_DUPLICATE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#duplicateResolutionRefusal'
const RESOLVE_CONFLICT_UNRECOGNISED_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#unrecognisedResolutionRefusal'
const RESOLVE_CONFLICT_MISSING_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#missingResolutionRefusal'
const RESOLVE_CONFLICT_THREAD_UNAVAILABLE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#threadUnavailableRefusal'
const RESOLVE_CONFLICT_STALE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#staleRecordedValueRefusal'
const RESOLVE_CONFLICT_UNCLASSIFIABLE_FIELD_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#unclassifiableFieldRefusal'
const RESOLVE_CONFLICT_UNCLASSIFIABLE_RECORD_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#unclassifiableRecordRefusal'
const RESOLVE_CONFLICT_INVALID_THREAD_PRODUCER: ProducerId =
  'server/tools/resolve_conflict.ts#invalidThreadAfterResolutionRefusal'
const RESOLVE_CONFLICT_INVALID_DECISION_PRODUCER: ProducerId =
  'server/tools/resolve_conflict.ts#invalidDecisionAfterResolutionRefusal'
const RESOLVE_CONFLICT_NO_REMOTE_POSITION_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#noRemotePositionRefusal'
const RESOLVE_CONFLICT_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#commitFailureRefusal'
const RESOLVE_CONFLICT_UNSAFE_DIVERGENCE_PRODUCER: ProducerId =
  'server/tools/resolve_conflict.ts#unsafeRemoteDivergenceRefusal'
const RESOLVE_CONFLICT_DIVERGENCE_UNVERIFIABLE_PRODUCER: ProducerId =
  'server/tools/resolve_conflict.ts#divergenceUnverifiableRefusal'
const RESOLVE_CONFLICT_HANDLER_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#resolveConflictTool.handler'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const CONTROL_CHAR_OVERFLOW = (rawCount: number): string => ''.repeat(rawCount)

const censusFixtureThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'census-fixture-thread',
  title: 'Census fixture thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'census fixture goal',
    next_step: 'census fixture next step',
    last_session: 'census fixture last session',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const OVER_CAP_FILL_CHUNK_SIZES: readonly number[] = [caps.CRITERION_TEXT_MAX, 100, 20, 4, 1, 0]

const overCapProbeCriterion = (rt: Runtime, text: string): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text,
  done: false,
  kind: 'planned',
  struck_by: null
})

const buildThreadAtWholeRecordCapEdge = (rt: Runtime): Thread => {
  const base: Thread = {
    id: rt.ulid(),
    slug: 'census-over-cap-thread',
    title: 'Census over-cap thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'census over-cap goal',
      next_step: 'census over-cap next step',
      last_session: 'census over-cap last session',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }

  const sizeOf = (criteria: Criterion[]): number =>
    Buffer.byteLength(JSON.stringify({ ...base, completion_criteria: criteria }), 'utf8')

  let criteria: Criterion[] = []
  for (const chunk of OVER_CAP_FILL_CHUNK_SIZES) {
    while (true) {
      const next = [...criteria, overCapProbeCriterion(rt, 'x'.repeat(chunk))]
      if (next.length > caps.CRITERIA_RETENTION_MAX_ELEMENTS) break
      if (sizeOf(next) > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) break
      criteria = next
    }
  }
  if (criteria.length === 0) {
    throw new Error('census over-cap fixture: the multi-resolution fill added no completion criteria')
  }

  const gap = caps.THREAD_RECORD_SERIALISED_MAX_BYTES - sizeOf(criteria)
  if (gap < 0) {
    throw new Error(`census over-cap fixture: the fill already exceeds the whole-record byte cap by ${-gap} bytes`)
  }
  const lastIndex = criteria.length - 1
  const last = criteria[lastIndex] as Criterion
  const extendedText = last.text + 'x'.repeat(gap)
  if (extendedText.length > caps.CRITERION_TEXT_MAX) {
    throw new Error(
      `census over-cap fixture: closing a ${gap}-byte gap would push one criterion's text past its own ${caps.CRITERION_TEXT_MAX}-character cap`
    )
  }
  criteria = [...criteria.slice(0, lastIndex), { ...last, text: extendedText }]

  const atEdge: Thread = { ...base, completion_criteria: criteria }
  const edgeSize = Buffer.byteLength(JSON.stringify(atEdge), 'utf8')
  if (edgeSize !== caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    throw new Error(
      `census over-cap fixture: expected exactly ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes at the cap edge, computed ${edgeSize}`
    )
  }
  return atEdge
}

const buildToolFixtureRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-tool-fixture-'))
  rawGit(repo, ['init', '--initial-branch=main'])
  rawGit(repo, ['config', 'user.name', 'Logbook Tool Fixture'])
  rawGit(repo, ['config', 'user.email', 'tool-fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook tool fixture repository\n')
  rawGit(repo, ['add', 'README.md'])
  rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const collectToolRefusals = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-tool-fixture-plugin-data-'))
  const repo = buildToolFixtureRepo()
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo })

    const firstOpen = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'census tool fixture thread',
      slug: 'census-tool-fixture',
      completion_criteria: [{ text: 'a census criterion', check: 'the census check' }]
    })
    if (!firstOpen.ok) throw new Error('expected openThreadTool to open the census tool fixture thread')
    const threadId = firstOpen.structured.thread_id

    const openedStore = openProjectStore(rt)
    if (!openedStore.ok) throw new Error('expected openProjectStore to open the census tool fixture store')
    const store = openedStore.value

    const unknownThreadLoad = loadThread(store, 'thread_id', rt.ulid())
    if (unknownThreadLoad.ok) throw new Error('expected loadThread to refuse against an unknown thread id')
    refusals.push({ producer: LOAD_THREAD_PRODUCER, refusal: unknownThreadLoad.refusal })

    const unknownReferenceLoad = loadThreadForReference(store, 'predecessor_id', rt.ulid())
    if (unknownReferenceLoad.ok) throw new Error('expected loadThreadForReference to refuse against an unknown thread id')
    refusals.push({ producer: LOAD_THREAD_FOR_REFERENCE_PRODUCER, refusal: unknownReferenceLoad.refusal })

    const openProjectStoreFailureRt = testRuntime({ env: {}, cwd: repo })
    const openProjectStoreFailure = openProjectStore(openProjectStoreFailureRt)
    if (openProjectStoreFailure.ok) throw new Error('expected openProjectStore to refuse when CLAUDE_PLUGIN_DATA is unset')
    refusals.push({ producer: OPEN_PROJECT_STORE_PRODUCER, refusal: openProjectStoreFailure.refusal })

    const resumeUnknownThread = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: rt.ulid() })
    if (resumeUnknownThread.ok) throw new Error('expected resumeThreadTool to refuse an unknown thread id')
    refusals.push({ producer: RESUME_THREAD_HANDLER_PRODUCER, refusal: resumeUnknownThread.refusal })

    const resumeUnknownFocus = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      focus: [rt.ulid()]
    })
    if (resumeUnknownFocus.ok) throw new Error('expected resumeThreadTool to refuse a focus id naming no criterion on this thread')
    refusals.push({ producer: RESUME_THREAD_UNKNOWN_FOCUS_PRODUCER, refusal: resumeUnknownFocus.refusal })

    const resumeForPark = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    if (!resumeForPark.ok) throw new Error('expected resumeThreadTool to resume the census tool fixture thread')

    const oversizedOutcome = 'x'.repeat(caps.SESSION_BODY_MAX + 1)
    const parkFailure = await parkThreadTool.handler(rt, STUB_TOOL_CTX, { outcome: oversizedOutcome })
    if (parkFailure.ok) throw new Error('expected parkThreadTool to refuse an outcome that overflows the session body cap')
    refusals.push({ producer: PARK_THREAD_HANDLER_PRODUCER, refusal: parkFailure.refusal })

    const duplicateOpen = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'census tool fixture thread again',
      slug: 'census-tool-fixture',
      completion_criteria: [{ text: 'a census criterion', check: 'the census check' }]
    })
    if (duplicateOpen.ok) throw new Error('expected openThreadTool to refuse a duplicate slug')
    refusals.push({ producer: OPEN_THREAD_DUPLICATE_SLUG_PRODUCER, refusal: duplicateOpen.refusal })
    refusals.push({ producer: OPEN_THREAD_HANDLER_PRODUCER, refusal: duplicateOpen.refusal })

    const unknownCriterion = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: rt.ulid(), result: 'the census result', result_status: 'verified' }]
    })
    if (unknownCriterion.ok) throw new Error('expected updateThreadTool to refuse an unknown criterion id')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_CRITERION_PRODUCER, refusal: unknownCriterion.refusal })
    refusals.push({ producer: UPDATE_THREAD_HANDLER_PRODUCER, refusal: unknownCriterion.refusal })

    const updateUnknownFocus = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      focus: [rt.ulid()]
    })
    if (updateUnknownFocus.ok) throw new Error('expected updateThreadTool to refuse a focus id naming no criterion on this thread')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_FOCUS_PRODUCER, refusal: updateUnknownFocus.refusal })

    const unknownDecision = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      key_decisions_add: [{ decision_id: rt.ulid(), title: 'a census decision', scope: 'a census scope' }]
    })
    if (unknownDecision.ok) throw new Error('expected updateThreadTool to refuse an unresolved decision id')
    refusals.push({ producer: UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER, refusal: unknownDecision.refusal })

    const conflictingBlockage = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      blocked_by: 'waiting on the infra approval',
      blocked_by_clear: true
    })
    if (conflictingBlockage.ok) {
      throw new Error('expected updateThreadTool to refuse a blockage that is both set and cleared in one call')
    }
    refusals.push({
      producer: UPDATE_THREAD_CONFLICTING_BLOCKAGE_PRODUCER,
      refusal: conflictingBlockage.refusal
    })

    const overflowingBlockedBy = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      blocked_by: CONTROL_CHAR_OVERFLOW(84)
    })
    if (overflowingBlockedBy.ok) {
      throw new Error('expected updateThreadTool to refuse a blocked_by whose escaped form overflows its cap')
    }
    refusals.push({
      producer: UPDATE_THREAD_BLOCKED_BY_CAP_PRODUCER,
      refusal: overflowingBlockedBy.refusal
    })

    const missingKind = await amendCriteriaTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: rt.ulid(),
      text: 'a census amendment'
    })
    if (missingKind.ok) throw new Error('expected amendCriteriaTool to refuse an insert with no kind')
    refusals.push({ producer: AMEND_CRITERIA_MISSING_FIELD_PRODUCER, refusal: missingKind.refusal })
    refusals.push({ producer: AMEND_CRITERIA_HANDLER_PRODUCER, refusal: missingKind.refusal })

    const overflowingBranch = String.fromCharCode(1).repeat(50) + 'a'.repeat(205)
    const invalidBinding = await bindBranchTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      branch: overflowingBranch
    })
    if (invalidBinding.ok) throw new Error('expected bindBranchTool to refuse a branch that overflows its cap once escaped')
    refusals.push({ producer: BIND_BRANCH_INVALID_BINDING_PRODUCER, refusal: invalidBinding.refusal })
    refusals.push({ producer: BIND_BRANCH_HANDLER_PRODUCER, refusal: invalidBinding.refusal })

    const overCapThread = buildThreadAtWholeRecordCapEdge(rt)
    const overCapSeed = store.commit([{ kind: 'thread', record: overCapThread }], 'seed census over-cap thread fixture')
    if (!overCapSeed.ok) throw new Error('expected the census over-cap thread fixture to seed successfully')
    const overCapClose = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: overCapThread.id,
      outcome: 'abandoned',
      detail: 'census whole-record cap probe'
    })
    if (overCapClose.ok) {
      throw new Error('expected closeThreadTool to refuse when closing a thread already at the byte-cap edge pushes it over the cap')
    }
    refusals.push({ producer: CLOSE_THREAD_WHOLE_RECORD_CAP_PRODUCER, refusal: overCapClose.refusal })
    refusals.push({ producer: CLOSE_THREAD_HANDLER_PRODUCER, refusal: overCapClose.refusal })

    const titleOverflow = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: CONTROL_CHAR_OVERFLOW(34),
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome'
    })
    if (titleOverflow.ok) throw new Error('expected recordDecisionTool to refuse a title that overflows its cap once escaped')
    refusals.push({ producer: RECORD_DECISION_TITLE_CAP_PRODUCER, refusal: titleOverflow.refusal })
    refusals.push({ producer: RECORD_DECISION_HANDLER_PRODUCER, refusal: titleOverflow.refusal })

    const contextOverflow = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: CONTROL_CHAR_OVERFLOW(667),
      options: ['a census option'],
      outcome: 'a census outcome'
    })
    if (contextOverflow.ok) {
      throw new Error('expected recordDecisionTool to refuse a context that overflows its cap once escaped')
    }
    refusals.push({ producer: RECORD_DECISION_CONTEXT_CAP_PRODUCER, refusal: contextOverflow.refusal })

    const outcomeOverflow = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: CONTROL_CHAR_OVERFLOW(667)
    })
    if (outcomeOverflow.ok) {
      throw new Error('expected recordDecisionTool to refuse an outcome that overflows its cap once escaped')
    }
    refusals.push({ producer: RECORD_DECISION_OUTCOME_CAP_PRODUCER, refusal: outcomeOverflow.refusal })

    const optionOverflow = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: [CONTROL_CHAR_OVERFLOW(84)],
      outcome: 'a census outcome'
    })
    if (optionOverflow.ok) throw new Error('expected recordDecisionTool to refuse an option that overflows its cap once escaped')
    refusals.push({ producer: RECORD_DECISION_OPTION_CAP_PRODUCER, refusal: optionOverflow.refusal })

    const scopeOverflow = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome',
      scope: CONTROL_CHAR_OVERFLOW(34)
    })
    if (scopeOverflow.ok) throw new Error('expected recordDecisionTool to refuse a scope that overflows its cap once escaped')
    refusals.push({ producer: RECORD_DECISION_SCOPE_CAP_PRODUCER, refusal: scopeOverflow.refusal })
    refusals.push({ producer: RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER, refusal: noOpenCriterionRefusal(threadId) })

    const actorOverflow = await logSessionEventTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      actor: CONTROL_CHAR_OVERFLOW(17),
      body: 'a census body'
    })
    if (actorOverflow.ok) throw new Error('expected logSessionEventTool to refuse an actor that overflows its cap once escaped')
    refusals.push({ producer: LOG_SESSION_EVENT_ACTOR_CAP_PRODUCER, refusal: actorOverflow.refusal })
    refusals.push({ producer: LOG_SESSION_EVENT_HANDLER_PRODUCER, refusal: actorOverflow.refusal })

    const reservedActorPrefix = await logSessionEventTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      actor: 'logbook:park_thread',
      body: 'a census body'
    })
    if (reservedActorPrefix.ok) {
      throw new Error('expected logSessionEventTool to refuse an actor beginning with the reserved prefix')
    }
    refusals.push({ producer: LOG_SESSION_EVENT_RESERVED_ACTOR_PREFIX_PRODUCER, refusal: reservedActorPrefix.refusal })

    const bodyOverflow = await logSessionEventTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      actor: 'claude',
      body: CONTROL_CHAR_OVERFLOW(1400)
    })
    if (bodyOverflow.ok) throw new Error('expected logSessionEventTool to refuse a body that overflows its cap once escaped')
    refusals.push({ producer: LOG_SESSION_EVENT_BODY_CAP_PRODUCER, refusal: bodyOverflow.refusal })

    rawGit(repo, ['config', '--unset', 'user.name'])
    rawGit(repo, ['config', '--unset', 'user.email'])

    const threadForCommitFailure = store.readThread(threadId)
    if (threadForCommitFailure === null || threadForCommitFailure.quarantined) {
      throw new Error('expected the census fixture thread to still read back for the commitThread probe')
    }
    const commitThreadFailure = commitThread(store, threadForCommitFailure.record, 'census commitThread failure probe')
    if (commitThreadFailure.ok) throw new Error('expected commitThread to refuse when the ledger commit cannot complete')
    refusals.push({ producer: COMMIT_THREAD_PRODUCER, refusal: commitThreadFailure.refusal })

    const bindCommitFailure = await bindBranchTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      branch: 'census-commit-failure-branch'
    })
    if (bindCommitFailure.ok) throw new Error('expected bindBranchTool to refuse when the ledger commit cannot complete')
    refusals.push({ producer: BIND_BRANCH_COMMIT_FAILURE_PRODUCER, refusal: bindCommitFailure.refusal })

    const closeCommitFailure = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      outcome: 'abandoned',
      detail: 'census commit-failure probe'
    })
    if (closeCommitFailure.ok) throw new Error('expected closeThreadTool to refuse when the ledger commit cannot complete')
    refusals.push({ producer: CLOSE_THREAD_COMMIT_FAILURE_PRODUCER, refusal: closeCommitFailure.refusal })

    const recordDecisionCommitFailure = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome'
    })
    if (recordDecisionCommitFailure.ok) {
      throw new Error('expected recordDecisionTool to refuse when the ledger commit cannot complete')
    }
    refusals.push({ producer: RECORD_DECISION_COMMIT_FAILURE_PRODUCER, refusal: recordDecisionCommitFailure.refusal })

    const logSessionEventCommitFailure = await logSessionEventTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      actor: 'claude',
      body: 'a census body'
    })
    if (logSessionEventCommitFailure.ok) {
      throw new Error('expected logSessionEventTool to refuse when the ledger commit cannot complete')
    }
    refusals.push({ producer: LOG_SESSION_EVENT_COMMIT_FAILURE_PRODUCER, refusal: logSessionEventCommitFailure.refusal })

    const listThreadsUnknownCursor = await listThreadsTool.handler(rt, STUB_TOOL_CTX, { cursor: rt.ulid() })
    if (listThreadsUnknownCursor.ok) throw new Error('expected listThreadsTool to refuse an unknown cursor')
    refusals.push({ producer: LIST_THREADS_HANDLER_PRODUCER, refusal: listThreadsUnknownCursor.refusal })

    const listThreadsOutOfRangeLimit = await listThreadsTool.handler(rt, STUB_TOOL_CTX, { limit: 0 })
    if (listThreadsOutOfRangeLimit.ok) throw new Error('expected listThreadsTool to refuse an out-of-range limit')
    refusals.push({ producer: LIST_THREADS_HANDLER_PRODUCER, refusal: listThreadsOutOfRangeLimit.refusal })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }

  return refusals
}

const collectSchemaRecordRefusals = (): TaggedRefusal[] => {
  const refusals: TaggedRefusal[] = []

  const bindingParse = BindingRecord.parse({})
  if (bindingParse.ok) throw new Error('expected BindingRecord.parse to refuse an empty binding')
  refusals.push({ producer: BINDING_RECORD_PARSE_PRODUCER, refusal: bindingParse })

  const bindingIssues = BindingRecord.schema.safeParse({})
  if (bindingIssues.success) throw new Error('expected the binding schema to reject an empty object')
  refusals.push({ producer: BINDING_RECORD_REFUSE_PRODUCER, refusal: BindingRecord.refuse(bindingIssues.error.issues) })

  const decisionParse = DecisionRecord.parse({})
  if (decisionParse.ok) throw new Error('expected DecisionRecord.parse to refuse an empty decision')
  refusals.push({ producer: DECISION_RECORD_PARSE_PRODUCER, refusal: decisionParse })

  const decisionIssues = DecisionRecord.schema.safeParse({})
  if (decisionIssues.success) throw new Error('expected the decision schema to reject an empty object')
  refusals.push({ producer: DECISION_RECORD_REFUSE_PRODUCER, refusal: DecisionRecord.refuse(decisionIssues.error.issues) })

  const sessionParse = SessionRecord.parse({})
  if (sessionParse.ok) throw new Error('expected SessionRecord.parse to refuse an empty session entry')
  refusals.push({ producer: SESSION_RECORD_PARSE_PRODUCER, refusal: sessionParse })

  const sessionIssues = SessionRecord.schema.safeParse({})
  if (sessionIssues.success) throw new Error('expected the session schema to reject an empty object')
  refusals.push({ producer: SESSION_RECORD_REFUSE_PRODUCER, refusal: SessionRecord.refuse(sessionIssues.error.issues) })

  const threadIssues = ThreadRecord.schema.safeParse({})
  if (threadIssues.success) throw new Error('expected the thread schema to reject an empty object')
  refusals.push({ producer: THREAD_RECORD_REFUSE_PRODUCER, refusal: ThreadRecord.refuse(threadIssues.error.issues) })

  return refusals
}

const collectDefensiveGuardRefusals = (): TaggedRefusal[] => {
  const refusals: TaggedRefusal[] = []

  const decisionParseForGuard = DecisionRecord.parse({})
  if (decisionParseForGuard.ok) throw new Error('expected DecisionRecord.parse to refuse an empty decision')
  refusals.push({
    producer: RECORD_DECISION_INVALID_PRODUCER,
    refusal: invalidDecisionRefusal(decisionParseForGuard.message)
  })

  const sessionParseForGuard = SessionRecord.parse({})
  if (sessionParseForGuard.ok) throw new Error('expected SessionRecord.parse to refuse an empty session entry')
  refusals.push({
    producer: LOG_SESSION_EVENT_INVALID_PRODUCER,
    refusal: invalidSessionEntryRefusal(sessionParseForGuard.message)
  })

  refusals.push({
    producer: RESOLVE_CONFLICT_UNCLASSIFIABLE_RECORD_PRODUCER,
    refusal: unclassifiableRecordRefusal('binding:01ARZ3NDEKTSV4RRFFQ69G5FAV')
  })

  withRepo((repo) => {
    const rt = testRuntime()
    const brokenDiff = git(rt, repo, ['diff', '--name-only', 'not-a-real-revision', 'also-not-a-real-revision'])
    if (brokenDiff.ok) throw new Error('expected git diff to fail against revisions that do not exist')
    refusals.push({
      producer: RESOLVE_CONFLICT_DIVERGENCE_UNVERIFIABLE_PRODUCER,
      refusal: divergenceUnverifiableRefusal(brokenDiff.stderr.trim())
    })
  })

  return refusals
}

type ResolveConflictFixture = {
  rt: Runtime
  repo: string
  pluginDataRoot: string
  store: Store
  layout: StoreLayout
  threadId: string
  threadTitle: string
}

const buildResolveConflictFixture = async (): Promise<ResolveConflictFixture> => {
  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-resolve-fixture-plugin-data-'))
  const repo = buildToolFixtureRepo()
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo })

  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error('expected openProjectStore to open the resolve-conflict fixture store')

  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error('expected layoutFor to resolve for the resolve-conflict fixture')

  const threadTitle = 'census resolve fixture original title'
  const openedThread = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: threadTitle,
    slug: 'census-resolve-fixture',
    completion_criteria: [{ text: 'a census criterion', check: 'the census check' }]
  })
  if (!openedThread.ok) throw new Error('expected openThreadTool to open the resolve-conflict fixture thread')

  return {
    rt,
    repo,
    pluginDataRoot,
    store: opened.value,
    layout: layout.value,
    threadId: openedThread.structured.thread_id,
    threadTitle
  }
}

const cleanupResolveConflictFixture = (fixture: ResolveConflictFixture): void => {
  rmSync(fixture.repo, { recursive: true, force: true })
  rmSync(fixture.pluginDataRoot, { recursive: true, force: true })
}

const writeConflictsFixture = (fixture: ResolveConflictFixture, conflicts: readonly Record<string, unknown>[]): void => {
  mkdirSync(fixture.layout.state, { recursive: true })
  writeFileSync(join(fixture.layout.state, 'conflicts.json'), JSON.stringify(conflicts), 'utf8')
}

const singleTitleConflict = (fixture: ResolveConflictFixture, theirsTitle: string): Record<string, unknown> => ({
  record: `thread:${fixture.threadId}`,
  field: 'title',
  ours: fixture.threadTitle,
  theirs: theirsTitle
})

const collectResolveConflictSingleRepoRefusals = async (): Promise<TaggedRefusal[]> => {
  const fixture = await buildResolveConflictFixture()
  const refusals: TaggedRefusal[] = []
  try {
    const noConflicts = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' }]
    })
    if (noConflicts.ok) throw new Error('expected resolveConflictTool to refuse when no conflicts are recorded')
    refusals.push({ producer: RESOLVE_CONFLICT_NO_CONFLICTS_PRODUCER, refusal: noConflicts.refusal })

    const conflictsPath = join(fixture.layout.state, 'conflicts.json')
    mkdirSync(conflictsPath, { recursive: true })
    const unreadable = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' }]
    })
    if (unreadable.ok) throw new Error('expected resolveConflictTool to refuse when the conflicts file cannot be read')
    refusals.push({ producer: RESOLVE_CONFLICT_UNREADABLE_PRODUCER, refusal: unreadable.refusal })
    rmSync(conflictsPath, { recursive: true, force: true })

    mkdirSync(fixture.layout.state, { recursive: true })
    writeFileSync(conflictsPath, JSON.stringify({ not: 'an array' }), 'utf8')
    const corrupt = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' }]
    })
    if (corrupt.ok) throw new Error('expected resolveConflictTool to refuse when the conflicts file is not the expected shape')
    refusals.push({ producer: RESOLVE_CONFLICT_CORRUPT_PRODUCER, refusal: corrupt.refusal })

    writeConflictsFixture(fixture, [
      singleTitleConflict(fixture, 'a remote title'),
      { record: `thread:${fixture.threadId}`, field: 'spine.next_step', ours: '', theirs: 'a remote next step' }
    ])

    const duplicate = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [
        { record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' },
        { record: `thread:${fixture.threadId}`, field: 'title', winner: 'remote' }
      ]
    })
    if (duplicate.ok) throw new Error('expected resolveConflictTool to refuse a resolutions list naming the same disagreement twice')
    refusals.push({ producer: RESOLVE_CONFLICT_DUPLICATE_PRODUCER, refusal: duplicate.refusal })

    const unrecognised = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'status', winner: 'local' }]
    })
    if (unrecognised.ok) {
      throw new Error('expected resolveConflictTool to refuse a resolution naming a disagreement sync_ledger did not report')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_UNRECOGNISED_PRODUCER, refusal: unrecognised.refusal })

    const missing = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' }]
    })
    if (missing.ok) {
      throw new Error('expected resolveConflictTool to refuse a resolutions list missing one of the reported disagreements')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_MISSING_PRODUCER, refusal: missing.refusal })

    const noRemotePosition = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [
        { record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' },
        { record: `thread:${fixture.threadId}`, field: 'spine.next_step', winner: 'local' }
      ]
    })
    if (noRemotePosition.ok) {
      throw new Error('expected resolveConflictTool to refuse when no remote ledger position has ever been recorded')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_NO_REMOTE_POSITION_PRODUCER, refusal: noRemotePosition.refusal })
    refusals.push({ producer: RESOLVE_CONFLICT_HANDLER_PRODUCER, refusal: noRemotePosition.refusal })

    writeConflictsFixture(fixture, [singleTitleConflict(fixture, 'a remote title with a stale ours value')])
    const stale = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'title', winner: 'local' }]
    })
    if (stale.ok) {
      throw new Error('expected resolveConflictTool to refuse when the recorded local value no longer matches the live thread')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_STALE_PRODUCER, refusal: stale.refusal })

    writeConflictsFixture(fixture, [{ record: `thread:${fixture.threadId}`, field: 'nonexistent_field', ours: 'a', theirs: 'b' }])
    const unclassifiableField = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${fixture.threadId}`, field: 'nonexistent_field', winner: 'local' }]
    })
    if (unclassifiableField.ok) {
      throw new Error('expected resolveConflictTool to refuse a field it does not know how to apply a winner to')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_UNCLASSIFIABLE_FIELD_PRODUCER, refusal: unclassifiableField.refusal })

    const missingThreadId = fixture.rt.ulid()
    writeConflictsFixture(fixture, [{ record: `thread:${missingThreadId}`, field: 'title', ours: 'a title', theirs: 'another title' }])
    const threadUnavailable = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${missingThreadId}`, field: 'title', winner: 'local' }]
    })
    if (threadUnavailable.ok) throw new Error('expected resolveConflictTool to refuse when the named thread cannot be loaded')
    refusals.push({ producer: RESOLVE_CONFLICT_THREAD_UNAVAILABLE_PRODUCER, refusal: threadUnavailable.refusal })

    const atEdgeThread = buildThreadAtWholeRecordCapEdge(fixture.rt)
    const seededEdge = fixture.store.commit(
      [{ kind: 'thread', record: atEdgeThread }],
      'seed a whole-record-cap-edge thread for a resolve_conflict census probe'
    )
    if (!seededEdge.ok) throw new Error('expected the whole-record-cap-edge thread to seed successfully')
    const lastIndex = atEdgeThread.completion_criteria.length - 1
    const targetCriterion = atEdgeThread.completion_criteria[lastIndex]
    if (targetCriterion === undefined) {
      throw new Error('expected the whole-record-cap-edge thread to carry at least one completion criterion')
    }
    const oversizedCriterion = { ...targetCriterion, text: `${targetCriterion.text}x` }
    writeConflictsFixture(fixture, [
      {
        record: `thread:${atEdgeThread.id}`,
        field: `completion_criteria[${targetCriterion.id}]`,
        ours: targetCriterion,
        theirs: oversizedCriterion
      }
    ])
    const invalidThread = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${atEdgeThread.id}`, field: `completion_criteria[${targetCriterion.id}]`, winner: 'remote' }]
    })
    if (invalidThread.ok) {
      throw new Error('expected resolveConflictTool to refuse a winner that would push the thread past its whole-record byte cap')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_INVALID_THREAD_PRODUCER, refusal: invalidThread.refusal })

    const recordedDecision = await recordDecisionTool.handler(fixture.rt, STUB_TOOL_CTX, {
      thread_id: fixture.threadId,
      title: 'a census decision title',
      context: 'a census decision context',
      options: ['a census option'],
      outcome: 'a census decision outcome'
    })
    if (!recordedDecision.ok) throw new Error('expected recordDecisionTool to record the resolve-conflict decision fixture')
    const decisionId = recordedDecision.structured.decision_id
    const liveDecisionSlot = fixture.store.readDecision(decisionId)
    if (liveDecisionSlot === null || liveDecisionSlot.quarantined) {
      throw new Error('expected the recorded decision to read back cleanly')
    }
    const liveDecision = liveDecisionSlot.record
    const oversizedDecision = { ...liveDecision, title: CONTROL_CHAR_OVERFLOW(40) }
    writeConflictsFixture(fixture, [{ record: `decision:${decisionId}`, field: 'decision', ours: liveDecision, theirs: oversizedDecision }])
    const invalidDecision = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `decision:${decisionId}`, field: 'decision', winner: 'remote' }]
    })
    if (invalidDecision.ok) {
      throw new Error('expected resolveConflictTool to refuse a winning decision that fails stored-shape validation once escaped')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_INVALID_DECISION_PRODUCER, refusal: invalidDecision.refusal })
  } finally {
    cleanupResolveConflictFixture(fixture)
  }
  return refusals
}

const SYNC_FIXTURE_CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const encodeSyncFixtureUlidSuffix = (seq: number): string => {
  let value = seq
  const chars: string[] = []
  for (let i = 0; i < 16; i += 1) {
    chars.unshift(SYNC_FIXTURE_CROCKFORD_ALPHABET[value % 32] as string)
    value = Math.floor(value / 32)
  }
  return chars.join('')
}

const withDistinctSyncFixtureUlids = (rt: Runtime, timePrefix: string): Runtime => {
  let sequence = 0
  return {
    ...rt,
    ulid: () => {
      const suffix = encodeSyncFixtureUlidSuffix(sequence)
      sequence += 1
      return `${timePrefix}${suffix}`
    }
  }
}

type SyncFixtureRepo = { name: string; repo: string; pluginDataRoot: string; rt: Runtime; store: Store }

const buildSyncFixtureRepo = (
  remote: string,
  name: string,
  identity: { name: string; email: string },
  ulidTimePrefix: string
): SyncFixtureRepo => {
  const repo = mkdtempSync(join(tmpdir(), `logbook-sync-fixture-${name}-`))
  rawGit(repo, ['clone', remote, '.'])
  rawGit(repo, ['config', 'user.name', identity.name])
  rawGit(repo, ['config', 'user.email', identity.email])
  const pluginDataRoot = mkdtempSync(join(tmpdir(), `logbook-sync-fixture-plugin-data-${name}-`))
  const rt = withDistinctSyncFixtureUlids(testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo }), ulidTimePrefix)
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`expected openStore to open ${name}'s sync fixture store`)
  return { name, repo, pluginDataRoot, rt, store: opened.value }
}

const withTwoSyncFixtureRepos = async (
  fn: (ana: SyncFixtureRepo, ben: SyncFixtureRepo, remote: string) => Promise<void>
): Promise<void> => {
  const remote = mkdtempSync(join(tmpdir(), 'logbook-sync-fixture-remote-'))
  const cleanupDirs: string[] = []
  try {
    rawGit(remote, ['init', '--bare', '--initial-branch=main'])
    const ana = buildSyncFixtureRepo(remote, 'ana', { name: 'ana', email: 'ana@logbook.test' }, '01ANASYNCA')
    cleanupDirs.push(ana.repo, ana.pluginDataRoot)
    const ben = buildSyncFixtureRepo(remote, 'ben', { name: 'ben', email: 'ben@logbook.test' }, '01BENSYNCB')
    cleanupDirs.push(ben.repo, ben.pluginDataRoot)
    await fn(ana, ben, remote)
  } finally {
    for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
}

const syncFixtureThread = (rt: Runtime, slug: string, title: string): Thread => ({
  id: rt.ulid(),
  slug,
  title,
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'sync fixture goal',
    next_step: 'sync fixture next step',
    last_session: 'sync fixture last session',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const collectSyncLedgerOfflineRefusal = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  await withTwoSyncFixtureRepos(async (ana) => {
    rawGit(ana.repo, ['remote', 'set-url', 'origin', join(tmpdir(), `logbook-sync-fixture-unreachable-${randomUUID()}`)])
    const result = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (result.ok) throw new Error('expected syncLedgerTool to refuse when the remote is unreachable')
    refusals.push({ producer: SYNC_LEDGER_OFFLINE_PRODUCER, refusal: result.refusal })
  })
  return refusals
}

const collectSyncLedgerConflictAndResolveCommitFailureRefusals = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  await withTwoSyncFixtureRepos(async (ana, ben) => {
    const original = syncFixtureThread(ana.rt, 'sync-fixture-conflict-thread', 'sync fixture original title')
    const created = ana.store.commit([{ kind: 'thread', record: original }], 'ana: create sync fixture conflict thread')
    if (!created.ok) throw new Error('expected the sync-conflict fixture to seed a thread')

    const anaFirstSync = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (!anaFirstSync.ok) throw new Error('expected the sync-conflict fixture to push the initial thread')

    const benFirstSync = await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})
    if (!benFirstSync.ok) throw new Error('expected the sync-conflict fixture to fast-forward ben')

    const benSlot = ben.store.readThread(original.id)
    if (benSlot === null || benSlot.quarantined) throw new Error('expected ben to read back the sync fixture thread')
    const benEdit = ben.store.commit(
      [{ kind: 'thread', record: { ...benSlot.record, title: 'ben changed the title', updated_at: ben.rt.now() } }],
      'ben: change title'
    )
    if (!benEdit.ok) throw new Error('expected ben to commit a local title change')

    const anaSlot = ana.store.readThread(original.id)
    if (anaSlot === null || anaSlot.quarantined) throw new Error('expected ana to read back the sync fixture thread')
    const anaEdit = ana.store.commit(
      [{ kind: 'thread', record: { ...anaSlot.record, title: 'ana changed the title', updated_at: ana.rt.now() } }],
      'ana: change title'
    )
    if (!anaEdit.ok) throw new Error('expected ana to commit a local title change')

    const anaSecondSync = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (!anaSecondSync.ok) throw new Error("expected ana's conflicting title change to push cleanly")

    const benSecondSync = await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})
    if (benSecondSync.ok) throw new Error('expected syncLedgerTool to refuse when both sides changed the same field')
    refusals.push({ producer: SYNC_LEDGER_CONFLICT_PRODUCER, refusal: benSecondSync.refusal })
    refusals.push({ producer: SYNC_LEDGER_HANDLER_PRODUCER, refusal: benSecondSync.refusal })

    rawGit(ben.repo, ['config', '--unset', 'user.name'])
    rawGit(ben.repo, ['config', '--unset', 'user.email'])

    const resolveCommitFailure = await resolveConflictTool.handler(ben.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${original.id}`, field: 'title', winner: 'local' }]
    })
    if (resolveCommitFailure.ok) {
      throw new Error('expected resolveConflictTool to refuse when the ledger commit cannot complete')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_COMMIT_FAILURE_PRODUCER, refusal: resolveCommitFailure.refusal })
  })
  return refusals
}

const collectResolveConflictUnsafeDivergenceRefusal = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  await withTwoSyncFixtureRepos(async (ana, ben) => {
    const original = syncFixtureThread(ana.rt, 'sync-fixture-divergence-thread', 'sync fixture original title 2')
    const created = ana.store.commit([{ kind: 'thread', record: original }], 'ana: create divergence fixture thread')
    if (!created.ok) throw new Error('expected the divergence fixture to seed a thread')

    const anaFirstSync = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (!anaFirstSync.ok) throw new Error('expected the divergence fixture to push the initial thread')

    const benFirstSync = await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})
    if (!benFirstSync.ok) throw new Error('expected the divergence fixture to fast-forward ben')

    const benSlot = ben.store.readThread(original.id)
    if (benSlot === null || benSlot.quarantined) throw new Error('expected ben to read back the divergence fixture thread')
    const benEdit = ben.store.commit(
      [{ kind: 'thread', record: { ...benSlot.record, title: 'ben changed the title 2', updated_at: ben.rt.now() } }],
      'ben: change title 2'
    )
    if (!benEdit.ok) throw new Error('expected ben to commit a local title change')

    const anaSlot = ana.store.readThread(original.id)
    if (anaSlot === null || anaSlot.quarantined) throw new Error('expected ana to read back the divergence fixture thread')
    const anaEdit = ana.store.commit(
      [{ kind: 'thread', record: { ...anaSlot.record, title: 'ana changed the title 2', updated_at: ana.rt.now() } }],
      'ana: change title 2'
    )
    if (!anaEdit.ok) throw new Error('expected ana to commit a local title change')

    const anaDecision = await recordDecisionTool.handler(ana.rt, STUB_TOOL_CTX, {
      thread_id: original.id,
      title: 'a divergence fixture decision',
      context: 'a divergence fixture context',
      options: ['a divergence fixture option'],
      outcome: 'a divergence fixture outcome',
      scope: 'the divergence fixture'
    })
    if (!anaDecision.ok) throw new Error('expected ana to record a decision unrelated to the title conflict')

    const anaSecondSync = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (!anaSecondSync.ok) throw new Error('expected ana to push both the title change and the unrelated decision')

    const benSecondSync = await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})
    if (benSecondSync.ok) throw new Error('expected syncLedgerTool to refuse when both sides changed the title')

    const resolveDivergence = await resolveConflictTool.handler(ben.rt, STUB_TOOL_CTX, {
      resolutions: [{ record: `thread:${original.id}`, field: 'title', winner: 'local' }]
    })
    if (resolveDivergence.ok) {
      throw new Error('expected resolveConflictTool to refuse when the remote carries a change the resolution would not preserve')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_UNSAFE_DIVERGENCE_PRODUCER, refusal: resolveDivergence.refusal })
  })
  return refusals
}

const collectSyncLedgerRejectedRefusal = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  await withTwoSyncFixtureRepos(async (ana, _ben, remote) => {
    const thread = syncFixtureThread(ana.rt, 'sync-fixture-rejected', 'sync fixture rejected thread')
    const created = ana.store.commit([{ kind: 'thread', record: thread }], 'ana: create a thread for the rejected-push probe')
    if (!created.ok) throw new Error('expected the sync-rejected fixture to seed a thread')

    const lockDown = spawnSync('chmod', ['-R', 'a-w', remote])
    if (lockDown.status !== 0) throw new Error('expected chmod to lock down the bare remote for the rejected-push probe')
    try {
      const result = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
      if (result.ok) throw new Error('expected syncLedgerTool to refuse when the push to the remote is rejected')
      refusals.push({ producer: SYNC_LEDGER_REJECTED_PRODUCER, refusal: result.refusal })
    } finally {
      const restore = spawnSync('chmod', ['-R', 'u+w', remote])
      if (restore.status !== 0) throw new Error('expected chmod to restore write access to the bare remote for cleanup')
    }
  })
  return refusals
}

const UNPARSEABLE_FIXTURE_REL_PATH = 'decisions/a-record-this-version-cannot-read.json'

const collectSyncLedgerUnparseableRefusal = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  await withTwoSyncFixtureRepos(async (ana, ben) => {
    const seed = syncFixtureThread(ana.rt, 'sync-fixture-unparseable', 'sync fixture unparseable thread')
    const created = ana.store.commit([{ kind: 'thread', record: seed }], 'ana: seed a thread for the unparseable probe')
    if (!created.ok) throw new Error('expected the sync-unparseable fixture to seed a thread')

    const anaFirstSync = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (!anaFirstSync.ok) throw new Error('expected the sync-unparseable fixture to push the seeded thread')

    const benFirstSync = await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})
    if (!benFirstSync.ok) throw new Error('expected the sync-unparseable fixture to fast-forward ben')

    const benLayout = layoutFor(ben.rt, ben.repo)
    if (!benLayout.ok) throw new Error("expected layoutFor to resolve ben's sync fixture layout")
    const seededBadRecord = writeRecords(
      ben.rt,
      benLayout.value,
      [{ kind: 'raw', relPath: UNPARSEABLE_FIXTURE_REL_PATH, content: '{"this is not a valid decision record":true}' }],
      'ben: write a record this version cannot read'
    )
    if (!seededBadRecord.ok) throw new Error('expected the sync-unparseable fixture to seed a record the schema rejects')

    const benPush = await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})
    if (!benPush.ok) throw new Error('expected the sync-unparseable fixture to push the unreadable record')

    const anaDiverges = syncFixtureThread(ana.rt, 'sync-fixture-unparseable-second', 'sync fixture unparseable second thread')
    const diverged = ana.store.commit([{ kind: 'thread', record: anaDiverges }], 'ana: diverge so the next sync must merge')
    if (!diverged.ok) throw new Error('expected the sync-unparseable fixture to diverge ana from the shared copy')

    const anaMerge = await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})
    if (anaMerge.ok) throw new Error('expected syncLedgerTool to refuse when the shared copy carries a record it cannot read')
    refusals.push({ producer: SYNC_LEDGER_UNPARSEABLE_PRODUCER, refusal: anaMerge.refusal })
  })
  return refusals
}

const collectRealRefusals = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = [
    { producer: REFUSE_PRODUCER, refusal: refusalTemplate() },
    { producer: THREAD_RECORD_PARSE_PRODUCER, refusal: refusalTemplate() },
    { producer: WITH_DETAIL_PRODUCER, refusal: withDetail(refusalTemplate(), 'a store-relative detail') },
    ...collectSchemaRecordRefusals()
  ]

  const noPluginDataDir = mkdtempSync(join(tmpdir(), 'logbook-no-plugin-data-'))
  try {
    const rt = testRuntime({ env: {} })
    const result = layoutFor(rt, noPluginDataDir)
    if (result.ok) throw new Error('expected layoutFor to refuse when CLAUDE_PLUGIN_DATA is unset')
    refusals.push({ producer: LAYOUT_FOR_PRODUCER, refusal: result })
  } finally {
    rmSync(noPluginDataDir, { recursive: true, force: true })
  }

  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)
    if (result.ok) throw new Error('expected layoutFor to refuse on a missing projectRoot')
    refusals.push({ producer: LAYOUT_FOR_PRODUCER, refusal: result })
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }

  withRepo((repo) => {
    const rt = testRuntime()
    const identity: Identity = { name: 'Census Probe', email: 'probe@logbook.test' }
    const tree = rawGit(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim()

    const first = git(rt, repo, ['commit-tree', tree, '-m', 'census probe one'], { identity })
    if (!first.ok) throw new Error('expected commit-tree to succeed while building the census fixture')
    const firstSha = first.stdout.trim()
    const establish = casUpdateRef(rt, repo, LEDGER_REF, firstSha, null)
    if (!establish.ok) throw new Error('expected the first cas update to succeed')

    const second = git(rt, repo, ['commit-tree', tree, '-p', firstSha, '-m', 'census probe two'], { identity })
    if (!second.ok) throw new Error('expected the second commit-tree to succeed')
    const secondSha = second.stdout.trim()

    const mismatch = casUpdateRef(rt, repo, LEDGER_REF, secondSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    if (mismatch.ok) throw new Error('expected a cas-mismatch refusal')
    refusals.push({ producer: CAS_UPDATE_REF_PRODUCER, refusal: mismatch })
  })

  const nonGitDir = mkdtempSync(join(tmpdir(), 'logbook-non-git-'))
  try {
    const rt = testRuntime()
    const ioFailure = casUpdateRef(rt, nonGitDir, LEDGER_REF, '1'.repeat(40), null)
    if (ioFailure.ok) throw new Error('expected an io refusal against a non-git directory')
    refusals.push({ producer: CAS_UPDATE_REF_PRODUCER, refusal: ioFailure })
  } finally {
    rmSync(nonGitDir, { recursive: true, force: true })
  }

  withRepoNoIdentity((repo) => {
    const rt = testRuntime()
    const identityFailure = readIdentity(rt, repo)
    if (identityFailure.ok) throw new Error('expected readIdentity to refuse against a repo with no configured identity')
    refusals.push({ producer: READ_IDENTITY_PRODUCER, refusal: identityFailure })
  })

  const duplicateStoreRoot = mkdtempSync(join(tmpdir(), 'logbook-duplicate-store-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: duplicateStoreRoot } })
    const projectRoot = mkdtempSync(join(tmpdir(), 'logbook-duplicate-store-project-'))
    try {
      const layout = layoutFor(rt, projectRoot)
      if (!layout.ok) throw new Error('expected layoutFor to resolve for the duplicate-store fixture')
      createStoreDirectories(layout.value)

      const conflictingKey = 'stale-store-for-the-same-project'
      const conflictingRoot = join(duplicateStoreRoot, conflictingKey)
      mkdirSync(join(conflictingRoot, 'state'), { recursive: true })
      writeFileSync(
        join(conflictingRoot, 'state', 'origin.json'),
        JSON.stringify({ project_root: layout.value.projectRoot }),
        'utf8'
      )

      const duplicateFailure = ensureSingleStore(rt, layout.value)
      if (duplicateFailure.ok) throw new Error('expected ensureSingleStore to refuse on a duplicate store')
      refusals.push({ producer: ENSURE_SINGLE_STORE_PRODUCER, refusal: duplicateFailure })
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  } finally {
    rmSync(duplicateStoreRoot, { recursive: true, force: true })
  }

  const unreadableRecordsPluginData = mkdtempSync(join(tmpdir(), 'logbook-unreadable-records-'))
  const unreadableRecordsProject = mkdtempSync(join(tmpdir(), 'logbook-unreadable-records-project-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: unreadableRecordsPluginData } })
    const first = openStore(rt, unreadableRecordsProject)
    if (!first.ok) throw new Error('expected the first openStore call to succeed and create the records directory')

    const layout = layoutFor(rt, unreadableRecordsProject)
    if (!layout.ok) throw new Error('expected layoutFor to resolve for the unreadable-records fixture')

    chmodSync(layout.value.records, 0o000)
    try {
      const unreadable = openStore(rt, unreadableRecordsProject)
      if (unreadable.ok) throw new Error('expected openStore to refuse against an unreadable records directory')
      refusals.push({ producer: OPEN_STORE_PRODUCER, refusal: unreadable })
    } finally {
      chmodSync(layout.value.records, 0o755)
    }
  } finally {
    rmSync(unreadableRecordsPluginData, { recursive: true, force: true })
    rmSync(unreadableRecordsProject, { recursive: true, force: true })
  }

  const domainRt = testRuntime()
  const domainThread = censusFixtureThread(domainRt)
  const neverResolves = (): boolean => false

  const insertResult = insertCriterion(
    domainRt,
    domainThread,
    { text: 'a census criterion', check: 'the census check', kind: 'planned', decisionId: undefined },
    neverResolves
  )
  if (insertResult.ok) throw new Error('expected insertCriterion to refuse without a decision id')
  refusals.push({ producer: INSERT_CRITERION_PRODUCER, refusal: insertResult })

  const rewriteResult = rewriteCriterion(
    domainRt,
    domainThread,
    { criterionId: 'unknown-criterion-id', text: 'rewritten census text', decisionId: undefined },
    neverResolves
  )
  if (rewriteResult.ok) throw new Error('expected rewriteCriterion to refuse without a decision id')
  refusals.push({ producer: REWRITE_CRITERION_PRODUCER, refusal: rewriteResult })

  const strikeResult = strikeCriterion(
    domainRt,
    domainThread,
    { criterionId: 'unknown-criterion-id', decisionId: undefined },
    neverResolves
  )
  if (strikeResult.ok) throw new Error('expected strikeCriterion to refuse without a decision id')
  refusals.push({ producer: STRIKE_CRITERION_PRODUCER, refusal: strikeResult })

  const spineResult = contributeToSpine(domainThread.spine, {
    active_goal: 'a'.repeat(caps.SPINE_ACTIVE_GOAL_MAX + 1)
  })
  if (spineResult.ok) throw new Error('expected contributeToSpine to refuse on an oversized active_goal')
  refusals.push({ producer: CONTRIBUTE_TO_SPINE_PRODUCER, refusal: spineResult })

  const transitionResult = transition(domainRt, domainThread, 'abandoned', '')
  if (transitionResult.ok) throw new Error('expected transition to refuse an abandon with no reason')
  refusals.push({ producer: TRANSITION_PRODUCER, refusal: transitionResult })

  const toolRefusals = await collectToolRefusals()
  refusals.push(...toolRefusals)

  refusals.push(...collectDefensiveGuardRefusals())
  refusals.push(...(await collectResolveConflictSingleRepoRefusals()))
  refusals.push(...(await collectSyncLedgerOfflineRefusal()))
  refusals.push(...(await collectSyncLedgerConflictAndResolveCommitFailureRefusals()))
  refusals.push(...(await collectResolveConflictUnsafeDivergenceRefusal()))
  refusals.push(...(await collectSyncLedgerRejectedRefusal()))
  refusals.push(...(await collectSyncLedgerUnparseableRefusal()))

  return refusals
}

test('error.discloses-no-path', async () => {
  const tagged = await collectRealRefusals()
  assert.ok(tagged.length > 0, 'expected at least one forced refusal to census')

  const scanned = scanRefusalProducers()
  assert.ok(scanned.length > 0, 'expected the static scan to find at least one refusal producer')
  const covered = new Set(tagged.map((t) => t.producer))
  const classifyProducerCoverage = (id: ProducerId): 'allowed' | 'unclassifiable' =>
    covered.has(id) ? 'allowed' : 'unclassifiable'
  assert.doesNotThrow(() => census(scanned, classifyProducerCoverage))

  const emitted = tagged.flatMap(({ refusal }) => emittedStrings(toolRefusal(refusal), refusal.example))
  assert.ok(emitted.length > 0, 'expected the rendered refusals to carry emitted strings')
  assert.doesNotThrow(() => census(emitted, classifyEmittedPath))

  const forbiddenPosix: EmittedString[] = [
    { path: 'content[0].text', value: `leaked at ${SENTINEL_POSIX}`, declaredExample: '' }
  ]
  assert.throws(() => census(forbiddenPosix, classifyEmittedPath))

  const forbiddenWin32: EmittedString[] = [
    { path: 'content[0].text', value: `leaked at ${SENTINEL_WIN32}`, declaredExample: '' }
  ]
  assert.throws(() => census(forbiddenWin32, classifyEmittedPath))
})

test('error.discloses-no-path.scan-population-matches-the-independently-derived-object-descent-domain', () => {
  const scanned = new Set(scanRefusalProducers())
  const candidates = deriveObjectDescentCandidates()
  assert.ok(
    candidates.length > 0,
    'expected the independent object-descent derivation to find at least one candidate producer'
  )
  const classifyAgainstScannedPopulation = (candidate: ObjectDescentCandidate): 'allowed' | 'unclassifiable' =>
    scanned.has(candidate.producer) ? 'allowed' : 'unclassifiable'
  assert.doesNotThrow(() => census(candidates, classifyAgainstScannedPopulation))

  const filesCoveredByFamily = (family: ObjectDescentFamily): Set<string> =>
    new Set(
      candidates.filter((candidate) => candidate.family === family).map((candidate) => producerSourceFile(candidate.producer))
    )

  const assertFamilyCoversItsExpectedFiles = (family: ObjectDescentFamily, expectedFiles: string[]): void => {
    const covered = filesCoveredByFamily(family)
    for (const expectedFile of expectedFiles) {
      assert.ok(
        covered.has(expectedFile),
        `expected the "${family}" object-descent family to have a candidate for ${expectedFile}, found none`
      )
    }
  }

  assertFamilyCoversItsExpectedFiles('tool-handler', deriveExpectedToolHandlerFiles())
  assertFamilyCoversItsExpectedFiles('record-methods', deriveExpectedRecordMethodsFiles())
})

test('error.discloses-no-path.taint-refusal-rejects-unclosed-fields', () => {
  assert.throws(() => taintRefusal({} as Refusal, SENTINEL_TOKEN))

  const template = refusalTemplate()
  const corrupted = { ...template, retryable: 42 } as unknown as Refusal
  assert.throws(() => taintRefusal(corrupted, SENTINEL_TOKEN))
})

test('error.discloses-no-path.field-closure-halts-on-an-unforeseen-field', () => {
  const template = refusalTemplate()
  const knownKeys = new Set(Object.keys(template))
  const classifyRefusalKey = (key: string): 'allowed' | 'unclassifiable' =>
    knownKeys.has(key) ? 'allowed' : 'unclassifiable'

  const withSeventhField = taintRefusal({ ...template, hint: 'a future field' } as Refusal, SENTINEL_TOKEN)
  assert.throws(() => census(Object.keys(withSeventhField), classifyRefusalKey))
})

test('error.discloses-no-path.non-emitted-detail-is-not-enumerable', () => {
  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-detail-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)
    if (result.ok) throw new Error('expected layoutFor to refuse on a missing projectRoot')
    const descriptor = Object.getOwnPropertyDescriptor(result, 'detail')
    assert.ok(descriptor !== undefined, 'expected a non-enumerable detail property carrying the store path')
    assert.equal(descriptor?.enumerable, false)
    assert.equal(Object.keys(result).includes('detail'), false)
    assert.equal(JSON.stringify(result).includes('detail'), false)
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('error.discloses-no-path.taint-survives-without-the-strip', () => {
  const template = refusalTemplate()
  const leaky = { ...template, cause: SENTINEL_POSIX } as Refusal & { cause: string }

  const withStrip = toolRefusal(leaky)
  assert.doesNotThrow(() => census(emittedStrings(withStrip, leaky.example), classifyEmittedPath))
  assert.equal(
    emittedStrings(withStrip, leaky.example).some((s) => s.value.includes(SENTINEL_TOKEN)),
    false
  )

  const withoutStrip: CallToolResult = {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(leaky) }]
  }
  assert.throws(() => census(emittedStrings(withoutStrip, leaky.example), classifyEmittedPath))
})

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))

test('error.discloses-no-path.producer-scan-covers-all-six-export-shapes', () => {
  const probeDir = join(SRC_ROOT, '__census_probe__')
  const probeFile = join(probeDir, 'plant.ts')
  mkdirSync(probeDir, { recursive: true })
  writeFileSync(
    probeFile,
    [
      "import type { Refusal } from '../schema/declare.ts'",
      '',
      'export function probeFunctionDeclaration(): Refusal {',
      "  return { ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' }",
      '}',
      '',
      'export const probeConciseArrow = (): Refusal =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      '',
      'export const probeAsyncArrow = async (): Promise<Refusal> =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      '',
      'const probeAssignedThenExported = (): Refusal =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      'export { probeAssignedThenExported }',
      '',
      'export type ProbeStoreFailure = Refusal',
      'export const probeTypeAliasReturn = (): ProbeStoreFailure =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      '',
      'const probeFactoryBehindObject = (): Refusal =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      'export const probeSpecLikeObject = { handler: probeFactoryBehindObject }',
      ''
    ].join('\n'),
    'utf8'
  )

  try {
    const scanned = scanRefusalProducers()
    const plantedFound = scanned.filter((id) => id.startsWith('__census_probe__/'))
    assert.deepEqual(
      new Set(plantedFound),
      new Set([
        '__census_probe__/plant.ts#probeFunctionDeclaration',
        '__census_probe__/plant.ts#probeConciseArrow',
        '__census_probe__/plant.ts#probeAsyncArrow',
        '__census_probe__/plant.ts#probeAssignedThenExported',
        '__census_probe__/plant.ts#probeTypeAliasReturn',
        '__census_probe__/plant.ts#probeSpecLikeObject.handler'
      ])
    )

    const classifyUncovered = (id: ProducerId): 'allowed' | 'unclassifiable' =>
      id.startsWith('__census_probe__/') ? 'unclassifiable' : 'allowed'
    assert.throws(() => census(scanned, classifyUncovered))
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }

  const scannedAfterCleanup = scanRefusalProducers()
  assert.equal(
    scannedAfterCleanup.some((id) => id.startsWith('__census_probe__/')),
    false
  )
})

test('error.discloses-no-path.example-scrub-is-positional-not-global', () => {
  const row1Value = `field: probe\naccepted: probe\nexample: ${SENTINEL_POSIX}\nretryable: true\nprobe was refused; unrelated message text with no path.`
  assert.doesNotThrow(() =>
    census([{ path: 'content[0].text', value: row1Value, declaredExample: SENTINEL_POSIX }], classifyEmittedPath)
  )

  const row2Value = `field: probe\naccepted: probe\nexample: ${SENTINEL_POSIX}\nretryable: true\nprobe was refused; it accepts probe; a valid example is ${SENTINEL_POSIX}; retryable=true.`
  assert.doesNotThrow(() =>
    census([{ path: 'content[0].text', value: row2Value, declaredExample: SENTINEL_POSIX }], classifyEmittedPath)
  )

  const row3Value = `field: probe\naccepted: probe\nexample: /\nretryable: true\nprobe was refused; the real leaked path is ${SENTINEL_POSIX}; retryable=true.`
  assert.throws(() =>
    census([{ path: 'content[0].text', value: row3Value, declaredExample: '/' }], classifyEmittedPath)
  )

  const row4Value = `field: probe\naccepted: probe\nexample: chmod +r <dir>\nretryable: true\nprobe was refused; the real leaked path is ${SENTINEL_POSIX}; retryable=true.`
  assert.throws(() =>
    census([{ path: 'content[0].text', value: row4Value, declaredExample: 'chmod +r <dir>' }], classifyEmittedPath)
  )
})

test('error.discloses-no-path.with-detail-is-idempotent', () => {
  const original = refusalTemplate()
  const snapshot = JSON.stringify(original)

  const once = withDetail(original, 'first detail')
  assert.doesNotThrow(() => withDetail(once, 'second detail'))
  const twice = withDetail(once, 'second detail')

  assert.equal(JSON.stringify(original), snapshot)
  assert.notEqual(original, once)
  assert.notEqual(once, twice)
  assert.equal(Object.getOwnPropertyDescriptor(twice, 'detail')?.value, 'first detail | second detail')
})
