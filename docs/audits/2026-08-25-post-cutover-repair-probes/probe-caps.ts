const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { contributeToSpine } = await import(`${R}/src/domain/spine.ts`)
const { ThreadRecord } = await import(`${R}/src/schema/thread.ts`)
const caps = await import(`${R}/src/schema/caps.ts`)

let seq = 0
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ulid = () => { let v = seq++; const c: string[] = []; for (let i=0;i<16;i+=1){c.unshift(ALPHA[v%32]!);v=Math.floor(v/32)} return `01ARZ3NDEK${c.join('')}` }

const kd = (title: string, scope: string) => ({ id: ulid(), decision_id: ulid(), title, scope })
const spine = (list: unknown[]) => ({ active_goal:'g', next_step:'n', last_session:'l', open_risks:[], key_decisions:list as never, out_of_scope:[] })
const thread = (list: unknown[]) => ({
  id: '01ARZ3NDEKZZZZZZZZZZZZZZZZ', slug:'probe', title:'probe', status:'open' as const, blocked_by:null,
  completion_criteria:[{id:'01ARZ3NDEKYYYYYYYYYYYYYYYY',ordinal:1,text:'c',done:false,kind:'planned' as const,struck_by:null}],
  spine: spine(list), created_at:'2024-01-01T00:00:00.000Z', updated_at:'2024-01-01T00:00:00.000Z'
})

console.log('KEY_DECISIONS_MAX_ELEMENTS          =', caps.KEY_DECISIONS_MAX_ELEMENTS)
console.log('KEY_DECISION_TITLE_MAX              =', caps.KEY_DECISION_TITLE_MAX)
console.log('KEY_DECISION_SCOPE_MAX              =', caps.KEY_DECISION_SCOPE_MAX)
console.log('THREAD_RECORD_SERIALISED_MAX_BYTES  =', caps.THREAD_RECORD_SERIALISED_MAX_BYTES)

console.log('\n--- A. element-count boundary via contributeToSpine ---')
const at200 = Array.from({length:200},(_,i)=>kd(`d${i}`,'s'))
const r201 = contributeToSpine(spine(at200), { key_decisions: [kd('the 201st','s')] })
console.log('stored=200, add 1 ->', r201.ok ? 'ACCEPTED' : `REFUSED field=${r201.field}`)
if (!r201.ok) console.log('  message:', r201.message)
const at199 = Array.from({length:199},(_,i)=>kd(`d${i}`,'s'))
const r200 = contributeToSpine(spine(at199), { key_decisions: [kd('the 200th','s')] })
console.log('stored=199, add 1 ->', r200.ok ? 'ACCEPTED' : `REFUSED field=${r200.field}`)

console.log('\n--- B. byte cap: where does ThreadRecord.parse start failing? ---')
const short = (n:number)=>Array.from({length:n},(_,i)=>kd(`d${i}`,'s'))
const long  = (n:number)=>Array.from({length:n},(_,i)=>kd('t'.repeat(200),'c'.repeat(200)))
for (const [label, mk] of [['short titles', short],['max-length titles', long]] as const) {
  let firstFail = -1
  for (let n=1;n<=200;n+=1) {
    seq = 0
    const p = ThreadRecord.parse(thread(mk(n)))
    if (!p.ok) { firstFail = n; break }
  }
  seq = 0
  const bytes200 = Buffer.byteLength(JSON.stringify(thread(mk(200))),'utf8')
  console.log(`${label.padEnd(18)} first byte-cap failure at n=${firstFail === -1 ? 'never (<=200)' : firstFail}, bytes at n=200 = ${bytes200}`)
}

console.log('\n--- C. what a spine-only cap check MISSES ---')
seq = 0
const bigStored = long(60)
const contribution = [kd('t'.repeat(200),'c'.repeat(200))]
const spineCheck = contributeToSpine(spine(bigStored), { key_decisions: contribution })
console.log('contributeToSpine at stored=60 max-length ->', spineCheck.ok ? 'ACCEPTED' : `REFUSED ${spineCheck.field}`)
if (spineCheck.ok) {
  const parsed = ThreadRecord.parse({ ...thread([]), spine: spineCheck.value })
  console.log('ThreadRecord.parse of that same result   ->', parsed.ok ? 'ACCEPTED' : 'REFUSED')
  if (!parsed.ok) console.log('  message:', parsed.message)
}
