import path from 'node:path'
import * as ts from 'typescript'
import type { Classified } from './census.ts'
import {
  findNamedImportSymbols,
  findNamespaceImportSymbols,
  forEachDescendant,
  lineOf,
  loadSourceProgram,
  relativeToRoot,
  sourceFileFor
} from './source-census.ts'

export const SEED_FILE = 'src/render/briefing.ts'
export const HELPER_NAME = 'criterionSettledness'
export const SETTLEDNESS_FIELD = 'settledness'
const SOURCE_ROOT_PREFIX = 'src/'

const REDUCING_METHODS = new Set(['reduce', 'reduceRight', 'some', 'every'])
const SELECTING_METHODS = new Set(['filter', 'map', 'flatMap'])
const MAPPING_METHODS = new Set(['map', 'flatMap'])

const NUMERIC_COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken
])

const ARITHMETIC_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken
])

export const halt = (detail: string): never => {
  throw new Error(`resume-path settledness census: ${detail}`)
}

const toPosix = (relative: string): string => relative.split(path.sep).join('/')

export type ImportEdge = { from: string; target: string; typeOnly: boolean }

export type ReadMechanism =
  | 'helper-call'
  | 'helper-reference'
  | 'property-access'
  | 'element-access'
  | 'destructured-field'

export type SettlednessUse =
  | 'per-criterion-read'
  | 'per-criterion-render'
  | 'conditional-inclusion'
  | 'reduction'
  | 'count'
  | 'recursive-read'
  | 'arithmetic-read'
  | 'iterated-read'
  | 'undemonstrated-read'
  | 'unrecognised-collection-use'

export type SettlednessSite = {
  file: string
  line: number
  expression: string
  mechanism: ReadMechanism
  use: SettlednessUse
}

type Consumption = 'length' | 'reducing-method' | 'numeric-comparison' | 'spread' | 'statement' | 'other'

type Denial = 'recursive-read' | 'arithmetic-read' | 'iterated-read'

type EnclosingFunction = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration

type CallbackSite = { call: ts.CallExpression; callback: ts.Node }

const COUNTING_CONSUMPTIONS = new Set<Consumption>(['length', 'reducing-method', 'numeric-comparison'])

const PER_CRITERION_CONSUMPTIONS = new Set<Consumption>(['spread', 'statement'])

const DEMONSTRATED_PER_CRITERION_USES = new Set<SettlednessUse>([
  'per-criterion-read',
  'per-criterion-render',
  'conditional-inclusion'
])

const DEMONSTRATED_AGGREGATE_USES = new Set<SettlednessUse>(['reduction', 'count'])

export const classifySettlednessSite = (
  site: SettlednessSite
): Classified<SettlednessSite>['verdict'] | 'unclassifiable' => {
  if (DEMONSTRATED_PER_CRITERION_USES.has(site.use)) return 'allowed'
  if (DEMONSTRATED_AGGREGATE_USES.has(site.use)) return 'forbidden'
  return 'unclassifiable'
}

const enclosingCallback = (node: ts.Node): CallbackSite | null => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return null
  const isCallback = ts.isArrowFunction(node) || ts.isFunctionExpression(node)
  if (isCallback && ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === node)) {
    return { call: parent, callback: node }
  }
  return enclosingCallback(parent)
}

const enclosingFunctionOf = (node: ts.Node): EnclosingFunction | null => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return null
  if (
    ts.isArrowFunction(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isMethodDeclaration(parent)
  ) {
    return parent
  }
  return enclosingFunctionOf(parent)
}

const parameterOwnedBy = (checker: ts.TypeChecker, identifier: ts.Identifier, owner: EnclosingFunction): boolean => {
  const symbol = checker.getSymbolAtLocation(identifier)
  if (symbol === undefined) return false
  const declarations = symbol.declarations
  if (declarations === undefined) return false
  return declarations.some((declaration) => ts.isParameter(declaration) && declaration.parent === owner)
}

const declaredNameSymbol = (checker: ts.TypeChecker, owner: EnclosingFunction): ts.Symbol | null => {
  if (ts.isFunctionDeclaration(owner)) {
    const name = owner.name
    return name === undefined ? null : (checker.getSymbolAtLocation(name) ?? null)
  }
  const parent: ts.Node | undefined = owner.parent
  if (parent === undefined || !ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) return null
  return checker.getSymbolAtLocation(parent.name) ?? null
}

const isSelfRecursive = (checker: ts.TypeChecker, owner: EnclosingFunction): boolean => {
  const own = declaredNameSymbol(checker, owner)
  if (own === null) return false
  const found: ts.CallExpression[] = []
  forEachDescendant(owner, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    if (checker.getSymbolAtLocation(node.expression) === own) found.push(node)
  })
  return found.length > 0
}

