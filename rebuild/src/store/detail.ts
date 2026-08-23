import type { Refusal } from '../schema/declare.ts'

export const errnoCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return 'unknown'
}

const existingDetail = (refusal: Refusal): string | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(refusal, 'detail')
  return descriptor !== undefined && typeof descriptor.value === 'string' ? descriptor.value : undefined
}

export const withDetail = <R extends Refusal>(refusal: R, detail: string): R => {
  const priorDetail = existingDetail(refusal)
  const mergedDetail = priorDetail === undefined ? detail : `${priorDetail} | ${detail}`
  const next: R = { ...refusal }
  Object.defineProperty(next, 'detail', {
    value: mergedDetail,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return next
}
