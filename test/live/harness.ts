import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newDocument } from '../../src/doc/render.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { durableWrite } from '../../src/store/durable-write.ts'
import { takeHold } from '../../src/thread/holds.ts'
import { findRepository, repoKey, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { THREADS_REF, commitDocuments, readDocument } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

export type ToolCall = { id: string; name: string; input: Record<string, unknown>; at: number }

export type ToolResult = { toolUseId: string; text: string; isError: boolean; at: number }

export type HookResponse = { event: string; text: string; at: number }

export type AssistantText = { text: string; at: number }

export type Run = {
  sessionId: string | null
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
  hookResponses: HookResponse[]
  texts: AssistantText[]
  result: string | null
}

export type Session = { id: string; resume: boolean }

export type ThreadCommit = { commit: string; message: string; time: number; text: string }

const CLAUDE_COMMAND = 'claude'
const ALLOWED_TOOLS = 'Bash,Skill,mcp__ledger'
const SERVER_NAME = 'ledger'
const REPO_PREFIX = 'logbook-live-'
const README_TEXT = 'Disposable repository for a logbook live proof.\n'
const HARNESS_SESSION = 'live-harness'
const STDERR_TAIL_LINES = 20
const CLEARED_ENV_KEYS: readonly string[] = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_ENV_FILE'
]
const FIELD_SEPARATOR = '\u001f'

export const repoRoot = (): string => resolve(fileURLToPath(new URL('../..', import.meta.url)))

const homeFolder = (): string => {
  const home = process.env.HOME
  if (home === undefined || home === '') throw new Error('the live harness needs HOME, where logbook keeps the working copies')
  return home
}

const harnessRuntime = (dir: string, sessionId: string | null): Runtime =>
  testRuntime({
    cwd: dir,
    env: process.env,
    sessionId: sessionId ?? HARNESS_SESSION,
    start: new Date().toISOString(),
    stepMs: 1
  })

