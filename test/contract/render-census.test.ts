import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import {
  REBUILD_ROOT,
  findNamedImportSymbols,
  forEachDescendant,
  lineOf,
  loadSourceProgram,
  relativeToRoot,
  sourceFileFor
} from '../support/source-census.ts'

const CENSUSED_FILES = [
  'src/render/briefing.ts',
  'src/render/roster.ts',
  'src/server/resource-render.ts',
  'src/server/resources.ts',
  'src/cli/session-start.ts',
  'src/domain/lifecycle.ts',
  'src/server/prompts.ts'
] as const

const ESCAPE_MODULE_SPECIFIERS = [
  './escape.ts',
  '../render/escape.ts',
  '../../render/escape.ts',
  './clip.ts',
  '../render/clip.ts',
  '../../render/clip.ts'
]
const ESCAPE_FUNCTION = 'escapeStored'
const CLIP_FUNCTION = 'clipGraphemes'
const MARKER_CLIP_FUNCTION = 'clipWithMarker'
const WRAPPING_CLIP_FUNCTIONS = new Set([CLIP_FUNCTION, MARKER_CLIP_FUNCTION])
const ITERATION_CALLBACK_NAMES = new Set(['map', 'flatMap', 'filter', 'forEach', 'find'])
const ARRAY_PRODUCING_NAMES = new Set(['map', 'flatMap'])
const JOIN_METHOD = 'join'
const MAX_RESOLUTION_DEPTH = 12

type SiteClass = 'escaped' | 'server-authored' | 'unclassifiable'

type Site = { file: string; line: number; expression: string; classification: SiteClass }

type Ctx = { checker: ts.TypeChecker; sourceFile: ts.SourceFile; escapeSymbols: Map<ts.Symbol, string> }

const contextFor = (checker: ts.TypeChecker, sourceFile: ts.SourceFile): Ctx => ({
  checker,
  sourceFile,
  escapeSymbols: findNamedImportSymbols(checker, sourceFile, ESCAPE_MODULE_SPECIFIERS, [
    ESCAPE_FUNCTION,
    CLIP_FUNCTION,
    MARKER_CLIP_FUNCTION
  ])
})

const unwrap = (node: ts.Node): ts.Node => {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

const typeIsStringLike = (type: ts.Type): boolean => {
  if (type.isUnion()) return type.types.some(typeIsStringLike)
  return (type.flags & ts.TypeFlags.StringLike) !== 0
}

const typeIsNumericOrBoolean = (type: ts.Type): boolean => {
  if (type.isUnion()) return type.types.every(typeIsNumericOrBoolean)
  return (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.BooleanLike)) !== 0
}

const isLiteralTextNode = (node: ts.Node): boolean =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)

const isStringConcat = (ctx: Ctx, node: ts.BinaryExpression): boolean => {
  if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false
  if (isLiteralTextNode(unwrap(node.left)) || isLiteralTextNode(unwrap(node.right))) return true
  if (typeIsStringLike(ctx.checker.getTypeAtLocation(node.left))) return true
  if (typeIsStringLike(ctx.checker.getTypeAtLocation(node.right))) return true
  return typeIsStringLike(ctx.checker.getTypeAtLocation(node))
}

const escapeCallName = (ctx: Ctx, node: ts.Node): string | null => {
  if (!ts.isCallExpression(node)) return null
  const callee = unwrap(node.expression)
  if (!ts.isIdentifier(callee)) return null
  const symbol = ctx.checker.getSymbolAtLocation(callee)
  if (symbol === undefined) return null
  return ctx.escapeSymbols.get(symbol) ?? null
}

const declaredInSameFile = (ctx: Ctx, declaration: ts.Declaration): boolean =>
  declaration.getSourceFile() === ctx.sourceFile

const symbolDeclarations = (ctx: Ctx, node: ts.Node): readonly ts.Declaration[] | null => {
  const symbol = ctx.checker.getSymbolAtLocation(node)
  if (symbol === undefined) return null
  const declarations = symbol.declarations
  if (declarations === undefined || declarations.length === 0) return null
  return declarations
}

const returnExpressionsOf = (body: ts.Node): ts.Expression[] | null => {
  if (!ts.isBlock(body)) return ts.isExpression(body) ? [body] : null
  const collected: ts.Expression[] = []
  let bailed = false
  forEachDescendant(body, (node) => {
    if (!ts.isReturnStatement(node)) return
    if (node.expression === undefined) {
      bailed = true
      return
    }
    collected.push(node.expression)
  })
  if (bailed || collected.length === 0) return null
  return collected
}

