import path from 'node:path'
import { commandRuntime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { refusalPayload } from '../server/errors.ts'
import { crashMessage, runTool, type ToolOutcome, type ToolSpec } from '../server/register.ts'
import { TOOL_SPECS } from '../server/tools/index.ts'
import { readDecisionsInForce } from '../thread/decisions.ts'
import { findRepository, RUN_WRITER_PREFIX, SESSION_ID_PATTERN, THREAD_SLUG_PATTERN } from '../thread/paths.ts'

export type CommandResult = { stdout: string[]; stderr: string[]; exitCode: 0 | 1 | 2 }

type WriteCommand = 'update_thread' | 'record_decision' | 'park_thread'

type CommandName = WriteCommand | 'decisions'

type FlagName = 'repo' | 'writer' | 'args' | 'thread'

type Flags = Readonly<Partial<Record<FlagName, string>>>

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string }

type Invocation =
  | { kind: 'write'; tool: WriteCommand; repo: string; writer: string; args: Record<string, unknown> }
  | { kind: 'decisions'; repo: string; thread: string }

const WRITE_COMMANDS: readonly WriteCommand[] = ['update_thread', 'record_decision', 'park_thread']
const COMMAND_NAMES: readonly CommandName[] = [...WRITE_COMMANDS, 'decisions']
const FLAG_NAMES: readonly FlagName[] = ['repo', 'writer', 'args', 'thread']
const WRITE_FLAGS: readonly FlagName[] = ['repo', 'writer', 'args']
const DECISIONS_FLAGS: readonly FlagName[] = ['repo', 'thread']
const FLAG_PREFIX = '--'
const USAGE_PREFIX = 'logbook: '
const USAGE_HINT = `usage: logbook <${WRITE_COMMANDS.join('|')}> --repo <root> --writer <name> --args <json>, or logbook decisions --repo <root> --thread <slug>`

const usage = (problem: string): CommandResult => ({
  stdout: [],
  stderr: [`${USAGE_PREFIX}${problem}; ${USAGE_HINT}`],
  exitCode: 2
})

const refused = (refusal: Refusal): CommandResult => ({
  stdout: [JSON.stringify(refusalPayload(refusal))],
  stderr: [refusal.message],
  exitCode: 1
})

const crashed = (command: string, message: string): CommandResult =>
  refused({
    ok: false,
    field: 'logbook',
    accepted: 'a call logbook completes',
    example: command,
    retryable: false,
    message
  })

const succeeded = (value: unknown): CommandResult => ({ stdout: [JSON.stringify(value)], stderr: [], exitCode: 0 })

const failed = <T>(problem: string): Parsed<T> => ({ ok: false, problem })

const commandNamed = (name: string): CommandName | null => COMMAND_NAMES.find((command) => command === name) ?? null

const flagNamed = (token: string): FlagName | null =>
  token.startsWith(FLAG_PREFIX) ? (FLAG_NAMES.find((flag) => `${FLAG_PREFIX}${flag}` === token) ?? null) : null

const readFlags = (command: CommandName, tokens: readonly string[], flags: Flags = {}): Parsed<Flags> => {
  const [token, value, ...rest] = tokens
  if (token === undefined) return { ok: true, value: flags }
  if (!token.startsWith(FLAG_PREFIX)) return failed(`unexpected argument ${JSON.stringify(token)}; every argument after the command is a flag and its value`)
  const flag = flagNamed(token)
  if (flag === null) return failed(`unknown flag ${JSON.stringify(token)}`)
  if (!COMMAND_TABLE[command].flags.includes(flag)) return failed(`${command} does not take ${token}`)
  if (flags[flag] !== undefined) return failed(`${token} was given more than once`)
  if (value === undefined || flagNamed(value) !== null) return failed(`${token} needs a value after it`)
  if (value === '') return failed(`${token} was given an empty value`)
  return readFlags(command, rest, { ...flags, [flag]: value })
}

const required = (command: CommandName, flags: Flags, flag: FlagName): Parsed<string> => {
  const value = flags[flag]
  return value === undefined ? failed(`${command} needs ${FLAG_PREFIX}${flag}`) : { ok: true, value }
}

const isWriterName = (writer: string): boolean =>
  writer.startsWith(RUN_WRITER_PREFIX)
    ? THREAD_SLUG_PATTERN.test(writer.slice(RUN_WRITER_PREFIX.length))
    : SESSION_ID_PATTERN.test(writer)

const parseWriter = (writer: string): Parsed<string> =>
  isWriterName(writer)
    ? { ok: true, value: writer }
    : failed(
        `--writer ${JSON.stringify(writer)} is neither run:<slug> with a slug matching ${THREAD_SLUG_PATTERN.source} nor a session id matching ${SESSION_ID_PATTERN.source}`
      )

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (text: string): Parsed<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return failed('--args is not valid JSON')
  }
}

