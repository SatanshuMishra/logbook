import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const SKILLS_DIR = join(PROJECT_ROOT, 'skills')
const PREFLIGHT_SKILL_PATH = join(PROJECT_ROOT, 'skills', 'preflight', 'SKILL.md')
const DEBRIEF_SKILL_PATH = join(PROJECT_ROOT, 'skills', 'debrief', 'SKILL.md')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type SkillFile = { relPath: string; content: string }

const readSkillFile = (absPath: string): SkillFile => ({
  relPath: absPath.slice(PROJECT_ROOT.length),
  content: readFileSync(absPath, 'utf8')
})

const discoverSkillFilePaths = (): string[] =>
  readdirSync(SKILLS_DIR, { withFileTypes: true }).map((entry) => {
    if (!entry.isDirectory()) {
      throw new Error(`skills.test: ${SKILLS_DIR} contains a non-directory entry "${entry.name}"`)
    }
    const skillPath = join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (!existsSync(skillPath)) {
      throw new Error(`skills.test: skill directory "${entry.name}" has no SKILL.md`)
    }
    return skillPath
  })

const loadSkillFiles = (): SkillFile[] => discoverSkillFilePaths().map(readSkillFile)

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

type ParsedSkill = { relPath: string; steps: string[] }

const parseSkill = (file: SkillFile): ParsedSkill => {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(file.content)
  if (frontmatterMatch === null) {
    throw new Error(`skills.test: ${file.relPath} has no parseable frontmatter block`)
  }
  const body = frontmatterMatch[2] as string

  const sequenceMatch = SEQUENCE_HEADING_PATTERN.exec(body)
  if (sequenceMatch === null) {
    throw new Error(`skills.test: ${file.relPath} has no parseable "## Sequence" block`)
  }
  const sequenceBlock = sequenceMatch[1] as string

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

  return { relPath: file.relPath, steps }
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
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT, entry: ENTRY })
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
    const toolName = qualifiedMatch[1] as string
    const fieldName = qualifiedMatch[2] as string
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

type SkillLineKind = 'frontmatter-delimiter' | 'frontmatter-entry' | 'heading' | 'step' | 'prose'

type SkillLine = { file: string; lineNumber: number; kind: SkillLineKind; key: string | undefined; content: string }

const FRONTMATTER_DELIMITER_LINE = '---'
const FRONTMATTER_ENTRY_LINE_PATTERN = /^([A-Za-z_-]+):\s*(.*)$/
const HEADING_LINE_PATTERN = /^#{1,6}\s+(.*)$/
const LINE_KIND_STEP_PATTERN = /^\d+\.\s+(.*)$/

type ParsedSkillLineKind = { kind: SkillLineKind; key: string | undefined; content: string }

const parseSkillLineKind = (line: string, insideFrontmatter: boolean): ParsedSkillLineKind => {
  if (line === FRONTMATTER_DELIMITER_LINE) {
    return { kind: 'frontmatter-delimiter', key: undefined, content: '' }
  }
  if (insideFrontmatter) {
    const entryMatch = FRONTMATTER_ENTRY_LINE_PATTERN.exec(line)
    if (entryMatch !== null) {
      const key = entryMatch[1] as string
      const value = entryMatch[2] as string
      return { kind: 'frontmatter-entry', key, content: value }
    }
  }
  const headingMatch = HEADING_LINE_PATTERN.exec(line)
  if (headingMatch !== null) {
    return { kind: 'heading', key: undefined, content: headingMatch[1] as string }
  }
  const stepMatch = LINE_KIND_STEP_PATTERN.exec(line)
  if (stepMatch !== null) {
    return { kind: 'step', key: undefined, content: stepMatch[1] as string }
  }
  return { kind: 'prose', key: undefined, content: line }
}

type SkillLinesAcc = { delimiterCount: number; lines: SkillLine[] }

