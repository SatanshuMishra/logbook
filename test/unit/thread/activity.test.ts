import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE_MS = Date.UTC(2026, 9, 14, 12)
const at = (offsetMs: number): string => new Date(BASE_MS + offsetMs).toISOString()
const SINCE = at(0)
const AFTER = at(1000)

type Line = Record<string, unknown> | string

const userEntry = (content: unknown, timestamp: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content },
  ...extra
})

const assistantEntry = (blocks: unknown[], timestamp: string): Record<string, unknown> => ({
  type: 'assistant',
  timestamp,
  message: { role: 'assistant', content: blocks }
})

const toolUse = (id: string, name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: 'tool_use',
  id,
  name,
  input
})

const toolResult = (toolUseId: string, content: unknown, isError?: boolean): Record<string, unknown> =>
  isError === undefined
    ? { type: 'tool_result', tool_use_id: toolUseId, content }
    : { type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }

const withDir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-'))
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const writeTranscript = (dir: string, name: string, lines: readonly Line[]): string => {
  const file = join(dir, name)
  writeFileSync(file, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n')
  return file
}

test('activity.user-message', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [userEntry('Ship it\nnow', AFTER)])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['User: Ship it'])
    assert.equal(activity.userWrote, true)
  })
})

test('activity.user-message-in-text-blocks', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      userEntry(
        [
          { type: 'text', text: 'Use the second option\nthanks' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
        ],
        AFTER
      )
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['User: Use the second option'])
    assert.equal(activity.userWrote, true)
  })
})

test('activity.slash-command-and-shell-line-count-as-the-user', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      userEntry(
        '<command-message>logbook:preflight</command-message>\n<command-name>/logbook:preflight</command-name>',
        AFTER
      ),
      userEntry('<bash-input>git status</bash-input>', at(2000))
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, [
      'User: <command-message>logbook:preflight</command-message>',
      'User: <bash-input>git status</bash-input>'
    ])
    assert.equal(activity.userWrote, true)
  })
})

test('activity.host-written-user-entries-are-left-out', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      userEntry('Base directory for this skill: x', AFTER, { isMeta: true }),
      userEntry('This session is being continued from a previous conversation', at(2000), { isCompactSummary: true }),
      userEntry('<task-notification>\n<task-id>a</task-id>', at(3000)),
      userEntry('<local-command-stdout>ok</local-command-stdout>', at(4000)),
      userEntry([{ type: 'text', text: '[Request interrupted by user]' }], at(5000))
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(
      activity.lines.filter((line) => line.startsWith('User:')),
      []
    )
    assert.equal(activity.userWrote, false)
  })
})

test('activity.tool-results-are-not-user-messages', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      userEntry([toolResult('toolu_read', 'file contents')], AFTER)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(
      activity.lines.filter((line) => line.startsWith('User:')),
      []
    )
    assert.equal(activity.userWrote, false)
  })
})

test('activity.read-only-calls-are-left-out', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Read', { file_path: '/repo/src/a.ts' })], AFTER),
      assistantEntry([toolUse('toolu_2', 'Grep', { pattern: 'buildActivity' })], at(2000)),
      assistantEntry([toolUse('toolu_3', 'WebFetch', { url: 'https://example.com', prompt: 'summarise' })], at(3000)),
      assistantEntry([toolUse('toolu_4', 'mcp__ledger__list_threads', {})], at(4000))
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, [])
    assert.equal(activity.changed, false)
  })
})

test('activity.bash-call', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Bash', { command: 'git commit -m fix\nmore' })], AFTER)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Bash: git commit -m fix'])
    assert.equal(activity.changed, true)
  })
})

test('activity.edit-of-a-project-file', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })], AFTER)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Edit: /repo/src/a.ts'])
    assert.equal(activity.changed, true)
  })
})

test('activity.edit-of-the-working-copy-is-left-out', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const workingCopyPath = join(dir, 'fix-login.md')
    writeFileSync(workingCopyPath, '# Fix login\n')
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Edit', { file_path: workingCopyPath, old_string: 'a', new_string: 'b' })], AFTER)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath })
    assert.deepEqual(activity.lines, [])
    assert.equal(activity.changed, false)
  })
})

