import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

interface HookHandler {
  readonly type: string
  readonly command: string
  readonly timeout: number
  readonly if?: string
}

interface HookGroup {
  readonly matcher?: string
  readonly hooks: readonly HookHandler[]
}

const loadHooks = (): Record<string, readonly HookGroup[]> => {
  const parsed = JSON.parse(readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8')) as {
    hooks: Record<string, readonly HookGroup[]>
  }
  return parsed.hooks
}

const commandFor = (entry: string): string => `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${entry}.ts"`

const MATCHING_TOOLS = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'Agent',
  'Task',
  'mcp__github__create_pull_request'
]

const OTHER_TOOLS = [
  'Read',
  'Skill',
  'mcp__ledger__update_thread',
  'EditNotebook',
  'BashOutput',
  'mcp__github__create_pull_request_review'
]

const ALL_TOOLS = [...MATCHING_TOOLS, ...OTHER_TOOLS]

const matched = (matcher: string | undefined, tools: readonly string[]): string[] => {
  assert.ok(matcher !== undefined)
  const pattern = new RegExp(matcher)
  return tools.filter((tool) => pattern.test(tool))
}

test('hooks-wiring.events-entries-and-timeouts', () => {
  const hooks = loadHooks()
  assert.deepEqual(Object.keys(hooks).sort(), [
    'PostToolUse',
    'PostToolUseFailure',
    'PreToolUse',
    'SessionEnd',
    'SessionStart',
    'Stop'
  ])
  assert.equal('UserPromptSubmit' in hooks, false)

  const expectations: ReadonlyArray<{
    event: string
    matchers: ReadonlyArray<string | undefined>
    entry: string
    timeout: number
  }> = [
    { event: 'SessionStart', matchers: [undefined], entry: 'session-start', timeout: 30 },
    { event: 'PreToolUse', matchers: ['^(Bash|Agent|Task)$', '^(Read|Edit)$'], entry: 'pre-tool-use', timeout: 10 },
    {
      event: 'PostToolUse',
      matchers: ['^(Edit|Write|MultiEdit|NotebookEdit|Bash|Agent|Task|mcp__.+__(create|merge)_pull_request)$'],
      entry: 'post-tool-use',
      timeout: 30
    },
    { event: 'PostToolUseFailure', matchers: ['^(Bash|Agent|Task)$'], entry: 'post-tool-use', timeout: 10 },
    { event: 'Stop', matchers: [undefined], entry: 'stop', timeout: 15 },
    { event: 'SessionEnd', matchers: [undefined], entry: 'session-end', timeout: 15 }
  ]

  for (const expectation of expectations) {
    const groups = hooks[expectation.event] ?? []
    assert.deepEqual(
      groups.map((group) => group.matcher),
      expectation.matchers,
      expectation.event
    )
    for (const group of groups) {
      assert.equal('matcher' in group, group.matcher !== undefined)
      assert.ok(group.hooks.length > 0, expectation.event)
      for (const handler of group.hooks) {
        assert.equal(handler.type, 'command')
        assert.equal(handler.command, commandFor(expectation.entry))
        assert.equal(handler.timeout, expectation.timeout)
      }
    }
    assert.ok(existsSync(path.join(REPO_ROOT, 'hooks', `${expectation.entry}.ts`)), expectation.entry)
  }
})

test('hooks-wiring.permission-handlers-start-only-for-working-copies', () => {
  const groups = loadHooks()['PreToolUse'] ?? []
  const permissionGroup = groups.find((group) => group.matcher === '^(Read|Edit)$')
  assert.ok(permissionGroup)
  assert.deepEqual(
    permissionGroup.hooks.map((handler) => handler.if),
    ['Read(~/.logbook/**)', 'Edit(~/.logbook/**)']
  )
  for (const handler of permissionGroup.hooks) {
    assert.equal(handler.type, 'command')
    assert.equal(handler.command, commandFor('pre-tool-use'))
    assert.equal(handler.timeout, 10)
  }
  const markerGroup = groups.find((group) => group.matcher === '^(Bash|Agent|Task)$')
  assert.ok(markerGroup)
  for (const handler of markerGroup.hooks) {
    assert.equal('if' in handler, false)
  }
})

test('hooks-wiring.packaging-check-expects-the-new-hooks', async () => {
  const specifier = '../../scripts/check-packaging.mjs'
  const script = (await import(specifier)) as {
    REQUIRED_HOOK_EVENTS: string[]
    EVENT_HOOK_FILES: Record<string, string>
    REQUIRED_FILES: string[]
  }
  assert.deepEqual([...script.REQUIRED_HOOK_EVENTS].sort(), [
    'PostToolUse',
    'PostToolUseFailure',
    'PreToolUse',
    'SessionEnd',
    'SessionStart',
    'Stop'
  ])
  assert.deepEqual(script.EVENT_HOOK_FILES, {
    SessionStart: 'session-start',
    PreToolUse: 'pre-tool-use',
    PostToolUse: 'post-tool-use',
    PostToolUseFailure: 'post-tool-use',
    Stop: 'stop',
    SessionEnd: 'session-end'
  })
  assert.ok(script.REQUIRED_FILES.includes('hooks/post-tool-use.ts'))
  assert.equal(script.REQUIRED_FILES.includes('hooks/user-prompt-submit.ts'), false)

  const result = spawnSync(process.execPath, ['scripts/check-packaging.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
})

test('hooks-wiring.matchers-select-the-right-tools', () => {
  const hooks = loadHooks()
  const preGroups = hooks['PreToolUse'] ?? []
  const post = hooks['PostToolUse'] ?? []
  const failure = hooks['PostToolUseFailure'] ?? []

  assert.deepEqual(matched(post[0]?.matcher, ALL_TOOLS), MATCHING_TOOLS)
  assert.deepEqual(matched(preGroups[0]?.matcher, ALL_TOOLS), ['Bash', 'Agent', 'Task'])
  assert.deepEqual(matched(failure[0]?.matcher, ALL_TOOLS), ['Bash', 'Agent', 'Task'])
  assert.deepEqual(matched(preGroups[1]?.matcher, ALL_TOOLS), ['Edit', 'Read'])
})
