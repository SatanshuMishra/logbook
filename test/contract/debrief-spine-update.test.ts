import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const DEBRIEF_SKILL_PATH = join(PROJECT_ROOT, 'skills', 'debrief', 'SKILL.md')

const PARK_TOOL_NAME = 'park_thread'
const SEQUENCE_HEADING_PATTERN = /## Sequence\r?\n\r?\n([\s\S]*)$/
const STEP_LINE_PATTERN = /^\d+\.\s+(.+)$/
const CODE_SPAN_PATTERN = /`([^`]+)`/g
const QUALIFIED_PATTERN = /^([a-z_]+)\.([a-z_]+)$/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const debriefSteps = (): string[] => {
  const content = readFileSync(DEBRIEF_SKILL_PATH, 'utf8')
  const sequenceMatch = SEQUENCE_HEADING_PATTERN.exec(content)
  if (sequenceMatch === null) {
    throw new Error(`debrief-spine-update: ${DEBRIEF_SKILL_PATH} has no parseable "## Sequence" block`)
  }
  return (sequenceMatch[1] as string)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const stepMatch = STEP_LINE_PATTERN.exec(line)
      if (stepMatch === null) {
        throw new Error(`debrief-spine-update: sequence line "${line}" is not a numbered step`)
      }
      return stepMatch[1] as string
    })
}

const spansIn = (step: string): string[] => Array.from(step.matchAll(CODE_SPAN_PATTERN)).map((match) => match[1] as string)

const documentedParkFields = (): string[] => {
  const parkSteps = debriefSteps().filter(
    (step) => step.startsWith('Call ') && spansIn(step).includes(PARK_TOOL_NAME)
  )
  assert.ok(parkSteps.length > 0, `debrief-spine-update: the debrief sequence has no Call step naming \`${PARK_TOOL_NAME}\``)
  const fields = parkSteps.flatMap((step) =>
    spansIn(step).flatMap((span) => {
      const qualified = QUALIFIED_PATTERN.exec(span)
      if (qualified === null) return []
      return (qualified[1] as string) === PARK_TOOL_NAME ? [qualified[2] as string] : []
    })
  )
  return Array.from(new Set(fields)).sort()
}

const parkInputPropertyNames = async (spawned: SpawnedServer): Promise<Set<string>> => {
  const listed = await spawned.client.listTools()
  const park = listed.tools.find((tool) => tool.name === PARK_TOOL_NAME)
  assert.notEqual(park, undefined, `debrief-spine-update: the live server publishes no ${PARK_TOOL_NAME} tool`)
  const schema = park?.inputSchema as unknown
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
    throw new Error(`debrief-spine-update: ${PARK_TOOL_NAME} publishes no input properties`)
  }
  return new Set(Object.keys(schema.properties))
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`debrief-spine-update fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-debrief-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Debrief Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'debrief@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook debrief fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const callOk = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
  const result = (await spawned.client.callTool({ name, arguments: args })) as CallToolResult
  assert.notEqual(result.isError, true, `debrief-spine-update: calling "${name}" failed: ${JSON.stringify(result.content)}`)
  return result
}

test('debrief.documents-next-step-and-not-last-session', () => {
  const fields = documentedParkFields()
  assert.ok(
    fields.includes('next_step'),
    `the debrief sequence must pass next_step to ${PARK_TOOL_NAME}; documented fields were [${fields.join(', ')}]`
  )
  assert.equal(
    fields.includes('last_session'),
    false,
    `the debrief sequence must stop passing last_session to ${PARK_TOOL_NAME}; documented fields were [${fields.join(', ')}]`
  )
})

test('debrief.returns-a-non-empty-spine-update', async () => {
  let repo = ''
  let pluginData = ''
  let spawned: SpawnedServer | undefined
  try {
    repo = bootstrapRepo()
    pluginData = mkdtempSync(join(tmpdir(), 'logbook-debrief-plugin-data-'))
    spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })

    const inputNames = await parkInputPropertyNames(spawned)
    const documented = documentedParkFields().filter((field) => inputNames.has(field))
    assert.ok(documented.length > 0, 'the debrief sequence documents no park_thread input field at all')

    const opened = await callOk(spawned, 'open_thread', {
      title: 'debrief spine update fixture thread',
      slug: 'debrief-spine-update-fixture',
      completion_criteria: [
        { text: 'prove the documented debrief sequence refreshes the running summary', check: 'the debrief spine update scenario check' }
      ]
    })
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    await callOk(spawned, 'resume_thread', { thread_id: threadId })

    const parked = await callOk(
      spawned,
      PARK_TOOL_NAME,
      Object.fromEntries(documented.map((field) => [field, `debrief fixture value for ${field}`]))
    )
    const spineFieldsUpdated = (parked.structuredContent as { spine_fields_updated: string[] }).spine_fields_updated
    assert.ok(
      spineFieldsUpdated.length > 0,
      `driving the documented debrief sequence returned an empty spine update; fields sent were [${documented.join(', ')}]`
    )
  } finally {
    if (spawned !== undefined) await spawned.close()
    if (repo !== '') rmSync(repo, { recursive: true, force: true })
    if (pluginData !== '') rmSync(pluginData, { recursive: true, force: true })
  }
})
