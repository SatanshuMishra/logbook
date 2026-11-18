import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOOK_EVENT_FIELDS, HOOK_TOOL_NAME } from '../../src/server/hook-tool.ts'

type HookHandler = {
  readonly type: string
  readonly timeout: number
  readonly command?: string
  readonly if?: string
  readonly server?: string
  readonly tool?: string
  readonly input?: Record<string, unknown>
}

type HookGroup = { readonly matcher?: string; readonly hooks: readonly HookHandler[] }

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const MARKED_TOOLS = ['Bash', 'Agent', 'Task']

const readJson = (relative: string): unknown => JSON.parse(readFileSync(path.join(REPO_ROOT, relative), 'utf8'))

const loadHooks = (): Record<string, readonly HookGroup[]> =>
  (readJson('hooks/hooks.json') as { hooks: Record<string, readonly HookGroup[]> }).hooks

const hookToolServer = (): string => {
  const plugin = readJson('.claude-plugin/plugin.json') as { name: string }
  const serverKeys = Object.keys((readJson('.mcp.json') as { mcpServers: Record<string, unknown> }).mcpServers)
  assert.equal(serverKeys.length, 1, `.mcp.json must declare one server, found ${serverKeys.join(', ')}`)
  return `plugin:${plugin.name}:${serverKeys[0]}`
}

const groupOf = (hooks: Record<string, readonly HookGroup[]>, event: string, matcher: string | undefined): HookGroup => {
  const group = (hooks[event] ?? []).find((candidate) => candidate.matcher === matcher)
  assert.ok(group !== undefined, `${event} must hold a group with matcher ${String(matcher)}`)
  return group
}

const matchesMarkedTool = (group: HookGroup): boolean =>
  group.matcher === undefined || MARKED_TOOLS.some((tool) => new RegExp(group.matcher as string).test(tool))

test('hook-tool-wiring.per-call-hooks-call-the-hook-tool', () => {
  const hooks = loadHooks()
  const postMatcher = (hooks['PostToolUse'] ?? [])[0]?.matcher
  const expectations: ReadonlyArray<{ event: string; matcher: string | undefined; timeout: number }> = [
    { event: 'PreToolUse', matcher: '^(Bash|Agent|Task)$', timeout: 10 },
    { event: 'PostToolUse', matcher: postMatcher, timeout: 30 },
    { event: 'PostToolUseFailure', matcher: '^(Bash|Agent|Task)$', timeout: 10 },
    { event: 'Stop', matcher: undefined, timeout: 15 }
  ]
  const expectedInput = Object.fromEntries(HOOK_EVENT_FIELDS.map((field) => [field, `\${${field}}`]))

  for (const expectation of expectations) {
    const group = groupOf(hooks, expectation.event, expectation.matcher)
    assert.equal(group.hooks.length, 1, `${expectation.event} must hold exactly one handler`)
    const [handler] = group.hooks
    assert.deepEqual(
      handler,
      {
        type: 'mcp_tool',
        server: hookToolServer(),
        tool: HOOK_TOOL_NAME,
        input: expectedInput,
        timeout: expectation.timeout
      },
      expectation.event
    )
  }
})

test('hook-tool-wiring.no-command-hook-runs-for-a-bash-call', () => {
  const hooks = loadHooks()

  for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) {
    for (const group of (hooks[event] ?? []).filter(matchesMarkedTool)) {
      assert.deepEqual(
        group.hooks.filter((handler) => handler.type === 'command'),
        [],
        `${event} group ${String(group.matcher)} must start no command hook`
      )
    }
  }
  const stopHandlers = (hooks['Stop'] ?? []).flatMap((group) => group.hooks)
  assert.deepEqual(stopHandlers.filter((handler) => handler.type === 'command'), [])
  for (const event of ['SessionStart', 'SessionEnd']) {
    const handlers = (hooks[event] ?? []).flatMap((group) => group.hooks)
    assert.equal(handlers.filter((handler) => handler.type === 'command').length, 1, event)
  }
  const permission = groupOf(hooks, 'PreToolUse', '^(Read|Edit)$')
  assert.deepEqual(
    permission.hooks.map((handler) => [handler.type, handler.if]),
    [
      ['command', 'Read(~/.logbook/**)'],
      ['command', 'Edit(~/.logbook/**)']
    ]
  )
})