const calleeBody = (ctx: Ctx, callee: ts.Node): ts.Node | null => {
  const declarations = symbolDeclarations(ctx, callee)
  if (declarations === null) return null
  const declaration = declarations[0]
  if (declaration === undefined || !declaredInSameFile(ctx, declaration)) return null
  if (ts.isFunctionDeclaration(declaration)) return declaration.body ?? null
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return null
  const initializer = unwrap(declaration.initializer)
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer.body
  return null
}

const iterationReceiver = (parameter: ts.ParameterDeclaration): ts.Expression | null => {
  const callback = parameter.parent
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null
  if (callback.parameters[0] !== parameter) return null
  const call = callback.parent
  if (!ts.isCallExpression(call) || call.arguments[0] !== callback) return null
  const callee = unwrap(call.expression)
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (!ITERATION_CALLBACK_NAMES.has(callee.name.text)) return null
  return callee.expression
}

const callbackBody = (ctx: Ctx, callback: ts.Expression): ts.Node | null => {
  const current = unwrap(callback)
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return current.body
  return calleeBody(ctx, current)
}

const mappedReturnExpressions = (ctx: Ctx, call: ts.CallExpression): ts.Expression[] | null => {
  const callee = unwrap(call.expression)
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (!ARRAY_PRODUCING_NAMES.has(callee.name.text)) return null
  const callback = call.arguments[0]
  if (callback === undefined) return null
  const body = callbackBody(ctx, callback)
  if (body === null) return null
  return returnExpressionsOf(body)
}

const arrayProducerElements = (ctx: Ctx, expression: ts.Expression, depth: number): ts.Expression[] | null => {
  if (depth > MAX_RESOLUTION_DEPTH) return null
  const current = unwrap(expression)

  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.flatMap((element) => {
      if (!ts.isSpreadElement(element)) return [element]
      return arrayProducerElements(ctx, element.expression, depth + 1) ?? [element]
    })
  }

  if (ts.isCallExpression(current)) return mappedReturnExpressions(ctx, current)

  if (ts.isIdentifier(current)) {
    const declarations = symbolDeclarations(ctx, current)
    if (declarations === null) return null
    const declaration = declarations[0]
    if (declaration === undefined || !declaredInSameFile(ctx, declaration)) return null
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return null
    return arrayProducerElements(ctx, declaration.initializer, depth + 1)
  }

  return null
}

const joinedElements = (ctx: Ctx, node: ts.Node, depth: number): ts.Expression[] | null => {
  if (!ts.isCallExpression(node)) return null
  const callee = unwrap(node.expression)
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (callee.name.text !== JOIN_METHOD) return null
  return arrayProducerElements(ctx, callee.expression, depth)
}

