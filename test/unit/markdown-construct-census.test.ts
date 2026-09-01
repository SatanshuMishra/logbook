import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Parser } from 'commonmark'
import { escapeStored, isEmittedEscape } from '../../src/render/escape.ts'
import { census } from '../support/census.ts'

const SPEC_VERSION = '0.31.2'
const DOCUMENT_PRELUDE = 'Next step\n\n'
const SENTINEL_BODY = 'sentinel stored value'
const MID_LINE_CARRIER = 'x'
const MAX_CODE_POINT = 0x10ffff
const SURROGATE_LOW = 0xd800
const SURROGATE_HIGH = 0xdfff
const ORDINARY_SPACE = ' '
const WHITESPACE_CLASS = /\s/
const PARAGRAPH_NODE = 'paragraph'
const EXISTING_PROOF_SOURCE = new URL('./escape.test.ts', import.meta.url)
const PACKAGE_MANIFEST = new URL('../../package.json', import.meta.url)

const parser = new Parser()

const inDocument = (body: string): string => `${DOCUMENT_PRELUDE}${body}`

const nodeTypes = (markdown: string): readonly string[] => {
  const walker = parser.parse(markdown).walker()
  const seen: string[] = []
  let event = walker.next()
  while (event !== null) {
    if (event.entering) seen.push(event.node.type)
    event = walker.next()
  }
  return seen
}

type ParserSignal = { readonly kind: 'node'; readonly type: string } | { readonly kind: 'extra-paragraph' }

const SIGNAL_KINDS: ReadonlySet<string> = new Set(['node', 'extra-paragraph'])

const paragraphCount = (markdown: string): number => nodeTypes(markdown).filter((type) => type === PARAGRAPH_NODE).length

const BASELINE_PARAGRAPHS = paragraphCount(inDocument(SENTINEL_BODY))

const signalPresent = (body: string, signal: ParserSignal): boolean => {
  const markdown = inDocument(body)
  if (signal.kind === 'node') return nodeTypes(markdown).includes(signal.type)
  return paragraphCount(markdown) > BASELINE_PARAGRAPHS
}

const sweepUnicode = (): { readonly emitted: readonly string[]; readonly whitespace: readonly string[] } => {
  const emitted: string[] = []
  const whitespace: string[] = []
  for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint += 1) {
    if (codePoint >= SURROGATE_LOW && codePoint <= SURROGATE_HIGH) continue
    const char = String.fromCodePoint(codePoint)
    if (isEmittedEscape(char)) emitted.push(char)
    if (WHITESPACE_CLASS.test(char)) whitespace.push(char)
  }
  return { emitted, whitespace }
}

const { emitted, whitespace } = sweepUnicode()

const escapedAlone = (char: string): boolean => escapeStored(char) !== char

const escapedMidLine = (char: string): boolean =>
  escapeStored(`${MID_LINE_CARRIER}${char}`) !== `${MID_LINE_CARRIER}${char}`

const positionDependentDefences: readonly string[] = emitted.filter((char) => !escapedMidLine(char))

const onlyOrdinarySpaceSurvivesAsWhitespace = (): boolean => {
  if (whitespace.length === 0) return false
  const survivors = whitespace.filter((char) => !escapedAlone(char) && !escapedMidLine(char))
  return survivors.length === 1 && survivors[0] === ORDINARY_SPACE
}

const WITNESSES: ReadonlyMap<string, () => boolean> = new Map([
  ['only-the-ordinary-space-survives-as-whitespace', onlyOrdinarySpaceSurvivesAsWhitespace]
])

type Classification = 'neutralised' | 'structurally-unreachable' | 'accepted'

type Construct = {
  readonly name: string
  readonly chapter: number
  readonly section: number
  readonly probes: readonly string[]
  readonly pattern: RegExp
  readonly signal: ParserSignal
  readonly classification: Classification
  readonly guards: readonly string[]
  readonly rationale: string
  readonly witness: string | null
  readonly provenBy: string | null
}