const flowsIntoArithmetic = (node: ts.Node): boolean => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return false
  if (ts.isParenthesizedExpression(parent)) return flowsIntoArithmetic(parent)
  if (ts.isConditionalExpression(parent)) return flowsIntoArithmetic(parent)
  if (ts.isBinaryExpression(parent)) {
    if (ARITHMETIC_OPERATORS.has(parent.operatorToken.kind)) return true
    if (NUMERIC_COMPARISON_OPERATORS.has(parent.operatorToken.kind)) return flowsIntoArithmetic(parent)
    return false
  }
  return false
}

const insideIterationStatement = (node: ts.Node): boolean => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return false
  if (ts.isIterationStatement(parent, false)) return true
  return insideIterationStatement(parent)
}

const containsIterationStatement = (node: ts.Node): boolean => {
  const found: ts.Node[] = []
  forEachDescendant(node, (candidate) => {
    if (ts.isIterationStatement(candidate, false)) found.push(candidate)
  })
  return found.length > 0
}

const denialOf = (checker: ts.TypeChecker, node: ts.Node): Denial | null => {
  const owner = enclosingFunctionOf(node)
  if (owner !== null && isSelfRecursive(checker, owner)) return 'recursive-read'
  if (flowsIntoArithmetic(node)) return 'arithmetic-read'
  if (insideIterationStatement(node)) return 'iterated-read'
  return null
}

const consumptionOf = (node: ts.Node): Consumption => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return 'other'
  if (ts.isParenthesizedExpression(parent)) return consumptionOf(parent)
  if (ts.isSpreadElement(parent)) return 'spread'
  if (ts.isExpressionStatement(parent)) return 'statement'
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const name = parent.name.text
    if (name === 'length') return 'length'
    if (REDUCING_METHODS.has(name)) return 'reducing-method'
    const grandparent: ts.Node | undefined = parent.parent
    if (grandparent !== undefined && ts.isCallExpression(grandparent) && grandparent.expression === parent) {
      return consumptionOf(grandparent)
    }
    return 'other'
  }
  if (ts.isBinaryExpression(parent) && NUMERIC_COMPARISON_OPERATORS.has(parent.operatorToken.kind)) {
    const other = parent.left === node ? parent.right : parent.left
    return ts.isNumericLiteral(other) ? 'numeric-comparison' : 'other'
  }
  return 'other'
}

const isSingleValueArrayLiteral = (node: ts.Expression): node is ts.ArrayLiteralExpression =>
  ts.isArrayLiteralExpression(node) &&
  node.elements.length === 1 &&
  node.elements.every((element) => !ts.isSpreadElement(element))

const subjectOf = (node: ts.Node, mechanism: ReadMechanism): ts.Identifier | null => {
  if (mechanism === 'helper-call' && ts.isCallExpression(node)) {
    const [only, ...rest] = node.arguments
    if (only === undefined || rest.length > 0) return null
    return ts.isIdentifier(only) ? only : null
  }
  if (mechanism === 'property-access' && ts.isPropertyAccessExpression(node)) {
    return ts.isIdentifier(node.expression) ? node.expression : null
  }
  if (mechanism === 'element-access' && ts.isElementAccessExpression(node)) {
    return ts.isIdentifier(node.expression) ? node.expression : null
  }
  if (mechanism === 'destructured-field' && ts.isBindingElement(node)) {
    const declaration: ts.Node = node.parent.parent
    if (!ts.isVariableDeclaration(declaration)) return null
    const initializer = declaration.initializer
    if (initializer === undefined || !ts.isIdentifier(initializer)) return null
    return initializer
  }
  return null
}

const isRecognisedArrayMethodCall = (call: ts.CallExpression): boolean => {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  const method = callee.name.text
  return REDUCING_METHODS.has(method) || SELECTING_METHODS.has(method)
}

const argumentHostOf = (node: ts.Node): ts.CallExpression | null => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return null
  if (ts.isParenthesizedExpression(parent)) return argumentHostOf(parent)
  if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === node)) return parent
  return null
}

const usePointFreeReference = (node: ts.Node): SettlednessUse => {
  const host = argumentHostOf(node)
  if (host === null) return 'undemonstrated-read'
  const callee = host.expression
  if (!ts.isPropertyAccessExpression(callee)) return 'undemonstrated-read'
  const method = callee.name.text
  if (REDUCING_METHODS.has(method)) return 'reduction'
  if (SELECTING_METHODS.has(method) && COUNTING_CONSUMPTIONS.has(consumptionOf(host))) return 'count'
  return 'undemonstrated-read'
}

