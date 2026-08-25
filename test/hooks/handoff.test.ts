import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { controlledEnv, freshTmpDir, runHookProcessWithEvent, TREE_ROOT } from './hook-process.ts'

const HANDOFF_FRAGMENT = 'was left marked as being worked when this session ended'

test('handoff.bound-to-session-end', () => {
  const hooksJsonPath = path.join(TREE_ROOT, 'hooks', 'hooks.json')
  const parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>
  }

  const commandsFor = (eventName: string): string[] =>
    (parsed.hooks[eventName] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command))

  assert.ok(
    commandsFor('SessionEnd').some((command) => command.includes('session-end.ts')),
    'expected hooks.json SessionEnd binding to route to session-end.ts, which raises the hand-off notice'
  )
  assert.equal(
    commandsFor('Stop').some((command) => command.includes('session-end.ts')),
    false,
    'expected hooks.json Stop binding to not route to session-end.ts, which raises the hand-off notice'
  )
})

test('handoff.fires-once', () => {
  const projectRoot = freshTmpDir('logbook-handoff-project-')
  const pluginDataRoot = freshTmpDir('logbook-handoff-plugin-data-')
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })

  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)

  const sessionId = 'handoff-fires-once-session'
  const threadId = rt.ulid()
  writePointer(rt, layout.value, { thread_id: threadId, written_at: rt.now(), session_id: sessionId })

  const env = controlledEnv({ CLAUDE_PLUGIN_DATA: pluginDataRoot })
  const transcriptPath = path.join(projectRoot, 'transcript.jsonl')

  const exitCodes: number[] = []

  const startResult = runHookProcessWithEvent(
    'session-start',
    { session_id: sessionId, source: 'startup', cwd: projectRoot },
    { env }
  )
  assert.equal(startResult.status, 0, `expected SessionStart to exit 0; stderr: ${startResult.stderr}`)
  exitCodes.push(startResult.status as number)

  let handoffFiringsDuringTurns = 0
  for (let turn = 0; turn < 10; turn += 1) {
    const stopResult = runHookProcessWithEvent(
      'stop',
      {
        session_id: sessionId,
        cwd: projectRoot,
        transcript_path: transcriptPath,
        stop_hook_active: false
      },
      { env }
    )
    exitCodes.push(stopResult.status as number)
    if (stopResult.stdout.includes(HANDOFF_FRAGMENT) || stopResult.stderr.includes(HANDOFF_FRAGMENT)) {
      handoffFiringsDuringTurns += 1
    }
  }
  assert.equal(handoffFiringsDuringTurns, 0, 'expected the hand-off notice to fire zero times across ten Stop events')

  const endResult = runHookProcessWithEvent('session-end', { session_id: sessionId, reason: 'other', cwd: projectRoot }, { env })
  exitCodes.push(endResult.status as number)
  assert.equal(endResult.status, 0, `expected SessionEnd to exit 0; stderr: ${endResult.stderr}`)

  const endOccurrences = endResult.stdout.split(HANDOFF_FRAGMENT).length - 1
  assert.equal(endOccurrences, 1, `expected the hand-off notice to fire exactly once at SessionEnd, found ${endOccurrences}`)
  assert.ok(endResult.stdout.includes(threadId), 'expected the hand-off notice to name the thread left open')

  assert.ok(
    exitCodes.every((code) => code !== 2),
    `expected no invocation across the session to exit 2, got: ${exitCodes.join(', ')}`
  )
})

test('handoff.fires-once.no-pointer-set-fires-zero-times-at-session-end', () => {
  const projectRoot = freshTmpDir('logbook-handoff-negative-project-')
  const pluginDataRoot = freshTmpDir('logbook-handoff-negative-plugin-data-')
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })

  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)

  const env = controlledEnv({ CLAUDE_PLUGIN_DATA: pluginDataRoot })
  const endResult = runHookProcessWithEvent(
    'session-end',
    { session_id: 'handoff-negative-session', reason: 'other', cwd: projectRoot },
    { env }
  )
  assert.equal(endResult.status, 0, `expected SessionEnd to exit 0 with no pointer set; stderr: ${endResult.stderr}`)
  assert.equal(
    endResult.stdout.includes(HANDOFF_FRAGMENT),
    false,
    'expected no hand-off notice when no pointer was ever set'
  )
})
