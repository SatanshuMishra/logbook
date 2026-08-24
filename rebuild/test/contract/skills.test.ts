import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { ULID_PATTERN, ISO_PATTERN } from '../../src/schema/ids.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'rebuild/dist/bin/logbook-server.js')
const PREFLIGHT_SKILL_PATH = join(PROJECT_ROOT, 'rebuild', 'skills', 'preflight', 'SKILL.md')
const DEBRIEF_SKILL_PATH = join(PROJECT_ROOT, 'rebuild', 'skills', 'debrief', 'SKILL.md')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type SkillFile = { relPath: string; content: string }

const readSkillFile = (absPath: string): SkillFile => ({
  relPath: absPath.slice(PROJECT_ROOT.length),
  content: readFileSync(absPath, 'utf8')
})

const loadSkillFiles = (): SkillFile[] => [readSkillFile(PREFLIGHT_SKILL_PATH), readSkillFile(DEBRIEF_SKILL_PATH)]

type CodeSpan = { file: string; line: number; text: string }

const CODE_SPAN_PATTERN = /`([^`]+)`/g

const extractCodeSpans = (file: SkillFile): CodeSpan[] => {
  const spans: CodeSpan[] = []
  file.content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CODE_SPAN_PATTERN)) {
      spans.push({ file: file.relPath, line: index + 1, text: match[1] as string })
    }
  })
  return spans
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
const SEQUENCE_HEADING_PATTERN = /## Sequence\r?\n\r?\n([\s\S]*)$/
const STEP_LINE_PATTERN = /^\d+\.\s+(.+)$/

type ParsedSkill = { relPath: string; frontmatterKeys: string[]; steps: string[] }

const parseSkill = (file: SkillFile): ParsedSkill => {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(file.content)
  if (frontmatterMatch === null) {
    throw new Error(`skills.test: ${file.relPath} has no parseable frontmatter block`)
  }
  const [, frontmatterBlock, body] = frontmatterMatch as unknown as [string, string, string]

  const frontmatterKeys = frontmatterBlock
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) {
        throw new Error(`skills.test: ${file.relPath} frontmatter line "${line}" carries no colon`)
      }
      return line.slice(0, colonIndex).trim()
    })

  const sequenceMatch = SEQUENCE_HEADING_PATTERN.exec(body)
  if (sequenceMatch === null) {
    throw new Error(`skills.test: ${file.relPath} has no parseable "## Sequence" block`)
  }
  const [, sequenceBlock] = sequenceMatch as unknown as [string, string]

  const steps = sequenceBlock
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const stepMatch = STEP_LINE_PATTERN.exec(line.trim())
      if (stepMatch === null) {
        throw new Error(`skills.test: ${file.relPath} sequence line "${line}" is not a numbered step`)
      }
      return stepMatch[1] as string
    })

  return { relPath: file.relPath, frontmatterKeys, steps }
}

const firstWordOf = (sentence: string): string | undefined => /^([A-Za-z]+)/.exec(sentence)?.[1]

const stepContainsSpan = (step: string, spanText: string): boolean => step.includes('`' + spanText + '`')

type LiveTool = { name: string; inputProperties: Set<string>; outputProperties: Set<string> }

const propertyKeysOf = (schema: unknown): Set<string> => {
  if (!isPlainObject(schema)) return new Set()
  const properties = schema.properties
  if (!isPlainObject(properties)) return new Set()
  return new Set(Object.keys(properties))
}

const readLiveTools = async (): Promise<LiveTool[]> => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const listed = await spawned.client.listTools()
    return listed.tools.map((tool) => ({
      name: tool.name,
      inputProperties: propertyKeysOf(tool.inputSchema),
      outputProperties: propertyKeysOf(tool.outputSchema)
    }))
  } finally {
    await spawned.close()
  }
}

const BARE_TOOL_PATTERN = /^[a-z_]+$/
const QUALIFIED_PATTERN = /^([a-z_]+)\.([a-z_]+)$/

const classifySkillReference = (
  span: CodeSpan,
  liveTools: Map<string, LiveTool>
): Classified<CodeSpan>['verdict'] | 'unclassifiable' => {
  if (BARE_TOOL_PATTERN.test(span.text)) {
    return liveTools.has(span.text) ? 'allowed' : 'forbidden'
  }
  const qualifiedMatch = QUALIFIED_PATTERN.exec(span.text)
  if (qualifiedMatch !== null) {
    const [, toolName, fieldName] = qualifiedMatch as unknown as [string, string, string]
    const tool = liveTools.get(toolName)
    if (tool === undefined) return 'forbidden'
    return tool.inputProperties.has(fieldName) || tool.outputProperties.has(fieldName) ? 'allowed' : 'forbidden'
  }
  return 'unclassifiable'
}

const ALLOWED_FRONTMATTER_KEYS = ['name', 'description']

const classifyFrontmatterKey = (key: string): Classified<string>['verdict'] =>
  (ALLOWED_FRONTMATTER_KEYS as readonly string[]).includes(key) ? 'allowed' : 'forbidden'

const RULE_MARKER_PATTERN =
  /\b(?:must|never|only|unless|cannot|always|should|may|require|requires|if|when|at\s+most|at\s+least)\b/i
const SEQUENCE_VERBS = ['Call', 'Present', 'Wait', 'Gather', 'Print', 'Stop']

const classifyBodySentence = (sentence: string): Classified<string>['verdict'] | 'unclassifiable' => {
  if (RULE_MARKER_PATTERN.test(sentence)) return 'forbidden'
  const firstWord = firstWordOf(sentence)
  if (firstWord !== undefined && (SEQUENCE_VERBS as readonly string[]).includes(firstWord)) return 'allowed'
  return 'unclassifiable'
}

const extractCallToolName = (step: string): string => {
  const spanTexts = Array.from(step.matchAll(CODE_SPAN_PATTERN)).map((match) => match[1] as string)
  const bareSpan = spanTexts.find((text) => BARE_TOOL_PATTERN.test(text))
  if (bareSpan === undefined) {
    throw new Error(`skills.test: Call step "${step}" names no bare tool code span`)
  }
  return bareSpan
}

const extractCallSequence = (steps: string[]): string[] =>
  steps.filter((step) => firstWordOf(step) === 'Call').map(extractCallToolName)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`skills.test fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-skills-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Skills Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'skills@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook skills fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type Pointer = { thread_id: string; written_at: string; session_id: string }

