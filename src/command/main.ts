import path from 'node:path'
import { claudeProcessOf, commandRuntime, SESSION_ID_ENV_KEY, type Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { refusalPayload } from '../server/errors.ts'
import { crashMessage, runTool, type ToolOutcome, type ToolSpec } from '../server/register.ts'
import { TOOL_SPECS } from '../server/tools/index.ts'
import { readRecordedDecisions } from '../thread/decisions.ts'
import { findRepository, RUN_WRITER_PREFIX, SESSION_ID_PATTERN, THREAD_SLUG_PATTERN } from '../thread/paths.ts'

export type CommandResult = { stdout: string[]; stderr: string[]; exitCode: 0 | 1 | 2 }

export type CommandContext = {
  env: Readonly<Record<string, string | undefined>>
  cwd: string
  readStdin: () => string
}

type WriteCommand = 'update_thread' | 'record_decision' | 'park_thread' | 'resume_thread'

type CommandName = WriteCommand | 'decisions'

type FlagName = 'repo' | 'writer' | 'args' | 'thread'

type Flags = Readonly<Partial<Record<FlagName, string>>>

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string }

type ChosenWriter = { kind: 'command'; name: string } | { kind: 'session'; name: string; process: number | null }

type Invocation =
  | { kind: 'write'; tool: WriteCommand; repo: string | null; writer: ChosenWriter; args: Record<string, unknown> }
  | { kind: 'decisions'; repo: string | null; thread: string }

type Located = { ok: true; repo: string } | { ok: false; result: CommandResult }

const WRITE_COMMANDS: readonly WriteCommand[] = ['update_thread', 'record_decision', 'park_thread', 'resume_thread']
const HOLDING_COMMAND: WriteCommand = 'resume_thread'
const STDIN_ARGS = '-'
const COMMAND_NAMES: readonly CommandName[] = [...WRITE_COMMANDS, 'decisions']
const FLAG_NAMES: readonly FlagName[] = ['repo', 'writer', 'args', 'thread']
const WRITE_FLAGS: readonly FlagName[] = ['repo', 'writer', 'args']
const DECISIONS_FLAGS: readonly FlagName[] = ['repo', 'thread']
const FLAG_PREFIX = '--'
const USAGE_PREFIX = 'logbook: '
const USAGE_HINT = `usage: logbook <${WRITE_COMMANDS.join('|')}> [--repo <root>] [--writer <name>] --args <json|${STDIN_ARGS}>, where --repo defaults to the repository of the current folder, --writer may be left out inside a Claude Code session and --args ${STDIN_ARGS} reads the JSON from standard input; or logbook decisions [--repo <root>] --thread <slug>`

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

const parseWriter = (writer: string): Parsed<ChosenWriter> =>
  isWriterName(writer)
    ? { ok: true, value: { kind: 'command', name: writer } }
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

const sessionWriter = (tool: WriteCommand, context: CommandContext): Parsed<ChosenWriter> => {
  const session = context.env[SESSION_ID_ENV_KEY]
  return session !== undefined && SESSION_ID_PATTERN.test(session)
    ? { ok: true, value: { kind: 'session', name: session, process: claudeProcessOf(context.env) } }
    : failed(`${tool} needs ${FLAG_PREFIX}writer`)
}

const chooseWriter = (tool: WriteCommand, flags: Flags, context: CommandContext): Parsed<ChosenWriter> => {
  const writer = flags.writer === undefined ? sessionWriter(tool, context) : parseWriter(flags.writer)
  if (!writer.ok) return writer
  return tool === HOLDING_COMMAND && writer.value.name.startsWith(RUN_WRITER_PREFIX)
    ? failed(`${tool} needs a session id as its writer, since a run never holds a thread`)
    : writer
}

const argsTextOf = (text: string, context: CommandContext): Parsed<string> => {
  if (text !== STDIN_ARGS) return { ok: true, value: text }
  try {
    return { ok: true, value: context.readStdin() }
  } catch (error) {
    return failed(`${FLAG_PREFIX}args ${STDIN_ARGS} could not read standard input: ${crashMessage(error)}`)
  }
}

const repoOf = (flags: Flags, context: CommandContext): string | null =>
  flags.repo === undefined ? null : path.resolve(context.cwd, flags.repo)

