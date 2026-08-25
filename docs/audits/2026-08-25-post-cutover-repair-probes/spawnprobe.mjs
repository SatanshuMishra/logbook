import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const cp = require('node:child_process')
const M = ['spawnSync','spawn','execFileSync','execFile','exec','execSync','fork']
let n = 0
const orig = {}
for (const m of M) { orig[m] = cp[m]; cp[m] = (...a) => { n++; console.log('SPAWN during import:', m, a[0]); return orig[m](...a) } }
await import('/Users/satanshumishra/Documents/DevLabs/logbook/src/server/tools/index.ts')
await import('/Users/satanshumishra/Documents/DevLabs/logbook/src/server/register.ts')
console.log('spawns during registry import:', n)