const isPointerShaped = (value: unknown): value is Pointer =>
  isPlainObject(value) &&
  typeof value.thread_id === 'string' &&
  ULID_PATTERN.test(value.thread_id) &&
  typeof value.written_at === 'string' &&
  ISO_PATTERN.test(value.written_at) &&
  typeof value.session_id === 'string' &&
  value.session_id.length > 0

const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced'])

const countPointers = (repo: string, pluginData: string, homeDir: string): number => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) {
    throw new Error(`skills.test: could not resolve the store layout to count pointers: ${layout.message}`)
  }
  if (!existsSync(layout.value.state)) return 0
  const entries = readdirSync(layout.value.state, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && !STATE_DIR_NON_POINTER_SENTINELS.has(entry.name)
  )
  return entries.filter((entry) => {
    const target = join(layout.value.state, entry.name)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(target, 'utf8'))
    } catch {
      return false
    }
    return isPointerShaped(parsed)
  }).length
}

type DriveContext = { threadId: string; outcome: string }

const CALL_ARGS_BY_TOOL: Record<string, (ctx: DriveContext) => Record<string, unknown>> = {
  list_threads: () => ({}),
  resume_thread: (ctx) => ({ thread_id: ctx.threadId }),
  park_thread: (ctx) => ({ outcome: ctx.outcome })
}

const driveCallSequence = async (spawned: SpawnedServer, toolNames: string[], ctx: DriveContext): Promise<void> => {
  for (const toolName of toolNames) {
    const resolveArgs = CALL_ARGS_BY_TOOL[toolName]
    if (resolveArgs === undefined) {
      throw new Error(`skills.test: no fixture argument resolver registered for tool "${toolName}"`)
    }
    const result = (await spawned.client.callTool({ name: toolName, arguments: resolveArgs(ctx) })) as CallToolResult
    assert.notEqual(
      result.isError,
      true,
      `skills.test: driving "${toolName}" from the documented sequence failed: ${JSON.stringify(result.content)}`
    )
  }
}

test('contract.skill-references-exist', async () => {
  const liveTools = await readLiveTools()
  const liveToolMap = new Map(liveTools.map((tool) => [tool.name, tool]))

  const spans = loadSkillFiles().flatMap(extractCodeSpans)
  assert.ok(spans.length > 0, 'expected at least one backtick code span across the shipped skill files')
  assert.ok(spans.some((span) => BARE_TOOL_PATTERN.test(span.text)), 'expected at least one bare tool-name span')
  assert.ok(spans.some((span) => QUALIFIED_PATTERN.test(span.text)), 'expected at least one qualified tool.field span')

  assert.doesNotThrow(() => census(spans, (span) => classifySkillReference(span, liveToolMap)))
})

const SYNTHETIC_LIVE_TOOLS: Map<string, LiveTool> = new Map([
  ['list_threads', { name: 'list_threads', inputProperties: new Set(['cursor']), outputProperties: new Set(['threads']) }]
])