const runGit = (dir: string, args: string[]): string => {
  const result = rawGit(dir, args)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${result.stderr.trim()}`)
  return result.stdout
}

const repoPaths = (rt: Runtime, dir: string): RepoPaths => {
  const found = findRepository(rt, dir)
  if (!found.ok) throw new Error(`${found.field}: ${found.message}`)
  return found.value
}

export const makeRepo = async (): Promise<{ dir: string; cleanup: () => void }> => {
  const dir = mkdtempSync(join(tmpdir(), REPO_PREFIX))
  try {
    runGit(dir, ['init', '--initial-branch=main'])
    runGit(dir, ['config', 'user.name', 'Logbook Live Proof'])
    runGit(dir, ['config', 'user.email', 'live-proof@logbook.test'])
    writeFileSync(join(dir, 'README.md'), README_TEXT)
    runGit(dir, ['add', 'README.md'])
    runGit(dir, ['commit', '-m', 'initial commit'])
    const commonDir = runGit(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    const workingFolder = join(homeFolder(), '.logbook', repoKey(commonDir))
    const cleanup = (): void => {
      rmSync(dir, { recursive: true, force: true })
      rmSync(workingFolder, { recursive: true, force: true })
    }
    return { dir, cleanup }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

export const claudeArgs = (input: { model: string; root: string; session: Session; prompt: string }): string[] => [
  '-p',
  input.prompt,
  '--plugin-dir',
  input.root,
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--mcp-config',
  JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: 'node', args: [`${input.root}/bin/logbook-server.ts`] } } }),
  '--permission-mode',
  'acceptEdits',
  '--allowedTools',
  ALLOWED_TOOLS,
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-hook-events',
  '--model',
  input.model,
  input.session.resume ? '--resume' : '--session-id',
  input.session.id
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

const contentOf = (event: Record<string, unknown>): Record<string, unknown>[] => {
  const message = event.message
  if (!isRecord(message) || !Array.isArray(message.content)) return []
  return message.content.filter(isRecord)
}

const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .map((part) => stringOr(part.text, ''))
    .filter((text) => text !== '')
    .join('\n')
}

const hookText = (event: Record<string, unknown>): string => {
  const output = stringOr(event.output, '')
  return output !== '' ? output : stringOr(event.stdout, '')
}

type Stamped = { event: Record<string, unknown>; at: number }

const toolCallsOf = ({ event, at }: Stamped): ToolCall[] =>
  event.type !== 'assistant'
    ? []
    : contentOf(event)
        .filter((part) => part.type === 'tool_use')
        .map((part) => ({
          id: stringOr(part.id, ''),
          name: stringOr(part.name, ''),
          input: isRecord(part.input) ? part.input : {},
          at
        }))

const textsOf = ({ event, at }: Stamped): AssistantText[] =>
  event.type !== 'assistant'
    ? []
    : contentOf(event)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => ({ text: stringOr(part.text, ''), at }))

const toolResultsOf = ({ event, at }: Stamped): ToolResult[] =>
  event.type !== 'user'
    ? []
    : contentOf(event)
        .filter((part) => part.type === 'tool_result')
        .map((part) => ({
          toolUseId: stringOr(part.tool_use_id, ''),
          text: resultText(part.content),
          isError: part.is_error === true,
          at
        }))

const hookResponsesOf = ({ event, at }: Stamped): HookResponse[] =>
  event.type === 'system' && event.subtype === 'hook_response'
    ? [{ event: stringOr(event.hook_event, ''), text: hookText(event), at }]
    : []

export const parseStream = (text: string, arrivals?: number[]): Run => {
  const stamped: Stamped[] = text.split('\n').flatMap((line, index) => {
    const event = line.trim() === '' ? null : parseLine(line)
    return event === null ? [] : [{ event, at: arrivals?.[index] ?? index }]
  })
  const sessionIds = stamped.flatMap(({ event }) => (typeof event.session_id === 'string' ? [event.session_id] : []))
  const results = stamped.flatMap(({ event }) =>
    event.type === 'result' && typeof event.result === 'string' ? [event.result] : []
  )
  return {
    sessionId: sessionIds.at(-1) ?? null,
    toolCalls: stamped.flatMap(toolCallsOf),
    toolResults: stamped.flatMap(toolResultsOf),
    hookResponses: stamped.flatMap(hookResponsesOf),
    texts: stamped.flatMap(textsOf),
    result: results.at(-1) ?? null
  }
}

const childEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !CLEARED_ENV_KEYS.includes(key)))

const quoted = (arg: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)

const commandLine = (args: readonly string[]): string => [CLAUDE_COMMAND, ...args].map(quoted).join(' ')

export const runClaude = (input: { cwd: string; model: string; session: Session; prompt: string }): Promise<Run> => {
  const args = claudeArgs({ model: input.model, root: repoRoot(), session: input.session, prompt: input.prompt })
  return new Promise<Run>((resolveRun, rejectRun) => {
    const lines: string[] = []
    const arrivals: number[] = []
    const stderrChunks: string[] = []
    let pending = ''
    let settled = false
    const child = spawn(CLAUDE_COMMAND, args, { cwd: input.cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const parts = `${pending}${chunk}`.split('\n')
      pending = parts.pop() ?? ''
      const now = Date.now()
      for (const line of parts) {
        lines.push(line)
        arrivals.push(now)
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      rejectRun(
        new Error(
          error.code === 'ENOENT'
            ? `${CLAUDE_COMMAND} is not on PATH, so the live harness could not run: ${commandLine(args)}`
            : `the live harness could not start ${commandLine(args)}: ${error.message}`
        )
      )
    })
    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      if (pending !== '') {
        lines.push(pending)
        arrivals.push(Date.now())
      }
      if (code !== 0) {
        const stderrTail = stderrChunks.join('').split('\n').slice(-STDERR_TAIL_LINES).join('\n').trim()
        rejectRun(new Error(`${commandLine(args)} exited with ${String(code)} in ${input.cwd}: ${stderrTail}`))
        return
      }
      resolveRun(parseStream(lines.join('\n'), arrivals))
    })
  })
}

export const storeThread = (dir: string, input: { slug: string; text: string; holder: string | null }): void => {
  const rt = harnessRuntime(dir, input.holder)
  const paths = repoPaths(rt, dir)
  const stored = readDocument(rt, paths, input.slug)
  const committed = commitDocuments(rt, paths, {
    changes: [{ slug: input.slug, text: input.text, expectedBlob: stored === null ? null : stored.blob }],
    message: `store ${input.slug} for a live proof`
  })
  if (!committed.ok) {
    throw new Error(
      'cause' in committed
        ? `${input.slug} could not be stored: ${committed.cause}`
        : `${input.slug} could not be stored: ${committed.message}`
    )
  }
  const file = workingCopyPath(paths, input.slug)
  if (!file.ok) throw new Error(`${file.field}: ${file.message}`)
  mkdirSync(dirname(file.value), { recursive: true })
  durableWrite(file.value, input.text, { log: rt.log })
  if (input.holder !== null) takeHold(rt, paths, input.slug, input.holder, null)
}

export const openThread = (
  dir: string,
  input: { slug: string; title: string; goal: string; nextStep: string; criteria: readonly string[]; holder: string | null }
): string => {
  const text = newDocument({
    slug: input.slug,
    title: input.title,
    goal: input.goal,
    nextStep: input.nextStep,
    criteria: input.criteria,
    details: [],
    now: new Date().toISOString()
  })
  storeThread(dir, { slug: input.slug, text, holder: input.holder })
  return text
}

export const workingCopy = (dir: string, slug: string): string => {
  const rt = harnessRuntime(dir, null)
  const file = workingCopyPath(repoPaths(rt, dir), slug)
  if (!file.ok) throw new Error(`${file.field}: ${file.message}`)
  return file.value
}

export const threadCommits = (dir: string, slug: string): ThreadCommit[] => {
  if (rawGit(dir, ['rev-parse', '--verify', '--quiet', THREADS_REF]).status !== 0) return []
  const listed = runGit(dir, ['log', '--reverse', '--format=%H', THREADS_REF, '--', `${slug}.md`])
  return listed
    .split('\n')
    .filter((commit) => commit !== '')
    .map((commit) => {
      const [seconds = '0', message = ''] = runGit(dir, ['log', '-1', `--format=%ct${FIELD_SEPARATOR}%B`, commit]).split(
        FIELD_SEPARATOR
      )
      const shown = rawGit(dir, ['show', `${commit}:${slug}.md`])
      return {
        commit,
        message: message.trim(),
        time: Number(seconds) * 1000,
        text: shown.status === 0 ? shown.stdout : ''
      }
    })
}

const nonBlankLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

export const holdsThreeDocumentLines = (reply: string, documentText: string): boolean => {
  const documentLines = nonBlankLines(documentText)
  const replyLines = nonBlankLines(reply)
  return documentLines.slice(0, -2).some((_line, start) =>
    replyLines.slice(0, -2).some((_reply, at) =>
      [0, 1, 2].every((offset) => {
        const documentLine = documentLines[start + offset]
        const replyLine = replyLines[at + offset]
        return documentLine !== undefined && replyLine !== undefined && replyLine.includes(documentLine)
      })
    )
  )
}
