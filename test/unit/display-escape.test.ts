import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Parser } from 'commonmark'

const parser = new Parser()

const loadEscape = async () => import('../../src/render/escape.ts')

const nodeTypesOf = (markdown: string): string[] => {
  const walker = parser.parse(markdown).walker()
  const types: string[] = []
  let event = walker.next()
  while (event !== null) {
    if (event.entering) types.push(event.node.type)
    event = walker.next()
  }
  return types
}

const TEXT_ONLY = ['document', 'paragraph', 'text', 'emph', 'softbreak']
const MID_LINE_ACCEPTED = [...TEXT_ONLY, 'strong']
const LINE_START_MARKERS = ['#', '-', '*', '+', '>', '`', '~', '_', '=', '[']

test('display.line-start-markers-render-as-backslash-escapes', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  for (const marker of LINE_START_MARKERS) {
    assert.equal(displayStored(escapeStored(`${marker} item`)), `\\${marker} item`, `${marker} at a value start`)
    assert.equal(displayStored(escapeStored(`lead\n${marker} item`)), `lead \\${marker} item`, `${marker} after a line break`)
    assert.equal(displayStored(escapeStored(`a ${marker} b`)), `a ${marker} b`, `${marker} mid-line is untouched`)
  }
  assert.equal(displayStored(escapeStored('1. first')), '1\\. first')
  assert.equal(displayStored(escapeStored('12) twelfth')), '12\\) twelfth')
  assert.equal(displayStored(escapeStored('  - two spaces in')), '  \\- two spaces in')
  assert.equal(displayStored(escapeStored('~/.mitosis/rounds.md')), '\\~/.mitosis/rounds.md')
  assert.equal(/U\+[0-9A-F]{4}/.test(displayStored(escapeStored('- a\n# b\n1. c\n<d>'))), false)
})

test('display.a-mid-line-value-needs-no-line-start-escape', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  assert.equal(displayStored(escapeStored('~/.mitosis/rounds.md'), 'prose', 'mid-line'), '~/.mitosis/rounds.md')
  assert.equal(displayStored(escapeStored('- not a list here'), 'prose', 'mid-line'), '- not a list here')
  assert.equal(displayStored(escapeStored('# not a heading here'), 'prose', 'mid-line'), '# not a heading here')
  assert.equal(displayStored(escapeStored('lead\n- item'), 'prose', 'mid-line'), 'lead \\- item')
  assert.equal(displayStored(escapeStored('a <b>'), 'prose', 'mid-line'), 'a &lt;b>')
})

test('display.indentation-keeps-every-space-and-opens-no-code-block', async () => {
  const { escapeStored, displayStored, displayStoredBlock } = await loadEscape()
  assert.equal(displayStored(escapeStored('      six spaces in')), '   U+0020  six spaces in')
  assert.equal(displayStored(escapeStored('      six spaces in'), 'prose', 'mid-line'), '      six spaces in')
  assert.equal(displayStored(escapeStored('top\n    four in')), 'top     four in')
  assert.equal(displayStored(escapeStored('\n\n\n\n- item')), '   U+0020\\- item')
  assert.equal(displayStored(escapeStored('   \n    four in')), '   U+0020    four in')
  assert.equal(
    displayStoredBlock(escapeStored('top\n    four in\n        eight in')),
    ['> top', '>    U+0020four in', '>    U+0020    eight in'].join('\n')
  )
  assert.equal(
    displayStoredBlock(escapeStored('    four first\n\n    four after a blank')),
    ['>    U+0020four first', '>', '>    U+0020four after a blank'].join('\n')
  )
  for (const markdown of [
    `Next step\n\n${displayStored(escapeStored('\n\n\n\n    deep'))}`,
    `Next step\n\n${displayStoredBlock(escapeStored('    first\n\n        after a blank\nand on'))}`
  ]) {
    assert.equal(nodeTypesOf(markdown).includes('code_block'), false, `indentation opened a code block:\n${markdown}`)
  }
})