test('activity.edit-of-the-working-copy-by-its-real-path-is-left-out', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const workingCopyPath = join(dir, 'fix-login.md')
    writeFileSync(workingCopyPath, '# Fix login\n')
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry(
        [toolUse('toolu_1', 'Write', { file_path: realpathSync(workingCopyPath), content: '# Fix login\n' })],
        AFTER
      )
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath })
    assert.deepEqual(activity.lines, [])
    assert.equal(activity.changed, false)
  })
})

test('activity.agent-call-with-its-result', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry(
        [toolUse('toolu_1', 'Agent', { description: 'review the diff', prompt: 'Review it.', subagent_type: 'code-reviewer' })],
        AFTER
      ),
      userEntry([toolResult('toolu_1', [{ type: 'text', text: 'No blockers found.\nTwo advisories follow.' }])], at(2000))
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Agent: review the diff - No blockers found.'])
  })
})

test('activity.skill-call', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Skill', { skill: 'interphase:feature' })], AFTER)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Skill: interphase:feature'])
  })
})

test('activity.other-tool-call', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry(
        [
          toolUse('toolu_1', 'mcp__github__create_pull_request', {
            owner: 'octo',
            repo: 'app',
            title: 'Fix login',
            head: 'fix-login',
            base: 'main'
          })
        ],
        AFTER
      )
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['mcp__github__create_pull_request'])
  })
})

test('activity.failed-call-is-marked', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Bash', { command: 'ls /nonexistent-dir' })], AFTER),
      userEntry([toolResult('toolu_1', 'Exit code 1\nls: /nonexistent-dir: No such file or directory', true)], at(2000))
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Bash: ls /nonexistent-dir (failed)'])
  })
})

test('activity.last-reply', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([{ type: 'text', text: 'First.' }], AFTER),
      assistantEntry([{ type: 'text', text: 'Done, tests pass.\nMore.' }], at(2000))
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Last reply: Done, tests pass.'])
  })
})

test('activity.skips-other-entries-and-broken-lines', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      { type: 'attachment', timestamp: AFTER, attachment: { type: 'file', path: '/repo/a.ts' } },
      { type: 'file-history-snapshot', messageId: 'm1', snapshot: { trackedFileBackups: {} } },
      { type: 'queue-operation', operation: 'enqueue', timestamp: at(2000), content: 'next' },
      '{broken'
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity, { lines: [], changed: false, userWrote: false })
  })
})

test('activity.only-after-the-time', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Bash', { command: 'echo before' })], at(-1000)),
      assistantEntry([toolUse('toolu_2', 'Bash', { command: 'echo after' })], AFTER)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity.lines, ['Bash: echo after'])
  })
})

test('activity.entry-at-the-time-is-left-out', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const transcript = writeTranscript(dir, 't.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Bash', { command: 'echo at' })], SINCE),
      userEntry('Ship it', SINCE)
    ])
    const activity = buildActivity({ transcripts: [transcript], since: SINCE, workingCopyPath: join(dir, 'doc.md') })
    assert.deepEqual(activity, { lines: [], changed: false, userWrote: false })
  })
})

test('activity.reads-transcripts-in-order-and-skips-missing-ones', async () => {
  const { buildActivity } = await import('../../../src/thread/activity.ts')
  await withDir(async (dir) => {
    const t1 = writeTranscript(dir, 't1.jsonl', [
      assistantEntry([toolUse('toolu_1', 'Bash', { command: 'echo one' })], AFTER)
    ])
    const t2 = writeTranscript(dir, 't2.jsonl', [
      assistantEntry([toolUse('toolu_2', 'Bash', { command: 'echo two' })], at(2000))
    ])
    const activity = buildActivity({
      transcripts: [join(dir, 'missing.jsonl'), t1, t2],
      since: SINCE,
      workingCopyPath: join(dir, 'doc.md')
    })
    assert.deepEqual(activity.lines, ['Bash: echo one', 'Bash: echo two'])
  })
})
