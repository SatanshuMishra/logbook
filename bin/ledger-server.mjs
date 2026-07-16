import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContext, listTools, callTool } from '../src/tools/index.mjs';

export const SERVER_INFO = { name: 'ledger', version: '0.1.0' };

export const SERVER_ENV_MAP = {
  LEDGER_BACKEND: 'ledger_backend',
  LEDGER_BRANCH: 'ledger_branch',
};

export function envToUserConfig(env = process.env) {
  const userConfig = {};
  for (const [envKey, configKey] of Object.entries(SERVER_ENV_MAP)) {
    const value = env[envKey];
    if (typeof value === 'string' && value.length > 0) {
      userConfig[configKey] = value;
    }
  }
  return userConfig;
}

export function createLedgerServer({
  buildContext: build = buildContext,
  listTools: list = listTools,
  callTool: call = callTool,
  env = process.env,
} = {}) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  let contextPromise = null;
  const resolveContext = () => {
    if (!contextPromise) {
      contextPromise = Promise.resolve()
        .then(() => build({ userConfig: envToUserConfig(env) }))
        .catch((error) => {
          contextPromise = null;
          throw error;
        });
    }
    return contextPromise;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: list() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const ctx = await resolveContext();
      const result = await call(name, args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.name, message: error.message }) }],
        isError: true,
      };
    }
  });

  return server;
}

export async function main() {
  const server = createLedgerServer();
  await server.connect(new StdioServerTransport());
}

function isEntrypoint() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`ledger-server: fatal: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
