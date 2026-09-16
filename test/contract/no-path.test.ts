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
import type { Thread } from '../../src/schema/thread.ts'
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
import { closeThreadTool, invalidThreadRecordRefusal } from '../../src/server/tools/close_thread.ts'
import { bindBranchTool, invalidCommittedBindingRefusal } from '../../src/server/tools/bind_branch.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { parkThreadTool } from '../../src/server/tools/park_thread.ts'
import { listThreadsTool } from '../../src/server/tools/list_threads.ts'
import { recordDecisionTool, invalidDecisionRefusal } from '../../src/server/tools/record_decision.ts'
import { logSessionEventTool, invalidSessionEntryRefusal } from '../../src/server/tools/log_session_event.ts'
import { syncLedgerTool } from '../../src/server/tools/sync_ledger.ts'
import { resolveConflictTool } from '../../src/server/tools/resolve_conflict.ts'
import { commitThread, loadThread, loadThreadForReference, openProjectStore } from '../../src/server/tool-support.ts'
import { git, readIdentity, type Identity } from '../../src/store/git.ts'
import { createStoreDirectories, layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { LEDGER_REF, casUpdateRef } from '../../src/store/ref.ts'
import { ensureSingleStore } from '../../src/store/single-store.ts'
import { withDetail } from '../../src/store/detail.ts'
import { insertCriterion, reopenCriterion, rewriteCriterion, strikeCriterion } from '../../src/domain/criteria.ts'
import { checkNextStepCriterion, contributeToSpine } from '../../src/domain/spine.ts'
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
const REOPEN_CRITERION_PRODUCER: ProducerId = 'domain/criteria.ts#reopenCriterion'
const CONTRIBUTE_TO_SPINE_PRODUCER: ProducerId = 'domain/spine.ts#contributeToSpine'
const CHECK_NEXT_STEP_CRITERION_PRODUCER: ProducerId = 'domain/spine.ts#checkNextStepCriterion'
const TRANSITION_PRODUCER: ProducerId = 'domain/lifecycle.ts#transition'
const OPEN_THREAD_DUPLICATE_SLUG_PRODUCER: ProducerId = 'server/tools/open_thread.ts#duplicateSlugRefusal'
const UPDATE_THREAD_UNKNOWN_CRITERION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownCriterionRefusal'
const UPDATE_THREAD_UNKNOWN_DECISION_PRODUCER: ProducerId = 'server/tools/update_thread.ts#unknownDecisionRefusal'
const UPDATE_THREAD_CONFLICTING_BLOCKAGE_PRODUCER: ProducerId =
  'server/tools/update_thread.ts#conflictingBlockageRefusal'
const CLOSE_THREAD_INVALID_THREAD_RECORD_PRODUCER: ProducerId = 'server/tools/close_thread.ts#invalidThreadRecordRefusal'
const CLOSE_THREAD_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/close_thread.ts#commitFailureRefusal'
const BIND_BRANCH_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/bind_branch.ts#commitFailureRefusal'
const BIND_BRANCH_INVALID_BINDING_PRODUCER: ProducerId = 'server/tools/bind_branch.ts#invalidBindingRefusal'
const BIND_BRANCH_INVALID_COMMITTED_BINDING_PRODUCER: ProducerId =
  'server/tools/bind_branch.ts#invalidCommittedBindingRefusal'
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
const UPDATE_THREAD_HANDLER_PRODUCER: ProducerId = 'server/tools/update_thread.ts#updateThreadTool.handler'

const RECORD_DECISION_INVALID_PRODUCER: ProducerId = 'server/tools/record_decision.ts#invalidDecisionRefusal'
const RECORD_DECISION_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/record_decision.ts#commitFailureRefusal'
const RECORD_DECISION_UNKNOWN_CRITERION_PRODUCER: ProducerId = 'server/tools/record_decision.ts#unknownCriterionRefusal'
const RECORD_DECISION_UNRESOLVED_SUPERSEDES_PRODUCER: ProducerId =
  'server/tools/record_decision.ts#unresolvedSupersedesRefusal'
const RECORD_DECISION_HANDLER_PRODUCER: ProducerId = 'server/tools/record_decision.ts#recordDecisionTool.handler'

const LOG_SESSION_EVENT_ACTOR_CAP_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#actorCapRefusal'
const LOG_SESSION_EVENT_RESERVED_ACTOR_PREFIX_PRODUCER: ProducerId =
  'server/tools/log_session_event.ts#reservedActorPrefixRefusal'
const LOG_SESSION_EVENT_BODY_CAP_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#bodyCapRefusal'
const LOG_SESSION_EVENT_UNPARKED_BOUND_PRODUCER: ProducerId =
  'server/tools/log_session_event.ts#unparkedEntriesBoundRefusal'
const LOG_SESSION_EVENT_INVALID_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#invalidSessionEntryRefusal'
const LOG_SESSION_EVENT_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#commitFailureRefusal'
const LOG_SESSION_EVENT_HANDLER_PRODUCER: ProducerId = 'server/tools/log_session_event.ts#logSessionEventTool.handler'

const SYNC_LEDGER_OFFLINE_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#offlineRefusal'
const SYNC_LEDGER_REJECTED_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#rejectedRefusal'
const SYNC_LEDGER_CONFLICT_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#conflictRefusal'
const SYNC_LEDGER_GIT_TOO_OLD_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#gitTooOldRefusal'
const SYNC_LEDGER_HANDLER_PRODUCER: ProducerId = 'server/tools/sync_ledger.ts#syncLedgerTool.handler'

const RESOLVE_CONFLICT_NO_CONFLICTS_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#noConflictsRefusal'
const RESOLVE_CONFLICT_UNREADABLE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#conflictsUnreadableRefusal'
const RESOLVE_CONFLICT_DUPLICATE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#duplicateResolutionRefusal'
const RESOLVE_CONFLICT_UNRECOGNISED_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#unrecognisedResolutionRefusal'
const RESOLVE_CONFLICT_MISSING_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#missingResolutionRefusal'
const RESOLVE_CONFLICT_PAYLOAD_MISMATCH_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#payloadMismatchRefusal'
const RESOLVE_CONFLICT_INVALID_RECORD_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#invalidRecordRefusal'
const RESOLVE_CONFLICT_ADDRESS_MISMATCH_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#recordAddressMismatchRefusal'
const RESOLVE_CONFLICT_STALE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#staleConflictRefusal'
const RESOLVE_CONFLICT_NO_REMOTE_POSITION_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#noRemotePositionRefusal'
const RESOLVE_CONFLICT_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/resolve_conflict.ts#commitFailureRefusal'
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
    landed: '',
    last_session: 'census fixture last session',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

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
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-tool-fixture-plugin-data-'))
  const pluginDataRoot = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginDataRoot)
  const repo = buildToolFixtureRepo()
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo })

    const firstOpen = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'census tool fixture thread',
      slug: 'census-tool-fixture',
      active_goal: 'ship the census tool fixture',
      next_step: 'exercise the census tool fixture',
      completion_criteria: [{ text: 'a census criterion', check: 'the census check', settledness: 'proposed' }]
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

    const resumeForPark = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    if (!resumeForPark.ok) throw new Error('expected resumeThreadTool to resume the census tool fixture thread')

    const oversizedOutcome = 'x'.repeat(caps.SESSION_BODY_MAX + 1)
    const parkFailure = await parkThreadTool.handler(rt, STUB_TOOL_CTX, { outcome: oversizedOutcome })
    if (parkFailure.ok) throw new Error('expected parkThreadTool to refuse an outcome that overflows the session body cap')
    refusals.push({ producer: PARK_THREAD_HANDLER_PRODUCER, refusal: parkFailure.refusal })

    const duplicateOpen = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'census tool fixture thread again',
      slug: 'census-tool-fixture',
      active_goal: 'ship the census tool fixture',
      next_step: 'exercise the census tool fixture',
      completion_criteria: [{ text: 'a census criterion', check: 'the census check', settledness: 'proposed' }]
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

    const closeWithOpenCriterion = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      outcome: 'done',
      detail: 'census close probe with a criterion still open'
    })
    if (closeWithOpenCriterion.ok) {
      throw new Error('expected closeThreadTool to refuse closing as done while a criterion is still open')
    }
    refusals.push({ producer: CLOSE_THREAD_HANDLER_PRODUCER, refusal: closeWithOpenCriterion.refusal })

    const unknownDecisionCriterion = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome',
      criterion_id: rt.ulid()
    })
    if (unknownDecisionCriterion.ok) {
      throw new Error('expected recordDecisionTool to refuse a criterion_id that names no criterion on this thread')
    }
    refusals.push({ producer: RECORD_DECISION_UNKNOWN_CRITERION_PRODUCER, refusal: unknownDecisionCriterion.refusal })
    refusals.push({ producer: RECORD_DECISION_HANDLER_PRODUCER, refusal: unknownDecisionCriterion.refusal })

    const unresolvedSupersedes = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome',
      supersedes: [rt.ulid()]
    })
    if (unresolvedSupersedes.ok) {
      throw new Error('expected recordDecisionTool to refuse a supersedes id that resolves to no stored decision record')
    }
    refusals.push({ producer: RECORD_DECISION_UNRESOLVED_SUPERSEDES_PRODUCER, refusal: unresolvedSupersedes.refusal })

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
      body: CONTROL_CHAR_OVERFLOW(5400)
    })
    if (bodyOverflow.ok) throw new Error('expected logSessionEventTool to refuse a body that overflows its cap once escaped')
    refusals.push({ producer: LOG_SESSION_EVENT_BODY_CAP_PRODUCER, refusal: bodyOverflow.refusal })

    const boundProbeThread = censusFixtureThread(rt)
    const boundProbeThreadWithSlug: Thread = { ...boundProbeThread, slug: 'census-session-entry-bound-thread' }
    const boundProbeThreadSeed = store.commit(
      [{ kind: 'thread', record: boundProbeThreadWithSlug }],
      'seed census session-entry-bound thread fixture'
    )
    if (!boundProbeThreadSeed.ok) {
      throw new Error('expected the census session-entry-bound thread fixture to seed successfully')
    }

    const unparkedBoundSeed = store.commit(
      Array.from({ length: caps.SESSION_UNPARKED_ENTRIES_MAX }, (_unused, index) => ({
        kind: 'session' as const,
        record: {
          id: rt.ulid(),
          thread_id: boundProbeThreadWithSlug.id,
          actor: 'claude',
          body: `census session-entry-bound seed entry ${index}`,
          created_at: rt.now()
        }
      })),
      'seed census session-entry-bound fixture'
    )
    if (!unparkedBoundSeed.ok) {
      throw new Error('expected store.commit to seed the census session-entry-bound fixture')
    }

    const unparkedBoundOverflow = await logSessionEventTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: boundProbeThreadWithSlug.id,
      actor: 'claude',
      body: 'a census body over the un-parked entries bound'
    })
    if (unparkedBoundOverflow.ok) {
      throw new Error('expected logSessionEventTool to refuse once the thread carries the un-parked entries bound')
    }
    if (!unparkedBoundOverflow.refusal.message.includes('park_thread')) {
      throw new Error(
        `expected the bound refusal to name park_thread as the remedy, got '${unparkedBoundOverflow.refusal.message}'`
      )
    }
    refusals.push({ producer: LOG_SESSION_EVENT_UNPARKED_BOUND_PRODUCER, refusal: unparkedBoundOverflow.refusal })

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
    if (!logSessionEventCommitFailure.refusal.message.includes('this session entry did not complete')) {
      throw new Error(
        `expected the commit-failure refusal to name the session entry commit as the cause, got '${logSessionEventCommitFailure.refusal.message}'`
      )
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
    rmSync(pluginDataHome, { recursive: true, force: true })
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

  const threadParseForGuard = ThreadRecord.parse({})
  if (threadParseForGuard.ok) throw new Error('expected ThreadRecord.parse to refuse an empty thread')
  refusals.push({
    producer: CLOSE_THREAD_INVALID_THREAD_RECORD_PRODUCER,
    refusal: invalidThreadRecordRefusal(threadParseForGuard.message)
  })

  const invalidBindingAtCommit = BindingRecord.parse({ id: randomUUID(), thread_id: randomUUID(), branch: '', created_at: '2026-09-02T00:00:00.000Z' })
  if (invalidBindingAtCommit.ok) throw new Error('expected BindingRecord.parse to refuse a binding with an empty branch')
  refusals.push({
    producer: BIND_BRANCH_INVALID_COMMITTED_BINDING_PRODUCER,
    refusal: invalidCommittedBindingRefusal(
      `${invalidBindingAtCommit.field} failed its stored-shape validation: ${invalidBindingAtCommit.message}`
    )
  })

  return refusals
}

