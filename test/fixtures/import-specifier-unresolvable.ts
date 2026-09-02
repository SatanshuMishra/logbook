const modulePathFromAVariable = 'node:os'

export const dynamicImportFromVariable = (): Promise<unknown> => import(modulePathFromAVariable)

export const requireFromVariable = (): unknown => require(modulePathFromAVariable)
