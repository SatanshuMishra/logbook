import Ajv from 'ajv';
import { projectValidationErrors } from '../schema/index.mjs';
import { LedgerError, ToolError, echo } from './shared.mjs';
import openThread from './open-thread.mjs';
import bindBranch from './bind-branch.mjs';
import appendSessionEvent from './append-session-event.mjs';
import recordDecision from './record-decision.mjs';
import transitionThread from './transition-thread.mjs';
import updateThread from './update-thread.mjs';
import amendCriteria from './amend-criteria.mjs';
import archiveThread from './archive-thread.mjs';
import createSuccessor from './create-successor.mjs';
import reopen from './reopen.mjs';
import reconcile from './reconcile.mjs';
import rebuildIndex from './rebuild-index.mjs';
import getResumeBrief from './get-resume-brief.mjs';
import readDecision from './read-decision.mjs';

export const TOOLS = [
  openThread,
  bindBranch,
  appendSessionEvent,
  recordDecision,
  transitionThread,
  updateThread,
  amendCriteria,
  archiveThread,
  createSuccessor,
  reopen,
  reconcile,
  rebuildIndex,
  getResumeBrief,
  readDecision,
];

const ajv = new Ajv({ allErrors: true, verbose: true });
const byName = new Map();
const validators = new Map();
for (const tool of TOOLS) {
  byName.set(tool.name, tool);
  validators.set(tool.name, ajv.compile(tool.inputSchema));
}

export class ToolValidationError extends LedgerError {
  constructor(toolName, errors) {
    const problems = projectValidationErrors(errors, { prefix: toolName });
    super({
      layer: 'input',
      ...(problems[0] ?? {
        code: 'invalid_value',
        field: toolName,
        expected: 'arguments the tool schema accepts',
        retryable: false,
        remedy: `correct the arguments to ${toolName} and re-send`,
      }),
      problems,
    });
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.errors = errors;
  }
}

export function listTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(name, args = {}, ctx) {
  const tool = byName.get(name);
  if (!tool) {
    throw new ToolError({
      code: 'unknown_tool',
      layer: 'server',
      field: 'name',
      expected: 'a tool name this server declares in tools/list',
      retryable: false,
      remedy: `unknown tool: ${echo(name)}; re-read tools/list and call a name it returns`,
    });
  }
  const validate = validators.get(name);
  if (!validate(args)) {
    throw new ToolValidationError(name, [...validate.errors]);
  }
  return tool.handler(ctx, args);
}