type ResolveConflictFixture = {
  rt: Runtime
  repo: string
  pluginDataRoot: string
  pluginDataHome: string
  store: Store
  layout: StoreLayout
  threadId: string
  threadTitle: string
}

const buildResolveConflictFixture = async (): Promise<ResolveConflictFixture> => {
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-resolve-fixture-plugin-data-'))
  const pluginDataRoot = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginDataRoot)
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
    active_goal: 'ship the resolve-conflict fixture',
    next_step: 'exercise the resolve-conflict fixture',
    completion_criteria: [{ text: 'a census criterion', check: 'the census check', settledness: 'proposed' }]
  })
  if (!openedThread.ok) throw new Error('expected openThreadTool to open the resolve-conflict fixture thread')

  return {
    rt,
    repo,
    pluginDataRoot,
    pluginDataHome,
    store: opened.value,
    layout: layout.value,
    threadId: openedThread.structured.thread_id,
    threadTitle
  }
}

const cleanupResolveConflictFixture = (fixture: ResolveConflictFixture): void => {
  rmSync(fixture.repo, { recursive: true, force: true })
  rmSync(fixture.pluginDataHome, { recursive: true, force: true })
}

type ResolveConflictResolutions = Parameters<typeof resolveConflictTool.handler>[2]['resolutions']

