import { z } from 'zod'

export const POINTER_PATTERN = /^(?!\+\+\+ )(?!--- )(?!.*(?:```|@@ |U\+000A|U\+000D))[^\r\n]*$/

export const structural = <T extends z.ZodType>(schema: T): T => schema.meta({ class: 'structural' }) as T

export const content = <T extends z.ZodType>(schema: T): T => schema.meta({ class: 'content' }) as T

export const pointer = (max: number, description: string) =>
  z.string().max(max).regex(POINTER_PATTERN).describe(description).meta({ class: 'pointer' })
