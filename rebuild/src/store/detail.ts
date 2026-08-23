import type { Refusal } from '../schema/declare.ts'

export const errnoCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return 'unknown'
}

export const withDetail = <R extends Refusal>(refusal: R, detail: string): R => {
  Object.defineProperty(refusal, 'detail', {
    value: detail,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return refusal
}
