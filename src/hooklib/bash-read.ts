import { scanShellSegments } from './bash-lex.ts'
import { GIT_VERB, isGitReadSegment } from './bash-git.ts'

const READ_VERBS = new Set([
  'cat',
  'jq',
  'ls',
  'head',
  'tail',
  'wc',
  'grep',
  'egrep',
  'fgrep',
  'diff',
  'cmp',
  'comm',
  'stat',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'du',
  'nl',
  'od'
])

const INLINE_PROGRAM_FLAGS: ReadonlyMap<string, readonly string[]> = new Map([
  ['node', ['-e', '--eval', '-p', '--print']],
  ['python', ['-c']],
  ['python3', ['-c']],
  ['perl', ['-e', '-E']],
  ['ruby', ['-e']],
  ['sh', ['-c']],
  ['bash', ['-c']],
  ['zsh', ['-c']]
])

const DATA_ONLY_SINKS: ReadonlyMap<string, readonly string[]> = new Map([
  ['tee', ['-a', '--append', '-i', '--ignore-interrupts', '-p']]
])

const SHELL_EXPANSIONS = ['~', '$', '`', '*', '?', '[']

const STDIN_OPERAND = '-'

const LEADING_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

type SegmentClass = 'read' | 'inert' | 'unclassifiable'

const expandsBeyondTheGuardsView = (token: string): boolean =>
  SHELL_EXPANSIONS.some((expansion) => token.includes(expansion))

const takesItsProgramInline = (tokens: readonly string[]): boolean => {
  const inlineFlags = INLINE_PROGRAM_FLAGS.get(tokens[0] as string)
  if (inlineFlags === undefined) return false
  const args = tokens.slice(1)
  if (args.includes(STDIN_OPERAND)) return false
  return args.some((token, index) => inlineFlags.includes(token) && args[index + 1] !== undefined)
}

const writesOnlyItsNamedOperands = (tokens: readonly string[]): boolean => {
  const sinkFlags = DATA_ONLY_SINKS.get(tokens[0] as string)
  if (sinkFlags === undefined) return false
  return tokens.slice(1).every((token) => !token.startsWith('-') || sinkFlags.includes(token))
}

const classifySegment = (tokens: readonly string[]): SegmentClass => {
  const verb = tokens[0]
  if (verb === undefined) return 'unclassifiable'
  if (LEADING_ASSIGNMENT.test(verb)) return 'unclassifiable'
  if (verb.includes('/')) return 'unclassifiable'
  if (verb === GIT_VERB) return isGitReadSegment(tokens) ? 'read' : 'unclassifiable'
  if (READ_VERBS.has(verb)) return 'read'
  if (tokens.some(expandsBeyondTheGuardsView)) return 'unclassifiable'
  if (takesItsProgramInline(tokens) || writesOnlyItsNamedOperands(tokens)) return 'inert'
  return 'unclassifiable'
}

export const isPureStoreRead = (command: string, touchesStore: (text: string) => boolean): boolean => {
  const scan = scanShellSegments(command)
  if (!scan.ok || scan.segments.length === 0) return false
  const judged = scan.segments.map((tokens) => ({
    touches: touchesStore(tokens.join(' ')),
    classification: classifySegment(tokens)
  }))
  if (!judged.some((segment) => segment.touches)) return false
  return judged.every((segment) =>
    segment.touches ? segment.classification === 'read' : segment.classification !== 'unclassifiable'
  )
}
