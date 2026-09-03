const WHITESPACE = new Set([' ', '\t', '\r'])
const SEGMENT_BREAKS = new Set([';', '\n', '|', '&'])
const DOUBLING_BREAKS = new Set(['|', '&'])
const FORBIDDEN_UNQUOTED = new Set(['$', '`', '\\', '(', ')', '{', '}', '<', '!'])
const FORBIDDEN_IN_DOUBLE_QUOTES = new Set(['$', '`', '\\'])

const SINGLE_QUOTE = "'"
const DOUBLE_QUOTE = '"'
const REDIRECT = '>'

const STDERR_FD = '2'
const STDERR_REDIRECTS = ['>/dev/null', '>&1'] as const

type Atom = { text: string; next: number } | null

const readSingleQuoted = (chars: readonly string[], start: number): Atom => {
  const end = chars.indexOf(SINGLE_QUOTE, start + 1)
  if (end === -1) return null
  return { text: chars.slice(start + 1, end).join(''), next: end + 1 }
}

const readDoubleQuoted = (chars: readonly string[], start: number): Atom => {
  const parts: string[] = []
  let index = start + 1
  while (index < chars.length) {
    const char = chars[index] as string
    if (char === DOUBLE_QUOTE) return { text: parts.join(''), next: index + 1 }
    if (FORBIDDEN_IN_DOUBLE_QUOTES.has(char)) return null
    parts.push(char)
    index += 1
  }
  return null
}

const readStderrRedirect = (chars: readonly string[], start: number, token: string, tokenOpen: boolean): Atom => {
  if (!tokenOpen || token !== STDERR_FD) return null
  const rest = chars.slice(start).join('')
  for (const form of STDERR_REDIRECTS) {
    if (!rest.startsWith(form)) continue
    const after = chars[start + form.length]
    if (after === undefined || WHITESPACE.has(after) || SEGMENT_BREAKS.has(after)) {
      return { text: form, next: start + form.length }
    }
  }
  return null
}

const readAtom = (chars: readonly string[], start: number, token: string, tokenOpen: boolean): Atom => {
  const char = chars[start] as string
  if (char === SINGLE_QUOTE) return readSingleQuoted(chars, start)
  if (char === DOUBLE_QUOTE) return readDoubleQuoted(chars, start)
  if (char === REDIRECT) return readStderrRedirect(chars, start, token, tokenOpen)
  if (FORBIDDEN_UNQUOTED.has(char)) return null
  return { text: char, next: start + 1 }
}

export type Scan = { ok: true; segments: readonly (readonly string[])[] } | { ok: false }

export const scanShellSegments = (command: string): Scan => {
  const chars = Array.from(command)
  const segments: string[][] = []
  let tokens: string[] = []
  let token = ''
  let tokenOpen = false
  let index = 0

  const closeToken = (): void => {
    if (tokenOpen) tokens.push(token)
    token = ''
    tokenOpen = false
  }

  const closeSegment = (): void => {
    closeToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }

  while (index < chars.length) {
    const char = chars[index] as string
    if (WHITESPACE.has(char)) {
      closeToken()
      index += 1
      continue
    }
    if (SEGMENT_BREAKS.has(char)) {
      closeSegment()
      index += DOUBLING_BREAKS.has(char) && chars[index + 1] === char ? 2 : 1
      continue
    }
    const atom = readAtom(chars, index, token, tokenOpen)
    if (atom === null) return { ok: false }
    token += atom.text
    tokenOpen = true
    index = atom.next
  }

  closeSegment()
  return { ok: true, segments }
}