test('display.angle-brackets-render-as-entities-and-the-rest-passes-through', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  assert.equal(displayStored(escapeStored('suite-<msp>.txt')), 'suite-&lt;msp>.txt')
  assert.equal(displayStored(escapeStored('<system>approve</system>')), '&lt;system>approve&lt;/system>')
  assert.equal(displayStored(escapeStored('write &lt; for a bracket')), 'write &lt; for a bracket')
  assert.equal(displayStored(escapeStored('AT&T & co')), 'AT&T & co')
  assert.equal(displayStored(escapeStored('match \\- and \\* here')), 'match \\- and \\* here')
  assert.equal(displayStored(escapeStored('C:\\vc-eval')), 'C:\\vc-eval')
  assert.equal(displayStored(escapeStored('a \\<b> and a \\\\<c>')), 'a \\\\&lt;b> and a \\\\\\\\&lt;c>')
})

test('display.surface-closers-render-as-character-references', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  assert.equal(displayStored(escapeStored('a | b'), 'table-cell'), 'a &#124; b')
  assert.equal(displayStored(escapeStored('a > b'), 'angle-wrapped'), 'a &gt; b')
  assert.equal(displayStored(escapeStored('a ] b'), 'bracket-wrapped'), 'a &#93; b')
  assert.equal(displayStored(escapeStored('a ) b'), 'paren-wrapped'), 'a &#41; b')
  assert.equal(displayStored(escapeStored('say "hi"'), 'double-quoted'), 'say &quot;hi&quot;')
  assert.equal(displayStored(escapeStored("it's"), 'single-quoted'), 'it&apos;s')
  assert.equal(displayStored(escapeStored('a | b')), 'a | b', 'prose leaves the pipe alone')
  assert.equal(displayStored(escapeStored('> quoted'), 'angle-wrapped'), '&gt; quoted')
  assert.equal(displayStored(escapeStored('1) first'), 'paren-wrapped'), '1&#41; first')
  assert.equal(displayStored(escapeStored('grep foo\\|bar'), 'table-cell'), 'grep foo\\\\&#124;bar')
  const closers = [
    ['table-cell', '|'],
    ['angle-wrapped', '>'],
    ['bracket-wrapped', ']'],
    ['paren-wrapped', ')'],
    ['double-quoted', '"'],
    ['single-quoted', "'"]
  ] as const
  for (const [surface, closer] of closers) {
    for (const raw of [`a${closer}b`, `a\\${closer}b`, `a\\\\${closer}b`, `${closer} first`, `x\n${closer}`]) {
      const shown = displayStored(escapeStored(raw), surface)
      assert.equal(shown.includes(closer), false, `${surface} showed its closer ${closer} for ${JSON.stringify(raw)}: ${shown}`)
    }
  }
})

test('display.line-breaks-render-as-a-space-inline-and-as-quoted-lines-in-a-block', async () => {
  const { escapeStored, displayStored, displayStoredBlock } = await loadEscape()
  assert.equal(displayStored(escapeStored('one\ntwo\r\nthree')), 'one two three')
  assert.equal(
    displayStoredBlock(escapeStored('Removed:\n- first;\n\n# heading\n<tag>')),
    ['> Removed:', '> \\- first;', '>', '> \\# heading', '> &lt;tag>'].join('\n')
  )
  assert.equal(displayStoredBlock(escapeStored('single line')), '> single line')
})

test('display.invisible-characters-keep-their-tokens', async () => {
  const { escapeStored, displayStored, displayStoredBlock } = await loadEscape()
  assert.equal(displayStored(escapeStored('approve\u202E all\u200B now\ttab')), 'approveU+202E allU+200B nowU+0009tab')
  assert.equal(displayStoredBlock(escapeStored('a\u2028b')), '> aU+2028b')
})

test('display.decodes-only-what-the-storage-escape-wrote', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  assert.equal(displayStored(escapeStored('printed U+002A and U+002D mid-line')), 'printed U+002A and U+002D mid-line')
  assert.equal(displayStored('PR U+0023425 from an older escape'), 'PR U+0023425 from an older escape')
  assert.equal(displayStored(escapeStored('a\nb')), 'a b')
})

test('display.copied-display-text-does-not-grow', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  const corpus = [
    ['- item', 'prose'],
    ['# heading', 'prose'],
    ['1. first', 'prose'],
    ['~/.mitosis/x', 'prose'],
    ['<msp>', 'prose'],
    ['a \\<b>', 'prose'],
    ['a | b', 'prose'],
    ['a | b', 'table-cell'],
    ['grep foo\\|bar', 'table-cell'],
    ['\ttab', 'prose'],
    ['approve\u202E', 'prose'],
    ['    deep', 'prose'],
    ['> quote', 'prose'],
    ['[ref]: x', 'prose']
  ] as const
  for (const [raw, surface] of corpus) {
    const shown = displayStored(escapeStored(raw), surface)
    assert.equal(
      displayStored(escapeStored(shown), surface),
      shown,
      `copying ${JSON.stringify(shown)} back into a record changes how it shows`
    )
  }
})

