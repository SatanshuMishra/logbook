import { z } from 'zod'
import { refuse as buildRefusal } from './refusal.ts'

export type Ok<T> = { ok: true; value: T }
export type Refusal = {
  ok: false
  field: string
  accepted: string
  example: string
  retryable: boolean
  message: string
}

export type Declared<T> = {
  readonly name: string
  readonly schema: z.ZodType<T>
  readonly jsonSchema: Record<string, unknown>
  parse: (input: unknown) => Ok<T> | Refusal
  refuse: (issues: z.core.$ZodIssue[]) => Refusal
}

export const declare = <T>(name: string, schema: z.ZodType<T>): Declared<T> => {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>

  const refuse = (issues: z.core.$ZodIssue[]): Refusal => buildRefusal(jsonSchema, issues)

  const parse = (input: unknown): Ok<T> | Refusal => {
    const result = schema.safeParse(input)
    if (result.success) {
      return { ok: true, value: result.data }
    }
    return refuse(result.error.issues)
  }

  return { name, schema, jsonSchema, parse, refuse }
}
