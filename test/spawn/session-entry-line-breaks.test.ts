import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { assertOkResult, readResourceText, withFixture } from '../support/resources-fixture.ts'
import type { SpawnedServer } from '../support/spawn-client.ts'

const LINE_BREAK = '\n'
const HEADER_BODY_SEPARATOR = '\n\n'
const RECORDED_HEADER = 'Recorded: '
const ESCAPED_LINE_BREAK_TOKEN = 'U+000A'
const MARKDOWN_HEADING_LINE = /^[ \t]*#/

const FIRST_PARAGRAPH = 'first paragraph of the entry'
const SECOND_PARAGRAPH = 'second paragraph of the entry'
const TWO_PARAGRAPH_BODY = `${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}`
const TWO_PARAGRAPH_EXPECTED_BODY = `${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}`
const TWO_PARAGRAPH_EXPECTED_LINE_BREAKS = 2

const FORGED_HEADING_BODY = 'U+000A## Forged'
const FORGED_HEADING_EXPECTED_LINE = 'U+0023# Forged'

const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1

const openLineBreakThread = async (spawned: SpawnedServer, slug: string): Promise<string> => {
  await spawned.client.listTools()
  const opened = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'session entry line break fixture thread',
      slug,
      active_goal: 'exercise the session entry line break fixture',
      next_step: 'exercise the session entry line break fixture',
      completion_criteria: [
        {
          text: 'a session entry line break fixture criterion',
          check: 'the session entry line break fixture check',
          settledness: 'proposed'
        }
      ]
    }
  })) as CallToolResult
  assertOkResult('open_thread (session entry line break fixture arrange)', opened)
  return (opened.structuredContent as { thread_id: string }).thread_id
}

const logEntry = async (spawned: SpawnedServer, threadId: string, body: string): Promise<string> => {
  const logged = (await spawned.client.callTool({
    name: 'log_session_event',
    arguments: { thread_id: threadId, actor: 'claude', body }
  })) as CallToolResult
  assertOkResult('log_session_event (session entry line break fixture arrange)', logged)
  return (logged.structuredContent as { session_entry_id: string }).session_entry_id
}

const renderedBodyPortion = (rendered: string): string => {
  const separatorIndex = rendered.indexOf(HEADER_BODY_SEPARATOR)
  assert.notEqual(
    separatorIndex,
    -1,
    `expected the rendered session entry to separate its headers from its body with a blank line, got '${rendered}'`
  )
  const headerPortion = rendered.slice(0, separatorIndex)
  assert.ok(
    headerPortion.includes(RECORDED_HEADER),
    `expected the text before the first blank line to be the session entry headers ending in '${RECORDED_HEADER}', got '${headerPortion}'`
  )
  const bodyPortion = rendered.slice(separatorIndex + HEADER_BODY_SEPARATOR.length)
  assert.ok(
    bodyPortion.length > 0,
    `expected the text after the first blank line to be a non-empty body, got an empty string from '${rendered}'`
  )
  return bodyPortion
}

const renderSessionEntryBody = async (spawned: SpawnedServer, slug: string, body: string): Promise<string> => {
  const threadId = await openLineBreakThread(spawned, slug)
  const entryId = await logEntry(spawned, threadId, body)
  const rendered = await readResourceText(spawned, `logbook://session/${threadId}/${entryId}`)
  return renderedBodyPortion(rendered)
}

test('resource.session-entry-body-renders-stored-line-breaks-as-real-lines', async () => {
  await withFixture(async (fx) => {
    const bodyPortion = await renderSessionEntryBody(
      fx.spawned,
      'session-entry-line-break-paragraphs',
      TWO_PARAGRAPH_BODY
    )

    assert.ok(
      bodyPortion.includes(FIRST_PARAGRAPH),
      `expected the rendered body to carry '${FIRST_PARAGRAPH}', got '${bodyPortion}'`
    )
    assert.ok(
      bodyPortion.includes(SECOND_PARAGRAPH),
      `expected the rendered body to carry '${SECOND_PARAGRAPH}', got '${bodyPortion}'`
    )
    assert.equal(
      countOccurrences(bodyPortion, LINE_BREAK),
      TWO_PARAGRAPH_EXPECTED_LINE_BREAKS,
      `expected the rendered body to be exactly '${TWO_PARAGRAPH_EXPECTED_BODY}', carrying ${TWO_PARAGRAPH_EXPECTED_LINE_BREAKS} real newline characters, got '${bodyPortion}'`
    )
    assert.equal(
      countOccurrences(bodyPortion, ESCAPED_LINE_BREAK_TOKEN),
      0,
      `expected the rendered body to be exactly '${TWO_PARAGRAPH_EXPECTED_BODY}', carrying no '${ESCAPED_LINE_BREAK_TOKEN}' token, got '${bodyPortion}'`
    )
  })
})

test('resource.session-entry-body-line-break-token-cannot-forge-a-heading', async () => {
  await withFixture(async (fx) => {
    const bodyPortion = await renderSessionEntryBody(
      fx.spawned,
      'session-entry-line-break-forged-heading',
      FORGED_HEADING_BODY
    )
    const bodyLines = bodyPortion.split(LINE_BREAK)

    const headingLines = bodyLines.filter((line) => MARKDOWN_HEADING_LINE.test(line))
    assert.deepEqual(
      headingLines,
      [],
      `expected no rendered body line to open a Markdown heading; the payload '${FORGED_HEADING_BODY}' must render as '${FORGED_HEADING_EXPECTED_LINE}', got '${bodyPortion}'`
    )
    assert.ok(
      bodyLines.includes(FORGED_HEADING_EXPECTED_LINE),
      `expected the payload '${FORGED_HEADING_BODY}' to render as a line equal to '${FORGED_HEADING_EXPECTED_LINE}', which is the line break decoded and the heading marker behind it re-escaped, got lines ${JSON.stringify(bodyLines)}`
    )
  })
})
