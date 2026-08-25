import { INSTRUCTIONS } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/server/instructions.ts'
import { ALL_TOOLS } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/server/register.ts'
const B = (s) => Buffer.byteLength(s, 'utf8')
console.log('INSTRUCTIONS bytes =', B(INSTRUCTIONS), 'budget 2048, headroom =', 2048 - B(INSTRUCTIONS))
const term = /[.!?](?:\s|$)/
for (const t of ALL_TOOLS) {
  const m = term.exec(t.description)
  const lead = m === null ? null : B(t.description.slice(0, m.index + 1))
  console.log(`${t.name.padEnd(18)} descBytes=${String(B(t.description)).padStart(4)} (limit<2048, headroom ${2048-B(t.description)})  leadBytes=${String(lead).padStart(4)} (limit<=200, headroom ${lead===null?'n/a':200-lead})`)
}
