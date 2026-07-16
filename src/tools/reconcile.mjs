import { runReconcile } from '../drift/index.mjs';
import { commitAndReindex } from './shared.mjs';
import { emptyInput } from './schemas.mjs';

async function handler(ctx) {
  const { drift, dispositions } = await runReconcile(ctx);
  await commitAndReindex(ctx.driver, 'chore(ledger): reconcile');
  return { drift, dispositions };
}

export default {
  name: 'reconcile',
  description: 'Reconcile branch/binding drift and re-attach renamed branches; mutates bindings, then commits.',
  inputSchema: emptyInput,
  handler,
};
