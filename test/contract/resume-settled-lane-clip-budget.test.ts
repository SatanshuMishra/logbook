import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'
import { logSessionEventTool } from '../../src/server/tools/log_session_event.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

const FILLER_WORDS =
  'the quick brown fox jumps over the lazy dog while the team ships steady incremental progress on the logbook renderer '

const filler = (length: number): string => {
  let out = ''
  while (out.length < length) out += FILLER_WORDS
  return out.slice(0, length)
}

const SETTLED_RISK_TEXT_LENGTH = 310
const OPEN_RISK_TEXT_LENGTH = 300
const RISK_REF_LENGTH = 60
const OPEN_RISK_COUNT = 7
const SPINE_FIELD_LENGTH = 200
const SESSION_ENTRY_COUNT = 6
const SESSION_ENTRY_LENGTH = 1500

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'settled lane clip budget fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Settled Lane Fixture'],
    ['config', 'user.email', 'settled-lane@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`settled lane fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (fn: (rt: Runtime) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-settled-lane-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-settled-lane-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    setUpRepo(repo)
    const rt = testRuntime({ env: { [PLUGIN_DATA_ENV_KEY]: pluginData }, cwd: repo, sessionId: 'settled-lane-session' })
    await fn(rt)
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const settledLineFor = (briefing: string, riskId: string): string | undefined =>
  briefing.split('\n').find((line) => line.startsWith(`- risk ${riskId} `))

const liveRiskLineFor = (briefing: string, riskId: string): string | undefined =>
  briefing.split('\n').find((line) => line.startsWith(`- ${riskId} `))

test('resume_thread.a-settled-risk-shortens-no-further-than-its-share-of-the-real-budget', async () => {
  await withHarness(async (rt) => {
    const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'settled lane clip budget fixture',
      slug: 'settled-lane-clip-budget',
      completion_criteria: [
        { text: filler(40), check: filler(40) },
        { text: filler(40), check: filler(40) }
      ]
    })
    if (!opened.ok) {
      throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
    }
    const threadId = opened.structured.thread_id
    const settledCriterionId = opened.structured.completion_criteria[0]?.id
    const openCriterionId = opened.structured.completion_criteria[1]?.id
    if (settledCriterionId === undefined || openCriterionId === undefined) {
      throw new Error('expected open_thread to mint two completion criteria for this fixture')
    }

    const settledRiskSuffix = ' idxsettled'
    const settledRiskText = filler(SETTLED_RISK_TEXT_LENGTH - settledRiskSuffix.length) + settledRiskSuffix
    const settledRiskRef = filler(RISK_REF_LENGTH)
    const openRiskTexts = Array.from({ length: OPEN_RISK_COUNT }, (_, index) => {
      const suffix = ` idx${index}`
      return filler(OPEN_RISK_TEXT_LENGTH - suffix.length) + suffix
    })
    const openRiskRef = filler(RISK_REF_LENGTH)

    const updated = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: settledCriterionId, result: filler(20), result_status: 'verified' }],
      active_goal: filler(SPINE_FIELD_LENGTH),
      next_step: filler(SPINE_FIELD_LENGTH),
      risks_add: [
        { text: settledRiskText, scope: 'settled lane fixture', refs: [settledRiskRef], criterion_id: settledCriterionId },
        ...openRiskTexts.map((text) => ({
          text,
          scope: 'settled lane fixture',
          refs: [openRiskRef],
          criterion_id: openCriterionId
        }))
      ]
    })
    if (!updated.ok) {
      throw new Error(`expected update_thread to mark the criterion done and add the risks, it refused: ${updated.refusal.message}`)
    }
    const settledRiskId = updated.structured.risks_added[0]
    const openRiskIds = updated.structured.risks_added.slice(1)
    if (settledRiskId === undefined || openRiskIds.length !== OPEN_RISK_COUNT) {
      throw new Error('expected update_thread to mint one settled risk id and seven open risk ids')
    }

    const decided = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: filler(40),
      context: filler(40),
      options: [filler(20), filler(20)],
      outcome: filler(40)
    })
    if (!decided.ok) {
      throw new Error(`expected record_decision to record the fixture decision, it refused: ${decided.refusal.message}`)
    }

    for (let index = 0; index < SESSION_ENTRY_COUNT; index += 1) {
      const logged = await logSessionEventTool.handler(rt, STUB_TOOL_CTX, {
        thread_id: threadId,
        actor: 'claude',
        body: filler(SESSION_ENTRY_LENGTH)
      })
      if (!logged.ok) {
        throw new Error(`expected log_session_event to append the fixture session entry, it refused: ${logged.refusal.message}`)
      }
    }

    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    if (!resumed.ok) {
      throw new Error(`expected resume_thread to resume the fixture thread, it refused: ${resumed.refusal.message}`)
    }
    const briefing = resumed.structured.briefing

    assert.ok(
      briefing.includes('- some text on this briefing was shortened'),
      'the fixture must actually enter the clip search, or this test asserts nothing about the settled-lane clip regime; got no shortened-text footnote at all'
    )

    const settledLine = settledLineFor(briefing, settledRiskId)
    if (settledLine === undefined) {
      throw new Error(`expected the settled risk ${settledRiskId} to render a line in the settled section`)
    }
    assert.equal(settledLine, `- risk ${settledRiskId} ${escapeStored(settledRiskText)}`)

    for (const [index, riskId] of openRiskIds.entries()) {
      const riskText = openRiskTexts[index]
      if (riskText === undefined) throw new Error('open risk text missing at index ' + index)
      const riskLine = liveRiskLineFor(briefing, riskId)
      if (riskLine === undefined) {
        throw new Error(`expected open risk ${riskId} to render a line in the open risks section`)
      }
      assert.equal(riskLine, `- ${riskId} ${escapeStored(riskText)}`)
    }

    const openRiskRefLines = briefing.split('\n').filter((line) => line === `  - ref: ${openRiskRef}`)
    assert.equal(
      openRiskRefLines.length,
      OPEN_RISK_COUNT,
      `expected all ${OPEN_RISK_COUNT} open risk ref lines to render untouched, got ${openRiskRefLines.length}`
    )

    assert.ok(
      briefing.includes(
        '- some text on this briefing was shortened to fit the size budget for one reply; every shortened value ends with ...[shortened]'
      ),
      'expected the shortened-text footnote to name the size budget for one reply, not the character budget alone, once a lane can be clipped past its per-lane ceiling to spend that budget where it is actually needed'
    )
  })
})
