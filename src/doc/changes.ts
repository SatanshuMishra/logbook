import { parseDocument, type Item, type Letter } from './document.ts'

export type ItemChanges = {
  criteria_added: number
  criteria_ticked: number
  criteria_struck: number
  criteria_reopened: number
  decisions_added: number
  decisions_removed: number
  risks_added: number
  risks_removed: number
  settled_added: number
  settled_removed: number
}

type Box = Item['box']

const firstById = (items: readonly Item[]): Map<string, Item> =>
  new Map([...items].reverse().map((item) => [item.id, item] as const))

const idsOf = (items: ReadonlyMap<string, Item>, letter: Letter): Set<string> =>
  new Set([...items.values()].filter((item) => item.letter === letter).map((item) => item.id))

const missingFrom = (from: ReadonlySet<string>, other: ReadonlySet<string>): number =>
  [...from].filter((id) => !other.has(id)).length

const boxMoves = (
  before: ReadonlyMap<string, Item>,
  after: ReadonlyMap<string, Item>,
  moved: (from: Box, to: Box) => boolean
): number =>
  [...before.values()].filter((item) => {
    const changed = after.get(item.id)
    return item.letter === 'c' && changed !== undefined && moved(item.box, changed.box)
  }).length

export const itemChanges = (previousText: string, newText: string): ItemChanges => {
  const before = firstById(parseDocument(previousText).items)
  const after = firstById(parseDocument(newText).items)
  const added = (letter: Letter): number => missingFrom(idsOf(after, letter), idsOf(before, letter))
  const removed = (letter: Letter): number => missingFrom(idsOf(before, letter), idsOf(after, letter))
  return {
    criteria_added: added('c'),
    criteria_ticked: boxMoves(before, after, (from, to) => from !== 'x' && to === 'x'),
    criteria_struck: boxMoves(before, after, (from, to) => from !== '~' && to === '~'),
    criteria_reopened: boxMoves(before, after, (from, to) => (from === 'x' || from === '~') && to === ' '),
    decisions_added: added('D'),
    decisions_removed: removed('D'),
    risks_added: added('R'),
    risks_removed: removed('R'),
    settled_added: added('S'),
    settled_removed: removed('S')
  }
}
