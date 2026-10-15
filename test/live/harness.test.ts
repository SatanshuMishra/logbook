import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

test('harness.builds-the-isolated-command', async () => {
  const { claudeArgs } = await import('./harness.ts')
  const id = randomUUID()

  const fresh = claudeArgs({
    model: 'opus',
    root: '/tmp/logbook-root',
    session: { id, resume: false },
    prompt: 'Reply with one word.'
  })
  assert.deepEqual(fresh, [
    '-p',
    'Reply with one word.',
    '--plugin-dir',
    '/tmp/logbook-root',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{"ledger":{"command":"node","args":["/tmp/logbook-root/bin/logbook-server.ts"]}}}',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Bash,Skill,mcp__ledger',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-hook-events',
    '--model',
    'opus',
    '--session-id',
    id
  ])

  const mcpConfig = JSON.parse(fresh[fresh.indexOf('--mcp-config') + 1] ?? '') as {
    mcpServers: Record<string, unknown>
  }
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ['ledger'])
  assert.equal(fresh.includes('bypassPermissions'), false)

  const resumed = claudeArgs({
    model: 'sonnet',
    root: '/tmp/logbook-root',
    session: { id, resume: true },
    prompt: 'Reply with one word.'
  })
  assert.deepEqual(resumed.slice(-4), ['--model', 'sonnet', '--resume', id])
  assert.equal(resumed.includes('--session-id'), false)
})

test('harness.parses-a-recorded-stream', async () => {
  const { parseStream } = await import('./harness.ts')
  const sessionId = randomUUID()
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId, tools: ['Edit', 'Read'] }),
    JSON.stringify({
      type: 'assistant',
      session_id: sessionId,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Updating the state document.' },
          {
            type: 'tool_use',
            id: 'toolu_edit_1',
            name: 'Edit',
            input: { file_path: '/home/me/.logbook/demo-0123456789ab/team-notes.md', old_string: 'Not started.', new_string: 'notes.md is committed.' }
          }
        ]
      }
    }),
    JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_edit_1',
            content: [{ type: 'text', text: 'The file has been updated.' }],
            is_error: false
          }
        ]
      }
    }),
    JSON.stringify({
      type: 'system',
      subtype: 'hook_response',
      session_id: sessionId,
      hook_id: 'hook-1',
      hook_name: 'PostToolUse:Edit',
      hook_event: 'PostToolUse',
      output: 'logbook: accepted the update to team-notes (commit 1a2b3c4d).',
      stdout: '',
      stderr: '',
      exit_code: 0,
      outcome: 'success'
    }),
    '{broken',
    JSON.stringify({ type: 'result', subtype: 'success', session_id: sessionId, result: 'Done: notes.md is committed.' })
  ]

  const run = parseStream(lines.join('\n'))
  assert.equal(run.sessionId, sessionId)
  assert.deepEqual(run.toolCalls, [
    {
      id: 'toolu_edit_1',
      name: 'Edit',
      input: { file_path: '/home/me/.logbook/demo-0123456789ab/team-notes.md', old_string: 'Not started.', new_string: 'notes.md is committed.' },
      at: 1
    }
  ])
  assert.deepEqual(run.toolResults, [
    { toolUseId: 'toolu_edit_1', text: 'The file has been updated.', isError: false, at: 2 }
  ])
  assert.deepEqual(run.hookResponses, [
    { event: 'PostToolUse', text: 'logbook: accepted the update to team-notes (commit 1a2b3c4d).', at: 3 }
  ])
  assert.deepEqual(run.texts, [{ text: 'Updating the state document.', at: 1 }])
  assert.equal(run.result, 'Done: notes.md is committed.')

  const arrivals = [1000, 1250, 1500, 1750, 2000, 2250]
  const stamped = parseStream(lines.join('\n'), arrivals)
  assert.equal(stamped.toolCalls[0]?.at, 1250)
  assert.equal(stamped.toolResults[0]?.at, 1500)
  assert.equal(stamped.hookResponses[0]?.at, 1750)
  assert.equal(stamped.toolCalls.length, 1)
  assert.equal(stamped.result, 'Done: notes.md is committed.')
})

const skillFiles = (): string[] =>
  readdirSync(join(REPO_ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(REPO_ROOT, 'skills', entry.name, 'SKILL.md'))

test('harness.held-out-cases-do-not-leak', async () => {
  const cases = await import('./cases.ts')
  const phrases = [
    ...cases.EDIT_UPDATE_CASES.map((entry) => entry.prompt),
    ...cases.STALE_LINE_CASES.flatMap((entry) => [entry.prompt, ...entry.markers]),
    ...cases.LONG_SEQUENCE_CASE.turns,
    ...cases.CONTINUE_CASE.questions.map((entry) => entry.question)
  ]
  assert.equal(phrases.length, 3 + 3 * 4 + 8 + 4)

  const files = [
    join(REPO_ROOT, 'src', 'doc', 'rules.ts'),
    join(REPO_ROOT, 'src', 'server', 'instructions.ts'),
    ...skillFiles()
  ]
  assert.ok(files.length >= 3, 'no skills SKILL.md file was found')

  const leaks = files.flatMap((file) => {
    const text = readFileSync(file, 'utf8').toLowerCase()
    return phrases
      .filter((phrase) => text.includes(phrase.toLowerCase()))
      .map((phrase) => `${file.slice(REPO_ROOT.length)} holds the held-out phrase ${JSON.stringify(phrase)}`)
  })
  assert.deepEqual(leaks, [], leaks.join('\n'))
})

test('harness.prove-runs-only-live-tests', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  assert.equal(pkg.scripts.prove, 'node --test --test-concurrency=1 "test/live/**/*.test.ts"')
  assert.equal(typeof pkg.scripts.test, 'string')
  assert.equal(pkg.scripts.test?.includes('test/live'), false, `npm test names a test/live path: ${pkg.scripts.test}`)
})