const skillLinesOf = (file: SkillFile): SkillLine[] =>
  file.content.split('\n').reduce<SkillLinesAcc>(
    (acc, rawLine, index) => {
      if (rawLine.trim().length === 0) return acc
      const insideFrontmatter = acc.delimiterCount === 1
      const parsed = parseSkillLineKind(rawLine, insideFrontmatter)
      const nextDelimiterCount = parsed.kind === 'frontmatter-delimiter' ? acc.delimiterCount + 1 : acc.delimiterCount
      const line: SkillLine = {
        file: file.relPath,
        lineNumber: index + 1,
        kind: parsed.kind,
        key: parsed.key,
        content: parsed.content
      }
      return { delimiterCount: nextDelimiterCount, lines: [...acc.lines, line] }
    },
    { delimiterCount: 0, lines: [] }
  ).lines

const nonBlankLineCount = (content: string): number => content.split('\n').filter((line) => line.trim().length > 0).length

const classifySkillLine = (line: SkillLine): Classified<SkillLine>['verdict'] | 'unclassifiable' => {
  if (line.kind === 'frontmatter-delimiter') return 'allowed'
  if (line.kind === 'frontmatter-entry') {
    if (line.key === undefined || classifyFrontmatterKey(line.key) === 'forbidden') return 'forbidden'
    return RULE_MARKER_PATTERN.test(line.content) ? 'forbidden' : 'allowed'
  }
  if (line.kind === 'heading') {
    return RULE_MARKER_PATTERN.test(line.content) ? 'forbidden' : 'allowed'
  }
  if (line.kind === 'step') {
    return classifyBodySentence(line.content)
  }
  return RULE_MARKER_PATTERN.test(line.content) ? 'forbidden' : 'unclassifiable'
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

const assertContainsCallsInOrder = (actual: string[], expected: string[]): void => {
  expected.reduce((searchFrom, expectedCall) => {
    const foundAt = actual.indexOf(expectedCall, searchFrom)
    assert.notEqual(
      foundAt,
      -1,
      `skills.test: expected "${expectedCall}" at or after index ${searchFrom} in the call sequence [${actual.join(', ')}]`
    )
    return foundAt + 1
  }, 0)
}

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

const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced', 'last-materialised'])

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
    } catch (error) {
      throw new Error(
        `skills.test: could not parse "${target}" as JSON while counting pointers: ${error instanceof Error ? error.message : String(error)}`
      )
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

const isHaltedOnUnclassifiable = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census halted on an unclassifiable item')

const isRejectedAsForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census rejected a forbidden item')

test('contract.skill-references-exist', async () => {
  const liveTools = await readLiveTools()
  const liveToolMap = new Map(liveTools.map((tool) => [tool.name, tool]))

  const skillFiles = loadSkillFiles()
  assert.ok(skillFiles.length > 0, 'expected at least one discovered skill under skills')

  const spans = skillFiles.flatMap(extractCodeSpans)
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
  assert.throws(() => census(synthetic, (span) => classifySkillReference(span, SYNTHETIC_LIVE_TOOLS)), isRejectedAsForbidden)
})

test('contract.skill-references-exist.control.unclassifiable-reference', () => {
  const synthetic: CodeSpan[] = [{ file: 'synthetic', line: 1, text: 'Resume_Thread' }]
  assert.throws(() => census(synthetic, (span) => classifySkillReference(span, SYNTHETIC_LIVE_TOOLS)), isHaltedOnUnclassifiable)
})

test('contract.skill-references-exist.control.forbidden-qualified-field', () => {
  const synthetic: CodeSpan[] = [{ file: 'synthetic', line: 1, text: 'list_threads.not_a_real_field' }]
  assert.throws(() => census(synthetic, (span) => classifySkillReference(span, SYNTHETIC_LIVE_TOOLS)), isRejectedAsForbidden)
})

test('contract.skills-hold-no-rules', () => {
  const skillFiles = loadSkillFiles()
  assert.ok(skillFiles.length > 0, 'expected at least one discovered skill under skills')

  const population = skillFiles.flatMap(skillLinesOf)
  assert.ok(population.length > 0, 'expected at least one non-blank line across the discovered skill files')

  const expectedNonBlankLineCount = skillFiles.reduce((sum, file) => sum + nonBlankLineCount(file.content), 0)
  assert.equal(
    population.length,
    expectedNonBlankLineCount,
    'expected the classified population to cover every non-blank line; a smaller population means lines were silently dropped'
  )

  assert.doesNotThrow(() => census(population, classifySkillLine))
})

test('contract.skills-hold-no-rules.control.forbidden-frontmatter-key', () => {
  const synthetic = ['allowed-tools']
  assert.throws(() => census(synthetic, classifyFrontmatterKey), isRejectedAsForbidden)
})

test('contract.skills-hold-no-rules.control.forbidden-body-sentence-with-a-rule-marker-after-its-verb', () => {
  const synthetic = ['Call `list_threads` only when the roster is empty.']
  assert.throws(() => census(synthetic, classifyBodySentence), isRejectedAsForbidden)
})

test('contract.skills-hold-no-rules.control.unclassifiable-body-sentence', () => {
  const synthetic = ['Read the returned roster aloud.']
  assert.throws(() => census(synthetic, classifyBodySentence), isHaltedOnUnclassifiable)
})

test('skill.preflight-presents-and-stops', () => {
  const preflight = parseSkill(readSkillFile(PREFLIGHT_SKILL_PATH))
  const steps = preflight.steps

  const presentIndex = steps.findIndex((step) => firstWordOf(step) === 'Present')
  assert.notEqual(presentIndex, -1, 'expected an explicit Present step in the preflight sequence')

  const waitIndex = steps.findIndex((step) => firstWordOf(step) === 'Wait')
  assert.notEqual(waitIndex, -1, 'expected an explicit Wait step in the preflight sequence')

  assert.ok(presentIndex < waitIndex, 'expected the Present step to precede the Wait step')

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

test('skill.debrief-passes-both-hand-off-fields', () => {
  const debrief = readSkillFile(DEBRIEF_SKILL_PATH).content

  assert.ok(
    debrief.includes('park_thread.landed'),
    'expected the debrief sequence to pass park_thread.landed'
  )
  assert.ok(
    debrief.includes('park_thread.next_step'),
    'expected the debrief sequence to pass park_thread.next_step'
  )
})

test('skill.preflight-resumes-before-it-asks-anything', () => {
  const preflight = readSkillFile(PREFLIGHT_SKILL_PATH).content
  const resumeAt = preflight.indexOf('Call `resume_thread`')
  const briefingAt = preflight.indexOf('Print the returned `resume_thread.briefing`')

  assert.notEqual(resumeAt, -1, 'expected a step calling resume_thread in the preflight sequence')
  assert.ok(briefingAt > resumeAt, 'expected the briefing print to follow the resume_thread call')
  assert.equal(
    preflight.includes('Wait for the human to name the completion criteria'),
    false,
    'expected no step demanding completion criteria ids before the briefing is printed'
  )
})

test('skill.cannot-strand', async () => {
  const preflight = parseSkill(readSkillFile(PREFLIGHT_SKILL_PATH))
  const debrief = parseSkill(readSkillFile(DEBRIEF_SKILL_PATH))
  const preflightCalls = extractCallSequence(preflight.steps)
  const debriefCalls = extractCallSequence(debrief.steps)
  assertContainsCallsInOrder(preflightCalls, ['list_threads', 'resume_thread'])
  assertContainsCallsInOrder(debriefCalls, ['park_thread'])

  let repo = ''
  let pluginDataHome = ''
  let pluginData = ''
  let homeDir = ''
  let spawned: SpawnedServer | undefined
  try {
    repo = bootstrapRepo()
    pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-skills-plugin-data-'))
    pluginData = join(pluginDataHome, 'plugin-data')
    mkdirSync(pluginData)
    homeDir = mkdtempSync(join(tmpdir(), 'logbook-skills-home-'))
    spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })

    await spawned.client.listTools()

    const opened = (await spawned.client.callTool({
      name: 'open_thread',
      arguments: {
        title: 'skills contract fixture thread',
        slug: 'skills-contract-fixture',
        completion_criteria: [
          {
            text: 'prove the documented preflight and debrief sequence cannot strand a pointer',
            check: 'the skills contract test drives both skills end to end'
          }
        ]
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
    if (spawned !== undefined) await spawned.close()
    if (repo !== '') rmSync(repo, { recursive: true, force: true })
    if (pluginDataHome !== '') rmSync(pluginDataHome, { recursive: true, force: true })
    if (homeDir !== '') rmSync(homeDir, { recursive: true, force: true })
  }
})