const resolveTerminals = (ctx: Ctx, node: ts.Node, depth: number): ts.Expression[] | null => {
  if (depth > MAX_RESOLUTION_DEPTH) return null
  const current = unwrap(node)

  if (ts.isConditionalExpression(current)) {
    const whenTrue = resolveTerminals(ctx, current.whenTrue, depth + 1)
    const whenFalse = resolveTerminals(ctx, current.whenFalse, depth + 1)
    if (whenTrue === null || whenFalse === null) return null
    return [...whenTrue, ...whenFalse]
  }

  if (ts.isBinaryExpression(current)) {
    const operator = current.operatorToken.kind
    const isChoice =
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.PlusToken
    if (!isChoice) return null
    const left = resolveTerminals(ctx, current.left, depth + 1)
    const right = resolveTerminals(ctx, current.right, depth + 1)
    if (left === null || right === null) return null
    return [...left, ...right]
  }

  if (ts.isIdentifier(current)) {
    const declarations = symbolDeclarations(ctx, current)
    if (declarations === null) return null
    const declaration = declarations[0]
    if (declaration === undefined || !declaredInSameFile(ctx, declaration)) return null
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      return resolveTerminals(ctx, declaration.initializer, depth + 1)
    }
    if (ts.isParameter(declaration)) {
      const receiver = iterationReceiver(declaration)
      if (receiver === null) return null
      const receiverTerminals = resolveTerminals(ctx, receiver, depth + 1)
      if (receiverTerminals === null) return null
      const elements: ts.Expression[] = []
      for (const terminal of receiverTerminals) {
        if (!ts.isArrayLiteralExpression(terminal)) return null
        for (const element of terminal.elements) {
          const resolved = resolveTerminals(ctx, element, depth + 1)
          if (resolved === null) return null
          elements.push(...resolved)
        }
      }
      return elements.length === 0 ? null : elements
    }
    return null
  }

  if (ts.isPropertyAccessExpression(current)) {
    const objectTerminals = resolveTerminals(ctx, current.expression, depth + 1)
    if (objectTerminals === null) return null
    const values: ts.Expression[] = []
    for (const terminal of objectTerminals) {
      if (!ts.isObjectLiteralExpression(terminal)) return null
      const property = terminal.properties.find(
        (candidate) =>
          ts.isPropertyAssignment(candidate) &&
          (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
          candidate.name.text === current.name.text
      )
      if (property === undefined || !ts.isPropertyAssignment(property)) return null
      const resolved = resolveTerminals(ctx, property.initializer, depth + 1)
      if (resolved === null) return null
      values.push(...resolved)
    }
    return values.length === 0 ? null : values
  }

  if (ts.isCallExpression(current)) {
    if (escapeCallName(ctx, current) !== null) return [current]
    if (joinedElements(ctx, current, depth + 1) !== null) return [current]
    const body = calleeBody(ctx, unwrap(current.expression))
    if (body === null) return null
    const returns = returnExpressionsOf(body)
    if (returns === null) return null
    const values: ts.Expression[] = []
    for (const returned of returns) {
      const resolved = resolveTerminals(ctx, returned, depth + 1)
      if (resolved === null) return null
      values.push(...resolved)
    }
    return values.length === 0 ? null : values
  }

  if (ts.isExpression(current)) return [current]
  return null
}

const isEscapedCall = (ctx: Ctx, node: ts.Node, depth: number): boolean => {
  const called = escapeCallName(ctx, node)
  if (called === ESCAPE_FUNCTION) return true
  if (called === null || !WRAPPING_CLIP_FUNCTIONS.has(called) || !ts.isCallExpression(node)) return false
  const wrapped = node.arguments[0]
  return wrapped !== undefined && classifyExpression(ctx, wrapped, depth + 1) === 'escaped'
}

const isServerAuthoredTerminal = (ctx: Ctx, node: ts.Expression, depth: number): boolean => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return true
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true
  if (isEscapedCall(ctx, node, depth)) return true
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.every((span) => classifyExpression(ctx, span.expression, depth + 1) !== 'unclassifiable')
  }
  const elements = joinedElements(ctx, node, depth + 1)
  if (elements !== null) {
    return elements.every((element) => classifyExpression(ctx, element, depth + 1) !== 'unclassifiable')
  }
  return typeIsNumericOrBoolean(ctx.checker.getTypeAtLocation(node))
}

const isServerAuthored = (ctx: Ctx, node: ts.Node, depth: number): boolean => {
  const current = unwrap(node)
  if (!ts.isExpression(current)) return false
  if (typeIsNumericOrBoolean(ctx.checker.getTypeAtLocation(current))) return true
  const terminals = resolveTerminals(ctx, current, depth)
  if (terminals === null || terminals.length === 0) return false
  return terminals.every((terminal) => isServerAuthoredTerminal(ctx, terminal, depth + 1))
}

const classifyExpression = (ctx: Ctx, expression: ts.Expression, depth: number): SiteClass => {
  if (depth > MAX_RESOLUTION_DEPTH) return 'unclassifiable'
  const current = unwrap(expression)
  if (isEscapedCall(ctx, current, depth)) return 'escaped'
  return isServerAuthored(ctx, current, depth) ? 'server-authored' : 'unclassifiable'
}

const siteFor = (ctx: Ctx, file: string, expression: ts.Expression): Site => ({
  file,
  line: lineOf(ctx.sourceFile, expression),
  expression: expression.getText(ctx.sourceFile),
  classification: classifyExpression(ctx, expression, 0)
})

const templateSites = (ctx: Ctx, file: string, node: ts.TemplateExpression): Site[] =>
  node.templateSpans.flatMap((span) =>
    ts.isTemplateExpression(unwrap(span.expression)) ? [] : [siteFor(ctx, file, span.expression)]
  )