const parseArgs = (text: string): Parsed<Record<string, unknown>> => {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  return isPlainObject(parsed.value) ? { ok: true, value: parsed.value } : failed('--args must be a JSON object')
}

const writeInvocation = (tool: WriteCommand, flags: Flags): Parsed<Invocation> => {
  const repo = required(tool, flags, 'repo')
  if (!repo.ok) return repo
  const writerText = required(tool, flags, 'writer')
  if (!writerText.ok) return writerText
  const argsText = required(tool, flags, 'args')
  if (!argsText.ok) return argsText
  const writer = parseWriter(writerText.value)
  if (!writer.ok) return writer
  const args = parseArgs(argsText.value)
  if (!args.ok) return args
  return { ok: true, value: { kind: 'write', tool, repo: path.resolve(repo.value), writer: writer.value, args: args.value } }
}

const decisionsInvocation = (flags: Flags): Parsed<Invocation> => {
  const repo = required('decisions', flags, 'repo')
  if (!repo.ok) return repo
  const thread = required('decisions', flags, 'thread')
  if (!thread.ok) return thread
  return { ok: true, value: { kind: 'decisions', repo: path.resolve(repo.value), thread: thread.value } }
}

type CommandEntry = { flags: readonly FlagName[]; invocation: (flags: Flags) => Parsed<Invocation> }

const writeEntry = (tool: WriteCommand): CommandEntry => ({
  flags: WRITE_FLAGS,
  invocation: (flags) => writeInvocation(tool, flags)
})

const COMMAND_TABLE: Readonly<Record<CommandName, CommandEntry>> = {
  update_thread: writeEntry('update_thread'),
  record_decision: writeEntry('record_decision'),
  park_thread: writeEntry('park_thread'),
  decisions: { flags: DECISIONS_FLAGS, invocation: decisionsInvocation }
}

export const parseCommandLine = (argv: readonly string[]): Parsed<Invocation> => {
  const [name, ...tokens] = argv
  if (name === undefined) return failed('no command given')
  const command = commandNamed(name)
  if (command === null) return failed(`unknown command ${JSON.stringify(name)}`)
  const flags = readFlags(command, tokens)
  if (!flags.ok) return flags
  return COMMAND_TABLE[command].invocation(flags.value)
}

const specNamed = (tool: WriteCommand): ToolSpec<unknown, unknown> => {
  const spec = TOOL_SPECS.find((candidate) => candidate.name === tool)
  if (spec === undefined) throw new Error(`no tool spec is named ${tool}`)
  return spec as unknown as ToolSpec<unknown, unknown>
}

const writeResult = (tool: WriteCommand, outcome: ToolOutcome<unknown>): CommandResult => {
  switch (outcome.kind) {
    case 'ok':
      return succeeded(outcome.structured)
    case 'refused':
      return refused(outcome.refusal)
    case 'crashed':
      return crashed(tool, outcome.message)
    default:
      throw new Error(`writeResult: unknown outcome kind ${JSON.stringify((outcome as { kind: unknown }).kind)}`)
  }
}

const runWrite = async (invocation: Extract<Invocation, { kind: 'write' }>): Promise<CommandResult> => {
  const rt = commandRuntime({ repo: invocation.repo, writer: invocation.writer })
  return writeResult(invocation.tool, await runTool(rt, specNamed(invocation.tool), invocation.args))
}

const runDecisions = (invocation: Extract<Invocation, { kind: 'decisions' }>): CommandResult => {
  const rt = commandRuntime({ repo: invocation.repo })
  const found = findRepository(rt, invocation.repo)
  if (!found.ok) return refused(found)
  const decisions = readDecisionsInForce(rt, found.value, invocation.thread)
  return decisions.ok ? succeeded(decisions.value) : refused(decisions)
}

const runInvocation = async (invocation: Invocation): Promise<CommandResult> => {
  switch (invocation.kind) {
    case 'write':
      return runWrite(invocation)
    case 'decisions':
      return runDecisions(invocation)
    default:
      throw new Error(`runInvocation: unknown invocation ${JSON.stringify((invocation as { kind: unknown }).kind)}`)
  }
}

const commandOf = (invocation: Invocation): string => (invocation.kind === 'write' ? invocation.tool : 'decisions')

export const runCommandLine = async (argv: readonly string[]): Promise<CommandResult> => {
  const parsed = parseCommandLine(argv)
  if (!parsed.ok) return usage(parsed.problem)
  try {
    return await runInvocation(parsed.value)
  } catch (error) {
    return crashed(commandOf(parsed.value), crashMessage(error))
  }
}
