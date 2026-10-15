type Quote = "'" | '"' | null

type SeparatorAt = (text: string, index: number) => number

const OPERATORS: readonly string[] = ['&&', '||', ';', '|', '\n']
const WHITESPACE = /\s/
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/
const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
const PULL_REQUEST_TOOL = /^mcp__.+__(?:create|merge)_pull_request$/
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c'])
const GIT_FLAG_OPTIONS: ReadonlySet<string> = new Set(['--no-pager', '-P'])
const GIT_ASSIGNED_OPTION = /^--(?:git-dir|work-tree)=./
const GIT_MILESTONES: ReadonlySet<string> = new Set(['commit', 'push', 'merge'])
const GH_PR_MILESTONES: ReadonlySet<string> = new Set(['create', 'merge'])

const operatorAt: SeparatorAt = (text, index) =>
  OPERATORS.find((operator) => text.startsWith(operator, index))?.length ?? 0

const whitespaceAt: SeparatorAt = (text, index) => (WHITESPACE.test(text[index] ?? '') ? 1 : 0)

const splitOutsideQuotes = (text: string, separatorAt: SeparatorAt): string[] => {
  const pieces: string[] = []
  let current = ''
  let quote: Quote = null
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (quote !== "'" && char === '\\') {
      const next = text[index + 1] ?? ''
      current += next === '\n' ? ' ' : `${char}${next}`
      index += 2
      continue
    }
    if (quote !== null) {
      current += char
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      current += char
      quote = char
      index += 1
      continue
    }
    const separator = separatorAt(text, index)
    if (separator > 0) {
      pieces.push(current)
      current = ''
      index += separator
      continue
    }
    current += char
    index += 1
  }
  return [...pieces, current].map((piece) => piece.trim()).filter((piece) => piece.length > 0)
}

export const splitSegments = (command: string): string[] => splitOutsideQuotes(command, operatorAt)

const commandWords = (segment: string): string[] => {
  const words = splitOutsideQuotes(segment, whitespaceAt)
  const start = words.findIndex((word) => !ASSIGNMENT_WORD.test(word))
  return start < 0 ? [] : words.slice(start)
}

const gitSubcommand = (words: readonly string[]): string | undefined => {
  const [first, ...rest] = words
  if (first === undefined) return undefined
  if (GIT_VALUE_OPTIONS.has(first)) return gitSubcommand(rest.slice(1))
  if (GIT_FLAG_OPTIONS.has(first) || GIT_ASSIGNED_OPTION.test(first)) return gitSubcommand(rest)
  return first
}

const isMilestoneSegment = (segment: string): boolean => {
  const [program, ...args] = commandWords(segment)
  if (program === 'git') {
    const subcommand = gitSubcommand(args)
    return subcommand !== undefined && GIT_MILESTONES.has(subcommand)
  }
  if (program === 'gh') {
    const [group, action] = args
    return group === 'pr' && action !== undefined && GH_PR_MILESTONES.has(action)
  }
  return false
}

export const isMilestone = (toolName: string, toolInput: Record<string, unknown>): boolean => {
  if (AGENT_TOOLS.has(toolName) || PULL_REQUEST_TOOL.test(toolName)) return true
  if (toolName !== 'Bash') return false
  const { command } = toolInput
  return typeof command === 'string' && splitSegments(command).some(isMilestoneSegment)
}
