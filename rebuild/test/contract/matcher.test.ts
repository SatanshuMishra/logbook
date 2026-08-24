import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HOOKS_JSON_PATH = path.join(PROJECT_ROOT, 'rebuild', 'hooks', 'hooks.json')

type HooksJson = {
  hooks: {
    PreToolUse: { matcher: string }[]
  }
}

const readPreToolUseMatcherSource = (): string => {
  const parsed = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8')) as HooksJson
  const binding = parsed.hooks.PreToolUse[0]
  if (binding === undefined) throw new Error('expected a PreToolUse binding in hooks.json')
  return binding.matcher
}

const HISTORICAL_UNANCHORED_PATTERN_SOURCE = 'mcp__(plugin_logbook_)?ledger__.*'

test('contract.hook-matcher-covers-tools', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  let liveToolNames: string[]
  try {
    const listed = await spawned.client.listTools()
    liveToolNames = listed.tools.map((tool) => tool.name)
  } finally {
    await spawned.close()
  }

  assert.ok(liveToolNames.length > 0, 'expected the live server to publish at least one tool')

  const matcher = new RegExp(readPreToolUseMatcherSource())

  for (const toolName of liveToolNames) {
    const directForm = `mcp__ledger__${toolName}`
    const pluginForm = `mcp__plugin_logbook_ledger__${toolName}`
    assert.ok(matcher.test(directForm), `expected the matcher to fire on ${directForm}`)
    assert.ok(matcher.test(pluginForm), `expected the matcher to fire on the plugin-namespaced form ${pluginForm}`)
  }

  const firstToolName = liveToolNames[0] as string
  const substringOnlyCandidates = [
    `zzz.mcp__plugin_logbook_ledger__${firstToolName}`,
    `mcp__plugin_logbook_ledger__${firstToolName}.zzz`,
    `wrapper.mcp__plugin_logbook_ledger__${firstToolName}.wrapper`
  ]
  for (const candidate of substringOnlyCandidates) {
    assert.equal(
      matcher.test(candidate),
      false,
      `expected the anchored matcher NOT to fire on "${candidate}", which merely contains a matching substring`
    )
  }
})

test('contract.hook-matcher-covers-tools.control.the-historical-unanchored-pattern-would-have-matched', () => {
  const historical = new RegExp(HISTORICAL_UNANCHORED_PATTERN_SOURCE)
  const substringOnly = 'zzz_mcp__plugin_logbook_ledger__open_thread_zzz'
  assert.ok(
    historical.test(substringOnly),
    'expected the historical unanchored matcher to wrongly fire on a substring match, proving the negative case in the main test has discriminating power'
  )

  const anchored = new RegExp(readPreToolUseMatcherSource())
  assert.equal(anchored.test(substringOnly), false, 'expected the shipped anchored matcher to correctly refuse the same substring match')
})
