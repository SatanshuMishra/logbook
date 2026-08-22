const FORMAT_CLASS = /\p{Cf}/u
const SEPARATOR_CLASS = /\p{Zs}/u
const CONTROL_CLASS = /\p{Cc}/u
const ORDINARY_SPACE = ' '
const LINE_SEPARATOR = '\u2028'
const PARAGRAPH_SEPARATOR = '\u2029'
const MARKDOWN_LEADING_CHARS = new Set(['#', '-', '*', '+', '>', '`', '~'])

const isBlank = (char: string): boolean => {
  if (char === LINE_SEPARATOR || char === PARAGRAPH_SEPARATOR) return true
  if (CONTROL_CLASS.test(char)) return true
  return SEPARATOR_CLASS.test(char) && char !== ORDINARY_SPACE
}

const isEscapable = (char: string): boolean => FORMAT_CLASS.test(char) || isBlank(char)

const toEscaped = (char: string): string => {
  const codePoint = char.codePointAt(0) ?? 0
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

export const escapeStored = (text: string): string => {
  const chars = Array.from(text)
  const out: string[] = []
  let atLineStart = true
  for (const char of chars) {
    const isLineBreak = char === '\n' || char === '\r'
    if (atLineStart && MARKDOWN_LEADING_CHARS.has(char)) {
      out.push(toEscaped(char))
    } else if (isEscapable(char)) {
      out.push(toEscaped(char))
    } else {
      out.push(char)
    }
    atLineStart = isLineBreak
  }
  return out.join('')
}

export const clipGraphemes = (text: string, max: number): string => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const graphemes = Array.from(segmenter.segment(text), (entry) => entry.segment)
  return graphemes.slice(0, max).join('')
}