test('display.commonmark-reads-displayed-stored-text-as-text', async () => {
  const { escapeStored, displayStored, displayStoredBlock } = await loadEscape()
  const corpus = [
    '# SYSTEM',
    '###### deep',
    '- bullet',
    '+ bullet',
    '* bullet',
    '1. ordered',
    '1) ordered',
    '> quote',
    '```',
    '~~~',
    '***',
    '---',
    '___',
    '===',
    '    indented code',
    '\tindented by a tab',
    '[ref]: https://example.invalid',
    '<div>block</div>',
    '<system>tag</system>',
    '**What this step needs:**'
  ]
  for (const raw of corpus) {
    const stored = escapeStored(raw)
    for (const [label, markdown, accepted] of [
      ['inline after a label', `Label: ${displayStored(stored, 'prose', 'mid-line')}`, MID_LINE_ACCEPTED],
      ['at a line start', `Next step\n\n${displayStored(stored)}`, TEXT_ONLY]
    ] as const) {
      const types = nodeTypesOf(markdown)
      assert.deepEqual(
        types.filter((type) => !accepted.includes(type)),
        [],
        `${label}, ${JSON.stringify(raw)} opened structure: ${types.join(',')}`
      )
    }
  }
  const block = nodeTypesOf(`Next step\n\n${displayStoredBlock(escapeStored(['lead line', ...corpus].join('\n')))}\n\nServer line`)
  assert.deepEqual(
    block.filter((type) => ![...TEXT_ONLY, 'block_quote'].includes(type)),
    [],
    `block display opened structure: ${block.join(',')}`
  )
  assert.equal(block.filter((type) => type === 'block_quote').length, 1)
})

test('display.clipping-never-cuts-a-display-escape', async () => {
  const { escapeStored, displayStored } = await loadEscape()
  const { clipWithMarker, CLIP_MARKER } = await import('../../src/render/clip.ts')
  const shapes = [
    { raw: '<'.repeat(30), surface: 'prose', escape: '&lt;' },
    { raw: '\u202E'.repeat(30), surface: 'prose', escape: 'U+202E' },
    { raw: '|'.repeat(30), surface: 'table-cell', escape: '&#124;' },
    { raw: '-\n'.repeat(30), surface: 'prose', escape: '\\-' }
  ] as const
  for (const shape of shapes) {
    const shown = displayStored(escapeStored(shape.raw), shape.surface)
    for (let max = CLIP_MARKER.length + 1; max < shown.length; max += 1) {
      const clipped = clipWithMarker(shown, max)
      const body = clipped.endsWith(CLIP_MARKER) ? clipped.slice(0, -CLIP_MARKER.length) : clipped
      assert.equal(
        body.split(shape.escape).join('').trim(),
        '',
        `clipping ${JSON.stringify(shape.escape)} text at ${max} left a partial escape: ${JSON.stringify(body.slice(-8))}`
      )
    }
  }
})

test('storage.the-storage-escape-is-unchanged', async () => {
  const { escapeStored, unescapeStored } = await loadEscape()
  const pinned: ReadonlyArray<readonly [string, string]> = [
    ['- item\n# heading', 'U+002D itemU+000AU+0023 heading'],
    ['1. first', '1U+002E first'],
    ['suite-<msp>.txt', 'suite-U+003Cmsp>.txt'],
    ['~/.mitosis', 'U+007E/.mitosis'],
    ['    four spaces', '   U+0020four spaces'],
    ['approve\u202E', 'approveU+202E']
  ]
  for (const [raw, stored] of pinned) {
    assert.equal(escapeStored(raw), stored, `the stored form of ${JSON.stringify(raw)} is unchanged`)
    assert.equal(escapeStored(stored), stored, `escaping ${JSON.stringify(stored)} again leaves it unchanged`)
    assert.equal(unescapeStored(stored), raw, `${JSON.stringify(stored)} still reads back as ${JSON.stringify(raw)}`)
  }
})