const writeInvocation = (tool: WriteCommand, flags: Flags, context: CommandContext): Parsed<Invocation> => {
  const argsFlag = required(tool, flags, 'args')
  if (!argsFlag.ok) return argsFlag
  const writer = chooseWriter(tool, flags, context)
  if (!writer.ok) return writer
  const argsText = argsTextOf(argsFlag.value, context)
  if (!argsText.ok) return argsText
  const args = parseArgs(argsText.value)
  if (!args.ok) return args
  return { ok: true, value: { kind: 'write', tool, repo: repoOf(flags, context), writer: writer.value, args: args.value } }
}

const decisionsInvocation = (flags: Flags, context: CommandContext): Parsed<Invocation> => {
  const thread = required('decisions', flags, 'thread')
  if (!thread.ok) return thread
  return { ok: true, value: { kind: 'decisions', repo: repoOf(flags, context), thread: thread.value } }
}

type CommandEntry = {
  flags: readonly FlagName[]
  invocation: (flags: Flags, context: CommandContext) => Parsed<Invocation>
}

const writeEntry = (tool: WriteCommand): CommandEntry => ({
  flags: WRITE_FLAGS,
  invocation: (flags, context) => writeInvocation(tool, flags, context)
})

const COMMAND_TABLE: Readonly<Record<CommandName, CommandEntry>> = {
  update_thread: writeEntry('update_thread'),
  record_decision: writeEntry('record_decision'),
  park_thread: writeEntry('park_thread'),
  resume_thread: writeEntry('resume_thread'),
  decisions: { flags: DECISIONS_FLAGS, invocation: decisionsInvocation }
}

export const parseCommandLine = (argv: readonly string[], context: CommandContext): Parsed<Invocation> => {
  const [name, ...tokens] = argv
  if (name === undefined) return failed('no command given')
  const command = commandNamed(name)
  if (command === null) return failed(`unknown command ${JSON.stringify(name)}`)
  const flags = readFlags(command, tokens)
  if (!flags.ok) return flags
  return COMMAND_TABLE[command].invocation(flags.value, context)
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

const writerRuntime = (repo: string, writer: ChosenWriter): Runtime => {
  switch (writer.kind) {
    case 'command':
      return commandRuntime({ repo, writer: writer.name })
    case 'session':
      return commandRuntime({ repo, writer: writer.name, writerKind: 'session', parentProcess: writer.process })
    default:
      throw new Error(`writerRuntime: unknown writer kind ${JSON.stringify((writer as { kind: unknown }).kind)}`)
  }
}

const runWrite = async (invocation: Extract<Invocation, { kind: 'write' }>, repo: string): Promise<CommandResult> => {
  const rt = writerRuntime(repo, invocation.writer)
  return writeResult(invocation.tool, await runTool(rt, specNamed(invocation.tool), invocation.args))
}

const runDecisions = (invocation: Extract<Invocation, { kind: 'decisions' }>, repo: string): CommandResult => {
  const rt = commandRuntime({ repo })
  const found = findRepository(rt, repo)
  if (!found.ok) return refused(found)
  const decisions = readRecordedDecisions(rt, found.value, invocation.thread)
  return decisions.ok ? succeeded(decisions.value) : refused(decisions)
}

const runInvocation = async (invocation: Invocation, repo: string): Promise<CommandResult> => {
  switch (invocation.kind) {
    case 'write':
      return runWrite(invocation, repo)
    case 'decisions':
      return runDecisions(invocation, repo)
    default:
      throw new Error(`runInvocation: unknown invocation ${JSON.stringify((invocation as { kind: unknown }).kind)}`)
  }
}

const commandOf = (invocation: Invocation): CommandName => (invocation.kind === 'write' ? invocation.tool : 'decisions')

const OUTSIDE_REPOSITORY_FIELD = 'cwd'

const locateRepository = (invocation: Invocation, context: CommandContext): Located => {
  if (invocation.repo !== null) return { ok: true, repo: invocation.repo }
  const found = findRepository(commandRuntime({ repo: context.cwd }), context.cwd)
  if (found.ok) return { ok: true, repo: found.value.root }
  return {
    ok: false,
    result:
      found.field === OUTSIDE_REPOSITORY_FIELD
        ? usage(`${commandOf(invocation)} needs ${FLAG_PREFIX}repo outside a git repository`)
        : refused(found)
  }
}

export const runCommandLine = async (argv: readonly string[], context: CommandContext): Promise<CommandResult> => {
  const parsed = parseCommandLine(argv, context)
  if (!parsed.ok) return usage(parsed.problem)
  try {
    const located = locateRepository(parsed.value, context)
    return located.ok ? await runInvocation(parsed.value, located.repo) : located.result
  } catch (error) {
    return crashed(commandOf(parsed.value), crashMessage(error))
  }
}