const ABSENT_COMMIT = '0'.repeat(40)
const NOTE_PATH = 'notes/census-note.txt'

const writeConflictsFixture = (fixture: ResolveConflictFixture, remoteCommit: string, paths: readonly string[]): void => {
  const localCommit = rawGit(fixture.repo, ['rev-parse', LEDGER_REF]).stdout.trim()
  mkdirSync(fixture.layout.state, { recursive: true })
  writeFileSync(
    join(fixture.layout.state, 'conflicts.json'),
    JSON.stringify({
      local_commit: localCommit,
      remote_commit: remoteCommit,
      paths: paths.map((path) => ({ path, base_blob: null, local_blob: ABSENT_COMMIT, remote_blob: ABSENT_COMMIT }))
    }),
    'utf8'
  )
}

const collectResolveConflictSingleRepoRefusals = async (): Promise<TaggedRefusal[]> => {
  const fixture = await buildResolveConflictFixture()
  const refusals: TaggedRefusal[] = []
  try {
    const threadPath = `threads/${fixture.threadId}.json`
    const threadSlot = fixture.store.readThread(fixture.threadId)
    if (threadSlot === null || threadSlot.quarantined) throw new Error('expected the resolve-conflict fixture thread to read back cleanly')
    const thread = threadSlot.record
    const bothFiles: [ResolveConflictResolutions[number], ResolveConflictResolutions[number]] = [
      { path: threadPath, record: thread },
      { path: NOTE_PATH, content: 'a census note' }
    ]
    const resolve = async (resolutions: ResolveConflictResolutions, expectation: string): Promise<Refusal> => {
      const result = await resolveConflictTool.handler(fixture.rt, STUB_TOOL_CTX, { resolutions })
      if (result.ok) throw new Error(`expected resolveConflictTool to refuse ${expectation}`)
      return result.refusal
    }

    refusals.push({ producer: RESOLVE_CONFLICT_NO_CONFLICTS_PRODUCER, refusal: await resolve(bothFiles, 'when no conflicts are recorded') })

    const conflictsPath = join(fixture.layout.state, 'conflicts.json')
    mkdirSync(conflictsPath, { recursive: true })
    refusals.push({ producer: RESOLVE_CONFLICT_UNREADABLE_PRODUCER, refusal: await resolve(bothFiles, 'when the conflicts file cannot be read') })
    rmSync(conflictsPath, { recursive: true, force: true })

    writeFileSync(conflictsPath, JSON.stringify([{ record: `thread:${fixture.threadId}`, field: 'title' }]), 'utf8')
    refusals.push({ producer: RESOLVE_CONFLICT_UNREADABLE_PRODUCER, refusal: await resolve(bothFiles, 'when the conflicts file is not the expected shape') })

    writeConflictsFixture(fixture, ABSENT_COMMIT, [threadPath, NOTE_PATH])

    refusals.push({
      producer: RESOLVE_CONFLICT_DUPLICATE_PRODUCER,
      refusal: await resolve([...bothFiles, { path: threadPath, record: thread }], 'a resolutions list naming one file twice')
    })
    refusals.push({
      producer: RESOLVE_CONFLICT_UNRECOGNISED_PRODUCER,
      refusal: await resolve([...bothFiles, { path: `threads/${fixture.rt.ulid()}.json`, record: thread }], 'a file sync_ledger did not report')
    })
    refusals.push({ producer: RESOLVE_CONFLICT_MISSING_PRODUCER, refusal: await resolve([bothFiles[0]], 'a list missing a reported file') })

    refusals.push({
      producer: RESOLVE_CONFLICT_PAYLOAD_MISMATCH_PRODUCER,
      refusal: await resolve([{ path: threadPath, content: 'a thread sent as text' }, bothFiles[1]], 'a record file sent as content')
    })
    refusals.push({
      producer: RESOLVE_CONFLICT_PAYLOAD_MISMATCH_PRODUCER,
      refusal: await resolve([bothFiles[0], { path: NOTE_PATH, record: thread }], 'a text file sent as a record')
    })

    const invalidRecord = await resolve([{ path: threadPath, record: { ...thread, title: '' } }, bothFiles[1]], 'a record that does not fit its stored shape')
    if (invalidRecord.field !== 'resolutions.0.record.title') throw new Error(`expected the stored-shape refusal to name resolutions.0.record.title, got '${invalidRecord.field}'`)
    refusals.push({ producer: RESOLVE_CONFLICT_INVALID_RECORD_PRODUCER, refusal: invalidRecord })

    refusals.push({
      producer: RESOLVE_CONFLICT_ADDRESS_MISMATCH_PRODUCER,
      refusal: await resolve([{ path: threadPath, record: { ...thread, id: fixture.rt.ulid() } }, bothFiles[1]], 'a record whose id differs from its path')
    })

    const noRemotePosition = await resolve(bothFiles, 'when the remote commit the conflict was found against is gone')
    refusals.push({ producer: RESOLVE_CONFLICT_NO_REMOTE_POSITION_PRODUCER, refusal: noRemotePosition })
    refusals.push({ producer: RESOLVE_CONFLICT_HANDLER_PRODUCER, refusal: noRemotePosition })

    writeConflictsFixture(fixture, rawGit(fixture.repo, ['rev-parse', LEDGER_REF]).stdout.trim(), [threadPath, NOTE_PATH])
    refusals.push({ producer: RESOLVE_CONFLICT_STALE_PRODUCER, refusal: await resolve(bothFiles, 'when the recorded conflict no longer stands') })
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

type SyncFixtureRepo = {
  name: string
  repo: string
  pluginDataRoot: string
  pluginDataHome: string
  rt: Runtime
  store: Store
}

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
  const pluginDataHome = mkdtempSync(join(tmpdir(), `logbook-sync-fixture-plugin-data-${name}-`))
  const pluginDataRoot = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginDataRoot)
  const rt = withDistinctSyncFixtureUlids(testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: repo }), ulidTimePrefix)
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`expected openStore to open ${name}'s sync fixture store`)
  return { name, repo, pluginDataRoot, pluginDataHome, rt, store: opened.value }
}

