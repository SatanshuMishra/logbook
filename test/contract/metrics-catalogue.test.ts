import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const CATALOGUE_FILE = join(LOGBOOK_ROOT, 'src', 'metrics', 'catalogue.json')
const CATALOGUE_SCHEMA_FILE = join(LOGBOOK_ROOT, 'metrics', 'schema', 'catalogue.schema.json')
const LINE_SCHEMA_FILE = join(LOGBOOK_ROOT, 'metrics', 'schema', 'line.schema.json')
const C1_OPEN = /^- \[ \] c1 (.*)$/m

const OPEN_ARGS = {
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Fix the submit handler.',
  criteria: ['The login page loads']
}

const DECISION_ARGS = {
  thread_id: 'fix-login',
  title: 'Keep the session cookie',
  context: 'The mobile app reads the session cookie.',
  options: ['keep the cookie', 'move to a token'],
  outcome: 'keep the cookie, because the mobile app reads it'
}

type Line = Record<string, unknown>

type Folders = { repo: string; home: string; store: string }

type FieldEntry = {
  type: string
  values?: unknown[]
  fields?: Record<string, FieldEntry>
  items?: FieldEntry
}

type Catalogue = {
  plugin: string
  objectives: { measured_by: string[] }[]
  events: Record<string, { fields: Record<string, FieldEntry> }>
  summary: { fields: Record<string, FieldEntry> }
}