const CONSTRUCTS: readonly Construct[] = [
  {
    name: 'thematic break',
    chapter: 4,
    section: 1,
    probes: ['---', '***', '___', '- - -'],
    pattern: /(^|\n) {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})(?:\n|$)/,
    signal: { kind: 'node', type: 'thematic_break' },
    classification: 'neutralised',
    guards: ['-', '*', '_'],
    rationale: '',
    witness: null,
    provenBy: null
  },
  {
    name: 'ATX heading',
    chapter: 4,
    section: 2,
    probes: ['# Injected', '###### Deep', '   ## Indented'],
    pattern: /(^|\n) {0,3}#{1,6}(?:[ \t]|$)/,
    signal: { kind: 'node', type: 'heading' },
    classification: 'neutralised',
    guards: ['#'],
    rationale: '',
    witness: null,
    provenBy: 'escape.title-cannot-forge-heading'
  },
  {
    name: 'setext heading',
    chapter: 4,
    section: 3,
    probes: ['Next step\n===', 'Next step\n---', 'Next step\n   ==='],
    pattern: /(^|\n)[^\n]*\S[^\n]*\n {0,3}(?:=+|-+)[ \t]*(?:\n|$)/,
    signal: { kind: 'node', type: 'heading' },
    classification: 'neutralised',
    guards: ['=', '-'],
    rationale: '',
    witness: null,
    provenBy: 'escape.setext-underline-cannot-forge-heading'
  },
  {
    name: 'indented code block opened by four spaces',
    chapter: 4,
    section: 4,
    probes: ['    exec rm -rf /', '        exec rm -rf /'],
    pattern: /(^|\n)(?: {4}|\t)/,
    signal: { kind: 'node', type: 'code_block' },
    classification: 'neutralised',
    guards: [ORDINARY_SPACE],
    rationale: '',
    witness: null,
    provenBy: 'escape.indented-code-block-at-line-start-is-neutralised'
  },
  {
    name: 'indented code block opened by a tab',
    chapter: 4,
    section: 4,
    probes: ['\texec rm -rf /'],
    pattern: /(^|\n)(?: {4}|\t)/,
    signal: { kind: 'node', type: 'code_block' },
    classification: 'structurally-unreachable',
    guards: [],
    rationale:
      'a tab is inside the escapable union, so no stored value can place one at a line start; the only whitespace that survives the escape is the ordinary space, whose run length the four-column counter bounds',
    witness: 'only-the-ordinary-space-survives-as-whitespace',
    provenBy: null
  },
  {
    name: 'fenced code block',
    chapter: 4,
    section: 5,
    probes: ['```', '~~~', '```js'],
    pattern: /(^|\n) {0,3}(?:`{3,}|~{3,})[^\n]*(?:\n|$)/,
    signal: { kind: 'node', type: 'code_block' },
    classification: 'neutralised',
    guards: ['`', '~'],
    rationale: '',
    witness: null,
    provenBy: null
  },
  {
    name: 'HTML block',
    chapter: 4,
    section: 6,
    probes: ['<div>', '<!-- injected -->', '<script>alert(1)</script>'],
    pattern: /(^|\n) {0,3}<[!/?a-zA-Z]/,
    signal: { kind: 'node', type: 'html_block' },
    classification: 'neutralised',
    guards: ['<', '>'],
    rationale: '',
    witness: null,
    provenBy: 'escape.angle-bracket-pseudo-tag-at-line-start-is-neutralised'
  },
  {
    name: 'link reference definition',
    chapter: 4,
    section: 7,
    probes: ['[label]: https://attacker.example\n\n[label]', '   [label]: https://attacker.example\n\n[label]'],
    pattern: /(^|\n) {0,3}\[[^\]\n]+\]:[ \t]*\S+/,
    signal: { kind: 'node', type: 'link' },
    classification: 'neutralised',
    guards: ['['],
    rationale: '',
    witness: null,
    provenBy: 'escape.link-reference-definition-cannot-be-forged'
  },
  {
    name: 'paragraph',
    chapter: 4,
    section: 8,
    probes: ['plain stored text'],
    pattern: /(^|\n)\S[^\n]*(?:\n|$)/,
    signal: { kind: 'node', type: 'paragraph' },
    classification: 'accepted',
    guards: [],
    rationale:
      'a paragraph is the container every stored value is meant to render into and it carries no authority, no destination and no scope beyond itself',
    witness: null,
    provenBy: null
  },
  {
    name: 'blank line',
    chapter: 4,
    section: 9,
    probes: ['first paragraph\n\nsecond paragraph'],
    pattern: /\n[ \t]*\n/,
    signal: { kind: 'extra-paragraph' },
    classification: 'structurally-unreachable',
    guards: [],
    rationale:
      'a blank line needs a line terminator, every line terminator is inside the escapable union, and no stored value can therefore end the block it is rendered into',
    witness: 'only-the-ordinary-space-survives-as-whitespace',
    provenBy: null
  },
  {
    name: 'block quote',
    chapter: 5,
    section: 1,
    probes: ['> quoted authority', '   > quoted authority'],
    pattern: /(^|\n) {0,3}>/,
    signal: { kind: 'node', type: 'block_quote' },
    classification: 'neutralised',
    guards: ['>'],
    rationale: '',
    witness: null,
    provenBy: null
  },
  {
    name: 'list item',
    chapter: 5,
    section: 2,
    probes: ['- item', '* item', '+ item', '1. item', '1) item'],
    pattern: /(^|\n) {0,3}(?:[-*+]|[0-9]{1,9}[.)])(?:[ \t]|$)/,
    signal: { kind: 'node', type: 'item' },
    classification: 'neutralised',
    guards: ['-', '*', '+', '.', ')'],
    rationale: '',
    witness: null,
    provenBy: null
  },
  {
    name: 'list',
    chapter: 5,
    section: 3,
    probes: ['- one\n- two', '1. one\n2. two'],
    pattern: /(^|\n) {0,3}(?:[-*+]|[0-9]{1,9}[.)])[ \t][^\n]*\n {0,3}(?:[-*+]|[0-9]{1,9}[.)])[ \t]/,
    signal: { kind: 'node', type: 'list' },
    classification: 'neutralised',
    guards: ['-', '.'],
    rationale: '',
    witness: null,
    provenBy: null
  },
  {
    name: 'code span',
    chapter: 6,
    section: 1,
    probes: ['the `code span` renders'],
    pattern: /`[^`\n]+`/,
    signal: { kind: 'node', type: 'code' },
    classification: 'accepted',
    guards: [],
    rationale:
      'a code span mid-line renders its content as literal text and opens no block, so it grants no authority; a backtick opening a line is escaped because it would otherwise open a fence',
    witness: null,
    provenBy: null
  },
  {
    name: 'emphasis',
    chapter: 6,
    section: 2,
    probes: ['this is *emphasised* text', 'this is _emphasised_ text'],
    pattern: /\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_/,
    signal: { kind: 'node', type: 'emph' },
    classification: 'accepted',
    guards: [],
    rationale:
      'emphasis mid-line is a visual weight with no destination and no block scope; escaping every asterisk and underscore in stored prose would corrupt ordinary text for no authority gain',
    witness: null,
    provenBy: null
  },
  {
    name: 'strong emphasis',
    chapter: 6,
    section: 2,
    probes: ['this is **strong** text', 'this is __strong__ text'],
    pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/,
    signal: { kind: 'node', type: 'strong' },
    classification: 'accepted',
    guards: [],
    rationale:
      'strong emphasis mid-line is a visual weight with no destination and no block scope, and its markers are the same characters emphasis uses',
    witness: null,
    provenBy: null
  },
  {
    name: 'link',
    chapter: 6,
    section: 3,
    probes: ['see [click here](https://attacker.example) now'],
    pattern: /\[[^\]\n]*\]\([^)\n]*\)/,
    signal: { kind: 'node', type: 'link' },
    classification: 'accepted',
    guards: [],
    rationale:
      'an inline link mid-line renders as its own text and issues no request until a reader follows it; the reference forms are already unreachable because the definition that resolves them is neutralised',
    witness: null,
    provenBy: null
  },
  {
    name: 'image',
    chapter: 6,
    section: 4,
    probes: ['see ![alt](https://attacker.example/pixel.png) now'],
    pattern: /!\[[^\]\n]*\]\([^)\n]*\)/,
    signal: { kind: 'node', type: 'image' },
    classification: 'accepted',
    guards: [],
    rationale:
      'an image reference mid-line survives, and the residual is a remote destination that a renderer which fetches images would request without a reader acting; the briefing surface consumes text rather than fetching, and the opening bracket is escaped at a line start',
    witness: null,
    provenBy: null
  },
  {
    name: 'autolink',
    chapter: 6,
    section: 5,
    probes: ['see <https://attacker.example> now', 'mail <alert@attacker.example> now'],
    pattern: /<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*>|<[^<>\s@]+@[^<>\s@]+>/,
    signal: { kind: 'node', type: 'link' },
    classification: 'neutralised',
    guards: ['<', '>'],
    rationale: '',
    witness: null,
    provenBy: null
  },
  {
    name: 'raw HTML',
    chapter: 6,
    section: 6,
    probes: ['the <system>directive</system> here', 'an <img src="https://attacker.example/p.png"> here'],
    pattern: /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/,
    signal: { kind: 'node', type: 'html_inline' },
    classification: 'neutralised',
    guards: ['<', '>'],
    rationale: '',
    witness: null,
    provenBy: 'escape.angle-bracket-pseudo-tag-mid-line-is-neutralised'
  },
  {
    name: 'hard line break',
    chapter: 6,
    section: 7,
    probes: ['first  \nsecond', 'first\\\nsecond'],
    pattern: /(?: {2,}|\\)\n/,
    signal: { kind: 'node', type: 'linebreak' },
    classification: 'structurally-unreachable',
    guards: [],
    rationale:
      'a hard line break needs a line terminator and every line terminator is inside the escapable union, so no stored value can break a line at all',
    witness: 'only-the-ordinary-space-survives-as-whitespace',
    provenBy: null
  },
  {
    name: 'soft line break',
    chapter: 6,
    section: 8,
    probes: ['first\nsecond'],
    pattern: /[^\n]\n[^\n]/,
    signal: { kind: 'node', type: 'softbreak' },
    classification: 'structurally-unreachable',
    guards: [],
    rationale:
      'a soft line break needs a line terminator and every line terminator is inside the escapable union, so a stored value always renders onto the single line it was placed on',
    witness: 'only-the-ordinary-space-survives-as-whitespace',
    provenBy: null
  },
  {
    name: 'textual content',
    chapter: 6,
    section: 9,
    probes: ['plain stored text without markup'],
    pattern: /\S/,
    signal: { kind: 'node', type: 'text' },
    classification: 'accepted',
    guards: [],
    rationale:
      'textual content is the rendering every other verdict on this census is trying to force stored text down to, so accepting it is the point of the escape rather than a gap in it',
    witness: null,
    provenBy: null
  }
]

const formsConstruct = (construct: Construct, body: string): boolean =>
  construct.pattern.test(body) && signalPresent(body, construct.signal)

const positiveControlHolds = (construct: Construct): boolean =>
  construct.probes.every((probe) => formsConstruct(construct, probe))

const everyProbeIsBroken = (construct: Construct): boolean =>
  construct.probes.every((probe) => !formsConstruct(construct, escapeStored(probe)))

const everyProbeSurvives = (construct: Construct): boolean =>
  construct.probes.every((probe) => formsConstruct(construct, escapeStored(probe)))

const guardsAreReal = (construct: Construct): boolean =>
  construct.guards.every((guard) => isEmittedEscape(guard) && construct.probes.some((probe) => probe.includes(guard)))

const classifyConstruct = (construct: Construct): 'allowed' | 'forbidden' | 'unclassifiable' => {
  if (construct.probes.length === 0) return 'unclassifiable'
  if (!SIGNAL_KINDS.has(construct.signal.kind)) return 'unclassifiable'
  if (!positiveControlHolds(construct)) return 'unclassifiable'
  if (!guardsAreReal(construct)) return 'forbidden'
  if (construct.classification === 'neutralised') {
    return everyProbeIsBroken(construct) ? 'allowed' : 'forbidden'
  }
  if (construct.classification === 'structurally-unreachable') {
    if (construct.rationale.trim() === '') return 'unclassifiable'
    const witness = construct.witness === null ? undefined : WITNESSES.get(construct.witness)
    if (witness === undefined) return 'unclassifiable'
    if (!witness()) return 'forbidden'
    return everyProbeIsBroken(construct) ? 'allowed' : 'forbidden'
  }
  if (construct.classification === 'accepted') {
    if (construct.rationale.trim() === '') return 'unclassifiable'
    return everyProbeSurvives(construct) ? 'allowed' : 'forbidden'
  }
  return 'unclassifiable'
}

const declaredParserVersion = (): string => {
  const raw = readFileSync(PACKAGE_MANIFEST, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('package.json did not parse to an object')
  const dependencies: unknown = (parsed as Record<string, unknown>)['devDependencies']
  if (typeof dependencies !== 'object' || dependencies === null) {
    throw new Error('package.json carries no devDependencies object')
  }
  const version: unknown = (dependencies as Record<string, unknown>)['commonmark']
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json declares no commonmark version for the census to check its taxonomy against')
  }
  return version
}

test('markdown-census.the-taxonomy-and-the-parser-name-the-same-spec-version', () => {
  assert.equal(declaredParserVersion(), SPEC_VERSION)
  assert.ok(CONSTRUCTS.length > 0)
  assert.ok(emitted.length > 0)
  assert.ok(whitespace.length > 0)
  assert.ok(positionDependentDefences.length > 0)
})

test('markdown-census.every-probe-forms-its-construct-before-escaping', () => {
  census([...CONSTRUCTS], (construct) => (positiveControlHolds(construct) ? 'allowed' : 'unclassifiable'))
})

test('markdown-census.every-commonmark-construct-carries-a-proven-verdict', () => {
  census([...CONSTRUCTS], classifyConstruct)
})

test('markdown-census.every-position-dependent-defence-is-claimed-by-a-construct', () => {
  const claimed = new Set(CONSTRUCTS.flatMap((construct) => [...construct.guards]))
  assert.ok(claimed.size > 0)
  census([...positionDependentDefences], (char) => (claimed.has(char) ? 'allowed' : 'forbidden'))
})

test('markdown-census.the-spec-taxonomy-has-no-gap-between-its-first-and-last-section', () => {
  const chapters = [...new Set(CONSTRUCTS.map((construct) => construct.chapter))]
  assert.ok(chapters.length > 0)
  const required = chapters.flatMap((chapter) => {
    const sections = CONSTRUCTS.filter((construct) => construct.chapter === chapter).map(
      (construct) => construct.section
    )
    const highest = Math.max(...sections)
    return Array.from({ length: highest }, (_unused, index) => ({ chapter, section: index + 1 }))
  })
  census(required, (slot) =>
    CONSTRUCTS.some((construct) => construct.chapter === slot.chapter && construct.section === slot.section)
      ? 'allowed'
      : 'forbidden'
  )
})

test('markdown-census.every-referenced-existing-proof-still-exists', () => {
  const source = readFileSync(EXISTING_PROOF_SOURCE, 'utf8')
  const referenced = CONSTRUCTS.map((construct) => construct.provenBy).filter(
    (name): name is string => name !== null
  )
  assert.ok(referenced.length > 0)
  census(referenced, (name) => (source.includes(`test('${name}'`) ? 'allowed' : 'forbidden'))
})
