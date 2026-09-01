declare module 'commonmark' {
  export type NodeWalkerEvent = { entering: boolean; node: Node }

  export type NodeWalker = {
    next(): NodeWalkerEvent | null
  }

  export class Node {
    readonly type: string
    readonly literal: string | null
    walker(): NodeWalker
  }

  export class Parser {
    constructor()
    parse(markdown: string): Node
  }
}