const withTwoSyncFixtureRepos = async (
  fn: (ana: SyncFixtureRepo, ben: SyncFixtureRepo, remote: string) => Promise<void>
): Promise<void> => {
  const remote = mkdtempSync(join(tmpdir(), 'logbook-sync-fixture-remote-'))
  const cleanupDirs: string[] = []
  try {
    rawGit(remote, ['init', '--bare', '--initial-branch=main'])
    const ana = buildSyncFixtureRepo(remote, 'ana', { name: 'ana', email: 'ana@logbook.test' }, '01ANASYNCA')
    cleanupDirs.push(ana.repo, ana.pluginDataHome)
    const ben = buildSyncFixtureRepo(remote, 'ben', { name: 'ben', email: 'ben@logbook.test' }, '01BENSYNCB')
    cleanupDirs.push(ben.repo, ben.pluginDataHome)
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
    landed: '',
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
      resolutions: [{ path: `threads/${original.id}.json`, record: benSlot.record }]
    })
    if (resolveCommitFailure.ok) {
      throw new Error('expected resolveConflictTool to refuse when the ledger commit cannot complete')
    }
    refusals.push({ producer: RESOLVE_CONFLICT_COMMIT_FAILURE_PRODUCER, refusal: resolveCommitFailure.refusal })
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