const usePerCriterion = (checker: ts.TypeChecker, node: ts.Node, mechanism: ReadMechanism): SettlednessUse => {
  const host = argumentHostOf(node)
  if (host !== null && !isRecognisedArrayMethodCall(host)) return 'undemonstrated-read'
  const owner = enclosingFunctionOf(node)
  if (owner === null) return 'undemonstrated-read'
  const subject = subjectOf(node, mechanism)
  if (subject === null) return 'undemonstrated-read'
  return parameterOwnedBy(checker, subject, owner) ? 'per-criterion-read' : 'undemonstrated-read'
}

const isConditionalInclusion = (
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  callee: ts.PropertyAccessExpression
): boolean => {
  if (!SELECTING_METHODS.has(callee.name.text)) return false
  const receiver = callee.expression
  if (!isSingleValueArrayLiteral(receiver)) return false
  const element = receiver.elements[0]
  if (element === undefined || !ts.isIdentifier(element)) return false
  const owner = enclosingFunctionOf(call)
  if (owner === null) return false
  if (!parameterOwnedBy(checker, element, owner)) return false
  const callback = call.arguments[0]
  if (callback === undefined) return false
  return !containsIterationStatement(callback)
}

const isPerCriterionRender = (
  checker: ts.TypeChecker,
  node: ts.Node,
  mechanism: ReadMechanism,
  site: CallbackSite,
  method: string
): boolean => {
  if (!MAPPING_METHODS.has(method)) return false
  if (!PER_CRITERION_CONSUMPTIONS.has(consumptionOf(site.call))) return false
  const callback = site.callback
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false
  const subject = subjectOf(node, mechanism)
  if (subject === null) return false
  return parameterOwnedBy(checker, subject, callback)
}

const useInsideCallback = (
  checker: ts.TypeChecker,
  node: ts.Node,
  mechanism: ReadMechanism,
  site: CallbackSite,
  denial: Denial | null
): SettlednessUse => {
  const callee = site.call.expression
  if (!ts.isPropertyAccessExpression(callee)) return denial ?? 'unrecognised-collection-use'
  if (isConditionalInclusion(checker, site.call, callee)) return denial ?? 'conditional-inclusion'
  const method = callee.name.text
  if (REDUCING_METHODS.has(method)) return 'reduction'
  if (SELECTING_METHODS.has(method)) {
    if (COUNTING_CONSUMPTIONS.has(consumptionOf(site.call))) return 'count'
    if (isPerCriterionRender(checker, node, mechanism, site, method)) return denial ?? 'per-criterion-render'
  }
  return denial ?? 'unrecognised-collection-use'
}

export const useOfSettlednessRead = (
  checker: ts.TypeChecker,
  node: ts.Node,
  mechanism: ReadMechanism
): SettlednessUse => {
  if (mechanism === 'helper-reference') return usePointFreeReference(node)
  const denial = denialOf(checker, node)
  const site = enclosingCallback(node)
  if (site === null) return denial ?? usePerCriterion(checker, node, mechanism)
  return useInsideCallback(checker, node, mechanism, site, denial)
}

const declaredHelperSymbol = (checker: ts.TypeChecker, sourceFile: ts.SourceFile): ts.Symbol | null => {
  const found: ts.Symbol[] = []
  forEachDescendant(sourceFile, (node) => {
    const named =
      (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === HELPER_NAME
    if (!named) return
    const name = node.name
    if (name === undefined || !ts.isIdentifier(name)) return
    const symbol = checker.getSymbolAtLocation(name)
    if (symbol !== undefined) found.push(symbol)
  })
  return found[0] ?? null
}

const isSettlednessBinding = (node: ts.BindingElement): boolean => {
  if (!ts.isObjectBindingPattern(node.parent)) return false
  const property = node.propertyName ?? node.name
  return ts.isIdentifier(property) && property.text === SETTLEDNESS_FIELD
}

const namesADeclaration = (node: ts.Identifier): boolean => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return false
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent)) return true
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node
  if (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent)) {
    return parent.name === node
  }
  if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node
  return false
}

const isPointFreeReference = (node: ts.Identifier): boolean => {
  if (namesADeclaration(node)) return false
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return false
  return !(ts.isCallExpression(parent) && parent.expression === node)
}