test('contract.skill-references-exist.control.forbidden-tool-name', () => {
  const synthetic: CodeSpan[] = [{ file: 'synthetic', line: 1, text: 'not_a_real_tool' }]
  assert.throws(() => census(synthetic, (span) => classifySkillReference(span, SYNTHETIC_LIVE_TOOLS)))
})

test('contract.skill-references-exist.control.unclassifiable-reference', () => {
  const synthetic: CodeSpan[] = [{ file: 'synthetic', line: 1, text: 'Resume_Thread' }]
  assert.throws(() => census(synthetic, (span) => classifySkillReference(span, SYNTHETIC_LIVE_TOOLS)))
})

test('contract.skills-hold-no-rules', () => {
  const parsedSkills = loadSkillFiles().map(parseSkill)

  const frontmatterKeys = parsedSkills.flatMap((skill) => skill.frontmatterKeys)
  assert.ok(frontmatterKeys.length > 0, 'expected at least one frontmatter key across the shipped skill files')
  assert.doesNotThrow(() => census(frontmatterKeys, classifyFrontmatterKey))

  const bodySentences = parsedSkills.flatMap((skill) => skill.steps)
  assert.ok(bodySentences.length > 0, 'expected at least one body sentence across the shipped skill files')
  assert.doesNotThrow(() => census(bodySentences, classifyBodySentence))
})

test('contract.skills-hold-no-rules.control.forbidden-frontmatter-key', () => {
  const synthetic = ['allowed-tools']
  assert.throws(() => census(synthetic, classifyFrontmatterKey))
})

test('contract.skills-hold-no-rules.control.forbidden-body-sentence-with-a-rule-marker-after-its-verb', () => {
  const synthetic = ['Call `list_threads` only when the roster is empty.']
  assert.throws(() => census(synthetic, classifyBodySentence))
})

test('contract.skills-hold-no-rules.control.unclassifiable-body-sentence', () => {
  const synthetic = ['Read the returned roster aloud.']
  assert.throws(() => census(synthetic, classifyBodySentence))
})

test('skill.preflight-presents-and-stops', () => {
  const preflight = parseSkill(readSkillFile(PREFLIGHT_SKILL_PATH))
  const steps = preflight.steps

  const waitIndex = steps.findIndex((step) => firstWordOf(step) === 'Wait')
  assert.notEqual(waitIndex, -1, 'expected an explicit Wait step in the preflight sequence')

  const resumeCallIndex = steps.findIndex((step) => stepContainsSpan(step, 'resume_thread'))
  assert.notEqual(resumeCallIndex, -1, 'expected a step calling `resume_thread` in the preflight sequence')

  assert.ok(waitIndex < resumeCallIndex, 'expected the Wait step to precede the resume_thread call')

  const briefingIndex = steps.findIndex((step) => stepContainsSpan(step, 'resume_thread.briefing'))
  assert.notEqual(briefingIndex, -1, 'expected a step printing `resume_thread.briefing`')
  assert.equal(
    briefingIndex,
    steps.length - 2,
    'expected printing the briefing to be the second-to-last step, with nothing after it but stopping'
  )

  const lastStep = steps[steps.length - 1]
  assert.ok(lastStep !== undefined)
  assert.equal(firstWordOf(lastStep), 'Stop', 'expected the final step to be nothing but stopping')
})

test('skill.cannot-strand', async () => {
  const preflight = parseSkill(readSkillFile(PREFLIGHT_SKILL_PATH))
  const debrief = parseSkill(readSkillFile(DEBRIEF_SKILL_PATH))
  const preflightCalls = extractCallSequence(preflight.steps)
  const debriefCalls = extractCallSequence(debrief.steps)
  assert.deepEqual(preflightCalls, ['list_threads', 'resume_thread'])
  assert.deepEqual(debriefCalls, ['park_thread'])

  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-skills-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-skills-home-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await spawned.client.listTools()

    const opened = (await spawned.client.callTool({
      name: 'open_thread',
      arguments: {
        title: 'skills contract fixture thread',
        slug: 'skills-contract-fixture',
        completion_criteria: ['prove the documented preflight and debrief sequence cannot strand a pointer']
      }
    })) as CallToolResult
    assert.notEqual(
      opened.isError,
      true,
      `skills.test: fixture open_thread call failed: ${JSON.stringify(opened.content)}`
    )
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    await driveCallSequence(spawned, preflightCalls, {
      threadId,
      outcome: 'exercised the documented preflight sequence'
    })
    assert.equal(
      countPointers(repo, pluginData, homeDir),
      1,
      'expected exactly one pointer to be set after driving the documented preflight sequence'
    )

    await driveCallSequence(spawned, debriefCalls, {
      threadId,
      outcome: 'exercised the documented debrief sequence'
    })
    assert.equal(
      countPointers(repo, pluginData, homeDir),
      0,
      'expected no pointer to remain set after driving the documented debrief sequence'
    )
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})
