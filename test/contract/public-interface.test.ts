import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { COMPACT_BRIEFING_HEADING } from '../../src/render/compact-briefing.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REGISTER_PATH = fileURLToPath(new URL('../registers/public-interface.json', import.meta.url))
const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../../package.json', import.meta.url))
const PACKAGE_LOCK_PATH = fileURLToPath(new URL('../../package-lock.json', import.meta.url))
const PLUGIN_MANIFEST_PATH = fileURLToPath(new URL('../../.claude-plugin/plugin.json', import.meta.url))

const RELEASE_VERSION = '15.0.0'
const RELEASE_MAJOR = 15
const WIRE_PREFIXES = ['mcp__ledger__', 'mcp__plugin_logbook_ledger__'] as const
const SECTION_HEADING = '## Public interface'
const REGISTER_REL_PATH = 'test/registers/public-interface.json'
const MAJOR_VERSION_RULE =
  'Renaming or removing a tool, removing an input or output property, or adding a required input is a major version'
const BASH_IF_RULE = 'Bash(*logbook*)'
const RETIRED_HOOK_EVENT = 'PostToolUse'
const OPTION_REASONS_PROPERTY = 'option_reasons'

type Requirement = 'required' | 'optional'
type ToolContract = { input: Readonly<Record<string, Requirement>>; output: readonly string[] }
type ToolContracts = Readonly<Record<string, ToolContract>>
type InterfaceRegister = { major: number; tools: ToolContracts }
type ListedSchema = { properties?: Record<string, unknown> | undefined; required?: string[] | undefined }
type ListedTool = { name: string; inputSchema: ListedSchema; outputSchema?: ListedSchema | undefined }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRequirement = (value: unknown): value is Requirement => value === 'required' || value === 'optional'

const parseToolContract = (name: string, raw: unknown): ToolContract => {
  assert.ok(isRecord(raw), `${REGISTER_REL_PATH}: tool ${name} is not an object`)
  const { input, output } = raw
  assert.ok(isRecord(input), `${REGISTER_REL_PATH}: tool ${name} has no input object`)
  assert.ok(
    Object.values(input).every(isRequirement),
    `${REGISTER_REL_PATH}: tool ${name} marks an input property other than "required" or "optional"`
  )
  assert.ok(
    Array.isArray(output) && output.every((property) => typeof property === 'string'),
    `${REGISTER_REL_PATH}: tool ${name} has no output list of property names`
  )
  return { input: input as Record<string, Requirement>, output: output as string[] }
}

const readRegister = (): InterfaceRegister => {
  const raw: unknown = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'))
  assert.ok(isRecord(raw), `${REGISTER_REL_PATH} is not an object`)
  assert.equal(typeof raw.major, 'number', `${REGISTER_REL_PATH} records no major version`)
  assert.ok(isRecord(raw.tools), `${REGISTER_REL_PATH} has no tools object`)
  return {
    major: raw.major as number,
    tools: Object.fromEntries(Object.entries(raw.tools).map(([name, contract]) => [name, parseToolContract(name, contract)]))
  }
}

const publishedContract = (tool: ListedTool): ToolContract => {
  const required = new Set(tool.inputSchema.required ?? [])
  return {
    input: Object.fromEntries(
      Object.keys(tool.inputSchema.properties ?? {}).map((property) => [
        property,
        required.has(property) ? 'required' : 'optional'
      ])
    ),
    output: Object.keys(tool.outputSchema?.properties ?? {})
  }
}

const sortedUnion = (left: Iterable<string>, right: Iterable<string>): string[] => [...new Set([...left, ...right])].sort()

const inputDifferences = (tool: string, pinned: ToolContract, published: ToolContract): string[] =>
  sortedUnion(Object.keys(pinned.input), Object.keys(published.input)).flatMap((property) => {
    const want = pinned.input[property]
    const got = published.input[property]
    if (want === undefined) return [`${tool} input ${property}: published as ${got}, missing from the register`]
    if (got === undefined) return [`${tool} input ${property}: in the register as ${want}, not published`]
    return want === got ? [] : [`${tool} input ${property}: the register says ${want}, published as ${got}`]
  })

const outputDifferences = (tool: string, pinned: ToolContract, published: ToolContract): string[] =>
  sortedUnion(pinned.output, published.output).flatMap((property) => {
    const inRegister = pinned.output.includes(property)
    const inPublished = published.output.includes(property)
    if (inRegister && inPublished) return []
    return [`${tool} output ${property}: ${inRegister ? 'in the register, not published' : 'published, missing from the register'}`]
  })

