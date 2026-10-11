import { clipWithMarker } from './clip.ts'

const FORMAT_CLASS = /\p{Cf}/u
const SEPARATOR_CLASS = /\p{Zs}/u
const CONTROL_CLASS = /\p{Cc}/u
const ORDINARY_SPACE = ' '
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const LINE_SEPARATOR = '\u2028'
const PARAGRAPH_SEPARATOR = '\u2029'
export const MARKDOWN_LEADING_CHARS: ReadonlySet<string> = new Set(['#', '-', '*', '+', '>', '`', '~', '_', '=', '['])
const ALWAYS_ESCAPED_CHARS = new Set(['<'])
const MARKDOWN_INDENT_THRESHOLD = 4
const ORDERED_LIST_DIGIT = /[0-9]/
const ORDERED_LIST_PUNCTUATION = new Set(['.', ')'])
const ORDERED_LIST_TERMINATOR = /\s/
export const TABLE_CELL_ESCAPED_CHARS: ReadonlySet<string> = new Set(['|'])
const PROSE_ESCAPED_CHARS: ReadonlySet<string> = new Set()
const ANGLE_WRAPPED_ESCAPED_CHARS: ReadonlySet<string> = new Set(['>'])
const BRACKET_WRAPPED_ESCAPED_CHARS: ReadonlySet<string> = new Set([']'])
const PAREN_WRAPPED_ESCAPED_CHARS: ReadonlySet<string> = new Set([')'])
const DOUBLE_QUOTED_ESCAPED_CHARS: ReadonlySet<string> = new Set(['"'])
const SINGLE_QUOTED_ESCAPED_CHARS: ReadonlySet<string> = new Set(["'"])

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

export type EscapeSurface =
  | 'prose'
  | 'table-cell'
  | 'angle-wrapped'
  | 'bracket-wrapped'
  | 'paren-wrapped'
  | 'double-quoted'
  | 'single-quoted'

const SURFACE_ESCAPED_CHARS: Readonly<Record<EscapeSurface, ReadonlySet<string>>> = {
  prose: PROSE_ESCAPED_CHARS,
  'table-cell': TABLE_CELL_ESCAPED_CHARS,
  'angle-wrapped': ANGLE_WRAPPED_ESCAPED_CHARS,
  'bracket-wrapped': BRACKET_WRAPPED_ESCAPED_CHARS,
  'paren-wrapped': PAREN_WRAPPED_ESCAPED_CHARS,
  'double-quoted': DOUBLE_QUOTED_ESCAPED_CHARS,
  'single-quoted': SINGLE_QUOTED_ESCAPED_CHARS
}

export const escapeStored = (text: string, surface: EscapeSurface = 'prose'): string => {
  const surfaceEscapedChars = SURFACE_ESCAPED_CHARS[surface]
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
    out.push(surfaceEscapedChars.has(char) ? toEscaped(char) : escapeChar(char))
    atLineStart = char === '\n' || char === '\r'
    spaceRun = 0
    index += 1
  }
  return out.join('')
}

const STORED_LINE_BREAK = toEscaped('\n')

export const firstStoredLine = (text: string): string => text.split(STORED_LINE_BREAK)[0] ?? ''

export const firstNonEmptyStoredLine = (text: string): string =>
  text.split(STORED_LINE_BREAK).find((line) => line.length > 0) ?? ''

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

const CHARACTER_REFERENCES: ReadonlyMap<string, string> = new Map([
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&apos;'],
  [')', '&#41;'],
  [']', '&#93;'],
  ['|', '&#124;']
])
const EMITTED_REFERENCES: readonly string[] = [...CHARACTER_REFERENCES.values()]
const REFERENCE_START = '&'
const BACKSLASH = '\\'
const BACKSLASH_ESCAPABLE = /^[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]$/
const DISPLAY_LINE_BREAK = /\r\n|\r|\n/
const LEADING_SPACES = /^ */

const isBackslashEscapeAt = (graphemes: readonly string[], index: number): boolean =>
  graphemes[index] === BACKSLASH && BACKSLASH_ESCAPABLE.test(graphemes[index + 1] ?? '')

const referenceAt = (graphemes: readonly string[], index: number): string | undefined =>
  graphemes[index] === REFERENCE_START
    ? EMITTED_REFERENCES.find(
        (reference) => graphemes.slice(index, index + reference.length).join('') === reference
      )
    : undefined

const escapeUnitEndAt = (graphemes: readonly string[], index: number): number => {
  const decoded =
    graphemes[index] === 'U' && graphemes[index + 1] === '+' ? decodedEscapeAt(graphemes, index) : null
  if (decoded !== null) return index + ESCAPE_PREFIX.length + decoded.width
  if (isBackslashEscapeAt(graphemes, index)) return index + 2
  return index + (referenceAt(graphemes, index)?.length ?? 1)
}

const escapeTokenSafeBoundary = (graphemes: readonly string[], max: number): number => {
  if (max >= graphemes.length) return graphemes.length
  let index = 0
  while (index < max) {
    const end = escapeUnitEndAt(graphemes, index)
    if (end > max) return index === 0 ? end : index
    index = end
  }
  return max
}

