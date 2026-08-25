import { z } from 'zod'
import { declare } from './src/schema/declare.ts'
import { classifyDescribedNode } from './test/contract/described.test.ts'

const optSchema = z.strictObject({
  a: z.string().min(1).describe('a required field'),
  predecessor_id: z.string().optional().describe('the thread this one succeeds')
})
const nulSchema = z.strictObject({
  a: z.string().min(1).describe('a required field'),
  predecessor_id: z.string().nullable().describe('the thread this one succeeds')
})
const dump = (label: string, s: z.ZodType) => {
  const js = declare('probe', s).jsonSchema as Record<string, unknown>
  const props = js.properties as Record<string, unknown>
  console.log(label, JSON.stringify(props.predecessor_id))
}
dump('OPTIONAL:', optSchema)
dump('NULLABLE:', nulSchema)