type SchemaNode = Record<string, unknown>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-metrics-catalogue-${label}-`))

const makeRepo = (): string => {
  const repo = scratch('repo')
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFolders = async (fn: (folders: Folders) => Promise<void>): Promise<void> => {
  const folders = { repo: makeRepo(), home: scratch('home'), store: scratch('store') }
  try {
    await fn(folders)
  } finally {
    for (const folder of Object.values(folders)) rmSync(folder, { recursive: true, force: true })
  }
}

const rawCall = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

const callTool = async (
  spawned: SpawnedServer,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> => {
  const reply = await rawCall(spawned, name, args)
  assert.equal(reply.isError, undefined, `expected ${name} to succeed, got: ${JSON.stringify(reply)}`)
  return reply
}

const hookEvent = (folders: Folders, hookEventName: string, fields: Line): Line => ({
  session_id: 's-1',
  transcript_path: join(folders.home, 'P', 's-1.jsonl'),
  cwd: folders.repo,
  hook_event_name: hookEventName,
  ...fields
})

const runHook = async (folders: Folders, hook: string, event: Line): Promise<void> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook, event, env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store } })
  assert.equal(run.code, 0, run.stderr)
}

const editEvent = (folders: Folders, workingCopy: string, toolUseId: string): Line =>
  hookEvent(folders, 'PostToolUse', {
    prompt_id: 'p-0',
    tool_use_id: toolUseId,
    tool_name: 'Edit',
    tool_input: { file_path: workingCopy, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
    tool_response: { filePath: workingCopy }
  })

const milestoneEvent = (folders: Folders): Line =>
  hookEvent(folders, 'PostToolUse', {
    prompt_id: 'p-1',
    tool_use_id: 'toolu_10',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m x' },
    tool_response: { stdout: '[main 1234567] x', stderr: '' }
  })

const storedText = async (folders: Folders): Promise<string> => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { readDocument } = await import('../../src/thread/store.ts')
  const rt = testRuntime({ cwd: folders.repo, env: { PATH: process.env.PATH, HOME: folders.home }, sessionId: 's-1' })
  const found = findRepository(rt, folders.repo)
  assert.ok(found.ok, 'the test repository must be found')
  const text = readDocument(rt, found.value, 'fix-login')?.text
  assert.equal(typeof text, 'string')
  return String(text)
}

const runScratchThread = async (folders: Folders): Promise<void> => {
  const spawned = await spawnServer({
    projectRoot: folders.repo,
    entry: ENTRY,
    env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store, CLAUDE_CODE_SESSION_ID: 's-1' }
  })
  try {
    const opened = await callTool(spawned, 'open_thread', OPEN_ARGS)
    const workingCopy = String((opened.structuredContent as Line | undefined)?.path)
    await callTool(spawned, 'update_thread', { thread_id: 'fix-login', next_step: 'Write the login test.' })
    const refused = await rawCall(spawned, 'update_thread', {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c9', result: 'the login test passed' }]
    })
    assert.equal(refused.isError, true, JSON.stringify(refused))
    await callTool(spawned, 'record_decision', DECISION_ARGS)
    const stored = await storedText(folders)
    assert.match(stored, C1_OPEN)
    writeFileSync(workingCopy, stored.replace(C1_OPEN, '- [x] c1 $1'))
    await runHook(folders, 'post-tool-use', editEvent(folders, workingCopy, 'toolu_00'))
    writeFileSync(workingCopy, stored.replace(C1_OPEN, '- [x] c1 $1 evidence: the login test passed'))
    await runHook(folders, 'post-tool-use', editEvent(folders, workingCopy, 'toolu_01'))
    await runHook(folders, 'session-start', hookEvent(folders, 'SessionStart', { source: 'compact' }))
    await runHook(folders, 'post-tool-use', milestoneEvent(folders))
    await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
    await callTool(spawned, 'resume_thread', { thread_id: 'fix-login' })
    await callTool(spawned, 'close_thread', { thread_id: 'fix-login', outcome: 'done', detail: 'the login page works' })
  } finally {
    await spawned.close()
  }
}

const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line)

const storeFiles = (folders: Folders, kind: string, suffix: string): string[] => {
  const folder = join(folders.store, 'plugin=logbook', `kind=${kind}`)
  return existsSync(folder)
    ? readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith(suffix) && !name.endsWith('.tmp'))
        .map((name) => join(folder, name))
    : []
}

const valueProblems = (entry: FieldEntry, value: unknown, where: string): string[] => {
  if (value === null) return []
  switch (entry.type) {
    case 'integer':
      return Number.isInteger(value) ? [] : [`${where} is not an integer: ${JSON.stringify(value)}`]
    case 'number':
      return typeof value === 'number' ? [] : [`${where} is not a number: ${JSON.stringify(value)}`]
    case 'string':
      return typeof value === 'string' ? [] : [`${where} is not a string: ${JSON.stringify(value)}`]
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${where} is not a boolean: ${JSON.stringify(value)}`]
    case 'enum':
      return typeof value === 'string' && (entry.values ?? []).includes(value)
        ? []
        : [`${where} is not one of its values: ${JSON.stringify(value)}`]
    case 'object':
      return isPlainObject(value) ? fieldsProblems(entry.fields ?? {}, value, where) : [`${where} is not an object`]
    case 'array': {
      if (!Array.isArray(value)) return [`${where} is not an array`]
      const items = entry.items
      return items === undefined ? [] : value.flatMap((item, index) => valueProblems(items, item, `${where}[${index}]`))
    }
    default:
      return [`${where} has an unknown type ${entry.type}`]
  }
}

const fieldsProblems = (fields: Record<string, FieldEntry>, value: Record<string, unknown>, where: string): string[] =>
  Object.entries(value).flatMap(([key, item]) => {
    const entry = fields[key]
    return entry === undefined
      ? [`${where}.${key} is not described in the catalogue`]
      : valueProblems(entry, item, `${where}.${key}`)
  })

const ownFields = (line: Line, envelope: readonly string[]): Line =>
  Object.fromEntries(Object.entries(line).filter(([key]) => !envelope.includes(key)))

const lineProblems = (catalogue: Catalogue, envelope: readonly string[], line: Line, where: string): string[] => {
  const keyOrder = Object.keys(line).slice(0, envelope.length)
  const orderProblems =
    JSON.stringify(keyOrder) === JSON.stringify(envelope) ? [] : [`${where} begins with keys ${keyOrder.join(', ')}`]
  if (line.kind === 'summary') {
    return [...orderProblems, ...fieldsProblems(catalogue.summary.fields, ownFields(line, envelope), `${where} summary`)]
  }
  const event = catalogue.events[String(line.event)]
  if (event === undefined) return [...orderProblems, `${where} event ${String(line.event)} is not described`]
  return [...orderProblems, ...fieldsProblems(event.fields, ownFields(line, envelope), `${where} ${String(line.event)}`)]
}