export const clipGraphemes = (text: string, max: number): string => {
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(text), (entry) => entry.segment)
  return graphemes.slice(0, escapeTokenSafeBoundary(graphemes, max)).join('')
}

const escapeTokenSafeFloorBoundary = (graphemes: readonly string[], min: number): number => {
  if (min >= graphemes.length) return graphemes.length
  let index = 0
  while (index < min) {
    const end = escapeUnitEndAt(graphemes, index)
    if (end > min) return end
    index = end
  }
  return min
}

export const clipGraphemesFloor = (text: string, min: number): string => {
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(text), (entry) => entry.segment)
  return graphemes.slice(0, escapeTokenSafeFloorBoundary(graphemes, min)).join('')
}

const isDecodedLineBreak = (char: string): boolean => char === '\n' || char === '\r'

const charAfterToken = (chars: readonly string[], index: number): string => {
  const next = chars[index] === 'U' && chars[index + 1] === '+' ? decodedEscapeAt(chars, index) : null
  if (next !== null && isEscapable(next.char)) return next.char
  return chars[index] ?? ''
}

const storageWrotePositionalToken = (
  chars: readonly string[],
  start: number,
  end: number,
  char: string,
  line: string
): boolean => {
  const after = ORDERED_LIST_PUNCTUATION.has(char) ? charAfterToken(chars, end) : ''
  const written = chars.slice(start, end).join('')
  return escapeStored(`${line}${char}${after}`) === escapeStored(`${line}${written}${after}`)
}

const decodeStored = (stored: string): string => {
  const chars = Array.from(stored)
  const decoded: string[] = []
  let lineStart = 0
  let index = 0
  while (index < chars.length) {
    const token = chars[index] === 'U' && chars[index + 1] === '+' ? decodedEscapeAt(chars, index) : null
    const end = token === null ? index + 1 : index + ESCAPE_PREFIX.length + token.width
    const decodes =
      token !== null &&
      (isEscapable(token.char) ||
        storageWrotePositionalToken(chars, index, end, token.char, decoded.slice(lineStart).join('')))
    const char = decodes ? token.char : (chars[index] as string)
    decoded.push(char)
    if (isDecodedLineBreak(char)) lineStart = decoded.length
    index = decodes ? end : index + 1
  }
  return decoded.join('')
}

const lineStartMarkerIndex = (chars: readonly string[]): number | null => {
  let start = 0
  while (chars[start] === ORDINARY_SPACE) start += 1
  if (MARKDOWN_LEADING_CHARS.has(chars[start] ?? '')) return start
  const markerEnd = orderedListMarkerEnd(chars, start)
  return markerEnd === null ? null : markerEnd - 1
}

const displayLine = (line: string, surface: EscapeSurface, atLineStart: boolean): string => {
  const surfaceEscapedChars = SURFACE_ESCAPED_CHARS[surface]
  const chars = Array.from(line)
  const backslashed = atLineStart ? lineStartMarkerIndex(chars) : null
  const out: string[] = []
  let backslashRun = 0
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] as string
    const reference =
      ALWAYS_ESCAPED_CHARS.has(char) || surfaceEscapedChars.has(char) ? CHARACTER_REFERENCES.get(char) : undefined
    if (reference !== undefined) out.push(BACKSLASH.repeat(backslashRun), reference)
    else if (index === backslashed) out.push(BACKSLASH, char)
    else out.push(escapeChar(char))
    backslashRun = char === BACKSLASH ? backslashRun + 1 : 0
  }
  return out.join('')
}

const guardIndentation = (displayed: string): string => {
  const spaces = LEADING_SPACES.exec(displayed)?.[0].length ?? 0
  if (spaces < MARKDOWN_INDENT_THRESHOLD || spaces === displayed.length) return displayed
  return `${displayed.slice(0, MARKDOWN_INDENT_THRESHOLD - 1)}${toEscaped(ORDINARY_SPACE)}${displayed.slice(MARKDOWN_INDENT_THRESHOLD)}`
}

export const displayStored = (
  stored: string,
  surface: EscapeSurface = 'prose',
  position: 'line-start' | 'mid-line' = 'line-start'
): string => {
  const shown = decodeStored(stored)
    .split(DISPLAY_LINE_BREAK)
    .map((line, index) => displayLine(line, surface, index > 0 || position === 'line-start'))
    .join(ORDINARY_SPACE)
  return position === 'line-start' ? guardIndentation(shown) : shown
}

export const displayStoredBlock = (stored: string, max: number = Number.POSITIVE_INFINITY): string =>
  clipWithMarker(
    decodeStored(stored)
      .split(DISPLAY_LINE_BREAK)
      .map((line) => guardIndentation(displayLine(line, 'prose', true)))
      .join('\n'),
    max
  )
    .split('\n')
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n')

export const storedSpansLines = (stored: string): boolean => DISPLAY_LINE_BREAK.test(decodeStored(stored))
