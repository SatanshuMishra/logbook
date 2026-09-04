import { MARKDOWN_LEADING_CHARS } from '../../src/render/escape.ts'

export { MARKDOWN_LEADING_CHARS }

const FORMAT_CLASS = /\p{Cf}/u
const SEPARATOR_CLASS = /\p{Zs}/u
const CONTROL_CLASS = /\p{Cc}/u
const ORDINARY_SPACE = ' '
const LINE_SEPARATOR = '\u2028'
const PARAGRAPH_SEPARATOR = '\u2029'
const ALWAYS_ESCAPED_CHARS = new Set(['<', '>', '|'])
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

const toEscaped = (char: string): string => {
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

export const reproduceEscapeStored = (text: string, threshold: number): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let atLineStart = true
  let spaceRun = 0
  let index = 0
  while (index < chars.length) {
    const char = chars[index] as string
    if (atLineStart && char === ORDINARY_SPACE) {
      if (spaceRun + 1 >= threshold) {
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
