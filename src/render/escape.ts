const FORMAT_CLASS = /\p{Cf}/u
const SEPARATOR_CLASS = /\p{Zs}/u
const CONTROL_CLASS = /\p{Cc}/u
const ORDINARY_SPACE = ' '
const LINE_SEPARATOR = '\u2028'
const PARAGRAPH_SEPARATOR = '\u2029'
export const MARKDOWN_LEADING_CHARS: ReadonlySet<string> = new Set(['#', '-', '*', '+', '>', '`', '~', '_', '=', '['])
const ALWAYS_ESCAPED_CHARS = new Set(['<', '>', '|'])
const MARKDOWN_INDENT_THRESHOLD = 4
const ORDERED_LIST_DIGIT = /[0-9]/
const ORDERED_LIST_PUNCTUATION = new Set(['.', ')'])
const ORDERED_LIST_TERMINATOR = /\s/

const isBlank = (char: string): boolean => {
  if (char === LINE_SEPARATOR || char === PARAGRAPH_SEPARATOR) return true
  if (CONTROL_CLASS.test(char)) return true
  return SEPARATOR_CLASS.test(char) && char !== ORDINARY_SPACE
}

const isEscapable = (char: string): boolean =>
  ALWAYS_ESCAPED_CHARS.has(char) || FORMAT_CLASS.test(char) || isBlank(char)

export const isEmittedEscape = (char: string): boolean =>
  isEscapable(char) ||
  MARKDOWN_LEADING_CHARS.has(char) ||
  ORDERED_LIST_PUNCTUATION.has(char) ||
  char === ORDINARY_SPACE

export const toEscaped = (char: string): string => {
  const codePoint = char.codePointAt(0) ?? 0
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

const escapeChar = (char: string): string => (isEscapable(char) ? toEscaped(char) : char)

const orderedListMarkerEnd = (chars: readonly string[], start: number): number | null => {
  let cursor = start
  while (cursor < chars.length && ORDERED_LIST_DIGIT.test(chars[cursor] as string)) cursor += 1
  if (cursor === start) return null
  const punctuation = chars[cursor]
  if (punctuation === undefined || !ORDERED_LIST_PUNCTUATION.has(punctuation)) return null
  const after = chars[cursor + 1]
  if (after !== undefined && !ORDERED_LIST_TERMINATOR.test(after)) return null
  return cursor + 1
}

export const escapeStored = (text: string): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let atLineStart = true
  let spaceRun = 0
  let index = 0
  while (index < chars.length) {
    const char = chars[index] as string
    if (atLineStart && char === ORDINARY_SPACE) {
      if (spaceRun + 1 >= MARKDOWN_INDENT_THRESHOLD) {
        out.push(toEscaped(char))
        spaceRun = 0
      } else {
        out.push(char)
        spaceRun += 1
      }
      index += 1
      continue
    }
    if (atLineStart && MARKDOWN_LEADING_CHARS.has(char)) {
      out.push(toEscaped(char))
      atLineStart = false
      spaceRun = 0
      index += 1
      continue
    }
    if (atLineStart) {
      const markerEnd = orderedListMarkerEnd(chars, index)
      if (markerEnd !== null) {
        for (let cursor = index; cursor < markerEnd - 1; cursor += 1) out.push(escapeChar(chars[cursor] as string))
        out.push(toEscaped(chars[markerEnd - 1] as string))
        atLineStart = false
        spaceRun = 0
        index = markerEnd
        continue
      }
    }
    out.push(escapeChar(char))
    atLineStart = char === '\n' || char === '\r'
    spaceRun = 0
    index += 1
  }
  return out.join('')
}

const ESCAPE_PREFIX = 'U+'
const ESCAPE_DIGITS = /^[0-9A-F]+$/
const ESCAPE_WIDTHS = [4, 5, 6] as const
const MAX_CODE_POINT = 0x10ffff
const SURROGATE_LOW = 0xd800
const SURROGATE_HIGH = 0xdfff

const decodedEscapeAt = (chars: readonly string[], index: number): { char: string; width: number } | null => {
  for (const width of ESCAPE_WIDTHS) {
    const start = index + ESCAPE_PREFIX.length
    const digits = chars.slice(start, start + width).join('')
    if (digits.length !== width) continue
    if (!ESCAPE_DIGITS.test(digits)) continue
    const codePoint = Number.parseInt(digits, 16)
    if (codePoint > MAX_CODE_POINT) continue
    if (codePoint >= SURROGATE_LOW && codePoint <= SURROGATE_HIGH) continue
    const char = String.fromCodePoint(codePoint)
    if (toEscaped(char) !== `${ESCAPE_PREFIX}${digits}`) continue
    if (!isEmittedEscape(char)) continue
    return { char, width }
  }
  return null
}

export const unescapeStored = (text: string): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let index = 0
  while (index < chars.length) {
    const decoded = chars[index] === 'U' && chars[index + 1] === '+' ? decodedEscapeAt(chars, index) : null
    if (decoded !== null) {
      out.push(decoded.char)
      index += ESCAPE_PREFIX.length + decoded.width
      continue
    }
    out.push(chars[index] as string)
    index += 1
  }
  return out.join('')
}

const escapeTokenSafeBoundary = (graphemes: readonly string[], max: number): number => {
  if (max >= graphemes.length) return graphemes.length
  let index = 0
  while (index < max) {
    const decoded =
      graphemes[index] === 'U' && graphemes[index + 1] === '+' ? decodedEscapeAt(graphemes, index) : null
    if (decoded === null) {
      index += 1
      continue
    }
    const end = index + ESCAPE_PREFIX.length + decoded.width
    if (end > max) return index === 0 ? end : index
    index = end
  }
  return max
}

export const clipGraphemes = (text: string, max: number): string => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const graphemes = Array.from(segmenter.segment(text), (entry) => entry.segment)
  return graphemes.slice(0, escapeTokenSafeBoundary(graphemes, max)).join('')
}