const withGitReportingAnOldVersion = async <T>(fn: (onOldGit: (rt: Runtime) => Runtime) => Promise<T>): Promise<T> => {
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  if (realGit.length === 0) throw new Error('expected a git on PATH to stand behind the old-version shim')
  const shimDir = mkdtempSync(join(tmpdir(), 'logbook-old-git-'))
  const shim = join(shimDir, 'git')
  writeFileSync(shim, `#!/bin/sh\nif [ "$3" = "version" ]; then echo "git version 2.34.1"; exit 0; fi\nexec "${realGit}" "$@"\n`)
  chmodSync(shim, 0o755)
  try {
    return await fn((rt) => ({ ...rt, env: { ...rt.env, PATH: `${shimDir}:${process.env.PATH ?? ''}` } }))
  } finally {
    rmSync(shimDir, { recursive: true, force: true })
  }
}

const collectSyncLedgerGitTooOldRefusal = async (): Promise<TaggedRefusal[]> => {
  const refusals: TaggedRefusal[] = []
  await withTwoSyncFixtureRepos(async (ana, ben) => {
    const seed = syncFixtureThread(ana.rt, 'sync-fixture-old-git', 'sync fixture old git thread')
    if (!ana.store.commit([{ kind: 'thread', record: seed }], 'ana: seed a thread for the old-git probe').ok) {
      throw new Error('expected the old-git fixture to seed a thread')
    }
    if (!(await syncLedgerTool.handler(ana.rt, STUB_TOOL_CTX, {})).ok) throw new Error('expected the old-git fixture to push the seed')
    if (!(await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})).ok) throw new Error('expected the old-git fixture to fast-forward ben')

    const bensThread = syncFixtureThread(ben.rt, 'sync-fixture-old-git-ben', 'sync fixture old git ben thread')
    if (!ben.store.commit([{ kind: 'thread', record: bensThread }], 'ben: diverge').ok) throw new Error('expected ben to diverge')
    if (!(await syncLedgerTool.handler(ben.rt, STUB_TOOL_CTX, {})).ok) throw new Error('expected ben to push his divergence')
    const anasThread = syncFixtureThread(ana.rt, 'sync-fixture-old-git-ana', 'sync fixture old git ana thread')
    if (!ana.store.commit([{ kind: 'thread', record: anasThread }], 'ana: diverge').ok) throw new Error('expected ana to diverge')

    await withGitReportingAnOldVersion(async (onOldGit) => {
      const anaMerge = await syncLedgerTool.handler(onOldGit(ana.rt), STUB_TOOL_CTX, {})
      if (anaMerge.ok) throw new Error('expected syncLedgerTool to refuse a merge on a git older than the merge-tree floor')
      refusals.push({ producer: SYNC_LEDGER_GIT_TOO_OLD_PRODUCER, refusal: anaMerge.refusal })
    })
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

  const pluginDataHomeForMissingPath = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-'))
  const pluginDataRoot = join(pluginDataHomeForMissingPath, 'plugin-data')
  mkdirSync(pluginDataRoot)
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)
    if (result.ok) throw new Error('expected layoutFor to refuse on a missing projectRoot')
    refusals.push({ producer: LAYOUT_FOR_PRODUCER, refusal: result })
  } finally {
    rmSync(pluginDataHomeForMissingPath, { recursive: true, force: true })
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

  const duplicateStoreHome = mkdtempSync(join(tmpdir(), 'logbook-duplicate-store-'))
  const duplicateStoreRoot = join(duplicateStoreHome, 'plugin-data')
  mkdirSync(duplicateStoreRoot)
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
    rmSync(duplicateStoreHome, { recursive: true, force: true })
  }

  const unreadableRecordsPluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-unreadable-records-'))
  const unreadableRecordsPluginData = join(unreadableRecordsPluginDataHome, 'plugin-data')
  mkdirSync(unreadableRecordsPluginData)
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
    rmSync(unreadableRecordsPluginDataHome, { recursive: true, force: true })
    rmSync(unreadableRecordsProject, { recursive: true, force: true })
  }

  const domainRt = testRuntime()
  const domainThread = censusFixtureThread(domainRt)
  const neverResolves = (): boolean => false

  const insertResult = insertCriterion(
    domainRt,
    domainThread,
    { text: 'a census criterion', check: 'the census check', kind: 'planned', decisionId: undefined, settledness: 'proposed' },
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

  const reopenResult = reopenCriterion(
    domainRt,
    domainThread,
    { criterionId: 'unknown-criterion-id', decisionId: undefined },
    neverResolves
  )
  if (reopenResult.ok) throw new Error('expected reopenCriterion to refuse without a decision id')
  refusals.push({ producer: REOPEN_CRITERION_PRODUCER, refusal: reopenResult })

  const spineResult = contributeToSpine(domainThread.spine, {
    key_decisions: Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS + 1 }, (_, index) => ({
      id: domainRt.ulid(),
      decision_id: domainRt.ulid(),
      title: `census decision ${index}`,
      scope: 'census scope'
    }))
  })
  if (spineResult.ok) throw new Error('expected contributeToSpine to refuse key decisions past their element cap')
  refusals.push({ producer: CONTRIBUTE_TO_SPINE_PRODUCER, refusal: spineResult })

  const nextStepCriterionResult = checkNextStepCriterion(domainThread.completion_criteria, {
    next_step_criterion_id: domainRt.ulid()
  })
  if (nextStepCriterionResult === null) {
    throw new Error('expected checkNextStepCriterion to refuse a criterion sent without a next step')
  }
  refusals.push({ producer: CHECK_NEXT_STEP_CRITERION_PRODUCER, refusal: nextStepCriterionResult })

  const transitionResult = transition(domainRt, domainThread, 'abandoned', '')
  if (transitionResult.ok) throw new Error('expected transition to refuse an abandon with no reason')
  refusals.push({ producer: TRANSITION_PRODUCER, refusal: transitionResult })

  const toolRefusals = await collectToolRefusals()
  refusals.push(...toolRefusals)

  refusals.push(...collectDefensiveGuardRefusals())
  refusals.push(...(await collectResolveConflictSingleRepoRefusals()))
  refusals.push(...(await collectSyncLedgerOfflineRefusal()))
  refusals.push(...(await collectSyncLedgerConflictAndResolveCommitFailureRefusals()))
  refusals.push(...(await collectSyncLedgerRejectedRefusal()))
  refusals.push(...(await collectSyncLedgerGitTooOldRefusal()))

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

  const publishedAddress: EmittedString[] = [
    { path: 'content[0].text', value: `local: logbook://conflict/${'a'.repeat(40)}\n`, declaredExample: '' }
  ]
  assert.doesNotThrow(() => census(publishedAddress, classifyEmittedPath), 'a published logbook address is not a filesystem path')

  const pathBehindTheScheme: EmittedString[] = [
    { path: 'content[0].text', value: `local: logbook://conflict${SENTINEL_POSIX}`, declaredExample: '' }
  ]
  assert.throws(
    () => census(pathBehindTheScheme, classifyEmittedPath),
    'a filesystem path carried behind the logbook scheme must still be caught'
  )
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
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-detail-'))
  const pluginDataRoot = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginDataRoot)
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
    rmSync(pluginDataHome, { recursive: true, force: true })
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