export const collectSettlednessSites = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  file: string,
  helperSpecifiers: readonly string[]
): SettlednessSite[] => {
  const namedHelperImports = findNamedImportSymbols(checker, sourceFile, helperSpecifiers, [HELPER_NAME])
  const namespaceHelperImports = findNamespaceImportSymbols(checker, sourceFile, helperSpecifiers)
  const localHelper = declaredHelperSymbol(checker, sourceFile)
  const found: SettlednessSite[] = []

  const namesTheHelper = (node: ts.Identifier): boolean => {
    const symbol = checker.getSymbolAtLocation(node)
    if (symbol === undefined) return false
    return namedHelperImports.has(symbol) || (localHelper !== null && symbol === localHelper)
  }

  const record = (node: ts.Node, mechanism: ReadMechanism): void => {
    found.push({
      file,
      line: lineOf(sourceFile, node),
      expression: node.getText(sourceFile),
      mechanism,
      use: useOfSettlednessRead(checker, node, mechanism)
    })
  }

  forEachDescendant(sourceFile, (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === SETTLEDNESS_FIELD) {
      record(node, 'property-access')
      return
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === SETTLEDNESS_FIELD
    ) {
      record(node, 'element-access')
      return
    }
    if (ts.isBindingElement(node) && isSettlednessBinding(node)) {
      record(node, 'destructured-field')
      return
    }
    if (ts.isIdentifier(node) && isPointFreeReference(node) && namesTheHelper(node)) {
      record(node, 'helper-reference')
      return
    }
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    if (ts.isIdentifier(callee)) {
      const symbol = checker.getSymbolAtLocation(callee)
      if (symbol === undefined) return
      if (namedHelperImports.has(symbol) || (localHelper !== null && symbol === localHelper)) {
        record(node, 'helper-call')
      }
      return
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === HELPER_NAME &&
      ts.isIdentifier(callee.expression)
    ) {
      const base = checker.getSymbolAtLocation(callee.expression)
      if (base !== undefined && namespaceHelperImports.has(base)) record(node, 'helper-call')
    }
  })

  return found
}

const importIsTypeOnly = (node: ts.ImportDeclaration): boolean => {
  const clause = node.importClause
  if (clause === undefined) return false
  if (clause.isTypeOnly) return true
  if (clause.name !== undefined) return false
  const bindings = clause.namedBindings
  if (bindings === undefined || !ts.isNamedImports(bindings)) return false
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
}

const exportIsTypeOnly = (node: ts.ExportDeclaration): boolean => {
  if (node.isTypeOnly) return true
  const clause = node.exportClause
  if (clause === undefined || !ts.isNamedExports(clause)) return false
  return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
}

const resolvedTargetOf = (
  program: ts.Program,
  byRelPath: ReadonlyMap<string, string>,
  file: string,
  absolute: string,
  specifier: string,
  line: number
): string | null => {
  if (specifier.startsWith('node:')) return null
  if (specifier.startsWith('.')) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
    if (!byRelPath.has(target)) {
      return halt(
        `${file} line ${line} imports ${specifier}, which resolves to ${target}, and no such file is part of the compiled program, so the forward closure of ${SEED_FILE} cannot tell what that import reaches and the census population would be understated`
      )
    }
    return target
  }
  const resolved = ts.resolveModuleName(specifier, absolute, program.getCompilerOptions(), ts.sys)
  if (resolved.resolvedModule === undefined) {
    return halt(
      `${file} line ${line} imports ${specifier}, which the compiler settings resolve to nothing, so the forward closure of ${SEED_FILE} cannot tell what that import reaches and the census population would be understated`
    )
  }
  return null
}

const edgesOf = (program: ts.Program, byRelPath: ReadonlyMap<string, string>, file: string): ImportEdge[] => {
  const absolute = byRelPath.get(file)
  if (absolute === undefined) {
    return halt(`${file} was reached by the forward closure yet is absent from the compiled program`)
  }
  const sourceFile = sourceFileFor(program, absolute)
  const found: ImportEdge[] = []

  const addEdge = (specifier: ts.Expression, typeOnly: boolean, node: ts.Node): void => {
    if (!ts.isStringLiteral(specifier)) {
      halt(
        `${file} line ${lineOf(sourceFile, node)} names its module with an expression this closure cannot read, so an edge out of ${file} may be missing`
      )
      return
    }
    const target = resolvedTargetOf(program, byRelPath, file, absolute, specifier.text, lineOf(sourceFile, node))
    if (target === null) return
    found.push({ from: file, target, typeOnly })
  }

  forEachDescendant(sourceFile, (node) => {
    if (ts.isImportEqualsDeclaration(node)) {
      halt(
        `${file} line ${lineOf(sourceFile, node)} uses an import-equals declaration, a form this closure cannot follow, so a callee of the resume render path could be missing from the census`
      )
      return
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      halt(
        `${file} line ${lineOf(sourceFile, node)} calls a dynamic import, a form this closure cannot follow, so a callee of the resume render path could be missing from the census`
      )
      return
    }
    if (ts.isImportDeclaration(node)) {
      addEdge(node.moduleSpecifier, importIsTypeOnly(node), node)
      return
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      addEdge(node.moduleSpecifier, exportIsTypeOnly(node), node)
    }
  })

  return found
}

