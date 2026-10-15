import { z } from 'zod'

export const NO_ARGUMENTS: z.ZodObject<Record<string, never>, z.core.$strict> = z.strictObject({})
