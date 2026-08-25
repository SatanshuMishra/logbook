import { z } from '/Users/satanshumishra/Documents/DevLabs/logbook/node_modules/zod/index.js'
const S = z.strictObject({
  a: z.string().regex(/^[0-9A-Z]{26}$/).nullable().describe('a nullable ulid field for probing'),
  b: z.string().regex(/^[0-9A-Z]{26}$/).optional().describe('an optional ulid field for probing'),
  c: z.array(z.object({ system: z.string().describe('the system name'), id: z.string().describe('the id there') })).optional().describe('an optional array of objects'),
})
console.log(JSON.stringify(z.toJSONSchema(S, { target: 'draft-7', io: 'input' }), null, 2))