export const admitsValueEdge = (edge: ImportEdge): boolean => !edge.typeOnly

export const admitsEveryEdge = (): boolean => true

export const closeForward = (
  edgesFor: ReadonlyMap<string, readonly ImportEdge[]>,
  seed: string,
  admits: (edge: ImportEdge) => boolean
): string[] => {
  const edgesOut = (file: string): readonly ImportEdge[] => {
    const edges = edgesFor.get(file)
    if (edges === undefined) {
      return halt(
        `${file} was reached by the forward closure of ${seed} yet has no import edges recorded, because only files under ${SOURCE_ROOT_PREFIX} were scanned for edges; treating it as a leaf would silently drop its own callees from the census population`
      )
    }
    return edges
  }
  const grow = (reached: readonly string[]): readonly string[] => {
    const targets = reached
      .flatMap((file) => edgesOut(file))
      .filter(admits)
      .map((edge) => edge.target)
    const joined = targets.filter(
      (target, index) => !reached.includes(target) && targets.indexOf(target) === index
    )
    return joined.length === 0 ? reached : grow([...reached, ...joined])
  }
  return [...grow([seed])].sort()
}

const helperModuleOf = (
  program: ts.Program,
  checker: ts.TypeChecker,
  byRelPath: ReadonlyMap<string, string>,
  files: readonly string[]
): string => {
  const declaring = files.filter((file) => {
    const absolute = byRelPath.get(file)
    if (absolute === undefined) return halt(`${file} is in the closure yet is absent from the compiled program`)
    return declaredHelperSymbol(checker, sourceFileFor(program, absolute)) !== null
  })
  const [first, ...rest] = declaring
  if (first === undefined) {
    return halt(
      `no file in the forward closure of ${SEED_FILE} declares ${HELPER_NAME}, so the symbol resolver has nothing to resolve against and this census would collect nothing through it; closure ${files.join(', ')}`
    )
  }
  if (rest.length > 0) {
    return halt(
      `${declaring.join(', ')} each declare ${HELPER_NAME}, so a call site cannot be attributed to one declaration and the symbol resolution below would be ambiguous`
    )
  }
  return first
}

const helperSpecifiersIn = (
  program: ts.Program,
  byRelPath: ReadonlyMap<string, string>,
  file: string,
  helperModule: string
): string[] => {
  const absolute = byRelPath.get(file)
  if (absolute === undefined) return halt(`${file} is in the closure yet is absent from the compiled program`)
  const sourceFile = sourceFileFor(program, absolute)
  const found: string[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return
    const specifier = node.moduleSpecifier.text
    if (!specifier.startsWith('.')) return
    if (path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) !== helperModule) return
    found.push(specifier)
  })
  return found
}

type ResumePathCensus = {
  valueClosure: string[]
  everyEdgeClosure: string[]
  helperModule: string
  population: SettlednessSite[]
}

export const resumePathCensus = (): ResumePathCensus => {
  const { program, checker } = loadSourceProgram()
  const byRelPath = new Map(program.getRootFileNames().map((fileName) => [toPosix(relativeToRoot(fileName)), fileName]))
  const sourceFiles = [...byRelPath.keys()].filter((file) => file.startsWith(SOURCE_ROOT_PREFIX)).sort()
  if (!byRelPath.has(SEED_FILE)) {
    halt(`${SEED_FILE} is not part of the compiled program, so the forward closure has no seed`)
  }
  const edgesFor = new Map<string, readonly ImportEdge[]>(
    sourceFiles.map((file) => [file, edgesOf(program, byRelPath, file)])
  )
  const valueClosure = closeForward(edgesFor, SEED_FILE, admitsValueEdge)
  const everyEdgeClosure = closeForward(edgesFor, SEED_FILE, admitsEveryEdge)
  const helperModule = helperModuleOf(program, checker, byRelPath, valueClosure)
  const population = valueClosure.flatMap((file) => {
    const absolute = byRelPath.get(file)
    if (absolute === undefined) return halt(`${file} is in the closure yet is absent from the compiled program`)
    return collectSettlednessSites(
      checker,
      sourceFileFor(program, absolute),
      file,
      helperSpecifiersIn(program, byRelPath, file, helperModule)
    )
  })
  return { valueClosure, everyEdgeClosure, helperModule, population }
}
