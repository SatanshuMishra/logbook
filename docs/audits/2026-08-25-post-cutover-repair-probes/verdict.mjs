import { classifyDescribedNode } from '/Users/satanshumishra/Documents/DevLabs/logbook/test/contract/described.test.ts'
const nullableNode = { path: 'open_thread.predecessor_id', value: { anyOf: [{ type:'string', pattern:'^[0-9A-HJKMNP-TV-Z]{26}$'}, {type:'null'}], description: 'the thread this one succeeds, or null' } }
const optionalNode = { path: 'open_thread.predecessor_id', value: { type:'string', pattern:'^[0-9A-HJKMNP-TV-Z]{26}$', description: 'the thread this one succeeds' } }
console.log('nullable (.nullable()) ->', classifyDescribedNode(nullableNode))
console.log('plain optional        ->', classifyDescribedNode(optionalNode))
console.log('missing description   ->', classifyDescribedNode({path:'x', value:{type:'string'}}))
console.log('short description     ->', classifyDescribedNode({path:'x', value:{type:'string', description:'too short'}}))
