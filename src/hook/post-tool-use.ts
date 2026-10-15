import { realpathSync } from 'node:fs'
import path from 'node:path'
import { formatViolation, type Violation } from '../doc/check.ts'
import { updateRequest } from '../doc/rules.ts'
import type { Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { activityLine, toolSummary } from '../thread/activity.ts'
import { addTranscript, heldBy, readHold, setNudged } from '../thread/holds.ts'
import { clearMarker } from '../thread/inflight.ts'
import { workingCopyPath, type RepoPaths } from '../thread/paths.ts'
import { reconcileThread, type ReconcileResult } from '../thread/reconcile.ts'
import { listSlugs, readDocument } from '../thread/store.ts'
import { isMilestone } from './milestone.ts'

export type PostToolUseInput = { event: Record<string, unknown>; sessionId: string; paths: RepoPaths; rt: Runtime }

export type PostToolUseOutput = Record<string, unknown>

type ToolCall = { name: string; input: Record<string, unknown> }

type Fit = { kept: number; used: number; open: boolean }

const HOOK_EVENT = 'PostToolUse'
const FAILURE_EVENT = 'PostToolUseFailure'
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const CONTEXT_CEILING = 9500
const LINE_LIMIT = 1000
const CUT_MARK = '...'
const VIOLATION_PREFIX = '- '
const CONTEXT_SEPARATOR = '\n\n'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const toolCallOf = (event: Record<string, unknown>): ToolCall | null => {
  const name = nonEmptyString(event.tool_name)
  return name === null ? null : { name, input: isPlainObject(event.tool_input) ? event.tool_input : {} }
}

const realPathOf = (file: string): string | null => {
  try {
    return realpathSync(file)
  } catch {
    return null
  }
}

const editedPathOf = (input: Record<string, unknown>): string | null => {
  const named = nonEmptyString(input.file_path) ?? nonEmptyString(input.notebook_path)
  return named !== null && path.isAbsolute(named) ? named : null
}

const cutTo = (limit: number, text: string): string =>
  text.length > limit ? `${text.slice(0, limit - CUT_MARK.length)}${CUT_MARK}` : text

const joinedLength = (lines: readonly string[]): number => lines.reduce((total, line) => total + line.length + 1, -1)

const moreLine = (count: number): string => `${VIOLATION_PREFIX}and ${count} more violations`

const violationLine = (entry: Violation): string => cutTo(LINE_LIMIT, `${VIOLATION_PREFIX}${formatViolation(entry)}`)

const keptCount = (opening: string, lines: readonly string[]): number => {
  const frameLength = (dropped: number): number => opening.length + 1 + moreLine(dropped).length
  return lines.slice(1, -1).reduce<Fit>(
    (fit, line) => {
      if (!fit.open) return fit
      const kept = fit.kept + 1
      const used = fit.used + line.length + 1
      return frameLength(lines.length - kept) + used <= CONTEXT_CEILING
        ? { kept, used, open: true }
        : { ...fit, open: false }
    },
    { kept: 1, used: (lines[0]?.length ?? 0) + 1, open: true }
  ).kept
}

const refusalText = (edited: string, violations: readonly Violation[]): string => {
  const opening = `logbook: the edit to ${edited} was not committed. Fix these and edit the file again:`
  const lines = violations.map(violationLine)
  const full = [opening, ...lines]
  if (lines.length < 2 || joinedLength(full) <= CONTEXT_CEILING) return full.join('\n')
  const kept = keptCount(opening, lines)
  return [opening, ...lines.slice(0, kept), moreLine(lines.length - kept)].join('\n')
}

const acceptedText = (slug: string, commit: string, removed: readonly string[]): string => {
  const opening = `logbook: accepted the update to ${slug} (commit ${commit.slice(0, 8)}).`
  return cutTo(CONTEXT_CEILING, removed.length === 0 ? opening : `${opening} Removed: ${removed.join(', ')}.`)
}

const failedText = (edited: string, refusal: Refusal): string =>
  cutTo(CONTEXT_CEILING, `logbook: the edit to ${edited} was not committed: ${refusal.message}`)

const isRefusal = (result: ReconcileResult | Refusal): result is Refusal => !('kind' in result)

const reconcileText = (edited: string, slug: string, result: ReconcileResult | Refusal): string | null => {
  if (isRefusal(result)) return failedText(edited, result)
  if (result.kind === 'refused') return refusalText(edited, result.violations)
  if (result.kind !== 'accepted') return null
  result.push?.unref()
  return acceptedText(slug, result.commit, result.removed)
}

const matchingSlug = (rt: Runtime, paths: RepoPaths, editedReal: string): string | undefined =>
  listSlugs(rt, paths).find((slug) => {
    const file = workingCopyPath(paths, slug)
    return file.ok && realPathOf(file.value) === editedReal
  })

const editContext = (rt: Runtime, paths: RepoPaths, call: ToolCall): string | null => {
  if (!EDIT_TOOLS.has(call.name)) return null
  const edited = editedPathOf(call.input)
  if (edited === null) return null
  const editedReal = realPathOf(edited)
  if (editedReal === null) return null
  const slug = matchingSlug(rt, paths, editedReal)
  return slug === undefined ? null : reconcileText(edited, slug, reconcileThread(rt, paths, slug))
}

const responseText = (response: unknown): string | null => {
  if (typeof response === 'string') return response
  const content = isPlainObject(response) ? response.content : response
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const text = content
    .filter(isPlainObject)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text))
    .join('\n')
  return text.length === 0 ? null : text
}

const milestoneContext = (
  rt: Runtime,
  paths: RepoPaths,
  event: Record<string, unknown>,
  held: string | null,
  call: ToolCall
): string | null => {
  if (held === null || nonEmptyString(event.agent_id) !== null || !isMilestone(call.name, call.input)) return null
  const promptId = nonEmptyString(event.prompt_id)
  const hold = readHold(paths, held)
  if (hold === null || (promptId !== null && hold.nudged_prompt_id === promptId)) return null
  const file = workingCopyPath(paths, held)
  const stored = readDocument(rt, paths, held)
  if (!file.ok || stored === null) return null
  const summary = toolSummary(call.name, call.input, responseText(event.tool_response))
  const request = updateRequest({
    path: file.value,
    documentText: stored.text,
    reason: { kind: 'milestone', detail: activityLine(call.name, summary) }
  })
  if (promptId !== null) setNudged(rt, paths, held, promptId)
  return request
}

const contextOutput = (contexts: readonly string[]): PostToolUseOutput =>
  contexts.length === 0
    ? {}
    : { hookSpecificOutput: { hookEventName: HOOK_EVENT, additionalContext: contexts.join(CONTEXT_SEPARATOR) } }

export const postToolUse = (input: PostToolUseInput): PostToolUseOutput => {
  const { event, paths, rt, sessionId } = input
  const held = heldBy(paths, sessionId)
  const transcript = nonEmptyString(event.transcript_path)
  const toolUseId = nonEmptyString(event.tool_use_id)
  if (held !== null && transcript !== null) addTranscript(rt, paths, held, transcript)
  if (held !== null && toolUseId !== null) clearMarker(paths, held, toolUseId)
  if (event.hook_event_name === FAILURE_EVENT) return {}
  const call = toolCallOf(event)
  if (call === null) return {}
  const contexts = [editContext(rt, paths, call), milestoneContext(rt, paths, event, held, call)]
  return contextOutput(contexts.filter((context): context is string => context !== null))
}
