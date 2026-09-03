import { realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { LEDGER_REF } from '../store/ref.ts'
import { errnoCode } from '../store/detail.ts'
import { isLedgerToolName } from '../server/tool-names.ts'
import { isPureStoreRead } from './bash-read.ts'
import { hasOptedOutOfBashPrompts } from './bash-prompt-optout.ts'

export type GuardVerdict =
  | { kind: 'allow'; reason: string }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string }
  | { kind: 'silent' }

export const LEDGER_TOOL_PATTERN = /^mcp__(?:plugin_logbook_)?ledger__([A-Za-z][A-Za-z0-9_]*)$/

const isRegisteredLedgerTool = (toolName: string): boolean => {
  const matched = LEDGER_TOOL_PATTERN.exec(toolName)
  const suffix = matched?.[1]
  return suffix !== undefined && isLedgerToolName(suffix)
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const NOT_A_BOUNDARY = 'this guard prompts for confirmation and is not a security boundary'
const USE_TOOLS = 'to write the ledger, use the ledger MCP tools (mcp__ledger__* or mcp__plugin_logbook_ledger__*)'
const CLAUDE_PLUGIN_DATA_TOKEN = /(?<![A-Za-z0-9_])CLAUDE_PLUGIN_DATA(?![A-Za-z0-9_])/
const PATH_TOKEN_PATTERN = /[^\s"'`]*\/[^\s"'`]*/g

type Canon = { ok: true; path: string } | { ok: false }

const canonicaliseExistingPrefix = (target: string): Canon => {
  let current = target
  for (;;) {
    try {
      return { ok: true, path: realpathSync.native(current) + target.slice(current.length) }
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') return { ok: false }
      const parent = dirname(current)
      if (parent === current) return { ok: false }
      current = parent
    }
  }
}

const isWithinCanonicalRoot = (absoluteTarget: string, canonicalRoot: string, whenUnresolvable: boolean): boolean => {
  const canonical = canonicaliseExistingPrefix(absoluteTarget)
  if (!canonical.ok) return whenUnresolvable
  return canonical.path === canonicalRoot || canonical.path.startsWith(canonicalRoot + sep)
}

type StoreRoot = { kind: 'root'; canonicalPath: string } | { kind: 'unconfigured' } | { kind: 'unresolvable' }

const resolveStoreRoot = (rt: Runtime, projectRoot: string): StoreRoot => {
  const layout = layoutFor(rt, projectRoot)
  if (!layout.ok) return { kind: 'unconfigured' }
  const canonical = canonicaliseExistingPrefix(layout.value.root)
  if (!canonical.ok) return { kind: 'unresolvable' }
  return { kind: 'root', canonicalPath: canonical.path }
}

const targetPathOf = (toolInput: unknown): string | null => {
  if (typeof toolInput !== 'object' || toolInput === null) return null
  const input = toolInput as Record<string, unknown>
  if (typeof input.file_path === 'string' && input.file_path.length > 0) return input.file_path
  if (typeof input.notebook_path === 'string' && input.notebook_path.length > 0) return input.notebook_path
  return null
}

const bashCommandOf = (toolInput: unknown): string | null => {
  if (typeof toolInput !== 'object' || toolInput === null) return null
  const input = toolInput as Record<string, unknown>
  return typeof input.command === 'string' ? input.command : null
}

const commandTouchesConstant = (command: string): boolean =>
  command.includes(LEDGER_REF) || CLAUDE_PLUGIN_DATA_TOKEN.test(command)

const commandTouchesStoreRoot = (command: string, cwd: string, canonicalRoot: string): boolean => {
  const tokens = command.match(PATH_TOKEN_PATTERN) ?? []
  return tokens.some((token) => isWithinCanonicalRoot(resolve(cwd, token), canonicalRoot, false))
}

type PreToolUseEvent = { tool_name: string; tool_input: unknown; cwd: string; permission_mode: unknown }

const parsePreToolUseEvent = (raw: unknown, fallbackCwd: string): PreToolUseEvent | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const event = raw as Record<string, unknown>
  if (typeof event.tool_name !== 'string' || event.tool_name.length === 0) return null
  const cwd = typeof event.cwd === 'string' && event.cwd.length > 0 ? event.cwd : fallbackCwd
  return { tool_name: event.tool_name, tool_input: event.tool_input, cwd, permission_mode: event.permission_mode }
}

export const guardDecision = (rt: Runtime, raw: unknown): GuardVerdict => {
  const event = parsePreToolUseEvent(raw, rt.cwd)
  if (event === null) return { kind: 'silent' }

  if (isRegisteredLedgerTool(event.tool_name)) {
    return { kind: 'allow', reason: 'a registered logbook ledger tool call, auto-approved' }
  }

  const isWriteTool = WRITE_TOOLS.has(event.tool_name)
  const isBash = event.tool_name === 'Bash'
  if (!isWriteTool && !isBash) return { kind: 'silent' }
  if (isBash && hasOptedOutOfBashPrompts(rt, event.permission_mode)) return { kind: 'silent' }

  const storeRoot = resolveStoreRoot(rt, event.cwd)
  if (storeRoot.kind === 'unconfigured') return { kind: 'silent' }
  if (storeRoot.kind === 'unresolvable') {
    return isWriteTool
      ? { kind: 'deny', reason: `the Logbook store path could not be verified; ${USE_TOOLS}` }
      : { kind: 'ask', reason: `the Logbook store path could not be verified; ${NOT_A_BOUNDARY}; ${USE_TOOLS}` }
  }

  if (isWriteTool) {
    const target = targetPathOf(event.tool_input)
    if (target === null) return { kind: 'silent' }
    if (!isWithinCanonicalRoot(resolve(event.cwd, target), storeRoot.canonicalPath, true)) return { kind: 'silent' }
    return { kind: 'deny', reason: `${event.tool_name} into the Logbook store is not permitted; ${USE_TOOLS}` }
  }

  const command = bashCommandOf(event.tool_input)
  if (command === null) {
    return {
      kind: 'ask',
      reason: `the Logbook guard could not read this Bash command as a string and refused to judge it; ${NOT_A_BOUNDARY}; ${USE_TOOLS}`
    }
  }
  const touches = commandTouchesConstant(command) || commandTouchesStoreRoot(command, event.cwd, storeRoot.canonicalPath)
  if (!touches) return { kind: 'silent' }
  if (isPureStoreRead(command, (text) => commandTouchesConstant(text) || commandTouchesStoreRoot(text, event.cwd, storeRoot.canonicalPath))) return { kind: 'silent' }
  return { kind: 'ask', reason: `this Bash command appears to touch the Logbook store; ${NOT_A_BOUNDARY}; ${USE_TOOLS}` }
}