const interfaceDifferences = (pinned: ToolContracts, published: ToolContracts): string[] =>
  sortedUnion(Object.keys(pinned), Object.keys(published)).flatMap((tool) => {
    const want = pinned[tool]
    const got = published[tool]
    if (want === undefined) return [`${tool}: published, missing from the register`]
    if (got === undefined) return [`${tool}: in the register, not published`]
    return [...inputDifferences(tool, want, got), ...outputDifferences(tool, want, got)]
  })

const readPublishedContracts = async (): Promise<ToolContracts> => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const listed = await spawned.client.listTools()
    return Object.fromEntries(listed.tools.map((tool) => [tool.name, publishedContract(tool)]))
  } finally {
    await spawned.close()
  }
}

const sectionOf = (markdown: string, heading: string): string | null => {
  const lines = markdown.split('\n')
  const start = lines.indexOf(heading)
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

const namesWholeWord = (text: string, word: string): boolean => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`).test(text)

const readJson = (filePath: string): Record<string, unknown> => {
  const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.ok(isRecord(raw), `${filePath} is not a JSON object`)
  return raw
}

test('contract.public-interface.live-tools-match-the-register', async () => {
  const register = readRegister()
  const published = await readPublishedContracts()
  assert.ok(Object.keys(published).length > 0, 'the spawned server published no tool')

  const differences = interfaceDifferences(register.tools, published)
  assert.deepEqual(
    differences,
    [],
    `the published interface differs from ${REGISTER_REL_PATH}:\n${differences.join('\n')}`
  )

  const [dropped, ...kept] = Object.keys(register.tools)
  assert.ok(dropped !== undefined, `${REGISTER_REL_PATH} pins no tool`)
  const withoutOne = Object.fromEntries(kept.map((name) => [name, register.tools[name] as ToolContract]))
  assert.deepEqual(interfaceDifferences(withoutOne, published), [`${dropped}: published, missing from the register`])
})

test('contract.public-interface.readme-documents-the-contract', () => {
  const readme = readFileSync(README_PATH, 'utf8')
  const section = sectionOf(readme, SECTION_HEADING)
  assert.ok(section !== null, `README.md has no section headed "${SECTION_HEADING}"`)

  const tools = Object.keys(readRegister().tools)
  assert.ok(tools.length > 0, `${REGISTER_REL_PATH} pins no tool`)
  const wireNames = tools.flatMap((tool) => WIRE_PREFIXES.map((prefix) => `${prefix}${tool}`))
  const unnamed = wireNames.filter((wireName) => !namesWholeWord(section, wireName))
  assert.deepEqual(unnamed, [], `the ${SECTION_HEADING} section does not name:\n${unnamed.join('\n')}`)

  assert.ok(section.includes(REGISTER_REL_PATH), `the ${SECTION_HEADING} section does not name ${REGISTER_REL_PATH}`)
  assert.ok(section.includes(MAJOR_VERSION_RULE), `the ${SECTION_HEADING} section does not state "${MAJOR_VERSION_RULE}"`)

  for (const phrase of [COMPACT_BRIEFING_HEADING, OPTION_REASONS_PROPERTY, BASH_IF_RULE]) {
    assert.ok(readme.includes(phrase), `README.md does not mention ${phrase}`)
  }
  assert.equal(readme.includes(RETIRED_HOOK_EVENT), false, `README.md still mentions ${RETIRED_HOOK_EVENT}`)
})

test('contract.public-interface.version-is-fifteen', () => {
  const manifest = readJson(PACKAGE_PATH)
  const lock = readJson(PACKAGE_LOCK_PATH)
  const lockPackages = lock.packages
  assert.ok(isRecord(lockPackages), 'package-lock.json has no packages object')
  const lockRoot = lockPackages['']
  assert.ok(isRecord(lockRoot), 'package-lock.json has no root package entry')
  const plugin = readJson(PLUGIN_MANIFEST_PATH)

  assert.deepEqual(
    {
      'package.json': manifest.version,
      'package-lock.json version': lock.version,
      'package-lock.json packages[""].version': lockRoot.version,
      '.claude-plugin/plugin.json': plugin.version
    },
    {
      'package.json': RELEASE_VERSION,
      'package-lock.json version': RELEASE_VERSION,
      'package-lock.json packages[""].version': RELEASE_VERSION,
      '.claude-plugin/plugin.json': RELEASE_VERSION
    }
  )
  assert.equal(readRegister().major, RELEASE_MAJOR, `${REGISTER_REL_PATH} must record major ${RELEASE_MAJOR}`)
})