const resolveRef = (schema: SchemaNode, node: SchemaNode): SchemaNode => {
  const ref = node.$ref
  if (typeof ref !== 'string') return node
  const definitions = isPlainObject(schema.$defs) ? schema.$defs : {}
  const target = definitions[ref.replace('#/$defs/', '')]
  assert.ok(isPlainObject(target), `the schema reference ${ref} must resolve`)
  return resolveRef(schema, target)
}

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const schemaProblems = (schema: SchemaNode, node: SchemaNode, value: unknown, where: string): string[] => {
  const resolved = resolveRef(schema, node)
  if (Array.isArray(value)) {
    const items = resolved.items
    return isPlainObject(items)
      ? value.flatMap((item, index) => schemaProblems(schema, items, item, `${where}[${index}]`))
      : []
  }
  if (!isPlainObject(value)) return []
  const properties = isPlainObject(resolved.properties) ? resolved.properties : {}
  const additional = resolved.additionalProperties
  const missing = stringsOf(resolved.required)
    .filter((key) => !(key in value))
    .map((key) => `${where} lacks the required key ${key}`)
  const extra =
    additional === false
      ? Object.keys(value)
          .filter((key) => !(key in properties))
          .map((key) => `${where} holds the key ${key}, which the schema does not allow`)
      : []
  const nested = Object.entries(value).flatMap(([key, item]) => {
    const child = properties[key] ?? additional
    return isPlainObject(child) ? schemaProblems(schema, child, item, `${where}.${key}`) : []
  })
  return [...missing, ...extra, ...nested]
}

const describesMeasure = (catalogue: Catalogue, measure: string): boolean => {
  if (measure.startsWith('summary.')) return catalogue.summary.fields[measure.slice('summary.'.length)] !== undefined
  const cut = measure.lastIndexOf('.')
  const event = catalogue.events[measure.slice(0, cut)]
  return cut > 0 && event !== undefined && event.fields[measure.slice(cut + 1)] !== undefined
}

test('metrics.every-written-field-is-described', async () => {
  await import('../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await runScratchThread(folders)
    const catalogue = readJson(CATALOGUE_FILE) as Catalogue
    const envelope = stringsOf((readJson(LINE_SCHEMA_FILE) as SchemaNode).required)
    assert.equal(envelope.length, 10)
    const eventLines = storeFiles(folders, 'event', '.jsonl').flatMap(linesOf)
    const summaryLines = storeFiles(folders, 'summary', '.json').flatMap(linesOf)
    assert.ok(eventLines.length > 0, 'the scratch thread must write event lines')
    assert.equal(summaryLines.length, 1)
    const written = new Set(eventLines.map((line) => line.event))
    for (const event of ['tool.call', 'doc.edit', 'doc.commit', 'doc.request', 'thread.pickup']) {
      assert.ok(written.has(event), `the scratch thread must write ${event}`)
    }
    const problems = [...eventLines, ...summaryLines].flatMap((line, index) =>
      lineProblems(catalogue, envelope, line, `line ${index}`)
    )
    assert.deepEqual(problems, [])
  })
})

test('metrics.catalogue-holds-every-key', () => {
  const catalogue = readJson(CATALOGUE_FILE)
  const schema = readJson(CATALOGUE_SCHEMA_FILE)
  assert.ok(isPlainObject(catalogue))
  assert.ok(isPlainObject(schema))
  assert.deepEqual(schemaProblems(schema, schema, catalogue, 'catalogue'), [])
  const typed = catalogue as Catalogue
  assert.equal(typed.plugin, 'logbook')
  const measures = typed.objectives.flatMap((objective) => objective.measured_by)
  assert.ok(measures.length > 0, 'the objectives must name measuring fields')
  assert.deepEqual(
    measures.filter((measure) => !describesMeasure(typed, measure)),
    []
  )
})

test('metrics.store-catalogue-equals-file', async () => {
  await import('../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await runScratchThread(folders)
    assert.deepEqual(readJson(join(folders.store, 'plugin=logbook', 'catalogue.json')), readJson(CATALOGUE_FILE))
  })
})