const concatSites = (ctx: Ctx, file: string, node: ts.BinaryExpression): Site[] =>
  [node.left, node.right].flatMap((operand) => {
    const inner = unwrap(operand)
    if (isLiteralTextNode(inner)) return []
    if (ts.isBinaryExpression(inner) && isStringConcat(ctx, inner)) return []
    return [siteFor(ctx, file, operand)]
  })

const collectedByAnotherSite = (ctx: Ctx, node: ts.Node): boolean => {
  if (isLiteralTextNode(node)) return true
  if (ts.isBinaryExpression(node) && isStringConcat(ctx, node)) return true
  return joinedElements(ctx, node, 0) !== null
}

const joinSites = (ctx: Ctx, file: string, elements: readonly ts.Expression[]): Site[] =>
  elements.flatMap((element) =>
    collectedByAnotherSite(ctx, unwrap(element)) ? [] : [siteFor(ctx, file, element)]
  )

const collectSites = (ctx: Ctx, file: string): Site[] => {
  const found: Site[][] = []
  forEachDescendant(ctx.sourceFile, (node) => {
    if (ts.isTemplateExpression(node)) {
      found.push(templateSites(ctx, file, node))
      return
    }
    if (ts.isBinaryExpression(node) && isStringConcat(ctx, node)) {
      found.push(concatSites(ctx, file, node))
      return
    }
    const elements = joinedElements(ctx, node, 0)
    if (elements !== null) {
      found.push(joinSites(ctx, file, elements))
    }
  })
  return found.flat()
}

export const classifySite = (site: Site): Classified<Site>['verdict'] | 'unclassifiable' => {
  if (site.classification === 'escaped') return 'allowed'
  if (site.classification === 'server-authored') return 'allowed'
  return 'unclassifiable'
}

const describeSite = (site: Site): string => `${site.file}:${site.line} ${site.expression}`

const renderBypasses = (population: readonly Site[]): string => {
  const bypasses = population.filter((site) => site.classification === 'unclassifiable')
  return [
    `render.no-unescaped-site: ${bypasses.length} of ${population.length} interpolation sites reach the model unescaped`,
    ...bypasses.map(describeSite)
  ].join('\n')
}

const sitesForCensusedFile = (
  program: ts.Program,
  checker: ts.TypeChecker,
  byRelativePath: ReadonlyMap<string, string>,
  censused: string
): Site[] => {
  const relative = censused.split('/').join(path.sep)
  const absolute = byRelativePath.get(relative)
  assert.ok(
    absolute !== undefined,
    `render.no-unescaped-site: ${censused} is not in the compiled production partition; the censused set drifted from the program`
  )
  const ctx = contextFor(checker, sourceFileFor(program, absolute))
  const sites = collectSites(ctx, relative)
  assert.ok(
    sites.length > 0,
    `render.no-unescaped-site: ${censused} yielded zero interpolation sites; the collector silently dropped a censused file`
  )
  if (ctx.escapeSymbols.size > 0) {
    assert.ok(
      sites.some((site) => site.classification === 'escaped'),
      `render.no-unescaped-site: ${censused} imports ${ESCAPE_FUNCTION} yet no site classified as escaped; the escape resolver is broken`
    )
  }
  return sites
}

const SYNTHETIC_DIR = path.join(REBUILD_ROOT, 'test', 'render-census-virtual')
const SYNTHETIC_MODULE_PATH = path.join(SYNTHETIC_DIR, 'synthetic.ts')
const SYNTHETIC_ESCAPE_PATH = path.join(SYNTHETIC_DIR, 'escape.ts')
const SYNTHETIC_OFFENDING_EXPRESSION = 'payload.rawTitle'

const SYNTHETIC_ESCAPE_SOURCE = [
  'export const escapeStored = (text: string): string => text',
  'export const clipGraphemes = (text: string, max: number): string => text.slice(0, max)',
  'export const clipWithMarker = (text: string, max: number): string => text.slice(0, max)',
  ''
].join('\n')

