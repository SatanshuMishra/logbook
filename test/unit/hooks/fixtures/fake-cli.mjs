#!/usr/bin/env node
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'roster') {
  process.stdout.write(`${JSON.stringify([{ id: 'X', slug: 's', title: 't', status: 'active', next_step: 'n' }])}\n`);
} else if (cmd === 'active-thread') {
  process.stdout.write(`${JSON.stringify({ thread_id: rest[0] ?? null })}\n`);
} else if (cmd === 'boom') {
  process.stderr.write('boom\n');
  process.exit(1);
} else if (cmd === 'notjson') {
  process.stdout.write('this is not json\n');
} else {
  process.stdout.write('{}\n');
}