const SYNTHETIC_MODULE_SOURCE = [
  "import { escapeStored, clipGraphemes, clipWithMarker } from './escape.ts'",
  '',
  "const BANNER = 'Synthetic'",
  '',
  'type Payload = { rawTitle: string; safeTitle: string; count: number }',
  '',
  'export const renderSynthetic = (payload: Payload): string =>',
  '  [',
  '    `${BANNER}: ${clipGraphemes(escapeStored(payload.safeTitle), 40)}`,',
  '    `Count: ${payload.count}`,',
  '    `Title: ${payload.rawTitle}`,',
  '    `Shortened: ${clipWithMarker(escapeStored(payload.safeTitle), 40)}`,',
  '    `ShortenedRaw: ${clipWithMarker(payload.rawTitle, 40)}`',
  "  ].join('\\n')",
  ''
].join('\n')

const SYNTHETIC_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  allowImportingTsExtensions: true,
  noEmit: true
}

const buildSyntheticContext = (): Ctx => {
  const files = new Map([
    [SYNTHETIC_MODULE_PATH, SYNTHETIC_MODULE_SOURCE],
    [SYNTHETIC_ESCAPE_PATH, SYNTHETIC_ESCAPE_SOURCE]
  ])
  const base = ts.createCompilerHost(SYNTHETIC_OPTIONS, true)
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (fileName) => files.has(fileName) || base.fileExists(fileName),
    directoryExists: (directoryName) =>
      directoryName === SYNTHETIC_DIR || (base.directoryExists?.(directoryName) ?? false),
    readFile: (fileName) => files.get(fileName) ?? base.readFile(fileName),
    getSourceFile: (fileName, options, onError, shouldCreate) => {
      const contents = files.get(fileName)
      if (contents === undefined) return base.getSourceFile(fileName, options, onError, shouldCreate)
      return ts.createSourceFile(fileName, contents, options, true)
    }
  }
  const program = ts.createProgram({ rootNames: [SYNTHETIC_MODULE_PATH], options: SYNTHETIC_OPTIONS, host })
  const sourceFile = program.getSourceFile(SYNTHETIC_MODULE_PATH)
  if (sourceFile === undefined) {
    throw new Error(`buildSyntheticContext: the in-memory module ${SYNTHETIC_MODULE_PATH} did not enter the program`)
  }
  const syntactic = program.getSyntacticDiagnostics(sourceFile)
  if (syntactic.length > 0) {
    const rendered = syntactic
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')
    throw new Error(`buildSyntheticContext: the in-memory module failed to parse: ${rendered}`)
  }
  return contextFor(program.getTypeChecker(), sourceFile)
}

test('render.no-unescaped-site', () => {
  const { checker, program, productionFiles } = loadSourceProgram()
  const byRelativePath = new Map(productionFiles.map((file) => [relativeToRoot(file), file]))

  const population = CENSUSED_FILES.flatMap((censused) =>
    sitesForCensusedFile(program, checker, byRelativePath, censused)
  )

  assert.ok(
    population.length > 0,
    'render.no-unescaped-site: the censused files yielded no interpolation sites; a census over an empty population proves nothing'
  )

  assert.doesNotThrow(() => census(population, classifySite), renderBypasses(population))
})

test('render.no-unescaped-site.names-the-module-and-the-expression-it-halted-on', () => {
  const ctx = buildSyntheticContext()
  const sites = collectSites(ctx, SYNTHETIC_MODULE_PATH)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.classification]),
    [
      ['BANNER', 'server-authored'],
      ['clipGraphemes(escapeStored(payload.safeTitle), 40)', 'escaped'],
      ['payload.count', 'server-authored'],
      [SYNTHETIC_OFFENDING_EXPRESSION, 'unclassifiable'],
      ['clipWithMarker(escapeStored(payload.safeTitle), 40)', 'escaped'],
      ['clipWithMarker(payload.rawTitle, 40)', 'unclassifiable']
    ],
    'the synthetic module must expose two unescaped interpolations alongside four classified ones'
  )

  assert.throws(
    () => census(sites, classifySite),
    (error: unknown) => {
      assert.ok(error instanceof Error, 'the census must halt by throwing an Error')
      assert.ok(
        error.message.includes(SYNTHETIC_MODULE_PATH),
        `the halt message must name the module path ${SYNTHETIC_MODULE_PATH}; got: ${error.message}`
      )
      assert.ok(
        error.message.includes(SYNTHETIC_OFFENDING_EXPRESSION),
        `the halt message must name the offending expression ${SYNTHETIC_OFFENDING_EXPRESSION}; got: ${error.message}`
      )
      return true
    }
  )
})
